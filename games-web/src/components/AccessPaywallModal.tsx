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

  const title = useMemo(() => {
    if (state?.paidUnlockActive) {
      return "Unlimited play active 🔓";
    }
    if ((state?.freeSessionsLeft || 0) > 0 || state?.shareBonusAvailable) {
      return "Unlock unlimited play for 4h 🔓, $1 AUD";
    }
    return "Keep playing";
  }, [state?.paidUnlockActive]);
  const freeLeft = state?.freeSessionsLeft ?? 0;
  const freeLabel = `${freeLeft} free session${freeLeft === 1 ? "" : "s"} remaining.`;

  async function handleCheckout() {
    setBusy(true);
    setErrorText("");
    try {
      const { checkoutUrl } = await startCheckout(window.location.href);
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
            You can play unlimited sessions for the next {formatRemaining(state.windowSecondsLeft)}, on this browser/device only.
          </p>
        ) : (state?.freeSessionsLeft || 0) > 0 || state?.shareBonusAvailable ? (
          <p className="body-text small">
            You have {freeLabel} Unlock unlimited sessions (play) for 4h, $1 AUD.
          </p>
        ) : (
          <p className="body-text small">
            You have {freeLabel} Unlock unlimited sessions (play) for 4h, $1 AUD.
          </p>
        )}

        {!state?.paidUnlockActive && (
          <>
            <button className="btn btn-key" type="button" onClick={() => void handleCheckout()} disabled={busy}>
              {busy ? "Loading..." : "Unlimited play for 4h 🔓"}
            </button>

            {state?.shareBonusAvailable && (
              <>
                <button className="btn btn-soft" type="button" onClick={() => void handleShare()} disabled={busy}>
                🎁 Share for +1 session (free)
                </button>
                {shareStep === "waiting" && <p className="body-text small">Checking share authenticity...</p>}
                {shareStep === "confirm" && <p className="body-text small">Are you sure you share the site with a friend?</p>}
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

        <button className="btn btn-soft" type="button" onClick={onClose} disabled={busy}>
          Maybe later
        </button>

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
