import { requiredEnv, supabasePublishableKey, supabaseSecretKey } from "../_shared/env.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { supabaseRest } from "../_shared/supabase-rest.ts";

type Product = {
  id: string;
  name: string;
  stripe_price_id: string;
};

type SupabaseUser = {
  id: string;
  email?: string;
};

function returnUrlFromPath(returnPath: string, siteUrl: string) {
  const site = new URL(siteUrl);
  const requested = new URL(returnPath || "/account/", site);

  if (requested.origin !== site.origin) {
    return new URL("/account/", site);
  }

  return requested;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const siteUrl = requiredEnv("SITE_URL");
    const stripeSecretKey = requiredEnv("STRIPE_SECRET_KEY");
    const publicKey = supabasePublishableKey();
    const secretKey = supabaseSecretKey();
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    if (!token) {
      return jsonResponse({ error: "Sign in before checkout." }, 401);
    }

    const body = await request.json();
    const productId = String(body.product_id ?? "");
    const returnPath = String(body.return_path ?? "/account/");

    if (!productId) {
      return jsonResponse({ error: "Missing product_id." }, 400);
    }

    const user = await supabaseRest<SupabaseUser>(
      `${supabaseUrl}/auth/v1/user`,
      publicKey,
      { token },
    );

    const products = await supabaseRest<Product[]>(
      `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&active=is.true&select=id,name,stripe_price_id`,
      secretKey,
    );
    const product = products[0];

    if (!product) {
      return jsonResponse({ error: "Product is not available." }, 404);
    }

    const successUrl = returnUrlFromPath(returnPath, siteUrl);
    successUrl.searchParams.set("purchase", "success");
    const cancelUrl = returnUrlFromPath(returnPath, siteUrl);
    cancelUrl.searchParams.set("purchase", "cancelled");

    const checkoutBody = new URLSearchParams({
      mode: "payment",
      "line_items[0][price]": product.stripe_price_id,
      "line_items[0][quantity]": "1",
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      client_reference_id: user.id,
      "metadata[user_id]": user.id,
      "metadata[product_id]": product.id,
      "metadata[product_name]": product.name,
    });

    if (user.email) checkoutBody.set("customer_email", user.email);

    const checkoutResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: checkoutBody,
    });

    const checkout = await checkoutResponse.json();
    if (!checkoutResponse.ok) {
      return jsonResponse({ error: checkout.error?.message ?? "Checkout could not be created." }, 400);
    }

    return jsonResponse({ url: checkout.url });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
