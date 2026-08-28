import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CONFIG = {
  supabaseUrl: "https://setykcvlivqiuufjkjuu.supabase.co",
  supabasePublishableKey: "sb_publishable_Bm4WRrxanbMLwlnfNarjaQ_edjN45Zj",
  createCheckoutUrl: "https://setykcvlivqiuufjkjuu.supabase.co/functions/v1/create-checkout",
  updatePreferencesUrl: "https://setykcvlivqiuufjkjuu.supabase.co/functions/v1/update-preferences",
};

const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey);
const page = document.body.dataset.page;
const themeKey = "jsm:reader-theme";

const fallbackEpisodes = [
  { episode_number: 1, title: "The Drowned Boy", published: true },
  { episode_number: 2, title: "The Lighthouse", published: true },
  { episode_number: 3, title: "The Blackwater Four", published: true },
  { episode_number: 4, title: "The Woman in Room 13", published: true },
  { episode_number: 5, title: "Don't Go Looking", published: true },
  { episode_number: 6, title: "Coming Soon", published: false },
];

const seriesRoutes = {
  "blackwater-bay": "blackwater",
};

function html(strings, ...values) {
  return strings.reduce((output, string, index) => {
    const value = values[index] ?? "";
    return output + string + value;
  }, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(themeKey, nextTheme);
}

function readerReturnUrl(anchor = "unlock") {
  const url = new URL(window.location.href);
  url.searchParams.delete("purchase");
  url.hash = anchor ? anchor : "";
  return url.toString();
}

function authReturnUrl(anchor = "unlock") {
  const url = new URL(window.location.href);
  url.searchParams.delete("purchase");
  url.searchParams.delete("auth_anchor");
  if (anchor) url.searchParams.set("auth_anchor", anchor);
  url.hash = "";
  return url.toString();
}

function readerReturnPath(anchor = "unlock") {
  const url = new URL(readerReturnUrl(anchor));
  return `${url.pathname}${url.search}${url.hash}`;
}

function scrollToReaderAnchor() {
  if (window.location.hash !== "#unlock") return;
  const target = document.querySelector("#unlock");
  if (!target) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: "start" });
  });
}

function initReaderSettings() {
  applyTheme(localStorage.getItem(themeKey) || "light");

  const settings = document.createElement("aside");
  settings.className = "reader-settings";
  settings.innerHTML = html`
    <button class="settings-toggle" type="button" aria-label="Reader settings" aria-expanded="false">Aa</button>
    <div class="settings-panel hidden" aria-label="Reader settings panel">
      <p>Mode</p>
      <div class="settings-options">
        <button type="button" data-theme-option="light">Light</button>
        <button type="button" data-theme-option="dark">Dark</button>
      </div>
    </div>
  `;
  document.body.append(settings);

  const toggle = settings.querySelector(".settings-toggle");
  const panel = settings.querySelector(".settings-panel");
  const buttons = settings.querySelectorAll("[data-theme-option]");

  function syncButtons() {
    const activeTheme = document.documentElement.dataset.theme || "light";
    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.themeOption === activeTheme));
    });
  }

  toggle.addEventListener("click", () => {
    const isHidden = panel.classList.toggle("hidden");
    toggle.setAttribute("aria-expanded", String(!isHidden));
    toggle.textContent = isHidden ? "Aa" : "x";
    toggle.setAttribute("aria-label", isHidden ? "Reader settings" : "Close reader settings");
  });

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeOption);
      syncButtons();
    });
  });

  syncButtons();
}

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

async function syncAccountNav() {
  const accountLinks = document.querySelectorAll("[data-account-nav]");
  if (!accountLinks.length) return;

  const session = await getSession();
  accountLinks.forEach((link) => {
    link.textContent = session ? "My account" : "Members";
  });
}

