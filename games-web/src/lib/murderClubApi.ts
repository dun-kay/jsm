import { getSupabaseClient } from "./supabase";

export type MurderClubPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  turnOrder: number;
};

export type SuspectCount = {
  playerId: string;
  count: number;
};

export type MurderClubState = {
  phase:
    | "rules"
    | "role_reveal"
    | "round_ready"
    | "evidence_reveal"
    | "suspect_vote"
    | "suspect_result"
    | "evidence_vote"
    | "evidence_result"
    | "result";
  roundNumber: number;
  targetScore: number;
  investigatorScore: number;
  conspiratorScore: number;
  themeId: string;
  evidenceIndex: number;
  suspectPlayerId: string | null;
  suspectVoteResult: "selected" | "hung" | null;
  evidenceVoteResult: "admitted" | "rejected" | "hung" | null;
  players: MurderClubPlayer[];
  suspectCounts: SuspectCount[];
  evidenceCounts: {
    admit: number;
    reject: number;
  };
  waitingOn: string[];
  lastLine: string | null;
  lastError: string | null;
  you: {
    id: string;
    name: string;
    isHost: boolean;
    role: "conspirator" | "investigator";
    evidenceCard: "admit" | "reject" | null;
    isUnderSuspicion: boolean;
    conspiratorIds: string[];
  };
};

function mapState(data: unknown): MurderClubState {
  const raw = data as Record<string, unknown>;
  const you = (raw.you as Record<string, unknown>) || {};
  const evidenceCountsRaw = (raw.evidenceCounts as Record<string, unknown>) || {};
  return {
    phase: (raw.phase as MurderClubState["phase"]) ?? "rules",
    roundNumber: Number(raw.roundNumber ?? 1),
    targetScore: Number(raw.targetScore ?? 3),
    investigatorScore: Number(raw.investigatorScore ?? 0),
    conspiratorScore: Number(raw.conspiratorScore ?? 0),
    themeId: String(raw.themeId ?? "holiday-murder"),
    evidenceIndex: Number(raw.evidenceIndex ?? 0),
    suspectPlayerId: (raw.suspectPlayerId as string | null) ?? null,
    suspectVoteResult: (raw.suspectVoteResult as MurderClubState["suspectVoteResult"]) ?? null,
    evidenceVoteResult: (raw.evidenceVoteResult as MurderClubState["evidenceVoteResult"]) ?? null,
    players: ((raw.players as Array<Record<string, unknown>>) || []).map((player) => ({
      id: String(player.id ?? ""),
      name: String(player.name ?? ""),
      isHost: Boolean(player.isHost),
      turnOrder: Number(player.turnOrder ?? 0)
    })),
    suspectCounts: ((raw.suspectCounts as Array<Record<string, unknown>>) || []).map((entry) => ({
      playerId: String(entry.playerId ?? ""),
      count: Number(entry.count ?? 0)
    })),
    evidenceCounts: {
      admit: Number(evidenceCountsRaw.admit ?? 0),
      reject: Number(evidenceCountsRaw.reject ?? 0)
    },
    waitingOn: ((raw.waitingOn as string[]) || []).map(String),
    lastLine: (raw.lastLine as string | null) ?? null,
    lastError: (raw.lastError as string | null) ?? null,
    you: {
      id: String(you.id ?? ""),
      name: String(you.name ?? ""),
      isHost: Boolean(you.isHost),
      role: (you.role as "conspirator" | "investigator") ?? "investigator",
      evidenceCard: (you.evidenceCard as "admit" | "reject" | null) ?? null,
      isUnderSuspicion: Boolean(you.isUnderSuspicion),
      conspiratorIds: ((you.conspiratorIds as string[]) || []).map(String)
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
  return rpcState("mc2_init_game", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function getMurderClubState(gameCode: string, playerToken: string): Promise<MurderClubState> {
  return rpcState("mc2_get_state", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function continueMurderClub(gameCode: string, playerToken: string): Promise<MurderClubState> {
  return rpcState("mc2_continue", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}

export function setMurderClubTheme(gameCode: string, playerToken: string, themeId: string): Promise<MurderClubState> {
  return rpcState("mc2_set_theme", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_theme_id: themeId
  });
}

export function castMurderClubSuspectVote(
  gameCode: string,
  playerToken: string,
  targetPlayerId: string
): Promise<MurderClubState> {
  return rpcState("mc2_cast_suspect_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_target_player_id: targetPlayerId
  });
}

export function castMurderClubEvidenceVote(
  gameCode: string,
  playerToken: string,
  vote: "admit" | "reject"
): Promise<MurderClubState> {
  return rpcState("mc2_cast_evidence_vote", {
    p_game_code: gameCode,
    p_player_token: playerToken,
    p_vote: vote
  });
}

export function playAgainMurderClub(gameCode: string, playerToken: string): Promise<MurderClubState> {
  return rpcState("mc2_play_again", {
    p_game_code: gameCode,
    p_player_token: playerToken
  });
}
