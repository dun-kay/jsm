import { getSupabaseClient } from "./supabase";

export type MurderClubPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  turnOrder: number;
};

export type TeamVoteEntry = {
  playerId: string;
  name: string;
  vote: "approve" | "reject" | null;
};

export type MurderClubState = {
  phase: "rules" | "team_pick" | "discussion_phase" | "team_vote" | "mission_vote" | "round_result" | "result";
  roundNumber: number;
  targetScore: number;
  innocentScore: number;
  killerScore: number;
  rejectStreak: number;
  leaderId: string | null;
  teamSizeRequired: number;
  missionFailThreshold: number;
  selectedTeam: string[];
  players: MurderClubPlayer[];
  teamVotes: TeamVoteEntry[];
  discussionLeaderEndsAt: string | null;
  discussionEndsAt: string | null;
  teamVoteEndsAt: string | null;
  missionVoteEndsAt: string | null;
  resultEndsAt: string | null;
  lastMurderCount: number;
  lastTeamApproved: boolean | null;
  lastLine: string | null;
  waitingOn: string[];
  lastError: string | null;
  you: {
    id: string;
    name: string;
    isHost: boolean;
    isLeader: boolean;
    isSelected: boolean;
    role: "killer" | "innocent";
    canUseMurder: boolean;
  };
};

function mapState(data: unknown): MurderClubState {
  const raw = data as Record<string, unknown>;
  const you = (raw.you as Record<string, unknown>) || {};
  return {
    phase: (raw.phase as MurderClubState["phase"]) ?? "rules",
    roundNumber: Number(raw.roundNumber ?? 1),
    targetScore: Number(raw.targetScore ?? 3),
    innocentScore: Number(raw.innocentScore ?? 0),
    killerScore: Number(raw.killerScore ?? 0),
    rejectStreak: Number(raw.rejectStreak ?? 0),
    leaderId: (raw.leaderId as string | null) ?? null,
    teamSizeRequired: Number(raw.teamSizeRequired ?? 2),
    missionFailThreshold: Number(raw.missionFailThreshold ?? 1),
    selectedTeam: ((raw.selectedTeam as string[]) || []).map(String),
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((player) => ({
      id: String(player.id ?? ""),
      name: String(player.name ?? ""),
      isHost: Boolean(player.isHost),
      turnOrder: Number(player.turnOrder ?? 0)
    })),
    teamVotes: ((raw.teamVotes as Array<Record<string, unknown>>) || []).map((vote) => ({
      playerId: String(vote.playerId ?? ""),
      name: String(vote.name ?? ""),
      vote: (vote.vote as TeamVoteEntry["vote"]) ?? null
    })),
    discussionLeaderEndsAt: (raw.discussionLeaderEndsAt as string | null) ?? null,
    discussionEndsAt: (raw.discussionEndsAt as string | null) ?? null,
    teamVoteEndsAt: (raw.teamVoteEndsAt as string | null) ?? null,
    missionVoteEndsAt: (raw.missionVoteEndsAt as string | null) ?? null,
    resultEndsAt: (raw.resultEndsAt as string | null) ?? null,
    lastMurderCount: Number(raw.lastMurderCount ?? 0),
    lastTeamApproved: (raw.lastTeamApproved as boolean | null) ?? null,
    lastLine: (raw.lastLine as string | null) ?? null,
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    lastError: (raw.lastError as string | null) ?? null,
    you: {
      id: String(you.id ?? ""),
      name: String(you.name ?? ""),
      isHost: Boolean(you.isHost),
      isLeader: Boolean(you.isLeader),
      isSelected: Boolean(you.isSelected),
      role: (you.role as "killer" | "innocent") ?? "innocent",
      canUseMurder: Boolean(you.canUseMurder)
    }
  };
}

async function rpcState(fn: string, params: Record<string, unknown>): Promise<MurderClubState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, params);
  if (error || !data) {
    throw new Error(error?.message || "Murder Club request failed.");
  }
  return mapState(data);
}

export function initMurderClub(gameCode: string, playerToken: string): Promise<MurderClubState> {
  return rpcState("mc_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function getMurderClubState(gameCode: string, playerToken: string): Promise<MurderClubState> {
  return rpcState("mc_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueMurderClub(gameCode: string, playerToken: string): Promise<MurderClubState> {
  return rpcState("mc_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function setMurderClubTeam(gameCode: string, playerToken: string, selectedTeam: string[]): Promise<MurderClubState> {
  return rpcState("mc_set_team", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_selected_team: selectedTeam
  });
}

export function castMurderClubTeamVote(
  gameCode: string,
  playerToken: string,
  vote: "approve" | "reject"
): Promise<MurderClubState> {
  return rpcState("mc_cast_team_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_vote: vote
  });
}

export function castMurderClubMissionVote(
  gameCode: string,
  playerToken: string,
  vote: "safe" | "murder"
): Promise<MurderClubState> {
  return rpcState("mc_cast_mission_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_vote: vote
  });
}

export function playAgainMurderClub(gameCode: string, playerToken: string): Promise<MurderClubState> {
  return rpcState("mc_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}
