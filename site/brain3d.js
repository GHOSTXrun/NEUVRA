/* ALPHAMORPH — 3D living brain (ES module). Renderer: vendored three.js r170 (MIT, see /vendor/three-0.170.0/PROVENANCE.md).
   All geometry is procedural and original. Data comes only from app.js (which reads the local API + SSE).
   Motion rules: signal pulses spawn ONLY from delivered decision/fill/observation events; idle = slow labelled breathing. */
import * as THREE from 'three';
import { OrbitControls } from './vendor/three-0.170.0/OrbitControls.js';

const A = window.DBAPP;
const $ = (s) => document.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const AMR = window.AMR; // regions.js: data-driven catalogue
const MAXREG = 6;
const ORDER = ['awareness', 'timing', 'risk']; // mutable: rebuilt from /api/state regions[] (3 core + up to 3 growth regions)
const ridx = (r) => Math.max(0, AMR.ORDER.indexOf(r)); // shader slot = catalogue index (stable when a region is absent)
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const REG = {
  awareness: { n: '01', name: 'Market Awareness', c: V(0, 0.16, 0.66), out: V(0.45, 0.3, 1), tint: 0xB6FF4D,
    fn: 'Selects which new launchpad tokens are worth acting on: token age, trade count, buy pressure.' },
  timing: { n: '02', name: 'Timing / Discipline', c: V(0, 0.42, -0.12), out: V(0.55, 1, -0.1), tint: 0x52D2EE,
    fn: 'Decides when to enter and when to leave: entry delay, take-profit, stop, maximum hold.' },
  risk: { n: '03', name: 'Risk / Conviction', c: V(0, -0.08, -0.7), out: V(0.5, -0.05, -1), tint: 0xFFAE72,
    fn: 'Sets conviction and size: position fraction and the conviction threshold for entry.' },
  provenance: { c: V(0, 0.5, 0.42), out: V(0.6, 1, 0.7) }, flow: { c: V(0, -0.38, 0.12), out: V(0.8, -0.9, 0.3) }, curve: { c: V(0, 0.4, -0.66), out: V(0.6, 0.8, -1) },
};
for (const k of ['provenance', 'flow', 'curve']) Object.assign(REG[k], AMR.CAT[k]); // n, name, tint, fn from the shared catalogue
const RSTAT = {}; // id -> {status, lock, pct, born, unlocked_gen}
const MAX_NODES = 96, MAX_PULSES = 56, TRAIL = 3;
const COL = { active: new THREE.Color(0xB6FF4D), challenger: new THREE.Color(0x9B7BFF), dead: new THREE.Color(0x3A424C),
  fire: new THREE.Color(0xFF5A4E), born: new THREE.Color(0xE9E2FF), hist: new THREE.Color(0xC9D3DC), white: new THREE.Color(0xffffff) };
// region view: each competing strategy gets its own hue; its tracts are tinted to match (coral reserved for fill pulses)
const HUES = [0xB6FF4D, 0x52D2EE, 0xFF7AD9, 0xF4D35E, 0x7CF3B0, 0xA48BFF, 0xFFAE72, 0x8FB8FF].map((h) => new THREE.Color(h));
const TR = { idle: new THREE.Color(0x7F6BD6), halt: new THREE.Color(0x5A6470) };

/* ------------------------------------------------------------------ boot / fallback */
const host = $('#gl');
const forceOff = /[?&]gl=0\b/.test(location.search);
let renderer = null;
try {
  if (forceOff) throw new Error('3D disabled by ?gl=0');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no WebGL context');
} catch (e) {
  renderer = null;
  document.body.classList.add('gl-off');
  const n = $('#glnote'); n.hidden = false;
  n.textContent = '3D view unavailable (' + e.message + '). Showing the 2D fallback view. It shows the same data but is not the 3D experience.';
}

if (renderer) init();

