import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16.12.0";
import { getCorsHeaders, getRequestOrigin, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRAW_THINGS_PRODUCT_ID = "prod_UKgE1EdSy1jEPm";
const DRAW_THINGS_PLAYS_GRANTED = 100;

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
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing server environment variables." }, 500, origin);
    }

    const body = (await req.json()) as { browserToken?: string; sessionId?: string; requestNonce?: string };
    const browserToken = String(body.browserToken || "");
    const sessionId = String(body.sessionId || "");
    const requestNonce = String(body.requestNonce || "");

    if (!UUID_REGEX.test(browserToken)) {
      return jsonResponse({ error: "Invalid browser token." }, 400, origin);
    }
    if (!sessionId.startsWith("cs_")) {
      return jsonResponse({ error: "Invalid checkout session id." }, 400, origin);
    }
    if (requestNonce.length < 16) {
      return jsonResponse({ error: "Invalid request signature." }, 403, origin);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    await supabase.rpc("ensure_access_record", { p_browser_token: browserToken });
    const { data: nonceAllowed, error: nonceError } = await supabase.rpc("consume_access_request_nonce", {
      p_browser_token: browserToken,
      p_purpose: "confirm_checkout",
      p_nonce: requestNonce
    });
    if (nonceError || nonceAllowed !== true) {
      return jsonResponse({ error: "Request signature rejected." }, 403, origin);
    }

    const { data: existingPayment } = await supabase
      .from("access_payments")
      .select("status")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle<{ status: string }>();

    if (existingPayment?.status === "paid") {
      return jsonResponse(
        {
          confirmed: true,
          applied: false,
          playsGranted: 0,
          reason: "already_applied"
        },
        200,
        origin
      );
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const isComplete = session.status === "complete";
    const isPaid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
    if (!isComplete || !isPaid) {
      return jsonResponse(
        {
          confirmed: false,
          applied: false,
          playsGranted: 0,
          reason: "payment_not_completed"
        },
        200,
        origin
      );
    }

    const metadataProductId = String(session.metadata?.product_id || "");
    const metadataType = String(session.metadata?.checkout_type || "");
    const hasDrawThingsProduct =
      metadataType === "draw_things_plays" &&
      metadataProductId === DRAW_THINGS_PRODUCT_ID;
    if (!hasDrawThingsProduct) {
      return jsonResponse({ error: "Checkout session product mismatch." }, 403, origin);
    }

    const metadataToken = String(session.metadata?.browser_token || "");
    const effectiveBrowserToken = UUID_REGEX.test(metadataToken) ? metadataToken : browserToken;
    if (!UUID_REGEX.test(effectiveBrowserToken)) {
      return jsonResponse({ error: "Checkout session missing browser token." }, 403, origin);
    }

    await supabase
      .from("access_payments")
      .upsert(
        {
          browser_token: effectiveBrowserToken,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent ? String(session.payment_intent) : null,
          status: "paid",
          amount_cents: typeof session.amount_total === "number" ? session.amount_total : 0,
          currency: String(session.currency || "usd").toLowerCase()
        },
        { onConflict: "stripe_checkout_session_id" }
      );

    return jsonResponse(
      {
        confirmed: true,
        applied: true,
        playsGranted: DRAW_THINGS_PLAYS_GRANTED
      },
      200,
      origin
    );
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Failed to confirm Draw Things checkout." },
      500,
      origin
    );
  }
});