async function handleAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const flowId = params.get("sb_flow_id");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") || "email";
  const authAnchor = params.get("auth_anchor");
  const hash = window.location.hash;
  const inferredAnchor = authAnchor || (hash.includes("unlock") ? "unlock" : "");
  const cleanHash = inferredAnchor ? `#${inferredAnchor}` : "";

  async function cleanAuthUrl() {
    params.delete("code");
    params.delete("sb_flow_id");
    params.delete("token_hash");
    params.delete("type");
    params.delete("auth_anchor");
    const query = params.toString();
    window.history.replaceState({}, document.title, `${window.location.pathname}${query ? `?${query}` : ""}${cleanHash}`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (!error) {
      await cleanAuthUrl();
    }
  }

  if (tokenHash) {
    await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    await cleanAuthUrl();
  }

  if (hash.includes("access_token")) {
    const tokenStart = hash.indexOf("access_token=");
    const tokenParams = new URLSearchParams(hash.slice(tokenStart));
    const accessToken = tokenParams.get("access_token");
    const refreshToken = tokenParams.get("refresh_token");

    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (!error) await cleanAuthUrl();
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await cleanAuthUrl();
    }
  }
}

function currentSeriesSlug() {
  return document.body.dataset.series || "blackwater-bay";
}

function currentSeriesTitle() {
  return currentSeriesSlug()
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function pendingPreferencesKey() {
  return `jsm:prefs:${currentSeriesSlug()}`;
}

function savePendingPreferences(preferences) {
  localStorage.setItem(pendingPreferencesKey(), JSON.stringify(preferences));
}

function takePendingPreferences() {
  const raw = localStorage.getItem(pendingPreferencesKey());
  if (!raw) return null;
  localStorage.removeItem(pendingPreferencesKey());
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function updatePreferences(preferences) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before updating preferences.");

  const response = await fetch(CONFIG.updatePreferencesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(preferences),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Preferences could not be saved.");
  }

  if (payload.brevo?.synced === false) {
    throw new Error(payload.brevo.reason || "Brevo contact sync failed.");
  }

  return payload;
}

async function applyPendingPreferences() {
  const pending = takePendingPreferences();
  if (!pending) return;

  try {
    await updatePreferences(pending);
  } catch {
    savePendingPreferences(pending);
  }
}

function brevoSyncKey(session) {
  return `jsm:brevo-sync:${session.user.id}`;
}

async function ensureBrevoContact() {
  const session = await getSession();
  if (!session) return;

  const key = brevoSyncKey(session);
  if (sessionStorage.getItem(key) === "done") return;

  try {
    await updatePreferences({});
    sessionStorage.setItem(key, "done");
  } catch (error) {
    console.error("Brevo contact sync failed", error);
  }
}

function syncContactInBackground(afterSync) {
  void (async () => {
    try {
      await applyPendingPreferences();
      await ensureBrevoContact();
      if (afterSync) await afterSync();
    } catch (error) {
      console.error("Background contact sync failed", error);
    }
  })();
}

async function fetchCatalog({ allowFallback = true } = {}) {
  const seriesSlug = currentSeriesSlug();
  const { data, error } = await supabase
    .from("public_episode_catalog")
    .select("*")
    .eq("series_slug", seriesSlug)
    .order("episode_number");

  if (error || !data?.length) return allowFallback ? fallbackCatalog(seriesSlug) : [];

  return data;
}

function fallbackCatalog(seriesSlug = currentSeriesSlug()) {
  return fallbackEpisodes.map((episode) => ({
    ...episode,
    series_slug: seriesSlug,
    season_number: 1,
    preview_html: "",
  }));
}

async function fetchProducts(episodeId) {
  if (!episodeId) return [];

  const { data, error } = await supabase
    .from("public_product_options")
    .select("*")
    .eq("episode_id", episodeId)
    .eq("active", true)
    .order("name");

  return error ? [] : data ?? [];
}

async function hasSeriesNotification(seriesSlug = currentSeriesSlug()) {
  const { data, error } = await supabase
    .from("user_series_notifications")
    .select("notify_new_releases,series:series_id(slug)")
    .eq("notify_new_releases", true);

  if (error) return false;

  return Boolean(data?.some((row) => row.series?.slug === seriesSlug));
}

async function renderSeriesNotificationButton(container) {
  if (!container) return;

  container.innerHTML = "";
  container.classList.remove("error");

  const session = await getSession();
  if (!session || await hasSeriesNotification()) return;

  container.innerHTML = html`
    <button class="button notify-series-button" type="button" data-notify-series>
      Notify me when the next episode of ${escapeHtml(currentSeriesTitle())} is released.
    </button>
    <p class="notice" data-notify-notice></p>
  `;

  container.querySelector("[data-notify-series]").addEventListener("click", async () => {
    const notifyNotice = container.querySelector("[data-notify-notice]");
    const notifyButton = container.querySelector("[data-notify-series]");
    notifyButton.disabled = true;

    try {
      await updatePreferences({
        series_slug: currentSeriesSlug(),
        notify_new_releases: true,
      });
      notifyNotice.textContent = "Done. You'll get Blackwater Bay release updates.";
      notifyNotice.classList.remove("error");
      notifyButton.remove();
    } catch (error) {
      notifyNotice.textContent = error.message;
      notifyNotice.classList.add("error");
      notifyButton.disabled = false;
    }
  });
}

async function renderStories() {
  const container = document.querySelector("#stories-list");
  if (!container) return;

  const { data } = await supabase
    .from("public_series_catalog")
    .select("*")
    .eq("status", "active")
    .order("title");

  const stories = data?.length ? data : [{
    title: "Blackwater Bay",
    slug: "blackwater-bay",
    description: "When a local boy disappears without a trace in a sleepy coastal town, Laura and her friends (Kit, Jules and Owen) set out to find him, and uncover the mysteries hiding beneath the surface of Blackwater Bay.",
  }];

  container.innerHTML = stories.map((story) => html`
    <a class="series-card" href="${escapeHtml(seriesPath(story.slug))}/">
      <h3>${escapeHtml(story.title)}</h3>
      <p>${escapeHtml(story.description)}</p>
    </a>
  `).join("");
}

function seriesPath(seriesSlug) {
  return seriesRoutes[seriesSlug] || seriesSlug;
}

function episodeTitleLine(episodeNumber, title) {
  return `Episode ${String(episodeNumber).padStart(2, "0")} | ${title}`;
}

function formatProductPrice(product) {
  const amountCents = Number(product.display_amount_cents);
  const currency = String(product.display_currency || "AUD").toUpperCase();

  if (!Number.isFinite(amountCents)) return "A$8.00";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(amountCents / 100);
}

function trackBeginCheckout(productId) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: "begin_checkout",
    product_id: productId,
  });
}

