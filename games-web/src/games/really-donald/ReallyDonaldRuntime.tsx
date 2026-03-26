import { useEffect, useState } from "react";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";
import {
  continueReallyDonald,
  getReallyDonaldState,
  initReallyDonald,
  playAgainReallyDonald,
  submitReallyDonaldSpeakerVote,
  submitReallyDonaldTruthVote,
  type ReallyDonaldState
} from "../../lib/reallyDonaldApi";
import { getGameIntroRules } from "../rules";
import quotePool from "./quotePool.json";

type ReallyDonaldRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

function isWaitingOnYou(state: ReallyDonaldState): boolean {
  return state.waitingOn.includes(state.you.id);
}

function playerName(state: ReallyDonaldState, playerId: string | null): string {
  if (!playerId) {
    return "";
  }
  return state.players.find((p) => p.id === playerId)?.name || "";
}

function namesFromIds(state: ReallyDonaldState, ids: string[]): string {
  if (ids.length === 0) {
    return "None";
  }
  return ids.map((id) => playerName(state, id)).filter(Boolean).join(", ");
}

export default function ReallyDonaldRuntime({ gameCode, playerToken }: ReallyDonaldRuntimeProps) {
  const introRules = getGameIntroRules("really-donald");
  const [state, setState] = useState<ReallyDonaldState | null>(null);
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
        const next = await initReallyDonald(gameCode, playerToken, quotePool);
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
            const next = await initReallyDonald(gameCode, playerToken, null);
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
        const next = await getReallyDonaldState(gameCode, playerToken);
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
      const next = await continueReallyDonald(gameCode, playerToken);
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
      const next = await submitReallyDonaldTruthVote(gameCode, playerToken, choice);
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
      const next = await submitReallyDonaldSpeakerVote(gameCode, playerToken, speaker);
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
      const next = await playAgainReallyDonald(gameCode, playerToken, quotePool);
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
        <h2>Really Donald?</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  const activeName = playerName(state, state.activePlayerId);
  const card = state.currentCard;
  const truthLabel = card?.isReal ? "Real" : "Fake";

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
          <p>Everyone gets one turn this round.</p>
          <div className="player-grid teams">
            {state.players.map((p) => (
              <div key={p.id} className="player-pill team">{p.name}: {p.score}</div>
            ))}
          </div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "quote_reveal" && (
        <>
          {state.activePlayerId === state.you.id ? (
            <>
              <h2>Your quote</h2>
              <p><b>{card?.quoteText || "..."}</b></p>
              <p>Real/Fake answer: <b>{truthLabel}</b></p>
              <p>Correct speaker: <b>{card?.correctSpeaker || ""}</b></p>
              <p>Read this quote out loud. Do not reveal the answer yet.</p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
                {busy ? "Loading..." : "Ready"}
              </button>
            </>
          ) : (
            <>
              <h2>{activeName} is reading the quote</h2>
              <p>Listen carefully.</p>
            </>
          )}
        </>
      )}

      {state.phase === "truth_vote" && (
        <>
          <h2>Real or Fake?</h2>
          <p><b>{card?.quoteText || "..."}</b></p>
          {state.activePlayerId === state.you.id ? (
            <p>Waiting for everyone to vote...</p>
          ) : (
            <div className="bottom-row">
              <button type="button" className="btn btn-key" onClick={() => void voteTruth("real")} disabled={busy}>Real</button>
              <button type="button" className="btn btn-soft" onClick={() => void voteTruth("fake")} disabled={busy}>Fake</button>
            </div>
          )}
        </>
      )}

      {state.phase === "truth_result" && (
        <>
          <h2>Truth reveal</h2>
          <p><b>{card?.quoteText || "..."}</b></p>
          <p>It was: <b>{truthLabel}</b></p>
          <p>+1 for Real/Fake: <b>{namesFromIds(state, state.truthWinners)}</b></p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "impression" && (
        <>
          {state.activePlayerId === state.you.id ? (
            <>
              <h2>Now do the impression</h2>
              <p>Speaker: <b>{card?.correctSpeaker || ""}</b></p>
              <p>Tip: <b>{card?.impressionTip || ""}</b></p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
                {busy ? "Loading..." : "Ready for guesses"}
              </button>
            </>
          ) : (
            <>
              <h2>{activeName} is doing the impression...</h2>
              <p>Get ready to guess the speaker.</p>
            </>
          )}
        </>
      )}

      {state.phase === "speaker_vote" && (
        <>
          <h2>Who said it?</h2>
          {state.activePlayerId === state.you.id ? (
            <p>Waiting for everyone to guess who said it...</p>
          ) : (
            <div className="runtime-list">
              {(card?.speakerOptions || []).map((speaker) => (
                <button key={speaker} type="button" className="btn btn-soft" onClick={() => void voteSpeaker(speaker)} disabled={busy}>
                  {speaker}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {state.phase === "turn_result" && (
        <>
          <h2>Turn result</h2>
          <p><b>{card?.quoteText || "..."}</b></p>
          <p>It was: <b>{truthLabel}</b></p>
          <p>Speaker: <b>{card?.correctSpeaker || ""}</b></p>
          <p>+1 for Real/Fake: <b>{namesFromIds(state, state.truthWinners)}</b></p>
          <p>+1 for Speaker: <b>{namesFromIds(state, state.speakerWinners)}</b></p>
          <div className="player-grid teams">
            {state.players.map((p) => (
              <div key={p.id} className="player-pill team">{p.name}: {p.score}</div>
            ))}
          </div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "round_result" && (
        <>
          <h2>Round {Math.max(1, state.roundNumber - 1)} complete</h2>
          <div className="player-grid teams">
            {state.players.map((p) => (
              <div key={p.id} className="player-pill team">{p.name}: {p.score}</div>
            ))}
          </div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Continue" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>Final results</h2>
          <div className="player-grid teams">
            {state.players
              .slice()
              .sort((a, b) => b.score - a.score)
              .map((p) => (
                <div key={p.id} className="player-pill team">{p.name}: {p.score}</div>
              ))}
          </div>
          {state.winnerIds.length > 0 && (
            <p>
              Winner{state.winnerIds.length > 1 ? "s" : ""}: <b>{namesFromIds(state, state.winnerIds)}</b>
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
