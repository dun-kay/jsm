# JSM Games Web Architecture (Draft)

## Purpose

This document defines the baseline architecture and constraints for the new game site before game-flow implementation.

## Current app structure

- `games-web/`: React + Vite + TypeScript frontend
- `.github/workflows/ci.yml`: typecheck + build checks
- `.github/workflows/deploy-games-web.yml`: deploy to GitHub Pages
- `supabase/`: backend migration scaffolding and setup notes

## Planned route map (high level only)

- `/` landing/home
- `/host` host setup screen
- `/join` join screen
- `/lobby/:gameCode` pre-game lobby
- `/game/:gameCode` active game screen

No route logic for create/join is implemented yet.

## State model (high level)

- `draft`: local host configuration before game exists
- `lobby`: players can join and set display names
- `ready`: host can start game
- `started`: game session active
- `ended`: game finished/closed

## Security assumptions

- Frontend uses only Supabase publishable credentials.
- Sensitive decisions must be validated server-side (future SQL policies/functions).
- Row Level Security should remain enabled for all future tables.
- Secrets are stored in GitHub secrets/environments, not committed.

## Deployment model

- Build and deploy through GitHub Actions only.
- `main` is protected and should merge via PR.
- Production hostname is `https://jumpship.media`.

## Non-goals in this phase

- No create/join game flow implementation.
- No game logic implementation.
- No final visual design pass.