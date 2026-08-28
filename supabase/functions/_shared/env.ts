export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function supabaseSecretKey(): string {
  const direct = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;

  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!keys) throw new Error("Missing SUPABASE_SECRET_KEY");
  return JSON.parse(keys).default;
}

export function supabasePublishableKey(): string {
  const direct = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  if (direct) return direct;

  const keys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!keys) throw new Error("Missing SUPABASE_PUBLISHABLE_KEY");
  return JSON.parse(keys).default;
}
