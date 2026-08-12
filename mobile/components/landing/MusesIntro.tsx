import React, { useCallback, useEffect, useRef, useState } from 'react';
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

/** The web lets go BEFORE the three fall, so no edge is ever left pointing at a
 * vertex its point has already vacated. */
const EDGES_OUT = 1700;
const EXTRAS_OUT = 2350;
const FIELD_OUT_DUR = 650;
const COLLAPSE_AT = 2350;
const COLLAPSE_DUR = 1000;

const NAMES_AT = 3200;
const NAME_STAGGER = 120;
const NAME_DUR = 450;
/** The glosses follow their names, so the row reads name-then-meaning. */
const MEANINGS_AT = 3600;

/** The three hold, still, long enough to actually be READ — all three names and
 * all three glosses — not merely glimpsed. Four seconds after the last gloss
 * lands: slow on purpose, because this is the screen that has to stick. */
const SCENE_OUT = 8300;
const SCENE_OUT_DUR = 700;

/** The closing line arrives alone, on an empty screen, as one slow fade —
 * deliberately unlike the word-at-a-time openings. */
const L3_AT = 9150;
const L3_DUR = 1200;

/** The sentence lets go of its last word, which then travels on by itself. */
const SENTENCE_OUT = 10950;
const SENTENCE_OUT_DUR = 450;
const MORPH_AT = 11250;
const MORPH_DUR = 1150;

/** The travelling word reads its own position and its destination off the
 * native tree a beat before it sets off, so the landing spot is the wordmark's
 * real place on screen rather than a sum of assumed parent geometry. */
const MEASURE_AT = MORPH_AT - 300;

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
  /** The real wordmark itself, so the word can be sent to where it actually is. */
  targetRef: React.RefObject<View | null>;
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

