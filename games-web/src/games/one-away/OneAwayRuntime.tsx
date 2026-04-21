import { useEffect, useMemo, useRef, useState } from "react";
import type { GameConfig } from "../types";
import dailySeed from "./dailySeed.json";
import allowedWords from "./allowedWords.4to6.json";
import { getOneAwayAverageGuesses, recordOneAwayCompletion } from "../../lib/oneAwayApi";

type ThemeMode = "light" | "dark";

type OneAwayRuntimeProps = {
  game: GameConfig;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBack: () => void;
};

type OneAwayPuzzle = {
  date: string;
  target: string;
  words: string[];
};

type GuessStateEntry = {
  guesses: string[];
  lockedIndexes: number[];
  blockedLetters: string[];
  solved: boolean;
  failed: boolean;
};

type GuessState = {
  byDate: Record<string, GuessStateEntry>;
};

type ProgressState = {
  completed: Record<string, { guesses: number; completedAt: string; solved: boolean }>;
};

const PROGRESS_KEY = "notes_one_away_progress_v1";
const GAME_STATE_KEY = "notes_one_away_state_v1";
const PLAYER_KEY = "notes_one_away_player_id";
const KEYBOARD_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;
const MAX_GUESSES = 4;
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

function readGuessState(): GuessState {
  try {
    const raw = window.localStorage.getItem(GAME_STATE_KEY);
    if (!raw) return { byDate: {} };
    const parsed = JSON.parse(raw) as GuessState;
    return parsed?.byDate ? parsed : { byDate: {} };
  } catch {
    return { byDate: {} };
  }
}

function persistGuessState(value: GuessState) {
  window.localStorage.setItem(GAME_STATE_KEY, JSON.stringify(value));
}

function readGuessStateForDay(day: string): GuessStateEntry {
  const state = readGuessState();
  const entry = state.byDate[day];
  if (!entry) {
    return {
      guesses: [],
      lockedIndexes: [],
      blockedLetters: [],
      solved: false,
      failed: false
    };
  }
  return {
    guesses: Array.isArray(entry.guesses) ? entry.guesses.map((word) => String(word).toLowerCase()) : [],
    lockedIndexes: Array.isArray(entry.lockedIndexes) ? entry.lockedIndexes.map((idx) => Number(idx)).filter(Number.isFinite) : [],
    blockedLetters: Array.isArray(entry.blockedLetters) ? entry.blockedLetters.map((char) => String(char).toUpperCase()) : [],
    solved: Boolean(entry.solved),
    failed: Boolean(entry.failed)
  };
}

