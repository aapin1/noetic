import { describe, expect, it } from "vitest";
import { semanticLayout, cosineSim, placeNewNode, isDegenerateLayout, isGroupIncoherentLayout } from "@/server/cognition/layout";
import { classifyEdgeSemantic, SEMANTIC_CONNECT_THRESHOLD } from "@/server/cognition/insights";

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("semanticLayout", () => {
  it("places semantically similar items closer than dissimilar ones", () => {
    // A and B point the same way; C is orthogonal (unrelated).
    const items = [
      { id: "A", embedding: [1, 0, 0] },
      { id: "B", embedding: [0.95, 0.05, 0] },
      { id: "C", embedding: [0, 0, 1] },
    ];
    const pos = semanticLayout(items);

    const ab = dist(pos.A!, pos.B!);
    const ac = dist(pos.A!, pos.C!);
    const bc = dist(pos.B!, pos.C!);

    expect(ab).toBeLessThan(ac);
    expect(ab).toBeLessThan(bc);
  });

  it("is deterministic — identical input yields identical output", () => {
    const items = [
      { id: "x1", embedding: [1, 0.2, 0.1] },
      { id: "x2", embedding: [0.1, 1, 0.2] },
      { id: "x3", embedding: [0.2, 0.1, 1] },
      { id: "x4", embedding: [0.9, 0.3, 0.1] },
    ];
    const a = semanticLayout(items);
    const b = semanticLayout(items);
    expect(a).toEqual(b);
  });

  it("keeps all coordinates within the normalized [0,1] box", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      embedding: [Math.sin(i), Math.cos(i), Math.sin(i * 2)],
    }));
    const pos = semanticLayout(items);
    for (const p of Object.values(pos)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("places items without embeddings on the periphery, away from the centre", () => {
    const pos = semanticLayout([
      { id: "a", embedding: [1, 0] },
      { id: "b", embedding: [0.9, 0.1] },
      { id: "noemb", embedding: null },
    ]);
    expect(dist(pos.noemb!, { x: 0.5, y: 0.5 })).toBeGreaterThan(0.3);
  });

  // Regression: the old accretion path froze every node and greedily placed
  // new ones against the frozen anchors, which collapsed the whole map onto a
  // line and could never move a badly-placed node again. A warm-started
  // re-layout must escape that line AND recover the true 2D relationships.
  it("heals a collinear warm start and respects 2D semantic relationships", () => {
    const items = [
      { id: "neuro", embedding: [1, 0.3, 0.1, 0] },
      { id: "consc1", embedding: [0.4, 1, 0.2, 0.1] },
      { id: "consc2", embedding: [0.42, 0.98, 0.22, 0.12] },
      // related to consciousness (shared themes), unrelated to neuroscience
      { id: "heidegger", embedding: [0.1, 0.5, 0.2, 1] },
    ];
    // Degenerate persisted coordinates: all four on one diagonal line, with
    // heidegger wrongly sitting closest to neuro (what the old path produced).
    const init = {
      neuro: { x: 0.5, y: 0.5 },
      consc1: { x: 0.766, y: 0.234 },
      consc2: { x: 0.76, y: 0.24 },
      heidegger: { x: 0.613, y: 0.385 },
    };

    const pos = semanticLayout(items, { init });

    expect(isDegenerateLayout(Object.values(pos))).toBe(false);
    // The consciousness pair stays the closest relationship on the map.
    expect(dist(pos.consc1!, pos.consc2!)).toBeLessThan(dist(pos.consc1!, pos.neuro!));
    // Heidegger ends up nearer consciousness than neuroscience.
    expect(dist(pos.heidegger!, pos.consc1!)).toBeLessThan(dist(pos.heidegger!, pos.neuro!));
  });

  it("is deterministic with a warm start", () => {
    const items = [
      { id: "a", embedding: [1, 0, 0] },
      { id: "b", embedding: [0.2, 1, 0] },
      { id: "c", embedding: [0.1, 0.2, 1] },
    ];
    const init = { a: { x: 0.3, y: 0.3 }, b: { x: 0.6, y: 0.6 }, c: { x: 0.9, y: 0.9 } };
    expect(semanticLayout(items, { init })).toEqual(semanticLayout(items, { init }));
  });

  // Regression: a lone science capture must sit with its own field even when
  // another field has far more nodes. Raw embedding distances bunch all
  // "unrelated" pairs into one band, so cluster mass could out-pull topical
  // fit; the group prior keeps the map correct at the domain scale.
  it("keeps same-field nodes together against a larger foreign cluster", () => {
    const psych = Array.from({ length: 8 }, (_, i) => ({
      id: `psy${i}`,
      embedding: [0.05 + i * 0.01, 1, 0.1 + i * 0.005, 0],
      group: "psychology",
    }));
    const items = [
      ...psych,
      { id: "bio", embedding: [1, 0.1, 0.05, 0.1], group: "science" },
      { id: "mech", embedding: [0.9, 0.05, 0.1, 0.2], group: "science" },
      // Quantum: modestly similar to the science pair, dissimilar to psychology.
      { id: "quantum", embedding: [0.6, 0.15, 0.5, 0.55], group: "science" },
    ];
    const pos = semanticLayout(items);
    const centroid = (ids: string[]) => ({
      x: ids.reduce((s, id) => s + pos[id]!.x, 0) / ids.length,
      y: ids.reduce((s, id) => s + pos[id]!.y, 0) / ids.length,
    });
    const psyCentroid = centroid(psych.map((p) => p.id));
    const sciCentroid = centroid(["bio", "mech"]);
    expect(dist(pos.quantum!, sciCentroid)).toBeLessThan(dist(pos.quantum!, psyCentroid));
  });

  it("group prior does not disturb single-group or ungrouped layouts", () => {
    const items = [
      { id: "A", embedding: [1, 0, 0] },
      { id: "B", embedding: [0.95, 0.05, 0] },
      { id: "C", embedding: [0, 0, 1] },
    ];
    const grouped = semanticLayout(items.map((it) => ({ ...it, group: "science" })));
    const ungrouped = semanticLayout(items);
    expect(grouped).toEqual(ungrouped);
  });
});

