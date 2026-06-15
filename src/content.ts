import { createApp, type App as VueApp } from 'vue';
import Overlay from './overlay/Overlay.vue';
import styles from './overlay/overlay.scss?inline';
import type { OpenTab } from './shared/messages';

const GET_OPEN_TABS_MESSAGE = 'motion-fss:get-open-tabs';
const CLOSE_OVERLAY_MESSAGE = 'motion-fss:close-overlay';
const TOGGLE_OVERLAY_MESSAGE = 'motion-fss:toggle-overlay';
const SETTINGS_STORAGE_KEY = 'motion-fss:settings';

const ROOT_ID = 'motion-fss-overlay-root';
const BADGE_ID = 'motion-fss-badge';

let host: HTMLDivElement | null = null;
let app: VueApp<Element> | null = null;

// ── Page-loading badge (top-right, outside overlay) ──────────────────────
async function createBadge() {
  if (document.getElementById(BADGE_ID)) return;

  // Check settings: only show badge if enabled
  let showBadge = true;
  try {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    const saved = stored[SETTINGS_STORAGE_KEY] as Record<string, unknown> | undefined;
    if (saved && typeof saved.showBadge === 'boolean') {
      showBadge = saved.showBadge;
    }
  } catch {
    // defaults apply
  }
  if (!showBadge) return;

  // Check fullscreen — only show badge in fullscreen mode
  let isFullscreen = false;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'motion-fss:check-fullscreen' });
    isFullscreen = response?.fullscreen === true;
  } catch {
    // Not in fullscreen, skip badge
  }
  if (!isFullscreen) return;

  const badge = document.createElement('div');
  badge.id = BADGE_ID;
  Object.assign(badge.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderRadius: '10px',
    background: 'rgba(255, 255, 255, 0.12)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '700',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    letterSpacing: '0.03em',
    lineHeight: '1',
    pointerEvents: 'none',
    opacity: '0',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
    transform: 'scale(0.9)',
    transition: 'opacity 0.35s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)'
  });
  badge.textContent = 'Loading tabs\u2026';

  // Pulsing dot
  const dot = document.createElement('span');
  dot.textContent = '⬤';
  Object.assign(dot.style, {
    fontSize: '10px',
    color: '#a5b4fc',
    display: 'inline-block',
    animation: 'motion-fss-badge-pulse 0.8s ease-in-out infinite'
  });
  badge.prepend(dot);

  // Inject keyframes
  if (!document.getElementById('motion-fss-badge-styles')) {
    const style = document.createElement('style');
    style.id = 'motion-fss-badge-styles';
    style.textContent = `
      @keyframes motion-fss-badge-pulse {
        0%, 100% { opacity: 0.5; transform: scale(0.9); }
        50%      { opacity: 1;   transform: scale(1.15); }
      }
    `;
    document.documentElement.appendChild(style);
  }

  document.documentElement.appendChild(badge);

  // Fade in immediately
  requestAnimationFrame(() => {
    badge.style.opacity = '1';
    badge.style.transform = 'scale(1)';
  });

  // Hide badge when the page finishes loading
  function hideBadge() {
    badge.style.opacity = '0';
    badge.style.transform = 'scale(0.9)';
    setTimeout(() => badge.remove(), 400);
  }

  if (document.readyState === 'complete') {
    // Page already loaded — hide immediately
    hideBadge();
  } else {
    window.addEventListener('load', hideBadge, { once: true });
    // Safety fallback: hide after 10s regardless
    setTimeout(() => {
      if (document.getElementById(BADGE_ID)) hideBadge();
    }, 10000);
  }
}

void createBadge();

async function createOverlay() {
  host = document.createElement('div');
  host.id = ROOT_ID;

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  const mountPoint = document.createElement('div');

  style.textContent = styles;
  shadow.append(style, mountPoint);

  const tabs = await fetchOpenTabs();
  const selectedTabId = tabs.find((tab) => tab.active)?.id ?? tabs[0]?.id ?? null;

  app = createApp(Overlay, {
    tabs,
    selectedTabId,
    onClose: destroyOverlay
  });
  app.mount(mountPoint);

  document.documentElement.append(host);
}

function destroyOverlay() {
  app?.unmount();
  app = null;
  host?.remove();
  host = null;
}

async function toggleOverlay() {
  if (host) {
    destroyOverlay();
    return;
  }

  await createOverlay();
}

function fetchOpenTabs(): Promise<OpenTab[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: GET_OPEN_TABS_MESSAGE }, (response) => {
      void chrome.runtime.lastError;
      resolve(response?.tabs ?? []);
    });
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === TOGGLE_OVERLAY_MESSAGE) {
    void toggleOverlay();
    return;
  }

  if (message?.type === CLOSE_OVERLAY_MESSAGE) {
    destroyOverlay();
  }
});
