import { CloudTasksClient } from '@google-cloud/tasks';
import { ExecuteRequest } from '../api/schemas/runtime_schemas';
import { Coordinator } from '../agents/coordinator';

const client = new CloudTasksClient();
function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 6;
}

export class TaskQueue {
  static async dispatch(request: ExecuteRequest): Promise<void> {
    if (!process.env.TASKS_QUEUE_PATH || !process.env.WORKER_URL) {
      if (process.env.NODE_ENV === 'production') throw new Error('Cloud Tasks is not configured');
      await this.dispatchLocal(request);
      return;
    }
    try {
      await client.createTask({
        parent: process.env.TASKS_QUEUE_PATH,
        task: {
          name: `${process.env.TASKS_QUEUE_PATH}/tasks/${request.request_id.replace(/[^A-Za-z0-9_-]/g, '-')}`,
          httpRequest: {
            httpMethod: 'POST', url: process.env.WORKER_URL,
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

  static async dispatchLocal(request: ExecuteRequest): Promise<boolean> {
    return new Coordinator(request).run();
  }
}
