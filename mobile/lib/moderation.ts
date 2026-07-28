import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { api } from '@/lib/api';
import type { ReportReason } from '@/types/api';

/**
 * The block/report menu, shared by every surface that shows another person —
 * Pulse cards and user search results today.
 *
 * App Store Guideline 1.2 wants both actions reachable from wherever the
 * content is, not buried in settings, so this is a single call the caller can
 * hang off a "…" button.
 *
 * iOS gets a real action sheet; the seven report reasons do not fit in an Alert
 * without turning into a stack of buttons nobody can read.
 */

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Something else' },
];

function chooseFromList(
  title: string,
  options: string[],
  onPick: (index: number) => void,
) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options, 'Cancel'], cancelButtonIndex: options.length },
      (index) => {
        if (index < options.length) onPick(index);
      },
    );
    return;
  }

  Alert.alert(
    title,
    undefined,
    [
      ...options.map((label, index) => ({ text: label, onPress: () => onPick(index) })),
      { text: 'Cancel', style: 'cancel' as const },
    ],
  );
}

function reportFlow(targetUserId: string, displayName: string) {
  chooseFromList(`Report ${displayName}`, REPORT_REASONS.map((r) => r.label), (index) => {
    const reason = REPORT_REASONS[index]!.value;
    void api.moderation
      .report(targetUserId, reason)
      .then(() => {
        Alert.alert(
          'Report sent',
          'Thanks — we review every report. You can also block this account so you stop seeing it.',
        );
      })
      .catch((e: unknown) => {
        Alert.alert('Could not send report', e instanceof Error ? e.message : 'Try again in a moment.');
      });
  });
}

function blockFlow(targetUserId: string, displayName: string, onChanged?: () => void) {
  Alert.alert(
    `Block ${displayName}?`,
    "You won't see each other in Pulse or search, and any follow between you is removed.",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          void api.moderation
            .block(targetUserId)
            .then(() => onChanged?.())
            .catch((e: unknown) => {
              Alert.alert('Could not block', e instanceof Error ? e.message : 'Try again in a moment.');
            });
        },
      },
    ],
  );
}

export function promptModerationActions(args: {
  targetUserId: string;
  displayName: string;
  /** Called after a successful block so the caller can drop the row. */
  onChanged?: () => void;
}) {
  chooseFromList(args.displayName, ['Report account', 'Block account'], (index) => {
    if (index === 0) reportFlow(args.targetUserId, args.displayName);
    else blockFlow(args.targetUserId, args.displayName, args.onChanged);
  });
}
