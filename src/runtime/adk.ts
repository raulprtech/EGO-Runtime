import { InMemoryRunner, LlmAgent, isFinalResponse, stringifyContent } from '@google/adk';
import type { LlmAgentSchema } from '@google/adk';
import { z } from 'zod';

export interface StructuredAgentOptions<T extends z.ZodType> {
  name: string; description: string; instruction: string; prompt: string; schema: T;
  userId: string; model?: string; abortSignal?: AbortSignal;
}
export async function runStructuredAgent<T extends z.ZodType>(options: StructuredAgentOptions<T>): Promise<z.infer<T>> {
  const agent = new LlmAgent({
    name: options.name, description: options.description,
    model: options.model ?? process.env.EGO_FAST_MODEL ?? 'gemini-3.5-flash',
    instruction: options.instruction, outputSchema: options.schema as unknown as LlmAgentSchema,
    includeContents: 'none', generateContentConfig: { temperature: 0.2 },
  });
  const runner = new InMemoryRunner({ agent, appName: 'ego_runtime' });
  let output = '';
  for await (const event of runner.runEphemeral({
    userId: options.userId,
    newMessage: { role: 'user', parts: [{ text: options.prompt }] },
  })) {
    if (isFinalResponse(event)) output = stringifyContent(event);
  }
  if (!output) throw new Error(`${options.name} returned no final response`);
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { throw new Error(`${options.name} returned invalid JSON`); }
  return options.schema.parse(parsed);
}
