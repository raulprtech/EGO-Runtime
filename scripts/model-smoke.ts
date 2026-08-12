import 'dotenv/config';
import { z } from 'zod';
import { getModelProvider } from '../src/runtime/model_provider';

const providerName = process.env.MODEL_PROVIDER ?? 'gemini-adk';
if (providerName === 'gemini-adk' && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
  throw new Error('Set GEMINI_API_KEY or GOOGLE_API_KEY before running the model smoke test');
}

const provider = await getModelProvider();
const schema = z.object({
  status: z.literal('ok'),
  message: z.string().min(1).max(120),
});
const startedAt = Date.now();
const result = await provider.generateStructured({
  name: 'provider_smoke',
  description: 'Verifies structured generation through the configured model provider.',
  instruction: 'Return only data matching the supplied schema.',
  prompt: 'Return status "ok" and a brief message confirming structured generation.',
  schema,
  userId: 'local-smoke-test',
});

console.log(JSON.stringify({
  type: 'model.smoke_passed',
  provider: provider.id,
  model: process.env.EGO_MODEL ?? 'provider-default',
  latency_ms: Date.now() - startedAt,
  result,
}));
