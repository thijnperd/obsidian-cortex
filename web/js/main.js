// Cortex UI controller.

import { Camera } from './camera.js';
import { Renderer, PALETTE } from './renderer.js';
import { clamp, easeInOut, project } from './math.js';
import { renderMarkdown } from './markdown.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { Atlas } from './atlas.js';
import { diaryFolders, isOverview } from './scale.js';

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
  launching: false,
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
  atlas: document.getElementById('atlas'),
  decisions: document.getElementById('decisions'),
  decisionsBoard: document.getElementById('decisions-board'),
  settings: document.getElementById('settings'),
  settingsButton: document.getElementById('settings-button'),
  settingsClose: document.getElementById('settings-close'),
  settingsName: document.getElementById('settings-name'),
  settingsPath: document.getElementById('settings-path'),
  settingsObsidian: document.getElementById('settings-obsidian'),
  settingsViews: document.getElementById('settings-views'),
  settingsWrites: document.getElementById('settings-writes'),
  settingsRoads: document.getElementById('settings-roads'),
  settingsRoutes: document.getElementById('settings-routes'),
  settingsAgents: document.getElementById('settings-agents'),
  settingsAgentsHelp: document.getElementById('settings-agents-help'),
  settingsReveal: document.getElementById('settings-reveal'),
  settingsMcpTest: document.getElementById('settings-mcp-test'),
  settingsMcpConfig: document.getElementById('settings-mcp-config'),
  settingsMcpStatus: document.getElementById('settings-mcp-status'),
  settingsAbout: document.getElementById('settings-about'),
  settingsUpdate: document.getElementById('settings-update'),
  launchBrowse: document.getElementById('launch-browse'),
  sidebar: document.getElementById('sidebar'),
  vaultButton: document.getElementById('vault-button'),
  vaultTitle: document.getElementById('vault-title'),
  vaultSub: document.getElementById('vault-sub'),
  stats: document.getElementById('stats'),
  folders: document.getElementById('folders'),
  foldersReset: document.getElementById('folders-reset'),
  vaultList: document.getElementById('vault-list'),
  addVault: document.getElementById('add-vault'),
  searchButton: document.getElementById('search-button'),
  newNote: document.getElementById('new-note'),
  panel: document.getElementById('panel'),
  panelBody: document.getElementById('panel-body'),
  panelActions: document.getElementById('panel-actions'),
  panelCrumbs: document.getElementById('panel-crumbs'),
  panelClose: document.getElementById('panel-close'),
  panelBack: document.getElementById('panel-back'),
  panelForward: document.getElementById('panel-forward'),
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

function viewForVault(id) {
  return prefs.get(`cortex.view.${id}`, prefs.get('cortex.launchView', 'universe'));
}

function launchView() {
  const checked = document.querySelector('input[name="launch-view"]:checked');
  return checked ? checked.value : 'universe';
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

function boot() {
  wire();
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
        await switchVault(active.id);
      } else {
        showLaunch();
      }
      ui.hideBoot();
      requestAnimationFrame(loop);
      return;
    }

    document.body.classList.add('is-static');
    const graph = await api.loadStaticGraph();
    applyGraph(graph);
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
    }
  }
}

