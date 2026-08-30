import { corsHeaders, jsonResponse } from "../_shared/http.ts";

function listId(name: string): number | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function brevoListIds(): number[] {
  const ids = [
    listId("BREVO_ALL_READERS_LIST_ID"),
    listId("BREVO_MARKETING_LIST_ID"),
    listId("BREVO_BLACKWATER_LIST_ID"),
    listId("BREVO_BLACKWATER_WAITLIST_LIST_ID") ?? 5,
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const apiKey = Deno.env.get("BREVO_API_KEY");
    if (!apiKey) return jsonResponse({ error: "Waitlist is not configured." }, 500);

    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const consent = body.marketing_consent === true;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid email address." }, 400);
    }

    if (!consent) {
      return jsonResponse({ error: "Marketing consent is required for this waitlist." }, 400);
    }

    const listIds = brevoListIds();
    const contactPayload = {
      email,
      updateEnabled: true,
      listIds,
      attributes: {
        JSM_READER: true,
        OPT_IN: true,
        MARKETING_CONSENT: true,
        SERIES_NOTIFICATIONS: "BLACKWATER_BAY",
        WAITLIST_SOURCE: String(body.source ?? "blackwater_waitlist"),
      },
    };

    const response = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contactPayload),
    });

    if (!response.ok) {
      const retry = await fetch("https://api.brevo.com/v3/contacts", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, updateEnabled: true, listIds }),
      });

      if (!retry.ok) {
        const detail = await retry.text();
        return jsonResponse({ error: `Brevo ${retry.status}: ${detail}` }, 502);
      }
    }

    const listFailures = await addEmailToBrevoLists(apiKey, email, listIds);
    if (listFailures.length) {
      return jsonResponse({ error: listFailures.join(" | ") }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
