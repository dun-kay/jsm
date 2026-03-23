import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16.12.0";
import { getCorsHeaders, getRequestOrigin, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    const body = (await req.json()) as { browserToken?: string; sessionId?: string };
    const browserToken = String(body.browserToken || "");
    const sessionId = String(body.sessionId || "");

    if (!UUID_REGEX.test(browserToken)) {
      return jsonResponse({ error: "Invalid browser token." }, 400, origin);
    }
    if (!sessionId.startsWith("cs_")) {
      return jsonResponse({ error: "Invalid checkout session id." }, 400, origin);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    await supabase.rpc("ensure_access_record", { p_browser_token: browserToken });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const metadataToken = String(session.metadata?.browser_token || "");
    let effectiveBrowserToken = browserToken;
    if (UUID_REGEX.test(metadataToken)) {
      effectiveBrowserToken = metadataToken;
    } else {
      const { data: pending } = await supabase
        .from("access_payments")
        .select("browser_token")
        .eq("stripe_checkout_session_id", session.id)
        .maybeSingle<{ browser_token: string }>();
      const fromPending = String(pending?.browser_token || "");
      if (UUID_REGEX.test(fromPending)) {
        effectiveBrowserToken = fromPending;
      }
    }
    if (!UUID_REGEX.test(effectiveBrowserToken)) {
      return jsonResponse({ error: "Checkout session missing browser token." }, 403, origin);
    }

    const isComplete = session.status === "complete";
    const isPaid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
    if (!isComplete || !isPaid) {
      return jsonResponse(
        {
          confirmed: false,
          applied: false,
          reason: "payment_not_completed"
        },
        200,
        origin
      );
    }

    const paymentRef = session.payment_intent ? String(session.payment_intent) : String(session.id);
    const unlockHoursRaw = Number(session.metadata?.unlock_hours || "4");
    const unlockHours =
      Number.isFinite(unlockHoursRaw) && unlockHoursRaw >= 1 && unlockHoursRaw <= 24 * 90
        ? Math.floor(unlockHoursRaw)
        : 4;
    const amountCents =
      typeof session.amount_total === "number"
        ? session.amount_total
        : unlockHours === 24 * 30
          ? 999
          : 100;
    const currency = String(session.currency || "usd").toLowerCase();

    await supabase.rpc("access_apply_payment_unlock", {
      p_browser_token: effectiveBrowserToken,
      p_payment_reference: paymentRef,
      p_unlock_hours: unlockHours
    });

    await supabase
      .from("access_payments")
      .upsert(
        {
          browser_token: effectiveBrowserToken,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent ? String(session.payment_intent) : null,
          status: "paid",
          amount_cents: amountCents,
          currency
        },
        { onConflict: "stripe_checkout_session_id" }
      );

    return jsonResponse(
      {
        confirmed: true,
        applied: true
      },
      200,
      origin
    );
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Failed to confirm checkout." },
      500,
      origin
    );
  }
});
