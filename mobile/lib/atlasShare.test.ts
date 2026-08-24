import { describe, expect, it } from "vitest";
// Relative import on purpose: the backend runner aliases `@` to src/, so the
// mobile alias would not resolve here. The framing math has no imports at all.
import {
  MIN_FIT_SPREAD,
  atlasMonthStamp,
  atlasNodeRadius,
  atlasStatLine,
  atlasLabelBudget,
  buildAtlasScene,
  darkenHex,
  fitAtlasFrame,
  projectAtlasPoint,
  type AtlasSharePoint,
} from "./atlasShare";

const FRAME = { width: 320, height: 400, pad: 24 };

function project(points: AtlasSharePoint[], frame = FRAME) {
  const fit = fitAtlasFrame(points, frame);
  expect(fit).not.toBeNull();
  return points.map((p) => projectAtlasPoint(p, fit!));
}

describe("fitAtlasFrame", () => {
  it("returns null for an empty cloud", () => {
    expect(fitAtlasFrame([], FRAME)).toBeNull();
  });

  it("centres a single node on the frame", () => {
    const [p] = project([{ x: 0.87, y: 0.13 }]);
    expect(p.x).toBeCloseTo(FRAME.width / 2);
    expect(p.y).toBeCloseTo(FRAME.height / 2);
  });

  it("keeps a 5-node cluster generous and centred, not exploded to the edges", () => {
    // Five thoughts within a whisker of each other — the degenerate small map.
    const points = [
      { x: 0.5, y: 0.5 },
      { x: 0.51, y: 0.5 },
      { x: 0.5, y: 0.51 },
      { x: 0.49, y: 0.5 },
      { x: 0.5, y: 0.49 },
    ];
    const fit = fitAtlasFrame(points, FRAME)!;
    // The floor spread governs the zoom, so the cluster occupies a small
    // fraction of the frame instead of being stretched across it.
    const innerW = FRAME.width - FRAME.pad * 2;
    expect(fit.scale).toBeCloseTo(innerW / MIN_FIT_SPREAD);
    const placed = project(points);
    const spanX = Math.max(...placed.map((p) => p.x)) - Math.min(...placed.map((p) => p.x));
    expect(spanX).toBeLessThan(innerW / 4);
    // Centroid still lands on the frame centre.
    const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length;
    expect(cx).toBeCloseTo(FRAME.width / 2);
  });

  it("fits 500 nodes inside the padding on both axes", () => {
    const points = Array.from({ length: 500 }, (_, i) => ({
      x: (i * 37) % 500 / 500,
      y: (i * 91) % 500 / 500,
    }));
    const placed = project(points);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(FRAME.pad - 1e-6);
      expect(p.x).toBeLessThanOrEqual(FRAME.width - FRAME.pad + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(FRAME.pad - 1e-6);
      expect(p.y).toBeLessThanOrEqual(FRAME.height - FRAME.pad + 1e-6);
    }
  });

  it("touches the padding on the long axis of a wide cloud", () => {
    const points = [
      { x: 0.05, y: 0.5 },
      { x: 0.95, y: 0.5 },
      { x: 0.5, y: 0.52 },
    ];
    const placed = project(points);
    expect(Math.min(...placed.map((p) => p.x))).toBeCloseTo(FRAME.pad);
    expect(Math.max(...placed.map((p) => p.x))).toBeCloseTo(FRAME.width - FRAME.pad);
  });

  it("does not distort an extreme-aspect cloud (uniform scale, both axes inside)", () => {
    // A near-1D ribbon: full width, a hair of height.
    const points = Array.from({ length: 40 }, (_, i) => ({
      x: i / 39,
      y: 0.5 + (i % 2) * 0.01,
    }));
    const fit = fitAtlasFrame(points, FRAME)!;
    const placed = project(points);
    // One scale for both axes: world aspect is preserved.
    const worldSpanX = 1;
    const screenSpanX =
      Math.max(...placed.map((p) => p.x)) - Math.min(...placed.map((p) => p.x));
    expect(screenSpanX).toBeCloseTo(worldSpanX * fit.scale);
    for (const p of placed) {
      expect(p.y).toBeGreaterThanOrEqual(FRAME.pad - 1e-6);
      expect(p.y).toBeLessThanOrEqual(FRAME.height - FRAME.pad + 1e-6);
    }
    // The ribbon sits vertically centred, not smeared to fill the tall frame.
    const cy =
      (Math.max(...placed.map((p) => p.y)) + Math.min(...placed.map((p) => p.y))) / 2;
    expect(cy).toBeCloseTo(FRAME.height / 2);
  });

  it("handles a tall ribbon the same way (portrait extreme)", () => {
    const points = [
      { x: 0.5, y: 0.02 },
      { x: 0.51, y: 0.98 },
    ];
    const placed = project(points);
    expect(Math.min(...placed.map((p) => p.y))).toBeCloseTo(FRAME.pad);
    expect(Math.max(...placed.map((p) => p.y))).toBeCloseTo(FRAME.height - FRAME.pad);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(FRAME.pad - 1e-6);
      expect(p.x).toBeLessThanOrEqual(FRAME.width - FRAME.pad + 1e-6);
    }
  });
});

