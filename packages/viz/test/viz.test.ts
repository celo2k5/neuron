import { describe, expect, it } from "vitest";
import { forward, generateModel, VISUAL_FORMS, type ModelConfig } from "@neuron/engine";
import { graphOf, intensity, layout, paletteFromSeed, schedule } from "../src";

const cfg: ModelConfig = { name: "v", seed: "viz", architecture: "sparse", inputDim: 3, outputDim: 2, hidden: [8, 6], activations: ["relu", "tanh"], outputActivation: "softmax", density: 0.5, init: "he" };

describe("viz", () => {
  it("graph mirrors the model: one edge per existing connection, none for masked ones", () => {
    const m = generateModel(cfg); const G = graphOf(m);
    const expected = m.layers.reduce((s, L) => s + Array.from(L.mask!).reduce((a, b) => a + b, 0), 0);
    expect(G.edges.length).toBe(expected);
    expect(G.nodes.length).toBe(3 + 8 + 6 + 2);
    for (const e of G.edges) expect(m.layers[e.layer - 1].W[e.k]).toBe(e.w);
  });
  it("layouts are deterministic and switching forms never changes the model", () => {
    const m = generateModel(cfg); const h = m.artifactHash; const out = forward(m, [1, 2, 3]).output;
    for (const f of VISUAL_FORMS) {
      const a = layout(m, f), b = layout(generateModel(cfg), f);
      expect(Array.from(a.x)).toEqual(Array.from(b.x));
      expect(Array.from(a.y)).toEqual(Array.from(b.y));
      a.x.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    }
    expect(m.artifactHash).toBe(h);
    expect(forward(m, [1, 2, 3]).output).toEqual(out);
    const forms = new Set(VISUAL_FORMS.map((f) => Array.from(layout(m, f).x.slice(0, 6)).join()));
    expect(forms.size).toBeGreaterThanOrEqual(5);
  });
  it("palette is seed-deterministic and distinct between seeds", () => {
    const a = generateModel(cfg), b = generateModel({ ...cfg, seed: "other" });
    expect(paletteFromSeed(a.configHash)).toEqual(paletteFromSeed(generateModel(cfg).configHash));
    expect(paletteFromSeed(a.configHash).hue).not.toBe(paletteFromSeed(b.configHash).hue);
  });
  it("activation mapping and schedule follow computation order", () => {
    expect(intensity(-2, 4)).toBe(0.5); expect(intensity(9, 4)).toBe(1); expect(intensity(NaN, 1)).toBe(0);
    const G = graphOf(generateModel(cfg)); const s = schedule(G, 100);
    for (const e of G.edges) { const [t0, t1] = s.edgeSpan(e); expect(t1).toBeGreaterThan(t0); }
  });
});
