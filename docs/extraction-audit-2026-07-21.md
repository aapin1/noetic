# Extraction & transcription audit — 2026-07-21

Stage-by-stage test of the capture pipeline against 13 real sources, run through
the production code (`fetchMetadata` → `scoreContentConfidence` →
`cleanContentMetadata` → capture-summary rule). Nothing was reimplemented.

Harnesses added: `scripts/stage-probe.ts` (per-stage output for a URL list),
`scripts/asr-probe.ts` (Groq ASR tier in isolation). Existing
`scripts/proxy-probe.mjs` used for proxy health.

---

## Headline

**The transcription layer is not broken.** All three ~10-minute YouTube videos
returned full, correct English transcripts in under 2s. All three Substacks
returned 9.8k–12k characters of real article text. The proxy is healthy.

**One real defect was found, and it is severe:** `ProxySession.close()` could
hang forever, which made `fetchMetadata` never settle — a capture that hangs
until the platform kills the request. It is barely reachable from a residential
IP and routine from a datacenter IP, which is exactly why it only appeared on
Render. Fixed and covered by a regression test (details below).

**One quality ceiling was found:** when a video has no usable captions, the ASR
fallback transcribes only the first **~43 seconds** of a 10-minute video. That
is the likeliest source of "generic" insights on video captures.

---

## Stage 1 — extraction / transcription

13 sources, local run, proxy enabled. `src` = which extractor won.

| Source | src | body | conf | ms |
|---|---|---|---|---|
| YouTube — Veritasium, *The Most Controversial Problem in Philosophy* (10:19) | transcript | 10,413 | rich | 1749 |
| YouTube — 3Blue1Brown, *Vectors, Essence of linear algebra* (9:52) | transcript | 10,174 | rich | 1773 |
| YouTube — Serious Science, *Hard Problem of Consciousness / Chalmers* (9:19) | transcript | 7,692 | rich | 1897 |
| Substack — Astral Codex Ten, *Being John Rawls* | body | 11,984 | rich | 249 |
| Substack — Experimental History, *The rise and fall of peer review* | body | 11,991 | rich | 300 |
| Substack — Noahpinion, *The Fall of the Nerds* | body | 9,842 | rich | 193 |
| News — Ars Technica, LARES-2 / Lense-Thirring | body | 8,147 | rich | 697 |
| News — BBC, T. rex auction | body | 1,977 | rich | 382 |
| News — NYT, Asgard archaea | — | 0 | **thin** | 1695 |
| Medium — *7 Rules for Creating Gorgeous UI* | body | 11,991 | rich | 278 |
| Reddit — ELI5 thread | — | 0 | **thin** | 3309 |
| arXiv PDF — *Attention Is All You Need* | pdf | 11,981 | rich | 1172 |
| Apple Podcasts — Lex Fridman show page | body | 308 | partial | 599 |

**11/13 rich.** The two failures are genuine upstream blocks, not pipeline bugs:

- **NYT**: 403 on every tier — plain UA, browser UA, *and* through the
  residential proxy. Hard paywall. Correctly degrades to "ask the user".
- **Reddit**: 403 on the public `.json` API both direct and proxied. Known and
  documented in `extraction-battery.ts`. Correctly degrades to thin.
- **Apple Podcasts** at 308 chars is a show-level page, not an episode — the
  308 chars *is* the whole description. Correct, if unexciting.

### Transcription specifics (tested hard, as requested)

- **English pinning works.** 3Blue1Brown's video carries 33 caption tracks with
  Arabic *first* in the list. The ranked selection took `en` (human-authored)
  over `en/auto` and over everything else. The Arabic-transcript regression the
  code comments warn about did not recur.
- **InnerTube is the winner every time.** `usedSupadata=false` on all three
  videos — no paid credits burned. Median InnerTube round-trip ~2s.
- **Proxy health**: 5/6 on `proxy-probe.mjs`. The one miss was
  `playability_LOGIN_REQUIRED` (a flagged exit IP), which the in-code hedge to
  the second InnerTube client is designed to absorb. A separate spot-check of a
  university lecture also hit `LOGIN_REQUIRED` on one exit — so flagged exits
  are real but a minority.
- **The proxy tier itself is fine.** Forcing the last-resort proxied HTML fetch
  (the tier a datacenter IP is pushed onto) returned complete pages: ACX
  186KB→11,984 chars, Experimental History 276KB→11,991, Ars Technica
  154KB→8,147, Medium 365KB→11,991. So "the proxy transfer isn't working" is
  not what is happening.

### The ASR fallback is near-useless on long video

Tested directly via `transcribeAudioUrl` (`scripts/asr-probe.ts`):

