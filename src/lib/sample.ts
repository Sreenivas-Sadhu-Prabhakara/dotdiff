/**
 * Sample configs preloaded on first visit so the tool explains itself.
 * Side A is a fictional "production" env; side B is "staging". They differ in
 * ways that show off every bucket: only-in-A, only-in-B, changed, identical,
 * plus a duplicate key, an empty value, drift, and a probable secret — while
 * also being reordered and reindented to prove that ordering never counts.
 */

export const SAMPLE_A = `# --- app config (production) ---
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://db.prod.internal:5432/app

# auth
JWT_SECRET=sk_live_9f2Ac71bQ0zPmR4tX8eL
SESSION_TIMEOUT=3600
FEATURE_BETA_UPLOAD=true

# integrations
STRIPE_KEY=pk_live_51HqRz2LmNoPqRsTuVwXy
LOG_LEVEL=warn
CACHE_TTL=300
`;

export const SAMPLE_B = `# staging — note the different order & indentation
   PORT = 3000
NODE_ENV=staging

DATABASE_URL=postgres://db.staging.internal:5432/app
FEATURE_BETA_UPLOAD=true

SESSION_TIMEOUT=3600
LOG_LEVEL=debug
CACHE_TTL=300
SENTRY_DSN=
DEBUG_TOOLBAR=true
DEBUG_TOOLBAR=false
`;

export const SAMPLE_REQUIRED = `NODE_ENV
PORT
DATABASE_URL
JWT_SECRET
STRIPE_KEY`;
