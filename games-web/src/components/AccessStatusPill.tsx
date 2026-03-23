import { useEffect, useMemo, useState } from "react";
import AccessPaywallModal from "./AccessPaywallModal";
import { getAccessState, type AccessState } from "../lib/accessApi";

function formatTimeLeft(endIso: string | null, nowMs: number): string {
  if (!endIso) {
    return "0h 0m";
  }
  const diff = Math.max(0, Math.floor((new Date(endIso).getTime() - nowMs) / 1000));
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

type AccessStatusPillProps = {
  hidden?: boolean;
};

export default function AccessStatusPill({ hidden = false }: AccessStatusPillProps) {
  const [state, setState] = useState<AccessState | null>(null);
  const [errorText, setErrorText] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const refresh = async () => {
    try {
      const next = await getAccessState();
      setState(next);
      setErrorText("");
    } catch (error) {
      setErrorText((error as Error).message || "Unable to load access.");
    }
  };

  useEffect(() => {
    if (hidden) {
      return;
    }
    void refresh();

    const tick = window.setInterval(() => setNowMs(Date.now()), 30_000);
    const poll = window.setInterval(() => {
      void refresh();
    }, 300_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [hidden]);

  const statusText = useMemo(() => {
    if (!state) {
      return "Checking access...";
    }
    if (state.paidUnlockActive) {
      return `Unlimited play 🔓: ${formatTimeLeft(state.paidUnlockExpiresAt, nowMs)} left`;
    }
    if (state.freeSessionsLeft > 0) {
      return `Play free +${state.freeSessionsLeft} 🎉`;
    }
    if (state.shareBonusAvailable) {
      return "Free plays used";
    }
    return "Free plays used, 4h unlimited $1.00 USD";
  }, [state, nowMs]);

  if (hidden) {
    return null;
  }

  return (
    <>
      <div className="access-pill-wrap">
        <div className="access-pill">
          <p className="access-pill-text">{statusText}</p>
          <div className="access-pill-actions">
            {state?.shareBonusAvailable && !state.paidUnlockActive && (
              <button className="btn btn-soft access-pill-btn" type="button" onClick={() => setShowModal(true)}>
               🎁 Share +2 plays
              </button>
            )}
            {!state?.paidUnlockActive && (
              <button className="btn btn-key access-pill-btn" type="button" onClick={() => setShowModal(true)}>
                Unlimited 🔓
              </button>
            )}
            {state?.paidUnlockActive && (
              <button className="btn btn-soft access-pill-btn" type="button" onClick={() => setShowModal(true)}>
                Unlocked 🔓
              </button>
            )}
          </div>
        </div>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </div>

      <AccessPaywallModal
        open={showModal}
        state={state}
        onClose={() => setShowModal(false)}
        onRefreshState={refresh}
        onUnlocked={async () => {
          await refresh();
        }}
      />
    </>
  );
}
