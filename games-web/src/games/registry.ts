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
    heroImage: "/assets/popular-people-logo.png",
    theme: "default",
    minPlayers: 3,
    maxPlayers: 18,
    joinPrefix: "B",
    route: "/g/popular-people/",
    enabled: true
  },
  {
    id: "C",
    slug: "fruit-bowl",
    title: "Fruit Bowl",
    description: "Race to guess prompts across 3 chaotic rounds.",
    shortRules: "Players add 2 words to the bowl. Across 3 rounds you: describe it, act it, & one word it.",
    heroImage: "/assets/fruit-bowl-logo.png",
    theme: "default",
    minPlayers: 4,
    maxPlayers: 18,
    joinPrefix: "C",
    route: "/g/fruit-bowl/",
    enabled: true
  },
  {
    id: "D",
    slug: "murder-club",
    title: "Murder Club",
    description: "Hidden killers. Public decisions. Fast rounds.",
    shortRules: "Pick mission teams, debate fast, vote publicly, then vote missions secretly. First to 3 wins.",
    heroImage: "/assets/murder-club-logo.png",
    theme: "default",
    minPlayers: 4,
    maxPlayers: 18,
    joinPrefix: "D",
    route: "/g/murder-club/",
    enabled: true
  }
];

export function getGameBySlug(slug: string): GameConfig | undefined {
  const normalized = slug === "celebrities" ? "popular-people" : slug === "fruit-bowel" ? "fruit-bowl" : slug;
  return GAMES.find((game) => game.slug === normalized && game.enabled);
}
