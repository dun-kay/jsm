import { ACQUISITION_TEST_MODE } from "./featureFlags";

export type DrawThingsWallet = {
  freePlays: number;
  paidPlays: number;
  lastRegenAt: number;
};

export type DrawThingsWalletSummary = {
  freePlays: number;
  paidPlays: number;
  totalPlays: number;
  refillInMs: number;
  canBuyPack: boolean;
};

type ConsumeResult = {
  ok: boolean;
  summary: DrawThingsWalletSummary;
  reason?: string;
};

const DRAW_THINGS_WALLET_KEY = "drawthings_wallet_v2";
const DRAW_THINGS_TURN_MARK_PREFIX = "drawthings_turn_mark_";
export const DRAW_THINGS_WALLET_EVENT = "drawthings-wallet-changed";
export const DRAW_THINGS_OPEN_PAYWALL_EVENT = "drawthings-open-paywall";

const FREE_START = 10;
const FREE_REGEN = 5;
const REGEN_MS = 4 * 60 * 60 * 1000;
const UNPAID_FREE_CAP = 10;
const PAID_TOTAL_CAP = 105;
const PAID_PACK_PLAYS = 100;

function nowMs(): number {
  return Date.now();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function legacyToWallet(raw: unknown): DrawThingsWallet | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (!("freeTurns" in row) && !("paidTurns" in row)) {
    return null;
  }
  return {
    freePlays: Number(row.freeTurns ?? FREE_START),
    paidPlays: Number(row.paidTurns ?? 0),
    lastRegenAt: Number(row.lastRegenAt ?? nowMs())
  };
}

function normalize(wallet: DrawThingsWallet): DrawThingsWallet {
  const now = nowMs();
  const safeLastRegenAt = isFiniteNumber(wallet.lastRegenAt) ? wallet.lastRegenAt : now;
  let next: DrawThingsWallet = {
    freePlays: Math.max(0, Math.floor(Number(wallet.freePlays) || 0)),
    paidPlays: Math.max(0, Math.floor(Number(wallet.paidPlays) || 0)),
    lastRegenAt: safeLastRegenAt > now ? now : safeLastRegenAt
  };

  const elapsed = Math.max(0, now - next.lastRegenAt);
  const steps = Math.floor(elapsed / REGEN_MS);
  if (steps > 0) {
    next.freePlays += steps * FREE_REGEN;
    next.lastRegenAt += steps * REGEN_MS;
  }

  const freeCap = next.paidPlays > 0 ? Math.max(0, PAID_TOTAL_CAP - next.paidPlays) : UNPAID_FREE_CAP;
  next.freePlays = Math.min(next.freePlays, freeCap);

  if (next.paidPlays > PAID_PACK_PLAYS) {
    next.paidPlays = PAID_PACK_PLAYS;
  }

  if (next.freePlays + next.paidPlays > PAID_TOTAL_CAP) {
    next.freePlays = Math.max(0, PAID_TOTAL_CAP - next.paidPlays);
  }

  return next;
}

function computeRefillInMs(wallet: DrawThingsWallet): number {
  const now = nowMs();
  const elapsedSinceTick = Math.max(0, now - wallet.lastRegenAt);
  const remainder = elapsedSinceTick % REGEN_MS;
  return remainder === 0 ? REGEN_MS : REGEN_MS - remainder;
}

function summaryFromWallet(wallet: DrawThingsWallet): DrawThingsWalletSummary {
  const normalized = normalize(wallet);
  return {
    freePlays: normalized.freePlays,
    paidPlays: normalized.paidPlays,
    totalPlays: normalized.freePlays + normalized.paidPlays,
    refillInMs: computeRefillInMs(normalized),
    canBuyPack: normalized.paidPlays <= 0
  };
}

function emitWallet(summary: DrawThingsWalletSummary): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(DRAW_THINGS_WALLET_EVENT, { detail: summary }));
}

export function readDrawThingsWallet(): DrawThingsWallet {
  try {
    const raw = window.localStorage.getItem(DRAW_THINGS_WALLET_KEY);
    if (!raw) {
      return normalize({
        freePlays: FREE_START,
        paidPlays: 0,
        lastRegenAt: nowMs()
      });
    }
    const parsed = JSON.parse(raw) as DrawThingsWallet;
    const wallet = normalize(parsed);
    return wallet;
  } catch {
    try {
      const legacyRaw = window.localStorage.getItem("drawwf_turn_wallet_v1");
      if (legacyRaw) {
        const migrated = legacyToWallet(JSON.parse(legacyRaw));
        if (migrated) {
          return normalize(migrated);
        }
      }
    } catch {
      // ignore bad legacy state
    }
    return normalize({
      freePlays: FREE_START,
      paidPlays: 0,
      lastRegenAt: nowMs()
    });
  }
}

export function saveDrawThingsWallet(wallet: DrawThingsWallet): DrawThingsWalletSummary {
  const normalized = normalize(wallet);
  window.localStorage.setItem(DRAW_THINGS_WALLET_KEY, JSON.stringify(normalized));
  const summary = summaryFromWallet(normalized);
  emitWallet(summary);
  return summary;
}

export function getDrawThingsWalletSummary(): DrawThingsWalletSummary {
  const wallet = readDrawThingsWallet();
  return saveDrawThingsWallet(wallet);
}

export function consumeDrawThingsPlay(turnKey: string): ConsumeResult {
  const markKey = `${DRAW_THINGS_TURN_MARK_PREFIX}${turnKey}`;
  if (window.sessionStorage.getItem(markKey) === "1") {
    return { ok: true, summary: getDrawThingsWalletSummary() };
  }

  if (ACQUISITION_TEST_MODE) {
    // Acquisition test mode override:
    // Previous limits were: unpaid cap 10 plays, +5 every 4h regen, paid pack 100 plays, total cap 105.
    // We intentionally bypass consumption and blocking for clean acquisition testing.
    window.sessionStorage.setItem(markKey, "1");
    return { ok: true, summary: getDrawThingsWalletSummary() };
  }

  const wallet = readDrawThingsWallet();
  if (wallet.freePlays > 0) {
    wallet.freePlays -= 1;
  } else if (wallet.paidPlays > 0) {
    wallet.paidPlays -= 1;
  } else {
    const summary = saveDrawThingsWallet(wallet);
    return { ok: false, summary, reason: "no_plays_left" };
  }

  const summary = saveDrawThingsWallet(wallet);
  window.sessionStorage.setItem(markKey, "1");
  return { ok: true, summary };
}

export function applyDrawThingsPurchasePlays(): DrawThingsWalletSummary {
  const wallet = readDrawThingsWallet();
  wallet.paidPlays = PAID_PACK_PLAYS;
  wallet.freePlays = Math.min(wallet.freePlays, PAID_TOTAL_CAP - PAID_PACK_PLAYS);
  return saveDrawThingsWallet(wallet);
}
