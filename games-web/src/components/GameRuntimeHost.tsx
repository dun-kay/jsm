import { useEffect, useState } from "react";
import { getGameBySlug } from "../games/registry";
import SecretCategoryRuntime from "../games/secret-category/SecretCategoryRuntime";
import PopularPeopleRuntime from "../games/popular-people/PopularPeopleRuntime";
import FruitBowlRuntime from "../games/fruit-bowl/FruitBowlRuntime";
import MurderClubRuntime from "../games/murder-club/MurderClubRuntime";
import type { GameSessionContext } from "../games/types";
import { cancelGame, getLobbyState, leaveGame, touchPlayer } from "../lib/lobbyApi";

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
  const [showQuitConfirm, setShowQuitConfirm] = useState<boolean>(false);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const [quitting, setQuitting] = useState<boolean>(false);

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

  useEffect(() => {
    if (!initialSession?.playerToken || sessionExpired) {
      return;
    }

    let active = true;

    const checkAlive = async () => {
      try {
        const alive = await touchPlayer(gameCode, initialSession.playerToken);
        if (!active) {
          return;
        }
        if (!alive) {
          setSessionExpired(true);
          setErrorText("Session expired.");
        }
      } catch (error) {
        if (!active) {
          return;
        }
        const message = ((error as Error).message || "").toLowerCase();
        if (message.includes("session expired")) {
          setSessionExpired(true);
          setErrorText("Session expired.");
        }
      }
    };

    void checkAlive();
    const interval = window.setInterval(() => {
      void checkAlive();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameCode, initialSession?.playerToken, initialSession?.hostSecret, sessionExpired]);

  async function returnHomeAfterSessionExpiry() {
    if (!initialSession || quitting) {
      return;
    }

    setQuitting(true);
    try {
      if (initialSession.hostSecret) {
        await cancelGame(gameCode, initialSession.hostSecret);
      } else {
        await leaveGame(gameCode, initialSession.playerToken);
      }
    } catch {
      // Best-effort cleanup; always return home even if server call fails.
    } finally {
      onBackToHome();
    }
  }

  const game = gameSlug ? getGameBySlug(gameSlug) : undefined;

  if (
    (game?.slug === "secret-category" ||
      game?.slug === "popular-people" ||
      game?.slug === "fruit-bowl" ||
      game?.slug === "murder-club") &&
    initialSession?.playerToken
  ) {
    return (
      <div className="site-shell">
        <div className="top-actions">
          <button type="button" className="theme-toggle quit-toggle" onClick={() => setShowQuitConfirm(true)}>
            Quit
          </button>
          <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
        {game.slug === "popular-people" && (
          <PopularPeopleRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "secret-category" && (
          <SecretCategoryRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "fruit-bowl" && (
          <FruitBowlRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "murder-club" && (
          <MurderClubRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {showQuitConfirm && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
              <h2>Quit game?</h2>
              <p className="body-text small">Are you sure you want to quit?</p>
              <div className="bottom-row">
                <button className="btn btn-key" type="button" onClick={onBackToHome}>
                  Yes
                </button>
                <button className="btn btn-soft" type="button" onClick={() => setShowQuitConfirm(false)}>
                  No
                </button>
              </div>
            </div>
          </div>
        )}
        {sessionExpired && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
              <h2>Session expired</h2>
              <p className="body-text small">Return home to reset this game state.</p>
              <button className="btn btn-key" type="button" onClick={() => void returnHomeAfterSessionExpiry()} disabled={quitting}>
                {quitting ? "Leaving..." : "Return home"}
              </button>
            </div>
          </div>
        )}
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
