# Environment Indicator Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a colored pill in the site header on staging and PR review-app deployments (not production) so it's obvious which environment a browser tab is pointed at.

**Architecture:** Each deploy workflow sets an `APP_ENV` Cloud Run env var (`staging`/`review`, unset on prod). `server.js` exposes that via a new public `GET /api/env` endpoint. The frontend fetches it once on load and, if not prod, unhides and styles a pill element already present (but hidden) in the header markup.

**Tech Stack:** Plain Node.js + Express backend (`server.js`), static HTML/CSS/vanilla JS frontend (`public/index.html`, `public/app.js`, `public/style.css`), GitHub Actions workflows deploying to Cloud Run. No test framework exists in this repo — verification is manual via `curl` and the browser, matching existing project conventions.

## Global Constraints

- Production (`deploy-prod.yml` / unset `APP_ENV`) must render identically to today — zero visual change.
- `/api/env` requires no auth — it returns no sensitive data and must be callable before user login.
- New CSS must reuse existing tokens (`--radius-sm`, `--color-warning`) except for one new token, `--color-review`, since no purple/blue exists yet.
- Pill text: `STAGING` for staging, `REVIEW · PR #<n>` for review apps.

---

### Task 1: Backend — `APP_ENV`/`PR_NUMBER` config and `/api/env` endpoint

**Files:**
- Modify: `server.js:22-24` (add env constants after `DATA_FILE`)
- Modify: `server.js:65-66` (add endpoint after static middleware)

**Interfaces:**
- Produces: `GET /api/env` → `{ "env": "prod" | "staging" | "review", "pr": number | null }`

- [ ] **Step 1: Add the `APP_ENV`/`PR_NUMBER` constants**

In `server.js`, find this existing block:

```js
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
```

Replace it with:

```js
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ── Environment identification (drives the staging/review pill in the UI) ────
const APP_ENV = process.env.APP_ENV || 'prod';
const PR_NUMBER = process.env.PR_NUMBER ? Number(process.env.PR_NUMBER) : null;
```

- [ ] **Step 2: Add the `/api/env` endpoint**

Find this existing line:

```js
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
```

Replace it with:

```js
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Public endpoint: tells the frontend which environment it's running in
app.get('/api/env', (req, res) => {
  res.json({ env: APP_ENV, pr: PR_NUMBER });
});
```

- [ ] **Step 3: Verify manually**

Run: `node server.js`
Then in another terminal: `curl -s localhost:3000/api/env`
Expected: `{"env":"prod","pr":null}`

Stop the server (Ctrl+C), then run: `APP_ENV=staging node server.js`
`curl -s localhost:3000/api/env`
Expected: `{"env":"staging","pr":null}`

Stop the server, then run: `APP_ENV=review PR_NUMBER=42 node server.js`
`curl -s localhost:3000/api/env`
Expected: `{"env":"review","pr":42}`

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add /api/env endpoint for environment detection"
```

---

### Task 2: Frontend markup and styles for the pill

**Files:**
- Modify: `public/index.html:24-30` (wrap `<h1>` with a title row containing the pill)
- Modify: `public/style.css:4-36` (new `--color-review` token)
- Modify: `public/style.css:124-139` (new `.title-row` and `.env-pill*` rules)

**Interfaces:**
- Produces: `#envPill` element, classes `env-pill`, `env-pill--staging`, `env-pill--review` for Task 3 to use.

- [ ] **Step 1: Update the header markup**

In `public/index.html`, find:

```html
        <div class="logo-area">
          <div class="ball-icon">⚽</div>
          <div>
            <h1>Prediction Arena</h1>
            <p class="subtitle">FIFA Prediction Game</p>
          </div>
        </div>
```

Replace it with:

```html
        <div class="logo-area">
          <div class="ball-icon">⚽</div>
          <div>
            <div class="title-row">
              <h1>Prediction Arena</h1>
              <span id="envPill" class="env-pill" style="display: none;"></span>
            </div>
            <p class="subtitle">FIFA Prediction Game</p>
          </div>
        </div>
```

