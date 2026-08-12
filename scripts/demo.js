#!/usr/bin/env node
import { randomUUID } from 'crypto';

const API_URL = process.env.APP_URL ? `${process.env.APP_URL}/v1/runtime` : 'http://localhost:3000/v1/runtime';
const TOKEN = process.env.INTERNAL_RUNTIME_TOKEN || 'test-token';

async function runDemo() {
  const reqId = `demo_req_${randomUUID().substring(0, 8)}`;
  console.log(`🚀 Starting EGO Runtime Demo (Request ID: ${reqId})`);

  // 1. Check Capabilities
  console.log('\n🔍 Fetching Capabilities...');
  const capRes = await fetch(`${API_URL}/capabilities`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  if (capRes.ok) {
    console.log(await capRes.json());
  } else {
    console.error('Failed to fetch capabilities', await capRes.text());
  }

  // 2. Submit execution request
  console.log('\n📝 Submitting execution request (3 PDFs)...');
  const payload = {
    request_id: reqId,
    user_id: 'user_test',
    session_id: 'sess_test',
    objective_id: 'obj_test',
    message: 'Tengo que entender estos tres papers sobre interpretabilidad en IA y preparar una exposición para el viernes.',
    attachments: [
      { id: 'art_1', name: 'paper1.pdf', mime_type: 'application/pdf', uri: 'gs://test/paper1.pdf' },
      { id: 'art_2', name: 'paper2.pdf', mime_type: 'application/pdf', uri: 'gs://test/paper2.pdf' },
      { id: 'art_3', name: 'paper3.pdf', mime_type: 'application/pdf', uri: 'gs://test/paper3.pdf' }
    ],
    capabilities: ['education.study_plan']
  };

  const execRes = await fetch(`${API_URL}/execute`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (execRes.status === 202) {
    console.log('✅ Job Accepted (202)');
  } else {
    console.error('❌ Failed to submit job:', await execRes.text());
    return;
  }

  // 3. Poll for Events
  console.log('\n⏳ Polling for events...');
  let cursor = 0;
  let jobCompleted = false;

  while (!jobCompleted) {
    await new Promise(r => setTimeout(r, 2000));
    
    const evRes = await fetch(`${API_URL}/${reqId}/events?cursor=${cursor}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    
    if (evRes.ok) {
      const data = await evRes.json();
      for (const ev of data.events) {
        console.log(`[Event ${ev.sequence_number}] ${ev.type}:`, ev.data);
        cursor = ev.sequence_number;
        if (ev.type === 'completed' || ev.type === 'failed') {
          jobCompleted = true;
        }
      }
    }
  }

  // 4. Final Status
  console.log('\n🏁 Fetching final job status...');
  const statRes = await fetch(`${API_URL}/${reqId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  if (statRes.ok) {
    console.log(await statRes.json());
  }

  console.log('\n🎉 Demo completed successfully.');
}

runDemo().catch(console.error);
