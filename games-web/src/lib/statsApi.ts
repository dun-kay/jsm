import { getSupabaseClient } from "./supabase";

export type DailySessionStat = {
  statDate: string;
  sessions: number;
  avgUsersPerSession: number;
};

export type DrawWfDailyStat = {
  statDate: string;
  sessions: number;
  avgDrawingsPerSession: number;
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

export async function getDrawWfDailyStats(fromDate: string): Promise<DrawWfDailyStat[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_draw_wf_daily_stats", {
    p_from: fromDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load Draw WF stats.");
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    statDate: String(row.stat_date ?? ""),
    sessions: Number(row.sessions ?? 0),
    avgDrawingsPerSession: Number(row.avg_drawings_per_session ?? 0)
  }));
}
