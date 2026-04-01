import { useEffect, useMemo, useState } from "react";
import AccessPaywallModal from "../../components/AccessPaywallModal";
import { usePlayAccess } from "../../lib/usePlayAccess";
import {
  continueWormyWorm,
  getWormyWormState,
  initWormyWorm,
  playAgainWormyWorm,
  rerollWormyPenalty,
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

export default function WormyWormRuntime({ gameCode, playerToken }: WormyWormRuntimeProps) {
  const introRules = getGameIntroRules("wormy-worm");
  const autoPenalties = useMemo(() => flattenPenalties(penaltyPool), []);
  const [state, setState] = useState<WormyWormState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [customPenalty, setCustomPenalty] = useState<string>("");
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

  const myId = state?.you.id || "";
  const isWaitingOnYou = Boolean(state?.waitingOn.includes(myId));
  const isDrawer = Boolean(state?.currentDrawerId === myId);
  const currentDrawerName = state ? playerName(state, state.currentDrawerId) : "";
  const sortedByLowest = state
    ? state.players.slice().sort((a, b) => a.wormsTotal - b.wormsTotal || a.turnOrder - b.turnOrder)
    : [];
  const trimmedPenalty = customPenalty.trim();
  const atLimit = customPenalty.length >= 20;

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
      <p className="hint-text nb">
        <b>Penalty:</b> {state.penaltyText || "Not set yet"}
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
          <h2>Set penalties</h2>
          {state.you.isHost ? (
            <div className="runtime-list">
              <button type="button" className="btn btn-key" onClick={() => void doModePick("auto")} disabled={busy}>
                Auto penalties
              </button>
              <p className="hint-text nb">E.g. Do a silly dance</p>
              <button type="button" className="btn btn-soft" onClick={() => void doModePick("own")} disabled={busy}>
                Own penalties
              </button>
              <p className="hint-text nb">E.g. Drink, do the dishes</p>
            </div>
          ) : (
            <p className="hint-text nb">Waiting for host to choose penalty mode...</p>
          )}
        </>
      )}

      {state.phase === "penalty_custom" && (
        <>
          <h2>Set your penalty</h2>
          {state.you.isHost ? (
            <>
              <input
                className="text-input"
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
          <h2>Penalty locked in</h2>
          {state.you.isHost && state.penaltyMode === "auto" && (
            <button type="button" className="btn btn-soft runtime-reroll-btn" onClick={() => void doRerollPenalty()} disabled={busy}>
              Re-spin penalty
            </button>
          )}
          {!state.you.isHost && state.penaltyMode === "auto" && (
            <button type="button" className="btn btn-soft runtime-reroll-btn" disabled>
              Host can re-spin
            </button>
          )}
          <p className="body-text">Each player draws 3 worms. Most worms wins.</p>
          {state.you.isHost ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : "Start drawing"}
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
              <h2>Your draw</h2>
              <p className="body-text">Swipe up from the bucket.</p>
              <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
                {busy ? "Loading..." : "Swipe up"}
              </button>
            </>
          ) : (
            <>
              <h2>{currentDrawerName} is drawing...</h2>
              <p className="hint-text nb">Waiting for their worm pull.</p>
            </>
          )}
        </>
      )}

      {state.phase === "draw_result" && (
        <>
          <h2>{currentDrawerName} pulled {state.currentDrawCount ?? 0} worms</h2>
          <p className="body-text">Current scoreboard (lowest first):</p>
          <div className="player-grid teams ne">
            {sortedByLowest.map((player) => (
              <div key={player.id} className="player-pill team">
                {player.name}: {player.wormsTotal}
              </div>
            ))}
          </div>
          {isDrawer ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
              {busy ? "Loading..." : "Continue"}
            </button>
          ) : (
            <p className="hint-text nb">Waiting for {currentDrawerName} to click continue...</p>
          )}
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>Wormy Worm results</h2>
          <p>Most worms wins:</p>
          <div className="player-grid teams ne">
            {state.players
              .slice()
              .sort((a, b) => b.wormsTotal - a.wormsTotal || a.turnOrder - b.turnOrder)
              .map((player) => (
                <div key={player.id} className="player-pill team">
                  {player.name}: {player.wormsTotal}
                </div>
              ))}
          </div>
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

