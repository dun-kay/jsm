import { getSupabaseClient } from "./supabase";

const ACCESS_TOKEN_KEY = "notes_browser_token";
const ACCESS_TOKEN_COOKIE = "notes_browser_token";
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;

export type AccessState = {
  browserToken: string;
  paidUnlockActive: boolean;
  paidUnlockExpiresAt: string | null;
  freeSessionsLeft: number;
  shareBonusAvailable: boolean;
  windowResetsAt: string | null;
  windowSecondsLeft: number;
};

export type ConsumeSessionResult = {
  allowed: boolean;
  reason: string;
  paidUnlockActive: boolean;
  paidUnlockExpiresAt: string | null;
  freeSessionsLeft: number;
  shareBonusAvailable: boolean;
  windowResetsAt: string | null;
};

export type ShareBonusResult = {
  granted: boolean;
  reason: string;
  shareBonusAvailable: boolean;
  freeSessionsLeft: number;
  windowResetsAt: string | null;
};

export type CheckoutPlan = "4h" | "30d";

export type PaymentHelpReason =
  | "i_paid_but_didnt_unlock"
  | "payment_failed"
  | "i_was_charged_twice"
  | "checkout_closed"
  | "something_else";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readCookie(name: string): string {
  const encoded = `${name}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const candidate = part.trim();
    if (candidate.startsWith(encoded)) {
      return decodeURIComponent(candidate.slice(encoded.length));
    }
  }
  return "";
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  const host = window.location.hostname.toLowerCase();
  const domainPart = host === "jumpship.media" || host.endsWith(".jumpship.media") ? "; Domain=.jumpship.media" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax; Secure${domainPart}`;
}

function ensureBrowserToken(): string {
  const fromStorage = window.localStorage.getItem(ACCESS_TOKEN_KEY) || "";
  const fromCookie = readCookie(ACCESS_TOKEN_COOKIE);
  const existing = isUuid(fromStorage) ? fromStorage : isUuid(fromCookie) ? fromCookie : "";
  const token = existing || crypto.randomUUID();
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  writeCookie(ACCESS_TOKEN_COOKIE, token, ACCESS_TOKEN_TTL_SECONDS);
  return token;
}

function mapAccessState(row: Record<string, unknown>): AccessState {
  return {
    browserToken: String(row.browser_token ?? ""),
    paidUnlockActive: Boolean(row.paid_unlock_active),
    paidUnlockExpiresAt: row.paid_unlock_expires_at ? String(row.paid_unlock_expires_at) : null,
    freeSessionsLeft: Number(row.free_sessions_left ?? 0),
    shareBonusAvailable: Boolean(row.share_bonus_available),
    windowResetsAt: row.window_resets_at ? String(row.window_resets_at) : null,
    windowSecondsLeft: Number(row.window_seconds_left ?? 0)
  };
}

export function getBrowserToken(): string {
  return ensureBrowserToken();
}

export async function getAccessState(): Promise<AccessState> {
  const supabase = getSupabaseClient();
  const browserToken = ensureBrowserToken();
  const { data, error } = await supabase
    .rpc("get_access_state_guarded", { p_browser_token: browserToken })
    .single<Record<string, unknown>>();

  if (error || !data) {
    throw new Error(error?.message || "Unable to load access state.");
  }

  return mapAccessState(data);
}

export async function consumeSession(gameCode: string): Promise<ConsumeSessionResult> {
  const supabase = getSupabaseClient();
  const browserToken = ensureBrowserToken();
  const { data, error } = await supabase
    .rpc("consume_session_guarded", {
      p_browser_token: browserToken,
      p_game_code: gameCode
    })
    .single<Record<string, unknown>>();

  if (error || !data) {
    throw new Error(error?.message || "Unable to validate play access.");
  }

  return {
    allowed: Boolean(data.allowed),
    reason: String(data.reason ?? ""),
    paidUnlockActive: Boolean(data.paid_unlock_active),
    paidUnlockExpiresAt: data.paid_unlock_expires_at ? String(data.paid_unlock_expires_at) : null,
    freeSessionsLeft: Number(data.free_sessions_left ?? 0),
    shareBonusAvailable: Boolean(data.share_bonus_available),
    windowResetsAt: data.window_resets_at ? String(data.window_resets_at) : null
  };
}

export async function claimShareBonus(): Promise<ShareBonusResult> {
  const supabase = getSupabaseClient();
  const browserToken = ensureBrowserToken();
  const { data, error } = await supabase
    .rpc("claim_share_bonus_guarded", {
      p_browser_token: browserToken
    })
    .single<Record<string, unknown>>();

  if (error || !data) {
    throw new Error(error?.message || "Unable to claim share bonus.");
  }

  return {
    granted: Boolean(data.granted),
    reason: String(data.reason ?? ""),
    shareBonusAvailable: Boolean(data.share_bonus_available),
    freeSessionsLeft: Number(data.free_sessions_left ?? 0),
    windowResetsAt: data.window_resets_at ? String(data.window_resets_at) : null
  };
}

export async function startCheckout(returnTo?: string, plan: CheckoutPlan = "4h"): Promise<{ checkoutUrl: string }> {
  const supabase = getSupabaseClient();
  const browserToken = ensureBrowserToken();
  const { data, error } = await supabase.functions.invoke("start-checkout", {
    body: {
      browserToken,
      returnTo: returnTo || window.location.href,
      plan
    }
  });

  if (error) {
    throw new Error(error.message || "Unable to start checkout.");
  }

  const url = String((data as { checkoutUrl?: string } | null)?.checkoutUrl || "");
  if (!url) {
    throw new Error("Missing checkout URL.");
  }
  return { checkoutUrl: url };
}

export async function requestPaymentHelp(reason: PaymentHelpReason, note: string): Promise<{ granted: boolean; message: string }> {
  const supabase = getSupabaseClient();
  const browserToken = ensureBrowserToken();
  const { data, error } = await supabase.functions.invoke("payment-help", {
    body: {
      browserToken,
      reason,
      note
    }
  });

  if (error) {
    throw new Error(error.message || "Unable to submit payment help request.");
  }

  return {
    granted: Boolean((data as { granted?: boolean } | null)?.granted),
    message: String((data as { message?: string } | null)?.message || "Request received.")
  };
}

export async function confirmCheckoutSession(sessionId: string): Promise<{ confirmed: boolean; applied: boolean; reason?: string }> {
  const supabase = getSupabaseClient();
  const browserToken = ensureBrowserToken();
  const { data, error } = await supabase.functions.invoke("confirm-checkout", {
    body: {
      browserToken,
      sessionId
    }
  });

  if (error) {
    throw new Error(error.message || "Unable to confirm checkout.");
  }

  const result = data as { confirmed?: boolean; applied?: boolean; reason?: string } | null;
  return {
    confirmed: Boolean(result?.confirmed),
    applied: Boolean(result?.applied),
    reason: result?.reason
  };
}