describe("atlasNodeRadius", () => {
  it("gives small maps big marks and large maps the live map's dot size", () => {
    expect(atlasNodeRadius(1)).toBe(9);
    expect(atlasNodeRadius(3)).toBeGreaterThan(atlasNodeRadius(50));
    expect(atlasNodeRadius(500)).toBeCloseTo(2.4);
    expect(atlasNodeRadius(0)).toBe(0);
  });
});

describe("buildAtlasScene", () => {
  const opts = { width: 320, height: 360, showLabels: true, colorFor: () => "#6E9AD1", hash: (id: string) => id.length * 7919 };
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `n${i}`, x: (i % 10) / 10 + 0.05, y: Math.floor(i / 10) / 10 + 0.05 }));
  const cluster = (ids: string[], name = "design") => ({ topicId: `t-${name}`, name, kind: "domain" as const, count: ids.length, itemIds: ids });

  it("returns an empty scene for no nodes", () => {
    expect(buildAtlasScene([], [], [], opts)).toEqual({ washes: [], links: [], stars: [], labels: [], baseR: 0 });
  });

  it("draws one star per node inside the frame", () => {
    const nodes = mk(30);
    const scene = buildAtlasScene(nodes, [], [], opts);
    expect(scene.stars).toHaveLength(30);
    for (const s of scene.stars) {
      expect(s.cx).toBeGreaterThan(0); expect(s.cx).toBeLessThan(opts.width);
      expect(s.cy).toBeGreaterThan(0); expect(s.cy).toBeLessThan(opts.height);
    }
  });

  it("scatters a node with no coordinates deterministically", () => {
    const a = buildAtlasScene([{ id: "abc" }], [], [], opts);
    const b = buildAtlasScene([{ id: "abc" }], [], [], opts);
    expect(a.stars[0]).toEqual(b.stars[0]);
  });

  it("ramps link opacity by weight and dashes contradictions", () => {
    const nodes = mk(3);
    const edges = [
      { fromItemId: "n0", toItemId: "n1", type: "RELATED", weight: 0.2 },
      { fromItemId: "n1", toItemId: "n2", type: "RELATED", weight: 0.9 },
      { fromItemId: "n0", toItemId: "n2", type: "CONTRADICTS", weight: 0.5 },
    ];
    const { links } = buildAtlasScene(nodes, edges, [], opts);
    const strong = links.find((l) => l.key === "n1-n2")!;
    const weak = links.find((l) => l.key === "n0-n1")!;
    expect(strong.opacity).toBeGreaterThan(weak.opacity);
    expect(links.find((l) => l.key === "n0-n2")!.dashed).toBe(true);
  });

  it("skips edges to nodes that are not on the map", () => {
    const { links } = buildAtlasScene(mk(2), [{ fromItemId: "n0", toItemId: "ghost", type: "RELATED", weight: 1 }], [], opts);
    expect(links).toHaveLength(0);
  });

  it("marks hubs only on dense maps", () => {
    const star = (n: number) =>
      Array.from({ length: n - 1 }, (_, i) => ({ fromItemId: "n0", toItemId: `n${i + 1}`, type: "RELATED", weight: 1 }));
    expect(buildAtlasScene(mk(8), star(8), [], opts).stars.some((s) => s.hub)).toBe(false);
    expect(buildAtlasScene(mk(40), star(40), [], opts).stars.find((s) => s.id === "n0")!.hub).toBe(true);
  });

  it("washes and labels one field per major cluster, respecting the budget", () => {
    const nodes = mk(20);
    const clusters = Array.from({ length: 7 }, (_, i) => cluster([`n${i * 2}`, `n${i * 2 + 1}`], `field ${i}`));
    const scene = buildAtlasScene(nodes, [], clusters, opts);
    expect(scene.washes).toHaveLength(7);
    expect(scene.labels.length).toBeLessThanOrEqual(atlasLabelBudget(20).max);
    expect(scene.labels[0]!.text).toBe("field 0");
  });

  it("ignores singleton clusters", () => {
    const scene = buildAtlasScene(mk(3), [], [cluster(["n0"], "alone")], opts);
    expect(scene.washes).toHaveLength(0);
    expect(scene.labels).toHaveLength(0);
  });

  it("never places two labels on top of each other", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: 0.5 + (i % 2) * 0.01, y: 0.5 + Math.floor(i / 2) * 0.005 }));
    const clusters = Array.from({ length: 6 }, (_, i) => cluster([`n${i * 2}`, `n${i * 2 + 1}`], `overlapping field ${i}`));
    const { labels } = buildAtlasScene(nodes, [], clusters, opts);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!, b = labels[j]!;
        const overlap = Math.abs(a.y - b.y) < a.fontSize && Math.abs(a.x - b.x) < (a.width + b.width) / 2;
        expect(overlap).toBe(false);
      }
    }
  });

  it("hides labels when asked", () => {
    const scene = buildAtlasScene(mk(4), [], [cluster(["n0", "n1"])], { ...opts, showLabels: false });
    expect(scene.labels).toHaveLength(0);
    expect(scene.washes).toHaveLength(1);
  });
});

