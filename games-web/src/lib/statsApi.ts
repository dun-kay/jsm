import { getSupabaseClient } from "./supabase";

export type DailySessionStat = {
  statDate: string;
  sessions: number;
  avgUsersPerSession: number;
};

export type DrawWfStats = {
  sessions: number;
  avgPlayersPerSession: number;
  totalRounds: number;
  totalGuesses: number;
  guessSuccessRate: number;
  avgRoomStreak: number;
  longestRoomStreak: number;
  roundsPerSession: number;
  paidRoundPurchases: number;
};

export async function getDailySessionStats(fromDate: string): Promise<DailySessionStat[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_daily_session_stats", {
    p_from: fromDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load stats.");
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    statDate: String(row.stat_date ?? ""),
    sessions: Number(row.sessions ?? 0),
    avgUsersPerSession: Number(row.avg_users_per_session ?? 0)
  }));
}

export async function getDrawWfStats(fromDate: string): Promise<DrawWfStats> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_draw_wf_stats", {
    p_from: fromDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load Draw WF stats.");
  }

  const row = ((data as Array<Record<string, unknown>> | null) ?? [])[0] ?? {};
  return {
    sessions: Number(row.sessions ?? 0),
    avgPlayersPerSession: Number(row.avg_players_per_session ?? 0),
    totalRounds: Number(row.total_rounds ?? 0),
    totalGuesses: Number(row.total_guesses ?? 0),
    guessSuccessRate: Number(row.guess_success_rate ?? 0),
    avgRoomStreak: Number(row.avg_room_streak ?? 0),
    longestRoomStreak: Number(row.longest_room_streak ?? 0),
    roundsPerSession: Number(row.rounds_per_session ?? 0),
    paidRoundPurchases: Number(row.paid_round_purchases ?? 0)
  };
}
