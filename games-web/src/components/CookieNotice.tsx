import { useEffect, useState } from "react";

const DISMISS_COOKIE_KEY = "jsm_cookie_notice_dismissed";
const DISMISS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const AUTO_HIDE_MS = 30_000;

function hasDismissCookie(): boolean {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${DISMISS_COOKIE_KEY}=`));
}

function writeDismissCookie() {
  document.cookie = `${DISMISS_COOKIE_KEY}=1; Max-Age=${DISMISS_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

export default function CookieNotice() {
  const [mounted, setMounted] = useState<boolean>(false);
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    if (hasDismissCookie()) {
      return;
    }

    setMounted(true);
    const showTimer = window.setTimeout(() => setVisible(true), 20);
    const autoHideTimer = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => setMounted(false), 300);
    }, AUTO_HIDE_MS);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(autoHideTimer);
    };
  }, []);

  if (!mounted) {
    return null;
  }

  const dismiss = () => {
    writeDismissCookie();
    setVisible(false);
    window.setTimeout(() => setMounted(false), 300);
  };

  return (
    <div className={`cookie-notice ${visible ? "is-visible" : ""}`} role="status" aria-live="polite">
      <span className="cookie-notice-text">
        <b>Cookies:</b> We use essential storage/cookies and may show Google Ads. Read our{" "}
        <a href="/privacy-policy/" target="_blank" rel="noreferrer">
          Privacy policy
        </a>
        .
      </span>
      <button type="button" className="cookie-notice-btn" onClick={dismiss}>
        Ok
      </button>
    </div>
  );
}
