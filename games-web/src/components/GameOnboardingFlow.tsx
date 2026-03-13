import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  cancelGame,
  createGame,
  getLobbyState,
  joinGame,
  rejoinGame,
  startGame,
  touchPlayer,
  type LobbyPlayer
} from "../lib/lobbyApi";
import type { GameConfig, GameSessionContext } from "../games/types";

type ThemeMode = "light" | "dark";
type FlowMode = "host" | "join";
type Screen = "home" | "joinLink" | "nameEntry" | "loading" | "lobby";
type ModalType = "cancel" | "start" | null;

type StoredSession = {
  flow: FlowMode;
  gameCode: string;
  gameSlug: string;
  playerToken: string;
  hostSecret: string;
  expiresAt: number;
};

type GameOnboardingFlowProps = {
  game: GameConfig;
  onExit: () => void;
  onLaunchGame: (session: GameSessionContext) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

const MIN_PLAYERS_TO_START = 3;
const MAX_NAME_LENGTH = 10;
const SESSION_TTL_MS = 120_000;

function readGameIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("g")?.toUpperCase() || "";
}

function sanitizeName(value: string): string {
  return value.replace(/\s+/g, "").slice(0, MAX_NAME_LENGTH);
}

function parseGameCodeFromInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const direct = trimmed.toUpperCase();
  if (/^[A-Z2-9]{6}$/.test(direct)) {
    return direct;
  }

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("g")?.toUpperCase() || "";
  } catch {
    return "";
  }
}

