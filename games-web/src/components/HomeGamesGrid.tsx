import type { GameConfig } from "../games/types";

type ThemeMode = "light" | "dark";

type HomeGamesGridProps = {
  games: GameConfig[];
  onOpenGame: (game: GameConfig) => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

export default function HomeGamesGrid({
  games,
  onOpenGame,
  onOpenTerms,
  onOpenPrivacy,
  theme,
  onToggleTheme
}: HomeGamesGridProps) {
  return (
    <div className="site-shell">
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>
      <header className="site-header">
        <h1>Games With Friends</h1>
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
            <div className="play">{game.minPlayers} - {game.maxPlayers} players</div>
          </button>
        ))}
      </section>
      <div className="bottom-stack">
        <button className="btn btn-soft" type="button" onClick={onOpenPrivacy}>
          Privacy policy
        </button>
        <button className="btn btn-soft" type="button" onClick={onOpenTerms}>
          Terms
        </button>
      </div>
    </div>
  );
}
