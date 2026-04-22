export type MurderClubTheme = {
  id: string;
  title: string;
  openingScene: string;
  evidences: string[];
};

export const MURDER_CLUB_THEMES: MurderClubTheme[] = [
  {
    id: "holiday-case",
    title: "The holiday case",
    openingScene:
      "A group of friends are staying in a small ski town in France. One of them has been found, unresponsive. Nobody knows who did it.",
    evidences: [
      "A kitchen knife was found stashed behind a curtain. There are no fingerprints.",
      "Security cameras were switched off exactly 7 minutes before the incident.",
      "A torn train ticket was found in the victim's coat pocket.",
      "Room service delivered two glasses to a single-occupancy room.",
      "The victim's phone was wiped remotely 30 seconds after death."
    ]
  },
  {
    id: "coastal-town",
    title: "The coastal town case",
    openingScene:
      "The disappearance of the town Mayor rocks a small coastal village on festival night. The streets are full, the stories conflict, and everyone has an alibi.",
    evidences: [
      "Sea-salt footprints stop halfway down the pier, then vanish.",
      "A voicemail was deleted at 11:47 PM from the Mayor's phone.",
      "The harbor clock was manually set forward by 9 minutes.",
      "A torn scarf was found folded inside a lifeboat.",
      "Two witnesses gave opposite stories about who left first."
    ]
  },
  {
    id: "museum-heist",
    title: "The museum case",
    openingScene:
      "A private museum gala turns into a major investigation after the lights cut out. One guest is missing, and the exits were locked from inside.",
    evidences: [
      "A shattered display case has no glass near the body.",
      "A staff keycard was used from two places at once.",
      "There is fresh paint on the victim's shirt.",
      "A handwritten floor map was hidden behind the bar.",
      "The backup generator was disabled with a missing fuse."
    ]
  },
  {
    id: "desert-motel",
    title: "The desert motel case",
    openingScene:
      "A highway dust storm strands strangers at a desert motel. By sunrise, one guest is missing and no one can agree on what happened.",
    evidences: [
      "A motel key was found inside the victim's shoe.",
      "The neon sign was cut moments before a scream was heard.",
      "A muddy wrench was left in a locked laundry room.",
      "The ice machine log shows use at 3:12 AM.",
      "A burner phone rang once from the roof and went silent."
    ]
  }
];

export function getMurderClubThemeById(themeId: string): MurderClubTheme {
  return (
    MURDER_CLUB_THEMES.find((theme) => theme.id === themeId) ??
    MURDER_CLUB_THEMES[0]
  );
}

export function getRandomMurderClubThemeId(excludeThemeId?: string): string {
  const pool = MURDER_CLUB_THEMES.filter((theme) => theme.id !== excludeThemeId);
  if (pool.length === 0) {
    return MURDER_CLUB_THEMES[0].id;
  }
  const index = Math.floor(Math.random() * pool.length);
  return pool[index].id;
}

