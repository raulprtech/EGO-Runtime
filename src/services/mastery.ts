import { AssessmentResult, MasteryState } from '../domain/types';

export function updateMasteryState(
  mastery: MasteryState,
  assessment: AssessmentResult,
  updatedAt = new Date(),
): MasteryState {
  const scores = new Map<string, number[]>();
  for (const result of assessment.results) {
    const values = scores.get(result.concept_id) ?? [];
    values.push(result.score);
    scores.set(result.concept_id, values);
  }
  return {
    ...mastery,
    updated_at: updatedAt.toISOString(),
    concepts: mastery.concepts.map(concept => {
      const values = scores.get(concept.concept_id);
      if (!values?.length) return concept;
      const score = values.reduce((sum, value) => sum + value, 0) / values.length;
      const confidence = Math.min(1, concept.confidence * 0.4 + score * 0.6);
      const reviewDays = score < 0.6 ? 1 : score < 0.8 ? 3 : 7;
      return {
        ...concept,
        confidence,
        attempts: concept.attempts + values.length,
        next_review_at: new Date(updatedAt.getTime() + reviewDays * 86_400_000).toISOString(),
      };
    }),
  };
}
