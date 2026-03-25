import { useEffect, useMemo, useState } from "react";
import {
  confirmLyingLlamaPenalty,
  continueLyingLlama,
  decideCharlatan,
  getLyingLlamaState,
  initLyingLlama,
  pickLyingLlamaAnimal,
  playAgainLyingLlama,
  submitLyingLlamaTargetResponse,
  voteLyingLlamaBattleWinner,
  type LyingLlamaState
} from "../../lib/lyingLlamaApi";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";

type LyingLlamaRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

const ANIMALS = ["Crazy Llama", "Poison Dart Frog", "Mountain Gorilla"] as const;

function displayAnimal(animal: string | null | undefined): string {
  if (!animal) {
    return "";
  }
  if (animal === "Crazy Llama") {
    return "Crazy Llama 🦙";
  }
  if (animal === "Poison Dart Frog") {
    return "Poison Dart Frog 🐸";
  }
  if (animal === "Mountain Gorilla") {
    return "🦍";
  }
  return animal;
}

function isWaitingOnYou(state: LyingLlamaState): boolean {
  return state.waitingOn.includes(state.you.id);
}

function playerName(state: LyingLlamaState, playerId: string | null): string {
  if (!playerId) {
    return "";
  }
  return state.players.find((p) => p.id === playerId)?.name || "";
}

