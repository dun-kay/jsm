import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16.12.0";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain"
    }
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return response(405, "Method not allowed");
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
    const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
      return response(500, "Missing server environment variables.");
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return response(400, "Missing stripe-signature header.");
    }

    const rawBody = await req.text();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, stripeWebhookSecret);
    } catch (error) {
      return response(400, `Webhook signature verification failed: ${(error as Error).message}`);
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      let browserToken = String(session.metadata?.browser_token || "");
      if (!UUID_REGEX.test(browserToken)) {
        const { data: pending } = await supabase
          .from("access_payments")
          .select("browser_token")
          .eq("stripe_checkout_session_id", session.id)
          .maybeSingle<{ browser_token: string }>();
        browserToken = String(pending?.browser_token || "");
      }
      if (!UUID_REGEX.test(browserToken)) {
        return response(200, "Ignored event with missing browser token.");
      }

      const paymentRef = session.payment_intent
        ? String(session.payment_intent)
        : String(session.id);
      const unlockHoursRaw = Number(session.metadata?.unlock_hours || "4");
      const unlockHours =
        Number.isFinite(unlockHoursRaw) && unlockHoursRaw >= 1 && unlockHoursRaw <= 24 * 90
          ? Math.floor(unlockHoursRaw)
          : 4;
      const amountCents = typeof session.amount_total === "number" ? session.amount_total : unlockHours === 24 * 30 ? 600 : 100;
      const currency = String(session.currency || "usd").toLowerCase();

      await supabase.rpc("access_apply_payment_unlock", {
        p_browser_token: browserToken,
        p_payment_reference: paymentRef,
        p_unlock_hours: unlockHours
      });

      await supabase
        .from("access_payments")
        .upsert(
          {
            browser_token: browserToken,
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent ? String(session.payment_intent) : null,
            status: "paid",
            amount_cents: amountCents,
            currency
          },
          { onConflict: "stripe_checkout_session_id" }
        );
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.id) {
        await supabase
          .from("access_payments")
          .update({ status: "expired" })
          .eq("stripe_checkout_session_id", session.id);
      }
    }

    return response(200, "ok");
  } catch (error) {
    return response(500, error instanceof Error ? error.message : "Unexpected webhook error.");
  }
});
