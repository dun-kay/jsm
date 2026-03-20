import { getSupabaseClient } from "./supabase";

export type DailySessionStat = {
  statDate: string;
  sessions: number;
  avgUsersPerSession: number;
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
