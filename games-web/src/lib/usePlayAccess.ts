import { useCallback, useEffect, useState } from "react";
import { consumeSession, getAccessState, type AccessState } from "./accessApi";

export function usePlayAccess() {
  const [accessState, setAccessState] = useState<AccessState | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [accessError, setAccessError] = useState("");

  const refreshAccessState = useCallback(async () => {
    const next = await getAccessState();
    setAccessState(next);
  }, []);

  useEffect(() => {
    void refreshAccessState().catch((error) => {
      setAccessError((error as Error).message || "Unable to load play access.");
    });
  }, [refreshAccessState]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("payment") !== "success") {
      return;
    }

    let cancelled = false;
    const clearPaymentQuery = () => {
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete("payment");
      cleaned.searchParams.delete("session_id");
      window.history.replaceState({}, "", cleaned.toString());
    };

    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const settle = async () => {
      for (let i = 0; i < 10; i += 1) {
        if (cancelled) {
          return;
        }
        try {
          const next = await getAccessState();
          setAccessState(next);
          if (next.paidUnlockActive) {
            setShowPaywall(false);
            clearPaymentQuery();
            return;
          }
        } catch {
          // keep retrying for eventual webhook consistency
        }
        await wait(1200);
      }
      clearPaymentQuery();
    };

    void settle();
    return () => {
      cancelled = true;
    };
  }, [refreshAccessState]);

  const ensureSessionAccess = useCallback(
    async (gameCode: string): Promise<boolean> => {
      setAccessError("");
      const result = await consumeSession(gameCode);
      await refreshAccessState();
      if (!result.allowed) {
        setShowPaywall(true);
        return false;
      }
      return true;
    },
    [refreshAccessState]
  );

  const primePaywallIfExhausted = useCallback(async (): Promise<void> => {
    const next = await getAccessState();
    setAccessState(next);
    if (!next.paidUnlockActive && next.freeSessionsLeft <= 0) {
      setShowPaywall(true);
    }
  }, []);

  return {
    accessState,
    showPaywall,
    setShowPaywall,
    accessError,
    setAccessError,
    refreshAccessState,
    ensureSessionAccess,
    primePaywallIfExhausted
  };
}
