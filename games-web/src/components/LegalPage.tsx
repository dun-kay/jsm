type ThemeMode = "light" | "dark";
type LegalType = "terms" | "privacy" | "unlimited";

type LegalPageProps = {
  type: LegalType;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBack: () => void;
};

const LAST_UPDATED = "April 14, 2026";
const COMPANY = "Jump Ship Media";
const CONTACT_URL = "https://tally.so/r/XxqNzP";
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
          <div className="runtime-flow legal-copy">
            <p><b>Who we are:</b> {COMPANY}</p>
            <p><b>Copyright:</b> {"\u00A9"} {CURRENT_YEAR} {COMPANY}</p>
            <p><b>Use at your own risk:</b> You are responsible for your own actions and conduct while using this app.</p>
            <p><b>No guarantees:</b> The app is provided "as is" without warranties of uptime, uninterrupted access, or fitness for a specific purpose.</p>
            <p><b>Age guidance:</b> Any age labels shown on games are advisory only for player discretion; we do not perform age verification or age-based access blocking.</p>
            <p><b>Advertising:</b> We may display ads through third-party providers, including Google AdSense.</p>
            <p><b>Storage and continuity:</b> We use browser storage/cookies for gameplay continuity. Clearing storage, using private mode, or switching browser types/devices may reset local progress.</p>
            <p><b>Availability and abuse:</b> We may limit, suspend, or block access to protect platform stability, prevent abuse, or comply with legal obligations.</p>
            <p><b>Liability:</b> To the extent allowed by law, {COMPANY} is not liable for losses, damages, or disputes arising from use of the app.</p>
            <p><b>Contact:</b> <a href={CONTACT_URL} target="_blank" rel="noreferrer">Contact link</a></p>
          </div>
        ) : isPrivacy ? (
          <div className="runtime-flow legal-copy">
            <p><b>Who we are:</b> {COMPANY}</p>
            <p><b>What we collect:</b> Limited game/session data needed to run gameplay and access logic, including display names, session/game IDs, room events, and browser access token state.</p>
            <p><b>Why we collect it:</b> To operate games, maintain session continuity, detect basic abuse, and provide support.</p>
            <p><b>Cookies and storage:</b> We use first-party browser storage/cookies for session continuity. Third-party vendors, including Google, use cookies to serve ads based on a user's prior visits to this site or other sites.</p>
            <p><b>Google ad cookies:</b> Google's use of advertising cookies enables Google and its partners to serve ads based on user visits to this site and other sites on the Internet.</p>
            <p><b>Ad controls:</b> Users may opt out of personalized advertising by visiting <a href="https://adssettings.google.com/" target="_blank" rel="noreferrer">Google Ads Settings</a>. Users may also visit <a href="https://www.aboutads.info/" target="_blank" rel="noreferrer">www.aboutads.info</a> for additional opt-out options from some third-party vendors.</p>
            <p><b>Ads and consent:</b> We may show Google Ads. In supported regions (including EU/UK and applicable US states), Google may present consent controls where required by law.</p>
            <p><b>Data sharing:</b> We do not sell personal data. We may share data with service providers strictly to operate the service (for example, hosting/database/advertising delivery).</p>
            <p><b>Retention:</b> We keep operational records for as long as reasonably required for service operation, troubleshooting, fraud prevention, legal, and accounting needs.</p>
            <p><b>Your choices:</b> You can clear browser data at any time, but this may reset access continuity on that browser type/device.</p>
            <p><b>Contact:</b> <a href={CONTACT_URL} target="_blank" rel="noreferrer">Contact link</a></p>
          </div>
        ) : (
          <div className="runtime-flow legal-copy">
            <p><b>This page has moved:</b> How Unlimited Works is no longer in use.</p>
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
