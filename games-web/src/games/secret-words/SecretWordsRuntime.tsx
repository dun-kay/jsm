import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GameConfig } from "../types";
import dailySeed from "./dailySeed.json";
import {
  getSecretWordsAverageGuesses,
  recordSecretWordsCompletion,
  type SecretWordPuzzle
} from "../../lib/secretWordsApi";

type ThemeMode = "light" | "dark";

type SecretWordsRuntimeProps = {
  game: GameConfig;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBack: () => void;
};

type GuessEntry = {
  word: string;
  rank: number;
};

type ProgressState = {
  completed: Record<string, { guesses: number; completedAt: string }>;
};

type GuessHistoryState = {
  byDate: Record<string, string[]>;
};

type Point = {
  x: number;
  y: number;
};

const PROGRESS_KEY = "notes_secret_words_progress_v1";
const GUESSES_KEY = "notes_secret_words_guesses_v1";
const PLAYER_KEY = "notes_secret_words_player_id";
const KEY_HOLD_MS = 500;
const SUCCESS_MS = 2000;

function toIsoLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
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

function readGuessHistory(): GuessHistoryState {
  try {
    const raw = window.localStorage.getItem(GUESSES_KEY);
    if (!raw) {
      return { byDate: {} };
    }
    const parsed = JSON.parse(raw) as GuessHistoryState;
    if (!parsed || typeof parsed !== "object" || !parsed.byDate) {
      return { byDate: {} };
    }
    return parsed;
  } catch {
    return { byDate: {} };
  }
}

function persistGuessHistory(value: GuessHistoryState) {
  window.localStorage.setItem(GUESSES_KEY, JSON.stringify(value));
}

function readGuessesForDay(day: string, puzzleWords: string[]): GuessEntry[] {
  const history = readGuessHistory();
  const words = history.byDate[day] ?? [];
  const seen = new Set<string>();
  const next: GuessEntry[] = [];

  for (const candidate of words) {
    const word = String(candidate).toLowerCase();
    if (seen.has(word)) {
      continue;
    }
    seen.add(word);
    const rank = puzzleWords.indexOf(word) + 1;
    if (rank > 0) {
      next.push({ word, rank });
    }
  }

  return next;
}

function writeGuessesForDay(day: string, words: string[]) {
  const history = readGuessHistory();
  history.byDate[day] = words;
  persistGuessHistory(history);
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

function normalizedSeed(): SecretWordPuzzle[] {
  return (dailySeed as SecretWordPuzzle[]).map((entry) => ({
    date: String(entry.date),
    letters: String(entry.letters).toUpperCase(),
    words: entry.words.map((word) => String(word).toLowerCase())
  }));
}

function pointString(point: Point): string {
  return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
}

function findPointForKey(index: number, keyCount: number): Point {
  const center = 180;
  const radius = 80;
  const angle = (Math.PI * 2 * index) / keyCount - Math.PI / 2;
  return {
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle)
  };
}

