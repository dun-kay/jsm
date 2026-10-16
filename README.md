# JSM Stories

## Is My Boyfriend Stupid? quiz

The mobile game lives at `/quiz/ismyboyfriendstupid/` and is static GitHub Pages code. It stores only a first name, progress, score, section totals, and payment status. LocalStorage resumes the browser session; Supabase provides durable recovery for that same UUID session.

Run `npm run dev`, then open `http://localhost:5173/quiz/ismyboyfriendstupid/`. Generate its browser-safe live configuration from the ignored `ENV.txt` with `node scripts/generate-quiz-config.mjs`. It contains only the Supabase URL and publishable key—never secrets.

### Live payment setup

1. Set `QUIZ_STRIPE_PRICE_ID` to the live 99¢ Stripe Price (a Product ID is not sufficient).
2. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `QUIZ_STRIPE_PRICE_ID`, and `SITE_URL` as Edge Function secrets.
3. Apply the migrations and deploy:

```sh
supabase db push
supabase functions deploy quiz-create-checkout
supabase functions deploy quiz-get-remediation-plan
supabase functions deploy stripe-webhook
```

4. Reuse the established `stripe-webhook` endpoint and ensure its Stripe subscription receives `checkout.session.completed`.
5. Commit the generated browser-safe `quiz-config.js` with the GitHub Pages site.

The established `stripe-webhook` marks quiz payments only after Stripe signature verification. A payment return URL never unlocks the plan: the plan function checks the server-side paid flag.

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
