# Auto-Deploy Setup (GitHub → Cloud Run)

This sets up a **standard deployment process** so you and your friend never have
to run Google Cloud commands by hand again. After the one-time setup below:

- **Push to the `staging` branch** → GitHub automatically deploys the **staging** link.
- **Merge into the `main` branch** → GitHub automatically deploys the **live** link.

> 💡 **Your friends' votes are safe.** Deploys only swap the *code*. The votes
> live in a separate Google storage box and are never overwritten by a deploy.
> Staging even gets its **own** box (a copy), so testing never touches real votes.

---

## Part A — One-time setup (do this once, ~10 minutes)

You need the `gcloud` tool installed and to be logged in (`gcloud auth login`).
Run these in **PowerShell**, one block at a time. Just copy-paste.

### 1. Set your project values

```powershell
$PROJECT_ID = "data-science-1530973235551"
$REGION     = "us-central1"
$REPO       = "xaskoiking/fifa-fun-prediction"   # owner/repo on GitHub
$PROJECT_NUMBER = gcloud projects describe $PROJECT_ID --format="value(projectNumber)"
gcloud config set project $PROJECT_ID
```

### 2. Turn on the Google services we use

```powershell
gcloud services enable run.googleapis.com storage.googleapis.com `
  cloudbuild.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com
```

### 3. Create the "robot account" GitHub will deploy as

```powershell
gcloud iam service-accounts create github-deployer `
  --display-name="GitHub Actions Deployer"

$DEPLOYER = "github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
```

Give the robot just the permissions it needs to build + deploy:

```powershell
foreach ($role in @(
  "roles/run.admin",
  "roles/cloudbuild.builds.editor",
  "roles/artifactregistry.admin",
  "roles/storage.admin"
)) {
  gcloud projects add-iam-policy-binding $PROJECT_ID `
    --member="serviceAccount:$DEPLOYER" --role="$role" | Out-Null
}

# Let the robot act as the Cloud Run runtime account
gcloud iam service-accounts add-iam-policy-binding `
  "$PROJECT_NUMBER-compute@developer.gserviceaccount.com" `
  --member="serviceAccount:$DEPLOYER" --role="roles/iam.serviceAccountUser"
```

### 4. Set up the keyless "handshake" (Workload Identity Federation)

```powershell
gcloud iam workload-identity-pools create github-pool `
  --location="global" --display-name="GitHub Pool"

gcloud iam workload-identity-pools providers create-oidc github-provider `
  --location="global" --workload-identity-pool="github-pool" `
  --display-name="GitHub provider" `
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" `
  --attribute-condition="assertion.repository_owner=='xaskoiking'" `
  --issuer-uri="https://token.actions.githubusercontent.com"
```

### 5. Allow ONLY your GitHub repo to use the robot account

```powershell
$POOL_ID = gcloud iam workload-identity-pools describe github-pool `
  --location="global" --format="value(name)"

gcloud iam service-accounts add-iam-policy-binding $DEPLOYER `
  --role="roles/iam.workloadIdentityUser" `
  --member="principalSet://iam.googleapis.com/$POOL_ID/attribute.repository/$REPO"
```

### 6. Get the value to paste into GitHub

```powershell
gcloud iam workload-identity-pools providers describe github-provider `
  --location="global" --workload-identity-pool="github-pool" `
  --format="value(name)"
```

Copy the line it prints. It looks like:
`projects/123456789/locations/global/workloadIdentityPools/github-pool/providers/github-provider`

Then on GitHub: **repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `GCP_WIF_PROVIDER` | the line you just copied |
| `FOOTBALL_DATA_API_KEY` | `4589fee6fd3646fb9c89536505cfe499` *(optional — enables fixtures)* |

---

## Part B — Create the staging box + copy today's votes (one time)

This makes a **separate** votes box for staging and fills it with a copy of
today's real votes, so staging looks realistic. It only **reads** the live box.

```powershell
$STAGING_BUCKET = "fifa-predictions-staging-data-$PROJECT_ID"
$LIVE_BUCKET    = "fifa-predictions-data-$PROJECT_ID"

# Create staging's own box
gsutil mb -l $REGION "gs://$STAGING_BUCKET"

# Photocopy today's live votes into the staging box (live box is untouched)
gsutil cp "gs://$LIVE_BUCKET/data.json" "gs://$STAGING_BUCKET/data.json"
```

---

## Part C — Turn on the safety gate for production (recommended)

So going live always needs a deliberate approval:

1. GitHub repo → **Settings → Environments → New environment** → name it `production`.
2. Tick **Required reviewers** and add yourself (and your friend).

Now every push to `main` will **pause and wait for a click** before it touches
the live link.

---

## Part D — Everyday use (this is all you do from now on)

```
  edit code  →  push to "staging" branch  →  staging link updates automatically
                        │
                  (you both test it)
                        │
  merge staging → main  →  (approve the gate)  →  live link updates automatically
```

Create the staging branch once:

```powershell
git checkout -b staging
git push -u origin staging
```

That's it. No more manual `gcloud` deploys. 🎉

---

## If something looks wrong on the live link

Cloud Run keeps the previous version. To roll back:

```powershell
gcloud run services update-traffic fifa-predictions `
  --region us-central1 --to-revisions PREVIOUS=100
```

(Find the previous revision name with
`gcloud run revisions list --service fifa-predictions --region us-central1`.)
Your votes are unaffected either way.
