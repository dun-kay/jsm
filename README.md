# JSM Stories

Static GitHub Pages frontend for Jump Ship Media and the JSM Stories MVP.

## Structure

- `index.html` is the JSM Stories homepage.
- `your-partner/` keeps the existing Jump Ship Media consulting page.
- `blackwater/` is the Blackwater Bay serial page and episode directory.
- `account/` contains the reader library page.
- `assets/stories.css` and `assets/stories.js` are the shared frontend assets.
- `supabase/migrations/` contains database schema, RLS, safe public views, and seed metadata.
- `supabase/functions/` contains Stripe Checkout and webhook Edge Functions.

## Secrets

`ENV.txt` is intentionally ignored by git. Do not commit it.

Public browser-safe values may appear in static frontend code:

- Supabase project URL
- Supabase publishable key

Server-only values must stay in Supabase Edge Function secrets or local ignored env files:

- Supabase secret key
- Supabase access token
- Supabase DB password
- Stripe secret key
- Stripe webhook secret
- Brevo API key

## Backend Setup

Install/use the Supabase CLI, then link the project:

```sh
supabase link --project-ref setykcvlivqiuufjkjuu
supabase db push
```

Set Edge Function secrets:

```sh
supabase secrets set --env-file supabase/functions/.env
```

Deploy functions:

```sh
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
```

Configure Stripe to send `checkout.session.completed` events to:

```txt
https://setykcvlivqiuufjkjuu.supabase.co/functions/v1/stripe-webhook
```

Then set the resulting `STRIPE_WEBHOOK_SECRET` in Supabase secrets.

## Supabase Auth Setup

The frontend uses Supabase passwordless email auth.

Supabase sends a magic link by default when the Magic Link email template includes `{{ .ConfirmationURL }}`. Keep that default and add these redirect URLs in Supabase Dashboard > Authentication > URL Configuration:

```txt
https://jumpship.media/**
http://localhost:5173/**
```

The frontend passes the current reader/account URL as `emailRedirectTo`, so readers return to the episode or account page after clicking the email link.

If a six-digit code is preferred later, update the Supabase Magic Link template to include `{{ .Token }}`. The frontend still has a hidden manual-code path for that setup.

## Paid Content

Do not put locked prose in this repository. The migration creates episode metadata only. Load `preview_html` and `paid_html` directly into Supabase from a private local import process or Dashboard SQL that is not committed.
