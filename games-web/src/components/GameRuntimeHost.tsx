import { useEffect, useState } from "react";
import { getGameBySlug } from "../games/registry";
import SecretCategoryRuntime from "../games/secret-category/SecretCategoryRuntime";
import type { GameSessionContext } from "../games/types";
import { getLobbyState } from "../lib/lobbyApi";

type GameRuntimeHostProps = {
  gameCode: string;
  initialSession: GameSessionContext | null;
  onBackToHome: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
};

export default function GameRuntimeHost({
  gameCode,
  initialSession,
  onBackToHome,
  theme,
  onToggleTheme
}: GameRuntimeHostProps) {
  const [gameSlug, setGameSlug] = useState<string>(initialSession?.gameSlug || "");
  const [errorText, setErrorText] = useState<string>("");

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const state = await getLobbyState(gameCode);
        if (!active) {
          return;
        }
        setGameSlug(state.gameSlug);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText((error as Error).message || "Unable to load game runtime.");
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [gameCode]);

  const game = gameSlug ? getGameBySlug(gameSlug) : undefined;

  if (game?.slug === "secret-category" && initialSession?.playerToken) {
    return (
      <div className="site-shell">
        <div className="top-actions">
          <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
          <button type="button" className="theme-toggle quit-toggle" onClick={onBackToHome}>
            Quit
          </button>
        </div>
        <SecretCategoryRuntime
          gameCode={gameCode}
          playerToken={initialSession.playerToken}
        />
      </div>
    );
  }

  return (
    <div className="site-shell">
      <div className="top-actions">
        <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
          {theme === "light" ? "Dark mode" : "Light mode"}
        </button>
      </div>
      <header className="site-header">
        <h1>{game?.title || "Game"}</h1>
      </header>
      <section className="runtime-card">
        <p>Game code: {gameCode}</p>
        {game && <p>Runtime route loaded for: {game.slug}</p>}
        {!game && !errorText && <p>Loading runtime...</p>}
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
      <div className="bottom-stack">
        <button type="button" className="btn btn-soft" onClick={onBackToHome}>
          Back to games
        </button>
      </div>
    </div>
  );
}
