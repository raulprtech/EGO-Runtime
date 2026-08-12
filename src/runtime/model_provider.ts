import { z } from 'zod';

export interface StructuredGenerationRequest<T extends z.ZodType> {
  name: string;
  description: string;
  instruction: string;
  prompt: string;
  schema: T;
  userId: string;
  model?: string;
  abortSignal?: AbortSignal;
}

export interface ModelProvider {
  readonly id: string;
  generateStructured<T extends z.ZodType>(request: StructuredGenerationRequest<T>): Promise<z.infer<T>>;
}

let override: ModelProvider | undefined;

export function setModelProvider(provider?: ModelProvider): void {
  override = provider;
}

export async function getModelProvider(): Promise<ModelProvider> {
  if (override) return override;
  const provider = process.env.MODEL_PROVIDER ?? 'gemini-adk';
  if (provider === 'gemini-adk') {
    const { GeminiAdkProvider } = await import('../providers/gemini_adk_provider');
    return new GeminiAdkProvider();
  }
  throw new Error(`Unsupported MODEL_PROVIDER: ${provider}`);
}