| video | length | audio size | transcript | coverage |
|---|---|---|---|---|
| Veritasium | 618s | 3.77 MB | 644 chars | **~43s (7%)** |
| Chalmers | 559s | 3.41 MB | 391 chars | **~43s (7%)** |

The text quality is good — accurate, clean, 2–3s round-trip. The problem is
volume. `MAX_LEADING_BYTES` is 256KB and YouTube's CDN refuses non-zero-offset
range reads, so at ~50kbps that is 43 seconds, full stop. This tier only fires
when captions are missing or blocked, so it is invisible in the happy path —
but when it fires on a 10-minute video, every downstream stage (embedding,
topic classification, insight drafting) is reasoning about the first 43
seconds, i.e. the intro and the sponsor read. That will read as generic.

Note it does *not* silently lie: 644 chars falls under the 800-char `rich`
threshold, so the capture is scored `partial`, and `attemptYouTubeAsr` appends
`[…]`. But `partial` still passes the thin-content gate, so no boilerplate
suppression and no ask-the-user prompt fires.

---

## Production run (Render, same 13 sources)

Run against `mneme-backend.onrender.com` via `/api/captures/preflight` — the
real production entry point into `ingestUrl` → `fetchMetadata`.

| Source | prod | local | prod ms |
|---|---|---|---|
| YouTube ×3 | rich / transcript | rich / transcript | 3.7–5.8s |
| Substack ×3 | rich / body | rich / body | 2.4–3.3s |
| Ars Technica, BBC | rich / body | rich / body | 2.7–3.1s |
| NYT | thin | thin | 1.4s |
| Medium | rich / body | rich / body | 2.7s |
| arXiv PDF | rich / pdf | rich / pdf | 0.9s |
| Apple Podcasts | partial / body | partial / body | 4.2s |
| **Reddit** | **HUNG — 90s client timeout** | (hung before fix) | 90,003ms |

**Prod matches local on 12 of 13 sources, including all three Substacks with
substantive excerpts.** Keys, models, and the proxy are all configured
correctly on Render — this run is proof, not inference.

The one divergence is the thirteenth: Reddit hung for the full 90s client
timeout on production. That is the `ProxySession.close()` bug reproduced live
on Render, on the deployed build, exactly as predicted.

### What this means for the Substack report

Production extracts Substack correctly today (ACX, Experimental History,
Noahpinion all `rich`, 2.4–3.3s, with real excerpts). So an empty About on a
Substack capture was **not** a live extraction failure at the time it was
tested. The remaining explanations, in likelihood order:

1. **A cached stub row.** `ingestOrStubUrl` creates a stub ContentItem
   (title = hostname, description = the URL) whenever the scrape fails —
   including when the request was killed by the hang. `ingestUrl` then dedupes
   on `canonicalUrl` forever after, and only re-scrapes once per 24h, with
   every failed retry restarting the cooldown. A URL that failed once keeps
   showing an empty About on every later capture.
2. **A subscriber-only post.** Paywalled Substack posts serve the same
   truncated HTML the ACX/Noahpinion free posts do not.
3. **A stale Render build** at the time of that capture.

Distinguishing these needs the exact URL that failed.

## Stage 2 — confidence gate

`scoreContentConfidence` behaved correctly on every source. Notably the
URL-shaped-description guard worked: NYT and Reddit both scored `thin` rather
than being rescued by a stub description.

---

## Stage 3 — LLM metadata clean

`cleanContentMetadata` produced accurate, specific excerpts on all 11 sources
that had body text, with no confabulation on the two that didn't (it was never
called — no title). It also correctly recovered titles the scrape got wrong:

- arXiv PDF: raw title `1706.03762` → cleaned `Attention Is All You Need`
- 3Blue1Brown: raw `Vectors | Chapter 1, Essence of linear algebra` → cleaned
  `Essence of linear algebra`

Latency 1.1–2.4s. This stage is not a suspect.

---

## Stage 4 — the "About this capture" text

`captureSummary` is derived in `captureItem()` from the cleaned excerpt: taken
verbatim if ≤400 chars, else cut at the last sentence boundary inside 400, else
**null**. Null renders as *"The source couldn't be read. Tell mneme what it was
about."*

Every source with body text produced a substantive About line. Example (ACX):

> The piece tells the story of two men named John Rawls, one an alcoholic who
> struggles with poverty and crime, and the other a wealthy banker who is
> indifferent to charity.

So when About is empty, the excerpt was null, which means the body was empty,
which means stage 1 lost the content. About is a symptom, never the cause.

---

## Root cause: `ProxySession.close()` could hang forever

### Evidence

`fetchMetadata` on a Reddit URL was **still pending after 60 seconds** — not
slow, never settling. It also killed the battery run mid-list: sources 11–13
never executed because the process sat on a dead promise.

