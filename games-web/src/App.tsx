import { useEffect, useMemo, useState } from "react";
import {
  cancelGame,
  createGame,
  getLobbyState,
  joinGame,
  startGame,
  type LobbyPlayer
} from "./lib/lobbyApi";

type ThemeMode = "light" | "dark";
type FlowMode = "host" | "join";
type Screen = "home" | "playerCount" | "nameEntry" | "loading" | "lobby";
type ModalType = "cancel" | "start" | null;

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 100;
const MAX_NAME_LENGTH = 10;

function readGameIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("g")?.toUpperCase() || "";
}

function sanitizeName(value: string): string {
  return value.trim().slice(0, MAX_NAME_LENGTH);
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [screen, setScreen] = useState<Screen>("home");
  const [flow, setFlow] = useState<FlowMode | null>(null);
  const [playerCount, setPlayerCount] = useState<number>(MIN_PLAYERS);
  const [playerName, setPlayerName] = useState<string>("");
  const [nameTouched, setNameTouched] = useState<boolean>(false);
  const [gameId, setGameId] = useState<string>("");
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [modal, setModal] = useState<ModalType>(null);
  const [gameStarted, setGameStarted] = useState<boolean>(false);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const [joinBuffer, setJoinBuffer] = useState<number>(10);
  const [hostSecret, setHostSecret] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
    if (screen !== "lobby" || !gameId) {
      return;
    }

    let active = true;

    const run = async () => {
      try {
        const state = await getLobbyState(gameId);
        if (!active) {
          return;
        }

        setPlayers(state.players);
        setPlayerCount(state.maxPlayers);
        setJoinBuffer(state.joinBuffer);
        setGameStarted(state.status === "started");

        if (state.status === "cancelled") {
          setErrorText("This lobby was cancelled by the host.");
          resetAll();
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
  }, [screen, gameId]);

  useEffect(() => {
    if (screen !== "lobby" || flow !== "host") {
      return;
    }

    void copyJoinLink();
  }, [screen, flow, gameId]);

  const joinLink = useMemo(() => {
    if (!gameId) {
      return "";
    }
    return `${window.location.origin}${window.location.pathname}?g=${gameId}`;
  }, [gameId]);

  const canSubmitName = sanitizeName(playerName).length > 0;

  function resetAll() {
    setScreen("home");
    setFlow(null);
    setPlayerCount(MIN_PLAYERS);
    setPlayerName("");
    setNameTouched(false);
    setGameId("");
    setPlayers([]);
    setModal(null);
    setGameStarted(false);
    setCopyState("idle");
    setJoinBuffer(10);
    setHostSecret("");
    setBusy(false);
  }

  function startCreateFlow() {
    setFlow("host");
    setScreen("playerCount");
    setPlayerName("");
    setNameTouched(false);
    setPlayers([]);
    setGameStarted(false);
    setCopyState("idle");
    setErrorText("");
  }

  function startJoinFlow() {
    const idFromUrl = readGameIdFromUrl();
    setFlow("join");
    setScreen("nameEntry");
    setPlayerName("");
    setNameTouched(false);
    setPlayers([]);
    setGameStarted(false);
    setCopyState("idle");
    setGameId(idFromUrl);
    setErrorText(idFromUrl ? "" : "Missing game code in URL. Use a host invite link.");
  }

  function goBack() {
    setErrorText("");

    if (screen === "playerCount") {
      resetAll();
      return;
    }

    if (screen === "nameEntry") {
      if (flow === "host") {
        setScreen("playerCount");
      } else {
        resetAll();
      }
    }
  }

  function handleNameChange(value: string) {
    setNameTouched(true);
    setPlayerName(value.slice(0, MAX_NAME_LENGTH));
    setErrorText("");
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
        const created = await createGame(cleaned, playerCount);
        setGameId(created.gameCode);
        setHostSecret(created.hostSecret);
        setScreen("loading");
      } else {
        if (!gameId) {
          throw new Error("Missing game code in URL.");
        }
        await joinGame(gameId, cleaned);
        setScreen("lobby");
      }
    } catch (error) {
      setErrorText((error as Error).message || "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyJoinLink() {
    if (!joinLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(joinLink);
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
    if (screen === "playerCount") {
      return "How many players?";
    }
    if (screen === "nameEntry") {
      return "Your game name";
    }
    if (screen === "loading") {
      return "Game loading";
    }
    if (screen === "lobby") {
      return `Game ${gameId || "..."} lobby`;
    }
    return "JSM Games";
  })();

  return (
    <div className="page-shell">
      <main className="app-canvas">
        <button
          className="theme-toggle"
          type="button"
          onClick={() => setTheme((old) => (old === "light" ? "dark" : "light"))}
          aria-label="Toggle light and dark mode"
        >
          {theme === "light" ? "Dark" : "Light"}
        </button>

        {screen === "home" && (
          <section className="screen screen-home">
            <header className="screen-header">
              <h1>{title}</h1>
              <p className="body-text">
                Your phone replaces physical cards and game boards. Create or join to start.
              </p>
            </header>

            <div className="bottom-stack">
              <button className="btn btn-key" type="button" onClick={startCreateFlow}>
                Create game
              </button>
              <button className="btn btn-key" type="button" onClick={startJoinFlow}>
                Join game
              </button>
            </div>
          </section>
        )}

        {screen === "playerCount" && (
          <section className="screen screen-basic">
            <header className="screen-header">
              <h1>{title}</h1>
            </header>

            <label className="field-wrap" htmlFor="player-count">
              <span className="body-text caps">Select player count</span>
              <select
                id="player-count"
                className="input-pill"
                value={playerCount}
                onChange={(event) => setPlayerCount(Number(event.target.value))}
              >
                {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => {
                  const value = MIN_PLAYERS + index;
                  return (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="bottom-row">
              <button className="btn btn-key" type="button" onClick={() => setScreen("nameEntry")}>
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
              <h1>{title}</h1>
            </header>

            <label className="field-wrap" htmlFor="name-input">
              <span className="body-text caps">Display name</span>
              <input
                id="name-input"
                className="input-pill"
                type="text"
                value={playerName}
                onChange={(event) => handleNameChange(event.target.value)}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Enter name"
              />
              {nameTouched && playerName.length >= MAX_NAME_LENGTH && (
                <span className="hint-text">10 character max reached</span>
              )}
            </label>

            <div className="bottom-row">
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
            <p className="body-text">
              Tip: turn your phone brightness down so your friends cannot accidentally see your screen.
            </p>
          </section>
        )}

        {screen === "lobby" && (
          <section className="screen screen-lobby">
            {flow === "host" && (
              <button className="icon-cancel" type="button" onClick={() => setModal("cancel")}>
                X
              </button>
            )}

            <header className="screen-header">
              <h1>{title}</h1>
              <p className="body-text">
                {flow === "host" ? "Join game link" : "Waiting for host to start game."}
              </p>
            </header>

            <div className="link-card">
              <p className="link-text">{joinLink || "Waiting for join link..."}</p>
              {flow === "host" && (
                <button className="btn btn-soft" type="button" onClick={() => void copyJoinLink()}>
                  Copy link
                </button>
              )}
              {flow === "host" && copyState === "ok" && <p className="hint-text">Link copied.</p>}
              {flow === "host" && copyState === "fail" && (
                <p className="hint-text">Copy failed. You can copy manually.</p>
              )}
            </div>

            <div className="players-panel">
              <p className="body-text caps">
                Players ({players.length}/{playerCount + joinBuffer})
              </p>
              <div className="player-grid">
                {players.map((player) => (
                  <div key={player.id} className="player-pill">
                    {player.name}
                  </div>
                ))}
              </div>
            </div>

            {!gameStarted && flow === "host" && (
              <button className="btn btn-key" type="button" onClick={() => setModal("start")}>
                Start game
              </button>
            )}

            {!gameStarted && flow === "join" && (
              <div className="waiting-text">Waiting for host to start game.</div>
            )}

            {gameStarted && <div className="waiting-text">Game started. Game screen comes next.</div>}
          </section>
        )}

        {errorText && <p className="hint-text app-error">{errorText}</p>}
      </main>

      {modal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            {modal === "cancel" && (
              <>
                <h2>Cancel game?</h2>
                <p className="body-text">
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
                <p className="body-text">Are you sure? You cannot undo this action.</p>
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