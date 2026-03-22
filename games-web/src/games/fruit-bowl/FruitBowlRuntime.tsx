import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  continueFruitBowl,
  getFruitBowlState,
  initFruitBowl,
  markFruitBowlPrompt,
  playAgainFruitBowl,
  shuffleFruitBowlTeams,
  submitFruitBowlPrompts,
  type FruitBowlState
} from "../../lib/fruitBowlApi";
import { getGameIntroRules } from "../rules";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";

type FruitBowlRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

const MAX_PROMPT_LENGTH = 20;

function capPromptLength(value: string): string {
  return value.slice(0, MAX_PROMPT_LENGTH);
}

function roundRuleCopy(roundNumber: number): { title: string; copy: string } {
  if (roundNumber === 1) {
    return {
      title: "Round 1: Describe",
      copy:
        "One player from each team takes turns describing the prompt they see.\n\n" +
        "Their team members must guess the prompt they are describing. The other team is silent.\n\n" +
        "You can use as many words as you want, just not the exact words used in the prompt.\n\n" +
        "Each player gets 30 seconds to describe as many prompts correctly as they can.\n\n" +
        "If the prompt is Dog, you might say 'you take it for a walk', & your team would shout Dog!\n\n" +
        "If your team gets a prompt right, tap Correct.\n\n" +
        "If the promp is A big red hairy dog!, you might say 'like the main character from Clifford, but it's in a sentance & fluffy'. You can add more detail to your description until they get it.\n\n" +
        "If you get stuck, you can click skip to go to the next prompt, even after you start describing.\n\n" +
        "Skipped prompts go to the bottom of the bowl.\n\n" +
        "The idea is to keep it fun & keep it moving, don't get too bogged down with complex rules!"
    };
  }
  if (roundNumber === 2) {
    return {
      title: "Round 2: Act it out",
      copy:
        "Act the prompt out without speaking.\n" +
        "No sounds, words, or spelling in the air.\n\n" +
        "Try & avoid pointing at people or objects in the room instead of acting the prompt out.\n\n" +
        "If your team gets it right, tap Correct.\n" +
        "If you get stuck, tap Skip.\n\n" +
        "Skipped prompts go to the bottom of the bowl.\n\n" +
        "A tip... go big with your actions. It makes it more fun (& the prompts easer to guess)."
    };
  }
  return {
    title: "Round 3: One word",
    copy:
      "Have you been paying attention? This final round is a test of your word & memory skills.\n\n" +
      "You can only say one word for each prompt.\n" +
      "No extra words, gestures, or sound effects.\n\n" +
      "E.g. For Dog you might say 'Leash'. For A big red hairy dog!, you might say 'Clifford'.\n\n" +
      "If you accidentily say more than one word or a word from the prompt tap skip & go back to it.\n\n" +
      "You can't change your word once you've said it. You have to click skip & go back to it later.\n\n" +
      "If your team gets it right, tap Correct.\n" +
      "If they get stuck, tap Skip.\n\n" +
      "Stay sharp and trust your instinct, it's meant to be hard! This is where champions are made." 
  };
}

function roundName(roundNumber: number): string {
  if (roundNumber === 1) {
    return "Describe";
  }
  if (roundNumber === 2) {
    return "Act it out";
  }
  return "One word";
}

