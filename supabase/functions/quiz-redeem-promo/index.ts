import { requiredEnv, supabaseSecretKey } from "../_shared/env.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { supabaseRest } from "../_shared/supabase-rest.ts";

type QuizSession = { id: string; paid: boolean };
type PromotionCode = {
  id: string;
  active: boolean;
  expires_at: number | null;
  max_redemptions: number | null;
  times_redeemed: number;
  customer: string | null;
  restrictions?: { first_time_transaction?: boolean; minimum_amount?: number | null; minimum_amount_currency?: string | null };
  coupon: { valid: boolean; percent_off: number | null; amount_off: number | null; applies_to?: { products?: string[] } | null };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const { session_id, code } = await request.json();
    if (typeof session_id !== "string" || !/^[0-9a-f-]{36}$/i.test(session_id) || typeof code !== "string") {
      return jsonResponse({ error: "Invalid promotion request." }, 400);
    }
    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,32}$/.test(cleanCode)) return jsonResponse({ error: "Enter a valid promotion code." }, 400);

    const url = requiredEnv("SUPABASE_URL");
    const secret = supabaseSecretKey();
    const quizzes = await supabaseRest<QuizSession[]>(`${url}/rest/v1/quiz_sessions?id=eq.${encodeURIComponent(session_id)}&select=id,paid`, secret);
    if (!quizzes[0] || quizzes[0].paid) return jsonResponse({ error: "Quiz session is unavailable." }, 404);

    const stripeKey = requiredEnv("STRIPE_SECRET_KEY");
    const promotionResponse = await fetch(`https://api.stripe.com/v1/promotion_codes?active=true&code=${encodeURIComponent(cleanCode)}&limit=10`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const promotionData = await promotionResponse.json();
    const promotion = (promotionData.data as PromotionCode[] | undefined)?.find((item) => item.active);
    if (!promotion || !promotion.coupon.valid) return jsonResponse({ error: "That promotion code is not available." }, 400);
    if (promotion.expires_at && promotion.expires_at * 1000 < Date.now()) return jsonResponse({ error: "That promotion code has expired." }, 400);
    if (promotion.max_redemptions !== null || promotion.coupon.percent_off !== 100 || promotion.coupon.amount_off !== null) {
      return jsonResponse({ error: "This quiz accepts unrestricted 100% promotion codes only." }, 400);
    }
    if (promotion.customer || promotion.restrictions?.first_time_transaction || promotion.restrictions?.minimum_amount) {
      return jsonResponse({ error: "That promotion code has restrictions this quiz cannot verify." }, 400);
    }

    const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${requiredEnv("QUIZ_STRIPE_PRICE_ID")}`, { headers: { Authorization: `Bearer ${stripeKey}` } });
    const price = await priceResponse.json();
    const allowedProducts = promotion.coupon.applies_to?.products;
    if (!priceResponse.ok || (allowedProducts?.length && !allowedProducts.includes(price.product))) {
      return jsonResponse({ error: "That promotion code does not apply to this quiz." }, 400);
    }

    await supabaseRest(`${url}/rest/v1/quiz_sessions?id=eq.${encodeURIComponent(session_id)}`, secret, {
      method: "PATCH",
      body: { paid: true, stripe_checkout_session_id: `promo_${promotion.id}_${session_id}`, updated_at: new Date().toISOString() },
    });
    return jsonResponse({ redeemed: true });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
