# You-page level-up + Mind flash fix

Date: 2026-07-06

## Goal

Two things: (1) stop the Mind page from flashing stray text before its empty
state, and (2) turn the "you" tab into a delightful, personal summary screen —
changeable profile picture, a cleaner hero, and a Spotify-Wrapped-style section.

## 1. Mind page — flashing lead text

**Bug:** `isEmpty` in `mobile/app/(tabs)/mind.tsx` includes `!loading`. When the
focus effect refetches an empty mind, `isEmpty` flips to `false` mid-refetch, so
`"What you didn't know you know."` flashes before `ScreenIntro` renders again.

**Fix:** compute `hasContent` from the data arrays + positions alone (no
`loading` term). Show `ScreenIntro` when `!hasContent`; show the lead line only
when `hasContent`. Empty users only ever see the quiet state; users with content
keep the lead as a header. No behavior change beyond removing the transient.

## 2. You-page hero

New order: **Avatar → display name → @handle → bio → Wrapped → captures stat →
Edit button.**

- Stop rendering `identitySummary` (the `"Top topics: … Core sources: …"`
  string). Render the user-authored `bio` field instead (nothing if empty).
- The topic/source data still feeds Wrapped, without the robotic labels.

## 3. Avatar initials centering

`mobile/components/ui/Avatar.tsx`: initials are top-clipped because the `Text`
has no `lineHeight` matching the centered box. Set `lineHeight` to the box
dimension (and stop relying on default vertical metrics) so initials are centered
at every size.

## 4. Change profile picture

- **UI:** avatar on the you-page becomes pressable with a small camera badge.
  Press → sheet with **Choose from library / Take photo / Remove photo**.
- **Pick + crop:** `expo-image-picker` with `allowsEditing: true`,
  `aspect: [1,1]`, compressed, `base64: true`. Native square crop — no custom UI.
- **Backend:** new `POST /api/profile/avatar` mirroring
  `src/app/api/captures/upload/route.ts`: decode base64 → upload to R2
  `avatar-uploads/` (dev-disk fallback) → set `profile.avatarUrl` → return updated
  profile. `remove: true` sets `avatarUrl = null`. New `avatarUploadSchema` in
  `src/server/contracts`.
- **Propagation:** every `Avatar` reads `profile.avatarUrl`, so the new picture
  appears on the you-page and on any profile others view automatically.

## 5. Wrapped section (self-only)

- **Backend:** `GET /api/me/wrapped` returns raw stats over full capture history —
  `totalCaptures`, `firstCaptureAt`, `distinctTopics`, `topTopics[{name,count}]`,
  `newTopicsThisMonth[]`, `busiestDayOfWeek`, `busiestHour`, `formats[{name,count}]`,
  `currentStreak`, `longestStreak`, `monthlyArc[{month,count}]`. Stats only — no copy.
- **Mobile `WrappedSection`:** a vertical stack of playful cards built from the
  stats. Cards reveal on scroll (reanimated), numbers count up, haptics fire on
  reveal, and the top card gets a confetti/balloon burst.
  - **Confetti:** hand-rolled with reanimated (gravity + spin + drift for realism),
    palette tuned to mneme's restrained look. No new dependency.
  - **Copy:** written through the humanizer skill — quirky, a little cringe, never
    AI-sounding. Lives in the mobile layer for easy iteration.
  - **Extras:** a "first capture" time-capsule card; a light-hearted reading
    "archetype" derived from top content type; graceful thin-history state where
    the first-log milestone is the hero card.

## Out of scope

- Wrapped on public profiles (self-only for now).
- Sharing Wrapped as an image.
- Custom (non-native) crop UI.

## Files

Backend: `src/app/api/profile/avatar/route.ts` (new), `src/app/api/me/wrapped/route.ts`
(new), `src/server/contracts.ts`, `src/server/storage.ts`, a wrapped stats service.
Mobile: `mind.tsx`, `Avatar.tsx`, `(tabs)/profile.tsx`, `lib/api.ts`, `types/api.ts`,
new `WrappedSection.tsx`, `Confetti.tsx`, editable-avatar UI.
