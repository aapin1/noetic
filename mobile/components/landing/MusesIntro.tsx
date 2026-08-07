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
const FIELD_IN = 700;
const FIELD_FULL = 1500;

const L1_AT = 350;
const L2_AT = 1250;
const WORD_STAGGER = 105;
const WORD_DUR = 500;

const EDGES_OUT = 2050;
const EXTRAS_OUT = 2150;
const FIELD_OUT_DUR = 700;
const COLLAPSE_AT = 2150;
const COLLAPSE_DUR = 1050;

const NAMES_AT = 3100;
const NAME_STAGGER = 130;
const NAME_DUR = 500;

const DIM_AT = 4050;
const DIM_DUR = 600;
const L3_AT = 4100;

/** The two who do not survive leave FIRST, and are gone before the last word
 * moves. Overlapping them with the morph read as Mneme escaping rather than as
 * the other two dissolving. */
const PART_AT = 5700;
const PART_DUR = 650;
/** The statements clear next, so the word crosses an empty screen. */
const TEXT_OUT = 5900;
const TEXT_OUT_DUR = 550;

const MORPH_AT = 6500;
const MORPH_DUR = 1150;
/** The screen behind starts rising before the word lands, so it reads as one
 * continuous motion rather than as two scenes. */
const HANDOFF_AT = MORPH_AT + MORPH_DUR - 250;
const TOTAL = MORPH_AT + MORPH_DUR;
const EXIT_MS = 260;

/** How far the two who leave rise as they fade — back up towards the
 * constellation they came down from. Drifting them sideways instead put Aoide
 * straight through Mneme, which is the one word that must stay legible. */
const PART_BY = 16;

const LINE_1 = 'Before the nine muses';
const LINE_2 = 'there were three.';
const LINE_3 = 'This one is for mneme.';
const NAMES = ['melete', 'aoide', 'mneme'];
/** The one that survives, and the only one the morph cares about. */
const MNEME = 2;

