import { useEffect, useMemo, useRef, useState } from "react";
import {
  continueDrawWf,
  getDrawWfState,
  initDrawWf,
  setDrawWfDisplayName,
  removeDrawWfPlayer,
  submitDrawWfDrawing,
  submitDrawWfGuess,
  type DrawWfState
} from "../../lib/drawWfApi";
import { confirmDrawThingsCheckout, startDrawThingsCheckout } from "../../lib/accessApi";
import {
  applyDrawThingsPurchasePlays,
  consumeDrawThingsPlay,
  DRAW_THINGS_OPEN_PAYWALL_EVENT,
  getDrawThingsWalletSummary,
  type DrawThingsWalletSummary
} from "../../lib/drawThingsWallet";
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
const DRAW_SECONDS = 20;
const GUESS_SECONDS = 20;
const DRAW_NUMERIC_SECONDS = 18; // Show 20..3 (18 seconds), then Quick.
const GUESS_NUMERIC_SECONDS = 18; // Show 20..3 (18 seconds), then Quick.
const DRAW_QUICK_SECONDS = 5;
const GUESS_QUICK_SECONDS = 5;
const GUESS_REPLAY_SECONDS = 15;
const NAME_SET_PREFIX = "dwf_name_set_";
const DRAW_THINGS_SESSION_CREDIT_PREFIX = "drawthings_checkout_credit_";
const MAX_NAME_LENGTH = 10;
const POST_GUESS_HOLD_MS = 5000;

