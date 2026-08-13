import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';

describe('execution approval API', () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
    delete process.env.REQUIRE_EXECUTION_APPROVAL;
    delete process.env.EXECUTION_APPROVAL_SECRET;
  });

  async function start() {
    process.env.RUNTIME_BACKEND = 'local';
    process.env.INTERNAL_RUNTIME_TOKEN = 'approval-api-token';
    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/runtime`;
  }

  it('returns the same normalized digest when omitted defaults are explicit', async () => {
    const baseUrl = await start();
    const headers = { Authorization: 'Bearer approval-api-token', 'Content-Type': 'application/json' };
    const request = {
      request_id: 'request_1', user_id: 'user_1', session_id: 'session_1',
      objective_id: 'objective_1', message: 'Master the source',
    };
    const omitted = await fetch(`${baseUrl}/approval-digest`, {
      method: 'POST', headers, body: JSON.stringify(request),
    });
    const explicit = await fetch(`${baseUrl}/approval-digest`, {
      method: 'POST', headers,
      body: JSON.stringify({ ...request, attachments: [], capabilities: [], metadata: {} }),
    });
    expect(omitted.ok).toBe(true);
    expect(await omitted.json()).toEqual(await explicit.json());
  });

  it('rejects before creating a job when approval is required but absent', async () => {
    process.env.REQUIRE_EXECUTION_APPROVAL = 'true';
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { Authorization: 'Bearer approval-api-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: 'request_1', user_id: 'user_1', session_id: 'session_1',
        objective_id: 'objective_1', message: 'Master the source',
      }),
    });
    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toEqual({ error: 'APPROVAL_REQUIRED' });
  });
});
