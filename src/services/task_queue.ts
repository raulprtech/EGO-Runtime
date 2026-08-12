import { CloudTasksClient } from '@google-cloud/tasks';
import { ExecuteRequest } from '../api/schemas/runtime_schemas';
import { Coordinator } from '../agents/coordinator';
import { getRuntimeRepository } from './runtime_repository';

const client = new CloudTasksClient();

function backend(): string {
  return process.env.RUNTIME_BACKEND ?? (process.env.NODE_ENV === 'production' ? 'cloud' : 'local');
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 6;
}

export class TaskQueue {
  static async dispatch(request: ExecuteRequest): Promise<void> {
    if (backend() === 'local') {
      setImmediate(() => {
        void this.dispatchLocal(request).catch(error => {
          console.error(`Local job ${request.request_id} failed`, error);
        });
      });
      return;
    }
    if (!process.env.TASKS_QUEUE_PATH || !process.env.WORKER_URL) {
      throw new Error('Cloud Tasks is not configured');
    }
    try {
      await client.createTask({
        parent: process.env.TASKS_QUEUE_PATH,
        task: {
          name: `${process.env.TASKS_QUEUE_PATH}/tasks/${request.request_id.replace(/[^A-Za-z0-9_-]/g, '-')}`,
          httpRequest: {
            httpMethod: 'POST',
            url: process.env.WORKER_URL,
            headers: {
              'Content-Type': 'application/json',
              'X-Ego-Runtime-Token': process.env.INTERNAL_RUNTIME_TOKEN ?? '',
            },
            oidcToken: process.env.TASKS_SERVICE_ACCOUNT
              ? { serviceAccountEmail: process.env.TASKS_SERVICE_ACCOUNT } : undefined,
            body: Buffer.from(JSON.stringify(request)).toString('base64'),
          },
        },
      });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  static dispatchLocal(request: ExecuteRequest): Promise<boolean> {
    return new Coordinator(request).run();
  }

  static async recoverPendingLocal(): Promise<number> {
    if (backend() !== 'local') return 0;
    const pending = await getRuntimeRepository().recoverableJobs(100);
    for (const request of pending) await this.dispatch(request);
    return pending.length;
  }
}
