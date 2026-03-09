import { env } from "./config/env";

export default function App() {
  return (
    <main className="app-shell">
      <h1>JSM Games</h1>
      <p>Foundation is ready. Game flow screens come next.</p>
      <section className="status-card">
        <h2>Environment</h2>
        <ul>
          <li>
            Supabase URL:{" "}
            <strong>{env.supabaseUrl ? "configured" : "missing"}</strong>
          </li>
          <li>
            Supabase anon key:{" "}
            <strong>{env.supabaseAnonKey ? "configured" : "missing"}</strong>
          </li>
        </ul>
      </section>
    </main>
  );
}

