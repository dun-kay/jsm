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
    const siteUrl = Deno.env.get("SITE_URL") || "https://jumpship.media";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Missing server environment variables." }, 500, origin);
    }

    const body = (await req.json()) as { browserToken?: string; returnTo?: string; plan?: string };
    const browserToken = String(body.browserToken || "");
    const planKey = body.plan === "30d" ? "30d" : "4h";
    const returnToRaw = String(body.returnTo || "");
    if (!UUID_REGEX.test(browserToken)) {
      return jsonResponse({ error: "Invalid browser token." }, 400, origin);
    }

    let successUrl = `${siteUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    let cancelUrl = `${siteUrl}/?payment=cancelled`;
    if (returnToRaw) {
      try {
        const parsed = new URL(returnToRaw);
        const allowedHost = new URL(siteUrl).host;
        if (parsed.host === allowedHost) {
          parsed.searchParams.set("payment", "success");
          parsed.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
          successUrl = parsed.toString();

          const cancelParsed = new URL(returnToRaw);
          cancelParsed.searchParams.set("payment", "cancelled");
          cancelUrl = cancelParsed.toString();
        }
      } catch {
        // keep default fallback URLs
      }
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20"
    });
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const plan =
      planKey === "30d"
        ? {
            key: "30d",
            unlockHours: 24 * 30,
            amountCents: 999,
            lineItem: {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: 999,
                product: "prod_UCN80vk13eYXL8"
              }
            }
          }
        : {
            key: "4h",
            unlockHours: 4,
            amountCents: 100,
            lineItem: {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: 100,
                product: "prod_UBHgz7NjuqyqXQ"
              }
            }
          };

    await supabase.rpc("ensure_access_record", { p_browser_token: browserToken });
    const { data: guardData, error: guardError } = await supabase
      .rpc("check_access_rate_limit", {
        p_browser_token: browserToken,
        p_action_key: "start_checkout",
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

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        plan.lineItem
      ],
      allow_promotion_codes: true,
      metadata: {
        browser_token: browserToken,
        unlock_hours: String(plan.unlockHours),
        plan_key: plan.key
      },
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    await supabase.from("access_payments").insert({
      browser_token: browserToken,
      stripe_checkout_session_id: checkout.id,
      status: "pending",
      amount_cents: plan.amountCents,
      currency: "usd"
    });

    return jsonResponse({
      checkoutUrl: checkout.url
    }, 200, origin);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Failed to create checkout session." },
      500,
      origin
    );
  }
});
