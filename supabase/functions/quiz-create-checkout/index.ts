import { requiredEnv, supabaseSecretKey } from "../_shared/env.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { supabaseRest } from "../_shared/supabase-rest.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const { session_id, success_url, cancel_url } = await request.json();
    if (!session_id || !success_url || !cancel_url) return jsonResponse({ error: "Missing checkout details." }, 400);
    const siteUrl = requiredEnv("SITE_URL");
    for (const value of [success_url, cancel_url]) if (new URL(value).origin !== new URL(siteUrl).origin) return jsonResponse({ error: "Invalid return URL." }, 400);
    const url = requiredEnv("SUPABASE_URL"), secret = supabaseSecretKey();
    const rows = await supabaseRest<{ id: string; paid: boolean }[]>(`${url}/rest/v1/quiz_sessions?id=eq.${encodeURIComponent(session_id)}&select=id,paid`, secret);
    if (!rows[0] || rows[0].paid) return jsonResponse({ error: "Quiz session is unavailable." }, 404);
    const params = new URLSearchParams({ mode: "payment", "line_items[0][price]": requiredEnv("QUIZ_STRIPE_PRICE_ID"), "line_items[0][quantity]": "1", allow_promotion_codes: "true", success_url, cancel_url, client_reference_id: session_id, "metadata[quiz_session_id]": session_id });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${requiredEnv("STRIPE_SECRET_KEY")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params });
    const checkout = await response.json();
    if (!response.ok) return jsonResponse({ error: checkout.error?.message ?? "Checkout could not be created." }, 400);
    return jsonResponse({ url: checkout.url });
  } catch (error) { return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500); }
});
