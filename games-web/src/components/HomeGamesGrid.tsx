import { useEffect, useState } from "react";
import type { GameConfig } from "../games/types";

type ThemeMode = "light" | "dark";

type HomeGamesGridProps = {
  games: GameConfig[];
  onOpenGame: (game: GameConfig) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

type SecretWordsProgressState = {
  completed?: Record<string, { guesses: number; completedAt: string }>;
};

const SECRET_WORDS_PROGRESS_KEY = "notes_secret_words_progress_v1";
const THEME_WORDS_PROGRESS_KEY = "notes_theme_words_progress_v1";
const ONE_AWAY_PROGRESS_KEY = "notes_one_away_progress_v1";
const ORDER_ME_PROGRESS_KEY = "notes_order_me_progress_v1";

function toIsoLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readDailyStreak(progressKey: string): number {
  try {
    const raw = window.localStorage.getItem(progressKey);
    if (!raw) {
      return 0;
    }

    const parsed = JSON.parse(raw) as SecretWordsProgressState;
    const completed = parsed?.completed ?? {};
    const completedDates = Object.keys(completed).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));

    if (completedDates.length === 0) {
      return 0;
    }

    const completedSet = new Set(completedDates);
    const today = new Date();
    const todayIso = toIsoLocal(today);
    const yesterdayDate = new Date(today);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayIso = toIsoLocal(yesterdayDate);

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
  } catch {
    return 0;
  }
}

export default function HomeGamesGrid({
  games,
  onOpenGame,
  theme,
  onToggleTheme
}: HomeGamesGridProps) {
  const [secretWordsStreak, setSecretWordsStreak] = useState(0);
  const [themeWordsStreak, setThemeWordsStreak] = useState(0);
  const [oneAwayStreak, setOneAwayStreak] = useState(0);
  const [orderMeStreak, setOrderMeStreak] = useState(0);

  useEffect(() => {
    const refreshStreaks = () => {
      setSecretWordsStreak(readDailyStreak(SECRET_WORDS_PROGRESS_KEY));
      setThemeWordsStreak(readDailyStreak(THEME_WORDS_PROGRESS_KEY));
      setOneAwayStreak(readDailyStreak(ONE_AWAY_PROGRESS_KEY));
      setOrderMeStreak(readDailyStreak(ORDER_ME_PROGRESS_KEY));
    };

    refreshStreaks();
    window.addEventListener("focus", refreshStreaks);
    window.addEventListener("storage", refreshStreaks);

    return () => {
      window.removeEventListener("focus", refreshStreaks);
      window.removeEventListener("storage", refreshStreaks);
    };
  }, []);

  const dailyGames = games.filter(
    (game) =>
      game.slug === "secret-words" ||
      game.slug === "theme-words" ||
      game.slug === "one-away" ||
      game.slug === "order-me"
  );
  const socialGames = games.filter((game) => game.slug === "draw-things" || game.slug === "draw-wf");
  const partyGames = games.filter(
    (game) =>
      game.slug !== "secret-words" &&
      game.slug !== "theme-words" &&
      game.slug !== "one-away" &&
      game.slug !== "order-me" &&
      game.slug !== "draw-things" &&
      game.slug !== "draw-wf"
  );

  function playerLabel(game: GameConfig): string {
    if (game.minPlayers === 1 && game.maxPlayers === 1) {
      return "1 player";
    }
    return `${game.minPlayers} - ${game.maxPlayers} players`;
  }

  function showAgeGuide(game: GameConfig): boolean {
    return (
      game.slug !== "secret-words" &&
      game.slug !== "theme-words" &&
      game.slug !== "one-away" &&
      game.slug !== "order-me" &&
      game.slug !== "draw-things" &&
      game.slug !== "draw-wf"
    );
  }

  function isDailyGame(game: GameConfig): boolean {
    return (
      game.slug === "secret-words" ||
      game.slug === "theme-words" ||
      game.slug === "one-away" ||
      game.slug === "order-me"
    );
  }

  function renderGameCard(game: GameConfig) {
    return (
      <a
        key={game.id}
        href={game.route}
        className="game-card"
        onClick={(event) => {
          event.preventDefault();
          onOpenGame(game);
        }}
      >
        <img
          className="gridimage"
          src={game.heroImage || "/assets/secret-categories-logo.png"}
          alt={`${game.title} image`}
        />
        <h2>{game.title}</h2>
        <p>{game.description}</p>
        <div className="play-meta-row">
          {game.slug === "secret-words" ? <div className="play">{secretWordsStreak} game streak</div> : null}
          {game.slug === "theme-words" ? <div className="play">{themeWordsStreak} game streak</div> : null}
          {game.slug === "one-away" ? <div className="play">{oneAwayStreak} game streak</div> : null}
          {game.slug === "order-me" ? <div className="play">{orderMeStreak} game streak</div> : null}
          {!isDailyGame(game) ? <div className="play">{playerLabel(game)}</div> : null}
          {!isDailyGame(game) ? <div className="play">{game.playTime}</div> : null}
          
          {showAgeGuide(game) ? <div className="play">{game.ageGuide}</div> : null}
        </div>
      </a>
    );
  }

  return (
    <div className="site-shell">
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>
      <header className="site-header">
        <h1>
          Games With Friends<br></br>by Jump Ship Media
          <br></br>
        </h1>
        <h2>Play fun daily, social, & party games.</h2>
        <div className="play-row">
          <a href="#party"><button className="play">Party games</button></a>
          <a href="#social"><button className="play">Social games</button></a>
          <a href="#daily"><button className="play">Daily games</button></a>
          </div>
          <p></p>
      </header>
      

      <section className="home-sections">
        <div className="home-section">
          <h2 id="daily" className="home-section-title">Daily games:</h2>
          <div className="games-grid daily-games-grid">{dailyGames.map(renderGameCard)}</div>
        </div>

        <div className="home-section">
          <h2 id="social" className="home-section-title">Social games:</h2>
          <span id="social" className="home-anchor-fix" aria-hidden="true" />
          <div className="games-grid">{socialGames.map(renderGameCard)}</div>
        </div>

        <div className="home-section">
          <h2 id="party" className="home-section-title">Party games:</h2>
          <div className="games-grid">{partyGames.map(renderGameCard)}</div>
        </div>
      </section>
    </div>
  );
}
