import { GoogleGenAI, Type, Schema } from '@google/genai';

const geminiConceptMapSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    nodes: { 
      type: Type.ARRAY, 
      items: { 
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          type: { type: Type.STRING }
        },
        required: ["id", "label", "type"]
      }
    },
    edges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING },
          target: { type: Type.STRING },
          relationship: { type: Type.STRING }
        },
        required: ["source", "target", "relationship"]
      }
    }
  },
  required: ["nodes", "edges"]
};

export class DocumentAnalyzerAgent {
  private ai: GoogleGenAI;
  private model = process.env.ARIA_FAST_MODEL || 'gemini-2.5-flash';

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async generateConceptMap(documentContext: string): Promise<string> {
    const prompt = `
      You are an expert Document Analyzer.
      Extract the core concepts and their relationships from the following document context to build a concept map.
      
      Context: ${documentContext}
      
      Respond with a JSON object containing nodes and edges.
    `;

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: geminiConceptMapSchema,
        temperature: 0.2
      }
    });

    return response.text || '{}';
  }
}
