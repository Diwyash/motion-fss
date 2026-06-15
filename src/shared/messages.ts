export const TOGGLE_OVERLAY_MESSAGE = 'motion-fss:toggle-overlay';
export const GET_OPEN_TABS_MESSAGE = 'motion-fss:get-open-tabs';
export const ACTIVATE_TAB_MESSAGE = 'motion-fss:activate-tab';
export const OPEN_GROUP_TABS_MESSAGE = 'motion-fss:open-group-tabs';

export type OpenTab = {
  id: number;
  title: string;
  url: string;
  favIconUrl: string | null;
  active: boolean;
  index: number;
};

export type GroupTabRecord = {
  id: string;
  sourceTabId: number | null;
  title: string;
  url: string;
  favIconUrl: string | null;
};

export type ExtensionMessage =
  | { type: typeof TOGGLE_OVERLAY_MESSAGE }
  | { type: typeof GET_OPEN_TABS_MESSAGE }
  | { type: typeof ACTIVATE_TAB_MESSAGE; tabId: number }
  | { type: typeof OPEN_GROUP_TABS_MESSAGE; urls: string[]; newWindow: boolean };
