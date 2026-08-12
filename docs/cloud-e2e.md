# Cloud end-to-end test

The default test suite never contacts Google Cloud. To verify a deployed runtime, prepare one PDF in an allowed input bucket and run:

```bash
EGO_E2E_BASE_URL=https://runtime.example \
EGO_E2E_TOKEN=... \
EGO_E2E_ARTIFACT_URI=gs://allowed-bucket/source.pdf \
npm test -- tests/cloud.e2e.test.ts
```

The test submits a real request, polls durable state and verifies that at least four artifacts are produced. When the deployment is protected by Cloud Run IAM, invoke it through the same authenticated proxy or identity used by the orchestration layer; the application token remains separate.
