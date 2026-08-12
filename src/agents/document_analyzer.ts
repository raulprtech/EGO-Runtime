import { ConceptMap, ConceptMapSchema } from '../domain/types';
import { runStructuredAgent } from '../runtime/adk';

export class DocumentAnalyzerAgent {
  generateConceptMap(documentContext: string, artifactIds: string[], userId: string): Promise<ConceptMap> {
    return runStructuredAgent({
      name: 'document_analyzer', description: 'Extracts source-grounded concepts and relationships.',
      userId, schema: ConceptMapSchema,
      instruction: 'Extract a compact concept graph only from the supplied material. Every node must cite one or more supplied artifact IDs.',
      prompt: `Allowed artifact IDs: ${artifactIds.join(', ')}\n\nMaterial:\n${documentContext}`,
    });
  }
}