function init() {
  document.body.classList.add('gl-on');
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07090D, 3, 6); // linear depth fog, re-centred on the orbit target every frame
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 0.45; controls.maxDistance = 7; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8;

  /* ---------------------------------------------------------------- noise (seeded Perlin) */
  const perm = new Uint8Array(512);
  { let a = 0x9E3779B9; const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { a = (Math.imul(a ^ (a >>> 15), 0x2C1B3C6D) + 0x6D2B79F5) >>> 0; const j = a % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => { const u = (h & 15) < 8 ? x : y, v = (h & 15) < 4 ? y : ((h & 15) === 12 || (h & 15) === 14) ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  function noise(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A0 = perm[X] + Y, AA = perm[A0] + Z, AB = perm[A0 + 1] + Z, B0 = perm[X + 1] + Y, BA = perm[B0] + Z, BB = perm[B0 + 1] + Z;
    const L = (t, a, b) => a + t * (b - a);
    return L(w, L(v, L(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)), L(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))),
      L(v, L(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)), L(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))));
  }
  const ridged = (x, y, z) => { const r = 1 - Math.abs(noise(x, y, z)); return r * r; }; // rounded gyral crowns, narrow sulci

  /* ---------------------------------------------------------------- cortex: two procedural hemispheres */
  function regionAt(y, z) { // nearest functional territory on the sagittal plane
    let best = 0, bd = 1e9;
    ORDER.forEach((r) => { const c = REG[r].c; const d = (y - c.y) ** 2 * 1.3 + (z - c.z) ** 2; if (d < bd) { bd = d; best = ridx(r); } });
    return best;
  }
  const shellMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    uniforms: { uT: { value: ['awareness', 'timing', 'risk', 'provenance', 'flow', 'curve'].map((k) => new THREE.Color(REG[k].tint)) },
      uDorm: { value: [0, 0, 0, 0, 0, 0] }, uBorn: { value: [0, 0, 0, 0, 0, 0] }, uFireA: { value: [0, 0, 0, 0, 0, 0] }, uTime: { value: 0 },
      uHover: { value: -1 }, uFocus: { value: -1 }, uHist: { value: 0 }, uBreath: { value: 0 },
      uCtr: { value: 3.6 }, uSpan: { value: 1.1 } },
    vertexShader: `attribute float aRegion; attribute float aRidge; uniform float uBreath;
      varying vec3 vN; varying vec3 vV; varying float vR; varying float vRidge; varying float vD; varying vec3 vP;
      void main(){ vec4 w = modelMatrix * vec4(position * (1.0 + uBreath), 1.0);
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vR = aRegion; vRidge = aRidge;
        vD = length(cameraPosition - w.xyz); vP = position;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uT[6]; uniform float uDorm[6]; uniform float uBorn[6]; uniform float uFireA[6]; uniform float uTime; uniform float uHover; uniform float uFocus; uniform float uHist;
      uniform float uCtr; uniform float uSpan;
      varying vec3 vN; varying vec3 vV; varying float vR; varying float vRidge; varying float vD; varying vec3 vP;
      void main(){ vec3 n = normalize(vN); vec3 v = normalize(vV); float fres = pow(1.0 - abs(dot(n, v)), 2.4);
        vec3 tint = vec3(0.0); float fire = 0.0; float dorm = 0.0; float born = 0.0;
        for (int i = 0; i < 6; i++) { float w = 1.0 - clamp(abs(vR - float(i)), 0.0, 1.0); tint += uT[i] * w; fire += uFireA[i] * w; dorm += uDorm[i] * w; born += uBorn[i] * w; }
        // depth: near cortex bright, far cortex sinks into the dark (fog falloff)
        float near = 1.0 - smoothstep(uCtr - uSpan, uCtr + uSpan * 0.9, vD);
        float lam = max(dot(n, normalize(vec3(0.35, 0.85, 0.45))), 0.0);
        float rim = pow(fres, 1.6) * max(dot(n, normalize(vec3(-0.6, 0.35, -0.7))) + 0.35, 0.0); // cool back-rim
        float sulc = vRidge * vRidge * vRidge;                       // 0 in the sulci, 1 on gyral crowns
        float fiss = smoothstep(0.035, 0.2, abs(vP.x)) ;              // the longitudinal fissure stays dark
        fiss = mix(1.0, fiss, smoothstep(-0.25, 0.25, vP.y));
        float sel = uFocus >= 0.0 ? uFocus : uHover; float act = 1.0; float mine = 0.0;
        if (sel >= 0.0) { mine = 1.0 - clamp(abs(vR - sel) * 1.6, 0.0, 1.0); act = mix(0.22, 1.35, mine); }
        vec3 col = tint * (0.015 + 0.85 * sulc) * (0.25 + 0.75 * lam) * fiss;
        col += tint * fres * 0.38 * fiss + vec3(0.62, 0.86, 1.0) * rim * 0.42;
        col = mix(col, vec3(1.0, 0.36, 0.3), clamp(fire, 0.0, 1.0) * 0.18 * fres);
        // dormant (embryonic) territory: ghosted - only a thin outline-like rim, almost no fill; newborn: bright pulsing
        col = mix(col, tint * fres * 0.5, dorm * 0.88);
        col += tint * born * (0.25 + 0.2 * sin(uTime * 3.0)) * (0.4 + fres);
        col *= act * mix(0.05, 1.35, near * near);
        if (uHist > 0.5) col = mix(col, vec3(dot(col, vec3(0.3, 0.4, 0.3))) * vec3(0.85, 0.85, 1.15), 0.7);
        float a = (0.05 + 0.4 * fres + 0.45 * sulc) * clamp(act, 0.3, 1.0) * mix(0.14, 1.0, near) * mix(0.35, 1.0, fiss);
        a = mix(a, a * 0.32 + fres * 0.25, dorm);
        if (uFocus >= 0.0) a *= mix(1.0, 0.42, mine);
        gl_FragColor = vec4(col, a); }`,
  });
  const cortex = new THREE.Group(); scene.add(cortex);
  const hemis = [];
  for (const side of [-1, 1]) {
    const g = new THREE.IcosahedronGeometry(1, 34);
    const pos = g.attributes.position; const n = pos.count;
    const aR = new Float32Array(n), aRi = new Float32Array(n), yz = new Float32Array(n * 2); const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const medial = v.x * side < 0;
      let x = v.x * 0.6 * (medial ? 0.26 : 1), y = v.y * 0.7, z = v.z * 1.08;
      if (y < 0) y *= 0.8 + 0.12 * Math.max(0, -v.z);           // flatter base, temporal pole hangs lower at back
      if (v.z > 0.3) { x *= 1 - 0.18 * (v.z - 0.3); y *= 1 - 0.08 * (v.z - 0.3); } // narrower frontal pole
      x += side * 0.235;
      const r = ridged(x * 4.0 + side * 7, y * 4.0, z * 3.7), r2 = ridged(x * 8 + 3, y * 8, z * 8);
      const amp = medial ? 0.3 : 1;
      const d = (0.12 * r + 0.014 * r2 - 0.07) * amp;
      pos.setXYZ(i, x + v.x * d, y + v.y * d, z + v.z * d);
      aR[i] = regionAt(y, z); yz[2 * i] = y; yz[2 * i + 1] = z; aRi[i] = Math.min(1, r * 0.9 + r2 * 0.2);
    }
    g.setAttribute('aRegion', new THREE.BufferAttribute(aR, 1)); g.userData.yz = yz;
    g.setAttribute('aRidge', new THREE.BufferAttribute(aRi, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, shellMat); m.renderOrder = 3; cortex.add(m); hemis.push(m);
  }
  function reassignRegions() { // territory map follows the region list; cerebellum stays with risk
    for (const h of hemis) { const yz = h.geometry.userData.yz; const a = h.geometry.attributes.aRegion; if (!yz) { a.array.fill(ridx('risk')); a.needsUpdate = true; continue; }
      for (let i = 0; i < a.count; i++) a.array[i] = regionAt(yz[2 * i], yz[2 * i + 1]); a.needsUpdate = true; }
  }
  // cerebellum: a finely striated lobe under the occipital pole (part of the Risk / Conviction territory)
  for (const side of [-1, 1]) {
    const g = new THREE.IcosahedronGeometry(1, 20); const pos = g.attributes.position; const n = pos.count;
    const aR = new Float32Array(n).fill(2), aRi = new Float32Array(n); const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const s = 0.5 + 0.5 * Math.sin(v.y * 34 + v.z * 6);           // folia: parallel horizontal ridges
      const d = 0.018 * s;
      const x = side * 0.2 + v.x * 0.24 * (v.x * side < 0 ? 0.5 : 1), y = -0.4 + v.y * 0.2, z = -0.66 + v.z * 0.3;
      pos.setXYZ(i, x + v.x * d, y + v.y * d, z + v.z * d); aRi[i] = s * 0.85;
    }
    g.setAttribute('aRegion', new THREE.BufferAttribute(aR, 1)); g.setAttribute('aRidge', new THREE.BufferAttribute(aRi, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, shellMat); m.renderOrder = 3; cortex.add(m); hemis.push(m);
  }
  // brainstem: the afferent inlet through which observations enter
  const stemCurve = new THREE.CatmullRomCurve3([V(0, -1.05, -0.5), V(0, -0.72, -0.36), V(0, -0.42, -0.2), V(0, -0.12, -0.04)]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 24, 0.075, 10, false),
    new THREE.MeshBasicMaterial({ color: 0x1E2A16, transparent: true, opacity: 0.16, depthWrite: false }));
  scene.add(stem);
  const INLET = V(0, -1.05, -0.5);
  // floor ring: the specimen sits above a quiet containment plate
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.262, 96), new THREE.MeshBasicMaterial({ color: 0xB6FF4D, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -1.08; scene.add(ring);

  /* ---------------------------------------------------------------- glow points material (halos + pulses) */
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 300 }, uCtr: { value: 3.6 } },
    vertexShader: `attribute float aSize; attribute vec3 aColor; varying vec3 vC; uniform float uScale; uniform float uCtr;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float near = 1.0 - smoothstep(uCtr - 1.0, uCtr + 1.3, -mv.z);
        vC = aColor * mix(0.22, 1.15, near); gl_PointSize = aSize * uScale / -mv.z * mix(0.7, 1.1, near); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.0, r); a = a * a; gl_FragColor = vec4(vC * a, a); }`,
  });
  function makePoints(n) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(V(0, 0, 0), 3);
    const p = new THREE.Points(g, glowMat); p.frustumCulled = false; p.renderOrder = 5; scene.add(p); return p;
  }

  /* ---------------------------------------------------------------- strategy nodes */
  const nodeMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ toneMapped: false }), MAX_NODES);
  nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); nodeMesh.count = 0; nodeMesh.renderOrder = 4; nodeMesh.frustumCulled = false;
  nodeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 3), 3);
  scene.add(nodeMesh);
  const halos = makePoints(MAX_NODES);
  const pulses = makePoints(MAX_PULSES * TRAIL);

  const T = { // runtime state
    state: null, gens: [], strat: new Map(), posCache: new Map(), nodes: [], nodeIdx: new Map(), comps: new Map(),
    level: 0, region: null, sel: null, hover: null, hoverNode: -1, hoverComp: null,
    fire: new Map(), born: new Map(), dying: new Map(), regFire: [0, 0, 0, 0, 0, 0],
    pulses: [], free: [...Array(MAX_PULSES).keys()], obsCurves: new Map(),
    hist: null, histDropped: 0, tween: null, needPick: false, px: 0, py: 0, down: null,
  };

  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // Position is a pure function of the strategy id (plus avoidance of already-placed neighbours), so a strategy keeps its place.
  function placeFor(s, others) {
    if (T.posCache.has(s.id)) return T.posCache.get(s.id);
    const R = rngOf(hashStr(s.id)); const c = (REG[s.region] || REG.awareness).c; let best = null, bestD = -1;
    for (let k = 0; k < 14; k++) {
      const side = R() < 0.5 ? -1 : 1;
      const p = V(side * (0.16 + R() * 0.34), c.y + (R() - 0.5) * 0.4, c.z + (R() - 0.5) * 0.46);
      const q = Math.sqrt((p.x / 0.78) ** 2 + (p.y / 0.66) ** 2 + (p.z / 1.04) ** 2); if (q > 0.8) p.multiplyScalar(0.8 / q);
      let md = 9; for (const o of others) md = Math.min(md, o.distanceTo(p));
      if (md > 0.17) { best = p; break; }
      if (md > bestD) { bestD = md; best = p; }
    }
    T.posCache.set(s.id, best); return best;
  }
  function elimGenMap() { const m = new Map(); for (const g of T.gens) for (const id of g.eliminated || []) m.set(id, g.n); return m; }
  const regionOf = (id) => (T.strat.get(id)?.region) || (id.startsWith('aw') ? 'awareness' : id.startsWith('ti') ? 'timing' : 'risk');

  /* which strategies are on the brain right now */
  function visibleSet() {
    const out = [];
    if (T.hist) {
      const g = T.hist.g;
      for (const id of g.survivors || []) out.push({ id, region: regionOf(id), hist: (g.born || []).includes(id) ? 'born' : 'alive' });
      for (const id of g.eliminated || []) out.push({ id, region: regionOf(id), hist: 'eliminated' });
      return out;
    }
    const eg = elimGenMap(); const cur = T.state?.generation || 0;
    const ghosts = [];
    for (const s of T.strat.values()) {
      if (s.status === 'eliminated' && !T.dying.has(s.id)) {
        if (T.level >= 1 && s.region === T.region) { ghosts.push(s); continue; } // region view: lineage ghosts
        const g = eg.get(s.id); if (g == null || cur - g > 1) continue;
      }
      out.push({ id: s.id, region: s.region });
    }
    ghosts.sort((a, b) => (b.generation || 0) - (a.generation || 0));
    for (const s of ghosts.slice(0, 18)) out.push({ id: s.id, region: s.region });
    return out;
  }

  function rebuild() {
    const vis = visibleSet().slice(0, MAX_NODES);
    vis.sort((a, b) => a.id.localeCompare(b.id));
    const placed = {}; for (const r of ORDER) placed[r] = [];
    for (const v of vis) if (T.posCache.has(v.id)) placed[v.region].push(T.posCache.get(v.id));
    T.nodes = vis.map((v) => { const s = T.strat.get(v.id) || { id: v.id, region: v.region, status: 'unknown', stats: {} };
      const p = T.posCache.get(v.id) || placeFor(s, placed[v.region]); if (!placed[v.region].includes(p)) placed[v.region].push(p);
      return { id: v.id, s, region: v.region, p, hist: v.hist }; });
    T.nodeIdx = new Map(T.nodes.map((n, i) => [n.id, i]));
    nodeMesh.count = T.nodes.length;
    T.hue = new Map();
    if (T.region && !T.hist) [...T.strat.values()].filter((s) => s.region === T.region && s.status !== 'eliminated')
      .sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0)).forEach((s, i) => T.hue.set(s.id, HUES[i % HUES.length]));
    buildComps(); buildLineage();
    paintNodes(performance.now());
    if (T.level >= 1) renderRegionPanel();
  }

  /* ---------------------------------------------------------------- lineage: parent -> child inside the focused region */
  const linMat = new THREE.LineDashedMaterial({ color: 0xE9E2FF, dashSize: 0.022, gapSize: 0.016, transparent: true, opacity: 0.55, depthWrite: false });
  const lineage = new THREE.LineSegments(new THREE.BufferGeometry(), linMat); lineage.renderOrder = 4; lineage.frustumCulled = false; scene.add(lineage);
  function buildLineage() {
    const pts = [];
    if (T.level >= 1 && T.region) for (const n of T.nodes) {
      if (n.region !== T.region) continue; const pid = n.s.parent_id; const pi = pid != null ? T.nodeIdx.get(pid) : undefined;
      if (pi === undefined) continue; pts.push(T.nodes[pi].p, n.p);
    }
    lineage.geometry.dispose(); lineage.geometry = new THREE.BufferGeometry().setFromPoints(pts); lineage.computeLineDistances();
    lineage.visible = pts.length > 0; T.linCount = pts.length / 2;
  }

  /* ---------------------------------------------------------------- compositions = nerve tracts */
  const compGroup = new THREE.Group(); scene.add(compGroup);
  function buildComps() {
    const want = new Map();
    if (!T.hist && T.state) {
      const init = T.state.risk?.limits?.initial_equity_micro || 1e9;
      const comps = T.state.compositions || [];
      const mx = Math.max(1, ...comps.map((c) => Math.abs((c.equity_micro ?? init) - init)));
      for (const c of comps) {
        const ids = [c.strategies?.awareness, c.strategies?.timing, c.strategies?.risk];
        const ps = ids.map((i) => T.nodes[T.nodeIdx.get(i)]?.p); if (ps.some((p) => !p)) continue;
        const pnl = (c.equity_micro ?? init) - init;
        const rad = +(0.0035 + 0.011 * Math.abs(pnl) / mx).toFixed(4); // thickness = magnitude of real paper PnL
        want.set(c.id, { c, ps, rad, key: ps.map((p) => p.toArray().join(',')).join('|') + '|' + rad, pnl });
      }
    }
    for (const [id, o] of T.comps) if (!want.has(id)) { compGroup.remove(o.mesh, o.hit); o.mesh.geometry.dispose(); o.hit.geometry.dispose(); o.mesh.material.dispose(); T.comps.delete(id); }
    for (const [id, w] of want) {
      let o = T.comps.get(id);
      if (!o || o.key !== w.key) {
        if (o) { compGroup.remove(o.mesh, o.hit); o.mesh.geometry.dispose(); o.hit.geometry.dispose(); }
        const [a, t, r] = w.ps; const R = rngOf(hashStr(id));
        // route through the white matter: each hop dips toward its own deep waypoint (no shared hub), bowing sideways per composition
        const deep = (p, q) => { const m = p.clone().add(q).multiplyScalar(0.5).multiplyScalar(0.82); // bow inward through the volume, no shared hub
          return m.add(V((R() - 0.5) * 0.5, (R() - 0.5) * 0.3, (R() - 0.5) * 0.26)); };
        const curve = new THREE.CatmullRomCurve3([a, deep(a, t), t, deep(t, r), r], false, 'catmullrom', 0.5);
        curve.arcLengthDivisions = 120; curve.getLengths();
        const mat = o ? o.mesh.material : new THREE.MeshBasicMaterial({ color: TR.idle, transparent: true, opacity: 0.1, depthWrite: false, toneMapped: false });
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, w.rad, 6, false), mat); mesh.renderOrder = 2;
        const hit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(48)), new THREE.LineBasicMaterial({ visible: false }));
        mesh.userData.comp = id; hit.userData.comp = id; compGroup.add(mesh, hit);
        o = { mesh, hit, curve, key: w.key, hot: 0 }; T.comps.set(id, o);
      }
      o.c = w.c; o.pnl = w.pnl;
    }
    paintComps(performance.now());
  }
  function paintComps(now) {
    const focusR = T.level >= 1 ? T.region : T.hover;
    const hn = T.hoverNode >= 0 ? T.nodes[T.hoverNode]?.id : null;
    const bundle = T.sel?.kind === 's' ? T.sel.id : hn;                  // one strategy's bundle highlighted, the rest dimmed
    for (const [id, o] of T.comps) {
      const c = o.c; const ids = Object.values(c.strategies || {});
      let op = c.open_positions > 0 ? 0.26 : 0.075;                      // idle tracts heavily dimmed; brighter = open paper position
      if (focusR) op = c.strategies?.[focusR] && T.nodeIdx.has(c.strategies[focusR]) && regionOf(c.strategies[focusR]) === focusR ? op * 2.4 : 0.03;
      if (bundle) op = ids.includes(bundle) ? 0.9 : 0.025;
      if (T.sel?.kind === 'c') op = id === T.sel.id ? 1 : 0.025;
      if (T.hoverComp === id) op = 1;
      const hot = (T.fire.get('C:' + id) || 0) > now;
      const hue = T.region && T.hue?.get(c.strategies?.[T.region]);
      _c.copy(c.halted ? TR.halt : hue || TR.idle);
      if (T.sel?.kind === 'c' && T.sel.id === id) _c.lerp(COL.white, 0.5);
      if (hot) { _c.lerp(COL.white, 0.35); if (!T.sel && !T.hoverComp && !bundle) op = Math.min(1, op + 0.22); }
      o.mesh.material.color.copy(_c);
      o.mesh.material.opacity = op;
    }
  }

  /* ---------------------------------------------------------------- node painting */
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();
  function paintNodes(now) {
    const hp = halos.geometry.attributes; const maxT = Math.max(1, ...T.nodes.map((n) => n.s.stats?.trades || 0));
    const focusR = T.level >= 1 ? T.region : T.hover;
    T.nodes.forEach((n, i) => {
      const s = n.s; let col, sc, hs;
      if (T.hist) {
        col = n.hist === 'eliminated' ? COL.fire : n.hist === 'born' ? COL.challenger : COL.hist;
        sc = 0.028; hs = n.hist === 'eliminated' ? 0.05 : 0.07;           // uniform: no historical metrics to size by
      } else {
        const dead = s.status === 'eliminated';
        const hue = T.hue?.get(n.id);
        col = dead ? COL.dead : hue || (s.status === 'challenger' ? COL.challenger : COL.active);
        sc = dead ? 0.014 : 0.018 + 0.03 * Math.sqrt((s.stats?.trades || 0) / maxT);   // legend: size = sqrt(paper trades)
        hs = dead ? 0.012 : sc * 3.4;
        const f = T.fire.get(n.id) || 0; if (f > now) { _c.copy(col).lerp(COL.white, 0.45); col = _c; hs = 0.17; } // firing = brighter own colour; coral is reserved for pulses
        const b = T.born.get(n.id) || 0; if (b > now) { _c.copy(COL.born); col = _c; hs = 0.16 + 0.12 * Math.sin((b - now) / 160); }
        const d = T.dying.get(n.id) || 0; if (d > now) { col = COL.fire; sc *= (d - now) / 1700 + 0.4; }
      }
      let dim = 1; if (focusR && n.region !== focusR) dim = 0.28;
      if (T.sel?.kind === 's') dim = n.id === T.sel.id ? 1.4 : n.region === T.region ? 0.7 : 0.25;
      if (T.hoverNode === i) { dim = 1.5; hs *= 1.6; }
      _c.copy(col).multiplyScalar(Math.min(dim, 1.2)); nodeMesh.instanceColor.setXYZ(i, _c.r, _c.g, _c.b);
      _s.setScalar(sc * (T.sel?.id === n.id ? 1.5 : 1)); _m.compose(n.p, _q, _s); nodeMesh.setMatrixAt(i, _m);
      hp.position.setXYZ(i, n.p.x, n.p.y, n.p.z); hp.aColor.setXYZ(i, col.r * 0.6 * dim, col.g * 0.6 * dim, col.b * 0.6 * dim); hp.aSize.setX(i, hs * Math.min(dim, 1.3));
    });
    for (let i = T.nodes.length; i < MAX_NODES; i++) hp.aSize.setX(i, 0);
    nodeMesh.instanceMatrix.needsUpdate = true; nodeMesh.instanceColor.needsUpdate = true;
    hp.position.needsUpdate = hp.aColor.needsUpdate = hp.aSize.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- pulses: only from delivered events */
  const _p = new THREE.Vector3();
  function spawn(curve, color, dur) {
    if (!T.free.length) return; // cap reached: the event is still counted in the HUD, only the visual is dropped
    const slot = T.free.pop(); T.pulses.push({ slot, curve, color, t0: performance.now(), dur });
  }
  function obsCurve(n) {
    let c = T.obsCurves.get(n.id);
    if (!c) { c = new THREE.CatmullRomCurve3([INLET, V(0, -0.6, -0.33), V(0, -0.15, -0.05), n.p.clone().multiplyScalar(0.5), n.p]); c.arcLengthDivisions = 80; c.getLengths(); T.obsCurves.set(n.id, c); if (T.obsCurves.size > 200) T.obsCurves.clear(); }
    return c;
  }
  const PC = { obsLive: new THREE.Color(0xB6FF4D), obsRec: new THREE.Color(0xD9E6B8), synth: new THREE.Color(0x8A949E), paper: new THREE.Color(0xFF5A4E), dec: new THREE.Color(0xFFC2A8) };
  function onEvent(ev) {
    const typ = ev.type; const now = performance.now();
    if (T.hist && (typ === 'observation' || typ === 'decision' || typ === 'fill')) { T.histDropped++; updHistBanner(); return; } // historical mode freezes live rendering
    if (typ === 'observation') {
      const aw = T.nodes.filter((n) => n.region === 'awareness' && n.s.status !== 'eliminated'); if (!aw.length) return;
      const n = aw[hashStr(String(ev.payload?.token || ev.id)) % aw.length];
      T.fire.set(n.id, now + 450); T.regFire[0] = 1;
      if (!REDUCED.matches) spawn(obsCurve(n), ev.label === 'SYNTHETIC_TEST' ? PC.synth : ev.payload?.recorded ? PC.obsRec : PC.obsLive, 800);
    } else if ((typ === 'decision' || typ === 'fill') && ev.composition) {
      const o = T.comps.get(ev.composition); if (!o) return;
      T.fire.set('C:' + ev.composition, now + 700);
      for (const id of Object.values(o.c.strategies || {})) { T.fire.set(id, now + 600); T.regFire[ridx(regionOf(id))] = 1; }
      if (!REDUCED.matches && now - (o.lastPulse || 0) > 150) { o.lastPulse = now; spawn(o.curve, typ === 'fill' ? PC.paper : PC.dec, 1150); } // legend: coral = paper fill, peach = decision (provenance is shown once, globally)
    } else if (typ === 'birth' && ev.strategy) T.born.set(ev.strategy, now + 5000);
    else if (typ === 'elimination' && ev.strategy) T.dying.set(ev.strategy, now + 1700);
  }
  function stepPulses(now) {
    const a = pulses.geometry.attributes;
    for (let i = T.pulses.length - 1; i >= 0; i--) {
      const p = T.pulses[i]; const t = (now - p.t0) / p.dur;
      if (t >= 1) { for (let k = 0; k < TRAIL; k++) a.aSize.setX(p.slot * TRAIL + k, 0); T.free.push(p.slot); T.pulses.splice(i, 1); continue; }
      for (let k = 0; k < TRAIL; k++) {
        const tk = Math.max(0, t - k * 0.035); p.curve.getPointAt(tk, _p); const j = p.slot * TRAIL + k; const f = 1 - k * 0.32;
        a.position.setXYZ(j, _p.x, _p.y, _p.z); a.aColor.setXYZ(j, p.color.r * f, p.color.g * f, p.color.b * f); a.aSize.setX(j, (0.11 - k * 0.025));
      }
    }
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- camera */
  const HOME = { pos: V(2.35, 0.95, 2.55), tgt: V(0, 0.0, 0), dir: V(2.7, 0.85, 1.55).normalize() };
  function fitScale() { const asp = camera.aspect; return asp < 0.75 ? 1.75 : asp < 1.1 ? 1.3 : 1; }
  // fit the whole cortex to the viewport for this aspect: ~80% of height on wide screens, full width on narrow ones
  const fitPts = []; for (const h of hemis) { const p = h.geometry.attributes.position; for (let i = 0; i < p.count; i += 23) fitPts.push(V(0, 0, 0).fromBufferAttribute(p, i)); }
  function fitHome() {
    const cam = camera.clone(); cam.clearViewOffset(); cam.updateProjectionMatrix(); const fy = 0.8, fx = camera.aspect < 0.8 ? 0.94 : 0.9; let lo = 1, hi = 14;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2; cam.position.copy(HOME.tgt).addScaledVector(HOME.dir, mid); cam.lookAt(HOME.tgt); cam.updateMatrixWorld(true);
      let ex = 0; for (const p of fitPts) { _p.copy(p).project(cam); ex = Math.max(ex, Math.abs(_p.x) / fx, Math.abs(_p.y) / fy); }
      if (ex > 1) lo = mid; else hi = mid;
    }
    HOME.dist = hi; HOME.pos.copy(HOME.tgt).addScaledVector(HOME.dir, hi);
    controls.maxDistance = hi * 1.8;
  }
  function regionView(r) { const R = REG[r]; return { tgt: R.c.clone(), pos: R.c.clone().add(R.out.clone().normalize().multiplyScalar(1.05 * Math.min(1.5, fitScale()))) }; }
  // the region panel covers the left of the stage: shift the projection so the scene centres in the free area to its right
  const PAN = { cur: 0 };
  function panelPx() { const W = host.clientWidth || 1000; return (T.level >= 1 && W > 720) ? Math.min(360, W * 0.34) + 12 : 0; }
  function stepPan() {
    const tgt = panelPx(); if (Math.abs(PAN.cur - tgt) < 0.5 && PAN.cur === tgt) return;
    PAN.cur += (tgt - PAN.cur) * 0.12; if (Math.abs(PAN.cur - tgt) < 0.5) PAN.cur = tgt;
    const W = host.clientWidth, H = host.clientHeight;
    if (PAN.cur) camera.setViewOffset(W, H, -PAN.cur / 2, 0, W, H); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function fly(to, ms = 950) {
    const toPos = to.pos.clone(), toTgt = to.tgt.clone();
    if (REDUCED.matches) { camera.position.copy(toPos); controls.target.copy(toTgt); controls.update(); T.tween = null; return; }
    T.tween = { fp: camera.position.clone(), ft: controls.target.clone(), tp: toPos, tt: toTgt, t0: performance.now(), ms };
    controls.enabled = false;
  }
  function stepTween(now) {
    const w = T.tween; if (!w) return; let k = Math.min(1, (now - w.t0) / w.ms); k = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    camera.position.lerpVectors(w.fp, w.tp, k); controls.target.lerpVectors(w.ft, w.tt, k);
    if (k >= 1) { T.tween = null; controls.enabled = true; }
  }

  /* ---------------------------------------------------------------- navigation */
  function setLevel(level, region) {
    T.level = level; T.region = level >= 1 ? region : null;
    shellMat.uniforms.uFocus.value = T.region ? ridx(T.region) : -1;
    document.body.dataset.level = String(level);
    const rp = $('#regionpanel'); rp.hidden = level < 1; if (level >= 1) renderRegionPanel();
    controls.minDistance = level >= 1 ? 0.3 : 0.9;
    rebuild(); renderCrumbs(); paintComps(performance.now());
  }
  function enterRegion(r) {
    if (!REG[r] || !ORDER.includes(r)) return;
    if (RSTAT[r]?.status === 'dormant') { A.announce(`${REG[r].name} is dormant: ${RSTAT[r].lock}.`); return; }
    const same = T.level >= 1 && T.region === r;
    if (T.level === 2) closeDetail(false);
    setLevel(1, r); if (!same) fly(regionView(r));
    A.announce(`Entered ${REG[r].name}.`);
  }
  function goHome() {
    closeDetail(false); setLevel(0, null); T.orbited = false; fly(HOME, 1000); setHover(null); A.announce('Whole brain view.');
  }
  function back() {
    if (T.level === 2) { closeDetail(true); return; }
    if (T.level === 1) goHome();
  }
  function closeDetail(announce) {
    T.sel = null; A.closeInspector(); if (T.level === 2) T.level = 1; document.body.dataset.level = String(T.level);
    renderCrumbs(); paintNodes(performance.now()); paintComps(performance.now()); if (T.level >= 1) renderRegionPanel();
    if (announce) A.announce('Back to region.');
  }
  // called by app.js select(): a strategy or composition opened in the inspector
  function selected(kind, id) {
    T.sel = { kind, id };
    let r = kind === 's' ? regionOf(id) : (T.region || 'awareness');
    if (kind === 's' && T.region !== r) { setLevel(1, r); fly(regionView(r)); }
    if (T.level < 1) { setLevel(1, r); fly(regionView(r)); }
    T.level = 2; document.body.dataset.level = '2';
    renderCrumbs(); paintNodes(performance.now()); paintComps(performance.now()); renderRegionPanel();
  }
  function renderCrumbs() {
    const c = $('#crumbs'); const parts = [`<button type="button" data-nav="home" ${T.level === 0 ? 'aria-current="page"' : ''}>Whole brain</button>`];
    if (T.region) parts.push(`<button type="button" data-nav="region" data-region="${T.region}" ${T.level === 1 ? 'aria-current="page"' : ''}>${REG[T.region].name}</button>`);
    if (T.level === 2 && T.sel) parts.push(`<span aria-current="page">${A.esc(T.sel.kind === 'c' ? 'composition ' + A.shortComp(T.sel.id) : T.sel.id)}</span>`);
    c.innerHTML = parts.join('<i aria-hidden="true">›</i>');
    $('#nav-back').disabled = T.level === 0;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    if (b.dataset.nav === 'home') goHome(); else if (b.dataset.nav === 'region') { if (T.level === 2) closeDetail(true); else enterRegion(b.dataset.region); }
    else if (b.dataset.nav === 'back') back();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && T.level > 0 && !e.defaultPrevented) { back(); }
  });

  /* ---------------------------------------------------------------- region tags (DOM, keyboard + touch equivalents) */
  const tagWrap = $('#regiontags');
  let tags = {};
  function buildTags() {
    tagWrap.replaceChildren(); tags = {};
    for (const r of ORDER) {
      const st = RSTAT[r] || { status: 'active' };
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rtag' + (st.status === 'dormant' ? ' dormant' : '') + (st.born ? ' born' : ''); b.dataset.region = r;
      if (st.status === 'dormant') b.setAttribute('aria-disabled', 'true');
      const dormHtml = st.status === 'dormant' ? `<span class="rt-lock">🔒 ${A.esc(st.lock)}</span><span class="rt-bar" aria-hidden="true"><i style="width:${st.pct == null ? 0 : Math.round(st.pct * 100)}%"></i></span>` : '';
      b.innerHTML = `<span class="rt-l"><span class="rt-n">${REG[r].n}</span> <span class="rt-name">${REG[r].name}</span></span>${dormHtml}<span class="rt-more"></span>`;
      b.addEventListener('mouseenter', () => T.level === 0 && setHover(r));
      b.addEventListener('mouseleave', () => T.level === 0 && setHover(null));
      b.addEventListener('focus', () => T.level === 0 && setHover(r));
      b.addEventListener('blur', () => T.level === 0 && setHover(null));
      b.addEventListener('click', () => enterRegion(r));
      tagWrap.appendChild(b); tags[r] = b;
    }
  }
  buildTags();
  let regSig = 'awareness:active|timing:active|risk:active';
  function syncRegions(st) { // region list + dormant/born status follow /api/state; absent fields => the three core regions
    const list = AMR.info(st).filter((r) => REG[r.id]).slice(0, MAXREG);
    const ids = list.map((r) => r.id); const full = list.map((r) => r.id + ':' + r.status + (r.born ? '!' : '') + Math.round((r.pct || 0) * 100)).join('|');
    for (const k of Object.keys(RSTAT)) delete RSTAT[k];
    for (const r of list) RSTAT[r.id] = r;
    const u = shellMat.uniforms; ['awareness', 'timing', 'risk', 'provenance', 'flow', 'curve'].forEach((k, i) => { u.uDorm.value[i] = RSTAT[k]?.status === 'dormant' ? 1 : 0; u.uBorn.value[i] = RSTAT[k]?.born ? 1 : 0; });
    if (ids.join() !== ORDER.join()) { ORDER.length = 0; ORDER.push(...ids); reassignRegions(); for (const k of Object.keys(_regPts)) delete _regPts[k]; for (const k of Object.keys(_anch)) delete _anch[k]; }
    if (full !== regSig) { regSig = full; if (T.hover) setHover(null); buildTags(); if (T.region && !ORDER.includes(T.region)) goHome(); }
  }
  function regionCounts(r) {
    let alive = 0, chal = 0, dead = 0; for (const s of T.strat.values()) if (s.region === r) s.status === 'eliminated' ? dead++ : s.status === 'challenger' ? chal++ : alive++;
    const comps = (T.state?.compositions || []).length; return { alive, chal, dead, comps };
  }
  function setHover(r) {
    if (T.hover === r) return; T.hover = r; shellMat.uniforms.uHover.value = r ? ridx(r) : -1;
    for (const k of ORDER) {
      const on = k === r; tags[k].classList.toggle('on', on);
      const more = tags[k].querySelector('.rt-more');
      if (on) { const n = regionCounts(k); more.textContent = `${REG[k].fn} ${n.alive} active${n.chal ? ' + ' + n.chal + ' challenger' : ''} · ${n.dead} eliminated · every active composition routes through here. ${matchMedia('(hover:none)').matches ? 'Tap again to enter.' : 'Click to enter.'}`; }
      else more.textContent = '';
    }
    paintNodes(performance.now()); paintComps(performance.now());
  }

  /* ---------------------------------------------------------------- picking */
  const ray = new THREE.Raycaster(); ray.params.Line = { threshold: 0.025 }; const ndc = new THREE.Vector2();
  const cv = renderer.domElement;
  cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); T.px = e.clientX - r.left; T.py = e.clientY - r.top; T.needPick = e.pointerType === 'mouse'; });
  cv.addEventListener('pointerleave', () => { T.needPick = false; if (T.level === 0) setHover(null); T.hoverNode = -1; T.hoverComp = null; cv.style.cursor = ''; });
  cv.addEventListener('pointerdown', (e) => { T.down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', (e) => {
    const d = T.down; T.down = null; if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7 || performance.now() - d.t > 600) return; // it was an orbit drag
    const r = cv.getBoundingClientRect(); const hit = pick(e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    if (hit.node != null) { const n = T.nodes[hit.node]; A.select('s', n.id); return; }
    if (hit.comp) { A.select('c', hit.comp); return; }
    if (hit.region) {
      if (e.pointerType !== 'mouse' && T.level === 0 && T.hover !== hit.region) { setHover(hit.region); return; } // touch: first tap previews
      if (T.level === 0 || T.region !== hit.region) enterRegion(hit.region);
    }
  });
  function pick(x, y) {
    ndc.set((x / cv.clientWidth) * 2 - 1, -(y / cv.clientHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    // nodes first (screen-space tolerance so small spheres are tappable)
    let bi = -1, bd = 1e9; const tol = matchMedia('(pointer:coarse)').matches ? 22 : 13;
    T.nodes.forEach((n, i) => { _p.copy(n.p).project(camera); if (_p.z > 1) return; const sx = (_p.x + 1) / 2 * cv.clientWidth, sy = (1 - _p.y) / 2 * cv.clientHeight;
      const dd = Math.hypot(sx - x, sy - y); if (dd < tol && dd < bd) { bd = dd; bi = i; } });
    if (bi >= 0 && (T.level >= 1 || T.hist)) return { node: bi };
    if (T.level >= 1) { const h = ray.intersectObjects([...T.comps.values()].map((o) => o.hit), false)[0]; if (h) return { comp: h.object.userData.comp }; }
    const s = ray.intersectObjects(hemis, false)[0];
    if (s) { const reg = s.object.geometry.attributes.aRegion.getX(s.face.a); const rid = AMR.ORDER[Math.round(reg)]; return { region: ORDER.includes(rid) ? rid : null }; }
    if (bi >= 0) return { node: bi };
    return null;
  }
  function hoverPick() {
    const hit = pick(T.px, T.py);
    const hn = hit?.node ?? -1, hc = hit?.comp ?? null;
    if (hn !== T.hoverNode || hc !== T.hoverComp) { T.hoverNode = hn; T.hoverComp = hc; paintNodes(performance.now()); paintComps(performance.now()); }
    if (T.level === 0) setHover(hit?.region || (hn >= 0 ? T.nodes[hn].region : null));
    cv.style.cursor = hit ? 'pointer' : 'grab';
    const tip = $('#tip');
    if (hn >= 0) { const n = T.nodes[hn]; tip.hidden = false; tip.textContent = `${n.id} · ${n.hist ? 'gen ' + T.hist.g.n + ': ' + n.hist : n.s.status}`; tip.style.transform = `translate(${T.px + 14}px,${T.py + 10}px)`; }
    else if (hc) { tip.hidden = false; tip.textContent = 'composition ' + A.shortComp(hc); tip.style.transform = `translate(${T.px + 14}px,${T.py + 10}px)`; }
    else tip.hidden = true;
  }

  /* ---------------------------------------------------------------- 3D-anchored DOM labels */
  const _regPts = {}; const _a = new THREE.Vector3(), _nn = new THREE.Vector3(), _ray = new THREE.Raycaster(); const _anch = {};
  function regionAnchor(r, out) { // a camera-visible shell point of region r, nearest the centroid of its camera-facing vertices (cached; recomputed when the camera moves)
    if (!_regPts[r]) { _regPts[r] = []; for (const h of hemis) { const g = h.geometry, pa = g.attributes.position, ra = g.attributes.aRegion, na = g.attributes.normal; for (let i = 0; i < pa.count; i += 5) if (Math.round(ra.getX(i)) === ridx(r)) _regPts[r].push([V(0, 0, 0).fromBufferAttribute(pa, i), V(0, 0, 0).fromBufferAttribute(na, i)]); } }
    const c = _anch[r]; const now = performance.now();
    if (c && c.cam.distanceToSquared(camera.position) < 1e-4 && now - c.t < 2000) return out.copy(c.p);
    _a.set(0, 0, 0); let n = 0; const vis = [];
    for (const [p, nr] of _regPts[r]) { _nn.copy(camera.position).sub(p); if (_nn.dot(nr) > 0.15 * _nn.length()) { _a.add(p); n++; vis.push(p); } }
    if (!n) return out.copy(REG[r].c); _a.multiplyScalar(1 / n);
    vis.sort((x, y) => x.distanceToSquared(_a) - y.distanceToSquared(_a));
    let pick = vis[0];
    for (let k = 0; k < Math.min(vis.length, 40); k++) { // occlusion check: the first surface along the eye ray must be this point
      const p = vis[k]; _ray.set(camera.position, _nn.copy(p).sub(camera.position).normalize()); const hit = _ray.intersectObjects(hemis, false)[0];
      if (hit && hit.distance > camera.position.distanceTo(p) - 0.03) { pick = p; break; }
    }
    _anch[r] = { p: pick.clone(), cam: camera.position.clone(), t: now };
    return out.copy(pick);
  }
  const labelWrap = $('#nodelabels'); const labelPool = []; const leaders = $('#leaders'); const _ctr = new THREE.Vector3();
  function placeLabels() {
    const W = cv.clientWidth, H = cv.clientHeight; const M = W < 600 ? 8 : 24; let svg = '';
    _ctr.set(0, 0.05, 0).project(camera); const cx = (_ctr.x + 1) / 2 * W, cy = (1 - _ctr.y) / 2 * H;
    for (const r of ORDER) { // thin leader-line labels: anchor on the territory, text pushed outward and clamped inside the viewport
      const R = REG[r]; const el = tags[r];
      if (r === 'risk') regionAnchor(r, _p); else _p.copy(R.c).addScaledVector(_tmpOut(R.out), 0.3);
      _p.project(camera);
      const vis = T.level === 0 && _p.z < 1; el.style.visibility = vis ? 'visible' : 'hidden'; if (!vis) continue;
      const ax = (_p.x + 1) / 2 * W, ay = (1 - _p.y) / 2 * H;
      let dx = ax - cx, dy = ay - cy; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const tw = el.offsetWidth, th = el.offsetHeight; const reach = W < 600 ? 34 : 70;
      let ex = ax + dx * reach, ey = ay + dy * reach * 0.8;
      let lx = dx < 0 ? ex - tw : ex, ly = ey - th / 2;
      lx = Math.max(M, Math.min(W - tw - M, lx)); ly = Math.max(M, Math.min(H - th - M, ly));
      el.classList.toggle('left', dx < 0);
      el.style.transform = `translate(${lx.toFixed(0)}px,${ly.toFixed(0)}px)`;
      const on = T.hover === r; const tx = dx < 0 ? lx + tw + 6 : lx - 6, ty = ly + Math.min(th / 2, 12);
      svg += `<g class="ld${on ? ' on' : ''}" data-r="${r}"><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2.5"/><polyline points="${ax.toFixed(1)},${ay.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}"/></g>`;
    }
    if (leaders._svg !== svg) { leaders.innerHTML = svg; leaders._svg = svg; }
    const show = T.level >= 1 ? T.nodes.filter((n) => n.region === T.region && (n.s.status !== 'eliminated' || T.sel?.id === n.id || n.hist)) : [];
    while (labelPool.length < show.length) { const d = document.createElement('div'); d.className = 'nlab'; labelWrap.appendChild(d); labelPool.push(d); }
    labelPool.forEach((d, i) => {
      const n = show[i]; if (!n) { d.style.display = 'none'; return; }
      _p.copy(n.p).project(camera); if (_p.z > 1) { d.style.display = 'none'; return; }
      d.style.display = ''; const txt = n.hist ? `${A.shortStrat(n.id)} · ${n.hist}` : `${A.shortStrat(n.id)} · v${n.s.version} · ${n.s.status === 'eliminated' ? 'eliminated' : (n.s.stats?.trades ?? 0) + 't'}`;
      if (d.textContent !== txt) d.textContent = txt;
      d.classList.toggle('sel', T.sel?.id === n.id); d.classList.toggle('dead', n.s.status === 'eliminated' || n.hist === 'eliminated');
      const hue = T.hue?.get(n.id); d.style.color = hue && T.sel?.id !== n.id ? '#' + hue.getHexString() : '';
      const x = Math.max(4 + panelPx(), Math.min(W - d.offsetWidth - 4, (_p.x + 1) / 2 * W + 10)), y = Math.max(4, Math.min(H - 18, (1 - _p.y) / 2 * H - 8));
      d.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
    });
  }
  const _o = new THREE.Vector3(); function _tmpOut(v) { return _o.copy(v).normalize(); }

  /* ---------------------------------------------------------------- region panel (contextual overlay) */
  function renderRegionPanel() {
    const rp = $('#regionpanel'); const r = T.region; if (!r) return;
    const R = REG[r]; const esc = A.esc;
    const comps = T.state?.compositions || [];
    if (T.hist) {
      const g = T.hist.g; const here = T.nodes.filter((n) => n.region === r);
      rp.innerHTML = `<h2 class="rp-h" id="rp-title"><span class="rt-n">${R.n}</span> ${esc(R.name)} <span class="b b-hist">HISTORICAL · GEN ${g.n}</span></h2>
        <p class="rp-fn">${esc(R.fn)}</p>
        <p class="rp-note">Population after generation ${g.n}, from <code>/api/generations</code>. Per-generation metrics are not exposed by the API, so trades, PnL and score are shown as unavailable rather than borrowed from today.</p>
        <ul class="cards">${here.map((n) => card(n, null)).join('') || '<li class="empty">No strategies recorded for this region.</li>'}</ul>`;
      return;
    }
    const strats = [...T.strat.values()].filter((s) => s.region === r);
    const alive = strats.filter((s) => s.status !== 'eliminated').sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
    const dead = strats.filter((s) => s.status === 'eliminated');
    const shown = alive.map((s) => T.nodes[T.nodeIdx.get(s.id)] || { id: s.id, s, region: r });
    rp.innerHTML = `<h2 class="rp-h" id="rp-title"><span class="rt-n">${R.n}</span> ${esc(R.name)}</h2>
      <p class="rp-fn">${esc(R.fn)}</p>
      <p class="rp-note">${alive.length} competing now · ${dead.length} eliminated in lineage · ${comps.length} compositions each route one strategy from every region. Sorted by tournament score.</p>
      <ul class="cards">${shown.map((n) => card(n, comps)).join('')}</ul>
      ${dead.length ? `<details class="rp-dead"><summary>${dead.length} eliminated ancestors</summary><p>${dead.slice(-40).map((s) => `<button class="linkbtn" data-sid="${esc(s.id)}">${esc(s.id)}</button>`).join(' ')}</p></details>` : ''}`;
  }
  function card(n, comps) {
    const esc = A.esc; const s = n.s || {}; const st = s.stats || {};
    const params = Object.entries(s.params || {}).map(([k, v]) => `<span class="pchip ${s.changes && s.changes[k] ? 'chg' : ''}"><i>${esc(k)}</i> ${esc(v)}</span>`).join('');
    let inter = '';
    if (comps) {
      const mine = comps.filter((c) => c.strategies?.[n.region] === s.id);
      const partners = {}; for (const c of mine) for (const [reg, id] of Object.entries(c.strategies)) if (reg !== n.region) partners[id] = (partners[id] || 0) + 1;
      inter = `<div class="c-int">${mine.length} compositions · partners ${Object.keys(partners).slice(0, 6).map((id) => `<button class="linkbtn" data-sid="${esc(id)}">${esc(A.shortStrat(id))}</button>`).join(' ') || '—'}</div>`;
    }
    const status = n.hist ? `<span class="b ${n.hist === 'eliminated' ? 'b-dead' : n.hist === 'born' ? 'b-paper' : 'b-ok'}">${n.hist === 'eliminated' ? 'eliminated at gen ' + T.hist.g.n : n.hist === 'born' ? 'born at gen ' + T.hist.g.n : 'alive'}</span>`
      : `<span class="b ${s.status === 'challenger' ? 'b-paper' : s.status === 'eliminated' ? 'b-dead' : 'b-ok'}">${esc(s.status)}</span>`;
    const perf = n.hist ? `<div class="c-perf mut">metrics at gen ${T.hist.g.n}: unavailable</div>`
      : `<div class="c-perf"><span>${esc(st.trades ?? 0)} trades</span><span class="${A.pnlCls(st.pnl_micro)}">${A.hype(st.pnl_micro)} <small>paper</small></span><span>score ${esc(st.score ?? '—')}</span><span>win ${A.pct(st.win_rate)}</span></div>`;
    return `<li><button type="button" class="card ${T.sel?.id === s.id ? 'sel' : ''}" data-sid="${esc(s.id || n.id)}">
      <span class="c-top"><b>${esc(s.id || n.id)}</b>${status}</span>
      <span class="c-id">v${esc(s.version ?? '?')} · born gen ${esc(s.generation ?? '?')} · ${s.parent_id ? 'from ' + esc(s.parent_id) : 'seed strategy'}</span>
      ${perf}<span class="c-params">${params}</span></button>${inter}</li>`;
  }

  /* ---------------------------------------------------------------- history (earlier generation structure) */
  const range = $('#genrange'), out = $('#genout');
  function setupRange() {
    const gs = T.gens; if (!gs.length) { range.disabled = true; out.textContent = 'LIVE · no generations yet'; return; }
    range.disabled = false; range.min = gs[0].n; range.max = gs[gs.length - 1].n + 1;
    if (!T.hist) range.value = range.max;
    range.setAttribute('aria-valuetext', T.hist ? `generation ${T.hist.g.n}, historical` : 'live');
  }
  let rangeT = 0;
  range.addEventListener('input', () => { clearTimeout(rangeT); const v = +range.value; out.textContent = v > T.gens[T.gens.length - 1].n ? 'LIVE' : 'GEN ' + v; rangeT = setTimeout(() => setHist(v), 120); });
  function setHist(n) {
    const g = n == null ? null : T.gens.find((x) => x.n === n);
    if (!g) { if (!T.hist) return; T.hist = null; }
    else T.hist = { g };
    T.histDropped = 0; document.body.classList.toggle('hist', !!T.hist);
    shellMat.uniforms.uHist.value = T.hist ? 1 : 0;
    for (const p of T.pulses) { for (let k = 0; k < TRAIL; k++) pulses.geometry.attributes.aSize.setX(p.slot * TRAIL + k, 0); T.free.push(p.slot); } T.pulses.length = 0;
    T.fire.clear(); T.born.clear(); T.dying.clear();
    if (T.sel) closeDetail(false);
    rebuild(); setupRange(); updHistBanner();
    out.textContent = T.hist ? 'GEN ' + T.hist.g.n : 'LIVE';
    A.announce(T.hist ? `Historical structure after generation ${T.hist.g.n}. Live rendering paused.` : 'Returned to live.');
  }
  function updHistBanner() {
    const b = $('#histbanner'); if (!T.hist) { b.hidden = true; return; }
    const g = T.hist.g; const esc = A.esc;
    const then = new Set(g.survivors || []); const now = new Set([...T.strat.values()].filter((s) => s.status !== 'eliminated').map((s) => s.id));
    const added = [...now].filter((x) => !then.has(x)), removed = [...then].filter((x) => !now.has(x)), kept = [...then].filter((x) => now.has(x));
    const L = (arr) => arr.slice(0, 8).map((id) => `<button class="linkbtn" data-sid="${esc(id)}">${esc(A.shortStrat(id))}</button>`).join(' ') + (arr.length > 8 ? ` +${arr.length - 8}` : '');
    b.hidden = false;
    b.innerHTML = `<div class="hb-h"><span class="b b-hist">HISTORICAL</span> structure after generation <b>${g.n}</b> · verdict ${esc(String(g.verdict).replace(/_/g, ' '))} · ${provLabel(g.label)} <button type="button" class="hb-live" data-live>Return to live</button></div>
      <div class="hb-row">at gen ${g.n}: ${then.size} alive · born ${L(g.born || []) || 'none'} · eliminated ${L(g.eliminated || []) || 'none'}</div>
      <div class="hb-row">compared with live: <span class="pos">+${added.length} alive now that were not then</span> ${L(added)} · <span class="neg">−${removed.length} since eliminated</span> ${L(removed)} · ${kept.length} unchanged</div>
      <div class="hb-row mut">Source: /api/generations survivors, born, eliminated. Composition wiring and per-generation metrics are not persisted in the API, so no nerves or historical numbers are drawn. Live pulses paused${T.histDropped ? ` (${T.histDropped} live events arrived meanwhile, counted not drawn)` : ''}.</div>`;
  }
  const provLabel = (l) => l === 'SYNTHETIC_TEST' ? '<span class="b b-synth">SYNTH TEST</span>' : '<span class="b b-pol">POLICY</span>';
  document.addEventListener('click', (e) => { if (e.target.closest('[data-live]')) setHist(null); });

  // inspector in historical mode: identity only (params are immutable per strategy id), no current metrics
  function inspectHistorical(kind, id) {
    if (kind !== 's') return false;
    const s = T.strat.get(id); const g = T.hist.g; const esc = A.esc;
    const elimAt = T.gens.find((x) => (x.eliminated || []).includes(id));
    const st = (g.eliminated || []).includes(id) ? 'eliminated in this generation' : (g.survivors || []).includes(id) ? ((g.born || []).includes(id) ? 'born in this generation' : 'alive') : 'not alive at this generation';
    T.sel = { kind, id }; if (T.region !== regionOf(id)) { setLevel(1, regionOf(id)); fly(regionView(regionOf(id))); }
    T.level = 2; document.body.dataset.level = '2'; renderCrumbs(); paintNodes(performance.now()); renderRegionPanel();
    A.openInspector('strategy · historical');
    $('#insp-body').innerHTML = `<p class="histnote"><span class="b b-hist">HISTORICAL · GEN ${g.n}</span> Identity and lineage only. Metrics as of gen ${g.n}: <b>unavailable</b> (not exposed by the API). Current figures are not substituted.</p>
      <dl class="kv"><dt>strategy</dt><dd>${esc(id)}</dd><dt>region</dt><dd>${esc(REG[regionOf(id)].name)}</dd>
      <dt>at gen ${g.n}</dt><dd>${esc(st)}</dd><dt>version</dt><dd>${s ? 'v' + esc(s.version) : '—'}</dd><dt>born</dt><dd>${s ? 'gen ' + esc(s.generation) : '—'}</dd>
      <dt>parent</dt><dd>${s?.parent_id ? `<button class="linkbtn" data-sid="${esc(s.parent_id)}">${esc(s.parent_id)}</button>` : 'seed strategy'}</dd>
      <dt>eliminated</dt><dd>${elimAt ? 'at gen ' + elimAt.n : 'not yet'}</dd><dt>status now</dt><dd>${esc(s?.status || 'unknown')} <span class="mut">(live, for comparison)</span></dd>
      <dt>config hash</dt><dd>${esc(s?.config_hash || '—')}</dd><dt>mutation seed</dt><dd>${esc(s?.seed || '—')}</dd></dl>
      <div class="sub">params (fixed for this id)</div><div>${Object.entries(s?.params || {}).map(([k, v]) => `<span class="pchip ${s.changes?.[k] ? 'chg' : ''}"><i>${esc(k)}</i> ${s.changes?.[k] ? esc(s.changes[k][0]) + '→' : ''}${esc(v)}</span>`).join('') || '—'}</div>`;
    return true;
  }

  /* ---------------------------------------------------------------- data hooks from app.js */
  function onState(st) {
    T.state = st; T.strat.clear(); syncRegions(st);
    for (const r of st.regions || []) for (const s of r.strategies || []) T.strat.set(s.id, s);
    if (!T.hist) rebuild(); else updHistBanner();
  }
  function onGens(gs) { T.gens = gs || []; setupRange(); if (!T.hist) rebuild(); }

  /* ---------------------------------------------------------------- frame loop */
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, w < 700 ? 1.5 : 1.75));
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    glowMat.uniforms.uScale.value = h * 0.9;
    PAN.cur = -1;
    fitHome();
    if (T.level === 0 && !T.tween && !T.orbited) { camera.position.copy(HOME.pos); controls.target.copy(HOME.tgt); controls.update(); }
  }
  new ResizeObserver(resize).observe(host);
  resize();
  camera.position.copy(HOME.pos); controls.target.copy(HOME.tgt); controls.update();
  controls.addEventListener('start', () => { T.orbited = true; });
  const hint = $('#hint');
  if (matchMedia('(hover:none)').matches) hint.textContent = 'Drag to orbit · pinch to zoom · tap a region to enter';
  const hideHint = () => hint.classList.add('gone');
  renderer.domElement.addEventListener('pointerdown', hideHint, { once: true }); setTimeout(hideHint, 9000);

  let frames = 0, fpsT = performance.now();
  const stats = { fps: 0, calls: 0, tris: 0, pulses: 0 };
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    stepTween(now); stepPan(); if (controls.enabled) controls.update();
    { const d = camera.position.distanceTo(controls.target); shellMat.uniforms.uCtr.value = d; shellMat.uniforms.uSpan.value = Math.max(0.45, Math.min(1.0, d * 0.3)); glowMat.uniforms.uCtr.value = d; scene.fog.near = d - 0.2; scene.fog.far = d + 1.7; }
    if (T.needPick) { T.needPick = false; hoverPick(); }
    const idle = Date.now() - (A.S.lastSignal || 0) > 4000;
    shellMat.uniforms.uBreath.value = idle && !REDUCED.matches && !T.hist ? Math.sin(now / 1400) * 0.006 : 0; // explicitly idle breathing
    for (let i = 0; i < 6; i++) { T.regFire[i] *= 0.94; shellMat.uniforms.uFireA.value[i] = T.regFire[i]; } shellMat.uniforms.uTime.value = now / 1000;
    const animating = T.pulses.length || T.fire.size || T.born.size || T.dying.size;
    if (animating) { stepPulses(now); paintNodes(now); paintComps(now);
      for (const m of [T.fire, T.born, T.dying]) for (const [k, u] of m) if (u < now) m.delete(k); }
    placeLabels();
    renderer.render(scene, camera);
    if (!T.shown && A.S.state) { T.shown = true; const m = $('#stagemsg'); if (m) m.hidden = true; }
    frames++; if (now - fpsT > 1000) { stats.fps = frames; frames = 0; fpsT = now; stats.calls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles; stats.pulses = T.pulses.length; }
  }
  requestAnimationFrame(frame);

  window.DB3D = {
    state: onState, gens: onGens, event: onEvent, selected, inspectHistorical, back, home: goHome, enterRegion,
    get hist() { return !!T.hist; }, setHist, stats,
    debug: () => ({ level: T.level, region: T.region, hover: T.hover, sel: T.sel, nodes: T.nodes.length, comps: T.comps.size, pulses: T.pulses.length,
      hist: T.hist ? T.hist.g.n : null, cam: camera.position.toArray().map((x) => +x.toFixed(2)), tgt: controls.target.toArray().map((x) => +x.toFixed(2)),
      tweening: !!T.tween, geometries: renderer.info.memory.geometries, ...stats }),
  };
  if (A.S.state) onState(A.S.state);
  if (A.S.gens?.length) onGens(A.S.gens);
  setLevel(0, null);
}
