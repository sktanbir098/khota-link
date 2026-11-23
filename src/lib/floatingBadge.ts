import { useEffect, useState } from 'react';

const DEFAULT_BADGE_OFFSET_PX = 80;
const BADGE_SELECTOR =
  'a[href*="netlify.com"], [id*="netlify-badge"], [class*="netlify"], iframe[src*="netlify"], div[data-netlify-badge]';

export function isNetlifyBadgeHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host.endsWith('.netlify.app') ||
    host.endsWith('.netlify.com') ||
    window.location.search.includes('netlify=1')
  );
}

function findNetlifyBadgeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(BADGE_SELECTOR);
  return el instanceof HTMLElement ? el : null;
}

function measureNetlifyBadgeOffsetPx(): number {
  const badgeEl = findNetlifyBadgeElement();
  if (badgeEl && typeof window !== 'undefined') {
    const rect = badgeEl.getBoundingClientRect();
    if (rect.height > 0 && rect.top > window.innerHeight * 0.5) {
      const fromBottom = Math.ceil(window.innerHeight - rect.top + 16);
      return Math.min(160, Math.max(DEFAULT_BADGE_OFFSET_PX, fromBottom));
    }
  }
  return isNetlifyBadgeHost() || badgeEl ? DEFAULT_BADGE_OFFSET_PX : 0;
}

function syncDocumentBadgeState(active: boolean, offsetPx: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (active) {
    root.dataset.netlifyBadge = 'true';
    root.style.setProperty('--netlify-badge-offset', `${offsetPx}px`);
  } else {
    delete root.dataset.netlifyBadge;
    root.style.setProperty('--netlify-badge-offset', '0px');
  }
}

// Apply immediately on load so CSS custom properties are ready on first paint
if (typeof window !== 'undefined') {
  const initialActive = isNetlifyBadgeHost() || Boolean(findNetlifyBadgeElement());
  syncDocumentBadgeState(initialActive, initialActive ? measureNetlifyBadgeOffsetPx() : 0);
}

export function useFloatingBadgeClearance(): boolean {
  const [needsClearance, setNeedsClearance] = useState<boolean>(
    () => isNetlifyBadgeHost() || Boolean(findNetlifyBadgeElement())
  );

  useEffect(() => {
    const update = () => {
      const badgeEl = findNetlifyBadgeElement();
      const active = isNetlifyBadgeHost() || Boolean(badgeEl);
      const offsetPx = active ? measureNetlifyBadgeOffsetPx() : 0;
      syncDocumentBadgeState(active, offsetPx);
      setNeedsClearance(active);
    };

    update();
    const observer = new MutationObserver(update);
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('resize', update);
    const t1 = window.setTimeout(update, 600);
    const t2 = window.setTimeout(update, 2000);
    const t3 = window.setTimeout(() => observer.disconnect(), 10000);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  return needsClearance;
}
