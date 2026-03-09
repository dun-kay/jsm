# Supabase Baseline

This folder stores SQL migrations and setup notes for the JSM Games backend.

## Applied scope

- Lobby backend wiring for create/join/start/cancel flow.
- Security-definer RPC functions for client access from anon key.

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

Then test from the web app by creating a game on one device and joining from another device/link.
