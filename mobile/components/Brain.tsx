import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';
import { useThemeColors } from '@/contexts/ThemeContext';

interface Props {
  size?: number;
  density?: number;
  intensity?: number;
  showLines?: boolean;
}

type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  base: number;
};

const FRAME_MS = 1000 / 24;

function makeBrainShape(): { x: number; y: number }[] {
  const shape: { x: number; y: number }[] = [];

  for (let t = 0; t <= Math.PI * 2; t += Math.PI / 90) {
    const x = 0.95 * Math.cos(t);
    const y = 0.78 * Math.sin(t) + 0.06 * Math.sin(t * 4);
    shape.push({ x, y });
  }

  return shape;
}

function pointInShape(x: number, y: number, shape: { x: number; y: number }[]): boolean {
  let inside = false;

  for (let i = 0, j = shape.length - 1; i < shape.length; j = i, i += 1) {
    const a = shape[i];
    const b = shape[j];
    const intersect = ((a.y > y) !== (b.y > y)) && (x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 1e-9) + a.x);

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function buildNodes(count: number, seed: number): Node[] {
  const rnd = seededRandom(seed);
  const shape = makeBrainShape();
  const nodes: Node[] = [];

  while (nodes.length < count) {
    const x = (rnd() - 0.5) * 2;
    const y = (rnd() - 0.5) * 2;

    if (!pointInShape(x, y, shape)) {
      continue;
    }

    const baseR = 1.4 + rnd() * 1.6;
    nodes.push({
      x,
      y,
      vx: (rnd() - 0.5) * 0.0008,
      vy: (rnd() - 0.5) * 0.0008,
      r: baseR,
      base: baseR,
    });
  }

  return nodes;
}

export function Brain({ size = 220, density = 64, intensity = 1, showLines = true }: Props) {
  const c = useThemeColors();
  const seedRef = useRef(Math.floor(Math.random() * 100000) + 1);
  const initialNodes = useMemo(() => buildNodes(density, seedRef.current), [density]);
  const positionsRef = useRef<Node[]>(initialNodes.map((node) => ({ ...node })));
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const shape = useMemo(() => makeBrainShape(), []);

  useEffect(() => {
    let mounted = true;
    let lastT = Date.now();

    const tick = () => {
      if (!mounted) return;
      const now = Date.now();
      const elapsed = (now - lastT) / 16;
      lastT = now;
      const next = positionsRef.current.map((node) => ({ ...node }));

      for (const node of next) {
        node.x += node.vx * elapsed * 16;
        node.y += node.vy * elapsed * 16;

        if (!pointInShape(node.x, node.y, shape)) {
          node.vx *= -1;
          node.vy *= -1;
          node.x = Math.max(-0.93, Math.min(0.93, node.x));
          node.y = Math.max(-0.76, Math.min(0.76, node.y));
        }

        const pulse = 0.85 + 0.3 * Math.sin((now / 1100 + node.x * 8 + node.y * 7) * intensity);
        node.r = node.base * pulse;
      }

      positionsRef.current = next;
      setNodes(next);
      timer = setTimeout(tick, FRAME_MS);
    };

    let timer = setTimeout(tick, FRAME_MS);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [shape, intensity]);

  const half = size / 2;
  const project = (n: number) => half + n * (half - 8);
  const lineThreshold = 0.34;
  const stroke = c.graphNode;

  const lines = useMemo(() => {
    if (!showLines) return [];
    const list: { from: Node; to: Node; opacity: number }[] = [];

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > lineThreshold) continue;

        list.push({ from: nodes[i], to: nodes[j], opacity: 0.22 - distance * 0.55 });
      }
    }

    return list;
  }, [nodes, showLines]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <Svg width={size} height={size}>
        <G>
          {lines.map((line, idx) => (
            <Line
              key={`l-${idx}`}
              x1={project(line.from.x)}
              y1={project(line.from.y)}
              x2={project(line.to.x)}
              y2={project(line.to.y)}
              stroke={c.graphLine}
              strokeOpacity={Math.max(0, Math.min(0.4, line.opacity))}
              strokeWidth={0.6}
            />
          ))}
          {nodes.map((node, idx) => (
            <Circle
              key={`n-${idx}`}
              cx={project(node.x)}
              cy={project(node.y)}
              r={Math.max(0.6, node.r)}
              fill={stroke}
              fillOpacity={0.85}
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