export function MusesIntro({ targetRef, onHandoff, onDone }: Props) {
  const c = useThemeColors();
  const clock = useRef(new Animated.Value(0)).current;
  const collapse = useRef(new Animated.Value(0)).current;
  const morph = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const started = useRef(false);
  const leaving = useRef(false);
  /** Which half of the piece is on screen — the opening, or the dedication. */
  const atClosing = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Held in refs so a re-render of the landing screen — which happens at the
  // handoff, mid-morph — can never restart or tear down the running timeline.
  const handoffRef = useRef(onHandoff);
  const doneRef = useRef(onDone);
  handoffRef.current = onHandoff;
  doneRef.current = onDone;

  // The collapse lands on measured boxes rather than assumed geometry. Every box
  // resolves against the same parent, so they subtract cleanly — no assumption
  // about how Yoga insets absolutely-positioned children by padding.
  const [rootBox, setRootBox] = useState<Box>(null);
  const [sceneBox, setSceneBox] = useState<Box>(null);
  const [namesBox, setNamesBox] = useState<Box>(null);
  const [colBoxes, setColBoxes] = useState<Box[]>([null, null, null]);
  const [dotBoxes, setDotBoxes] = useState<Box[]>([null, null, null]);

  // The morph does NOT: a chain of nested boxes is only ever as right as its
  // weakest link, and one wrong term put the word down above the wordmark, so it
  // visibly dropped into place the instant this component retired. Both nodes
  // are read in window coordinates instead, at MEASURE_AT — nothing between them
  // and the window is scaled or rotated, so the difference IS the translation.
  const wordRef = useRef<View>(null);
  const [delta, setDelta] = useState({ x: 0, y: 0 });

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
    sceneBox !== null &&
    namesBox !== null &&
    colBoxes.every(Boolean) &&
    dotBoxes.every(Boolean);

  /**
   * Where a survivor's dot starts: on its own point in the constellation,
   * expressed relative to where the names row will finally put it.
   *
   * Every level between the two has to be in the sum. The scene wrapper in
   * particular is centred inside the root rather than filling it, so leaving it
   * out offsets all three dots off their points — which is exactly what made
   * them look like they were merely sliding down out of the text.
   */
  const scatterOffset = (i: number) => {
    if (!ready) return { x: 0, y: 0 };
    const restX = sceneBox!.x + namesBox!.x + colBoxes[i]!.x + dotBoxes[i]!.x;
    const restY = sceneBox!.y + namesBox!.y + colBoxes[i]!.y + dotBoxes[i]!.y;
    return {
      x: SURVIVORS[i].x * rootBox!.width - DOT_SIZE / 2 - restX,
      y: SURVIVORS[i].y * rootBox!.height - DOT_SIZE / 2 - restY,
    };
  };

  /**
   * Plays the timeline from `from` onward. Written to be re-entered rather than
   * merely started, because a tap during the opening moves the piece ON to its
   * dedication instead of throwing it away — the three muses are skippable, the
   * line they are there to set up is not.
   */
  const schedule = useCallback(
    (from: number) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];

      clock.stopAnimation();
      clock.setValue(from);
      Animated.timing(clock, {
        toValue: TOTAL,
        duration: TOTAL - from,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();

      const at = (ms: number, fn: () => void) =>
        timers.current.push(setTimeout(fn, Math.max(0, ms - from)));

      // The collapse belongs to the opening. Landing past it means it has
      // already happened — not that it should now happen all at once.
      if (from >= COLLAPSE_AT) {
        collapse.setValue(1);
      } else {
        at(COLLAPSE_AT, () =>
          Animated.timing(collapse, {
            toValue: 1,
            duration: COLLAPSE_DUR,
            easing: SETTLE,
            useNativeDriver: true,
          }).start(),
        );
      }

      at(L3_AT, () => {
        atClosing.current = true;
      });

      // Both reads are native round-trips, so they are taken 300ms early and the
      // morph keeps its own start time. If either node declines to answer the
      // delta stays zero and the word simply leaves with the rest of the line —
      // better than flying it to a position nobody measured.
      at(MEASURE_AT, () => {
        targetRef.current?.measureInWindow((tx, ty) => {
          wordRef.current?.measureInWindow((wx, wy) => setDelta({ x: tx - wx, y: ty - wy }));
        });
      });

      at(MORPH_AT, () =>
        Animated.timing(morph, {
          toValue: 1,
          duration: MORPH_DUR,
          easing: SETTLE,
          useNativeDriver: true,
        }).start(),
      );

      at(HANDOFF_AT, () => handoffRef.current());
      at(TOTAL, () => {
        leaving.current = true;
        doneRef.current();
      });
    },
    [clock, collapse, morph, targetRef],
  );

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    schedule(0);
  }, [ready, schedule]);

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

  /**
   * A tap on the opening jumps to the dedication; a tap on the dedication
   * leaves. So the three muses are skippable, but the line they exist to set up
   * still gets said — and nobody is ever more than two taps from the app.
   */
  const advance = () => {
    if (leaving.current) return;
    if (atClosing.current) {
      skip();
      return;
    }
    // Set here rather than left to schedule's own 0ms cue, so a fast double tap
    // reads as opening-then-dedication instead of jumping to L3_AT twice.
    atClosing.current = true;
    schedule(L3_AT);
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
        onPress={advance}
        accessibilityLabel="Skip ahead"
        accessibilityRole="button"
      />

      <Animated.View
        style={[styles.scene, { opacity: sceneOpacity }]}
        onLayout={measure(setSceneBox)}
        pointerEvents="none"
      >
        <Words clock={clock} at={L0_AT} text={LINE_0} color={c.text} />
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
        pointerEvents="none"
      >
        <View style={styles.wordRow}>
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
            ref={wordRef}
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
  // No padding here: the constellation fills this box, and the survivors' start
  // points are expressed as fractions of it. Any inset would shift the field out
  // from under the dots. The text carries its own padding instead.
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scene: {
    alignSelf: 'stretch',
    alignItems: 'center',
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
