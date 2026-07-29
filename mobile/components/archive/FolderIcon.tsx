import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { useThemeColors } from '@/contexts/ThemeContext';

const VIEW_W = 48;
const VIEW_H = 40;

/**
 * Flat file-explorer-style folder silhouette (back tab + front panel).
 *
 * Takes the topic's accent when given one. A grid of twenty identical grey
 * folders is a wall — the eye has nothing to navigate by, so finding a topic
 * means reading twenty captions in sequence. Tinting the tab and the panel's
 * edge turns the grid into something scannable by colour, and the accent is
 * stable per topic (see `accentForKey`), so that scanning is worth learning:
 * philosophy is the same colour every time the archive is opened.
 *
 * The fills stay very light on purpose. This is a folder that happens to be
 * tinted, not a coloured tile.
 */
export function FolderIcon({ size = 56, accent }: { size?: number; accent?: string }) {
  const c = useThemeColors();
  const height = (size * VIEW_H) / VIEW_W;
  const body = 'M2 12a4 4 0 0 1 4-4h11l4 4h21a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z';

  return (
    <Svg width={size} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      <Rect
        x={4} y={4} width={20} height={10} rx={3}
        fill={accent ?? c.border}
        fillOpacity={accent ? 0.72 : 1}
      />
      <Path
        d={body}
        // `surface`, not `elevated`: the archive sits on the canvas tone now,
        // and an elevated fill matches it closely in light mode.
        fill={c.surface}
        stroke={accent ?? c.border}
        strokeWidth={1.5}
        strokeOpacity={accent ? 0.55 : 1}
        strokeLinejoin="round"
      />
      {/* Wash over the panel, drawn separately so it tints the surface without
          the stroke having to carry two opacities. */}
      {accent && <Path d={body} fill={accent} fillOpacity={0.12} />}
    </Svg>
  );
}
