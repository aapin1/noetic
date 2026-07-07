export type TutorialTab = 'index' | 'memory' | 'pulse' | 'trends' | 'mind' | 'profile';

export interface TutorialStep {
  id: string;
  tab: TutorialTab;
  title: string;
  body: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    tab: 'index',
    title: 'welcome',
    body: "A quick walk through what mneme does, including a couple of things it does quietly in the background. Takes about a minute. Skip whenever you want.",
  },
  {
    id: 'atlas',
    tab: 'index',
    title: 'atlas',
    body: "This is home. Every node here is something you saved, and lines form when ideas share a topic, contradict each other, or grow out of one another. Try the lenses at the top to sort the map by meaning, time, or source.",
  },
  {
    id: 'capture',
    tab: 'index',
    title: 'capture',
    body: "Tap the plus to save something: a link, a thought, a quote, or a photo. On the next screen you can add a quick reaction, one line just for you, or leave it blank.",
  },
  {
    id: 'share',
    tab: 'index',
    title: 'share to mneme',
    body: "You don't have to open the app to save something. From Safari, Reddit, YouTube, wherever, use the share button and look for mneme in the list. It drops straight into the same capture flow.",
  },
  {
    id: 'reading-source',
    tab: 'index',
    title: 'reading the source',
    body: "When you save a link, mneme tries to read the whole thing: the article, the transcript, the caption. If it can't get enough, it'll ask what the piece was about, in your own words. That's what the map and the insights get built from.",
  },
  {
    id: 'archive',
    tab: 'memory',
    title: 'archive',
    body: "A chronological record of everything you've saved. Each entry shows its type, when it was captured, and the key idea mneme pulled from it.",
  },
  {
    id: 'pulse',
    tab: 'pulse',
    title: 'pulse',
    body: "Follow people by their handle. A small version of their map, plus their latest logs, shows up here. Search is always open at the top if you want to find someone.",
  },
  {
    id: 'drift',
    tab: 'trends',
    title: 'drift',
    body: "Tracks how your attention moves across topics over time. Closer to the centre of the galaxy means more recent. Tensions show up when something new pulls against what you already hold.",
  },
  {
    id: 'mind',
    tab: 'mind',
    title: 'mind',
    body: "What's already sitting in your map: patterns you missed, ideas that contradict each other, threads that keep coming back. All of it comes from what you saved, not from prompts.",
  },
  {
    id: 'you',
    tab: 'profile',
    title: 'you',
    body: "Your profile: handle, identity, how many things you've saved. Settings and sign out live here too.",
  },
  {
    id: 'done',
    tab: 'profile',
    title: "you're set",
    body: "That's the whole map. Go save something.",
  },
];
