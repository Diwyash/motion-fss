const ACTIVATE_TAB_MESSAGE = 'motion-fss:activate-tab';
const CLOSE_TAB_MESSAGE = 'motion-fss:close-tab';
const CLOSE_OVERLAY_MESSAGE = 'motion-fss:close-overlay';
const GET_OPEN_TABS_MESSAGE = 'motion-fss:get-open-tabs';
const OPEN_GROUP_TABS_MESSAGE = 'motion-fss:open-group-tabs';
const OPEN_NEW_TAB_MESSAGE = 'motion-fss:open-new-tab';
const OPEN_URL_MESSAGE = 'motion-fss:open-url';
const TOGGLE_OVERLAY_MESSAGE = 'motion-fss:toggle-overlay';

const TOGGLE_COMMAND = 'toggle-overlay';
let activeTabId: number | null = null;

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== TOGGLE_COMMAND) {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: TOGGLE_OVERLAY_MESSAGE }, () => {
    void chrome.runtime.lastError;
    // Chrome internal pages and extension store pages do not accept content scripts.
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (typeof activeTabId === 'number' && activeTabId !== tabId) {
    chrome.tabs.sendMessage(activeTabId, { type: CLOSE_OVERLAY_MESSAGE }, () => {
      void chrome.runtime.lastError;
    });
  }

  activeTabId = tabId;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === GET_OPEN_TABS_MESSAGE) {
    chrome.tabs
      .query({ currentWindow: true })
      .then((tabs) =>
        tabs
          .filter((tab) => typeof tab.id === 'number')
          .map((tab) => ({
            id: tab.id as number,
            title: tab.title ?? '',
            url: tab.url ?? '',
            favIconUrl: tab.favIconUrl ?? null,
            active: Boolean(tab.active),
            index: tab.index
          }))
      )
      .then((tabs) => sendResponse({ tabs }))
      .catch(() => sendResponse({ tabs: [] }));

    return true;
  }

  if (message?.type === ACTIVATE_TAB_MESSAGE && typeof message.tabId === 'number') {
    chrome.tabs.update(message.tabId, { active: true }, () => {
      void chrome.runtime.lastError;
    });
    if (typeof activeTabId === 'number' && activeTabId !== message.tabId) {
      chrome.tabs.sendMessage(activeTabId, { type: CLOSE_OVERLAY_MESSAGE }, () => {
        void chrome.runtime.lastError;
      });
    }
    return;
  }

  if (message?.type === OPEN_NEW_TAB_MESSAGE) {
    chrome.tabs.create({ active: true }, () => {
      void chrome.runtime.lastError;
    });
    return;
  }

  if (message?.type === OPEN_URL_MESSAGE && typeof message.url === 'string' && message.url.length > 0) {
    if (message.currentTab) {
      chrome.tabs.update({ url: message.url }, () => {
        void chrome.runtime.lastError;
      });
    } else {
      chrome.tabs.create({ url: message.url, active: true }, () => {
        void chrome.runtime.lastError;
      });
    }
    return;
  }

  if (message?.type === CLOSE_TAB_MESSAGE && typeof message.tabId === 'number') {
    chrome.tabs.remove(message.tabId, () => {
      void chrome.runtime.lastError;
      sendResponse({ closed: true });
    });
    return true;
  }

  if (message?.type === 'motion-fss:go-back') {
    chrome.tabs.goBack(() => {
      void chrome.runtime.lastError;
    });
  }

  if (message?.type === 'motion-fss:go-forward') {
    chrome.tabs.goForward(() => {
      void chrome.runtime.lastError;
    });
  }

  if (message?.type === 'motion-fss:open-shortcuts-page') {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    return;
  }

  if (message?.type === 'motion-fss:toggle-fullscreen') {
    void chrome.windows.getCurrent().then((win) => {
      if (win.state === 'fullscreen') {
        chrome.windows.update(win.id!, { state: 'normal' });
      } else {
        chrome.windows.update(win.id!, { state: 'fullscreen' });
      }
    });
    return;
  }

  if (message?.type === OPEN_GROUP_TABS_MESSAGE && Array.isArray(message.urls) && message.urls.length) {
    const urls = message.urls as string[];
    const newWindow = Boolean(message.newWindow);
    if (newWindow) {
      chrome.windows.create({ url: urls, focused: true }, () => {
        void chrome.runtime.lastError;
      });
    } else {
      // Check if any of the URLs are already open in the current window
      chrome.tabs.query({ currentWindow: true }, (existingTabs) => {
        const existingUrls = new Set(existingTabs.map((t) => t.url?.replace(/\/$/, '')));
        const toOpen: string[] = [];
        for (const url of urls) {
          if (!existingUrls.has(url.replace(/\/$/, ''))) {
            toOpen.push(url);
          }
        }
        if (toOpen.length) {
          // Open remaining tabs
          for (const url of toOpen) {
            chrome.tabs.create({ url, active: false }, () => {
              void chrome.runtime.lastError;
            });
          }
        }
      });
    }
    return;
  }

  if (message?.type === 'motion-fss:toggle-maximize') {
    void chrome.windows.getCurrent().then((win) => {
      if (win.state === 'maximized') {
        chrome.windows.update(win.id!, { state: 'normal' });
      } else {
        chrome.windows.update(win.id!, { state: 'maximized' });
      }
    });
    return;
  }

  if (message?.type === 'motion-fss:check-fullscreen') {
    chrome.windows.getCurrent().then((win) => {
      sendResponse({ fullscreen: win.state === 'fullscreen' });
    }).catch(() => sendResponse({ fullscreen: false }));
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('motion-fss:settings')
    .then((stored) => {
      const settings = stored['motion-fss:settings'] as Record<string, unknown> | undefined;
      if (settings?.toggleFullscreenOnOpen) {
        void chrome.windows.getCurrent().then((win) => {
          if (win.state !== 'fullscreen') {
            chrome.windows.update(win.id!, { state: 'fullscreen' });
          }
        });
      }
    })
    .catch(() => {});
});