export default function GameOnboardingFlow({
  game,
  onExit,
  onLaunchGame,
  theme,
  onToggleTheme
}: GameOnboardingFlowProps) {
  const sessionKey = `notes_session_${game.slug}`;

  const readStoredSession = (): StoredSession | null => {
    try {
      const raw = window.localStorage.getItem(sessionKey);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed.gameCode || !parsed.playerToken || !parsed.flow || !parsed.expiresAt || !parsed.gameSlug) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const clearStoredSession = () => {
    window.localStorage.removeItem(sessionKey);
  };

  const persistSession = (data: Omit<StoredSession, "expiresAt">) => {
    const payload: StoredSession = {
      ...data,
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    window.localStorage.setItem(sessionKey, JSON.stringify(payload));
  };

  const [screen, setScreen] = useState<Screen>("home");
  const [flow, setFlow] = useState<FlowMode | null>(null);
  const [playerCount, setPlayerCount] = useState<number>(game.maxPlayers);
  const [playerName, setPlayerName] = useState<string>("");
  const [joinLinkInput, setJoinLinkInput] = useState<string>("");
  const [nameTouched, setNameTouched] = useState<boolean>(false);
  const [gameId, setGameId] = useState<string>("");
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [modal, setModal] = useState<ModalType>(null);
  const [gameStarted, setGameStarted] = useState<boolean>(false);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const [hostSecret, setHostSecret] = useState<string>("");
  const [playerToken, setPlayerToken] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");

  useEffect(() => {
    const stored = readStoredSession();
    const urlCode = readGameIdFromUrl();

    if (stored && stored.expiresAt > Date.now() && stored.gameSlug === game.slug) {
      setFlow(stored.flow);
      setGameId(stored.gameCode);
      setHostSecret(stored.hostSecret || "");
      setPlayerToken(stored.playerToken);
      setScreen("lobby");
      setErrorText("");
      void attemptRejoin(stored.gameCode, stored.playerToken);
      return;
    }

    clearStoredSession();

    if (urlCode) {
      setFlow("join");
      setGameId(urlCode);
      setScreen("nameEntry");
    }
  }, [game.slug]);

  useEffect(() => {
    if (screen !== "loading") {
      return;
    }

    const timer = window.setTimeout(() => {
      setScreen("lobby");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [screen]);

  useEffect(() => {
    if (screen !== "lobby" || !gameId || !playerToken) {
      return;
    }

    let active = true;

    const run = async () => {
      try {
        const isAlive = await touchPlayer(gameId, playerToken);
        if (!active) {
          return;
        }

        if (!isAlive) {
          goHomeWithError("Session expired. Please rejoin.");
          return;
        }

        const state = await getLobbyState(gameId);
        if (!active) {
          return;
        }

        persistSession({
          flow: flow || "join",
          gameCode: gameId,
          gameSlug: game.slug,
          playerToken,
          hostSecret: hostSecret || ""
        });

        setPlayers(state.players);
        setPlayerCount(state.maxPlayers);

        if (state.status === "started") {
          setGameStarted(true);
          onLaunchGame({
            gameCode: gameId,
            gameSlug: state.gameSlug,
            hostSecret,
            playerToken
          });
        }

        if (state.status === "cancelled") {
          goHomeWithError("This lobby was cancelled by the host.");
        }
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText((error as Error).message || "Could not load lobby state.");
      }
    };

    void run();
    const interval = window.setInterval(() => {
      void run();
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [screen, gameId, playerToken, flow, hostSecret, game.slug, onLaunchGame]);

  const joinUrl = useMemo(() => {
    if (!gameId) {
      return "";
    }
    return `${window.location.origin}${game.route}?g=${gameId}`;
  }, [gameId, game.route]);

  const canSubmitName = sanitizeName(playerName).length > 0;

  function resetAll() {
    clearStoredSession();
    setScreen("home");
    setFlow(null);
    setPlayerCount(game.maxPlayers);
    setPlayerName("");
    setJoinLinkInput("");
    setNameTouched(false);
    setGameId("");
    setPlayers([]);
    setModal(null);
    setGameStarted(false);
    setCopyState("idle");
    setHostSecret("");
    setPlayerToken("");
    setBusy(false);
    setErrorText("");
    window.history.replaceState({}, "", game.route);
  }

  function goHomeWithError(message: string) {
    clearStoredSession();
    setScreen("home");
    setFlow(null);
    setPlayerCount(game.maxPlayers);
    setPlayerName("");
    setJoinLinkInput("");
    setNameTouched(false);
    setGameId("");
    setPlayers([]);
    setModal(null);
    setGameStarted(false);
    setCopyState("idle");
    setHostSecret("");
    setPlayerToken("");
    setBusy(false);
    setErrorText(message);
    window.history.replaceState({}, "", game.route);
  }

  function startCreateFlow() {
    setFlow("host");
    setScreen("nameEntry");
    setPlayerName("");
    setNameTouched(false);
    setErrorText("");
  }

  function startJoinFlow() {
    const idFromUrl = readGameIdFromUrl();
    setFlow("join");
    setPlayerName("");
    setNameTouched(false);
    setErrorText("");

    if (idFromUrl) {
      setGameId(idFromUrl);
      setScreen("nameEntry");
      return;
    }

    setScreen("joinLink");
  }

  function goBack() {
    setErrorText("");

    if (screen === "joinLink") {
      resetAll();
      return;
    }

    if (screen === "nameEntry") {
      if (flow === "join" && !readGameIdFromUrl() && !gameId) {
        setScreen("joinLink");
      } else if (flow === "join" && !readGameIdFromUrl() && gameId) {
        setScreen("joinLink");
      } else {
        resetAll();
      }
    }
  }

  function handleNameChange(value: string) {
    setNameTouched(true);
    setPlayerName(value.replace(/\s+/g, "").slice(0, MAX_NAME_LENGTH));
    setErrorText("");
  }

  function continueFromJoinLink() {
    const code = parseGameCodeFromInput(joinLinkInput);
    if (!code) {
      setErrorText("Enter a valid join URL or game code.");
      return;
    }

    setGameId(code);
    window.history.replaceState({}, "", `${game.route}?g=${code}`);
    setScreen("nameEntry");
    setErrorText("");
  }

  function onJoinLinkInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    continueFromJoinLink();
  }

  async function continueFromName() {
    if (!canSubmitName || !flow || busy) {
      return;
    }

    const cleaned = sanitizeName(playerName);
    setBusy(true);
    setErrorText("");

    try {
      if (flow === "host") {
        const created = await createGame(cleaned, game.slug);
        setGameId(created.gameCode);
        setHostSecret(created.hostSecret);
        setPlayerToken(created.hostPlayerToken);
        persistSession({
          flow: "host",
          gameCode: created.gameCode,
          gameSlug: game.slug,
          playerToken: created.hostPlayerToken,
          hostSecret: created.hostSecret
        });
        setScreen("loading");
      } else {
        if (!gameId) {
          throw new Error("Missing game code.");
        }
        const joined = await joinGame(gameId, cleaned);
        setPlayerToken(joined.playerToken);
        persistSession({
          flow: "join",
          gameCode: gameId,
          gameSlug: game.slug,
          playerToken: joined.playerToken,
          hostSecret: ""
        });
        setScreen("lobby");
      }
    } catch (error) {
      setErrorText((error as Error).message || "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function onNameInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void continueFromName();
  }

  async function attemptRejoin(code: string, token: string) {
    setBusy(true);
    try {
      await rejoinGame(code, token);
      setErrorText("");
    } catch {
      goHomeWithError("Session expired. Please rejoin.");
    } finally {
      setBusy(false);
    }
  }

  async function copyJoinLink() {
    if (!joinUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopyState("ok");
    } catch {
      setCopyState("fail");
    }
  }

  async function confirmStartGame() {
    if (!gameId || !hostSecret || busy) {
      return;
    }

    setBusy(true);
    setErrorText("");
    try {
      await startGame(gameId, hostSecret);
      setGameStarted(true);
      setModal(null);
      onLaunchGame({
        gameCode: gameId,
        gameSlug: game.slug,
        hostSecret,
        playerToken
      });
    } catch (error) {
      setErrorText((error as Error).message || "Failed to start game.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancelGame() {
    if (!gameId || !hostSecret || busy) {
      return;
    }

    setBusy(true);
    setErrorText("");
    try {
      await cancelGame(gameId, hostSecret);
      resetAll();
    } catch (error) {
      setErrorText((error as Error).message || "Failed to cancel game.");
      setBusy(false);
    }
  }

  const title = (() => {
    if (screen === "joinLink") {
      return "Join game";
    }
    if (screen === "nameEntry" && flow === "join") {
      return `Join game: #${gameId || "------"}`;
    }
    if (screen === "nameEntry") {
      return "Enter your name";
    }
    if (screen === "loading") {
      return "Game loading";
    }
    if (screen === "lobby") {
      return `Game lobby: #${gameId || "..."}`;
    }
    return game.title;
  })();

  return (
    <div className="site-shell">
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-label="Toggle light and dark mode"
        >
          {theme === "light" ? "Dark mode" : "Light mode"}
        </button>

        {screen === "home" && (
          <section className="screen screen-home">
            <header className="screen-header">
              <h1>{title}</h1>
              <p className="body-text">{game.description}</p>
              <p className="body-text small">{game.shortRules}</p>
            </header>

            {errorText && <p className="hint-text error-text">{errorText}</p>}

            <div className="bottom-stack">
              <button className="btn btn-key" type="button" onClick={startCreateFlow}>
                Create game
              </button>
              <button className="btn btn-soft" type="button" onClick={startJoinFlow}>
                Join game
              </button>
              <button className="btn btn-soft" type="button" onClick={onExit}>
                Back to games
              </button>
            </div>
          </section>
        )}

        {screen === "joinLink" && (
          <section className="screen screen-basic">
            <header className="screen-header">
              <h1>{title}</h1>
              <p className="body-text">Enter a join URL or 6 character code.</p>
            </header>

            <label className="field-wrap" htmlFor="join-link-input">
              <br></br><span className="body-text">Paste URL or code:</span>
              <input
                id="join-link-input"
                className="input-pill"
                type="text"
                value={joinLinkInput}
                onChange={(event) => setJoinLinkInput(event.target.value)}
                onKeyDown={onJoinLinkInputKeyDown}
                placeholder=""
              />
            </label>

            {errorText && <p className="hint-text error-text">{errorText}</p>}

            <div className="bottom-stack">
              <button className="btn btn-key" type="button" onClick={continueFromJoinLink}>
                Next
              </button>
              <button className="btn btn-soft" type="button" onClick={goBack}>
                Back
              </button>
            </div>
          </section>
        )}

        {screen === "nameEntry" && (
          <section className="screen screen-basic">
            <header className="screen-header">
              <h1>{title}</h1><br></br>
              {flow === "join" && <p className="body-text">Enter your name</p>}
            </header>

            <label className="field-wrap" htmlFor="name-input">
              <input
                id="name-input"
                className="input-pill"
                type="text"
                value={playerName}
                onChange={(event) => handleNameChange(event.target.value)}
                onKeyDown={onNameInputKeyDown}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Enter your name"
              />
              {nameTouched && playerName.length >= MAX_NAME_LENGTH && (
                <span className="hint-text">10 character max reached</span>
              )}
            </label>

            {errorText && <p className="hint-text error-text">{errorText}</p>}

            <div className="bottom-stack">
              <button
                className="btn btn-key"
                type="button"
                onClick={() => void continueFromName()}
                disabled={!canSubmitName || busy || (flow === "join" && !gameId)}
              >
                {busy ? "Working..." : flow === "host" ? "Create game" : "Join game"}
              </button>
              <button className="btn btn-soft" type="button" onClick={goBack} disabled={busy}>
                Back
              </button>
            </div>
          </section>
        )}

        {screen === "loading" && (
          <section className="screen screen-basic loading-screen">
            <header className="screen-header">
              <h1>{title}</h1>
            </header>
            <p className="body-text small">
              Tip: turn your phone brightness down so your friends can't see your screen.
            </p>
          </section>
        )}

        {screen === "lobby" && (
          <section className="screen screen-lobby">


            <header className="screen-header">
              <h1>{title}</h1>
              <p className="body-text">
                {flow === "host" ? "Join game link" : "Waiting for host to start game..."}
              </p>
            </header>

            <div className="link-card">
              <p className="link-text">{joinUrl || "Waiting for join link..."}</p>
              <button className="btn btn-soft" type="button" onClick={() => void copyJoinLink()}>
                Copy link
              </button>
              {copyState === "ok" && <p className="hint-text">Link copied.</p>}
              {copyState === "fail" && <p className="hint-text">Copy failed. You can copy manually.</p>}
            </div>

            <div className="players-panel">
              <p className="body-text left">
                Players: {players.length} (max {playerCount})
              </p>
              <div className="player-grid">
                {players.map((player) => (
                  <div key={player.id} className="player-pill">
                    {player.name}
                  </div>
                ))}
              </div>
            </div>

            {errorText && <p className="hint-text error-text">{errorText}</p>}

            {!gameStarted && flow === "host" && (
              <>
                {players.length < MIN_PLAYERS_TO_START && (
                  <p className="hint-text error-text">At least 3 players are required to start.</p>
                )}
                <button
                  className="btn btn-key"
                  type="button"
                  onClick={() => setModal("start")}
                  disabled={players.length < MIN_PLAYERS_TO_START || busy}
                >
                  Start game
                </button>
              </>
            )}
            {flow === "host" && (

            <button className="btn btn-soft" type="button" onClick={() => setModal("cancel")}>
                Cancel
              </button>
            )}

            {!gameStarted && flow === "join" && (
              <div className="waiting-text">Waiting for host to start game.</div>
            )}

            {gameStarted && <div className="waiting-text">Game started. Game screen comes next.</div>}
          </section>
        )}
      

      {modal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            {modal === "cancel" && (
              <>
                <h2>Cancel game?</h2>
                <p className="body-text small">
                  Are you sure you want to cancel your game? This returns everyone to the first screen.
                </p>
                <div className="bottom-row">
                  <button className="btn btn-key" type="button" onClick={() => void confirmCancelGame()}>
                    Yes
                  </button>
                  <button className="btn btn-soft" type="button" onClick={() => setModal(null)}>
                    No
                  </button>
                </div>
              </>
            )}

            {modal === "start" && (
              <>
                <h2>Start game?</h2>
                <p className="body-text small">Are you sure? You cannot undo this action.</p>
                <div className="bottom-row">
                  <button className="btn btn-key" type="button" onClick={() => void confirmStartGame()}>
                    Yes
                  </button>
                  <button className="btn btn-soft" type="button" onClick={() => setModal(null)}>
                    No
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
