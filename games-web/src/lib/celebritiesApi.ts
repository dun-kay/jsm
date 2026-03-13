import { getSupabaseClient } from "./supabase";

export type CelebPlayer = {
  id: string;
  name: string;
  leaderId: string;
  celebrityName: string | null;
};

export type CelebritiesState = {
  phase: "rules" | "input" | "reveal" | "guess_pick" | "guess_input" | "guess_confirm" | "result";
  revealRound: number;
  revealEndsAt: string | null;
  currentAskerId: string | null;
  currentTargetId: string | null;
  currentGuess: string | null;
  askerConfirm: boolean | null;
  targetConfirm: boolean | null;
  lastError: string | null;
  showCelebrityList: boolean;
  celebrityList: string[];
  players: CelebPlayer[];
  teamLeaders: string[];
  you: {
    id: string;
    name: string;
    isHost: boolean;
    leaderId: string;
  };
};

function mapState(data: unknown): CelebritiesState {
  const raw = data as Record<string, unknown>;
  return {
    phase: (raw.phase as CelebritiesState["phase"]) ?? "rules",
    revealRound: Number(raw.revealRound ?? 0),
    revealEndsAt: (raw.revealEndsAt as string | null) ?? null,
    currentAskerId: (raw.currentAskerId as string | null) ?? null,
    currentTargetId: (raw.currentTargetId as string | null) ?? null,
    currentGuess: (raw.currentGuess as string | null) ?? null,
    askerConfirm: (raw.askerConfirm as boolean | null) ?? null,
    targetConfirm: (raw.targetConfirm as boolean | null) ?? null,
    lastError: (raw.lastError as string | null) ?? null,
    showCelebrityList: Boolean(raw.showCelebrityList),
    celebrityList: ((raw.celebrityList as string[]) || []).map(String),
    players: ((raw.players as Array<{ id: string; name: string; leaderId: string; celebrityName: string | null }>) || []).map((p) => ({
      id: String(p.id),
      name: String(p.name),
      leaderId: String(p.leaderId),
      celebrityName: p.celebrityName ? String(p.celebrityName) : null
    })),
    teamLeaders: ((raw.teamLeaders as string[]) || []).map(String),
    you: {
      id: String((raw.you as { id: string })?.id ?? ""),
      name: String((raw.you as { name: string })?.name ?? ""),
      isHost: Boolean((raw.you as { isHost: boolean })?.isHost),
      leaderId: String((raw.you as { leaderId: string })?.leaderId ?? "")
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<CelebritiesState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Celebrities request failed.");
  }
  return mapState(data);
}

export function initCelebrities(gameCode: string, playerToken: string): Promise<CelebritiesState> {
  return rpcState("cc_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function getCelebritiesState(gameCode: string, playerToken: string): Promise<CelebritiesState> {
  return rpcState("cc_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueCelebrities(gameCode: string, playerToken: string): Promise<CelebritiesState> {
  return rpcState("cc_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function submitCelebrities(
  gameCode: string,
  playerToken: string,
  celebOne: string,
  celebTwo: string
): Promise<CelebritiesState> {
  return rpcState("cc_submit_celebrities", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_celebrity_one: celebOne,
    p_celebrity_two: celebTwo
  });
}

export function pickCelebTarget(gameCode: string, playerToken: string, targetPlayerId: string): Promise<CelebritiesState> {
  return rpcState("cc_pick_target", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_target_player_id: targetPlayerId
  });
}

export function submitCelebGuess(gameCode: string, playerToken: string, guess: string): Promise<CelebritiesState> {
  return rpcState("cc_submit_guess", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_guess: guess
  });
}

export function confirmCelebGuess(gameCode: string, playerToken: string, isCorrect: boolean): Promise<CelebritiesState> {
  return rpcState("cc_confirm_guess", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_is_correct: isCorrect
  });
}

