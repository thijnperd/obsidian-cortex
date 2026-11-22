// Cortex UI controller.

import { Camera } from './camera.js';
import { Renderer, PALETTE } from './renderer.js';
import { clamp, easeInOut, project } from './math.js';
import {
  renderMarkdown,
  toggleNthBallotBox,
  toggleNthTaskBox,
  extractNoteTallies,
  syncInlinePlayerTally,
} from './markdown.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { Atlas } from './atlas.js';
import {
  attachEditor,
  attachSelectionBubble,
  initRovingToolbar,
  openSlashMenu,
  runEditorCommand,
} from './editor.js';
import { mountLiveEditor } from './live-editor.js';
import { Tutorial } from './tutorial.js';
import { diaryFolders, isOverview } from './scale.js';
import { applyPlatformHints, key, mod } from './platform.js';
import * as localvault from './localvault.js';

const state = {
  graph: null,
  meta: null,
  live: false,
  vaultId: null,
  vaults: [],
  readOnly: false,
  renderer: null,
  atlas: null,
  camera: new Camera(),
  mode: 'universe',
  brain: 0,
  brainTarget: 0,
  reveal: 1,
  hover: null,
  selected: null,
  selection: new Set(),
  compose: null,
  hidden: new Set(),
  expandedFolders: new Set(),
  lookup: new Map(),
  incoming: new Map(),
  detail: null,
  editing: false,
  draft: '',
  cache: new Map(),
  labels: [],
  folderLabels: [],
  folderFocus: null,
  local: null,
  lastPick: 0,
  palette: { open: false, hits: [], active: 0, timer: null, query: '' },
  replay: { min: 0, max: 1, playing: false, startedAt: 0, undated: false },
  history: { items: [], index: -1 },
  events: null,
  version: null,
  about: null,
  update: null,
  launching: false,
  theme: 'dark',
  starMode: 'glow',
  brainMode: 'shell',
  activeTallySection: null,
  addingCustomTally: false,
  sidebarCollapsed: false,
  panelExpanded: false,
  surpriseSeed: 0,
  quickNoteTemplate: 'blank',
  studio: {
    tabs: [],
    activeId: null,
    viewMode: 'live',
    scope: 'all',
    folderFilter: null,
    filterQuery: '',
    sortBy: 'recent',
    listView: 'folders',
    openFolders: new Set(),
    revealedFor: null,
    listCollapsed: false,
    inspectorCollapsed: false,
    zenMode: false,
    inspectorTab: 'backlinks',
    dirty: false,
    autoSaveTimer: null,
    saving: false,
    mobileReading: false,
    liveController: null,
    activeTextarea: null,
    editorHandle: null,
    toolbarCleanup: null,
    bubbleCleanup: null,
  },
  time: 0,
  dragging: false,
  dragMoved: false,
  pointerX: 0,
  pointerY: 0,
  lastX: 0,
  lastY: 0,
};

const els = {
  canvas: document.getElementById('stage'),
  labels: document.getElementById('labels'),
  sectionFocus: document.getElementById('section-focus'),
  sectionFocusName: document.getElementById('section-focus-name'),
  sectionFocusExit: document.getElementById('section-focus-exit'),
  update: document.getElementById('update'),
  updateText: document.getElementById('update-text'),
  updateAction: document.getElementById('update-action'),
  updateClose: document.getElementById('update-close'),
  atlas: document.getElementById('atlas'),
  decisions: document.getElementById('decisions'),
  decisionsBoard: document.getElementById('decisions-board'),
  bento: document.getElementById('bento'),
  bentoBoard: document.getElementById('bento-board'),
  settings: document.getElementById('settings'),
  settingsButton: document.getElementById('settings-button'),
  todayNote: document.getElementById('today-note'),
  settingsClose: document.getElementById('settings-close'),
  settingsName: document.getElementById('settings-name'),
  settingsPath: document.getElementById('settings-path'),
  settingsObsidian: document.getElementById('settings-obsidian'),
  settingsViews: document.getElementById('settings-views'),
  settingsWrites: document.getElementById('settings-writes'),
  settingsStars: document.getElementById('settings-stars'),
  settingsBrainMode: document.getElementById('settings-brain-mode'),
  settingsRoads: document.getElementById('settings-roads'),
  settingsRoutes: document.getElementById('settings-routes'),
  settingsBiomes: document.getElementById('settings-biomes'),
  settingsBiomeList: document.getElementById('settings-biome-list'),
  settingsAgents: document.getElementById('settings-agents'),
  settingsAgentsHelp: document.getElementById('settings-agents-help'),
  settingsReveal: document.getElementById('settings-reveal'),
  settingsMcpTest: document.getElementById('settings-mcp-test'),
  settingsMcpConfig: document.getElementById('settings-mcp-config'),
  settingsMcpStatus: document.getElementById('settings-mcp-status'),
  settingsAbout: document.getElementById('settings-about'),
  settingsAutoUpdate: document.getElementById('settings-auto-update'),
  settingsUpdate: document.getElementById('settings-update'),
  settingsTheme: document.getElementById('settings-theme'),
  settingsThemeSystem: document.getElementById('settings-theme-system'),
  launchBrowse: document.getElementById('launch-browse'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  sidebarResize: document.getElementById('sidebar-resize'),
  themeToggle: document.getElementById('theme-toggle'),
  vaultButton: document.getElementById('vault-button'),
  vaultTitle: document.getElementById('vault-title'),
  vaultSub: document.getElementById('vault-sub'),
  stats: document.getElementById('stats'),
  folders: document.getElementById('folders'),
  foldersReset: document.getElementById('folders-reset'),
  tallies: document.getElementById('tallies'),
  tallyAdd: document.getElementById('tally-add'),
  vaultList: document.getElementById('vault-list'),
  addVault: document.getElementById('add-vault'),
  searchButton: document.getElementById('search-button'),
  tourButton: document.getElementById('tour-button'),
  newNote: document.getElementById('new-note'),
  panel: document.getElementById('panel'),
  panelResize: document.getElementById('panel-resize'),
  panelExpand: document.getElementById('panel-expand'),
  panelBody: document.getElementById('panel-body'),
  panelActions: document.getElementById('panel-actions'),
  panelCrumbs: document.getElementById('panel-crumbs'),
  panelClose: document.getElementById('panel-close'),
  panelBack: document.getElementById('panel-back'),
  panelForward: document.getElementById('panel-forward'),
  panelOpenStudio: document.getElementById('panel-open-studio'),
  pinnedBlock: document.getElementById('pinned-block'),
  pinnedList: document.getElementById('pinned-list'),
  surpriseNote: document.getElementById('surprise-note'),
  shortcutsButton: document.getElementById('shortcuts-button'),
  shortcutsModal: document.getElementById('shortcuts-modal'),
  shortcutsClose: document.getElementById('shortcuts-close'),
  quickNoteModal: document.getElementById('quick-note-modal'),
  quickNoteForm: document.getElementById('quick-note-form'),
  quickNoteTitle: document.getElementById('quick-note-title'),
  quickNoteFolder: document.getElementById('quick-note-folder'),
  quickNoteFolderList: document.getElementById('quick-note-folder-list'),
  quickNoteTemplates: document.getElementById('quick-note-templates'),
  quickNoteBody: document.getElementById('quick-note-body'),
  quickNoteClose: document.getElementById('quick-note-close'),
  quickNoteCancel: document.getElementById('quick-note-cancel'),
  notesStudio: document.getElementById('notes-studio'),
  notesListPane: document.getElementById('notes-list-pane'),
  notesListTitle: document.getElementById('notes-list-title'),
  notesListCount: document.getElementById('notes-list-count'),
  notesSort: document.getElementById('notes-sort'),
  notesNewBtn: document.getElementById('notes-new-btn'),
  notesFilter: document.getElementById('notes-filter'),
  notesScopes: document.getElementById('notes-scopes'),
  notesScopeFolder: document.getElementById('notes-scope-folder'),
  notesQuickForm: document.getElementById('notes-quick-form'),
  notesQuickInput: document.getElementById('notes-quick-input'),
  notesFeed: document.getElementById('notes-feed'),
  notesViewToggle: document.getElementById('notes-view-toggle'),
  notesMoreBtn: document.getElementById('notes-more-btn'),
  notesMoreMenu: document.getElementById('notes-more-menu'),
  notesToggleList: document.getElementById('notes-toggle-list'),
  notesMobileBack: document.getElementById('notes-mobile-back'),
  notesTabs: document.getElementById('notes-tabs'),
  notesTabNew: document.getElementById('notes-tab-new'),
  notesSaveStatus: document.getElementById('notes-save-status'),
  notesViewModes: document.getElementById('notes-view-modes'),
  notesPinBtn: document.getElementById('notes-pin-btn'),
  notesCopyLink: document.getElementById('notes-copy-link'),
  notesRevealFile: document.getElementById('notes-reveal-file'),
  notesLocateGraph: document.getElementById('notes-locate-graph'),
  notesZenBtn: document.getElementById('notes-zen-btn'),
  notesToggleInspector: document.getElementById('notes-toggle-inspector'),
  notesCanvas: document.getElementById('notes-canvas'),
  notesMiniOutline: document.getElementById('notes-mini-outline'),
  notesInspectorPane: document.getElementById('notes-inspector-pane'),
  notesInspectorClose: document.getElementById('notes-inspector-close'),
  notesInspectorTabs: document.getElementById('notes-inspector-tabs'),
  notesInspectorBody: document.getElementById('notes-inspector-body'),
  mobileBackdrop: document.getElementById('mobile-backdrop'),
  mobileMoreBtn: document.getElementById('mobile-more-btn'),
  mobileMoreLabel: document.getElementById('mobile-more-label'),
  mobileMoreSheet: document.getElementById('mobile-more-sheet'),
  mobileMoreClose: document.getElementById('mobile-more-close'),
  mobileActionVault: document.getElementById('mobile-action-vault'),
  mobileActionTheme: document.getElementById('mobile-action-theme'),
  mobileActionSurprise: document.getElementById('mobile-action-surprise'),
  palette: document.getElementById('palette'),
  paletteInput: document.getElementById('palette-input'),
  paletteResults: document.getElementById('palette-results'),
  replay: document.getElementById('replay'),
  replayRange: document.getElementById('replay-range'),
  replayPlay: document.getElementById('replay-play'),
  selection: document.getElementById('selection'),
  trayCount: document.getElementById('tray-count'),
  trayClear: document.getElementById('tray-clear'),
  compose: document.getElementById('compose'),
  composeForm: document.getElementById('compose-form'),
  composeKicker: document.getElementById('compose-kicker'),
  composeLabel: document.getElementById('compose-label'),
  composeTitle: document.getElementById('compose-title'),
  composeSub: document.getElementById('compose-sub'),
  composeCancel: document.getElementById('compose-cancel'),
  launch: document.getElementById('launch'),
  launchForm: document.getElementById('launch-form'),
  launchList: document.getElementById('launch-list'),
  launchPath: document.getElementById('launch-path'),
  launchError: document.getElementById('launch-error'),
  launchSubmit: document.getElementById('launch-submit'),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const tour = new Tutorial();
let tourSession = null;

// Local only, and optional: a private-mode browser just loses the memory.
const prefs = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

const TOUR_COMPLETE_KEY = 'cortex.tour.completed';
const THEME_KEY = 'cortex.theme';
const SIDEBAR_COLLAPSED_KEY = 'cortex.sidebar.collapsed';
const SIDEBAR_WIDTH_KEY = 'cortex.sidebar.width';
const PANEL_WIDTH_KEY = 'cortex.panel.width';
const DEFAULT_SIDEBAR_W = 236;
const DEFAULT_PANEL_W = 460;

const systemLightQuery = window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null;

function effectiveTheme() {
  if (state.theme === 'light' || state.theme === 'dark') return state.theme;
  return systemLightQuery?.matches ? 'light' : 'dark';
}

function syncThemeUI() {
  const rendered = effectiveTheme();
  const osLabel = systemLightQuery?.matches ? 'light' : 'dark';
  if (els.settingsThemeSystem) {
    els.settingsThemeSystem.textContent = `System (${osLabel})`;
  }
  if (els.settingsTheme) {
    els.settingsTheme.querySelectorAll('[data-theme-choice]').forEach((button) => {
      const active = button.dataset.themeChoice === state.theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  if (els.themeToggle) {
    const nextLabel = rendered === 'dark' ? 'Switch to Warm Light theme' : 'Switch to Dark theme';
    els.themeToggle.title = nextLabel;
    els.themeToggle.setAttribute('aria-label', nextLabel);
  }
}

function applyTheme(pref, { persist = true } = {}) {
  const valid = pref === 'dark' || pref === 'light' || pref === 'system' ? pref : 'dark';
  state.theme = valid;
  document.documentElement.dataset.theme = valid;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = valid === 'system' ? 'light dark' : valid;
  if (persist) prefs.set(THEME_KEY, valid);
  syncThemeUI();
}

function toggleTheme() {
  applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
}

function setSidebarWidth(px, { persist = false } = {}) {
  const clamped = Math.round(clamp(px, 188, 380));
  document.documentElement.style.setProperty('--sidebar-w', `${clamped}px`);
  if (persist) prefs.set(SIDEBAR_WIDTH_KEY, clamped);
}

function setPanelWidth(px, { persist = false } = {}) {
  const max = Math.max(420, Math.min(760, window.innerWidth - 120));
  const clamped = Math.round(clamp(px, 360, max));
  document.documentElement.style.setProperty('--panel-w', `${clamped}px`);
  if (persist) prefs.set(PANEL_WIDTH_KEY, clamped);
}

const isMobileViewport = () => Boolean(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
const isTabletViewport = () => Boolean(window.matchMedia && window.matchMedia('(max-width: 1120px)').matches);

const SECONDARY_MOBILE_MODES = {
  atlas: 'Atlas',
  replay: 'Timeline',
  bento: 'Bento',
};

let lastMobileViewport = isMobileViewport();
let lastTabletViewport = isTabletViewport();

function hasOpenMobileDrawer() {
  const moreOpen = Boolean(els.mobileMoreSheet && !els.mobileMoreSheet.hidden);
  const sidebarOpen = Boolean(els.sidebar && els.sidebar.classList.contains('is-mobile-open'));
  const inspectorOpen = Boolean(
    els.notesInspectorPane && els.notesInspectorPane.classList.contains('is-mobile-open'),
  );
  return moreOpen || sidebarOpen || inspectorOpen;
}

function syncMobileBackdrop() {
  if (!els.mobileBackdrop) return;
  els.mobileBackdrop.hidden = !hasOpenMobileDrawer();
}

function syncMobileMoreState() {
  const secondaryLabel = SECONDARY_MOBILE_MODES[state.mode] || null;
  if (els.mobileMoreBtn) {
    els.mobileMoreBtn.classList.toggle('is-active', Boolean(secondaryLabel));
  }
  if (els.mobileMoreLabel) {
    els.mobileMoreLabel.textContent = secondaryLabel || 'More';
  }
  if (els.mobileMoreSheet) {
    els.mobileMoreSheet.querySelectorAll('[data-mobile-mode]').forEach((btn) => {
      const active = btn.dataset.mobileMode === state.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
}

function closeMobileDrawers() {
  if (els.mobileMoreSheet) {
    els.mobileMoreSheet.hidden = true;
  }
  if (els.mobileMoreBtn) {
    els.mobileMoreBtn.setAttribute('aria-expanded', 'false');
  }
  if (els.sidebar && els.sidebar.classList.contains('is-mobile-open')) {
    els.sidebar.classList.remove('is-mobile-open');
    if (isMobileViewport()) els.sidebar.hidden = true;
    if (els.sidebarToggle) {
      els.sidebarToggle.setAttribute('aria-expanded', 'false');
      els.sidebarToggle.classList.remove('is-active');
    }
  }
  if (els.notesInspectorPane && els.notesInspectorPane.classList.contains('is-mobile-open')) {
    els.notesInspectorPane.classList.remove('is-mobile-open');
    if (els.notesToggleInspector) {
      els.notesToggleInspector.setAttribute('aria-pressed', 'false');
    }
  }
  syncMobileBackdrop();
}

function toggleMobileMoreSheet(force) {
  if (!els.mobileMoreSheet) return;
  const opening = typeof force === 'boolean' ? force : els.mobileMoreSheet.hidden;
  closeMobileDrawers();
  if (opening) {
    els.mobileMoreSheet.hidden = false;
    if (els.mobileMoreBtn) els.mobileMoreBtn.setAttribute('aria-expanded', 'true');
    syncMobileMoreState();
    syncMobileBackdrop();
  }
}

function handleViewportBreakpointChange() {
  const mobile = isMobileViewport();
  const tablet = isTabletViewport();
  const mobileChanged = mobile !== lastMobileViewport;
  const tabletChanged = tablet !== lastTabletViewport;
  if (!mobileChanged && !tabletChanged) return;
  lastMobileViewport = mobile;
  lastTabletViewport = tablet;

  closeMobileDrawers();
  if (mobileChanged) {
    syncSidebar();
    syncStudioMobileReading();
    if (state.mode === 'notes' && state.studio.viewMode === 'split') {
      renderNotesStudioHeaderControls();
      renderNotesStudioDocument();
    }
  }
  if (tabletChanged && els.notesToggleInspector) {
    const pressed = tablet
      ? Boolean(els.notesInspectorPane?.classList.contains('is-mobile-open'))
      : !state.studio.inspectorCollapsed;
    els.notesToggleInspector.setAttribute('aria-pressed', String(pressed));
  }
}

function syncSidebar() {
  const available = !state.launching && Boolean(state.graph);
  if (!available) {
    if (els.sidebarToggle) {
      els.sidebarToggle.hidden = true;
      els.sidebarToggle.setAttribute('aria-expanded', 'false');
      els.sidebarToggle.classList.remove('is-active');
    }
    els.sidebar.hidden = true;
    els.sidebar.classList.remove('is-mobile-open');
    document.body.classList.remove('has-sidebar');
    syncMobileBackdrop();
    return;
  }
  if (isMobileViewport()) {
    const mobileOpen = els.sidebar.classList.contains('is-mobile-open');
    if (els.sidebarToggle) {
      els.sidebarToggle.hidden = false;
      els.sidebarToggle.setAttribute('aria-expanded', String(mobileOpen));
      els.sidebarToggle.classList.toggle('is-active', mobileOpen);
    }
    els.sidebar.hidden = !mobileOpen;
    document.body.classList.remove('has-sidebar');
    syncMobileBackdrop();
    onResize();
    return;
  }
  els.sidebar.classList.remove('is-mobile-open');
  if (els.sidebarToggle) {
    els.sidebarToggle.hidden = false;
    els.sidebarToggle.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    els.sidebarToggle.classList.toggle('is-active', !state.sidebarCollapsed);
  }
  els.sidebar.hidden = state.sidebarCollapsed;
  document.body.classList.toggle('has-sidebar', !state.sidebarCollapsed);
  syncMobileBackdrop();
  onResize();
}

function toggleSidebar(force) {
  if (state.launching || !state.graph) return;
  if (isMobileViewport()) {
    const currentOpen = els.sidebar.classList.contains('is-mobile-open');
    const nextOpen = typeof force === 'boolean' ? !force : !currentOpen;
    closeMobileDrawers();
    if (nextOpen) {
      els.sidebar.classList.add('is-mobile-open');
      els.sidebar.hidden = false;
      if (els.sidebarToggle) {
        els.sidebarToggle.setAttribute('aria-expanded', 'true');
        els.sidebarToggle.classList.add('is-active');
      }
      syncMobileBackdrop();
    }
    return;
  }
  state.sidebarCollapsed = typeof force === 'boolean' ? force : !state.sidebarCollapsed;
  prefs.set(SIDEBAR_COLLAPSED_KEY, state.sidebarCollapsed);
  syncSidebar();
}

function setPanelExpanded(expanded) {
  state.panelExpanded = Boolean(expanded);
  document.body.classList.toggle('panel-expanded', state.panelExpanded);
  if (els.panelExpand) {
    els.panelExpand.setAttribute('aria-pressed', String(state.panelExpanded));
    const label = state.panelExpanded ? 'Restore panel width' : 'Expand focus reader';
    els.panelExpand.title = label;
    els.panelExpand.setAttribute('aria-label', label);
    const expandIcon = els.panelExpand.querySelector('.panel-icon-expand');
    const compressIcon = els.panelExpand.querySelector('.panel-icon-compress');
    if (expandIcon) expandIcon.hidden = state.panelExpanded;
    if (compressIcon) compressIcon.hidden = !state.panelExpanded;
  }
}

function wireResizeHandles() {
  if (els.sidebarResize) {
    let dragging = false;
    els.sidebarResize.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || state.sidebarCollapsed) return;
      event.preventDefault();
      dragging = true;
      document.body.classList.add('is-resizing');
      els.sidebarResize.setPointerCapture(event.pointerId);
    });
    els.sidebarResize.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      setSidebarWidth(event.clientX);
      onResize();
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing');
      setSidebarWidth(event.clientX, { persist: true });
      onResize();
    };
    els.sidebarResize.addEventListener('pointerup', finish);
    els.sidebarResize.addEventListener('pointercancel', finish);
    els.sidebarResize.addEventListener('dblclick', () => {
      setSidebarWidth(DEFAULT_SIDEBAR_W, { persist: true });
      onResize();
    });
    els.sidebarResize.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const current = els.sidebar.getBoundingClientRect().width || DEFAULT_SIDEBAR_W;
      setSidebarWidth(current + (event.key === 'ArrowRight' ? 16 : -16), { persist: true });
      onResize();
    });
  }

  if (els.panelResize) {
    let dragging = false;
    els.panelResize.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || state.panelExpanded) return;
      event.preventDefault();
      dragging = true;
      document.body.classList.add('is-resizing');
      els.panelResize.setPointerCapture(event.pointerId);
    });
    els.panelResize.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      setPanelWidth(window.innerWidth - event.clientX);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing');
      setPanelWidth(window.innerWidth - event.clientX, { persist: true });
    };
    els.panelResize.addEventListener('pointerup', finish);
    els.panelResize.addEventListener('pointercancel', finish);
    els.panelResize.addEventListener('dblclick', () => {
      setPanelWidth(DEFAULT_PANEL_W, { persist: true });
    });
    els.panelResize.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const current = els.panel.getBoundingClientRect().width || DEFAULT_PANEL_W;
      setPanelWidth(current + (event.key === 'ArrowLeft' ? 24 : -24), { persist: true });
    });
  }
}

function syncTourButton() {
  const complete = prefs.get(TOUR_COMPLETE_KEY, false);
  const label = complete ? 'Replay the guided tour' : 'Take the guided tour';
  const tourLabel = document.getElementById('tour-label');
  const startIcon = els.tourButton.querySelector('.tour-icon-start');
  const replayIcon = els.tourButton.querySelector('.tour-icon-replay');
  if (tourLabel) tourLabel.textContent = complete ? 'Replay' : 'Tour';
  if (startIcon) startIcon.hidden = complete;
  if (replayIcon) replayIcon.hidden = !complete;
  els.tourButton.title = label;
  els.tourButton.setAttribute('aria-label', label);
}

function viewForVault(id) {
  return prefs.get(`cortex.view.${id}`, prefs.get('cortex.launchView', 'brain'));
}

function launchView() {
  const checked = document.querySelector('input[name="launch-view"]:checked');
  return checked ? checked.value : 'universe';
}

const VIEWS = new Set(['notes', 'universe', 'brain', 'replay', 'atlas', 'bento', 'decisions']);

/// A marketing link can name the view it wants: `?view=brain`.
function requestedView() {
  const view = new URLSearchParams(window.location.search).get('view');
  return VIEWS.has(view) ? view : null;
}

