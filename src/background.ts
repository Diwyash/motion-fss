const ACTIVATE_TAB_MESSAGE = 'motion-fss:activate-tab';
const CLOSE_TAB_MESSAGE = 'motion-fss:close-tab';
const CLOSE_OVERLAY_MESSAGE = 'motion-fss:close-overlay';
const GET_OPEN_TABS_MESSAGE = 'motion-fss:get-open-tabs';
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
    });
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
});