function renderNextEpisodeNav(container, catalog, episode) {
  if (!container || !episode) return;

  const nextEpisode = catalog.find((item) => item.published && item.episode_number > episode.episode_number);
  if (nextEpisode) {
    container.innerHTML = html`
      <a class="button secondary" href="/blackwater/episode/?e=${nextEpisode.episode_number}">
        Next: Episode ${String(nextEpisode.episode_number).padStart(2, "0")}
      </a>
    `;
    return;
  }

  container.innerHTML = html`
    <a class="button secondary" href="/blackwater/">Back to Blackwater Bay</a>
  `;
}

async function renderSeries() {
  const { data } = await supabase
    .from("public_series_catalog")
    .select("*")
    .eq("slug", currentSeriesSlug())
    .maybeSingle();

  if (data) {
    document.querySelector("#series-title").textContent = data.title;
    document.querySelector("#series-description").textContent = data.description;
  }

  await renderEpisodeDirectory();
}

async function renderSeason() {
  await renderEpisodeDirectory();
}

async function renderEpisodeDirectory() {
  const container = document.querySelector("#episode-list");
  if (!container) return;

  renderEpisodeDirectoryControls(fallbackCatalog(), container);
  const episodes = await fetchCatalog({ allowFallback: false });
  if (episodes.length) renderEpisodeDirectoryControls(episodes, container);
}