function selectionIndices() {
  const indices = new Set();
  if (!state.graph) return indices;
  for (const id of state.selection) {
    const index = nodeIndex(id);
    if (index >= 0) indices.add(index);
  }
  return indices;
}

// ------------------------------------------------------------- local vaults

async function openLocalVaultDialog(message) {
  const dialog = document.getElementById('local-vault');
  if (!dialog) return;
  const status = document.getElementById('local-vault-status');
  if (status) status.textContent = message || '';
  const forget = document.getElementById('local-vault-forget');
  if (forget) forget.hidden = !(await localvault.hasLocalVault());
  dialog.hidden = false;
}

function closeLocalVaultDialog() {
  const dialog = document.getElementById('local-vault');
  if (dialog) dialog.hidden = true;
}

async function readDroppedEntry(entry, prefix = '') {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        if (prefix && !file.webkitRelativePath) {
          try {
            Object.defineProperty(file, 'webkitRelativePath', { value: `${prefix}${file.name}` });
          } catch {
            /* read-only property in some browsers */
          }
        }
        resolve([file]);
      }, () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = [];
    const readChunk = () => new Promise((resolve) => {
      reader.readEntries((batch) => resolve(batch || []), () => resolve([]));
    });
    while (true) {
      const batch = await readChunk();
      if (!batch.length) break;
      entries.push(...batch);
    }
    const nested = await Promise.all(
      entries.map((child) => readDroppedEntry(child, `${prefix}${entry.name}/`)),
    );
    return nested.flat();
  }
  return [];
}

async function extractDroppedFiles(dataTransfer) {
  if (!dataTransfer) return [];
  const items = [...(dataTransfer.items || [])];
  if (items.length && typeof items[0]?.webkitGetAsEntry === 'function') {
    const entries = items.map((item) => item.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) {
      const resolved = await Promise.all(entries.map((entry) => readDroppedEntry(entry, '')));
      const flat = resolved.flat();
      if (flat.length) return flat;
    }
  }
  return [...(dataTransfer.files || [])];
}

async function importLocalVault(source) {
  const isInput = source && 'files' in source;
  const files = isInput ? source.files : source;
  if (!files || !files.length) return;
  const status = document.getElementById('local-vault-status');
  const previous = status ? status.textContent : '';
  if (status) status.textContent = `Reading ${files.length} file${files.length === 1 ? '' : 's'}…`;
  try {
    const graph = await localvault.buildLocalVault(files);
    resetVaultState();
    state.live = false;
    state.vaultId = null;
    document.body.classList.add('is-static');
    applyGraph(graph);
    if (graph.nodes.length === 1) {
      setMode('notes', { persist: false, animate: false });
      await openNote(0);
    } else {
      setMode(requestedView() || state.mode || 'brain', { persist: false, animate: false });
    }
    closeLocalVaultDialog();
    ui.hideBoot();
    ui.toast(`${graph.meta.note_count} ${graph.meta.note_count === 1 ? 'note' : 'notes'} from this device`);
    if (!graph.local.persisted) {
      ui.toast('This browser refused storage, so the vault lasts until you close the tab');
    }
  } catch (error) {
    if (status) status.textContent = error.message || 'Could not read that vault.';
  } finally {
    if (isInput) source.value = '';
    if (status && !status.textContent) status.textContent = previous;
  }
}

function wireLocalVault() {
  const dialog = document.getElementById('local-vault');
  if (!dialog) return;
  const card = dialog.querySelector('.local-vault-card');
  const folder = document.getElementById('local-vault-folder');
  const files = document.getElementById('local-vault-files');
  // iPhone and iPad have no folder picker; the Files multi-select is the path.
  const mobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const folderButton = document.getElementById('local-vault-folder-button');
  if (folderButton && mobile) folderButton.hidden = true;

  document.getElementById('open-vault')?.addEventListener('click', () => openLocalVaultDialog(''));
  document.getElementById('local-vault-close')?.addEventListener('click', closeLocalVaultDialog);
  folderButton?.addEventListener('click', () => folder?.click());
  document.getElementById('local-vault-files-button')?.addEventListener('click', () => files?.click());
  folder?.addEventListener('change', () => importLocalVault(folder));
  files?.addEventListener('change', () => importLocalVault(files));

  const preventDrop = (event) => {
    event.preventDefault();
  };
  dialog.addEventListener('dragover', preventDrop);
  dialog.addEventListener('drop', preventDrop);
  if (card) {
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      card.classList.add('is-dragover');
    });
    card.addEventListener('dragleave', (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove('is-dragover');
    });
    card.addEventListener('drop', async (event) => {
      event.preventDefault();
      card.classList.remove('is-dragover');
      const dropped = await extractDroppedFiles(event.dataTransfer);
      if (dropped.length) importLocalVault(dropped);
    });
  }

  document.getElementById('local-vault-forget')?.addEventListener('click', async () => {
    await localvault.forgetLocalVault();
    closeLocalVaultDialog();
    ui.toast('Saved vault removed from this device');
    if (!state.live) location.reload();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeLocalVaultDialog();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.hidden) closeLocalVaultDialog();
  });
}

// The page ships a strict CSP (no inline script), so the shell worker is
// registered from this module instead of a <script> tag in index.html.
function registerShell() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

function boot() {
  state.studio.listView = prefs.get('cortex.notes.listView', 'folders') === 'list' ? 'list' : 'folders';
  state.studio.openFolders = new Set(prefs.get('cortex.notes.openFolders', []));
  wire();
  wireLocalVault();
  registerShell();
  start();
}

async function start() {
  try {
    const listing = await api.listVaults();
    if (listing) {
      state.live = true;
      state.readOnly = Boolean(listing.read_only);
      state.vaults = listing.vaults || [];
      ui.renderVaultList(els.vaultList, state.vaults, state.vaultId, openListedVault, revealVault);
      ui.renderLaunch(els.launchList, state.vaults, {
        onOpen: openListedVault,
        onForget: forgetVault,
      });
      const active = state.vaults.find(
        (vault) => vault.id === listing.active && !vault.missing,
      );
      if (active) {
        await switchVault(active.id, requestedView() || undefined);
      } else {
        showLaunch();
      }
      ui.hideBoot();
      requestAnimationFrame(loop);
      // The app checks once per launch unless opted out; a failure stays quiet
      // until the user asks in Vault settings, where an error is worth reporting.
      if (state.live && prefs.get('cortex.update.auto', true)) checkForUpdates();
      return;
    }

    document.body.classList.add('is-static');
    const graph = await api.loadStaticGraph();
    applyGraph(graph);
    syncSidebar();
    const view = requestedView() || 'brain';
    setMode(view, { persist: false, animate: false });
    document.addEventListener('visibilitychange', onVisibility);
    ui.hideBoot();
    requestAnimationFrame(loop);
  } catch (error) {
    if (state.live) {
      ui.hideBoot();
      showLaunch(error.message || 'Could not open that folder');
      requestAnimationFrame(loop);
    } else {
      ui.setBootStatus(error.message || 'Could not open that folder');
      openLocalVaultDialog('Open a vault from this device to get started.');
    }
  }
}

function applyStarMode(mode, { persist = true } = {}) {
  const valid = mode === 'anime' || mode === 'dots' ? mode : 'glow';
  state.starMode = valid;
  if (persist) prefs.set('cortex.graph.starMode', valid);
  if (state.renderer) state.renderer.setStarMode(valid);
  syncVisualSettingsUI();
}

function applyBrainMode(mode, { persist = true } = {}) {
  const valid = mode === 'notes' ? 'notes' : 'shell';
  state.brainMode = valid;
  if (persist) prefs.set('cortex.graph.brainMode', valid);
  if (state.renderer) {
    state.renderer.setBrainMode(valid);
    if (state.graph) buildLabels();
  }
  syncVisualSettingsUI();
}

function toggleBiomeChoice(biomeId) {
  const list = new Set(prefs.get('cortex.atlas.disabledBiomes', []));
  if (list.has(biomeId)) list.delete(biomeId);
  else list.add(biomeId);
  const arr = [...list];
  prefs.set('cortex.atlas.disabledBiomes', arr);
  if (state.atlas) state.atlas.setDisabledBiomes(list);
  syncVisualSettingsUI();
}

function syncVisualSettingsUI() {
  if (els.settingsStars) {
    els.settingsStars.querySelectorAll('[data-star-mode]').forEach((btn) => {
      const active = btn.dataset.starMode === state.starMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
  if (els.settingsBrainMode) {
    els.settingsBrainMode.querySelectorAll('[data-brain-mode]').forEach((btn) => {
      const active = btn.dataset.brainMode === state.brainMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
  if (els.settingsBiomes) {
    els.settingsBiomes.checked = prefs.get('cortex.atlas.biomes', true);
  }
  if (els.settingsBiomeList) {
    const biomesOn = prefs.get('cortex.atlas.biomes', true);
    const disabled = new Set(prefs.get('cortex.atlas.disabledBiomes', []));
    els.settingsBiomeList.classList.toggle('is-disabled', !biomesOn);
    els.settingsBiomeList.querySelectorAll('[data-biome]').forEach((btn) => {
      const active = biomesOn && !disabled.has(btn.dataset.biome);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = !biomesOn;
    });
  }
}

function wire() {
  applyPlatformHints();
  syncTourButton();
  applyTheme(prefs.get(THEME_KEY, 'dark'), { persist: false });
  state.starMode = prefs.get('cortex.graph.starMode', 'glow');
  state.brainMode = prefs.get('cortex.graph.brainMode', 'shell');
  state.sidebarCollapsed = Boolean(prefs.get(SIDEBAR_COLLAPSED_KEY, false));
  const savedSidebarW = Number(prefs.get(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_W));
  if (Number.isFinite(savedSidebarW)) setSidebarWidth(savedSidebarW);
  const savedPanelW = Number(prefs.get(PANEL_WIDTH_KEY, DEFAULT_PANEL_W));
  if (Number.isFinite(savedPanelW)) setPanelWidth(savedPanelW);
  wireResizeHandles();
  if (systemLightQuery) {
    systemLightQuery.addEventListener('change', syncThemeUI);
  }
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY) {
      applyTheme(prefs.get(THEME_KEY, 'dark'), { persist: false });
    }
  });

  const storedView = prefs.get('cortex.launchView', 'brain');
  const openingView = requestedView() || storedView;
  const storedRadio = document.querySelector(`input[name="launch-view"][value="${openingView}"]`);
  if (storedRadio) storedRadio.checked = true;

  if (els.sidebarToggle) {
    els.sidebarToggle.addEventListener('click', () => toggleSidebar());
  }
  if (els.themeToggle) {
    els.themeToggle.addEventListener('click', toggleTheme);
  }
  if (els.panelExpand) {
    els.panelExpand.addEventListener('click', () => setPanelExpanded(!state.panelExpanded));
  }
  if (els.settingsTheme) {
    els.settingsTheme.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
    });
  }

  els.canvas.addEventListener('pointerdown', onPointerDown);
  els.canvas.addEventListener('pointermove', onPointerMove);
  els.canvas.addEventListener('pointerup', onPointerUp);
  els.canvas.addEventListener('pointerleave', () => setHover(null));
  els.canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  document.querySelectorAll('.view[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetMode = button.dataset.mode;
      closeMobileDrawers();
      if (targetMode === 'notes' && isMobileViewport()) {
        if (state.mode === 'notes') {
          if (state.studio.dirty) saveStudioDraft({ quiet: true });
          setStudioMobileReading(false);
          return;
        }
        state.studio.mobileReading = false;
      }
      setMode(targetMode);
    });
  });
  if (els.mobileMoreBtn) {
    els.mobileMoreBtn.addEventListener('click', () => toggleMobileMoreSheet());
  }
  if (els.mobileMoreClose) {
    els.mobileMoreClose.addEventListener('click', () => closeMobileDrawers());
  }
  if (els.mobileBackdrop) {
    els.mobileBackdrop.addEventListener('click', () => closeMobileDrawers());
  }
  if (els.mobileMoreSheet) {
    els.mobileMoreSheet.querySelectorAll('[data-mobile-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mobileMode;
        closeMobileDrawers();
        if (mode) setMode(mode);
      });
    });
  }
  if (els.mobileActionTheme) {
    els.mobileActionTheme.addEventListener('click', () => {
      toggleTheme();
      closeMobileDrawers();
    });
  }
  if (els.mobileActionSurprise) {
    els.mobileActionSurprise.addEventListener('click', () => {
      closeMobileDrawers();
      openRandomNote();
    });
  }
  if (els.mobileActionVault) {
    els.mobileActionVault.addEventListener('click', () => {
      closeMobileDrawers();
      openLocalVaultDialog('');
    });
  }
  els.sectionFocusExit.addEventListener('click', () => clearFolderFocus());
  els.panelClose.addEventListener('click', closePanel);
  els.panelBack.addEventListener('click', goBack);
  els.panelForward.addEventListener('click', goForward);
  if (els.panelOpenStudio) {
    els.panelOpenStudio.addEventListener('click', () => {
      const targetId = state.detail?.id || (state.selected != null ? state.graph?.nodes[state.selected]?.id : null);
      if (targetId && isMobileViewport()) state.studio.mobileReading = true;
      setMode('notes');
      if (targetId) openNoteInStudio(targetId, { reveal: true });
    });
  }
  if (els.surpriseNote) {
    els.surpriseNote.addEventListener('click', openRandomNote);
  }
  if (els.shortcutsButton) {
    els.shortcutsButton.addEventListener('click', openShortcutsModal);
  }
  if (els.shortcutsClose) {
    els.shortcutsClose.addEventListener('click', closeShortcutsModal);
  }
  if (els.shortcutsModal) {
    els.shortcutsModal.addEventListener('click', (event) => {
      if (event.target === els.shortcutsModal) closeShortcutsModal();
    });
  }
  if (els.quickNoteForm) {
    els.quickNoteForm.addEventListener('submit', submitQuickNoteModal);
  }
  if (els.quickNoteClose) {
    els.quickNoteClose.addEventListener('click', closeQuickNoteModal);
  }
  if (els.quickNoteCancel) {
    els.quickNoteCancel.addEventListener('click', closeQuickNoteModal);
  }
  if (els.quickNoteModal) {
    els.quickNoteModal.addEventListener('click', (event) => {
      if (event.target === els.quickNoteModal) closeQuickNoteModal();
    });
  }
  if (els.quickNoteTemplates) {
    els.quickNoteTemplates.querySelectorAll('[data-note-tpl]').forEach((btn) => {
      btn.addEventListener('click', () => setQuickNoteTemplate(btn.dataset.noteTpl));
    });
  }
  wireNotesStudioEvents();
  els.selection.querySelectorAll('[data-template]').forEach((button) => {
    button.addEventListener('click', () => openCompose(button.dataset.template));
  });
  els.trayClear.addEventListener('click', clearSelection);
  els.composeForm.addEventListener('submit', submitCompose);
  els.composeCancel.addEventListener('click', closeCompose);
  els.composeTitle.addEventListener('input', updateComposeState);
  els.compose.addEventListener('click', (event) => {
    if (event.target === els.compose) closeCompose();
  });
  els.replayRange.addEventListener('input', onScrub);
  els.replayPlay.addEventListener('click', startReplay);
  els.newNote.addEventListener('click', () => openQuickNoteModal());
  els.todayNote.addEventListener('click', openDaily);
  els.paletteInput.addEventListener('input', () => {
    state.palette.query = els.paletteInput.value;
    scheduleSearch();
  });
  els.paletteInput.addEventListener('keydown', onPaletteKey);
  els.paletteResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-hit-index]');
    if (button) openHit(Number(button.dataset.hitIndex));
  });
  els.palette.addEventListener('click', (event) => {
    if (event.target === els.palette) closePalette();
  });
  els.searchButton.addEventListener('click', openPalette);
  els.tourButton.addEventListener('click', startTour);
  els.settingsButton.addEventListener('click', openSettings);
  els.settingsClose.addEventListener('click', closeSettings);
  els.settings.addEventListener('click', (event) => {
    if (event.target === els.settings) closeSettings();
  });
  els.settingsViews.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
  if (els.settingsStars) {
    els.settingsStars.querySelectorAll('[data-star-mode]').forEach((button) => {
      button.addEventListener('click', () => applyStarMode(button.dataset.starMode));
    });
  }
  if (els.settingsBrainMode) {
    els.settingsBrainMode.querySelectorAll('[data-brain-mode]').forEach((button) => {
      button.addEventListener('click', () => applyBrainMode(button.dataset.brainMode));
    });
  }
  els.settingsRoads.addEventListener('change', () => {
    prefs.set('cortex.atlas.roads', els.settingsRoads.checked);
    if (state.atlas) state.atlas.setRoads(els.settingsRoads.checked);
  });
  els.settingsRoutes.addEventListener('change', () => {
    prefs.set('cortex.atlas.routes', els.settingsRoutes.checked);
    if (state.atlas) state.atlas.setRoutes(els.settingsRoutes.checked);
  });
  if (els.settingsBiomes) {
    els.settingsBiomes.addEventListener('change', () => {
      prefs.set('cortex.atlas.biomes', els.settingsBiomes.checked);
      if (state.atlas) state.atlas.setBiomes(els.settingsBiomes.checked);
      syncVisualSettingsUI();
    });
  }
  if (els.settingsBiomeList) {
    els.settingsBiomeList.querySelectorAll('[data-biome]').forEach((button) => {
      button.addEventListener('click', () => toggleBiomeChoice(button.dataset.biome));
    });
  }
  if (els.tallyAdd) {
    els.tallyAdd.addEventListener('click', () => {
      state.addingCustomTally = !state.addingCustomTally;
      renderSidebarTallies();
    });
  }
  els.settingsAgents.addEventListener('change', () => {
    setAgentAccess(els.settingsAgents.checked);
  });
  els.settingsReveal.addEventListener('click', () => revealVault(currentVault()));
  els.launchBrowse.addEventListener('click', browseFolder);
  els.settingsMcpTest.addEventListener('click', testMcp);
  els.settingsMcpConfig.addEventListener('click', copyMcpConfig);
  els.settingsUpdate.addEventListener('click', () => checkForUpdates({ manual: true }));
  if (els.settingsAutoUpdate) {
    els.settingsAutoUpdate.addEventListener('change', () => {
      const enabled = Boolean(els.settingsAutoUpdate.checked);
      prefs.set('cortex.update.auto', enabled);
      ui.toast(
        enabled
          ? 'Automatic update checks enabled'
          : 'Automatic update checks disabled (offline-friendly)',
      );
    });
  }
  els.updateAction.addEventListener('click', installUpdate);
  els.updateClose.addEventListener('click', dismissUpdate);
  els.vaultButton.addEventListener('click', () => (state.live ? showLaunch() : openLocalVaultDialog('')));
  els.addVault.addEventListener('click', () => (state.live ? showLaunch() : openLocalVaultDialog('')));
  els.foldersReset.addEventListener('click', resetFolders);
  els.launchForm.addEventListener('submit', submitLaunch);
  document.addEventListener('visibilitychange', onVisibility);
}

/* ---------- vaults ---------- */

function currentVault() {
  return state.vaults.find((vault) => vault.id === state.vaultId) || null;
}

/// Hands the vault folder to Explorer, Finder or the file manager.
function revealVault(vault) {
  if (!vault) return;
  if (vault.missing) {
    ui.toast('That folder is no longer there');
    return;
  }
  // The id goes in the body: the query string is ignored by a POST route, and
  // any vault row can be revealed, not only the active one.
  api.revealInFolder({ vault: vault.id }, vault.id).catch((error) => ui.toast(error.message));
}

function syncAgentHelp(vault) {
  const on = vault.agents !== false;
  els.settingsAgents.checked = on;
  els.settingsAgentsHelp.textContent = on
    ? 'AI clients can read and write this vault over MCP. Turn this off to refuse them — including a client that is already connected.'
    : 'MCP clients are refused for this vault: cortex mcp will not start, and a connected client stops on its next call.';
}

async function setAgentAccess(enabled) {
  const vault = currentVault();
  if (!vault) return;
  try {
    const result = await api.setAgentAccess(vault.id, enabled);
    vault.agents = result.agents !== false;
    syncAgentHelp(vault);
    ui.toast(vault.agents ? 'Agent access is on' : 'Agent access is off');
  } catch (error) {
    els.settingsAgents.checked = !enabled;
    ui.toast(error.message);
  }
}

async function refreshVaults() {
  const listing = await api.listVaults();
  if (!listing) return;
  state.vaults = listing.vaults || [];
  ui.renderVaultList(els.vaultList, state.vaults, state.vaultId, openListedVault, revealVault);
  ui.renderLaunch(els.launchList, state.vaults, {
    onOpen: openListedVault,
    onForget: forgetVault,
  });
}

function showLaunch(message) {
  if (!state.live) {
    openLocalVaultDialog(message || '');
    return;
  }
  closeMobileDrawers();
  state.launching = true;
  els.tourButton.hidden = true;
  els.launch.hidden = false;
  if (els.stats) els.stats.hidden = true;
  syncSidebar();
  showLaunchError(message);
  els.launchPath.value = '';
  refreshVaults();
  resizeCamera();
  if (!message) els.launchPath.focus();
}

function showLaunchError(message) {
  els.launchError.hidden = !message;
  els.launchError.textContent = message || '';
}

function hideLaunch() {
  state.launching = false;
  els.launch.hidden = true;
  els.tourButton.hidden = !state.live || !state.graph;
  if (els.stats && state.graph) els.stats.hidden = false;
  showLaunchError(null);
  syncSidebar();
}

async function submitLaunch(event) {
  event.preventDefault();
  const path = els.launchPath.value.trim();
  if (!path) {
    showLaunchError('Enter the path to a folder of Markdown notes.');
    return;
  }
  els.launchSubmit.disabled = true;
  els.launchSubmit.textContent = 'Opening…';
  try {
    const view = launchView();
    const vault = await api.addVault(path);
    hideLaunch();
    await refreshVaults();
    await switchVault(vault.id, view);
  } catch (error) {
    showLaunchError(error.message || 'Could not open that folder.');
  } finally {
    els.launchSubmit.disabled = false;
    els.launchSubmit.textContent = 'Open';
  }
}

async function openListedVault(vault) {
  if (vault.missing) {
    showLaunchError('That folder is no longer there. Use Forget to remove it.');
    return;
  }
  closeMobileDrawers();
  try {
    const view = launchView();
    if (!vault.loaded) await api.addVault(vault.path);
    hideLaunch();
    await switchVault(vault.id, view);
  } catch (error) {
    showLaunchError(error.message || 'Could not open that folder.');
  }
}

async function forgetVault(vault) {
  try {
    await api.forgetVault(vault.id);
    if (vault.id === state.vaultId) {
      state.vaultId = null;
      state.graph = null;
      state.renderer = null;
      els.panel.hidden = true;
      els.sidebar.hidden = true;
      document.body.classList.remove('has-sidebar');
      showLaunch();
    }
    await refreshVaults();
  } catch (error) {
    showLaunchError(error.message || 'Could not remove that folder.');
  }
}

async function switchVault(id, view) {
  const { graph, version } = await api.fetchGraph(id);
  resetVaultState();
  state.vaultId = id;
  state.version = version;
  showApp();
  applyGraph(graph);
  setMode(view || viewForVault(id), { persist: false, animate: false });
  await refreshVaults();
  watchVault();
}

function showApp() {
  hideLaunch();
  syncSidebar();
  resizeCamera();
}

function resetVaultState() {
  closeMobileDrawers();
  cleanupStudioCanvas();
  clearTimeout(state.studio.autoSaveTimer);
  state.studio.dirty = false;
  state.studio.saving = false;
  state.studio.mobileReading = false;
  els.tourButton.hidden = true;
  state.cache.clear();
  state.selection.clear();
  state.history = { items: [], index: -1 };
  state.detail = null;
  state.editing = false;
  state.selected = null;
  state.hidden.clear();
  state.folderFocus = null;
  state.local = null;
  state.version = null;
  openToken += 1;
  if (state.events) state.events.abort();
  state.events = null;
  els.panel.hidden = true;
  els.selection.hidden = true;
  els.settings.hidden = true;
  if (state.atlas) state.atlas.reset();
  syncFolderFocus();
  syncHistory();
}

