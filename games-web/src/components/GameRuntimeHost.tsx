import { useEffect, useState } from "react";
import { getGameBySlug } from "../games/registry";
import SecretCategoryRuntime from "../games/secret-category/SecretCategoryRuntime";
import PopularPeopleRuntime from "../games/popular-people/PopularPeopleRuntime";
import FruitBowlRuntime from "../games/fruit-bowl/FruitBowlRuntime";
import MurderClubRuntime from "../games/murder-club/MurderClubRuntime";
import LyingLlamaRuntime from "../games/lying-llama/LyingLlamaRuntime";
import FakeFamousRuntime from "../games/fake-famous/FakeFamousRuntime";
import NeverEverRuntime from "../games/never-ever/NeverEverRuntime";
import MostLikelyRuntime from "../games/most-likely/MostLikelyRuntime";
import WormyWormRuntime from "../games/wormy-worm/WormyWormRuntime";
import DrawWfRuntime from "../games/draw-wf/DrawWfRuntime";
import type { GameSessionContext } from "../games/types";
import { getLobbyState, quitGame, touchPlayer } from "../lib/lobbyApi";
import {
  DRAW_THINGS_OPEN_PAYWALL_EVENT,
  DRAW_THINGS_WALLET_EVENT,
  getDrawThingsWalletSummary,
  type DrawThingsWalletSummary
} from "../lib/drawThingsWallet";
import { ACQUISITION_TEST_MODE } from "../lib/featureFlags";

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
  const [drawWallet, setDrawWallet] = useState<DrawThingsWalletSummary | null>(null);

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
  }, [gameCode, initialSession?.playerToken, sessionExpired]);

  useEffect(() => {
    if (gameSlug !== "draw-wf") {
      setDrawWallet(null);
      return;
    }
    setDrawWallet(getDrawThingsWalletSummary());
    const onWalletChanged = (event: Event) => {
      const payload = (event as CustomEvent<DrawThingsWalletSummary>).detail;
      if (payload) {
        setDrawWallet(payload);
      } else {
        setDrawWallet(getDrawThingsWalletSummary());
      }
    };
    window.addEventListener(DRAW_THINGS_WALLET_EVENT, onWalletChanged as EventListener);
    return () => {
      window.removeEventListener(DRAW_THINGS_WALLET_EVENT, onWalletChanged as EventListener);
    };
  }, [gameSlug]);

  async function returnHomeAfterSessionExpiry() {
    if (!initialSession || quitting) {
      return;
    }

    setQuitting(true);
    try {
      await quitGame(gameCode, initialSession.playerToken);
    } catch {
      // Best-effort cleanup; always return home even if server call fails.
    } finally {
      onBackToHome();
    }
  }

  async function confirmQuitGame() {
    if (!initialSession || quitting) {
      return;
    }

    setQuitting(true);
    try {
      await quitGame(gameCode, initialSession.playerToken);
    } catch {
      // Best-effort cleanup; always return home even if server call fails.
    } finally {
      onBackToHome();
    }
  }

  const game = gameSlug ? getGameBySlug(gameSlug) : undefined;
  const isDrawThingsRuntime = game?.slug === "draw-wf";

  const openDrawThingsPaywall = () => {
    window.dispatchEvent(new Event(DRAW_THINGS_OPEN_PAYWALL_EVENT));
  };

  if (
    (game?.slug === "secret-category" ||
      game?.slug === "popular-people" ||
      game?.slug === "fruit-bowl" ||
      game?.slug === "detective-club" ||
      game?.slug === "lying-llama" ||
      game?.slug === "fake-famous" ||
      game?.slug === "never-ever" ||
      game?.slug === "most-likely" ||
      game?.slug === "wormy-worm" ||
      game?.slug === "draw-wf") &&
    initialSession?.playerToken
  ) {
    return (
      <div className="site-shell">
        <div className="top-actions">
          <button type="button" className="theme-toggle quit-toggle" onClick={() => setShowQuitConfirm(true)}>
            Quit
          </button>
          <div hidden={ACQUISITION_TEST_MODE}>
            {isDrawThingsRuntime && drawWallet ? (
              <div className="drawthings-runtime-accessbar">
                <p className="drawthings-runtime-accessbar-text">Plays +{drawWallet.totalPlays}</p>
                <button type="button" className="drawthings-mini-btn drawthings-mini-btn-key" onClick={openDrawThingsPaywall}>
                  Unlock
                </button>
              </div>
            ) : null}
          </div>
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
        {game.slug === "detective-club" && (
          <MurderClubRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "lying-llama" && (
          <LyingLlamaRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "fake-famous" && (
          <FakeFamousRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "never-ever" && (
          <NeverEverRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "most-likely" && (
          <MostLikelyRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "wormy-worm" && (
          <WormyWormRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {game.slug === "draw-wf" && (
          <DrawWfRuntime gameCode={gameCode} playerToken={initialSession.playerToken} />
        )}
        {showQuitConfirm && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
              <h2>Quit game?</h2>
              <p className="body-text small">Are you sure? This will end the game for all players.</p>
              <div className="bottom-row">
                <button className="btn btn-key" type="button" onClick={() => void confirmQuitGame()} disabled={quitting}>
                  {quitting ? "Leaving..." : "Yes"}
                </button>
                <button className="btn btn-soft" type="button" onClick={() => setShowQuitConfirm(false)} disabled={quitting}>
                  No
                </button>
              </div>
            </div>
          </div>
        )}
        {sessionExpired && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
              <h2>Session finished...</h2>
              <p>Your session has ended. A player quit the game or your game expired.</p>
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


