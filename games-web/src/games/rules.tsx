import type { ReactNode } from "react";

type GameIntroRules = {
  title: string;
  content: ReactNode;
};

const RULES_BY_SLUG: Record<string, GameIntroRules> = {
  "secret-words": {
    title: "You are about to play... Secret Words",
    content: (
      <>
        <p>This is a <b>daily single-player game.</b></p>
        <br />
        <p>Swipe through the letters to make words.</p>
        <p>When you release, your guess submits.</p>
        <br />
        <p>Every valid guess is ranked by closeness.</p>
        <p><b>#1 is the secret word.</b></p>
        <br />
        <p>Use the day slider to play older puzzles.</p>
        <p>Progress is saved locally on your device.</p>
      </>
    )
  },
  "theme-words": {
    title: "You are about to play... Theme Words",
    content: (
      <>
        <p>This is a <b>daily single-player game.</b></p>
        <br />
        <p>Swipe through the letters to make words.</p>
        <p>When you release, your guess submits.</p>
        <br />
        <p>Find all words listed for the day's letter theme.</p>
        <p><b>Each found word fills the puzzle grid.</b></p>
        <br />
        <p>Use the day slider to play older puzzles.</p>
        <p>Progress is saved locally on your device.</p>
      </>
    )
  },
  "one-away": {
    title: "You are about to play... One Away",
    content: (
      <>
        <p>This is a daily single-player game.</p>
        <br />
       <p>You are shown 3 words from a list of four (words #2 - #4), ranked from most similar to least similar.</p>
              <br />
              <p>Guess the #1 word in 4 guesses.</p>
              <br />
              <p>Green letters are correct and lock in place.</p>
              <br />
              <p>Grey keyboard letters are not in the word.</p>
            
      </>
    )
  },
  "order-me": {
    title: "You are about to play... Order Me",
    content: (
      <>
        <p>This is a <b>daily single-player game.</b></p>
        <br />
        <p>You get one main word and <b>6 related words</b>.</p>
        <p>Drag them into order from <b>most similar to least similar</b>.</p>
        <br />
        <p>Each check uses one guess, and you have <b>4 guesses</b>.</p>
        <p>Green = exact position, Yellow = right row wrong position, Red = wrong row.</p>
        <p>Green locks in place. Red placements are blocked for that slot.</p>
      </>
    )
  },
  "draw-wf": {
    title: "You are about to play... Draw Things",
    content: (
      <>
        <p>One player draws. Everyone else guesses.</p>
        <br />
        <p><b>Draw time:</b> 20 seconds.</p>
        <p><b>Guess time:</b> 20 seconds.</p>
        <br />
        <p>Guessers can start replay when they press <b>Guess</b>.</p>
        <p>Wrong attempts do not submit. Correct guesses auto-submit.</p>
        <br />
        <p>If everyone gets it right, the room streak goes up.</p>
        <p>If one person misses or times out, the streak breaks.</p>
      </>
    )
  },
  "most-likely": {
    title: "You are about to play... Most Likely",
    content: (
      <>
        <p>The party game that <b>sets the record straight.</b></p>
        <br></br>
        <p>Two players face off by reading a spicy card,<p></p><b>who is most likely to...?</b></p>
        <br />
        <p><b>Make $1 million, get married, go broke, etc...</b></p>
        <br></br>
        <p>The rest of the group <b>validates the outcome.</b></p>
        <br />
        <p>If the pair can't agree, <b>the group picks.</b></p>
        <br />
        <p>Each round, <b>the winner serves a group penalty</b> (so pick one together now).</p>
      </>
    )
  },
  "never-ever": {
    title: "You are about to play... Never Ever",
    content: (
      <>
        <p>The party game that <b>reveals the real you & calls out your friends.</b></p>
        <br></br>
        <p>Each turn, one player reads a spicy card out, then everyone votes if they would do it: <b>Again, never again, maybe?, or never ever.</b></p>
        <br />
        <p>Vote truthfully, <b>the least voted for option gets called out...</b></p>
        <br></br>
        <p>You might <b>find out things about your friends you never knew</b> or didn't want to...</p>
        <br></br>
        <p>Like which of your friends would definitely <b>get back with their ex... again.</b></p>
      </>
    )
  },
  "wormy-worm": {
    title: "You are about to play... Wormy Worm ðŸª±ðŸª±ðŸª±",
    content: (
      <>
        <p>Settle arguments. <b>Let the worms decide.</b></p>
        <br />
        <p>To begin, <b>set a game penalty.</b></p>
        <br />
        <p>Each round, <b>every player draws a worm from the bucket ðŸª£</b>. Sometimes you get <b>more worms</b>, other times, <b>less worms</b>.</p>
        <br />
        <p>Most worms <b>over three rounds wins.</b></p>
        <p>Least worms, <b>loses.</b></p>
        <br />
        <p><b>Loser does the game penalty.</b></p>
      </>
    )
  },
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
    title: "You are abot to play... Popular People",
    content: (
      <>
        <p>Each player enters a <b>secret popular person.</b></p>
        <p>Pick someone recognisable, <b>a celebrity... character... athlete... public person.</b></p>
        <br />
        <p><b>All players get 30 seconds to study the list.</b> One player starts by guessing a person.</p>
        <br />
        <p>If they guess correctly, <b>that player is collected and joins the guesser's team.</b> The guesser asks again.</p>
        <p>If incorrect, <b>the asked player goes next.</b></p>
        <p>After the first guess, everyone gets 30 more seconds to review the list. <b>The list is then hidden for the remainder of the game.</b></p>
        <br />
        <p><b>The game ends when one team collects all the players.</b></p>
        <p>Collected players help with advice, but don't ask questions.</p>
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
        <p>The players are then split into two teams. <b>Team Mango ðŸ¥­ & Team Peach ðŸ‘.</b></p>
        <br />
        <p>Teams take turns describing, acting, or using a single word to try <b>help their team guess the prompts they pull from the bowl.</b></p>
        <br />
        <p>The game is split over three rounds. <b>Describe it, Act it out, & One word only.</b></p>
        <br />
        <p><b>Your team gets a point for a correct guess.</b> Each round is explained in detail as it happens.</p>
      </>
    )
  },
  "detective-club": {
    title: "You are about to play... Detective Club",
    content: (
      <>
        <p><b>A major case has just occrued & a detective has been called.</b><br />Half the players are involved, and the other half are trying to find the culprits.</p>
        <br />
        <p><b>Each round, a piece of evidence is found.</b></p>
        <p>Everyone votes on <b>one suspect</b>, someone they think is involved.</p>
        <p>The suspect <b>can't speak or vote</b> on evidence that round.</p>
        <p>Players are dealt two cards and vote to <b>Admit</b> or <b>Reject</b> the evidence.<br />
        Players may be dealt two of the same card, <b>or may be lying about it.</b></p>
        <br />
        <p><b>In general, Culprits want to reject & Detectives want to admit evidence.</b><br />
          But play carefully, or you'll be put under suspicion and blocked from voting...</p>
        <br />
        <p>Detecitves win at <b>3 evidence submits.</b></p>
        <p>Culprits win at <b>3 evidence blocks.</b></p>
        <p><p></p>It's similar to social deduction style games like Mafia or Werewolf.</p>
      </>
    )
  },
  "lying-llama": {
    title: "You are now playing... Lying Llama",
    content: (
      <>
        <p><b>Warning: this game is extremely weird.</b><p></p>It will take a few rounds to "get it", but I promise it's super fun & addictive.</p>
        <br></br>
        <p>The game is <b>meant to be played very fast.</b> So push your friends to play faster & faster...</p>
        <br />
        <p>Each player has 3 hidden animal cards: <b>Crazy Llama ðŸ¦™, Poison Dart Frog ðŸ¸, & Mountain Gorilla ðŸ¦</b>.</p>
        <p>One of those 3 cards is Charlatan-marked.</p>
        <br />
        <p>On your turn, ask the next player: <b>Are you a [Llama... Frog... or Gorilla...]?</b></p>
        <p>If your guess is correct, you collect their top card.</p>
        <p>If your guess is wrong, you must do an animal penalty.</p>
        <br />
        <p>If the target card is Charlatan, they must lie with a weird tell.</p>
        <p>You can call <b>Charlatan!</b> and battle for the card.</p>
        <br />
        <p>Most collected cards at the end wins.</p>
      </>
    )
  },
  "fake-famous": {
    title: "You are now playing... Fake Famous",
    content: (
      <>
        <p>One player reads out a famous "quote".<p></p><b>Sometimes it's real, sometimes it's fake.</b></p>
        <br />
        <p>Everyone votes if they think the quote is <b>real</b> or <b>fake</b>. The answer is then revealed.</p>
        <br />
        <p>If the quote was real, the reader <b>does an impression of the person who said it.</b></p>
        <br />
        <p>Everyone tries to guess who said the quote based on the impression.</p>
        <br />
        <p><b>+1 point</b> for guessing if it was real or fake.<b>+1 point</b> for guessing who said it.</p>
        <br />
        <p>Most points after 2 rounds wins.</p>
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