/** Long poll: the server answers the moment this vault's version changes. */
function watchVault() {
  if (state.events) state.events.abort();
  if (!state.live || !state.vaultId) return;
  const controller = new AbortController();
  state.events = controller;
  const vaultId = state.vaultId;

  (async () => {
    while (!controller.signal.aborted) {
      try {
        const info = await api.waitForChange(vaultId, state.version, controller.signal);
        if (controller.signal.aborted || state.vaultId !== vaultId) break;
        if (info.vault && info.vault !== vaultId) continue;
        if (!info.version || info.version === state.version) continue;
        if (state.studio.saving) continue;
        if (state.editing || (state.mode === 'notes' && (state.studio.dirty || state.studio.activeTextarea))) {
          // Do not pull the ground out from under a draft; offer a refresh instead.
          state.version = info.version;
          ui.toast('This note changed on disk. Save to overwrite, or close and reopen.');
          continue;
        }
        await refreshGraph();
      } catch (error) {
        if (controller.signal.aborted || error.name === 'AbortError') break;
        await sleep(1200);
      }
    }
  })();
}

/* ---------- graph ---------- */

async function refreshGraph() {
  if (!state.vaultId) return;
  try {
    const { graph, version } = await api.fetchGraph(state.vaultId);
    applyGraph(graph);
    state.version = version;
    if (state.hover != null) state.renderer.setFocus(state.hover);
  } catch {
    /* transient failure: keep the current view */
  }
}

function applyGraph(graph) {
  state.graph = graph;
  state.meta = graph.meta;
  if (!state.live) {
    const overrides = prefs.get(staticNoteOverridesKey(), {});
    for (const node of graph.nodes) {
      if (overrides[node.id]) node.body = overrides[node.id];
    }
  }
  document.title = `${graph.meta.title} — Cortex`;
  els.vaultTitle.textContent = graph.meta.title;
  els.vaultSub.textContent = state.live
    ? (currentVault()?.path || '')
    : localvault.isDeviceGraph(graph)
      ? 'on this device'
      : 'static demo';
  els.newNote.hidden = !state.live;
  els.todayNote.hidden = !state.live;
  els.tourButton.hidden = !state.live;
  const openVaultBtn = document.getElementById('open-vault');
  if (openVaultBtn) openVaultBtn.hidden = state.live;
  const overview = isOverview(graph.nodes.length);
  ui.setStats(graph.meta, overview);
  ui.renderDecisions(els.decisionsBoard, graph.structures, openDecision);
  syncBento();
  buildLookup();
  buildIncoming();
  renderSidebarPinned();
  renderSidebarFolders();
  renderSidebarTallies();
  if (state.live) preloadTallyNotes();
  initStudioForVault();

  if (!state.renderer) {
    state.renderer = new Renderer(els.canvas);
    state.renderer.onContextLost = () => ui.toast('Graphics context lost — reload to restore');
  }
  state.renderer.setStarMode(state.starMode);
  state.renderer.brainMode = state.brainMode;
  state.renderer.setGraph(graph);
  state.renderer.setFolderFilter(state.hidden);
  if (state.folderFocus && !graph.meta.folders.some((folder) => folder.name === state.folderFocus)) {
    state.folderFocus = null;
  }
  state.renderer.setFolderFocus(state.folderFocus);
  state.renderer.setLocalNodes(state.local?.nodes || null);
  if (state.brain > 0) state.renderer.setMorph(state.brain);
  if (state.detail) {
    const index = nodeIndex(state.detail.id);
    state.selected = index >= 0 ? index : null;
  }
  computeTimeline();
  buildLabels();
  syncFolderFocus();
  syncSelection();
  syncAtlas();
  if (state.selected != null) state.renderer.setFocus(state.selected);
  syncSidebar();
  resizeCamera();
  if (!state.replay.playing) {
    state.reveal = state.mode === 'replay' ? 0.015 : 1;
  }
}

function buildLookup() {
  state.lookup.clear();
  for (const node of state.graph.nodes) {
    state.lookup.set(node.id.toLowerCase(), node.id);
    state.lookup.set(node.title.toLowerCase(), node.id);
    const stem = node.id.split('/').pop();
    if (stem && !state.lookup.has(stem.toLowerCase())) state.lookup.set(stem.toLowerCase(), node.id);
  }
}

function buildIncoming() {
  state.incoming.clear();
  for (const edge of state.graph.edges) {
    const list = state.incoming.get(edge.target) || [];
    list.push({ source: edge.source, weight: edge.weight });
    state.incoming.set(edge.target, list);
  }
}

function resolveTarget(target) {
  let key = String(target || '')
    .trim()
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  key = key.split(/[#\^]/)[0].trim().replace(/\.md$/i, '').toLowerCase();
  if (!key) return null;
  return state.lookup.get(key) || state.lookup.get(key.split('/').pop()) || null;
}

/** A bento box names a folder; fly there in the graph, where the section lives. */
function openFolderInGraph(name) {
  setMode('universe', { persist: false });
  focusFolder(name);
}

/** A card names a note id; the board can open it without leaving the view. */
function openDecision(id) {
  const index = nodeIndex(id);
  if (index >= 0) openNote(index);
  else ui.toast('That note is not in this vault any more');
}

function nodeIndex(id) {
  if (!state.graph) return -1;
  return state.graph.nodes.findIndex((node) => node.id === id);
}

function computeTimeline() {
  let min = Infinity;
  let max = -Infinity;
  for (const node of state.graph.nodes) {
    const value = Date.parse(`${node.created}T00:00:00Z`);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  // No frontmatter dates (or all the same): say so instead of inventing a
  // year of history for the scrubber.
  state.replay.undated = !Number.isFinite(min) || max <= min;
  if (state.replay.undated) {
    min = Date.now() - 365 * 86400000;
    max = Date.now();
  }
  state.replay.min = min;
  state.replay.max = max;
}

function buildLabels() {
  els.labels.innerHTML = '';
  state.labels = [];
  state.folderLabels = [];

  const overview = isOverview(state.graph.nodes.length);
  const diaries = state.renderer?.diaries || diaryFolders(state.graph.nodes);
  // A large vault opens as a folder overview: individual stars are too small
  // to label usefully, and a dozen labels only add noise. Hovering still names
  // a note, and a selected note keeps its label. When focused on a folder or
  // local graph, include every note in that focus set so zooming in names them.
  const allEntries = state.graph.nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => b.node.pagerank - a.node.pagerank);
  let ranked;
  if (state.folderFocus) {
    ranked = allEntries.filter(
      (entry) => entry.node.folder === state.folderFocus || entry.index === state.selected,
    );
  } else if (state.local) {
    ranked = allEntries.filter((entry) => state.local.nodes.has(entry.index));
  } else {
    ranked = allEntries.slice(0, overview ? 0 : 36);
  }
  if (state.selected != null && !ranked.some((entry) => entry.index === state.selected)) {
    const index = state.selected;
    ranked.unshift({ node: state.graph.nodes[index], index });
  }
  for (const entry of ranked) {
    const element = document.createElement('span');
    element.className = 'star-label';
    element.setAttribute('aria-hidden', 'true');
    element.textContent = entry.node.title;
    els.labels.appendChild(element);
    state.labels.push({ index: entry.index, element });
  }

  // Section titles are folder names, just as Atlas names its countries. They
  // are placed first in updateLabels so note labels yield to them instead of
  // the other way around.
  const sections = new Map();
  for (const node of state.graph.nodes) {
    const entry = sections.get(node.folder) || { x: 0, y: 0, z: 0, n: 0, radius: 0, ringNode: null };
    entry.x += node.x; entry.y += node.y; entry.z += node.z; entry.n += 1;
    if (!entry.ringNode || node.pagerank > entry.ringNode.pagerank) entry.ringNode = node;
    sections.set(node.folder, entry);
  }
  for (const entry of sections.values()) {
    entry.cx = entry.x / entry.n;
    entry.cy = entry.y / entry.n;
    entry.cz = entry.z / entry.n;
  }
  for (const node of state.graph.nodes) {
    const entry = sections.get(node.folder);
    if (!entry) continue;
    const distance = Math.hypot(node.x - entry.cx, node.y - entry.cy, node.z - entry.cz);
    if (distance > entry.radius) entry.radius = distance;
  }

  const folders = [...state.graph.meta.folders]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  // Atlas caps permanent country names at 26 in overview; section titles use
  // the same limit instead of showing a title for only half the galaxies.
  const named = overview ? folders.slice(0, 26) : folders;
  for (const folder of named) {
    const section = sections.get(folder.name);
    if (!section || section.n === 0) continue;
    const diary = diaries.has(folder.name);
    const focusPosition = diary
      ? [0, 0, 0]
      : [section.cx, section.cy, section.cz];
    const ringNode = section.ringNode;
    const position = diary && ringNode
      ? [ringNode.x, ringNode.y, ringNode.z]
      : focusPosition;
    const radius = diary ? 2.35 : Math.max(0.08, section.radius);
    const focusDistance = diary ? 2.9 : clamp(radius * 3 + 0.35, 0.55, 2.4);

    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'star-label galaxy-label';
    element.textContent = folder.name;
    element.title = `Zoom to ${folder.name}`;
    element.setAttribute('aria-label', `Zoom to ${folder.name}`);
    element.addEventListener('click', () => focusFolder(folder.name));
    els.labels.appendChild(element);
    state.folderLabels.push({
      name: folder.name,
      element,
      diary,
      position,
      focusPosition,
      focusDistance,
      brainPosition: state.renderer.brainAnchors.get(folder.name) || null,
    });
  }
}

function resizeCamera() {
  if (!state.renderer) return;
  const width = els.canvas.clientWidth || 1;
  const height = els.canvas.clientHeight || 1;
  state.camera.aspect = width / height;
  state.renderer.resize();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - (loop.last || now)) / 1000);
  loop.last = now;
  if (!state.renderer) return;
  // A 30 fps cap is invisible while orbiting a folder overview and halves
  // the per-frame label, projection and GPU work on a large vault.
  if (state.renderer.overview && now - (loop.drawn || 0) < 1000 / 30) return;
  loop.drawn = now;
  if (state.mode === 'atlas') {
    if (state.atlas) state.atlas.tick(now);
    return;
  }
  // The boards and Notes Studio are DOM: no scene to draw, and no reason to keep paying for one.
  if (state.mode === 'decisions' || state.mode === 'bento' || state.mode === 'notes') return;

  state.time += dt;

  if (state.brain !== state.brainTarget) {
    const delta = state.brainTarget - state.brain;
    state.brain += delta * Math.min(1, dt * 4.2);
    if (Math.abs(delta) < 0.0015) state.brain = state.brainTarget;
  }
  state.renderer.setMorph(easeInOut(clamp(state.brain, 0, 1)));

  if (state.replay.playing) {
    const elapsed = (now - state.replay.startedAt) / 1000;
    const progress = clamp(elapsed / 15, 0, 1);
    state.reveal = 0.015 + progress * 0.985;
    els.replayRange.value = String(Math.round(progress * 1000));
    ui.setTimelineDate(formatDate(progress));
    if (progress >= 1) {
      state.replay.playing = false;
      els.replayPlay.textContent = 'Play';
    }
  }
  state.renderer.setReveal(state.reveal);

  state.camera.update(dt);
  state.renderer.render(state.camera, state.time);
  updateLabels();
}

function updateLabels() {
  const camera = state.camera;
  const placed = [];
  const focusSet = state.selected != null
    ? new Set([state.selected, ...(state.renderer.neighbors[state.selected] || [])])
    : null;
  const width = els.canvas.clientWidth || 1;
  const height = els.canvas.clientHeight || 1;
  const brain = state.brain > 0.35;

  // Folder titles are the map's anchor, exactly as country names are in the
  // Atlas: place them first, strongest folders first, and let note labels yield.
  for (const label of state.folderLabels) {
    const position = brain ? label.brainPosition : label.position;
    let visible = state.reveal >= 0.92
      && Boolean(position)
      && !state.hidden.has(label.name);
    let point = null;
    if (visible) {
      point = project(
        camera.viewProjection,
        position[0],
        position[1],
        position[2],
        width,
        height,
      );
      if (!point || point.x < 24 || point.x > width - 24 || point.y < 24 || point.y > height - 36) {
        visible = false;
      }
    }
    if (visible) {
      const half = Math.min(116, 18 + label.element.textContent.length * 3.3);
      for (const other of placed) {
        if (Math.abs(other.x - point.x) < half + other.half && Math.abs(other.y - point.y) < 42) {
          visible = false;
          break;
        }
      }
    }
    if (visible) placed.push({ x: point.x, y: point.y, half: Math.min(116, 18 + label.element.textContent.length * 3.3) });
    label.element.style.visibility = visible ? 'visible' : 'hidden';
    label.element.style.opacity = visible
      ? String(state.folderFocus && state.folderFocus !== label.name ? 0.32 : 0.86)
      : '0';
    if (point && visible) {
      label.element.style.left = `${point.x}px`;
      label.element.style.top = `${point.y}px`;
    }
  }

  // Greedy de-overlap: a note label only appears when it has room to breathe.
  const boxW = state.folderFocus || state.local ? 112 : 152;
  const boxH = state.folderFocus || state.local ? 26 : 36;
  for (const label of state.labels) {
    const screen = state.renderer.screenOf(label.index);
    const node = state.graph.nodes[label.index];
    const focused = state.hover === label.index || state.selected === label.index;
    let visible = screen.alpha > 0.5 && !state.hidden.has(node.folder)
      && (!state.folderFocus || node.folder === state.folderFocus || state.selected === label.index)
      && (!state.local || state.local.nodes.has(label.index))
      && screen.x > 40 && screen.x < width - 40 && screen.y > 24 && screen.y < height - 40;
    if (visible && focusSet && !focusSet.has(label.index)) visible = false;
    if (visible && !focused) {
      for (const other of placed) {
        if (Math.abs(other.x - screen.x) < boxW && Math.abs(other.y - screen.y) < boxH) {
          visible = false;
          break;
        }
      }
    }
    label.element.style.visibility = visible ? 'visible' : 'hidden';
    label.element.style.opacity = visible ? String(clamp(1.35 - screen.depth * 0.16, 0.28, 0.95)) : '0';
    if (visible) {
      placed.push({ x: screen.x, y: screen.y, half: boxW * 0.5 });
      label.element.style.left = `${screen.x}px`;
      label.element.style.top = `${screen.y}px`;
    }
  }
}

/// A two-hop neighbourhood: the video's useful local graph, not the whole
/// vault. Direct neighbours always fit; second-hop notes are ranked by
/// pagerank so a hub cannot turn the local view into the global one again.
function localAround(index) {
  const neighbours = state.renderer?.neighbors || [];
  const direct = [...new Set(neighbours[index] || [])].filter((other) => other !== index);
  const second = new Set();
  for (const other of direct) {
    for (const next of neighbours[other] || []) {
      if (next !== index && !direct.includes(next)) second.add(next);
    }
  }
  const ranked = [...second]
    .sort((a, b) => (state.graph.nodes[b].pagerank || 0) - (state.graph.nodes[a].pagerank || 0))
    .slice(0, Math.max(0, 120 - direct.length));
  return new Set([index, ...direct, ...ranked]);
}

function frameLocal(nodes) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const index of nodes) {
    const node = state.graph.nodes[index];
    x += node.x; y += node.y; z += node.z;
  }
  const n = Math.max(1, nodes.size);
  const center = [x / n, y / n, z / n];
  let radius = 0;
  for (const index of nodes) {
    const node = state.graph.nodes[index];
    radius = Math.max(radius, Math.hypot(node.x - center[0], node.y - center[1], node.z - center[2]));
  }
  state.camera.focusOn(center, clamp(radius * 2.6 + 0.35, 0.55, 2.5));
}

function showLocalGraph(index) {
  if (index == null || !state.graph) return;
  if (state.mode !== 'universe') setMode('universe', { persist: false, animate: false });
  const nodes = localAround(index);
  state.local = { center: index, nodes };
  state.folderFocus = null;
  syncFolderFocus();
  state.renderer.setLocalNodes(nodes);
  state.renderer.setFocus(index);
  frameLocal(nodes);
}

function clearLocalGraph({ resetCamera = true, rerender = true } = {}) {
  if (!state.local) return;
  state.local = null;
  if (state.renderer) {
    state.renderer.setLocalNodes(null);
    state.renderer.setFocus(state.selected);
  }
  if (state.graph) buildLabels();
  if (resetCamera) state.camera.frame(state.mode);
  if (rerender && state.detail) renderPanel(state.detail);
}

function focusFolder(name) {
  const label = state.folderLabels.find((folder) => folder.name === name);
  if (!label || !state.renderer) return;
  const brain = state.brain > 0.35;
  const target = brain
    ? (label.diary ? [0, 0, 0] : label.brainPosition || label.focusPosition)
    : label.focusPosition;
  state.folderFocus = name;
  state.camera.focusOn(target, brain ? 1.55 : label.focusDistance);
  syncFolderFocus();
}

/// Reflect the focused section in the chip, the titles and the renderer dimming.
function syncFolderFocus() {
  const active = Boolean(state.folderFocus);
  els.sectionFocus.hidden = !active;
  if (active) els.sectionFocusName.textContent = state.folderFocus;
  for (const label of state.folderLabels) {
    const current = label.name === state.folderFocus;
    label.element.classList.toggle('is-active', current);
    label.element.setAttribute('aria-pressed', String(current));
  }
  if (state.renderer) state.renderer.setFolderFocus(state.folderFocus);
  if (state.graph) buildLabels();
}

function clearFolderFocus({ resetCamera = true } = {}) {
  if (!state.folderFocus) return;
  state.folderFocus = null;
  syncFolderFocus();
  if (resetCamera) state.camera.frame(state.mode);
}

