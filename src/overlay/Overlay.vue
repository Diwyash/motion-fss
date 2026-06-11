<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { OpenTab } from '../shared/messages';
import { getTabFallbackTitle } from '../shared/tabUtils';

const ACTIVATE_TAB_MESSAGE = 'motion-fss:activate-tab';
const CLOSE_TAB_MESSAGE = 'motion-fss:close-tab';
const OPEN_NEW_TAB_MESSAGE = 'motion-fss:open-new-tab';
const OPEN_URL_MESSAGE = 'motion-fss:open-url';
const GO_BACK_MESSAGE = 'motion-fss:go-back';
const GO_FORWARD_MESSAGE = 'motion-fss:go-forward';
const GROUPS_STORAGE_KEY = 'motion-fss:groups';
const QUICK_LINKS_STORAGE_KEY = 'motion-fss:quick-links';
const ACTIVE_GROUP_STORAGE_KEY = 'motion-fss:active-group';
const MAX_QUICK_LINKS = 9;

type QuickLink = {
  id: string;
  name: string;
  url: string;
  favIconUrl: string;
};

type GroupTabRecord = {
  id: string;
  sourceTabId: number | null;
  title: string;
  url: string;
  favIconUrl: string | null;
};

type GroupRecord = {
  id: string;
  name: string;
  collapsed: boolean;
  tabs: GroupTabRecord[];
};

type ItemMenuState = {
  groupId: string;
  tabId: string;
  x: number;
  y: number;
} | null;

type EditingState = {
  groupId: string;
  tabId: string;
  title: string;
} | null;

type GroupDragState = {
  groupId: string;
  tabId: string;
} | null;

type GroupMenuPos = {
  groupId: string;
  x: number;
  y: number;
} | null;

type SearchSuggestion = {
  id: string;
  title: string;
  url: string;
  favIconUrl: string | null;
  source: 'tab' | 'group';
  tabId?: number;
  score: number;
};

const props = defineProps<{
  tabs: OpenTab[];
  selectedTabId: number | null;
  onClose: () => void;
}>();

const GET_OPEN_TABS_MESSAGE = 'motion-fss:get-open-tabs';

const localTabs = ref<OpenTab[]>([...props.tabs]);
const selectedIndex = ref(0);
const selectedTab = computed(() => localTabs.value[selectedIndex.value] ?? null);

