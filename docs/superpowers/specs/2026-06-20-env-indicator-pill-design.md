# Environment Indicator Pill — Design

## Problem

The app runs in three places: production (`fifa-predictions`), a long-lived staging
service (`fifa-predictions-staging`), and ephemeral per-PR review apps
(`fifa-predictions-pr-{N}`, deployed by `deploy-pr.yml`). The UI looks identical in
all three, so it's easy to lose track of which environment a given browser tab is
pointed at. Production must look exactly as it does today; staging and review apps
should show a small colored pill in the header so it's unmistakable.

## Approach

### Environment signal

Each deploy workflow already sets Cloud Run env vars via `--set-env-vars`. We add:

- `deploy-staging.yml` → `APP_ENV=staging`
- `deploy-pr.yml` → `APP_ENV=review,PR_NUMBER=<pr number>`
- `deploy-prod.yml` → unchanged (no `APP_ENV` set)

`server.js` reads `process.env.APP_ENV` (default `'prod'`) and `process.env.PR_NUMBER`,
and exposes them via a new read-only endpoint:

```
GET /api/env
→ { "env": "prod" | "staging" | "review", "pr": number | null }
```

No auth required — this is not sensitive data and needs to be readable before user
identification happens.

### Frontend

`public/index.html`: add an empty pill element inside `.logo-area`, right after the
`<h1>`, hidden by default:

```html
<span id="envPill" class="env-pill" style="display:none"></span>
```

`public/app.js`: add a `loadEnvBadge()` function, called alongside `setupUser()` in the
`DOMContentLoaded` handler. It fetches `/api/env` and:

- `env === 'prod'` (or fetch fails) → leave the pill hidden. Fetch failure is treated as
  prod, not as an error state — there's nothing useful to show the user if the check
  itself is broken.
- `env === 'staging'` → text `STAGING`, add class `env-pill--staging`.
- `env === 'review'` → text `REVIEW · PR #<pr>`, add class `env-pill--review`.

`public/style.css`: new `--color-review: #7c4dff` token alongside the existing
`--color-warning` (reused for staging). New `.env-pill` base style (small, uppercase,
rounded using `--radius-sm`, tinted background/border, no layout shift to
`.logo-area`) plus `.env-pill--staging` / `.env-pill--review` color modifiers.

## Out of scope

- Changing how `deploy-prod.yml` works.
- Any visual indicator beyond the header pill (e.g. favicon swap, page title prefix).
- Auth/security on `/api/env` — it returns no sensitive data.

## Testing

- Manual: run locally with no `APP_ENV` set → no pill. Set `APP_ENV=staging` → amber
  "STAGING" pill. Set `APP_ENV=review PR_NUMBER=42` → violet "REVIEW · PR #42" pill.
- Verify `/api/env` response shape directly via curl.
