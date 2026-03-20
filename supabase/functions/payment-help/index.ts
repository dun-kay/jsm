import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_REASONS = new Set([
  "i_paid_but_didnt_unlock",
  "payment_failed",
  "i_was_charged_twice",
  "checkout_closed",
  "something_else"
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing server environment variables." }, 500);
    }

    const body = (await req.json()) as { browserToken?: string; reason?: string; note?: string };
    const browserToken = String(body.browserToken || "");
    const reason = String(body.reason || "");
    const note = String(body.note || "").slice(0, 400);

    if (!UUID_REGEX.test(browserToken)) {
      return jsonResponse({ error: "Invalid browser token." }, 400);
    }
    if (!ALLOWED_REASONS.has(reason)) {
      return jsonResponse({ error: "Invalid reason." }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    await supabase.rpc("ensure_access_record", { p_browser_token: browserToken });
    const { data, error } = await supabase
      .rpc("maybe_grant_courtesy_unlock", {
        p_browser_token: browserToken,
        p_reason: reason
      })
      .single<{ granted: boolean; reason: string }>();

    if (error || !data) {
      return jsonResponse({ error: error?.message || "Unable to process request." }, 500);
    }

    await supabase.from("access_payments").insert({
      browser_token: browserToken,
      status: data.granted ? "paid" : "failed",
      amount_cents: 100,
      currency: "aud",
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: note || null
    });

    if (data.granted) {
      return jsonResponse({
        granted: true,
        message:
          "You have been given a courtesy 4-hour unlock. If this keeps happening, please try again later."
      });
    }

    return jsonResponse({
      granted: false,
      message: "Request received. No courtesy unlock available right now."
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unable to process payment help request." },
      500
    );
  }
});
