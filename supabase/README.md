# Supabase Baseline

This folder stores SQL migrations and setup notes for the JSM Games backend.

## Applied scope

- Lobby backend wiring for create/join/start/cancel flow.
- Security-definer RPC functions for client access from anon key.
- Fixed max cap of 18 players.
- Session resume with 120-second timeout and cleanup rules.

## Dashboard settings to confirm

1. Auth -> URL Configuration
- Site URL: https://jumpship.media
- Redirect URLs:
  - http://localhost:5173
  - https://jumpship.media

2. Database -> Extensions
- Confirm `pgcrypto` is enabled.

3. API Settings
- Keep Row Level Security enabled for all future tables.

## Apply migrations now

Run these SQL files in Supabase SQL Editor, in order:

1. `migrations/20260309_0001_baseline.sql`
2. `migrations/20260309_0002_lobby_flow.sql`
3. `migrations/20260310_0003_fixed_cap_18.sql`
4. `migrations/20260310_0004_session_timeout_and_join_updates.sql`
5. `migrations/20260311_0005_name_rules.sql`
6. `migrations/20260311_0006_game_slug_routing.sql`
7. `migrations/20260311_0007_secret_category_runtime.sql`
8. `migrations/20260311_0008_secret_category_reroll.sql`

Then test from the web app by creating a game on one device and joining from another device/link.
