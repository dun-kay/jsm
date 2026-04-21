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

export type SecretWordsDailyStat = {
  statDate: string;
  sessions: number;
  avgGuessesPerSession: number;
};

export type OneAwayDailyStat = {
  statDate: string;
  sessions: number;
  avgGuessesPerSession: number;
};

export type OrderMeDailyStat = {
  statDate: string;
  sessions: number;
  avgGuessesPerSession: number;
};

export type ThemeWordsDailyStat = {
  statDate: string;
  sessions: number;
  avgSecondsPerSession: number;
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
    throw new Error(error.message || "Failed to load Draw Things stats.");
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    statDate: String(row.stat_date ?? ""),
    sessions: Number(row.sessions ?? 0),
    avgDrawingsPerSession: Number(row.avg_drawings_per_session ?? 0)
  }));
}

export async function getSecretWordsDailyStats(fromDate: string): Promise<SecretWordsDailyStat[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_secret_words_daily_stats", {
    p_from: fromDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load Secret Words stats.");
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    statDate: String(row.stat_date ?? ""),
    sessions: Number(row.sessions ?? 0),
    avgGuessesPerSession: Number(row.avg_guesses_per_session ?? 0)
  }));
}

export async function getOneAwayDailyStats(fromDate: string): Promise<OneAwayDailyStat[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_one_away_daily_stats", {
    p_from: fromDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load One Away stats.");
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    statDate: String(row.stat_date ?? ""),
    sessions: Number(row.sessions ?? 0),
    avgGuessesPerSession: Number(row.avg_guesses_per_session ?? 0)
  }));
}

export async function getOrderMeDailyStats(fromDate: string): Promise<OrderMeDailyStat[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_order_me_daily_stats", {
    p_from: fromDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load Order Me stats.");
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    statDate: String(row.stat_date ?? ""),
    sessions: Number(row.sessions ?? 0),
    avgGuessesPerSession: Number(row.avg_guesses_per_session ?? 0)
  }));
}

export async function getThemeWordsDailyStats(fromDate: string): Promise<ThemeWordsDailyStat[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_theme_words_daily_stats", {
    p_from: fromDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load Theme Words stats.");
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    statDate: String(row.stat_date ?? ""),
    sessions: Number(row.sessions ?? 0),
    avgSecondsPerSession: Number(row.avg_seconds_per_session ?? 0)
  }));
}