function renderEpisodeDirectoryControls(episodes, container) {
  const seasonSelect = document.querySelector("#season-filter");
  const requestedSeason = document.body.dataset.seasonFilter || new URLSearchParams(window.location.search).get("season") || "all";
  const seasons = [...new Set(episodes.map((episode) => episode.season_number ?? 1))].sort((a, b) => a - b);

  if (seasonSelect) {
    seasonSelect.innerHTML = html`
      <option value="all" ${requestedSeason === "all" ? "selected" : ""}>All Seasons</option>
      ${seasons.map((season) => html`
        <option value="${season}" ${String(season) === String(requestedSeason) ? "selected" : ""}>Season ${season}</option>
      `).join("")}
    `;
    seasonSelect.addEventListener("change", () => {
      renderEpisodeRows(episodes, seasonSelect.value, container);
    });
  }

  renderEpisodeRows(episodes, requestedSeason, container);
}

function renderEpisodeRows(episodes, selectedSeason, container) {
  const readerBase = document.body.dataset.readerBase || "episode/";
  const filtered = selectedSeason === "all"
    ? episodes
    : episodes.filter((episode) => String(episode.season_number ?? 1) === String(selectedSeason));

  const rows = filtered.map((episode) => {
    const href = `${readerBase}?e=${episode.episode_number}`;
    const tag = episode.published ? "a" : "article";
    const hrefAttribute = episode.published ? ` href="${href}"` : "";
    const status = episode.published ? "" : "Not yet published.";

    return html`
      <${tag} class="episode-row"${hrefAttribute}>
        <span class="episode-thumb" aria-hidden="true"></span>
        <div class="episode-copy">
          <h3>${escapeHtml(episodeTitleLine(episode.episode_number, episode.title))}</h3>
          ${status ? `<p>${status}</p>` : ""}
        </div>
        ${episode.published ? "" : `<span class="status-pill">Coming Soon</span>`}
      </${tag}>
    `;
  }).join("");

  container.innerHTML = `<h2 class="season-heading">${selectedSeason === "all" ? "All Episodes" : `Season ${selectedSeason}`}</h2>${rows}`;
}

function renderAuthPanel(container, { compact = false, seriesSlug = currentSeriesSlug(), seriesTitle = currentSeriesTitle() } = {}) {
  if (!compact) {
    renderReaderAuthChoice(container, { seriesSlug, seriesTitle });
    return;
  }

  renderAccountAuthChoice(container, { seriesSlug, seriesTitle });
}

