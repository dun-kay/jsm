import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  continueFruitBowl,
  getFruitBowlState,
  initFruitBowl,
  markFruitBowlPrompt,
  playAgainFruitBowl,
  submitFruitBowlPrompts,
  type FruitBowlState
} from "../../lib/fruitBowlApi";

type FruitBowlRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

const MAX_PROMPT_LENGTH = 50;

function capPromptLength(value: string): string {
  return value.slice(0, MAX_PROMPT_LENGTH);
}

function roundRuleCopy(roundNumber: number): { title: string; copy: string } {
  if (roundNumber === 1) {
    return { title: "Round 1: Describe", copy: "Describe the prompt without saying the exact words." };
  }
  if (roundNumber === 2) {
    return { title: "Round 2: Act it out", copy: "No speaking. Use only actions and gestures." };
  }
  return { title: "Round 3: One word", copy: "You may say one word only for each prompt." };
}

export default function FruitBowlRuntime({ gameCode, playerToken }: FruitBowlRuntimeProps) {
  const [state, setState] = useState<FruitBowlState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [promptOne, setPromptOne] = useState<string>("");
  const [promptTwo, setPromptTwo] = useState<string>("");
  const [promptTouched, setPromptTouched] = useState<boolean>(false);
  const [showDisputeModal, setShowDisputeModal] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const next = await initFruitBowl(gameCode, playerToken);
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
        const next = await getFruitBowlState(gameCode, playerToken);
        if (!active) {
          return;
        }
        setState(next);
      } catch {
        // keep current state on transient failures
      }
    }, 1000);

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
  const isClueGiver = Boolean(state?.activeCluegiverId && state.activeCluegiverId === myId);
  const activeClueGiverName = useMemo(() => {
    if (!state?.activeCluegiverId) {
      return "Someone";
    }
    return state.players.find((p) => p.id === state.activeCluegiverId)?.name || "Someone";
  }, [state]);

  const turnSecondsLeft = useMemo(() => {
    if (!state?.turnEndsAt) {
      return 0;
    }
    const diff = Math.ceil((new Date(state.turnEndsAt).getTime() - nowMs) / 1000);
    return Math.max(0, diff);
  }, [state?.turnEndsAt, nowMs]);

  const canSubmitPrompts = useMemo(
    () => capPromptLength(promptOne).trim().length > 0 && capPromptLength(promptTwo).trim().length > 0,
    [promptOne, promptTwo]
  );

  const rulesForRound = roundRuleCopy(state?.roundNumber || 1);

  async function doContinue() {
    if (!state || busy) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await continueFruitBowl(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function doSubmitPrompts() {
    if (!state || busy) {
      return;
    }
    const first = capPromptLength(promptOne).trim();
    const second = capPromptLength(promptTwo).trim();
    if (!first || !second) {
      setErrorText("Enter 2 prompts.");
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitFruitBowlPrompts(gameCode, playerToken, first, second);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit prompts.");
    } finally {
      setBusy(false);
    }
  }

  function onPromptInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void doSubmitPrompts();
  }

  async function doMark(action: "correct" | "skip") {
    if (!state || busy || !isClueGiver) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await markFruitBowlPrompt(gameCode, playerToken, action);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to update prompt.");
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
      const next = await playAgainFruitBowl(gameCode, playerToken);
      setState(next);
      setPromptOne("");
      setPromptTwo("");
      setPromptTouched(false);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to start another game.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="runtime-card">
        <h2>Fruit Bowl</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  return (
    <section className="runtime-card runtime-flow">
      <h2>Fruit Bowl</h2>
      <p>
        Score: Team A {state.teamAScore} - {state.teamBScore} Team B
      </p>
      <p>Prompts left in bowl: {state.promptsRemaining}</p>

      {state.phase === "rules" && (
        <>
          <p>Everyone adds 2 prompts to the bowl.</p>
          <p>Then you play 3 rounds using the same prompts:</p>
          <p>Describe it, Act it out, One word only.</p>
          <p>Most points after Round 3 wins.</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "input" && (
        <>
          <p>Enter 2 prompts for the bowl.</p>
          <label className="field-wrap" htmlFor="fb-prompt-one">
            <input
              id="fb-prompt-one"
              className="input-pill"
              type="text"
              value={promptOne}
              onChange={(event) => {
                setPromptTouched(true);
                setPromptOne(capPromptLength(event.target.value));
              }}
              onKeyDown={onPromptInputKeyDown}
              maxLength={MAX_PROMPT_LENGTH}
              placeholder="Prompt 1"
            />
          </label>
          <label className="field-wrap" htmlFor="fb-prompt-two">
            <input
              id="fb-prompt-two"
              className="input-pill"
              type="text"
              value={promptTwo}
              onChange={(event) => {
                setPromptTouched(true);
                setPromptTwo(capPromptLength(event.target.value));
              }}
              onKeyDown={onPromptInputKeyDown}
              maxLength={MAX_PROMPT_LENGTH}
              placeholder="Prompt 2"
            />
          </label>
          {promptTouched &&
            (promptOne.length >= MAX_PROMPT_LENGTH || promptTwo.length >= MAX_PROMPT_LENGTH) && (
              <span className="hint-text">50 character max reached</span>
            )}
          <button type="button" className="btn btn-key" onClick={() => void doSubmitPrompts()} disabled={busy || !canSubmitPrompts}>
            {busy ? "Submitting..." : "Submit prompts"}
          </button>
          {state.yourSubmitted && <p>Submitted. Waiting for others...</p>}
        </>
      )}

      {state.phase === "teams" && (
        <>
          <p>Teams are set. Only the active clue giver controls cards.</p>
          <div className="players-panel">
            <p className="body-text left">Team A</p>
            <div className="player-grid teams">
              {state.teamA.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>
          <div className="players-panel">
            <p className="body-text left">Team B</p>
            <div className="player-grid teams">
              {state.teamB.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "round_intro" && (
        <>
          <h2>{rulesForRound.title}</h2>
          <p>{rulesForRound.copy}</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "turn_live" && (
        <>
          <p>Round {state.roundNumber}</p>
          <p>{turnSecondsLeft}s remaining</p>
          <p>Active team: Team {state.activeTeam === 1 ? "A" : "B"}</p>
          {isClueGiver ? (
            <>
              <p>Your prompt:</p>
              <div className="player-pill">{state.currentPrompt || "Waiting for prompt..."}</div>
              <div className="bottom-row">
                <button type="button" className="btn btn-key" onClick={() => void doMark("correct")} disabled={busy}>
                  Correct
                </button>
                <button type="button" className="btn btn-soft" onClick={() => void doMark("skip")} disabled={busy}>
                  Skip
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{activeClueGiverName} is drawing from the bowel.</p>
              <p>Guess out loud if they are on your team.</p>
            </>
          )}
        </>
      )}

      {state.phase === "turn_summary" && (
        <>
          <h2>Turn over</h2>
          <p>Team {state.lastTurnTeam === 1 ? "A" : "B"} scored {state.lastTurnPoints}</p>
          <p>{state.promptsRemaining} prompts left in the bowel</p>
        </>
      )}

      {state.phase === "round_results" && (
        <>
          <h2>Round {state.roundNumber} complete</h2>
          <p>Same prompts. New rules.</p>
          <div className="bottom-row">
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : isWaitingOnYou ? "Continue" : "Waiting for others"}
            </button>
            <button type="button" className="btn btn-soft" onClick={() => setShowDisputeModal(true)}>
              Dispute Score
            </button>
          </div>
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>
            {state.teamAScore === state.teamBScore
              ? "It's a tie."
              : state.teamAScore > state.teamBScore
                ? "Team A wins Fruit Bowl"
                : "Team B wins Fruit Bowl"}
          </h2>
          <p>Ready to play again?</p>
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

      {(state.lastError || errorText) && <p className="hint-text error-text">{state.lastError || errorText}</p>}

      {showDisputeModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Dispute score?</h2>
            <p>
              Chill out... remember this is just a game. If the other team is actually cheating kindly ask them not to.
              If it's just edge cases stop whining and use it as fuel to destroy them in the next round.
            </p>
            <button className="btn btn-key" type="button" onClick={() => setShowDisputeModal(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
