import { getSupabaseClient } from "./supabase";

export type SecretWordPuzzle = {
  date: string;
  letters: string;
  words: string[];
};

export async function getSecretWordsWindow(fromDate: string, toDate: string): Promise<SecretWordPuzzle[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("sw_get_puzzles_window", {
    p_from: fromDate,
    p_to: toDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load Secret Words puzzles.");
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    date: String(row.puzzle_date ?? ""),
    letters: String(row.letters ?? "").toUpperCase(),
    words: Array.isArray(row.words)
      ? row.words.map((word) => String(word).toLowerCase())
      : []
  }));
}

export async function getSecretWordsAverageGuesses(puzzleDate: string): Promise<number | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("sw_get_average_guesses", {
    p_puzzle_date: puzzleDate
  });

  if (error) {
    throw new Error(error.message || "Failed to load Secret Words average guesses.");
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

export async function recordSecretWordsCompletion(
  puzzleDate: string,
  localPlayerId: string,
  guessCount: number
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("sw_record_completion", {
    p_puzzle_date: puzzleDate,
    p_local_player_id: localPlayerId,
    p_guess_count: guessCount
  });

  if (error) {
    throw new Error(error.message || "Failed to record Secret Words completion.");
  }
}
