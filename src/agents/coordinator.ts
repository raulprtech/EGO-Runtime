import { ExecuteRequest, JobStatus } from '../api/schemas/runtime_schemas';
import { EventTracker } from '../runtime/events';
import { getFirestore, COLLECTIONS } from '../services/firestore';
import { ArtifactStore } from '../services/artifact_store';
import { PlannerAgent } from './planner';
import { DocumentAnalyzerAgent } from './document_analyzer';

export class Coordinator {
  private readonly tracker: EventTracker;
  constructor(private readonly request: ExecuteRequest) {
    this.tracker = new EventTracker(request.request_id, request.session_id);
  }
  private async assertActive(): Promise<void> {
    const doc = await getFirestore().collection(COLLECTIONS.JOBS).doc(this.request.request_id).get();
    if (doc.data()?.status === 'cancelled') throw new Error('JOB_CANCELLED');
  }
  async run(): Promise<void> {
    const jobRef = getFirestore().collection(COLLECTIONS.JOBS).doc(this.request.request_id);
    const current = await jobRef.get();
    if (!current.exists || ['completed', 'cancelled'].includes(current.data()?.status)) return;
    try {
      await jobRef.update({ status: 'running' as JobStatus, updated_at: new Date().toISOString() });
      await this.tracker.emit('runtime_started');
      const extracted: string[] = [];
      for (const artifact of this.request.attachments) {
        await this.assertActive();
        await this.tracker.emit('extracting_document', { artifact_id: artifact.id });
        extracted.push(`## Source ${artifact.id}: ${artifact.name}\n${await ArtifactStore.readArtifact(artifact)}`);
      }
      if (!extracted.length) throw new Error('At least one source artifact is required');
      const context = extracted.join('\n\n');
      await this.assertActive();
      const conceptMap = await new DocumentAnalyzerAgent().generateConceptMap(
        context, this.request.attachments.map(a => a.id), this.request.user_id);
      const conceptArtifact = await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id, 'concept_map', 'concept_map.json', 'application/json', JSON.stringify(conceptMap, null, 2));
      await this.assertActive();
      const plan = await new PlannerAgent().buildStudyPlan(this.request.message, context, this.request.user_id);
      const planArtifact = await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id, 'study_plan', 'study_plan.json', 'application/json', JSON.stringify(plan, null, 2));
      await this.assertActive();
      await jobRef.update({ status: 'completed' as JobStatus, artifacts: [conceptArtifact, planArtifact],
        updated_at: new Date().toISOString() });
      await this.tracker.emit('completed', { artifact_ids: [conceptArtifact.id, planArtifact.id] });
    } catch (error) {
      if (error instanceof Error && error.message === 'JOB_CANCELLED') return;
      const message = error instanceof Error ? error.message : 'Unknown error';
      await jobRef.update({ status: 'failed' as JobStatus, error: message, updated_at: new Date().toISOString() });
      await this.tracker.emit('failed', { error: message });
      throw error;
    }
  }
}
