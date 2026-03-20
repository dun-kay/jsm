import { useEffect, useState } from "react";
import { getDailySessionStats, type DailySessionStat } from "../lib/statsApi";

type ThemeMode = "light" | "dark";

type StatsPageProps = {
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

export default function StatsPage({ theme, onToggleTheme, onBack }: StatsPageProps) {
  const [rows, setRows] = useState<DailySessionStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await getDailySessionStats(FROM_DATE);
        if (!canceled) {
          setRows(data);
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
  }, []);

  return (
    <div className="site-shell">
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>

      <section className="screen screen-basic">
        <header className="screen-header">
          <h1>Session Stats</h1>
          <p className="body-text small">Daily totals (LA time).</p>
        </header>

        <div className="stats-list" aria-live="polite">
          <div className="stats-row stats-head">
            <span>Date (LA)</span>
            <span>Sessions</span>
            <span>Av us./se.</span>
          </div>

          {loading ? <p className="body-text small">Loading stats...</p> : null}
          {error ? <p className="error-text">{error}</p> : null}

          {!loading && !error
            ? rows.map((row) => (
                <div className="stats-row" key={row.statDate}>
                  <span>{formatDate(row.statDate)}</span>
                  <span>{row.sessions}</span>
                  <span>{row.avgUsersPerSession.toFixed(2)}</span>
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
