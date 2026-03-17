# Supabase Baseline

This folder stores SQL migrations and setup notes for the JSM Games backend.

## Applied scope

- Lobby backend wiring for create/join/start/cancel flow.
- Security-definer RPC functions for client access from anon key.
- Fixed max cap of 18 players.
- Session resume with timeout and cleanup rules (hardened to 20 minutes for active gameplay).

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
9. `migrations/20260311_0009_secret_category_vote_fix.sql`
10. `migrations/20260312_0010_session_hardening.sql`
11. `migrations/20260312_0011_secret_category_pool_table.sql`
12. `migrations/20260313_0012_celebrities_runtime.sql`
13. `migrations/20260313_0013_celebrities_submit_fix.sql`
14. `migrations/20260313_0014_celebrities_duplicate_guard.sql`
15. `migrations/20260313_0015_leave_game_rpc.sql`
16. `migrations/20260313_0016_celebrities_countdown_and_waiting_state.sql`
17. `migrations/20260313_0017_celebrities_30s_and_play_again.sql`
18. `migrations/20260315_0018_celebrities_single_input_logic.sql`
19. `migrations/20260315_0019_popular_people_rename.sql`
20. `migrations/20260316_0020_popular_people_randomize_bot_pool.sql`
21. `migrations/20260316_0021_popular_people_auto_advance_reveal.sql`
22. `migrations/20260316_0022_popular_people_leader_turns_only.sql`
23. `migrations/20260316_0023_popular_people_uncollected_targets_only.sql`
24. `migrations/20260317_0024_fruit_bowl_runtime.sql`
25. `migrations/20260317_0025_fruit_bowl_turn_cycle_fix.sql`
26. `migrations/20260317_0026_fruit_bowl_turn_ready_gate.sql`

Then test from the web app by creating a game on one device and joining from another device/link.

## Secret Categories data

- Runtime now pulls category data from `public.secret_category_pool` (database table).
- Reference JSON lives at `games-web/src/games/secret-category/categoryPool.json`.
- Edit the DB table in Supabase if you want instant updates without redeploying.
