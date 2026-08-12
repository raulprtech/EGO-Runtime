import { ExecuteRequest } from '../api/schemas/runtime_schemas';
import { EventTracker } from '../runtime/events';
import { getFirestore, COLLECTIONS } from '../services/firestore';
import { ArtifactStore } from '../services/artifact_store';
import { JobLifecycle } from '../services/job_lifecycle';
import { PlannerAgent } from './planner';
import { DocumentAnalyzerAgent } from './document_analyzer';
import { PracticeDesignerAgent } from './practice_designer';
import { MasteryState } from '../domain/types';

const maxTotalContextChars = Number(process.env.MAX_TOTAL_CONTEXT_CHARS ?? 500_000);

export class Coordinator {
  private readonly tracker: EventTracker;
  constructor(private readonly request: ExecuteRequest) {
    this.tracker = new EventTracker(request.request_id, request.session_id);
  }

  async run(): Promise<boolean> {
    const owner = await JobLifecycle.claim(this.request.request_id);
    if (!owner) return false;
    const jobRef = getFirestore().collection(COLLECTIONS.JOBS).doc(this.request.request_id);

    try {
      await this.tracker.emit('runtime_started');
      const extracted: string[] = [];
      let totalChars = 0;
      for (const artifact of this.request.attachments) {
        await JobLifecycle.assertAndRenew(this.request.request_id, owner);
        await this.tracker.emit('extracting_document', { artifact_id: artifact.id });
        const text = await ArtifactStore.readArtifact(artifact);
        totalChars += text.length;
        if (totalChars > maxTotalContextChars) throw new Error('Combined source material exceeds MAX_TOTAL_CONTEXT_CHARS');
        extracted.push(`## Source ${artifact.id}: ${artifact.name}\n${text}`);
      }
      if (!extracted.length) throw new Error('At least one source artifact is required');
      const context = extracted.join('\n\n');
      const artifactIds = new Set(this.request.attachments.map(item => item.id));

      await JobLifecycle.assertAndRenew(this.request.request_id, owner);
      const conceptMap = await new DocumentAnalyzerAgent().generateConceptMap(
        context, [...artifactIds], this.request.user_id);
      for (const node of conceptMap.nodes) {
        if (!node.source_artifact_ids.length || node.source_artifact_ids.some(id => !artifactIds.has(id))) {
          throw new Error(`Concept ${node.id} contains invalid source references`);
        }
      }
      const conceptIds = new Set(conceptMap.nodes.map(node => node.id));
      if (conceptIds.size !== conceptMap.nodes.length || conceptMap.edges.some(edge =>
        !conceptIds.has(edge.source) || !conceptIds.has(edge.target))) {
        throw new Error('Concept map contains duplicate or unknown concept references');
      }
      const conceptArtifact = await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id, 'concept_map', 'concept_map.json', 'application/json',
        JSON.stringify(conceptMap, null, 2));

      await JobLifecycle.assertAndRenew(this.request.request_id, owner);
      const plan = await new PlannerAgent().buildStudyPlan(this.request.message, context, this.request.user_id);
      const planArtifact = await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id, 'study_plan', 'study_plan.json', 'application/json',
        JSON.stringify(plan, null, 2));

      await JobLifecycle.assertAndRenew(this.request.request_id, owner);
      const practice = await new PracticeDesignerAgent().build(conceptMap, this.request.message, this.request.user_id);
      const practiceItems = [...practice.flashcards, ...practice.quiz];
      const practiceIds = new Set(practiceItems.map(item => item.id));
      if (practiceIds.size !== practiceItems.length) throw new Error('Practice set contains duplicate item IDs');
      for (const item of practiceItems) {
        if (!conceptIds.has(item.concept_id) || !item.source_artifact_ids.length ||
            item.source_artifact_ids.some(id => !artifactIds.has(id))) {
          throw new Error(`Practice item ${item.id} contains invalid grounding references`);
        }
      }
      await jobRef.collection('internal').doc('practice').set(practice);
      const learnerPractice = {
        session: practice.session,
        flashcards: practice.flashcards,
        quiz: practice.quiz.map(({ answer_key: _answerKey, rubric: _rubric, ...question }) => question),
      };
      const practiceArtifact = await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id, 'practice_set', 'practice_set.json', 'application/json',
        JSON.stringify(learnerPractice, null, 2));

      const now = new Date();
      const nextReview = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const mastery: MasteryState = {
        objective_id: this.request.objective_id,
        concepts: conceptMap.nodes.map(node => ({
          concept_id: node.id, label: node.label, confidence: 0, attempts: 0, next_review_at: nextReview,
        })),
        updated_at: now.toISOString(),
      };
      await jobRef.collection('state').doc('mastery').set(mastery);
      const masteryArtifact = await ArtifactStore.saveGeneratedArtifact(
        this.request.request_id, 'mastery_state', 'mastery_state.json', 'application/json',
        JSON.stringify(mastery, null, 2));

      await JobLifecycle.assertAndRenew(this.request.request_id, owner);
      const artifacts = [conceptArtifact, planArtifact, practiceArtifact, masteryArtifact];
      if (!await JobLifecycle.complete(this.request.request_id, owner, artifacts)) return false;
      await this.tracker.emit('completed', { artifact_ids: artifacts.map(item => item.id) });
      return true;
    } catch (error) {
      if (error instanceof Error && ['JOB_CANCELLED', 'LEASE_LOST'].includes(error.message)) return false;
      const message = error instanceof Error ? error.message : 'Unknown error';
      await JobLifecycle.fail(this.request.request_id, owner, message);
      await this.tracker.emit('failed', { error: message });
      throw error;
    }
  }
}
