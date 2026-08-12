# Deployment to Google Cloud Run

The EGO Runtime is designed to be deployed as a stateless container on Google Cloud Run. 
State is persisted in Firestore, and long-running tasks are handled gracefully.

## Prerequisites
1. Google Cloud CLI (`gcloud`) installed and authenticated.
2. A Google Cloud Project with Billing enabled.
3. APIs enabled: Cloud Run API, Secret Manager API, Firestore API, Artifact Registry API.

## Step 1: Manage Secrets
Store your Gemini API key and internal runtime token in Google Secret Manager:

```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-
echo -n "YOUR_INTERNAL_TOKEN" | gcloud secrets create INTERNAL_RUNTIME_TOKEN --data-file=-
```

## Step 2: Build and Deploy
You can build and deploy the container directly from the source code using Cloud Build and Cloud Run in a single command.

```bash
gcloud run deploy ego-runtime \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest,INTERNAL_RUNTIME_TOKEN=INTERNAL_RUNTIME_TOKEN:latest" \
  --service-account="ego-runtime-sa@YOUR_PROJECT.iam.gserviceaccount.com"
```

### Important Flags:
*   `--source .`: Uses the provided `Dockerfile` to build the container using Cloud Build.
*   `--set-secrets`: Securely injects API keys as environment variables at runtime.
*   `--service-account`: Ensure you attach a service account that has `roles/datastore.user` (to read/write Firestore) and `roles/secretmanager.secretAccessor` (to access the secrets).

## Step 3: Verify
Once deployed, Cloud Run will provide a Service URL.
Test the deployment using the capabilities endpoint:

```bash
curl -H "Authorization: Bearer YOUR_INTERNAL_TOKEN" \
     https://ego-runtime-xxxxxx-uc.a.run.app/v1/capabilities
```
