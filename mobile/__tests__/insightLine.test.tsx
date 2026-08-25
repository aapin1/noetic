/**
 * The insight row, rendered for real. The READING is a two-part contract —
 * the claim the content makes, and the catch in it — and the row has to show
 * both halves as labelled halves, not as a headline with a sentence under it.
 */
import React from 'react';
import { screen } from '@testing-library/react-native';

import { renderScreen } from './helpers/render';

import { InsightLine } from '@/components/InsightLine';
import type { InsightCard } from '@/types/api';

const card = (type: InsightCard['type']): InsightCard => ({
  id: `ins_${type}`,
  type,
  headline: 'Public speaking nerves are a training problem, not a personality trait.',
  body: 'It assumes the nerves were ever the thing holding the talk back.',
  strength: 1,
  evidence: null,
});

describe('InsightLine', () => {
  it('renders a READING as a labelled claim and catch', async () => {
    await renderScreen(<InsightLine insight={card('READING')} />);

    expect(screen.getByText('the claim')).toBeTruthy();
    expect(screen.getByText('Public speaking nerves are a training problem, not a personality trait.')).toBeTruthy();
    expect(screen.getByText('the catch')).toBeTruthy();
    expect(screen.getByText('It assumes the nerves were ever the thing holding the talk back.')).toBeTruthy();
  });

  it('labels the MIRROR as a read on the person', async () => {
    await renderScreen(<InsightLine insight={card('MIRROR')} />);

    expect(screen.getByText('a read on you')).toBeTruthy();
    expect(screen.queryByText('the catch')).toBeNull();
  });

  it('shows no catch marker on graph-derived kinds', async () => {
    await renderScreen(<InsightLine insight={card('NOVELTY')} />);

    expect(screen.getByText('novelty')).toBeTruthy();
    expect(screen.queryByText('the catch')).toBeNull();
  });

  it('drops the catch marker with the body in compact mode', async () => {
    await renderScreen(<InsightLine insight={card('READING')} compact />);

    expect(screen.getByText('the claim')).toBeTruthy();
    expect(screen.queryByText('the catch')).toBeNull();
    expect(screen.queryByText('It assumes the nerves were ever the thing holding the talk back.')).toBeNull();
  });
});
