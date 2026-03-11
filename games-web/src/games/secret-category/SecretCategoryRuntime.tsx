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
  onExit: () => void;
};

export default function SecretCategoryRuntime({ gameCode, playerToken, onExit }: SecretCategoryRuntimeProps) {
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
        {errorText && <p>{errorText}</p>}
      </section>
    );
  }

  return (
    <section className="runtime-card runtime-flow">
      <button type="button" className="icon-cancel runtime-exit" onClick={onExit}>
        X
      </button>

      <h2>Secret Categories</h2>
      <p>Round {state.roundNo}</p>

      {state.phase === "rules" && (
        <>
          <p>
            Game title, description, & rules pop up to make sure all users understand how to play. Don't
            worry if you don't understand it right away, you'll catch on pretty quick. Trust me!
          </p>
          <p>Everyone must click begin to continue.</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "role_reveal" && (
        <>
          {state.you.isHost && (
            <button
              type="button"
              className="btn btn-soft"
              style={{ minHeight: "36px", padding: "6px 10px", fontSize: "14px" }}
              onClick={() => void doRerollCategory()}
              disabled={busy}
            >
              Re-spin category
            </button>
          )}
          {!state.you.isHost && <p>Ask the host to re-spin the category if needed.</p>}
          <p>Main category: {state.mainCategory}</p>
          {!state.isSpy && state.secretCategory && <p>Secret category: {state.secretCategory}</p>}
          {state.isSpy && (
            <p>
              You are the Spy. Do not reveal this to any other players. Your job is to uncover this round's
              Secret Category without getting caught.
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
              It's your turn. Say one word that relates to the Category, without giving away the Secret
              Category.
            </p>
          ) : (
            <p>{currentTurnName}'s turn.</p>
          )}
          {state.isSpy && <p>You are the Spy. Blend in and avoid getting caught.</p>}
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "discussion" && (
        <>
          <p>Discuss who you think the Spy is. Voting is next.</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "vote" && (
        <>
          <p>Vote who you think is the Spy. Majority required.</p>
          {state.voteAttempt > 1 && <p>No majority last vote. Vote again.</p>}
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
          {hasVoted && <p>Vote locked. Waiting for others.</p>}
        </>
      )}

      {state.phase === "spy_guess" && (
        <>
          {state.isSpy ? (
            <>
              <p>You were found. Guess the Secret Category to steal the win.</p>
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
            <p>Spy is guessing the Secret Category...</p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          {state.roundResult === "spy_not_found" && <p>The Spy was not found. Spy wins.</p>}
          {state.roundResult === "spy_guessed_correct" && <p>Spy guessed correctly and wins.</p>}
          {state.roundResult === "spy_guessed_wrong" && <p>Spy was found and guessed wrong. Team wins.</p>}
          {state.roundResult === "spy_found" && <p>Spy was found.</p>}

          {state.you.isHost && (
            <button type="button" className="btn btn-key" onClick={() => void doNextRound()} disabled={busy}>
              Play another round
            </button>
          )}
          {!state.you.isHost && <p>Waiting for host to start next round.</p>}
        </>
      )}

      {errorText && <p>{errorText}</p>}
    </section>
  );
}
