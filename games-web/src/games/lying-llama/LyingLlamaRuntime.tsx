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
import { getGameIntroRules } from "../rules";
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
    return "Mountain Gorilla 🦍";
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

function isSameAnimal(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

export default function LyingLlamaRuntime({ gameCode, playerToken }: LyingLlamaRuntimeProps) {
  const [state, setState] = useState<LyingLlamaState | null>(null);
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

  async function doTargetResponse(correctGuess: boolean, charlatanCalled: boolean | null = null) {
    if (!state || busy || state.phase !== "target_response" || state.activeTargetId !== state.you.id) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitLyingLlamaTargetResponse(gameCode, playerToken, correctGuess, charlatanCalled);
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
  const myTopCard = state.you.stack[0] || null;
  const introRules = getGameIntroRules("lying-llama");
  const targetGuessIsCorrect = isSameAnimal(state.selectedAnimal, myTopCard?.animal);

  return (
    <section className="runtime-card runtime-flow">
      {state.phase === "rules" && (
        <>
          <h2>{introRules.title}</h2>
          <div className="rules-modal-content">{introRules.content}</div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "turn_prompt" && (
        <>
          {state.activeAskerId === state.you.id ? (
            <>
              <h2>It's your turn, try guess {targetName}'s card.</h2>
              <p></p>
              <p>Make sure you say your guess out loud so everyone can hear you!</p><p></p>
              <div className="runtime-list">
                {ANIMALS.map((animal) => (
                  <button key={animal} type="button" className="btn btn-soft" onClick={() => void doPickAnimal(animal)} disabled={busy}>
                    {displayAnimal(animal)}
                  </button>
                ))}
              </div>
            </>
          ) : state.activeTargetId === state.you.id ? (
            <div><h2>{askerName} is trying to guess your card.</h2><br></br>
            <p>Your card:<p></p><b><u>{myTopCard ? displayAnimal(myTopCard.animal) : "Unknown"}!</u><p></p></b>{myTopCard?.isCharlatan ? "(Charlaton Card)" : ""} {myTopCard?.isCharlatan && state.charlatanPrompt ? ` - ${state.charlatanPrompt}` : ""}</p>
            </div>
          ) : (
            <div><h2>{askerName} is asking {targetName} about their card.</h2><br></br><p>Listen carefully, it'll help you later to try remember what cards have been guessed.</p><br></br><p><b>If {askerName} makes an incorrect Charlatan guess, it's your job to make sure they apologise.</b></p></div>
          )}
        </>
      )}

      {state.phase === "target_response" && (
        <>
          {state.activeTargetId === state.you.id ? (
            <>
              <h2>{askerName} asked if your card is a {displayAnimal(state.selectedAnimal)}!</h2><br></br>
              <p>Your card:<p></p>
              <b><u>{myTopCard ? displayAnimal(myTopCard.animal) : "Unknown"}!</u></b></p>
              {myTopCard?.isCharlatan && <p>(Charlatan Card)</p>}
              <div className="runtime-list">
                {targetGuessIsCorrect && myTopCard?.isCharlatan ? (
                  <>
                    <br></br><p><b>
                      Your Charlatan action:<p></p></b> {state.charlatanPrompt || "doing your Charlatan action"} <p></p><br></br>Make sure you say:<p></p><b><u>No, I am not a {displayAnimal(state.selectedAnimal)}!</u></b>
                      
                    </p><br></br>
                    <button type="button" className="btn btn-soft" onClick={() => void doTargetResponse(true, false)} disabled={busy}>
                      {askerName} did not call Charlatan
                    </button>
                    <button type="button" className="btn btn-key" onClick={() => void doTargetResponse(true, true)} disabled={busy}>
                      {askerName} called Charlatan
                    </button>
                  </>
                ) : targetGuessIsCorrect ? (
                  <button type="button" className="btn btn-key" onClick={() => void doTargetResponse(true)} disabled={busy}>
                    Yes, I am a {myTopCard ? displayAnimal(myTopCard.animal) : "Unknown"}!
                  </button>
                ) : (
                  <div><br></br>
                  <button type="button" className="btn btn-soft" onClick={() => void doTargetResponse(false)} disabled={busy}>
                    No, I am not a {displayAnimal(state.selectedAnimal)}!
                  </button>
                  <p>Don't say what your card is unless it is guessed correctly.</p>
                  </div>
                )}
              </div>
            </>
          ) : state.activeAskerId === state.you.id ? (
            <div><h2>{targetName} is confirming your guess.</h2><br></br><p><b>Don't forget to watch for their Charlatan action, call them out if you think they're lying!</b></p></div>
          ) : (
            <div><h2>{targetName} is confirming the guess.</h2><br></br><p>Make sure they say it out loud so the whole group can hear.</p></div>
          )}
        </>
      )}

      {state.phase === "charlatan_call" && (
        <>
          {state.activeAskerId === state.you.id ? (
            <>
              <h2>Did you catch a Charlatan?</h2>
              {state.charlatanPrompt && <p><b>Tell used: {state.charlatanPrompt}</b></p>}
              <div className="bottom-row">
                <button type="button" className="btn btn-key" onClick={() => void doCharlatanDecision(true)} disabled={busy}>
                  Charlatan called (start challenge)
                </button>
                <button type="button" className="btn btn-soft" onClick={() => void doCharlatanDecision(false)} disabled={busy}>
                  Charlatan not called (give penalty)
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
          <h2>Charlatan battle</h2><br></br>
          <p><b>{state.battlePrompt}</b></p>
          {(state.activeAskerId === state.you.id || state.activeTargetId === state.you.id) ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
              {busy ? "Loading..." : isWaitingOnYou(state) ? "Completed" : "Waiting for other player"}
            </button>
          ) : (
            <p><br></br><b>You do not have to do anything. Just watch along: {askerName} vs {targetName}</b></p>
          )}
        </>
      )}

      {state.phase === "charlatan_vote" && (
        <>
          {(state.activeAskerId === state.you.id || state.activeTargetId === state.you.id) ? (
            <>
              <h2>Who won?</h2><p>Who won the Charlatan battle?</p><p></p>
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
            <h2>Waiting for Charlatan battle result...</h2>
          )}
        </>
      )}

      {state.phase === "penalty_prompt" && (
        <>
          {state.activeAskerId === state.you.id ? (
            <>
              <h2>You guessed wrong!</h2>
              <p></p>
              <p><p>Your penalty:</p><b>{state.penaltyText}</b></p><p></p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
                {busy ? "Loading..." : "I did it"}
              </button>
              <p>Make sure you do it properly, the game can't proceed until it's served...</p>
            </>
          ) : (
            <div><h2>{askerName} is doing their penalty...</h2><br></br><p>Make sure they do it correctly:<p></p><b>{state.penaltyText}</b><p></p><br></br>The game can't proceed until {askerName} serves the penalty properly...</p></div>
          )}
        </>
      )}

      {state.phase === "penalty_confirm" && (
        <>
          {state.activeTargetId === state.you.id ? (
            <>
              <h2>Did they do it properly?</h2>
              <p></p><p><i>... {state.penaltyText}</i></p><p></p>
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
            <h2>{targetName} is confirming the penalty.</h2>
          )}
        </>
      )}

      {state.phase === "turn_result" && (
        <>
          <h2>Scoreboard</h2><p></p>
          <p>Results:</p>
          <div className="player-grid teamsz">
            {state.scores.map((row) => (
              <div key={row.playerId} className="player-pill team">
                {row.name} has: {row.collectedCount} Cards
              </div>
            ))}
          </div>
          {state.activeAskerId === state.you.id ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
              {busy ? "Loading..." : "Continue"}
            </button>
          ) : (
            <p className="hint-text nb">Waiting for {askerName} to click continue...</p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>Game over</h2>
          <p>Most collected cards wins.</p>
          <div className="player-grid teamsz">
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

