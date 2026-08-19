# Mneme Engagement Design Spec
*2026-06-10*

## Vision

Mneme is the place where what you consume becomes what you believe.

Most intellectual consumption disappears. You read an article, listen to a podcast, watch a lecture — and a week later you retain a vague impression and nothing else. The problem isn't memory; it's that consumption was never connected to thinking. Mneme closes that loop. You track what you engage with, and Mneme turns the accumulated pattern of your engagement into a living map of your mind — showing you what you believe, how it's evolved, where your blind spots are, and who else is thinking alongside you.

This is not a note-taking app. It is not a social platform. It is not a content aggregator. It is a tool for building an intellectual practice.

---

## The Market

The intellectual productivity space is full of partial solutions:

- **Notion / Obsidian** — require manual work, no synthesis, not social
- **Readwise** — excellent at retention, doesn't generate understanding
- **Roam / Logseq** — powerful but high-friction, nerd tools not mass market
- **Twitter/X** — rewards hot takes and performance, not deep thinking
- **Substack** — makes you a publisher, high barrier
- **Goodreads / Letterboxd** — single format, validation-oriented, no insights

Nothing in this space turns passive consumption into active understanding, and nothing makes that social in a way that serves thinking rather than replacing it.

The gap is large and growing. People are consuming more than ever — newsletters, podcasts, YouTube lectures, long reads — and increasingly anxious that none of it is compounding. "I read a lot but I can't retain it and I'm not sure I'm getting smarter" is a feeling that is nearly universal among curious people. Mneme is the answer to that feeling.

---

## User Archetypes

**The Hungry Generalist** *(primary market)*
22–35, curious across domains, reads and listens voraciously. Feels like their consumption isn't compounding. Wants to feel like all of it is going somewhere. The largest cohort by far.

**The Aspiring Intellectual**
Slightly younger. Wants to take their thinking seriously. Drawn to the social layer as inspiration ("what is my friend Alfred exploring?") and to habit-building structure. The app gives their intellectual curiosity a container.

**The Deep Specialist**
Researcher, academic, domain expert. Already goes deep. Wants a tool that reveals their own evolution over years and surfaces the rare person who can genuinely challenge them at depth.

**The Reflective Professional**
Executive, entrepreneur, consultant. High volume of inputs, needs synthesis. Treats the Socratic challenge as a way to stress-test beliefs before acting on them.

All four archetypes share one thing: they are already doing a manual version of what Mneme does — running notes in Notion, highlights in Readwise, bookmarks in Safari. Mneme is the version of that which works without the overhead and is worth sharing.

---

## The Experience Arc

**Day 1.** You capture a few things. The map is sparse but the immediate response is specific — two things you just logged connect to each other in a named way. It already feels smarter than a bookmark folder.

**Week 1.** You've captured 15–20 things. The map has shape. You get your first contradiction card — two captures hold opposing views on the same question. You didn't know that. The app surfaces your first thread: you've been circling one idea from four different angles without realising it.

**Month 1.** The map is rich enough to read. The Socratic companion has enough material to challenge you on something you actually believe. Mneme prompts you to take your first position — to state what you actually think after a month of circling a topic. Your first weekly digest lands. You see your first affinity match: someone whose map overlaps yours in interesting ways.

**Month 3.** You've taken positions on several topics. You've had your first structured sparring exchange with someone whose map diverged from yours — and it changed something you thought you believed. Your evolution timeline shows how your thinking on one topic has visibly shifted. The app has become part of how you think, not just how you track.

**Month 6+.** Your map is a record of intellectual growth you can actually see. You have a small network of sparring partners. The Socratic companion knows your thinking well enough to catch inconsistencies before you do. The app has kept its promise.

---

## Feature Specification

### Layer 0 — Capture

Keep capture minimal. The manual act of deciding to log something is itself meaningful — it signals engagement. Don't automate it away.

