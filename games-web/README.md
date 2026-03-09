# JSM Games Web App

This folder contains the new game-site foundation (React + Vite + TypeScript).

## Quick start

1. Copy `.env.example` to `.env` and add values.
2. Install deps: `npm install`
3. Run dev server: `npm run dev`
4. Typecheck: `npm run typecheck`
5. Build: `npm run build`

## Supabase

Environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

No create/join flow logic is implemented yet.

## Environment templates

- `.env.development.example`
- `.env.production.example`

## Deployment

GitHub Actions workflow: `.github/workflows/deploy-games-web.yml`

Expected repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`