import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, getRequestOrigin, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_REASONS = new Set([
  "i_paid_but_didnt_unlock",
  "payment_failed",
  "i_was_charged_twice",
  "checkout_closed",
  "something_else"
]);

Deno.serve(async (req) => {
  const origin = getRequestOrigin(req);

  if (req.method === "OPTIONS") {
    if (!origin || !isOriginAllowed(origin)) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }

  if (!origin || !isOriginAllowed(origin)) {
    return jsonResponse({ error: "Forbidden origin." }, 403, origin);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing server environment variables." }, 500, origin);
    }

    const body = (await req.json()) as { browserToken?: string; reason?: string; note?: string };
    const browserToken = String(body.browserToken || "");
    const reason = String(body.reason || "");
    const note = String(body.note || "").slice(0, 400);

    if (!UUID_REGEX.test(browserToken)) {
      return jsonResponse({ error: "Invalid browser token." }, 400, origin);
    }
    if (!ALLOWED_REASONS.has(reason)) {
      return jsonResponse({ error: "Invalid reason." }, 400, origin);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    await supabase.rpc("ensure_access_record", { p_browser_token: browserToken });
    const { data: guardData, error: guardError } = await supabase
      .rpc("check_access_rate_limit", {
        p_browser_token: browserToken,
        p_action_key: "payment_help",
        p_limit: 6,
        p_window_seconds: 600,
        p_block_seconds: 600
      })
      .single<{ allowed: boolean; retry_after_seconds: number }>();

    if (guardError) {
      return jsonResponse({ error: guardError.message || "Unable to validate request rate." }, 500, origin);
    }
    if (!guardData?.allowed) {
      return jsonResponse(
        { error: `Too many help requests. Try again in ${guardData?.retry_after_seconds || 600} seconds.` },
        429,
        origin
      );
    }

    const { data, error } = await supabase
      .rpc("maybe_grant_courtesy_unlock", {
        p_browser_token: browserToken,
        p_reason: reason
      })
      .single<{ granted: boolean; reason: string }>();

    if (error || !data) {
      return jsonResponse({ error: error?.message || "Unable to process request." }, 500, origin);
    }

    await supabase.from("access_payments").insert({
      browser_token: browserToken,
      status: data.granted ? "paid" : "failed",
      amount_cents: 100,
      currency: "usd",
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: note || null
    });

    if (data.granted) {
      return jsonResponse({
        granted: true,
        message:
          "You have been given a courtesy 4-hour unlock. If this keeps happening, please try again later."
      }, 200, origin);
    }

    return jsonResponse({
      granted: false,
      message: "Request received. No courtesy unlock available right now."
    }, 200, origin);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unable to process payment help request." },
      500,
      origin
    );
  }
});
