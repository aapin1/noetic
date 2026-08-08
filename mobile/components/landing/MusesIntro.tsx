import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type LayoutRectangle,
} from 'react-native';
import { FontFamily, FontSize, LetterSpacing, LineHeight, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import {
  Constellation,
  DOT,
  DOT_ALPHA,
  DOT_SIZE,
  SURVIVORS,
} from '@/components/landing/Constellation';

/**
 * Opacity beats read off ONE driver counting milliseconds, so the pacing is
 * legible in one place. The two motions that carry the piece — the collapse and
 * the morph — get their own eased drivers instead, because sampling a curve off
 * a linear clock leaves visible kinks in the velocity.
 */
const FIELD_IN = 600;
const FIELD_FULL = 1400;

const L0_AT = 250;
const L1_AT = 900;
const L2_AT = 1620;
const WORD_STAGGER = 85;
const WORD_DUR = 400;

const EDGES_OUT = 2250;
const EXTRAS_OUT = 2350;
const FIELD_OUT_DUR = 650;
const COLLAPSE_AT = 2350;
const COLLAPSE_DUR = 1000;

const NAMES_AT = 3200;
const NAME_STAGGER = 120;
const NAME_DUR = 450;
/** The glosses follow their names, so the row reads name-then-meaning. */
const MEANINGS_AT = 3600;

/** The three hold, still, long enough to actually be looked at. */
const SCENE_OUT = 6300;
const SCENE_OUT_DUR = 700;

/** The closing line arrives alone, on an empty screen, as one slow fade —
 * deliberately unlike the word-at-a-time openings. */
const L3_AT = 7150;
const L3_DUR = 1200;

/** The sentence lets go of its last word, which then travels on by itself. */
const SENTENCE_OUT = 8950;
const SENTENCE_OUT_DUR = 450;
const MORPH_AT = 9250;
const MORPH_DUR = 1150;

/** The screen behind starts rising before the word lands, so it reads as one
 * continuous motion rather than as two scenes. */
const HANDOFF_AT = MORPH_AT + MORPH_DUR - 250;
const TOTAL = MORPH_AT + MORPH_DUR;
const EXIT_MS = 260;

const LINE_0 = 'In Greek mythology,';
// Lower case: the clarifying line ends in a comma, so this continues it.
const LINE_1 = 'before the nine muses';
const LINE_2 = 'there were three.';
const CLOSING = ['This', 'one', 'is', 'for'];
const NAMES = ['melete', 'aoide', 'mneme'];
const MEANINGS = ['for practice', 'for song', 'for memory'];

/** The three opening statements are set at one size. Only colour separates them. */
const LINE_SIZE = FontSize['2xl'];
/**
 * The closing line is set in the WORDMARK's own metrics instead — tracked out,
 * a size down. It never shares the screen with the opening, so nothing clashes;
 * it rhymes with the three names, which are set the same way; and it means the
 * word that leaves it already IS the wordmark, so the morph is a pure
 * translation with no scale to interpolate and no letter-spacing seam.
 */
const CLOSING_SIZE = FontSize.xl;

/** Long, soft settle — most of the distance early, then a slow arrival. */
const SETTLE = Easing.bezier(0.16, 1, 0.3, 1);

type Box = LayoutRectangle | null;

interface Props {
  /** Where the real wordmark sits, in the coordinate space of the shared parent. */
  target: { x: number; y: number };
  /** Fired before the word lands, so the screen behind can start rising. */
  onHandoff: () => void;
  /** Fired once the word is home and this component can go. */
  onDone: () => void;
}

/** A line that arrives a word at a time rather than as a block. */
function Words({
  clock,
  at,
  text,
  color,
}: {
  clock: Animated.Value;
  at: number;
  text: string;
  color: string;
}) {
  return (
    <View style={styles.wordRow}>
      {text.split(' ').map((word, i) => {
        const start = at + i * WORD_STAGGER;
        return (
          <Animated.Text
            key={i}
            style={[
              styles.word,
              { color },
              {
                opacity: clock.interpolate({
                  inputRange: [start, start + WORD_DUR],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    translateY: clock.interpolate({
                      inputRange: [start, start + WORD_DUR * 0.35, start + WORD_DUR],
                      outputRange: [9, 2.4, 0],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          >
            {word}
          </Animated.Text>
        );
      })}
    </View>
  );
}

export function MusesIntro({ target, onHandoff, onDone }: Props) {
  const c = useThemeColors();
  const clock = useRef(new Animated.Value(0)).current;
  const collapse = useRef(new Animated.Value(0)).current;
  const morph = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const started = useRef(false);
  const leaving = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Held in refs so a re-render of the landing screen — which happens at the
  // handoff, mid-morph — can never restart or tear down the running timeline.
  const handoffRef = useRef(onHandoff);
  const doneRef = useRef(onDone);
  handoffRef.current = onHandoff;
  doneRef.current = onDone;

  // Both motions land on measured boxes rather than assumed geometry. Every box
  // resolves against the same parent, so they subtract cleanly — no assumption
  // about how Yoga insets absolutely-positioned children by padding.
  const [rootBox, setRootBox] = useState<Box>(null);
  const [namesBox, setNamesBox] = useState<Box>(null);
  const [colBoxes, setColBoxes] = useState<Box[]>([null, null, null]);
  const [dotBoxes, setDotBoxes] = useState<Box[]>([null, null, null]);
  const [closingBox, setClosingBox] = useState<Box>(null);
  const [closingRowBox, setClosingRowBox] = useState<Box>(null);
  const [mnemeBox, setMnemeBox] = useState<Box>(null);

  // Layout events are pooled, so every handler reads the box out before the
  // state updater runs — by then `nativeEvent` has already been recycled.
  const measure =
    (setter: React.Dispatch<React.SetStateAction<Box>>) =>
    (e: { nativeEvent: { layout: LayoutRectangle } }) => {
      const box = e.nativeEvent.layout;
      setter((prev) => prev ?? box);
    };

  const measureAt =
    (setter: React.Dispatch<React.SetStateAction<Box[]>>, i: number) =>
    (e: { nativeEvent: { layout: LayoutRectangle } }) => {
      const box = e.nativeEvent.layout;
      setter((prev) => (prev[i] ? prev : prev.map((v, j) => (j === i ? box : v))));
    };

  const ready =
    rootBox !== null &&
    namesBox !== null &&
    closingBox !== null &&
    closingRowBox !== null &&
    mnemeBox !== null &&
    colBoxes.every(Boolean) &&
    dotBoxes.every(Boolean);

  /** Where a survivor's dot starts: out on the constellation, relative to where
   * the names row will finally put it. */
  const scatterOffset = (i: number) => {
    if (!ready) return { x: 0, y: 0 };
    const restX = namesBox!.x + colBoxes[i]!.x + dotBoxes[i]!.x;
    const restY = namesBox!.y + colBoxes[i]!.y + dotBoxes[i]!.y;
    return {
      x: SURVIVORS[i].x * rootBox!.width - DOT_SIZE / 2 - restX,
      y: SURVIVORS[i].y * rootBox!.height - DOT_SIZE / 2 - restY,
    };
  };

  const delta = ready
    ? {
        x: target.x - rootBox!.x - (closingBox!.x + closingRowBox!.x + mnemeBox!.x),
        y: target.y - rootBox!.y - (closingBox!.y + closingRowBox!.y + mnemeBox!.y),
      }
    : { x: 0, y: 0 };

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;

    Animated.timing(clock, {
      toValue: TOTAL,
      duration: TOTAL,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();

    const run = (value: Animated.Value, at: number, duration: number) =>
      timers.current.push(
        setTimeout(() => {
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: SETTLE,
            useNativeDriver: true,
          }).start();
        }, at),
      );

    run(collapse, COLLAPSE_AT, COLLAPSE_DUR);
    run(morph, MORPH_AT, MORPH_DUR);

    timers.current.push(setTimeout(() => handoffRef.current(), HANDOFF_AT));
    timers.current.push(
      setTimeout(() => {
        leaving.current = true;
        doneRef.current();
      }, TOTAL),
    );
  }, [clock, collapse, morph, ready]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const skip = () => {
    if (leaving.current) return;
    leaving.current = true;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    clock.stopAnimation();
    collapse.stopAnimation();
    morph.stopAnimation();
    handoffRef.current();
    Animated.timing(exit, {
      toValue: 1,
      duration: EXIT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => doneRef.current());
  };

  const fadeField = (out: number) =>
    clock.interpolate({
      inputRange: [FIELD_IN, FIELD_FULL, out, out + FIELD_OUT_DUR],
      outputRange: [0, 1, 1, 0],
      extrapolate: 'clamp',
    });

  /** The whole first scene — the three statements and the three names — holds,
   * then goes together, leaving the screen empty for the closing line. */
  const sceneOpacity = clock.interpolate({
    inputRange: [0, SCENE_OUT, SCENE_OUT + SCENE_OUT_DUR],
    outputRange: [1, 1, 0],
    extrapolate: 'clamp',
  });

  const dotOpacity = clock.interpolate({
    inputRange: [FIELD_IN, FIELD_FULL],
    outputRange: [0, DOT_ALPHA],
    extrapolate: 'clamp',
  });

  const stagger = (at: number, i: number, dur: number) => ({
    opacity: clock.interpolate({
      inputRange: [at + i * NAME_STAGGER, at + i * NAME_STAGGER + dur],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateY: clock.interpolate({
          inputRange: [
            at + i * NAME_STAGGER,
            at + i * NAME_STAGGER + dur * 0.35,
            at + i * NAME_STAGGER + dur,
          ],
          outputRange: [10, 2.6, 0],
          extrapolate: 'clamp',
        }),
      },
    ],
  });

  const closingOpacity = clock.interpolate({
    inputRange: [L3_AT, L3_AT + L3_DUR],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  /** Everything in the closing line except the word that leaves it. */
  const sentenceOpacity = clock.interpolate({
    inputRange: [0, SENTENCE_OUT, SENTENCE_OUT + SENTENCE_OUT_DUR],
    outputRange: [1, 1, 0],
    extrapolate: 'clamp',
  });

  const travel = (axis: 'x' | 'y') =>
    morph.interpolate({ inputRange: [0, 1], outputRange: [0, delta[axis]] });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.root,
        { opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
      ]}
      onLayout={measure(setRootBox)}
    >
      {rootBox && (
        <Constellation
          width={rootBox.width}
          height={rootBox.height}
          pointOpacity={fadeField(EXTRAS_OUT)}
          edgeOpacity={fadeField(EDGES_OUT)}
        />
      )}

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={skip}
        accessibilityLabel="Skip the introduction"
        accessibilityRole="button"
      />

      <Animated.View style={{ opacity: sceneOpacity }} pointerEvents="none">
        <Words clock={clock} at={L0_AT} text={LINE_0} color={c.muted} />
        <Words clock={clock} at={L1_AT} text={LINE_1} color={c.text} />
        <Words clock={clock} at={L2_AT} text={LINE_2} color={c.text} />

        <View style={styles.names} onLayout={measure(setNamesBox)}>
          {NAMES.map((name, i) => (
            <View key={name} style={styles.nameCol} onLayout={measureAt(setColBoxes, i)}>
              <Animated.Text
                onLayout={measureAt(setDotBoxes, i)}
                style={[
                  styles.dot,
                  { color: c.text },
                  {
                    opacity: dotOpacity,
                    transform: [
                      {
                        translateX: collapse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [scatterOffset(i).x, 0],
                        }),
                      },
                      {
                        translateY: collapse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [scatterOffset(i).y, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {DOT}
              </Animated.Text>

              <Animated.View style={stagger(NAMES_AT, i, NAME_DUR)}>
                <Text variant="wordmark">{name}</Text>
              </Animated.View>

              <Animated.View style={[styles.meaning, stagger(MEANINGS_AT, i, NAME_DUR)]}>
                <Text variant="monoSmall" color="muted">
                  {MEANINGS[i]}
                </Text>
              </Animated.View>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View
        style={[StyleSheet.absoluteFill, styles.closing, { opacity: closingOpacity }]}
        onLayout={measure(setClosingBox)}
        pointerEvents="none"
      >
        <View style={styles.wordRow} onLayout={measure(setClosingRowBox)}>
          {CLOSING.map((word) => (
            <Animated.Text
              key={word}
              style={[styles.closingWord, { color: c.text }, { opacity: sentenceOpacity }]}
            >
              {word}
            </Animated.Text>
          ))}

          {/* No right margin: the word's own trailing letter-space is exactly
              the gap a full stop wants, and the period below opens with none. */}
          <Animated.View
            onLayout={measure(setMnemeBox)}
            style={[
              styles.closingWordBox,
              { marginRight: 0 },
              { transform: [{ translateX: travel('x') }, { translateY: travel('y') }] },
            ]}
          >
            <Text variant="wordmark">mneme</Text>
          </Animated.View>

          <Animated.Text
            style={[
              styles.closingWord,
              { color: c.text },
              { marginLeft: 0, opacity: sentenceOpacity },
            ]}
          >
            .
          </Animated.Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  closing: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  wordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    fontFamily: FontFamily.serif,
    fontSize: LINE_SIZE,
    lineHeight: LINE_SIZE * LineHeight.snug,
    letterSpacing: LetterSpacing.tight,
    marginHorizontal: 3.5,
  },
  // The closing line, set in the wordmark's metrics so its last word can leave
  // and land without changing shape.
  closingWord: {
    fontFamily: FontFamily.serif,
    fontSize: CLOSING_SIZE,
    lineHeight: CLOSING_SIZE * LineHeight.snug,
    letterSpacing: LetterSpacing.wider,
    marginHorizontal: 3.5,
  },
  closingWordBox: { marginHorizontal: 3.5 },
  names: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: Spacing[8],
  },
  nameCol: {
    alignItems: 'center',
    marginHorizontal: Spacing[3],
  },
  dot: {
    fontFamily: FontFamily.mono,
    fontSize: DOT_SIZE,
    lineHeight: DOT_SIZE,
    marginBottom: Spacing[3],
  },
  meaning: { marginTop: Spacing[2] },
});
