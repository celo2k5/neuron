/**
 * WebGL specimen renderer (three.js). Same correspondence rules as the 2D renderer:
 *  - one line per existing connection (masked connections are never drawn)
 *  - colour sign = weight sign, brightness ∝ |w| / max|w|
 *  - during a trace, layer l lights at l·step; particles travel only along real edges,
 *    with size/brightness ∝ |w · a_source| (the actual contribution to the next weighted sum)
 * Presentation only: never mutates the model.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Model } from "@neuron/engine";
import { graphOf, refreshWeights, type Graph } from "@neuron/viz";
import type { ThemeColors } from "@/lib/client/theme";

export interface Scene3DOptions { autoRotate?: boolean; zoom?: boolean; stepMs?: number; bloom?: number; framing?: number; /** shift the rendered centre right by this fraction of the width (wide screens) */ offsetX?: number; offsetY?: number; onFrame?: (t: number) => void }

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const MAX_PULSES = 1400;

const POINT_VS = /* glsl */ `
  attribute float size; attribute float act; attribute vec3 tint;
  varying vec3 vColor; varying float vAct; varying float vDepth;
  uniform float uPixel; uniform float uTime;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = clamp((-mv.z - 6.0) / 26.0, 0.0, 1.0);
    vColor = tint; vAct = act;
    float breathe = 1.0 + 0.06 * sin(uTime * 1.3 + position.x * 2.1 + position.y * 3.7);
    gl_PointSize = min(72.0, size * (1.0 + act * 0.9) * breathe * uPixel * (330.0 / -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;
const POINT_FS = /* glsl */ `
  varying vec3 vColor; varying float vAct; varying float vDepth;
  uniform float uBase;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.2, 0.11, d);
    float halo = pow(smoothstep(0.5, 0.0, d), 3.0) * (0.28 + vAct * 0.9);
    float a = (core * (uBase + vAct * 0.6) + halo) * (1.0 - vDepth * 0.55);
    gl_FragColor = vec4(vColor * a, a);
  }`;
const PULSE_FS = /* glsl */ `
  varying vec3 vColor; varying float vAct; varying float vDepth;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float d = length(c);
    if (d > 0.5) discard;
    float a = (smoothstep(0.16, 0.0, d) * 0.9 + pow(smoothstep(0.5, 0.0, d), 2.4) * 0.6) * vAct;
    gl_FragColor = vec4(vColor * a, a);
  }`;

const col = (s: string, fallback = "#ffffff") => {
  const c = new THREE.Color();
  try { c.setStyle((s || fallback).replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, "rgb($1,$2,$3)")); } catch { c.set(fallback); }
  return c;
};

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private group = new THREE.Group();
  private nodes: THREE.Points | null = null;
  private edges: THREE.LineSegments | null = null;
  private pulses: THREE.Points;
  private dust: THREE.Points;
  private rings = new THREE.Group();
  private G: Graph | null = null;
  private model: Model | null = null;
  private pos = new Float32Array(0);
  private edgeBase = new Float32Array(0);
  private trace: number[][] | null = null;
  private layerMax: number[] = [];
  private traceAt = 0;
  private raf = 0;
  private visible = true;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private clock = new THREE.Clock();
  private colors: ThemeColors;
  private opts: Required<Omit<Scene3DOptions, "onFrame">> & Pick<Scene3DOptions, "onFrame">;
  private reduced: boolean;
  private pointer = new THREE.Vector2();
  private intro = 0;
  private radius = 10;
  private light = false;

  constructor(private host: HTMLElement, colors: ThemeColors, opts: Scene3DOptions = {}) {
    this.colors = colors;
    this.opts = { autoRotate: true, zoom: false, stepMs: 420, bloom: 1, framing: 1, offsetX: 0, offsetY: 0, ...opts };
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.domElement.className = "absolute inset-0 h-full w-full";
    host.prepend(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
    this.camera.position.set(9, 6.5, 19);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.06, enablePan: false, enableZoom: this.opts.zoom, autoRotate: this.opts.autoRotate && !this.reduced, autoRotateSpeed: 0.35, rotateSpeed: 0.5, minDistance: 6, maxDistance: 60 });
    this.controls.minPolarAngle = Math.PI * 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.82;
    this.scene.add(this.group);

    // signal particles
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PULSES * 3), 3));
    pg.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(MAX_PULSES * 3), 3));
    pg.setAttribute("size", new THREE.BufferAttribute(new Float32Array(MAX_PULSES), 1));
    pg.setAttribute("act", new THREE.BufferAttribute(new Float32Array(MAX_PULSES), 1));
    pg.setDrawRange(0, 0);
    this.pulses = new THREE.Points(pg, this.pointMaterial(PULSE_FS, 0));
    this.pulses.frustumCulled = false;
    this.group.add(this.pulses);

    // ambient dust for depth (deterministic)
    const N = 900, dp = new Float32Array(N * 3), dt = new Float32Array(N * 3), ds = new Float32Array(N), da = new Float32Array(N);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const r = 14 + rnd() * 40, th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
      dp.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], i * 3);
      ds[i] = 0.06 + rnd() * 0.14;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    dg.setAttribute("tint", new THREE.BufferAttribute(dt, 3));
    dg.setAttribute("size", new THREE.BufferAttribute(ds, 1));
    dg.setAttribute("act", new THREE.BufferAttribute(da, 1));
    this.dust = new THREE.Points(dg, this.pointMaterial(POINT_FS, 0.35));
    this.scene.add(this.dust);
    this.group.add(this.rings);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8 * this.opts.bloom, 0.55, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.applyColors();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.io = new IntersectionObserver((es) => { this.visible = es[0]?.isIntersecting ?? true; if (this.visible) this.loop(); });
    this.io.observe(host);
    host.addEventListener("pointermove", this.onPointer);
    this.resize();
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect(); this.io.disconnect();
    this.host.removeEventListener("pointermove", this.onPointer);
    this.controls.dispose();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onPointer = (e: PointerEvent) => {
    const r = this.host.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };

  private pointMaterial(fs: string, base: number) {
    return new THREE.ShaderMaterial({
      vertexShader: POINT_VS, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPixel: { value: this.renderer.getPixelRatio() }, uTime: { value: 0 }, uBase: { value: base } },
    });
  }

  setColors(c: ThemeColors) { this.colors = c; this.applyColors(); if (this.model) this.colorize(); }

  private applyColors() {
    const bg = col(this.colors.bg, "#080b12");
    this.scene.background = bg;
    const light = bg.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
    this.light = light;
    // additive light on a light ground washes out; dial bloom down for SOLAR
    this.bloom.strength = (light ? 0.2 : 0.8) * this.opts.bloom;
    const dc = col(this.colors.muted, "#7f91af").multiplyScalar(light ? 0.6 : 0.45);
    const t = this.dust.geometry.getAttribute("tint") as THREE.BufferAttribute;
    for (let i = 0; i < t.count; i++) t.setXYZ(i, dc.r, dc.g, dc.b);
    t.needsUpdate = true;
    for (const m of [this.nodes?.material, this.pulses.material, this.dust.material]) {
      if (m) (m as THREE.ShaderMaterial).blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    }
    if (this.edges) (this.edges.material as THREE.LineBasicMaterial).blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.rings.children.forEach((r) => { const m = (r as THREE.Line).material as THREE.LineBasicMaterial; m.color = col(this.colors.muted, "#7f91af"); m.opacity = light ? 0.35 : 0.13; });
  }

  setModel(m: Model) {
    const sameGraph = this.model?.configHash === m.configHash;
    this.model = m;
    if (sameGraph && this.G) { refreshWeights(m); this.colorize(); return; }
    this.G = graphOf(m);
    this.trace = null;
    this.build();
    this.intro = performance.now();
  }

  play(acts: number[][]) {
    this.trace = acts;
    this.layerMax = acts.map((v) => Math.max(1e-9, ...v.map(Math.abs)));
    this.traceAt = performance.now();
  }

  get durationMs() { return this.G ? this.G.layerSize.length * this.opts.stepMs : 0; }

  private build() {
    const G = this.G!;
    for (const o of [this.nodes, this.edges]) if (o) { this.group.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    this.rings.clear();
    const L = G.layerSize.length;
    const gap = Math.min(2.6, 15 / Math.max(1, L - 1));
    const n = G.nodes.length;
    this.pos = new Float32Array(n * 3);
    const tilt = 0.35;
    let maxR = 0;
    for (let l = 0; l < L; l++) {
      const size = G.layerSize[l];
      const R = 0.25 + Math.sqrt(size) * 0.55;
      maxR = Math.max(maxR, R);
      for (let i = 0; i < size; i++) {
        const g = G.layerStart[l] + i;
        const r = size === 1 ? 0 : R * Math.sqrt((i + 0.5) / size);
        const a = i * GOLDEN + l * 0.9;
        const x = (l - (L - 1) / 2) * gap;
        this.pos.set([x, r * Math.cos(a), r * Math.sin(a) * (1 - tilt * 0.3)], g * 3);
      }
      // instrument ring marking each layer plane
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, k) => new THREE.Vector3(0, Math.cos((k / 96) * Math.PI * 2) * (R + 0.35), Math.sin((k / 96) * Math.PI * 2) * (R + 0.35)))),
        new THREE.LineBasicMaterial({ color: col(this.colors.muted), transparent: true, opacity: 0.13, depthWrite: false }),
      );
      ring.position.x = (l - (L - 1) / 2) * gap;
      this.rings.add(ring);
    }
    this.radius = Math.max(((L - 1) * gap) / 2 + 1.2, maxR + 1);
    const ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    ng.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    ng.setAttribute("size", new THREE.BufferAttribute(new Float32Array(n), 1));
    ng.setAttribute("act", new THREE.BufferAttribute(new Float32Array(n), 1));
    this.nodes = new THREE.Points(ng, this.pointMaterial(POINT_FS, 0.95));
    this.nodes.frustumCulled = false;

    const E = G.edges.length;
    const ep = new Float32Array(E * 6);
    G.edges.forEach((e, k) => { ep.set(this.pos.subarray(e.s * 3, e.s * 3 + 3), k * 6); ep.set(this.pos.subarray(e.t * 3, e.t * 3 + 3), k * 6 + 3); });
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.BufferAttribute(ep, 3));
    eg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(E * 6), 3));
    this.edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.edges.frustumCulled = false;
    this.group.add(this.edges, this.nodes);
    this.applyColors();
    this.colorize();
    this.frame3d();
  }

  /** frame the camera so the whole specimen fits the viewport */
  private frame3d() {
    const fov = (this.camera.fov * Math.PI) / 180;
    const fitH = this.radius / Math.sin(fov / 2);
    const fitW = this.radius / Math.sin(Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const d = Math.max(fitH, fitW) * 0.92 * this.opts.framing;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(dir.multiplyScalar(d));
    this.controls.maxDistance = d * 2.4;
    this.controls.minDistance = d * 0.35;
  }

  private colorize() {
    if (!this.G || !this.nodes || !this.edges) return;
    const G = this.G, pos = col(this.colors.pos), neg = col(this.colors.neg), node = col(this.colors.node), acc = col(this.colors.accent), ice = col(this.colors.accent2);
    const tint = this.nodes.geometry.getAttribute("tint") as THREE.BufferAttribute;
    const size = this.nodes.geometry.getAttribute("size") as THREE.BufferAttribute;
    const last = G.layerSize.length - 1;
    for (const nd of G.nodes) {
      const c = nd.layer === 0 ? ice : nd.layer === last ? acc : node;
      tint.setXYZ(nd.g, c.r, c.g, c.b);
      size.setX(nd.g, (nd.layer === 0 || nd.layer === last ? 1.15 : 0.8) + Math.min(0.6, Math.sqrt(nd.degIn + nd.degOut) * 0.06));
    }
    tint.needsUpdate = true; size.needsUpdate = true;
    const ec = this.edges.geometry.getAttribute("color") as THREE.BufferAttribute;
    this.edgeBase = new Float32Array(ec.count * 3);
    const dense = G.edges.length > 700 ? 0.42 : 0.85;
    const bg = col(this.colors.bg, "#080b12");
    G.edges.forEach((e, k) => {
      const m = Math.min(1, Math.abs(e.w) / G.maxAbsW);
      const c = e.w >= 0 ? pos : neg;
      const b = (0.03 + 0.2 * m * m) * dense * (e.kind === "skip" ? 1.6 : 1);
      // dark grounds: additive light (colour × brightness). light grounds: tint from the paper toward the colour.
      const out = this.light ? bg.clone().lerp(c, Math.min(1, b * 2.2)) : c.clone().multiplyScalar(b);
      for (const v of [0, 1]) this.edgeBase.set([out.r, out.g, out.b], (k * 2 + v) * 3);
    });
    (ec.array as Float32Array).set(this.edgeBase);
    ec.needsUpdate = true;
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.composer.setSize(r.width, r.height);
    this.bloom.resolution.set(r.width / 2, r.height / 2);
    this.camera.aspect = r.width / r.height;
    const wide = r.width >= 1024;
    // phones: lift the specimen into the top half so the headline sits below it
    const ox = wide ? this.opts.offsetX : 0, oy = wide ? this.opts.offsetY : this.opts.offsetX ? 0.2 : 0;
    if (ox || oy) this.camera.setViewOffset(r.width, r.height, -r.width * ox, r.height * oy, r.width, r.height); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.G) this.frame3d();
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    if (!this.visible) return;
    this.raf = requestAnimationFrame(this.loop);
    this.render(performance.now());
  };

  private render(now: number) {
    const t = this.clock.getElapsedTime();
    for (const p of [this.nodes, this.pulses, this.dust]) if (p) ((p.material as THREE.ShaderMaterial).uniforms.uTime.value = t);
    if (!this.reduced) {
      this.dust.rotation.y = t * 0.012;
      // gentle parallax toward the pointer
      this.group.rotation.x += ((this.pointer.y * 0.08) - this.group.rotation.x) * 0.04;
      this.group.rotation.z += ((-this.pointer.x * 0.05) - this.group.rotation.z) * 0.04;
    }
    // intro: the specimen assembles outward from its axis
    if (this.nodes && this.intro) {
      const k = this.reduced ? 1 : Math.min(1, (now - this.intro) / 1600);
      const e = 1 - Math.pow(1 - k, 4);
      this.group.scale.set(1, 0.2 + 0.8 * e, 0.2 + 0.8 * e);
      (this.edges!.material as THREE.LineBasicMaterial).opacity = e;
      if (k >= 1) this.intro = 0;
    }
    this.animateTrace(now);
    this.controls.update();
    this.composer.render();
    this.opts.onFrame?.(t);
  }

  private animateTrace(now: number) {
    const G = this.G, nodes = this.nodes, edges = this.edges;
    if (!G || !nodes || !edges) return;
    const act = nodes.geometry.getAttribute("act") as THREE.BufferAttribute;
    const ec = edges.geometry.getAttribute("color") as THREE.BufferAttribute;
    const P = this.pulses.geometry;
    if (!this.trace) { P.setDrawRange(0, 0); return; }
    const step = this.reduced ? 1 : this.opts.stepMs;
    const el = now - this.traceAt;
    const end = G.layerSize.length * step;
    // nodes: light when their layer is reached, then settle to a held glow
    for (const nd of G.nodes) {
      const at = nd.layer * step;
      const a = Math.min(1, Math.abs(this.trace[nd.layer]?.[nd.index] ?? 0) / this.layerMax[nd.layer]);
      const since = el - at;
      const v = since < 0 ? 0 : since < 260 ? a * (since / 260) * 1.25 : a * (0.55 + 0.7 * Math.exp(-(since - 260) / 500));
      act.setX(nd.g, v);
    }
    act.needsUpdate = true;
    // edges + particles
    const pp = P.getAttribute("position") as THREE.BufferAttribute, pt = P.getAttribute("tint") as THREE.BufferAttribute;
    const ps = P.getAttribute("size") as THREE.BufferAttribute, pa = P.getAttribute("act") as THREE.BufferAttribute;
    const arr = ec.array as Float32Array;
    arr.set(this.edgeBase);
    let fmax = 1e-12;
    for (const e of G.edges) fmax = Math.max(fmax, Math.abs(e.w * (this.trace[G.nodes[e.s].layer]?.[G.nodes[e.s].index] ?? 0)));
    const glow = col(this.colors.accent2), pos = col(this.colors.pos), neg = col(this.colors.neg);
    let n = 0;
    for (const e of G.edges) {
      const sn = G.nodes[e.s];
      const f = Math.abs(e.w * (this.trace[sn.layer]?.[sn.index] ?? 0)) / fmax;
      if (f < 0.03) continue;
      const t0 = sn.layer * step, t1 = G.nodes[e.t].layer * step;
      const u = (el - t0) / (t1 - t0);
      const c = e.w >= 0 ? pos : neg;
      if (u > 0) { // carried signal stays faintly lit
        const hold = u > 1 ? 0.35 * Math.exp(-(el - t1) / 900) : 0.9;
        const b = f * hold * 0.55;
        for (const v of [0, 1]) {
          const o = (e.e * 2 + v) * 3;
          if (this.light) { const k2 = Math.min(1, b * 1.6); arr[o] += (c.r - arr[o]) * k2; arr[o + 1] += (c.g - arr[o + 1]) * k2; arr[o + 2] += (c.b - arr[o + 2]) * k2; }
          else { arr[o] += c.r * b; arr[o + 1] += c.g * b; arr[o + 2] += c.b * b; }
        }
      }
      if (u < 0 || u > 1 || n >= MAX_PULSES) continue;
      const s = e.s * 3, d = e.t * 3, k = u * u * (3 - 2 * u);
      pp.setXYZ(n, this.pos[s] + (this.pos[d] - this.pos[s]) * k, this.pos[s + 1] + (this.pos[d + 1] - this.pos[s + 1]) * k, this.pos[s + 2] + (this.pos[d + 2] - this.pos[s + 2]) * k);
      const m = e.kind === "skip" ? glow : c.clone().lerp(glow, 0.5);
      pt.setXYZ(n, m.r, m.g, m.b);
      ps.setX(n, 0.5 + 1.4 * f);
      pa.setX(n, 0.35 + 0.65 * f);
      n++;
    }
    ec.needsUpdate = true;
    P.setDrawRange(0, n);
    pp.needsUpdate = pt.needsUpdate = ps.needsUpdate = pa.needsUpdate = true;
    if (el > end + 2500) { /* hold final glow */ }
  }
}
