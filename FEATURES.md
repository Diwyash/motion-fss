# Motion FSS — Features & Functionality

A custom UI extension for Chrome fullscreen mode — an elegant tab switcher overlay with tab groups and quick links.

---

## Activation

| Feature | Details |
|---|---|
| **Toggle Shortcut** | `Alt+W` (configurable via `chrome://extensions/shortcuts`) |
| **Auto-close** | Overlay closes when switching to a different tab |
| **Dismiss** | Click outside the overlay shell, or press `Escape` |

---

## Left Rail — Open Tabs

| Feature | Details |
|---|---|
| **Tab list** | Shows all open tabs in the current window with favicon, title |
| **Active tab indicator** | Subtle inset highlight on the currently active tab |
| **Selected indicator** | Blue background highlight for keyboard-navigated tab |
| **Keyboard navigation** | `Tab` / `Shift+Tab` to move selection up/down |
| **Activate tab** | Click tab or press `Enter` on selected tab |
| **Close tab** | Click the × button on any tab — immediate optimistic removal, re-fetches after background confirms |
| **Middle-click close** | Middle-click a tab to close it |
| **Drag tab to group** | Drag any tab from the list and drop onto a group sidebar item or into the open group content area |
| **Tab count badge** | Shows total number of open tabs |
| **Browser nav buttons** | ← and → buttons in the header navigate browser history (`chrome.tabs.goBack` / `goForward`) |
| **New Tab button** | Opens a new tab and dismisses the overlay |
| **Background** | White (`#ffffff`) |

### Drag ghost
- Appears instantly via cloned DOM element inside Shadow DOM
- Styled with white background, light border, slight rotation
- Cross (×) icon and menu buttons stripped from the ghost image

---

## Groups Panel

### Sidebar

| Feature | Details |
|---|---|
| **Group list** | Vertical list of all groups with name + tab count |
| **Select group** | Click a group name to view its tabs in the content area |
| **Active group highlight** | Blue background on the currently selected group |
| **Create group** | `+` button in sidebar header opens a name popup |
| **Edit group** | Right-click a group name to edit (popup) |
| **Delete group** | From group menu (⋮) → "Delete" |
| **Drag tabs to group** | Drop any tab from the left rail onto a sidebar group name |
| **Reorder groups** | Drag sidebar group items to reorder |
| **Drag-over highlight** | Blue inset glow and slight scale on the target group |
| **Count badge** | Shows number of tabs in each group |

### Content Area (active group)

| Feature | Details |
|---|---|
| **Group header** | Shows group name, back button, play-all button, and ⋮ menu |
| **Open All Tabs** | Play button or menu option opens all group tabs at once |
| **Group menu (⋮)** | Edit, Delete, Open All Tabs |
| **Tab list** | Lists all saved tabs in the active group |
| **Click tab** | Activates existing tab (by ID) or opens URL in new tab |
| **Middle-click tab** | Closes the existing tab |
| **3-dot menu per tab** | Edit title (popup), Delete from group |
| **Drag tabs from list** | Drop on group content body or on specific tab slot to insert |
| **Drag to reorder** | Drag group tab items to reorder within or across groups |
| **Empty state** | "Drop tabs here" with drag-over highlight |
| **Content body highlight** | Blue inset glow when dragging over the content area |

### Drag-and-drop on group

| Source | Target | Behavior |
|---|---|---|
| Tab list item | Sidebar group name | Tab added to that group |
| Tab list item | Open group content body | Tab added to open group |
| Tab list item | Specific tab slot | Tab inserted at that position |
| Group tab item | Other group tab slot | Tab moved (reorder) |
| Group tab item | Different group | Tab moved across groups |
| Sidebar group item | Other sidebar group | Groups reordered |

---

## Quick Links

| Feature | Details |
|---|---|
| **Display** | Row of favicon icons below the search bar, left-aligned |
| **Max count** | 9 quick links |
| **Add link** | `+` button opens URL popup — name derived from hostname |
| **Open link** | Click opens URL; if already open in a tab, activates that tab instead |
| **Keyboard shortcuts** | Keys `1`–`9` open the corresponding quick link |
| **Right-click** | Context menu with "Delete" option |
| **Persistence** | Stored in `chrome.storage.local` under `motion-fss:quick-links` |
| **Favicon** | Fetched via Google Favicons service (`s2/favicons`) |
| **Item size** | 36×36px, rounded, light gray background |
| **Add button** | Dashed border, shown only when fewer than 9 links exist |

---

## Search

| Feature | Details |
|---|---|
| **Search input** | Auto-focused when overlay opens |
| **Search tabs** | Searches open tab titles and URLs, shows up to 8 results |
| **Animated results** | Staggered drop-in animation on suggestions |
| **Keyboard navigation** | `↑` / `↓` to navigate results, `Enter` to select |
| **Web search** | Typing a query + `Enter` opens Google search in new tab |
| **URL navigation** | Typing a URL + `Enter` opens the URL |
| **Search mode UI** | Scaling animation on the search bar, blur on rail/quicklinks/groups |
| **Alt+K / Cmd+K** | Focus the search input |
| **Shadow** | Darker box-shadow with reduced spread |

---

## Popups & Menus

| Feature | Details |
|---|---|
| **Mutual exclusion** | Only one popup/menu open at a time |
| **Dismiss** | Click backdrop, press `Escape`, or open another popup |
| **New Group popup** | Group name input, Enter to confirm |
| **Edit Group popup** | Rename group |
| **Edit Item popup** | Rename a saved tab's title |
| **Add Quick Link popup** | URL input (name auto-derived) |
| **Group menu dropdown** | Edit, Delete, Open All Tabs |
| **Tab item menu** | Edit title, Delete — fixed-position at click coordinates |
| **Quick link context menu** | Delete — positioned above the icon |

---

## Persistence

| Data | Storage Key |
|---|---|
| Groups | `motion-fss:groups` |
| Active group | `motion-fss:active-group` |
| Quick links | `motion-fss:quick-links` |

All stored in `chrome.storage.local` and hydrated on mount.

---

## Architecture

| Component | File | Role |
|---|---|---|
| **Background service worker** | `src/background.ts` | Handles commands, tab queries, tab activation/close/create, browser nav |
| **Content script** | `src/content.ts` | Creates Shadow DOM overlay, mounts Vue app, toggles visibility |
| **Overlay component** | `src/overlay/Overlay.vue` | Main UI: tabs, groups, quick links, search, drag-and-drop |
| **Styles** | `src/overlay/overlay.scss` | Scoped styles injected into Shadow DOM |
| **Shared types** | `src/shared/messages.ts` | Message type constants and `OpenTab` type |
| **Shared utilities** | `src/shared/tabUtils.ts` | `getTabHost`, `getTabFallbackTitle` |

---

## Visual Design

| Area | Style |
|---|---|
| **Overlay backdrop** | Dark semi-transparent with radial gradient, blurred |
| **Shell** | White rounded container with box shadow, 700×350px |
| **Tab items** | 30px min-height, 8px border-radius, hover highlight |
| **Quick links** | 36px squares, 20px favicon images, 8px spacing |
| **Group sidebar** | 11px font, 6px border-radius, blue active state |
| **Group tabs** | Flex row with hover background, 6px padding, border-radius |
| **Popups/menus** | White background, rounded corners, box shadow |
| **Transitions** | Smooth opacity/transform/background transitions throughout |
