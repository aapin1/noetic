import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  CheckIcon,
  ChevronLeftIcon,
  FileTextIcon,
  ImagesIcon,
  SearchIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Radius, Spacing, accentFor } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { RecapCoverCard, RecapNodeCard, RecapPoster } from '@/components/share/RecapCard';
import {
  RECAP_ASPECT,
  RECAP_MAX,
  RECAP_TITLE_PRESETS,
  RECAP_WINDOWS,
  applyRecapFilters,
  captureFrame,
  dateRangeLabel,
  nodeImage,
  saveFramesToPhotos,
  shareImage,
  topicOptions,
  type RecapFilters,
  type RecapWindow,
} from '@/lib/recap';
import type { CaptureSummary } from '@/types/api';

type Step = 'select' | 'compose';
type Format = 'slideshow' | 'single';

export default function ShareRecapScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile } = useAuth();

  const { data: captures, loading } = useApiQuery(
    () => api.captures.list({ limit: 80 }),
    [],
    { cacheKey: 'recap.captures' },
  );

  const [step, setStep] = useState<Step>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<RecapFilters>({ window: 'all', topicId: null, query: '' });
  const [title, setTitle] = useState<string>(RECAP_TITLE_PRESETS[0]);
  const [format, setFormat] = useState<Format>('slideshow');

  const all = useMemo(() => captures ?? [], [captures]);
  const filtered = useMemo(() => applyRecapFilters(all, filters), [all, filters]);
  const topics = useMemo(() => topicOptions(all), [all]);

  // Selection is kept in tap order so the slideshow follows the order the user
  // built it in. `filtered` can hide a selected item (e.g. a search refines the
  // list) without dropping it from the recap.
  const selected = useMemo(() => {
    const byId = new Map(all.map((i) => [i.id, i]));
    return selectedIds.map((id) => byId.get(id)).filter((x): x is CaptureSummary => Boolean(x));
  }, [selectedIds, all]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= RECAP_MAX) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return prev;
      }
      void Haptics.selectionAsync();
      return [...prev, id];
    });
  }, []);

  if (loading && all.length === 0) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <Header onClose={() => router.back()} />
        <AsciiLoader fill variant="cat" size={80} message="gathering your saves…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      {step === 'select' ? (
        <>
          <Header onClose={() => router.back()} title="Share a recap" />
          <SelectStep
            items={filtered}
            hasAny={all.length > 0}
            selectedIds={selectedIds}
            filters={filters}
            topics={topics}
            onFilters={setFilters}
            onToggle={toggle}
          />
          <View style={[styles.bar, { borderTopColor: c.border, backgroundColor: c.background }]}>
            <Button
              label={selected.length === 0 ? 'Pick some nodes' : `Next · ${selected.length} selected`}
              fullWidth
              disabled={selected.length === 0}
              onPress={() => setStep('compose')}
            />
          </View>
        </>
      ) : (
        <ComposeStep
          items={selected}
          title={title}
          onTitle={setTitle}
          format={format}
          onFormat={setFormat}
          handle={profile?.handle ?? null}
          onBack={() => setStep('select')}
        />
      )}
    </SafeAreaView>
  );
}

/* ---------------------------------------------------------------- header --- */

function Header({ onClose, title }: { onClose: () => void; title?: string }) {
  const c = useThemeColors();
  return (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
        <XIcon size={22} color={c.text} />
      </Pressable>
      <Text variant="monoSmall" color="muted" style={styles.headerTitle} numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View style={{ width: 22 }} />
    </View>
  );
}

