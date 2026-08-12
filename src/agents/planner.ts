import { GoogleGenAI, Type, Schema } from '@google/genai';
import { StudyPlanSchema } from '../domain/types';

// Convert Zod schema to Gemini's expected Schema format
const geminiStudyPlanSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    learning_objective: { type: Type.STRING },
    sub_objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
    required_concepts: { type: Type.ARRAY, items: { type: Type.STRING } },
    dependencies: { type: Type.ARRAY, items: { type: Type.STRING } },
    estimated_difficulty: { type: Type.STRING },
    study_sessions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING },
          duration_minutes: { type: Type.INTEGER },
          activities: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["topic", "duration_minutes", "activities"]
      }
    },
    deliverables: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: [
    "learning_objective", 
    "sub_objectives", 
    "required_concepts", 
    "dependencies", 
    "estimated_difficulty", 
    "study_sessions", 
    "deliverables"
  ]
};

export class PlannerAgent {
  private ai: GoogleGenAI;
  // Use a fast model for structuring plans
  private model = process.env.ARIA_FAST_MODEL || 'gemini-2.5-flash';

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async buildStudyPlan(objective: string, materialsInfo: string): Promise<string> {
    const prompt = `
      You are the Aria Learning Planner.
      Create a highly structured study plan for the following objective.
      
      Objective: ${objective}
      Available Materials: ${materialsInfo}
      
      Produce a JSON object that adheres strictly to the required schema.
    `;

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: geminiStudyPlanSchema,
        temperature: 0.2
      }
    });

    return response.text || '{}';
  }
}
