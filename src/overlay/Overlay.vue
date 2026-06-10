<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { OpenTab } from '../shared/messages';
import { getTabFallbackTitle } from '../shared/tabUtils';

const ACTIVATE_TAB_MESSAGE = 'motion-fss:activate-tab';
const CLOSE_TAB_MESSAGE = 'motion-fss:close-tab';
const OPEN_NEW_TAB_MESSAGE = 'motion-fss:open-new-tab';
const OPEN_URL_MESSAGE = 'motion-fss:open-url';
const GROUPS_STORAGE_KEY = 'motion-fss:groups';

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

const props = defineProps<{
  tabs: OpenTab[];
  selectedTabId: number | null;
  onClose: () => void;
}>();

const selectedIndex = ref(0);
const selectedTab = computed(() => props.tabs[selectedIndex.value] ?? null);
const groups = ref<GroupRecord[]>([]);
const hydrated = ref(false);
const isNewGroupOpen = ref(false);
const newGroupName = ref('');
const newGroupInput = ref<HTMLInputElement | null>(null);
const activeItemMenu = ref<ItemMenuState>(null);
const editingItem = ref<EditingState>(null);
const dragTabId = ref<number | null>(null);
const dragOverGroupId = ref<string | null>(null);
const draggingGroupItem = ref<GroupDragState>(null);
const dragOverGroupItem = ref<GroupDragState>(null);

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
  const nextIndex = props.tabs.findIndex((tab) => tab.id === tabId);
  selectedIndex.value = nextIndex >= 0 ? nextIndex : 0;
}

