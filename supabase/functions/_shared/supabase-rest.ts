type RestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  prefer?: string;
};

export async function supabaseRest<T>(
  path: string,
  apiKey: string,
  options: RestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    apikey: apiKey,
    "Content-Type": "application/json",
  };

  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase request failed with ${response.status}`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text.trim()) return undefined as T;

  return JSON.parse(text) as T;
}
