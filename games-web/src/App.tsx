import { useEffect, useMemo, useState } from "react";
import GameOnboardingFlow from "./components/GameOnboardingFlow";
import GameRuntimeHost from "./components/GameRuntimeHost";
import HomeGamesGrid from "./components/HomeGamesGrid";
import { GAMES, getGameBySlug } from "./games/registry";
import type { GameSessionContext } from "./games/types";

type RouteState =
  | { kind: "home" }
  | { kind: "onboarding"; slug: string }
  | { kind: "runtime"; gameCode: string };
type ThemeMode = "light" | "dark";

const SESSION_CONTEXT_KEY = "notes_runtime_session";

function normalizePath(pathname: string): string {
  if (!pathname.endsWith("/") && pathname !== "/") {
    return `${pathname}/`;
  }
  return pathname;
}

function parseRoute(pathname: string): RouteState {
  const path = normalizePath(pathname);

  if (path === "/") {
    return { kind: "home" };
  }

  const onboardingMatch = path.match(/^\/g\/([^/]+)\/$/);
  if (onboardingMatch) {
    return { kind: "onboarding", slug: onboardingMatch[1] };
  }

  const runtimeMatch = path.match(/^\/play\/([^/]+)\/$/);
  if (runtimeMatch) {
    return { kind: "runtime", gameCode: runtimeMatch[1].toUpperCase() };
  }

  return { kind: "home" };
}

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function saveRuntimeSession(session: GameSessionContext) {
  window.sessionStorage.setItem(SESSION_CONTEXT_KEY, JSON.stringify(session));
}

function clearRuntimeSession() {
  window.sessionStorage.removeItem(SESSION_CONTEXT_KEY);
}

function clearOnboardingSessions() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith("notes_session_")) {
      window.localStorage.removeItem(key);
    }
  }
}

function readRuntimeSession(): GameSessionContext | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_CONTEXT_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as GameSessionContext;
  } catch {
    return null;
  }
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [runtimeSession, setRuntimeSession] = useState<GameSessionContext | null>(() => readRuntimeSession());
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const enabledGames = useMemo(() => GAMES.filter((game) => game.enabled), []);
  const toggleTheme = () => setTheme((old) => (old === "light" ? "dark" : "light"));
  const exitRuntimeToHome = () => {
    clearRuntimeSession();
    clearOnboardingSessions();
    setRuntimeSession(null);
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  if (route.kind === "home") {
    return (
      <HomeGamesGrid
        games={enabledGames}
        onOpenGame={(game) => navigate(game.route)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  if (route.kind === "onboarding") {
    const game = getGameBySlug(route.slug);
    if (!game) {
      return (
        <HomeGamesGrid
          games={enabledGames}
          onOpenGame={(entry) => navigate(entry.route)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      );
    }

    return (
      <GameOnboardingFlow
        game={game}
        onExit={() => navigate("/")}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLaunchGame={(session) => {
          saveRuntimeSession(session);
          setRuntimeSession(session);
          navigate(`/play/${session.gameCode}/`);
        }}
      />
    );
  }

  return (
    <GameRuntimeHost
      gameCode={route.gameCode}
      initialSession={runtimeSession}
      theme={theme}
      onToggleTheme={toggleTheme}
      onBackToHome={exitRuntimeToHome}
    />
  );
}
