import { useEffect, useMemo, useState } from "react";
import GameOnboardingFlow from "./components/GameOnboardingFlow";
import GameRuntimeHost from "./components/GameRuntimeHost";
import HomeGamesGrid from "./components/HomeGamesGrid";
import LegalPage from "./components/LegalPage";
import StatsPage from "./components/StatsPage";
import FixedFooterLinks from "./components/FixedFooterLinks";
import CookieNotice from "./components/CookieNotice";
import AccessStatusPill from "./components/AccessStatusPill";
import { GAMES, getGameBySlug } from "./games/registry";
import type { GameSessionContext } from "./games/types";

type RouteState =
  | { kind: "home" }
  | { kind: "stats" }
  | { kind: "legal"; page: "terms" | "privacy" | "unlimited" }
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
  if (path === "/stats/") {
    return { kind: "stats" };
  }
  if (path === "/terms/") {
    return { kind: "legal", page: "terms" };
  }
  if (path === "/privacy-policy/") {
    return { kind: "legal", page: "privacy" };
  }
  if (path === "/how-unlimited-works/") {
    return { kind: "legal", page: "unlimited" };
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

  let page = null;

  if (route.kind === "home") {
    page = (
      <HomeGamesGrid
        games={enabledGames}
        onOpenGame={(game) => navigate(game.route)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  if (route.kind === "legal") {
    page = (
      <LegalPage
        type={route.page}
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={() => navigate("/")}
      />
    );
  }

  if (route.kind === "stats") {
    page = (
      <StatsPage
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={() => navigate("/")}
      />
    );
  }

  if (route.kind === "onboarding") {
    if (route.slug === "celebrities") {
      navigate("/g/popular-people/");
      return null;
    }
    if (route.slug === "fruit-bowel") {
      navigate("/g/fruit-bowl/");
      return null;
    }
    if (route.slug === "murder-clubs") {
      navigate("/g/murder-club/");
      return null;
    }

    const game = getGameBySlug(route.slug);
    if (!game) {
      page = (
        <HomeGamesGrid
          games={enabledGames}
          onOpenGame={(entry) => navigate(entry.route)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      );
    } else {
      page = (
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
  }

  if (!page && route.kind === "runtime") {
    page = (
      <GameRuntimeHost
        gameCode={route.gameCode}
        initialSession={runtimeSession}
        theme={theme}
        onToggleTheme={toggleTheme}
        onBackToHome={exitRuntimeToHome}
      />
    );
  }

  if (!page) {
    page = (
      <HomeGamesGrid
        games={enabledGames}
        onOpenGame={(game) => navigate(game.route)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return (
    <>
      <AccessStatusPill hidden={route.kind === "runtime"} />
      {page}
      <FixedFooterLinks />
      <CookieNotice />
    </>
  );
}
