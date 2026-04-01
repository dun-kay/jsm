import { getSupabaseClient } from "./supabase";

export type WormyWormPhase =
  | "rules"
  | "penalty_mode"
  | "penalty_custom"
  | "penalty_ready"
  | "draw_reveal"
  | "draw_result"
  | "result";

export type WormyPenaltyMode = "auto" | "own";

export type WormyWormPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  turnOrder: number;
  wormsTotal: number;
  draws: number[];
};

export type WormyWormState = {
  phase: WormyWormPhase;
  roundNumber: number;
  turnIndex: number;
  currentDrawerId: string | null;
  currentDrawCount: number | null;
  penaltyMode: WormyPenaltyMode | null;
  penaltyText: string | null;
  scores: Record<string, number>;
  waitingOn: string[];
  players: WormyWormPlayer[];
  lastError: string | null;
  you: {
    id: string;
    name: string;
    isHost: boolean;
    wormsTotal: number;
  };
};

function mapState(data: unknown): WormyWormState {
  const raw = data as Record<string, unknown>;
  return {
    phase: (raw.phase as WormyWormPhase) ?? "rules",
    roundNumber: Number(raw.roundNumber ?? 1),
    turnIndex: Number(raw.turnIndex ?? 0),
    currentDrawerId: (raw.currentDrawerId as string | null) ?? null,
    currentDrawCount: raw.currentDrawCount == null ? null : Number(raw.currentDrawCount),
    penaltyMode: (raw.penaltyMode as WormyPenaltyMode | null) ?? null,
    penaltyText: (raw.penaltyText as string | null) ?? null,
    scores: (raw.scores as Record<string, number>) || {},
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((p) => ({
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      isHost: Boolean(p.isHost),
      turnOrder: Number(p.turnOrder ?? 0),
      wormsTotal: Number(p.wormsTotal ?? 0),
      draws: Array.isArray(p.draws) ? p.draws.map((v) => Number(v)) : []
    })),
    lastError: (raw.lastError as string | null) ?? null,
    you: {
      id: String((raw.you as Record<string, unknown> | undefined)?.id ?? ""),
      name: String((raw.you as Record<string, unknown> | undefined)?.name ?? ""),
      isHost: Boolean((raw.you as Record<string, unknown> | undefined)?.isHost),
      wormsTotal: Number((raw.you as Record<string, unknown> | undefined)?.wormsTotal ?? 0)
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<WormyWormState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Wormy Worm request failed.");
  }
  return mapState(data);
}

export function initWormyWorm(gameCode: string, playerToken: string, penaltyPool: unknown): Promise<WormyWormState> {
  return rpcState("ww_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_auto_penalties: penaltyPool
  });
}

export function getWormyWormState(gameCode: string, playerToken: string): Promise<WormyWormState> {
  return rpcState("ww_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueWormyWorm(gameCode: string, playerToken: string): Promise<WormyWormState> {
  return rpcState("ww_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function setWormyPenaltyMode(
  gameCode: string,
  playerToken: string,
  mode: WormyPenaltyMode
): Promise<WormyWormState> {
  return rpcState("ww_set_penalty_mode", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_mode: mode
  });
}

export function setWormyCustomPenalty(
  gameCode: string,
  playerToken: string,
  penaltyText: string
): Promise<WormyWormState> {
  return rpcState("ww_set_custom_penalty", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_penalty_text: penaltyText
  });
}

export function rerollWormyPenalty(gameCode: string, playerToken: string): Promise<WormyWormState> {
  return rpcState("ww_reroll_penalty", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function playAgainWormyWorm(gameCode: string, playerToken: string, penaltyPool: unknown): Promise<WormyWormState> {
  return rpcState("ww_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_auto_penalties: penaltyPool
  });
}

