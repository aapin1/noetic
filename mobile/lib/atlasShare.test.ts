import { describe, expect, it } from "vitest";
// Relative import on purpose: the backend runner aliases `@` to src/, so the
// mobile alias would not resolve here. The framing math has no imports at all.
import {
  MIN_FIT_SPREAD,
  atlasNodeRadius,
  atlasStatLine,
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
