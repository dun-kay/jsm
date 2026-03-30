import { useEffect, useMemo, useState } from "react";
import GameOnboardingFlow from "./components/GameOnboardingFlow";
import GameRuntimeHost from "./components/GameRuntimeHost";
import HomeGamesGrid from "./components/HomeGamesGrid";
import LegalPage from "./components/LegalPage";
import StatsPage from "./components/StatsPage";
import GameRulesPage from "./components/GameRulesPage";
import FixedFooterLinks from "./components/FixedFooterLinks";
import CookieNotice from "./components/CookieNotice";
import AccessStatusPill from "./components/AccessStatusPill";
import { GAMES, getGameBySlug } from "./games/registry";
import type { GameSessionContext } from "./games/types";

type RouteState =
  | { kind: "home" }
  | { kind: "stats" }
  | { kind: "legal"; page: "terms" | "privacy" | "unlimited" }
  | { kind: "game-rules"; slug: string }
  | { kind: "onboarding"; slug: string }
  | { kind: "runtime"; gameCode: string };
type ThemeMode = "light" | "dark";
type MetaConfig = {
  title: string;
  description: string;
  robots?: "index,follow" | "noindex,nofollow";
};

const SESSION_CONTEXT_KEY = "notes_runtime_session";
const THEME_STORAGE_KEY = "notes_theme_mode";

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

  const gameRulesMatch = path.match(/^\/g\/([^/]+)\/rules\/$/);
  if (gameRulesMatch) {
    return { kind: "game-rules", slug: gameRulesMatch[1] };
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

function readStoredTheme(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function upsertMetaTag(name: string, content: string) {
  let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

function getMetaForRoute(route: RouteState): MetaConfig {
  const bySlug: Record<string, { h: string; b: string }> = {
    "secret-category": {
      h: "Play Secret Categories | Games With Friends",
      b: "One player is the spy. Use one-word clues to keep the secret hidden from them."
    },
    "popular-people": {
      h: "Play Popular People | Games With Friends",
      b: "Guess your friends' chosen popular person before they guess yours."
    },
    "fruit-bowl": {
      h: "Play Fruit Bowl | Games With Friends",
      b: "Guess the prompts your team pulls from the fruit bowl. Describe, act, or use a word."
    },
    "murder-club": {
      h: "Play Murder Club | Games With Friends",
      b: "Find the hidden killer & their accomplices. Vote to submit or reject evidence."
    },
    "lying-llama": {
      h: "Play Lying Llama | Games With Friends",
      b: "Bluff, catch Charlatans, and collect the most cards to win."
    },
    "fake-famous": {
      h: "Play Fake Famous | Games With Friends",
      b: "Vote real or fake, then guess the speaker after a live impression."
    },
    "never-ever": {
      h: "Play Never Ever | Games With Friends",
      b: "Read the card, vote your answer, and see who gets called out."
    }
  };

  const rulesBySlug: Record<string, { h: string; b: string }> = {
    "secret-category": {
      h: "Secret Categories Rules | Games With Friends",
      b: "Game Rules: One player is the spy. Use one-word clues to keep the secret hidden from them."
    },
    "popular-people": {
      h: "Popular People Rules | Games With Friends",
      b: "Game Rules: Guess your friends' chosen popular person before they guess yours."
    },
    "fruit-bowl": {
      h: "Fruit Bowl Rules | Games With Friends",
      b: "Game Rules: Guess the prompts your team pulls from the fruit bowl. Describe, act, or use a word."
    },
    "murder-club": {
      h: "Murder Club Rules | Games With Friends",
      b: "Game Rules: Find the hidden killer & their accomplices. Vote to submit or reject evidence."
    },
    "lying-llama": {
      h: "Lying Llama Rules | Games With Friends",
      b: "Game Rules: Ask, bluff, call Charlatan, and collect the most cards to win."
    },
    "fake-famous": {
      h: "Fake Famous Rules | Games With Friends",
      b: "Game Rules: Vote real or fake, then guess who said it from five options."
    },
    "never-ever": {
      h: "Never Ever Rules | Games With Friends",
      b: "Game Rules: Read the card, vote your answer, and see who gets called out."
    }
  };

  if (route.kind === "home") {
    return {
      title: "Play Games With Friends by Jump Ship Media",
      description: "The fastest way to make a night more fun. Play IRL social games with your friends."
    };
  }

  if (route.kind === "onboarding") {
    const meta = bySlug[route.slug];
    if (meta) {
      return { title: meta.h, description: meta.b };
    }
  }

  if (route.kind === "game-rules") {
    const meta = rulesBySlug[route.slug];
    if (meta) {
      return { title: meta.h, description: meta.b };
    }
  }

  if (route.kind === "legal") {
    if (route.page === "terms") {
      return {
        title: "Terms | Games With Friends by Jump Ship Media",
        description: "Games with friends is a way to play IRL social with your friends, straight from your phone."
      };
    }
    if (route.page === "privacy") {
      return {
        title: "Privacy policy | Games With Friends by Jump Ship Media",
        description: "Games with friends is a way to play IRL social with your friends, straight from your phone."
      };
    }
    return {
      title: "How Unlimited PlayWorks | Games With Friends by Jump Ship Media",
      description: "Unlocking unlimited gives you unlimited game sessions/play for 4h or 30 days."
    };
  }

  if (route.kind === "stats") {
    return {
      title: "Session Stats | Games With Friends",
      description: "Internal stats page.",
      robots: "noindex,nofollow"
    };
  }

  if (route.kind === "runtime") {
    return {
      title: "Game Session | Games With Friends",
      description: "Live game runtime.",
      robots: "noindex,nofollow"
    };
  }

  return {
    title: "Play Games With Friends by Jump Ship Media",
    description: "The fastest way to make a night more fun. Play IRL social games with your friends."
  };
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [runtimeSession, setRuntimeSession] = useState<GameSessionContext | null>(() => readRuntimeSession());
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    if (window.location.hostname === "www.jumpship.media") {
      const target = new URL(window.location.href);
      target.hostname = "jumpship.media";
      window.location.replace(target.toString());
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage-write failures and keep runtime theme behavior.
    }
  }, [theme]);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const meta = getMetaForRoute(route);
    document.title = meta.title;
    upsertMetaTag("description", meta.description);
    upsertMetaTag("robots", meta.robots || "index,follow");
    upsertCanonical(`${window.location.origin}${window.location.pathname}`);
  }, [route]);

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
    if (route.slug === "really-donald") {
      navigate("/g/fake-famous/");
      return null;
    }
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

  if (route.kind === "game-rules") {
    if (route.slug === "really-donald") {
      navigate("/g/fake-famous/rules/");
      return null;
    }
    if (route.slug === "celebrities") {
      navigate("/g/popular-people/rules/");
      return null;
    }
    if (route.slug === "fruit-bowel") {
      navigate("/g/fruit-bowl/rules/");
      return null;
    }
    if (route.slug === "murder-clubs") {
      navigate("/g/murder-club/rules/");
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
        <GameRulesPage
          game={game}
          theme={theme}
          onToggleTheme={toggleTheme}
          onPlay={() => navigate(game.route)}
          onBack={() => navigate("/")}
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
