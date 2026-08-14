import fs from 'node:fs/promises';
import path from 'node:path';
import { createNigmaRuntimeReceipt } from '../src/runtime/nigma_handoff';
import { ExecuteRequest } from '../src/api/schemas/runtime_schemas';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  throw new Error('Usage: generate-nigma-receipt-fixture INPUT.json OUTPUT.json');
}

const fixture = JSON.parse(await fs.readFile(path.resolve(input), 'utf8')) as {
  invocation: Record<string, unknown>;
};
const invocation = fixture.invocation;
const requestPayload = {
  request_id: invocation.id,
  user_id: 'fixture_learner',
  session_id: 'fixture_session',
  objective_id: 'fixture_objective',
  message: invocation.objective,
  attachments: [],
  capabilities: ['artifacts', 'documents.text', 'education.study_plan'],
  approval: undefined,
  metadata: {
    nigma: {
      invocation_id: invocation.id,
      invocation_digest: invocation.digest,
      execution_id: invocation.execution_id,
      runtime_snapshot_id: invocation.runtime_snapshot_id,
      runtime_snapshot_digest: invocation.runtime_snapshot_digest,
    },
  },
} as ExecuteRequest;
const receipt = createNigmaRuntimeReceipt({
  request_id: String(invocation.id),
  user_id: 'fixture_learner',
  session_id: 'fixture_session',
  objective_id: 'fixture_objective',
  request_payload: requestPayload,
  request_digest: 'a'.repeat(64),
  status: 'completed',
  created_at: '2026-08-14T06:01:31.000Z',
  started_at: '2026-08-14T06:02:00.000Z',
  completed_at: '2026-08-14T06:03:00.000Z',
  updated_at: '2026-08-14T06:03:00.000Z',
  attempts: 1,
  artifacts: [
    {
      id: 'study_plan',
      name: 'study_plan.json',
      mime_type: 'application/json',
      uri: 'file:///controlled/output/study_plan.json',
      sha256: 'b'.repeat(64),
      size_bytes: 512,
    },
    {
      id: 'mastery_state',
      name: 'mastery_state.json',
      mime_type: 'application/json',
      uri: 'file:///controlled/output/mastery_state.json',
      sha256: 'c'.repeat(64),
      size_bytes: 256,
    },
  ],
});
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(path.resolve(output), JSON.stringify(receipt, null, 2) + '\n');
