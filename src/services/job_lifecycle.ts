import { randomUUID } from 'node:crypto';
import { COLLECTIONS, getFirestore } from './firestore';

const leaseMs = Number(process.env.JOB_LEASE_MS ?? 15 * 60 * 1000);

export function isJobClaimable(data: Record<string, unknown>, now = Date.now()): boolean {
  if (['completed', 'cancelled'].includes(String(data.status))) return false;
  const expiresAt = Date.parse(String(data.lease_expires_at ?? ''));
  return data.status !== 'running' || !Number.isFinite(expiresAt) || expiresAt <= now;
}

export class JobLifecycle {
  static async claim(requestId: string): Promise<string | null> {
    const owner = randomUUID();
    const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(requestId);
    return getFirestore().runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const data = snapshot.data()!;
      if (!isJobClaimable(data)) return null;
      const now = new Date();
      transaction.update(ref, {
        status: 'running',
        lease_owner: owner,
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        attempts: Number(data.attempts ?? 0) + 1,
        updated_at: now.toISOString(),
      });
      return owner;
    });
  }

  static async assertAndRenew(requestId: string, owner: string): Promise<void> {
    const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(requestId);
    await getFirestore().runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!snapshot.exists || data?.status === 'cancelled') throw new Error('JOB_CANCELLED');
      if (data?.lease_owner !== owner) throw new Error('LEASE_LOST');
      transaction.update(ref, {
        lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
        updated_at: new Date().toISOString(),
      });
    });
  }

  static async complete(requestId: string, owner: string, artifacts: unknown[]): Promise<boolean> {
    const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(requestId);
    return getFirestore().runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.lease_owner !== owner || snapshot.data()?.status === 'cancelled') return false;
      transaction.update(ref, {
        status: 'completed', artifacts, lease_owner: null, lease_expires_at: null,
        completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      return true;
    });
  }

  static async fail(requestId: string, owner: string, error: string): Promise<void> {
    const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(requestId);
    await getFirestore().runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.lease_owner !== owner || snapshot.data()?.status === 'cancelled') return;
      transaction.update(ref, {
        status: 'failed', error, lease_owner: null, lease_expires_at: null,
        updated_at: new Date().toISOString(),
      });
    });
  }
}
