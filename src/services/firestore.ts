import * as admin from 'firebase-admin';

// Initialize Firebase Admin lazily to prevent crash on startup if not configured properly yet
let db: admin.firestore.Firestore | null = null;

export function getFirestore(): admin.firestore.Firestore {
  if (!db) {
    if (!admin.apps.length) {
      // In this environment, we rely on application default credentials 
      // or the environment variables injected by the platform.
      admin.initializeApp();
    }
    db = admin.firestore();
  }
  return db;
}

export const COLLECTIONS = {
  JOBS: 'aria_jobs',
  EVENTS: 'aria_events',
  ARTIFACTS: 'aria_artifacts',
  SEQUENCES: 'aria_sequences' // For generating monotonic event IDs
};
