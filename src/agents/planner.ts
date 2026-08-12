import { StudyPlan, StudyPlanSchema } from '../domain/types';
import { runStructuredAgent } from '../runtime/adk';

export class PlannerAgent {
  buildStudyPlan(objective: string, materials: string, userId: string): Promise<StudyPlan> {
    return runStructuredAgent({
      name: 'learning_planner', description: 'Builds evidence-grounded mastery plans.',
      userId, schema: StudyPlanSchema,
      instruction: 'Design rigorous learning plans grounded only in supplied sources. Mix focused study, Feynman explanations, retrieval practice, quizzes and spaced review. Never claim unsupported knowledge.',
      prompt: `Learning objective:\n${objective}\n\nExtracted source material:\n${materials}`,
    });
  }
}