function formatDate(progress) {
  if (state.replay.undated) return 'No dates in this vault';
  const value = state.replay.min + (state.replay.max - state.replay.min) * clamp(progress, 0, 1);
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function setMode(mode, { persist = true, animate = true } = {}) {
  const prevMode = state.mode;
  if (prevMode === 'notes' && mode !== 'notes') {
    if (state.studio.dirty) saveStudioDraft({ quiet: true });
    cleanupStudioCanvas();
  }
  closeMobileDrawers();
  state.mode = mode;
  if (state.folderFocus) clearFolderFocus({ resetCamera: false });
  if (state.local) clearLocalGraph({ resetCamera: false, rerender: false });
  ui.setModeButtons(mode);
  syncMobileMoreState();
  syncSettingsViews();

  const notesMode = mode === 'notes';
  const atlasMode = mode === 'atlas';
  const boardMode = mode === 'decisions';
  const bentoMode = mode === 'bento';
  const domMode = boardMode || bentoMode || notesMode;
  els.replay.hidden = mode !== 'replay';
  els.canvas.hidden = atlasMode || domMode;
  els.labels.hidden = atlasMode || domMode;
  els.atlas.hidden = !atlasMode;
  els.decisions.hidden = !boardMode;
  els.bento.hidden = !bentoMode;
  if (els.notesStudio) els.notesStudio.hidden = !notesMode;
  document.body.classList.toggle('mode-notes', notesMode);
  document.body.classList.toggle('mode-atlas', atlasMode);
  document.body.classList.toggle('mode-decisions', boardMode);
  document.body.classList.toggle('mode-bento', bentoMode);
  document.body.classList.toggle('mode-replay', mode === 'replay');

  if (notesMode) {
    if (!els.panel.hidden) els.panel.hidden = true;
    ensureStudioActiveNote();
    renderNotesStudio();
    renderSidebarPinned();
  } else if (atlasMode) {
    const atlas = ensureAtlas();
    syncAtlas();
    atlas.setRoads(prefs.get('cortex.atlas.roads', true));
    atlas.setRoutes(prefs.get('cortex.atlas.routes', true));
    atlas.setBiomes(prefs.get('cortex.atlas.biomes', true));
    atlas.setDisabledBiomes(new Set(prefs.get('cortex.atlas.disabledBiomes', [])));
    atlas.resize();
    atlas.dirty = true;
    els.atlas.focus({ preventScroll: true });
  } else {
    state.brainTarget = mode === 'brain' ? 1 : 0;
    state.camera.frame(mode);
    resizeCamera();
  }

  if (mode === 'replay' && animate) {
    beginReplay();
  } else {
    state.replay.playing = false;
    els.replayPlay.textContent = 'Play';
    state.reveal = 1;
    if (mode === 'replay') ui.setTimelineDate(formatDate(1));
  }

  if (persist && state.vaultId) {
    prefs.set(`cortex.view.${state.vaultId}`, mode);
    prefs.set('cortex.launchView', mode);
  }
}

function startReplay() {
  if (state.mode !== 'replay') {
    setMode('replay');
    return;
  }
  beginReplay();
}

function beginReplay() {
  state.reveal = 0.015;
  state.replay.playing = true;
  state.replay.startedAt = performance.now();
  els.replayRange.value = '0';
  els.replayPlay.textContent = 'Playing';
  ui.setTimelineDate(formatDate(0));
}

function onScrub(event) {
  state.replay.playing = false;
  els.replayPlay.textContent = 'Play';
  state.mode = 'replay';
  ui.setModeButtons('replay');
  syncMobileMoreState();
  els.replay.hidden = false;
  state.brainTarget = 0;
  const progress = Number(event.target.value) / 1000;
  state.reveal = 0.015 + progress * 0.985;
  ui.setTimelineDate(formatDate(progress));
}

function renderSidebarFolders() {
  if (!state.graph) return;
  const selectedId = state.selected != null ? state.graph.nodes[state.selected]?.id : null;
  ui.renderFolders(els.folders, state.graph.meta.folders, state.hidden, toggleFolder, PALETTE, {
    nodes: state.graph.nodes,
    expanded: state.expandedFolders,
    selectedId,
    onToggleExpand: toggleFolderExpand,
    onOpenNote: (index) => {
      if (isMobileViewport()) closeMobileDrawers();
      openNote(index);
    },
  });
  ui.syncFolders(state.hidden);
}

function toggleFolderExpand(name) {
  if (state.expandedFolders.has(name)) state.expandedFolders.delete(name);
  else state.expandedFolders.add(name);
  renderSidebarFolders();
}

function toggleFolder(name) {
  if (isMobileViewport()) closeMobileDrawers();
  if (state.mode === 'notes') {
    if (state.studio.scope === 'folder' && state.studio.folderFilter === name) {
      setStudioScope('all');
    } else {
      setStudioFolderFilter(name);
    }
    if (isMobileViewport()) setStudioMobileReading(false);
    return;
  }
  if (state.hidden.has(name)) state.hidden.delete(name);
  else state.hidden.add(name);
  if (state.hidden.has(name) && state.folderFocus === name) clearFolderFocus();
  ui.syncFolders(state.hidden);
  state.renderer.setFolderFilter(state.hidden);
  if (state.atlas) state.atlas.setHidden(state.hidden);
  syncBento();
}

function resetFolders() {
  if (isMobileViewport()) closeMobileDrawers();
  state.hidden.clear();
  if (state.mode === 'notes') {
    setStudioScope('all');
    if (isMobileViewport()) setStudioMobileReading(false);
  }
  ui.syncFolders(state.hidden);
  state.renderer.setFolderFilter(state.hidden);
  if (state.atlas) state.atlas.setHidden(state.hidden);
  syncBento();
}

/* ---------- tallies & point trackers ---------- */

function vaultStorageKey() {
  return state.vaultId || state.meta?.title || 'default';
}

function staticNoteOverridesKey() {
  return `cortex.noteOverrides.${vaultStorageKey()}`;
}

function customTalliesKey() {
  return `cortex.tallies.custom.${vaultStorageKey()}`;
}

async function preloadTallyNotes() {
  if (!state.live || !state.graph) return;
  const candidates = state.graph.nodes.filter(
    (node) =>
      /point|tally|tracker|score|cool|crybaby/i.test(node.title)
      || /[\u2610\u2611\u2612]/.test(node.excerpt || ''),
  );
  let loadedAny = false;
  for (const node of candidates.slice(0, 6)) {
    if (state.cache.has(node.id)) continue;
    try {
      const detail = await api.fetchNote(node.id, state.vaultId);
      if (detail) {
        state.cache.set(node.id, detail);
        loadedAny = true;
      }
    } catch {
      /* ignore transient fetch failure */
    }
  }
  if (loadedAny) renderSidebarTallies();
}

function getNoteSourceForTally(node) {
  if (!node) return '';
  if (state.detail && state.detail.id === node.id) {
    return state.detail.raw || state.detail.markdown || node.body || '';
  }
  if (state.cache.has(node.id)) {
    const cached = state.cache.get(node.id);
    return cached.raw || cached.markdown || node.body || '';
  }
  return node.body || '';
}

function collectVaultTallySections() {
  if (!state.graph) return [];
  const primary = [];
  const fallback = [];
  for (const node of state.graph.nodes) {
    const src = getNoteSourceForTally(node);
    if (!src || !/[\u2610\u2611\u2612]/.test(src)) continue;
    let body = src;
    const heading = /^\s*#\s+(.+)\r?\n/.exec(body);
    if (heading && heading[1].trim().toLowerCase() === node.title.trim().toLowerCase()) {
      body = body.slice(heading[0].length);
    }
    const extracted = extractNoteTallies(body, node.id, node.title);
    const isDedicated = /point|tally|tracker|cool|crybaby|score/i.test(node.title);
    for (const sec of extracted) {
      if (isDedicated || /point|tally|tracker|cool|crybaby|score/i.test(sec.title)) {
        primary.push(sec);
      } else {
        fallback.push(sec);
      }
    }
  }
  return primary.length ? primary : fallback;
}

function renderSidebarTallies() {
  if (!els.tallies || !state.graph) return;
  const sections = collectVaultTallySections();
  if (sections.length && !sections.some((s) => s.id === state.activeTallySection)) {
    state.activeTallySection = sections[0].id;
  }
  const customCounters = prefs.get(customTalliesKey(), []);
  ui.renderTallies(els.tallies, {
    sections,
    activeSectionId: state.activeTallySection,
    customCounters,
    addingCustom: state.addingCustomTally,
    onSelectSection: (secId) => {
      state.activeTallySection = secId;
      renderSidebarTallies();
    },
    onToggleNotePip: (noteId, pipIndex, row) => {
      toggleNoteBallotPip(noteId, pipIndex, row?.targetNote || null);
    },
    onOpenNoteByTarget: (target) => {
      const id = resolveTarget(target);
      if (!id) {
        ui.toast(`No note called “${target}” yet`);
        return;
      }
      const idx = nodeIndex(id);
      if (idx >= 0) openNote(idx);
    },
    onOpenSourceNote: (noteId) => {
      const idx = nodeIndex(noteId);
      if (idx >= 0) openNote(idx);
    },
    onAdjustCustom: (id, delta) => adjustCustomTally(id, delta),
    onToggleCustomPip: (id, pipSlot) => toggleCustomTallyPip(id, pipSlot),
    onAddCustom: (label) => addCustomTally(label),
    onDeleteCustom: (id) => deleteCustomTally(id),
    onCancelAdd: () => {
      state.addingCustomTally = false;
      renderSidebarTallies();
    },
  });
}

async function persistModifiedNoteSource(noteId, updatedSource) {
  const idx = nodeIndex(noteId);
  const node = idx >= 0 ? state.graph.nodes[idx] : null;
  if (node) node.body = updatedSource;

  if (state.cache.has(noteId)) {
    const cached = state.cache.get(noteId);
    cached.markdown = updatedSource;
    if (cached.raw != null) cached.raw = updatedSource;
  }
  if (state.detail && state.detail.id === noteId) {
    state.detail.markdown = updatedSource;
    if (state.detail.raw != null) state.detail.raw = updatedSource;
  }

  if (state.live && !state.readOnly) {
    try {
      const res = await api.saveNote({ id: noteId, content: updatedSource }, state.vaultId);
      state.version = res.version;
    } catch (error) {
      ui.toast(error.message || 'Could not save tally change');
    }
  } else {
    const overrides = prefs.get(staticNoteOverridesKey(), {});
    overrides[noteId] = updatedSource;
    prefs.set(staticNoteOverridesKey(), overrides);
  }
}

async function syncLinkedPlayerTalliesFromSource(noteId, noteTitle, updatedSource, linkedPlayerTarget = null) {
  const updatedSections = extractNoteTallies(updatedSource, noteId, noteTitle);
  if (!updatedSections.length) return;
  const targetsToSync = new Set();
  if (linkedPlayerTarget) targetsToSync.add(linkedPlayerTarget);
  else {
    for (const sec of updatedSections) {
      for (const r of sec.rows) {
        if (r.targetNote) targetsToSync.add(r.targetNote);
      }
    }
  }
  for (const target of targetsToSync) {
    const playerId = resolveTarget(target);
    if (!playerId || playerId === noteId) continue;
    let coolCount = null;
    let crybabyCount = null;
    for (const sec of updatedSections) {
      const row = sec.rows.find(
        (r) => r.targetNote && resolveTarget(r.targetNote) === playerId,
      );
      if (!row) continue;
      const mainPips = row.pips.filter((p) => !p.isBonus).slice(0, 3);
      const count = mainPips.filter((p) => p.checked).length;
      if (/cool/i.test(sec.title)) coolCount = count;
      else if (/crybaby/i.test(sec.title)) crybabyCount = count;
    }
    if (coolCount !== null || crybabyCount !== null) {
      const pIdx = nodeIndex(playerId);
      const pNode = pIdx >= 0 ? state.graph.nodes[pIdx] : null;
      if (pNode) {
        const pSource = getNoteSourceForTally(pNode);
        if (pSource && /cool\s+[\u2610\u2611\u2612]/i.test(pSource)) {
          const syncedPlayer = syncInlinePlayerTally(pSource, coolCount, crybabyCount);
          if (syncedPlayer !== pSource) {
            await persistModifiedNoteSource(playerId, syncedPlayer);
          }
        }
      }
    }
  }
}

async function toggleNoteBallotPip(noteId, pipIndex, linkedPlayerTarget = null) {
  const idx = nodeIndex(noteId);
  if (idx < 0) return;
  const node = state.graph.nodes[idx];
  let source = getNoteSourceForTally(node);
  if (!source && state.live) {
    const detail = await getDetail(node);
    source = detail?.raw || detail?.markdown || '';
  }
  if (!source) return;

  const updated = toggleNthBallotBox(source, pipIndex);
  await persistModifiedNoteSource(noteId, updated);

  // If this note is a Points table and row points to a player note, sync the player's inline tally!
  await syncLinkedPlayerTalliesFromSource(noteId, node.title, updated, linkedPlayerTarget);

  if (state.detail && state.detail.id === noteId) {
    state.draft = updated;
  }
  if (state.mode === 'notes' && state.detail) {
    const scroll = els.notesCanvas ? els.notesCanvas.scrollTop : 0;
    renderNotesStudioDocument({ preserveScroll: scroll });
  } else if (state.detail && !state.editing) {
    const scroll = els.panelBody.scrollTop;
    renderPanel(state.detail, { preserveScroll: scroll });
  }
  renderSidebarTallies();
}

async function toggleNoteTaskPip(noteId, taskIndex) {
  const idx = nodeIndex(noteId);
  if (idx < 0) return;
  const node = state.graph.nodes[idx];
  const source = getNoteSourceForTally(node);
  if (!source) return;
  const updated = toggleNthTaskBox(source, taskIndex);
  await persistModifiedNoteSource(noteId, updated);
  if (state.detail && state.detail.id === noteId) {
    state.draft = updated;
  }
  if (state.mode === 'notes' && state.detail && state.detail.id === noteId) {
    const scroll = els.notesCanvas ? els.notesCanvas.scrollTop : 0;
    renderNotesStudioDocument({ preserveScroll: scroll });
  } else if (state.detail && state.detail.id === noteId && !state.editing) {
    const scroll = els.panelBody.scrollTop;
    renderPanel(state.detail, { preserveScroll: scroll });
  }
}

function addCustomTally(label) {
  const list = prefs.get(customTalliesKey(), []);
  list.push({
    id: `c_${Date.now()}_${list.length}`,
    label,
    count: 0,
    max: 3,
  });
  prefs.set(customTalliesKey(), list);
  state.addingCustomTally = false;
  renderSidebarTallies();
}

function adjustCustomTally(id, delta) {
  const list = prefs.get(customTalliesKey(), []);
  const item = list.find((c) => c.id === id);
  if (!item) return;
  const max = item.max || 3;
  item.count = clamp((item.count || 0) + delta, 0, max);
  prefs.set(customTalliesKey(), list);
  renderSidebarTallies();
}

function toggleCustomTallyPip(id, pipSlot) {
  const list = prefs.get(customTalliesKey(), []);
  const item = list.find((c) => c.id === id);
  if (!item) return;
  const current = item.count || 0;
  item.count = current === pipSlot + 1 ? pipSlot : pipSlot + 1;
  prefs.set(customTalliesKey(), list);
  renderSidebarTallies();
}

function deleteCustomTally(id) {
  const list = prefs.get(customTalliesKey(), []).filter((c) => c.id !== id);
  prefs.set(customTalliesKey(), list);
  renderSidebarTallies();
}

/** The bento board is DOM, so a folder toggle is a cheap re-render. */
function syncBento() {
  if (!state.graph) return;
  ui.renderBento(els.bentoBoard, state.graph, state.hidden, {
    onOpen: openDecision,
    onFolder: openFolderInGraph,
    palette: PALETTE,
  });
}

/* ---------- atlas ---------- */

function ensureAtlas() {
  if (state.atlas) return state.atlas;
  state.atlas = new Atlas(els.atlas, {
    onSelect: (index, additive) => {
      if (additive) toggleSelection(index);
      else openNote(index);
    },
    onHover: (index, x, y) => {
      if (index == null || !state.graph) ui.hideTooltip();
      else ui.showTooltip(state.graph.nodes[index], x, y);
    },
    onBackground: () => {
      if (!els.panel.hidden) closePanel();
    },
  });
  state.atlas.setRoads(prefs.get('cortex.atlas.roads', true));
  state.atlas.setRoutes(prefs.get('cortex.atlas.routes', true));
  state.atlas.setBiomes(prefs.get('cortex.atlas.biomes', true));
  state.atlas.setDisabledBiomes(new Set(prefs.get('cortex.atlas.disabledBiomes', [])));
  return state.atlas;
}

function syncAtlas() {
  if (!state.atlas || !state.graph) return;
  state.atlas.setGraph(state.graph);
  state.atlas.setHidden(state.hidden);
  state.atlas.setSelection(selectionIndices());
  state.atlas.setFocus(state.selected);
}

function syncSettingsViews() {
  if (!els.settingsViews) return;
  els.settingsViews.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function browseFolder() {
  if (!els.launchBrowse) return;
  els.launchBrowse.disabled = true;
  try {
    const picked = await api.pickFolder();
    if (picked?.path) {
      els.launchPath.value = picked.path;
      els.launchForm.requestSubmit();
    }
  } catch (error) {
    showLaunchError(error.message);
  } finally {
    els.launchBrowse.disabled = false;
  }
}

async function refreshMcpStatus() {
  if (!els.settingsMcpStatus) return;
  els.settingsMcpStatus.textContent = 'Checking the MCP server…';
  try {
    const status = await api.mcpStatus();
    const clients = (status.clients || [])
      .map(
        (client) =>
          `${client.name}: ${client.configured ? 'configured' : client.present ? 'not configured' : 'not installed'}`,
      )
      .join(' · ');
    els.settingsMcpStatus.textContent = `${status.agents ? 'Agent access on' : 'Agent access off'}${clients ? ` · ${clients}` : ''}`;
  } catch (error) {
    els.settingsMcpStatus.textContent = error.message;
  }
}

async function testMcp() {
  if (!currentVault()) return;
  els.settingsMcpTest.disabled = true;
  els.settingsMcpStatus.textContent = 'Starting cortex mcp…';
  try {
    const result = await api.testMcp();
    els.settingsMcpStatus.textContent = result.ok
      ? `Connected: ${result.tools} tools, MCP ${result.server}.`
      : result.error || 'The MCP server refused';
    ui.toast(result.ok ? 'The MCP server answered' : 'MCP test failed');
  } catch (error) {
    els.settingsMcpStatus.textContent = error.message;
  } finally {
    els.settingsMcpTest.disabled = false;
  }
}

async function copyMcpConfig() {
  try {
    const status = await api.mcpStatus();
    if (!navigator.clipboard) throw new Error('The clipboard is not available here');
    await navigator.clipboard.writeText(status.snippet);
    ui.toast('Config copied — restart the AI client after pasting it');
  } catch (error) {
    ui.toast(error.message);
  }
}

async function loadAbout() {
  if (!els.settingsAbout) return;
  try {
    const about = await api.about();
    state.about = about;
    renderAbout();
  } catch {
    els.settingsAbout.textContent = 'Cortex';
  }
}

function renderAbout() {
  if (!els.settingsAbout || !state.about) return;
  const about = state.about;
  const build = about.build && about.build !== 'dev' ? ` (${about.build})` : '';
  let line = `Cortex ${about.version}${build} · port ${about.port} · ${about.config || 'config folder unknown'}`;
  if (about.offline) line += ' · offline mode';
  if (state.update) {
    if (state.update.disabled) line += ' · update checks disabled';
    else if (state.update.error) line += ' · update check unavailable';
    else if (state.update.available) line += ` · ${state.update.latest} available`;
    else if (state.update.latest) line += ' · up to date';
  }
  els.settingsAbout.textContent = line;
  if (els.settingsUpdate) {
    els.settingsUpdate.disabled = Boolean(about.offline);
  }
}

/* ---------- updates ---------- */

async function checkForUpdates({ manual = false } = {}) {
  if (!state.live) {
    if (manual) ui.toast('The static demo cannot check for updates');
    return;
  }
  if (state.about?.offline) {
    if (manual) ui.toast('Offline mode is enabled; update checks are disabled');
    return;
  }
  try {
    const info = await api.updateInfo();
    state.update = info;
    renderAbout();
    if (info.disabled) {
      if (manual) ui.toast(info.error || 'Offline mode is enabled; update checks are disabled');
    } else if (info.available) {
      showUpdateBanner(info);
      if (manual) ui.toast(`Cortex ${info.latest} is available`);
    } else if (manual) {
      ui.toast(info.error ? `Could not check for updates: ${info.error}` : 'Cortex is up to date');
    }
  } catch (error) {
    if (manual) ui.toast(error.message || 'Could not check for updates');
  }
}

function showUpdateBanner(info) {
  if (prefs.get('cortex.update.dismissed', '') === info.latest) return;
  els.updateText.textContent = `Cortex ${info.latest} is available`;
  els.updateAction.textContent = info.can_install ? 'Update' : 'Download';
  els.updateAction.hidden = false;
  els.updateClose.hidden = false;
  els.updateAction.disabled = false;
  els.update.hidden = false;
}

function dismissUpdate() {
  els.update.hidden = true;
  if (state.update?.latest) prefs.set('cortex.update.dismissed', state.update.latest);
}

async function installUpdate() {
  const info = state.update;
  if (!info?.available) return;
  if (!info.can_install) {
    const url = info.url || state.about?.releases;
    if (url) window.open(url, '_blank', 'noopener');
    return;
  }
  const confirmed = window.confirm(
    `Install Cortex ${info.latest} now?\n\nCortex will close and reopen when the installer finishes.`,
  );
  if (!confirmed) return;
  els.updateAction.disabled = true;
  els.updateText.textContent = `Downloading Cortex ${info.latest}…`;
  try {
    const result = await api.installUpdate();
    els.updateText.textContent = result.message || 'Installing…';
    els.updateAction.hidden = true;
    els.updateClose.hidden = true;
  } catch (error) {
    els.updateText.textContent = 'The update failed';
    els.updateAction.disabled = false;
    ui.toast(error.message || 'The update failed');
  }
}

function openSettings() {
  const vault = currentVault();
  if (!vault && !state.graph) {
    ui.toast('Open a folder first');
    return;
  }
  els.settingsName.textContent = vault?.name || state.meta?.title || 'Vault';
  els.settingsPath.textContent = vault?.path || (state.live ? '' : 'Static demo');
  els.settingsObsidian.hidden = !vault?.obsidian;
  els.settingsWrites.textContent = !state.live
    ? 'Static export mode: visual settings and tallies are saved locally in your browser.'
    : state.readOnly
      ? 'This folder is open read-only. Cortex can read it, but will not write to it.'
      : 'Notes are written as plain Markdown in the folder, so Obsidian sees them immediately.';
  els.settingsRoads.checked = prefs.get('cortex.atlas.roads', true);
  els.settingsRoutes.checked = prefs.get('cortex.atlas.routes', true);
  if (els.settingsAutoUpdate) {
    els.settingsAutoUpdate.checked = prefs.get('cortex.update.auto', true);
  }
  if (vault && state.live) {
    syncAgentHelp(vault);
    refreshMcpStatus();
    loadAbout();
    if (prefs.get('cortex.update.auto', true)) checkForUpdates();
    els.settingsReveal.disabled = Boolean(vault.missing);
  } else {
    els.settingsReveal.disabled = true;
  }
  syncSettingsViews();
  syncThemeUI();
  syncVisualSettingsUI();
  els.settings.hidden = false;
  els.settingsClose.focus();
}

function closeSettings() {
  els.settings.hidden = true;
  els.settingsButton.focus();
}

/* ---------- guided tour ---------- */

function hasTourTrail(card) {
  return Boolean(card && (card.confidence !== null && card.confidence !== undefined
    || card.review_on
    || card.supersedes));
}

/** The tour needs real examples for every step it promises to teach. */
function tourReadiness(graph) {
  const cards = graph?.structures?.cards || [];
  const research = cards.find(
    (card) => card.kind === 'research' && (card.evidence || []).length >= 2,
  );
  const idea = cards.find((card) => card.kind === 'idea' && (card.evidence || []).length >= 2);
  const trail = cards.find((card) => hasTourTrail(card) && card.supersedes)
    || cards.find(hasTourTrail);

  if (!graph?.nodes || graph.nodes.length < 2) {
    return {
      ok: false,
      reason: 'The tour collects at least two notes as evidence, so it needs a vault with two or more notes.',
    };
  }
  if (!research || !idea) {
    return {
      ok: false,
      reason: 'The tour needs one research brief and one idea note so Decisions and the trail are real examples, not a mock-up.',
    };
  }
  if (!trail) {
    return {
      ok: false,
      reason: 'The tour needs a decision with confidence, a review date, or a superseded note so it can show the decision trail.',
    };
  }
  return { ok: true, research, idea, trail };
}

function openTourCompose(template, example) {
  closeCompose();
  openCompose(template);
  if (els.compose.hidden) return;
  els.composeTitle.value = example;
  updateComposeState();
}

function collectTourEvidence(ids) {
  closePanel();
  if (state.sidebarCollapsed) toggleSidebar(false);
  state.selection.clear();
  for (const id of ids) {
    if (nodeIndex(id) >= 0) state.selection.add(id);
  }
  syncSelection();
}

async function openTourDecision(id) {
  const index = nodeIndex(id);
  if (index < 0) return;
  setMode('decisions', { persist: false, animate: false });
  await openNote(index, { record: false });
  const trail = document.getElementById('decision-trail');
  if (trail) trail.scrollIntoView({ block: 'center', behavior: 'auto' });
}

function buildTourSteps({ usedDemo, demoReason }) {
  const readiness = tourReadiness(state.graph);
  const research = readiness.research;
  const idea = readiness.idea;
  const trail = readiness.trail || readiness.research || readiness.idea;
  const sourceIds = [];
  for (const source of [...(research?.evidence || []), ...(idea?.evidence || [])]) {
    if (!sourceIds.includes(source.id)) sourceIds.push(source.id);
    if (sourceIds.length === 3) break;
  }
  const featuredId = sourceIds[0] || research?.id || state.graph.nodes[0]?.id;
  const vaultName = currentVault()?.name || state.meta?.title || 'this vault';
  const trailTitle = trail?.title || 'this decision';

  const intro = [
    'This is a working vault, not a slideshow: I will walk through the six views, then the loop that makes Cortex different — collect evidence, write a research brief or an idea refinement, and keep the decision trail.',
    usedDemo
      ? `You are in the generated Cortex Tour demo because your own vault does not yet have every piece this tour teaches. ${demoReason} Your notes have not been read or changed.`
      : `You are in your own vault, ${vaultName}. The tour only moves around; it does not write a note.`,
  ];

  return [
    {
      title: 'A guided tour of Cortex',
      body: intro,
      hint: 'Next moves forward. Esc exits and puts your view back.',
      nextLabel: 'Start the tour',
      enter: () => closeCompose(),
    },
    {
      title: 'Graph — the shape of your notes',
      body: [
        'Every star is a note and every line is a link. The graph is not decoration: it is how you spot the cluster you forgot, the bridge between two projects, and the note that connects nothing.',
      ],
      points: [
        'Drag to orbit, scroll to zoom, and click a star to read it.',
        'Click a folder title to fly into that section; `f` reframes the whole camera.',
        '`l` narrows the graph to the open note’s local neighbourhood.',
      ],
      target: '.views [data-mode="universe"]',
      placement: 'bottom',
      enter: () => {
        closeCompose();
        closePanel();
        setMode('universe', { persist: false, animate: false });
      },
    },
    {
      title: 'The note panel — read without losing the map',
      body: [
        'I opened a source note from the research brief. The panel keeps the graph behind it, so following one idea does not erase the context around it.',
      ],
      points: [
        'Backlinks are notes that link here; Linked sources appear on research briefs and idea notes.',
        'Related finds notes that share neighbours. Local graph (`l`) isolates that neighbourhood.',
        'Edit opens the raw Markdown; Collect puts this note in the evidence tray.',
      ],
      target: '#panel',
      placement: 'left',
      enter: async () => {
        closeCompose();
        setMode('universe', { persist: false, animate: false });
        const index = nodeIndex(featuredId);
        if (index >= 0) await openNote(index, { record: false });
      },
    },
    {
      title: 'Search — find a phrase, not just a title',
      body: [
        `Press \`${key('K')}\` anywhere, or \`/\`, and type part of a title, a tag, a folder or a sentence. Results always come from the vault you are looking at.`,
      ],
      hint: `The tour blocks app shortcuts until it ends. Afterwards, \`/\` and \`${key('K')}\` both open search.`,
      target: '#search-button',
      placement: 'bottom',
      enter: () => closeCompose(),
    },
    {
      title: 'Collect evidence — the tray is the handoff',
      body: [
        `A decision needs sources. Select notes with \`${mod}\`/\`Shift\`-click, or press \`c\` on the open note. The Collected tray appears on the left.`,
      ],
      points: [
        'I collected sources for you. Collection lives in memory until you create a structure note, and the tour restores your own collection when it closes.',
        'With two or more collected notes, Research brief and Refine idea become active.',
        'Clear empties the tray without touching the notes themselves.',
      ],
      target: '#selection',
      placement: 'right',
      enter: () => {
        closeCompose();
        collectTourEvidence(sourceIds);
      },
    },
    {
      title: 'Research brief — from sources to an answer',
      body: [
        'Research brief asks one question and writes a normal note at `Synthesis/<question>.md`. Cortex builds the scaffold from the collected notes; you write the thinking.',
      ],
      points: [
        'Question, what the sources say, tensions, synthesis and open questions.',
        'The evidence list is made of `[[wikilinks]]` back to every source, not copies.',
        'No prompt, API key or model is involved. This is a local Markdown write.',
      ],
      hint: 'The tour shows the form but does not create the note. In your own workflow, this is the Create note button.',
      target: '.compose-box',
      placement: 'left',
      enter: () => {
        closePanel();
        openTourCompose('research', 'How does attention shape deep work?');
      },
    },
    {
      title: 'Refine idea — make the decision explicit',
      body: [
        'Refine idea writes a `type: idea` note with the scaffolding a real decision needs. This is the part most note tools leave out: they help you collect and connect, then stop before a conclusion exists.',
      ],
      points: [
        'Situation, and the assumptions that are load-bearing versus cosmetic.',
        'Options A and B, each with effort, risk and reversibility.',
        'A recommendation, and the evidence that would change your mind.',
        'Both templates become Decisions cards from frontmatter; `status` stays yours to edit.',
      ],
      hint: 'Again, the tour is only showing the form. Nothing is written to this vault.',
      target: '.compose-box',
      placement: 'left',
      enter: () => openTourCompose('idea', 'Should this be one product or two?'),
    },
    {
      title: 'Decisions — what you concluded, and on what',
      body: [
        'Press `5`. Every note with `type: research` or `type: idea` becomes a card under its `status`. This is not a second database: the board is built from the same Markdown scan as the graph.',
      ],
      points: [
        '`open` and `refining` are the default columns; any other status becomes its own column.',
        'Cards show the folder, date, source count, evidence chips and any links that point nowhere.',
        'The board is read-only on purpose. Edit `status` or the trail fields in any editor.',
      ],
      target: '.decisions-head',
      placement: 'bottom',
      enter: () => {
        closeCompose();
        closePanel();
        setMode('decisions', { persist: false, animate: false });
        els.decisions.scrollTop = 0;
      },
    },
    {
      title: 'The decision trail — the “why” layer',
      body: [
        `I opened “${trailTitle}”. The trail keeps the judgment around the conclusion: how sure you were, when to revisit it, and what it replaced.`,
      ],
      points: [
        'Status, confidence, review date and supersession sit above the prose.',
        'A review date in the past is marked Review due, so a decision cannot quietly go stale.',
        'Linked sources below the note are one click from the evidence. Press `y` to jump back to the trail.',
        'The fields are optional. Add `confidence`, `review_on` and `supersedes` to any research brief or idea note.',
      ],
      target: '#decision-trail',
      placement: 'left',
      enter: () => trail ? openTourDecision(trail.id) : undefined,
    },
    {
      title: 'Brain — the same graph, inside a cortex',
      body: [
        'Press `2`. Notes sit on a folded cortical surface and links become fibre tracts. It is the same vault as Graph, arranged for a different kind of spatial memory.',
      ],
      points: [
        'This is the view the app is named after, and the front door in the README.',
        'Folder titles still fly you into a region.',
        'Drag and scroll behave like Graph; `f` resets the view.',
        'Nothing new is stored: this is one graph with another lens.',
      ],
      target: '.views [data-mode="brain"]',
      placement: 'bottom',
      enter: () => {
        closePanel();
        setMode('brain', { persist: false, animate: false });
      },
    },
    {
      title: 'Timeline — replay how the vault was written',
      body: [
        'Press `3`. Play or scrub the timeline and notes appear in creation order. It answers “what was I thinking then?” without opening a folder tree.',
      ],
      points: [
        'The date stamp above the scrubber follows the reveal.',
        'Play replays the vault; drag the scrubber to inspect a moment.',
        'Notes without dates are called out instead of inventing a history.',
      ],
      target: '.views [data-mode="replay"]',
      placement: 'bottom',
      enter: () => {
        closePanel();
        setMode('replay', { persist: false, animate: true });
      },
    },
    {
      title: 'Atlas — folders as countries',
      body: [
        'Press `4`. Folders become countries sized by note count, notes become places, and links become roads. Geography is deterministic, so a place stays where you learned it.',
      ],
      points: [
        'Drag to pan; scroll or `+`/`-` to zoom; `0` fits the whole map.',
        'Dense folders become stipple, not a wall of black badges.',
        'Click a place to read it; click a folder in the sidebar to hide or show its country.',
      ],
      target: '.views [data-mode="atlas"]',
      placement: 'bottom',
      enter: () => {
        closePanel();
        setMode('atlas', { persist: false, animate: false });
      },
    },
    {
      title: 'Bento — what is even in here?',
      body: [
        'Press `6`. Every folder becomes a box sized by how much of the vault it holds, with its strongest notes inside. It is the fastest overview of a vault you have not opened in a while.',
      ],
      points: [
        'Click a note to read it without leaving the board.',
        'Open in graph flies to that folder’s section.',
        'Big folders earn big tiles; the layout is deterministic and costs no WebGL frame.',
      ],
      target: '.bento-header',
      placement: 'bottom',
      enter: () => {
        closePanel();
        setMode('bento', { persist: false, animate: false });
      },
    },
    {
      title: 'The daily loop, and the keys that keep it fast',
      body: [
        'The sun button, or `t`, opens today’s note at `Journal/YYYY-MM-DD.md`; an existing note is opened, never overwritten.',
      ],
      points: [
        `\`n\` creates a note. Edit opens plain Markdown; \`${key('S')}\` saves and \`Esc\` cancels.`,
        '`1`–`6` switch views, `f` resets the camera, and `y` jumps to a decision trail.',
        'Vault settings holds the opening view, map roads and optional AI client access. Every native workflow here works without MCP.',
      ],
      target: '#today-note',
      placement: 'bottom',
      enter: () => {
        closeCompose();
        closePanel();
        setMode('universe', { persist: false, animate: false });
      },
    },
    {
      title: 'That is the loop',
      body: [
        'Collect → Research brief or Refine idea → Decisions → review the trail. One folder, six views, and a reason for every important conclusion.',
        'Your notes stay plain Markdown. No account, no database, no model, no lock-in.',
      ],
      hint: usedDemo
        ? 'Finish returns to your vault. Stay in demo keeps this generated vault open.'
        : 'Finish returns your view and collection to where they were before the tour.',
      nextLabel: 'Finish tour',
      secondary: usedDemo ? { label: 'Stay in demo' } : undefined,
      enter: () => {
        closeCompose();
        closePanel();
        setMode('decisions', { persist: false, animate: false });
      },
    },
  ];
}

async function startTour() {
  if (tour.active) return;
  if (!state.graph || !state.live) {
    ui.toast('Open a folder first');
    return;
  }
  if (state.editing) {
    ui.toast('Save or cancel your draft before starting the tour');
    return;
  }

  const previous = {
    vaultId: state.vaultId,
    mode: state.mode,
    selection: new Set(state.selection),
    detailId: state.detail?.id || null,
    panelOpen: !els.panel.hidden,
  };
  const readiness = tourReadiness(state.graph);
  let usedDemo = false;
  const demoReason = readiness.ok ? '' : readiness.reason;

  if (!readiness.ok) {
    if (state.readOnly) {
      ui.toast('The tour demo cannot be created while this folder is read-only');
      return;
    }
    els.tourButton.disabled = true;
    try {
      ui.toast('Opening the Cortex Tour demo…');
      const demo = await api.tutorialVault();
      if (!demo?.id) throw new Error('The tour demo did not open');
      await switchVault(demo.id, 'universe');
      usedDemo = true;
    } catch (error) {
      ui.toast(error.message || 'Could not open the tour demo');
      return;
    } finally {
      els.tourButton.disabled = false;
    }
    const activeReadiness = tourReadiness(state.graph);
    if (!activeReadiness.ok) {
      tourSession = null;
      try {
        await switchVault(previous.vaultId, previous.mode);
      } catch {
        /* the demo is still usable; do not hide the real error */
      }
      ui.toast('The tour demo is incomplete — remove it from the vault list and try again');
      return;
    }
  }

  closeCompose();
  closePalette();
  if (!els.settings.hidden) els.settings.hidden = true;
  const steps = buildTourSteps({ usedDemo, demoReason });
  tourSession = { previous, usedDemo };
  try {
    await tour.start(steps, {
      context: usedDemo
        ? 'Generated demo · your notes untouched'
        : `Your vault · ${currentVault()?.name || state.meta.title}`,
      reason: demoReason,
      onExit: finishTour,
    });
  } catch (error) {
    tourSession = null;
    ui.toast(error.message || 'Could not start the tour');
  }
}

async function finishTour({ stay = false, completed = false } = {}) {
  const session = tourSession;
  tourSession = null;
  closeCompose();
  closePalette();
  if (completed) {
    prefs.set(TOUR_COMPLETE_KEY, true);
    syncTourButton();
  }
  if (!session) return;

  if (stay) {
    ui.toast(session.usedDemo
      ? 'Demo vault open — switch back from the vault list when you are ready'
      : 'Tour closed');
    return;
  }

  if (session.usedDemo && session.previous.vaultId) {
    try {
      await switchVault(session.previous.vaultId, session.previous.mode);
    } catch (error) {
      ui.toast(error.message || 'Could not return to your vault');
      return;
    }
    state.selection = new Set(session.previous.selection);
    syncSelection();
    setMode(session.previous.mode, { persist: false, animate: false });
    if (session.previous.panelOpen && session.previous.detailId) {
      const index = nodeIndex(session.previous.detailId);
      if (index >= 0) await openNote(index, { record: false });
    } else {
      closePanel();
    }
    ui.toast('Back in your vault — nothing changed');
    return;
  }

  state.selection = new Set(session.previous.selection);
  syncSelection();
  setMode(session.previous.mode, { persist: false, animate: false });
  if (session.previous.panelOpen && session.previous.detailId) {
    const index = nodeIndex(session.previous.detailId);
    if (index >= 0) await openNote(index, { record: false });
  } else {
    closePanel();
  }
  ui.toast('Tour complete — replay it from the toolbar. Your notes are untouched.');
}

/* ---------- pointer ---------- */

function setHover(index) {
  if (state.hover === index) return;
  state.hover = index;
  state.renderer.setFocus(index);
  if (index == null) ui.hideTooltip();
  else ui.showTooltip(state.graph.nodes[index], state.pointerX, state.pointerY);
  els.canvas.style.cursor = index != null ? 'pointer' : '';
}

function localPoint(event) {
  const rect = els.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  state.dragging = true;
  state.dragMoved = false;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  state.camera.dragging = true;
  setHover(null);
  els.canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  if (state.dragging) {
    const dx = event.clientX - state.lastX;
    const dy = event.clientY - state.lastY;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) state.dragMoved = true;
    state.camera.orbit(dx, dy);
    return;
  }
  // Picking visits every node. It does not need to run at pointer frequency.
  const now = performance.now();
  if (now - state.lastPick < 45) return;
  state.lastPick = now;
  const point = localPoint(event);
  const index = state.renderer.pick(point.x, point.y);
  setHover(index >= 0 ? index : null);
  if (index >= 0) {
    ui.showTooltip(state.graph.nodes[index], state.pointerX, state.pointerY);
  }
}

function onPointerUp(event) {
  const point = localPoint(event);
  state.dragging = false;
  state.camera.dragging = false;
  if (!state.dragMoved) {
    const index = state.renderer.pick(point.x, point.y);
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    if (index >= 0 && additive) {
      toggleSelection(index);
    } else if (index >= 0) {
      openNote(index);
    } else if (!els.panel.hidden) {
      closePanel();
    } else if (state.local) {
      clearLocalGraph();
    } else if (state.folderFocus) {
      clearFolderFocus();
    }
  }
  state.dragMoved = false;
}

function onWheel(event) {
  event.preventDefault();
  state.camera.zoom(event.deltaY);
}

function onResize() {
  handleViewportBreakpointChange();
  resizeCamera();
  if (state.atlas) state.atlas.resize();
}

function onVisibility() {
  loop.last = performance.now();
}

/* ---------- keyboard ---------- */

function isTyping() {
  const active = document.activeElement;
  return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
}

function onKeyDown(event) {
  if (tour.active) {
    tour.handleKey(event);
    return;
  }
  const typing = isTyping();
  const mod = event.metaKey || event.ctrlKey;

  if (mod && event.key.toLowerCase() === 'k') {
    // The note editor owns Ctrl/⌘K while it is focused: it writes a wikilink.
    if (typing) return;
    event.preventDefault();
    if (state.palette.open) closePalette();
    else openPalette();
    return;
  }
  if (mod && event.key === '[') {
    event.preventDefault();
    goBack();
    return;
  }
  if (mod && event.key === ']') {
    event.preventDefault();
    goForward();
    return;
  }
  if (mod && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    showLaunch();
    return;
  }
  if (mod && event.key.toLowerCase() === 'e') {
    if (!typing || event.shiftKey) {
      event.preventDefault();
      if (state.mode === 'notes') {
        cycleStudioEditorMode();
      } else if (state.detail && state.live) {
        if (state.editing) cancelEdit();
        else requestEdit();
      }
      return;
    }
  }
  if (event.key === 'Escape') {
    if (els.shortcutsModal && !els.shortcutsModal.hidden) closeShortcutsModal();
    else if (els.quickNoteModal && !els.quickNoteModal.hidden) closeQuickNoteModal();
    else if (!els.settings.hidden) closeSettings();
    else if (!els.compose.hidden) closeCompose();
    else if (state.palette.open) closePalette();
    else if (hasOpenMobileDrawer()) closeMobileDrawers();
    else if (state.launching && (state.vaultId || state.graph)) hideLaunch();
    else if (state.mode === 'notes' && state.studio.zenMode) toggleStudioZen(false);
    else if (!els.panel.hidden && state.panelExpanded) setPanelExpanded(false);
    else if (!els.panel.hidden) closePanel();
    else if (state.local) clearLocalGraph();
    else if (state.folderFocus) clearFolderFocus();
    else setHover(null);
    return;
  }
  if (typing || state.launching || !state.graph) return;

  if (event.key === '?') {
    event.preventDefault();
    openShortcutsModal();
  } else if (event.key === '/') {
    event.preventDefault();
    openPalette();
  } else if (event.key === '[') {
    event.preventDefault();
    toggleSidebar();
  } else if (event.key === '0' || event.key.toLowerCase() === 'w') {
    event.preventDefault();
    setMode('notes');
  } else if (event.key === '1') setMode('universe');
  else if (event.key === '2') setMode('brain');
  else if (event.key === '3') setMode('replay');
  else if (event.key === '4') setMode('atlas');
  else if (event.key === '5') setMode('decisions');
  else if (event.key === '6') setMode('bento');
  else if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    setMode(state.mode === 'brain' ? 'universe' : 'brain');
  } else if (event.key.toLowerCase() === 'r') startReplay();
  else if (event.key.toLowerCase() === 'l' && state.selected != null) {
    if (state.local) clearLocalGraph();
    else showLocalGraph(state.selected);
  } else if (event.key.toLowerCase() === 'n') {
    event.preventDefault();
    openQuickNoteModal();
  } else if (event.key.toLowerCase() === 'q') {
    event.preventDefault();
    triggerQuickCapture();
  } else if (event.key.toLowerCase() === 't' && state.live) openDaily();
  else if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    openRandomNote();
  } else if (event.key.toLowerCase() === 'p') {
    event.preventDefault();
    togglePinCurrentNote();
  } else if (event.key.toLowerCase() === 'z' && state.mode === 'notes') {
    event.preventDefault();
    toggleStudioZen();
  } else if (event.key.toLowerCase() === 'y' && state.detail) focusDecisionTrail();
  else if (event.key.toLowerCase() === 'c' && state.selected != null) {
    toggleSelection(state.selected);
    if (state.detail && state.mode !== 'notes') renderPanel(state.detail);
  } else if (event.key.toLowerCase() === 'f') {
    clearFolderFocus({ resetCamera: false });
    state.camera.yaw = 0.55;
    state.camera.pitch = 0.22;
    state.camera.frame(state.mode);
    if (state.atlas && state.mode === 'atlas') state.atlas.fit();
  }
}

