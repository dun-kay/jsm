import { useEffect, useMemo, useRef, useState } from "react";
import {
  continueDrawWf,
  getDrawWfState,
  setDrawWfDisplayName,
  submitDrawWfDrawing,
  submitDrawWfGuess,
  type DrawWfState
} from "../../lib/drawWfApi";
import wordPool from "./wordPool.json";

type DrawWfRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

type StrokePoint = { x: number; y: number; t: number };
type Stroke = { points: StrokePoint[] };
type ReplayPayload = { width: number; height: number; strokes: Stroke[] };

type TurnWallet = {
  freeTurns: number;
  paidTurns: number;
  paidExpiresAt: number;
  lastRegenAt: number;
};

const TURN_WALLET_KEY = "drawwf_turn_wallet_v1";
const TURN_MARK_PREFIX = "drawwf_turn_mark_";
const FREE_START = 10;
const FREE_REGEN = 5;
const REGEN_MS = 4 * 60 * 60 * 1000;
const FREE_CAP = 20;
const PAID_TURNS = 100;
const PAID_MS = 7 * 24 * 60 * 60 * 1000;
const TURN_SECONDS = 10;
const NAME_SET_PREFIX = "dwf_name_set_";
const MAX_NAME_LENGTH = 10;

function flattenWords(pool: unknown): string[] {
  if (!pool || typeof pool !== "object") return [];
  const words = (pool as { words?: unknown[] }).words;
  if (!Array.isArray(words)) return [];
  return words.map((w) => String(w).trim().toUpperCase()).filter((w) => w.length >= 3 && w.length <= 6);
}

function nowMs() {
  return Date.now();
}

function readWallet(): TurnWallet {
  try {
    const raw = localStorage.getItem(TURN_WALLET_KEY);
    if (!raw) {
      return { freeTurns: FREE_START, paidTurns: 0, paidExpiresAt: 0, lastRegenAt: nowMs() };
    }
    const parsed = JSON.parse(raw) as TurnWallet;
    return {
      freeTurns: Number(parsed.freeTurns ?? FREE_START),
      paidTurns: Number(parsed.paidTurns ?? 0),
      paidExpiresAt: Number(parsed.paidExpiresAt ?? 0),
      lastRegenAt: Number(parsed.lastRegenAt ?? nowMs())
    };
  } catch {
    return { freeTurns: FREE_START, paidTurns: 0, paidExpiresAt: 0, lastRegenAt: nowMs() };
  }
}

function saveWallet(wallet: TurnWallet) {
  localStorage.setItem(TURN_WALLET_KEY, JSON.stringify(wallet));
}

function normalizeWallet(wallet: TurnWallet): TurnWallet {
  const now = nowMs();
  let next = { ...wallet };
  if (next.paidExpiresAt > 0 && now > next.paidExpiresAt) {
    next.paidTurns = 0;
    next.paidExpiresAt = 0;
  }
  const elapsed = Math.max(0, now - next.lastRegenAt);
  const steps = Math.floor(elapsed / REGEN_MS);
  if (steps > 0) {
    next.freeTurns = Math.min(FREE_CAP, next.freeTurns + steps * FREE_REGEN);
    next.lastRegenAt = next.lastRegenAt + steps * REGEN_MS;
  }
  return next;
}

function consumeTurn(turnKey: string): { ok: boolean; wallet: TurnWallet; reason?: string } {
  if (sessionStorage.getItem(TURN_MARK_PREFIX + turnKey) === "1") {
    return { ok: true, wallet: normalizeWallet(readWallet()) };
  }

  let wallet = normalizeWallet(readWallet());

  if (wallet.freeTurns > 0) {
    wallet.freeTurns -= 1;
  } else if (wallet.paidTurns > 0 && wallet.paidExpiresAt > nowMs()) {
    wallet.paidTurns -= 1;
  } else {
    saveWallet(wallet);
    return { ok: false, wallet, reason: "No turns left." };
  }

  saveWallet(wallet);
  sessionStorage.setItem(TURN_MARK_PREFIX + turnKey, "1");
  return { ok: true, wallet };
}

