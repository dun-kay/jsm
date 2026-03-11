import type { GameConfig } from "../games/types";

type HomeGamesGridProps = {
  games: GameConfig[];
  onOpenGame: (game: GameConfig) => void;
};

export default function HomeGamesGrid({ games, onOpenGame }: HomeGamesGridProps) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <h1>Games with friends</h1>
      </header>
      <section className="games-grid">
        {games.map((game) => (
          <button key={game.id} type="button" className="game-card" onClick={() => onOpenGame(game)}>
            <img
              className="gridimage"
              src="/assets/jump-ship-media_trains_tile.png"
              alt="Secret Categories image"
            />
            <h2>{game.title}</h2>
            <p>{game.description}</p>
          </button>
        ))}
      </section>
    </div>
  );
}
