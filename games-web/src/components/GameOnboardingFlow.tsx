import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  cancelGame,
  createGame,
  getLobbyState,
  joinGame,
  leaveGame,
  rejoinGame,
  startGame,
  touchPlayer,
  type LobbyPlayer,
  type LobbyStatus
} from "../lib/lobbyApi";
import AccessPaywallModal from "./AccessPaywallModal";
import { getAccessState, type AccessState } from "../lib/accessApi";
import { getGameIntroRules } from "../games/rules";
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

function randomQuickName(prefix: string): string {
  const suffix = Math.floor(1000 + Math.random() * 9000).toString();
  return `${prefix}${suffix}`.slice(0, MAX_NAME_LENGTH);
}

export default function GameOnboardingFlow({
  game,
  onExit,
  onLaunchGame,
  theme,
  onToggleTheme
}: GameOnboardingFlowProps) {
  const isDrawWf = game.slug === "draw-wf";
  const sessionKey = `notes_session_${game.slug}`;

  const readStoredSession = (): StoredSession | null => {
    if (isDrawWf) {
      return null;
    }
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
    if (isDrawWf) {
      return;
    }
    window.localStorage.removeItem(sessionKey);
  };

  const persistSession = (data: Omit<StoredSession, "expiresAt">) => {
    if (isDrawWf) {
      return;
    }
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
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
  const [accessState, setAccessState] = useState<AccessState | null>(null);
  const [showPaywall, setShowPaywall] = useState<boolean>(false);
  const [primedLobbyCode, setPrimedLobbyCode] = useState<string>("");
  const [drawWfPreviewPlayers, setDrawWfPreviewPlayers] = useState<LobbyPlayer[]>([]);
  const [drawWfPreviewLoading, setDrawWfPreviewLoading] = useState<boolean>(false);
  const [drawWfPreviewStatus, setDrawWfPreviewStatus] = useState<LobbyStatus | null>(null);
  const introRules = useMemo(() => getGameIntroRules(game.slug), [game.slug]);
  const drawWfHostName = useMemo(
    () => drawWfPreviewPlayers.find((player) => player.isHost)?.name?.trim() || "",
    [drawWfPreviewPlayers]
  );
  const drawWfInviteCopy = useMemo(() => {
    const host = drawWfHostName || "A friend";
    return `${host} has invited you to their game. Try guess their drawing..`;
  }, [drawWfHostName]);

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
      setGameId(urlCode);
      if (isDrawWf) {
        setFlow("join");
        setScreen("home");
      } else {
        setFlow("join");
        setScreen("nameEntry");
      }
    }
  }, [game.slug, isDrawWf]);

  useEffect(() => {
    if (!isDrawWf || !gameId || screen !== "home") {
      return;
    }

    let active = true;
    const loadPreview = async () => {
      setDrawWfPreviewLoading(true);
      try {
        const state = await getLobbyState(gameId);
        if (!active) {
          return;
        }
        if (state.gameSlug !== "draw-wf") {
          setErrorText("This link is not for Draw Things.");
          setDrawWfPreviewPlayers([]);
          setDrawWfPreviewStatus(null);
          return;
        }
        setDrawWfPreviewPlayers(state.players);
        setDrawWfPreviewStatus(state.status);
        setErrorText("");
      } catch (error) {
        if (!active) {
          return;
        }
        setDrawWfPreviewPlayers([]);
        setDrawWfPreviewStatus(null);
        setErrorText((error as Error).message || "Could not load game preview.");
      } finally {
        if (active) {
          setDrawWfPreviewLoading(false);
        }
      }
    };

    void loadPreview();
    return () => {
      active = false;
    };
  }, [isDrawWf, gameId, screen]);

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

  useEffect(() => {
    if (isDrawWf) {
      return;
    }
    if (screen !== "lobby" || !gameId || !playerToken || gameStarted) {
      return;
    }
    if (primedLobbyCode === gameId) {
      return;
    }

    let active = true;

    const primePaymentWarning = async () => {
      try {
        const next = await getAccessState();
        if (!active) {
          return;
        }
        setAccessState(next);
        if (!next.paidUnlockActive && next.freeSessionsLeft <= 0) {
          setShowPaywall(true);
        }
        setPrimedLobbyCode(gameId);
      } catch {
        if (!active) {
          return;
        }
        setPrimedLobbyCode(gameId);
      }
    };

    void primePaymentWarning();

    return () => {
      active = false;
    };
  }, [screen, gameId, playerToken, gameStarted, primedLobbyCode, isDrawWf]);

  const joinUrl = useMemo(() => {
    if (!gameId) {
      return "";
    }
    return `${window.location.origin}${game.route}?g=${gameId}`;
  }, [gameId, game.route]);

  const canSubmitName = sanitizeName(playerName).length > 0;

  useEffect(() => {
    let active = true;

    const buildQr = async () => {
      if (!joinUrl || screen !== "lobby") {
        setQrCodeDataUrl("");
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(joinUrl, {
          width: 180,
          margin: 1
        });
        if (!active) {
          return;
        }
        setQrCodeDataUrl(dataUrl);
      } catch {
        if (!active) {
          return;
        }
        setQrCodeDataUrl("");
      }
    };

    void buildQr();

    return () => {
      active = false;
    };
  }, [joinUrl, screen]);

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
    setShowPaywall(false);
    setAccessState(null);
    setPrimedLobbyCode("");
    setDrawWfPreviewPlayers([]);
    setDrawWfPreviewLoading(false);
    setDrawWfPreviewStatus(null);
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
    setShowPaywall(false);
    setAccessState(null);
    setPrimedLobbyCode("");
    setDrawWfPreviewPlayers([]);
    setDrawWfPreviewLoading(false);
    setDrawWfPreviewStatus(null);
    window.history.replaceState({}, "", game.route);
  }

  function startCreateFlow() {
    if (isDrawWf) {
      void launchDrawWfHost();
      return;
    }
    setFlow("host");
    setScreen("nameEntry");
    setPlayerName("");
    setNameTouched(false);
    setErrorText("");
  }

  function startJoinFlow() {
    if (isDrawWf) {
      void launchDrawWfJoin();
      return;
    }
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

  async function launchDrawWfHost() {
    if (busy) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const hostName = randomQuickName("P");
      const created = await createGame(hostName, game.slug);
      await startGame(created.gameCode, created.hostSecret);
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
      onLaunchGame({
        gameCode: created.gameCode,
        gameSlug: game.slug,
        hostSecret: created.hostSecret,
        playerToken: created.hostPlayerToken
      });
    } catch (error) {
      setErrorText((error as Error).message || "Unable to start Draw Things.");
    } finally {
      setBusy(false);
    }
  }

  async function launchDrawWfJoin() {
    if (busy) {
      return;
    }
    const code = gameId || readGameIdFromUrl();
    if (!code) {
      setErrorText("Missing join code.");
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const joined = await joinGame(code, randomQuickName("G"));
      setGameId(code);
      setPlayerToken(joined.playerToken);
      setHostSecret("");
      persistSession({
        flow: "join",
        gameCode: code,
        gameSlug: game.slug,
        playerToken: joined.playerToken,
        hostSecret: ""
      });
      onLaunchGame({
        gameCode: code,
        gameSlug: game.slug,
        hostSecret: "",
        playerToken: joined.playerToken
      });
    } catch (error) {
      setErrorText((error as Error).message || "Unable to join Draw Things.");
    } finally {
      setBusy(false);
    }
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
        setScreen("lobby");
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

  async function leaveLobbyAndGoBack() {
    if (!gameId || !playerToken || busy) {
      return;
    }

    setBusy(true);
    setErrorText("");
    try {
      await leaveGame(gameId, playerToken);
      clearStoredSession();
      setPlayers([]);
      setPlayerToken("");
      setHostSecret("");
      setGameStarted(false);
      setCopyState("idle");
      setPlayerName("");
      setNameTouched(false);
      setFlow("join");
      setScreen("nameEntry");
      setShowPaywall(false);
      setAccessState(null);
      setPrimedLobbyCode("");
    } catch (error) {
      setErrorText((error as Error).message || "Failed to leave game.");
    } finally {
      setBusy(false);
    }
  }

  const title = (() => {
    if (isDrawWf && gameId && screen === "home") {
      return `Join ${game.title} game`;
    }
    if (screen === "joinLink") {
      return `Join a game of ${game.title}`;
    }
    if (screen === "nameEntry" && flow === "join") {
      return isDrawWf ? `Join ${game.title} game` : `Join ${game.title} game: ${gameId || "------"}`;
    }
    if (screen === "nameEntry") {
      return "Enter your name";
    }
    if (screen === "loading") {
      return "Game loading...";
    }
    if (screen === "lobby") {
      return `${game.title} game lobby: ${gameId || "..."}`;
    }
    return game.title;
  })();

  return (
    <div className="site-shell">
        {screen === "lobby" && flow === "join" && !gameStarted ? (
          <div className="top-actions">
            <button
              className="theme-toggle quit-toggle"
              type="button"
              onClick={() => void leaveLobbyAndGoBack()}
              disabled={busy}
            >
              Back
            </button>
            <button
              className="theme-toggle"
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle light and dark mode"
            >
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
          </div>
        ) : (
          <button
            className="theme-toggle"
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle light and dark mode"
          >
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        )}

        {screen === "home" && (
          <section className="screen screen-home">
            <header className="screen-header">
              <div className="landing-hero-wrap">
                <img
                  className="landing-hero-image"
                  src={game.heroImage || "/assets/secret-categories-logo.png"}
                  alt={`${game.title} image`}
                />
              </div>
              <div className="play-meta-row">
                {!isDrawWf ? (
                  <>
                    <div className="play">{game.minPlayers} - {game.maxPlayers} players</div>
                    <div className="play">{game.playTime}</div>
                    <div className="play">{game.ageGuide}</div>
                  </>
                ) : null}
              </div>
              <h1>{title}</h1>
              <p className="body-text">{isDrawWf ? drawWfInviteCopy : game.description}</p>
              {!isDrawWf ? <p className="body-text small">{game.shortRules}</p> : null}
              {!isDrawWf ? (
                <>
                  <button type="button" className="btn btn-key rules" onClick={() => setShowRulesModal(true)}>
                  Full game rules
                  </button><br></br>
                </>
              ) : null}
            </header>

            {errorText && <p className="hint-text error-text">{errorText}</p>}

            <div>
              {isDrawWf && gameId ? (
                <>
                  
                  <div>
                    <p></p><p className="body-text small"><b>Players:</b></p>
                    {drawWfPreviewStatus === "started" ? (
                      <p></p>
                    ) : null}
                    <div className="player-grid">
                      {drawWfPreviewLoading ? <p className="hint-text">Loading...</p> : null}
                      {!drawWfPreviewLoading && drawWfPreviewPlayers.length === 0 ? <p className="hint-text">No players yet</p> : null}
                      {!drawWfPreviewLoading
                        ? drawWfPreviewPlayers.map((player) => (
                            <div key={player.id} className="player-pill">
                              {player.name}
                            </div>
                          ))
                        : null}
                    </div>
                  </div><p></p>
                  <button className="btn btn-key" type="button" onClick={startJoinFlow} disabled={busy}>
                    {busy ? "Loading..." : "Join"}
                  </button><p></p>
                  
                </>
              ) : isDrawWf ? (
                <>
                  <br></br><button className="btn btn-key" type="button" onClick={startCreateFlow} disabled={busy}>
                    {busy ? "Loading..." : "Play"}
                  </button>
                  <p></p><p className="hint-text nb">
                    Join via share link (ask a player to send it to you)
                  </p><p></p>
                </>
              ) : (
                <>
                  <button className="btn btn-key" type="button" onClick={startCreateFlow}>
                    Create game
                  </button>
                  <button className="btn btn-soft" type="button" onClick={startJoinFlow}>
                    Join game
                  </button>
                </>
              )}
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
              <br></br><br></br><h1>{title}</h1>
            </header>
            <p className="body-text small">
              
            </p>
          </section>
        )}

        {screen === "lobby" && (
          <section className="screen screen-lobby">


            <header className="screen-header">
              <h1>{title}</h1>
              <p className="body-text">
                {flow === "host" ? "Join game link:" : "Waiting for host to start game..."}
              </p>
            </header>

            <div className="link-card">
              {qrCodeDataUrl && (
                <img
                  src={qrCodeDataUrl}
                  alt="Join game QR code"
                  style={{ width: 75, height: 75, margin: "0 auto", borderRadius: 5, border: "solid 3px" }}
                />
              )}
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
                {players.length < game.minPlayers && (
                  <p className="hint-text error-text">At least {game.minPlayers} players are required to start.</p>
                )}
                <button
                  className="btn btn-key"
                  type="button"
                  onClick={() => setModal("start")}
                  disabled={players.length < game.minPlayers || busy}
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
              <div className="waiting-text">Waiting for host to start...</div>
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

      {showRulesModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card rules-modal rules-modal-scroll">
            <h2>{introRules.title}</h2>
            <div className="rules-modal-content">{introRules.content}</div>
            <button className="btn btn-key" type="button" onClick={() => setShowRulesModal(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {!isDrawWf ? (
        <AccessPaywallModal
          open={showPaywall}
          state={accessState}
          onClose={() => setShowPaywall(false)}
          onRefreshState={async () => {
            const next = await getAccessState();
            setAccessState(next);
          }}
          onUnlocked={async () => {
            const next = await getAccessState();
            setAccessState(next);
            setShowPaywall(false);
          }}
        />
      ) : null}
    </div>
  );
}