function wire() {
  const storedView = prefs.get('cortex.launchView', 'universe');
  const storedRadio = document.querySelector(`input[name="launch-view"][value="${storedView}"]`);
  if (storedRadio) storedRadio.checked = true;

  els.canvas.addEventListener('pointerdown', onPointerDown);
  els.canvas.addEventListener('pointermove', onPointerMove);
  els.canvas.addEventListener('pointerup', onPointerUp);
  els.canvas.addEventListener('pointerleave', () => setHover(null));
  els.canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  document.querySelectorAll('.view[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
  els.sectionFocusExit.addEventListener('click', () => clearFolderFocus());
  els.panelClose.addEventListener('click', closePanel);
  els.panelBack.addEventListener('click', goBack);
  els.panelForward.addEventListener('click', goForward);
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
  els.newNote.addEventListener('click', createNote);
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
  els.settingsButton.addEventListener('click', openSettings);
  els.settingsClose.addEventListener('click', closeSettings);
  els.settings.addEventListener('click', (event) => {
    if (event.target === els.settings) closeSettings();
  });
  els.settingsViews.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
  els.settingsRoads.addEventListener('change', () => {
    prefs.set('cortex.atlas.roads', els.settingsRoads.checked);
    if (state.atlas) state.atlas.setRoads(els.settingsRoads.checked);
  });
  els.settingsRoutes.addEventListener('change', () => {
    prefs.set('cortex.atlas.routes', els.settingsRoutes.checked);
    if (state.atlas) state.atlas.setRoutes(els.settingsRoutes.checked);
  });
  els.settingsAgents.addEventListener('change', () => {
    setAgentAccess(els.settingsAgents.checked);
  });
  els.settingsReveal.addEventListener('click', () => revealVault(currentVault()));
  els.launchBrowse.addEventListener('click', browseFolder);
  els.settingsMcpTest.addEventListener('click', testMcp);
  els.settingsMcpConfig.addEventListener('click', copyMcpConfig);
  els.settingsUpdate.addEventListener('click', () => {
    if (state.about?.releases) window.open(state.about.releases, '_blank', 'noopener');
  });
  els.vaultButton.addEventListener('click', () => showLaunch());
  els.addVault.addEventListener('click', () => showLaunch());
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
  state.launching = true;
  els.launch.hidden = false;
  els.sidebar.hidden = true;
  document.body.classList.remove('has-sidebar');
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
  showLaunchError(null);
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
  if (state.live) {
    els.sidebar.hidden = false;
    document.body.classList.add('has-sidebar');
  }
  resizeCamera();
}

function resetVaultState() {
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
        if (state.editing) {
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
  document.title = `${graph.meta.title} — Cortex`;
  els.vaultTitle.textContent = graph.meta.title;
  els.vaultSub.textContent = state.live
    ? (currentVault()?.path || '')
    : 'static demo';
  els.newNote.hidden = !state.live;
  const overview = isOverview(graph.nodes.length);
  ui.setStats(graph.meta, overview);
  ui.renderDecisions(els.decisionsBoard, graph.structures, openDecision);
  ui.renderFolders(els.folders, graph.meta.folders, state.hidden, toggleFolder, PALETTE);
  ui.syncFolders(state.hidden);
  buildLookup();
  buildIncoming();

  if (!state.renderer) {
    state.renderer = new Renderer(els.canvas);
    state.renderer.onContextLost = () => ui.toast('Graphics context lost — reload to restore');
  }
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
  const key = String(target || '').trim().replace(/\.md$/i, '').toLowerCase();
  if (!key) return null;
  return state.lookup.get(key) || state.lookup.get(key.split('/').pop()) || null;
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
  // a note, and a selected note keeps its label.
  const ranked = [...state.graph.nodes]
    .map((node, index) => ({ node, index }))
    .sort((a, b) => b.node.pagerank - a.node.pagerank)
    .slice(0, overview ? 0 : 16);
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
  // The board is DOM: no scene to draw, and no reason to keep paying for one.
  if (state.mode === 'decisions') return;

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
        if (Math.abs(other.x - screen.x) < 170 && Math.abs(other.y - screen.y) < 40) {
          visible = false;
          break;
        }
      }
    }
    label.element.style.visibility = visible ? 'visible' : 'hidden';
    label.element.style.opacity = visible ? String(clamp(1.35 - screen.depth * 0.16, 0.28, 0.95)) : '0';
    if (visible) {
      placed.push({ x: screen.x, y: screen.y, half: 85 });
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
  state.mode = mode;
  if (state.folderFocus) clearFolderFocus({ resetCamera: false });
  if (state.local) clearLocalGraph({ resetCamera: false, rerender: false });
  ui.setModeButtons(mode);
  syncSettingsViews();

  const atlasMode = mode === 'atlas';
  const boardMode = mode === 'decisions';
  els.replay.hidden = mode !== 'replay';
  els.canvas.hidden = atlasMode || boardMode;
  els.labels.hidden = atlasMode || boardMode;
  els.atlas.hidden = !atlasMode;
  els.decisions.hidden = !boardMode;
  document.body.classList.toggle('mode-atlas', atlasMode);
  document.body.classList.toggle('mode-decisions', boardMode);

  if (atlasMode) {
    const atlas = ensureAtlas();
    syncAtlas();
    atlas.setRoads(prefs.get('cortex.atlas.roads', true));
    atlas.setRoutes(prefs.get('cortex.atlas.routes', true));
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
  els.replay.hidden = false;
  state.brainTarget = 0;
  const progress = Number(event.target.value) / 1000;
  state.reveal = 0.015 + progress * 0.985;
  ui.setTimelineDate(formatDate(progress));
}

function toggleFolder(name) {
  if (state.hidden.has(name)) state.hidden.delete(name);
  else state.hidden.add(name);
  if (state.hidden.has(name) && state.folderFocus === name) clearFolderFocus();
  ui.syncFolders(state.hidden);
  state.renderer.setFolderFilter(state.hidden);
  if (state.atlas) state.atlas.setHidden(state.hidden);
}

function resetFolders() {
  state.hidden.clear();
  ui.syncFolders(state.hidden);
  state.renderer.setFolderFilter(state.hidden);
  if (state.atlas) state.atlas.setHidden(state.hidden);
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
    const build = about.build && about.build !== 'dev' ? ` (${about.build})` : '';
    els.settingsAbout.textContent = `Cortex ${about.version}${build} · port ${about.port} · ${about.config || 'config folder unknown'}`;
  } catch {
    els.settingsAbout.textContent = 'Cortex';
  }
}

function openSettings() {
  const vault = currentVault();
  if (!vault) {
    ui.toast('Open a folder first');
    return;
  }
  els.settingsName.textContent = vault.name;
  els.settingsPath.textContent = vault.path;
  els.settingsObsidian.hidden = !vault.obsidian;
  els.settingsWrites.textContent = state.readOnly
    ? 'This folder is open read-only. Cortex can read it, but will not write to it.'
    : 'Notes are written as plain Markdown in the folder, so Obsidian sees them immediately.';
  els.settingsRoads.checked = prefs.get('cortex.atlas.roads', true);
  els.settingsRoutes.checked = prefs.get('cortex.atlas.routes', true);
  syncAgentHelp(vault);
  refreshMcpStatus();
  loadAbout();
  els.settingsReveal.disabled = Boolean(vault.missing);
  syncSettingsViews();
  els.settings.hidden = false;
  els.settingsClose.focus();
}

function closeSettings() {
  els.settings.hidden = true;
  els.settingsButton.focus();
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
  const typing = isTyping();
  const mod = event.metaKey || event.ctrlKey;

  if (mod && event.key.toLowerCase() === 'k') {
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
  if (event.key === 'Escape') {
    if (!els.settings.hidden) closeSettings();
    else if (!els.compose.hidden) closeCompose();
    else if (state.palette.open) closePalette();
    else if (state.launching && state.vaultId) hideLaunch();
    else if (!els.panel.hidden) closePanel();
    else if (state.local) clearLocalGraph();
    else if (state.folderFocus) clearFolderFocus();
    else setHover(null);
    return;
  }
  if (typing || state.launching || !state.graph) return;

  if (event.key === '/') {
    event.preventDefault();
    openPalette();
  } else if (event.key === '1') setMode('universe');
  else if (event.key === '2') setMode('brain');
  else if (event.key === '3') setMode('replay');
  else if (event.key === '4') setMode('atlas');
  else if (event.key === '5') setMode('decisions');
  else if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    setMode(state.mode === 'brain' ? 'universe' : 'brain');
  } else if (event.key.toLowerCase() === 'r') startReplay();
  else if (event.key.toLowerCase() === 'l' && state.selected != null) {
    if (state.local) clearLocalGraph();
    else showLocalGraph(state.selected);
  } else if (event.key.toLowerCase() === 'n' && state.live) createNote();
  else if (event.key.toLowerCase() === 'c' && state.selected != null) {
    toggleSelection(state.selected);
    if (state.detail) renderPanel(state.detail);
  } else if (event.key.toLowerCase() === 'f' || event.key === '0') {
    clearFolderFocus({ resetCamera: false });
    state.camera.yaw = 0.55;
    state.camera.pitch = 0.22;
    state.camera.frame(state.mode);
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

async function openNote(index, { record = true } = {}) {
  const node = state.graph.nodes[index];
  if (!node) return;
  const token = ++openToken;
  const wasLocal = Boolean(state.local);
  state.selected = index;
  if (wasLocal) showLocalGraph(index);
  state.renderer.setFocus(index);
  if (state.atlas) state.atlas.setFocus(index);
  if (record) pushHistory(node.id);
  const detail = await getDetail(node);
  if (!detail || token !== openToken) return;
  state.detail = detail;
  state.editing = false;
  renderPanel(detail);
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

function localDetail(node) {
  const backlinks = (state.incoming.get(node.id) || [])
    .map(({ source, weight }) => ({
      id: state.graph.nodes[source].id,
      title: state.graph.nodes[source].title,
      folder: state.graph.nodes[source].folder,
      weight,
    }))
    .slice(0, 16);
  const related = relatedFromGraph(node.id);
  return {
    id: node.id,
    title: node.title,
    folder: node.folder,
    created: node.created,
    words: node.words,
    tags: node.tags,
    markdown: node.body || node.excerpt,
    raw: null,
    backlinks,
    mentions: [],
    related,
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
      return { id: node.id, title: node.title, folder: node.folder, weight: 0 };
    });
}

function renderPanel(detail) {
  // The body usually repeats its title as an H1; the panel already shows it.
  let markdown = detail.markdown || '';
  const heading = /^\s*#\s+(.+)\r?\n/.exec(markdown);
  if (heading && heading[1].trim().toLowerCase() === detail.title.trim().toLowerCase()) {
    markdown = markdown.slice(heading[0].length);
  }
  const html = renderMarkdown(markdown, (target) => Boolean(resolveTarget(target)));
  els.panelBody.innerHTML = ui.panelHtml(detail, html);
  els.panelBody.scrollTop = 0;
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

  els.panelBody.querySelectorAll('.wikilink').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const id = resolveTarget(link.dataset.target);
      if (!id) {
        ui.toast(`No note called “${link.dataset.target}” yet`);
        return;
      }
      const index = nodeIndex(id);
      if (index >= 0) openNote(index);
    });
  });
  els.panelBody.querySelectorAll('[data-note-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = nodeIndex(button.dataset.noteId);
      if (index >= 0) openNote(index);
    });
  });
}

