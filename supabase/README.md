# Supabase Baseline

This folder stores SQL migrations and setup notes for the JSM Games backend.

## Applied scope

- No game-flow tables yet.
- Baseline hardening only.

## Dashboard settings to confirm

1. Auth -> URL Configuration
- Site URL: https://jumpship.media
- Redirect URLs:
  - http://localhost:5173
  - https://jumpship.media

2. Database -> Extensions
- Confirm `pgcrypto` is enabled (migration includes this).

3. API Settings
- Keep Row Level Security enabled for all future tables.

## Migration usage

Run SQL files in order from `migrations/` using Supabase SQL Editor or Supabase CLI.