- [ ] **Step 2: Add the `--color-review` token**

In `public/style.css`, find:

```css
  --color-danger: #ff5252;
  --color-warning: #ffd600;
```

Replace it with:

```css
  --color-danger: #ff5252;
  --color-warning: #ffd600;
  --color-review: #7c4dff;
```

- [ ] **Step 3: Add the `.title-row` and `.env-pill` rules**

In `public/style.css`, find:

```css
.logo-area h1 {
  font-weight: 800;
  font-size: 2rem;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, #ffffff 30%, var(--color-accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

Replace it with:

```css
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.logo-area h1 {
  font-weight: 800;
  font-size: 2rem;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, #ffffff 30%, var(--color-accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.env-pill {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid;
  white-space: nowrap;
}

.env-pill--staging {
  color: var(--color-warning);
  border-color: var(--color-warning);
  background: rgba(255, 214, 0, 0.12);
}

.env-pill--review {
  color: var(--color-review);
  border-color: var(--color-review);
  background: rgba(124, 77, 255, 0.12);
}
```

- [ ] **Step 4: Verify markup renders unchanged with the pill hidden**

Run: `node server.js`, open `http://localhost:3000` in a browser.
Expected: header looks identical to before (pill is `display: none`, takes no space).

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add hidden env pill markup and styles"
```

---

### Task 3: Frontend JS — fetch and render the pill

**Files:**
- Modify: `public/app.js:63-80` (call new function from `DOMContentLoaded`)
- Modify: `public/app.js` (add `loadEnvBadge` function near `setupUser`)

**Interfaces:**
- Consumes: `GET /api/env` → `{ env, pr }` (Task 1); `#envPill` element with classes `env-pill--staging`/`env-pill--review` (Task 2).

- [ ] **Step 1: Add the `loadEnvBadge` function**

In `public/app.js`, find:

```js
// Setup User Identification
function setupUser() {
```

Insert this new function directly above it:

```js
// Fetch environment info and show a STAGING/REVIEW pill in the header (no-op on prod)
function loadEnvBadge() {
  fetch('/api/env')
    .then(res => res.json())
    .then(data => {
      const pill = document.getElementById('envPill');
      if (!pill || !data) return;

      if (data.env === 'staging') {
        pill.textContent = 'STAGING';
        pill.classList.add('env-pill--staging');
      } else if (data.env === 'review') {
        pill.textContent = `REVIEW · PR #${data.pr}`;
        pill.classList.add('env-pill--review');
      } else {
        return; // prod (or unknown) — leave hidden
      }

      pill.style.display = 'inline-flex';
    })
    .catch(() => {}); // fetch failure is treated the same as prod — pill stays hidden
}

