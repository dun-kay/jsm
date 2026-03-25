import { getSupabaseClient } from "./supabase";

export type LyingLlamaPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  turnOrder: number;
  cardsRemaining: number;
  collectedCount: number;
  isOut: boolean;
};

export type LyingLlamaState = {
  phase:
    | "rules"
    | "turn_prompt"
    | "target_response"
    | "charlatan_call"
    | "charlatan_battle"
    | "charlatan_vote"
    | "penalty_prompt"
    | "penalty_confirm"
    | "turn_result"
    | "result";
  players: LyingLlamaPlayer[];
  scores: Array<{ playerId: string; name: string; collectedCount: number }>;
  winnerIds: string[];
  activeAskerId: string | null;
  activeTargetId: string | null;
  selectedAnimal: string | null;
  charlatanPrompt: string | null;
  battlePrompt: string | null;
  battleVotes: Record<string, string>;
  penaltyAnimal: string | null;
  penaltyText: string | null;
  waitingOn: string[];
  lastOutcomeType: string | null;
  lastOutcomeText: string | null;
  lastWinnerId: string | null;
  lastLoserId: string | null;
  lastCardWon: string | null;
  lastError: string | null;
  you: {
    id: string;
    name: string;
    isHost: boolean;
    stack: Array<{ animal: string; isCharlatan: boolean }>;
    cardsRemaining: number;
    collectedCount: number;
  };
};

function mapState(data: unknown): LyingLlamaState {
  const raw = data as Record<string, unknown>;
  const you = (raw.you as Record<string, unknown>) || {};
  return {
    phase: (raw.phase as LyingLlamaState["phase"]) ?? "rules",
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((p) => ({
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      isHost: Boolean(p.isHost),
      turnOrder: Number(p.turnOrder ?? 0),
      cardsRemaining: Number(p.cardsRemaining ?? 0),
      collectedCount: Number(p.collectedCount ?? 0),
      isOut: Boolean(p.isOut)
    })),
    scores: ((raw.scores as Array<Record<string, unknown>>) || []).map((s) => ({
      playerId: String(s.playerId ?? ""),
      name: String(s.name ?? ""),
      collectedCount: Number(s.collectedCount ?? 0)
    })),
    winnerIds: ((raw.winnerIds as string[]) || []).map(String),
    activeAskerId: (raw.activeAskerId as string | null) ?? null,
    activeTargetId: (raw.activeTargetId as string | null) ?? null,
    selectedAnimal: (raw.selectedAnimal as string | null) ?? null,
    charlatanPrompt: (raw.charlatanPrompt as string | null) ?? null,
    battlePrompt: (raw.battlePrompt as string | null) ?? null,
    battleVotes: (raw.battleVotes as Record<string, string>) || {},
    penaltyAnimal: (raw.penaltyAnimal as string | null) ?? null,
    penaltyText: (raw.penaltyText as string | null) ?? null,
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    lastOutcomeType: (raw.lastOutcomeType as string | null) ?? null,
    lastOutcomeText: (raw.lastOutcomeText as string | null) ?? null,
    lastWinnerId: (raw.lastWinnerId as string | null) ?? null,
    lastLoserId: (raw.lastLoserId as string | null) ?? null,
    lastCardWon: (raw.lastCardWon as string | null) ?? null,
    lastError: (raw.lastError as string | null) ?? null,
    you: {
      id: String(you.id ?? ""),
      name: String(you.name ?? ""),
      isHost: Boolean(you.isHost),
      stack: ((you.stack as Array<Record<string, unknown>>) || []).map((c) => ({
        animal: String(c.animal ?? ""),
        isCharlatan: Boolean(c.isCharlatan)
      })),
      cardsRemaining: Number(you.cardsRemaining ?? 0),
      collectedCount: Number(you.collectedCount ?? 0)
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<LyingLlamaState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Lying Llama request failed.");
  }
  return mapState(data);
}

export function initLyingLlama(gameCode: string, playerToken: string): Promise<LyingLlamaState> {
  return rpcState("ll_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function getLyingLlamaState(gameCode: string, playerToken: string): Promise<LyingLlamaState> {
  return rpcState("ll_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueLyingLlama(gameCode: string, playerToken: string): Promise<LyingLlamaState> {
  return rpcState("ll_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function pickLyingLlamaAnimal(gameCode: string, playerToken: string, animal: string): Promise<LyingLlamaState> {
  return rpcState("ll_pick_animal", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_animal: animal
  });
}

export function submitLyingLlamaTargetResponse(
  gameCode: string,
  playerToken: string,
  correctGuess: boolean,
  charlatanCalled: boolean | null = null
): Promise<LyingLlamaState> {
  return rpcState("ll_submit_target_response", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_correct_guess: correctGuess,
    p_charlatan_called: charlatanCalled
  });
}

export function decideCharlatan(gameCode: string, playerToken: string, callCharlatan: boolean): Promise<LyingLlamaState> {
  return rpcState("ll_charlatan_decision", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_call_charlatan: callCharlatan
  });
}

export function confirmLyingLlamaPenalty(gameCode: string, playerToken: string, accepted: boolean): Promise<LyingLlamaState> {
  return rpcState("ll_confirm_penalty", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_accepted: accepted
  });
}

export function voteLyingLlamaBattleWinner(gameCode: string, playerToken: string, winnerPlayerId: string): Promise<LyingLlamaState> {
  return rpcState("ll_vote_battle_winner", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_winner_player_id: winnerPlayerId
  });
}

export function playAgainLyingLlama(gameCode: string, playerToken: string): Promise<LyingLlamaState> {
  return rpcState("ll_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}
