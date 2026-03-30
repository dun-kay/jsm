import { useEffect, useState } from "react";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";
import {
  continueNeverEver,
  getNeverEverState,
  initNeverEver,
  playAgainNeverEver,
  rerollNeverEverCategory,
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

function playerName(state: NeverEverState, playerId: string | null): string {
  if (!playerId) return "";
  return state.players.find((p) => p.id === playerId)?.name || "";
}

export default function NeverEverRuntime({ gameCode, playerToken }: NeverEverRuntimeProps) {
  const introRules = getGameIntroRules("never-ever");
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
        const next = await initNeverEver(gameCode, playerToken, cardPool);
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
  }, [gameCode, playerToken]);

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
      const next = await playAgainNeverEver(gameCode, playerToken, cardPool);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to start another game.");
    } finally {
      setBusy(false);
    }
  }

  async function doRerollCategory() {
    if (!state || busy || !state.you.isHost || state.phase !== "round_intro" || state.turnIndex !== 0) return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await rerollNeverEverCategory(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to re-spin category.");
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

      {state.phase === "round_intro" && (
        <>
          <h2>Round {state.roundNumber}</h2>
          <p>Category: <b>{state.selectedCategory || "Loading..."}</b></p>
          {state.you.isHost && state.turnIndex === 0 ? (
            <button type="button" className="btn btn-soft runtime-reroll-btn" onClick={() => void doRerollCategory()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : "Re-spin category"}
            </button>
          ) : state.turnIndex === 0 ? (
            <button type="button" className="btn btn-soft runtime-reroll-btn">Ask the host to re-spin</button>
          ) : null}
          <p>9 cards this round. Read the card out loud, then everyone votes.</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "card_reveal" && (
        <>
          {isReader ? (
            <>
              <p>Your card:</p>
              <h2>{state.currentCard || "..."}</h2>
              <p>Read this out loud to everyone.</p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
                {busy ? "Loading..." : "Done reading"}
              </button>
            </>
          ) : (
            <>
              <h2>{activeName} is reading the card...</h2>
              <p>Listen and get ready to vote.</p>
            </>
          )}
        </>
      )}

      {state.phase === "vote" && (
        <>
          <p><b>{activeName} reads:</b></p>
          <h2>{state.currentCard || "..."}</h2>
          <p>Choose your answer:</p>
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
          {selectedChoice && <p className="hint-text nb">You selected {selectedChoice}, waiting...</p>}
        </>
      )}

      {state.phase === "callout" && (
        <>
          <h2>Called out...</h2>
          <p><b>{state.currentCard || "..."}</b></p>
          <p>Least-selected answer used: <b>{state.calledOutOption || "N/A"}</b></p>
          <div className="player-grid teams">
            {state.calledOut.map((id) => (
              <div key={id} className="player-pill team">
                {playerName(state, id)}: {state.votes[id]}
              </div>
            ))}
          </div>
          {isCalledOut ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : "Continue"}
            </button>
          ) : (
            <p className="hint-text nb">Waiting for a called-out player to continue...</p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>Never Ever results</h2>
          <p>Most called-out players this game:</p>
          <div className="player-grid teams">
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