function closePanel() {
  if (els.panel.hidden) return;
  if (state.local) clearLocalGraph({ resetCamera: true, rerender: false });
  openToken += 1;
  els.panel.hidden = true;
  state.detail = null;
  state.editing = false;
  state.selected = null;
  if (state.renderer) state.renderer.setFocus(state.hover);
  if (state.atlas) state.atlas.setFocus(null);
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
  cancel.addEventListener('click', () => {
    state.editing = false;
    renderPanel(state.detail);
  });
  els.panelActions.append(save, cancel);
  const textarea = document.getElementById('note-editor');
  if (textarea) {
    textarea.focus();
    textarea.addEventListener('input', () => {
      state.draft = textarea.value;
    });
    textarea.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        saveEdits();
      }
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
  if (!state.live) return;
  try {
    const result = await api.saveNote(
      { title: 'Untitled', content: '---\ntags: []\n---\n\n# Untitled\n\n' },
      state.vaultId,
    );
    state.version = result.version;
    await refreshGraph();
    const index = nodeIndex(result.id);
    if (index >= 0) {
      await openNote(index);
      requestEdit();
    }
  } catch (error) {
    ui.toast(error.message || 'Could not create a note');
  }
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
    ui.toast('⌘-click or shift-click at least two stars to collect them');
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

/* ---------- search ---------- */

function openPalette() {
  state.palette.open = true;
  els.palette.hidden = false;
  els.paletteInput.value = '';
  state.palette.query = '';
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
  else state.palette.timer = setTimeout(run, 130);
}

async function search(query) {
  if (!state.graph) return;
  const needle = query.trim();
  if (!needle) {
    state.palette.hits = [...state.graph.nodes]
      .sort((a, b) => b.pagerank - a.pagerank)
      .slice(0, 12)
      .map((node) => ({ id: node.id, title: node.title, folder: node.folder, snippet: node.excerpt }));
  } else if (!state.live) {
    const lower = needle.toLowerCase();
    state.palette.hits = state.graph.nodes
      .filter(
        (node) =>
          node.title.toLowerCase().includes(lower)
          || node.tags.some((tag) => tag.includes(lower))
          || node.folder.toLowerCase().includes(lower),
      )
      .sort((a, b) => b.pagerank - a.pagerank)
      .slice(0, 20)
      .map((node) => ({ id: node.id, title: node.title, folder: node.folder, snippet: node.excerpt }));
  } else {
    try {
      const hits = await api.searchNotes(needle, state.vaultId, 20);
      if (state.palette.query.trim() !== needle) return;
      state.palette.hits = hits;
    } catch {
      state.palette.hits = [];
    }
  }
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
    openHit(state.palette.active);
  }
}

function openHit(hitIndex) {
  const hit = state.palette.hits[hitIndex];
  if (!hit) return;
  closePalette();
  const index = nodeIndex(hit.id);
  if (index >= 0) openNote(index);
}

boot();
