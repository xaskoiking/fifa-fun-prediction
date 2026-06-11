# Deploy FIFA Predictions to Google Cloud Run
#
# Pre-requisites:
# 1. Install Google Cloud SDK (gcloud CLI)
# 2. Run: gcloud auth login
# 3. Run this script
#
# ============================ DATA SAFETY ============================
# The LIVE source of truth is gs://<bucket>/data.json — NOT the local
# data.json in this folder. Once players start voting, the bucket holds
# all real users and votes.
#
# DO:    add/remove players from the admin UI (saves to the bucket live).
# DON'T: manually run `gsutil cp data.json gs://.../data.json` against a
#        live bucket — it overwrites real votes with your local copy.
#
# This script is safe to re-run for code updates: step [4] only seeds
# data.json if the bucket is EMPTY, and --max-instances 1 guarantees a
# single server copy so writes never clobber each other.
# ====================================================================

# ─────────────────────────── CONFIGURE ME ───────────────────────────
# Set your own values here, or pass them in:
#   .\deploy.ps1 -ProjectID my-gcp-project -AdminPasscode "mySecret"
param(
    [string]$ProjectID     = $env:GCP_PROJECT_ID,   # your Google Cloud project ID
    [string]$Region        = "us-central1",
    [string]$AppName       = "fifa-predictions",
    [string]$BucketName    = "",                      # defaults to fifa-predictions-data-<ProjectID>
    [string]$AdminPasscode = $env:ADMIN_PASSCODE      # admin-panel passcode for the deployed app
)

if (-not $ProjectID) {
    Write-Error "ProjectID is required. Pass -ProjectID <id> or set `$env:GCP_PROJECT_ID."
    exit 1
}
if (-not $BucketName) { $BucketName = "fifa-predictions-data-$ProjectID" }
$ImageName = "gcr.io/$ProjectID/$AppName"

Write-Host "========================================="
Write-Host "Deploying FIFA Predictions to Cloud Run"
Write-Host "Project: $ProjectID"
Write-Host "Region: $Region"
Write-Host "Bucket: $BucketName"
Write-Host "========================================="
Write-Host ""

# 1. Set Project
Write-Host "[1/6] Setting GCP Project..."
gcloud config set project $ProjectID

# 2. Enable necessary APIs
Write-Host "[2/6] Enabling APIs (Run, Storage, Build)..."
gcloud services enable run.googleapis.com storage.googleapis.com cloudbuild.googleapis.com

# 3. Create GCS Bucket if it doesn't exist
Write-Host "[3/6] Checking GCS Bucket..."
$bucketExists = gsutil ls -b gs://$BucketName 2>$null
if (-not $bucketExists) {
    Write-Host "Bucket not found. Creating gs://$BucketName..."
    gsutil mb -l $Region gs://$BucketName
} else {
    Write-Host "Bucket gs://$BucketName already exists."
}

# 4. Seed data.json to GCS ONLY on first-ever deploy.
#    SAFEGUARD: if the bucket already has a data.json (i.e. real votes
#    exist), we skip the upload so live data is never overwritten.
Write-Host "[4/6] Seeding data.json to GCS..."
$fileExists = gsutil ls gs://$BucketName/data.json 2>$null
if (-not $fileExists) {
    # Seed from data.json if present, otherwise the committed template.
    $seedFile = if (Test-Path "data.json") { "data.json" } else { "data.example.json" }
    Write-Host "First deploy: uploading $seedFile to seed the bucket..."
    gsutil cp $seedFile gs://$BucketName/data.json
} else {
    Write-Host "data.json already exists in bucket. SKIPPING upload to preserve live votes." -ForegroundColor Yellow
}

# 5. Build and submit container image to Container Registry
Write-Host "[5/6] Building Docker image via Cloud Build..."
gcloud builds submit --tag $ImageName

# 6. Deploy to Cloud Run
Write-Host "[6/6] Deploying to Cloud Run..."
$envVars = "GCS_BUCKET_NAME=$BucketName"
if ($AdminPasscode) { $envVars += ",ADMIN_PASSCODE=$AdminPasscode" }
gcloud run deploy $AppName `
    --image $ImageName `
    --region $Region `
    --platform managed `
    --allow-unauthenticated `
    --max-instances 1 `
    --set-env-vars $envVars

Write-Host ""
Write-Host "========================================="
Write-Host "Deployment Complete!"
Write-Host "========================================="
