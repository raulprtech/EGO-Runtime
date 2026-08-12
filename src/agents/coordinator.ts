import { ExecuteRequest, JobStatus } from '../api/schemas/runtime_schemas';
import { EventTracker } from '../runtime/events';
import { getFirestore, COLLECTIONS } from '../services/firestore';
import { ArtifactStore } from '../services/artifact_store';
import { PlannerAgent } from './planner';
import { DocumentAnalyzerAgent } from './document_analyzer';

export class Coordinator {
  private request: ExecuteRequest;
  private tracker: EventTracker;

  constructor(request: ExecuteRequest) {
    this.request = request;
    this.tracker = new EventTracker(request.request_id, request.session_id);
  }

  async run(): Promise<void> {
    const db = getFirestore();
    const jobRef = db.collection(COLLECTIONS.JOBS).doc(this.request.request_id);

    try {
      await jobRef.update({ status: 'running' as JobStatus, updated_at: new Date().toISOString() });
      await this.tracker.emit('runtime_started', { message: 'Coordinator initialized' });

      // 1. Artifact Validation
      await this.tracker.emit('validating_artifacts', { count: this.request.attachments.length });
      for (const artifact of this.request.attachments) {
        await ArtifactStore.validateIncomingArtifact(artifact);
      }

      // Simulate extraction of content from artifacts.
      // In reality, this would involve downloading from GCS and parsing PDF text.
      const simulatedContext = `
        Extracted content from ${this.request.attachments.length} PDFs.
        Topics likely involve: ${this.request.message}
      `;

      await this.tracker.emit('analyzing_material', { message: 'Extracting knowledge from sources' });

      // 2. Planning
      await this.tracker.emit('planning', { message: 'Building study plan' });
      const planner = new PlannerAgent();
      const studyPlanJsonStr = await planner.buildStudyPlan(this.request.message, simulatedContext);
      
      // Save JSON Artifact
      await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id,
        'study_plan',
        'study_plan.json',
        'application/json',
        studyPlanJsonStr
      );

      // Create Markdown version
      const planObj = JSON.parse(studyPlanJsonStr);
      const studyPlanMd = `# Study Plan: ${planObj.learning_objective}\n\n## Sub-objectives\n${planObj.sub_objectives?.map((o: string) => '- ' + o).join('\n')}\n\n## Sessions\n${planObj.study_sessions?.map((s: any) => '### ' + s.topic + '\nDuration: ' + s.duration_minutes + 'm\n' + s.activities.join(', ')).join('\n\n')}`;
      
      await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id,
        'study_plan_markdown',
        'study_plan.md',
        'text/markdown',
        studyPlanMd
      );

      // 3. Document Analysis & Concept Mapping
      await this.tracker.emit('extracting_concepts', { message: 'Generating concept map' });
      const analyzer = new DocumentAnalyzerAgent();
      const conceptMapJsonStr = await analyzer.generateConceptMap(simulatedContext);
      
      await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id,
        'concept_map',
        'concept_map.json',
        'application/json',
        conceptMapJsonStr
      );

      // 4. Completion
      await this.tracker.emit('completed', { message: 'Workflow finished successfully' });
      await jobRef.update({ status: 'completed' as JobStatus, updated_at: new Date().toISOString() });

    } catch (error: any) {
      console.error(`[Coordinator] Error in job ${this.request.request_id}:`, error);
      await this.tracker.emit('failed', { error: error.message || 'Unknown error' });
      await jobRef.update({ status: 'failed' as JobStatus, updated_at: new Date().toISOString() });
      throw error;
    }
  }
}
