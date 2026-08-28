import { requiredEnv, supabaseSecretKey } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import { supabaseRest } from "../_shared/supabase-rest.ts";

const encoder = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyStripeSignature(rawBody: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expected = await hmacSha256(secret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(expected, signature);
}

type Profile = {
  email: string;
  marketing_consent: boolean;
};

type Product = {
  name: string;
};

type NotificationRow = {
  notify_new_releases: boolean;
  series: {
    slug: string;
  };
};

function seriesTag(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function listId(name: string): number | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function brevoListIds(marketingConsent: boolean, seriesTags: string[]): number[] {
  const ids = [
    listId("BREVO_ALL_READERS_LIST_ID"),
    marketingConsent ? listId("BREVO_MARKETING_LIST_ID") : null,
    seriesTags.includes("BLACKWATER_BAY") || seriesTags.includes("BLACKWATER")
      ? listId("BREVO_BLACKWATER_LIST_ID")
      : null,
  ].filter((id): id is number => id !== null);

  return [...new Set(ids)];
}

async function addEmailToBrevoLists(apiKey: string, email: string, listIds: number[]) {
  const failures: string[] = [];

  await Promise.all(listIds.map(async (id) => {
    const response = await fetch(`https://api.brevo.com/v3/contacts/lists/${id}/contacts/add`, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ emails: [email] }),
    });

    if (!response.ok) {
      const detail = await response.text();
      failures.push(`List ${id}: ${response.status} ${detail}`);
    }
  }));

  return failures;
}

async function syncBrevoContact(
  email: string | undefined,
  productName: string | undefined,
  marketingConsent: boolean,
  seriesTags: string[],
) {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey || !email) {
    return { synced: false, reason: !apiKey ? "Missing BREVO_API_KEY" : "Missing email" };
  }

  const listIds = brevoListIds(marketingConsent, seriesTags);
  const basePayload = {
    email,
    updateEnabled: true,
    listIds,
  };

  const response = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...basePayload,
      attributes: {
        JSM_READER: true,
        OPT_IN: marketingConsent,
        MARKETING_CONSENT: marketingConsent,
        BLACKWATER_CUSTOMER: true,
        BLACKWATER_STATUS: "Purchased",
        LAST_PURCHASED_PRODUCT: productName ?? "Unknown product",
        PURCHASED_PRODUCTS: productName ?? "Unknown product",
        SERIES_NOTIFICATIONS: seriesTags.join(","),
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Brevo contact sync failed", response.status, detail);

    const retry = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(basePayload),
    });

    if (!retry.ok) {
      const retryDetail = await retry.text();
      console.error("Brevo contact list-only sync failed", retry.status, retryDetail);
      return { synced: false, reason: `Brevo ${retry.status}: ${retryDetail}` };
    }

    const listFailures = await addEmailToBrevoLists(apiKey, email, listIds);
    if (listFailures.length) {
      console.error("Brevo contact explicit list sync failed", listFailures.join(" | "));
      return { synced: false, reason: listFailures.join(" | ") };
    }

    return { synced: true, warning: "Synced to lists only. Check Brevo custom attributes." };
  }

  const listFailures = await addEmailToBrevoLists(apiKey, email, listIds);
  if (listFailures.length) {
    console.error("Brevo contact explicit list sync failed", listFailures.join(" | "));
    return { synced: false, reason: listFailures.join(" | ") };
  }

  return { synced: true };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const webhookSecret = requiredEnv("STRIPE_WEBHOOK_SECRET");
    const signature = request.headers.get("stripe-signature") ?? "";
    const rawBody = await request.text();
    const verified = await verifyStripeSignature(rawBody, signature, webhookSecret);

    if (!verified) {
      return jsonResponse({ error: "Invalid signature" }, 400);
    }

    const event = JSON.parse(rawBody);
    if (event.type !== "checkout.session.completed") {
      return jsonResponse({ received: true });
    }

    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const productId = session.metadata?.product_id;
    const paid = session.payment_status === "paid" || session.status === "complete";

    if (!userId || !productId || !paid) {
      return jsonResponse({ received: true });
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const secretKey = supabaseSecretKey();
    const products = await supabaseRest<Product[]>(
      `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=name`,
      secretKey,
    );
    const profiles = await supabaseRest<Profile[]>(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email,marketing_consent`,
      secretKey,
    );
    const notificationRows = await supabaseRest<NotificationRow[]>(
      `${supabaseUrl}/rest/v1/user_series_notifications?user_id=eq.${encodeURIComponent(userId)}&notify_new_releases=is.true&select=notify_new_releases,series:series_id(slug)`,
      secretKey,
    );
    const productName = session.metadata?.product_name ?? products[0]?.name;
    const profile = profiles[0];
    const seriesTags = notificationRows.map((row) => seriesTag(row.series.slug));

    await supabaseRest(
      `${supabaseUrl}/rest/v1/purchases?on_conflict=stripe_session_id`,
      secretKey,
      {
        method: "POST",
        prefer: "resolution=merge-duplicates",
        body: {
          user_id: userId,
          product_id: productId,
          stripe_session_id: session.id,
          status: "paid",
        },
      },
    );

    const brevo = await syncBrevoContact(
      session.customer_details?.email ?? session.customer_email ?? profile?.email,
      productName,
      Boolean(profile?.marketing_consent),
      seriesTags,
    );

    return jsonResponse({ received: true, brevo });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
