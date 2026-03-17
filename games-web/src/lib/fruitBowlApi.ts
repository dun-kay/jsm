import { getSupabaseClient } from "./supabase";

export type FruitBowlPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  teamNo: number | null;
  teamOrder: number | null;
};

export type FruitBowlTeamMember = {
  id: string;
  name: string;
};

export type FruitBowlState = {
  phase: "rules" | "input" | "teams" | "round_intro" | "turn_ready" | "turn_live" | "turn_summary" | "round_results" | "result";
  roundNumber: number;
  waitingOn: string[];
  yourSubmitted: boolean;
  teamAScore: number;
  teamBScore: number;
  activeTeam: number;
  activeCluegiverId: string | null;
  turnEndsAt: string | null;
  currentPrompt: string | null;
  promptsRemaining: number;
  lastTurnPoints: number;
  lastTurnTeam: number | null;
  players: FruitBowlPlayer[];
  teamA: FruitBowlTeamMember[];
  teamB: FruitBowlTeamMember[];
  you: {
    id: string;
    name: string;
    isHost: boolean;
    teamNo: number | null;
    teamOrder: number | null;
  };
  lastError: string | null;
};

function mapState(data: unknown): FruitBowlState {
  const raw = data as Record<string, unknown>;
  return {
    phase: (raw.phase as FruitBowlState["phase"]) ?? "rules",
    roundNumber: Number(raw.roundNumber ?? 1),
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    yourSubmitted: Boolean(raw.yourSubmitted),
    teamAScore: Number(raw.teamAScore ?? 0),
    teamBScore: Number(raw.teamBScore ?? 0),
    activeTeam: Number(raw.activeTeam ?? 1),
    activeCluegiverId: (raw.activeCluegiverId as string | null) ?? null,
    turnEndsAt: (raw.turnEndsAt as string | null) ?? null,
    currentPrompt: (raw.currentPrompt as string | null) ?? null,
    promptsRemaining: Number(raw.promptsRemaining ?? 0),
    lastTurnPoints: Number(raw.lastTurnPoints ?? 0),
    lastTurnTeam: (raw.lastTurnTeam as number | null) ?? null,
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((player) => ({
      id: String(player.id ?? ""),
      name: String(player.name ?? ""),
      isHost: Boolean(player.isHost),
      teamNo: player.teamNo === null || player.teamNo === undefined ? null : Number(player.teamNo),
      teamOrder: player.teamOrder === null || player.teamOrder === undefined ? null : Number(player.teamOrder)
    })),
    teamA: ((raw.teamA as Array<Record<string, unknown>>) || []).map((member) => ({
      id: String(member.id ?? ""),
      name: String(member.name ?? "")
    })),
    teamB: ((raw.teamB as Array<Record<string, unknown>>) || []).map((member) => ({
      id: String(member.id ?? ""),
      name: String(member.name ?? "")
    })),
    you: {
      id: String((raw.you as Record<string, unknown>)?.id ?? ""),
      name: String((raw.you as Record<string, unknown>)?.name ?? ""),
      isHost: Boolean((raw.you as Record<string, unknown>)?.isHost),
      teamNo:
        (raw.you as Record<string, unknown>)?.teamNo === null || (raw.you as Record<string, unknown>)?.teamNo === undefined
          ? null
          : Number((raw.you as Record<string, unknown>)?.teamNo),
      teamOrder:
        (raw.you as Record<string, unknown>)?.teamOrder === null ||
        (raw.you as Record<string, unknown>)?.teamOrder === undefined
          ? null
          : Number((raw.you as Record<string, unknown>)?.teamOrder)
    },
    lastError: (raw.lastError as string | null) ?? null
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<FruitBowlState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Fruit Bowl request failed.");
  }
  return mapState(data);
}

export function initFruitBowl(gameCode: string, playerToken: string): Promise<FruitBowlState> {
  return rpcState("fb_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function getFruitBowlState(gameCode: string, playerToken: string): Promise<FruitBowlState> {
  return rpcState("fb_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueFruitBowl(gameCode: string, playerToken: string): Promise<FruitBowlState> {
  return rpcState("fb_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function submitFruitBowlPrompts(
  gameCode: string,
  playerToken: string,
  promptOne: string,
  promptTwo: string
): Promise<FruitBowlState> {
  return rpcState("fb_submit_prompts", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_prompt_one: promptOne,
    p_prompt_two: promptTwo
  });
}

export function markFruitBowlPrompt(
  gameCode: string,
  playerToken: string,
  action: "correct" | "skip"
): Promise<FruitBowlState> {
  return rpcState("fb_mark_prompt", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_action: action
  });
}

export function playAgainFruitBowl(gameCode: string, playerToken: string): Promise<FruitBowlState> {
  return rpcState("fb_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}
