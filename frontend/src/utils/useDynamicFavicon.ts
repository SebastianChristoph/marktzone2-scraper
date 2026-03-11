import { useEffect } from "react";

const DEFAULT_FAVICON = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#1976d2"/>
  <text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="white">MZ</text>
</svg>
`)}`;

const SCRAPING_FAVICON = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#1976d2"/>
  <text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="white">MZ</text>
  <circle cx="26" cy="6" r="5" fill="#f44336">
    <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/>
  </circle>
</svg>
`)}`;

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

export function useDynamicFavicon() {
  useEffect(() => {
    setFavicon(DEFAULT_FAVICON);

    let active = false;

    async function check() {
      try {
        const res = await fetch("/api/jobs");
        if (!res.ok) return;
        const jobs: { status: string }[] = await res.json();
        const hasActive = jobs.some(
          (j) => j.status === "pending" || j.status === "running"
        );
        const newActive = hasActive;
        if (newActive !== active) {
          active = newActive;
          setFavicon(active ? SCRAPING_FAVICON : DEFAULT_FAVICON);
        }
      } catch {
        // non-critical
      }
    }

    check();
    const id = setInterval(check, 3000);
    return () => {
      clearInterval(id);
      setFavicon(DEFAULT_FAVICON);
    };
  }, []);
}