/* ------------------------------------------------------------ select step --- */

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        { borderColor: active ? c.text : c.border, backgroundColor: active ? c.text : 'transparent' },
      ]}
    >
      <Text variant="monoSmall" style={{ color: active ? c.inverseText : c.muted }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SelectStep({
  items,
  hasAny,
  selectedIds,
  filters,
  topics,
  onFilters,
  onToggle,
}: {
  items: CaptureSummary[];
  hasAny: boolean;
  selectedIds: string[];
  filters: RecapFilters;
  topics: { topicId: string; name: string; count: number }[];
  onFilters: (f: RecapFilters) => void;
  onToggle: (id: string) => void;
}) {
  const c = useThemeColors();

  return (
    <ScrollView
      contentContainerStyle={styles.selectContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Input
        placeholder="Search your saves"
        value={filters.query}
        onChangeText={(query) => onFilters({ ...filters, query })}
        leftIcon={<SearchIcon size={18} color={c.faint} />}
        autoCorrect={false}
        containerStyle={styles.search}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {RECAP_WINDOWS.map((w) => (
          <Chip
            key={w.key}
            label={w.label}
            active={filters.window === w.key}
            onPress={() => onFilters({ ...filters, window: w.key as RecapWindow })}
          />
        ))}
      </ScrollView>

      {topics.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Chip
            label="All topics"
            active={filters.topicId === null}
            onPress={() => onFilters({ ...filters, topicId: null })}
          />
          {topics.map((t) => (
            <Chip
              key={t.topicId}
              label={t.name}
              active={filters.topicId === t.topicId}
              onPress={() =>
                onFilters({ ...filters, topicId: filters.topicId === t.topicId ? null : t.topicId })
              }
            />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.selectHint}>
        <Text variant="monoSmall" color="faint">
          {selectedIds.length} of {RECAP_MAX} · tap to add
        </Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text variant="monoSmall" color="muted" style={{ textAlign: 'center', letterSpacing: 1.2 }}>
            {hasAny ? 'nothing matches those filters.' : 'save something first, then come back.'}
          </Text>
        </View>
      ) : (
        items.map((item) => (
          <SelectableRow
            key={item.id}
            item={item}
            selected={selectedIds.includes(item.id)}
            onPress={() => onToggle(item.id)}
          />
        ))
      )}
    </ScrollView>
  );
}

function SelectableRow({
  item,
  selected,
  onPress,
}: {
  item: CaptureSummary;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();
  const thumb = nodeImage(item);
  const author = item.contentItem?.authorName ?? item.contentItem?.sourceName ?? null;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderBottomColor: c.border }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      <View
        style={[
          styles.check,
          selected
            ? { backgroundColor: c.text, borderColor: c.text }
            : { borderColor: c.border },
        ]}
      >
        {selected ? <CheckIcon size={14} color={c.inverseText} strokeWidth={3} /> : null}
      </View>

      {thumb ? (
        <Image source={{ uri: thumb }} style={[styles.thumb, { borderColor: c.border }]} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder, { borderColor: c.border, backgroundColor: c.elevated }]}>
          <FileTextIcon size={16} color={c.faint} />
        </View>
      )}

      <View style={styles.rowInfo}>
        <Text variant="serif" numberOfLines={2}>
          {item.title}
        </Text>
        {author ? (
          <Text variant="monoSmall" color="faint" numberOfLines={1} style={{ marginTop: 2 }}>
            {author}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/* ----------------------------------------------------------- compose step --- */

function ComposeStep({
  items,
  title,
  onTitle,
  format,
  onFormat,
  handle,
  onBack,
}: {
  items: CaptureSummary[];
  title: string;
  onTitle: (t: string) => void;
  format: Format;
  onFormat: (f: Format) => void;
  handle: string | null;
  onBack: () => void;
}) {
  const c = useThemeColors();
  const { width: screenW } = useWindowDimensions();
  const cardW = Math.min(screenW - Spacing[6] * 2, 360);

  const accent = useMemo(() => accentFor(items.length * 31 + (items[0]?.id.length ?? 0)), [items]);
  const range = useMemo(() => dateRangeLabel(items), [items]);
  const heading = title.trim() || RECAP_TITLE_PRESETS[0];

  // One rendered view per capturable frame, keyed by frame id.
  const frames = useRef<Record<string, View | null>>({});
  const setFrame = useCallback(
    (id: string) => (el: View | null) => {
      frames.current[id] = el;
    },
    [],
  );

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // Warm the image cache before any capture, so a frame never rasterizes with a
  // half-loaded thumbnail. Falls open after a short wait if a fetch stalls.
  React.useEffect(() => {
    let cancelled = false;
    const urls = items.map(nodeImage).filter((u): u is string => Boolean(u));
    if (urls.length === 0) {
      setReady(true);
      return;
    }
    const done = () => {
      if (!cancelled) setReady(true);
    };
    Promise.race([
      Image.prefetch(urls),
      new Promise((res) => setTimeout(res, 2500)),
    ]).finally(done);
    return () => {
      cancelled = true;
    };
  }, [items]);

  const frameIds = useMemo(() => ['cover', ...items.map((i) => i.id)], [items]);

  const captureAll = useCallback(async (): Promise<string[]> => {
    const uris: string[] = [];
    for (const id of frameIds) {
      const view = frames.current[id];
      if (view) uris.push(await captureFrame(view));
    }
    return uris;
  }, [frameIds]);

  const handleShareSlideshow = useCallback(async () => {
    setBusy(true);
    try {
      const uris = await captureAll();
      const saved = await saveFramesToPhotos(uris);
      if (saved) {
        Alert.alert(
          'Saved to Photos',
          `${uris.length} ${uris.length === 1 ? 'card' : 'cards'} are in your camera roll. Open TikTok or Instagram and pick them as a slideshow.`,
        );
      }
    } catch {
      Alert.alert('Couldn’t make your cards', 'Something went wrong rendering the images. Try again.');
    } finally {
      setBusy(false);
    }
  }, [captureAll]);

  const handleShareSingle = useCallback(async () => {
    setBusy(true);
    try {
      const view = frames.current.poster;
      if (view) await shareImage(await captureFrame(view));
    } catch {
      Alert.alert('Couldn’t make your image', 'Something went wrong rendering the image. Try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSaveSingle = useCallback(async () => {
    setBusy(true);
    try {
      const view = frames.current.poster;
      if (view) {
        const saved = await saveFramesToPhotos([await captureFrame(view)]);
        if (saved) Alert.alert('Saved to Photos', 'Your image is in your camera roll.');
      }
    } catch {
      Alert.alert('Couldn’t save', 'Something went wrong rendering the image. Try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleShareCover = useCallback(async () => {
    setBusy(true);
    try {
      const view = frames.current.cover;
      if (view) await shareImage(await captureFrame(view));
    } catch {
      Alert.alert('Couldn’t share', 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={onBack} accessibilityLabel="Back" hitSlop={8}>
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="monoSmall" color="muted" style={styles.headerTitle}>
          Compose
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.composeContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Input
          label="Cover title"
          value={title}
          onChangeText={onTitle}
          placeholder={RECAP_TITLE_PRESETS[0]}
          maxLength={60}
          containerStyle={{ marginBottom: Spacing[3] }}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {RECAP_TITLE_PRESETS.map((preset) => (
            <Chip key={preset} label={preset} active={title === preset} onPress={() => onTitle(preset)} />
          ))}
        </ScrollView>

        <View style={[styles.segmented, { borderColor: c.border }]}>
          <FormatTab
            label="Slideshow"
            icon={<ImagesIcon size={15} color={format === 'slideshow' ? c.inverseText : c.muted} />}
            active={format === 'slideshow'}
            onPress={() => onFormat('slideshow')}
          />
          <FormatTab
            label="One image"
            icon={<SquareIcon size={15} color={format === 'single' ? c.inverseText : c.muted} />}
            active={format === 'single'}
            onPress={() => onFormat('single')}
          />
        </View>

        {format === 'slideshow' ? (
          <SlideshowPreview
            items={items}
            cardW={cardW}
            screenW={screenW}
            colors={c}
            accent={accent}
            handle={handle}
            heading={heading}
            range={range}
            setFrame={setFrame}
          />
        ) : (
          <View style={styles.singlePreview}>
            <View ref={setFrame('poster')} collapsable={false} style={[styles.frameMatte, { backgroundColor: c.background }]}>
              <RecapPoster
                colors={c}
                accent={accent}
                width={cardW}
                handle={handle}
                title={heading}
                dateRange={range}
                items={items}
              />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bar, { borderTopColor: c.border, backgroundColor: c.background }]}>
        {format === 'slideshow' ? (
          <>
            <Button
              label={ready ? `Save ${items.length + 1} to Photos` : 'Preparing…'}
              fullWidth
              loading={busy}
              disabled={!ready}
              onPress={() => void handleShareSlideshow()}
            />
            <Pressable onPress={() => void handleShareCover()} disabled={busy || !ready} style={styles.subAction}>
              <Text variant="monoSmall" color="muted">
                or share the cover →
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Button
              label={ready ? 'Share image' : 'Preparing…'}
              fullWidth
              loading={busy}
              disabled={!ready}
              onPress={() => void handleShareSingle()}
            />
            <Pressable onPress={() => void handleSaveSingle()} disabled={busy || !ready} style={styles.subAction}>
              <Text variant="monoSmall" color="muted">
                or save to Photos →
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </>
  );
}

function FormatTab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.segment, active && { backgroundColor: c.text }]}
    >
      {icon}
      <Text variant="monoSmall" style={{ color: active ? c.inverseText : c.muted, marginLeft: 6 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SlideshowPreview({
  items,
  cardW,
  screenW,
  colors,
  accent,
  handle,
  heading,
  range,
  setFrame,
}: {
  items: CaptureSummary[];
  cardW: number;
  screenW: number;
  colors: ReturnType<typeof useThemeColors>;
  accent: string;
  handle: string | null;
  heading: string;
  range: string;
  setFrame: (id: string) => (el: View | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      // Nested inside a vertical ScrollView, the horizontal pager doesn't
      // reliably adopt its pages' height and clips the bottom of each card
      // (the brand footer). Pin it to the exact page height: card + frameMatte
      // padding + page padding.
      style={[styles.pager, { height: cardW * RECAP_ASPECT + Spacing[5] * 2 + Spacing[4] * 2 }]}
    >
      <View style={[styles.page, { width: screenW }]}>
        <View ref={setFrame('cover')} collapsable={false} style={[styles.frameMatte, { backgroundColor: colors.background }]}>
          <RecapCoverCard
            colors={colors}
            accent={accent}
            width={cardW}
            handle={handle}
            title={heading}
            count={items.length}
            dateRange={range}
          />
        </View>
      </View>
      {items.map((item, i) => (
        <View key={item.id} style={[styles.page, { width: screenW }]}>
          <View ref={setFrame(item.id)} collapsable={false} style={[styles.frameMatte, { backgroundColor: colors.background }]}>
            <RecapNodeCard
              colors={colors}
              accent={accent}
              width={cardW}
              handle={handle}
              item={item}
              index={i}
              total={items.length}
            />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  bar: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[6],
    borderTopWidth: 1,
  },
  subAction: { alignSelf: 'center', paddingVertical: Spacing[3] },

  selectContent: { paddingBottom: Spacing[8] },
  search: { paddingHorizontal: Spacing[6], marginBottom: Spacing[2], marginTop: Spacing[4] },
  chipRow: {
    paddingHorizontal: Spacing[6],
    gap: Spacing[2],
    paddingVertical: Spacing[2],
  },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    maxWidth: 200,
  },
  selectHint: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
  },
  emptyWrap: { paddingTop: Spacing[16], paddingHorizontal: Spacing[8] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[4],
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, marginLeft: Spacing[4] },

  composeContent: { paddingTop: Spacing[5], paddingBottom: Spacing[8] },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.full,
    overflow: 'hidden',
    marginHorizontal: Spacing[6],
    marginTop: Spacing[4],
    marginBottom: Spacing[2],
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
  },

  pager: { marginTop: Spacing[4] },
  page: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing[4] },
  singlePreview: { alignItems: 'center', paddingVertical: Spacing[6] },
  // Matte around each captured card so the exported PNG is a filled rectangle
  // (no transparent corners) rather than a floating card on a transparent field.
  frameMatte: { padding: Spacing[5], borderRadius: Radius.xl },
});