describe("isDegenerateLayout", () => {
  it("flags points on a straight line", () => {
    const line = Array.from({ length: 6 }, (_, i) => ({ x: 0.1 + i * 0.15, y: 0.1 + i * 0.15 }));
    expect(isDegenerateLayout(line)).toBe(true);
  });

  it("flags coincident points", () => {
    expect(isDegenerateLayout([
      { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 },
    ])).toBe(true);
  });

  it("accepts a healthy 2D spread", () => {
    expect(isDegenerateLayout([
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.15 }, { x: 0.5, y: 0.85 }, { x: 0.3, y: 0.5 },
    ])).toBe(false);
  });

  it("never flags fewer than 3 points", () => {
    expect(isDegenerateLayout([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }])).toBe(false);
  });
});

describe("placeNewNode", () => {
  // Two fixed anchors: A (left) similar to one theme, B (right) to another.
  const anchors = [
    { x: 0.2, y: 0.5, embedding: [1, 0, 0] },
    { x: 0.8, y: 0.5, embedding: [0, 1, 0] },
  ];

  it("lands near the anchor it is most similar to", () => {
    const nearA = placeNewNode([0.95, 0.05, 0], anchors)!;
    const nearB = placeNewNode([0.05, 0.95, 0], anchors)!;
    expect(nearA.x).toBeLessThan(0.5); // pulled toward A on the left
    expect(nearB.x).toBeGreaterThan(0.5); // pulled toward B on the right
    expect(Math.hypot(nearA.x - 0.2, nearA.y - 0.5)).toBeLessThan(
      Math.hypot(nearA.x - 0.8, nearA.y - 0.5),
    );
  });

  it("does not mutate the anchors", () => {
    const snapshot = JSON.parse(JSON.stringify(anchors));
    placeNewNode([0.5, 0.5, 0], anchors);
    expect(anchors).toEqual(snapshot);
  });

  it("is deterministic", () => {
    expect(placeNewNode([0.3, 0.7, 0], anchors)).toEqual(placeNewNode([0.3, 0.7, 0], anchors));
  });

  it("returns null without an embedding or without usable anchors", () => {
    expect(placeNewNode(null, anchors)).toBeNull();
    expect(placeNewNode([1, 0, 0], [])).toBeNull();
  });

  // Regression: seeding must follow what the node is MOST similar to, not the
  // biggest cluster's mass. Twenty mildly-dissimilar anchors on the right used
  // to out-pull three highly-similar anchors on the left.
  it("lands near its most similar anchors, not the largest cluster", () => {
    const science = [
      { x: 0.15, y: 0.2, embedding: [1, 0.1, 0] },
      { x: 0.2, y: 0.25, embedding: [0.95, 0.15, 0] },
      { x: 0.18, y: 0.15, embedding: [0.9, 0.1, 0.1] },
    ];
    const psychology = Array.from({ length: 20 }, (_, i) => ({
      x: 0.75 + (i % 5) * 0.03,
      y: 0.7 + Math.floor(i / 5) * 0.04,
      embedding: [0.15, 1, 0.1 + i * 0.002],
    }));
    const p = placeNewNode([0.85, 0.25, 0.05], [...psychology, ...science])!;
    const sciDist = Math.hypot(p.x - 0.18, p.y - 0.2);
    const psyDist = Math.hypot(p.x - 0.81, p.y - 0.76);
    expect(sciDist).toBeLessThan(psyDist);
  });
});

