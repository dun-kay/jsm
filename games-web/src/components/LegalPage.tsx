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
            <p><b>Play access model:</b> Access is browser type/device based. No account is required.</p>
            <p><b>Age guidance:</b> Any age labels shown on games are advisory only for player discretion; we do not perform age verification or age-based access blocking.</p>
            <p><b>Free access:</b> You receive 1 free session to use every 4 hours. Free sessions do not roll over.</p>
            <p><b>Share bonus:</b> You may claim up to +2 extra free sessions in that same 4-hour window via the share flow.</p>
            <p><b>Paid access:</b> $1 USD unlocks unlimited sessions for 4 hours on that browser type/device only. $6.00 USD unlocks unlimited sessions for 30 days on that browser type/device only. Refreshing the page or closing the tab and coming back to the same browser type is possible (provided your access time has not lapsed); unless you purchase in private mode (not recommended), clear cookies/local storage, or change your browser type.</p>
            <p><b>Draw Things access:</b> Draw Things uses a play-pack model. You get up to 10 free plays plus +5 free-play refill every 4 hours. A play is consumed when you start a Draw or Guess action.</p>
            <p><b>Draw Things paid pack:</b> A single purchase grants 100 Draw Things plays for that browser type/device. While paid plays are active, total stored plays are capped at 105 (paid + free refill pool). The buy button is hidden while paid plays remain.</p>
            <p><b>Draw Things inactivity and service changes:</b> If Draw Things plays are not used for an extended period, we may expire unused Draw Things plays after 90 days of inactivity on that browser/device. We may also pause, change, or sunset Draw Things or related services at any time, including for maintenance, commercial, or product reasons, and are not required to keep the service running indefinitely solely to preserve unused plays.</p>
            <p><b>Billing:</b> Payments are processed by Stripe. By purchasing, you authorize the applicable charge shown at checkout.</p>
            <p><b>Advertising:</b> We may display ads through third-party providers (including Google). Regional consent prompts may be shown where required by law.</p>
            <p><b>Session counting:</b> A session is counted when gameplay starts (not just browsing, lobby, or reading rules).</p>
            <p><b>Storage and continuity:</b> Clearing cookies/local storage, using incognito/private mode, or switching browser types/devices may reset or break access continuity.</p>
            <p><b>Disclaimer:</b> Paid access and free sessions are tied to this browser type/device via local storage and cookies. If you clear cookies/local storage, use private mode, or switch browser types/devices, access may be lost. By continuing or purchasing, you accept this setup and understand this is not grounds for a refund. Issues, contact support.</p>
            <p><b>Refunds and disputes:</b> Refunds are handled case-by-case at our discretion. If payment issues occur, contact support.</p>
            <p><b>Availability and abuse:</b> We may limit, suspend, or block access to protect platform stability, prevent abuse, or comply with legal obligations.</p>
            <p><b>Liability:</b> To the extent allowed by law, {COMPANY} is not liable for losses, damages, or disputes arising from use of the app.</p>
            <p><b>Contact:</b> <a href={CONTACT_URL} target="_blank" rel="noreferrer">Contact link</a></p>
          </div>
        ) : isPrivacy ? (
          <div className="runtime-flow legal-copy">
            <p><b>Who we are:</b> {COMPANY}</p>
            <p><b>What we collect:</b> Limited game/session data needed to run gameplay and access logic, including display names, session/game IDs, room events, and browser access token state.</p>
            <p><b>Why we collect it:</b> To operate games, enforce free/paid session rules, detect basic abuse, and provide support.</p>
            <p><b>Cookies and storage:</b> We use first-party browser storage/cookies for access and session continuity, and we may use Google advertising technologies (including cookies or local storage) to serve ads.</p>
            <p><b>Ads and consent:</b> We may show Google Ads. In supported regions (including EU/UK and applicable US states), Google provides a consent flow and handles ad-consent controls based on local requirements.</p>
            <p><b>Payments:</b> Payments are processed by Stripe. We do not store full card numbers. Stripe may process payment and fraud-prevention data under its own terms.</p>
            <p><b>Data sharing:</b> We do not sell personal data. We may share data with service providers strictly to operate the service (for example, hosting/database/payment processing/advertising delivery).</p>
            <p><b>Retention:</b> We keep operational records for as long as reasonably required for service operation, troubleshooting, fraud prevention, legal, and accounting needs.</p>
            <p><b>Your choices:</b> You can clear browser data at any time, but this may reset access continuity on that browser type/device.</p>
            <p><b>Contact:</b> <a href={CONTACT_URL} target="_blank" rel="noreferrer">Contact link</a></p>
          </div>
        ) : (
          <div className="runtime-flow legal-copy">
            <p><b>How access works:</b> No account needed. Access is tied to this browser type/device.</p>
            <p><b>Free access:</b> 1 free session to use every 4 hours. Free sessions do not roll over.</p>
            <p><b>Share bonus:</b> Up to +2 extra free sessions in that same 4-hour window via the share flow.</p>
            <p><b>Unlimited access:</b> $1 USD unlocks unlimited sessions for 4 hours on that browser type/device. $6.00 USD unlocks unlimited sessions for 30 days on that browser type/device. Refreshing the page or closing the tab and coming back to the same browser type is possible (provided your access time has not lapsed); unless you purchase in private mode (not recommended), clear cookies/local storage, or change your browser type.</p>
            <p><b>Draw Things plays:</b> Draw Things is priced separately. You can use free plays (up to 10, +5 refill every 4 hours) or buy a 100-play pack. One play = one Draw start or one Guess start.</p>
            <p><b>Draw Things play cap:</b> If paid plays are active, stored plays are capped at 105 total (paid + free refill pool).</p>
            <p><b>Draw Things inactivity policy:</b> Unused Draw Things plays may expire after 90 days of inactivity on that browser/device.</p>
            <p><b>Service continuity:</b> We may pause, modify, or discontinue Draw Things (or related features) at any time. Purchases do not guarantee indefinite service availability.</p>
            <p><b>Disclaimer:</b> Paid access and free sessions are tied to this browser type/device via local storage and cookies. If you clear cookies/local storage, use private mode, or switch browser types/devices, access may be lost. By continuing or purchasing, you accept this setup and understand this is not grounds for a refund. Issues, contact support.</p>
            <p><b>Per-player access:</b> Sessions are per user/browser. In a group of 8, all 8 players must each have at least 1 free session (or active unlimited). Sessions cannot be shared.</p>
            <p><b>When sessions count:</b> A session counts when gameplay starts, not while browsing or waiting in lobby.</p>
            <p><b>Payment confirmation:</b> Unlimited access starts after successful Stripe confirmation.</p>
            <p><b>What can break continuity:</b> Clearing cookies/local storage, private/incognito mode, browser type/device changes, strict privacy tools, or blocked storage may reset access state.</p>
            <p><b>Important:</b> This is a convenience-first system, not a perfect anti-circumvention system.</p>
            <p><b>Support:</b> If something looks wrong with billing/access, contact support with your details and approximate payment time.</p>
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