// Setup User Identification
function setupUser() {
```

- [ ] **Step 2: Call it on page load**

In `public/app.js`, find:

```js
document.addEventListener('DOMContentLoaded', () => {
  setupUser();
  startIntervals();
```

Replace it with:

```js
document.addEventListener('DOMContentLoaded', () => {
  setupUser();
  startIntervals();
  loadEnvBadge();
```

- [ ] **Step 3: Verify all three states in the browser**

Run: `node server.js`, open `http://localhost:3000`.
Expected: no pill next to "Prediction Arena" (prod default).

Stop the server. Run: `APP_ENV=staging node server.js`, reload the page.
Expected: amber `STAGING` pill next to the title.

Stop the server. Run: `APP_ENV=review PR_NUMBER=42 node server.js`, reload the page.
Expected: violet `REVIEW · PR #42` pill next to the title.

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: render env pill based on /api/env response"
```

---

### Task 4: Wire `APP_ENV`/`PR_NUMBER` into the staging and PR review-app workflows

**Files:**
- Modify: `.github/workflows/deploy-staging.yml:39-48`
- Modify: `.github/workflows/deploy-pr.yml:51-60`

**Interfaces:**
- Consumes: `APP_ENV`/`PR_NUMBER` env vars as read by Task 1's `server.js` changes.

- [ ] **Step 1: Set `APP_ENV=staging` in the staging workflow**

In `.github/workflows/deploy-staging.yml`, find:

```yaml
      - name: Build and deploy to Cloud Run (staging)
        run: |
          gcloud run deploy "$SERVICE" \
            --source . \
            --project "$PROJECT_ID" \
            --region "$REGION" \
            --platform managed \
            --allow-unauthenticated \
            --max-instances 1 \
            --set-env-vars GCS_BUCKET_NAME=$BUCKET${FOOTBALL_KEY:+,FOOTBALL_DATA_API_KEY=$FOOTBALL_KEY}
        env:
          # Optional: add a repo secret named FOOTBALL_DATA_API_KEY to enable fixtures.
          FOOTBALL_KEY: ${{ secrets.FOOTBALL_DATA_API_KEY }}
```

Replace it with:

```yaml
      - name: Build and deploy to Cloud Run (staging)
        run: |
          gcloud run deploy "$SERVICE" \
            --source . \
            --project "$PROJECT_ID" \
            --region "$REGION" \
            --platform managed \
            --allow-unauthenticated \
            --max-instances 1 \
            --set-env-vars GCS_BUCKET_NAME=$BUCKET,APP_ENV=staging${FOOTBALL_KEY:+,FOOTBALL_DATA_API_KEY=$FOOTBALL_KEY}
        env:
          # Optional: add a repo secret named FOOTBALL_DATA_API_KEY to enable fixtures.
          FOOTBALL_KEY: ${{ secrets.FOOTBALL_DATA_API_KEY }}
```

- [ ] **Step 2: Set `APP_ENV=review` and `PR_NUMBER` in the PR review-app workflow**

In `.github/workflows/deploy-pr.yml`, find:

```yaml
      - name: Build and deploy to Cloud Run (review app)
        run: |
          gcloud run deploy "$SERVICE" \
            --source . \
            --project "$PROJECT_ID" \
            --region "$REGION" \
            --platform managed \
            --allow-unauthenticated \
            --max-instances 1 \
            --set-env-vars GCS_BUCKET_NAME=$BUCKET${FOOTBALL_KEY:+,FOOTBALL_DATA_API_KEY=$FOOTBALL_KEY}
        env:
          FOOTBALL_KEY: ${{ secrets.FOOTBALL_DATA_API_KEY }}
```

Replace it with:

```yaml
      - name: Build and deploy to Cloud Run (review app)
        run: |
          gcloud run deploy "$SERVICE" \
            --source . \
            --project "$PROJECT_ID" \
            --region "$REGION" \
            --platform managed \
            --allow-unauthenticated \
            --max-instances 1 \
            --set-env-vars GCS_BUCKET_NAME=$BUCKET,APP_ENV=review,PR_NUMBER=${{ github.event.pull_request.number }}${FOOTBALL_KEY:+,FOOTBALL_DATA_API_KEY=$FOOTBALL_KEY}
        env:
          FOOTBALL_KEY: ${{ secrets.FOOTBALL_DATA_API_KEY }}
```

- [ ] **Step 3: Validate YAML syntax**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-staging.yml'))" && echo OK`
Expected: `OK`

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-pr.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-staging.yml .github/workflows/deploy-pr.yml
git commit -m "feat: pass APP_ENV/PR_NUMBER to staging and review-app deploys"
```

---

### Task 5: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full local pass through all three states**

Run: `node server.js` → open browser → confirm header looks exactly like before (no pill, no layout shift).

Stop the server. Run: `APP_ENV=staging node server.js` → reload → confirm amber `STAGING` pill appears next to "Prediction Arena", header layout otherwise unchanged, no console errors (check browser devtools console).

Stop the server. Run: `APP_ENV=review PR_NUMBER=7 node server.js` → reload → confirm violet `REVIEW · PR #7` pill appears, no console errors.

Stop the server.

- [ ] **Step 2: Confirm no regressions on prod-equivalent run**

Run: `node server.js` again (no env vars) → click through all tabs (Predictions, Past Results, Leaderboard, Points Rules) → confirm nothing else changed.

Stop the server.

No commit for this task — it's verification only.
