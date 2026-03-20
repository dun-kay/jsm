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
import { getGameIntroRules } from "../rules";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";

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
  const {
    accessState,
    showPaywall,
    setShowPaywall,
    accessError,
    setAccessError,
    refreshAccessState,
    ensureSessionAccess
  } = usePlayAccess();

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
  const hasSubmittedMyConfirm = Boolean(
    state?.phase === "guess_confirm" &&
      ((state.currentAskerId === myId && state.askerConfirm !== null) ||
        (state.currentTargetId === myId && state.targetConfirm !== null))
  );

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
    return state.players.filter((p) => p.id !== myId && p.leaderId !== myLeader && p.leaderId === p.id);
  }, [state, myId, isMyTurnToPick]);

  const teamSummary = useMemo(() => {
    if (!state) {
      return [];
    }
    return state.teamLeaders.map((leaderId) => {
      const members = state.players.filter((p) => p.leaderId === leaderId);
      const orderedMembers = [...members].sort((a, b) => {
        if (a.id === leaderId && b.id !== leaderId) {
          return -1;
        }
        if (b.id === leaderId && a.id !== leaderId) {
          return 1;
        }
        return 0;
      });
      const leaderName = state.players.find((p) => p.id === leaderId)?.name || members[0]?.name || "Team";
      return { leaderId, leaderName, members: orderedMembers };
    });
  }, [state]);
  const introRules = getGameIntroRules("popular-people");

  async function doContinue() {
    if (!state || busy) {
      return;
    }
    if (state.phase === "rules" && isWaitingOnYou) {
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
    if (!state || busy || hasSubmittedMyConfirm) {
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
          <button
            type="button"
            className="btn btn-key"
            onClick={() => void doContinue()}
            disabled={busy || !isWaitingOnYou}
          >
            {busy ? "Loading..." : isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "input" && (
        <>
          <h2>Enter your popular person.</h2>
          <p>Don't tell reveal this to any of the other players.</p>
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
              placeholder="Enter celebrity..."
            />
          </label>
          {celebTouched && celebOne.length >= MAX_CELEB_LENGTH && (
            <span className="hint-text">20 character max reached</span>
          )}
          <button type="button" className="btn btn-key" onClick={() => void doSubmitCelebrities()} disabled={busy}>
            {busy ? "Submitting..." : "Submit"}
          </button>
          {state.yourSubmitted && <p>Submitted. Waiting for others...</p>}
        </>
      )}

      {state.phase === "reveal" && (
        <>
          <h2>Study the popular people list.</h2>
          <p>It might help you to remember the list if one player reads it aloud.</p>
          <br></br><p>{revealSecondsLeft}s remaining</p>
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
              <h2>Your turn. Pick a player to ask.</h2>
              <p>Guess who their popular person is.</p><br></br>
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
            <h2>{askerName} is asking the questions.</h2>
              <br></br><p>Contribute to help your team win by
              collecting all players.</p>
            </p>
          ) : (
            <p><h2>It's {askerName}'s turn to pick someone.</h2><br></br>
            <p>They'll guess who their popular person is. Consider giving some advice, or sabotage.</p></p>
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

        </>
        
      )}

      

      {state.phase === "guess_input" && (
        <>
          {isMyTurnToGuess ? (
            <>
              <h2>Ask {targetName} who their popular person is.</h2>
              <p>Ask your guess out loud, you'll confirm their response on the next screen.</p>
              <button type="button" className="btn btn-key" onClick={() => void doSubmitGuess()} disabled={busy}>
                Confirm guess...
              </button>
            </>
          ) : isMyTeamLeaderAsking ? (
            <p><h2>
              {askerName} is asking {targetName}.
            </h2>
            <br></br>
            <p>Your team leader is asking the questions. Help by
              contributing your ideas.</p></p>
          ) : (
            <p><h2>{askerName} is guessing {targetName}'s popular person.</h2><br></br>
            <p>Don't forget to keep a mental note of their answer...</p></p>
          )}

          <div className="players-panel">
        <p className="body-text left">Current Teams</p>
        <div className="player-grid teams">
          {teamSummary.map((team) => (
            <div key={team.leaderId} className="player-pill team">
              {team.members.map((m) => m.name).join(", ")}
            </div>
          ))}
        </div>
      </div>

        </>
      )}

      {state.phase === "guess_confirm" && (
        <>
        
          {isMyTurnToConfirm ? (
            <>
              <h2>{targetName} & {askerName}</h2>
              <br></br><p>Confirm if {askerName} guessed {targetName}'s popular person correctly.</p>
              <p></p>
              <div className="bottom-row">
                <button
                  type="button"
                  className="btn btn-key"
                  onClick={() => void doConfirm(true)}
                  disabled={busy || hasSubmittedMyConfirm}
                >
                  Correct
                </button>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => void doConfirm(false)}
                  disabled={busy || hasSubmittedMyConfirm}
                >
                  Incorrect
                </button>
              </div>
            </>
          ) : (
            <p><h2>Waiting for guess confirmation...</h2><br></br>
            <p>Check what the result was & keep a mental note of it.</p></p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
        <h2>{teamSummary[0]?.leaderName || "Unknown"} won the game.</h2>
          <p>Game complete, ready to play again?</p>
          <br></br>
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

      {state.phase === "guess_confirm" && hasSubmittedMyConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Waiting for confirmation">
          <div className="modal-card">
            <h2>Answer submitted</h2>
            <p>Waiting for the other player to confirm.</p>
          </div>
        </div>
      )}
    </section>
  );
}
