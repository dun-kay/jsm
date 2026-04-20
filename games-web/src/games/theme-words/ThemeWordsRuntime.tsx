import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GameConfig } from "../types";
import dailySeed from "./themeSeed.generated.json";
import { getThemeWordsAverageSeconds, recordThemeWordsCompletion } from "../../lib/themeWordsApi";
import { solveThemeLayout, type ThemeWordPlacement } from "./layout";

type ThemeMode = "light" | "dark";

type ThemeWordsRuntimeProps = {
  game: GameConfig;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBack: () => void;
};

type ThemeWordPuzzle = {
  date: string;
  letters: string;
  themeTitle: string;
  themeSubtitle?: string;
  targetWords: string[];
  placements?: ThemeWordPlacement[];
};

type ProgressState = {
  completed: Record<string, { guesses?: number; seconds?: number; completedAt: string }>;
};

type FoundHistoryState = {
  byDate: Record<string, string[]>;
};

type TimerHistoryState = {
  byDate: Record<string, number>;
};

type Point = {
  x: number;
  y: number;
};

type GridBounds = {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
};

type CellState = {
  letter: string;
  words: string[];
};

const PROGRESS_KEY = "notes_theme_words_progress_v1";
const FOUND_KEY = "notes_theme_words_found_v1";
const TIMER_KEY = "notes_theme_words_timer_v1";
const KEY_HOLD_MS = 500;
const SUCCESS_MS = 2000;
const KEYBOARD_VIEWBOX = 100;
const KEYBOARD_CENTER = KEYBOARD_VIEWBOX / 2;
const KEYBOARD_RADIUS = 34;
const ALL_PLAYED_TEXT = "Congrats, you have played all available games right now. Come back tomorrow to play again.";
const PLAYER_KEY = "notes_theme_words_player_id";

