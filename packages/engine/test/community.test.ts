import { describe, expect, it } from "vitest";
import { compileCommunity, forward, genesisNeurons, neuronIssues, type CommunityNeuron } from "../src";

const mk = (id: string, layer: 1 | 2, over: Partial<CommunityNeuron> = {}): CommunityNeuron =>
  ({ id, owner: "w1", layer, bias: 0.1, seed: id, scale: 1, createdAt: "2026-01-01T00:00:00.000Z", ...over });

describe("community network", () => {
  it("compiles deterministically and is executable", () => {
    const ns = [...genesisNeurons(), mk("a", 1), mk("b", 2)];
    const A = compileCommunity(ns), B = compileCommunity([...ns].reverse());
    expect(A.snapshotHash).toBe(B.snapshotHash);
    expect(A.model.config.hidden).toEqual([3, 3]);
    const out = forward(A.model, [0.1, 0.2, 0.3, 0.4]).output;
    expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
  });
  it("a neuron's change only affects its own incoming weights and bias", () => {
    const ns = [...genesisNeurons(), mk("a", 1), mk("b", 1)];
    const before = compileCommunity(ns).model;
    const after = compileCommunity(ns.map((n) => (n.id === "a" ? { ...n, seed: "a2", bias: -0.3 } : n))).model;
    const L0b = before.layers[0], L0a = after.layers[0];
    const order = compileCommunity(ns).order[1].map((n) => n.id);
    const ia = order.indexOf("a");
    for (let o = 0; o < L0b.outDim; o++) for (let i = 0; i < L0b.inDim; i++) {
      const same = L0b.W[o * 4 + i] === L0a.W[o * 4 + i];
      expect(same).toBe(o !== ia);
    }
    expect(Array.from(before.layers[2].W)).not.toEqual([]);
  });
  it("validates neurons and caps", () => {
    expect(neuronIssues({ layer: 3 as 1, bias: 0, seed: "x", scale: 1 })).toHaveLength(1);
    expect(neuronIssues({ layer: 1, bias: 9, seed: "", scale: 5 })).toHaveLength(3);
    expect(() => compileCommunity([mk("a", 1)])).toThrow(/at least one/);
    const many = Array.from({ length: 49 }, (_, i) => mk(`n${i}`, 1));
    expect(() => compileCommunity([...genesisNeurons(), ...many])).toThrow(/cap/);
  });
});