function writeGuessStateForDay(day: string, entry: GuessStateEntry) {
  const state = readGuessState();
  state.byDate[day] = entry;
  persistGuessState(state);
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
    if (!completedSet.has(iso)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function normalizedSeed(): OneAwayPuzzle[] {
  return (dailySeed as OneAwayPuzzle[]).map((entry) => ({
    date: String(entry.date),
    target: String(entry.target).toLowerCase(),
    words: Array.isArray(entry.words) ? entry.words.map((word) => String(word).toLowerCase()) : []
  }));
}

function nextCursorIndex(slots: string[], locked: Set<number>) {
  for (let idx = 0; idx < slots.length; idx += 1) {
    if (locked.has(idx)) continue;
    if (!slots[idx]) return idx;
  }
  return -1;
}

function buildBlankAttempt(target: string, locked: Set<number>) {
  return Array.from({ length: target.length }, (_, idx) => (locked.has(idx) ? target[idx].toUpperCase() : ""));
}

export default function OneAwayRuntime({ game, theme, onToggleTheme, onBack }: OneAwayRuntimeProps) {
  const [puzzles, setPuzzles] = useState<OneAwayPuzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [progress, setProgress] = useState<ProgressState>(() => readProgress());
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [lockedIndexes, setLockedIndexes] = useState<Set<number>>(new Set());
  const [blockedLetters, setBlockedLetters] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [averageGuesses, setAverageGuesses] = useState<string | null>(null);
  const [showResultOverlay, setShowResultOverlay] = useState(false);
  const [solved, setSolved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [shakeInput, setShakeInput] = useState(false);
  const noticeTimerRef = useRef<number | null>(null);

  const activePuzzle = useMemo(() => {
    if (!activeDate) return null;
    return puzzles.find((entry) => entry.date === activeDate) ?? null;
  }, [activeDate, puzzles]);

  const today = useMemo(() => toIsoLocal(new Date()), []);
  const dailyStreak = useMemo(() => computeDailyStreak(progress.completed), [progress.completed]);
  const commonWords = useMemo(() => {
    const set = new Set<string>(allowedWords as string[]);
    for (const puzzle of puzzles) {
      set.add(puzzle.target);
      for (const word of puzzle.words) set.add(word);
    }
    return set;
  }, [puzzles]);

  const playablePuzzles = useMemo(() => puzzles.filter((entry) => entry.date <= today).sort((a, b) => b.date.localeCompare(a.date)), [puzzles, today]);
  const unplayedPuzzle = useMemo(() => playablePuzzles.find((entry) => !progress.completed[entry.date]) ?? null, [playablePuzzles, progress.completed]);
  const allAvailablePlayed = playablePuzzles.length > 0 && unplayedPuzzle == null;
  const mostRecentUnplayed = useMemo(() => unplayedPuzzle ?? playablePuzzles[0] ?? null, [unplayedPuzzle, playablePuzzles]);
  const highlightedDate = mostRecentUnplayed?.date ?? playablePuzzles[0]?.date ?? null;

  const shareUrl = useMemo(() => {
    const puzzleDate = activePuzzle?.date ?? mostRecentUnplayed?.date;
    if (!puzzleDate) return `${window.location.origin}${game.route}`;
    return `${window.location.origin}${game.route}?day=${encodeURIComponent(puzzleDate)}`;
  }, [activePuzzle?.date, mostRecentUnplayed?.date, game.route]);

  const shareText = useMemo(() => {
    if (solved) {
      return `I solved today's One Away in ${guesses.length}/4 guesses, can you do better?`;
    }
    return "I couldn't solve today's One Away in 4 guesses, can you do better?";
  }, [guesses.length, solved]);

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
      if (found) {
        startPuzzle(found.date);
      }
    }
  }, [puzzles]);

  useEffect(() => {
    if (!activePuzzle || solved || failed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submitGuess();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        backspaceLetter();
        return;
      }
      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        pickLetter(event.key.toUpperCase());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePuzzle, solved, failed, attempt, lockedIndexes, guesses, blockedLetters]);


  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);
  function updateUrlForDay(day: string | null) {
    const url = new URL(window.location.href);
    if (day) {
      url.searchParams.set("day", day);
    } else {
      url.searchParams.delete("day");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function resetRoundState(target: string, lockedSet: Set<number>, blockedSet: Set<string>, nextGuesses: string[], wasSolved: boolean, wasFailed: boolean) {
    setGuesses(nextGuesses);
    setLockedIndexes(new Set(lockedSet));
    setBlockedLetters(new Set(blockedSet));
    setAttempt(buildBlankAttempt(target, lockedSet));
    setSolved(wasSolved);
    setFailed(wasFailed);
    setNotice("");
    setAverageGuesses(null);
    setShowShareModal(false);
    setShowHelpModal(false);
  }

  function startPuzzle(day: string) {
    const puzzle = puzzles.find((entry) => entry.date === day);
    if (!puzzle) return;

    const stored = readGuessStateForDay(day);
    const lockedSet = new Set(stored.lockedIndexes.filter((idx) => idx >= 0 && idx < puzzle.target.length));
    const blockedSet = new Set(stored.blockedLetters.map((char) => char.toUpperCase()));

    setActiveDate(day);
    updateUrlForDay(day);
    resetRoundState(puzzle.target, lockedSet, blockedSet, stored.guesses, stored.solved, stored.failed);
  }

  function returnToLanding() {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setActiveDate(null);
    setGuesses([]);
    setLockedIndexes(new Set());
    setBlockedLetters(new Set());
    setAttempt([]);
    setNotice("");
    setAverageGuesses(null);
    setSolved(false);
    setFailed(false);
    setShowShareModal(false);
    setShowHelpModal(false);
    updateUrlForDay(null);
  }

  function showInvalidNotice(
    text: string,
    options?: { clearInput?: boolean; target?: string; lockedSnapshot?: Set<number> }
  ) {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(text);
    setShakeInput(false);
    window.requestAnimationFrame(() => setShakeInput(true));
    window.setTimeout(() => setShakeInput(false), 360);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("");
      if (options?.clearInput && options.target) {
        setAttempt(buildBlankAttempt(options.target, options.lockedSnapshot ?? new Set()));
      }
      noticeTimerRef.current = null;
    }, 2000);
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
      await recordOneAwayCompletion(activePuzzle.date, localPlayerId, nextGuessCount);
    } catch {
      // best effort
    }

    try {
      const avg = await getOneAwayAverageGuesses(activePuzzle.date);
      setAverageGuesses(avg == null ? null : avg.toFixed(2));
    } catch {
      setAverageGuesses(null);
    }
  }

  function pickLetter(letter: string) {
    if (!activePuzzle || solved || failed) return;
    if (blockedLetters.has(letter.toUpperCase())) return;
    const locked = lockedIndexes;
    const idx = nextCursorIndex(attempt, locked);
    if (idx < 0) return;
    const next = [...attempt];
    next[idx] = letter.toUpperCase();
    setAttempt(next);
    setNotice("");
  }

  function backspaceLetter() {
    if (!activePuzzle || solved || failed) return;
    const next = [...attempt];
    for (let idx = next.length - 1; idx >= 0; idx -= 1) {
      if (lockedIndexes.has(idx)) continue;
      if (next[idx]) {
        next[idx] = "";
        break;
      }
    }
    setAttempt(next);
  }

  async function submitGuess() {
    if (!activePuzzle || solved || failed) return;
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    const target = activePuzzle.target;
    const guess = attempt.join("").toLowerCase();
    const hintWords = new Set(activePuzzle.words.slice(1).map((word) => word.toLowerCase()));

    if (attempt.some((slot) => !slot) || guess.length !== target.length) {
      showInvalidNotice("Fill every letter...");
      return;
    }
    if (guesses.includes(guess)) {
      showInvalidNotice("Already guessed...", {
        clearInput: true,
        target,
        lockedSnapshot: new Set(lockedIndexes)
      });
      return;
    }
    if (!commonWords.has(guess)) {
      showInvalidNotice("Not in common word list...", {
        clearInput: true,
        target,
        lockedSnapshot: new Set(lockedIndexes)
      });
      return;
    }
    if (hintWords.has(guess)) {
      showInvalidNotice("You can't guess clue words...", {
        clearInput: true,
        target,
        lockedSnapshot: new Set(lockedIndexes)
      });
      return;
    }

    const nextGuesses = [guess, ...guesses];
    setGuesses(nextGuesses);

    const nextLocked = new Set(lockedIndexes);
    const nextBlocked = new Set(blockedLetters);

    for (let idx = 0; idx < target.length; idx += 1) {
      const char = guess[idx];
      if (char === target[idx]) {
        nextLocked.add(idx);
      }
      if (!target.includes(char)) {
        nextBlocked.add(char.toUpperCase());
      }
    }

    const didSolve = guess === target;
    const didFail = !didSolve && nextGuesses.length >= MAX_GUESSES;

    setLockedIndexes(nextLocked);
    setBlockedLetters(nextBlocked);
    setAttempt(buildBlankAttempt(target, nextLocked));
    setNotice("");
    setSolved(didSolve);
    setFailed(didFail);

    writeGuessStateForDay(activePuzzle.date, {
      guesses: nextGuesses,
      lockedIndexes: [...nextLocked.values()],
      blockedLetters: [...nextBlocked.values()],
      solved: didSolve,
      failed: didFail
    });

    if (didSolve || didFail) {
      await completePuzzle(nextGuesses.length, didSolve);
    }
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
  const guessesRemaining = Math.max(0, MAX_GUESSES - guesses.length);
  const clues = activePuzzle ? activePuzzle.words.slice(1, 4) : [];

  return (
    <div className="site-shell sw-shell oa-shell">
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
            <h1>Guess the #1 word:</h1>
            <p className="body-text">Guess the #1 word based on the next three words. Words are ordered by similarity.</p>
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
            <h1>{solved ? "Solved!" : "Close!"}</h1>
            <div className="sw-date-guess-row-inner">
              <p className="sw-date-text">{formatLongDay(activePuzzle!.date)}</p>
              <p className="sw-date-text">Guesses: {guesses.length}/4</p>
            </div>
            <div className="sw-date-guess-row-inner">
              <p className="sw-date-text">{activePuzzle!.target.toUpperCase()}</p>
              <p className="sw-date-text">Avg. Guesses: <b>{averageGuesses ?? "Waiting..."}</b></p>
            </div>
          </header>
          <div className="bottom-stack">
            <button className="btn btn-key" type="button" onClick={playAgain}>Play more</button>
            <button className="btn btn-soft" type="button" onClick={() => void shareResult()}>Challenge friends</button>
          </div>
        </section>
      ) : (
        <section className="screen screen-basic sw-screen sw-play-screen">
          <header className="screen-header">
            <div className="play-meta-row"><div className="play">{dailyStreak} game streak</div></div>
            <h1>Guess the #1 word:</h1>
          </header>


          <div className={`oa-input-box${shakeInput ? " oa-shake" : ""}`}>
            {attempt.map((char, idx) => {
              const locked = lockedIndexes.has(idx);
              return (
                <span key={`slot-${idx}`} className={`oa-slot${locked ? " is-locked" : ""}`}>
                  {char || "\u00A0"}
                </span>
              );
            })}
          </div>
            <div className="sw-date-guess-row">
            <p className="sw-date-text">{formatLongDay(activePuzzle!.date)}</p>
            <div className="sw-hint-actions"><button type="button" className="btn btn-soft runtime-reroll-btn btn-left mores shorter-btn vs" onClick={() => setShowHelpModal(true)}>??</button>
          </div></div>

          <div className="oa-clues-grid">
            {clues.map((word, idx) => (
              <div key={`clue-${word}-${idx}`} className="oa-clue-pill">
                <small>#{idx + 2}</small>
                <strong>{word.toUpperCase()}</strong>
              </div>
            ))}
          </div>
          
          
          <div className="sw-date-guess-row-inner sg">
          <span className="sw-date-text">Guesses remaining:</span>
            <div className="oa-guess-pips">
              {Array.from({ length: MAX_GUESSES }).map((_, idx) => (
                <span key={`pip-${idx}`} className={`oa-pip${idx < guessesRemaining ? " is-live" : ""}`} />
              ))}
            </div></div> 
          
          <div className="space10"></div>
          
          <div className="keyboard-bottom">
          <div className="oa-keyboard">
            {KEYBOARD_ROWS.map((row, rowIdx) => (
              <div key={row} className="drawwf-keyboard-row">
                {row.split("").map((letter) => (
                  <button
                    key={`${row}-${letter}`}
                    type="button"
                    className={`wf${blockedLetters.has(letter) ? " oa-key-disabled" : ""}`}
                    onClick={() => pickLetter(letter)}
                    disabled={blockedLetters.has(letter)}
                  >
                    {letter}
                  </button>
                ))}
                {rowIdx === KEYBOARD_ROWS.length - 1 ? (
                  <button type="button" className="wf wf-backspace" onClick={backspaceLetter}>⌫</button>
                ) : null}
              </div>
            ))}
          
              <div className="oa-guess-row">
                <button type="button" className="oa-enter-btn" onClick={() => void submitGuess()}>GUESS</button>
              </div>
              </div>
              </div>{notice ? <p className="hint-text error-text">{notice}</p> : null}</section>
      )}


      {showResultOverlay && activePuzzle ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card sw-success-pop">
            <h2>{solved ? "Solved!" : "Close!"}</h2>
            <p className="body-text">The word was<br />{activePuzzle.target.toUpperCase()}</p>
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
              You are shown 3 words from a list of four (you see words #2 - #4).
              <br /><br />
              The words are ranked by similarity. Sometimes in meaning. Sometimes in letters... it's your job to figure that out.
              <br /><br />
              Guess the #1 word in 4 guesses.
              <br /><br />
              Green letters are correct and lock in place.
              <br /><br />
              Grey keyboard letters are not in the word.
            </p>
            <button className="btn btn-soft" type="button" onClick={() => setShowHelpModal(false)}>Back</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}



