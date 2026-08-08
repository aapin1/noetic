import { describe, expect, it } from "vitest";
// Relative import on purpose: the backend runner aliases `@` to src/, so the
// mobile alias would not resolve here. The gate itself has no imports at all.
import { shouldRequestReview, type ReviewStats } from "./reviewGate";

function stats(overrides: Partial<ReviewStats> = {}): ReviewStats {
  return {
    captureCount: 5,
    sessionCount: 3,
    accountAgeDays: 3,
    tutorialActive: false,
    promptedVersion: null,
    currentVersion: "1.1.0",
    ...overrides,
  };
}

describe("shouldRequestReview", () => {
  it("asks when every threshold is exactly met", () => {
    expect(shouldRequestReview(stats())).toBe(true);
  });

  it("holds at four captures, asks at five", () => {
    expect(shouldRequestReview(stats({ captureCount: 4 }))).toBe(false);
    expect(shouldRequestReview(stats({ captureCount: 5 }))).toBe(true);
  });

  it("holds at two sessions, asks at three", () => {
    expect(shouldRequestReview(stats({ sessionCount: 2 }))).toBe(false);
    expect(shouldRequestReview(stats({ sessionCount: 3 }))).toBe(true);
  });

  it("holds under three days of account age, and when the age is unknown", () => {
    expect(shouldRequestReview(stats({ accountAgeDays: 2.99 }))).toBe(false);
    expect(shouldRequestReview(stats({ accountAgeDays: 3 }))).toBe(true);
    expect(shouldRequestReview(stats({ accountAgeDays: null }))).toBe(false);
  });

  it("never asks mid-tutorial, even when everything else passes", () => {
    expect(shouldRequestReview(stats({ tutorialActive: true }))).toBe(false);
  });

  it("asks at most once per app version", () => {
    expect(shouldRequestReview(stats({ promptedVersion: "1.1.0" }))).toBe(false);
    expect(shouldRequestReview(stats({ promptedVersion: "1.0.0" }))).toBe(true);
    expect(shouldRequestReview(stats({ promptedVersion: null }))).toBe(true);
  });
});