function uniqueWords(words: string[]): string[] {
  return Array.from(new Set(words));
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

export default function SecretWordsRuntime({ game, theme, onToggleTheme, onBack }: SecretWordsRuntimeProps) {
  const [puzzles, setPuzzles] = useState<SecretWordPuzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [progress, setProgress] = useState<ProgressState>(() => readProgress());
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessEntry[]>([]);
  const [inputNotice, setInputNotice] = useState("");
  const [pathIndexes, setPathIndexes] = useState<number[]>([]);
  const [pathPoints, setPathPoints] = useState<Point[]>([]);
  const [traceCursor, setTraceCursor] = useState<Point | null>(null);
  const [shake, setShake] = useState(false);
  const [keyboardLocked, setKeyboardLocked] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [averageGuesses, setAverageGuesses] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);

  const keyboardWrapRef = useRef<HTMLDivElement | null>(null);

  const pointerIdRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const pathIndexesRef = useRef<number[]>([]);
  const pathPointsRef = useRef<Point[]>([]);

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

  const recentPuzzles = useMemo(() => playablePuzzles.slice(0, 11), [playablePuzzles]);

  const mostRecentUnplayed = useMemo(() => {
    return playablePuzzles.find((entry) => !progress.completed[entry.date]) ?? playablePuzzles[0] ?? null;
  }, [playablePuzzles, progress.completed]);

  const successText = useMemo(() => {
    return `Look, I guessed todays Secret Word in ${guesses.length}, can you do it in less?`;
  }, [guesses.length]);

  const shareUrl = useMemo(() => {
    const puzzleDate = activePuzzle?.date ?? mostRecentUnplayed?.date;
    if (!puzzleDate) {
      return `${window.location.origin}${game.route}`;
    }
    return `${window.location.origin}${game.route}?day=${encodeURIComponent(puzzleDate)}`;
  }, [activePuzzle?.date, mostRecentUnplayed?.date, game.route]);

  const inGame = Boolean(activePuzzle);
  const solved = guesses.some((entry) => entry.rank === 1);
  const starterHintWord = activePuzzle?.words?.[activePuzzle.words.length - 1] ?? "";

  useEffect(() => {
    setLoading(true);
    setErrorText("");
    const sorted = normalizedSeed()
      .map((entry) => ({
        ...entry,
        words: uniqueWords(entry.words.map((word) => word.toLowerCase()))
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
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
    return () => {
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    pathIndexesRef.current = pathIndexes;
  }, [pathIndexes]);

  useEffect(() => {
    pathPointsRef.current = pathPoints;
  }, [pathPoints]);

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
    setGuesses(puzzle ? readGuessesForDay(day, puzzle.words) : []);
    setInputNotice("");
    setPathIndexes([]);
    setPathPoints([]);
    setTraceCursor(null);
    setAverageGuesses(null);
    updateUrlForDay(day);
  }

  function returnToLanding() {
    setActiveDate(null);
    setGuesses([]);
    setInputNotice("");
    setPathIndexes([]);
    setPathPoints([]);
    setTraceCursor(null);
    setAverageGuesses(null);
    setShowShareModal(false);
    setShowQuitModal(false);
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

  async function completePuzzle(guessCount: number) {
    if (!activePuzzle) {
      return;
    }

    const updated: ProgressState = {
      completed: {
        ...progress.completed,
        [activePuzzle.date]: {
          guesses: guessCount,
          completedAt: new Date().toISOString()
        }
      }
    };
    setProgress(updated);
    persistProgress(updated);

    setShowSuccessOverlay(true);
    await new Promise((resolve) => window.setTimeout(resolve, SUCCESS_MS));
    setShowSuccessOverlay(false);

    const localPlayerId = getOrCreateLocalPlayerId();
    try {
      await recordSecretWordsCompletion(activePuzzle.date, localPlayerId, guessCount);
    } catch {
      // best effort
    }

    try {
      const avg = await getSecretWordsAverageGuesses(activePuzzle.date);
      setAverageGuesses(avg == null ? null : avg.toFixed(2));
    } catch {
      setAverageGuesses(null);
    }
  }

  function submitGuess(word: string) {
    if (!activePuzzle) {
      return;
    }

    const normalized = word.toLowerCase();
    if (normalized.length < 2) {
      setInputNotice("");
      triggerShake();
      return;
    }

    if (guesses.some((entry) => entry.word === normalized)) {
      setInputNotice("ALREADY GUESSED");
      triggerShake();
      return;
    }

    const rank = activePuzzle.words.indexOf(normalized) + 1;
    if (rank <= 0) {
      setInputNotice("");
      triggerShake();
      return;
    }

    setInputNotice("");
    const next = [{ word: normalized, rank }, ...guesses];
    setGuesses(next);
    writeGuessesForDay(activePuzzle.date, next.map((entry) => entry.word));

    if (rank === 1) {
      void completePuzzle(next.length);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePuzzle || keyboardLocked) {
      return;
    }

    const key = (event.target as HTMLElement).closest("[data-sw-key]") as HTMLButtonElement | null;
    if (!key) {
      return;
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
    if (!activePuzzle || !draggingRef.current) {
      return;
    }

    const wrapRect = keyboardWrapRef.current?.getBoundingClientRect();
    if (wrapRect) {
      setTraceCursor({
        x: event.clientX - wrapRect.left,
        y: event.clientY - wrapRect.top
      });
    }

    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const key = hovered?.closest("[data-sw-key]") as HTMLButtonElement | null;
    if (!key) {
      return;
    }
    const index = Number(key.dataset.swKey);
    if (pathIndexesRef.current.includes(index)) {
      return;
    }

    const nextIndexes = [...pathIndexesRef.current, index];
    const nextPoints = [...pathPointsRef.current, findPointForKey(index, wheelLetters.length)];
    pathIndexesRef.current = nextIndexes;
    pathPointsRef.current = nextPoints;
    setPathIndexes(nextIndexes);
    setPathPoints(nextPoints);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePuzzle || !draggingRef.current) {
      return;
    }

    draggingRef.current = false;
    if (pointerIdRef.current != null && event.currentTarget.hasPointerCapture(pointerIdRef.current)) {
      event.currentTarget.releasePointerCapture(pointerIdRef.current);
    }
    pointerIdRef.current = null;

    const word = pathIndexesRef.current.map((index) => wheelLetters[index] || "").join("");
    submitGuess(word);
    lockKeyboardThenClearPath();
  }

  function playToday() {
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
            <p className="hint-text error-text">{errorText}</p>
          </header>
        </section>
      </div>
    );
  }

  return (
    <div className="site-shell sw-shell">
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
            <h1>Guess the Secret Word:</h1>
            <p className="body-text">Find the daily secret word. Words higher on the list are closer to the answer.</p>
          </header>

          <div className="bottom-stack sw-stack">
            <button className="btn btn-key" type="button" onClick={playToday}>Play</button>
            <br></br>
            <p className="hint-text">Previous games:</p>
            <div className="sw-slider-wrap">
              <div className="sw-slider">
                {recentPuzzles.map((entry) => {
                  const isToday = entry.date === today;
                  return (
                    <button
                      key={entry.date}
                      type="button"
                      className={`sw-day-chip${isToday ? " is-today" : ""}`}
                      onClick={() => startPuzzle(entry.date)}
                    >
                      <span></span>
                      <strong>{isToday ? "Today" : formatDayLabel(entry.date)}</strong>
                      <span></span>

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
            <h1>Solved!</h1>
             <div className="sw-date-guess-row-inner">
            <p className="sw-date-text">{formatLongDay(activePuzzle!.date)}</p>
            <p className="sw-date-text">Guesses: {guesses.length}</p>
            </div>
            <p className="sw-date-text">Avg: <b>{averageGuesses ?? "Calculating..."}</b></p>
          </header>

          <div className="bottom-stack">
            <button className="btn btn-key" type="button" onClick={playAgain}>Play more</button>
            <button className="btn btn-soft" type="button" onClick={() => void shareResult()}>Challenge friends</button>
          </div>
        </section>
      ) : (
        <section className="screen screen-basic sw-screen sw-play-screen">
          <header className="screen-header">
            <h1>Guess the Secret Word</h1>
          </header>
          <div className="sw-date-guess-row">
            <p className="sw-date-text">{formatLongDay(activePuzzle!.date)}</p>
            <span className="sw-date-text">Guess: {guesses.length}</span>
          </div>

          <div className="sw-input-box">
            {previewWord ? (
              <span className="sw-input-word">{previewWord}</span>
            ) : inputNotice ? (
              <span className="hint-text">{inputNotice}</span>
            ) : (
              <span className="sw-input-word">{"\u00A0"}</span>
            )}
          </div>

          <div className="sw-guesses sw-guesses-scroll">
            {guesses.length === 0 ? (
              <div className="sw-guess-row">
                <p className="sw-date-text">
                  Tap & drag to select letters.<br />
                  Find the day's secret word. Can be any number of letters.<br />
                  Guesses are ranked by similarity.<br /><br />
                  <u>Try an easy word to get started... {starterHintWord.toUpperCase()}</u>
                </p>
              </div>
            ) : null}
            {guesses.map((entry) => {
              const total = activePuzzle!.words.length;
              const fillPercent = ((total - entry.rank + 1) / total) * 100;
              const hue = Math.max(0, Math.min(120, Math.round((fillPercent / 100) * 120)));
              return (
                <div className="sw-guess-row" key={`${entry.word}-${entry.rank}`}>
                  <div className="sw-guess-bar-track">
                    <div className="sw-guess-bar" style={{ width: `${fillPercent.toFixed(1)}%`, minWidth: "40px", backgroundColor: `hsl(${hue}, 72%, 42%)` }} />
                    <div className="sw-guess-bar-labels">
                      <strong>{entry.word.toUpperCase()}</strong>
                      <span className="sw-guess-bar-labels drk">{entry.rank}</span>
                    </div>
                  </div>
                </div>
              );
            })}
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
            <svg className="sw-trace" viewBox="0 0 360 360" preserveAspectRatio="none" aria-hidden="true">
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
                  style={{ left: `${point.x - 30}px`, top: `${point.y - 30}px` }}
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
            <p className="body-text small">
              Don't quit just because it's hard.
            </p>
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
            <h2>Solved!</h2>
            <p className="body-text">Nice work, the word was<br></br>{activePuzzle!.words[0].toUpperCase()}</p>
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
    </div>
  );
}











