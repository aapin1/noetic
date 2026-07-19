import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { useThemeColors } from '@/contexts/ThemeContext';

const VIEW_W = 48;
const VIEW_H = 40;

/** Flat file-explorer-style folder silhouette (back tab + front panel),
 * built entirely from theme grayscale tokens — no new color introduced. */
export function FolderIcon({ size = 56 }: { size?: number }) {
  const c = useThemeColors();
  const height = (size * VIEW_H) / VIEW_W;

  return (
    <Svg width={size} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      <Rect x={4} y={4} width={20} height={10} rx={3} fill={c.border} />
      <Path
        d="M2 12a4 4 0 0 1 4-4h11l4 4h21a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z"
        // `surface`, not `elevated`: the archive sits on the gray canvas now,
        // and an elevated fill matches it exactly in light mode.
        fill={c.surface}
        stroke={c.border}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