function formatElapsed(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toIsoLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getOrCreateLocalPlayerId(): string {
  try {
    const current = window.localStorage.getItem(PLAYER_KEY);
    if (current) {
      return current;
    }
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
  if (completedDates.length === 0) {
    return 0;
  }

  const completedSet = new Set(completedDates);
  const today = new Date();
  const todayIso = toIsoLocal(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = toIsoLocal(yesterday);

  const latestPlayed = completedDates.slice().sort((a, b) => b.localeCompare(a))[0];
  if (latestPlayed !== todayIso && latestPlayed !== yesterdayIso) {
    return 0;
  }

  let streak = 0;
  const cursor = new Date(`${latestPlayed}T00:00:00`);
  while (true) {
    const iso = toIsoLocal(cursor);
    if (!completedSet.has(iso)) {
      break;
    }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function formatDayLabel(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "2-digit" });
}

function formatLongDay(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function readProgress(): ProgressState {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) {
      return { completed: {} };
    }
    const parsed = JSON.parse(raw) as ProgressState;
    if (!parsed || typeof parsed !== "object" || !parsed.completed) {
      return { completed: {} };
    }
    return parsed;
  } catch {
    return { completed: {} };
  }
}

function persistProgress(value: ProgressState) {
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(value));
}

function readFoundHistory(): FoundHistoryState {
  try {
    const raw = window.localStorage.getItem(FOUND_KEY);
    if (!raw) {
      return { byDate: {} };
    }
    const parsed = JSON.parse(raw) as FoundHistoryState;
    if (!parsed || typeof parsed !== "object" || !parsed.byDate) {
      return { byDate: {} };
    }
    return parsed;
  } catch {
    return { byDate: {} };
  }
}

function persistFoundHistory(value: FoundHistoryState) {
  window.localStorage.setItem(FOUND_KEY, JSON.stringify(value));
}

function readFoundForDay(day: string, targetWords: string[]): string[] {
  const history = readFoundHistory();
  const words = history.byDate[day] ?? [];
  const valid = new Set(targetWords.map((word) => word.toUpperCase()));
  const seen = new Set<string>();
  const next: string[] = [];

  for (const candidate of words) {
    const normalized = String(candidate).toUpperCase();
    if (!valid.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }

  return next;
}

function writeFoundForDay(day: string, words: string[]) {
  const history = readFoundHistory();
  history.byDate[day] = words;
  persistFoundHistory(history);
}

function readTimerHistory(): TimerHistoryState {
  try {
    const raw = window.localStorage.getItem(TIMER_KEY);
    if (!raw) {
      return { byDate: {} };
    }
    const parsed = JSON.parse(raw) as TimerHistoryState;
    if (!parsed || typeof parsed !== "object" || !parsed.byDate) {
      return { byDate: {} };
    }
    return parsed;
  } catch {
    return { byDate: {} };
  }
}

function persistTimerHistory(value: TimerHistoryState) {
  window.localStorage.setItem(TIMER_KEY, JSON.stringify(value));
}

function readTimerForDay(day: string): number {
  const history = readTimerHistory();
  const value = Number(history.byDate[day]);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function writeTimerForDay(day: string, seconds: number) {
  const history = readTimerHistory();
  history.byDate[day] = Math.max(0, Math.floor(seconds));
  persistTimerHistory(history);
}

function normalizedSeed(): ThemeWordPuzzle[] {
  return (dailySeed as ThemeWordPuzzle[]).map((entry) => ({
    date: String(entry.date),
    letters: String(entry.letters).toUpperCase(),
    themeTitle: String(entry.themeTitle),
    themeSubtitle: entry.themeSubtitle ? String(entry.themeSubtitle) : undefined,
    targetWords: entry.targetWords.map((word) => String(word).toUpperCase())
  }));
}

function pointString(point: Point): string {
  return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
}

function findPointForKey(index: number, keyCount: number): Point {
  const angle = (Math.PI * 2 * index) / keyCount - Math.PI / 2;
  return {
    x: KEYBOARD_CENTER + KEYBOARD_RADIUS * Math.cos(angle),
    y: KEYBOARD_CENTER + KEYBOARD_RADIUS * Math.sin(angle)
  };
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffledLettersForDay(dateIso: string, letters: string): string[] {
  const chars = letters.toUpperCase().split("");
  if (chars.length < 2) {
    return chars;
  }

  let seed = hashSeed(`${dateIso}:${letters}`) || 1;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  for (let idx = chars.length - 1; idx > 0; idx -= 1) {
    const swapIndex = Math.floor(rand() * (idx + 1));
    [chars[idx], chars[swapIndex]] = [chars[swapIndex], chars[idx]];
  }

  if (chars.join("") === letters.toUpperCase()) {
    const first = chars.shift();
    if (first) {
      chars.push(first);
    }
  }

  return chars;
}

function buildGridState(placements: ThemeWordPlacement[], foundWords: string[]) {
  if (!placements || placements.length === 0) {
    return {
      bounds: null as GridBounds | null,
      cells: new Map<string, CellState>()
    };
  }

  const cells = new Map<string, CellState>();
  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;

  for (const placement of placements) {
    const chars = placement.word.split("");
    chars.forEach((letter, index) => {
      const row = placement.row + (placement.direction === "down" ? index : 0);
      const col = placement.col + (placement.direction === "across" ? index : 0);
      const key = `${row}:${col}`;
      const existing = cells.get(key);
      if (!existing) {
        cells.set(key, {
          letter,
          words: [placement.word]
        });
      } else {
        if (existing.letter !== letter) {
          return;
        }
        existing.words.push(placement.word);
      }

      minRow = Math.min(minRow, row);
      minCol = Math.min(minCol, col);
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    });
  }

  if (!Number.isFinite(minRow) || !Number.isFinite(minCol) || !Number.isFinite(maxRow) || !Number.isFinite(maxCol)) {
    return {
      bounds: null as GridBounds | null,
      cells
    };
  }

  return {
    bounds: {
      minRow,
      maxRow,
      minCol,
      maxCol
    },
    cells,
    foundSet: new Set(foundWords)
  };
}

export default function ThemeWordsRuntime({ game, theme, onToggleTheme, onBack }: ThemeWordsRuntimeProps) {
  const [puzzles, setPuzzles] = useState<ThemeWordPuzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ProgressState>(() => readProgress());
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [foundWords, setFoundWords] = useState<string[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timerPaused, setTimerPaused] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const [averageTime, setAverageTime] = useState<string | null>(null);
  const [inputNotice, setInputNotice] = useState("");
  const [pathIndexes, setPathIndexes] = useState<number[]>([]);
  const [pathPoints, setPathPoints] = useState<Point[]>([]);
  const [traceCursor, setTraceCursor] = useState<Point | null>(null);
  const [shake, setShake] = useState(false);
  const [keyboardLocked, setKeyboardLocked] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(() => !document.hidden);

  const keyboardWrapRef = useRef<HTMLDivElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);

  const pointerIdRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const pathIndexesRef = useRef<number[]>([]);
  const pathPointsRef = useRef<Point[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const timerLastTickRef = useRef<number | null>(null);

  const activePuzzle = useMemo(() => {
    if (!activeDate) {
      return null;
    }
    return puzzles.find((entry) => entry.date === activeDate) ?? null;
  }, [activeDate, puzzles]);

  const wheelLetters = useMemo(() => {
    if (!activePuzzle) {
      return [];
    }
    return shuffledLettersForDay(activePuzzle.date, activePuzzle.letters);
  }, [activePuzzle]);

  const previewWord = useMemo(() => {
    if (!activePuzzle || wheelLetters.length === 0) {
      return "";
    }
    return pathIndexes.map((idx) => wheelLetters[idx] || "").join("");
  }, [pathIndexes, activePuzzle, wheelLetters]);

  const today = useMemo(() => toIsoLocal(new Date()), []);

  const playablePuzzles = useMemo(() => {
    return puzzles.filter((entry) => entry.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  }, [puzzles, today]);

  const unplayedPuzzle = useMemo(() => {
    return playablePuzzles.find((entry) => !progress.completed[entry.date]) ?? null;
  }, [playablePuzzles, progress.completed]);

  const allAvailablePlayed = playablePuzzles.length > 0 && unplayedPuzzle == null;
  const dailyStreak = useMemo(() => computeDailyStreak(progress.completed), [progress.completed]);

  const mostRecentUnplayed = useMemo(() => {
    return unplayedPuzzle ?? playablePuzzles[0] ?? null;
  }, [unplayedPuzzle, playablePuzzles]);

  const shareUrl = useMemo(() => {
    const puzzleDate = activePuzzle?.date ?? mostRecentUnplayed?.date;
    if (!puzzleDate) {
      return `${window.location.origin}${game.route}`;
    }
    return `${window.location.origin}${game.route}?day=${encodeURIComponent(puzzleDate)}`;
  }, [activePuzzle?.date, mostRecentUnplayed?.date, game.route]);

  const successText = useMemo(() => {
    if (!activePuzzle) {
      return "I solved today's Theme Words puzzle.";
    }
    return `I found all ${activePuzzle.targetWords.length} Theme Words in ${formatElapsed(Math.floor(elapsedMs / 1000))}.`;
  }, [activePuzzle, elapsedMs]);

  const inGame = Boolean(activePuzzle);
  const solved = activePuzzle ? foundWords.length === activePuzzle.targetWords.length : false;
  const highlightedDate = mostRecentUnplayed?.date ?? playablePuzzles[0]?.date ?? null;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const missingWords = useMemo(
    () => (activePuzzle ? activePuzzle.targetWords.filter((word) => !foundWords.includes(word)) : []),
    [activePuzzle, foundWords]
  );
  const showGiveUp = missingWords.length < 4 || hintsUsed >= 3;
  const timerRunning = inGame && !solved && !timerPaused && isPageVisible;

  const activePlacements = useMemo(() => {
    if (!activePuzzle) {
      return [] as ThemeWordPlacement[];
    }
    return solveThemeLayout(activePuzzle.targetWords, activePuzzle.date);
  }, [activePuzzle]);

  const gridState = useMemo(() => buildGridState(activePlacements, foundWords), [activePlacements, foundWords]);

  useEffect(() => {
    setLoading(true);
    const sorted = normalizedSeed().sort((a, b) => b.date.localeCompare(a.date));
    setPuzzles(sorted);
    setLoading(false);
  }, [today]);

  useEffect(() => {
    if (puzzles.length === 0) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const day = params.get("day");
    if (day) {
      const found = puzzles.find((entry) => entry.date === day);
      if (found) {
        startPuzzle(found.date);
      }
    }
  }, [puzzles]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (timerRunning) {
      if (timerLastTickRef.current == null) {
        timerLastTickRef.current = performance.now();
      }
      timerIntervalRef.current = window.setInterval(() => {
        const now = performance.now();
        const previous = timerLastTickRef.current ?? now;
        timerLastTickRef.current = now;
        const delta = Math.max(0, now - previous);
        setElapsedMs((current) => current + delta);
      }, 250);
      return () => {
        if (timerIntervalRef.current != null) {
          window.clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      };
    }

    timerLastTickRef.current = null;
    if (timerIntervalRef.current != null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    return;
  }, [timerRunning]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
      }
      if (timerIntervalRef.current != null) {
        window.clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    pathIndexesRef.current = pathIndexes;
  }, [pathIndexes]);

  useEffect(() => {
    pathPointsRef.current = pathPoints;
  }, [pathPoints]);

  useEffect(() => {
    if (inGame || !highlightedDate || !sliderRef.current) {
      return;
    }

    const target = sliderRef.current.querySelector(`[data-tw-day="${highlightedDate}"]`) as HTMLButtonElement | null;
    if (!target) {
      return;
    }

    sliderRef.current.scrollLeft = Math.max(0, target.offsetLeft);
  }, [inGame, highlightedDate, playablePuzzles]);

  useEffect(() => {
    if (!activeDate) {
      return;
    }
    writeTimerForDay(activeDate, elapsedSeconds);
  }, [activeDate, elapsedSeconds]);

  useEffect(() => {
    if (!activePuzzle || !solved) {
      return;
    }

    let canceled = false;
    const run = async () => {
      try {
        const avg = await getThemeWordsAverageSeconds(activePuzzle.date);
        if (!canceled) {
          setAverageTime(avg == null ? null : formatElapsed(Math.round(avg)));
        }
      } catch {
        if (!canceled) {
          setAverageTime(null);
        }
      }
    };
    void run();

    return () => {
      canceled = true;
    };
  }, [activePuzzle, solved]);

  function updateUrlForDay(day: string | null) {
    const url = new URL(window.location.href);
    if (day) {
      url.searchParams.set("day", day);
    } else {
      url.searchParams.delete("day");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function startPuzzle(day: string) {
    setActiveDate(day);
    const puzzle = puzzles.find((entry) => entry.date === day);
    if (puzzle) {
      setFoundWords(readFoundForDay(day, puzzle.targetWords));
      const completedSeconds = progress.completed[day]?.seconds ?? progress.completed[day]?.guesses ?? 0;
      const savedTimerSeconds = readTimerForDay(day);
      const savedSeconds = Math.max(completedSeconds, savedTimerSeconds);
      setElapsedMs(savedSeconds * 1000);
    } else {
      setFoundWords([]);
      setElapsedMs(0);
    }
    setHintsUsed(0);
    setGaveUp(false);
    setAverageTime(null);
    setTimerPaused(false);
    setInputNotice("");
    setPathIndexes([]);
    setPathPoints([]);
    setTraceCursor(null);
    setShowHelpModal(false);
    updateUrlForDay(day);
  }

  function returnToLanding() {
    setActiveDate(null);
    setFoundWords([]);
    setElapsedMs(0);
    setTimerPaused(false);
    setHintsUsed(0);
    setGaveUp(false);
    setAverageTime(null);
    setInputNotice("");
    setPathIndexes([]);
    setPathPoints([]);
    setTraceCursor(null);
    setShowShareModal(false);
    setShowQuitModal(false);
    setShowHelpModal(false);
    updateUrlForDay(null);
  }

  function triggerShake() {
    setShake(false);
    window.requestAnimationFrame(() => setShake(true));
    window.setTimeout(() => setShake(false), 450);
  }

  function lockKeyboardThenClearPath() {
    setKeyboardLocked(true);
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      setKeyboardLocked(false);
      setPathIndexes([]);
      setPathPoints([]);
      setTraceCursor(null);
      holdTimerRef.current = null;
    }, KEY_HOLD_MS);
  }

  async function completePuzzle(finalElapsedSeconds: number) {
    if (!activePuzzle) {
      return;
    }

    const updated: ProgressState = {
      completed: {
        ...progress.completed,
        [activePuzzle.date]: {
          guesses: finalElapsedSeconds,
          seconds: finalElapsedSeconds,
          completedAt: new Date().toISOString()
        }
      }
    };
    setProgress(updated);
    persistProgress(updated);

    const localPlayerId = getOrCreateLocalPlayerId();
    try {
      await recordThemeWordsCompletion(activePuzzle.date, localPlayerId, finalElapsedSeconds);
    } catch {
      // best effort
    }

    try {
      const avg = await getThemeWordsAverageSeconds(activePuzzle.date);
      setAverageTime(avg == null ? null : formatElapsed(Math.round(avg)));
    } catch {
      setAverageTime(null);
    }

    setShowSuccessOverlay(true);
    await new Promise((resolve) => window.setTimeout(resolve, SUCCESS_MS));
    setShowSuccessOverlay(false);
  }

  function submitGuess(word: string) {
    if (!activePuzzle || solved) {
      return;
    }

    const normalized = word.toUpperCase();
    if (normalized.length < 2) {
      setInputNotice("");
      triggerShake();
      return;
    }

    if (foundWords.includes(normalized)) {
      setInputNotice("ALREADY FOUND");
      triggerShake();
      return;
    }

    if (!activePuzzle.targetWords.includes(normalized)) {
      setInputNotice("");
      triggerShake();
      return;
    }

    const nextFoundWords = [normalized, ...foundWords];
    setFoundWords(nextFoundWords);
    writeFoundForDay(activePuzzle.date, nextFoundWords);
    setInputNotice("");

    if (nextFoundWords.length === activePuzzle.targetWords.length) {
      void completePuzzle(Math.floor(elapsedMs / 1000));
    }
  }

  function revealHintWord() {
    if (!activePuzzle || solved || missingWords.length === 0) {
      return;
    }
    const randomIndex = Math.floor(Math.random() * missingWords.length);
    const selectedWord = missingWords[randomIndex];
    const nextFoundWords = [selectedWord, ...foundWords];
    setFoundWords(nextFoundWords);
    writeFoundForDay(activePuzzle.date, nextFoundWords);
    setHintsUsed((current) => current + 1);
    setInputNotice("HINT");
    if (nextFoundWords.length === activePuzzle.targetWords.length) {
      void completePuzzle(Math.floor(elapsedMs / 1000));
    }
  }

  function giveUpGame() {
    if (!activePuzzle || solved || missingWords.length === 0) {
      return;
    }
    const nextFoundWords = [...missingWords, ...foundWords];
    setFoundWords(nextFoundWords);
    writeFoundForDay(activePuzzle.date, nextFoundWords);
    setInputNotice("GAVE UP");
    setGaveUp(true);
    void completePuzzle(Math.floor(elapsedMs / 1000));
  }

  function onHintAction() {
    if (showGiveUp) {
      giveUpGame();
      return;
    }
    revealHintWord();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePuzzle || keyboardLocked || solved) {
      return;
    }

    const key = (event.target as HTMLElement).closest("[data-sw-key]") as HTMLButtonElement | null;
    if (!key) {
      return;
    }

    if (timerPaused) {
      setTimerPaused(false);
    }
    setInputNotice("");
    draggingRef.current = true;
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    const index = Number(key.dataset.swKey);
    const point = findPointForKey(index, wheelLetters.length);
    pathIndexesRef.current = [index];
    pathPointsRef.current = [point];
    setPathIndexes([index]);
    setPathPoints([point]);
    setTraceCursor(point);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePuzzle || !draggingRef.current || solved) {
      return;
    }

    const wrapRect = keyboardWrapRef.current?.getBoundingClientRect();
    if (wrapRect) {
      setTraceCursor({
        x: ((event.clientX - wrapRect.left) / wrapRect.width) * KEYBOARD_VIEWBOX,
        y: ((event.clientY - wrapRect.top) / wrapRect.height) * KEYBOARD_VIEWBOX
      });
    }

    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const key = hovered?.closest("[data-sw-key]") as HTMLButtonElement | null;
    if (!key) {
      return;
    }

    const index = Number(key.dataset.swKey);
    const currentIndexes = pathIndexesRef.current;

    if (
      currentIndexes.length >= 2
      && index === currentIndexes[currentIndexes.length - 2]
    ) {
      const nextIndexes = currentIndexes.slice(0, -1);
      const nextPoints = pathPointsRef.current.slice(0, -1);
      pathIndexesRef.current = nextIndexes;
      pathPointsRef.current = nextPoints;
      setPathIndexes(nextIndexes);
      setPathPoints(nextPoints);
      return;
    }

    if (currentIndexes.includes(index)) {
      return;
    }

    const nextIndexes = [...currentIndexes, index];
    const nextPoints = [...pathPointsRef.current, findPointForKey(index, wheelLetters.length)];
    pathIndexesRef.current = nextIndexes;
    pathPointsRef.current = nextPoints;
    setPathIndexes(nextIndexes);
    setPathPoints(nextPoints);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePuzzle || !draggingRef.current || solved) {
      return;
    }

    draggingRef.current = false;
    if (pointerIdRef.current != null && event.currentTarget.hasPointerCapture(pointerIdRef.current)) {
      event.currentTarget.releasePointerCapture(pointerIdRef.current);
    }
    pointerIdRef.current = null;

    if (pathIndexesRef.current.length < 2) {
      lockKeyboardThenClearPath();
      return;
    }

    const word = pathIndexesRef.current.map((index) => wheelLetters[index] || "").join("");
    submitGuess(word);
    lockKeyboardThenClearPath();
  }

  function playToday() {
    if (allAvailablePlayed) {
      return;
    }

    const target = mostRecentUnplayed ?? playablePuzzles[0];
    if (target) {
      startPuzzle(target.date);
    }
  }

  function playAgain() {
    if (!activePuzzle) {
      return;
    }

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
    const payload = `${successText} ${shareUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ text: successText, url: shareUrl });
        return;
      } catch {
        // fallback to modal copy
      }
    }
    setShowShareModal(true);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // best effort
    }
  }

  async function copySharePayload() {
    const payload = `${successText} ${shareUrl}`;
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // best effort
    }
  }

  if (loading) {
    return (
      <div className="site-shell">
        <div className="top-actions">
          <button className="theme-toggle quit-toggle" type="button" onClick={onBack}>
            Back
          </button>
          <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
        <section className="screen screen-basic">
          <header className="screen-header">
            <h1>{game.title}</h1>
            <p className="body-text">Loading daily puzzle...</p>
          </header>
        </section>
      </div>
    );
  }

  return (
    <div className="site-shell sw-shell tw-shell">
      <div className="top-actions">
        <button className="theme-toggle quit-toggle" type="button" onClick={inGame ? () => setShowQuitModal(true) : onBack}>
          {inGame ? "Quit" : "Back"}
        </button>
        <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
          {theme === "light" ? "Dark mode" : "Light mode"}
        </button>
      </div>

      {!inGame ? (
        <section className="screen screen-home sw-screen">
          <header className="screen-header">
            <div className="landing-hero-wrap">
              <img className="landing-hero-image" src={game.heroImage} alt={`${game.title} image`} />
            </div>
            <div className="play-meta-row">
              <div className="play">{dailyStreak} game streak</div>
            </div>
            <h1>Find the Theme Words:</h1>
            <p className="body-text">Find the hidden words in today's letter theme. Use the letter wheel to build words.</p>
          </header>

          <div className="bottom-stack sw-stack">
            <button className="btn btn-key" type="button" onClick={playToday} disabled={allAvailablePlayed}>Play</button>
            {allAvailablePlayed ? <p className="hint-text error-text">{ALL_PLAYED_TEXT}</p> : null}
            <br></br>
            <p className="hint-text">Previous games:</p>
            <div className="sw-slider-wrap">
              <div ref={sliderRef} className="sw-slider">
                {playablePuzzles.map((entry) => {
                  const isToday = entry.date === today;
                  const isHighlighted = entry.date === highlightedDate;
                  return (
                    <button
                      key={entry.date}
                      type="button"
                      data-tw-day={entry.date}
                      className={`sw-day-chip${isHighlighted ? " is-today" : ""}`}
                      onClick={() => startPuzzle(entry.date)}
                    >
                      <strong>{isToday ? "Today" : formatDayLabel(entry.date)}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : solved ? (
        <section className="screen screen-basic sw-screen sw-play-screen">
          <header className="screen-header">
            <div className="play-meta-row">
              <div className="play">{dailyStreak} game streak</div>
            </div>
            <h1>Solved!</h1>
            <div className="sw-date-guess-row-inner">
              <p className="sw-date-text">{formatLongDay(activePuzzle!.date)}</p>
              <p className="sw-date-text">Time: {formatElapsed(elapsedSeconds)}</p>
            </div>
            <div className="sw-date-guess-row-inner">
              <p className="sw-date-text">{gaveUp ? "Gave up..." : `Hints: ${hintsUsed}/3`}</p>
              <p className="sw-date-text">Avg. Time: <b>{averageTime ?? "Waiting..."}</b></p>
            </div>
          </header>

          <div className="bottom-stack">
            <button className="btn btn-key" type="button" onClick={playAgain}>Play more</button>
            <button className="btn btn-soft" type="button" onClick={() => void shareResult()}>Challenge friends</button>
          </div>
        </section>
      ) : (
        <section className="screen screen-basic sw-screen sw-play-screen tw-play-screen">
          <header className="screen-header">
            <div className="play-meta-row">
              <div className="play">{dailyStreak} game streak</div>
            </div>
            <h1>Find the Theme Words:</h1>
            <p className="tw-theme-title hide">{activePuzzle!.themeTitle}</p>
          </header>
          <div className="sg">
            <div className="hint-text nb">
              {formatElapsed(elapsedSeconds)}
            </div>
            <div
              className="hint-text nb"
              onClick={() => setTimerPaused((current) => !current)}
            >
              {timerPaused ? "▶️" : "⏸️"}
            </div>
          </div>
          



          {gridState.bounds ? (
            <div className="tw-grid-wrap">
              <div
                className="tw-grid"
                style={{
                  gridTemplateColumns: `repeat(${gridState.bounds.maxCol - gridState.bounds.minCol + 1}, 25px)`
                }}
              >
                {Array.from({ length: gridState.bounds.maxRow - gridState.bounds.minRow + 1 }).map((_, rowOffset) => {
                  const row = gridState.bounds!.minRow + rowOffset;
                  return Array.from({ length: gridState.bounds!.maxCol - gridState.bounds!.minCol + 1 }).map((_, colOffset) => {
                    const col = gridState.bounds!.minCol + colOffset;
                    const key = `${row}:${col}`;
                    const cell = gridState.cells.get(key);
                    if (!cell) {
                      return <div key={key} className="tw-cell-empty" aria-hidden="true" />;
                    }

                    const revealed = cell.words.some((word) => foundWords.includes(word));
                    const isCrossing = cell.words.length > 1;
                    return (
                      <div key={key} className={`tw-grid-cell${isCrossing ? " is-crossing" : ""}`}>
                        {revealed ? cell.letter : ""}
                      </div>
                    );
                  });
                })}
              </div>
            </div>
          ) : null}


          <div className="sw-input-box">
            {previewWord ? (
              <span className="sw-input-word">{previewWord}</span>
            ) : inputNotice ? (
              <span className="hint-text">{inputNotice}</span>
            ) : (
              <span className="sw-input-word">{"\u00A0"}</span>
            )}
          </div>

          <div className="sw-date-guess-row">

            <p className="sw-date-text">{formatLongDay(activePuzzle!.date)}, {foundWords.length}/{activePuzzle!.targetWords.length}</p>
            <p className="sw-date-text"></p>
            <div className="sw-hint-actions">
              <button
                type="button"
                className="btn btn-soft runtime-reroll-btn btn-left mores shorter-btn"
                onClick={onHintAction}
              >
                {showGiveUp ? "Give up" : `Hint ${hintsUsed}/3`}
              </button>
              <button
                type="button"
                className="btn btn-soft runtime-reroll-btn btn-left mores shorter-btn vs"
                onClick={() => setShowHelpModal(true)}
              >
                ??
              </button>
            </div>
          </div>

          <div
            ref={keyboardWrapRef}
            className={`sw-keyboard-wrap${shake ? " sw-shake" : ""}${keyboardLocked ? " sw-locked" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="presentation"
          >
            <svg className="sw-trace" viewBox={`0 0 ${KEYBOARD_VIEWBOX} ${KEYBOARD_VIEWBOX}`} preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points={
                  [...pathPoints, ...(traceCursor ? [traceCursor] : [])]
                    .map((point) => pointString(point))
                    .join(" ")
                }
              />
            </svg>
            <div className="sw-keyboard-center" />
            {wheelLetters.map((letter, index, allLetters) => {
              const point = findPointForKey(index, allLetters.length);
              const selected = pathIndexes.includes(index);
              return (
                <button
                  key={`${letter}-${index}`}
                  type="button"
                  data-sw-key={index}
                  className={`sw-key${selected ? " is-active" : ""}`}
                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  disabled={keyboardLocked}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {showQuitModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Are you sure?</h2>
            <p className="body-text small">Don't quit just because it's hard. Keep trying!</p>
            <div className="bottom-row">
              <button className="btn btn-key" type="button" onClick={returnToLanding}>
                Quit
              </button>
              <button className="btn btn-soft" type="button" onClick={() => setShowQuitModal(false)}>
                Back
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSuccessOverlay ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card sw-success-pop">
            <h2>Theme complete!</h2>
            <p className="body-text">You found all words for<br />{formatLongDay(activePuzzle!.date)}</p>
          </div>
        </div>
      ) : null}

      {showShareModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>Share</h2>
            <p className="hint-text">{successText}</p>
            <textarea className="input-pill" value={`${successText} ${shareUrl}`} readOnly rows={4} style={{ borderRadius: 16 }} />
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
              Tap and drag letters to make a word.<br /><br />
              If the word is in the list, it will be revealed in the grid.<br /><br />
              Find every word to finish the letter theme.
            </p>
            <div>
              <button className="btn btn-soft" type="button" onClick={() => setShowHelpModal(false)}>
                Back
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