describe("atlasLabelBudget", () => {
  it("spends fewer, bigger names on a small map and more, smaller ones on a dense map", () => {
    expect(atlasLabelBudget(5).max).toBeLessThan(atlasLabelBudget(200).max);
    expect(atlasLabelBudget(5).fontSize).toBeGreaterThan(atlasLabelBudget(200).fontSize);
  });
});

describe("darkenHex", () => {
  it("mixes toward black and keeps the format", () => {
    expect(darkenHex("#ffffff", 0.5)).toBe("#808080");
    expect(darkenHex("#000000", 0.4)).toBe("#000000");
    expect(darkenHex("#6E9AD1", 0)).toBe("#6e9ad1");
  });
});

describe("atlasMonthStamp", () => {
  it("formats the month + year", () => {
    expect(atlasMonthStamp(new Date(2026, 7, 10))).toBe("AUG 2026");
    expect(atlasMonthStamp(new Date(2027, 0, 1))).toBe("JAN 2027");
  });
});

describe("atlasStatLine", () => {
  it("formats the plural stat line", () => {
    expect(atlasStatLine(214, 37)).toBe("214 points · 37 fields");
  });

  it("uses singulars", () => {
    expect(atlasStatLine(1, 1)).toBe("1 point · 1 field");
  });

  it("drops the field clause when there are no fields yet", () => {
    expect(atlasStatLine(3, 0)).toBe("3 points");
  });
});
