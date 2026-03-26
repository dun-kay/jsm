import { useEffect, useState } from "react";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";
import {
  continueFakeFamous,
  getFakeFamousState,
  initFakeFamous,
  playAgainFakeFamous,
  submitFakeFamousSpeakerVote,
  submitFakeFamousTruthVote,
  type FakeFamousState
} from "../../lib/fakeFamousApi";
import { getGameIntroRules } from "../rules";
import quotePool from "./quotePool.json";

type FakeFamousRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

function isWaitingOnYou(state: FakeFamousState): boolean {
  return state.waitingOn.includes(state.you.id);
}

function playerName(state: FakeFamousState, playerId: string | null): string {
  if (!playerId) {
    return "";
  }
  return state.players.find((p) => p.id === playerId)?.name || "";
}

function namesFromIds(state: FakeFamousState, ids: string[]): string {
  if (ids.length === 0) {
    return "None";
  }
  return ids.map((id) => playerName(state, id)).filter(Boolean).join(", ");
}

function formatWinnerNames(state: FakeFamousState, ids: string[]): string {
  const names = ids.map((id) => playerName(state, id)).filter(Boolean);
  if (names.length <= 1) {
    return names[0] || "No winner";
  }
  if (names.length === 2) {
    return `${names[0]} & ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

export default function FakeFamousRuntime({ gameCode, playerToken }: FakeFamousRuntimeProps) {
  const introRules = getGameIntroRules("fake-famous");
  const [state, setState] = useState<FakeFamousState | null>(null);
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
        const next = await initFakeFamous(gameCode, playerToken, quotePool);
        if (!active) {
          return;
        }
        setState(next);
        setErrorText("");
      } catch (error) {
        if (!active) {
          return;
        }
        const message = ((error as Error).message || "").toLowerCase();
        if (message.includes("host must initialize")) {
          try {
            const next = await initFakeFamous(gameCode, playerToken, null);
            if (!active) {
              return;
            }
            setState(next);
            setErrorText("");
          } catch (inner) {
            if (!active) {
              return;
            }
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
        const next = await getFakeFamousState(gameCode, playerToken);
        if (!active) {
          return;
        }
        setState(next);
      } catch {
        // keep state on transient poll failures
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
      const next = await continueFakeFamous(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function voteTruth(choice: "real" | "fake") {
    if (!state || busy || state.phase !== "truth_vote" || state.activePlayerId === state.you.id) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitFakeFamousTruthVote(gameCode, playerToken, choice);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit vote.");
    } finally {
      setBusy(false);
    }
  }

  async function voteSpeaker(speaker: string) {
    if (!state || busy || state.phase !== "speaker_vote" || state.activePlayerId === state.you.id) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await submitFakeFamousSpeakerVote(gameCode, playerToken, speaker);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to submit speaker vote.");
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
      const next = await playAgainFakeFamous(gameCode, playerToken, quotePool);
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
        <h2>Fake Famous</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  const activeName = playerName(state, state.activePlayerId);
  const card = state.currentCard;
  const truthLabel = card?.isReal ? "Real" : "Fake";
  const selectedTruthVote = state.truthVotes[state.you.id];
  const selectedSpeakerVote = state.speakerVotes[state.you.id];

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

      {state.phase === "round_intro" && (
        <>
          <h2>Round {state.roundNumber}</h2>
          <p>Everyone reads out a quote.<p></p>You guess if it's fake or not & who said it (impressions may be involved).</p>
          <br></br>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? " Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "quote_reveal" && (
        <>
          {state.activePlayerId === state.you.id ? (
            <>
              <p>Your quote:</p>
              <h2>"{card?.quoteText || "..."}"</h2>
              <br></br>
              <p>Read the quote out loud.</p>
              <p>Do not reaveal that the quote is: {truthLabel}.</p><br></br>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
                {busy ? "Loading..." : "Continue..."}
              </button>
            </>
          ) : (
            <>
              <h2>{activeName} is reading the quote...</h2>
              <br></br>
              <p>Listen carefully.</p>
            </>
          )}
        </>
      )}

      {state.phase === "truth_vote" && (
        <>
          <p><b>Quote vote:</b></p>
          <p>Real or Fake?</p>
          <p></p>
          <h2>"{card?.quoteText || "..."}"</h2><br></br>
          {state.activePlayerId === state.you.id ? (
            <p>Waiting for everyone to vote...</p>
          ) : (
            <>
              <div className="bottom-row">
                <button
                  type="button"
                  className={selectedTruthVote === "real" ? "btn btn-key" : "btn btn-key"}
                  onClick={() => void voteTruth("real")}
                  disabled={busy || Boolean(selectedTruthVote)}
                >
                  Real
                </button>
                <button
                  type="button"
                  className={selectedTruthVote === "fake" ? "btn btn-key" : "btn btn-key"}
                  onClick={() => void voteTruth("fake")}
                  disabled={busy || Boolean(selectedTruthVote)}
                >
                  Fake
                </button>
              </div>
              {selectedTruthVote && (
                <p className="hint-text nb">You selected {selectedTruthVote}...</p>
              )}
            </>
          )}
        </>
      )}

      {state.phase === "truth_result" && (
        <>
        <p>Reveal:</p>
          <h2>"{card?.quoteText || "..."}"</h2>
          <br></br>
          <p><b>It's a: {truthLabel} quote!</b></p>
          <br></br>
          <p>+1 point for: <b>{namesFromIds(state, state.truthWinners)}</b></p>
          {state.activePlayerId === state.you.id ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
              {busy ? "Loading..." : "Continue"}
            </button>
          ) : (
            <p className="hint-text nb">Waiting for {activeName} to click continue...</p>
          )}
        </>
      )}

      {state.phase === "impression" && (
        <>
          {state.activePlayerId === state.you.id ? (
            <>
              <h2>Now do the impression...</h2><br></br>
              <p>Quote: "{card?.quoteText || "..."}"</p>
              <p><b>Who said it: {card?.correctSpeaker || ""}</b></p>
              <p>Tip: {card?.impressionTip || ""}</p><br></br>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
                {busy ? "Loading..." : "Continue..."}
              </button>
            </>
          ) : (
            <>
              <h2>{activeName} is doing an impression...</h2>
              <p></p>
              <p>Get ready to guess was said the quote.</p>
            </>
          )}
        </>
      )}

      {state.phase === "speaker_vote" && (
        <>
          <h2>Who said it?</h2><p></p>
          {state.activePlayerId === state.you.id ? (
            <p>Waiting for everyone to guess...</p>
          ) : (
            <>
              <div className="runtime-list">
                {(card?.speakerOptions || []).map((speaker) => (
                  <button
                    key={speaker}
                    type="button"
                    className={selectedSpeakerVote === speaker ? "btn btn-key" : "btn btn-soft"}
                    onClick={() => void voteSpeaker(speaker)}
                    disabled={busy || Boolean(selectedSpeakerVote)}
                  >
                    {speaker}
                  </button>
                ))}
              </div>
              {selectedSpeakerVote && (
                <p className="hint-text nb">You selected {selectedSpeakerVote}...</p>
              )}
            </>
          )}
        </>
      )}

      {state.phase === "turn_result" && (
        <>
          <h2>Turn result, "{card?.quoteText || "..."}"</h2>
          <p></p>
          <p>The quote was: {truthLabel}</p>
          <p>Speaker: {card?.correctSpeaker || ""}</p><p></p>
          <p>Score:</p>
          <div className="player-grid teams">
            {state.players.map((p) => (
              <div key={p.id} className="player-pill team">{p.name}: {p.score} points</div>
            ))}
          </div><p></p>
          {state.activePlayerId === state.you.id ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
              {busy ? "Loading..." : "Continue"}
            </button>
          ) : (
            <p className="hint-text nb">Waiting for {activeName} to click continue...</p>
          )}
        </>
      )}

      {state.phase === "round_result" && (
        <>
          <h2>Round {Math.max(1, state.roundNumber - 1)} complete...</h2>
          <p></p><p>Score:</p>
          <div className="player-grid teams">
            {state.players.map((p) => (
              <div key={p.id} className="player-pill team">{p.name}: {p.score} points</div>
            ))}
          </div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>
            {state.winnerIds.length <= 1
              ? `Final result, the winner is ${formatWinnerNames(state, state.winnerIds)}!`
              : `Final result, the winners are ${formatWinnerNames(state, state.winnerIds)}!`}
          </h2><br></br>
          <p>Final score:</p>
          <div className="player-grid teams">
            {state.players
              .slice()
              .sort((a, b) => b.score - a.score)
              .map((p) => (
                <div key={p.id} className="player-pill team">{p.name}: {p.score} points</div>
              ))}
          </div>
          <br></br>
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
