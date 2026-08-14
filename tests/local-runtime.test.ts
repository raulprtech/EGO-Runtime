import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../server';
import { ModelProvider, setModelProvider, StructuredGenerationRequest } from '../src/runtime/model_provider';
import { getRuntimeRepository, resetRuntimeRepositoryForTests } from '../src/services/runtime_repository';

const values: Record<string, unknown> = {
  document_analyzer: {
    nodes: [{ id: 'c1', label: 'Core idea', type: 'concept', source_artifact_ids: ['source_1'] }],
    edges: [],
  },
  learning_planner: {
    learning_objective: 'Understand the source',
    sub_objectives: ['Explain the core idea'],
    required_concepts: ['Core idea'],
    dependencies: [],
    estimated_difficulty: 'introductory',
    study_sessions: [{
      id: 's1', topic: 'Core idea', duration_minutes: 25, technique: 'feynman',
      activities: ['Read', 'Explain'], completion_criteria: ['Explain without notes'],
    }],
    review_cadence_days: [1, 3, 7],
    mastery_criteria: ['Score at least 0.8'],
    deliverables: ['Written explanation'],
  },
  practice_designer: {
    session: {
      title: 'Core idea session', focus_minutes: 25, feynman_prompt: 'Explain the core idea.',
      completion_criteria: ['Complete the quiz'],
    },
    flashcards: [1, 2, 3].map(index => ({
      id: `f${index}`, concept_id: 'c1', front: `Front ${index}`, back: `Back ${index}`,
      source_artifact_ids: ['source_1'],
    })),
    quiz: [1, 2, 3].map(index => ({
      id: `q${index}`, concept_id: 'c1', prompt: `Question ${index}`, answer_key: 'Expected idea',
      rubric: ['Mentions the idea'], source_artifact_ids: ['source_1'],
    })),
  },
  assessment_grader: {
    results: [1, 2, 3].map(index => ({
      question_id: `q${index}`, concept_id: 'c1', score: 1,
      feedback: 'Correct', missing_elements: [],
    })),
    summary: 'Mastered',
  },
};

const fakeProvider: ModelProvider = {
  id: 'fake',
  async generateStructured<T extends z.ZodType>(request: StructuredGenerationRequest<T>): Promise<z.infer<T>> {
    return request.schema.parse(values[request.name]);
  },
};

describe('local runtime', () => {
  let directory = '';

  afterEach(async () => {
    setModelProvider(undefined);
    resetRuntimeRepositoryForTests();
    delete process.env.RESULT_RECEIPT_SECRET;
    delete process.env.REQUIRE_EXECUTION_APPROVAL;
    delete process.env.EXECUTION_APPROVAL_SECRET;
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it('runs and persists a complete learning cycle without cloud services', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ego-local-'));
    const inputRoot = path.join(directory, 'inputs');
    const dataRoot = path.join(directory, 'data');
    await fs.mkdir(inputRoot);
    const source = path.join(inputRoot, 'source.md');
    await fs.writeFile(source, '# Core idea\nA concise trusted learning source.');

    process.env.RUNTIME_BACKEND = 'local';
    process.env.LOCAL_INPUT_ROOT = inputRoot;
    process.env.LOCAL_DATA_DIR = dataRoot;
    process.env.INTERNAL_RUNTIME_TOKEN = 'local-test-token';
    process.env.REQUIRE_EXECUTION_APPROVAL = 'false';
    process.env.RESULT_RECEIPT_SECRET = 'local-receipt-secret';
    setModelProvider(fakeProvider);
    resetRuntimeRepositoryForTests();

    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/runtime`;
    const headers = { Authorization: 'Bearer local-test-token', 'Content-Type': 'application/json' };

    try {
      const execute = await fetch(`${base}/execute`, {
        method: 'POST', headers,
        body: JSON.stringify({
          request_id: 'local_request', user_id: 'local_user', session_id: 'local_session',
          objective_id: 'local_objective', message: 'Master the source',
          attachments: [{
            id: 'source_1', name: 'source.md', mime_type: 'text/markdown', uri: pathToFileURL(source).href,
          }],
        }),
      });
      expect(execute.status).toBe(202);

      let job: Record<string, unknown> = {};
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
        const response = await fetch(`${base}/local_request`, { headers });
        job = await response.json() as Record<string, unknown>;
        if (['completed', 'failed'].includes(String(job.status))) break;
      }
      expect(job.status).toBe('completed');
      const artifacts = job.artifacts as Array<{ uri: string; name: string }>;
      expect(artifacts).toHaveLength(4);
      const receiptResponse = await fetch(`${base}/local_request/receipt`, { headers });
      expect(receiptResponse.ok).toBe(true);
      const receipt = await receiptResponse.json() as Record<string, unknown>;
      expect(receipt).toMatchObject({ request_id: 'local_request', status: 'completed', algorithm: 'hmac-sha256' });
      expect(receipt.signature).toMatch(/^[a-f0-9]{64}$/);

      expect(artifacts.every(artifact => artifact.uri.startsWith('file://'))).toBe(true);

      const practiceArtifact = artifacts.find(artifact => artifact.name === 'practice_set.json');
      const publicPractice = JSON.parse(await fs.readFile(new URL(practiceArtifact!.uri), 'utf8'));
      expect(publicPractice.quiz[0]).not.toHaveProperty('answer_key');

      const assessment = await fetch(`${base}/local_request/assess`, {
        method: 'POST', headers,
        body: JSON.stringify({
          assessment_id: 'attempt_1', user_id: 'local_user', session_id: 'local_session', language: 'es-MX',
          responses: [1, 2, 3].map(index => ({
            question_id: `q${index}`, answer: 'learner-private-response',
          })),
        }),
      });
      expect(assessment.ok).toBe(true);
      const result = await assessment.json() as {
        language: string; mastery: { concepts: Array<{ confidence: number }> };
      };
      expect(result.language).toBe('es-MX');
      expect(result.mastery.concepts[0].confidence).toBe(0.6);
      const durableState = await fs.readFile(path.join(dataRoot, 'state.json'), 'utf8');
      expect(durableState).not.toContain('learner-private-response');
      const durableJson = JSON.parse(durableState) as {
        attempts: Record<string, Record<string, { response_count: number }>>;
      };
      expect(durableJson.attempts.local_request.attempt_1.response_count).toBe(3);

      resetRuntimeRepositoryForTests();
      const persisted = await getRuntimeRepository().getJob('local_request');
      expect(persisted?.status).toBe('completed');
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
