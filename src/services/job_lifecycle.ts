import { randomUUID } from 'node:crypto';
import { getRuntimeRepository } from './runtime_repository';
import { Artifact } from '../api/schemas/runtime_schemas';

const leaseMs = Number(process.env.JOB_LEASE_MS ?? 15 * 60 * 1000);

export function isJobClaimable(data: Record<string, unknown>, now = Date.now()): boolean {
  if (['completed', 'cancelled'].includes(String(data.status))) return false;
  const expiresAt = Date.parse(String(data.lease_expires_at ?? ''));
  return data.status !== 'running' || !Number.isFinite(expiresAt) || expiresAt <= now;
}

export class JobLifecycle {
  static async claim(requestId: string): Promise<string | null> {
    const owner = randomUUID();
    return await getRuntimeRepository().claim(requestId, owner, leaseMs) ? owner : null;
  }

  static async assertAndRenew(requestId: string, owner: string): Promise<void> {
    const result = await getRuntimeRepository().renew(requestId, owner, leaseMs);
    if (result === 'cancelled') throw new Error('JOB_CANCELLED');
    if (result === 'lost') throw new Error('LEASE_LOST');
  }

  static complete(requestId: string, owner: string, artifacts: Artifact[]): Promise<boolean> {
    return getRuntimeRepository().complete(requestId, owner, artifacts);
  }

  static fail(requestId: string, owner: string, error: string): Promise<void> {
    return getRuntimeRepository().fail(requestId, owner, error);
  }
}
