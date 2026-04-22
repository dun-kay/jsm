import type { GameConfig } from "./types";

export const GAMES: GameConfig[] = [
    {
    id: "M",
    slug: "one-away",
    title: "One Away",
    description: "Guess the #1 word from the clues.",
    shortRules: "",
    heroImage: "/assets/one-away-logo.png",
    theme: "default",
    minPlayers: 1,
    maxPlayers: 1,
    playTime: "2 - 5 mins",
    ageGuide: "Ages 8+",
    joinPrefix: "M",
    route: "/g/one-away/",
    enabled: true
  },
    {
    id: "N",
    slug: "order-me",
    title: "Order Me",
    description: "Order words based on similarity.",
    shortRules: "",
    heroImage: "/assets/order-me-logo.png",
    theme: "default",
    minPlayers: 1,
    maxPlayers: 1,
    playTime: "3 - 6 mins",
    ageGuide: "Ages 8+",
    joinPrefix: "N",
    route: "/g/order-me/",
    enabled: true
  },
  {
    id: "K",
    slug: "secret-words",
    title: "Secret Words",
    description: "Can you find the secret word?",
    shortRules: "",
    heroImage: "/assets/secret-words-logo.png",
    theme: "default",
    minPlayers: 1,
    maxPlayers: 1,
    playTime: "2 - 5 mins",
    ageGuide: "Ages 8+",
    joinPrefix: "K",
    route: "/g/secret-words/",
    enabled: true
  },  
  {
    id: "L",
    slug: "theme-words",
    title: "Theme Words",
    description: "Find the words from the letters.",
    shortRules: "",
    heroImage: "/assets/theme-words-logo.png",
    theme: "default",
    minPlayers: 1,
    maxPlayers: 1,
    playTime: "3 - 6 mins",
    ageGuide: "Ages 10+",
    joinPrefix: "L",
    route: "/g/theme-words/",
    enabled: true
  },
  {
    id: "J",
    slug: "draw-things",
    title: "Draw Things",
    description: "Draw things. Guess things. You have 20s.",
    shortRules: "",
    heroImage: "/assets/draw-wf-logo.png",
    theme: "default",
    minPlayers: 2,
    maxPlayers: 24,
    playTime: "2 - 10 mins",
    ageGuide: "Ages 6+",
    joinPrefix: "J",
    route: "/g/draw-things/",
    enabled: true
  },
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
    id: "D",
    slug: "detective-club",
    title: "Detective Club",
    description: "Find the hidden culprits. Vote to submit or reject evidence.",
    shortRules: "Half the group blocks evidence while the rest push it through. Find culprits before they derail the investigation.",
    heroImage: "/assets/detective-club-logo.png",
    theme: "default",
    minPlayers: 4,
    maxPlayers: 18,
    playTime: "10 - 20 mins",
    ageGuide: "Ages 14+",
    joinPrefix: "D",
    route: "/g/detective-club/",
    enabled: true
  },

    {
    id: "G",
    slug: "never-ever",
    title: "Never Ever",
    description: "The party game that reveals the real you.",
    shortRules: "Each turn, one player reads a spicy card out, then everyone votes if they would do it: Again, never again, maybe?, or never ever.",
    heroImage: "/assets/never-ever-logo.png",
    theme: "default",
    minPlayers: 2,
    maxPlayers: 18,
    playTime: "5 - 15 mins",
    ageGuide: "Ages 17+",
    joinPrefix: "G",
    route: "/g/never-ever/",
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
    id: "I",
    slug: "wormy-worm",
    title: "Wormy Worm",
    description: "Settle arguments. Let the worms decide.",
    shortRules: "Set a penalty. Draw worms. Most worms wins. Loser serves the penalty.",
    heroImage: "/assets/wormy-worm-logo.png",
    theme: "default",
    minPlayers: 2,
    maxPlayers: 18,
    playTime: "5 - 10 mins",
    ageGuide: "Ages 12+",
    joinPrefix: "I",
    route: "/g/wormy-worm/",
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
    id: "H",
    slug: "most-likely",
    title: "Most Likely",
    description: "Who is most likely to? Set the record straight.",
    shortRules: "Two players face off & vote who is most likely to... the group decides if they agree.",
    heroImage: "/assets/most-likely-logo.png",
    theme: "default",
    minPlayers: 3,
    maxPlayers: 18,
    playTime: "5 - 15 mins",
    ageGuide: "Ages 17+",
    joinPrefix: "H",
    route: "/g/most-likely/",
    enabled: true
  },
  {
    id: "F",
    slug: "fake-famous",
    title: "Fake Famous",
    description: "Guess if a players quote is real, then guess who said it based on their impression.",
    shortRules: "One player reads the quote. Everyone else votes real/fake and then guesses who said it based on an impression. Most points wins.",
    heroImage: "/assets/fake-famous-logo.png",
    theme: "default",
    minPlayers: 2,
    maxPlayers: 18,
    playTime: "10 - 20 mins",
    ageGuide: "Ages 10+",
    joinPrefix: "F",
    route: "/g/fake-famous/",
    enabled: true
  },
    {
    id: "E",
    slug: "lying-llama",
    title: "Lying Llama",
    description: "Bluff, spot Charlatans, and win cards with mini challenge battles.",
    shortRules: "Ask the next player if they are a Llama 🦙, Frog 🐸, or Gorilla 🦍. Catch Charlatans, survive penalties, and collect the most cards.",
    heroImage: "/assets/lying-llama-logo.png",
    theme: "default",
    minPlayers: 2,
    maxPlayers: 18,
    playTime: "5 - 15 mins",
    ageGuide: "Ages 6+",
    joinPrefix: "E",
    route: "/g/lying-llama/",
    enabled: true
  }
];

export function getGameBySlug(slug: string): GameConfig | undefined {
  const normalized =
    slug === "celebrities"
      ? "popular-people"
      : slug === "fruit-bowel"
        ? "fruit-bowl"
        : slug === "draw-things"
          ? "draw-wf"
          : slug === "theme-word"
            ? "theme-words"
            : slug === "oneaway"
              ? "one-away"
          : slug === "orderme"
                ? "order-me"
          : slug;
  return GAMES.find((game) => game.slug === normalized && game.enabled);
}
