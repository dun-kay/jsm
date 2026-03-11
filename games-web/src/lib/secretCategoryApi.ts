import { getSupabaseClient } from "./supabase";

export type SecretCategoryPlayer = {
  id: string;
  name: string;
};

export type SecretCategoryState = {
  roundNo: number;
  phase: "rules" | "role_reveal" | "turn_clues" | "discussion" | "vote" | "spy_guess" | "result";
  mainCategory: string;
  secretCategory: string | null;
  isSpy: boolean;
  spyPlayerId: string;
  secretOptions: string[];
  players: SecretCategoryPlayer[];
  waitingOn: string[];
  turnOrder: string[];
  turnIndex: number;
  currentTurnPlayerId: string | null;
  voteAttempt: number;
  votes: Record<string, string>;
  roundResult: "pending" | "spy_found" | "spy_not_found" | "spy_guessed_correct" | "spy_guessed_wrong";
  you: {
    id: string;
    name: string;
    isHost: boolean;
  };
};

function mapState(data: unknown): SecretCategoryState {
  const raw = data as Record<string, unknown>;
  return {
    roundNo: Number(raw.roundNo ?? 1),
    phase: (raw.phase as SecretCategoryState["phase"]) ?? "rules",
    mainCategory: String(raw.mainCategory ?? ""),
    secretCategory: (raw.secretCategory as string | null) ?? null,
    isSpy: Boolean(raw.isSpy),
    spyPlayerId: String(raw.spyPlayerId ?? ""),
    secretOptions: ((raw.secretOptions as string[]) || []).map(String),
    players: ((raw.players as Array<{ id: string; name: string }>) || []).map((p) => ({
      id: String(p.id),
      name: String(p.name)
    })),
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    turnOrder: ((raw.turnOrder as string[]) || []).map(String),
    turnIndex: Number(raw.turnIndex ?? 0),
    currentTurnPlayerId: (raw.currentTurnPlayerId as string | null) ?? null,
    voteAttempt: Number(raw.voteAttempt ?? 1),
    votes: (raw.votes as Record<string, string>) || {},
    roundResult: (raw.roundResult as SecretCategoryState["roundResult"]) ?? "pending",
    you: {
      id: String((raw.you as { id: string })?.id ?? ""),
      name: String((raw.you as { name: string })?.name ?? ""),
      isHost: Boolean((raw.you as { isHost: boolean })?.isHost)
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<SecretCategoryState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Secret Categories request failed.");
  }
  return mapState(data);
}

export function initSecretCategory(gameCode: string, playerToken: string): Promise<SecretCategoryState> {
  return rpcState("sc_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function getSecretCategoryState(gameCode: string, playerToken: string): Promise<SecretCategoryState> {
  return rpcState("sc_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueSecretCategory(gameCode: string, playerToken: string): Promise<SecretCategoryState> {
  return rpcState("sc_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function submitSecretCategoryVote(
  gameCode: string,
  playerToken: string,
  targetPlayerId: string
): Promise<SecretCategoryState> {
  return rpcState("sc_submit_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_target_player_id: targetPlayerId
  });
}

export function submitSpyGuess(
  gameCode: string,
  playerToken: string,
  guess: string
): Promise<SecretCategoryState> {
  return rpcState("sc_spy_guess", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_guess: guess
  });
}

export function nextSecretCategoryRound(gameCode: string, playerToken: string): Promise<SecretCategoryState> {
  return rpcState("sc_next_round", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function rerollSecretCategory(gameCode: string, playerToken: string): Promise<SecretCategoryState> {
  return rpcState("sc_reroll_category", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}