function fetchOpenTabs() {
  chrome.runtime.sendMessage({ type: GET_OPEN_TABS_MESSAGE }, (response) => {
    void chrome.runtime.lastError;
    const fetchedTabs: OpenTab[] = response?.tabs ?? [];
    localTabs.value = fetchedTabs;
    syncSelection(props.selectedTabId);
  });
}
const groups = ref<GroupRecord[]>([]);
const hydrated = ref(false);
const isNewGroupOpen = ref(false);
const newGroupName = ref('');
const newGroupInput = ref<HTMLInputElement | null>(null);
const newGroupPopup = ref<{ x: number; y: number } | null>(null);
const activeGroupId = ref<string | null>(null);
const activeItemMenu = ref<ItemMenuState>(null);
const activeGroupMenu = ref<GroupMenuPos>(null);
const editingItem = ref<EditingState>(null);
const editItemPopup = ref<{ x: number; y: number } | null>(null);
const editingGroup = ref<{ groupId: string; name: string } | null>(null);
const editGroupPopup = ref<{ x: number; y: number } | null>(null);
const showSettings = ref(false);
const quickLinks = ref<QuickLink[]>([]);
const searchInput = ref<HTMLInputElement | null>(null);
const isNewQuickLinkOpen = ref(false);
const newQuickLinkPopup = ref<{ x: number; y: number } | null>(null);
const newQuickLinkUrl = ref('');
const newQuickLinkInput = ref<HTMLInputElement | null>(null);
const searchQuery = ref('');
const searchSuggestions = computed((): SearchSuggestion[] => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return [];

  const results: SearchSuggestion[] = [];
  const seen = new Set<string>();

  for (const group of groups.value) {
    for (const tab of group.tabs) {
      const title = (tab.title ?? '').toLowerCase();
      const url = (tab.url ?? '').toLowerCase();
      const normUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const key = normUrl || title;
      if (seen.has(key)) continue;
      seen.add(key);

      const titleMatch = title.includes(q);
      const urlMatch = url.includes(q);
      if (!titleMatch && !urlMatch) continue;

      let score = 0;
      if (title === q) score = 100;
      else if (title.startsWith(q)) score = 80;
      else if (titleMatch) score = 60;
      else if (url.startsWith(q)) score = 40;
      else if (urlMatch) score = 20;

      results.push({ id: tab.id, title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl, source: 'group', score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 8);
});
const searchSelectedIndex = ref(-1);
const isSearchFocused = ref(false);
const isSearchActive = computed(() => searchQuery.value.length > 0 && isSearchFocused.value);
const dragTabId = ref<number | null>(null);
const dragOverGroupId = ref<string | null>(null);
const dragGroupId = ref<string | null>(null);
const dragOverGroupIndex = ref<string | null>(null);
const draggingGroupItem = ref<GroupDragState>(null);
const dragOverGroupItem = ref<GroupDragState>(null);

function toggleGroupMenu(groupId: string, event: MouseEvent) {
  closeAllPopups();
  activeGroupMenu.value = activeGroupMenu.value?.groupId === groupId ? null : { groupId, x: event.clientX, y: event.clientY };
  event.stopPropagation();
}

function deleteGroup(groupId: string) {
  groups.value = groups.value.filter((entry) => entry.id !== groupId);
  activeGroupMenu.value = null;
  if (activeGroupId.value === groupId) {
    activeGroupId.value = null;
  }
}

function openAllGroupTabs(groupId: string) {
  const group = groups.value.find((entry) => entry.id === groupId);
  if (!group) return;
  for (const tab of group.tabs) {
    sendMessage(OPEN_URL_MESSAGE, { url: tab.url });
  }
  activeGroupMenu.value = null;
}

function startEditGroup(groupId: string, name: string, event: MouseEvent) {
  closeAllPopups();
  editingGroup.value = { groupId, name };
  editGroupPopup.value = { x: event.clientX, y: event.clientY };
  event.stopPropagation();
}

function saveEditGroup() {
  if (!editingGroup.value) return;
  const group = groups.value.find((entry) => entry.id === editingGroup.value?.groupId);
  if (group) {
    group.name = editingGroup.value.name.trim() || group.name;
    groups.value = [...groups.value];
  }
  editingGroup.value = null;
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneGroups(value: GroupRecord[]) {
  return value.map((group) => ({
    id: group.id,
    name: group.name,
    collapsed: group.collapsed,
    tabs: group.tabs.map((tab) => ({
      id: tab.id,
      sourceTabId: tab.sourceTabId,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl
    }))
  }));
}

function syncSelection(tabId: number | null) {
  const nextIndex = localTabs.value.findIndex((tab) => tab.id === tabId);
  selectedIndex.value = nextIndex >= 0 ? nextIndex : 0;
}

function moveSelection(delta: number) {
  if (!localTabs.value.length) {
    return;
  }

  selectedIndex.value = (selectedIndex.value + delta + localTabs.value.length) % localTabs.value.length;
}

function sendMessage(type: string, payload: Record<string, unknown> = {}) {
  chrome.runtime.sendMessage({ type, ...payload }, () => {
    void chrome.runtime.lastError;
  });
}

function activateSelectedTab() {
  const tab = selectedTab.value;
  if (!tab) {
    return;
  }

  sendMessage(ACTIVATE_TAB_MESSAGE, { tabId: tab.id });
  props.onClose();
}

function openSuggestion(suggestion: SearchSuggestion) {
  if (suggestion.source === 'tab' && suggestion.tabId) {
    sendMessage(ACTIVATE_TAB_MESSAGE, { tabId: suggestion.tabId });
  } else {
    const existingTab = localTabs.value.find((t) => t.url === suggestion.url || t.url.replace(/\/$/, '') === suggestion.url.replace(/\/$/, ''));
    if (existingTab?.id) {
      sendMessage(ACTIVATE_TAB_MESSAGE, { tabId: existingTab.id });
    } else {
      sendMessage(OPEN_URL_MESSAGE, { url: suggestion.url });
    }
  }
  props.onClose();
}

function closeTab(tab: OpenTab) {
  localTabs.value = localTabs.value.filter((t) => t.id !== tab.id);
  chrome.runtime.sendMessage(
    { type: CLOSE_TAB_MESSAGE, tabId: tab.id },
    () => {
      void chrome.runtime.lastError;
      setTimeout(() => fetchOpenTabs(), 100);
    }
  );
}

function openNewTab() {
  sendMessage(OPEN_NEW_TAB_MESSAGE);
  props.onClose();
}

function openNewGroup(event: MouseEvent) {
  closeAllPopups();
  isNewGroupOpen.value = true;
  newGroupName.value = '';
  newGroupPopup.value = { x: event.clientX, y: event.clientY };
  event.stopPropagation();
  void nextTick(() => {
    newGroupInput.value?.focus();
  });
}

function closeNewGroup() {
  isNewGroupOpen.value = false;
  newGroupName.value = '';
}

function createGroup() {
  const name = newGroupName.value.trim();
  if (!name) {
    return;
  }

  groups.value = [
    ...groups.value,
    {
      id: createId('group'),
      name,
      collapsed: false,
      tabs: []
    }
  ];

  closeNewGroup();
}

function toggleGroup(groupId: string) {
  const group = groups.value.find((entry) => entry.id === groupId);
  if (!group) {
    return;
  }

  group.collapsed = !group.collapsed;
}

function findGroupTab(groupId: string, tabId: string) {
  const group = groups.value.find((entry) => entry.id === groupId);
  const tabIndex = group?.tabs.findIndex((entry) => entry.id === tabId) ?? -1;
  return { group, tabIndex };
}

function insertGroupTab(group: GroupRecord, tab: GroupTabRecord, index = group.tabs.length) {
  if (group.tabs.some((entry) => entry.sourceTabId === tab.sourceTabId || entry.url === tab.url)) {
    return;
  }

  const nextTabs = [...group.tabs];
  const safeIndex = Math.min(Math.max(index, 0), nextTabs.length);
  nextTabs.splice(safeIndex, 0, tab);
  group.tabs = nextTabs;
}

function addTabToGroup(groupId: string, tabId: number) {
  const group = groups.value.find((entry) => entry.id === groupId);
  const tab = localTabs.value.find((entry) => entry.id === tabId);

  if (!group || !tab) {
    return;
  }

  insertGroupTab(group, {
    id: createId('tab'),
    sourceTabId: tab.id,
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl
  });

  groups.value = [...groups.value];
}

function moveGroupTab(sourceGroupId: string, tabId: string, targetGroupId: string, targetIndex: number) {
  const source = groups.value.find((entry) => entry.id === sourceGroupId);
  const target = groups.value.find((entry) => entry.id === targetGroupId);

  if (!source || !target) {
    return;
  }

  const sourceIndex = source.tabs.findIndex((entry) => entry.id === tabId);
  if (sourceIndex < 0) {
    return;
  }

  const [tab] = source.tabs.splice(sourceIndex, 1);
  const adjustedTargetIndex =
    sourceGroupId === targetGroupId && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;

  const nextIndex = Math.min(Math.max(adjustedTargetIndex, 0), target.tabs.length);
  if (target.tabs.some((entry) => entry.sourceTabId === tab.sourceTabId || entry.url === tab.url)) {
    if (sourceGroupId !== targetGroupId) {
      source.tabs.splice(sourceIndex, 0, tab);
    }
    groups.value = [...groups.value];
    return;
  }

  target.tabs.splice(nextIndex, 0, tab);
  groups.value = [...groups.value];
}

function removeTabFromGroup(groupId: string, tabId: string) {
  const group = groups.value.find((entry) => entry.id === groupId);
  if (!group) {
    return;
  }

  group.tabs = group.tabs.filter((entry) => entry.id !== tabId);
  groups.value = [...groups.value];
}

function removeAllDuplicates(tab: GroupTabRecord) {
  for (const group of groups.value) {
    group.tabs = group.tabs.filter(
      (entry) => entry.sourceTabId !== tab.sourceTabId && entry.url !== tab.url
    );
  }
}

function openGroupTab(tab: GroupTabRecord) {
  const openTab = localTabs.value.find((entry) => entry.id === tab.sourceTabId || entry.url === tab.url);
  if (openTab?.id) {
    sendMessage(ACTIVATE_TAB_MESSAGE, { tabId: openTab.id });
  } else {
    sendMessage(OPEN_URL_MESSAGE, { url: tab.url });
  }
}

function onGroupTabClick(tab: GroupTabRecord) {
  openGroupTab(tab);
  props.onClose();
}

function onGroupTabMiddleClick(tab: GroupTabRecord) {
  const openTab = localTabs.value.find((entry) => entry.id === tab.sourceTabId || entry.url === tab.url);
  if (openTab?.id) {
    closeTab(openTab);
  }
}

function toggleItemMenu(groupId: string, tabId: string, event: MouseEvent) {
  closeAllPopups();
  activeItemMenu.value =
    activeItemMenu.value?.groupId === groupId && activeItemMenu.value?.tabId === tabId
      ? null : { groupId, tabId, x: event.clientX, y: event.clientY };
  event.stopPropagation();
}

function startEditItem(groupId: string, tab: GroupTabRecord, event: MouseEvent) {
  closeAllPopups();
  editingItem.value = { groupId, tabId: tab.id, title: tab.title };
  editItemPopup.value = { x: event.clientX, y: event.clientY };
  event.stopPropagation();
}

function saveEditItem() {
  if (!editingItem.value) {
    return;
  }

  const group = groups.value.find((entry) => entry.id === editingItem.value?.groupId);
  const tab = group?.tabs.find((entry) => entry.id === editingItem.value?.tabId);

  if (tab) {
    tab.title = editingItem.value.title.trim() || tab.title;
    groups.value = [...groups.value];
  }

  editingItem.value = null;
}

function deleteItem() {
  if (!activeItemMenu.value) {
    return;
  }

  removeTabFromGroup(activeItemMenu.value.groupId, activeItemMenu.value.tabId);
  activeItemMenu.value = null;
}

function getFavIconUrl(url: string) {
  try {
    const origin = new URL(url).origin;
    return `https://www.google.com/s2/favicons?domain=${origin}&sz=32`;
  } catch {
    return '';
  }
}

function openAddQuickLink(event: MouseEvent) {
  closeAllPopups();
  isNewQuickLinkOpen.value = true;
  newQuickLinkUrl.value = '';
  newQuickLinkPopup.value = { x: event.clientX, y: event.clientY };
  event.stopPropagation();
  void nextTick(() => {
    newQuickLinkInput.value?.focus();
  });
}

function closeAddQuickLink() {
  isNewQuickLinkOpen.value = false;
  newQuickLinkUrl.value = '';
}

function addQuickLink() {
  let url = newQuickLinkUrl.value.trim();
  if (!url) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  let name: string;
  try {
    name = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return;
  }

  quickLinks.value = [
    ...quickLinks.value,
    {
      id: createId('ql'),
      name,
      url,
      favIconUrl: getFavIconUrl(url)
    }
  ];

  closeAddQuickLink();
}

function openQuickLink(index: number) {
  const link = quickLinks.value[index];
  if (!link) return;

  const existingTab = localTabs.value.find(
    (tab) => tab.url === link.url || tab.url.replace(/\/$/, '') === link.url.replace(/\/$/, '')
  );
  if (existingTab?.id) {
    sendMessage(ACTIVATE_TAB_MESSAGE, { tabId: existingTab.id });
  } else {
    sendMessage(OPEN_URL_MESSAGE, { url: link.url });
  }
  props.onClose();
}

const activeQuickLinkMenu = ref<string | null>(null);

function toggleQuickLinkMenu(id: string) {
  activeQuickLinkMenu.value = activeQuickLinkMenu.value === id ? null : id;
}

function removeQuickLink(id: string) {
  quickLinks.value = quickLinks.value.filter((entry) => entry.id !== id);
  if (activeQuickLinkMenu.value === id) {
    activeQuickLinkMenu.value = null;
  }
}

function onTabDragStart(tabId: number, event: DragEvent) {
  dragTabId.value = tabId;
  event.dataTransfer?.setData('text/plain', String(tabId));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
  const el = event.currentTarget as HTMLElement;
  const ghost = el.cloneNode(true) as HTMLElement;
  const rect = el.getBoundingClientRect();
  ghost.querySelector('.motion-overlay__tab-close, .motion-overlay__group-tab-menu-button')?.remove();
  ghost.style.position = 'fixed';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.opacity = '0.92';
  ghost.style.pointerEvents = 'none';
  ghost.style.transform = 'rotate(1deg)';
  ghost.style.zIndex = '9999';
  ghost.style.margin = '0';
  ghost.style.border = '1px solid rgba(0,0,0,0.08)';
  ghost.style.borderRadius = '8px';
  ghost.style.background = '#ffffff';
  // Keep ghost inside the shadow DOM so overlay styles still apply
  el.closest('.motion-overlay')?.appendChild(ghost);
  event.dataTransfer?.setDragImage(ghost, el.offsetWidth / 2, el.offsetHeight / 2);
  requestAnimationFrame(() => ghost.remove());
}

function onTabDragEnd() {
  dragTabId.value = null;
  dragOverGroupId.value = null;
}

function onGroupItemDragStart(groupId: string, tabId: string, event: DragEvent) {
  draggingGroupItem.value = { groupId, tabId };
  event.dataTransfer?.setData('text/plain', JSON.stringify({ groupId, tabId }));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
  const el = event.currentTarget as HTMLElement;
  const ghost = el.cloneNode(true) as HTMLElement;
  const rect = el.getBoundingClientRect();
  ghost.querySelector('.motion-overlay__tab-close, .motion-overlay__group-tab-menu-button')?.remove();
  ghost.style.position = 'fixed';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.opacity = '0.92';
  ghost.style.pointerEvents = 'none';
  ghost.style.transform = 'rotate(1deg)';
  ghost.style.zIndex = '9999';
  ghost.style.margin = '0';
  ghost.style.border = '1px solid rgba(0,0,0,0.08)';
  ghost.style.borderRadius = '6px';
  ghost.style.background = '#ffffff';
  el.closest('.motion-overlay')?.appendChild(ghost);
  event.dataTransfer?.setDragImage(ghost, el.offsetWidth / 2, el.offsetHeight / 2);
  requestAnimationFrame(() => ghost.remove());
}

function onGroupItemDragEnd() {
  draggingGroupItem.value = null;
  dragOverGroupItem.value = null;
}

function onGroupItemDragOver(groupId: string, tabId: string, event: DragEvent) {
  event.preventDefault();
  dragOverGroupItem.value = { groupId, tabId };
  dragOverGroupId.value = groupId;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onGroupItemDrop(groupId: string, tabId: string, event: DragEvent) {
  event.preventDefault();

  const item = draggingGroupItem.value;
  if (item) {
    const sourceGroup = groups.value.find((entry) => entry.id === item.groupId);
    const targetGroup = groups.value.find((entry) => entry.id === groupId);
    const targetIndex = targetGroup?.tabs.findIndex((entry) => entry.id === tabId) ?? -1;

    if (sourceGroup && targetGroup && targetIndex >= 0) {
      moveGroupTab(item.groupId, item.tabId, groupId, targetIndex);
    }
  } else {
    const sourceTabId = Number(event.dataTransfer?.getData('text/plain') || dragTabId.value);
    if (Number.isFinite(sourceTabId)) {
      const group = groups.value.find((entry) => entry.id === groupId);
      const targetIndex = group?.tabs.findIndex((entry) => entry.id === tabId) ?? -1;
      if (group && targetIndex >= 0) {
        const openTab = localTabs.value.find((entry) => entry.id === sourceTabId);
        if (openTab && !group.tabs.some((entry) => entry.sourceTabId === openTab.id || entry.url === openTab.url)) {
          group.tabs.splice(targetIndex, 0, {
            id: createId('tab'),
            sourceTabId: openTab.id,
            title: openTab.title,
            url: openTab.url,
            favIconUrl: openTab.favIconUrl
          });
          groups.value = [...groups.value];
        }
      }
    }
  }

  draggingGroupItem.value = null;
  dragOverGroupItem.value = null;
  dragTabId.value = null;
}

function onGroupDragOver(groupId: string, event: DragEvent) {
  event.preventDefault();
  dragOverGroupId.value = groupId;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onGroupDragLeave(groupId: string) {
  if (dragOverGroupId.value === groupId) {
    dragOverGroupId.value = null;
  }
}

function onGroupDrop(groupId: string, event: DragEvent) {
  event.preventDefault();
  if (draggingGroupItem.value) {
    const sourceGroup = groups.value.find((entry) => entry.id === draggingGroupItem.value?.groupId);
    const targetGroup = groups.value.find((entry) => entry.id === groupId);

    if (sourceGroup && targetGroup) {
      const sourceIndex = sourceGroup.tabs.findIndex((entry) => entry.id === draggingGroupItem.value?.tabId);
      if (sourceIndex >= 0) {
        const [tab] = sourceGroup.tabs.splice(sourceIndex, 1);
        if (
          !targetGroup.tabs.some((entry) => entry.sourceTabId === tab.sourceTabId || entry.url === tab.url)
        ) {
          targetGroup.tabs.push(tab);
        } else if (sourceGroup.id !== targetGroup.id) {
          sourceGroup.tabs.splice(sourceIndex, 0, tab);
        }
        groups.value = [...groups.value];
      }
    }
  } else {
    const tabId = Number(event.dataTransfer?.getData('text/plain') || dragTabId.value);
    if (Number.isFinite(tabId)) {
      addTabToGroup(groupId, tabId);
    }
  }

  dragTabId.value = null;
  dragOverGroupId.value = null;
  draggingGroupItem.value = null;
  dragOverGroupItem.value = null;
  dragGroupId.value = null;
  dragOverGroupIndex.value = null;
}

function onSidebarGroupDragStart(groupId: string, event: DragEvent) {
  dragGroupId.value = groupId;
  event.dataTransfer?.setData('text/plain', JSON.stringify({ groupDrag: true, groupId }));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function moveGroup(fromId: string, toId: string) {
  const from = groups.value.findIndex((g) => g.id === fromId);
  const to = groups.value.findIndex((g) => g.id === toId);
  if (from >= 0 && to >= 0 && from !== to) {
    const next = [...groups.value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    groups.value = next;
  }
}

function onSidebarGroupDragOver(groupId: string, event: DragEvent) {
  event.preventDefault();
  dragOverGroupIndex.value = groupId;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onSidebarGroupDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  const related = event.relatedTarget as HTMLElement | null;
  if (!related || !target.contains(related)) {
    dragOverGroupIndex.value = null;
  }
}

function onSidebarListDrop(event: DragEvent) {
  event.preventDefault();
  const data = event.dataTransfer?.getData('text/plain');
  if (!data || !groups.value.length) return;

  try {
    const parsed = JSON.parse(data);
    if (parsed.groupDrag) return;
  } catch {
    // plain text = tab ID from tab list
  }

  const sourceTabId = Number(data);
  if (Number.isFinite(sourceTabId)) {
    addTabToGroup(groups.value[0].id, sourceTabId);
  }

  dragTabId.value = null;
}

function onSidebarGroupDrop(targetGroupId: string, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  const data = event.dataTransfer?.getData('text/plain');
  if (!data) return;

  let sourceTabId: number | null = null;

  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && parsed.groupDrag && parsed.groupId) {
      moveGroup(parsed.groupId, targetGroupId);
    } else {
      sourceTabId = typeof parsed === 'number' ? parsed : Number(data);
    }
  } catch {
    sourceTabId = Number(data);
  }

  if (sourceTabId !== null && Number.isFinite(sourceTabId)) {
    addTabToGroup(targetGroupId, sourceTabId);
  }

  dragGroupId.value = null;
  dragOverGroupIndex.value = null;
  dragTabId.value = null;
}

function closeAllPopups() {
  showSettings.value = false;
  activeItemMenu.value = null;
  activeGroupMenu.value = null;
  activeQuickLinkMenu.value = null;
  editingItem.value = null;
  editingGroup.value = null;
  editItemPopup.value = null;
  editGroupPopup.value = null;
  newGroupPopup.value = null;
  newQuickLinkPopup.value = null;
  if (isNewGroupOpen.value) { isNewGroupOpen.value = false; newGroupName.value = ''; }
  if (isNewQuickLinkOpen.value) { isNewQuickLinkOpen.value = false; newQuickLinkUrl.value = ''; }
}

function onShellClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('.motion-overlay__popup, .motion-overlay__group-menu, .motion-overlay__group-tab-menu, .motion-overlay__ql-menu, .motion-overlay__search-suggestions')) {
    return;
  }
  if (activeItemMenu.value || activeGroupMenu.value || editingItem.value || editingGroup.value || isNewGroupOpen.value || isNewQuickLinkOpen.value || activeQuickLinkMenu.value) {
    closeAllPopups();
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isNewQuickLinkOpen.value) {
    event.preventDefault();
    closeAddQuickLink();
    return;
  }

  if (isNewGroupOpen.value && event.key === 'Escape') {
    event.preventDefault();
    closeNewGroup();
    return;
  }

  const isPopupOpen = isNewGroupOpen.value || isNewQuickLinkOpen.value || editingItem.value || editingGroup.value;

  if (event.key === 'Tab') {
    if (isPopupOpen) return;
    if (isSearchFocused.value && searchSuggestions.value.length) {
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      const next = (searchSelectedIndex.value + delta + searchSuggestions.value.length) % searchSuggestions.value.length;
      searchSelectedIndex.value = next;
      // Scroll the selected suggestion into view
      void nextTick(() => {
        const host = searchInput.value?.closest('.motion-overlay') as HTMLElement | null;
        if (!host) return;
        const suggestion = host.querySelector('.motion-overlay__search-suggestion--selected') as HTMLElement | null;
        suggestion?.scrollIntoView?.({ block: 'nearest' });
      });
    } else {
      event.preventDefault();
      moveSelection(event.shiftKey ? -1 : 1);
    }
    return;
  }

  if (event.key === 'Enter') {
    if (isNewGroupOpen.value || isNewQuickLinkOpen.value) {
      event.preventDefault();
      if (isNewGroupOpen.value) { createGroup(); } else { addQuickLink(); }
      return;
    }

    const q = searchQuery.value.trim();
    if (searchSuggestions.value.length && searchSelectedIndex.value >= 0) {
      event.preventDefault();
      openSuggestion(searchSuggestions.value[searchSelectedIndex.value]);
      return;
    }

    if (isSearchFocused.value && q) {
      event.preventDefault();
      let targetUrl = q;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        if (targetUrl.includes('.')) {
          targetUrl = `https://${targetUrl}`;
        } else {
          targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
        }
      }
      sendMessage(OPEN_URL_MESSAGE, { url: targetUrl, currentTab: event.shiftKey });
      props.onClose();
      return;
    }

    event.preventDefault();
    activateSelectedTab();
    return;
  }

  if (event.key >= '1' && event.key <= '9') {
    if (isPopupOpen) return;
    const index = parseInt(event.key) - 1;
    if (index < quickLinks.value.length) {
      event.preventDefault();
      openQuickLink(index);
    }
    return;
  }

  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && isSearchFocused.value && searchSuggestions.value.length) {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    searchSelectedIndex.value = Math.min(Math.max(searchSelectedIndex.value + delta, 0), searchSuggestions.value.length - 1);
    return;
  }

  if (event.key === 'k' && (event.altKey || event.metaKey)) {
    event.preventDefault();
    searchInput.value?.focus();
    return;
  }

  if (event.key === 'Escape') {
    if (searchQuery.value) {
      searchQuery.value = '';
      searchSelectedIndex.value = -1;
      searchInput.value?.blur();
      return;
    }
    event.preventDefault();
    closeAllPopups();
  }
}

async function hydrateGroups() {
  try {
    const stored = await chrome.storage.local.get([GROUPS_STORAGE_KEY, ACTIVE_GROUP_STORAGE_KEY]);
    const savedGroups = Array.isArray(stored[GROUPS_STORAGE_KEY]) ? (stored[GROUPS_STORAGE_KEY] as GroupRecord[]) : [];
    groups.value = savedGroups;
    if (stored[ACTIVE_GROUP_STORAGE_KEY]) {
      const saved = stored[ACTIVE_GROUP_STORAGE_KEY];
      if (savedGroups.some((g: GroupRecord) => g.id === saved)) {
        activeGroupId.value = saved;
      }
    }
  } catch {
    groups.value = [];
  } finally {
    hydrated.value = true;
  }
}

async function hydrateQuickLinks() {
  try {
    const stored = await chrome.storage.local.get(QUICK_LINKS_STORAGE_KEY);
    const savedLinks = Array.isArray(stored[QUICK_LINKS_STORAGE_KEY]) ? (stored[QUICK_LINKS_STORAGE_KEY] as QuickLink[]) : [];
    quickLinks.value = savedLinks;
  } catch {
    quickLinks.value = [];
  }
}

function persistGroups() {
  if (!hydrated.value) {
    return;
  }

  chrome.storage.local.set({
    [GROUPS_STORAGE_KEY]: cloneGroups(groups.value)
  });
}

watch(
  () => props.selectedTabId,
  (value) => syncSelection(value),
  { immediate: true }
);

watch(
  () => groups.value,
  (nextGroups) => {
    if (hydrated.value) {
      chrome.storage.local.set({
        [GROUPS_STORAGE_KEY]: cloneGroups(nextGroups)
      });
    }
  },
  { deep: true }
);

watch(
  () => quickLinks.value,
  (nextLinks) => {
    chrome.storage.local.set({
      [QUICK_LINKS_STORAGE_KEY]: nextLinks.map((link) => ({
        id: link.id,
        name: link.name,
        url: link.url,
        favIconUrl: link.favIconUrl
      }))
    });
  },
  { deep: true }
);

onMounted(() => {
  void hydrateGroups();
  void hydrateQuickLinks();
  void nextTick(() => {
    searchInput.value?.focus();
  });
  window.addEventListener('keydown', onKeydown, true);
});

watch(searchQuery, () => {
  searchSelectedIndex.value = -1;
});

watch(activeGroupId, (id) => {
  if (hydrated.value && id) {
    chrome.storage.local.set({ [ACTIVE_GROUP_STORAGE_KEY]: id }).catch(() => {});
  }
});

onBeforeUnmount(() => {
  if (hydrated.value) {
    chrome.storage.local.set({ [GROUPS_STORAGE_KEY]: cloneGroups(groups.value) });
    if (activeGroupId.value) {
      chrome.storage.local.set({ [ACTIVE_GROUP_STORAGE_KEY]: activeGroupId.value });
    }
  }
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <section class="motion-overlay" :class="{ 'motion-overlay--searching': isSearchActive }" role="dialog" aria-modal="true" aria-label="Open tabs overlay" @click.self="closeAllPopups">
    <div class="motion-overlay__shell" :class="{ 'motion-overlay--searching': isSearchActive }" @click="onShellClick">
      <aside class="motion-overlay__rail">
        <div class="motion-overlay__rail-header">
          <div class="motion-overlay__title-wrap">
            <h1>
              <span class="motion-overlay__title-text">OPEN TABS</span>
              <span class="motion-overlay__count-badge">{{ localTabs.length }}</span>
            </h1>
          </div>
          <div class="motion-overlay__nav">
            <button
              type="button"
              class="motion-overlay__nav-button"
              aria-label="Previous tab"
              @click="sendMessage(GO_BACK_MESSAGE)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button
              type="button"
              class="motion-overlay__nav-button"
              aria-label="Next tab"
              @click="sendMessage(GO_FORWARD_MESSAGE)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <ul class="motion-overlay__tab-list" role="listbox" aria-label="Open tabs">
          <li v-for="(tab, index) in localTabs" :key="tab.id" class="motion-overlay__tab-li">
            <button
              class="motion-overlay__tab"
              :class="{
                'motion-overlay__tab--active': tab.active,
                'motion-overlay__tab--selected': index === selectedIndex
              }"
              type="button"
              role="option"
              :aria-selected="index === selectedIndex"
              draggable="true"
              @click="selectedIndex = index; openTab(tab)"
              @auxclick.prevent="(event) => event.button === 1 && closeTab(tab)"
              @dragstart="onTabDragStart(tab.id, $event)"
              @dragend="onTabDragEnd"
            >
              <span class="motion-overlay__tab-icon" aria-hidden="true">
                <img v-if="tab.favIconUrl" :src="tab.favIconUrl" alt="" />
                <span v-else>{{ getTabFallbackTitle(tab.title, tab.url).slice(0, 1).toUpperCase() }}</span>
              </span>

              <span class="motion-overlay__tab-content">
                <span class="motion-overlay__tab-title">{{ getTabFallbackTitle(tab.title, tab.url) }}</span>
              </span>

              <span
                class="motion-overlay__tab-close"
                role="button"
                :aria-label="`Close ${getTabFallbackTitle(tab.title, tab.url)}`"
                @click.stop="closeTab(tab)"
                tabindex="0"
                @keydown.enter.stop="closeTab(tab)"
                @keydown.space.stop="closeTab(tab)"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
            </button>
          </li>
        </ul>

        <div class="motion-overlay__rail-footer">
          <button type="button" class="motion-overlay__footer-button" @click="openNewTab">
            <span class="motion-overlay__footer-label">New Tab</span>
          </button>
        </div>
      </aside>

      <main class="motion-overlay__workspace">
        <header class="motion-overlay__topbar">
          <div class="motion-overlay__search-wrap">
            <label class="motion-overlay__search">
              <span aria-hidden="true">
                <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14.9536 14.9458L21 21M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              <input ref="searchInput" v-model="searchQuery" type="text" placeholder="Search the web..." @focus="isSearchFocused = true" @blur="isSearchFocused = false; setTimeout(() => { searchQuery = ''; searchSelectedIndex = -1; }, 120)" />
            </label>
            <div v-if="isSearchFocused && searchSuggestions.length" class="motion-overlay__search-suggestions">
              <button
                v-for="(suggestion, sIndex) in searchSuggestions"
                :key="suggestion.id"
                type="button"
                class="motion-overlay__search-suggestion"
                :style="{ '--index': sIndex }"
                :class="{ 'motion-overlay__search-suggestion--selected': sIndex === searchSelectedIndex }"
                @click="openSuggestion(suggestion)"
                @mousedown.prevent
              >
                <span class="motion-overlay__search-suggestion-icon" aria-hidden="true">
                  <img v-if="suggestion.favIconUrl" :src="suggestion.favIconUrl" alt="" />
                  <span v-else>{{ getTabFallbackTitle(suggestion.title, suggestion.url).slice(0, 1).toUpperCase() }}</span>
                </span>
                <span class="motion-overlay__search-suggestion-title">{{ getTabFallbackTitle(suggestion.title, suggestion.url) }}</span>
                <span class="motion-overlay__search-suggestion-url">{{ suggestion.url }}</span>
              </button>
            </div>
          </div>

          <button type="button" class="motion-overlay__icon-button" :class="{ 'motion-overlay__icon-button--active': showSettings }" aria-label="Settings" @click="showSettings = !showSettings">
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="3" stroke="#1C274C" stroke-width="1.5"/>
              <path d="M13.7654 2.15224C13.3978 2 12.9319 2 12 2C11.0681 2 10.6022 2 10.2346 2.15224C9.74457 2.35523 9.35522 2.74458 9.15223 3.23463C9.05957 3.45834 9.0233 3.7185 9.00911 4.09799C8.98826 4.65568 8.70226 5.17189 8.21894 5.45093C7.73564 5.72996 7.14559 5.71954 6.65219 5.45876C6.31645 5.2813 6.07301 5.18262 5.83294 5.15102C5.30704 5.08178 4.77518 5.22429 4.35436 5.5472C4.03874 5.78938 3.80577 6.1929 3.33983 6.99993C2.87389 7.80697 2.64092 8.21048 2.58899 8.60491C2.51976 9.1308 2.66227 9.66266 2.98518 10.0835C3.13256 10.2756 3.3397 10.437 3.66119 10.639C4.1338 10.936 4.43789 11.4419 4.43786 12C4.43783 12.5581 4.13375 13.0639 3.66118 13.3608C3.33965 13.5629 3.13248 13.7244 2.98508 13.9165C2.66217 14.3373 2.51966 14.8691 2.5889 15.395C2.64082 15.7894 2.87379 16.193 3.33973 17C3.80568 17.807 4.03865 18.2106 4.35426 18.4527C4.77508 18.7756 5.30694 18.9181 5.83284 18.8489C6.07289 18.8173 6.31632 18.7186 6.65204 18.5412C7.14547 18.2804 7.73556 18.27 8.2189 18.549C8.70224 18.8281 8.98826 19.3443 9.00911 19.9021C9.02331 20.2815 9.05957 20.5417 9.15223 20.7654C9.35522 21.2554 9.74457 21.6448 10.2346 21.8478C10.6022 22 11.0681 22 12 22C12.9319 22 13.3978 22 13.7654 21.8478C14.2554 21.6448 14.6448 21.2554 14.8477 20.7654C14.9404 20.5417 14.9767 20.2815 14.9909 19.902C15.0117 19.3443 15.2977 18.8281 15.781 18.549C16.2643 18.2699 16.8544 18.2804 17.3479 18.5412C17.6836 18.7186 17.927 18.8172 18.167 18.8488C18.6929 18.9181 19.2248 18.7756 19.6456 18.4527C19.9612 18.2105 20.1942 17.807 20.6601 16.9999C21.1261 16.1929 21.3591 15.7894 21.411 15.395C21.4802 14.8691 21.3377 14.3372 21.0148 13.9164C20.8674 13.7243 20.6602 13.5628 20.3387 13.3608C19.8662 13.0639 19.5621 12.558 19.5621 11.9999C19.5621 11.4418 19.8662 10.9361 20.3387 10.6392C20.6603 10.4371 20.8675 10.2757 21.0149 10.0835C21.3378 9.66273 21.4803 9.13087 21.4111 8.60497C21.3592 8.21055 21.1262 7.80703 20.6602 7C20.1943 6.19297 19.9613 5.78945 19.6457 5.54727C19.2249 5.22436 18.693 5.08185 18.1671 5.15109C17.9271 5.18269 17.6837 5.28136 17.3479 5.4588C16.8545 5.71959 16.2644 5.73002 15.7811 5.45096C15.2977 5.17191 15.0117 4.65566 14.9909 4.09794C14.9767 3.71848 14.9404 3.45833 14.8477 3.23463C14.6448 2.74458 14.2554 2.35523 13.7654 2.15224Z" stroke="#1C274C" stroke-width="1.5"/>
            </svg>
          </button>
        </header>

        <div v-show="!showSettings" class="motion-overlay__main-content">
          <div v-if="quickLinks.length || quickLinks.length < MAX_QUICK_LINKS" class="motion-overlay__quicklinks">
            <template v-for="i in MAX_QUICK_LINKS" :key="i">
              <div
                v-if="quickLinks[i - 1]"
                class="motion-overlay__quicklink"
                :title="quickLinks[i - 1].name"
                @click="openQuickLink(i - 1)"
                @contextmenu.prevent="toggleQuickLinkMenu(quickLinks[i - 1].id)"
              >
                <img v-if="quickLinks[i - 1].favIconUrl" :src="quickLinks[i - 1].favIconUrl" :alt="quickLinks[i - 1].name" />
                <span v-else class="motion-overlay__quicklink-letter">{{ quickLinks[i - 1].name.slice(0, 1).toUpperCase() }}</span>
                <div v-if="activeQuickLinkMenu === quickLinks[i - 1].id" class="motion-overlay__ql-menu" @click.stop>
                  <button type="button" class="menu-delete" @click="removeQuickLink(quickLinks[i - 1].id)">Delete</button>
                </div>
              </div>
              <button
                v-else-if="i === quickLinks.length + 1 && quickLinks.length < MAX_QUICK_LINKS"
                type="button"
                class="motion-overlay__quicklink motion-overlay__quicklink--add"
                @click="(e) => openAddQuickLink(e)"
                aria-label="Add quick link"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 6V18M6 12H18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div v-else class="motion-overlay__quicklink motion-overlay__quicklink--empty"></div>
            </template>
          </div>

          <section class="motion-overlay__groups-panel" aria-label="Groups">
          <div class="motion-overlay__groups-sidebar">
            <div class="motion-overlay__groups-sidebar-header">
              <h2>Groups</h2>
              <button type="button" class="motion-overlay__groups-add-btn" @click="(e) => openNewGroup(e)" aria-label="New group">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 6V18M6 12H18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            <div
              v-if="groups.length"
              class="motion-overlay__groups-sidebar-list"
              @dragover.prevent
              @drop.prevent="onSidebarListDrop"
            >
              <button v-for="group in groups" :key="group.id" type="button" class="motion-overlay__groups-sidebar-item"
                :class="{ 'motion-overlay__groups-sidebar-item--active': activeGroupId === group.id, 'motion-overlay__groups-sidebar-item--drag-over': dragOverGroupIndex === group.id }"
                draggable="true" @click="activeGroupId = group.id" @contextmenu.prevent="(e) => startEditGroup(group.id, group.name, e)"
                @dragstart="onSidebarGroupDragStart(group.id, $event)" @dragover="onSidebarGroupDragOver(group.id, $event)"
                @dragleave="onSidebarGroupDragLeave" @drop.stop="onSidebarGroupDrop(group.id, $event)"
              >
                <span class="motion-overlay__groups-sidebar-item-name">{{ group.name }}</span>
                <span class="motion-overlay__groups-sidebar-item-count" @click.stop="(e) => toggleGroupMenu(group.id, e)">{{ group.tabs.length }}</span>
                <div v-if="activeGroupMenu?.groupId === group.id" class="motion-overlay__group-menu" :style="{ left: activeGroupMenu.x + 'px', top: activeGroupMenu.y + 'px' }" @click.stop>
                  <button type="button" @click="(e) => startEditGroup(group.id, group.name, e)">Edit</button>
                  <button type="button" class="menu-delete" @click="deleteGroup(group.id)">Delete</button>
                  <button type="button" @click="openAllGroupTabs(group.id)">Open All Tabs</button>
                </div>
              </button>
            </div>
            <div v-else class="motion-overlay__groups-sidebar-empty">
              <p>No groups yet</p>
            </div>
          </div>

          <div class="motion-overlay__groups-content">
            <template v-if="activeGroupId">
              <div class="motion-overlay__groups-content-header">
                <button type="button" class="motion-overlay__groups-back-btn" @click="activeGroupId = null" aria-label="Back to groups">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <h3>{{ groups.find((g) => g.id === activeGroupId)?.name }}</h3>
                <button
                  type="button"
                  class="motion-overlay__groups-content-action-btn"
                  aria-label="Open all tabs"
                  :title="`Open all ${groups.find((g) => g.id === activeGroupId)?.tabs.length ?? 0} tabs`"
                  @click="openAllGroupTabs(activeGroupId)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 5V19L19 12L8 5Z" fill="currentColor"/>
                  </svg>
                </button>
                <button
                  type="button"
                  class="motion-overlay__groups-content-menu-btn"
                  aria-label="Group menu"
                  @click.stop="(e) => toggleGroupMenu(activeGroupId, e)"
                >⋮</button>
                <div v-if="activeGroupMenu?.groupId === activeGroupId" class="motion-overlay__group-menu" :style="{ left: activeGroupMenu.x + 'px', top: activeGroupMenu.y + 'px' }" @click.stop>
                  <button type="button" @click="(e) => startEditGroup(activeGroupId, groups.find((g) => g.id === activeGroupId)?.name ?? '', e)">Edit</button>
                  <button type="button" class="menu-delete" @click="deleteGroup(activeGroupId)">Delete</button>
                  <button type="button" @click="openAllGroupTabs(activeGroupId)">Open All Tabs</button>
                </div>
              </div>
              <div
                class="motion-overlay__groups-content-body"
                :class="{ 'motion-overlay__groups-content-body--drag-over': dragOverGroupId === activeGroupId && ((groups.find((g) => g.id === activeGroupId)?.tabs.length ?? 0) > 0) }"
                @dragover="onGroupDragOver(activeGroupId, $event)"
                @drop="onGroupDrop(activeGroupId, $event)"
                @dragleave="onGroupDragLeave(activeGroupId)"
              >
                <template v-if="(groups.find((g) => g.id === activeGroupId)?.tabs.length ?? 0) > 0">
                  <div
                    v-for="tab in groups.find((g) => g.id === activeGroupId)?.tabs"
                    :key="tab!.id"
                    class="motion-overlay__group-tab"
                    draggable="true"
                    @dragstart="onGroupItemDragStart(activeGroupId, tab!.id, $event)"
                    @dragend="onGroupItemDragEnd"
                    @dragover.stop="onGroupItemDragOver(activeGroupId, tab!.id, $event)"
                    @drop.stop="onGroupItemDrop(activeGroupId, tab!.id, $event)"
                  >
                    <button
                      class="motion-overlay__group-tab-main"
                      type="button"
                      @click="onGroupTabClick(tab!)"
                      @auxclick.prevent="(event) => event.button === 1 && onGroupTabMiddleClick(tab!)"
                    >
                      <span class="motion-overlay__group-tab-icon" aria-hidden="true">
                        <img v-if="tab!.favIconUrl" :src="tab!.favIconUrl" alt="" />
                        <span v-else>{{ getTabFallbackTitle(tab!.title, tab!.url).slice(0, 1).toUpperCase() }}</span>
                      </span>
                      <span class="motion-overlay__group-tab-title">{{ tab!.title }}</span>
                    </button>
                    <button
                      type="button"
                      class="motion-overlay__group-tab-menu-button"
                      :aria-label="`Menu for ${tab!.title}`"
                      @click.stop="(e) => toggleItemMenu(activeGroupId, tab!.id, e)"
                    >⋮</button>
                    <div
                      v-if="activeItemMenu?.groupId === activeGroupId && activeItemMenu?.tabId === tab!.id"
                      class="motion-overlay__group-tab-menu"
                      :style="{ left: activeItemMenu.x + 'px', top: activeItemMenu.y + 'px' }"
                    >
                      <button type="button" @click="(e) => startEditItem(activeGroupId, tab!, e)">Edit</button>
                      <button type="button" class="menu-delete" @click="deleteItem">Delete</button>
                    </div>
                  </div>
                </template>
                <div
                  v-else
                  class="motion-overlay__group-empty"
                  :class="{ 'motion-overlay__group-empty--drag-over': dragOverGroupId === activeGroupId }"
                  @dragover="onGroupDragOver(activeGroupId, $event)"
                  @drop="onGroupDrop(activeGroupId, $event)"
                  @dragleave="onGroupDragLeave(activeGroupId)"
                >
                  <svg class="motion-overlay__group-empty-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 6V12L15 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <p class="motion-overlay__group-empty-text">Drop tabs here</p>
                </div>
              </div>
            </template>
            <div v-else class="motion-overlay__groups-content-empty">
              <p>Select a group to view its tabs</p>
            </div>
          </div>
        </section>
        </div>

        <!-- ── Settings page ──────────────────────────────────────────────── -->
        <div v-show="showSettings" class="motion-overlay__settings">
          <div class="motion-overlay__settings-section">
            <h2 class="motion-overlay__settings-title">Keyboard Shortcuts</h2>
            <div class="motion-overlay__settings-shortcuts">
              <div class="motion-overlay__settings-shortcut">
                <span class="motion-overlay__settings-shortcut-label">Close overlay</span>
                <kbd class="motion-overlay__settings-kbd">Esc</kbd>
              </div>
              <div class="motion-overlay__settings-shortcut">
                <span class="motion-overlay__settings-shortcut-label">Focus search</span>
                <kbd class="motion-overlay__settings-kbd"><span class="motion-overlay__settings-mod">⌘</span>K</kbd>
              </div>
              <div class="motion-overlay__settings-shortcut">
                <span class="motion-overlay__settings-shortcut-label">Navigate tabs</span>
                <kbd class="motion-overlay__settings-kbd">Tab</kbd>
              </div>
              <div class="motion-overlay__settings-shortcut">
                <span class="motion-overlay__settings-shortcut-label">Open quick link (1–9)</span>
                <kbd class="motion-overlay__settings-kbd">1–9</kbd>
              </div>
            </div>
          </div>

          <div class="motion-overlay__settings-section">
            <h2 class="motion-overlay__settings-title">About</h2>
            <p class="motion-overlay__settings-about">Motion FSS &mdash; Fast Session Switcher</p>
            <p class="motion-overlay__settings-version">Version 1.0.0</p>
          </div>
        </div>
      </main>

      <!-- ── Inline popups (no backdrops, near-mouse) ──────────────────────── -->
      <div v-if="isNewGroupOpen" class="motion-overlay__popup" :style="{ left: newGroupPopup?.x + 'px', top: newGroupPopup?.y + 'px' }" @click.stop>
        <p class="motion-overlay__popup-label">New Group</p>
        <p class="motion-overlay__popup-desc">Enter a name for your new tab group.</p>
        <form @submit.prevent="createGroup">
          <input ref="newGroupInput" v-model="newGroupName" type="text" placeholder="Group name" maxlength="40" autofocus @keydown.esc.prevent="closeAllPopups" />
          <div class="motion-overlay__popup-actions">
            <button type="button" class="motion-overlay__popup-button motion-overlay__popup-button--ghost" @click="closeAllPopups">Cancel</button>
            <button type="submit" class="motion-overlay__popup-button">Add</button>
          </div>
        </form>
      </div>

      <div v-if="editingItem" class="motion-overlay__popup" :style="{ left: editItemPopup?.x + 'px', top: editItemPopup?.y + 'px' }" @click.stop>
        <p class="motion-overlay__popup-label">Edit Item</p>
        <p class="motion-overlay__popup-desc">Rename this saved tab's title.</p>
        <form @submit.prevent="saveEditItem">
          <input v-model="editingItem.title" type="text" maxlength="80" autofocus @keydown.esc.prevent="editingItem = null; editItemPopup = null" />
          <div class="motion-overlay__popup-actions">
            <button type="button" class="motion-overlay__popup-button motion-overlay__popup-button--ghost" @click="editingItem = null; editItemPopup = null">Cancel</button>
            <button type="submit" class="motion-overlay__popup-button">Save</button>
          </div>
        </form>
      </div>

      <div v-if="editingGroup" class="motion-overlay__popup" :style="{ left: editGroupPopup?.x + 'px', top: editGroupPopup?.y + 'px' }" @click.stop>
        <p class="motion-overlay__popup-label">Edit Group</p>
        <p class="motion-overlay__popup-desc">Rename this group.</p>
        <form @submit.prevent="saveEditGroup">
          <input v-model="editingGroup.name" type="text" maxlength="40" autofocus @keydown.esc.prevent="editingGroup = null; editGroupPopup = null" />
          <div class="motion-overlay__popup-actions">
            <button type="button" class="motion-overlay__popup-button motion-overlay__popup-button--ghost" @click="editingGroup = null; editGroupPopup = null">Cancel</button>
            <button type="submit" class="motion-overlay__popup-button">Save</button>
          </div>
        </form>
      </div>

      <div v-if="isNewQuickLinkOpen" class="motion-overlay__popup" :style="{ left: newQuickLinkPopup?.x + 'px', top: newQuickLinkPopup?.y + 'px' }" @click.stop>
        <p class="motion-overlay__popup-label">Add Quick Link</p>
        <p class="motion-overlay__popup-desc">Paste a URL to add a quick link. The site name is derived automatically.</p>
        <form @submit.prevent="addQuickLink">
          <input ref="newQuickLinkInput" v-model="newQuickLinkUrl" type="text" placeholder="URL" maxlength="500" autofocus @keydown.esc.prevent="closeAllPopups" />
          <div class="motion-overlay__popup-actions">
            <button type="button" class="motion-overlay__popup-button motion-overlay__popup-button--ghost" @click="closeAllPopups">Cancel</button>
            <button type="submit" class="motion-overlay__popup-button">Add</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>
