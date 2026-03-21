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
        <p>If the Category is Car Brands and the Secret is Ferrari, <b>Fast is a better clue than Horse</b>.</p>
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
        <p>The players are then split into two teams. <b>Team Mango 🥭 & Team Peach 🍑.</b></p>
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
        <p><b>Some players are Murderers.</b> Everyone else is an Investigator.</p>
        <p>Murderers try to block evidence. Investigators try to submit evidence.</p>
        <br />
        <p><b>Each round has 5 steps:</b></p>
        <p>1. A fresh piece of evidence is revealed.</p>
        <p>2. Everyone votes on one suspect.</p>
        <p>3. The suspect is under suspicion and can't speak or vote on evidence.</p>
        <p>4. Remaining players vote to <b>Admit</b> or <b>Reject</b> evidence using dealt cards.</p>
        <p>5. The result is revealed and scores update.</p>
        <br />
        <p><b>Why place suspicion?</b> You might block a strong speaker, remove a likely liar, or sideline someone you don't trust.</p>
        <p>Suspect votes are public. Evidence votes are shown after the round.</p>
        <p>If there is a tie, you discuss quickly and vote again.</p>
        <br />
        <p><b>Evidence cards are randomly dealt each round.</b> You might get Reject + Reject, Admit + Reject, or Admit + Admit.</p>
        <p>So when players explain their vote, they might be truthful... or bluffing.</p>
        <br />
        <p><b>Win condition:</b></p>
        <p>Investigators win at 3 evidence submits.</p>
        <p>Murderers win at 3 evidence blocks.</p>
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
