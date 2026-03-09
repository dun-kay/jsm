function getEnv(name: string): string {
  return import.meta.env[name] ?? "";
}

export const env = {
  supabaseUrl: getEnv("VITE_SUPABASE_URL"),
  supabaseAnonKey: getEnv("VITE_SUPABASE_ANON_KEY")
};

