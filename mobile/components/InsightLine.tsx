import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CompassIcon,
  GitForkIcon,
  LayersIcon,
  LinkIcon,
  RotateCcwIcon,
  ScaleIcon,
  TrendingUpIcon,
  UserIcon,
  type LucideIcon,
} from 'lucide-react-native';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { plainProse, sentenceCase } from '@/lib/text';
import type { InsightCard, InsightType } from '@/types/api';

const TYPE_LABEL: Record<InsightType, string> = {
  PATTERN: 'Pattern',
  TRAJECTORY: 'Trajectory',
  CONNECTION: 'Connection',
  REINFORCES: 'Reinforces',
  CONTRADICTS: 'Contradicts',
  NOVELTY: 'Novelty',
  RECUR: 'Recurs',
  READING: 'Reading',
  MIRROR: 'A read on you',
};

// The category row borrows Health's grammar: a small glyph and the category
// name in the secondary colour, then the content in the primary. The glyph
// is what keeps it a category line rather than a label floating over text.
const TYPE_ICON: Record<InsightType, LucideIcon> = {
  PATTERN: LayersIcon,
  TRAJECTORY: TrendingUpIcon,
  CONNECTION: LinkIcon,
  REINFORCES: GitForkIcon,
  CONTRADICTS: ScaleIcon,
  NOVELTY: CompassIcon,
  RECUR: RotateCcwIcon,
  READING: BookOpenIcon,
  MIRROR: UserIcon,
};

interface Props {
  insight: InsightCard;
  compact?: boolean;
  /**
   * Whether the note shows at first. Collapsed, the row is the category and
   * the line, clamped to two lines, and a tap opens it. Defaults to open so
   * a lone insight never hides its note.
   */
  defaultExpanded?: boolean;
}

/**
 * One insight: a category row (glyph and name), the line itself, and the
 * note the model made on it. The note's move ("the catch", "what it adds")
 * runs into the note as a bold lead-in rather than sitting above it as a
 * label, so the block reads as a title and a paragraph.
 */
export function InsightLine({ insight, compact = false, defaultExpanded = true }: Props) {
  const c = useThemeColors();
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Every polished insight names the move it made in evidence.kicker: the
  // READING's note ("the catch", "where it comes from") and the graph-derived
  // kinds too ("what it adds", "where they split"). The MIRROR carries none;
  // its label is the type itself.
  const rawKicker = insight.type !== 'MIRROR'
    ? (insight.evidence as { kicker?: unknown } | null)?.kicker
    : undefined;
  const noteKicker = typeof rawKicker === 'string' && rawKicker.trim() ? sentenceCase(rawKicker.trim()) : null;

  const border = useMemo(() => ({ borderTopColor: c.borderSubtle }), [c]);
  const Icon = TYPE_ICON[insight.type];
  const hasNote = !compact && !!insight.body;
  const open = hasNote && expanded;
  const Chevron = open ? ChevronUpIcon : ChevronDownIcon;

  return (
    <Pressable
      onPress={hasNote ? () => setExpanded((v) => !v) : undefined}
      disabled={!hasNote}
      accessibilityRole={hasNote ? 'button' : undefined}
      accessibilityState={hasNote ? { expanded: open } : undefined}
      style={[styles.container, compact && styles.compact, border]}
    >
      <View style={styles.category}>
        <Icon size={14} color={c.textSecondary} strokeWidth={2} />
        <Text variant="subheadline" color="secondary" style={styles.categoryText}>
          {TYPE_LABEL[insight.type]}
        </Text>
        {hasNote ? <Chevron size={16} color={c.faint} /> : null}
      </View>
      <Text variant="bodyMedium" color="primary" numberOfLines={open || compact ? undefined : 2}>
        {plainProse(insight.headline)}
      </Text>
      {open ? (
        <Text variant="subheadline" color="secondary" style={styles.body}>
          {noteKicker ? (
            <Text variant="subheadline" color="secondary" style={styles.lead}>{`${noteKicker}. `}</Text>
          ) : null}
          {plainProse(insight.body)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  compact: {
    paddingVertical: Spacing[3],
  },
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: Spacing[1],
  },
  categoryText: {
    flex: 1,
    fontWeight: '600',
  },
  lead: {
    fontWeight: '600',
  },
  body: {
    marginTop: Spacing[1],
    lineHeight: 21,
  },
});
