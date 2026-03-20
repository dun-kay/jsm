import { useEffect, useMemo, useState } from "react";
import {
  claimShareBonus,
  requestPaymentHelp,
  startCheckout,
  type AccessState,
  type PaymentHelpReason
} from "../lib/accessApi";

type AccessPaywallModalProps = {
  open: boolean;
  state: AccessState | null;
  onClose: () => void;
  onRefreshState: () => Promise<void>;
  onUnlocked: () => void;
};

type ShareStep = "idle" | "waiting" | "confirm";

const HELP_REASONS: Array<{ value: PaymentHelpReason; label: string }> = [
  { value: "i_paid_but_didnt_unlock", label: "I paid but didn't unlock" },
  { value: "payment_failed", label: "Payment failed" },
  { value: "i_was_charged_twice", label: "I was charged twice" },
  { value: "checkout_closed", label: "Checkout closed" },
  { value: "something_else", label: "Something else" }
];

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpReason, setHelpReason] = useState<PaymentHelpReason>("i_paid_but_didnt_unlock");
  const [helpNote, setHelpNote] = useState("");
  const [helpMessage, setHelpMessage] = useState("");

  useEffect(() => {
    if (!open) {
      setErrorText("");
      setBusy(false);
      setShareStep("idle");
      setShowShareConfirmButtons(false);
      setHelpOpen(false);
      setHelpMessage("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || shareStep !== "waiting") {
      return;
    }
    const first = window.setTimeout(() => setShareStep("confirm"), 10_000);
    const second = window.setTimeout(() => setShowShareConfirmButtons(true), 20_000);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [open, shareStep]);

  const title = useMemo(() => {
    if (state?.paidUnlockActive) {
      return "Unlimited play active";
    }
    return "Keep playing";
  }, [state?.paidUnlockActive]);

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

  async function submitPaymentHelp() {
    setBusy(true);
    setErrorText("");
    setHelpMessage("");
    try {
      const result = await requestPaymentHelp(helpReason, helpNote);
      setHelpMessage(result.message);
      await onRefreshState();
      if (result.granted) {
        onUnlocked();
      }
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit payment help request.");
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
            You can play unlimited sessions for the next {formatRemaining(state.windowSecondsLeft)} in this browser.
          </p>
        ) : (
          <p className="body-text small">
            You have used your free sessions for now. Unlock unlimited sessions for 4 hours for $1 AUD.
          </p>
        )}

        {!state?.paidUnlockActive && (
          <>
            <button className="btn btn-key" type="button" onClick={() => void handleCheckout()} disabled={busy}>
              {busy ? "Loading..." : "Unlock now"}
            </button>

            {state?.shareBonusAvailable && (
              <>
                <button className="btn btn-soft" type="button" onClick={() => void handleShare()} disabled={busy}>
                  Share for 1 extra free session
                </button>
                {shareStep === "waiting" && <p className="body-text small">Checking share flow...</p>}
                {shareStep === "confirm" && <p className="body-text small">Did you share the site?</p>}
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
          Not now
        </button>

        <button className="btn btn-soft" type="button" onClick={() => setHelpOpen((old) => !old)} disabled={busy}>
          Payment didn't work?
        </button>

        {helpOpen && (
          <div className="runtime-list">
            <select
              className="input-pill"
              value={helpReason}
              onChange={(event) => setHelpReason(event.target.value as PaymentHelpReason)}
            >
              {HELP_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
            <input
              className="input-pill"
              type="text"
              value={helpNote}
              onChange={(event) => setHelpNote(event.target.value.slice(0, 200))}
              placeholder="Tell us what happened (optional)"
            />
            <button className="btn btn-key" type="button" onClick={() => void submitPaymentHelp()} disabled={busy}>
              Submit help request
            </button>
            {helpMessage && <p className="body-text small">{helpMessage}</p>}
          </div>
        )}

        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </div>
    </div>
  );
}
