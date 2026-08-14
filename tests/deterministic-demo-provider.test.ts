import fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { AssessmentGraderAgent } from '../src/agents/assessment_grader';
import { DocumentAnalyzerAgent } from '../src/agents/document_analyzer';
import { PlannerAgent } from '../src/agents/planner';
import { PracticeDesignerAgent } from '../src/agents/practice_designer';
import { isModelProviderConfigured, setModelProvider } from '../src/runtime/model_provider';
import { PracticeSetSchema } from '../src/domain/types';

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
    expect(assessment.summary).toBe('3 de 3 respuestas dominaron el concepto; 0 expresaron incertidumbre.');
    expect(assessment.results.every(result => result.feedback.startsWith('La respuesta'))).toBe(true);
    expect(assessment.results.every(result => result.reason_code === 'mastered')).toBe(true);
    expect(assessment.calibration_version).toBe('deterministic-bilingual-v1');
  });

  it('matches the versioned bilingual calibration cases with explicit reasons', async () => {
    process.env.MODEL_PROVIDER = 'deterministic-demo';
    const cases = JSON.parse(await fs.readFile(
      new URL('./fixtures/deterministic-assessment-calibration-v1.json', import.meta.url),
      'utf8',
    )) as Array<{
      id: string; answer_key: string; response: string; language: string;
      expected_reason: string; min_score: number; max_score: number;
    }>;
    const practice = PracticeSetSchema.parse({
      session: {
        title: 'Calibration', focus_minutes: 25, feynman_prompt: 'Explain.',
        completion_criteria: ['Complete calibration'],
      },
      flashcards: [1, 2, 3].map(index => ({
        id: `f${index}`, concept_id: `c${index}`, front: 'Front', back: 'Back',
        source_artifact_ids: ['source_1'],
      })),
      quiz: cases.map((item, index) => ({
        id: item.id, concept_id: `calibration_${index + 1}`, prompt: 'Explain.',
        answer_key: item.answer_key, rubric: ['Name or explain the concept'],
        source_artifact_ids: ['source_1'],
      })),
    });

    for (const item of cases) {
      const result = await new AssessmentGraderAgent().grade(
        practice,
        [{ question_id: item.id, answer: item.response }],
        'calibration_learner',
        item.language,
      );
      expect(result.results[0].reason_code, item.id).toBe(item.expected_reason);
      expect(result.results[0].score, item.id).toBeGreaterThanOrEqual(item.min_score);
      expect(result.results[0].score, item.id).toBeLessThanOrEqual(item.max_score);
      expect(result.calibration_version, item.id).toBe('deterministic-bilingual-v1');
    }
  });
});
