# Deployment contract

Infrastructure is deliberately outside this repository. A production platform must provide:

- Node.js 22 and `PORT`;
- Application Default Credentials;
- Firestore and `FIRESTORE_DATABASE_ID`;
- input and output GCS buckets;
- credentials for the selected model provider, `INTERNAL_RUNTIME_TOKEN`, `EXECUTION_APPROVAL_SECRET` and `RESULT_RECEIPT_SECRET` through a secret manager;
- Cloud Tasks queue path and the absolute `/v1/runtime/worker` URL;
- least-privilege IAM for Firestore, Storage, Tasks and Secret Manager;
- independent approval and receipt secrets shared only with the authorized control plane.

The API service may scale to zero. Durable work is delivered by Cloud Tasks to the worker endpoint. Do not rely on background threads after returning HTTP 202.

Production infrastructure is intentionally maintained outside this repository. Runtime discovery and selection belong to the calling control plane.
