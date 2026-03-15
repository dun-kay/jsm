import type { GameConfig } from "./types";

export const GAMES: GameConfig[] = [
  {
    id: "A",
    slug: "secret-category",
    title: "Secret Categories",
    description: "One Spy. One secret. One-word clues.",
    shortRules: "Everyone sees the main category. Only non-spies see the secret category. Give one-word clues & try find the spy (or the secret).",
    heroImage: "/assets/secret-categories-logo.png",
    theme: "default",
    minPlayers: 3,
    maxPlayers: 18,
    joinPrefix: "A",
    route: "/g/secret-category/",
    enabled: true
  },
  {
    id: "B",
    slug: "popular-people",
    title: "Popular People",
    description: "Collect players by guessing their person.",
    shortRules: "Add 1 popular person each. Study the list, then ask and confirm guesses face to face.",
    heroImage: "/assets/celebrities-logo.png",
    theme: "default",
    minPlayers: 2,
    maxPlayers: 18,
    joinPrefix: "B",
    route: "/g/popular-people/",
    enabled: true
  }
];

export function getGameBySlug(slug: string): GameConfig | undefined {
  const normalized = slug === "celebrities" ? "popular-people" : slug;
  return GAMES.find((game) => game.slug === normalized && game.enabled);
}
