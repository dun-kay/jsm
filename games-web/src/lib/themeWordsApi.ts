import { getSupabaseClient } from "./supabase";

export async function getThemeWordsAverageSeconds(puzzleDate: string): Promise<number | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("tw_get_average_time_seconds", {
    p_puzzle_date: puzzleDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load Theme Words average time.");
  }

  if (typeof data === "number") {
    return data;
  }

  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    const maybe = first.average_seconds;
    if (typeof maybe === "number") {
      return maybe;
    }
  }

  return null;
}

export async function recordThemeWordsCompletion(
  puzzleDate: string,
  localPlayerId: string,
  elapsedSeconds: number
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("tw_record_completion", {
    p_puzzle_date: puzzleDate,
    p_local_player_id: localPlayerId,
    p_elapsed_seconds: elapsedSeconds
  });

  if (error) {
    throw new Error(error.message || "Failed to record Theme Words completion.");
  }
}