export default function LyingLlamaRuntime({ gameCode, playerToken }: LyingLlamaRuntimeProps) {
  const [state, setState] = useState<LyingLlamaState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [turnResultSeconds, setTurnResultSeconds] = useState<number>(3);
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
        const next = await initLyingLlama(gameCode, playerToken);
        if (!active) {
          return;
        }
        setState(next);
        setErrorText("");
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText((error as Error).message || "Failed to load game runtime.");
      }
    };

    void bootstrap();

    const interval = window.setInterval(async () => {
      try {
        const next = await getLyingLlamaState(gameCode, playerToken);
        if (!active) {
          return;
        }
        setState(next);
      } catch {
        // keep current state on transient poll failures
      }
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameCode, playerToken]);

  const waitingKey = useMemo(() => (state ? state.waitingOn.join(",") : ""), [state]);

  useEffect(() => {
    if (!state) {
      return;
    }
    if (state.phase !== "rules") {
      setRulesPaywallPrimed(false);
      return;
    }
    if (rulesPaywallPrimed) {
      return;
    }
    setRulesPaywallPrimed(true);
    void primePaywallIfExhausted().catch((error) => {
      setAccessError((error as Error).message || "Unable to load play access.");
    });
  }, [state?.phase, state, rulesPaywallPrimed, primePaywallIfExhausted, setAccessError]);

  useEffect(() => {
    if (!state || state.phase !== "turn_result" || !isWaitingOnYou(state)) {
      setTurnResultSeconds(3);
      return;
    }

    setTurnResultSeconds(3);
    const tickInterval = window.setInterval(() => {
      setTurnResultSeconds((prev) => Math.max(prev - 1, 0));
    }, 1000);

    const advanceTimeout = window.setTimeout(() => {
      void doContinue();
    }, 3000);

    return () => {
      window.clearInterval(tickInterval);
      window.clearTimeout(advanceTimeout);
    };
  }, [state?.phase, waitingKey, state?.you.id]);

  const askerName = useMemo(() => (state ? playerName(state, state.activeAskerId) : ""), [state]);
  const targetName = useMemo(() => (state ? playerName(state, state.activeTargetId) : ""), [state]);

  async function doContinue() {
    if (!state || busy || !isWaitingOnYou(state)) {
      return;
    }
    if (state.phase === "rules") {
      try {
        const ok = await ensureSessionAccess(gameCode);
        if (!ok) {
          return;
        }
      } catch (error) {
        setAccessError((error as Error).message || "Unable to validate play access.");
        return;
      }
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await continueLyingLlama(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function doPickAnimal(animal: string) {
    if (!state || busy || state.activeAskerId !== state.you.id || state.phase !== "turn_prompt") {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await pickLyingLlamaAnimal(gameCode, playerToken, animal);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit animal guess.");
    } finally {
      setBusy(false);
    }
  }

  async function doCharlatanDecision(callCharlatan: boolean) {
    if (!state || busy || state.phase !== "charlatan_call" || state.activeAskerId !== state.you.id) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await decideCharlatan(gameCode, playerToken, callCharlatan);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to confirm charlatan decision.");
    } finally {
      setBusy(false);
    }
  }

  async function doTargetResponse(correctGuess: boolean) {
    if (!state || busy || state.phase !== "target_response" || state.activeTargetId !== state.you.id) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitLyingLlamaTargetResponse(gameCode, playerToken, correctGuess);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to confirm the guess result.");
    } finally {
      setBusy(false);
    }
  }

  async function doPenaltyConfirm(accepted: boolean) {
    if (!state || busy || state.phase !== "penalty_confirm" || state.activeTargetId !== state.you.id) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await confirmLyingLlamaPenalty(gameCode, playerToken, accepted);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to confirm penalty.");
    } finally {
      setBusy(false);
    }
  }

  async function doVoteWinner(winnerId: string) {
    if (!state || busy || state.phase !== "charlatan_vote") {
      return;
    }
    if (state.you.id !== state.activeAskerId && state.you.id !== state.activeTargetId) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await voteLyingLlamaBattleWinner(gameCode, playerToken, winnerId);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit winner vote.");
    } finally {
      setBusy(false);
    }
  }

  async function doPlayAgain() {
    if (!state || busy || !state.you.isHost) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await playAgainLyingLlama(gameCode, playerToken);
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
        <h2>Lying Llama</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  const myBattleVote = state.battleVotes[state.you.id] || null;
  const lastWinnerName = playerName(state, state.lastWinnerId);
  const myTopCard = state.you.stack[0] || null;

  return (
    <section className="runtime-card runtime-flow">
      {state.phase === "rules" && (
        <>
          <h2>You are now playing... Lying Llama</h2>
          <p>Each player has 3 hidden animal cards:</p>
          <p><b>Crazy Llama 🦙, Poison Dart Frog 🐸, 🦍</b></p>
          <p>On your turn, ask the next player: "Are you a [animal]?"</p>
          <p>If you guess correctly, you collect their top card.</p>
          <p>One card per player is Charlatan. If it is on top, they must lie in a weird way.</p>
          <p>Spot it, call Charlatan!, and win the card in a mini challenge.</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "turn_prompt" && (
        <>
          {state.activeAskerId === state.you.id ? (
            <>
              <h2>Your turn</h2>
              <p>Guess {targetName}'s top card.</p>
              <p><b>Make sure you say your guess out loud so everyone can hear you!</b></p>
              <div className="runtime-list">
                {ANIMALS.map((animal) => (
                  <button key={animal} type="button" className="btn btn-soft" onClick={() => void doPickAnimal(animal)} disabled={busy}>
                    {displayAnimal(animal)}
                  </button>
                ))}
              </div>
            </>
          ) : state.activeTargetId === state.you.id ? (
            <p><b>{askerName}</b> is choosing a guess for your top card.</p>
          ) : (
            <p><b>{askerName}</b> is asking <b>{targetName}</b>.</p>
          )}
        </>
      )}

      {state.phase === "target_response" && (
        <>
          {state.activeTargetId === state.you.id ? (
            <>
              <h2>{myTopCard ? `${displayAnimal(myTopCard.animal)}${myTopCard.isCharlatan ? " - Charlatan" : ""}` : "Top card"}</h2>
              <p>{askerName} asked you if your top card is {displayAnimal(state.selectedAnimal)}.</p>
              <p><b>Let them know how they did!</b></p>
              <div className="runtime-list">
                <button type="button" className="btn btn-key" onClick={() => void doTargetResponse(true)} disabled={busy}>
                  Confirm guess (if correct)
                </button>
                <button type="button" className="btn btn-soft" onClick={() => void doTargetResponse(false)} disabled={busy}>
                  Give penalty (if wrong)
                </button>
              </div>
            </>
          ) : state.activeAskerId === state.you.id ? (
            <p>{targetName} is confirming your guess.</p>
          ) : (
            <p>{targetName} is confirming the guess result.</p>
          )}
        </>
      )}

      {state.phase === "charlatan_call" && (
        <>
          {state.activeAskerId === state.you.id ? (
            <>
              <h2>Did you catch a Charlatan?</h2>
              <div className="bottom-row">
                <button type="button" className="btn btn-key" onClick={() => void doCharlatanDecision(true)} disabled={busy}>
                  Charlatan!
                </button>
                <button type="button" className="btn btn-soft" onClick={() => void doCharlatanDecision(false)} disabled={busy}>
                  Let it go
                </button>
              </div>
            </>
          ) : (
            <p>{askerName} is deciding...</p>
          )}
        </>
      )}

      {state.phase === "charlatan_battle" && (
        <>
          <h2>Charlatan battle</h2>
          <p><b>{state.battlePrompt}</b></p>
          {(state.activeAskerId === state.you.id || state.activeTargetId === state.you.id) ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
              {busy ? "Loading..." : isWaitingOnYou(state) ? "Ready" : "Waiting for other player"}
            </button>
          ) : (
            <p>Charlatan battle: {askerName} vs {targetName}</p>
          )}
        </>
      )}

      {state.phase === "charlatan_vote" && (
        <>
          {(state.activeAskerId === state.you.id || state.activeTargetId === state.you.id) ? (
            <>
              <h2>Who won?</h2>
              <div className="bottom-row">
                <button type="button" className="btn btn-soft" onClick={() => void doVoteWinner(state.activeAskerId || "")} disabled={busy || !state.activeAskerId}>
                  {askerName}
                </button>
                <button type="button" className="btn btn-soft" onClick={() => void doVoteWinner(state.activeTargetId || "")} disabled={busy || !state.activeTargetId}>
                  {targetName}
                </button>
              </div>
              {myBattleVote && <p>You voted: {playerName(state, myBattleVote)}</p>}
            </>
          ) : (
            <p>Waiting for Charlatan result...</p>
          )}
        </>
      )}

      {state.phase === "penalty_prompt" && (
        <>
          {state.activeAskerId === state.you.id ? (
            <>
              <h2>Wrong guess</h2>
              <p>You guessed: <b>{displayAnimal(state.penaltyAnimal)}</b></p>
              <p><b>{state.penaltyText}</b></p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
                {busy ? "Loading..." : "I did it"}
              </button>
            </>
          ) : (
            <p>{askerName} is doing their penalty...</p>
          )}
        </>
      )}

      {state.phase === "penalty_confirm" && (
        <>
          {state.activeTargetId === state.you.id ? (
            <>
              <h2>Did they do it properly?</h2>
              <div className="bottom-row">
                <button type="button" className="btn btn-key" onClick={() => void doPenaltyConfirm(true)} disabled={busy}>
                  Yes
                </button>
                <button type="button" className="btn btn-soft" onClick={() => void doPenaltyConfirm(false)} disabled={busy}>
                  Do it again
                </button>
              </div>
            </>
          ) : (
            <p>{targetName} is confirming the penalty.</p>
          )}
        </>
      )}

      {state.phase === "turn_result" && (
        <>
          <h2>Turn result</h2>
          <p>{state.lastOutcomeText || "Turn complete."}</p>
          {state.lastCardWon && <p>Card won: <b>{displayAnimal(state.lastCardWon)}</b></p>}
          {lastWinnerName && <p>Winner: <b>{lastWinnerName}</b></p>}
          <div className="player-grid teams">
            {state.scores.map((row) => (
              <div key={row.playerId} className="player-pill team">
                {row.name}: {row.collectedCount}
              </div>
            ))}
          </div>
          <p>{isWaitingOnYou(state) ? `Continuing in ${turnResultSeconds}...` : "Continuing..."}</p>
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>Game over</h2>
          <p>Most collected cards wins.</p>
          <div className="player-grid teams">
            {state.scores.map((row) => (
              <div key={row.playerId} className="player-pill team">
                {row.name}: {row.collectedCount}
              </div>
            ))}
          </div>
          {state.winnerIds.length > 0 && (
            <p>
              Winner{state.winnerIds.length > 1 ? "s" : ""}:{" "}
              <b>{state.winnerIds.map((id) => playerName(state, id)).join(", ")}</b>
            </p>
          )}
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

