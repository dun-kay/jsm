import { getGameIntroRules } from "../games/rules";
import type { GameConfig } from "../games/types";

type ThemeMode = "light" | "dark";

type GameRulesPageProps = {
  game: GameConfig;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onPlay: () => void;
  onBack: () => void;
};

export default function GameRulesPage({ game, theme, onToggleTheme, onPlay, onBack }: GameRulesPageProps) {
  const rules = getGameIntroRules(game.slug);

  return (
    <div className="site-shell">
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>

      <section className="screen screen-basic">
        <header className="screen-header">
          <h1>{game.title} rules</h1>
        </header>

        <div className="modal-card rules-modal rules-modal-scroll">
          <h2>{rules.title}</h2>
          <div className="rules-modal-content">{rules.content}</div>
        </div>

        <div className="bottom-stack">
          <button className="btn btn-key" type="button" onClick={onPlay}>
            Play
          </button>
          <button className="btn btn-soft" type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </section>
    </div>
  );
}

