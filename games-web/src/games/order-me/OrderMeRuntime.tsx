import { useEffect, useMemo, useRef, useState } from "react";
import type { GameConfig } from "../types";
import dailySeed from "./dailySeed.json";
import { getOrderMeAverageGuesses, recordOrderMeCompletion } from "../../lib/orderMeApi";

type ThemeMode = "light" | "dark";

type OrderMeRuntimeProps = {
  game: GameConfig;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBack: () => void;
};

type OrderMePuzzle = {
  date: string;
  target: string;
  words: string[];
};

type Feedback = "none" | "green" | "red";

type OrderMeStateEntry = {
  placed: Array<string | null>;
  feedback: Feedback[];
  lockedIndexes: number[];
  blockedByPos: string[][];
  guessesUsed: number;
  solved: boolean;
  failed: boolean;
};

type OrderMeState = {
  byDate: Record<string, OrderMeStateEntry>;
};

type ProgressState = {
  completed: Record<string, { guesses: number; completedAt: string; solved: boolean }>;
};

const PROGRESS_KEY = "notes_order_me_progress_v1";
const STATE_KEY = "notes_order_me_state_v1";
const PLAYER_KEY = "notes_order_me_player_id";
const MAX_GUESSES = 4;
const SLOT_COUNT = 6;
const SUCCESS_MS = 1600;
const ALL_PLAYED_TEXT = "Congrats, you have played all available games right now. Come back tomorrow to play again.";

function toIsoLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "2-digit" });
}

function formatLongDay(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffle(items: string[], seedText: string): string[] {
  const arr = [...items];
  let seed = hashSeed(seedText) || 1;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizedSeed(): OrderMePuzzle[] {
  return (dailySeed as OrderMePuzzle[]).map((entry) => ({
    date: String(entry.date),
    target: String(entry.target).toLowerCase(),
    words: Array.isArray(entry.words) ? entry.words.map((word) => String(word).toLowerCase()) : []
  }));
}

function readProgress(): ProgressState {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { completed: {} };
    const parsed = JSON.parse(raw) as ProgressState;
    return parsed?.completed ? parsed : { completed: {} };
  } catch {
    return { completed: {} };
  }
}

function persistProgress(value: ProgressState) {
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(value));
}

function readState(): OrderMeState {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return { byDate: {} };
    const parsed = JSON.parse(raw) as OrderMeState;
    return parsed?.byDate ? parsed : { byDate: {} };
  } catch {
    return { byDate: {} };
  }
}

function persistState(value: OrderMeState) {
  window.localStorage.setItem(STATE_KEY, JSON.stringify(value));
}

function readStateForDay(day: string): OrderMeStateEntry {
  const state = readState();
  const entry = state.byDate[day];
  if (!entry) {
    return {
      placed: Array.from({ length: SLOT_COUNT }, () => null),
      feedback: Array.from({ length: SLOT_COUNT }, () => "none"),
      lockedIndexes: [],
      blockedByPos: Array.from({ length: SLOT_COUNT }, () => []),
      guessesUsed: 0,
      solved: false,
      failed: false
    };
  }

  const placed = Array.isArray(entry.placed) ? entry.placed.slice(0, SLOT_COUNT) : [];
  while (placed.length < SLOT_COUNT) placed.push(null);

  const feedback = Array.isArray(entry.feedback) ? entry.feedback.slice(0, SLOT_COUNT) : [];
  while (feedback.length < SLOT_COUNT) feedback.push("none");

  const blockedByPos = Array.isArray(entry.blockedByPos)
    ? entry.blockedByPos.slice(0, SLOT_COUNT).map((row) => (Array.isArray(row) ? row.map((word) => String(word).toLowerCase()) : []))
    : [];
  while (blockedByPos.length < SLOT_COUNT) blockedByPos.push([]);

  return {
    placed: placed.map((value) => (value ? String(value).toLowerCase() : null)),
    feedback: feedback.map((value) => (value === "green" || value === "red" ? value : "none")),
    lockedIndexes: Array.isArray(entry.lockedIndexes) ? entry.lockedIndexes.map((idx) => Number(idx)).filter(Number.isFinite) : [],
    blockedByPos,
    guessesUsed: Number(entry.guessesUsed ?? 0),
    solved: Boolean(entry.solved),
    failed: Boolean(entry.failed)
  };
}

function writeStateForDay(day: string, entry: OrderMeStateEntry) {
  const state = readState();
  state.byDate[day] = entry;
  persistState(state);
}