Minimal isolation, same proxy, same 403:

```
close()    after 403 with body unconsumed -> HUNG (12002ms)
destroy()  after 403 with body unconsumed -> ok (4ms)
```

### Mechanism

undici's `ProxyAgent.close()` is a *graceful* close: it waits for every
response from that agent to be fully consumed. The extraction ladder
deliberately abandons bodies it can't use —
`if (!res.ok) return undefined` — and every call site releases the session in
`finally { await session.close() }`. Abandoned body + graceful close = a
promise that never resolves, awaited in a `finally`.

Affected call sites, all reachable in normal operation:

| location | abandoned body |
|---|---|
| `metadata.ts` `fetchYouTubePlayerData` | `if (!res.ok) return undefined` |
| `metadata.ts` `fetchCaptionText` | `if (!res.ok) return undefined` |
| `metadata.ts` `fetchRedditMetadata` (proxy retry) | `if (!retry.ok) return undefined` |
| `metadata.ts` `fetchTikTokMediaUrl` | `if (!res.ok) return undefined` |
| `metadata.ts` final proxied HTML tier | no `else` branch consuming the body |
| `metadata.ts` `textCapped` | byte/time cap cancels the reader without awaiting |
| `transcribe.ts` `downloadLeadingAudio` | `if (!res.ok) return { failure }` |

### Why it only showed up on Render

The trigger is a **non-OK response through the proxy**. From a residential IP
the direct tiers succeed and the proxy tier is rarely reached, so the trigger is
rare. From a datacenter IP far more hosts bot-wall the request, the proxy tier
carries much more traffic, and flagged exits return 403 regularly. Same code,
very different hit rate.

### Fix

`src/server/proxyFetch.ts` — `close: () => agent.destroy()` instead of
`agent.close()`. `close()` is only ever called once the session's work is done,
so forcibly dropping sockets discards nothing a caller still wants.

Regression test in `src/server/proxy-fetch.test.ts` stands up a CONNECT proxy
in front of an origin that 403s with a 200KB body, leaves it unread, and
asserts `close()` resolves. Verified to **fail** on `agent.close()` and **pass**
on `agent.destroy()`. Full unit suite: 250/250 pass.

After the fix, the Reddit URL settles in 5.1s and the full 13-source battery
completes.

---

## Deploying this to Render

1. Deploy the `proxyFetch.ts` change. Nothing else is required — no env var, no
   key, no schema change.
2. **Expect no immediate improvement on URLs you already tried.** `ingestUrl`
   dedupes by `canonicalUrl`, and a URL whose scrape failed left a stub row with
   no `bodyText`. That row is only re-scraped once per 24h
   (`RETRY_COOLDOWN_MS`), and every failed retry *touches `updatedAt`*, which
   restarts the cooldown. So a Substack post that failed before the fix will
   keep returning its empty stub for up to a day.
   - To test the fix immediately, capture URLs you have never captured before,
     or clear the stub rows:
     ```sql
     DELETE FROM "ContentItem" WHERE "bodyText" IS NULL;
     ```
     (deletes only rows that carry no content; captures referencing them will
     re-ingest on next touch — check FK behaviour before running on prod).
3. Watch the structured log lines already emitted — `extraction`,
   `yt_transcript_miss`, `yt_asr`, `asr_miss` — in the Render log stream. If
   the fix landed, `extraction` lines should show `confidence:"rich"` for
   article and video captures, and `usedSupadata:false` for YouTube.

---

## Open items, in priority order

1. **ASR coverage (biggest remaining quality gap).** 43 seconds of a 10-minute
   video is not a transcript. Options: fall back to Supadata `mode=auto` when
   the ASR result is `partial` on a video over N minutes (costs credits, gets
   the whole thing); or accept the gap and mark ASR-partial captures as `thin`
   so the ask-the-user path fires instead of insights being drafted from a
   sponsor read.
2. **Consume abandoned bodies anyway.** `destroy()` fixes the hang, but the
   non-OK early-returns still drop bodies mid-flight. Draining them
   (`void res.arrayBuffer().catch(() => {})`) is tidier and avoids relying on
   the destroy semantics. Not required for correctness now.
3. **Nothing bounds `fetchMetadata` end-to-end.** Every individual fetch has a
   timeout, but the ladder can chain many of them. A single outer deadline
   would have turned this bug into a slow capture rather than a hung one.
4. **`browserPromise` in `fetchMetadata` is often never awaited**, leaking a
   response body per capture on the happy path. Global-fetch, so no agent hang,
   but it is a socket leak.
5. **Reddit is fully blocked** (403 direct and proxied). If Reddit captures
   matter, this needs an authenticated API path; today it always degrades to
   ask-the-user.