- **Share sheet** (iOS/Android) — capture directly from Safari, Spotify, YouTube, any app
- **Voice capture** — speak a thought, Mneme transcribes and places it
- **Quick add widget** — home screen widget, no need to open the app

No browser extension, no Kindle import, no automated ingestion in this phase.

---

### Layer 1 — The Map

The cognitive cartography visualization exists. It needs:

- **Node landing animation** — when you capture something, it visibly lands and edges form in real-time to connected nodes. The map feels alive, not static.
- **Cluster legibility** — major topic clusters readable at a glance. Named territories, not just dots.
- **Time scrubbing** — drag back in time and watch the map grow. See your intellectual territory as it built.

---

### Layer 2 — Post-Capture Payoff *(highest priority)*

What happens in the 10 seconds after you log something. Currently: a dot appears and a generic AI observation fires. This must become the most satisfying moment in the app.

**Connection flash.** On every capture, run a fresh AI synthesis call against the user's existing memory graph to surface the 2–3 most specific connections with the tension named. Not "you're exploring philosophy" — but "this shares a core conflict with something you captured from [source] in January. Both are wrestling with whether rationality can ground moral obligation." Pull the actual content, name the actual relationship. This is distinct from the existing generic topic observation — it references specific past captures by content, not by category.

**Thread drop-in.** Show the existing thread this capture joins. "This is your 4th capture on the hard problem of consciousness. Here's where your thinking on this has been going." Give context immediately.

**Recommended next three.** Specific external content suggestions that follow from this capture AND the thread it landed in. These are AI-generated suggestions (titles, authors, sources) based on the thread context — not pulled from a live database or search index. Reasoned, not algorithmic: "You've approached this from the neuroscience angle — this is the best philosophical entry point into the same question." The user can then capture any of them to continue the thread.

---

### Layer 3 — Personal Intelligence Engine

These are the features that make users say "I didn't know that about myself."

**Contradiction cards.** Two captures holding genuinely opposing views on the same question, surfaced side-by-side with the specific tension named. "You seem to hold both X and Y — do you actually?" The user can dismiss it, sit with it, or flag it as a genuine unresolved tension. Should feel like a revelation, not a test.

**Thread synthesis.** When 5+ captures orbit the same idea from different angles, generate an interpretation of the user's intellectual position — not a summary of what they read, but a statement of where their thinking seems to have landed. The distinction matters: they're not being shown their content back at them, they're being told what they appear to believe.

**Convergence detection.** "You've arrived at this same core idea from five completely different sources across six months." Shows that intuitions are consistent even when the user wasn't trying to be. Validating and surprising in equal measure.

**Evolution timeline.** For heavily-captured topics, an arc: "In March your captures on consciousness were mostly neuroscience. By June, philosophy of mind. Now you're in the territory of the hard problem and mysticism." The user sees their own intellectual drift — not as a judgment, as a story.

**Dormant thread nudge.** Low-pressure: "You were deep into X three weeks ago and stopped. There's more here if you want it." Never a guilt notification. Always optional.

---

### Layer 4 — The Active Layer *(killer features)*

This is what separates Mneme from every passive tracker. These features turn consumption into capability.

#### The Position System

Once a thread synthesis has been generated for a topic (threshold: 5+ captures), Mneme prompts: *"You've been circling free will for four months. What do you actually think?"*

The answer becomes a **thesis node** — a distinct node on the map representing the user's stated view. From that point, new captures are evaluated against it. "You took a position on compatibilism in March. You've since captured six things that challenge it. Has your view shifted?" The user can update their position, but must acknowledge the shift.

The map stops being a collection and becomes an argument. Thesis nodes are visible on a user's public map — not raw captures, not highlights, but the views they've actually committed to. This is the social object that makes a map interesting to others.

#### The Socratic Companion

A conversational AI that knows the user's entire map and uses it to argue with them. Not a summarizer. Not a chatbot. An interlocutor.

