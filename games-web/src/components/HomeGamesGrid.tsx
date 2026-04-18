import type { GameConfig } from "../games/types";

type ThemeMode = "light" | "dark";

type HomeGamesGridProps = {
  games: GameConfig[];
  onOpenGame: (game: GameConfig) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

export default function HomeGamesGrid({
  games,
  onOpenGame,
  theme,
  onToggleTheme
}: HomeGamesGridProps) {
  const dailyGames = games.filter((game) => game.slug === "secret-words");
  const socialGames = games.filter((game) => game.slug === "draw-wf");
  const partyGames = games.filter((game) => game.slug !== "secret-words" && game.slug !== "draw-wf");

  function playerLabel(game: GameConfig): string {
    if (game.minPlayers === 1 && game.maxPlayers === 1) {
      return "1 player";
    }
    return `${game.minPlayers} - ${game.maxPlayers} players`;
  }

  function showAgeGuide(game: GameConfig): boolean {
    return game.slug !== "secret-words" && game.slug !== "draw-wf";
  }

  function renderGameCard(game: GameConfig) {
    return (
      <button key={game.id} type="button" className="game-card" onClick={() => onOpenGame(game)}>
        <img
          className="gridimage"
          src={game.heroImage || "/assets/secret-categories-logo.png"}
          alt={`${game.title} image`}
        />
        <h2>{game.title}</h2>
        <p>{game.description}</p>
        <div className="play-meta-row">
          <div className="play">{playerLabel(game)}</div>
          <div className="play">{game.playTime}</div>
          {showAgeGuide(game) ? <div className="play">{game.ageGuide}</div> : null}
        </div>
      </button>
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
      </header>

      <section className="home-sections">
        <div className="home-section">
          <h2 id="daily" className="home-section-title">Daily games:</h2>
          <div className="games-grid">{dailyGames.map(renderGameCard)}</div>
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
