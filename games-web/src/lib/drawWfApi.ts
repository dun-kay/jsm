import { getSupabaseClient } from "./supabase";

export type DrawWfPhase = "rules" | "draw_intro" | "draw_live" | "guess_intro" | "guess_live" | "round_result";

export type DrawWfPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  turnOrder: number;
  status: "active" | "pending" | "inactive";
  isDrawer: boolean;
};

export type DrawWfState = {
  phase: DrawWfPhase;
  roundNumber: number;
  roundId: string;
  drawerPlayerId: string | null;
  drawerName: string | null;
  guesserIds: string[];
  activeGuesserIds: string[];
  wordLength: number;
  wordMask: string;
  drawDeadlineAt: string | null;
  guessDeadlineAt: string | null;
  revealWord: string | null;
  letterBank: string[];
  replayPayload: unknown;
  waitingOn: string[];
  roomPlayerCount?: number;
  streak: number;
  longestStreak: number;
  allCorrect: boolean | null;
  yourGuess: string | null;
  yourGuessCorrect: boolean | null;
  players: DrawWfPlayer[];
  lastError: string | null;
  you: {
    id: string;
    name: string;
    isHost: boolean;
  };
};

function mapState(data: unknown): DrawWfState {
  const raw = data as Record<string, unknown>;
  return {
    phase: (raw.phase as DrawWfPhase) ?? "rules",
    roundNumber: Number(raw.roundNumber ?? 1),
    roundId: String(raw.roundId ?? ""),
    drawerPlayerId: (raw.drawerPlayerId as string | null) ?? null,
    drawerName: (raw.drawerName as string | null) ?? null,
    guesserIds: Array.isArray(raw.guesserIds) ? raw.guesserIds.map(String) : [],
    activeGuesserIds: Array.isArray(raw.activeGuesserIds) ? raw.activeGuesserIds.map(String) : [],
    wordLength: Number(raw.wordLength ?? 0),
    wordMask: String(raw.wordMask ?? ""),
    drawDeadlineAt: (raw.drawDeadlineAt as string | null) ?? null,
    guessDeadlineAt: (raw.guessDeadlineAt as string | null) ?? null,
    revealWord: (raw.revealWord as string | null) ?? null,
    letterBank: Array.isArray(raw.letterBank) ? raw.letterBank.map(String) : [],
    replayPayload: raw.replayPayload,
    waitingOn: Array.isArray(raw.waitingOn) ? raw.waitingOn.map(String) : [],
    roomPlayerCount: raw.roomPlayerCount == null ? undefined : Number(raw.roomPlayerCount),
    streak: Number(raw.streak ?? 0),
    longestStreak: Number(raw.longestStreak ?? 0),
    allCorrect: raw.allCorrect == null ? null : Boolean(raw.allCorrect),
    yourGuess: (raw.yourGuess as string | null) ?? null,
    yourGuessCorrect: raw.yourGuessCorrect == null ? null : Boolean(raw.yourGuessCorrect),
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((p) => ({
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      isHost: Boolean(p.isHost),
      turnOrder: Number(p.turnOrder ?? 0),
      status: (String(p.status ?? "active") as DrawWfPlayer["status"]),
      isDrawer: Boolean(p.isDrawer)
    })),
    lastError: (raw.lastError as string | null) ?? null,
    you: {
      id: String((raw.you as Record<string, unknown> | undefined)?.id ?? ""),
      name: String((raw.you as Record<string, unknown> | undefined)?.name ?? ""),
      isHost: Boolean((raw.you as Record<string, unknown> | undefined)?.isHost)
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<DrawWfState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Draw WF request failed.");
  }
  return mapState(data);
}

export function initDrawWf(gameCode: string, playerToken: string, wordPool: string[]): Promise<DrawWfState> {
  return rpcState("dwf_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_word_pool: wordPool
  });
}

export function getDrawWfState(gameCode: string, playerToken: string): Promise<DrawWfState> {
  return rpcState("dwf_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueDrawWf(gameCode: string, playerToken: string): Promise<DrawWfState> {
  return rpcState("dwf_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function submitDrawWfDrawing(gameCode: string, playerToken: string, replayPayload: unknown): Promise<DrawWfState> {
  return rpcState("dwf_submit_drawing", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_replay_payload: replayPayload
  });
}

export function submitDrawWfGuess(gameCode: string, playerToken: string, guess: string): Promise<DrawWfState> {
  return rpcState("dwf_submit_guess", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_guess: guess
  });
}

export function playAgainDrawWf(gameCode: string, playerToken: string, wordPool: string[]): Promise<DrawWfState> {
  return rpcState("dwf_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_word_pool: wordPool
  });
}

export async function setDrawWfDisplayName(gameCode: string, playerToken: string, name: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("dwf_set_display_name", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_display_name: name
  });
  if (error) {
    throw new Error(error.message || "Failed to update display name.");
  }
}
