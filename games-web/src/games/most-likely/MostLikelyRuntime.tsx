import { useEffect, useMemo, useState } from "react";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";
import {
  continueMostLikely,
  getMostLikelyState,
  initMostLikely,
  playAgainMostLikely,
  submitMostLikelyGroupVote,
  submitMostLikelyPairVote,
  type MostLikelyPairChoice,
  type MostLikelyState
} from "../../lib/mostLikelyApi";
import { getGameIntroRules } from "../rules";
import cardPool from "./cardPool.json";

type MostLikelyRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

function playerName(state: MostLikelyState, playerId: string | null): string {
  if (!playerId) return "";
  return state.players.find((p) => p.id === playerId)?.name || "";
}

function flattenCardPool(pool: unknown): string[] {
  if (Array.isArray(pool)) {
    return pool.map(String).filter((v) => v.trim().length > 0);
  }
  if (pool && typeof pool === "object") {
    const cards = (pool as { cards?: unknown[] }).cards;
    if (Array.isArray(cards)) {
      return cards.map(String).filter((v) => v.trim().length > 0);
    }
  }
  return [];
}

export default function MostLikelyRuntime({ gameCode, playerToken }: MostLikelyRuntimeProps) {
  const introRules = getGameIntroRules("most-likely");
  const combinedCardPool = useMemo(() => flattenCardPool(cardPool), []);
  const [state, setState] = useState<MostLikelyState | null>(null);
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
        const next = await initMostLikely(gameCode, playerToken, combinedCardPool);
        if (!active) return;
        setState(next);
        setErrorText("");
      } catch (error) {
        if (!active) return;
        const message = ((error as Error).message || "").toLowerCase();
        if (message.includes("host must initialize")) {
          try {
            const next = await initMostLikely(gameCode, playerToken, null);
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
        const next = await getMostLikelyState(gameCode, playerToken);
        if (!active) return;
        setState(next);
      } catch {
        // transient poll failure
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
  const isWaitingOnYou = Boolean(state?.waitingOn.includes(myId));
  const isReader = Boolean(state?.currentReaderId === myId);
  const isPairPlayer = Boolean(myId && (myId === state?.pairPlayerAId || myId === state?.pairPlayerBId));
  const activeName = state ? playerName(state, state.currentReaderId) : "";
  const pairAName = state ? playerName(state, state.pairPlayerAId) : "";
  const pairBName = state ? playerName(state, state.pairPlayerBId) : "";
  const proposedWinnerName = state ? playerName(state, state.proposedWinnerId) : "";
  const myPairVote = state?.pairVotes?.[myId] || "";
  const myGroupVote = state?.groupVotes?.[myId] || "";

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
      const next = await continueMostLikely(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function doPairVote(choice: MostLikelyPairChoice) {
    if (!state || busy || state.phase !== "pair_vote" || !isPairPlayer || myPairVote) return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitMostLikelyPairVote(gameCode, playerToken, choice);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit pair vote.");
    } finally {
      setBusy(false);
    }
  }

  async function doGroupVote(choice: string) {
    if (!state || busy || state.phase !== "group_vote" || !isWaitingOnYou || myGroupVote) return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitMostLikelyGroupVote(gameCode, playerToken, choice);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit group vote.");
    } finally {
      setBusy(false);
    }
  }

  async function doPlayAgain() {
    if (!state || busy || !state.you.isHost) return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await playAgainMostLikely(gameCode, playerToken, combinedCardPool);
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
        <h2>Most Likely</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  const groupVoterCount = state.players.filter((p) => p.id !== state.pairPlayerAId && p.id !== state.pairPlayerBId).length;

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
              <p>Read this card out loud:</p>
              <h2>{state.currentCard || "..."}</h2>
              <p>{pairAName} vs {pairBName}</p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
                {busy ? "Loading..." : "Done reading"}
              </button>
            </>
          ) : (
            <>
              <h2>{activeName} is reading...</h2>
              <p>{pairAName} and {pairBName} vote next.</p>
            </>
          )}
        </>
      )}

      {state.phase === "pair_vote" && (
        <>
          <h2>{state.currentCard || "..."}</h2>
          <p><b>{pairAName}</b> and <b>{pairBName}</b>: Who is most likely to?</p>
          {isPairPlayer ? (
            <>
              <div className="runtime-list">
                <button
                  type="button"
                  className={myPairVote === "me" ? "btn btn-key" : "btn btn-soft"}
                  onClick={() => void doPairVote("me")}
                  disabled={busy || Boolean(myPairVote)}
                >
                  Me
                </button>
                <button
                  type="button"
                  className={myPairVote === "them" ? "btn btn-key" : "btn btn-soft"}
                  onClick={() => void doPairVote("them")}
                  disabled={busy || Boolean(myPairVote)}
                >
                  Them
                </button>
              </div>
              {myPairVote && <p className="hint-text nb">You selected {myPairVote}.</p>}
            </>
          ) : (
            <p className="hint-text nb">Waiting for {pairAName} and {pairBName} to vote...</p>
          )}
        </>
      )}

      {state.phase === "group_vote" && (
        <>
          <h2>Group validate</h2>
          <p><b>{state.currentCard || "..."}</b></p>
          {state.groupMode === "consensus" ? (
            <p>
              {pairAName} and {pairBName} both picked <b>{proposedWinnerName}</b>.  
              Agree or disagree?
            </p>
          ) : (
            <p>
              {pairAName} and {pairBName} could not agree.  
              Who is most likely to?
            </p>
          )}
          {isWaitingOnYou ? (
            <div className="runtime-list">
              {state.groupMode === "consensus" ? (
                <>
                  <button
                    type="button"
                    className={myGroupVote === "agree" ? "btn btn-key" : "btn btn-soft"}
                    onClick={() => void doGroupVote("agree")}
                    disabled={busy || Boolean(myGroupVote)}
                  >
                    Agree
                  </button>
                  <button
                    type="button"
                    className={myGroupVote === "disagree" ? "btn btn-key" : "btn btn-soft"}
                    onClick={() => void doGroupVote("disagree")}
                    disabled={busy || Boolean(myGroupVote)}
                  >
                    Disagree
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={myGroupVote === state.pairPlayerAId ? "btn btn-key" : "btn btn-soft"}
                    onClick={() => void doGroupVote(state.pairPlayerAId || "")}
                    disabled={busy || Boolean(myGroupVote)}
                  >
                    {pairAName}
                  </button>
                  <button
                    type="button"
                    className={myGroupVote === state.pairPlayerBId ? "btn btn-key" : "btn btn-soft"}
                    onClick={() => void doGroupVote(state.pairPlayerBId || "")}
                    disabled={busy || Boolean(myGroupVote)}
                  >
                    {pairBName}
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="hint-text nb">Waiting for group votes ({groupVoterCount})...</p>
          )}
          {myGroupVote && <p className="hint-text nb">You selected: {myGroupVote}.</p>}
        </>
      )}

      {state.phase === "turn_result" && (
        <>
          <h2>Penalty result</h2>
          <p><b>{state.currentCard || "..."}</b></p>
          <div className="player-grid teams mc">
            {state.winnerIds.map((id) => (
              <div key={id} className="player-pill team">
                {playerName(state, id)}
              </div>
            ))}
          </div>
          {isWaitingOnYou ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : "Continue"}
            </button>
          ) : (
            <p className="hint-text nb">Waiting for winner to continue...</p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>Most Likely results</h2>
          <p>Who served the most penalties:</p>
          <div className="player-grid teams mc">
            {state.players
              .slice()
              .sort((a, b) => b.penaltyCount - a.penaltyCount)
              .map((p) => (
                <div key={p.id} className="player-pill team">
                  {p.name}: {p.penaltyCount}
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