function renderReaderAuthChoice(container, { seriesSlug = currentSeriesSlug(), seriesTitle = currentSeriesTitle() } = {}) {
  container.innerHTML = html`
    <div class="paywall-intro">
      <h1><span class="blue-text">Hey there,</span> you have reached the end of this episode preview.</h1>
      <h3>To keep reading, unlock Season 1, Part 1 of Blackwater Bay (Episodes 1 - 5).</h3>
      <p class="paywall-step-copy">Start by creating a free account or logging in.</p>
      <div class="paywall-choice-actions">
        <button class="button paywall-primary" type="button" data-auth-mode="signup">Sign Up</button>
        <button class="button" type="button" data-auth-mode="login">Log In</button>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      renderReaderAuthForm(container, {
        mode: button.dataset.authMode,
        seriesSlug,
        seriesTitle,
      });
    });
  });
}

function renderEmailSentState(container, { mode, onRetry, context = "reader" }) {
  let seconds = 60;
  const continueCopy = context === "reader"
    ? "Continue reading using the sign-in link."
    : "Continue using the sign-in link.";

  container.innerHTML = html`
    <div class="paywall-form email-sent-state">
      <h1>We have sent a one-time sign-in link to your email.</h1>
      <p>If you can't see it, it may have gone to your spam folder.</p>
      <p>${continueCopy}</p>
      <p class="notice error" data-retry-warning>Wait a minute before trying again.</p>
      <button class="button paywall-primary" type="button" data-retry-auth disabled>Try again (${seconds})</button>
    </div>
  `;

  const retry = container.querySelector("[data-retry-auth]");
  const warning = container.querySelector("[data-retry-warning]");
  const timer = window.setInterval(() => {
    seconds -= 1;
    if (seconds > 0) {
      retry.textContent = `Try again (${seconds})`;
      return;
    }

    window.clearInterval(timer);
    retry.textContent = "Try again";
    retry.disabled = false;
    warning.classList.add("hidden");
  }, 1000);

  retry.addEventListener("click", () => {
    if (retry.disabled) return;
    onRetry(mode);
  });
}

function renderReaderAuthForm(container, { mode, seriesSlug = currentSeriesSlug(), seriesTitle = currentSeriesTitle() } = {}) {
  const isSignup = mode !== "login";

  container.innerHTML = html`
    <div class="paywall-form">
      <h1>${isSignup ? "Create your free JSM Stories account." : "Log in to your JSM Stories account."}</h1>
      <input type="email" autocomplete="email" placeholder="Your email" data-auth-email>
      ${isSignup ? html`
        <div class="consent-list">
          <label>
            <input type="checkbox" data-marketing-consent>
            <span>Email me about JSM Stories releases and promotions.</span>
          </label>
          <label>
            <input type="checkbox" data-series-notification checked>
            <span>Notify me when new episodes of ${escapeHtml(seriesTitle)} come out.</span>
          </label>
        </div>
      ` : ""}
      <button class="button paywall-primary" type="button" data-send-code>
        ${isSignup ? "Sign up and email me a sign-in link" : "Email me a log-in link"}
      </button>
      ${isSignup ? html`
        <p class="terms-note">
          By signing up you agree to the Jump Ship Media / JSM Stories <a href="/terms-jsmstories/">terms</a> and <a href="/privacy-policy-jsmstories/">privacy policy</a>.
        </p>
      ` : ""}
      <button class="text-button" type="button" data-switch-auth>
        ${isSignup ? "Already have an account? Log in" : "Need an account? Sign up"}
      </button>
      <p class="notice" data-auth-notice></p>
    </div>
  `;

  container.querySelector("[data-switch-auth]").addEventListener("click", () => {
    renderReaderAuthForm(container, {
      mode: isSignup ? "login" : "signup",
      seriesSlug,
      seriesTitle,
    });
  });

  container.querySelector("[data-send-code]").addEventListener("click", async () => {
    const email = container.querySelector("[data-auth-email]").value.trim();
    const notice = container.querySelector("[data-auth-notice]");
    if (!email) {
      notice.textContent = "Enter your email first.";
      notice.classList.add("error");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: isSignup,
        emailRedirectTo: authReturnUrl(),
      },
    });

    if (isSignup) {
      savePendingPreferences({
        marketing_consent: container.querySelector("[data-marketing-consent]").checked,
        series_slug: seriesSlug,
        notify_new_releases: container.querySelector("[data-series-notification]").checked,
      });
    }

    if (error) {
      notice.textContent = error.message;
      notice.classList.add("error");
      return;
    }

    renderEmailSentState(container, {
      mode,
      context: "reader",
      onRetry: (nextMode) => renderReaderAuthForm(container, {
        mode: nextMode,
        seriesSlug,
        seriesTitle,
      }),
    });
  });
}

function renderAccountAuthChoice(container, { seriesSlug = currentSeriesSlug(), seriesTitle = currentSeriesTitle() } = {}) {
  container.innerHTML = html`
    <div class="paywall-intro">
      <h1><span class="blue-text">Hey there,</span> you are not signed-in.</h1>
      <h3>Sign-up or log-in to access unlocked levels.</h3>
      <div class="paywall-choice-actions">
        <button class="button paywall-primary" type="button" data-auth-mode="signup">Sign Up</button>
        <button class="button" type="button" data-auth-mode="login">Log In</button>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      renderAccountAuthForm(container, {
        mode: button.dataset.authMode,
        seriesSlug,
        seriesTitle,
      });
    });
  });
}

