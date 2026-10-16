import { requiredEnv, supabaseSecretKey } from "../_shared/env.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { supabaseRest } from "../_shared/supabase-rest.ts";

type QuizSession = {
  boyfriend_name: string;
  score: number;
  paid: boolean;
  created_at: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const { session_id } = await request.json();
    if (typeof session_id !== "string" || !/^[0-9a-f-]{36}$/i.test(session_id)) {
      return jsonResponse({ error: "Invalid quiz session." }, 400);
    }
    const rows = await supabaseRest<QuizSession[]>(
      `${requiredEnv("SUPABASE_URL")}/rest/v1/quiz_sessions?id=eq.${encodeURIComponent(session_id)}&select=boyfriend_name,score,paid,created_at`,
      supabaseSecretKey(),
    );
    const quiz = rows[0];
    if (!quiz?.paid) return jsonResponse({ error: "Payment has not been confirmed yet." }, 403);
    return jsonResponse({
      name: quiz.boyfriend_name,
      score: Math.max(0, Math.min(30, quiz.score)),
      test_date: quiz.created_at,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