describe("isGroupIncoherentLayout", () => {
  const psych = Array.from({ length: 6 }, (_, i) => ({
    x: 0.7 + (i % 3) * 0.05,
    y: 0.7 + Math.floor(i / 3) * 0.05,
    group: "psychology",
  }));
  const science = [
    { x: 0.15, y: 0.2, group: "science" },
    { x: 0.2, y: 0.15, group: "science" },
  ];

  it("flags a node parked deep inside a foreign field", () => {
    // A science capture sitting in the middle of the psychology cluster.
    expect(isGroupIncoherentLayout([
      ...psych,
      ...science,
      { x: 0.72, y: 0.73, group: "science" },
    ])).toBe(true);
  });

  it("accepts a coherent layout", () => {
    expect(isGroupIncoherentLayout([
      ...psych,
      ...science,
      { x: 0.25, y: 0.22, group: "science" },
    ])).toBe(false);
  });

  it("never flags ungrouped or single-field layouts", () => {
    expect(isGroupIncoherentLayout(psych.map((p) => ({ ...p, group: undefined })))).toBe(false);
    expect(isGroupIncoherentLayout(psych)).toBe(false);
  });
});

describe("cosineSim", () => {
  it("returns 1 for parallel vectors and ~0 for orthogonal", () => {
    expect(cosineSim([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});

describe("classifyEdgeSemantic", () => {
  it("creates no edge below the connect threshold", () => {
    expect(
      classifyEdgeSemantic({ similarity: SEMANTIC_CONNECT_THRESHOLD - 0.01, polarityDelta: 0, topicJaccard: 0 }),
    ).toBeNull();
  });

  it("connects genuinely related captures", () => {
    expect(
      classifyEdgeSemantic({ similarity: 0.5, polarityDelta: 0, topicJaccard: 0.4 }),
    ).toBe("REINFORCES");
  });

  it("flags opposing stance on a related topic as a contradiction", () => {
    expect(
      classifyEdgeSemantic({ similarity: 0.5, polarityDelta: 0.2, topicJaccard: 0.4 }),
    ).toBe("CONTRADICTS");
  });

  it("marks very-high similarity as recurrence", () => {
    expect(
      classifyEdgeSemantic({ similarity: 0.7, polarityDelta: 0, topicJaccard: 0.6 }),
    ).toBe("RECURS");
  });
});
