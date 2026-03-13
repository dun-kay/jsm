import { getSupabaseClient } from "./supabase";

export type LobbyStatus = "lobby" | "started" | "cancelled";

export type LobbyPlayer = {
  id: string;
  name: string;
  isHost: boolean;
};

export type LobbyState = {
  gameCode: string;
  gameSlug: string;
  status: LobbyStatus;
  maxPlayers: number;
  playerCount: number;
  players: LobbyPlayer[];
};

export type CreateGameResult = {
  gameCode: string;
  hostSecret: string;
  hostPlayerId: string;
  hostPlayerToken: string;
};

export async function createGame(hostName: string, gameSlug: string): Promise<CreateGameResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_game", {
      p_host_name: hostName,
      p_max_players: 18,
      p_game_slug: gameSlug
    })
    .single<{ game_code: string; host_secret: string; host_player_id: string; host_player_token: string }>();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create game.");
  }

  return {
    gameCode: data.game_code,
    hostSecret: data.host_secret,
    hostPlayerId: data.host_player_id,
    hostPlayerToken: data.host_player_token
  };
}

export async function joinGame(gameCode: string, playerName: string): Promise<{ playerId: string; playerToken: string }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("join_game", {
      p_game_code: gameCode,
      p_player_name: playerName
    })
    .single<{ player_id: string; player_token: string }>();

  if (error || !data) {
    throw new Error(error?.message || "Failed to join game.");
  }

  return { playerId: data.player_id, playerToken: data.player_token };
}

export async function rejoinGame(gameCode: string, playerToken: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("rejoin_game", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });

  if (error) {
    throw new Error(error.message || "Failed to rejoin game.");
  }
}

export async function touchPlayer(gameCode: string, playerToken: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("touch_player", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });

  if (error) {
    throw new Error(error.message || "Failed to keep session alive.");
  }

  return data === true;
}

export async function getLobbyState(gameCode: string): Promise<LobbyState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_lobby_state", {
    p_game_code: gameCode
  });

  if (error || !data) {
    throw new Error(error?.message || "Failed to load lobby.");
  }

  const state = data as {
    gameCode: string;
    gameSlug: string;
    status: LobbyStatus;
    maxPlayers: number;
    playerCount: number;
    players: LobbyPlayer[];
  };

  return {
    gameCode: state.gameCode,
    gameSlug: state.gameSlug,
    status: state.status,
    maxPlayers: state.maxPlayers,
    playerCount: state.playerCount,
    players: state.players || []
  };
}

export async function startGame(gameCode: string, hostSecret: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("start_game", {
    p_game_code: gameCode,
    p_host_secret: hostSecret
  });

  if (error || data !== true) {
    throw new Error(error?.message || "Failed to start game.");
  }
}

export async function cancelGame(gameCode: string, hostSecret: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_game", {
    p_game_code: gameCode,
    p_host_secret: hostSecret
  });

  if (error || data !== true) {
    throw new Error(error?.message || "Failed to cancel game.");
  }
}

export async function leaveGame(gameCode: string, playerToken: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("leave_game", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });

  if (error || data !== true) {
    throw new Error(error?.message || "Failed to leave game.");
  }
}
