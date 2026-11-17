// The renderer: nebula background, glowing stars, curved light arcs, bloom.
//
// Node positions live in an RGBA32F texture (xyz + birth time) so morphing
// between the universe and the brain only costs one texture upload per frame.

import { createProgram, createTarget, destroyTarget, initGL } from './gl.js';
import { buildAppearValues, buildBrainPositions } from './morph.js';
import { clamp, project, smoothstep } from './math.js';
import {
  BLUR_FS,
  COMPOSITE_FS,
  EDGE_FS,
  EDGE_VS,
  FULLSCREEN_VS,
  HALO_FS,
  HALO_VS,
  NEBULA_FS,
  STAR_FS,
  STAR_VS,
  THRESHOLD_FS,
} from './shaders.js';

const SEGMENTS = 6;
const TEX_WIDTH = 1024;
export const PALETTE = [
  [0.38, 0.86, 1.0],
  [1.0, 0.76, 0.44],
  [0.70, 0.56, 1.0],
  [0.48, 1.0, 0.74],
  [1.0, 0.50, 0.62],
  [1.0, 0.86, 0.32],
  [0.42, 0.66, 1.0],
  [0.92, 0.52, 1.0],
];
const NEBULA_SIZE = 1024;

const locations = new WeakMap();
function loc(gl, program, name) {
  let map = locations.get(program);
  if (!map) {
    map = new Map();
    locations.set(program, map);
  }
  if (!map.has(name)) map.set(name, gl.getUniformLocation(program, name));
  return map.get(name);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = initGL(canvas);
    const gl = this.gl;
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      if (this.onContextLost) this.onContextLost();
    });

    this.programs = {
      stars: createProgram(gl, STAR_VS, STAR_FS, 'stars'),
      edges: createProgram(gl, EDGE_VS, EDGE_FS, 'arcs'),
      halo: createProgram(gl, HALO_VS, HALO_FS, 'galaxy haze'),
      nebula: createProgram(gl, FULLSCREEN_VS, NEBULA_FS, 'nebula'),
      threshold: createProgram(gl, FULLSCREEN_VS, THRESHOLD_FS, 'threshold'),
      blur: createProgram(gl, FULLSCREEN_VS, BLUR_FS, 'bloom blur'),
      composite: createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite'),
    };

    this.emptyVao = gl.createVertexArray();
    this.quadCorners = this.createBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.edgeCorners = this.createBuffer(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]));

    this.count = 0;
    this.nodes = [];
    this.edges = [];
    this.neighbors = [];
    this.texWidth = TEX_WIDTH;
    this.texHeight = 1;
    this.posData = null;
    this.universe = null;
    this.brain = null;
    this.appear = null;
    this.morph = -1;
    this.reveal = 1;
    this.hiddenFolders = new Set();
    this.selection = new Set();
    this.focusIndex = null;
    this.screen = new Float32Array(0);
    this.width = 0;
    this.height = 0;
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.dpr = 1;
    this.time = 0;
    this.targets = null;
    this.bgTarget = null;
    this.backgroundDrawn = false;

    this.resize();
    this.drawBackground();
  }

  createBuffer(data) {
    const gl = this.gl;
    const handle = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, handle);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return handle;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round((rect.width || 1) * dpr));
    const height = Math.max(1, Math.round((rect.height || 1) * dpr));
    if (this.targets && width === this.width && height === this.height) return;
    const gl = this.gl;
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.cssWidth = rect.width || 1;
    this.cssHeight = rect.height || 1;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.targets) {
      destroyTarget(gl, this.targets.scene);
      destroyTarget(gl, this.targets.bright);
      destroyTarget(gl, this.targets.blur);
    }
    const halfWidth = Math.max(1, width >> 1);
    const halfHeight = Math.max(1, height >> 1);
    this.targets = {
      scene: createTarget(gl, width, height),
      bright: createTarget(gl, halfWidth, halfHeight),
      blur: createTarget(gl, halfWidth, halfHeight),
    };
  }

  drawBackground() {
    const gl = this.gl;
    if (!this.bgTarget) this.bgTarget = createTarget(gl, NEBULA_SIZE, NEBULA_SIZE);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgTarget.framebuffer);
    gl.viewport(0, 0, NEBULA_SIZE, NEBULA_SIZE);
    gl.useProgram(this.programs.nebula);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.backgroundDrawn = true;
  }

  setGraph(graph) {
    const gl = this.gl;
    this.graph = graph;
    this.nodes = graph.nodes || [];
    this.edges = graph.edges || [];
    const count = this.nodes.length;
    this.count = count;
    this.texHeight = Math.max(1, Math.ceil(count / TEX_WIDTH));
    this.posData = new Float32Array(this.texWidth * this.texHeight * 4);
    this.universe = new Float32Array(count * 3);
    const brain = buildBrainPositions(this.nodes, graph.meta.folders.map((folder) => folder.name));
    this.brain = brain.positions;
    this.brainAnchors = brain.anchors;
    this.appear = buildAppearValues(this.nodes);
    this.screen = new Float32Array(count * 4);

    const folderColor = new Map(graph.meta.folders.map((folder) => [folder.name, folder.color]));
    const nodeStatic = new Float32Array(count * 5);
    const edgeInstances = this.edges.length * SEGMENTS;
    this.edgeInstances = edgeInstances;
    const edgeData = new Float32Array(edgeInstances * 7);
    const edgeFocus = new Float32Array(edgeInstances);

    for (let index = 0; index < count; index += 1) {
      const node = this.nodes[index];
      const x = node.x;
      const y = node.y;
      const z = node.z;
      this.universe[index * 3] = x;
      this.universe[index * 3 + 1] = y;
      this.universe[index * 3 + 2] = z;
      this.posData[index * 4] = x;
      this.posData[index * 4 + 1] = y;
      this.posData[index * 4 + 2] = z;
      this.posData[index * 4 + 3] = this.appear[index];

      const color = PALETTE[(folderColor.get(node.folder) ?? 0) % PALETTE.length];
      const luminance = 0.82 + 0.22 * (index % 3);
      nodeStatic[index * 5] = color[0] * luminance;
      nodeStatic[index * 5 + 1] = color[1] * luminance;
      nodeStatic[index * 5 + 2] = color[2] * luminance;
      nodeStatic[index * 5 + 3] = node.size;
      nodeStatic[index * 5 + 4] = ((index * 2654435761) % 1000) / 1000;
    }

    let cursor = 0;
    const folderSizes = new Map(graph.meta.folders.map((folder) => [folder.name, folder.count]));
    for (const edge of this.edges) {
      const source = this.nodes[edge.source];
      const target = this.nodes[edge.target];
      const color = PALETTE[(folderColor.get(source.folder) ?? 0) % PALETTE.length];
      const weight = Math.min(1, edge.weight || 1);
      // Diary spokes are many; keep them whisper-quiet until hovered.
      const spoke = (folderSizes.get(source.folder) ?? 0) > 48 || (folderSizes.get(target.folder) ?? 0) > 48;
      const tint = spoke ? 0.45 : 1;
      for (let segment = 0; segment < SEGMENTS; segment += 1) {
        edgeData[cursor * 7] = edge.source;
        edgeData[cursor * 7 + 1] = edge.target;
        edgeData[cursor * 7 + 2] = segment;
        edgeData[cursor * 7 + 3] = weight;
        edgeData[cursor * 7 + 4] = color[0] * 0.75 * tint;
        edgeData[cursor * 7 + 5] = color[1] * 0.75 * tint;
        edgeData[cursor * 7 + 6] = color[2] * 0.8 * tint;
        cursor += 1;
      }
    }

    this.neighbors = Array.from({ length: count }, () => []);
    for (const edge of this.edges) {
      if (edge.source === edge.target) continue;
      this.neighbors[edge.source].push(edge.target);
      this.neighbors[edge.target].push(edge.source);
    }

    if (this.positionsTexture) gl.deleteTexture(this.positionsTexture);
    this.positionsTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.positionsTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.texWidth, this.texHeight, 0, gl.RGBA, gl.FLOAT, this.posData);

    this.nodeStaticBuffer = this.rebuild(this.nodeStaticBuffer, nodeStatic);
    this.edgeBuffer = this.rebuild(this.edgeBuffer, edgeData);
    this.nodeFocus = new Float32Array(count).fill(1);
    this.edgeFocus = edgeFocus.fill(1);
    this.nodeFocusBuffer = this.rebuild(this.nodeFocusBuffer, this.nodeFocus);
    this.edgeFocusBuffer = this.rebuild(this.edgeFocusBuffer, this.edgeFocus);

    this.buildHaze(folderColor);
    this.buildNodeVao();
    this.buildEdgeVao();
    this.morph = -1;
    this.focusIndex = null;
    this.selection = new Set();
    this.setMorph(0);
    this.updateFocus();
  }

  rebuild(existing, data) {
    const gl = this.gl;
    const handle = existing || gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, handle);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return handle;
  }

  buildHaze(folderColor) {
    const sums = new Map();
    for (const node of this.nodes) {
      const entry = sums.get(node.folder) || { x: 0, y: 0, z: 0, n: 0 };
      entry.x += node.x;
      entry.y += node.y;
      entry.z += node.z;
      entry.n += 1;
      sums.set(node.folder, entry);
    }
    const entries = [];
    for (const folder of this.graph.meta.folders) {
      // The journal is a ring, not a cluster; it gets no haze.
      if (!folder || folder.count > 48) continue;
      const sum = sums.get(folder.name);
      if (!sum || !sum.n) continue;
      entries.push({
        name: folder.name,
        center: [sum.x / sum.n, sum.y / sum.n, sum.z / sum.n],
        color: PALETTE[(folder.color ?? 0) % PALETTE.length],
        radius: Math.min(0.5, 0.1 + 0.045 * Math.sqrt(folder.count)),
      });
    }
    this.hazeEntries = entries;
    this.hazeCount = entries.length;
    this.hazeData = new Float32Array(entries.length * 8);
    entries.forEach((entry, index) => {
      const base = index * 8;
      this.hazeData[base] = entry.center[0];
      this.hazeData[base + 1] = entry.center[1];
      this.hazeData[base + 2] = entry.center[2];
      this.hazeData[base + 3] = entry.color[0];
      this.hazeData[base + 4] = entry.color[1];
      this.hazeData[base + 5] = entry.color[2];
      this.hazeData[base + 6] = entry.radius;
      this.hazeData[base + 7] = 1;
    });
    this.hazeBuffer = this.rebuild(this.hazeBuffer, this.hazeData);

    const gl = this.gl;
    if (this.hazeVao) gl.deleteVertexArray(this.hazeVao);
    this.hazeVao = gl.createVertexArray();
    gl.bindVertexArray(this.hazeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadCorners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hazeBuffer);
    const stride = 32;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 28);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
  }

  buildNodeVao() {
    const gl = this.gl;
    if (this.nodeVao) gl.deleteVertexArray(this.nodeVao);
    this.nodeVao = gl.createVertexArray();
    gl.bindVertexArray(this.nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadCorners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeStaticBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(3, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeFocusBuffer);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
  }

  buildEdgeVao() {
    const gl = this.gl;
    if (this.edgeVao) gl.deleteVertexArray(this.edgeVao);
    this.edgeVao = gl.createVertexArray();
    gl.bindVertexArray(this.edgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeCorners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    const stride = 28;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 4);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(4, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeFocusBuffer);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(5, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 3, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(6, 1);
    gl.bindVertexArray(null);
  }

  setMorph(value) {
    if (!this.count) return;
    const target = clamp(value, 0, 1);
    if (Math.abs(target - this.morph) < 0.0004) return;
    this.morph = target;
    const data = this.posData;
    const universe = this.universe;
    const brain = this.brain;
    for (let index = 0; index < this.count; index += 1) {
      const base = index * 3;
      data[index * 4] = universe[base] + (brain[base] - universe[base]) * target;
      data[index * 4 + 1] = universe[base + 1] + (brain[base + 1] - universe[base + 1]) * target;
      data[index * 4 + 2] = universe[base + 2] + (brain[base + 2] - universe[base + 2]) * target;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.positionsTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight, gl.RGBA, gl.FLOAT, data);
  }

  setReveal(value) {
    this.reveal = clamp(value, 0, 1);
  }

  resizeViewport() {
    this.resize();
  }

  setFolderFilter(hidden) {
    this.hiddenFolders = hidden;
    this.updateFocus();
  }

  setFocus(index) {
    this.focusIndex = index;
    this.updateFocus();
  }

  setSelection(indices) {
    this.selection = indices instanceof Set ? indices : new Set(indices || []);
    this.updateFocus();
  }

  updateFocus() {
    const gl = this.gl;
    if (!this.count) return;
    const focus = this.nodeFocus;
    for (let index = 0; index < this.count; index += 1) {
      focus[index] = this.hiddenFolders.has(this.nodes[index].folder) ? 0.03 : 1;
    }
    if (this.focusIndex != null) {
      for (let index = 0; index < this.count; index += 1) {
        focus[index] = Math.min(focus[index], 0.07);
      }
      focus[this.focusIndex] = 2.4;
      for (const other of this.neighbors[this.focusIndex] || []) {
        focus[other] = Math.max(focus[other], 1.3);
      }
    }
    // Collected notes stay legible even while a focus node dims everything else.
    for (const index of this.selection) {
      if (index >= 0 && index < this.count) focus[index] = Math.max(focus[index], 1.9);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeFocusBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, focus);

    const edgeFocus = this.edgeFocus;
    let cursor = 0;
    for (const edge of this.edges) {
      const visible = !this.hiddenFolders.has(this.nodes[edge.source].folder)
        && !this.hiddenFolders.has(this.nodes[edge.target].folder);
      let value = visible ? 1 : 0.02;
      if (this.focusIndex != null) {
        const connected = edge.source === this.focusIndex || edge.target === this.focusIndex;
        value = connected ? (visible ? 2.4 : 0.12) : (visible ? 0.08 : 0.008);
      }
      for (let segment = 0; segment < SEGMENTS; segment += 1) {
        edgeFocus[cursor] = value;
        cursor += 1;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeFocusBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, edgeFocus);

    if (this.hazeEntries && this.hazeData) {
      this.hazeEntries.forEach((entry, index) => {
        this.hazeData[index * 8 + 7] = this.hiddenFolders.has(entry.name) ? 0 : 1;
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, this.hazeBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.hazeData);
    }
  }

  render(camera, time) {
    const gl = this.gl;
    if (!this.graph || !this.targets) return;
    this.time = time;
    const targets = this.targets;

    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.scene.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);

    if (this.hazeCount > 0 && this.morph < 0.98) {
      const program = this.programs.halo;
      gl.useProgram(program);
      gl.uniformMatrix4fv(loc(gl, program, 'uViewProj'), false, camera.viewProjection);
      gl.uniform1f(loc(gl, program, 'uScale'), 1.15);
      gl.uniform1f(loc(gl, program, 'uOpacity'), (1 - this.morph) * 0.9);
      gl.bindVertexArray(this.hazeVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.hazeCount);
    }

    if (this.edgeInstances > 0) {
      const program = this.programs.edges;
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.positionsTexture);
      gl.uniform1i(loc(gl, program, 'uPositions'), 0);
      gl.uniform1i(loc(gl, program, 'uTexWidth'), this.texWidth);
      gl.uniformMatrix4fv(loc(gl, program, 'uViewProj'), false, camera.viewProjection);
      gl.uniform2f(loc(gl, program, 'uViewport'), this.cssWidth, this.cssHeight);
      gl.uniform1f(loc(gl, program, 'uTime'), time);
      gl.uniform1f(loc(gl, program, 'uReveal'), this.reveal);
      gl.uniform1f(loc(gl, program, 'uThickness'), 1.0);
      gl.bindVertexArray(this.edgeVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.edgeInstances);
    }

    if (this.count > 0) {
      const program = this.programs.stars;
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.positionsTexture);
      gl.uniform1i(loc(gl, program, 'uPositions'), 0);
      gl.uniform1i(loc(gl, program, 'uTexWidth'), this.texWidth);
      gl.uniformMatrix4fv(loc(gl, program, 'uViewProj'), false, camera.viewProjection);
      gl.uniform2f(loc(gl, program, 'uViewport'), this.cssWidth, this.cssHeight);
      gl.uniform1f(loc(gl, program, 'uTime'), time);
      gl.uniform1f(loc(gl, program, 'uReveal'), this.reveal);
      gl.uniform1f(loc(gl, program, 'uSizeScale'), 20.0);
      gl.bindVertexArray(this.nodeVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // Bloom: threshold -> horizontal blur -> vertical blur.
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bright.framebuffer);
    gl.viewport(0, 0, targets.bright.width, targets.bright.height);
    gl.useProgram(this.programs.threshold);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.scene.texture);
    gl.uniform1i(loc(gl, this.programs.threshold, 'uScene'), 0);
    this.drawFullscreen();

    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blur.framebuffer);
    gl.useProgram(this.programs.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.bright.texture);
    gl.uniform1i(loc(gl, this.programs.blur, 'uTexture'), 0);
    gl.uniform2f(loc(gl, this.programs.blur, 'uDirection'), 1 / targets.bright.width, 0);
    this.drawFullscreen();

    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bright.framebuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.blur.texture);
    gl.uniform2f(loc(gl, this.programs.blur, 'uDirection'), 0, 1 / targets.bright.height);
    this.drawFullscreen();

    // Composite over the nebula.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const composite = this.programs.composite;
    gl.useProgram(composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTarget.texture);
    gl.uniform1i(loc(gl, composite, 'uBackground'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, targets.scene.texture);
    gl.uniform1i(loc(gl, composite, 'uScene'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, targets.bright.texture);
    gl.uniform1i(loc(gl, composite, 'uBloom'), 2);
    gl.uniform2f(
      loc(gl, composite, 'uParallax'),
      Math.sin(camera.yaw) * 0.6,
      camera.pitch * 0.5,
    );
    gl.uniform2f(loc(gl, composite, 'uResolution'), this.cssWidth, this.cssHeight);
    gl.uniform1f(loc(gl, composite, 'uTime'), time);
    this.drawFullscreen();
    gl.bindVertexArray(null);

    this.projectNodes(camera);
  }

  drawFullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  projectNodes(camera) {
    const width = this.cssWidth;
    const height = this.cssHeight;
    for (let index = 0; index < this.count; index += 1) {
      const point = project(
        camera.viewProjection,
        this.posData[index * 4],
        this.posData[index * 4 + 1],
        this.posData[index * 4 + 2],
        width,
        height,
      );
      if (!point) {
        this.screen[index * 4 + 3] = 0;
        continue;
      }
      this.screen[index * 4] = point.x;
      this.screen[index * 4 + 1] = point.y;
      this.screen[index * 4 + 2] = point.depth;
      this.screen[index * 4 + 3] = smoothstep(this.appear[index], this.appear[index] + 0.05, this.reveal);
    }
  }

  screenOf(index) {
    return {
      x: this.screen[index * 4],
      y: this.screen[index * 4 + 1],
      depth: this.screen[index * 4 + 2],
      alpha: this.screen[index * 4 + 3],
    };
  }

  pick(x, y) {
    let best = -1;
    let bestScore = 26;
    for (let index = 0; index < this.count; index += 1) {
      if (this.screen[index * 4 + 3] < 0.2) continue;
      const dx = x - this.screen[index * 4];
      const dy = y - this.screen[index * 4 + 1];
      const distance = Math.hypot(dx, dy);
      if (distance > 24) continue;
      const score = distance + this.screen[index * 4 + 2] * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }
    return best;
  }

  dispose() {
    const gl = this.gl;
    if (this.targets) {
      destroyTarget(gl, this.targets.scene);
      destroyTarget(gl, this.targets.bright);
      destroyTarget(gl, this.targets.blur);
    }
    if (this.bgTarget) destroyTarget(gl, this.bgTarget);
  }
}
