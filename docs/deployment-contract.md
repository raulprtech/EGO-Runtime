# Deployment contract

Infrastructure is deliberately outside this repository. A production platform must provide:

- Node.js 22 and `PORT`;
- Application Default Credentials;
- Firestore and `FIRESTORE_DATABASE_ID`;
- input and output GCS buckets;
- `GEMINI_API_KEY` and `INTERNAL_RUNTIME_TOKEN` through a secret manager;
- Cloud Tasks queue path and the absolute `/v1/runtime/worker` URL;
- least-privilege IAM for Firestore, Storage, Tasks and Secret Manager.

The API service may scale to zero. Durable work is delivered by Cloud Tasks to the worker endpoint. Do not rely on background threads after returning HTTP 202.

See the separately maintained EGO-Deploy repository for one opinionated Google Cloud implementation.
