export const TOGGLE_OVERLAY_MESSAGE = 'motion-fss:toggle-overlay';
export const GET_OPEN_TABS_MESSAGE = 'motion-fss:get-open-tabs';
export const ACTIVATE_TAB_MESSAGE = 'motion-fss:activate-tab';

export type OpenTab = {
  id: number;
  title: string;
  url: string;
  favIconUrl: string | null;
  active: boolean;
  index: number;
};

export type ExtensionMessage =
  | { type: typeof TOGGLE_OVERLAY_MESSAGE }
  | { type: typeof GET_OPEN_TABS_MESSAGE }
  | { type: typeof ACTIVATE_TAB_MESSAGE; tabId: number };
