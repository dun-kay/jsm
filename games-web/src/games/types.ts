export type GameConfig = {
  id: string;
  slug: string;
  title: string;
  description: string;
  shortRules: string;
  heroImage: string;
  theme: string;
  minPlayers: number;
  maxPlayers: number;
  playTime: string;
  ageGuide: string;
  joinPrefix?: string;
  route: string;
  enabled: boolean;
};

export type GameSessionContext = {
  gameCode: string;
  gameSlug: string;
  hostSecret: string;
  playerToken: string;
};
