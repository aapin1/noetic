// Onboarding, distilled: over the ghost map, two small pills say what the
// map is and offer the walkthrough. Answering (either way) fades the ghost
// constellation out. The walkthrough itself is the structured tour in
// constants/tutorialSteps.ts, and after that the app explains nothing
// unprompted.
//
// Pure module, no imports. All persistence and rendering live in the map
// screen and DisclosureContext.

/** Who accompanies a pill: the cat, the envelope, a ✦, or nobody. */
export type GuideArt = "cat" | "mail" | "spark" | "none";

/**
 * Every tab focus records one of these, once, keyed by PRODUCT name ('you',
 * 'archive'). Kept as durable bookkeeping in the disclosure seen-set.
 */
export function visitedTabFlag(tab: string): string {
  return `visited:${tab}`;
}

/** An account below this is still new (comeback-promise arming reads it). */
export const GUIDE_MAX_CORPUS = 5;

/**
 * The two welcome beats, each spoken once per ACCOUNT. The disclosure store
 * is one per install and survives account switches, so an unscoped flag set
 * by one account would rob every later account on the device of its ghost
 * map and welcome. Scope by user id.
 */
export function welcomeIntroFlag(userId: string): string {
  /** "this is a map" has been said. */
  return `welcome:intro:${userId}`;
}

export function welcomeOfferFlag(userId: string): string {
  /** The walkthrough was offered and answered, either way. */
  return `welcome:offer:${userId}`;
}

export const WELCOME_INTRO_LINE =
  "this is a map. save the things you read and watch, and yours will grow like this.";

export const WELCOME_OFFER_LINE = "want a quick tour?";
