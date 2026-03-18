import type { ReactNode } from "react";

type GameIntroRules = {
  title: string;
  content: ReactNode;
};

const RULES_BY_SLUG: Record<string, GameIntroRules> = {
  "secret-category": {
    title: "You are about to play... Secret Categories",
    content: (
      <>
        <p>The game starts by revealing the <b>Main Category</b> to everyone.</p>
        <p>The <b>Secret Category</b> is then revealed. One player does not see it. <b>They are the Spy</b>.</p>
        <br/>
        <p>The Spy must figure out the Secret Category. <b>Other players must figure out who the Spy is</b>.</p>
        <br />
        <p><b>Each round one player gives a one-word clue.</b> The clue should relate to the main category & the secret category (if you know what it is).</p>
        <br />
        <p>When the Spy gives a clue, they <b>try & sound like they know the secret</b>. Other players <b>try & show they know the secret</b> without saying it.</p>
        <br />
        <p>"If the Category is Car Brands and the Secret is Ferrari, <b>Fast</b> is a better clue than <b>Horse</b>."</p>
        <br />
        <p>Once everyone gives a clue, you discuss & vote to try find the Spy.</p>
      </>
    )
  },
  "popular-people": {
    title: "You are about to play... Popular People",
    content: (
      <>
        <p><b>Each player enters a popular person.</b> Don't reveal this to the other players.</p>
        <p>Pick someone most players would recognise, a <b>celebrity, character, athlete, or public person.</b></p>
        <br />
        <p><b>All players then get 30 seconds to study the list of popular people.</b> One player starts by guessing another player's popular person.</p>
        <br />
        <p>If they guess correctly, that player joins the guesser's team. <b>They are now collected by that player & they get to ask again.</b></p>
        <p>If they guess incorrectly, <b>the player who was asked guesses next.</b></p>
        <p>After the first guess, everyone gets 30 more seconds to review the list. <b>The list is then hidden for the remainder of the game.</b></p>
        <br />
        <p><b>The game ends when one team collects all the players by guessing their celebrities.</b></p>
        <p>Collected players can help with advice, but only non-collected players ask questions.</p>
      </>
    )
  },
  "fruit-bowl": {
    title: "You are about to play... Fruit Bowl",
    content: (
      <>
        <p>The game starts with <b>everyone adding 2 prompts</b> to the game.</p>
        <p>These prompts can be anything. A word, two words, a phrase... <b>make it fun & memorable.</b></p>
        <br />
        <p>The players are then split into two teams. <b>Team Eggplant 🍆 & Team Peach 🍑.</b></p>
        <br />
        <p>Teams take turns describing, acting, or using a single word to try <b>help their team guess the prompts they pull from the bowl.</b></p>
        <br />
        <p>The game is split over three rounds. <b>Describe it, Act it out, & One word only.</b></p>
        <br />
        <p><b>Your team gets a point for a correct guess.</b> Each round is explained in detail as it happens.</p>
      </>
    )
  },
  "murder-club": {
    title: "You are about to play... Murder Club",
    content: (
      <>
        <p>You've all been invited to a Coastal Town Murder Club...</p>
        <p>Hidden killers sabotage missions. Innocents try to stop them.</p>
        <p>Each round: leader picks a team, discussion, public team vote, secret mission vote.</p>
        <p>Mission succeeds with no murders. Mission fails with murders.</p>
        <p>First side to 3 wins.</p>
      </>
    )
  }
};

export function getGameIntroRules(slug: string): GameIntroRules {
  return (
    RULES_BY_SLUG[slug] ?? {
      title: "Game rules",
      content: <p>Rules coming soon.</p>
    }
  );
}