function renderAccountAuthForm(container, { mode, seriesSlug = currentSeriesSlug(), seriesTitle = currentSeriesTitle() } = {}) {
  const isSignup = mode !== "login";

  container.innerHTML = html`
    <div class="paywall-form">
      <h1>${isSignup ? "Create your free JSM Stories account." : "Log in to your JSM Stories account."}</h1>
      <input type="email" autocomplete="email" placeholder="Your email" data-auth-email>
      ${isSignup ? html`
        <div class="consent-list">
          <label>
            <input type="checkbox" data-marketing-consent>
            <span>Email me about JSM Stories releases and promotions.</span>
          </label>
          <label>
            <input type="checkbox" data-series-notification checked>
            <span>Notify me when new episodes of ${escapeHtml(seriesTitle)} come out.</span>
          </label>
        </div>
      ` : ""}
      <button class="button paywall-primary" type="button" data-send-code>
        ${isSignup ? "Sign up and email me a sign-in link" : "Email me a log-in link"}
      </button>
      ${isSignup ? html`
        <p class="terms-note">
          By signing up you agree to the Jump Ship Media / JSM Stories <a href="/terms-jsmstories/">terms</a> and <a href="/privacy-policy-jsmstories/">privacy policy</a>.
        </p>
      ` : ""}
      <button class="text-button" type="button" data-switch-auth>
        ${isSignup ? "Already have an account? Log in" : "Need an account? Sign up"}
      </button>
      <p class="notice" data-auth-notice></p>
    </div>
  `;

  container.querySelector("[data-switch-auth]").addEventListener("click", () => {
    renderAccountAuthForm(container, {
      mode: isSignup ? "login" : "signup",
      seriesSlug,
      seriesTitle,
    });
  });

  container.querySelector("[data-send-code]").addEventListener("click", async () => {
    const email = container.querySelector("[data-auth-email]").value.trim();
    const notice = container.querySelector("[data-auth-notice]");
    if (!email) {
      notice.textContent = "Enter your email first.";
      notice.classList.add("error");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: isSignup,
        emailRedirectTo: authReturnUrl(""),
      },
    });

    if (isSignup) {
      savePendingPreferences({
        marketing_consent: container.querySelector("[data-marketing-consent]").checked,
        series_slug: seriesSlug,
        notify_new_releases: container.querySelector("[data-series-notification]").checked,
      });
    }

    if (error) {
      notice.textContent = error.message;
      notice.classList.add("error");
      return;
    }

    renderEmailSentState(container, {
      mode,
      context: "account",
      onRetry: (nextMode) => renderAccountAuthForm(container, {
        mode: nextMode,
        seriesSlug,
        seriesTitle,
      }),
    });
  });
}

