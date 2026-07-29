/**
 * The Atlas's ink — shared by every surface that draws a semantic map.
 *
 * This lives outside the Atlas screen because it is not the Atlas screen's
 * property: the pulse tab renders a miniature of each friend's map, and those
 * dots have to be the same colours the friend sees on their own Atlas or the
 * miniature is telling a different story than the thing it miniaturises. It had
 * drifted exactly that way — MiniMap carried a hand-copied palette, under a
 * comment claiming it matched, that hadn't matched in two redesigns.
 *
 * The map is dark in BOTH app themes, so everything here is a fixed value
 * rather than a theme token.
 */

/** Warm-biased near-black. Matches `mapBackground` in both palettes. */
export const MAP_BG = '#0A0907';

/**
 * Fully opaque, and brighter than a mid grey. A node is the smallest mark on
 * the map, so any alpha it carries is spent before the eye can resolve it — the
 * points read as smudges rather than as points. Every dimming a map does
 * (search, focus, timeline, zoom fade) is applied on top of this.
 */
export const MAP_NODE = 'rgba(246,246,246,1)';

/**
 * Faintly cool rather than pure white: at edge alphas a neutral grey goes muddy
 * against the near-black, where a hint of blue stays crisp. Opaque — an edge's
 * strokeOpacity carries the whole falloff.
 */
export const MAP_LINE = 'rgba(222,230,241,1)';

/**
 * Region hues. The map is monochrome apart from these, so a cluster's colour is
 * the only thing that says "this region is one subject" — it has to survive
 * being a 4px dot on black. An earlier revision pulled every hue ~35% toward
 * its own luma to stay quiet, and at that chroma the dots read as dirty white
 * instead of as colour. These sit near full chroma but stay mid-luminance, so a
 * cluster is unmistakable up close and still resolves as texture, not confetti,
 * when the whole map is in frame.
 */
export const CLUSTER_PALETTE = [
  '#6E9AD1',
  '#9885C9',
  '#7FC7A2',
  '#DFA26B',
  '#D97878',
  '#79C2C2',
  '#C6AC7F',
  '#9BB4D1',
  '#C4849B',
  '#A8CC86',
];

/** Accent for a capture made in the last two weeks. */
export const RECENT_NODE_COLOR = '#E3B87C';

/** Stable 32-bit hash of an id. */
export function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

/**
 * Colour is a stable function of the topic id — NEVER of the cluster's rank in
 * a count-sorted list. Rank-indexed colours reshuffled every cluster's hue
 * whenever relative counts changed (each new capture could recolour the whole
 * map); a hash keeps a topic's colour fixed for the life of the account, and
 * fixed between a user's own Atlas and the miniature their friends see.
 */
export function clusterColorFor(topicId: string): string {
  return CLUSTER_PALETTE[hashId(topicId) % CLUSTER_PALETTE.length]!;
}

// ── Chrome floating over a map ────────────────────────────────────
// One glass recipe for every control that sits on the map — the toolbar pill,
// the capture FAB, the summary strip, the search bar — so they read as the same
// surface rather than as unrelated controls.
//
// The old recipe was rgba(10,10,10,0.72): a near-black wash over a near-black
// map, which composited to something barely distinguishable from the map
// itself. The controls didn't read as controls so much as slightly-darker
// patches of nothing. These are a warm charcoal instead, landing around #282420
// over the map: unmistakably a surface, still clearly subordinate to the points
// it floats over.
export const GLASS_BG = 'rgba(46,42,35,0.82)';
export const GLASS_BORDER = 'rgba(240,232,214,0.16)';
/** Brighter than GLASS_BORDER: the FAB is the primary action, so its edge
 *  catches light where the passive surfaces' do not. */
export const GLASS_BORDER_GLOW = 'rgba(240,232,214,0.42)';
/** Hairlines and pressed states inside a glass control. */
export const GLASS_SEP = 'rgba(240,232,214,0.1)';
export const GLASS_ACTIVE_BG = 'rgba(240,232,214,0.11)';

/**
 * Ink for anything drawn ON the glass. Fixed rather than themed: the chrome
 * floats over the always-dark map, but these icons used to take `c.muted`,
 * which in LIGHT mode is a dark warm grey — a near-black icon on a near-black
 * pill. Half the toolbar was effectively invisible in light mode.
 */
export const MAP_CHROME_ICON = 'rgba(240,232,214,0.62)';
export const MAP_CHROME_ICON_ACTIVE = 'rgba(248,244,236,0.96)';
