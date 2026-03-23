import { useEffect, useMemo, useState } from "react";
import {
  continueSecretCategory,
  getSecretCategoryState,
  initSecretCategory,
  nextSecretCategoryRound,
  rerollSecretCategory,
  submitSecretCategoryVote,
  submitSpyGuess,
  type SecretCategoryState
} from "../../lib/secretCategoryApi";
import { getGameIntroRules } from "../rules";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";

type SecretCategoryRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

export default function SecretCategoryRuntime({ gameCode, playerToken }: SecretCategoryRuntimeProps) {
  const [state, setState] = useState<SecretCategoryState | null>(null);
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
        const next = await initSecretCategory(gameCode, playerToken);
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
        const next = await getSecretCategoryState(gameCode, playerToken);
        if (!active) {
          return;
        }
        setState(next);
      } catch {
        // keep existing state for transient poll failures
      }
    }, 2000);

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

  const currentTurnName = useMemo(() => {
    if (!state?.currentTurnPlayerId) {
      return "";
    }
    return state.players.find((player) => player.id === state.currentTurnPlayerId)?.name || "";
  }, [state]);

  const hasVoted = useMemo(() => {
    if (!state) {
      return false;
    }
    return Boolean(state.votes[state.you.id]);
  }, [state]);

  const isWaitingOnYou = useMemo(() => {
    if (!state) {
      return false;
    }
    return state.waitingOn.includes(state.you.id);
  }, [state]);
  const introRules = getGameIntroRules("secret-category");

  async function doContinue() {
    if (!state || busy || !isWaitingOnYou) {
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
      const next = await continueSecretCategory(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function doVote(targetPlayerId: string) {
    if (!state || busy || state.phase !== "vote") {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitSecretCategoryVote(gameCode, playerToken, targetPlayerId);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit vote.");
    } finally {
      setBusy(false);
    }
  }

  async function doSpyGuess(guess: string) {
    if (!state || busy || state.phase !== "spy_guess") {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitSpyGuess(gameCode, playerToken, guess);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit guess.");
    } finally {
      setBusy(false);
    }
  }

  async function doNextRound() {
    if (!state || busy || !state.you.isHost) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await nextSecretCategoryRound(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to start next round.");
    } finally {
      setBusy(false);
    }
  }

  async function doRerollCategory() {
    if (!state || busy || !state.you.isHost) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await rerollSecretCategory(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to reroll category.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="runtime-card">
        <h2>Loading game...</h2>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  return (
    <section className="runtime-card runtime-flow">
      {state.phase === "rules" && (
        <>
          <h2>{introRules.title}</h2>
          {introRules.content}
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "role_reveal" && (
        <>
        {state.you.isHost && (
            <button
              type="button"
              className="btn btn-soft runtime-reroll-btn"
              onClick={() => void doRerollCategory()}
              disabled={busy}
            >
              Re-spin category
            </button>
          )}
                  {!state.you.isHost && (
            <button
              type="button"
              className="btn btn-soft runtime-reroll-btn"
            >
              Host can re-spin
            </button>
          )}

              {!state.isSpy && <p><h2>You are <u>not</u> the spy.</h2><p>Shhh, don't tell anyone.</p><br></br></p>}
              {state.isSpy && <p><h2>You are <u>the</u> spy.</h2><p>Shhh, don't tell anyone.</p><br></br></p>}
              <p className="maincat"><p><b>Main Category: </b>{state.mainCategory}</p></p>
      {!state.isSpy && state.secretCategory && <p className="secretcat">Secret Category: {state.secretCategory}</p>}
          {state.isSpy && (<p className="secretcat">Secret Category: You are the Spy</p>)}




          {!state.isSpy && <p><br></br><p>Keep the secret safe.</p><p>Use smart, subtle clues.</p><br></br></p>}
        {state.isSpy && (<p><br></br><p>Blend in. Avoid suspicion.</p><p>Try & figure out the secret category.</p><br></br></p>)}
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "turn_clues" && (
        <>

          {state.currentTurnPlayerId === state.you.id ? (
            <p>
              <h2>It's your turn.</h2><br></br><p>Say a one word clue related to the main category. Don't expose the secret category<p>(or that you don't know what it is).</p>
            </p></p>
          ) : (
            <p><h2>It's {currentTurnName}'s turn.</h2><br></br><p>Listen for their clue.</p></p>
          )}
                        <br></br><p className="maincat"><p><b>Main Category: </b>{state.mainCategory}</p></p>
      {!state.isSpy && state.secretCategory && <p className="secretcat">Secret Category: {state.secretCategory}</p>}
          {state.isSpy && (<p className="secretcat">Secret Category: You are the Spy</p>)}<br></br>
          
                    {state.currentTurnPlayerId === state.you.id ? (
            <p><b>Click continue after you have given your clue.</b></p>
          ) : (
            <p><b>Waiting for {currentTurnName} to give their clue.</b></p>
          )}
          
          {state.currentTurnPlayerId === state.you.id && (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {isWaitingOnYou ? "Continue" : "Waiting for others"}
            </button>
          )}
        </>
      )}

      {state.phase === "discussion" && (
        <>
          <h2>Discuss, who is the Spy?</h2><p>Voting next...</p>
         <br></br><div className="player-grid">
            {state.players.map((player) => (
              <div 
                key={player.id}
                className="player-pill"
              >
                {player.name}
              </div>
            ))}
          </div><br></br>             
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "vote" && (
        <>
          <h2>Vote for who you think the Spy is.</h2><p>A majority is required.</p><br></br>
          {state.voteAttempt > 1 && <p>No majority last round. Vote again.</p>}
          <div className="runtime-list">
            {state.players.map((player) => (
              <button
                key={player.id}
                type="button"
                className="btn btn-soft vote"
                onClick={() => void doVote(player.id)}
                disabled={busy || hasVoted}
              >
              {player.name} is the Spy
              </button>
            ))}
          </div>
          {hasVoted && <p>Vote cast. Waiting for the rest of the table...</p>}
        </>
      )}

      {state.phase === "spy_guess" && (
        <>
          {state.isSpy ? (
            <>
              <p><h2>You were caught...</h2><br></br><p>Guess the Secret Category & win the game.</p></p>
              <div className="runtime-list">
                {state.secretOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="btn btn-soft"
                    onClick={() => void doSpyGuess(option)}
                    disabled={busy}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p><h2>You caught the Spy...</h2><br></br><p>They are trying to guess the Secret Category & win the game.</p></p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          {state.roundResult === "spy_not_found" && <p><h2>The Spy survived!</h2><p>They won this round, but who was the spy...</p><br></br></p>}
          {state.roundResult === "spy_guessed_correct" && <p><h2>The Spy guessed the Secret!</h2><p>They won this round.</p><br></br></p>}
          {state.roundResult === "spy_guessed_wrong" && <p><h2>The Spy guessed wrong!</h2><p>The non-Spies won this round.</p><br></br></p>}
          {state.roundResult === "spy_found" && <p><h2>The Spy was found out!</h2><p>The non-Spies won this round.</p><br></br></p>}

          {state.you.isHost && (
            <button type="button" className="btn btn-key" onClick={() => void doNextRound()} disabled={busy}>
              Play again
            </button>
          )}
          {!state.you.isHost && (
            <button type="button" className="btn btn-key" disabled>
              Ask the host to play again
            </button>
          )}
        </>
      )}

      {(errorText || accessError) && <p className="hint-text error-text">{errorText || accessError}</p>}
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
