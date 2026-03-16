import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  confirmCelebGuess,
  continueCelebrities,
  getCelebritiesState,
  initCelebrities,
  pickCelebTarget,
  playAgainCelebrities,
  submitCelebGuess,
  submitCelebrities,
  type CelebritiesState
} from "../../lib/popularPeopleApi";

type PopularPeopleRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

const MAX_CELEB_LENGTH = 20;

function capCelebLength(value: string): string {
  return value.slice(0, MAX_CELEB_LENGTH);
}

export default function PopularPeopleRuntime({ gameCode, playerToken }: PopularPeopleRuntimeProps) {
  const [state, setState] = useState<CelebritiesState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [celebOne, setCelebOne] = useState<string>("");
  const [celebTouched, setCelebTouched] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const next = await initCelebrities(gameCode, playerToken);
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
        const next = await getCelebritiesState(gameCode, playerToken);
        if (!active) {
          return;
        }
        setState(next);
      } catch {
        // keep current state for transient failures
      }
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameCode, playerToken]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const myId = state?.you.id || "";
  const isWaitingOnYou = Boolean(state?.waitingOn.includes(myId));
  const isMyTurnToPick = state?.phase === "guess_pick" && state.currentAskerId === myId;
  const isMyTurnToGuess = state?.phase === "guess_input" && state.currentAskerId === myId;
  const isMyTurnToConfirm =
    state?.phase === "guess_confirm" && (state.currentAskerId === myId || state.currentTargetId === myId);

  const revealSecondsLeft = useMemo(() => {
    if (!state?.revealEndsAt) {
      return 0;
    }
    const diff = Math.ceil((new Date(state.revealEndsAt).getTime() - nowMs) / 1000);
    return Math.max(0, diff);
  }, [state?.revealEndsAt, nowMs]);

  const askerName = useMemo(() => {
    if (!state?.currentAskerId) {
      return "";
    }
    return state.players.find((p) => p.id === state.currentAskerId)?.name || "";
  }, [state]);

  const targetName = useMemo(() => {
    if (!state?.currentTargetId) {
      return "";
    }
    return state.players.find((p) => p.id === state.currentTargetId)?.name || "";
  }, [state]);

  const isMyTeamLeaderAsking = Boolean(
    state?.currentAskerId && state.you.leaderId === state.currentAskerId && state.currentAskerId !== myId
  );

  const availableTargets = useMemo(() => {
    if (!state || !isMyTurnToPick) {
      return [];
    }
    const myLeader = state.you.leaderId;
    return state.players.filter((p) => p.id !== myId && p.leaderId !== myLeader);
  }, [state, myId, isMyTurnToPick]);

  const teamSummary = useMemo(() => {
    if (!state) {
      return [];
    }
    return state.teamLeaders.map((leaderId) => {
      const members = state.players.filter((p) => p.leaderId === leaderId);
      const leaderName = state.players.find((p) => p.id === leaderId)?.name || members[0]?.name || "Team";
      return { leaderId, leaderName, members };
    });
  }, [state]);

  async function doContinue() {
    if (!state || busy) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await continueCelebrities(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function doSubmitCelebrities() {
    if (!state || busy) {
      return;
    }
    const first = capCelebLength(celebOne);
    if (!first.trim()) {
      setErrorText("Enter a celebrity.");
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      // Backend currently expects two values; send the same value for slot 2.
      const next = await submitCelebrities(gameCode, playerToken, first, first);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit celebrities.");
    } finally {
      setBusy(false);
    }
  }

  function onPersonInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void doSubmitCelebrities();
  }

  async function doPickTarget(targetPlayerId: string) {
    if (!state || busy) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await pickCelebTarget(gameCode, playerToken, targetPlayerId);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to pick target.");
    } finally {
      setBusy(false);
    }
  }

  async function doSubmitGuess() {
    if (!state || busy) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitCelebGuess(gameCode, playerToken, "Verbal guess");
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit guess.");
    } finally {
      setBusy(false);
    }
  }

  async function doConfirm(isCorrect: boolean) {
    if (!state || busy) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await confirmCelebGuess(gameCode, playerToken, isCorrect);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to confirm result.");
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
      const next = await playAgainCelebrities(gameCode, playerToken);
      setState(next);
      setCelebOne("");
      setCelebTouched(false);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to start another round.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="runtime-card">
        <h2>Popular People</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  return (
    <section className="runtime-card runtime-flow">
      <h2>Popular People</h2>

      {state.phase === "rules" && (
        <>
          <p>Everyone must read the rules, then tap Begin.</p>
          <p>Each player enters 1 popular person.</p>
          <p>Study the list, then ask and confirm guesses face to face.</p>
          <button
            type="button"
            className="btn btn-key"
            onClick={() => void doContinue()}
            disabled={busy || !isWaitingOnYou}
          >
            {busy ? "Loading..." : isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "input" && (
        <>
          <p>Enter a celebrity (max 20 characters).</p>
          <label className="field-wrap" htmlFor="celeb-one">
            <input
              id="celeb-one"
              className="input-pill"
              type="text"
              value={celebOne}
              onChange={(event) => {
                setCelebTouched(true);
                setCelebOne(capCelebLength(event.target.value));
              }}
              onKeyDown={onPersonInputKeyDown}
              maxLength={MAX_CELEB_LENGTH}
              placeholder="Celebrity"
            />
          </label>
          {celebTouched && celebOne.length >= MAX_CELEB_LENGTH && (
            <span className="hint-text">20 character max reached</span>
          )}
          <button type="button" className="btn btn-key" onClick={() => void doSubmitCelebrities()} disabled={busy}>
            {busy ? "Submitting..." : "Submit person"}
          </button>
          {state.yourSubmitted && <p>Submitted. Waiting for others...</p>}
        </>
      )}

      {state.phase === "reveal" && (
        <>
          <p>Study the celebrity list.</p>
          <p>{revealSecondsLeft}s remaining</p>
          <div className="player-grid cele">
            {state.celebrityList.map((name, index) => (
              <div key={`${name}-${index}`} className="player-pill">{name}</div>
            ))}
          </div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || revealSecondsLeft > 0}>
            {busy ? "Loading..." : revealSecondsLeft > 0 ? "Wait..." : isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "guess_pick" && (
        <>
          {isMyTurnToPick ? (
            <>
              <p>Your turn. Pick a player to ask.</p>
              <div className="runtime-list">
                {availableTargets.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className="btn btn-soft"
                    onClick={() => void doPickTarget(player.id)}
                    disabled={busy}
                  >
                    Ask {player.name}
                  </button>
                ))}
              </div>
            </>
          ) : isMyTeamLeaderAsking ? (
            <p>
              {askerName} is asking the questions, your team leader. Contribute helpfully to help your team win by
              collecting all players.
            </p>
          ) : (
            <p>{askerName}'s turn to pick someone.</p>
          )}
        </>
      )}

      {state.phase === "guess_input" && (
        <>
          {isMyTurnToGuess ? (
            <>
              <p>You are asking {targetName}. Ask your guess out loud.</p>
              <button type="button" className="btn btn-key" onClick={() => void doSubmitGuess()} disabled={busy}>
                Continue to confirmation
              </button>
            </>
          ) : isMyTeamLeaderAsking ? (
            <p>
              {askerName} is asking {targetName}. Your team leader is in control this turn. Help your team by
              contributing useful ideas.
            </p>
          ) : (
            <p>{askerName} is asking {targetName} a verbal guess.</p>
          )}
        </>
      )}

      {state.phase === "guess_confirm" && (
        <>
          <p>{askerName} guessed: <b>{state.currentGuess || "..."}</b> for {targetName}</p>
          {isMyTurnToConfirm ? (
            <>
              <p>Confirm if that guess was correct.</p>
              <div className="bottom-row">
                <button type="button" className="btn btn-key" onClick={() => void doConfirm(true)} disabled={busy}>
                  Correct
                </button>
                <button type="button" className="btn btn-soft" onClick={() => void doConfirm(false)} disabled={busy}>
                  Incorrect
                </button>
              </div>
            </>
          ) : (
            <p>Waiting for asker + target confirmation.</p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          <p>Game complete.</p>
          <p>Final team leader: {teamSummary[0]?.leaderName || "Unknown"}</p>
          <div className="player-grid cele">
            {state.celebrityList.map((name, index) => (
              <div key={`${name}-${index}`} className="player-pill">{name}</div>
            ))}
          </div>
          {state.you.isHost && (
            <button type="button" className="btn btn-key" onClick={() => void doPlayAgain()} disabled={busy}>
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

      <div className="players-panel">
        <p className="body-text left">Teams</p>
        <div className="player-grid teams">
          {teamSummary.map((team) => (
            <div key={team.leaderId} className="player-pill team">
              {team.members.map((m) => m.name).join(", ")}
            </div>
          ))}
        </div>
      </div>

      {(state.lastError || errorText) && <p className="hint-text error-text">{state.lastError || errorText}</p>}
    </section>
  );
}