function topUpPaidTurns(): TurnWallet {
  const now = nowMs();
  let wallet = normalizeWallet(readWallet());
  if (wallet.paidExpiresAt < now) {
    wallet.paidTurns = 0;
  }
  wallet.paidTurns += PAID_TURNS;
  wallet.paidExpiresAt = Math.max(wallet.paidExpiresAt, now) + PAID_MS;
  saveWallet(wallet);
  return wallet;
}

function formatMs(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function sanitizeName(value: string): string {
  return value.replace(/\s+/g, "").slice(0, MAX_NAME_LENGTH);
}

function playerName(state: DrawWfState, id: string | null): string {
  if (!id) return "";
  return state.players.find((p) => p.id === id)?.name || "";
}

function parseReplayPayload(value: unknown): ReplayPayload | null {
  if (!value) return null;
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  if (!Array.isArray(payload.strokes)) return null;
  return {
    width: Number(payload.width ?? 330),
    height: Number(payload.height ?? 330),
    strokes: payload.strokes as Stroke[]
  };
}

export default function DrawWfRuntime({ gameCode, playerToken }: DrawWfRuntimeProps) {
  const words = useMemo(() => flattenWords(wordPool), []);
  const [state, setState] = useState<DrawWfState | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [countdownText, setCountdownText] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState(7);
  const [guess, setGuess] = useState("");
  const [wallet, setWallet] = useState<TurnWallet>(() => normalizeWallet(readWallet()));
  const [showPaywall, setShowPaywall] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [pendingDrawingPayload, setPendingDrawingPayload] = useState<ReplayPayload | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const replayRef = useRef<HTMLCanvasElement | null>(null);
  const drawTimerRef = useRef<number | null>(null);
  const guessTimerRef = useRef<number | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);

  const myId = state?.you.id || "";
  const isDrawer = Boolean(state?.drawerPlayerId && state.drawerPlayerId === myId);
  const isWaitingOnYou = Boolean(state?.waitingOn.includes(myId));
  const isSinglePlayer = (state?.roomPlayerCount ?? state?.players.length ?? 0) <= 1;
  const joinUrl = `${window.location.origin}/g/draw-wf/?g=${gameCode}`;

  function nameSetKey() {
    return `${NAME_SET_PREFIX}${gameCode}_${playerToken}`;
  }

  function isNameConfirmed() {
    try {
      return window.localStorage.getItem(nameSetKey()) === "1";
    } catch {
      return false;
    }
  }

  function markNameConfirmed() {
    try {
      window.localStorage.setItem(nameSetKey(), "1");
    } catch {
      // ignore storage failures
    }
  }

  function openNameModal() {
    setNameDraft(state?.you.name ?? "");
    setShowNameModal(true);
  }

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        const next = await getDrawWfState(gameCode, playerToken);
        if (!active) return;
        setState(next);
        setErrorText("");
      } catch (e) {
        if (!active) return;
        setErrorText((e as Error).message || "Failed to load Draw WF.");
      }
    };
    void boot();

    const interval = window.setInterval(async () => {
      try {
        const next = await getDrawWfState(gameCode, playerToken);
        if (!active) return;
        setState(next);
      } catch {
        // ignore transient poll failures
      }
    }, 1400);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameCode, playerToken, words]);

  async function retryBoot() {
    setErrorText("");
    try {
      const next = await getDrawWfState(gameCode, playerToken);
      setState(next);
    } catch (e) {
      setErrorText((e as Error).message || "Failed to load Draw WF.");
    }
  }

  useEffect(() => {
    setWallet(normalizeWallet(readWallet()));
  }, [state?.roundId, state?.phase]);

  useEffect(() => {
    if (!state) return;
    if (state.phase === "rules" && isWaitingOnYou && !busy) {
      void doContinue();
    }
    if (state.phase === "draw_intro") {
      void runCountdown(isDrawer ? `Set? Draw: ${state.revealWord || "WORD"}` : `Set? ${playerName(state, state.drawerPlayerId)} is drawing`);
    }
    if (state.phase === "guess_intro") {
      void runCountdown("Set? Guess: " + state.wordMask);
    }
    if (state.phase === "guess_live") {
      setGuess(state.yourGuess || "");
    }
  }, [state?.phase, state?.roundId, isWaitingOnYou, busy]);

  useEffect(() => {
    if (!state) return;
    if (state.phase === "draw_live" && isDrawer && state.revealWord) {
      startDrawTimer();
    }
    if (state.phase === "guess_live") {
      startGuessTimer();
      const parsedReplay = parseReplayPayload(state.replayPayload);
      if (parsedReplay) {
        playReplay(parsedReplay);
      }
    }
    return () => {
      if (drawTimerRef.current) window.clearInterval(drawTimerRef.current);
      if (guessTimerRef.current) window.clearInterval(guessTimerRef.current);
    };
  }, [state?.phase, state?.roundId, state?.replayPayload, state?.guessDeadlineAt, isDrawer]);

  async function runCountdown(setLabel: string) {
    const isNewGameLeadIn = state?.phase === "draw_intro" && (state?.roundNumber ?? 0) <= 1;
    const steps = isNewGameLeadIn
      ? ["Ready to draw?", "Get set...", "Ready?", setLabel, "Go!"]
      : ["Ready?", setLabel, "Go!"];

    for (const step of steps) {
      setCountdownText(step);
      await new Promise((r) => setTimeout(r, 1000));
    }

    setCountdownText("");
    if (state?.phase === "draw_intro" && isWaitingOnYou && isDrawer) {
      await doContinue();
    }
    if (state?.phase === "guess_intro" && !isDrawer) {
      await doContinue();
    }
  }

  function startDrawTimer() {
    if (drawTimerRef.current) window.clearInterval(drawTimerRef.current);
    setTimeLeft(TURN_SECONDS);
    const started = Date.now();
    drawTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const left = Math.max(0, TURN_SECONDS - elapsed);
      setTimeLeft(left);
      if (left <= 0) {
        if (drawTimerRef.current) window.clearInterval(drawTimerRef.current);
        void finalizeDrawing();
      }
    }, 120);
  }

  function startGuessTimer() {
    if (guessTimerRef.current) window.clearInterval(guessTimerRef.current);
    setTimeLeft(TURN_SECONDS);
    const started = Date.now();
    guessTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const left = Math.max(0, TURN_SECONDS - elapsed);
      setTimeLeft(left);
      if (left <= 0) {
        if (guessTimerRef.current) window.clearInterval(guessTimerRef.current);
      }
    }, 120);
  }

  function beginStroke(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!state || state.phase !== "draw_live" || !isDrawer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const stroke: Stroke = { points: [{ x, y, t: Date.now() }] };
    activeStrokeRef.current = stroke;
    strokesRef.current.push(stroke);
  }

  function moveStroke(ev: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const stroke = activeStrokeRef.current;
    if (!canvas || !ctx || !stroke) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const prev = stroke.points[stroke.points.length - 1];
    stroke.points.push({ x, y, t: Date.now() });
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#111";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endStroke() {
    activeStrokeRef.current = null;
  }

  async function finalizeDrawing() {
    if (!state || state.phase !== "draw_live" || !isDrawer) return;
    const turnKey = `${gameCode}:${state.roundId}:draw:${myId}`;
    const consumed = consumeTurn(turnKey);
    setWallet(consumed.wallet);
    if (!consumed.ok) {
      setShowPaywall(true);
      return;
    }

    const canvas = canvasRef.current;
    const payload: ReplayPayload = {
      width: canvas?.width || 320,
      height: canvas?.height || 320,
      strokes: strokesRef.current
    };

    if (!isNameConfirmed()) {
      setPendingDrawingPayload(payload);
      openNameModal();
      return;
    }

    await submitDrawingPayload(payload);
  }

  async function submitDrawingPayload(payload: ReplayPayload) {
    const canvas = canvasRef.current;

    setBusy(true);
    setErrorText("");
    try {
      const next = await submitDrawWfDrawing(gameCode, playerToken, payload);
      setState(next);
      strokesRef.current = [];
      activeStrokeRef.current = null;
      const ctx = canvas?.getContext("2d");
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    } catch (e) {
      setErrorText((e as Error).message || "Failed to submit drawing.");
    } finally {
      setBusy(false);
    }
  }

  async function doContinue() {
    if (!state || busy) return;
    const canForceGuessIntroContinue = state.phase === "guess_intro" && !isDrawer;
    if (!isWaitingOnYou && !canForceGuessIntroContinue) return;
    if (state.phase === "round_result" && isSinglePlayer) return;
    if (
      state.phase === "draw_intro" &&
      isDrawer &&
      state.roundNumber > 1 &&
      !isNameConfirmed()
    ) {
      openNameModal();
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await continueDrawWf(gameCode, playerToken);
      setState(next);
    } catch (e) {
      setErrorText((e as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function submitGuess() {
    if (!state || busy || state.phase !== "guess_live") return;
    if (isDrawer) return;

    const turnKey = `${gameCode}:${state.roundId}:guess:${myId}`;
    const consumed = consumeTurn(turnKey);
    setWallet(consumed.wallet);
    if (!consumed.ok) {
      setShowPaywall(true);
      return;
    }

    setBusy(true);
    setErrorText("");
    try {
      const next = await submitDrawWfGuess(gameCode, playerToken, guess.toUpperCase());
      setState(next);
    } catch (e) {
      setErrorText((e as Error).message || "Unable to submit guess.");
    } finally {
      setBusy(false);
    }
  }

  function pickLetter(letter: string) {
    if (!state || state.phase !== "guess_live") return;
    if (guess.length >= state.wordLength) return;
    setGuess((old) => (old + letter).slice(0, state.wordLength));
  }

  function clearGuess() {
    setGuess("");
  }

  async function sendToFriend() {
    if (shareBusy) return;
    setShareBusy(true);
    const shareData = {
      title: "Draw WF",
      text: "Join my Draw WF game",
      url: joinUrl
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(joinUrl);
      }
    } finally {
      setShareBusy(false);
    }
  }

  function playReplay(payload: ReplayPayload) {
    const canvas = replayRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const allPoints = payload.strokes.flatMap((s) => s.points);
    if (allPoints.length < 2) return;

    const minT = allPoints[0].t;
    const maxT = allPoints[allPoints.length - 1].t;
    const span = Math.max(1, maxT - minT);

    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.min(TURN_SECONDS * 1000, Date.now() - started);
      const cutoff = minT + (elapsed / (TURN_SECONDS * 1000)) * span;
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#111";
      ctx.lineCap = "round";

      payload.strokes.forEach((stroke) => {
        if (stroke.points.length < 2) return;
        for (let i = 1; i < stroke.points.length; i += 1) {
          const p1 = stroke.points[i - 1];
          const p2 = stroke.points[i];
          if (p2.t > cutoff) break;
          ctx.beginPath();
          ctx.moveTo((p1.x / payload.width) * width, (p1.y / payload.height) * height);
          ctx.lineTo((p2.x / payload.width) * width, (p2.y / payload.height) * height);
          ctx.stroke();
        }
      });

      if (elapsed >= TURN_SECONDS * 1000) {
        window.clearInterval(timer);
      }
    }, 70);
  }

  async function saveDisplayName() {
    const cleaned = sanitizeName(nameDraft);
    if (!cleaned || savingName) {
      return;
    }
    setSavingName(true);
    setErrorText("");
    try {
      await setDrawWfDisplayName(gameCode, playerToken, cleaned);
      markNameConfirmed();
      setShowNameModal(false);
      if (pendingDrawingPayload) {
        const payload = pendingDrawingPayload;
        setPendingDrawingPayload(null);
        await submitDrawingPayload(payload);
        return;
      }
      const next = await getDrawWfState(gameCode, playerToken);
      setState(next);
      if (
        next.phase === "draw_intro" &&
        next.drawerPlayerId === next.you.id &&
        next.roundNumber > 1 &&
        next.waitingOn.includes(next.you.id)
      ) {
        await doContinue();
      }
    } catch (e) {
      setErrorText((e as Error).message || "Unable to save name.");
    } finally {
      setSavingName(false);
    }
  }

  if (!state) {
    return (
      <section className="runtime-card runtime-flow">
        <h2>Draw WF</h2>
        {errorText ? (
          <>
            <p className="hint-text error-text">{errorText}</p>
            <button type="button" className="btn btn-key" onClick={() => void retryBoot()}>
              Retry
            </button>
          </>
        ) : (
          <p>Loading game...</p>
        )}
      </section>
    );
  }

  const drawer = playerName(state, state.drawerPlayerId);
  const paidLeft = wallet.paidExpiresAt > nowMs() ? formatMs(wallet.paidExpiresAt - nowMs()) : "0s";

  return (
    <section className="runtime-card runtime-flow drawwf-runtime">
      <h2>Draw WF</h2>
      <p className="body-text small">Room streak: <b>{state.streak}</b> | Longest: <b>{state.longestStreak}</b></p>
      <p className="hint-text">Turns left: {wallet.freeTurns} free, {wallet.paidTurns} paid</p>

      {countdownText ? <h2>{countdownText}</h2> : null}

      {state.phase === "rules" && (
        <>
          <p>Draw fast. Guess faster. Keep the streak alive.</p>
          <p>1 draw = 1 turn. 1 guess = 1 turn.</p>
          <div className="players-panel">
            <p className="body-text left">Players in room</p>
            <div className="player-grid">
              {state.players.map((player) => (
                <div key={player.id} className="player-pill">
                  {player.name}
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-key" type="button" onClick={() => void doContinue()} disabled={!isWaitingOnYou || busy}>
            {isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "draw_intro" && (
        <>
          <p>Current drawer: <b>{drawer}</b></p>
          {!isDrawer ? <p className="hint-text">Waiting for {drawer} to draw...</p> : null}
        </>
      )}

      {state.phase === "draw_live" && (
        <>
          <p><b>Draw: {state.revealWord || state.wordMask}</b></p>
          <p className="hint-text">Timer: {timeLeft}s</p>
          <canvas
            ref={canvasRef}
            width={330}
            height={330}
            className="drawwf-canvas"
            onPointerDown={beginStroke}
            onPointerMove={moveStroke}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
          />
          {!isDrawer ? <p className="hint-text">{drawer} is drawing now...</p> : null}
          {isDrawer && <p className="hint-text">Draw until timer ends.</p>}
        </>
      )}

      {state.phase === "guess_intro" && (
        <>
          {isDrawer ? (
            <>
              <p><b>Your drawing is live.</b></p>
              <p className="hint-text">Share the link so more players can join and guess.</p>
              <button type="button" className="btn btn-soft" onClick={() => void sendToFriend()} disabled={shareBusy}>
                {shareBusy ? "Sharing..." : "Send to a friend"}
              </button>
            </>
          ) : (
            <>
              <p><b>Guess: {state.wordMask}</b></p>
              {!isWaitingOnYou ? <p className="hint-text">Waiting for active guessers...</p> : null}
            </>
          )}
        </>
      )}

      {state.phase === "guess_live" && (
        <>
          <canvas ref={replayRef} width={330} height={330} className="drawwf-canvas" />
          {isDrawer ? (
            <>
              <p><b>Players are guessing your drawing.</b></p>
              <p className="hint-text">Timer: {timeLeft}s</p>
              <button type="button" className="btn btn-soft" onClick={() => void sendToFriend()} disabled={shareBusy}>
                {shareBusy ? "Sharing..." : "Send to a friend"}
              </button>
            </>
          ) : (
            <>
              <p><b>Guess: {state.wordMask}</b></p>
              <p className="hint-text">Timer: {timeLeft}s</p>
              {state.wordLength > 0 ? (
                <>
                  <div className="drawwf-guess-word">{guess || "_".repeat(state.wordLength)}</div>
                  <div className="drawwf-letter-bank">
                    {state.letterBank.map((letter, idx) => (
                      <button key={`${letter}-${idx}`} type="button" className="player-pill" onClick={() => pickLetter(letter)} disabled={busy || guess.length >= state.wordLength}>
                        {letter}
                      </button>
                    ))}
                  </div>
                  <div className="bottom-row">
                    <button type="button" className="btn btn-soft" onClick={clearGuess}>Clear</button>
                    <button type="button" className="btn btn-key" onClick={() => void submitGuess()} disabled={busy || guess.length !== state.wordLength}>Submit guess</button>
                  </div>
                </>
              ) : (
                <p className="hint-text">Loading guess input...</p>
              )}
              {state.yourGuess ? <p className="hint-text">You guessed: {state.yourGuess}</p> : null}
            </>
          )}
        </>
      )}

      {state.phase === "round_result" && (
        <>
          <h2>{state.allCorrect ? "All correct!" : "Streak broken"}</h2>
          <p>Word: <b>{state.revealWord || "-"}</b></p>
          <p>Next drawer: <b>{drawer}</b></p>
          {isSinglePlayer ? (
            <>
              <p className="hint-text">You need at least 2 players to keep going.</p>
              <button type="button" className="btn btn-key" onClick={() => void sendToFriend()} disabled={shareBusy}>
                {shareBusy ? "Sharing..." : "Send to a friend"}
              </button>
            </>
          ) : isWaitingOnYou ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy}>
              {busy ? "Loading..." : "Continue"}
            </button>
          ) : (
            <p className="hint-text">Waiting for {drawer} to continue...</p>
          )}
          <div className="bottom-stack">
            <button type="button" className="btn btn-soft" onClick={() => setShowPaywall(true)}>Add more friends</button>
            <button type="button" className="btn btn-soft" onClick={() => window.open("/g/draw-wf/", "_blank", "noopener,noreferrer")}>
              Start a new game
            </button>
          </div>
        </>
      )}

      {showPaywall && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Need more turns?</h2>
            <p className="body-text small">10 free turns included. +5 free turns every 4h.</p>
            <p className="body-text small">Get 100 extra turns for $6 (valid 7 days).</p>
            <p className="hint-text">Paid time left: {paidLeft}</p>
            <div className="bottom-row">
              <button
                type="button"
                className="btn btn-key"
                onClick={() => {
                  const next = topUpPaidTurns();
                  setWallet(next);
                  setShowPaywall(false);
                }}
              >
                Add 100 turns
              </button>
              <button type="button" className="btn btn-soft" onClick={() => setShowPaywall(false)}>
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

      {showNameModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Enter your name</h2>
            <p className="body-text small">Enter your name to save your spot.</p>
            <input
              className="input-pill"
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(sanitizeName(event.target.value))}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Name"
            />
            <p className="hint-text">10 characters max, no spaces</p>
            <div className="bottom-row">
              <button type="button" className="btn btn-key" onClick={() => void saveDisplayName()} disabled={savingName || sanitizeName(nameDraft).length === 0}>
                {savingName ? "Saving..." : "Save"}
              </button>
              <button type="button" className="btn btn-soft" onClick={() => setShowNameModal(false)} disabled={savingName}>
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {(errorText || state.lastError) && <p className="hint-text error-text">{errorText || state.lastError}</p>}
    </section>
  );
}
