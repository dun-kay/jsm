# Environments

Use two GitHub environments:

1. `development`
- For preview or non-production workflows.
- Secrets:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

2. `production`
- For deploy-to-main workflows.
- Secrets:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## Current deploy workflow

`deploy-games-web.yml` currently deploys from `main` to Pages and reads repo secrets.

If you want strict env separation, move secrets from repo-level to environment-level
and set `environment: production` in the deploy job.