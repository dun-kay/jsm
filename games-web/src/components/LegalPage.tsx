type ThemeMode = "light" | "dark";
type LegalType = "terms" | "privacy" | "unlimited";

type LegalPageProps = {
  type: LegalType;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBack: () => void;
};

const LAST_UPDATED = "March 19, 2026";
const COMPANY = "Jump Ship Media";
const CONTACT = "james[symbol]jumpship.media";
const CURRENT_YEAR = new Date().getFullYear();

export default function LegalPage({ type, theme, onToggleTheme, onBack }: LegalPageProps) {
  const isTerms = type === "terms";
  const isPrivacy = type === "privacy";

  return (
    <div className="site-shell">
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle light and dark mode">
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>

      <section className="screen screen-basic">
        <header className="screen-header">
          <h1>{isTerms ? "Terms" : isPrivacy ? "Privacy policy" : "How unlimited works"}</h1>
          <p className="body-text small">Last updated: {LAST_UPDATED}</p>
        </header>

        {isTerms ? (
          <div className="runtime-flow">
            <p><b>Who we are:</b> {COMPANY}</p>
            <p><b>Copyright:</b> {"\u00A9"} {CURRENT_YEAR} {COMPANY}</p>
            <p><b>Use at your own risk:</b> You are responsible for your own actions and conduct while using this app.</p>
            <p><b>No guarantees:</b> This app is provided "as is" without warranties of uptime, availability, or fitness for a specific purpose.</p>
            <p><b>Liability:</b> To the extent allowed by law, {COMPANY} is not liable for losses, damages, or disputes from use of the app.</p>
            <p><b>Payments (planned):</b> We may add paid access, likely $1 for 4 hours of unlimited sessions after a threshold of free sessions. This may be processed by Stripe.</p>
            <p><b>Contact:</b> {CONTACT}</p>
          </div>
        ) : isPrivacy ? (
          <div className="runtime-flow">
            <p><b>Who we are:</b> {COMPANY}</p>
            <p><b>What we collect:</b> Basic game/session data needed to run lobbies and games (for example: display names, session/game IDs, and game state events). This information is not stored or used for marketing or promotional purposes.</p>
            <p><b>Cookies:</b> We currently do not use third-party cookies.</p>
            <p><b>Data sharing:</b> We currently do not sell personal data or share it with advertising networks.</p>
            <p><b>Payments (planned):</b> If paid access is enabled later, payment details may be handled by Stripe.</p>
            <p><b>Contact:</b> {CONTACT}</p>
          </div>
        ) : (
          <div className="runtime-flow">
            <p><b>What you get:</b> $1 AUD unlocks unlimited sessions for 4 hours on this browser/device.</p>
            <p><b>Free access:</b> You also get free sessions on a rolling timer, plus one extra free session when you use the share flow.</p>
            <p><b>No account needed:</b> Access is tied to this browser/device using local browser storage.</p>
            <p><b>Important:</b> If you clear cookies/local storage, switch browsers, or use private/incognito mode, your unlock may not carry across.</p>
            <p><b>Payment confirmation:</b> Unlock starts after successful Stripe confirmation.</p>
            <p><b>Need help:</b> Contact support via the support form link in the footer.</p>
          </div>
        )}

        <div className="bottom-stack">
          <button className="btn btn-soft" type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </section>
    </div>
  );
}
