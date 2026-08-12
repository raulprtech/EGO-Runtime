import { z } from 'zod';
import { getModelProvider, StructuredGenerationRequest } from './model_provider';

export async function runStructuredAgent<T extends z.ZodType>(
  request: StructuredGenerationRequest<T>,
): Promise<z.infer<T>> {
  const provider = await getModelProvider();
  return provider.generateStructured(request);
}
