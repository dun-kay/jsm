const DEFAULT_ALLOWED_ORIGINS = ["https://jumpship.media", "http://localhost:5173", "http://127.0.0.1:5173"];

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function getAllowedOrigins(): string[] {
  const fromEnv = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
  const list = fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
  return Array.from(new Set(list));
}

export function isOriginAllowed(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  return getAllowedOrigins().includes(normalized);
}

export function getCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": normalizeOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  };
}

export function getRequestOrigin(req: Request): string {
  return req.headers.get("origin") || "";
}

export function jsonResponse(body: unknown, status = 200, origin = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(origin ? getCorsHeaders(origin) : {}),
      "Content-Type": "application/json"
    }
  });
}
