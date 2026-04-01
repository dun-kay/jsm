import { useEffect, useMemo, useRef, useState } from "react";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";
import {
  continueWormyWorm,
  getWormyWormState,
  initWormyWorm,
  playAgainWormyWorm,
  rerollWormyPenalty,
  startWormyPull,
  setWormyCustomPenalty,
  setWormyPenaltyMode,
  type WormyWormState
} from "../../lib/wormyWormApi";
import { getGameIntroRules } from "../rules";
import penaltyPool from "./penaltyPool.json";

type WormyWormRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

function flattenPenalties(pool: unknown): string[] {
  if (Array.isArray(pool)) {
    return pool.map(String).filter((v) => v.trim().length > 0);
  }
  if (pool && typeof pool === "object") {
    const penalties = (pool as { penalties?: unknown[] }).penalties;
    if (Array.isArray(penalties)) {
      return penalties.map(String).filter((v) => v.trim().length > 0);
    }
  }
  return [];
}

function playerName(state: WormyWormState, playerId: string | null): string {
  if (!playerId) return "";
  return state.players.find((p) => p.id === playerId)?.name || "";
}

const WORM_EMOJI = "🪱";
const BUCKET_EMOJI = "🪣";

export default function WormyWormRuntime({ gameCode, playerToken }: WormyWormRuntimeProps) {
  const introRules = getGameIntroRules("wormy-worm");
  const autoPenalties = useMemo(() => flattenPenalties(penaltyPool), []);
  const [state, setState] = useState<WormyWormState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [customPenalty, setCustomPenalty] = useState<string>("");
  const [showPostReveal, setShowPostReveal] = useState<boolean>(false);
  const [isPullAnimating, setIsPullAnimating] = useState<boolean>(false);
  const [animatedWormCount, setAnimatedWormCount] = useState<number>(0);
  const [viewerWormCount, setViewerWormCount] = useState<number>(1);
  const [rulesPaywallPrimed, setRulesPaywallPrimed] = useState<boolean>(false);
  const pullStepTimerRef = useRef<number | null>(null);
  const pullEndTimerRef = useRef<number | null>(null);
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
        const next = await initWormyWorm(gameCode, playerToken, autoPenalties);
        if (!active) return;
        setState(next);
        setErrorText("");
      } catch (error) {
        if (!active) return;
        const message = ((error as Error).message || "").toLowerCase();
        if (message.includes("host must initialize")) {
          try {
            const next = await initWormyWorm(gameCode, playerToken, null);
            if (!active) return;
            setState(next);
            setErrorText("");
          } catch (inner) {
            if (!active) return;
            setErrorText((inner as Error).message || "Failed to load game runtime.");
          }
          return;
        }
        setErrorText((error as Error).message || "Failed to load game runtime.");
      }
    };

    void bootstrap();

    let pollInFlight = false;
    const interval = window.setInterval(async () => {
      if (pollInFlight || document.hidden) {
        return;
      }
      pollInFlight = true;
      try {
        const next = await getWormyWormState(gameCode, playerToken);
        if (!active) return;
        setState(next);
      } catch {
        // keep state on transient poll failures
      } finally {
        pollInFlight = false;
      }
    }, 1800);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameCode, playerToken, autoPenalties]);

  useEffect(() => {
    if (!state) return;
    if (state.phase !== "rules") {
      setRulesPaywallPrimed(false);
      return;
    }
    if (rulesPaywallPrimed) return;
    setRulesPaywallPrimed(true);
    void primePaywallIfExhausted().catch((error) => {
      setAccessError((error as Error).message || "Unable to load play access.");
    });
  }, [state?.phase, state, rulesPaywallPrimed, primePaywallIfExhausted, setAccessError]);

  useEffect(() => {
    if (!state || state.phase !== "draw_result") {
      setShowPostReveal(false);
      return;
    }

    setShowPostReveal(false);
    const timer = window.setTimeout(() => {
      setShowPostReveal(true);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state?.phase, state?.turnIndex, state?.currentDrawerId, state?.currentDrawCount]);

  useEffect(() => {
    if (state?.phase !== "draw_reveal") {
      setIsPullAnimating(false);
      setAnimatedWormCount(0);
      setViewerWormCount(1);
      if (pullStepTimerRef.current) {
        window.clearTimeout(pullStepTimerRef.current);
        pullStepTimerRef.current = null;
      }
      if (pullEndTimerRef.current) {
        window.clearTimeout(pullEndTimerRef.current);
        pullEndTimerRef.current = null;
      }
    }
  }, [state?.phase]);

  useEffect(() => {
    const viewerIsDrawer = Boolean(
      state?.currentDrawerId &&
      state?.you?.id &&
      state.currentDrawerId === state.you.id
    );

    if (!state || state.phase !== "draw_reveal" || viewerIsDrawer || !state.pullInProgress) {
      return;
    }

    const target = Math.max(1, state.currentDrawCount ?? 1);
    let current = 0;

    const interval = window.setInterval(() => {
      current += 1;
      setViewerWormCount(Math.min(current, target));
      if (current >= target) {
        window.clearInterval(interval);
      }
    }, 190);

    return () => {
      window.clearInterval(interval);
    };
  }, [state?.phase, state?.currentDrawerId, state?.you?.id, state?.pullInProgress, state?.currentDrawCount]);

  useEffect(() => {
    return () => {
      if (pullStepTimerRef.current) {
        window.clearTimeout(pullStepTimerRef.current);
      }
      if (pullEndTimerRef.current) {
        window.clearTimeout(pullEndTimerRef.current);
      }
    };
  }, []);

  const myId = state?.you.id || "";
  const isWaitingOnYou = Boolean(state?.waitingOn.includes(myId));
  const isDrawer = Boolean(state?.currentDrawerId === myId);
  const currentDrawerName = state ? playerName(state, state.currentDrawerId) : "";
  const sortedByLowest = state
    ? state.players.slice().sort((a, b) => a.wormsTotal - b.wormsTotal || a.turnOrder - b.turnOrder)
    : [];
  const lowestScore = sortedByLowest.length > 0 ? sortedByLowest[0].wormsTotal : 0;
  const lowestPlayersText = sortedByLowest
    .filter((player) => player.wormsTotal === lowestScore)
    .map((player) => player.name)
    .join(", ");
  const trimmedPenalty = customPenalty.trim();
  const atLimit = customPenalty.length >= 20;
  const drawCount = state?.currentDrawCount ?? 0;
  const wormWord = drawCount === 1 ? "worm" : "worms";
  const wormsEmoji = WORM_EMOJI.repeat(Math.max(0, drawCount));
  const animWormsEmoji = WORM_EMOJI.repeat(Math.max(1, animatedWormCount));
  const viewerWormsEmoji = WORM_EMOJI.repeat(Math.max(1, viewerWormCount));

  function runPullAnimationThenContinue() {
    if (!state || busy || !isWaitingOnYou || !isDrawer || isPullAnimating) {
      return;
    }

    void (async () => {
      setBusy(true);
      setErrorText("");
      try {
        const started = await startWormyPull(gameCode, playerToken);
        setState(started);

        const target = Math.max(1, drawCount);
        let current = 0;
        setIsPullAnimating(true);
        setAnimatedWormCount(1);

        const tick = () => {
          current += 1;
          setAnimatedWormCount(Math.min(current, target));

          if (current >= target) {
            pullEndTimerRef.current = window.setTimeout(async () => {
              await doContinue();
              setIsPullAnimating(false);
              setAnimatedWormCount(0);
            }, 1780);
            return;
          }

          pullStepTimerRef.current = window.setTimeout(tick, 190);
        };

        pullStepTimerRef.current = window.setTimeout(tick, 190);
      } catch (error) {
        setErrorText((error as Error).message || "Unable to start pull.");
      } finally {
        setBusy(false);
      }
    })();
  }

  async function doContinue() {
    if (!state || busy || !isWaitingOnYou) return;

    if (state.phase === "rules") {
      try {
        const ok = await ensureSessionAccess(gameCode);
        if (!ok) return;
      } catch (error) {
        setAccessError((error as Error).message || "Unable to validate play access.");
        return;
      }
    }

    setBusy(true);
    setErrorText("");
    try {
      const next = await continueWormyWorm(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function doModePick(mode: "auto" | "own") {
    if (!state || busy || !state.you.isHost || state.phase !== "penalty_mode") return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await setWormyPenaltyMode(gameCode, playerToken, mode);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to set penalty mode.");
    } finally {
      setBusy(false);
    }
  }

  async function doSaveCustomPenalty() {
    if (!state || busy || !state.you.isHost || state.phase !== "penalty_custom") return;
    if (!trimmedPenalty) {
      setErrorText("Penalty is required.");
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await setWormyCustomPenalty(gameCode, playerToken, trimmedPenalty);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to save penalty.");
    } finally {
      setBusy(false);
    }
  }

  async function doRerollPenalty() {
    if (!state || busy || !state.you.isHost || state.phase !== "penalty_ready" || state.penaltyMode !== "auto") return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await rerollWormyPenalty(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to re-spin penalty.");
    } finally {
      setBusy(false);
    }
  }

  async function doPlayAgain() {
    if (!state || busy || !state.you.isHost) return;
    setBusy(true);
    setErrorText("");
    try {
      const next = await playAgainWormyWorm(gameCode, playerToken, autoPenalties);
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
        <h2>Wormy Worm</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  return (
    <section className="runtime-card runtime-flow">
      <p>
        Penalty for loser:
        <p></p>
        <b>{state.penaltyText || "Not set yet"}</b>
      </p>

      {state.phase === "rules" && (
        <>
          <h2>{introRules.title}</h2>
          <div className="rules-modal-content">{introRules.content}</div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "penalty_mode" && (
        <>
          <h2>Set penalties</h2> <p></p>
          {state.you.isHost ? (
            <div className="runtime-list">
              <button type="button" className="btn btn-key" onClick={() => void doModePick("auto")} disabled={busy}>
                Auto penalty
              </button>
              <p className="hint-text nb">E.g. Do a chicken dance, let someone reply to one message...</p>
              <p></p>
              <button type="button" className="btn btn-soft" onClick={() => void doModePick("own")} disabled={busy}>
                Own penalty
              </button>
              <p className="hint-text nb">You enter a custom penalty, (do the dishes, pay for dinner)...</p>
            </div>
          ) : (
            <p className="hint-text nb">Waiting for host to choose penalty mode...</p>
          )}
        </>
      )}

      {state.phase === "penalty_custom" && (
        <>
          <h2>Set your penalty...</h2>
          {state.you.isHost ? (
            <>
            <label className="field-wrap">
              <input
                className="input-pill"
                value={customPenalty}
                onChange={(event) => setCustomPenalty(event.target.value.slice(0, 20))}
                placeholder="Enter penalty"
                maxLength={20}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void doSaveCustomPenalty();
                  }
                }}
              />
              </label><p></p>
              {atLimit && <p className="hint-text">Max 20 characters reached.</p>}
              <button type="button" className="btn btn-key" onClick={() => void doSaveCustomPenalty()} disabled={busy || !trimmedPenalty}>
                {busy ? "Saving..." : "Save penalty"}
              </button>
            </>
          ) : (
            <p className="hint-text nb">Host is setting the penalty...</p>
          )}
        </>
      )}

      {state.phase === "penalty_ready" && (
        <>
          {state.you.isHost && state.penaltyMode === "auto" && (
            <div>
              <button type="button" className="btn btn-soft runtime-reroll-btn" onClick={() => void doRerollPenalty()} disabled={busy}>
                Re-spin penalty
              </button>
            </div>
          )}
          {!state.you.isHost && state.penaltyMode === "auto" && (
            <div>
              <button type="button" className="btn btn-soft runtime-reroll-btn" disabled>
                Host can re-spin
              </button>
            </div>
          )}
          <p></p><p className="body-text">Each player draws a worm over 3 rounds.<p></p><b>Most {WORM_EMOJI} wins.</b></p><p></p>
          {state.you.isHost ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : "Start"}
            </button>
          ) : (
            <p className="hint-text nb">Waiting for host to start the game...</p>
          )}
        </>
      )}

      {state.phase === "draw_reveal" && (
        <>
          {isDrawer ? (
            <>
              <p></p><p><b><u>Round {state.roundNumber}/3</u></b></p>
              <h2>Your draw:</h2>
              <p className="body-text">Pull a worm from the bucket...</p>
              <div className="wormy-stack">
                <div className={`wormy wormy-over-pot ${isPullAnimating ? "wormy-pop wormy-shake" : ""}`}>
                  {isPullAnimating ? animWormsEmoji : ""}
                </div>
                <div className={`pot ${isPullAnimating ? "pot-shake" : ""}`}>{BUCKET_EMOJI}</div>
              </div>
              <button
                type="button"
                className="btn btn-key"
                onClick={() => runPullAnimationThenContinue()}
                disabled={busy || !isWaitingOnYou || isPullAnimating || state.pullInProgress}
              >
                {busy ? "Loading..." : isPullAnimating ? "Pulling..." : `Pull a ${WORM_EMOJI}?`}
              </button>
            </>
          ) : (
            <>
            <p></p><p><b><u>Round {state.roundNumber}/3</u></b></p>
              <h2>{currentDrawerName} is drawing a worm from the bucket...</h2>
              <div className="wormy-stack">
                <div className={`wormy wormy-over-pot ${state.pullInProgress ? "wormy-pop wormy-shake" : ""}`}>
                  {state.pullInProgress ? viewerWormsEmoji : ""}
                </div>
                <div className={`pot ${state.pullInProgress ? "pot-shake" : ""}`}>{BUCKET_EMOJI}</div>
              </div>
              <p className="hint-text nb">Waiting for their {WORM_EMOJI} pull...</p>
            </>
          )}
        </>
      )}

      {state.phase === "draw_result" && (
        <><p></p>
          <p><b><u>Round {state.roundNumber}/3</u></b></p>
          <h2>{currentDrawerName} pulled: {drawCount} {wormWord}</h2>
          <div className="wormy">{wormsEmoji || WORM_EMOJI}</div>
          <p></p>
          {showPostReveal && (
            <>
           
              <p className="body-text">Current scores, round {state.roundNumber}/3:</p>
              <div className="player-grid teams ww">
                {sortedByLowest.map((player) => (
                  <div key={player.id} className="player-pill team">
                    {player.name}: {player.wormsTotal} {WORM_EMOJI}
                  </div>
                ))}
              </div>
              <p></p>
              {isDrawer ? (
                <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
                  {busy ? "Loading..." : "Continue"}
                </button>
              ) : (
                <p className="hint-text nb">Waiting for {currentDrawerName} to click continue...</p>
              )}
            </>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>Wormy Worm loser: {lowestPlayersText}</h2>
          <p><u>{lowestPlayersText} must do the penalty...</u></p>
          <p></p>
          <p>Final worm scores:</p>
          <div className="player-grid teams ww">
            {state.players
              .slice()
              .sort((a, b) => b.wormsTotal - a.wormsTotal || a.turnOrder - b.turnOrder)
              .map((player) => (
                <div key={player.id} className="player-pill team">
                  {player.name}: {player.wormsTotal} {WORM_EMOJI}
                </div>
              ))}
          </div><p></p>
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
