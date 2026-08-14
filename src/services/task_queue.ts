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
  private static readonly activeLocal = new Set<Promise<unknown>>();
  private static readonly activeLocalByRequest = new Map<string, Promise<unknown>>();

  static async dispatch(request: ExecuteRequest): Promise<void> {
    if (backend() === 'local') {
      const task = new Promise<void>(resolve => setImmediate(resolve))
        .then(() => this.dispatchLocal(request));
      this.activeLocal.add(task);
      this.activeLocalByRequest.set(request.request_id, task);
      void task.catch(error => {
        console.error(`Local job ${request.request_id} failed`, error);
      }).finally(() => {
        this.activeLocal.delete(task);
        this.activeLocalByRequest.delete(request.request_id);
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

  static activeLocalCount(): number {
    return this.activeLocal.size;
  }

  static async waitForLocal(requestId: string, timeoutMs: number): Promise<boolean> {
    const task = this.activeLocalByRequest.get(requestId);
    if (!task) return true;
    let timer: NodeJS.Timeout | undefined;
    const completed = task.then(() => true, () => true);
    const timedOut = new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref();
    });
    const result = await Promise.race([completed, timedOut]);
    if (timer) clearTimeout(timer);
    return result;
  }

  static async drainLocal(timeoutMs: number): Promise<boolean> {
    if (!this.activeLocal.size) return true;
    let timer: NodeJS.Timeout | undefined;
    const completed = Promise.allSettled([...this.activeLocal]).then(() => true);
    const timedOut = new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref();
    });
    const result = await Promise.race([completed, timedOut]);
    if (timer) clearTimeout(timer);
    return result;
  }
}