/** Both statements are set at one size. Only colour separates them. */
const LINE_SIZE = FontSize['2xl'];

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
  const part = useRef(new Animated.Value(0)).current;
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
  const [rowBox, setRowBox] = useState<Box>(null);
  const [colBoxes, setColBoxes] = useState<Box[]>([null, null, null]);
  const [dotBoxes, setDotBoxes] = useState<Box[]>([null, null, null]);
  const [wordBox, setWordBox] = useState<Box>(null);

  const measureAt =
    (setter: React.Dispatch<React.SetStateAction<Box[]>>, i: number) =>
    (e: { nativeEvent: { layout: LayoutRectangle } }) => {
      // Read the layout out of the event first: it is pooled, so by the time the
      // state updater runs `nativeEvent` has already been recycled.
      const box = e.nativeEvent.layout;
      setter((prev) => (prev[i] ? prev : prev.map((v, j) => (j === i ? box : v))));
    };

  const ready =
    rootBox !== null &&
    rowBox !== null &&
    wordBox !== null &&
    colBoxes.every(Boolean) &&
    dotBoxes.every(Boolean);

  /** Where a survivor's dot starts: out on the constellation, relative to where
   * the names row will finally put it. */
  const scatterOffset = (i: number) => {
    if (!ready) return { x: 0, y: 0 };
    const restX = rowBox!.x + colBoxes[i]!.x + dotBoxes[i]!.x;
    const restY = rowBox!.y + colBoxes[i]!.y + dotBoxes[i]!.y;
    return {
      x: SURVIVORS[i].x * rootBox!.width - DOT_SIZE / 2 - restX,
      y: SURVIVORS[i].y * rootBox!.height - DOT_SIZE / 2 - restY,
    };
  };

  const delta = ready
    ? {
        x: target.x - rootBox!.x - (rowBox!.x + colBoxes[MNEME]!.x + wordBox!.x),
        y: target.y - rootBox!.y - (rowBox!.y + colBoxes[MNEME]!.y + wordBox!.y),
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
    run(part, PART_AT, PART_DUR);
    run(morph, MORPH_AT, MORPH_DUR);

    timers.current.push(setTimeout(() => handoffRef.current(), HANDOFF_AT));
    timers.current.push(
      setTimeout(() => {
        leaving.current = true;
        doneRef.current();
      }, TOTAL),
    );
  }, [clock, collapse, morph, part, ready]);

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
    part.stopAnimation();
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

  // The opening statement holds, dims behind the closing line, then goes.
  const openingOpacity = clock.interpolate({
    inputRange: [0, DIM_AT, DIM_AT + DIM_DUR, TEXT_OUT, TEXT_OUT + TEXT_OUT_DUR],
    outputRange: [1, 1, 0.3, 0.3, 0],
    extrapolate: 'clamp',
  });

  const closingOpacity = clock.interpolate({
    inputRange: [0, TEXT_OUT, TEXT_OUT + TEXT_OUT_DUR],
    outputRange: [1, 1, 0],
    extrapolate: 'clamp',
  });

  // Every dot arrives at the constellation's own weight. Two leave with their
  // names; Mneme's goes early into the morph, so nothing trails the wordmark.
  const dotOpacity = (i: number) =>
    clock.interpolate({
      inputRange:
        i === MNEME
          ? [FIELD_IN, FIELD_FULL, MORPH_AT, MORPH_AT + 450]
          : [FIELD_IN, FIELD_FULL, PART_AT, PART_AT + PART_DUR],
      outputRange: [0, DOT_ALPHA, DOT_ALPHA, 0],
      extrapolate: 'clamp',
    });

  const nameOpacity = (i: number) => {
    const at = NAMES_AT + i * NAME_STAGGER;
    return i === MNEME
      ? clock.interpolate({
          inputRange: [at, at + NAME_DUR],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        })
      : clock.interpolate({
          inputRange: [at, at + NAME_DUR, PART_AT, PART_AT + PART_DUR],
          outputRange: [0, 1, 1, 0],
          extrapolate: 'clamp',
        });
  };

  const nameRise = (i: number) => {
    const at = NAMES_AT + i * NAME_STAGGER;
    return clock.interpolate({
      inputRange: [at, at + NAME_DUR * 0.35, at + NAME_DUR],
      outputRange: [10, 2.6, 0],
      extrapolate: 'clamp',
    });
  };

  /** Melete and Aoide rise away on their own driver; Mneme heads for the corner
   * on the morph, a beat later. */
  const leave = (i: number, axis: 'x' | 'y') =>
    i === MNEME
      ? morph.interpolate({ inputRange: [0, 1], outputRange: [0, delta[axis]] })
      : part.interpolate({
          inputRange: [0, 1],
          outputRange: [0, axis === 'y' ? -PART_BY : 0],
        });

  const dotTravel = (i: number, axis: 'x' | 'y') =>
    Animated.add(
      collapse.interpolate({ inputRange: [0, 1], outputRange: [scatterOffset(i)[axis], 0] }),
      leave(i, axis),
    );

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.root,
        { opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
      ]}
      onLayout={(e) => {
        const box = e.nativeEvent.layout;
        setRootBox((prev) => prev ?? box);
      }}
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

      <Animated.View style={{ opacity: openingOpacity }} pointerEvents="none">
        <Words clock={clock} at={L1_AT} text={LINE_1} color={c.text} />
        <Words clock={clock} at={L2_AT} text={LINE_2} color={c.text} />
      </Animated.View>

      <Animated.View
        style={styles.names}
        onLayout={(e) => {
          const box = e.nativeEvent.layout;
          setRowBox((prev) => prev ?? box);
        }}
        pointerEvents="none"
      >
        {NAMES.map((name, i) => (
          <View key={name} style={styles.nameCol} onLayout={measureAt(setColBoxes, i)}>
            <Animated.Text
              onLayout={measureAt(setDotBoxes, i)}
              style={[
                styles.dot,
                { color: c.text },
                {
                  opacity: dotOpacity(i),
                  transform: [
                    { translateX: dotTravel(i, 'x') },
                    { translateY: dotTravel(i, 'y') },
                  ],
                },
              ]}
            >
              {DOT}
            </Animated.Text>

            <Animated.View
              onLayout={i === MNEME ? (e) => {
                const box = e.nativeEvent.layout;
                setWordBox((prev) => prev ?? box);
              } : undefined}
              style={{
                opacity: nameOpacity(i),
                transform: [
                  { translateX: leave(i, 'x') },
                  { translateY: Animated.add(nameRise(i), leave(i, 'y')) },
                ],
              }}
            >
              <Text variant="wordmark">{name}</Text>
            </Animated.View>
          </View>
        ))}
      </Animated.View>

      <Animated.View style={{ opacity: closingOpacity }} pointerEvents="none">
        <Words clock={clock} at={L3_AT} text={LINE_3} color={c.muted} />
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
  wordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  word: {
    fontFamily: FontFamily.serif,
    fontSize: LINE_SIZE,
    lineHeight: LINE_SIZE * LineHeight.snug,
    letterSpacing: LetterSpacing.tight,
    marginHorizontal: 3.5,
  },
  names: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: Spacing[8],
    marginBottom: Spacing[8],
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
});
