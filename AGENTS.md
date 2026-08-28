# JSM Stories Project Notes

JSM Stories is a GitHub Pages hosted serial-fiction MVP for Jump Ship Media.

## Architecture

- GitHub Pages serves the public frontend and reader shell.
- Supabase owns authentication, database records, content access checks, and Edge Functions.
- Stripe Checkout is the payment authority.
- Brevo is downstream contact/email sync only.

## Security

- Paid episode prose must never be committed to static HTML, JavaScript, CSS, JSON, comments, or public assets.
- Public frontend code may contain Supabase URL and publishable keys only.
- Supabase secret keys, access tokens, database passwords, Stripe secret keys, webhook secrets, and Brevo API keys must stay out of source control.
- Access to paid prose must be authorized server/database-side.
- Brevo must never determine whether a reader has access.

## Simplicity

Build the content model so many serials are possible later, but build product surfaces only for the Blackwater Bay launch.

Database migrations belong in `supabase/migrations/`.
Edge Functions belong in `supabase/functions/`.
