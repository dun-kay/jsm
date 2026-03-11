import type { GameConfig } from "../games/types";

type HomeGamesGridProps = {
  games: GameConfig[];
  onOpenGame: (game: GameConfig) => void;
};

export default function HomeGamesGrid({ games, onOpenGame }: HomeGamesGridProps) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <h1>Notes</h1>
      </header>
      <section className="games-grid">
        {games.map((game) => (
          <button key={game.id} type="button" className="game-card" onClick={() => onOpenGame(game)}>
            <h2>{game.title}</h2>
            <p>{game.description}</p>
            <p className="game-card-meta">{game.shortRules}</p>
          </button>
        ))}
      </section>
    </div>
  );
}