function renderChangeEmailForm(container, currentEmail) {
  container.innerHTML = html`
    <div class="paywall-form">
      <h1>Change your email address.</h1>
      <p class="notice">Signed in as ${escapeHtml(currentEmail)}</p>
      <input type="email" autocomplete="email" placeholder="New email address" data-new-email>
      <button class="button paywall-primary" type="button" data-update-email>Send confirmation link</button>
      <button class="text-button" type="button" data-cancel-email-change>Cancel</button>
      <p class="notice" data-email-change-notice></p>
    </div>
  `;

  container.querySelector("[data-cancel-email-change]").addEventListener("click", () => {
    renderSignedInAccountPanel(container, currentEmail);
  });

  container.querySelector("[data-update-email]").addEventListener("click", async () => {
    const email = container.querySelector("[data-new-email]").value.trim();
    const notice = container.querySelector("[data-email-change-notice]");

    if (!email) {
      notice.textContent = "Enter your new email address first.";
      notice.classList.add("error");
      return;
    }

    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: authReturnUrl("") },
    );

    if (error) {
      notice.textContent = error.message;
      notice.classList.add("error");
      return;
    }

    container.innerHTML = html`
      <div class="paywall-form email-sent-state">
        <h1>Check your email to confirm the change.</h1>
        <p>Supabase may send confirmation links to both your current email and your new email.</p>
        <p>The new address will not be active until the confirmation step is complete.</p>
        <button class="button secondary" type="button" data-back-account>Back to account</button>
      </div>
    `;

    container.querySelector("[data-back-account]").addEventListener("click", () => {
      renderSignedInAccountPanel(container, currentEmail);
    });
  });
}

function renderSignedInAccountPanel(container, email) {
  container.innerHTML = html`
    <p class="notice">Signed in as ${escapeHtml(email)}</p>
    <button class="button paywall-primary" type="button" data-change-email>Change email address</button>
    <button class="button secondary" type="button" data-sign-out>Sign out</button>
  `;

  container.querySelector("[data-change-email]").addEventListener("click", () => {
    renderChangeEmailForm(container, email);
  });

  container.querySelector("[data-sign-out]").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.reload();
  });
}