/* ---------- note panel + history ---------- */

function pushHistory(id) {
  const { items } = state.history;
  if (items[state.history.index] === id) return;
  items.length = state.history.index + 1;
  items.push(id);
  state.history.index = items.length - 1;
  if (items.length > 80) {
    items.shift();
    state.history.index -= 1;
  }
  syncHistory();
}

function syncHistory() {
  if (!els.panelBack) return;
  els.panelBack.disabled = state.history.index <= 0;
  els.panelForward.disabled = state.history.index >= state.history.items.length - 1;
}

function goBack() {
  if (state.history.index <= 0) return;
  state.history.index -= 1;
  openHistoryEntry();
}

function goForward() {
  if (state.history.index >= state.history.items.length - 1) return;
  state.history.index += 1;
  openHistoryEntry();
}

async function openHistoryEntry() {
  const id = state.history.items[state.history.index];
  const index = nodeIndex(id);
  if (index < 0) {
    syncHistory();
    return;
  }
  await openNote(index, { record: false });
}

// A page opened, then quickly replaced, must not be overwritten by the slower
// response of the page that lost the race.
let openToken = 0;

async function openNote(index, { record = true, reveal = true } = {}) {
  const node = state.graph.nodes[index];
  if (!node) return;
  if (state.mode === 'notes' && state.studio.dirty && state.detail && state.detail.id !== node.id) {
    await saveStudioDraft({ quiet: true });
  }
  const token = ++openToken;
  const wasLocal = Boolean(state.local);
  state.selected = index;
  if (wasLocal) showLocalGraph(index);
  if (state.renderer) state.renderer.setFocus(index);
  if (state.atlas) state.atlas.setFocus(index);
  if (record) pushHistory(node.id);
  recordRecentNote(node.id);
  ensureTabInStudio(node.id, true);
  const detail = await getDetail(node);
  if (!detail || token !== openToken) return;
  state.detail = detail;
  state.draft = detail.raw ?? detail.markdown ?? '';
  state.editing = false;
  state.studio.dirty = false;
  renderSidebarPinned();
  document.querySelectorAll('.folder-note').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.noteId === detail.id);
  });
  if (state.mode === 'notes') {
    els.panel.hidden = true;
    if (reveal && isMobileViewport()) {
      state.studio.mobileReading = true;
    }
    renderNotesStudio();
  } else {
    renderPanel(detail);
  }
}

async function getDetail(node) {
  if (state.live) {
    if (state.cache.has(node.id)) return state.cache.get(node.id);
    try {
      const detail = await api.fetchNote(node.id, state.vaultId);
      state.cache.set(node.id, detail);
      return detail;
    } catch (error) {
      ui.toast(error.message || 'Could not open that note');
      return null;
    }
  }
  return localDetail(node);
}

