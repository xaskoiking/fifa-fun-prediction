# How I Deployed My App to Google Cloud Run

A simple, shareable guide for deploying a **Node.js + Express** web app
(data stored in a JSON file, backed by Google Cloud Storage) to Cloud Run.

---

## Prerequisites (one-time setup)

1. **Install the Google Cloud SDK** (the `gcloud` CLI tool)
2. **Have a Google Cloud project** ready (with billing enabled)
3. **Log in** from the terminal:
   ```
   gcloud auth login
   ```

Replace these placeholders with your own values in the steps below:
- `YOUR_PROJECT_ID` – your Google Cloud project ID
- `YOUR_BUCKET_NAME` – any unique name for your storage bucket
- `APP_NAME` – the name for your Cloud Run service

---

## The deployment steps

**1. Set the active project**
```
gcloud config set project YOUR_PROJECT_ID
```

**2. Enable the required Google Cloud APIs**
```
gcloud services enable run.googleapis.com storage.googleapis.com cloudbuild.googleapis.com
```
(Cloud Run = hosting, Storage = the data bucket, Build = builds the container)

**3. Create a Cloud Storage bucket** (where the data lives permanently)
```
gsutil mb -l us-central1 gs://YOUR_BUCKET_NAME
```

**4. Seed the initial data file into the bucket** (only the first time)
```
gsutil cp data.json gs://YOUR_BUCKET_NAME/data.json
```

**5. Build the app into a container image** (uses a Dockerfile)
```
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/APP_NAME
```

**6. Deploy the container to Cloud Run**
```
gcloud run deploy APP_NAME ^
  --image gcr.io/YOUR_PROJECT_ID/APP_NAME ^
  --region us-central1 ^
  --platform managed ^
  --allow-unauthenticated ^
  --max-instances 1 ^
  --set-env-vars GCS_BUCKET_NAME=YOUR_BUCKET_NAME
```
> Note: the `^` is the Windows CMD line-continuation character. In PowerShell
> use a backtick `` ` ``; in Mac/Linux bash use a backslash `\`.

---

## The result

Cloud Run gives you a **public URL** (like `https://your-app-xxxxx.run.app`)
that anyone can open. 🎉

---

## Key things to know

- **The app reads/writes its data file from the Cloud Storage bucket**, so data
  survives restarts and redeploys.
- **`--max-instances 1`** keeps it to a single server copy so concurrent writes
  don't overwrite each other.
- It **scales to zero when idle**, so it's basically **free** for a small app.
- To push updates later, just **re-run the deploy** — it rebuilds and redeploys
  without touching the live data (re-seeding is skipped if the bucket already
  has a `data.json`).

---

## Tip: automate it

All six steps can be saved into a single script (e.g. `deploy.ps1` on Windows)
so the whole deployment runs with one command. The script can also check
whether the bucket already exists before creating it, and skip re-seeding the
data file to protect live data.
