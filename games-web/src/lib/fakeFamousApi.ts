import { getSupabaseClient } from "./supabase";

export type FakeFamousQuote = {
  id: string;
  quoteText: string;
  isReal: boolean;
  correctSpeaker: string;
  speakerOptions: string[];
  impressionTip: string;
};

export type FakeFamousPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  turnOrder: number;
  score: number;
};

export type FakeFamousState = {
  phase:
    | "rules"
    | "round_intro"
    | "quote_reveal"
    | "truth_vote"
    | "truth_result"
    | "impression"
    | "speaker_vote"
    | "turn_result"
    | "round_result"
    | "result";
  roundNumber: number;
  turnIndex: number;
  activePlayerId: string | null;
  players: FakeFamousPlayer[];
  scores: Record<string, number>;
  currentCard: FakeFamousQuote | null;
  truthVotes: Record<string, "real" | "fake">;
  speakerVotes: Record<string, string>;
  truthWinners: string[];
  speakerWinners: string[];
  waitingOn: string[];
  winnerIds: string[];
  lastError: string | null;
  you: {
    id: string;
    name: string;
    isHost: boolean;
    score: number;
  };
};

function mapState(data: unknown): FakeFamousState {
  const raw = data as Record<string, unknown>;
  const currentCardRaw = (raw.currentCard as Record<string, unknown>) || {};
  const hasCard = Object.keys(currentCardRaw).length > 0;

  const truthVotesRaw = (raw.truthVotes as Record<string, unknown>) || {};
  const truthVotes: Record<string, "real" | "fake"> = {};
  for (const [key, value] of Object.entries(truthVotesRaw)) {
    const vote = String(value || "").toLowerCase();
    if (vote === "real" || vote === "fake") {
      truthVotes[key] = vote;
    }
  }

  return {
    phase: (raw.phase as FakeFamousState["phase"]) ?? "rules",
    roundNumber: Number(raw.roundNumber ?? 1),
    turnIndex: Number(raw.turnIndex ?? 0),
    activePlayerId: (raw.activePlayerId as string | null) ?? null,
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((p) => ({
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      isHost: Boolean(p.isHost),
      turnOrder: Number(p.turnOrder ?? 0),
      score: Number(p.score ?? 0)
    })),
    scores: (raw.scores as Record<string, number>) || {},
    currentCard: hasCard
      ? {
          id: String(currentCardRaw.id ?? ""),
          quoteText: String(currentCardRaw.quoteText ?? ""),
          isReal: Boolean(currentCardRaw.isReal),
          correctSpeaker: String(currentCardRaw.correctSpeaker ?? ""),
          speakerOptions: ((currentCardRaw.speakerOptions as string[]) || []).map(String),
          impressionTip: String(currentCardRaw.impressionTip ?? "")
        }
      : null,
    truthVotes,
    speakerVotes: (raw.speakerVotes as Record<string, string>) || {},
    truthWinners: ((raw.truthWinners as string[]) || []).map(String),
    speakerWinners: ((raw.speakerWinners as string[]) || []).map(String),
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    winnerIds: ((raw.winnerIds as string[]) || []).map(String),
    lastError: (raw.lastError as string | null) ?? null,
    you: {
      id: String((raw.you as Record<string, unknown> | undefined)?.id ?? ""),
      name: String((raw.you as Record<string, unknown> | undefined)?.name ?? ""),
      isHost: Boolean((raw.you as Record<string, unknown> | undefined)?.isHost),
      score: Number((raw.you as Record<string, unknown> | undefined)?.score ?? 0)
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<FakeFamousState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Fake Famous request failed.");
  }
  return mapState(data);
}

export function initFakeFamous(gameCode: string, playerToken: string, quotes: FakeFamousQuote[] | null): Promise<FakeFamousState> {
  return rpcState("rd_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_quotes: quotes
  });
}

export function getFakeFamousState(gameCode: string, playerToken: string): Promise<FakeFamousState> {
  return rpcState("rd_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueFakeFamous(gameCode: string, playerToken: string): Promise<FakeFamousState> {
  return rpcState("rd_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function submitFakeFamousTruthVote(
  gameCode: string,
  playerToken: string,
  choice: "real" | "fake"
): Promise<FakeFamousState> {
  return rpcState("rd_submit_truth_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_choice: choice
  });
}

export function submitFakeFamousSpeakerVote(
  gameCode: string,
  playerToken: string,
  speaker: string
): Promise<FakeFamousState> {
  return rpcState("rd_submit_speaker_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_speaker: speaker
  });
}

export function playAgainFakeFamous(
  gameCode: string,
  playerToken: string,
  quotes: FakeFamousQuote[] | null
): Promise<FakeFamousState> {
  return rpcState("rd_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_quotes: quotes
  });
}
