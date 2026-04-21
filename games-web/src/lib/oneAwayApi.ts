import { getSupabaseClient } from "./supabase";

export async function getOneAwayAverageGuesses(puzzleDate: string): Promise<number | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("oa_get_average_guesses", {
    p_puzzle_date: puzzleDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load One Away average guesses.");
  }

  if (typeof data === "number") {
    return data;
  }

  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    const maybe = first.average_guesses;
    if (typeof maybe === "number") {
      return maybe;
    }
  }

  return null;
}

export async function recordOneAwayCompletion(
  puzzleDate: string,
  localPlayerId: string,
  guessCount: number
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("oa_record_completion", {
    p_puzzle_date: puzzleDate,
    p_local_player_id: localPlayerId,
    p_guess_count: guessCount
  });

  if (error) {
    throw new Error(error.message || "Failed to record One Away completion.");
  }
}