function extractLocalMentionSnippet(body, needle, fallback = '') {
  const raw = String(body || '');
  const lowerNeedle = String(needle || '').toLowerCase();
  if (raw && lowerNeedle) {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---' || trimmed.startsWith('```')) continue;
      if (trimmed.toLowerCase().includes(lowerNeedle)) {
        const clean = trimmed.replace(/^#+\s*/, '').replace(/^>\s*/, '');
        return clean.length > 160 ? `${clean.slice(0, 160)}…` : clean;
      }
    }
  }
  const fb = String(fallback || '').trim();
  return fb || undefined;
}

function localDetail(node) {
  const card = state.graph.structures?.cards?.find((item) => item.id === node.id);
  const incomingList = state.incoming.get(node.id) || [];
  const linkedSourceSet = new Set([node.id]);
  const backlinks = incomingList
    .map(({ source, weight }) => {
      const srcNode = state.graph.nodes[source];
      linkedSourceSet.add(srcNode.id);
      return {
        id: srcNode.id,
        title: srcNode.title,
        folder: srcNode.folder,
        weight,
        snippet: extractLocalMentionSnippet(srcNode.body, node.title, srcNode.excerpt),
      };
    })
    .slice(0, 24);

  const mentions = [];
  const lowerTitle = (node.title || '').toLowerCase();
  if (lowerTitle.length >= 3) {
    for (const other of state.graph.nodes) {
      if (linkedSourceSet.has(other.id)) continue;
      if ((other.links || []).includes(node.id)) continue;
      const body = other.body || other.excerpt || '';
      if (body.toLowerCase().includes(lowerTitle)) {
        mentions.push({
          id: other.id,
          title: other.title,
          folder: other.folder,
          weight: 1,
          snippet: extractLocalMentionSnippet(body, node.title, other.excerpt),
        });
        if (mentions.length >= 16) break;
      }
    }
  }

  const related = relatedFromGraph(node.id);
  return {
    id: node.id,
    title: node.title,
    folder: node.folder,
    path: `${node.id}.md`,
    created: node.created,
    words: node.words,
    tags: node.tags,
    links: node.links || [],
    markdown: node.body || node.excerpt,
    body: node.body || node.excerpt,
    raw: node.body || node.excerpt,
    backlinks,
    mentions,
    related,
    kind: card?.kind,
    status: card?.status,
    confidence: card?.confidence,
    review_on: card?.review_on,
    supersedes: card?.supersedes,
    evidence: card?.evidence,
  };
}

function relatedFromGraph(id) {
  const index = state.graph.nodes.findIndex((node) => node.id === id);
  if (index < 0) return [];
  const neighbours = new Map();
  for (const edge of state.graph.edges) {
    if (!neighbours.has(edge.source)) neighbours.set(edge.source, new Set());
    if (!neighbours.has(edge.target)) neighbours.set(edge.target, new Set());
    neighbours.get(edge.source).add(edge.target);
    neighbours.get(edge.target).add(edge.source);
  }
  const base = neighbours.get(index) || new Set();
  const scored = [];
  for (const [candidate, other] of neighbours) {
    if (candidate === index) continue;
    let intersection = 0;
    for (const item of base) if (other.has(item)) intersection += 1;
    const union = base.size + other.size - intersection;
    if (union > 0) scored.push({ candidate, score: intersection / union });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ candidate }) => {
      const node = state.graph.nodes[candidate];
      return {
        id: node.id,
        title: node.title,
        folder: node.folder,
        weight: 0,
        snippet: node.excerpt || undefined,
      };
    });
}

function isVaultWritable() {
  return (state.live && !state.readOnly) || !state.live;
}

function renderPanel(detail, { preserveScroll = null } = {}) {
  // The body usually repeats its title as an H1; the panel already shows it.
  let markdown = detail.markdown || '';
  const heading = /^\s*#\s+(.+)\r?\n/.exec(markdown);
  if (heading && heading[1].trim().toLowerCase() === detail.title.trim().toLowerCase()) {
    markdown = markdown.slice(heading[0].length);
  }
  const html = renderMarkdown(markdown, (target) => Boolean(resolveTarget(target)));
  els.panelBody.innerHTML = ui.panelHtml(detail, html, isVaultWritable());
  els.panelBody.scrollTop = preserveScroll !== null ? preserveScroll : 0;
  els.panel.hidden = false;
  ui.setCrumbs(`${state.meta.title} / ${detail.folder}`);
  syncHistory();

  els.panelActions.innerHTML = '';
  if (state.live) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-primary';
    edit.textContent = 'Edit';
    edit.addEventListener('click', requestEdit);
    els.panelActions.appendChild(edit);
  }
  const studioBtn = document.createElement('button');
  studioBtn.type = 'button';
  studioBtn.className = 'btn';
  studioBtn.textContent = 'Notes Studio';
  studioBtn.title = 'Open this note in the full 3-pane Notes Studio (0)';
  studioBtn.addEventListener('click', () => {
    if (isMobileViewport()) state.studio.mobileReading = true;
    setMode('notes');
    openNoteInStudio(detail.id, { reveal: true });
  });
  els.panelActions.appendChild(studioBtn);

  const collect = document.createElement('button');
  collect.type = 'button';
  collect.className = 'btn';
  const collected = state.selection.has(detail.id);
  collect.textContent = collected ? 'Collected' : 'Collect';
  collect.title = 'Collect this note as evidence for a brief or an idea note';
  collect.addEventListener('click', () => {
    const index = nodeIndex(detail.id);
    if (index < 0) return;
    toggleSelection(index);
    if (state.detail) renderPanel(state.detail);
  });
  els.panelActions.appendChild(collect);

  const local = document.createElement('button');
  local.type = 'button';
  local.className = 'btn';
  local.textContent = state.local ? 'Full graph' : 'Local graph';
  local.title = state.local
    ? 'Return to the whole vault'
    : 'Show only this note and its nearby connections';
  local.addEventListener('click', () => {
    if (state.local) clearLocalGraph();
    else showLocalGraph(nodeIndex(detail.id));
    local.textContent = state.local ? 'Full graph' : 'Local graph';
    local.title = state.local ? 'Return to the whole vault' : 'Show only this note and its nearby connections';
  });
  els.panelActions.appendChild(local);

  const status = document.createElement('span');
  status.className = 'panel-status';
  status.id = 'panel-status';
  status.textContent = state.live ? '' : 'static demo';
  els.panelActions.appendChild(status);

  wireProseInteractions(els.panelBody, detail.id);

  document.querySelectorAll('.folder-note').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.noteId === detail.id);
  });
  els.panelBody.querySelectorAll('[data-note-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = nodeIndex(button.dataset.noteId);
      if (index >= 0) openNote(index);
    });
  });
  els.panelBody.querySelectorAll('[data-link-mention-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      linkUnlinkedMention(button.dataset.linkMentionId, detail.title);
    });
  });

  els.panelBody.querySelectorAll('.confidence-fill[data-confidence]').forEach((bar) => {
    bar.style.setProperty('--confidence', `${bar.dataset.confidence}%`);
  });

  wireConnectionTabs(els.panelBody.querySelector('#note-connections'));
  renderSidebarTallies();
}

async function openWikilinkTarget(rawTarget, linkEl = null) {
  const targetStr = String(rawTarget || '');
  if (linkEl?.dataset?.file === 'true') {
    const [fileName, anchor] = targetStr.split('#');
    const page = anchor && /^page=(\d+)/i.exec(anchor);
    const label = page ? `${fileName} (page ${page[1]})` : targetStr;
    if (state.live && state.detail) {
      try {
        await api.revealInFolder(state.detail.id, state.vaultId);
        ui.toast(`Attachment: ${label} — revealed folder in Explorer`);
      } catch {
        ui.toast(`Attachment reference: ${label}`);
      }
    } else {
      ui.toast(`Attachment reference: ${label}`);
    }
    return;
  }

  const hashIdx = targetStr.indexOf('#');
  const anchorText = hashIdx >= 0 ? targetStr.slice(hashIdx + 1).trim() : '';
  const id = resolveTarget(targetStr);
  if (!id) {
    const cleanTitle = (hashIdx >= 0 ? targetStr.slice(0, hashIdx) : targetStr).trim() || targetStr;
    if (isVaultWritable()) {
      const currentFolder = state.detail?.folder && state.detail.folder !== '(root)'
        ? state.detail.folder
        : null;
      openQuickNoteModal({ title: cleanTitle, folder: currentFolder });
    } else {
      ui.toast(`No note called “${cleanTitle}” yet`);
    }
    return;
  }

  if (state.mode === 'notes') {
    await openNoteInStudio(id, { reveal: true });
    if (anchorText) {
      jumpToStudioHeading(0, { text: anchorText });
    }
    return;
  }

  const index = nodeIndex(id);
  if (index >= 0) await openNote(index);
}

function wireProseInteractions(container, noteId) {
  if (!container) return;
  container.querySelectorAll('.wikilink').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openWikilinkTarget(link.dataset.target || '', link);
    });
  });

  container.querySelectorAll('.tally-pip[data-pip-index]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleNoteBallotPip(noteId, Number(btn.dataset.pipIndex));
    });
  });

  container.querySelectorAll('.task-box[data-task-index]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleNoteTaskPip(noteId, Number(btn.dataset.taskIndex));
    });
  });
}

function wireConnectionTabs(root) {
  if (!root) return;
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = [...root.querySelectorAll('[role="tabpanel"]')];
  if (!tabs.length) return;

  const activate = (id, { focus = false } = {}) => {
    for (const tab of tabs) {
      const selected = tab.dataset.connTab === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) {
        tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (focus) tab.focus();
      }
    }
    for (const panel of panels) {
      const selected = panel.dataset.connPanel === id;
      if (selected) {
        panel.removeAttribute('hidden');
        if (!panel.querySelector('button, a, [tabindex]')) panel.tabIndex = 0;
      } else {
        panel.hidden = 'until-found';
        panel.removeAttribute('tabindex');
      }
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.connTab));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next !== null) {
        event.preventDefault();
        activate(tabs[next].dataset.connTab, { focus: true });
      }
    });
  });

  panels.forEach((panel) => {
    panel.addEventListener('beforematch', () => activate(panel.dataset.connPanel));
  });
}

function focusDecisionTrail() {
  const trail = document.getElementById('decision-trail');
  if (!trail) {
    ui.toast('Open a research brief or idea note to see its decision trail');
    return;
  }
  trail.scrollIntoView({ behavior: 'smooth', block: 'center' });
  trail.classList.remove('is-flash');
  void trail.offsetWidth;
  trail.classList.add('is-flash');
}

function closePanel() {
  if (els.panel.hidden) return;
  if (state.local) clearLocalGraph({ resetCamera: true, rerender: false });
  openToken += 1;
  setPanelExpanded(false);
  els.panel.hidden = true;
  state.detail = null;
  state.editing = false;
  state.selected = null;
  if (state.renderer) state.renderer.setFocus(state.hover);
  if (state.atlas) state.atlas.setFocus(null);
}

function cancelEdit() {
  if (!state.detail) return;
  state.editing = false;
  state.draft = null;
  renderPanel(state.detail);
}

function requestEdit() {
  if (!state.detail || !state.live) return;
  state.editing = true;
  state.draft = state.detail.raw ?? state.detail.markdown;
  els.panelBody.innerHTML = ui.editorHtml(state.detail, state.draft);
  els.panelActions.innerHTML = '';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.textContent = 'Save';
  save.addEventListener('click', saveEdits);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', cancelEdit);
  els.panelActions.append(save, cancel);
  const textarea = document.getElementById('note-editor');
  if (textarea) {
    textarea.focus();
    attachEditor(textarea, {
      onChange: () => {
        state.draft = textarea.value;
      },
      onSave: saveEdits,
      onCancel: cancelEdit,
      getNotes: () => state.graph?.nodes || [],
      getTags: getAllVaultTags,
    });
    const toolbarEl = els.panelBody.querySelector('.editor-bar');
    if (toolbarEl) initRovingToolbar(toolbarEl);
    els.panelBody.querySelectorAll('[data-edit-cmd]').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        // Keep focus & text selection inside the textarea when clicking a toolbar button.
        event.preventDefault();
      });
      button.addEventListener('click', () => {
        const cmd = button.dataset.editCmd;
        if (cmd === 'slash') openSlashMenu(textarea);
        else runEditorCommand(textarea, cmd);
      });
    });
  }
}

async function saveEdits() {
  if (!state.detail) return;
  const status = document.getElementById('panel-status');
  if (status) status.textContent = 'Saving…';

  try {
    const textarea = document.getElementById('note-editor');
    const content = textarea ? textarea.value : state.draft;
    const result = await api.saveNote({ id: state.detail.id, content }, state.vaultId);
    state.cache.delete(state.detail.id);
    state.version = result.version;
    await refreshGraph();
    const index = nodeIndex(result.id);
    if (index >= 0) await openNote(index);
    ui.toast('Saved');
  } catch (error) {
    if (status) status.textContent = 'Save failed';
    ui.toast(error.message || 'Could not save');
  }
}

async function createNote() {
  openQuickNoteModal();
}

async function openDaily() {
  if (!state.live) {
    ui.toast('The static demo cannot write notes');
    return;
  }
  try {
    const result = await api.openDaily(state.vaultId);
    state.version = result.version;
    await refreshGraph();
    const index = nodeIndex(result.id);
    if (index < 0) {
      ui.toast('Today’s note was written, but the vault has not picked it up yet');
      return;
    }
    await openNote(index);
    ui.toast(result.created ? 'Today’s note ready' : 'Today’s note');
    if (result.created) {
      if (state.mode === 'notes') setStudioEditorMode('live');
      else requestEdit();
    }
  } catch (error) {
    ui.toast(error.message || 'Could not open today’s note');
  }
}

/* ---------- notes studio, pinned notes, templates & qol ---------- */

function pinnedNotesKey() {
  return `cortex.pinned.${vaultStorageKey()}`;
}

function recentNotesKey() {
  return `cortex.recent.${vaultStorageKey()}`;
}

function studioTabsKey() {
  return `cortex.studio.tabs.${vaultStorageKey()}`;
}

function getPinnedIds() {
  return prefs.get(pinnedNotesKey(), []);
}

function getRecentIds() {
  return prefs.get(recentNotesKey(), []);
}

function recordRecentNote(noteId) {
  if (!noteId) return;
  const list = getRecentIds().filter((id) => id !== noteId);
  list.unshift(noteId);
  prefs.set(recentNotesKey(), list.slice(0, 24));
}

function togglePinNote(noteId) {
  if (!noteId) return;
  const list = getPinnedIds();
  const idx = list.indexOf(noteId);
  const pinned = idx < 0;
  if (pinned) list.unshift(noteId);
  else list.splice(idx, 1);
  prefs.set(pinnedNotesKey(), list);
  renderSidebarPinned();
  if (state.mode === 'notes') {
    renderNotesStudioFeed();
    renderNotesStudioHeaderControls();
    renderNotesStudioTabsBar();
  }
  const node = state.graph?.nodes.find((n) => n.id === noteId);
  ui.toast(pinned ? `Pinned “${node?.title || noteId}”` : `Unpinned “${node?.title || noteId}”`);
}

function togglePinCurrentNote() {
  const id = state.detail?.id || state.studio.activeId;
  if (!id) {
    ui.toast('Open a note first to pin it');
    return;
  }
  togglePinNote(id);
}

function renderSidebarPinned() {
  if (!state.graph || !els.pinnedList || !els.pinnedBlock) return;
  const nodesById = new Map(state.graph.nodes.map((n) => [n.id, n]));
  const selectedId = state.detail?.id || (state.selected != null ? state.graph.nodes[state.selected]?.id : null);
  ui.renderPinnedSidebar(
    els.pinnedList,
    els.pinnedBlock,
    getPinnedIds(),
    nodesById,
    selectedId,
    {
      showEmptyHint: state.mode === 'notes',
      onOpen: (id) => {
        if (isMobileViewport()) closeMobileDrawers();
        const idx = nodeIndex(id);
        if (idx >= 0) openNote(idx);
      },
      onUnpin: (id) => togglePinNote(id),
    },
  );
}

function getAllVaultTags() {
  const nodes = state.graph?.nodes || [];
  const seen = new Map();
  for (const node of nodes) {
    for (const raw of node.tags || []) {
      const cleaned = String(raw ?? '').trim().replace(/^#+/, '').trim();
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (!seen.has(key)) seen.set(key, cleaned);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function effectiveStudioViewMode(mode = state.studio.viewMode) {
  if (!isVaultWritable()) return 'read';
  const normalized = mode === 'live' || mode === 'edit' || mode === 'split' || mode === 'read'
    ? mode
    : 'live';
  if (normalized === 'split' && isMobileViewport()) return 'live';
  return normalized;
}

function syncStudioMobileReading() {
  if (!els.notesStudio) return;
  const active = Boolean(state.studio.mobileReading && isMobileViewport());
  els.notesStudio.classList.toggle('is-mobile-reading', active);
}

function setStudioMobileReading(reading) {
  state.studio.mobileReading = Boolean(reading);
  syncStudioMobileReading();
}

function cleanupStudioCanvas() {
  if (state.studio.liveController) {
    try {
      state.studio.liveController.destroy();
    } catch {
      /* ignore teardown error */
    }
    state.studio.liveController = null;
  }
  state.studio.activeTextarea = null;
  if (state.studio.editorHandle) {
    try {
      state.studio.editorHandle.destroy();
    } catch {
      /* ignore teardown error */
    }
    state.studio.editorHandle = null;
  }
  if (state.studio.toolbarCleanup) {
    try {
      state.studio.toolbarCleanup();
    } catch {
      /* ignore teardown error */
    }
    state.studio.toolbarCleanup = null;
  }
  if (state.studio.bubbleCleanup) {
    try {
      state.studio.bubbleCleanup();
    } catch {
      /* ignore teardown error */
    }
    state.studio.bubbleCleanup = null;
  }
}

function filterStudioByTag(tag) {
  const cleanTag = String(tag || '').trim().replace(/^#+/, '');
  state.studio.filterQuery = cleanTag;
  if (els.notesFilter) els.notesFilter.value = state.studio.filterQuery;
  renderNotesStudioFeed();
  if (isMobileViewport()) {
    setStudioMobileReading(false);
    if (cleanTag) ui.toast(`Filtered by #${cleanTag}`);
  }
}

function initStudioForVault() {
  if (!state.graph) return;
  const nodesById = new Map(state.graph.nodes.map((n) => [n.id, n]));
  const savedTabs = prefs.get(studioTabsKey(), []).filter((id) => nodesById.has(id));
  state.studio.tabs = savedTabs;
  const savedMode = prefs.get('cortex.studio.viewMode', null);
  state.studio.viewMode = savedMode === 'live' || savedMode === 'edit' || savedMode === 'split' || savedMode === 'read'
    ? savedMode
    : 'live';
  if (!state.studio.activeId || !nodesById.has(state.studio.activeId)) {
    state.studio.activeId = savedTabs[0] || null;
  }
  if (state.mode === 'notes' && !state.studio.dirty && !state.studio.activeTextarea) {
    ensureStudioActiveNote();
    renderNotesStudio();
  }
}

function ensureTabInStudio(noteId, makeActive = true) {
  if (!noteId) return;
  if (!state.studio.tabs.includes(noteId)) {
    state.studio.tabs.push(noteId);
    if (state.studio.tabs.length > 12) state.studio.tabs.shift();
  }
  if (makeActive) state.studio.activeId = noteId;
  prefs.set(studioTabsKey(), state.studio.tabs);
}

function closeStudioTab(noteId) {
  const idx = state.studio.tabs.indexOf(noteId);
  if (idx < 0) return;
  state.studio.tabs.splice(idx, 1);
  prefs.set(studioTabsKey(), state.studio.tabs);
  if (state.studio.activeId === noteId) {
    const nextId = state.studio.tabs[idx] || state.studio.tabs[idx - 1] || null;
    state.studio.activeId = nextId;
    if (nextId) {
      openNoteInStudio(nextId);
      return;
    }
    state.detail = null;
    state.selected = null;
    setStudioMobileReading(false);
  }
  renderNotesStudio();
}

function ensureStudioActiveNote() {
  if (!state.graph || !state.graph.nodes.length) return;
  if (state.detail && nodeIndex(state.detail.id) >= 0) {
    ensureTabInStudio(state.detail.id, true);
    return;
  }
  const candidateId = state.studio.activeId
    || getPinnedIds()[0]
    || getRecentIds()[0]
    || [...state.graph.nodes].sort((a, b) => (b.pagerank || 0) - (a.pagerank || 0))[0]?.id;
  if (candidateId) {
    openNoteInStudio(candidateId, { reveal: false });
  }
}

async function openNoteInStudio(noteId, { reveal = true } = {}) {
  const idx = nodeIndex(noteId);
  if (idx < 0) return;
  if (reveal && isMobileViewport()) {
    setStudioMobileReading(true);
  }
  await openNote(idx, { reveal });
}

function filteredStudioNotes() {
  if (!state.graph) return [];
  const pinnedSet = new Set(getPinnedIds());
  const recentIds = getRecentIds();
  const recentSet = new Set(recentIds);
  const recentRank = new Map(recentIds.map((id, i) => [id, i]));
  const q = (state.studio.filterQuery || '').trim().toLowerCase();

  let list = state.graph.nodes.filter((node) => {
    if (state.studio.scope === 'pinned' && !pinnedSet.has(node.id)) return false;
    if (state.studio.scope === 'recent' && !recentSet.has(node.id)) return false;
    if (state.studio.scope === 'folder' && state.studio.folderFilter && node.folder !== state.studio.folderFilter) {
      return false;
    }
    if (!q) return true;
    return (
      node.title.toLowerCase().includes(q)
      || (node.folder || '').toLowerCase().includes(q)
      || (node.tags || []).some((t) => t.toLowerCase().includes(q))
      || (node.excerpt || '').toLowerCase().includes(q)
      || (node.body || '').toLowerCase().includes(q)
    );
  });

  const sortBy = state.studio.sortBy;
  list = [...list].sort((a, b) => {
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title);
    }
    if (sortBy === 'links') {
      return (b.degree || 0) - (a.degree || 0) || a.title.localeCompare(b.title);
    }
    if (sortBy === 'words') {
      return (b.words || 0) - (a.words || 0) || a.title.localeCompare(b.title);
    }
    // Default 'recent': pinned first, then recently opened, then created date desc, then pagerank
    const pinDiff = (pinnedSet.has(b.id) ? 1 : 0) - (pinnedSet.has(a.id) ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    const rA = recentRank.has(a.id) ? recentRank.get(a.id) : 9999;
    const rB = recentRank.has(b.id) ? recentRank.get(b.id) : 9999;
    if (rA !== rB) return rA - rB;
    const dateDiff = String(b.created || '').localeCompare(String(a.created || ''));
    if (dateDiff !== 0) return dateDiff;
    return (b.pagerank || 0) - (a.pagerank || 0);
  });

  return list.map((node) => ({
    ...node,
    snippet: node.excerpt || (node.body || '').slice(0, 140),
  }));
}

function folderColorMap() {
  const map = new Map();
  for (const f of state.graph?.meta?.folders || []) {
    map.set(f.name, f.color ?? 0);
  }
  return map;
}

function renderNotesStudioFeed() {
  if (!els.notesFeed || !state.graph) return;
  const notes = filteredStudioNotes();
  const scopeTitles = {
    all: 'All notes',
    pinned: 'Pinned notes',
    recent: 'Recent notes',
    folder: state.studio.folderFilter || 'Folder',
  };
  if (els.notesListTitle) {
    els.notesListTitle.textContent = scopeTitles[state.studio.scope] || 'All notes';
  }
  if (els.notesListCount) {
    els.notesListCount.textContent = String(notes.length);
  }
  if (els.notesSort) {
    const sortLabels = { recent: 'Recent', title: 'A–Z', links: 'Links', words: 'Length' };
    els.notesSort.textContent = `↕ ${sortLabels[state.studio.sortBy] || 'Recent'}`;
  }
  if (els.notesScopes) {
    els.notesScopes.querySelectorAll('.notes-scope').forEach((btn) => {
      const active = btn.dataset.scope === state.studio.scope;
      btn.classList.toggle('is-active', active);
    });
  }
  if (els.notesScopeFolder) {
    if (state.studio.folderFilter) {
      els.notesScopeFolder.hidden = false;
      els.notesScopeFolder.textContent = state.studio.folderFilter;
    } else {
      els.notesScopeFolder.hidden = true;
    }
  }

  const treeMode = state.studio.listView === 'folders';
  if (els.notesViewToggle) {
    els.notesViewToggle.querySelectorAll('[data-list-view]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.listView === state.studio.listView);
    });
  }
  if (els.notesSort) els.notesSort.hidden = treeMode;
  els.notesFeed.classList.toggle('is-tree', treeMode);

  if (treeMode) {
    const activeId = state.detail?.id || state.studio.activeId;
    // Open the path to the current note once, so it is never hidden in a closed folder.
    if (activeId && state.studio.revealedFor !== activeId) {
      state.studio.revealedFor = activeId;
      const parts = String(activeId).split('/');
      parts.pop();
      let path = '';
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        state.studio.openFolders.add(path);
      }
    }
    const ordered = state.studio.sortBy === 'recent'
      ? [...notes].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
      : notes;
    ui.renderNotesStudioTree(els.notesFeed, ordered, {
      activeId,
      pinnedSet: new Set(getPinnedIds()),
      openFolders: state.studio.openFolders,
      forceOpen: Boolean((state.studio.filterQuery || '').trim()) || ['pinned', 'recent'].includes(state.studio.scope),
      onToggleFolder: (path, open) => {
        if (open) state.studio.openFolders.add(path);
        else state.studio.openFolders.delete(path);
        prefs.set('cortex.notes.openFolders', [...state.studio.openFolders]);
        renderNotesStudioFeed();
      },
      onSelectNote: (id) => openNoteInStudio(id),
      onTogglePin: (id) => togglePinNote(id),
    });
    return;
  }

  ui.renderNotesStudioList(els.notesFeed, notes, {
    activeId: state.detail?.id || state.studio.activeId,
    pinnedSet: new Set(getPinnedIds()),
    recentIds: getRecentIds(),
    palette: PALETTE,
    folderColorMap: folderColorMap(),
    sortBy: state.studio.sortBy,
    onSelectNote: (id) => openNoteInStudio(id),
    onTogglePin: (id) => togglePinNote(id),
  });
}

