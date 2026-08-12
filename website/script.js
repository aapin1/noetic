/* Mneme landing interactions.
   Everything animated here degrades to a sensible static state under
   prefers-reduced-motion. */

(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Accents from the app's theme (mobile/constants/theme.ts).
  const ACCENTS = {
    amber: '#B8894B',
    moss: '#6B7F5B',
    clay: '#8A5A5A',
    slate: '#5B6E7F',
    ochre: '#C08A5A',
    plum: '#7A6E8A',
  };

  /* ---------- scroll reveal ---------- */

  const revealEls = document.querySelectorAll('.reveal');
  if (reduceMotion) {
    revealEls.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- hero cycling word ---------- */

  const CYCLE_WORDS = ['read', 'watch', 'hear', 'think'];
  const cycleEl = document.getElementById('cycleWord');

  if (cycleEl && !reduceMotion) {
    let wordIndex = 0;
    const type = (word, i, done) => {
      cycleEl.textContent = word.slice(0, i);
      if (i < word.length) setTimeout(() => type(word, i + 1, done), 90);
      else done();
    };
    const erase = (done) => {
      const cur = cycleEl.textContent;
      if (cur.length === 0) return done();
      cycleEl.textContent = cur.slice(0, -1);
      setTimeout(() => erase(done), 55);
    };
    const loop = () => {
      setTimeout(() => {
        erase(() => {
          wordIndex = (wordIndex + 1) % CYCLE_WORDS.length;
          type(CYCLE_WORDS[wordIndex], 0, loop);
        });
      }, 2400);
    };
    loop();
  }

  /* ---------- map canvas (hero) ---------- */

  // Ambient labels stay distinct from the capture-spawned ones below, both for
  // looks and because the pruning logic tells them apart by label.
  const LABELS = ['memory', 'myth', 'slow work', 'design', 'time', 'craft'];

  function setupCanvas(canvas, onResize) {
    const ctx = canvas.getContext('2d');
    const state = { w: 0, h: 0, dpr: 1 };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const oldW = state.w;
      const oldH = state.h;
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = rect.width;
      state.h = rect.height;
      canvas.width = Math.round(rect.width * state.dpr);
      canvas.height = Math.round(rect.height * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      if (onResize && oldW > 0 && oldH > 0) onResize(oldW, oldH);
    };
    resize();
    window.addEventListener('resize', resize);
    return { ctx, state };
  }

  function makeNodes(count, w, h, labelled) {
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const hasLabel = labelled && i < LABELS.length && i % 3 === 0;
      const accentKeys = Object.keys(ACCENTS);
      nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: hasLabel ? 3 : 1.2 + Math.random() * 1.6,
        color: hasLabel
          ? ACCENTS[accentKeys[i % accentKeys.length]]
          : 'rgba(236,236,236,0.85)',
        label: hasLabel ? LABELS[i % LABELS.length] : null,
        alpha: 1,
        bloom: 1, // 0..1 growth factor for newly placed nodes
      });
    }
    return nodes;
  }

  function drawMap(ctx, nodes, w, h, linkFactor = 0.28) {
    ctx.clearRect(0, 0, w, h);

    // links between near neighbours
    const LINK_DIST = Math.min(w, h) * linkFactor;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < LINK_DIST) {
          const alpha = (1 - d / LINK_DIST) * 0.16 * Math.min(a.bloom, b.bloom);
          ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // nodes + labels
    ctx.font = '10px Menlo, monospace';
    nodes.forEach((n) => {
      ctx.globalAlpha = n.alpha * n.bloom;
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (0.4 + 0.6 * n.bloom), 0, Math.PI * 2);
      ctx.fill();
      if (n.label) {
        ctx.fillStyle = 'rgba(236,236,236,0.6)';
        const textW = ctx.measureText(n.label).width;
        const x = n.x + 8 + textW > w - 6 ? n.x - 8 - textW : n.x + 8;
        ctx.fillText(n.label, x, n.y + 3);
      }
      ctx.globalAlpha = 1;
    });
  }

  function stepNodes(nodes, w, h, insetBottom = 0) {
    const bottom = h - insetBottom;
    nodes.forEach((n) => {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < -10) n.x = w + 10;
      if (n.x > w + 10) n.x = -10;
      if (n.y < -10) n.y = bottom + 10;
      if (n.y > bottom + 10) n.y = -10;
      if (n.bloom < 1) n.bloom = Math.min(1, n.bloom + 0.03);
    });
  }

  function runMap(canvasId, nodeCount, labelled, linkFactor, insetBottom = 0) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    let nodes = [];
    // Keep node positions proportional and repaint on resize, so a rotation
    // or window change never leaves the panel blank or the nodes stranded
    // outside the visible area.
    const { ctx, state } = setupCanvas(canvas, (oldW, oldH) => {
      nodes.forEach((n) => {
        n.x = (n.x / oldW) * state.w;
        n.y = (n.y / oldH) * state.h;
      });
      drawMap(ctx, nodes, state.w, state.h, linkFactor);
    });
    nodes = makeNodes(nodeCount, state.w, state.h - insetBottom, labelled);

    if (reduceMotion) {
      drawMap(ctx, nodes, state.w, state.h, linkFactor);
      return { nodes, ctx, state };
    }

    let running = true;
    const io = new IntersectionObserver(
      ([e]) => { running = e.isIntersecting; },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    const frame = () => {
      if (running && !document.hidden) {
        stepNodes(nodes, state.w, state.h, insetBottom);
        drawMap(ctx, nodes, state.w, state.h, linkFactor);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return { nodes, ctx, state };
  }

  // The hero map keeps its nodes clear of the capture bar at the bottom.
  const heroMap = runMap('mapCanvas', 26, true, 0.28, 90);

  /* ---------- capture sequence (hero) ---------- */

  const CAPTURES = [
    { text: 'why we stopped building beautiful train stations', label: 'cities', color: ACCENTS.ochre },
    { text: 'veritasium: what makes flow states work', label: 'flow', color: ACCENTS.slate },
    { text: 'attention might be a moral act', label: 'attention', color: ACCENTS.amber },
    { text: 'kahneman_notes.pdf', label: 'judgment', color: ACCENTS.plum },
  ];
  const STATUSES = ['reading…', 'thinking…', 'placing…'];

  const captureText = document.getElementById('captureText');
  const captureStatus = document.getElementById('captureStatus');

  if (captureText && captureStatus && heroMap && !reduceMotion) {
    let ci = 0;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const typeInto = async (el, text) => {
      el.textContent = '';
      for (let i = 0; i <= text.length; i++) {
        el.textContent = text.slice(0, i);
        await wait(34);
      }
    };

    const spawnNode = (label, color) => {
      const { nodes, state } = heroMap;
      const x = state.w * (0.25 + Math.random() * 0.5);
      const y = state.h * (0.2 + Math.random() * 0.45);
      nodes.push({
        x, y,
        vx: (Math.random() - 0.5) * 0.1,
        vy: (Math.random() - 0.5) * 0.1,
        r: 3.4,
        color,
        label,
        alpha: 1,
        bloom: 0,
      });
      // keep the constellation from getting crowded
      const spawned = nodes.filter((n) => n.label && !LABELS.includes(n.label));
      if (spawned.length > 4) {
        const oldest = nodes.indexOf(spawned[0]);
        if (oldest >= 0) nodes.splice(oldest, 1);
      }
    };

    const runCaptureLoop = async () => {
      // small initial pause so the page settles first
      await wait(1600);
      for (;;) {
        const cap = CAPTURES[ci % CAPTURES.length];
        ci += 1;
        await typeInto(captureText, cap.text);
        for (const status of STATUSES) {
          captureStatus.textContent = status;
          captureStatus.classList.add('show');
          await wait(status === 'placing…' ? 650 : 950);
        }
        captureStatus.classList.remove('show');
        spawnNode(cap.label, cap.color);
        await wait(500);
        captureText.textContent = '';
        await wait(2600);
      }
    };
    runCaptureLoop();
  } else if (captureText) {
    captureText.textContent = 'attention might be a moral act';
  }

  // App loader art (mobile/components/ui/AsciiLoader.tsx): the cat keeps you
  // company.
  const CAT_FRAMES = [
    ' /\\_/\\\n( o.o )\n > ^ <',
    ' /\\_/\\\n( o.o )\n > ^ <',
    ' /\\_/\\\n( o.o )\n > ^ <',
    ' /\\_/\\\n( -.- )\n > ^ <',
    ' /\\_/\\\n( o.o )\n > ^ <',
    ' /\\_/\\\n( o.o )\n > ^ <',
    ' /\\_/\\\n( o.- )\n > ^ <',
    ' /\\_/\\\n( -.- )\n > ^ <',
  ];
  const startCatLoop = (el) => {
    let fi = 0;
    setInterval(() => {
      el.textContent = CAT_FRAMES[fi % CAT_FRAMES.length];
      fi += 1;
    }, 420);
  };

  /* ---------- scroll cat ---------- */

  // The same cat from the app's loader sits partway down the page (static
  // frame in the markup) and wakes up the first time it scrolls into view.
  const scrollCat = document.getElementById('scrollCat');
  if (scrollCat && !reduceMotion) {
    const catIo = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          startCatLoop(scrollCat);
          catIo.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    catIo.observe(scrollCat);
  }

})();
