import { describe, expect, it } from 'vitest';

const baseUrl = process.env.EGO_E2E_BASE_URL;
const token = process.env.EGO_E2E_TOKEN;
const artifactUri = process.env.EGO_E2E_ARTIFACT_URI;
const enabled = Boolean(baseUrl && token && artifactUri);

describe.skipIf(!enabled)('deployed learning workflow', () => {
  it('creates a grounded learning package', async () => {
    const requestId = `e2e_${Date.now()}`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const execute = await fetch(`${baseUrl}/v1/runtime/execute`, {
      method: 'POST', headers,
      body: JSON.stringify({
        request_id: requestId,
        user_id: 'e2e-user',
        session_id: 'e2e-session',
        objective_id: 'e2e-objective',
        message: 'Build a focused plan to master this source.',
        attachments: [{
          id: 'e2e-source', name: 'source.pdf', mime_type: 'application/pdf', uri: artifactUri,
        }],
      }),
    });
    expect(execute.status).toBe(202);

    let job: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const response = await fetch(`${baseUrl}/v1/runtime/${requestId}`, { headers });
      expect(response.ok).toBe(true);
      job = await response.json() as Record<string, unknown>;
      if (['completed', 'failed'].includes(String(job.status))) break;
    }

    expect(job.status).toBe('completed');
    expect(Array.isArray(job.artifacts)).toBe(true);
    expect((job.artifacts as unknown[]).length).toBeGreaterThanOrEqual(4);
    expect(job).not.toHaveProperty('request_payload');
    expect(job).not.toHaveProperty('lease_owner');

    const masteryResponse = await fetch(`${baseUrl}/v1/runtime/${requestId}/mastery`, { headers });
    expect(masteryResponse.ok).toBe(true);
    const mastery = await masteryResponse.json() as { concepts?: unknown[] };
    expect(mastery.concepts?.length).toBeGreaterThan(0);
  }, 330_000);
});