function renderNotesStudioTabsBar() {
  if (!els.notesTabs || !state.graph) return;
  const nodesById = new Map(state.graph.nodes.map((n) => [n.id, n]));
  ui.renderNotesStudioTabs(
    els.notesTabs,
    state.studio.tabs,
    state.detail?.id || state.studio.activeId,
    nodesById,
    {
      dirtyId: state.studio.dirty ? state.detail?.id : null,
      pinnedSet: new Set(getPinnedIds()),
      onSelectTab: (id) => openNoteInStudio(id),
      onCloseTab: (id) => closeStudioTab(id),
    },
  );
  els.notesTabs.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderNotesStudioHeaderControls() {
  const detail = state.detail;
  const pinned = detail ? getPinnedIds().includes(detail.id) : false;
  if (els.notesPinBtn) {
    els.notesPinBtn.classList.toggle('is-active', pinned);
    els.notesPinBtn.setAttribute('aria-pressed', String(pinned));
    els.notesPinBtn.title = pinned ? 'Unpin note (p)' : 'Pin note to sidebar (p)';
  }
  if (els.notesViewModes) {
    const writable = isVaultWritable();
    const activeMode = effectiveStudioViewMode();
    els.notesViewModes.querySelectorAll('[data-editor-mode]').forEach((btn) => {
      const mode = btn.dataset.editorMode;
      const active = activeMode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = !writable && mode !== 'read';
    });
  }
  if (els.notesSaveStatus) {
    if (!isVaultWritable()) {
      els.notesSaveStatus.textContent = 'Read-only';
      els.notesSaveStatus.dataset.state = 'readonly';
    } else if (state.studio.saving) {
      els.notesSaveStatus.textContent = 'Saving…';
      els.notesSaveStatus.dataset.state = 'saving';
    } else if (state.studio.dirty) {
      els.notesSaveStatus.textContent = 'Editing…';
      els.notesSaveStatus.dataset.state = 'dirty';
    } else {
      els.notesSaveStatus.textContent = 'Saved';
      els.notesSaveStatus.dataset.state = 'saved';
    }
  }
}

function prepareStudioProseHtml(rawMarkdown, title) {
  let markdown = String(rawMarkdown || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n?/, '');
  const heading = /^\s*#\s+(.+)\r?\n/.exec(markdown);
  if (heading && title && heading[1].trim().toLowerCase() === title.trim().toLowerCase()) {
    markdown = markdown.slice(heading[0].length);
  }
  return renderMarkdown(markdown, (target) => Boolean(resolveTarget(target)));
}

function renderNotesStudioDocument({ preserveScroll = null } = {}) {
  if (!els.notesCanvas) return;
  cleanupStudioCanvas();

  const detail = state.detail;
  const draft = state.draft ?? detail?.raw ?? detail?.markdown ?? '';
  const effectiveMode = effectiveStudioViewMode();
  const html = detail && effectiveMode !== 'live' ? prepareStudioProseHtml(draft, detail.title) : '';
  const fMap = folderColorMap();
  const cIdx = detail ? (fMap.get(detail.folder) ?? 0) : 0;
  const folderRgb = PALETTE[cIdx % PALETTE.length];

  ui.renderNotesStudioCanvas(els.notesCanvas, detail, {
    viewMode: effectiveMode,
    draft,
    markdownHtml: html,
    writable: isVaultWritable(),
    folderRgb,
  });

  if (preserveScroll !== null) {
    els.notesCanvas.scrollTop = preserveScroll;
  }

  if (!detail) {
    if (els.notesMiniOutline) els.notesMiniOutline.hidden = true;
    renderNotesStudioInspectorPane([]);
    return;
  }

  els.notesCanvas.querySelectorAll('[data-filter-folder]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setStudioFolderFilter(btn.dataset.filterFolder);
      if (isMobileViewport()) setStudioMobileReading(false);
    });
  });
  els.notesCanvas.querySelectorAll('[data-filter-tag]').forEach((btn) => {
    btn.addEventListener('click', () => filterStudioByTag(btn.dataset.filterTag));
  });
  els.notesCanvas.querySelectorAll('[data-switch-editor-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setStudioEditorMode(btn.dataset.switchEditorMode));
  });
  els.notesCanvas.querySelectorAll('[data-note-id]').forEach((btn) => {
    btn.addEventListener('click', () => openNoteInStudio(btn.dataset.noteId));
  });
  els.notesCanvas.querySelectorAll('.confidence-fill[data-confidence]').forEach((bar) => {
    bar.style.setProperty('--confidence', `${bar.dataset.confidence}%`);
  });

  if (effectiveMode === 'live') {
    const liveHost = els.notesCanvas.querySelector('#studio-live-host');
    if (liveHost) {
      state.studio.liveController = mountLiveEditor(liveHost, {
        raw: draft,
        title: detail.title,
        detail,
        renderBlockHtml: (md) => renderMarkdown(md, (target) => Boolean(resolveTarget(target))),
        onInput: (nextRaw) => handleLiveEditorInput(nextRaw),
        onSave: () => saveStudioDraft({ quiet: false }),
        onOpenLink: (target, linkEl) => openWikilinkTarget(target, linkEl),
        onToggleCheckbox: async (kind, globalIndex) => {
          const liveRaw = state.studio.liveController?.getValue();
          const nextRaw = typeof liveRaw === 'string'
            ? liveRaw
            : (kind === 'task'
              ? toggleNthTaskBox(state.draft ?? '', globalIndex)
              : toggleNthBallotBox(state.draft ?? '', globalIndex));
          handleLiveEditorInput(nextRaw);
          if (kind === 'pip' && state.detail) {
            await syncLinkedPlayerTalliesFromSource(state.detail.id, state.detail.title, nextRaw);
          }
          await saveStudioDraft({ quiet: true });
        },
        onFilterTag: (tag) => filterStudioByTag(tag),
        getNotes: () => state.graph?.nodes || [],
        getTags: () => getAllVaultTags(),
        onActiveTextarea: (ta) => {
          state.studio.activeTextarea = ta;
        },
      });
    }

    const toolbarEl = els.notesCanvas.querySelector('#studio-editor-bar');
    if (toolbarEl) {
      state.studio.toolbarCleanup = initRovingToolbar(toolbarEl);
      toolbarEl.querySelectorAll('[data-edit-cmd]').forEach((button) => {
        button.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        button.addEventListener('click', () => {
          let ta = state.studio.activeTextarea || state.studio.liveController?.getActiveTextarea();
          if (!ta && state.studio.liveController) {
            state.studio.liveController.focusBlock(0);
            ta = state.studio.activeTextarea || state.studio.liveController.getActiveTextarea();
          }
          if (!ta) return;
          const cmd = button.dataset.editCmd;
          if (cmd === 'slash') openSlashMenu(ta);
          else runEditorCommand(ta, cmd);
        });
      });
    }
  } else {
    const proseEl = els.notesCanvas.querySelector('#studio-prose');
    if (proseEl) {
      wireProseInteractions(proseEl, detail.id);
      // Tag rendered headings for smooth outline scrolling
      proseEl.querySelectorAll('h1, h2, h3, h4').forEach((hEl, idx) => {
        hEl.dataset.outlineIdx = String(idx);
      });
      if (effectiveMode === 'read' && isVaultWritable()) {
        proseEl.addEventListener('dblclick', (event) => {
          if (event.target.closest('button, a, .wikilink, .tally-pip, .task-box')) return;
          setStudioEditorMode('live');
        });
      }
    }

    const textarea = els.notesCanvas.querySelector('#studio-editor');
    if (textarea) {
      state.studio.activeTextarea = textarea;
      state.studio.editorHandle = attachEditor(textarea, {
        onChange: () => onStudioEditorInput(textarea),
        onSave: () => saveStudioDraft({ quiet: false }),
        onCancel: () => setStudioEditorMode('read'),
        getNotes: () => state.graph?.nodes || [],
        getTags: () => getAllVaultTags(),
      });
      const toolbarEl = els.notesCanvas.querySelector('.editor-bar');
      if (toolbarEl) {
        state.studio.toolbarCleanup = initRovingToolbar(toolbarEl);
      }
      els.notesCanvas.querySelectorAll('[data-edit-cmd]').forEach((button) => {
        button.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        button.addEventListener('click', () => {
          const cmd = button.dataset.editCmd;
          if (cmd === 'slash') openSlashMenu(textarea);
          else runEditorCommand(textarea, cmd);
        });
      });
      state.studio.bubbleCleanup = attachSelectionBubble(
        els.notesCanvas,
        () => textarea,
        (cmd) => (cmd === 'slash' ? openSlashMenu(textarea) : runEditorCommand(textarea, cmd)),
      );
    }
  }

  const headings = ui.extractOutlineHeadings(draft);
  ui.renderNotesMiniOutline(els.notesMiniOutline, headings, jumpToStudioHeading);
  renderNotesStudioInspectorPane(headings);
}

function jumpToStudioHeading(headingIdx, heading) {
  if (!els.notesCanvas) return;
  if (isTabletViewport()) closeMobileDrawers();
  const needle = String(heading?.text || '').trim().toLowerCase();
  const proseEl = els.notesCanvas.querySelector('#studio-prose');
  if (proseEl) {
    const targets = proseEl.querySelectorAll('h1, h2, h3, h4');
    const match = (needle
      ? [...targets].find((el) => el.textContent.trim().toLowerCase() === needle)
      : null) || targets[headingIdx];
    if (match) {
      match.scrollIntoView({ behavior: 'smooth', block: 'start' });
      match.classList.remove('is-flash');
      void match.offsetWidth;
      match.classList.add('is-flash');
      return;
    }
  }
  const liveHost = els.notesCanvas.querySelector('#studio-live-host');
  if (liveHost) {
    const targets = liveHost.querySelectorAll(
      '.live-block-view h1, .live-block-view h2, .live-block-view h3, .live-block-view h4',
    );
    const match = (needle
      ? [...targets].find((el) => el.textContent.trim().toLowerCase() === needle)
      : null) || targets[headingIdx];
    if (match) {
      match.scrollIntoView({ behavior: 'smooth', block: 'start' });
      match.classList.remove('is-flash');
      void match.offsetWidth;
      match.classList.add('is-flash');
      return;
    }
    const headingBlocks = [...liveHost.querySelectorAll('.live-block.is-heading[data-block-index]')];
    const targetBlock = headingBlocks[headingIdx];
    if (targetBlock && state.studio.liveController) {
      const idx = Number(targetBlock.dataset.blockIndex);
      if (Number.isFinite(idx)) {
        state.studio.liveController.focusBlock(idx, { caret: 0 });
        targetBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
  }
  const textarea = els.notesCanvas.querySelector('#studio-editor');
  if (textarea && heading?.line != null) {
    const lines = textarea.value.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(heading.line, lines.length); i += 1) {
      offset += lines[i].length + 1;
    }
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
  }
}

function renderNotesStudioInspectorPane(headings = null) {
  if (!els.notesInspectorBody) return;
  const detail = state.detail;
  const draft = state.draft ?? detail?.raw ?? detail?.markdown ?? '';
  const list = headings || (detail ? ui.extractOutlineHeadings(draft) : []);

  if (els.notesInspectorTabs) {
    els.notesInspectorTabs.querySelectorAll('[data-inspector-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.inspectorTab === state.studio.inspectorTab);
    });
  }

  ui.renderNotesStudioInspector(els.notesInspectorBody, detail, {
    activeTab: state.studio.inspectorTab,
    headings: list,
    writable: isVaultWritable(),
    onOpenNote: (id) => {
      if (isTabletViewport()) closeMobileDrawers();
      openNoteInStudio(id);
    },
    onLinkMention: (sourceId) => {
      if (detail) linkUnlinkedMention(sourceId, detail.title);
    },
    onJumpHeading: jumpToStudioHeading,
  });
}

function renderNotesStudio() {
  if (!els.notesStudio || !state.graph) return;
  els.notesStudio.classList.toggle('is-list-collapsed', state.studio.listCollapsed);
  els.notesStudio.classList.toggle('is-inspector-collapsed', state.studio.inspectorCollapsed);
  els.notesStudio.classList.toggle('is-zen', state.studio.zenMode);
  syncStudioMobileReading();
  if (els.notesToggleInspector) {
    const pressed = isTabletViewport()
      ? Boolean(els.notesInspectorPane?.classList.contains('is-mobile-open'))
      : !state.studio.inspectorCollapsed;
    els.notesToggleInspector.setAttribute('aria-pressed', String(pressed));
  }
  renderNotesStudioFeed();
  renderNotesStudioTabsBar();
  renderNotesStudioHeaderControls();
  renderNotesStudioDocument();
}

function syncStudioLiveMetricsAndOutline(nextRaw) {
  const words = nextRaw.trim() ? nextRaw.trim().split(/\s+/).length : 0;
  const readMin = Math.max(1, Math.round(words / 200));
  els.notesCanvas?.querySelectorAll('[data-studio-words]').forEach((el) => {
    el.textContent = `${words} words`;
  });
  els.notesCanvas?.querySelectorAll('[data-studio-readtime]').forEach((el) => {
    el.textContent = `~${readMin} min read`;
  });

  const headings = ui.extractOutlineHeadings(nextRaw);
  ui.renderNotesMiniOutline(els.notesMiniOutline, headings, jumpToStudioHeading);
  if (state.studio.inspectorTab === 'outline') {
    renderNotesStudioInspectorPane(headings);
  }
}

function handleLiveEditorInput(nextRaw) {
  state.draft = nextRaw;
  state.studio.dirty = true;
  renderNotesStudioHeaderControls();
  renderNotesStudioTabsBar();
  syncStudioLiveMetricsAndOutline(nextRaw);

  clearTimeout(state.studio.autoSaveTimer);
  state.studio.autoSaveTimer = setTimeout(() => {
    saveStudioDraft({ quiet: true });
  }, 850);
}

function onStudioEditorInput(textarea) {
  state.draft = textarea.value;
  state.studio.dirty = true;
  renderNotesStudioHeaderControls();
  renderNotesStudioTabsBar();
  syncStudioLiveMetricsAndOutline(state.draft);

  // Live split preview: update right-hand prose immediately without touching the textarea!
  const proseEl = els.notesCanvas?.querySelector('#studio-prose');
  if (proseEl && state.detail) {
    proseEl.innerHTML = prepareStudioProseHtml(state.draft, state.detail.title);
    wireProseInteractions(proseEl, state.detail.id);
  }

  clearTimeout(state.studio.autoSaveTimer);
  state.studio.autoSaveTimer = setTimeout(() => {
    saveStudioDraft({ quiet: true });
  }, 850);
}

async function saveStudioDraft({ quiet = true } = {}) {
  clearTimeout(state.studio.autoSaveTimer);
  if (!state.detail || !isVaultWritable()) return;
  const noteId = state.detail.id;
  const content = state.draft ?? state.detail.raw ?? state.detail.markdown ?? '';

  state.studio.saving = true;
  renderNotesStudioHeaderControls();

  try {
    if (state.live && !state.readOnly) {
      const result = await api.saveNote({ id: noteId, content }, state.vaultId);
      state.version = result.version;
      state.cache.delete(noteId);
      const fresh = await api.fetchNote(noteId, state.vaultId);
      state.cache.set(noteId, fresh);
      if (state.detail && state.detail.id === noteId) {
        state.detail = fresh;
      }
      const idx = nodeIndex(noteId);
      if (idx >= 0 && state.graph.nodes[idx]) {
        state.graph.nodes[idx].words = fresh.words;
        state.graph.nodes[idx].tags = fresh.tags || [];
      }
    } else {
      await persistModifiedNoteSource(noteId, content);
      const idx = nodeIndex(noteId);
      if (idx >= 0) {
        state.detail = localDetail(state.graph.nodes[idx]);
      }
    }
    if (state.draft === content) {
      state.studio.dirty = false;
    }
    state.studio.saving = false;
    renderNotesStudioHeaderControls();
    renderNotesStudioTabsBar();
    renderNotesStudioFeed();
    renderNotesStudioInspectorPane();
    renderSidebarTallies();
    if (!quiet) ui.toast('Saved');
  } catch (error) {
    state.studio.saving = false;
    renderNotesStudioHeaderControls();
    if (!quiet) ui.toast(error.message || 'Could not save note');
  }
}

function setStudioEditorMode(mode) {
  let valid = mode === 'live' || mode === 'edit' || mode === 'split' || mode === 'read' ? mode : 'live';
  if (!isVaultWritable() && valid !== 'read') {
    ui.toast('This vault is open read-only');
    return;
  }
  if (valid === 'split' && isMobileViewport()) {
    valid = 'live';
  }
  if (state.studio.dirty) {
    saveStudioDraft({ quiet: true });
  }
  state.studio.viewMode = valid;
  prefs.set('cortex.studio.viewMode', valid);
  renderNotesStudioHeaderControls();
  renderNotesStudioDocument();
  if (valid === 'edit' || valid === 'split') {
    const ta = els.notesCanvas?.querySelector('#studio-editor');
    if (ta) ta.focus();
  }
}

function cycleStudioEditorMode() {
  const order = isMobileViewport() ? ['live', 'edit', 'read'] : ['live', 'edit', 'read', 'split'];
  const current = effectiveStudioViewMode();
  const idx = order.indexOf(current);
  const next = order[(idx + 1) % order.length];
  setStudioEditorMode(next);
}

function setStudioScope(scope) {
  state.studio.scope = scope;
  if (scope !== 'folder') state.studio.folderFilter = null;
  renderNotesStudioFeed();
}

function setStudioFolderFilter(folderName) {
  state.studio.folderFilter = folderName;
  state.studio.scope = 'folder';
  renderNotesStudioFeed();
}

function toggleStudioZen(force) {
  state.studio.zenMode = typeof force === 'boolean' ? force : !state.studio.zenMode;
  if (els.notesStudio) els.notesStudio.classList.toggle('is-zen', state.studio.zenMode);
  if (els.notesZenBtn) {
    els.notesZenBtn.classList.toggle('is-active', state.studio.zenMode);
    els.notesZenBtn.setAttribute('aria-pressed', String(state.studio.zenMode));
  }
}

function wireNotesStudioEvents() {
  if (els.notesMobileBack) {
    els.notesMobileBack.addEventListener('click', () => {
      if (state.studio.dirty) saveStudioDraft({ quiet: true });
      closeMobileDrawers();
      setStudioMobileReading(false);
    });
  }
  if (els.notesFilter) {
    els.notesFilter.addEventListener('input', () => {
      state.studio.filterQuery = els.notesFilter.value;
      renderNotesStudioFeed();
    });
  }
  if (els.notesScopes) {
    els.notesScopes.querySelectorAll('[data-scope]').forEach((btn) => {
      btn.addEventListener('click', () => setStudioScope(btn.dataset.scope));
    });
  }
  if (els.notesViewToggle) {
    els.notesViewToggle.querySelectorAll('[data-list-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.studio.listView = btn.dataset.listView === 'list' ? 'list' : 'folders';
        prefs.set('cortex.notes.listView', state.studio.listView);
        renderNotesStudioFeed();
      });
    });
  }
  if (els.notesMoreBtn && els.notesMoreMenu) {
    const closeMore = () => {
      els.notesMoreMenu.hidden = true;
      els.notesMoreBtn.setAttribute('aria-expanded', 'false');
    };
    els.notesMoreBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = els.notesMoreMenu.hidden;
      els.notesMoreMenu.hidden = !open;
      els.notesMoreBtn.setAttribute('aria-expanded', String(open));
    });
    els.notesMoreMenu.addEventListener('click', closeMore);
    document.addEventListener('click', (event) => {
      if (!els.notesMoreMenu.hidden && !event.target.closest('.notes-more')) closeMore();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.notesMoreMenu.hidden) closeMore();
    });
  }
  if (els.notesSort) {
    els.notesSort.addEventListener('click', () => {
      const order = ['recent', 'title', 'links', 'words'];
      state.studio.sortBy = order[(order.indexOf(state.studio.sortBy) + 1) % order.length];
      renderNotesStudioFeed();
    });
  }
  if (els.notesNewBtn) {
    els.notesNewBtn.addEventListener('click', () => openQuickNoteModal());
  }
  if (els.notesTabNew) {
    els.notesTabNew.addEventListener('click', () => openQuickNoteModal());
  }
  if (els.notesToggleList) {
    els.notesToggleList.addEventListener('click', () => {
      state.studio.listCollapsed = !state.studio.listCollapsed;
      els.notesToggleList.setAttribute('aria-pressed', String(!state.studio.listCollapsed));
      if (els.notesStudio) els.notesStudio.classList.toggle('is-list-collapsed', state.studio.listCollapsed);
    });
  }
  if (els.notesToggleInspector) {
    els.notesToggleInspector.addEventListener('click', () => {
      if (isTabletViewport()) {
        const opening = !els.notesInspectorPane?.classList.contains('is-mobile-open');
        closeMobileDrawers();
        if (opening && els.notesInspectorPane) {
          els.notesInspectorPane.classList.add('is-mobile-open');
          els.notesToggleInspector.setAttribute('aria-pressed', 'true');
          renderNotesStudioInspectorPane();
          syncMobileBackdrop();
        }
        return;
      }
      state.studio.inspectorCollapsed = !state.studio.inspectorCollapsed;
      els.notesToggleInspector.setAttribute('aria-pressed', String(!state.studio.inspectorCollapsed));
      if (els.notesStudio) els.notesStudio.classList.toggle('is-inspector-collapsed', state.studio.inspectorCollapsed);
    });
  }
  if (els.notesInspectorClose) {
    els.notesInspectorClose.addEventListener('click', () => closeMobileDrawers());
  }
  if (els.notesViewModes) {
    els.notesViewModes.querySelectorAll('[data-editor-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setStudioEditorMode(btn.dataset.editorMode));
    });
  }
  if (els.notesPinBtn) {
    els.notesPinBtn.addEventListener('click', togglePinCurrentNote);
  }
  if (els.notesCopyLink) {
    els.notesCopyLink.addEventListener('click', async () => {
      if (!state.detail) return;
      const link = `[[${state.detail.title}]]`;
      try {
        await navigator.clipboard.writeText(link);
        ui.toast(`Copied ${link} to clipboard`);
      } catch {
        ui.toast(link);
      }
    });
  }
  if (els.notesRevealFile) {
    els.notesRevealFile.addEventListener('click', async () => {
      if (!state.detail) return;
      if (!state.live) {
        ui.toast(`Path: ${state.detail.path || `${state.detail.id}.md`}`);
        return;
      }
      try {
        await api.revealInFolder(state.detail.id, state.vaultId);
      } catch (error) {
        ui.toast(error.message || 'Could not reveal file');
      }
    });
  }
  if (els.notesLocateGraph) {
    els.notesLocateGraph.addEventListener('click', () => {
      if (!state.detail) return;
      const idx = nodeIndex(state.detail.id);
      if (idx >= 0) {
        setMode('universe');
        showLocalGraph(idx);
      }
    });
  }
  if (els.notesZenBtn) {
    els.notesZenBtn.addEventListener('click', () => toggleStudioZen());
  }
  if (els.notesInspectorTabs) {
    els.notesInspectorTabs.querySelectorAll('[data-inspector-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.studio.inspectorTab = btn.dataset.inspectorTab;
        renderNotesStudioInspectorPane();
      });
    });
  }
  if (els.notesQuickForm) {
    els.notesQuickForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const rawTitle = (els.notesQuickInput?.value || '').trim();
      if (!rawTitle) return;
      els.notesQuickInput.value = '';
      els.notesQuickForm.hidden = true;
      await createNoteWithTemplate({
        title: rawTitle,
        folder: 'Inbox',
        template: 'blank',
        body: '',
      });
    });
  }
}

/**
 * Replace the first unlinked plain-text occurrence of `targetTitle` in `sourceMarkdown`
 * with `[[targetTitle]]`, skipping YAML frontmatter, fenced code blocks, headings, and existing `[[...]]`.
 */
function replaceFirstUnlinkedMention(sourceMarkdown, targetTitle) {
  const lines = String(sourceMarkdown || '').split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i += 1;
    i += 1;
  }
  const escaped = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = new RegExp(`(^|[^\\w\\[])(${escaped})(?=$|[^\\w\\]])`, 'i');
  let inFence = false;

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Split line by existing [[...]] so we never replace inside an existing wikilink
    const parts = line.split(/(\[\[[^\]]+\]\])/g);
    for (let p = 0; p < parts.length; p += 2) {
      const seg = parts[p];
      const match = wordRegex.exec(seg);
      if (match) {
        const before = seg.slice(0, match.index + match[1].length);
        const matchedText = match[2];
        const after = seg.slice(match.index + match[0].length);
        const linkText = matchedText === targetTitle
          ? `[[${targetTitle}]]`
          : `[[${targetTitle}|${matchedText}]]`;
        parts[p] = `${before}${linkText}${after}`;
        lines[i] = parts.join('');
        return { changed: true, content: lines.join('\n') };
      }
    }
  }
  return { changed: false, content: sourceMarkdown };
}

async function linkUnlinkedMention(sourceId, targetTitle) {
  if (!sourceId || !targetTitle || !isVaultWritable()) return;
  try {
    const idx = nodeIndex(sourceId);
    if (idx < 0) return;
    const srcNode = state.graph.nodes[idx];
    const srcDetail = await getDetail(srcNode);
    const raw = srcDetail?.raw ?? srcDetail?.markdown ?? srcNode.body ?? '';
    const { changed, content } = replaceFirstUnlinkedMention(raw, targetTitle);
    if (!changed) {
      ui.toast(`Could not find an unlinked mention of “${targetTitle}” in ${srcNode.title}`);
      return;
    }

    if (state.live && !state.readOnly) {
      const res = await api.saveNote({ id: sourceId, content }, state.vaultId);
      state.version = res.version;
      state.cache.delete(sourceId);
      if (state.detail) state.cache.delete(state.detail.id);
      await refreshGraph();
    } else {
      await persistModifiedNoteSource(sourceId, content);
      if (!srcNode.links.includes(state.detail.id)) {
        srcNode.links.push(state.detail.id);
        state.graph.edges.push({
          source: idx,
          target: nodeIndex(state.detail.id),
          weight: 1,
        });
        buildIncoming();
      }
    }

    if (state.detail) {
      const currentIdx = nodeIndex(state.detail.id);
      if (currentIdx >= 0) await openNote(currentIdx, { record: false });
    }
    ui.toast(`Linked [[${targetTitle}]] in “${srcNode.title}”`);
  } catch (error) {
    ui.toast(error.message || 'Could not link mention');
  }
}