async function renderReader() {
  const params = new URLSearchParams(window.location.search);
  const episodeNumber = Number(params.get("e") || "1");
  const purchaseState = params.get("purchase");
  const catalog = await fetchCatalog();
  const episode = catalog.find((item) => item.episode_number === episodeNumber);
  const title = document.querySelector("#reader-title");
  const meta = document.querySelector("#reader-meta");
  const accessStatus = document.querySelector("#reader-access-status");
  const preview = document.querySelector("#reader-preview");
  const paid = document.querySelector("#reader-paid");
  const paywall = document.querySelector("#reader-paywall");
  const notice = document.querySelector("#reader-notice");
  const nextNav = document.querySelector("#reader-next");
  syncContactInBackground(() => renderSeriesNotificationButton(notice));

  if (!episode || !episode.published) {
    title.textContent = "Coming Soon";
    if (accessStatus) accessStatus.textContent = "Episode preview";
    if (nextNav) {
      nextNav.innerHTML = html`<a class="button secondary" href="/blackwater/">Back to Blackwater Bay</a>`;
    }
    preview.innerHTML = "<p>This episode is not yet available.</p>";
    scrollToReaderAnchor();
    return;
  }

  document.title = `${episode.title} | JSM Stories`;
  title.textContent = episodeTitleLine(episode.episode_number, episode.title);
  meta.innerHTML = html`
    <a href="/blackwater/">Blackwater Bay</a>
    /
    <a href="/blackwater/?season=${episode.season_number ?? 1}">Season ${episode.season_number ?? 1}</a>
    /
    <a href="/blackwater/episode/?e=${episode.episode_number}">Episode ${String(episode.episode_number).padStart(2, "0")}</a>
  `;
  preview.innerHTML = episode.preview_html || "<p>Preview text will appear here once the episode is loaded into Supabase.</p>";
  if (accessStatus) accessStatus.textContent = "Episode preview";
  renderNextEpisodeNav(nextNav, catalog, episode);

  const session = await getSession();
  const productsPromise = session ? fetchProducts(episode.episode_id) : Promise.resolve([]);
  if (session) {
    void renderSeriesNotificationButton(notice);
    const paidContent = await loadPaidContent(episode.episode_id, purchaseState === "success");
    if (paidContent) {
      if (accessStatus) accessStatus.textContent = "Full episode unlocked";
      paid.innerHTML = paidContent;
      paid.classList.remove("hidden");
      paywall.classList.add("hidden");
      scrollToReaderAnchor();
      return;
    }
  }

  paywall.classList.remove("hidden");
  const authPanel = document.querySelector("#auth-panel");
  const productOptions = document.querySelector("#product-options");
  if (!session && notice) {
    notice.innerHTML = "";
    notice.classList.remove("error");
  }
  if (!session) {
    renderAuthPanel(authPanel);
    if (productOptions) productOptions.innerHTML = "";
  } else {
    authPanel.innerHTML = html`
      <div class="paywall-purchase-copy">
        <h1><span class="blue-text">Hey there,</span> you have reached the end of this episode preview.</h1>
        <h3>To continue reading, purchase Season 1, Part 1 of Blackwater Bay.</h3>
        <p>This gives you access to the first five episodes of Blackwater Bay.</p>
      </div>
    `;

    if (productOptions) {
      authPanel.append(productOptions);
    }
  }

  if (!session) {
    scrollToReaderAnchor();
    return;
  }

  const products = await productsPromise;
  productOptions.innerHTML = products.map((product) => html`
    <button class="button paywall-primary" type="button" data-product-id="${escapeHtml(product.product_id)}">
      <span>Purchase to continue reading</span>
      <span class="button-subline">Season 1, Part 1 - Blackwater Bay - ${escapeHtml(formatProductPrice(product))}</span>
    </button>
  `).join("");

  productOptions.querySelectorAll("[data-product-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const productId = button.dataset.productId;
      trackBeginCheckout(productId);

      const latestSession = await getSession();
      if (!latestSession) {
        notice.textContent = "Sign in first, then choose an unlock option.";
        notice.classList.add("error");
        return;
      }

      const response = await fetch(CONFIG.createCheckoutUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${latestSession.access_token}`,
        },
        body: JSON.stringify({
          product_id: productId,
          return_path: readerReturnPath(),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.url) {
        notice.textContent = payload.error || "Checkout could not be started.";
        notice.classList.add("error");
        return;
      }

      window.location.href = payload.url;
    });
  });

  if (!products.length) {
    productOptions.innerHTML = `<p class="notice">Purchase options will appear once products are published.</p>`;
  }

  scrollToReaderAnchor();
}

async function loadPaidContent(episodeId, shouldPoll = false) {
  const attempts = shouldPoll ? 8 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data, error } = await supabase.rpc("get_episode_paid_content", {
      requested_episode_id: episodeId,
    });

    if (!error && Array.isArray(data) && data[0]?.paid_html) return data[0].paid_html;
    if (!error && data?.paid_html) return data.paid_html;

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  return "";
}

async function renderAccount() {
  syncContactInBackground();
  const auth = document.querySelector("#account-auth");
  const library = document.querySelector("#account-library");
  const session = await getSession();

  if (!session) {
    renderAuthPanel(auth, { compact: true });
    library.innerHTML = "";
    return;
  }

  renderSignedInAccountPanel(auth, session.user.email);

  const { data } = await supabase
    .from("public_account_library")
    .select("*")
    .order("series_title")
    .order("season_number")
    .order("episode_number");

  const rows = data?.length ? data : [];
  library.innerHTML = rows.map((row) => html`
    <a class="library-row" href="../${escapeHtml(seriesPath(row.series_slug))}/episode/?e=${row.episode_number}">
      <span class="episode-thumb" aria-hidden="true"></span>
      <div class="episode-copy">
        <h3>${escapeHtml(episodeTitleLine(row.episode_number, row.episode_title))}</h3>
        <p>${escapeHtml(row.series_title)} / Season ${row.season_number}</p>
        <p class="reader-access-status">Full episode unlocked</p>
      </div>
    </a>
  `).join("") || `<p class="notice">Purchased episodes will appear here.</p>`;
}

const renderers = {
  stories: renderStories,
  series: renderSeries,
  season: renderSeason,
  reader: renderReader,
  account: renderAccount,
};

await handleAuthRedirect();
initReaderSettings();
void syncAccountNav();
await renderers[page]?.();
