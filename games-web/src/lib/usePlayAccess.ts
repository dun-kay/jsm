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

  return {
    accessState,
    showPaywall,
    setShowPaywall,
    accessError,
    setAccessError,
    refreshAccessState,
    ensureSessionAccess
  };
}