function getOrCreateLocalPlayerId(): string {
  try {
    const current = window.localStorage.getItem(PLAYER_KEY);
    if (current) return current;
    const next = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    window.localStorage.setItem(PLAYER_KEY, next);
    return next;
  } catch {
    return `local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }
}

function computeDailyStreak(completed: ProgressState["completed"]): number {
  const completedDates = Object.keys(completed).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  if (completedDates.length === 0) return 0;

  const completedSet = new Set(completedDates);
  const today = new Date();
  const todayIso = toIsoLocal(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = toIsoLocal(yesterday);

  const latestPlayed = completedDates.slice().sort((a, b) => b.localeCompare(a))[0];
  if (latestPlayed !== todayIso && latestPlayed !== yesterdayIso) return 0;

  let streak = 0;
  const cursor = new Date(`${latestPlayed}T00:00:00`);
  while (true) {
    const iso = toIsoLocal(cursor);
    if (!completedSet.has(iso)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export default function OrderMeRuntime({ game, theme, onToggleTheme, onBack }: OrderMeRuntimeProps) {
  const [puzzles, setPuzzles] = useState<OrderMePuzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [progress, setProgress] = useState<ProgressState>(() => readProgress());
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Array<string | null>>(Array.from({ length: SLOT_COUNT }, () => null));
  const [feedback, setFeedback] = useState<Feedback[]>(Array.from({ length: SLOT_COUNT }, () => "none"));
  const [lockedIndexes, setLockedIndexes] = useState<Set<number>>(new Set());
  const [blockedByPos, setBlockedByPos] = useState<Array<Set<string>>>(Array.from({ length: SLOT_COUNT }, () => new Set()));
  const [guessesUsed, setGuessesUsed] = useState(0);
  const [solved, setSolved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [dragWord, setDragWord] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragSourceSlot, setDragSourceSlot] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [averageGuesses, setAverageGuesses] = useState<string | null>(null);
  const [showResultOverlay, setShowResultOverlay] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);

  const activePuzzle = useMemo(() => {
    if (!activeDate) return null;
    return puzzles.find((entry) => entry.date === activeDate) ?? null;
  }, [activeDate, puzzles]);

  const today = useMemo(() => toIsoLocal(new Date()), []);
  const dailyStreak = useMemo(() => computeDailyStreak(progress.completed), [progress.completed]);
  const playablePuzzles = useMemo(() => puzzles.filter((entry) => entry.date <= today).sort((a, b) => b.date.localeCompare(a.date)), [puzzles, today]);
  const unplayedPuzzle = useMemo(() => playablePuzzles.find((entry) => !progress.completed[entry.date]) ?? null, [playablePuzzles, progress.completed]);
  const allAvailablePlayed = playablePuzzles.length > 0 && unplayedPuzzle == null;
  const mostRecentUnplayed = useMemo(() => unplayedPuzzle ?? playablePuzzles[0] ?? null, [unplayedPuzzle, playablePuzzles]);
  const highlightedDate = mostRecentUnplayed?.date ?? playablePuzzles[0]?.date ?? null;

  const orderedWords = useMemo(() => {
    if (!activePuzzle) return [];
    return activePuzzle.words.slice(1, 7);
  }, [activePuzzle]);

  const shuffledWordPool = useMemo(() => {
    if (!activePuzzle) return [];
    return shuffle(orderedWords, `${activePuzzle.date}:${activePuzzle.target}:order-me`);
  }, [activePuzzle, orderedWords]);

  const poolWords = useMemo(() => {
    const used = new Set(placed.filter((word): word is string => Boolean(word)));
    return shuffledWordPool.filter((word) => !used.has(word));
  }, [placed, shuffledWordPool]);

  const shareUrl = useMemo(() => {
    const puzzleDate = activePuzzle?.date ?? mostRecentUnplayed?.date;
    if (!puzzleDate) return `${window.location.origin}${game.route}`;
    return `${window.location.origin}${game.route}?day=${encodeURIComponent(puzzleDate)}`;
  }, [activePuzzle?.date, mostRecentUnplayed?.date, game.route]);

  const shareText = useMemo(() => {
    if (solved) {
      return `I solved today's Order Me in ${guessesUsed}/4 guesses — can you beat me?`;
    }
    return "I couldn't solve today's Order Me, can you?";
  }, [solved, guessesUsed]);

  useEffect(() => {
    setLoading(true);
    setErrorText("");
    const sorted = normalizedSeed().sort((a, b) => b.date.localeCompare(a.date));
    setPuzzles(sorted);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (puzzles.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const day = params.get("day");
    if (day) {
      const found = puzzles.find((entry) => entry.date === day);
      if (found) startPuzzle(found.date);
    }
  }, [puzzles]);

  useEffect(() => {
    if (!activePuzzle) return;
    persistCurrentState();
  }, [activePuzzle?.date, placed, feedback, guessesUsed, solved, failed]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => {
      setNotice("");
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function updateUrlForDay(day: string | null) {
    const url = new URL(window.location.href);
    if (day) url.searchParams.set("day", day);
    else url.searchParams.delete("day");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function resetRoundState(next: OrderMeStateEntry) {
    setPlaced(next.placed);
    setFeedback(next.feedback);
    setLockedIndexes(new Set(next.lockedIndexes));
    setBlockedByPos(next.blockedByPos.map((row) => new Set(row)));
    setGuessesUsed(next.guessesUsed);
    setSolved(next.solved);
    setFailed(next.failed);
    setNotice("");
    setAverageGuesses(null);
    setShowShareModal(false);
    setShowHelpModal(false);
  }

  function startPuzzle(day: string) {
    const puzzle = puzzles.find((entry) => entry.date === day);
    if (!puzzle) return;
    const stored = readStateForDay(day);
    setActiveDate(day);
    updateUrlForDay(day);
    resetRoundState(stored);
  }

  function returnToLanding() {
    setActiveDate(null);
    setPlaced(Array.from({ length: SLOT_COUNT }, () => null));
    setFeedback(Array.from({ length: SLOT_COUNT }, () => "none"));
    setLockedIndexes(new Set());
    setBlockedByPos(Array.from({ length: SLOT_COUNT }, () => new Set()));
    setGuessesUsed(0);
    setSolved(false);
    setFailed(false);
    setNotice("");
    setAverageGuesses(null);
    setShowShareModal(false);
    setShowHelpModal(false);
    updateUrlForDay(null);
  }

  function persistCurrentState(next?: Partial<OrderMeStateEntry>) {
    if (!activePuzzle) return;
    const entry: OrderMeStateEntry = {
      placed,
      feedback,
      lockedIndexes: [...lockedIndexes.values()],
      blockedByPos: blockedByPos.map((row) => [...row.values()]),
      guessesUsed,
      solved,
      failed,
      ...next
    };
    writeStateForDay(activePuzzle.date, entry);
  }

  async function completePuzzle(nextGuessCount: number, didSolve: boolean) {
    if (!activePuzzle) return;

    const updated: ProgressState = {
      completed: {
        ...progress.completed,
        [activePuzzle.date]: {
          guesses: nextGuessCount,
          completedAt: new Date().toISOString(),
          solved: didSolve
        }
      }
    };
    setProgress(updated);
    persistProgress(updated);

    setShowResultOverlay(true);
    await new Promise((resolve) => window.setTimeout(resolve, SUCCESS_MS));
    setShowResultOverlay(false);

    const localPlayerId = getOrCreateLocalPlayerId();
    try {
      await recordOrderMeCompletion(activePuzzle.date, localPlayerId, nextGuessCount);
    } catch {
      // best effort
    }

    try {
      const avg = await getOrderMeAverageGuesses(activePuzzle.date);
      setAverageGuesses(avg == null ? null : avg.toFixed(2));
    } catch {
      setAverageGuesses(null);
    }
  }

  function placeWordInSlot(word: string, slotIndex: number) {
    if (!activePuzzle || solved || failed) return;
    if (lockedIndexes.has(slotIndex)) return;
    if (blockedByPos[slotIndex]?.has(word)) {
      setNotice("Incorrect placement, already tried...");
      return;
    }

    const next = [...placed];
    const currentIdx = next.findIndex((value) => value === word);
    const targetWord = next[slotIndex];
    if (currentIdx >= 0 && currentIdx !== slotIndex && targetWord) {
      next[currentIdx] = targetWord;
      next[slotIndex] = word;
    } else {
      if (currentIdx >= 0) next[currentIdx] = null;
      next[slotIndex] = word;
    }
    setPlaced(next);
    setDragWord(null);
    setNotice("");
  }

  function clearSlot(slotIndex: number) {
    if (!activePuzzle || solved || failed) return;
    if (lockedIndexes.has(slotIndex)) return;
    const next = [...placed];
    next[slotIndex] = null;
    setPlaced(next);
  }

  function getSlotAtPoint(clientX: number, clientY: number): number | null {
    for (let idx = 0; idx < SLOT_COUNT; idx += 1) {
      const node = slotRefs.current[idx];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return idx;
      }
    }
    return null;
  }

  function startPointerDrag(word: string, sourceSlot: number | null, clientX: number, clientY: number) {
    if (!activePuzzle || solved || failed) return;
    setDragWord(word);
    setDragSourceSlot(sourceSlot);
    setDragPos({ x: clientX, y: clientY });
    setDragOverSlot(getSlotAtPoint(clientX, clientY));
  }

  useEffect(() => {
    if (!dragWord) return;

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      setDragPos({ x: event.clientX, y: event.clientY });
      setDragOverSlot(getSlotAtPoint(event.clientX, event.clientY));
    };

    const stopDragging = () => {
      setDragWord(null);
      setDragSourceSlot(null);
      setDragPos(null);
      setDragOverSlot(null);
    };

    const handlePointerUp = (event: PointerEvent) => {
      event.preventDefault();
      const dropSlot = getSlotAtPoint(event.clientX, event.clientY);
      if (dropSlot != null) {
        placeWordInSlot(dragWord, dropSlot);
      } else if (dragSourceSlot != null) {
        clearSlot(dragSourceSlot);
      }
      stopDragging();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragWord, dragSourceSlot, activePuzzle, solved, failed, lockedIndexes, blockedByPos, placed]);

  async function checkOrder() {
    if (!activePuzzle || solved || failed) return;
    if (placed.some((word) => !word)) {
      setNotice("Fill all 6 slots first.");
      return;
    }
    for (let idx = 0; idx < SLOT_COUNT; idx += 1) {
      const word = placed[idx];
      if (word && blockedByPos[idx]?.has(word)) {
        setNotice("Move red placements before checking again.");
        return;
      }
    }

    const correct = orderedWords;
    const nextFeedback: Feedback[] = Array.from({ length: SLOT_COUNT }, () => "none");
    const nextLocked = new Set(lockedIndexes);
    const nextBlocked = blockedByPos.map((row) => new Set(row));

    for (let idx = 0; idx < SLOT_COUNT; idx += 1) {
      const word = placed[idx]!;
      if (word === correct[idx]) {
        nextFeedback[idx] = "green";
        nextLocked.add(idx);
        continue;
      }

      nextFeedback[idx] = "red";
      nextBlocked[idx].add(word);
    }

    const nextGuessesUsed = guessesUsed + 1;
    const didSolve = nextFeedback.every((status) => status === "green");
    const didFail = !didSolve && nextGuessesUsed >= MAX_GUESSES;

    setFeedback(nextFeedback);
    setLockedIndexes(nextLocked);
    setBlockedByPos(nextBlocked);
    setGuessesUsed(nextGuessesUsed);
    setSolved(didSolve);
    setFailed(didFail);
    setNotice("");

    writeStateForDay(activePuzzle.date, {
      placed,
      feedback: nextFeedback,
      lockedIndexes: [...nextLocked.values()],
      blockedByPos: nextBlocked.map((row) => [...row.values()]),
      guessesUsed: nextGuessesUsed,
      solved: didSolve,
      failed: didFail
    });

    if (didSolve || didFail) {
      await completePuzzle(nextGuessesUsed, didSolve);
    }
  }

  function clearBoard() {
    if (!activePuzzle || solved || failed) return;
    const next = [...placed];
    for (let idx = 0; idx < SLOT_COUNT; idx += 1) {
      if (lockedIndexes.has(idx)) continue;
      next[idx] = null;
    }
    setPlaced(next);
    setNotice("");
    persistCurrentState({ placed: next });
  }

  function playToday() {
    if (allAvailablePlayed) return;
    const target = mostRecentUnplayed ?? playablePuzzles[0];
    if (target) startPuzzle(target.date);
  }

  function playAgain() {
    if (!activePuzzle) return;
    const unplayed = playablePuzzles.find((entry) => !progress.completed[entry.date]);
    if (unplayed) {
      startPuzzle(unplayed.date);
      return;
    }
    const currentIndex = playablePuzzles.findIndex((entry) => entry.date === activePuzzle.date);
    if (currentIndex >= 0 && playablePuzzles[currentIndex + 1]) {
      startPuzzle(playablePuzzles[currentIndex + 1].date);
      return;
    }
    returnToLanding();
  }

  async function shareResult() {
    const payload = `${shareText} ${shareUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, url: shareUrl });
        return;
      } catch {
        // fallback
      }
    }
    setShowShareModal(true);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // ignore
    }
  }

  async function copySharePayload() {
    const payload = `${shareText} ${shareUrl}`;
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="site-shell">
        <div className="top-actions">
          <button className="theme-toggle quit-toggle" type="button" onClick={onBack}>Back</button>
          <button className="theme-toggle" type="button" onClick={onToggleTheme}>{theme === "light" ? "Dark mode" : "Light mode"}</button>
        </div>
        <section className="screen screen-basic">
          <header className="screen-header">
            <h1>{game.title}</h1>
            <p className="body-text">Loading daily puzzles...</p>
          </header>
        </section>
      </div>
    );
  }

  if (errorText) {
    return (
      <div className="site-shell">
        <div className="top-actions">
          <button className="theme-toggle quit-toggle" type="button" onClick={onBack}>Back</button>
          <button className="theme-toggle" type="button" onClick={onToggleTheme}>{theme === "light" ? "Dark mode" : "Light mode"}</button>
        </div>
        <section className="screen screen-basic">
          <header className="screen-header">
            <h1>{game.title}</h1>
            <p className="hint-text error-text">{errorText}</p>
          </header>
        </section>
      </div>
    );
  }

  const inGame = Boolean(activePuzzle);
  const completed = solved || failed;
  const guessesRemaining = Math.max(0, MAX_GUESSES - guessesUsed);

  return (
    <div className="site-shell sw-shell om-shell">
      <div className="top-actions">
        <button className="theme-toggle quit-toggle" type="button" onClick={inGame ? returnToLanding : onBack}>{inGame ? "Quit" : "Back"}</button>
        <button className="theme-toggle" type="button" onClick={onToggleTheme}>{theme === "light" ? "Dark mode" : "Light mode"}</button>
      </div>

      {!inGame ? (
        <section className="screen screen-home sw-screen">
          <header className="screen-header">
            <div className="landing-hero-wrap">
              <img className="landing-hero-image" src={game.heroImage} alt={`${game.title} image`} />
            </div>
            <div className="play-meta-row"><div className="play">{dailyStreak} game streak</div></div>
            <h1>Order the words:</h1>
            <p className="body-text">Order today's six words based on their similarity to the main word.</p>
          </header>

          <div className="bottom-stack sw-stack">
            <button className="btn btn-key" type="button" onClick={playToday} disabled={allAvailablePlayed}>Play</button>
            {allAvailablePlayed ? <p className="hint-text error-text">{ALL_PLAYED_TEXT}</p> : null}
            <br></br><p className="hint-text">Previous games:</p>
            <div className="sw-slider-wrap">
              <div className="sw-slider">
                {playablePuzzles.map((entry) => {
                  const isToday = entry.date === today;
                  const isHighlighted = entry.date === highlightedDate;
                  return (
                    <button key={entry.date} type="button" data-sw-day={entry.date} className={`sw-day-chip${isHighlighted ? " is-today" : ""}`} onClick={() => startPuzzle(entry.date)}>
                      <span />
                      <strong>{isToday ? "Today" : formatDayLabel(entry.date)}</strong>
                      <span />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : completed ? (
        <section className="screen screen-basic sw-screen sw-play-screen">
          <header className="screen-header">
            <div className="play-meta-row"><div className="play">{dailyStreak} game streak</div></div>
            <h1>{solved ? "Solved!" : "Close!"}</h1></header>
<div className="sw-date-guess-row-inner">
            <p className="sw-date-text">{formatLongDay(activePuzzle!.date)}</p><p className="sw-date-text">Guesses: {guessesUsed}/4</p>
            </div>
            <div className="sw-date-guess-row-inner">
              <p className="sw-date-text"></p>
              <p className="sw-date-text">Avg. Guesses: <b>{averageGuesses ?? "Waiting..."}</b></p>
            </div>
            <div className="sw-date-guess-row-inner">
              
            </div>
          <div className="om-grid">
            {placed.map((word, idx) => (
              <div key={`board-${idx}-${word || "empty"}`} className={`om-slot om-${feedback[idx] || "none"}${feedback[idx] === "green" ? " om-locked" : ""}`}>
                {!word ? <small><b>#{idx + 2}</b></small> : null}
                {word ? (
                  <span className="om-word-pill om-slot-pill">{word.toUpperCase()}</span>
                ) : (
                  <span className="om-slot-placeholder"></span>
                )}
              </div>
            ))}
          </div>

          <div className="bottom-stack">
            <button className="btn btn-key" type="button" onClick={playAgain}>Play more</button>
            <button className="btn btn-soft" type="button" onClick={() => void shareResult()}>Challenge friends</button>
          </div>
        </section>
      ) : (
        <section className="screen screen-basic sw-screen sw-play-screen">
          <header className="screen-header">
            <div className="play-meta-row"><div className="play">{dailyStreak} game streak</div></div>
            <h1>Order the words:</h1>
          </header><div className="space15"></div>
<div className="sw-date-guess-row">
            <p className="sw-date-text">#1 {activePuzzle!.target.toUpperCase()}</p><p className="sw-date-text">{formatLongDay(activePuzzle!.date)}</p>
            </div>



          <div className="om-grid">
            {Array.from({ length: SLOT_COUNT }).map((_, idx) => {
              const word = placed[idx];
              const rowFeedback = feedback[idx] ?? "none";
              const isLocked = lockedIndexes.has(idx);
              return (
                <div
                  key={`slot-${idx}`}
                  ref={(node) => {
                    slotRefs.current[idx] = node;
                  }}
                  className={`om-slot om-${rowFeedback}${isLocked ? " om-locked" : ""}${dragOverSlot === idx ? " om-drop-target" : ""}`}
                >
                  {!word ? <small><b>#{idx + 2}</b></small> : null}
                  {word ? (
                    <button
                      type="button"
                      className={`om-word-pill om-slot-pill${dragWord === word ? " is-dragging" : ""}`}
                      onPointerDown={(event) => {
                        if (isLocked) return;
                        event.preventDefault();
                        startPointerDrag(word, idx, event.clientX, event.clientY);
                      }}
                    >
                      {word.toUpperCase()}
                    </button>
                  ) : (
                    <span className="om-slot-placeholder"></span>
                  )}
                </div>
              );
            })}

          </div>

            

          <div className="sw-date-guess-row-inner sg">
          <span className="sw-date-text">Guesses remaining:</span>
            <div className="oa-guess-pips">
              {Array.from({ length: MAX_GUESSES }).map((_, idx) => (
                <span key={`pip-${idx}`} className={`oa-pip${idx < guessesRemaining ? " is-live" : ""}`} />
              ))}
            </div><div className="sw-hint-actions"><button type="button" className="btn btn-soft runtime-reroll-btn btn-left mores shorter-btn vs" onClick={() => setShowHelpModal(true)}>??</button>
          </div></div>
<div className="space15"></div>
                    <div className="bottom-row">
            <button className="btn btn-soft" type="button" onClick={clearBoard}>Clear</button>
            <button className="btn btn-key" type="button" onClick={() => void checkOrder()} disabled={placed.some((word) => !word)}>Guess</button>
          </div>

            <div className="om-pool">{poolWords.map((word) => (
              <button
                key={`pool-${word}`}
                type="button"
                className={`om-word-pill om-pool-pill${dragWord === word ? " is-dragging" : ""}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  startPointerDrag(word, null, event.clientX, event.clientY);
                }}
              >
                {word.toUpperCase()}
              </button>
            ))}
          </div>

          {dragWord && dragPos ? (
            <div className="om-word-pill om-pool-pill om-drag-preview" style={{ left: dragPos.x, top: dragPos.y }}>
              {dragWord.toUpperCase()}
            </div>
          ) : null}

          {notice ? <p className="hint-text error-text">{notice}</p> : null}

        </section>
      )}

      {showResultOverlay && activePuzzle ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card sw-success-pop">
            <h2>{solved ? "Solved!" : "Close!"}</h2>
            <p className="body-text"></p>
          </div>
        </div>
      ) : null}

      {showShareModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Share</h2>
            <p className="hint-text">{shareText}</p>
            <textarea className="input-pill" value={`${shareText} ${shareUrl}`} readOnly rows={4} style={{ borderRadius: 16 }} />
            <div className="bottom-row">
              <button className="btn btn-key" type="button" onClick={() => void copySharePayload()}>Copy</button>
              <button className="btn btn-soft" type="button" onClick={() => setShowShareModal(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {showHelpModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>How to play</h2>
            <p className="sw-date-text">
              Drag the 6 words into order from most similar to least similar.
              <br /><br />
              Fill all slots, then press guess. You get 4 guesses total.
              <br /><br />
              Green = exact position.
              <br /><br />
              Red = wrong position and blocked for that slot next time.
            </p>
            <button className="btn btn-soft" type="button" onClick={() => setShowHelpModal(false)}>Back</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
