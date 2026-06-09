import { createApp, type App as VueApp } from 'vue';
import Overlay from './overlay/Overlay.vue';
import styles from './overlay/overlay.scss?inline';
import type { OpenTab } from './shared/messages';

const GET_OPEN_TABS_MESSAGE = 'motion-fss:get-open-tabs';
const CLOSE_OVERLAY_MESSAGE = 'motion-fss:close-overlay';
const TOGGLE_OVERLAY_MESSAGE = 'motion-fss:toggle-overlay';

const ROOT_ID = 'motion-fss-overlay-root';

let host: HTMLDivElement | null = null;
let app: VueApp<Element> | null = null;

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