function buildTemplateContent(template, title, extraBody = '') {
  const today = new Date().toISOString().slice(0, 10);
  const body = extraBody.trim();
  switch (template) {
    case 'session':
      return (
        `---\ncreated: ${today}\ntags: [session, log]\n---\n\n` +
        `# ${title}\n\n` +
        `> [!INFO] Session summary\n` +
        `> ${body || 'Key outcome or cliffhanger from this session.'}\n\n` +
        `## Key events\n- [ ] \n\n` +
        `## People & places encountered\n- \n\n` +
        `## Tallies & highlights\n` +
        `| Character | Moment | Points |\n| --- | --- | --- |\n|  |  | \u2610 \u2610 \u2610 |\n\n` +
        `## Open threads for next time\n- \n`
      );
    case 'lore':
      return (
        `---\ncreated: ${today}\ntags: [lore, wiki]\n---\n\n` +
        `# ${title}\n\n` +
        `> [!INFO] Overview\n` +
        `> ${body || 'One-sentence summary of what this topic is and why it matters.'}\n\n` +
        `## Details\n\n\n` +
        `## Connections\n- Related: \n`
      );
    case 'npc':
      return (
        `---\ncreated: ${today}\ntags: [npc, character]\n---\n\n` +
        `# ${title}\n\n` +
        `> [!TIP] Role & demeanour\n` +
        `> ${body || 'How they come across at the table: voice, posture, and first impression.'}\n\n` +
        `| Attribute | Detail |\n| --- | --- |\n| Affiliation |  |\n| Location |  |\n| Status | Active |\n\n` +
        `## What they want\n\n\n` +
        `## Relationships & hooks\n- \n`
      );
    case 'location':
      return (
        `---\ncreated: ${today}\ntags: [location, atlas]\n---\n\n` +
        `# ${title}\n\n` +
        `> [!INFO] Sights & atmosphere\n` +
        `> ${body || 'What you see, hear, and notice first upon arriving.'}\n\n` +
        `## Landmarks & features\n- \n\n` +
        `## Connected roads & routes\n- \n`
      );
    case 'blank':
    default:
      return (
        `---\ncreated: ${today}\ntags: []\n---\n\n` +
        `# ${title}\n\n` +
        `${body ? `${body}\n` : ''}`
      );
  }
}

function setQuickNoteTemplate(tpl) {
  state.quickNoteTemplate = tpl || 'blank';
  if (els.quickNoteTemplates) {
    els.quickNoteTemplates.querySelectorAll('[data-note-tpl]').forEach((btn) => {
      const active = btn.dataset.noteTpl === state.quickNoteTemplate;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
}

function openQuickNoteModal({ title = '', folder = null, template = 'blank' } = {}) {
  if (!isVaultWritable()) {
    ui.toast('This vault is open read-only');
    return;
  }
  if (!els.quickNoteModal) return;
  setQuickNoteTemplate(template);
  if (els.quickNoteFolderList && state.graph) {
    els.quickNoteFolderList.innerHTML = (state.graph.meta.folders || [])
      .filter((f) => f.name && f.name !== '(root)')
      .map((f) => `<option value="${f.name}"></option>`)
      .join('');
  }
  const defaultFolder = folder !== null
    ? folder
    : (state.studio.scope === 'folder' && state.studio.folderFilter && state.studio.folderFilter !== '(root)'
      ? state.studio.folderFilter
      : '');
  if (els.quickNoteTitle) els.quickNoteTitle.value = title;
  if (els.quickNoteFolder) els.quickNoteFolder.value = defaultFolder;
  if (els.quickNoteBody) els.quickNoteBody.value = '';
  els.quickNoteModal.hidden = false;
  setTimeout(() => els.quickNoteTitle?.focus(), 0);
}

function closeQuickNoteModal() {
  if (els.quickNoteModal) els.quickNoteModal.hidden = true;
}

async function submitQuickNoteModal(event) {
  event.preventDefault();
  const title = (els.quickNoteTitle?.value || '').trim();
  if (!title) return;
  const folder = (els.quickNoteFolder?.value || '').trim().replace(/^\/+|\/+$/g, '');
  const body = els.quickNoteBody?.value || '';
  const template = state.quickNoteTemplate || 'blank';
  closeQuickNoteModal();
  await createNoteWithTemplate({ title, folder, template, body });
}

async function createNoteWithTemplate({ title, folder = '', template = 'blank', body = '' }) {
  const cleanFolder = folder && folder !== '(root)' ? folder : '';
  const relId = cleanFolder ? `${cleanFolder}/${title}` : title;
  const content = buildTemplateContent(template, title, body);

  if (state.live && !state.readOnly) {
    try {
      const result = await api.saveNote({ id: relId, title, content }, state.vaultId);
      state.version = result.version;
      await refreshGraph();
      const index = nodeIndex(result.id);
      if (index >= 0) {
        setMode('notes');
        await openNote(index);
        setStudioEditorMode('live');
        ui.toast(`Created “${title}”`);
      }
    } catch (error) {
      ui.toast(error.message || 'Could not create note');
    }
    return;
  }

  // Static mode local note creation so demo & static users can test the full workflow too
  if (!state.live && state.graph) {
    const folderName = cleanFolder || '(root)';
    const newNode = {
      id: relId,
      title,
      folder: folderName,
      created: new Date().toISOString().slice(0, 10),
      words: content.split(/\s+/).filter(Boolean).length,
      tags: [],
      links: [],
      degree: 0,
      pagerank: 0.01,
      x: 0,
      y: 0,
      z: 0,
      bx: 0,
      by: 0,
      bz: 0,
      color: 0,
      size: 1,
      appear: 0.5,
      excerpt: body || title,
      body: content,
    };
    state.graph.nodes.unshift(newNode);
    await persistModifiedNoteSource(relId, content);
    buildLookup();
    setMode('notes');
    await openNote(0);
    setStudioEditorMode('live');
    ui.toast(`Created “${title}” (saved in browser)`);
  }
}

function triggerQuickCapture() {
  if (state.mode === 'notes' && els.notesQuickForm) {
    els.notesQuickForm.hidden = !els.notesQuickForm.hidden;
    if (!els.notesQuickForm.hidden) {
      els.notesQuickInput?.focus();
    }
    return;
  }
  openQuickNoteModal({ folder: 'Inbox', template: 'blank' });
}

function openRandomNote() {
  if (!state.graph || !state.graph.nodes.length) return;
  const nodes = state.graph.nodes;
  // Golden-ratio deterministic step through the vault so every press visits a distinct note
  state.surpriseSeed = (state.surpriseSeed + Math.max(1, Math.floor(nodes.length * 0.6180339887))) % nodes.length;
  const idx = state.surpriseSeed;
  openNote(idx);
  ui.toast(`Surprise note: “${nodes[idx].title}”`);
}

function openShortcutsModal() {
  if (!els.shortcutsModal) return;
  els.shortcutsModal.hidden = false;
  els.shortcutsClose?.focus();
}

function closeShortcutsModal() {
  if (!els.shortcutsModal) return;
  els.shortcutsModal.hidden = true;
}

/* ---------- collection ---------- */

function toggleSelection(index) {
  const node = state.graph && state.graph.nodes[index];
  if (!node) return;
  if (state.selection.has(node.id)) state.selection.delete(node.id);
  else state.selection.add(node.id);
  syncSelection();
}

function clearSelection() {
  state.selection.clear();
  syncSelection();
}

function syncSelection() {
  const indices = selectionIndices();
  if (state.renderer) state.renderer.setSelection(indices);
  if (state.atlas) state.atlas.setSelection(indices);
  renderSelection();
}

function renderSelection() {
  const count = state.selection.size;
  els.selection.hidden = count === 0;
  els.trayCount.textContent = String(count);
  els.selection.querySelectorAll('[data-template]').forEach((button) => {
    button.disabled = count < 2;
    button.title = count < 2 ? 'Collect at least two notes first' : '';
  });
}

function openCompose(template) {
  if (!state.live) {
    ui.toast('The static demo cannot write notes');
    return;
  }
  if (state.selection.size < 2) {
    ui.toast(`${mod}-click or shift-click at least two stars to collect them`);
    return;
  }
  state.compose = template;
  const research = template === 'research';
  els.composeKicker.textContent = research ? 'Research brief' : 'Idea refinement';
  els.composeLabel.textContent = research ? 'The question' : 'The decision';
  els.composeTitle.placeholder = research
    ? 'How does attention shape deep work?'
    : 'Should this be one product or two?';
  els.composeTitle.value = '';
  els.compose.hidden = false;
  els.composeTitle.focus();
  updateComposeState();
}

function closeCompose() {
  els.compose.hidden = true;
  state.compose = null;
}

function updateComposeState() {
  const count = state.selection.size;
  els.composeSub.textContent = `${count} collected ${count === 1 ? 'note' : 'notes'} will be linked as evidence.`;
  const submit = els.composeForm.querySelector('button[type="submit"]');
  if (submit) submit.disabled = els.composeTitle.value.trim().length < 3;
}

async function submitCompose(event) {
  event.preventDefault();
  if (!state.compose) return;
  const title = els.composeTitle.value.trim();
  if (title.length < 3) return;
  const template = state.compose;
  const submit = els.composeForm.querySelector('button[type="submit"]');
  const notes = [...state.selection];
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Writing…';
  }
  try {
    const result = await api.synthesize({ title, template, notes }, state.vaultId);
    closeCompose();
    state.selection.clear();
    syncSelection();
    state.version = result.version;
    await refreshGraph();
    const index = nodeIndex(result.id);
    if (index >= 0) await openNote(index);
    ui.toast(template === 'research' ? 'Research brief created' : 'Idea note created');
  } catch (error) {
    ui.toast(error.message || 'Could not create that note');
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Create note';
    }
  }
}

/* ---------- command palette & search ---------- */

function buildPaletteCommands() {
  const rendered = effectiveTheme();
  const commands = [
    {
      kind: 'command',
      id: 'cmd:view:notes',
      title: 'Switch to Notes Studio',
      subtitle: 'Full native Markdown note-taking studio with backlinks, outline & live split preview',
      keywords: 'view notes studio write editor markdown obsidian notion astrocortex',
      shortcut: '0',
      pinned: state.mode !== 'notes',
      run: () => setMode('notes'),
    },
    {
      kind: 'command',
      id: 'cmd:note:new',
      title: 'Create new note (with folder & template)',
      subtitle: 'Blank, Session log, Wiki callout, Character/NPC, or Place/Atlas note',
      keywords: 'new create note template folder session npc lore location',
      shortcut: 'n',
      pinned: true,
      run: () => openQuickNoteModal(),
    },
    {
      kind: 'command',
      id: 'cmd:note:quick',
      title: 'Quick capture to Inbox',
      subtitle: 'Jot a fast note directly into Inbox',
      keywords: 'quick capture inbox jot note',
      shortcut: 'q',
      run: () => triggerQuickCapture(),
    },
    {
      kind: 'command',
      id: 'cmd:note:surprise',
      title: 'Surprise me — open a random note',
      subtitle: 'Rediscover an existing note from your vault',
      keywords: 'surprise random note serendipity discover',
      shortcut: 's',
      run: () => openRandomNote(),
    },
    {
      kind: 'command',
      id: 'cmd:note:pin',
      title: 'Pin / unpin current note',
      subtitle: 'Keep important notes at the top of the left sidebar',
      keywords: 'pin unpin favorite bookmark note sidebar',
      shortcut: 'p',
      run: () => togglePinCurrentNote(),
    },
    {
      kind: 'command',
      id: 'cmd:studio:mode',
      title: 'Cycle editor mode (Live · Source · Read · Split)',
      subtitle: 'Switch between Obsidian Live Preview, source editor, reading view, and side-by-side split',
      keywords: 'editor live split preview read source mode',
      shortcut: key('E'),
      run: () => {
        if (state.mode !== 'notes') setMode('notes');
        cycleStudioEditorMode();
      },
    },
    {
      kind: 'command',
      id: 'cmd:shortcuts',
      title: 'Keyboard shortcuts & slash commands',
      subtitle: 'Reference sheet for studio shortcuts, [[wikilinks, and /slash commands',
      keywords: 'shortcuts keyboard help slash commands reference',
      shortcut: '?',
      run: () => openShortcutsModal(),
    },
    {
      kind: 'command',
      id: 'cmd:view:brain',
      title: 'Switch to Brain view',
      subtitle: 'Notes folded onto a cortical surface',
      keywords: 'view brain cortex 3d',
      shortcut: '2',
      pinned: state.mode !== 'brain',
      run: () => setMode('brain'),
    },
    {
      kind: 'command',
      id: 'cmd:view:universe',
      title: 'Switch to Graph view',
      subtitle: 'Folder galaxies and wikilink clusters',
      keywords: 'view graph universe 3d',
      shortcut: '1',
      pinned: state.mode === 'brain',
      run: () => setMode('universe'),
    },
    {
      kind: 'command',
      id: 'cmd:view:replay',
      title: 'Switch to Timeline view',
      subtitle: 'Replay notes in creation order',
      keywords: 'view timeline replay history',
      shortcut: '3',
      run: () => setMode('replay'),
    },
    {
      kind: 'command',
      id: 'cmd:view:atlas',
      title: 'Switch to Atlas view',
      subtitle: 'Folders as countries, notes as places',
      keywords: 'view atlas map parchment',
      shortcut: '4',
      run: () => setMode('atlas'),
    },
    {
      kind: 'command',
      id: 'cmd:view:bento',
      title: 'Switch to Bento view',
      subtitle: 'Folders as boxes sized by note count',
      keywords: 'view bento overview grid',
      shortcut: '6',
      run: () => setMode('bento'),
    },
    {
      kind: 'command',
      id: 'cmd:view:decisions',
      title: 'Switch to Decisions view',
      subtitle: 'Research briefs and idea notes by status',
      keywords: 'view decisions briefs ideas trail',
      shortcut: '5',
      run: () => setMode('decisions'),
    },
    {
      kind: 'command',
      id: 'cmd:theme:toggle',
      title: rendered === 'dark' ? 'Switch to Warm Light theme' : 'Switch to Dark theme',
      subtitle: 'Toggle studio appearance',
      keywords: 'theme dark light appearance color warm',
      pinned: true,
      run: () => toggleTheme(),
    },
    {
      kind: 'command',
      id: 'cmd:theme:system',
      title: 'Use System appearance',
      subtitle: 'Follow the operating system theme',
      keywords: 'theme system auto appearance',
      run: () => applyTheme('system'),
    },
    {
      kind: 'command',
      id: 'cmd:sidebar:toggle',
      title: state.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
      subtitle: 'Toggle vaults and folders panel',
      keywords: 'sidebar collapse expand panel chrome',
      shortcut: '[',
      pinned: true,
      run: () => toggleSidebar(),
    },
    {
      kind: 'command',
      id: 'cmd:camera:reframe',
      title: 'Reframe camera',
      subtitle: 'Reset zoom and focus to the full vault',
      keywords: 'reframe reset camera zoom center fit',
      shortcut: 'f',
      run: () => {
        clearFolderFocus({ resetCamera: false });
        state.camera.yaw = 0.55;
        state.camera.pitch = 0.22;
        state.camera.frame(state.mode);
        if (state.atlas && state.mode === 'atlas') state.atlas.fit();
      },
    },
    {
      kind: 'command',
      id: 'cmd:stars:glow',
      title: 'Star style: Glow',
      subtitle: 'Soft glowing stars with halo and cross flare',
      keywords: 'stars glow style graph look',
      run: () => applyStarMode('glow'),
    },
    {
      kind: 'command',
      id: 'cmd:stars:anime',
      title: 'Star style: Anime impact',
      subtitle: 'High-contrast impact frame star bursts',
      keywords: 'stars anime impact sakuga frame style graph look',
      run: () => applyStarMode('anime'),
    },
    {
      kind: 'command',
      id: 'cmd:stars:dots',
      title: 'Star style: Dots',
      subtitle: 'Crisp flat geometric dots without flare',
      keywords: 'stars dots minimal flat style graph look',
      run: () => applyStarMode('dots'),
    },
    {
      kind: 'command',
      id: 'cmd:brain:mode',
      title: state.brainMode === 'shell' ? 'Brain mode: Notes form brain (hide shell)' : 'Brain mode: Show cortical shell',
      subtitle: 'Toggle whether the 3D brain mesh is drawn or notes sculpt the brain directly',
      keywords: 'brain mode shell hidden notes sculpt cortex',
      run: () => applyBrainMode(state.brainMode === 'shell' ? 'notes' : 'shell'),
    },
    {
      kind: 'command',
      id: 'cmd:atlas:biomes',
      title: prefs.get('cortex.atlas.biomes', true) ? 'Hide Atlas biomes' : 'Show Atlas biomes',
      subtitle: 'Toggle regional biomes (woodland, wastes, wetlands, tundra, highlands, steppe)',
      keywords: 'atlas map biomes terrain toggle',
      run: () => {
        const next = !prefs.get('cortex.atlas.biomes', true);
        prefs.set('cortex.atlas.biomes', next);
        if (state.atlas) state.atlas.setBiomes(next);
        syncVisualSettingsUI();
      },
    },
    {
      kind: 'command',
      id: 'cmd:tally:add',
      title: 'Add tally / point counter',
      subtitle: 'Track cool points, crybaby points, or custom tallies in the sidebar',
      keywords: 'tally counter points cool crybaby tracker score',
      run: () => {
        if (state.sidebarCollapsed) toggleSidebar(false);
        state.addingCustomTally = true;
        renderSidebarTallies();
      },
    },
    {
      kind: 'command',
      id: 'cmd:settings',
      title: 'Open vault settings',
      subtitle: 'Appearance, star look, brain mode, map roads & biomes',
      keywords: 'settings preferences stars brain biomes roads mcp',
      run: () => openSettings(),
    },
  ];

  if (state.selected != null) {
    commands.push({
      kind: 'command',
      id: 'cmd:local',
      title: state.local ? 'Return to full graph' : 'Focus local graph',
      subtitle: 'Isolate the selected note and its neighbours',
      keywords: 'local graph focus neighbours',
      shortcut: 'l',
      run: () => {
        if (state.local) clearLocalGraph();
        else showLocalGraph(state.selected);
      },
    });
  }

  if (state.live) {
    commands.push(
      {
        kind: 'command',
        id: 'cmd:today',
        title: "Open today's note",
        subtitle: 'Journal/YYYY-MM-DD.md',
        keywords: 'today daily journal note',
        shortcut: 't',
        pinned: true,
        run: () => openDaily(),
      },
      {
        kind: 'command',
        id: 'cmd:new',
        title: 'Create new note',
        subtitle: 'Write a blank Markdown note in this vault',
        keywords: 'new create note markdown',
        shortcut: 'n',
        run: () => createNote(),
      },
      {
        kind: 'command',
        id: 'cmd:tour',
        title: 'Start guided tour',
        subtitle: 'Fifteen-step walkthrough of Cortex',
        keywords: 'tour walkthrough guide help',
        run: () => startTour(),
      },
      {
        kind: 'command',
        id: 'cmd:vaults',
        title: 'Open another folder…',
        subtitle: 'Switch vault or open a new Markdown folder',
        keywords: 'vault folder open switch launcher',
        shortcut: key('O'),
        run: () => showLaunch(),
      },
    );
  } else {
    commands.push({
      kind: 'command',
      id: 'cmd:vaults:local',
      title: 'Open folder or Markdown files from this device',
      subtitle: 'Load a local vault folder or .md files directly in the browser',
      keywords: 'vault folder open file markdown local pc device import',
      pinned: true,
      run: () => openLocalVaultDialog(''),
    });
  }

  return commands;
}

function matchCommands(query, commands) {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  const terms = needle.split(/\s+/).filter(Boolean);
  return commands.filter((cmd) => {
    const haystack = `${cmd.title} ${cmd.subtitle || ''} ${cmd.keywords || ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function openPalette(initial = '') {
  const text = typeof initial === 'string' ? initial : '';
  state.palette.open = true;
  els.palette.hidden = false;
  els.paletteInput.value = text;
  state.palette.query = text;
  state.palette.active = 0;
  els.paletteInput.focus();
  scheduleSearch(true);
}

function closePalette() {
  state.palette.open = false;
  els.palette.hidden = true;
  els.paletteInput.blur();
}

function scheduleSearch(immediate = false) {
  clearTimeout(state.palette.timer);
  const run = () => search(state.palette.query);
  if (immediate) run();
  else state.palette.timer = setTimeout(run, 120);
}

async function search(query) {
  if (!state.graph) return;
  const raw = query.trim();
  const commandsOnly = raw.startsWith('>');
  const needle = commandsOnly ? raw.slice(1).trim() : raw;
  const allCommands = buildPaletteCommands();

  if (commandsOnly) {
    state.palette.hits = matchCommands(needle, allCommands);
    state.palette.active = 0;
    ui.renderPaletteHits(els.paletteResults, state.palette.hits, state.palette.active);
    return;
  }

  let matchedCommands = [];
  let noteHits = [];

  if (!needle) {
    matchedCommands = allCommands.filter((cmd) => cmd.pinned).slice(0, 4);
    noteHits = [...state.graph.nodes]
      .sort((a, b) => b.pagerank - a.pagerank)
      .slice(0, 10)
      .map((node) => ({ kind: 'note', id: node.id, title: node.title, folder: node.folder, snippet: node.excerpt }));
  } else {
    matchedCommands = matchCommands(needle, allCommands).slice(0, 5);
    if (!state.live) {
      const lower = needle.toLowerCase();
      noteHits = state.graph.nodes
        .filter(
          (node) =>
            node.title.toLowerCase().includes(lower)
            || node.tags.some((tag) => tag.includes(lower))
            || node.folder.toLowerCase().includes(lower),
        )
        .sort((a, b) => b.pagerank - a.pagerank)
        .slice(0, 16)
        .map((node) => ({ kind: 'note', id: node.id, title: node.title, folder: node.folder, snippet: node.excerpt }));
    } else {
      try {
        const hits = await api.searchNotes(needle, state.vaultId, 16);
        if (state.palette.query.trim() !== raw) return;
        noteHits = hits.map((hit) => ({ kind: 'note', ...hit }));
      } catch {
        noteHits = [];
      }
    }
  }

  state.palette.hits = [...matchedCommands, ...noteHits];
  state.palette.active = 0;
  ui.renderPaletteHits(els.paletteResults, state.palette.hits, state.palette.active);
}

function onPaletteKey(event) {
  const count = state.palette.hits.length;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (count) {
      state.palette.active = (state.palette.active + 1) % count;
      ui.renderPaletteHits(els.paletteResults, state.palette.hits, state.palette.active);
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (count) {
      state.palette.active = (state.palette.active - 1 + count) % count;
      ui.renderPaletteHits(els.paletteResults, state.palette.hits, state.palette.active);
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (event.isComposing || event.keyCode === 229) return;
    openHit(state.palette.active);
  }
}

function openHit(hitIndex) {
  const hit = state.palette.hits[hitIndex];
  if (!hit) return;
  closePalette();
  if (hit.kind === 'command') {
    if (typeof hit.run === 'function') hit.run();
    return;
  }
  const index = nodeIndex(hit.id);
  if (index >= 0) openNote(index);
}

boot();