function flattenWords(pool: unknown): string[] {
  if (!pool || typeof pool !== "object") return [];
  const words = (pool as { words?: unknown[] }).words;
  if (!Array.isArray(words)) return [];
  return words.map((w) => String(w).trim().toUpperCase()).filter((w) => w.length >= 3 && w.length <= 6);
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
  const [wallet, setWallet] = useState<DrawThingsWalletSummary>(() => getDrawThingsWalletSummary());
  const [showPaywall, setShowPaywall] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showNameHint, setShowNameHint] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [showShareFallbackModal, setShowShareFallbackModal] = useState(false);
  const [shareFallbackText, setShareFallbackText] = useState("");
  const [pendingDrawingPayload, setPendingDrawingPayload] = useState<ReplayPayload | null>(null);
  const [guessStartedRoundId, setGuessStartedRoundId] = useState<string | null>(null);
  const [showQuick, setShowQuick] = useState(false);
  const [guessWrongFlash, setGuessWrongFlash] = useState(false);
  const [postGuessHold, setPostGuessHold] = useState(false);
  const [showPlayerEditor, setShowPlayerEditor] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [removingPlayer, setRemovingPlayer] = useState(false);
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
  const wrongGuessClearTimerRef = useRef<number | null>(null);
  const postGuessHoldTimerRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const lastGuessRoundRef = useRef<string | null>(null);
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
  const shareMoreText = `Can you guess what I drew? Join my Draw Things game...\n${joinUrl}`;
  const nudgeGuessText = `Hey! I'm waiting for you to guess my drawing....\n${joinUrl}`;
  const nudgeDrawText = `Hey! I'm waiting for you to do your drawing....\n${joinUrl}`;

  function nameSetKey() {
    return `${NAME_SET_PREFIX}${gameCode}_${playerToken}`;
  }

  function checkoutCreditKey(sessionId: string) {
    return `${DRAW_THINGS_SESSION_CREDIT_PREFIX}${sessionId}`;
  }

  function isCheckoutCredited(sessionId: string) {
    if (!sessionId) return false;
    try {
      return window.localStorage.getItem(checkoutCreditKey(sessionId)) === "1";
    } catch {
      return false;
    }
  }

  function markCheckoutCredited(sessionId: string) {
    if (!sessionId) return;
    try {
      window.localStorage.setItem(checkoutCreditKey(sessionId), "1");
    } catch {
      // ignore storage failures
    }
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
    setWallet(getDrawThingsWalletSummary());
  }, [state?.roundId, state?.phase]);

  useEffect(() => {
    const openModal = () => setShowPaywall(true);
    window.addEventListener(DRAW_THINGS_OPEN_PAYWALL_EVENT, openModal);
    return () => window.removeEventListener(DRAW_THINGS_OPEN_PAYWALL_EVENT, openModal);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const paymentStatus = url.searchParams.get("draw_payment");
    if (paymentStatus !== "success") {
      if (paymentStatus) {
        url.searchParams.delete("draw_payment");
        url.searchParams.delete("draw_session_id");
        window.history.replaceState({}, "", url.toString());
      }
      return;
    }

    const sessionId = url.searchParams.get("draw_session_id") || "";
    let active = true;
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const settleCheckout = async () => {
      let settled = false;
      for (let i = 0; i < 10; i += 1) {
        if (!active) {
          return;
        }
        try {
          const result = await confirmDrawThingsCheckout(sessionId);
          if (!active) {
            return;
          }

          if (result.confirmed) {
            if (!isCheckoutCredited(sessionId) && (result.playsGranted > 0 || result.reason === "already_applied")) {
              setWallet(applyDrawThingsPurchasePlays());
              markCheckoutCredited(sessionId);
            } else {
              setWallet(getDrawThingsWalletSummary());
            }
            settled = true;
            break;
          }
        } catch (error) {
          if (!active) {
            return;
          }
          if (i === 9) {
            setErrorText((error as Error).message || "Unable to confirm payment.");
          }
        }
        await wait(1200);
      }

      if (!settled && active) {
        setWallet(getDrawThingsWalletSummary());
      }

      if (active) {
        const cleaned = new URL(window.location.href);
        cleaned.searchParams.delete("draw_payment");
        cleaned.searchParams.delete("draw_session_id");
        window.history.replaceState({}, "", cleaned.toString());
      }
    };

    void settleCheckout();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    if (state.phase === "rules" && isWaitingOnYou && !busy) {
      void doContinue();
    }
    if (state.phase !== "guess_live") {
      lastGuessRoundRef.current = null;
      setGuessStartedRoundId(null);
      guessAttemptRef.current = null;
      timeoutSubmittedRoundRef.current = null;
    }
    if (state.phase === "guess_live") {
      if (lastGuessRoundRef.current !== state.roundId) {
        lastGuessRoundRef.current = state.roundId;
        setGuess(state.yourGuess ?? "");
      } else if (state.yourGuess !== null) {
        // Only sync server guess after a submitted value exists.
        setGuess(state.yourGuess);
      }
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
    if (!state) return;
    if (removeTarget && !state.players.some((player) => player.id === removeTarget.id)) {
      setRemoveTarget(null);
    }
  }, [state?.players, removeTarget]);

  useEffect(() => {
    return () => {
      if (drawTimerRef.current) window.clearInterval(drawTimerRef.current);
      if (guessTimerRef.current) window.clearInterval(guessTimerRef.current);
      if (replayTimerRef.current) window.clearInterval(replayTimerRef.current);
      if (wrongFlashTimerRef.current) window.clearTimeout(wrongFlashTimerRef.current);
      if (wrongFlashRafRef.current) window.cancelAnimationFrame(wrongFlashRafRef.current);
      if (wrongGuessClearTimerRef.current) window.clearTimeout(wrongGuessClearTimerRef.current);
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
    const numericSeconds = DRAW_NUMERIC_SECONDS;
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
    const numericSeconds = GUESS_NUMERIC_SECONDS;
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

    const isInitialDrawStart = state.phase === "rules";
    const isGuessJoinClick = state.phase === "guess_intro" && !isDrawer;
    const isDrawStartClick = state.phase === "round_result" && !isSinglePlayer;
    if (isInitialDrawStart || isGuessJoinClick || isDrawStartClick) {
      const action = isGuessJoinClick ? "guess" : "draw";
      const turnKey = `${gameCode}:${state.roundId || "r0"}:${action}:${myId}`;
      const consumed = consumeDrawThingsPlay(turnKey);
      setWallet(consumed.summary);
      if (!consumed.ok) {
        setShowPaywall(true);
        return;
      }
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
        if (wrongGuessClearTimerRef.current) {
          window.clearTimeout(wrongGuessClearTimerRef.current);
        }
        wrongGuessClearTimerRef.current = window.setTimeout(() => {
          setGuess("");
          guessAttemptRef.current = null;
          wrongGuessClearTimerRef.current = null;
        }, 300);
      }

      setState(next);

      if (next.yourGuess !== null && !isNameConfirmed()) {
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
    const turnKey = `${gameCode}:${state.roundId || "r0"}:guess:${myId}`;
    const consumed = consumeDrawThingsPlay(turnKey);
    setWallet(consumed.summary);
    if (!consumed.ok) {
      setShowPaywall(true);
      return;
    }
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

  async function sendShareText(shareText: string) {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      if (navigator.share) {
        // Keep this as plain text so platforms are less likely to build a separate preview target URL.
        await navigator.share({ text: shareText });
      } else {
        setShareFallbackText(shareText);
        setShowShareFallbackModal(true);
      }
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareFallbackText() {
    if (!shareFallbackText) return;
    try {
      await navigator.clipboard.writeText(shareFallbackText);
    } catch {
      // ignore clipboard permission failures
    }
  }

  async function beginDrawThingsCheckout() {
    if (checkoutBusy) {
      return;
    }
    setCheckoutBusy(true);
    setErrorText("");
    try {
      const returnTo = new URL(window.location.href);
      returnTo.searchParams.delete("draw_payment");
      returnTo.searchParams.delete("draw_session_id");
      const { checkoutUrl } = await startDrawThingsCheckout(returnTo.toString());
      window.location.assign(checkoutUrl);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to open checkout.");
      setCheckoutBusy(false);
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

  async function confirmRemovePlayer() {
    if (!state || !removeTarget || removingPlayer) {
      return;
    }
    setRemovingPlayer(true);
    setErrorText("");
    try {
      const next = await removeDrawWfPlayer(gameCode, playerToken, removeTarget.id);
      setState(next);
      setRemoveTarget(null);
      setShowPlayerEditor(false);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to remove player.");
    } finally {
      setRemovingPlayer(false);
    }
  }

  function renderPlayersPanel() {
    if (!state) {
      return null;
    }

    return (
      <div className="players-panel">
        <div className="drawwf-players-head">
          <span className="drawwf-edit-spacer" aria-hidden="true" />
          <p className="body-text left">Current players:</p>
          <button
            type="button"
            className="btn btn-soft drawwf-edit-btn"
            onClick={() => setShowPlayerEditor((old) => !old)}
            disabled={removingPlayer || state.players.length <= 1}
          >
            {showPlayerEditor ? "Done" : "Edit"}
          </button>
        </div>
        <div className="player-grid">
          {state.players.map((player) => {
            const isSelf = player.id === myId;
            if (!showPlayerEditor) {
              return (
                <div key={player.id} className="player-pill">
                  {player.name}
                </div>
              );
            }
            return (
              <button
                key={player.id}
                type="button"
                className="player-pill drawwf-player-pill-edit"
                onClick={() => setRemoveTarget({ id: player.id, name: player.name })}
                disabled={isSelf || removingPlayer}
                title={isSelf ? "You cannot remove yourself." : `Remove ${player.name}`}
              >
                <span>{player.name}</span>
                {!isSelf ? <span className="drawwf-pill-pen">✎</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    );
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
  const refillIn = formatMs(wallet.refillInMs);

  return (
    <section className="runtime-card runtime-flow drawwf-runtime">
        <p></p>

      {state.phase === "rules" && (
        <>
          {renderPlayersPanel()}
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
              <button type="button" className="btn btn-key" onClick={() => void sendShareText(shareMoreText)} disabled={shareBusy}>
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
              {state.roundNumber <= 1 ? (
                <button type="button" className="btn btn-key" onClick={() => void sendShareText(shareMoreText)} disabled={shareBusy}>
                  {shareBusy ? "Sharing..." : "Send drawing to friends"}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-key" onClick={() => void sendShareText(nudgeGuessText)} disabled={shareBusy}>
                    {shareBusy ? "Sharing..." : "Nudge..."}
                  </button>
                  <button type="button" className="btn btn-key" onClick={() => void sendShareText(shareMoreText)} disabled={shareBusy}>
                    {shareBusy ? "Sharing..." : "Send to MORE"}
                  </button>
                </>
              )}
              {renderPlayersPanel()}
            </>
          ) : !isGuessUiReady ? (
            <>
              <h2>Ready to guess<h2></h2>{state.drawerName}'s drawing?</h2><p></p>
              <button className="btn btn-key" type="button" onClick={startGuessing} disabled={busy}>
                Guess
              </button>
              {renderPlayersPanel()}
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
            <p className="hint-text">Waiting for <u>{drawer}</u> to do the next drawing...</p>
          )}
          <p></p>
            {!isWaitingOnYou ? (
              <button type="button" className="btn btn-key" onClick={() => void sendShareText(nudgeDrawText)} disabled={shareBusy}>
                {shareBusy ? "Sharing..." : "Nudge your friend to draw"}
              </button>
            ) : null}
            {renderPlayersPanel()}
            <p></p>
             <button type="button" className="btn key btn-left" onClick={() => void sendShareText(shareMoreText)} disabled={shareBusy}>
                {shareBusy ? "Sharing..." : "Send to MORE friends (max 24 players)"}
              </button>
            <button type="button" className="btn btn-soft runtime-reroll-btn btn-left" onClick={() => window.open("/g/draw-things/", "_blank", "noopener,noreferrer")}>
              Start a NEW game, opens a new tab
            </button>
          </>
        )}
        </>
      )}

      {showShareFallbackModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Share this invite</h2>
            <p className="hint-text">Copy and paste this message into Messenger, WhatsApp, SMS, or DM.</p>
            <textarea
              className="input-pill"
              value={shareFallbackText}
              readOnly
              rows={4}
              style={{ width: "100%", resize: "none" }}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="bottom-row">
              <button type="button" className="btn btn-key" onClick={() => void copyShareFallbackText()}>
                Copy
              </button>
              <button type="button" className="btn btn-soft" onClick={() => setShowShareFallbackModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaywall && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Draw Things Plays</h2>
            <p className="body-text smallish">Plays remaining: +{wallet.freePlays}.<p></p>Refill (+5 plays) in {refillIn}.</p><p></p>
            <p className="body-text smallish"><b>Unlock more plays 🔓...</b></p>
            {wallet.canBuyPack ? (
              <button type="button" className="btn btn-key" onClick={() => void beginDrawThingsCheckout()} disabled={checkoutBusy}>
                {checkoutBusy ? "Loading..." : "+100 plays for $6.00 🔓"}
              </button>
            ) : (
              <p className="hint-text">100-play pack active: {wallet.paidPlays} plays left.</p>
            )}
            <button type="button" className="btn btn-soft" onClick={() => setShowPaywall(false)} disabled={checkoutBusy}>
              Back
            </button><p></p>
            <p className="tinyy">
              <i>
                Disclaimer: Access is tied to this browser type/device via local storage. If you clear cookies/local
                storage, use private mode, or switch browser types/devices, access may be lost. By continuing you
                accept this, have read the terms, and understand it is not grounds for a refund. Issues, contact support.
              </i>
            </p><p></p>
            <div className="footer-links-inline">
              <a href="https://tally.so/r/XxqNzP" target="_blank" rel="noreferrer">
                Support
              </a>
              <a href="/terms/">Terms</a>
              <a href="/how-unlimited-works/">How unlimited works</a>
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

      {removeTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Remove {removeTarget.name} from game?</h2>
            <div className="bottom-row">
              <button type="button" className="btn btn-key" onClick={() => void confirmRemovePlayer()} disabled={removingPlayer}>
                {removingPlayer ? "Removing..." : "Remove"}
              </button>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  setRemoveTarget(null);
                  setShowPlayerEditor(false);
                }}
                disabled={removingPlayer}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {(errorText || state.lastError) && <p className="hint-text error-text">{errorText || state.lastError}</p>}
    </section>
  );
}
