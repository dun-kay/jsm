import { getSupabaseClient } from "./supabase";

export type NeverEverPhase = "rules" | "card_reveal" | "vote" | "callout" | "result";
export type NeverEverChoice = "Again" | "Never again" | "Maybe?" | "Never ever";

export type NeverEverPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  turnOrder: number;
  calloutCount: number;
};

export type NeverEverState = {
  phase: NeverEverPhase;
  roundNumber: number;
  turnIndex: number;
  selectedCategory: string | null;
  currentReaderId: string | null;
  currentCard: string | null;
  votes: Record<string, NeverEverChoice>;
  calledOut: string[];
  calledOutOption: NeverEverChoice | null;
  calloutCounts: Record<string, number>;
  waitingOn: string[];
  players: NeverEverPlayer[];
  lastError: string | null;
  you: {
    id: string;
    name: string;
    isHost: boolean;
    calloutCount: number;
  };
};

function mapState(data: unknown): NeverEverState {
  const raw = data as Record<string, unknown>;
  return {
    phase: (raw.phase as NeverEverPhase) ?? "rules",
    roundNumber: Number(raw.roundNumber ?? 1),
    turnIndex: Number(raw.turnIndex ?? 0),
    selectedCategory: (raw.selectedCategory as string | null) ?? null,
    currentReaderId: (raw.currentReaderId as string | null) ?? null,
    currentCard: (raw.currentCard as string | null) ?? null,
    votes: (raw.votes as Record<string, NeverEverChoice>) || {},
    calledOut: ((raw.calledOut as string[]) || []).map(String),
    calledOutOption: (raw.calledOutOption as NeverEverChoice | null) ?? null,
    calloutCounts: (raw.calloutCounts as Record<string, number>) || {},
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((p) => ({
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      isHost: Boolean(p.isHost),
      turnOrder: Number(p.turnOrder ?? 0),
      calloutCount: Number(p.calloutCount ?? 0)
    })),
    lastError: (raw.lastError as string | null) ?? null,
    you: {
      id: String((raw.you as Record<string, unknown> | undefined)?.id ?? ""),
      name: String((raw.you as Record<string, unknown> | undefined)?.name ?? ""),
      isHost: Boolean((raw.you as Record<string, unknown> | undefined)?.isHost),
      calloutCount: Number((raw.you as Record<string, unknown> | undefined)?.calloutCount ?? 0)
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<NeverEverState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Never Ever request failed.");
  }
  return mapState(data);
}

export function initNeverEver(gameCode: string, playerToken: string, cardPool: unknown): Promise<NeverEverState> {
  return rpcState("ne_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_card_pool: cardPool
  });
}

export function getNeverEverState(gameCode: string, playerToken: string): Promise<NeverEverState> {
  return rpcState("ne_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueNeverEver(gameCode: string, playerToken: string): Promise<NeverEverState> {
  return rpcState("ne_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function submitNeverEverVote(
  gameCode: string,
  playerToken: string,
  choice: NeverEverChoice
): Promise<NeverEverState> {
  return rpcState("ne_submit_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_choice: choice
  });
}

export function playAgainNeverEver(gameCode: string, playerToken: string, cardPool: unknown): Promise<NeverEverState> {
  return rpcState("ne_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_card_pool: cardPool
  });
}
