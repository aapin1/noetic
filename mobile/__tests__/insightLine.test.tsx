/**
 * The insight row, rendered for real. A READING is a line and then one move
 * made on it, and the reading names its own move (evidence.kicker) — the row
 * has to show that name as the note's label, whatever it is, and never invent
 * one when the reading didn't.
 */
import React from 'react';
import { screen } from '@testing-library/react-native';

import { renderScreen } from './helpers/render';

import { InsightLine } from '@/components/InsightLine';
import type { InsightCard } from '@/types/api';

const LINE = 'Public speaking nerves are a training problem, not a personality trait.';
const NOTE = 'If that were true, the tenth rehearsal would be calmer than the first for everyone.';

const card = (type: InsightCard['type'], evidence: unknown = null): InsightCard => ({
  id: `ins_${type}`,
  type,
  headline: LINE,
  body: NOTE,
  strength: 1,
  evidence,
});

describe('InsightLine', () => {
  it('renders a READING as a line and a note labelled with the move the reading chose', async () => {
    await renderScreen(<InsightLine insight={card('READING', { kicker: 'the test' })} />);

    expect(screen.getByText('reading')).toBeTruthy();
    expect(screen.getByText(LINE)).toBeTruthy();
    expect(screen.getByText('the test')).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it('shows whichever move the reading named — there is no fixed label', async () => {
    await renderScreen(<InsightLine insight={card('READING', { kicker: 'where it comes from' })} />);

    expect(screen.getByText('where it comes from')).toBeTruthy();
    expect(screen.queryByText('the catch')).toBeNull();
    expect(screen.queryByText('the test')).toBeNull();
  });

  it('shows the note unlabelled when the reading named no move', async () => {
    await renderScreen(<InsightLine insight={card('READING', { grounding: 'rich' })} />);

    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.queryByText('the catch')).toBeNull();
  });

  it('labels the MIRROR as a read on the person and ignores any kicker on it', async () => {
    await renderScreen(<InsightLine insight={card('MIRROR', { kicker: 'the test' })} />);

    expect(screen.getByText('a read on you')).toBeTruthy();
    expect(screen.queryByText('the test')).toBeNull();
  });

  it('shows no note label on graph-derived kinds', async () => {
    await renderScreen(<InsightLine insight={card('NOVELTY', { kicker: 'the test' })} />);

    expect(screen.getByText('novelty')).toBeTruthy();
    expect(screen.queryByText('the test')).toBeNull();
  });

  it('drops the note label with the body in compact mode', async () => {
    await renderScreen(<InsightLine insight={card('READING', { kicker: 'the test' })} compact />);

    expect(screen.getByText('reading')).toBeTruthy();
    expect(screen.queryByText('the test')).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
