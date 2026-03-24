import type { GameConfig } from "./types";

export const GAMES: GameConfig[] = [
  {
    id: "A",
    slug: "secret-category",
    title: "Secret Categories",
    description: "One player is the spy. Use one-word clues to keep the secret hidden from them.",
    shortRules: "Everyone sees the main category. The secret category is hidden from one player (the spy). Give one-word clues relating to the secret cateogry without revealing it to the spy.",
    heroImage: "/assets/secret-categories-logo.png",
    theme: "default",
    minPlayers: 3,
    maxPlayers: 18,
    playTime: "5 - 15 mins",
    ageGuide: "Ages 10+",
    joinPrefix: "A",
    route: "/g/secret-category/",
    enabled: true
  },
  {
    id: "B",
    slug: "popular-people",
    title: "Popular People",
    description: "Guess your friends' chosen popular person before they guess yours.",
    shortRules: "Each player picks one popular person in secret. Use social deduction and cunning to figure out everyone's choice before they figure out yours.",
    heroImage: "/assets/popular-people-logo.png",
    theme: "default",
    minPlayers: 3,
    maxPlayers: 18,
    playTime: "10 - 20mins",
    ageGuide: "Ages 8+",
    joinPrefix: "B",
    route: "/g/popular-people/",
    enabled: true
  },
  {
    id: "C",
    slug: "fruit-bowl",
    title: "Fruit Bowl",
    description: "Guess the prompts your team pulls from the fruit bowl. Describe, act, or use a word.",
    shortRules: "Each player adds 2 words to the bowl. Across 3 rounds you describe, act, or use one word to help your team guess the prompt.",
    heroImage: "/assets/fruit-bowl-logo.png",
    theme: "default",
    minPlayers: 4,
    maxPlayers: 18,
    playTime: "15 - 30mins",
    ageGuide: "Ages 8+",
    joinPrefix: "C",
    route: "/g/fruit-bowl/",
    enabled: true
  },
  {
    id: "D",
    slug: "murder-club",
    title: "Murder Club",
    description: "Find the hidden killer & their accomplices. Vote to submit or reject evidence.",
    shortRules: "One killer hides amoung you. Vote to submit or reject case evidence. Catch the killer before they derail the investigation.",
    heroImage: "/assets/murder-club-logo.png",
    theme: "default",
    minPlayers: 4,
    maxPlayers: 18,
    playTime: "10 - 20mins",
    ageGuide: "Ages 14+",
    joinPrefix: "D",
    route: "/g/murder-club/",
    enabled: true
  }
];

export function getGameBySlug(slug: string): GameConfig | undefined {
  const normalized = slug === "celebrities" ? "popular-people" : slug === "fruit-bowel" ? "fruit-bowl" : slug;
  return GAMES.find((game) => game.slug === normalized && game.enabled);
}
