import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error(
      "Supabase environment variables are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }

  client = createClient(env.supabaseUrl, env.supabaseAnonKey);
  return client;
}

