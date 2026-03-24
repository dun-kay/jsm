import { useEffect, useMemo, useState } from "react";
import {
  claimShareBonus,
  startCheckout,
  type AccessState
} from "../lib/accessApi";

type AccessPaywallModalProps = {
  open: boolean;
  state: AccessState | null;
  onClose: () => void;
  onRefreshState: () => Promise<void>;
  onUnlocked: () => void;
};

type ShareStep = "idle" | "waiting" | "confirm";

function formatRemaining(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatRemainingFromIso(endIso: string | null, nowMs: number): string {
  if (!endIso) {
    return "0h 0m";
  }
  const diff = Math.max(0, Math.floor((new Date(endIso).getTime() - nowMs) / 1000));
  return formatRemaining(diff);
}

export default function AccessPaywallModal({
  open,
  state,
  onClose,
  onRefreshState,
  onUnlocked
}: AccessPaywallModalProps) {
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [shareStep, setShareStep] = useState<ShareStep>("idle");
  const [showShareConfirmButtons, setShowShareConfirmButtons] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!open) {
      setErrorText("");
      setBusy(false);
      setShareStep("idle");
      setShowShareConfirmButtons(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || shareStep !== "waiting") {
      return;
    }
    const first = window.setTimeout(() => {
      setShareStep("confirm");
      setShowShareConfirmButtons(true);
    }, 7_000);
    return () => {
      window.clearTimeout(first);
    };
  }, [open, shareStep]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const tick = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, [open]);

  const title = useMemo(() => {
    if (state?.paidUnlockActive) {
      return "Unlimited play active 🔓";
    }
    if ((state?.freeSessionsLeft || 0) > 0 || state?.shareBonusAvailable) {
      return "Share the site with a friend for +2 free sessions 🎁";
    }
    return "Unlock unlimited to continue, from $1.00 🔓";
  }, [state?.paidUnlockActive]);
  const freeLeft = state?.freeSessionsLeft ?? 0;
  const freeLabel = `${freeLeft} free session${freeLeft === 1 ? "" : "s"} remaining.`;

  async function handleCheckout(plan: "4h" | "30d") {
    setBusy(true);
    setErrorText("");
    try {
      const { checkoutUrl } = await startCheckout(window.location.href, plan);
      window.location.assign(checkoutUrl);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to start checkout.");
      setBusy(false);
    }
  }

  async function handleShare() {
    setBusy(true);
    setErrorText("");
    try {
      const text = "Join me on Games With Friends";
      const url = window.location.origin;
      if (navigator.share) {
        await navigator.share({ title: "Games With Friends", text, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setShareStep("waiting");
    } catch (error) {
      setErrorText((error as Error).message || "Share action cancelled.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmShare(claimed: boolean) {
    if (!claimed) {
      setShareStep("idle");
      setShowShareConfirmButtons(false);
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      await claimShareBonus();
      await onRefreshState();
      onUnlocked();
      onClose();
    } catch (error) {
      setErrorText((error as Error).message || "Unable to claim bonus session.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>{title}</h2>
        {state?.paidUnlockActive ? (
          <p className="body-text small">
            You can play unlimited sessions for the next {formatRemainingFromIso(state.paidUnlockExpiresAt, nowMs)}, on this browser/device.
          </p>
        ) : (state?.freeSessionsLeft || 0) > 0 || state?.shareBonusAvailable ? (
          <p className="body-text tiny">
            You have {freeLabel} <b>Unlock unlimited sessions/play below.</b> <p className="tiny"><i>For the share bonus to work, you must copy & share the link with a friend or to a social account.</i></p>
          </p>
        ) : (
          <p className="body-text small">
            You have {freeLabel} <b>Unlock unlimited sessions/play. 4h for $1.00 USD or 30 days for $6.00 USD.</b>
          </p>
        )}

        {state && !state.paidUnlockActive && (
          <>
            <button className="btn btn-key tiny" type="button" onClick={() => void handleCheckout("4h")} disabled={busy}>
              {busy ? "Loading..." : "Unlimited for 4h, $1.00 🔓"}
            </button>

            <button className="btn btn-key tiny" type="button" onClick={() => void handleCheckout("30d")} disabled={busy}>
              {busy ? "Loading..." : " Unlimited for 30 days, $6.00 🔓"}
            </button>
            {state?.shareBonusAvailable && (
              <>
                <button className="btn btn-soft tiny" type="button" onClick={() => void handleShare()} disabled={busy}>
                🎁 Share for +2 sessions (free)
                </button>
                {shareStep === "waiting" && <p className="body-text small">Checking share authenticity...</p>}
                {shareStep === "confirm" && <p className="body-text small">Did you share it with a friend?</p>}
                {showShareConfirmButtons && (
                  <div className="bottom-row">
                    <button className="btn btn-key" type="button" onClick={() => void confirmShare(true)} disabled={busy}>
                      Yes
                    </button>
                    <button className="btn btn-soft" type="button" onClick={() => void confirmShare(false)} disabled={busy}>
                      No
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        <button className="btn btn-soft tiny" type="button" onClick={onClose} disabled={busy}>
          Back
        </button>
        <p className="tiny"><i>Disclaimer: Access is tied to this browser type/device via local storage. If you clear cookies/local storage, use private mode, or switch browser types/devices, access may be lost. By continuing you accept this and understand it is not grounds for a refund. Issues, contact support.</i></p>
        <div className="footer-links-inline">
          <a href="https://tally.so/r/XxqNzP" target="_blank" rel="noreferrer">
            Support
          </a>
          <a href="/terms/">Terms</a>
          <a href="/how-unlimited-works/">How unlimited works</a>
        </div>

        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </div>
    </div>
  );
}

