import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16.12.0";
import { getCorsHeaders, getRequestOrigin, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRAW_THINGS_PRODUCT_ID = "prod_UKgE1EdSy1jEPm";

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
    const siteUrl = Deno.env.get("SITE_URL") || "https://jumpship.media";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing server environment variables." }, 500, origin);
    }

    const body = (await req.json()) as { browserToken?: string; returnTo?: string; requestNonce?: string; productId?: string };
    const browserToken = String(body.browserToken || "");
    const requestNonce = String(body.requestNonce || "");
    const returnToRaw = String(body.returnTo || "");
    const productId = String(body.productId || DRAW_THINGS_PRODUCT_ID);

    if (!UUID_REGEX.test(browserToken)) {
      return jsonResponse({ error: "Invalid browser token." }, 400, origin);
    }
    if (requestNonce.length < 16) {
      return jsonResponse({ error: "Invalid request signature." }, 403, origin);
    }
    if (productId !== DRAW_THINGS_PRODUCT_ID) {
      return jsonResponse({ error: "Unsupported product." }, 400, origin);
    }

    const canonicalOrigin = new URL(siteUrl).origin;
    let successUrl = `${siteUrl}/?draw_payment=success&draw_session_id={CHECKOUT_SESSION_ID}`;
    let cancelUrl = `${siteUrl}/?draw_payment=cancelled`;

    if (returnToRaw) {
      try {
        const parsed = new URL(returnToRaw);
        if (isOriginAllowed(parsed.origin)) {
          const base = `${parsed.pathname}${parsed.search}${parsed.hash}`;
          const successParsed = new URL(base, canonicalOrigin);
          successParsed.searchParams.set("draw_payment", "success");
          successParsed.searchParams.set("draw_session_id", "{CHECKOUT_SESSION_ID}");
          successUrl = successParsed.toString();

          const cancelParsed = new URL(base, canonicalOrigin);
          cancelParsed.searchParams.set("draw_payment", "cancelled");
          cancelUrl = cancelParsed.toString();
        }
      } catch {
        // Keep fallback URLs.
      }
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    await supabase.rpc("ensure_access_record", { p_browser_token: browserToken });
    const { data: nonceAllowed, error: nonceError } = await supabase.rpc("consume_access_request_nonce", {
      p_browser_token: browserToken,
      p_purpose: "start_checkout",
      p_nonce: requestNonce
    });
    if (nonceError || nonceAllowed !== true) {
      return jsonResponse({ error: "Request signature rejected." }, 403, origin);
    }

    const { data: guardData, error: guardError } = await supabase
      .rpc("check_access_rate_limit", {
        p_browser_token: browserToken,
        p_action_key: "start_draw_things_checkout",
        p_limit: 5,
        p_window_seconds: 300,
        p_block_seconds: 300
      })
      .single<{ allowed: boolean; retry_after_seconds: number }>();

    if (guardError) {
      return jsonResponse({ error: guardError.message || "Unable to validate request rate." }, 500, origin);
    }
    if (!guardData?.allowed) {
      return jsonResponse(
        { error: `Too many attempts. Try again in ${guardData?.retry_after_seconds || 300} seconds.` },
        429,
        origin
      );
    }

    const product = await stripe.products.retrieve(DRAW_THINGS_PRODUCT_ID, { expand: ["default_price"] });
    const defaultPrice = product.default_price;
    const priceId = typeof defaultPrice === "string" ? defaultPrice : defaultPrice?.id || "";
    if (!priceId) {
      return jsonResponse({ error: "Draw Things product has no default price." }, 500, origin);
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: {
        browser_token: browserToken,
        checkout_type: "draw_things_plays",
        plays_granted: "100"
      },
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    await supabase.from("access_payments").insert({
      browser_token: browserToken,
      stripe_checkout_session_id: checkout.id,
      status: "pending",
      amount_cents: 0,
      currency: "usd"
    });

    return jsonResponse({ checkoutUrl: checkout.url }, 200, origin);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Failed to create Draw Things checkout session." },
      500,
      origin
    );
  }
});
