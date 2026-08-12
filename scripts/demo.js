#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

const API_URL = process.env.APP_URL
  ? `${process.env.APP_URL}/v1/runtime`
  : 'http://localhost:3000/v1/runtime';
const TOKEN = process.env.INTERNAL_RUNTIME_TOKEN || 'local-dev-token';

async function runDemo() {
  const requestId = `demo_req_${randomUUID().substring(0, 8)}`;
  console.log(`Starting EGO Runtime demo (${requestId})`);

  const capabilities = await fetch(`${API_URL}/capabilities`);
  if (!capabilities.ok) throw new Error(`Capabilities failed: ${await capabilities.text()}`);
  console.log('Capabilities:', await capabilities.json());

  const payload = {
    request_id: requestId,
    user_id: 'demo_user',
    session_id: 'demo_session',
    objective_id: 'demo_objective',
    message: 'Quiero dominar las ideas principales del documento y comprobar mi comprensión.',
    attachments: [{
      id: 'source_1',
      name: 'source.md',
      mime_type: 'text/markdown',
      uri: process.env.EGO_DEMO_ARTIFACT_URI || new URL('../examples/source.md', import.meta.url).href,
    }],
    capabilities: ['education.study_plan'],
  };

  const execute = await fetch(`${API_URL}/execute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (execute.status !== 202) throw new Error(`Execution failed: ${await execute.text()}`);
  console.log('Accepted:', await execute.json());

  let cursor = 0;
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const response = await fetch(`${API_URL}/${requestId}/events?cursor=${cursor}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!response.ok) throw new Error(`Events failed: ${await response.text()}`);
    const { events } = await response.json();
    for (const event of events) {
      console.log(`[${event.sequence_number}] ${event.type}`, event.data);
      cursor = event.sequence_number;
      if (event.type === 'failed') throw new Error(String(event.data?.error ?? 'Job failed'));
      if (event.type === 'completed') {
        const job = await fetch(`${API_URL}/${requestId}`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });
        console.log('Completed:', await job.json());
        return;
      }
    }
  }
}

runDemo().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