It knows the user captured X and also captured Y, which point in different directions — and it says so. "You seem to hold compatibilism about free will, but three months ago you captured an argument that undermines the exact premise compatibilism relies on. How do you hold both?" The user responds. Their response feeds back into the map as a new capture tagged as a reflection.

The Socratic companion maintains a persistent, per-topic dialogue thread. Each topic in the map with enough depth gets its own ongoing conversation. The return pull — "continue your dialogue on determinism" — is completely different from "check your insights." It's a relationship with your own thinking, mediated by something that knows you well enough to push back.

#### Structured Intellectual Sparring

Two users whose maps diverge on the same question get matched. Mneme generates the specific crux — not "you both like philosophy" but "you've both captured extensively on consciousness and seem to have landed at opposite ends on the hard problem. Here's the exact point of divergence."

A structured exchange follows: each person responds to the crux. After each response, the AI generates a follow-up question or reframe to keep the exchange precise and substantive — it prevents the exchange from becoming a comment section by steering toward the actual point of disagreement rather than meta-commentary. Both final responses feed back into both maps as reflection captures. The outcome is recorded as a connection between the two maps.

This is completely native to Mneme — no other app can do it because no other app knows the actual structure of your thinking. The outputs are shareable artifacts. The experience is intellectual sport.

---

### Layer 5 — Social Discovery

The social layer exposes the shape of thinking, not a stream of activity.

**Friend maps.** See the topography of a friend's intellectual territory — their biggest clusters, active threads, stated positions. Not what they captured today. With a curated entry point: "Alfred has been deep in existentialism for three months. This is the single best place to start if you want to understand his map."

**Affinity matching.** Mneme surfaces people whose maps have meaningful overlap or meaningful divergence. Specifically: "You've both been circling the same question about agency from completely different disciplines. Their map might show you something yours doesn't." The basis for a sparring match, or just a follow. Social graph is both people you know and people you're matched with by intellectual affinity.

**Map overlap view.** When viewing another person's map, see where yours intersects — shared threads, shared captures, places where you diverged from the same starting point.

**Shareable artifacts.** Not posts. Specific generated objects: a contradiction you're sitting with, a thread synthesis, a "my mind this month" digest, a sparring outcome. These travel on their own — someone sees the artifact, wants to know what generated it, finds Mneme. That's the growth loop.

**Weekly mind digest.** A brief, visually satisfying summary of the shape of your thinking that week — active threads, a highlight insight, one unexpected connection. Designed to be shareable without being designed as a post. The Spotify Wrapped mechanic: deeply personal data, naturally viral.

---

## Design Principles

### What Mneme Is Not

These are firm lines. Crossing them turns Mneme into something else.

- **Not a feed of real-time captures.** The social layer exposes structure, not activity.
- **Not likes or comments on individual captures.** That turns tracking into performance. People start capturing for the audience, not for themselves.
- **Not follower counts or public metrics.** The meaningful social object is the quality of your map and the positions you've taken.
- **Not a place to write.** The app processes what you consume. The only "writing" it asks of you is position statements and Socratic companion responses — both feed the map, not a public feed.
- **Not notifications for social validation.** Never "someone liked your capture." Always: "something happened in your mind" or "a sparring match is waiting."

---

## Build Order

**Phase 1 — Fix the feedback loop** *(works with zero other users)*
Connection flash, thread drop-in, recommended next three, map landing animation. The capture moment pays off immediately.

**Phase 2 — Make it personal**
Contradiction cards, thread synthesis, convergence detection, evolution timeline. The app starts revealing things users didn't know about themselves.

**Phase 3 — Make it active**
Position system, Socratic companion. Consumption becomes capability. The map becomes an argument.

**Phase 4 — Build the habit**
Specific insight notifications, weekly mind digest. Pull without the feed.

**Phase 5 — Open it up**
Friend maps, affinity matching, map overlap, shareable artifacts, structured sparring. Social amplifies what's already valuable.
