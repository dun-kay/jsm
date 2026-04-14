import { useEffect, useMemo, useRef, useState } from "react";
import {
  continueDrawWf,
  getDrawWfState,
  initDrawWf,
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
const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 350;
const KEYBOARD_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;

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
const DRAW_SECONDS = 10;
const GUESS_SECONDS = 10;
const DRAW_QUICK_SECONDS = 3;
const GUESS_QUICK_SECONDS = 5;
const GUESS_REPLAY_SECONDS = 10;
const NAME_SET_PREFIX = "dwf_name_set_";
const MAX_NAME_LENGTH = 10;
const POST_GUESS_HOLD_MS = 5000;

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

function getInkColor(): string {
  if (typeof document === "undefined") {
    return "#111";
  }
  return document.documentElement.getAttribute("data-theme") === "dark" ? "#fff" : "#111";
}

function pointerToCanvasPoint(canvas: HTMLCanvasElement, ev: React.PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = canvas.clientWidth || rect.width || 1;
  const cssHeight = canvas.clientHeight || rect.height || 1;

  // Account for canvas CSS scaling and border thickness so input tracks the visible tip.
  const rawX = ((ev.clientX - rect.left - canvas.clientLeft) * canvas.width) / cssWidth;
  const rawY = ((ev.clientY - rect.top - canvas.clientTop) * canvas.height) / cssHeight;

  return {
    x: Math.max(0, Math.min(canvas.width, rawX)),
    y: Math.max(0, Math.min(canvas.height, rawY))
  };
}

export default function DrawWfRuntime({ gameCode, playerToken }: DrawWfRuntimeProps) {
  const words = useMemo(() => flattenWords(wordPool), []);
  const [state, setState] = useState<DrawWfState | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [timeLeft, setTimeLeft] = useState(7);
  const [guess, setGuess] = useState("");
  const [wallet, setWallet] = useState<TurnWallet>(() => normalizeWallet(readWallet()));
  const [showPaywall, setShowPaywall] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showNameHint, setShowNameHint] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [pendingDrawingPayload, setPendingDrawingPayload] = useState<ReplayPayload | null>(null);
  const [guessStartedRoundId, setGuessStartedRoundId] = useState<string | null>(null);
  const [showQuick, setShowQuick] = useState(false);
  const [guessWrongFlash, setGuessWrongFlash] = useState(false);
  const [postGuessHold, setPostGuessHold] = useState(false);
  const [themeMode, setThemeMode] = useState<string>(() =>
    typeof document === "undefined" ? "light" : document.documentElement.getAttribute("data-theme") || "light"
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const replayRef = useRef<HTMLCanvasElement | null>(null);
  const finalReplayRef = useRef<HTMLCanvasElement | null>(null);
  const drawTimerRef = useRef<number | null>(null);
  const guessTimerRef = useRef<number | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const replayStartedRoundRef = useRef<string | null>(null);
  const guessTimerRoundRef = useRef<string | null>(null);
  const guessAttemptRef = useRef<string | null>(null);
  const timeoutSubmittedRoundRef = useRef<string | null>(null);
  const wrongFlashTimerRef = useRef<number | null>(null);
  const wrongFlashRafRef = useRef<number | null>(null);
  const postGuessHoldTimerRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);

  const myId = state?.you.id || "";
  const isDrawer = Boolean(state?.drawerPlayerId && state.drawerPlayerId === myId);
  const isWaitingOnYou = Boolean(state?.waitingOn.includes(myId));
  const isGuesserForRound = Boolean(state?.guesserIds.includes(myId));
  const hasStartedGuessForRound = Boolean(state && guessStartedRoundId === state.roundId);
  const isGuessUiReady = Boolean(
    state &&
    state.phase === "guess_live" &&
    !isDrawer &&
    (hasStartedGuessForRound || Boolean(state.yourGuess))
  );
  const isActiveGuesser = Boolean(
    state &&
    state.phase === "guess_live" &&
    !isDrawer &&
    (state.activeGuesserIds.includes(myId) || (isGuesserForRound && isWaitingOnYou)) &&
    hasStartedGuessForRound
  );
  const isSinglePlayer = (state?.roomPlayerCount ?? state?.players.length ?? 0) <= 1;
  const isDrawHurryWindow = isDrawer && state?.phase === "draw_live" && (showQuick || timeLeft <= 2);
  const drawCountdown = timeLeft;
  const isHurryWindow = isActiveGuesser && (showQuick || timeLeft <= 2);
  const guessCountdown = timeLeft;
  const joinUrl = `${window.location.origin}/g/draw-things/?g=${gameCode}`;

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
    setNameDraft("");
    setShowNameHint(false);
    setShowNameModal(true);
  }

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        const next = await initDrawWf(gameCode, playerToken, words);
        if (!active) return;
        setState(next);
        setErrorText("");
      } catch (e) {
        if (!active) return;
        setErrorText((e as Error).message || "Failed to load Draw Things.");
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

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeMode(root.getAttribute("data-theme") || "light");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  async function retryBoot() {
    setErrorText("");
    try {
      const next = await getDrawWfState(gameCode, playerToken);
      setState(next);
    } catch (e) {
      setErrorText((e as Error).message || "Failed to load Draw Things.");
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
    if (state.phase !== "guess_live") {
      setGuessStartedRoundId(null);
      guessAttemptRef.current = null;
      timeoutSubmittedRoundRef.current = null;
    }
    if (state.phase === "guess_live") {
      setGuess(state.yourGuess || "");
    } else {
      setShowQuick(false);
    }
  }, [state?.phase, state?.roundId, isWaitingOnYou, busy]);

  useEffect(() => {
    if (!state) return;
    if (state.phase === "draw_live" && isDrawer && state.revealWord) {
      startDrawTimer();
      return;
    }
    if (drawTimerRef.current) {
      window.clearInterval(drawTimerRef.current);
      drawTimerRef.current = null;
    }
  }, [state?.phase, state?.roundId, isDrawer, state?.revealWord]);

  useEffect(() => {
    if (!state) return;
    if (state.phase === "guess_live" && isActiveGuesser) {
      if (guessTimerRoundRef.current !== state.roundId) {
        guessTimerRoundRef.current = state.roundId;
        startGuessTimer();
      }
      return;
    }
    guessTimerRoundRef.current = null;
    if (guessTimerRef.current) {
      window.clearInterval(guessTimerRef.current);
      guessTimerRef.current = null;
    }
  }, [state?.phase, state?.roundId, isActiveGuesser]);

  useEffect(() => {
    if (!state) return;
    if (state.phase === "guess_live" && isActiveGuesser) {
      const parsedReplay = parseReplayPayload(state.replayPayload);
      if (parsedReplay && replayStartedRoundRef.current !== state.roundId) {
        replayStartedRoundRef.current = state.roundId;
        playReplay(parsedReplay);
      }
      return;
    }
    replayStartedRoundRef.current = null;
    if (replayTimerRef.current) {
      window.clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, [state?.phase, state?.roundId, isActiveGuesser, state?.replayPayload, themeMode]);

  useEffect(() => {
    if (!state) return;
    const showFinalReplay =
      (state.phase === "guess_live" && isDrawer) ||
      (state.phase === "guess_live" && !isDrawer && !isActiveGuesser && Boolean(state.yourGuess)) ||
      state.phase === "round_result";
    if (!showFinalReplay) return;
    const payload = parseReplayPayload(state.replayPayload);
    if (!payload) return;
    drawReplayStatic(finalReplayRef.current, payload);
  }, [state?.phase, state?.roundId, state?.replayPayload, state?.yourGuess, isDrawer, isActiveGuesser, themeMode]);

  useEffect(() => {
    if (!state || busy) return;
    if (state.phase !== "guess_live" || !isActiveGuesser) return;
    if (state.yourGuess) return;
    if (guess.length !== state.wordLength || state.wordLength <= 0) return;
    const attemptKey = `${state.roundId}:${guess.toUpperCase()}`;
    if (guessAttemptRef.current === attemptKey) return;
    guessAttemptRef.current = attemptKey;
    void submitGuess(guess.toUpperCase());
  }, [guess, state?.phase, state?.roundId, state?.wordLength, state?.yourGuess, isActiveGuesser, busy]);

  useEffect(() => {
    return () => {
      if (drawTimerRef.current) window.clearInterval(drawTimerRef.current);
      if (guessTimerRef.current) window.clearInterval(guessTimerRef.current);
      if (replayTimerRef.current) window.clearInterval(replayTimerRef.current);
      if (wrongFlashTimerRef.current) window.clearTimeout(wrongFlashTimerRef.current);
      if (wrongFlashRafRef.current) window.cancelAnimationFrame(wrongFlashRafRef.current);
      if (postGuessHoldTimerRef.current) window.clearTimeout(postGuessHoldTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    const prevPhase = prevPhaseRef.current;
    const enteredRoundResult = prevPhase === "guess_live" && state.phase === "round_result";
    const shouldShowHold = enteredRoundResult && !isDrawer && state.yourGuess !== null;

    if (shouldShowHold) {
      setPostGuessHold(true);
      if (postGuessHoldTimerRef.current) {
        window.clearTimeout(postGuessHoldTimerRef.current);
      }
      postGuessHoldTimerRef.current = window.setTimeout(() => {
        setPostGuessHold(false);
        postGuessHoldTimerRef.current = null;
      }, POST_GUESS_HOLD_MS);
    } else if (state.phase !== "round_result") {
      setPostGuessHold(false);
      if (postGuessHoldTimerRef.current) {
        window.clearTimeout(postGuessHoldTimerRef.current);
        postGuessHoldTimerRef.current = null;
      }
    }

    prevPhaseRef.current = state.phase;
  }, [state?.phase, state?.roundId, state?.yourGuess, isDrawer]);

  function startDrawTimer() {
    if (drawTimerRef.current) window.clearInterval(drawTimerRef.current);
    setShowQuick(false);
    setTimeLeft(DRAW_SECONDS);
    const started = Date.now();
    const numericSeconds = DRAW_SECONDS - 1; // Show 10..2, then switch to Quick.
    drawTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      if (elapsed < numericSeconds) {
        setShowQuick(false);
        setTimeLeft(DRAW_SECONDS - elapsed);
        return;
      }

      const quickElapsed = elapsed - numericSeconds;
      if (quickElapsed < DRAW_QUICK_SECONDS) {
        setShowQuick(true);
        return;
      }

      if (elapsed >= numericSeconds + DRAW_QUICK_SECONDS) {
        if (drawTimerRef.current) window.clearInterval(drawTimerRef.current);
        void finalizeDrawing();
      }
    }, 120);
  }

  function startGuessTimer() {
    if (guessTimerRef.current) window.clearInterval(guessTimerRef.current);
    setShowQuick(false);
    setTimeLeft(GUESS_SECONDS);
    const started = Date.now();
    const numericSeconds = GUESS_SECONDS - 1; // Show 10..2, then switch to Quick.
    guessTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      if (elapsed < numericSeconds) {
        setShowQuick(false);
        setTimeLeft(GUESS_SECONDS - elapsed);
        return;
      }

      const quickElapsed = elapsed - numericSeconds;
      if (quickElapsed < GUESS_QUICK_SECONDS) {
        setShowQuick(true);
        return;
      }

      if (elapsed >= numericSeconds + GUESS_QUICK_SECONDS) {
        if (guessTimerRef.current) window.clearInterval(guessTimerRef.current);
        if (state && isActiveGuesser && !state.yourGuess && timeoutSubmittedRoundRef.current !== state.roundId) {
          timeoutSubmittedRoundRef.current = state.roundId;
          void submitGuess("", { timeout: true });
        }
      }
    }, 120);
  }

  function beginStroke(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!state || state.phase !== "draw_live" || !isDrawer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    const { x, y } = pointerToCanvasPoint(canvas, ev);
    const stroke: Stroke = { points: [{ x, y, t: Date.now() }] };
    activeStrokeRef.current = stroke;
    strokesRef.current.push(stroke);
  }

  function moveStroke(ev: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const stroke = activeStrokeRef.current;
    if (!canvas || !ctx || !stroke) return;
    ev.preventDefault();
    const { x, y } = pointerToCanvasPoint(canvas, ev);
    const prev = stroke.points[stroke.points.length - 1];
    stroke.points.push({ x, y, t: Date.now() });
    ctx.lineWidth = 4;
    ctx.strokeStyle = getInkColor();
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endStroke(ev?: React.PointerEvent<HTMLCanvasElement>) {
    if (ev && canvasRef.current?.hasPointerCapture(ev.pointerId)) {
      canvasRef.current.releasePointerCapture(ev.pointerId);
    }
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
    if (!isWaitingOnYou) return;
    if (state.phase === "round_result" && isSinglePlayer) return;
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

  async function submitGuess(nextGuess?: string, opts?: { timeout?: boolean }) {
    if (!state || busy || state.phase !== "guess_live") return;
    if (isDrawer || !isActiveGuesser) return;
    const finalGuess = (nextGuess ?? guess).toUpperCase();

    setBusy(true);
    setErrorText("");
    try {
      const next = await submitDrawWfGuess(gameCode, playerToken, finalGuess);
      const isWrongFullAttempt = !next.yourGuess && finalGuess.length === state.wordLength && state.wordLength > 0;

      if (isWrongFullAttempt) {
        triggerWrongGuessFlash();
        setGuess("");
        guessAttemptRef.current = null;
      }

      setState(next);

      if (next.yourGuess) {
        const turnKey = `${gameCode}:${next.roundId}:guess:${myId}`;
        const consumed = consumeTurn(turnKey);
        setWallet(consumed.wallet);
        if (!consumed.ok) {
          setShowPaywall(true);
        }
      }

      if (next.yourGuess && !isNameConfirmed()) {
        openNameModal();
      }

    } catch (e) {
      if (opts?.timeout) {
        setErrorText((e as Error).message || "Unable to submit timeout.");
      }
    } finally {
      setBusy(false);
    }
  }

  function pickLetter(letter: string) {
    if (!state || state.phase !== "guess_live") return;
    if (guess.length >= state.wordLength) return;
    setGuess((old) => (old + letter).slice(0, state.wordLength));
  }

  function backspaceGuess() {
    setGuess((old) => old.slice(0, -1));
  }

  function startGuessing() {
    if (!state || state.phase !== "guess_live" || isDrawer) return;
    setGuessStartedRoundId(state.roundId);
  }

  function triggerWrongGuessFlash() {
    if (wrongFlashTimerRef.current) {
      window.clearTimeout(wrongFlashTimerRef.current);
      wrongFlashTimerRef.current = null;
    }
    if (wrongFlashRafRef.current) {
      window.cancelAnimationFrame(wrongFlashRafRef.current);
      wrongFlashRafRef.current = null;
    }
    setGuessWrongFlash(false);
    wrongFlashRafRef.current = window.requestAnimationFrame(() => {
      setGuessWrongFlash(true);
      wrongFlashTimerRef.current = window.setTimeout(() => {
        setGuessWrongFlash(false);
        wrongFlashTimerRef.current = null;
      }, 500);
      wrongFlashRafRef.current = null;
    });
  }

  async function sendToFriend() {
    if (shareBusy) return;
    setShareBusy(true);
    const shareData = {
      title: "Draw Things",
      text: "Join my Draw Things game",
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
    if (replayTimerRef.current) {
      window.clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    payload.strokes.forEach((stroke) => {
      if (!Array.isArray(stroke.points) || stroke.points.length < 2) return;
      for (let i = 1; i < stroke.points.length; i += 1) {
        const p1 = stroke.points[i - 1];
        const p2 = stroke.points[i];
        segments.push({
          x1: (p1.x / payload.width) * width,
          y1: (p1.y / payload.height) * height,
          x2: (p2.x / payload.width) * width,
          y2: (p2.y / payload.height) * height
        });
      }
    });
    if (segments.length === 0) return;

    const started = Date.now();
    replayTimerRef.current = window.setInterval(() => {
      const elapsed = Math.min(GUESS_REPLAY_SECONDS * 1000, Date.now() - started);
      const progress = elapsed / (GUESS_REPLAY_SECONDS * 1000);
      const visibleSegments = Math.floor(progress * segments.length);
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 4;
      ctx.strokeStyle = getInkColor();
      ctx.lineCap = "round";
      for (let i = 0; i < visibleSegments; i += 1) {
        const seg = segments[i];
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
      }

      if (elapsed >= GUESS_REPLAY_SECONDS * 1000) {
        if (replayTimerRef.current) {
          window.clearInterval(replayTimerRef.current);
          replayTimerRef.current = null;
        }
      }
    }, 70);
  }

  function drawReplayStatic(canvas: HTMLCanvasElement | null, payload: ReplayPayload) {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 4;
    ctx.strokeStyle = getInkColor();
    ctx.lineCap = "round";
    payload.strokes.forEach((stroke) => {
      if (!Array.isArray(stroke.points) || stroke.points.length < 2) return;
      for (let i = 1; i < stroke.points.length; i += 1) {
        const p1 = stroke.points[i - 1];
        const p2 = stroke.points[i];
        const x1 = (p1.x / payload.width) * width;
        const y1 = (p1.y / payload.height) * height;
        const x2 = (p2.x / payload.width) * width;
        const y2 = (p2.y / payload.height) * height;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    });
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
    } catch (e) {
      setErrorText((e as Error).message || "Unable to save name.");
    } finally {
      setSavingName(false);
    }
  }

  function handleNameDraftInput(rawValue: string) {
    const hasSpace = /\s/.test(rawValue);
    const compact = rawValue.replace(/\s+/g, "");
    const overLimit = compact.length > MAX_NAME_LENGTH;
    setShowNameHint(hasSpace || overLimit);
    setNameDraft(compact.slice(0, MAX_NAME_LENGTH));
  }

  if (!state) {
    return (
      <section className="runtime-card runtime-flow">
        <h2>Draw Things</h2>
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

  const roundResultDrawerId = state.phase === "round_result" ? (state.waitingOn[0] ?? null) : state.drawerPlayerId;
  const drawer = playerName(state, roundResultDrawerId);
  const roundWordLower = state.revealWord
    ? state.revealWord.charAt(0).toUpperCase() + state.revealWord.slice(1).toLowerCase()
    : "";
  const paidLeft = wallet.paidExpiresAt > nowMs() ? formatMs(wallet.paidExpiresAt - nowMs()) : "0s";

  return (
    <section className="runtime-card runtime-flow drawwf-runtime">
        <p></p>

      {state.phase === "rules" && (
        <>
          <div className="players-panel">
            <p className="body-text left">Current players:</p>
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

      {state.phase === "draw_live" && (
        <>
          {isDrawer ? (
            <>
              <h2>Draw:<h2></h2>{state.revealWord || state.wordMask}</h2>
              <p className="hint-text">
                {isDrawHurryWindow ? <span className="drawwf-hurry-blink">Quick!</span> : `${drawCountdown}s`}
              </p>
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="drawwf-canvas"
                onPointerDown={beginStroke}
                onPointerMove={moveStroke}
                onPointerUp={endStroke}
                onPointerLeave={endStroke}
              />
              
            </>
          ) : (
            <>
              <h2>{drawer} is drawing now...</h2>
              <p className="hint-text">Get ready to guess...</p>
            </>
          )}
        </>
      )}

      {state.phase === "guess_intro" && (
        <>
          {isDrawer ? (
            <>
              <p><b>Your drawing is live.</b></p>
              <p className="hint-text">Waiting for all active guessers to press Guess.</p>
              <button type="button" className="btn btn-key" onClick={() => void sendToFriend()} disabled={shareBusy}>
                {shareBusy ? "Sharing..." : "Send to more friends"}
              </button>
            </>
          ) : (
            <>
              <p><b>Guess:<p></p>{state.wordMask}</b></p>
              <button className="btn btn-key " type="button" onClick={() => void doContinue()} disabled={busy}>
                {busy ? "Loading..." : "Guess"}
              </button>
              {!isWaitingOnYou ? <p className="hint-text">Press Guess to join this round.</p> : null}
            </>
          )}
        </>
      )}

      {state.phase === "guess_live" && (
        <>

          {isDrawer ? (
            
            <>
            
              <h2>{state.roundNumber <= 1 ? "Send your drawing to a friend, see if they can guess it..." : "Waiting for friends to guess..."}</h2><p></p>
              <div><canvas ref={finalReplayRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="drawwf-canvas lob" /></div><p></p>
              <button type="button" className="btn btn-soft" onClick={() => void sendToFriend()} disabled={shareBusy}>
                {shareBusy ? "Sharing..." : "Send to friends"}
              </button>
                        <div className="players-panel">
            <p className="body-text left">Current players:</p>
            <div className="player-grid">
              {state.players.map((player) => (
                <div key={player.id} className="player-pill">
                  {player.name}
                </div>
              ))}
            </div>
          </div>
            </>
          ) : !isGuessUiReady ? (
            <>
              <h2>Ready to guess<h2></h2>{state.drawerName}'s drawing?</h2><p></p>
              <button className="btn btn-key" type="button" onClick={startGuessing} disabled={busy}>
                Guess
              </button>
            </>
          ) : isActiveGuesser ? (
            <>
            <h2>{isHurryWindow ? <span className="drawwf-hurry-blink">Quick!</span> : `Guess: ${guessCountdown}s`}</h2>
              <canvas ref={replayRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="drawwf-canvas" />
              <p></p>
              {state.wordLength > 0 ? (
                <>
                  <div className="drawwf-guess-wrap">
                    <div className={`drawwf-guess-word${guessWrongFlash ? " is-wrong" : ""}`}>
                      {Array.from({ length: state.wordLength }).map((_, idx) => {
                        const letter = guess[idx] ?? "";
                        return (
                          <span key={`guess-slot-${idx}`} className="drawwf-guess-slot">
                            {letter || "\u00A0"}
                          </span>
                        );
                      })}
                    </div>
                    <div className="drawwf-letter-bank">
                      {KEYBOARD_ROWS.map((row, rowIdx) => (
                        <div key={row} className="drawwf-keyboard-row">
                          {row.split("").map((letter) => (
                            <button
                              key={`${row}-${letter}`}
                              type="button"
                              className="wf"
                              onClick={() => pickLetter(letter)}
                              disabled={busy || guess.length >= state.wordLength}
                            >
                              {letter}
                            </button>
                          ))}
                          {rowIdx === KEYBOARD_ROWS.length - 1 ? (
                            <button
                              type="button"
                              className="wf wf-backspace"
                              aria-label="Backspace"
                              onClick={backspaceGuess}
                              disabled={busy || guess.length === 0}
                            >
                              ⌫
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="hint-text">Loading guess input...</p>
              )}
              {state.yourGuess ? <p className="hint-text">You guessed: {state.yourGuess}</p> : null}
            </>
          ) : (
            <>
              {state.yourGuess ? (
                <>
                  <div><br></br><canvas ref={finalReplayRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="drawwf-canvas lob" /></div>
                  <p className="hint-text">You guessed {state.yourGuess}, witing for all players...</p>
                </>
              ) : (
                <p className="hint-text">Waiting for your turn...</p>
              )}
            </>
          )}
        </>
      )}

      {state.phase === "round_result" && (
        <>
        {postGuessHold ? (
          <>
            <div className={state.yourGuessCorrect ? "streak correctstreak" : "streak"}>
              {state.yourGuessCorrect ? `Correct: ${roundWordLower || "-"}` : `So close... ${roundWordLower || "-"}`}
            </div>
            <p>
              {state.yourGuessCorrect ? `Group Streak: +${state.streak}` : "Group Streak: +0"}
            </p>
            <div><canvas ref={finalReplayRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="drawwf-canvas lob" /></div>
          </>
        ) : (
          <>
        <div className={state.streak > 0 ? "streak correctstreak" : "streak"}>Group Streak: +{state.streak}</div><p></p>
          <p><b>{state.allCorrect ? "Everyone got it right!" : "Oops, someone missed the mark..."}</b></p>
          <div className="answer">  Previous Drawing: {state.revealWord ? state.revealWord.charAt(0).toUpperCase() + state.revealWord.slice(1).toLowerCase() : "-"}</div>
          <div><canvas ref={finalReplayRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="drawwf-canvas lob" /></div>
          
          {isSinglePlayer ? (
            <>

            </>
          ) : isWaitingOnYou ? (
            <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy}>
              {busy ? "Loading..." : "Your turn to draw..."}
            </button>
          ) : (
            <p className="hint-text">Waiting for next drawing...</p>
          )}
          <p></p><button type="button" className="btn btn-soft" onClick={() => void sendToFriend()} disabled={shareBusy}>
                {shareBusy ? "Sharing..." : "Send to more friends"}
              </button>
          <div className="player-grid">
              {state.players.map((player) => (
                <div key={player.id} className="player-pill">
                  {player.name}
                </div>
              ))}
            </div>
            <p></p><button type="button" className="btn btn-soft runtime-reroll-btn btn-left" onClick={() => window.open("/g/draw-things/", "_blank", "noopener,noreferrer")}>
              Start a NEW game, opens a new tab
            </button>
          </>
        )}
        </>
      )}

      {showPaywall && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Need more turns?</h2>
            <p className="body-text smallish">10 free turns included. +5 free turns every 4h.</p>
            <p className="body-text smallish">Get 100 extra turns for $6 (valid 7 days).</p>
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
            <h2>Enter your name<h2></h2>to join the game...</h2>
            <p></p>
            <input
              className="input-pill"
              type="text"
              value={nameDraft}
              onChange={(event) => handleNameDraftInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === " ") {
                  setShowNameHint(true);
                }
                if (nameDraft.length >= MAX_NAME_LENGTH && event.key.length === 1 && event.key !== " ") {
                  setShowNameHint(true);
                }
              }}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name..."
            /><p></p>
            {showNameHint ? <p className="hint-text">10 characters max, no spaces</p> : null}
            <div>
              <button type="button" className="btn btn-key" onClick={() => void saveDisplayName()} disabled={savingName || sanitizeName(nameDraft).length === 0}>
                {savingName ? "Saving..." : "Join game"}
              </button>
            </div>
          </div>
        </div>
      )}

      {(errorText || state.lastError) && <p className="hint-text error-text">{errorText || state.lastError}</p>}
    </section>
  );
}
