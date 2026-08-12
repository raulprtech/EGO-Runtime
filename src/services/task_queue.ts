import { CloudTasksClient } from '@google-cloud/tasks';
import { ExecuteRequest } from '../api/schemas/runtime_schemas';
import { Coordinator } from '../agents/coordinator';

const client = new CloudTasksClient();

export class TaskQueue {
  static async dispatch(request: ExecuteRequest): Promise<void> {
    if (!process.env.TASKS_QUEUE_PATH || !process.env.WORKER_URL) {
      if (process.env.NODE_ENV === 'production') throw new Error('Cloud Tasks is not configured');
      return this.dispatchLocal(request);
    }
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
            ? { serviceAccountEmail: process.env.TASKS_SERVICE_ACCOUNT }
            : undefined,
          body: Buffer.from(JSON.stringify(request)).toString('base64'),
        },
      },
    });
  }

  static dispatchLocal(request: ExecuteRequest): Promise<void> {
    return new Coordinator(request).run();
  }
}
