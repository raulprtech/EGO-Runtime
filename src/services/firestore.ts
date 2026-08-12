import { getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

let db: Firestore | null = null;
export function getFirestore(): Firestore {
  if (!db) {
    const app = getApps()[0] ?? initializeApp();
    const databaseId = process.env.FIRESTORE_DATABASE_ID;
    db = databaseId ? getAdminFirestore(app, databaseId) : getAdminFirestore(app);
  }
  return db;
}
export const COLLECTIONS = { JOBS: 'ego_jobs', EVENTS: 'events', ARTIFACTS: 'ego_artifacts' } as const;
