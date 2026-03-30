import { useEffect, useMemo, useState } from "react";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";
import {
  continueNeverEver,
  getNeverEverState,
  initNeverEver,
  playAgainNeverEver,
  submitNeverEverVote,
  type NeverEverChoice,
  type NeverEverState
} from "../../lib/neverEverApi";
import { getGameIntroRules } from "../rules";
import cardPool from "./cardPool.json";

type NeverEverRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

const CHOICES: NeverEverChoice[] = ["Again", "Never again", "Maybe?", "Never ever"];

function flattenCardPool(pool: unknown): string[] {
  if (Array.isArray(pool)) {
    return pool.map(String).filter((v) => v.trim().length > 0);
  }
  if (pool && typeof pool === "object") {
    const categories = (pool as { categories?: Array<{ cards?: unknown[] }> }).categories;
    if (Array.isArray(categories)) {
      return categories
        .flatMap((c) => (Array.isArray(c.cards) ? c.cards : []))
        .map(String)
        .filter((v) => v.trim().length > 0);
    }
  }
  return [];
}

function playerName(state: NeverEverState, playerId: string | null): string {
  if (!playerId) return "";
  return state.players.find((p) => p.id === playerId)?.name || "";
}

export default function NeverEverRuntime({ gameCode, playerToken }: NeverEverRuntimeProps) {
  const introRules = getGameIntroRules("never-ever");
  const combinedCardPool = useMemo(() => flattenCardPool(cardPool), []);
  const [state, setState] = useState<NeverEverState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [rulesPaywallPrimed, setRulesPaywallPrimed] = useState<boolean>(false);
  const {
    accessState,
    showPaywall,
    setShowPaywall,
    accessError,
    setAccessError,
    refreshAccessState,
    ensureSessionAccess,
    primePaywallIfExhausted
  } = usePlayAccess();

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const next = await initNeverEver(gameCode, playerToken, combinedCardPool);
        if (!active) return;
        setState(next);
        setErrorText("");
      } catch (error) {
        if (!active) return;
        const message = ((error as Error).message || "").toLowerCase();
        if (message.includes("host must initialize")) {
          try {
            const next = await initNeverEver(gameCode, playerToken, null);
            if (!active) return;
            setState(next);
            setErrorText("");
          } catch (inner) {
            if (!active) return;
            setErrorText((inner as Error).message || "Failed to load game runtime.");
          }
          return;
        }
        setErrorText((error as Error).message || "Failed to load game runtime.");
      }
    };

    void bootstrap();
    const interval = window.setInterval(async () => {
      try {
        const next = await getNeverEverState(gameCode, playerToken);
        if (!active) return;
        setState(next);
      } catch {
        // keep state on transient poll failures
      }
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameCode, playerToken, combinedCardPool]);

  useEffect(() => {
    if (!state) return;
    if (state.phase !== "rules") {
      setRulesPaywallPrimed(false);
      return;
    }
    if (rulesPaywallPrimed) return;
    setRulesPaywallPrimed(true);
    void primePaywallIfExhausted().catch((error) => {
      setAccessError((error as Error).message || "Unable to load play access.");
    });
  }, [state?.phase, state, rulesPaywallPrimed, primePaywallIfExhausted, setAccessError]);

  const myId = state?.you.id || "";
  const isReader = Boolean(state?.currentReaderId && state.currentReaderId === myId);
  const isWaitingOnYou = Boolean(state?.waitingOn.includes(myId));
  const selectedChoice = state?.votes?.[myId] || null;
  const isCalledOut = Boolean(state?.calledOut.includes(myId));
  const activeName = state ? playerName(state, state.currentReaderId) : "";
  const isHungVote = (state?.calledOutOption || "").toLowerCase().includes("hung vote");

  async function doContinue() {
    if (!state || busy || !isWaitingOnYou) return;

    if (state.phase === "rules") {
      try {
        const ok = await ensureSessionAccess(gameCode);
        if (!ok) return;
      } catch (error) {
        setAccessError((error as Error).message || "Unable to validate play access.");
        return;
      }
    }

    setBusy(true);
    setErrorText("");
    try {
      const next = await continueNeverEver(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function doVote(choice: NeverEverChoice) {
    if (!state || busy || state.phase !== "vote" || selectedChoice) return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitNeverEverVote(gameCode, playerToken, choice);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit vote.");
    } finally {
      setBusy(false);
    }
  }

  async function doPlayAgain() {
    if (!state || busy || !state.you.isHost) return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await playAgainNeverEver(gameCode, playerToken, combinedCardPool);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to start another game.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="runtime-card">
        <h2>Never Ever</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  return (
    <section className="runtime-card runtime-flow">
      {state.phase === "rules" && (
        <>
          <h2>{introRules.title}</h2>
          <div className="rules-modal-content">{introRules.content}</div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "card_reveal" && (
        <>
          {isReader ? (
            <>
              <p>Read your card out loud:</p>
              <h2>{state.currentCard || "..."}</h2><p></p>
              <p>Everyone votes next...</p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
                {busy ? "Loading..." : "Done"}
              </button>
            </>
          ) : (
            <>
              <h2>{activeName} is reading the card...</h2><p></p>
              <p>Listen and be ready to vote if <u>you</u> would do it:<p></p>Again, never again, maybe?, or never ever.</p>
            </>
          )}
        </>
      )}

      {state.phase === "vote" && (
        <>
          <h2>{state.currentCard || "..."}</h2>
          <p>Choose your answer, would <u>you</u> do the above:</p>
          <p></p>
          <div className="runtime-list">
            {CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                className={selectedChoice === choice ? "btn btn-key" : "btn btn-soft"}
                onClick={() => void doVote(choice)}
                disabled={busy || Boolean(selectedChoice)}
              >
                {choice}
              </button>
            ))}
          </div>
          {selectedChoice && <p className="hint-text nb">You selected: {selectedChoice}...</p>}
        </>
      )}

      {state.phase === "callout" && (
        <>
          <h2>Who's the odd one out?</h2>
          <p></p>
          <p>{state.currentCard || "..."}</p>
          <p><b>{state.calledOutOption || "N/A"}</b></p>
          <p></p>
          <div className="player-grid teams mc">
            {isHungVote ? (
              <div className="player-pill team">Hung vote</div>
            ) : (
              state.calledOut.map((id) => (
                <div key={id} className="player-pill team">
                  {playerName(state, id)}
                </div>
              ))
            )}
          </div>
          {isCalledOut ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : "Continue"}
            </button>
          ) : (
            <p className="hint-text nb">Click continue/serve a penalty...</p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>Never Ever results</h2>
          <p>Most called-out players this game:</p>
          <p></p>
          <div className="player-grid teams mc">
            {state.players
              .slice()
              .sort((a, b) => b.calloutCount - a.calloutCount)
              .map((p) => (
                <div key={p.id} className="player-pill team">
                  {p.name}: {p.calloutCount} callouts
                </div>
              ))}
          </div>
          {state.you.isHost ? (
            <button type="button" className="btn btn-key" onClick={() => void doPlayAgain()} disabled={busy}>
              Play again
            </button>
          ) : (
            <button type="button" className="btn btn-key" disabled>
              Ask the host to play again
            </button>
          )}
        </>
      )}

      {(state.lastError || errorText || accessError) && (
        <p className="hint-text error-text">{state.lastError || errorText || accessError}</p>
      )}

      <AccessPaywallModal
        open={showPaywall}
        state={accessState}
        onClose={() => setShowPaywall(false)}
        onRefreshState={refreshAccessState}
        onUnlocked={() => setShowPaywall(false)}
      />
    </section>
  );
}
