import type { GameConfig } from "./types";

export const GAMES: GameConfig[] = [
  {
    id: "A",
    slug: "secret-category",
    title: "Secret Categories",
    description: "Description of screte categories",
    shortRules: "Short game rules go here.",
    heroImage: "",
    theme: "default",
    minPlayers: 3,
    maxPlayers: 18,
    joinPrefix: "A",
    route: "/g/secret-category/",
    enabled: true
  }
];

export function getGameBySlug(slug: string): GameConfig | undefined {
  return GAMES.find((game) => game.slug === slug && game.enabled);
}

