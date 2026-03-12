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

type SecretCategoryRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

export default function SecretCategoryRuntime({ gameCode, playerToken }: SecretCategoryRuntimeProps) {
  const [state, setState] = useState<SecretCategoryState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");

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

  async function doContinue() {
    if (!state || busy || !isWaitingOnYou) {
      return;
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
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  return (
    <section className="runtime-card runtime-flow">
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
      <p><b>Main category: {state.mainCategory}</b></p>
      {!state.isSpy && state.secretCategory && <p><u>Secret category: {state.secretCategory}</u></p>}
          {state.isSpy && (
            <p><u><b>You are the Spy</b></u> (do not reveal this to anyone).</p>)}

      {state.phase === "rules" && (
        <>
        <br></br>
          <p><b>How to play:</b></p>
          <p>The game starts by revealing the <b>main category</b> to everyone (you can see it above).</p>
          <p>The <b>secret category</b> is revealed under that.</p>
          <p>One player does not see it. <u><b>They are the Spy.</b></u></p>
          <br></br>
          <p>The Spy must figure out the secret category.</p>
          <p>The other players must figure out who the Spy is.</p>
          <br></br>
          <p><b>Each round, one player gives a one-word clue.</b></p>
          <p>The clue should relate to the main category and the secret category.</p>
          <p>If you are the Spy, sound believable so others think you know the secret.</p>
          <p>If you are not the Spy try & show others with the clue you give, without revealing the secret.</p>
          <br></br>
          <p>Example: If the category is Cars and the secret is Ferrari. <b>Horse</b> is a bad clue. <b>Fast</b> is better.</p>
          <br></br>
          <p>After everyone gives clues, you discuss and vote.</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "role_reveal" && (
        <>
          {!state.isSpy && <p>Keep the secret safe. Use smart, subtle clues.</p>}
        {state.isSpy && (
            <p>
              Stay hidden. Blend in, avoid suspicion, and figure out the secret category.
            </p>
          )}
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "turn_clues" && (
        <>
          {state.currentTurnPlayerId === state.you.id ? (
            <p>
              Your turn. Say one word linked to the main category without exposing the secret category.
            </p>
          ) : (
            <p>{currentTurnName} is giving a clue.</p>
          )}
          {state.isSpy && <p>You are the Spy. Sound convincing and gather information. Don't reveal your role to anyone.</p>}
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "discussion" && (
        <>
          <p>Discuss, who is the Spy?</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "vote" && (
        <>
          <p>Vote for the Spy. A majority is required.</p>
          {state.voteAttempt > 1 && <p>No majority last round. Vote again.</p>}
          <div className="runtime-list">
            {state.players.map((player) => (
              <button
                key={player.id}
                type="button"
                className="btn btn-soft"
                onClick={() => void doVote(player.id)}
                disabled={busy || hasVoted}
              >
                Vote {player.name}
              </button>
            ))}
          </div>
          {hasVoted && <p>Vote locked. Waiting for the rest of the table.</p>}
        </>
      )}

      {state.phase === "spy_guess" && (
        <>
          {state.isSpy ? (
            <>
              <p>You were caught. Make one final guess to steal the win.</p>
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
            <p>The Spy is making a final guess...</p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          {state.roundResult === "spy_not_found" && <p>The Spy survived. Spy wins.</p>}
          {state.roundResult === "spy_guessed_correct" && <p>The Spy guessed correctly. Spy wins.</p>}
          {state.roundResult === "spy_guessed_wrong" && <p>The Spy missed. Team wins.</p>}
          {state.roundResult === "spy_found" && <p>The Spy was found.</p>}

          {state.you.isHost && (
            <button type="button" className="btn btn-key" onClick={() => void doNextRound()} disabled={busy}>
              Play another round
            </button>
          )}
          {!state.you.isHost && <p>Waiting for host to start next round.</p>}
        </>
      )}

      {errorText && <p className="hint-text error-text">{errorText}</p>}
    </section>
  );
}
