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
  function playerLabel(game: GameConfig): string {
    if (game.minPlayers === 1 && game.maxPlayers === 1) {
      return "1 player";
    }
    return `${game.minPlayers} - ${game.maxPlayers} players`;
  }

  function showAgeGuide(game: GameConfig): boolean {
    return game.slug !== "secret-words" && game.slug !== "draw-wf";
  }

  return (
    <div className="site-shell">
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>
      <header className="site-header">
        <h1>Games With Friends<br></br>by Jump Ship Media</h1>
        <h2>Play fun word & social games.</h2>
      </header>
      <section className="games-grid">
        {games.map((game) => (
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
        ))}
      </section>
    </div>
  );
}
