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
    description: "Guess your friends' favourite popular person before they guess yours.",
    shortRules: "Each player picks one popular person in secret. Use social deduction and cunning to figure out everyone's choice before they figure out yours.",
    heroImage: "/assets/celebrities-logo.png",
    theme: "default",
    minPlayers: 3,
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
