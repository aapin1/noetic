/**
 * The /today ritual screen, rendered for real against mocked API payloads.
 *
 * Only `@/lib/api` is mocked — the screen, its hooks, the theme, and every
 * child component render exactly as they do on device. These cover the
 * branches that are tedious to reach by hand: the pre-history empty state, the
 * streak-credit line, and where each action navigates.
 */
import React from 'react';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { renderScreen } from './helpers/render';

import TodayScreen from '@/app/today';
import { api } from '@/lib/api';
import type { StreakSummary, TodayResponse } from '@/types/api';

jest.mock('@/lib/api', () => ({
  api: {
    today: { get: jest.fn(), visit: jest.fn() },
  },
}));

const todayGet = api.today.get as jest.MockedFunction<typeof api.today.get>;
const todayVisit = api.today.visit as jest.MockedFunction<typeof api.today.visit>;

const streak = (current: number): StreakSummary =>
  ({ current, longest: current, lastActiveDay: null }) as unknown as StreakSummary;

const CAPTURE: TodayResponse = {
  challenge: null,
  collision: null,
  capture: {
    id: 'cap_1',
    title: 'The Dichotomy of Control',
    keyIdea: 'Freedom follows from judging what is up to you.',
    reaction: 'this reframes anxiety',
    whyNow: 'saved 3 months ago, untouched since',
  } as TodayResponse['capture'],
  connection: null,
};

beforeEach(() => {
  todayGet.mockReset();
  todayVisit.mockReset();
  todayVisit.mockResolvedValue({ credited: false, streak: streak(1) });
});

describe('today screen', () => {
  it('explains itself instead of showing an empty page before there is history', async () => {
    todayGet.mockResolvedValue({ challenge: null, collision: null, capture: null, connection: null });

    await renderScreen(<TodayScreen />);

    expect(await screen.findByText('not yet')).toBeOnTheScreen();
    expect(screen.getByText(/a week of saves is enough/i)).toBeOnTheScreen();
  });

  it('renders the resurfaced capture with its reason and key idea', async () => {
    todayGet.mockResolvedValue(CAPTURE);

    await renderScreen(<TodayScreen />);

    expect(await screen.findByText('The Dichotomy of Control')).toBeOnTheScreen();
    expect(screen.getByText('saved 3 months ago, untouched since')).toBeOnTheScreen();
    expect(screen.getByText('Freedom follows from judging what is up to you.')).toBeOnTheScreen();
    expect(screen.getByText(/this reframes anxiety/)).toBeOnTheScreen();
  });

  it('credits the visit once and says so', async () => {
    todayGet.mockResolvedValue(CAPTURE);
    todayVisit.mockResolvedValue({ credited: true, streak: streak(4) });

    await renderScreen(<TodayScreen />);

    expect(await screen.findByText('◆ 4 days running — opening this counted.')).toBeOnTheScreen();
    expect(todayVisit).toHaveBeenCalledTimes(1);
  });

  it('does not claim the day was counted when it already was', async () => {
    todayGet.mockResolvedValue(CAPTURE);
    todayVisit.mockResolvedValue({ credited: false, streak: streak(4) });

    await renderScreen(<TodayScreen />);

    expect(await screen.findByText('◆ 4 days running.')).toBeOnTheScreen();
    expect(screen.queryByText(/counted/)).not.toBeOnTheScreen();
  });

  it('stays silent about a streak of one', async () => {
    todayGet.mockResolvedValue(CAPTURE);
    todayVisit.mockResolvedValue({ credited: false, streak: streak(1) });

    await renderScreen(<TodayScreen />);

    await screen.findByText('The Dichotomy of Control');
    await waitFor(() => expect(todayVisit).toHaveBeenCalled());
    expect(screen.queryByText(/days running/)).not.toBeOnTheScreen();
  });

  it('opens the insight for the resurfaced capture', async () => {
    todayGet.mockResolvedValue(CAPTURE);
    const user = userEvent.setup();

    await renderScreen(<TodayScreen />);
    await user.press(await screen.findByLabelText('open insight →'));

    expect(global.__routerMock.push).toHaveBeenCalledWith('/insight/cap_1?from=today');
  });

  it('survives the visit call failing', async () => {
    todayGet.mockResolvedValue(CAPTURE);
    todayVisit.mockRejectedValue(new Error('offline'));

    await renderScreen(<TodayScreen />);

    // The ritual still renders; only the streak footer is missing.
    expect(await screen.findByText('The Dichotomy of Control')).toBeOnTheScreen();
    expect(screen.queryByText(/days running/)).not.toBeOnTheScreen();
  });
});
