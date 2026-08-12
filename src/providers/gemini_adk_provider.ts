import { InMemoryRunner, LlmAgent, isFinalResponse, stringifyContent } from '@google/adk';
import type { LlmAgentSchema } from '@google/adk';
import { z } from 'zod';
import { ModelProvider, StructuredGenerationRequest } from '../runtime/model_provider';

export class GeminiAdkProvider implements ModelProvider {
  readonly id = 'gemini-adk';

  async generateStructured<T extends z.ZodType>(request: StructuredGenerationRequest<T>): Promise<z.infer<T>> {
    const agent = new LlmAgent({
      name: request.name,
      description: request.description,
      model: request.model ?? process.env.EGO_MODEL ?? process.env.EGO_FAST_MODEL ?? 'gemini-3.5-flash',
      instruction: request.instruction,
      outputSchema: request.schema as unknown as LlmAgentSchema,
      disallowTransferToParent: true,
      disallowTransferToPeers: true,
      includeContents: 'none',
      generateContentConfig: { temperature: 0.2 },
    });
    const runner = new InMemoryRunner({ agent, appName: 'ego_runtime' });
    let output = '';
    for await (const event of runner.runEphemeral({
      userId: request.userId,
      newMessage: { role: 'user', parts: [{ text: request.prompt }] },
    })) {
      if (isFinalResponse(event)) output = stringifyContent(event);
    }
    if (!output) throw new Error(`${request.name} returned no final response`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error(`${request.name} returned invalid JSON`);
    }
    return request.schema.parse(parsed);
  }
}
