import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  type LayoutRectangle,
} from 'react-native';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';

/**
 * The whole sequence runs off ONE driver counting milliseconds, so every beat
 * below is read straight off the same clock and the pacing lives in one place.
 */
const A_IN = 300;
const A_DUR = 600;
const B_IN = 1500;
const B_DUR = 600;
const DIM_AT = 2700;
const DIM_DUR = 600;
const C_IN = 2700;
const C_DUR = 600;
const MORPH_AT = 4000;
const MORPH_DUR = 600;
/** How long the lines that are leaving take to go, starting with the morph. */
const LEAVE_DUR = 400;
/** The screen behind starts rising just before the word lands, so it reads as
 * one continuous motion rather than as two scenes. */
const HANDOFF_AT = 4400;
const TOTAL = MORPH_AT + MORPH_DUR;
const EXIT_MS = 220;

/** How far Melete and Aoide drift apart as they go. */
const PART_BY = 14;

interface Props {
  /** Where the real wordmark sits, in the coordinate space of the shared parent. */
  target: { x: number; y: number };
  /** Fired just before the word lands, so the screen behind can start rising. */
  onHandoff: () => void;
  /** Fired once the word is home and this component can go. */
  onDone: () => void;
}

/** A fade-and-rise entrance, sampled off the shared clock. */
function entrance(clock: Animated.Value, at: number, dur: number) {
  return clock.interpolate({
    inputRange: [at, at + dur * 0.25, at + dur * 0.5, at + dur],
    outputRange: [10, 4.2, 1.25, 0],
    extrapolate: 'clamp',
  });
}

export function MusesIntro({ target, onHandoff, onDone }: Props) {
  const clock = useRef(new Animated.Value(0)).current;
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

  // The morph is a pure translation: the names are already set in the wordmark
  // variant, so the word that travels IS the wordmark by the time it arrives —
  // no scale, no cross-fade, nothing to seam. Getting there needs the offset
  // between where the word was laid out and where the real wordmark sits, and
  // every box below is measured against the same parent so they subtract.
  const [rootBox, setRootBox] = useState<LayoutRectangle | null>(null);
  const [rowBox, setRowBox] = useState<LayoutRectangle | null>(null);
  const [wordBox, setWordBox] = useState<LayoutRectangle | null>(null);

  const delta =
    rootBox && rowBox && wordBox
      ? {
          x: target.x - rootBox.x - (rowBox.x + wordBox.x),
          y: target.y - rootBox.y - (rowBox.y + wordBox.y),
        }
      : null;
  const ready = delta !== null;

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;

    Animated.timing(clock, {
      toValue: TOTAL,
      duration: TOTAL,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();

    timers.current.push(setTimeout(() => handoffRef.current(), HANDOFF_AT));
    timers.current.push(
      setTimeout(() => {
        leaving.current = true;
        doneRef.current();
      }, TOTAL),
    );
  }, [clock, ready]);

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
    handoffRef.current();
    Animated.timing(exit, {
      toValue: 1,
      duration: EXIT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => doneRef.current());
  };

  // Opening lines: in, hold, dim behind the closing line, then out.
  const openingOpacity = clock.interpolate({
    inputRange: [A_IN, A_IN + A_DUR, DIM_AT, DIM_AT + DIM_DUR, MORPH_AT, MORPH_AT + LEAVE_DUR],
    outputRange: [0, 1, 1, 0.3, 0.3, 0],
    extrapolate: 'clamp',
  });

  // The two muses who do not survive the myth.
  const partingOpacity = clock.interpolate({
    inputRange: [B_IN, B_IN + B_DUR, MORPH_AT, MORPH_AT + LEAVE_DUR],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });

  const closingOpacity = clock.interpolate({
    inputRange: [C_IN, C_IN + C_DUR, MORPH_AT, MORPH_AT + LEAVE_DUR],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });

  // Mneme arrives with the others and never leaves.
  const mnemeOpacity = clock.interpolate({
    inputRange: [B_IN, B_IN + B_DUR],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const rise = entrance(clock, B_IN, B_DUR);

  const parting = (direction: -1 | 1) =>
    clock.interpolate({
      inputRange: [MORPH_AT, MORPH_AT + MORPH_DUR],
      outputRange: [0, PART_BY * direction],
      extrapolate: 'clamp',
    });

  // Sampled off an ease-out cubic, so the word leaves quickly and settles slowly.
  const travel = clock.interpolate({
    inputRange: [
      MORPH_AT,
      MORPH_AT + MORPH_DUR * 0.25,
      MORPH_AT + MORPH_DUR * 0.5,
      MORPH_AT + MORPH_DUR * 0.75,
      MORPH_AT + MORPH_DUR,
    ],
    outputRange: [0, 0.578, 0.875, 0.984, 1],
    extrapolate: 'clamp',
  });
  const travelTo = (distance: number) =>
    travel.interpolate({ inputRange: [0, 1], outputRange: [0, distance] });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.root,
        { opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
      ]}
      onLayout={(e) => {
        // Read the layout out of the event first: it is pooled, so by the time
        // the state updater runs `nativeEvent` has already been recycled.
        const box = e.nativeEvent.layout;
        setRootBox((prev) => prev ?? box);
      }}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={skip}
        accessibilityLabel="Skip the introduction"
        accessibilityRole="button"
      />

      <Animated.View
        style={{ opacity: openingOpacity, transform: [{ translateY: entrance(clock, A_IN, A_DUR) }] }}
        pointerEvents="none"
      >
        <Text variant="h2" style={styles.line}>
          Before the nine muses{'\n'}there were three.
        </Text>
      </Animated.View>

      <Animated.View
        style={styles.names}
        onLayout={(e) => {
          const box = e.nativeEvent.layout;
          setRowBox((prev) => prev ?? box);
        }}
        pointerEvents="none"
      >
        <Animated.View
          style={[
            styles.name,
            { opacity: partingOpacity, transform: [{ translateX: parting(-1) }, { translateY: rise }] },
          ]}
        >
          <Text variant="wordmark">melete</Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.name,
            { opacity: partingOpacity, transform: [{ translateX: parting(1) }, { translateY: rise }] },
          ]}
        >
          <Text variant="wordmark">aoide</Text>
        </Animated.View>

        <Animated.View
          onLayout={(e) => {
            const box = e.nativeEvent.layout;
            setWordBox((prev) => prev ?? box);
          }}
          style={[
            styles.name,
            {
              opacity: mnemeOpacity,
              transform: [
                { translateX: travelTo(delta?.x ?? 0) },
                { translateY: Animated.add(rise, travelTo(delta?.y ?? 0)) },
              ],
            },
          ]}
        >
          <Text variant="wordmark">mneme</Text>
        </Animated.View>
      </Animated.View>

      <Animated.View
        style={{ opacity: closingOpacity, transform: [{ translateY: entrance(clock, C_IN, C_DUR) }] }}
        pointerEvents="none"
      >
        <Text variant="serif" color="muted" style={styles.line}>
          This one is for mneme.
        </Text>
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
  line: { textAlign: 'center' },
  names: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing[6],
    marginBottom: Spacing[6],
  },
  name: { marginHorizontal: Spacing[3] },
});