function teamLabel(teamNo: number | null | undefined): string {
  return teamNo === 1 ? "Team Mango 🥭" : "Team Peach 🍑";
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

  const introRules = getGameIntroRules("fruit-bowl");

  const rulesForRound = roundRuleCopy(state?.roundNumber || 1);

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

  async function doShuffleTeams() {
    if (!state || busy || !state.you.isHost || state.phase !== "teams") {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await shuffleFruitBowlTeams(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to re-shuffle teams.");
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

      {state.phase === "rules" && (
        <>
          <h2>{introRules.title}</h2>
          {introRules.content}
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "input" && (
        <>
          <h2>Enter 2 prompts for the bowl:</h2>
          <p>These prompts can be anything. A word, two words, a phrase... make it fun & memorable.</p>
          <p>E.g. Your prompt could be 'Dog' or 'A big red hairy dog!', both are acceptable. </p>
          <p></p>
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
              <span className="hint-text">20 character max reached</span>
            )}
          <button
            type="button"
            className="btn btn-key"
            onClick={() => void doSubmitPrompts()}
            disabled={busy || !canSubmitPrompts || state.yourSubmitted}
          >
            {busy ? "Submitting..." : state.yourSubmitted ? "Submitted" : "Submit prompts"}
          </button>
          {state.yourSubmitted && <p>Waiting for others...</p>}
        </>
      )}

      {state.phase === "teams" && (
        <><p><h2>Get to know your team.</h2><p>You might want to sit closer to them.</p></p>
          {state.you.isHost && (
            <button type="button" className="btn btn-soft" onClick={() => void doShuffleTeams()} disabled={busy}>
              {busy ? "Re-shuffling..." : "Re-shuffle teams"}
            </button>
          )}
          <div className="players-panel">
            <p className="body-text left"><b>Team Mango 🥭:</b></p>
            <div className="player-grid teams eg">
              {state.teamA.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>
          <div className="players-panel">
            <p className="body-text left"><b>Team Peach 🍑:</b></p>
            <div className="player-grid teams pe">
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
          <p style={{ whiteSpace: "pre-line" }}>{rulesForRound.copy}</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "turn_live" && (
        <>
          {isClueGiver ? (
            <>
              <p><b>It's your turn to '{roundName(state.roundNumber)}' the prompt.</b></p>
              <p></p><p><b>Prompt:</b></p>
              <h2>{state.currentPrompt || "Waiting for prompt..."}</h2><p></p>
              <div className="bottom-row">
                <button type="button" className="btn btn-key" onClick={() => void doMark("correct")} disabled={busy}>
                  Correct
                </button>
                <button type="button" className="btn btn-soft" onClick={() => void doMark("skip")} disabled={busy}>
                  Skip
                </button>
              </div><br></br>
          <h2>{turnSecondsLeft}s remaining</h2>
                       <p>Team Mango 🥭, Points: {state.teamAScore}</p>
              <p>Team Peach 🍑, Points: {state.teamBScore}</p>
            </>
          ) : (
            <>
            <p><b>Round {state.roundNumber}: {roundName(state.roundNumber)}</b></p>
          <h2>{turnSecondsLeft}s remaining</h2>
          <p>{teamLabel(state.activeTeam)} is guessing. {activeClueGiverName} is drawing from the bowl.</p><p>{state.promptsRemaining} prompts left in the bowl.</p>
          
              <br></br>
              <p><b>Team Mango 🥭, Points: {state.teamAScore}</b></p>
              <p><b>Team Peach 🍑, Points: {state.teamBScore}</b></p>
            </>
          )}
        </>
      )}

      {state.phase === "turn_ready" && (
        <>
          <p><b>Round {state.roundNumber}: {roundName(state.roundNumber)}</b></p>
          {isClueGiver ? (
            <>
              <h2>Your turn to draw from the bowl.</h2>
              <p>{teamLabel(state.activeTeam)}, get ready.</p><p></p>
              <p>When you are ready, start the 30 second timer.</p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy}>
                {busy ? "Loading..." : "Start timer"}
              </button>
            </>
          ) : (
            <>
              <h2>It's {activeClueGiverName}'s turn.</h2>
              <p>{teamLabel(state.activeTeam)}, get ready.</p><p></p><p></p>
              <p>Waiting for {activeClueGiverName} to start the timer.</p>
            </>
          )}

          <div className="players-panel">
            <p className="body-text left"><b>Team Mango 🥭, Points: {state.teamAScore}</b></p>
            <div className="player-grid teams eg">
              {state.teamA.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>

          <div className="players-panel">
            <p className="body-text left"><b>Team Peach 🍑, Points: {state.teamBScore}</b></p>
            <div className="player-grid teams pe">
              {state.teamB.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {state.phase === "turn_summary" && (
        <>
          <h2>Turn over</h2>
          <p>{teamLabel(state.lastTurnTeam)} scored {state.lastTurnPoints}</p>
          <p>{state.promptsRemaining} prompts left in the bowl.</p>
        </>
      )}

      {state.phase === "round_results" && (
        <>
          <h2>Round {state.roundNumber} complete!</h2>
          <p>Same prompts next round, but new rules.</p><p></p>
          <div className="bottom-row">
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : isWaitingOnYou ? "Continue" : "Waiting for others"}
            </button>
            <button type="button" className="btn btn-soft" onClick={() => setShowDisputeModal(true)}>
              Dispute Score
            </button>
          </div>
                    <div className="players-panel">
            <p className="body-text left"><b>Team Mango 🥭, Points: {state.teamAScore}</b></p>
            <div className="player-grid teams eg">
              {state.teamA.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>

          <div className="players-panel">
            <p className="body-text left"><b>Team Peach 🍑, Points: {state.teamBScore}</b></p>
            <div className="player-grid teams pe">
              {state.teamB.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>
            {state.teamAScore === state.teamBScore
              ? "It's a tie."
              : state.teamAScore > state.teamBScore
                ? "Team Mango 🥭 wins Fruit Bowl!"
                : "Team Peach 🍑 wins Fruit Bowl!"}
          </h2>
          <p>Want to play again?</p>
          <p></p><p></p>
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
          <p></p>
                              <div className="players-panel">
            <p className="body-text left"><b>Team Mango 🥭, Points: {state.teamAScore}</b></p>
            <div className="player-grid teams eg">
              {state.teamA.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>
          
          <div className="players-panel">
            <p className="body-text left"><b>Team Peach 🍑, Points: {state.teamBScore}</b></p>
            <div className="player-grid teams pe">
              {state.teamB.map((member) => (
                <div key={member.id} className="player-pill team">
                  {member.name}
                </div>
              ))}
            </div>
          </div>
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

      {showDisputeModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Stickler for the rules?</h2>
            <p>
              Remember, it's just a game. Some advice: Worry less about cheating.</p><p>Worry more about destroying the other team with your awesome descriptions & acting skills!</p>
            <button className="btn btn-key" type="button" onClick={() => setShowDisputeModal(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}


