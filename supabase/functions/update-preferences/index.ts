import { supabasePublishableKey, supabaseSecretKey, requiredEnv } from "../_shared/env.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { supabaseRest } from "../_shared/supabase-rest.ts";

type SupabaseUser = {
  id: string;
  email?: string;
};

type Series = {
  id: string;
  slug: string;
};

type Profile = {
  email: string;
  marketing_consent: boolean;
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
      if (response.status === 400 && detail.includes("already in list")) return;
      failures.push(`List ${id}: ${response.status} ${detail}`);
    }
  }));

  return failures;
}

async function syncBrevoContact(
  email: string | undefined,
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
        SERIES_NOTIFICATIONS: seriesTags.join(","),
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Brevo preference sync failed", response.status, detail);

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
      console.error("Brevo preference list-only sync failed", retry.status, retryDetail);
      return { synced: false, reason: `Brevo ${retry.status}: ${retryDetail}` };
    }

    const listFailures = await addEmailToBrevoLists(apiKey, email, listIds);
    if (listFailures.length) {
      console.error("Brevo preference explicit list sync failed", listFailures.join(" | "));
      return { synced: false, reason: listFailures.join(" | ") };
    }

    return { synced: true, warning: "Synced to lists only. Check Brevo custom attributes." };
  }

  const listFailures = await addEmailToBrevoLists(apiKey, email, listIds);
  if (listFailures.length) {
    console.error("Brevo preference explicit list sync failed", listFailures.join(" | "));
    return { synced: false, reason: listFailures.join(" | ") };
  }

  return { synced: true };
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
    const publicKey = supabasePublishableKey();
    const secretKey = supabaseSecretKey();
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    if (!token) {
      return jsonResponse({ error: "Sign in before updating preferences." }, 401);
    }

    const user = await supabaseRest<SupabaseUser>(
      `${supabaseUrl}/auth/v1/user`,
      publicKey,
      { token },
    );
    const body = await request.json();
    const hasMarketingConsent = typeof body.marketing_consent === "boolean";
    const hasSeriesPreference = typeof body.series_slug === "string"
      && typeof body.notify_new_releases === "boolean";

    if (hasMarketingConsent) {
      await supabaseRest(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`,
        secretKey,
        {
          method: "PATCH",
          prefer: "return=minimal",
          body: { marketing_consent: body.marketing_consent },
        },
      );
    }

    if (hasSeriesPreference) {
      const seriesRows = await supabaseRest<Series[]>(
        `${supabaseUrl}/rest/v1/series?slug=eq.${encodeURIComponent(body.series_slug)}&status=eq.active&select=id,slug`,
        secretKey,
      );
      const series = seriesRows[0];

      if (!series) {
        return jsonResponse({ error: "Series not found." }, 404);
      }

      await supabaseRest(
        `${supabaseUrl}/rest/v1/user_series_notifications?on_conflict=user_id,series_id`,
        secretKey,
        {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: {
            user_id: user.id,
            series_id: series.id,
            notify_new_releases: body.notify_new_releases,
          },
        },
      );
    }

    const profiles = await supabaseRest<Profile[]>(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=email,marketing_consent`,
      secretKey,
    );
    const notificationRows = await supabaseRest<NotificationRow[]>(
      `${supabaseUrl}/rest/v1/user_series_notifications?user_id=eq.${encodeURIComponent(user.id)}&notify_new_releases=is.true&select=notify_new_releases,series:series_id(slug)`,
      secretKey,
    );
    const profile = profiles[0];
    const tags = notificationRows.map((row) => seriesTag(row.series.slug));

    const brevo = await syncBrevoContact(
      user.email ?? profile?.email,
      Boolean(profile?.marketing_consent),
      tags,
    );

    return jsonResponse({ ok: true, series_notifications: tags, brevo });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
