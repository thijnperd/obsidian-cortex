// Thin API client. The same UI runs live (Rust server) or static (graph.json).

function withVault(path, vault) {
  if (!vault) return path;
  return `${path}${path.includes('?') ? '&' : '?'}vault=${encodeURIComponent(vault)}`;
}

async function readJson(response) {
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body && body.error) detail = body.error;
    } catch {
      /* non-JSON error */
    }
    const error = new Error(detail);
    error.status = response.status;
    error.code = undefined;
    throw error;
  }
  return response.json();
}

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-cortex': 'write' };

/** Vault list, or null when this build is a static export. */
export async function listVaults() {
  try {
    const response = await fetch('./api/vaults', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchGraph(vault) {
  const response = await fetch(withVault('./api/graph', vault), {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  const graph = await readJson(response);
  return { graph, version: response.headers.get('x-cortex-version') || null };
}

/** Only for a static export: the Pages demo has no server behind it. */
export async function loadStaticGraph() {
  const response = await fetch('./graph.json', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('No folder is open. Choose one to get started.');
  return response.json();
}

export async function addVault(path) {
  const response = await fetch('./api/vaults', {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ path }),
  });
  return readJson(response);
}

export async function forgetVault(id) {
  const response = await fetch('./api/vaults/forget', {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ id }),
  });
  return readJson(response);
}

export async function fetchNote(id, vault) {
  const response = await fetch(withVault(`./api/note?id=${encodeURIComponent(id)}`, vault));
  return readJson(response);
}

export async function searchNotes(query, vault, limit = 20) {
  const response = await fetch(
    withVault(`./api/search?q=${encodeURIComponent(query)}&limit=${limit}`, vault),
  );
  return readJson(response);
}

export async function saveNote(payload, vault) {
  const response = await fetch(withVault('./api/note', vault), {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(payload),
  });
  return readJson(response);
}

/** Opens today's note, creating Journal/YYYY-MM-DD.md when it is missing. */
export async function openDaily(vault) {
  const response = await fetch(withVault('./api/daily', vault), {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: '{}',
  });
  return readJson(response);
}

export async function synthesize(payload, vault) {
  const response = await fetch(withVault('./api/synthesize', vault), {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(payload),
  });
  return readJson(response);
}

/** Asks the server to show the vault folder, or one note, in the file manager. */
export async function revealInFolder(payload, vault) {
  const response = await fetch(withVault('./api/reveal', vault), {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(payload),
  });
  return readJson(response);
}

/** The MCP switch for one vault, stored beside the vault list on the server. */
export async function setAgentAccess(id, enabled) {
  const response = await fetch('./api/vaults/agents', {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ id, enabled }),
  });
  return readJson(response);
}

/** The platform folder dialog. `path` is null when it was cancelled. */
export async function pickFolder() {
  const response = await fetch('./api/pick-folder', {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: '{}',
  });
  return readJson(response);
}

/** The MCP switch, the snippet, and which client configs already name it. */
export async function mcpStatus() {
  const response = await fetch('./api/mcp/status', { cache: 'no-store' });
  return readJson(response);
}

/** Starts `cortex mcp` and runs a real initialize + tools/list handshake. */
export async function testMcp() {
  const response = await fetch('./api/mcp/test', {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: '{}',
  });
  return readJson(response);
}

/** Version, build, port and the paths a bug report needs. */
export async function about() {
  const response = await fetch('./api/about', { cache: 'no-store' });
  return readJson(response);
}

/** The newest stable release; the server asks GitHub and caches the answer. */
export async function updateInfo() {
  const response = await fetch('./api/update', { cache: 'no-store' });
  return readJson(response);
}

/** Download, verify and run the Windows installer. */
export async function installUpdate() {
  const response = await fetch('./api/update', {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: '{}',
  });
  return readJson(response);
}

/**
 * Long poll: resolves when the vault version differs from `version`, or after
 * the server's 25 s timeout. Rejects with AbortError when the caller cancels.
 */
export async function waitForChange(vault, version, signal) {
  const query = version ? `&since=${encodeURIComponent(version)}` : '';
  const response = await fetch(`${withVault('./api/events', vault)}${query}`, {
    cache: 'no-store',
    signal,
  });
  return readJson(response);
}
