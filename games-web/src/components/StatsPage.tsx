import { useEffect, useMemo, useState } from "react";
import { getDailySessionStats, getDrawWfStats, type DailySessionStat, type DrawWfStats } from "../lib/statsApi";

type ThemeMode = "light" | "dark";

type StatsPageProps = {
  mode: "default" | "draw-wf";
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBack: () => void;
};

const FROM_DATE = "2026-03-10";

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export default function StatsPage({ mode, theme, onToggleTheme, onBack }: StatsPageProps) {
  const [rows, setRows] = useState<DailySessionStat[]>([]);
  const [drawWf, setDrawWf] = useState<DrawWfStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        if (mode === "draw-wf") {
          const data = await getDrawWfStats(FROM_DATE);
          if (!canceled) {
            setDrawWf(data);
            setRows([]);
          }
          return;
        }

        const data = await getDailySessionStats(FROM_DATE);
        if (!canceled) {
          setRows(data);
          setDrawWf(null);
        }
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : "Failed to load stats.");
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      canceled = true;
    };
  }, [mode]);

  const drawWfRows = useMemo(
    () =>
      drawWf
        ? [
            ["Sessions", String(drawWf.sessions)],
            ["Avg players / session", drawWf.avgPlayersPerSession.toFixed(2)],
            ["Total rounds", String(drawWf.totalRounds)],
            ["Total guesses", String(drawWf.totalGuesses)],
            ["Guess success rate", `${(drawWf.guessSuccessRate * 100).toFixed(1)}%`],
            ["Avg room streak", drawWf.avgRoomStreak.toFixed(2)],
            ["Longest room streak", String(drawWf.longestRoomStreak)],
            ["Rounds / session", drawWf.roundsPerSession.toFixed(2)],
            ["Paid purchases", String(drawWf.paidRoundPurchases)]
          ]
        : [],
    [drawWf]
  );

  return (
    <div className="site-shell">
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>

      <section className="screen screen-basic">
        <header className="screen-header">
          <h1>Session Stats</h1>
          <p className="body-text small">{mode === "draw-wf" ? "Draw WF metrics." : "Daily totals (LA time)."}</p>
        </header>

        <div className="stats-list" aria-live="polite">
          {mode === "default" ? (
            <div className="stats-row stats-head">
              <span>Date (LA)</span>
              <span>Sessions</span>
              <span>Av us./se.</span>
            </div>
          ) : null}

          {loading ? <p className="body-text small">Loading stats...</p> : null}
          {error ? <p className="error-text">{error}</p> : null}

          {mode === "default" && !loading && !error
            ? rows.map((row) => (
                <div className="stats-row" key={row.statDate}>
                  <span>{formatDate(row.statDate)}</span>
                  <span>{row.sessions}</span>
                  <span>{row.avgUsersPerSession.toFixed(2)}</span>
                </div>
              ))
            : null}

          {mode === "draw-wf" && !loading && !error
            ? drawWfRows.map(([label, value]) => (
                <div className="stats-row stats-row-dwf" key={label}>
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))
            : null}
        </div>

        <div className="bottom-stack">
          <button className="btn btn-soft" type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </section>
    </div>
  );
}