function moveSelection(delta: number) {
  if (!props.tabs.length) {
    return;
  }

  selectedIndex.value = (selectedIndex.value + delta + props.tabs.length) % props.tabs.length;
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

function openTab(tab: OpenTab) {
  sendMessage(ACTIVATE_TAB_MESSAGE, { tabId: tab.id });
  props.onClose();
}

function closeTab(tab: OpenTab) {
  sendMessage(CLOSE_TAB_MESSAGE, { tabId: tab.id });
}

function openNewTab() {
  sendMessage(OPEN_NEW_TAB_MESSAGE);
  props.onClose();
}

function openNewGroup() {
  isNewGroupOpen.value = true;
  newGroupName.value = '';
  activeItemMenu.value = null;
  editingItem.value = null;

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
  const tab = props.tabs.find((entry) => entry.id === tabId);

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
  const openTab = props.tabs.find((entry) => entry.id === tab.sourceTabId || entry.url === tab.url);
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
  const openTab = props.tabs.find((entry) => entry.id === tab.sourceTabId || entry.url === tab.url);
  if (openTab?.id) {
    closeTab(openTab);
  }
}

function toggleItemMenu(groupId: string, tabId: string) {
  activeItemMenu.value =
    activeItemMenu.value?.groupId === groupId && activeItemMenu.value?.tabId === tabId
      ? null
      : { groupId, tabId };
}

function startEditItem(groupId: string, tab: GroupTabRecord) {
  activeItemMenu.value = null;
  editingItem.value = {
    groupId,
    tabId: tab.id,
    title: tab.title
  };
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

function onTabDragStart(tabId: number, event: DragEvent) {
  dragTabId.value = tabId;
  event.dataTransfer?.setData('text/plain', String(tabId));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
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
}

function onGroupItemDragEnd() {
  draggingGroupItem.value = null;
  dragOverGroupItem.value = null;
}

function onGroupItemDragOver(groupId: string, tabId: string, event: DragEvent) {
  event.preventDefault();
  dragOverGroupItem.value = { groupId, tabId };
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
        const openTab = props.tabs.find((entry) => entry.id === sourceTabId);
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
}

function onKeydown(event: KeyboardEvent) {
  if (isNewGroupOpen.value && event.key === 'Escape') {
    event.preventDefault();
    closeNewGroup();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    moveSelection(event.shiftKey ? -1 : 1);
    return;
  }

  if (event.key === 'Enter') {
    if (isNewGroupOpen.value) {
      event.preventDefault();
      createGroup();
      return;
    }

    event.preventDefault();
    activateSelectedTab();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    props.onClose();
  }
}

async function hydrateGroups() {
  try {
    const stored = await chrome.storage.local.get(GROUPS_STORAGE_KEY);
    const savedGroups = Array.isArray(stored[GROUPS_STORAGE_KEY]) ? (stored[GROUPS_STORAGE_KEY] as GroupRecord[]) : [];
    groups.value = savedGroups;
  } catch {
    groups.value = [];
  } finally {
    hydrated.value = true;
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

onMounted(() => {
  void hydrateGroups();
  window.addEventListener('keydown', onKeydown, true);
});

onBeforeUnmount(() => {
  persistGroups();
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <section class="motion-overlay" role="dialog" aria-modal="true" aria-label="Open tabs overlay" @click.self="onClose">
    <div class="motion-overlay__shell" @click.stop>
      <aside class="motion-overlay__rail">
        <div class="motion-overlay__rail-header">
          <div class="motion-overlay__title-wrap">
            <h1>
              <span class="motion-overlay__title-text">OPEN TABS</span>
              <span class="motion-overlay__count-badge">{{ tabs.length }}</span>
            </h1>
          </div>
        </div>

        <ul class="motion-overlay__tab-list" role="listbox" aria-label="Open tabs">
          <li v-for="(tab, index) in tabs" :key="tab.id">
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
            </button>
          </li>
        </ul>

        <div class="motion-overlay__rail-footer">
          <button type="button" class="motion-overlay__footer-button" @click="openNewTab">
            <span class="motion-overlay__footer-label">New Tab</span>
          </button>

          <button type="button" class="motion-overlay__footer-button" @click="openNewGroup">
            <span class="motion-overlay__footer-label">New Group</span>
          </button>
        </div>
      </aside>

      <main class="motion-overlay__workspace">
        <header class="motion-overlay__topbar">
          <label class="motion-overlay__search">
            <span aria-hidden="true">
              <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14.9536 14.9458L21 21M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <input type="text" placeholder="Search the web..." />
          </label>

          <button type="button" class="motion-overlay__icon-button" aria-label="Settings">
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="3" stroke="#1C274C" stroke-width="1.5"/>
              <path d="M13.7654 2.15224C13.3978 2 12.9319 2 12 2C11.0681 2 10.6022 2 10.2346 2.15224C9.74457 2.35523 9.35522 2.74458 9.15223 3.23463C9.05957 3.45834 9.0233 3.7185 9.00911 4.09799C8.98826 4.65568 8.70226 5.17189 8.21894 5.45093C7.73564 5.72996 7.14559 5.71954 6.65219 5.45876C6.31645 5.2813 6.07301 5.18262 5.83294 5.15102C5.30704 5.08178 4.77518 5.22429 4.35436 5.5472C4.03874 5.78938 3.80577 6.1929 3.33983 6.99993C2.87389 7.80697 2.64092 8.21048 2.58899 8.60491C2.51976 9.1308 2.66227 9.66266 2.98518 10.0835C3.13256 10.2756 3.3397 10.437 3.66119 10.639C4.1338 10.936 4.43789 11.4419 4.43786 12C4.43783 12.5581 4.13375 13.0639 3.66118 13.3608C3.33965 13.5629 3.13248 13.7244 2.98508 13.9165C2.66217 14.3373 2.51966 14.8691 2.5889 15.395C2.64082 15.7894 2.87379 16.193 3.33973 17C3.80568 17.807 4.03865 18.2106 4.35426 18.4527C4.77508 18.7756 5.30694 18.9181 5.83284 18.8489C6.07289 18.8173 6.31632 18.7186 6.65204 18.5412C7.14547 18.2804 7.73556 18.27 8.2189 18.549C8.70224 18.8281 8.98826 19.3443 9.00911 19.9021C9.02331 20.2815 9.05957 20.5417 9.15223 20.7654C9.35522 21.2554 9.74457 21.6448 10.2346 21.8478C10.6022 22 11.0681 22 12 22C12.9319 22 13.3978 22 13.7654 21.8478C14.2554 21.6448 14.6448 21.2554 14.8477 20.7654C14.9404 20.5417 14.9767 20.2815 14.9909 19.902C15.0117 19.3443 15.2977 18.8281 15.781 18.549C16.2643 18.2699 16.8544 18.2804 17.3479 18.5412C17.6836 18.7186 17.927 18.8172 18.167 18.8488C18.6929 18.9181 19.2248 18.7756 19.6456 18.4527C19.9612 18.2105 20.1942 17.807 20.6601 16.9999C21.1261 16.1929 21.3591 15.7894 21.411 15.395C21.4802 14.8691 21.3377 14.3372 21.0148 13.9164C20.8674 13.7243 20.6602 13.5628 20.3387 13.3608C19.8662 13.0639 19.5621 12.558 19.5621 11.9999C19.5621 11.4418 19.8662 10.9361 20.3387 10.6392C20.6603 10.4371 20.8675 10.2757 21.0149 10.0835C21.3378 9.66273 21.4803 9.13087 21.4111 8.60497C21.3592 8.21055 21.1262 7.80703 20.6602 7C20.1943 6.19297 19.9613 5.78945 19.6457 5.54727C19.2249 5.22436 18.693 5.08185 18.1671 5.15109C17.9271 5.18269 17.6837 5.28136 17.3479 5.4588C16.8545 5.71959 16.2644 5.73002 15.7811 5.45096C15.2977 5.17191 15.0117 4.65566 14.9909 4.09794C14.9767 3.71848 14.9404 3.45833 14.8477 3.23463C14.6448 2.74458 14.2554 2.35523 13.7654 2.15224Z" stroke="#1C274C" stroke-width="1.5"/>
            </svg>
          </button>
        </header>

        <section v-if="groups.length" class="motion-overlay__groups" aria-label="Groups">
          <article
            v-for="group in groups"
            :key="group.id"
            class="motion-overlay__group-card"
            :class="{ 'motion-overlay__group-card--drop': dragOverGroupId === group.id }"
            @dragover="onGroupDragOver(group.id, $event)"
            @dragleave="onGroupDragLeave(group.id)"
            @drop="onGroupDrop(group.id, $event)"
          >
            <button class="motion-overlay__group-head" type="button" @click="toggleGroup(group.id)">
              <h2>{{ group.name }}</h2>
              <span class="motion-overlay__group-badge">{{ group.tabs.length }}</span>
            </button>

            <Transition name="group-expand">
              <div v-if="!group.collapsed">
                <ul v-if="group.tabs.length" class="motion-overlay__group-list">
                  <li
                    v-for="tab in group.tabs"
                    :key="tab.id"
                    class="motion-overlay__group-tab"
                    @dragover="onGroupItemDragOver(group.id, tab.id, $event)"
                    @drop="onGroupItemDrop(group.id, tab.id, $event)"
                  >
                    <button
                      class="motion-overlay__group-tab-main"
                      type="button"
                      draggable="true"
                      @click="onGroupTabClick(tab)"
                      @auxclick.prevent="(event) => event.button === 1 && onGroupTabMiddleClick(tab)"
                      @dragstart="onGroupItemDragStart(group.id, tab.id, $event)"
                      @dragend="onGroupItemDragEnd"
                    >
                      <span class="motion-overlay__group-tab-icon" aria-hidden="true">
                        <img v-if="tab.favIconUrl" :src="tab.favIconUrl" alt="" />
                        <span v-else>{{ getTabFallbackTitle(tab.title, tab.url).slice(0, 1).toUpperCase() }}</span>
                      </span>
                      <span class="motion-overlay__group-tab-title">{{ tab.title }}</span>
                    </button>

                    <button
                      type="button"
                      class="motion-overlay__group-tab-menu-button"
                      :aria-label="`Menu for ${tab.title}`"
                      @click.stop="toggleItemMenu(group.id, tab.id)"
                    >
                      ⋮
                    </button>

                    <div
                      v-if="activeItemMenu?.groupId === group.id && activeItemMenu?.tabId === tab.id"
                      class="motion-overlay__group-tab-menu"
                    >
                      <button type="button" @click="startEditItem(group.id, tab)">Edit</button>
                      <button type="button" @click="deleteItem">Delete</button>
                    </div>
                  </li>
                </ul>
                <div v-else class="motion-overlay__group-empty">
                  <svg class="motion-overlay__group-empty-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 6V12L15 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <p class="motion-overlay__group-empty-text">Drop tabs here</p>
                </div>
              </div>
            </Transition>
          </article>
        </section>

        <section v-else class="motion-overlay__groups-empty" aria-label="Groups empty state">
          <div>
            <h2>No groups yet</h2>
            <p>Create a group, then drag tabs into it.</p>
          </div>
        </section>
      </main>

      <div v-if="isNewGroupOpen" class="motion-overlay__popup-backdrop">
        <form class="motion-overlay__popup" @submit.prevent="createGroup">
          <p class="motion-overlay__popup-label">New Group</p>
          <input
            ref="newGroupInput"
            v-model="newGroupName"
            type="text"
            placeholder="Group name"
            maxlength="40"
            @keydown.esc.prevent="closeNewGroup"
          />
          <div class="motion-overlay__popup-actions">
            <button type="button" class="motion-overlay__popup-button motion-overlay__popup-button--ghost" @click="closeNewGroup">
              Cancel
            </button>
            <button type="submit" class="motion-overlay__popup-button">Add</button>
          </div>
        </form>
      </div>

      <div v-if="editingItem" class="motion-overlay__popup-backdrop">
        <form class="motion-overlay__popup" @submit.prevent="saveEditItem">
          <p class="motion-overlay__popup-label">Edit Item</p>
          <input v-model="editingItem.title" type="text" maxlength="80" autofocus />
          <div class="motion-overlay__popup-actions">
            <button
              type="button"
              class="motion-overlay__popup-button motion-overlay__popup-button--ghost"
              @click="editingItem = null"
            >
              Cancel
            </button>
            <button type="submit" class="motion-overlay__popup-button">Save</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>
