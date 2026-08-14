import { afterEach, describe, expect, it } from 'vitest';
import { AssessmentGraderAgent } from '../src/agents/assessment_grader';
import { DocumentAnalyzerAgent } from '../src/agents/document_analyzer';
import { PlannerAgent } from '../src/agents/planner';
import { PracticeDesignerAgent } from '../src/agents/practice_designer';
import { isModelProviderConfigured, setModelProvider } from '../src/runtime/model_provider';

describe('deterministic demo provider', () => {
  afterEach(() => {
    delete process.env.MODEL_PROVIDER;
    setModelProvider(undefined);
  });

  it('builds and assesses a source-derived learning package without credentials', async () => {
    process.env.MODEL_PROVIDER = 'deterministic-demo';
    expect(isModelProviderConfigured()).toBe(true);
    const material = '## Source source_1: lesson.md\n# Photosynthesis\nPlants transform light into stored energy.';
    const concepts = await new DocumentAnalyzerAgent().generateConceptMap(
      material, ['source_1'], 'learner_1',
    );
    expect(concepts.nodes[0]).toMatchObject({
      label: 'Photosynthesis', source_artifact_ids: ['source_1'],
    });
    const plan = await new PlannerAgent().buildStudyPlan(
      'Understand photosynthesis', material, 'learner_1',
    );
    expect(plan.required_concepts).toContain('Photosynthesis');
    const practice = await new PracticeDesignerAgent().build(
      concepts, 'Understand photosynthesis', 'learner_1',
    );
    expect(practice.flashcards).toHaveLength(3);
    expect(practice.quiz).toHaveLength(3);
    const assessment = await new AssessmentGraderAgent().grade(
      practice,
      practice.quiz.map(question => ({
        question_id: question.id,
        answer: `My explanation includes ${question.answer_key}.`,
      })),
      'learner_1',
      'es-MX',
    );
    expect(assessment.results.every(result => result.score === 1)).toBe(true);
    expect(assessment.summary).toBe('Se recuperaron todos los conceptos enviados.');
    expect(assessment.results.every(result => result.feedback.startsWith('La respuesta'))).toBe(true);
  });
});
