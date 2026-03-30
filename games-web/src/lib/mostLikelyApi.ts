import { getSupabaseClient } from "./supabase";

export type MostLikelyPhase = "rules" | "card_reveal" | "pair_vote" | "group_vote" | "turn_result" | "result";
export type MostLikelyPairChoice = "me" | "them";
export type MostLikelyGroupMode = "consensus" | "split";

export type MostLikelyPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  turnOrder: number;
  penaltyCount: number;
};

export type MostLikelyState = {
  phase: MostLikelyPhase;
  turnIndex: number;
  roundNumber: number;
  currentCard: string | null;
  currentReaderId: string | null;
  pairPlayerAId: string | null;
  pairPlayerBId: string | null;
  pairVotes: Record<string, string>;
  groupVotes: Record<string, string>;
  groupMode: MostLikelyGroupMode | null;
  proposedWinnerId: string | null;
  winnerIds: string[];
  waitingOn: string[];
  penaltyCounts: Record<string, number>;
  players: MostLikelyPlayer[];
  lastError: string | null;
  you: {
    id: string;
    name: string;
    isHost: boolean;
    penaltyCount: number;
  };
};

function mapState(data: unknown): MostLikelyState {
  const raw = data as Record<string, unknown>;
  return {
    phase: (raw.phase as MostLikelyPhase) ?? "rules",
    turnIndex: Number(raw.turnIndex ?? 0),
    roundNumber: Number(raw.roundNumber ?? 1),
    currentCard: (raw.currentCard as string | null) ?? null,
    currentReaderId: (raw.currentReaderId as string | null) ?? null,
    pairPlayerAId: (raw.pairPlayerAId as string | null) ?? null,
    pairPlayerBId: (raw.pairPlayerBId as string | null) ?? null,
    pairVotes: (raw.pairVotes as Record<string, string>) || {},
    groupVotes: (raw.groupVotes as Record<string, string>) || {},
    groupMode: (raw.groupMode as MostLikelyGroupMode | null) ?? null,
    proposedWinnerId: (raw.proposedWinnerId as string | null) ?? null,
    winnerIds: ((raw.winnerIds as string[]) || []).map(String),
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    penaltyCounts: (raw.penaltyCounts as Record<string, number>) || {},
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((p) => ({
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      isHost: Boolean(p.isHost),
      turnOrder: Number(p.turnOrder ?? 0),
      penaltyCount: Number(p.penaltyCount ?? 0)
    })),
    lastError: (raw.lastError as string | null) ?? null,
    you: {
      id: String((raw.you as Record<string, unknown> | undefined)?.id ?? ""),
      name: String((raw.you as Record<string, unknown> | undefined)?.name ?? ""),
      isHost: Boolean((raw.you as Record<string, unknown> | undefined)?.isHost),
      penaltyCount: Number((raw.you as Record<string, unknown> | undefined)?.penaltyCount ?? 0)
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<MostLikelyState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Most Likely request failed.");
  }
  return mapState(data);
}

export function initMostLikely(gameCode: string, playerToken: string, cardPool: unknown): Promise<MostLikelyState> {
  return rpcState("ml_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_card_pool: cardPool
  });
}

export function getMostLikelyState(gameCode: string, playerToken: string): Promise<MostLikelyState> {
  return rpcState("ml_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueMostLikely(gameCode: string, playerToken: string): Promise<MostLikelyState> {
  return rpcState("ml_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function submitMostLikelyPairVote(
  gameCode: string,
  playerToken: string,
  choice: MostLikelyPairChoice
): Promise<MostLikelyState> {
  return rpcState("ml_submit_pair_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_choice: choice
  });
}

export function submitMostLikelyGroupVote(
  gameCode: string,
  playerToken: string,
  choice: string
): Promise<MostLikelyState> {
  return rpcState("ml_submit_group_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_choice: choice
  });
}

export function playAgainMostLikely(gameCode: string, playerToken: string, cardPool: unknown): Promise<MostLikelyState> {
  return rpcState("ml_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_card_pool: cardPool
  });
}

