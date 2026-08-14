import { z } from 'zod';
import { isModelProviderConfigured } from './model_provider';

export const RUNTIME_ID = 'ego-runtime';
export const RUNTIME_VERSION = '0.8.0';
export const RUNTIME_PROTOCOL_VERSION = 1;
export const RUNTIME_MANIFEST_VERSION = '1.0';
export const RUNTIME_CAPABILITIES = [
  'education.study_plan', 'education.flashcards', 'education.quiz',
  'education.feynman', 'education.mastery', 'audio.transcription', 'audio.synthesis',
  'documents.pdf', 'documents.text', 'artifacts',
] as const;

export const RuntimeManifestSchema = z.object({
  manifest_version: z.literal(RUNTIME_MANIFEST_VERSION),
  runtime_id: z.literal(RUNTIME_ID),
  runtime_version: z.literal(RUNTIME_VERSION),
  protocol: z.object({
    name: z.literal('ego-runtime-http'),
    version: z.literal(RUNTIME_PROTOCOL_VERSION),
    base_path: z.literal('/v1/runtime'),
  }),
  backend: z.enum(['local', 'cloud']),
  supported_backends: z.array(z.enum(['local', 'cloud'])).min(1),
  integrations: z.object({
    nigma: z.object({
      protocol: z.literal('nigma.runtime-handoff/v1'),
      supported: z.literal(true),
      configured: z.boolean(),
      host_orchestration_supported: z.literal(true),
      host_orchestration_configured: z.boolean(),
    }),
  }),
  providers: z.object({
    model: z.object({ id: z.string().min(1), configured: z.boolean() }),
    transcription: z.object({ id: z.string().min(1) }),
    speech_synthesis: z.object({ id: z.string().min(1) }),
  }),
  capabilities: z.array(z.string().min(1)).min(1),
  endpoints: z.object({
    execute: z.literal('/execute'), approval_digest: z.literal('/approval-digest'), status: z.literal('/:request_id'),
    events: z.literal('/:request_id/events'), cancel: z.literal('/:request_id/cancel'),
    assess: z.literal('/:request_id/assess'), mastery: z.literal('/:request_id/mastery'),
    receipt: z.literal('/:request_id/receipt'),
    transcriptions: z.literal('/transcriptions'), speech: z.literal('/speech'),
  }),
  execution: z.object({
    asynchronous: z.literal(true), idempotent_submission: z.literal(true),
    durable_events: z.literal(true), approval_protocol: z.literal(true),
    result_receipts: z.literal(true),
  }),
  integrity: z.object({
    approval: z.object({
      algorithm: z.literal('hmac-sha256'), supported: z.literal(true),
      required: z.boolean(), configured: z.boolean(),
    }),
    result_receipt: z.object({
      algorithm: z.literal('hmac-sha256'), supported: z.literal(true), configured: z.boolean(),
    }),
  }),
  limits: z.object({
    max_attachments: z.literal(20), max_message_characters: z.literal(20_000),
    accepted_artifact_mime_types: z.array(z.string()).min(1),
  }),
});

export type RuntimeManifest = z.infer<typeof RuntimeManifestSchema>;

export function getRuntimeBackend(): 'local' | 'cloud' {
  const configured = process.env.RUNTIME_BACKEND ?? (process.env.NODE_ENV === 'production' ? 'cloud' : 'local');
  return z.enum(['local', 'cloud']).parse(configured);
}

export function createRuntimeManifest(): RuntimeManifest {
  return RuntimeManifestSchema.parse({
    manifest_version: RUNTIME_MANIFEST_VERSION,
    runtime_id: RUNTIME_ID,
    runtime_version: RUNTIME_VERSION,
    protocol: { name: 'ego-runtime-http', version: RUNTIME_PROTOCOL_VERSION, base_path: '/v1/runtime' },
    backend: getRuntimeBackend(),
    supported_backends: ['local', 'cloud'],
    integrations: {
      nigma: {
        protocol: 'nigma.runtime-handoff/v1',
        supported: true,
        configured: process.env.NIGMA_HANDOFF_ENABLED === 'true'
          && Boolean(process.env.NIGMA_ADAPTER_POLICY_FILE),
        host_orchestration_supported: true,
        host_orchestration_configured: Boolean(
          process.env.NIGMA_CONTROL_PLANE_URL
          && process.env.NIGMA_CONTROL_PLANE_API_KEY
          && process.env.NIGMA_HOST_ROUTES_FILE
        ),
      },
    },
    providers: {
      model: { id: process.env.MODEL_PROVIDER ?? 'gemini-adk', configured: isModelProviderConfigured() },
      transcription: { id: process.env.TRANSCRIPTION_PROVIDER ?? 'gemini' },
      speech_synthesis: { id: process.env.SPEECH_SYNTHESIS_PROVIDER ?? 'gemini' },
    },
    capabilities: [...RUNTIME_CAPABILITIES],
    endpoints: {
      execute: '/execute', approval_digest: '/approval-digest', status: '/:request_id', events: '/:request_id/events',
      cancel: '/:request_id/cancel', assess: '/:request_id/assess', mastery: '/:request_id/mastery',
      receipt: '/:request_id/receipt',
      transcriptions: '/transcriptions', speech: '/speech',
    },
    execution: {
      asynchronous: true, idempotent_submission: true, durable_events: true,
      approval_protocol: true, result_receipts: true,
    },
    integrity: {
      approval: {
        algorithm: 'hmac-sha256', supported: true,
        required: process.env.REQUIRE_EXECUTION_APPROVAL === 'true',
        configured: Boolean(process.env.EXECUTION_APPROVAL_SECRET),
      },
      result_receipt: {
        algorithm: 'hmac-sha256', supported: true,
        configured: Boolean(process.env.RESULT_RECEIPT_SECRET),
      },
    },
    limits: {
      max_attachments: 20, max_message_characters: 20_000,
      accepted_artifact_mime_types: [
        'application/pdf', 'text/plain', 'text/markdown', 'application/json',
      ],
    },
  });
}

export function unsupportedCapabilities(requested: readonly string[]): string[] {
  const supported = new Set<string>(RUNTIME_CAPABILITIES);
  return [...new Set(requested.filter(capability => !supported.has(capability)))];
}

/** Temporary response shape for clients using the pre-manifest capabilities endpoint. */
export function createLegacyCapabilities() {
  const manifest = createRuntimeManifest();
  return {
    runtime: manifest.runtime_id,
    version: manifest.runtime_version,
    backend: manifest.backend,
    model_provider: manifest.providers.model.id,
    model_configured: manifest.providers.model.configured,
    transcription_provider: manifest.providers.transcription.id,
    speech_synthesis_provider: manifest.providers.speech_synthesis.id,
    capabilities: manifest.capabilities,
    manifest_url: `${manifest.protocol.base_path}/manifest`,
    manifest_version: manifest.manifest_version,
  };
}
