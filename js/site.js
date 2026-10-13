/* Villa Arka · page behaviour. The engine (scrollcraft.js) drives the acts;
   this file does what only this site does: the clock and thermometer, the
   ice-to-ember regrade, snow, the fire's warmth, the scroll-turned 360, the
   steam, and the request form. */
(function () {
  'use strict';

  /* Where the request form sends. PLACEHOLDER until the client confirms. */
  var CONTACT_EMAIL = 'info@villaarka.hr';

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var root = document.documentElement;
  var LANGS = ['hr', 'en', 'de', 'it', 'sl'];
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  /* ------------------------------------------------------------- language
     Applied before the engine mounts, so kinetic headlines split the right
     words. Switching reloads, for the same reason. */
  var lang = (function () {
    var q = new URLSearchParams(location.search).get('lang');
    if (LANGS.indexOf(q) > -1) return q;
    try { var s = localStorage.getItem('va-lang'); if (LANGS.indexOf(s) > -1) return s; } catch (e) {}
    var n = (navigator.languages || [navigator.language || 'en']).map(function (l) { return String(l).slice(0, 2).toLowerCase(); });
    for (var i = 0; i < n.length; i++) {
      if (n[i] === 'bs' || n[i] === 'sr') return 'hr';
      if (LANGS.indexOf(n[i]) > -1) return n[i];
    }
    return 'en';
  })();
  var DICT = (window.VA_I18N || {})[lang] || null;
  function t(key, fallback) { return (DICT && DICT[key]) || fallback; }
  root.lang = lang;
  if (DICT) {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = DICT[el.getAttribute('data-i18n')]; if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
      var v = DICT[el.getAttribute('data-i18n-alt')]; if (v) el.alt = v;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var v = DICT[el.getAttribute('data-i18n-aria')]; if (v) el.setAttribute('aria-label', v);
    });
    if (DICT['meta.title']) document.title = DICT['meta.title'];
    var md = document.querySelector('meta[name="description"]');
    if (md && DICT['meta.desc']) md.content = DICT['meta.desc'];
  }
  var sel = document.querySelector('[data-lang]');
  if (sel) {
    sel.value = lang;
    sel.addEventListener('change', function () {
      try { localStorage.setItem('va-lang', sel.value); } catch (e) {}
      var u = new URL(location.href); u.searchParams.set('lang', sel.value); u.hash = '';
      location.href = u.toString();
    });
  }

  /* stagger index for the room rail's settle */
  document.querySelectorAll('.rail > .room, .rail > .rail__facts').forEach(function (el, i) { el.style.setProperty('--i', String(i + 1)); });

  /* AV1 only where the device decodes it in hardware (same picture at about
     70% of the bytes); everywhere else H.264, which every device decodes in
     hardware. Software AV1 makes each scrubbed seek cost a long frame, and a
     smooth page matters more than a few megabytes. Decided before mount,
     because the engine reads data-sc-src when it mounts. */
  function pickAV1() {
    var type = 'video/mp4; codecs="av01.0.08M.08"';
    if (/[?&]codec=h264/.test(location.search)) return Promise.resolve(false);
    try { if (document.createElement('video').canPlayType(type) !== 'probably') return Promise.resolve(false); } catch (e) { return Promise.resolve(false); }
    if (!navigator.mediaCapabilities || !navigator.mediaCapabilities.decodingInfo) return Promise.resolve(false);
    return navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: type, width: 1920, height: 1080, bitrate: 6000000, framerate: 24 } })
      .then(function (r) { return !!(r && r.supported && r.smooth && r.powerEfficient); }, function () { return false; });
  }
  var mounted = false;
  function mountOnce(av1) {
    if (mounted) return; mounted = true;
    if (av1) document.querySelectorAll('video[data-av1]').forEach(function (v) {
      v.setAttribute('data-sc-src', v.getAttribute('data-av1'));
      if (v.hasAttribute('data-av1-mobile')) v.setAttribute('data-sc-src-mobile', v.getAttribute('data-av1-mobile'));
    });
    ScrollCraft.mount(document.body);
    if (typeof queueMeasure === 'function') queueMeasure();
  }
  pickAV1().then(mountOnce, function () { mountOnce(false); });
  setTimeout(function () { mountOnce(false); }, 400);    // never wait long for the answer
  if (window.VATour) VATour.init();

  /* ------------------------------------------------------- shared state */
  var sections = Array.prototype.slice.call(document.querySelectorAll('main > section[data-hour]'));
  var peak = document.getElementById('prag');
  var look = document.getElementById('razgledaj');
  var morning = document.getElementById('rezervacija');
  var vh = innerHeight;

  function prog(el) { return parseFloat(el.style.getPropertyValue('--sc-p')) || 0; }

  /* Layout cache. Section offsets and the viewport are measured on resize and
     when the document's height changes, never inside the frame loop, so the
     loop only ever reads numbers and writes styles: no forced layouts. */
  var VW = root.clientWidth, VH = innerHeight, SY = scrollY, geo = new Map(), measureHooks = [];
  function measure() {
    VW = root.clientWidth; VH = innerHeight; vh = VH;
    var sy = scrollY;
    document.querySelectorAll('main > section').forEach(function (sec) {
      var r = sec.getBoundingClientRect(); geo.set(sec, { top: r.top + sy, h: r.height });
    });
    measureHooks.forEach(function (f) { f(); });
  }
  var measureQueued = false;
  function queueMeasure() { if (!measureQueued) { measureQueued = true; requestAnimationFrame(function () { measureQueued = false; measure(); }); } }
  addEventListener('resize', queueMeasure, { passive: true });
  addEventListener('load', queueMeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueMeasure);
  if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe(document.body);
  function topOf(el) { var g = geo.get(el); return g ? g.top - SY : 0; }
  function onScreen(el, margin) {
    var g = geo.get(el); if (!g) return false;
    var m = (margin || 0) * VH, t = g.top - SY;
    return t + g.h > -m && t < VH + m;
  }

  /* Sections only hold GPU memory while they are on screen: an .is-live
     class turns their compositor layers on, and their canvases are emptied
     (width 0) when they leave. Toggled on change only. */
  var liveState = new Map(), liveHooks = new Map();
  function setLive(el, on) {
    if (liveState.get(el) === on) return on;
    liveState.set(el, on); el.classList.toggle('is-live', on);
    (liveHooks.get(el) || []).forEach(function (f) { f(on); });
    return on;
  }
  function onLive(el, f) { if (!liveHooks.has(el)) liveHooks.set(el, []); liveHooks.get(el).push(f); }
  function freeCanvas(c) { return function (on) { if (!on) { c.width = 0; c.height = 0; } }; }

  /* one soft round sprite per colour, drawn once, stamped many times */
  function sprite(rgb, size, core) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(' + rgb + ',1)'); g.addColorStop(core, 'rgba(' + rgb + ',.55)'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, size, size); return c;
  }

  /* scroll velocity, smoothed: snow streaks harder when the hand moves fast */
  var lastY = scrollY, vel = 0;

  /* ------------------------------------------------ clock + thermometer */
  var clockBtn = document.querySelector('.clock');
  var stay = document.getElementById('stay');
  var clockH = document.querySelector('[data-clock-h]');
  var clockT = document.querySelector('[data-clock-t]');
  var stayLinks = stay ? stay.querySelectorAll('a') : [];
  var shown = { h: '', t: '', id: '' };
  function fmtT(x) { x = Math.round(x); return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x); }

  if (clockBtn) {
    clockBtn.addEventListener('click', function () {
      var open = clockBtn.getAttribute('aria-expanded') === 'true';
      clockBtn.setAttribute('aria-expanded', String(!open));
      stay.hidden = open;
      if (!open) { var cur = stay.querySelector('[aria-current="true"]') || stayLinks[0]; cur && cur.focus(); }
    });
    stay.addEventListener('click', function (e) { if (e.target.closest('a')) closeStay(); });
    document.addEventListener('click', function (e) { if (!stay.hidden && !e.target.closest('.stay, .clock')) closeStay(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !stay.hidden) { closeStay(); clockBtn.focus(); } });
  }
  function closeStay() { clockBtn.setAttribute('aria-expanded', 'false'); stay.hidden = true; }

  /* --------------------------------------------------------------- snow */
  function Snow(canvas, kind) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.kind = kind; this.w = 0; this.h = 0;
    var self = this; measureHooks.push(function () { self.w = canvas.clientWidth; self.h = canvas.clientHeight; });
    this.near = kind === 'near';
    this.n = this.near ? 16 : kind === 'far' ? 150 : 110;
    this.f = [];
    for (var i = 0; i < this.n; i++) this.f.push(this.spawn(true));
  }
  Snow.prototype.spawn = function (any) {
    var near = this.near, z = near ? 0.75 + Math.random() * 0.25 : Math.random();
    return {
      x: Math.random(), y: any ? Math.random() : -0.05,
      r: near ? 3 + z * 5.5 : 0.6 + z * 2.1,
      s: (near ? 0.05 : 0.018 + z * 0.05) * (0.8 + Math.random() * 0.4),
      d: Math.random() * 6.28, a: near ? 0.32 + Math.random() * 0.2 : 0.35 + z * 0.55
    };
  };
  Snow.prototype.draw = function (dt, v) {
    var c = this.c, ctx = this.ctx, dpr = Math.min(devicePixelRatio || 1, 1.5);
    var w = this.w, h = this.h;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var k = dt / 1000, push = clamp(v, -60, 60);
    for (var i = 0; i < this.f.length; i++) {
      var p = this.f[i];
      p.d += k * 0.8;
      p.y += p.s * k * (1 + Math.abs(push) * 0.02) - push * 0.0006 * p.r;
      p.x += Math.sin(p.d) * 0.0006 + 0.0004;
      if (p.y > 1.05 || p.y < -0.08 || p.x > 1.05) { this.f[i] = this.spawn(false); if (push < 0) this.f[i].y = 1.04; continue; }
      var x = p.x * w, y = p.y * h, stretch = 1 + Math.min(4, Math.abs(push) * 0.05);
      if (this.near) {
        var R = p.r * 1.6;
        ctx.globalAlpha = p.a; ctx.drawImage(FLAKE, x - R, y - R * stretch, R * 2, R * 2 * stretch); ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'rgba(236,243,248,' + p.a + ')';
        ctx.beginPath(); ctx.ellipse(x, y, p.r, p.r * stretch, 0, 0, 6.283); ctx.fill();
      }
    }
  };
  var FLAKE = sprite('240,246,250', 64, .35);
  if (/[?&]nosnow/.test(location.search)) document.querySelectorAll('.snow--near').forEach(function (c) { c.remove(); }); // test flag: measure text without the near flakes
  var snows = reduce ? [] : Array.prototype.map.call(document.querySelectorAll('canvas[data-snow]'), function (c) {
    var host = c.closest('section'); onLive(host, freeCanvas(c));
    return { s: new Snow(c, c.getAttribute('data-snow')), host: host };
  });

  /* ------------------------------------------------- the fire's warmth
     The signature move. The room in Clip B starts cold: everything is greyed
     and cooled by one layer, except a small circle around the fire. As the
     visitor scrolls, that circle grows out from wherever the fire is in the
     film until the whole room is warm, embers rise from the fire, and the
     thermometer climbs from -8 to +22. */
  var warmth = (function () {
    if (!peak) return null;
    var cold = peak.querySelector('.peak__cold'), cv = peak.querySelector('.embers');
    var tempEl = peak.querySelector('[data-peak-temp]'), vid = peak.querySelector('video');
    var ctx = cv.getContext('2d'), sparks = [], lastTemp = '', lastState = '';
    onLive(peak, function (on) { if (!on) { cv.width = 0; cv.height = 0; sparks.length = 0; } });
    var EMBER = sprite('255,170,80', 48, .22), CORE = sprite('255,230,180', 24, .4);
    var stageEl = peak.querySelector('[data-sc-stage]');
    var mqPortrait = matchMedia('(max-width: 860px)');
    // where the fire is in the landscape film, second by second (fraction of
    // the frame), measured from the clip; the phone cut pans to keep it centred
    var FX = [.84, .84, .83, .77, .78, .75, .71, .625, .59, .56, .55], FY = .64;
    function firePos() {
      var W = VW, H = VH;
      var portrait = mqPortrait.matches;
      var vw = portrait ? 608 : 1920, vh2 = 1080;
      var tt = vid && vid.duration ? clamp(vid.currentTime / vid.duration, 0, 1) * 10 : 0;
      var i = Math.min(9, Math.floor(tt)), fx = portrait ? .5 : lerp(FX[i], FX[i + 1], tt - i);
      var s = Math.max(W / vw, H / vh2);                    // object-fit: cover
      return { x: (W - vw * s) / 2 + fx * vw * s, y: (H - vh2 * s) / 2 + FY * vh2 * s, W: W, H: H };
    }
    function spawn(f, heat) {
      sparks.push({ x: f.x + (Math.random() - .5) * f.W * .05, y: f.y + (Math.random() - .5) * f.H * .03,
        vx: (Math.random() - .5) * 18, vy: -(30 + Math.random() * 70) * (0.6 + heat), life: 0,
        max: 1.6 + Math.random() * 2.4, r: .7 + Math.random() * 1.8, ph: Math.random() * 6.28 });
    }
    return function (p, w, dt) {
      var f = firePos(), diag = Math.hypot(f.W, f.H);
      // the warm circle: a glow around the fire at first, the whole room by the end
      var r = lerp(Math.min(f.W, f.H) * .09, diag * 1.15, w);
      var soft = lerp(Math.min(f.W, f.H) * .16, diag * .35, w);
      cold.style.setProperty('--fx', f.x.toFixed(1) + 'px');
      cold.style.setProperty('--fy', f.y.toFixed(1) + 'px');
      cold.style.setProperty('--r0', r.toFixed(1) + 'px');
      cold.style.setProperty('--r1', (r + soft).toFixed(1) + 'px');
      cold.style.opacity = (1 - smooth(0.85, 1, w)).toFixed(3);
      var tv = Math.round(-8 + 30 * w), ts = (tv > 0 ? '+' : tv < 0 ? '−' : '') + Math.abs(tv);
      if (ts !== lastTemp) { tempEl.textContent = ts; lastTemp = ts; }
      var st = 'w:' + w.toFixed(2) + ' t:' + (vid ? vid.currentTime.toFixed(1) : 0);
      if (st !== lastState) { stageEl.setAttribute('data-sc-verify-state', st); lastState = st; }
      if (reduce) return;
      // embers: more of them, and faster, as the room warms
      var dpr = Math.min(devicePixelRatio || 1, 1.5);
      if (cv.width !== Math.round(f.W * dpr)) { cv.width = Math.round(f.W * dpr); cv.height = Math.round(f.H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, f.W, f.H);
      var k = dt / 1000, rate = 6 + 34 * w;
      for (var n = rate * k; n > 0; n--) if (Math.random() < n) spawn(f, w);
      ctx.globalCompositeOperation = 'lighter';
      for (var i = sparks.length - 1; i >= 0; i--) {
        var s = sparks[i];
        s.life += k; if (s.life > s.max) { sparks.splice(i, 1); continue; }
        s.ph += k * 2.2; s.x += (s.vx + Math.sin(s.ph) * 14) * k; s.y += s.vy * k; s.vy *= 0.995;
        var a = Math.sin(Math.PI * s.life / s.max), R = s.r * 3.4;
        ctx.globalAlpha = 0.75 * a; ctx.drawImage(EMBER, s.x - R, s.y - R, R * 2, R * 2);
        ctx.globalAlpha = a; ctx.drawImage(CORE, s.x - R * .35, s.y - R * .35, R * .7, R * .7);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    };
  })();

  /* ---------------------------------------------------------- steam */
  var steam = (function () {
    var c = document.querySelector('.steam');
    if (!c || reduce) return null;
    var ctx = c.getContext('2d'), puffs = [], cw = 0, ch = 0, PUFF = sprite('255,244,232', 128, .2);
    onLive(c.closest('section'), freeCanvas(c));
    measureHooks.push(function () { cw = c.clientWidth; ch = c.clientHeight; });
    for (var i = 0; i < 18; i++) puffs.push({ x: Math.random(), y: Math.random(), r: .08 + Math.random() * .12, s: .02 + Math.random() * .03, a: Math.random() * 6.28 });
    return function (dt) {
      var w = cw, h = ch; if (!w) return;
      if (c.width !== Math.round(w / 2)) { c.width = Math.round(w / 2); c.height = Math.round(h / 2); }
      var W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < puffs.length; i++) {
        var p = puffs[i];
        p.y -= p.s * dt / 1000; p.a += dt / 2400; p.x += Math.sin(p.a) * 0.0008;
        if (p.y < -0.2) { p.y = 1.05; p.x = 0.2 + Math.random() * 0.6; }
        var life = clamp((1.05 - p.y) * 2.2, 0, 1) * clamp(p.y * 3 + .4, 0, 1);
        var R = p.r * W * (1.4 - p.y * 0.5);
        ctx.globalAlpha = 0.13 * life; ctx.drawImage(PUFF, p.x * W - R, p.y * H - R, R * 2, R * 2);
      }
      ctx.globalAlpha = 1;
    };
  })();

  /* ------------------------------------------- 18:30 the scroll-turned 360 */
  var lookGL = (function () {
    if (!look || !window.VAPano) return null;
    var canvas = look.querySelector('.look__gl'), stage = look.querySelector('.look__stage');
    var scene = VAScenes['dnevni-boravak'];
    var pano = null, spots = null, live = false, dragYaw = 0, drag = null;
    function start() {
      if (pano) return;
      pano = new VAPano(canvas, { fov: 76 });
      if (!pano.ok()) return;
      spots = new VASpots(look.querySelector('.look__spots'), pano, function (to) { VATour.open(to); });
      pano.show(scene.id).then(function () { live = true; canvas.classList.add('is-live'); spots.set(scene); }, function () {});
    }
    new IntersectionObserver(function (es) { if (es[0].isIntersecting) start(); }, { rootMargin: '150% 0px' }).observe(look);
    canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y0: dragYaw }; });
    addEventListener('pointermove', function (e) { if (drag) dragYaw = drag.y0 - (e.clientX - drag.x) * 0.18; });
    addEventListener('pointerup', function () { drag = null; });
    addEventListener('pointercancel', function () { drag = null; });
    var lastKey = '';
    return function () {
      if (!live) return;
      var p = reduce ? 1 : prog(look);
      var portrait = VH > VW;
      var yaw = (scene.yaw || 0) - 65 - p * 259 + dragYaw; // dining table, round past the windows, onto the fire
      var key = yaw.toFixed(2) + (portrait ? 'p' : 'l') + VW + 'x' + VH;
      if (key === lastKey) return;                          // nothing moved: no redraw
      lastKey = key;
      pano.fov = portrait ? 96 : 74; pano.yaw = yaw; pano.pitch = -3;
      pano.draw(); spots.place();
      var yw = ((yaw % 360) + 360) % 360;
      look.style.setProperty('--yaw', yw.toFixed(1) + 'deg');
      stage.setAttribute('data-sc-verify-state', 'yaw:' + Math.round(yw));
    };
  })();

  /* ------------------------------------------------------ the regrade
     One number, five colour roles. Mixed here rather than with color-mix()
     so every browser and every contrast check reads a plain rgb(). */
  var PAIRS = {
    '--sc-canvas': ['#0B1115', '#170F0A'], '--sc-surface': ['#141D22', '#24180F'],
    '--sc-ink': ['#EAF0F1', '#F7EBDC'], '--sc-ink-soft': ['#A3B5BC', '#CDB69C'], '--sc-accent': ['#9FCFE4', '#EBA45C']
  };
  function hex(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  Object.keys(PAIRS).forEach(function (k) { PAIRS[k] = PAIRS[k].map(hex); });
  var lastW = -1;
  function regrade(el, w) {
    for (var k in PAIRS) {
      var a = PAIRS[k][0], b = PAIRS[k][1];
      el.style.setProperty(k, 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * w) + ',' + Math.round(a[1] + (b[1] - a[1]) * w) + ',' + Math.round(a[2] + (b[2] - a[2]) * w) + ')');
    }
    el.style.setProperty('--w', w.toFixed(3));
    el.style.setProperty('--cold', (1 - w).toFixed(3));
  }
  /* While the fire warms the room only the bar and the threshold are on
     screen, so only they regrade frame by frame (small subtrees). The root,
     which every element inherits from, switches once, when the room is warm
     and nothing else is visible: no full-page restyle per frame. */
  var barEl = document.querySelector('.bar'), rootW = -1;

  /* ------------------------------------------------------ the hero film
     The tour plays by itself. It loads only when motion is welcome and data
     is not being saved, picks the portrait cut on a portrait phone, pauses
     whenever the hero is off screen, and the visitor can pause it. */
  var hero = document.getElementById('dolazak');
  (function () {
    var film = hero.querySelector('.hero__film'), poster = hero.querySelector('.hero__poster');
    var pauseBtn = hero.querySelector('.hero__pause'), userPaused = false, visible = true;
    var saveData = navigator.connection && navigator.connection.saveData;
    if (!film || reduce || saveData) { if (pauseBtn) pauseBtn.hidden = true; return; }
    var portrait = matchMedia('(max-width: 860px) and (orientation: portrait)').matches;
    film.src = film.getAttribute(portrait ? 'data-src-portrait' : 'data-src');
    film.preload = 'auto';
    film.addEventListener('playing', function () { hero.classList.add('is-playing'); }, { once: true });
    function sync() {
      if (visible && !userPaused && !document.hidden) { var p = film.play(); if (p && p.catch) p.catch(function () {}); }
      else film.pause();
    }
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; sync(); }, { threshold: 0.05 }).observe(hero);
    document.addEventListener('visibilitychange', sync);
    pauseBtn.addEventListener('click', function () {
      userPaused = !userPaused;
      pauseBtn.setAttribute('aria-pressed', String(userPaused));
      pauseBtn.setAttribute('aria-label', userPaused ? t('hero.play', 'Pokreni video') : t('hero.pause', 'Zaustavi video'));
      sync();
    });
    sync();
  })();

  /* the booking bar hands its dates to the request form below */
  (function () {
    var quick = hero.querySelector('[data-quick]'), ask = document.getElementById('ask');
    if (!quick || !ask) return;
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    quick.od.min = quick.do.min = d.toISOString().slice(0, 10);
    quick.od.addEventListener('change', function () { if (quick.od.value) quick.do.min = quick.od.value; });
    quick.addEventListener('submit', function (e) {
      e.preventDefault();
      if (quick.od.value) ask.od.value = quick.od.value;
      if (quick.do.value) ask.do.value = quick.do.value;
      ask.gosti.value = quick.gosti.value;
      ask.dispatchEvent(new Event('change'));
      document.getElementById('rezervacija').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
      setTimeout(function () { (ask.od.value ? ask.ime : ask.od).focus({ preventScroll: true }); }, reduce ? 0 : 900);
    });
  })();

  /* --------------------------------------------- rooms on a curved rail */
  var roomsSec = document.getElementById('sobe');
  var roomCards = Array.prototype.slice.call(document.querySelectorAll('.rail .room'));
  var railEl = document.querySelector('.rail'), cardMid = [], lastTx = null;
  measureHooks.push(function () { cardMid = roomCards.map(function (c) { return c.offsetLeft + c.offsetWidth / 2; }); lastTx = null; });
  function drawRooms() {
    if (reduce) return;
    // the engine moves the rail with translate3d(-Xpx,0,0); card centres follow from cached offsets
    var m = /translate3d\((-?[\d.]+)px/.exec(railEl.style.transform || ''), tx = m ? parseFloat(m[1]) : 0;
    if (tx === lastTx) return; lastTx = tx;
    for (var i = 0; i < roomCards.length; i++) {
      var d = clamp((cardMid[i] + tx - VW / 2) / (VW * 0.55), -1.4, 1.4);
      roomCards[i].style.transform = 'perspective(1400px) rotateY(' + (-d * 26).toFixed(2) + 'deg) translateZ(' + (-Math.abs(d) * 110).toFixed(1) + 'px)';
    }
  }

  /* ------------------------------------------------ the pool window
     The window starts narrow between the two words of the headline and the
     scroll opens it to the full screen while the engine scrubs the glide
     inside it. Only a clip-path changes, so the film is never enlarged. On a
     wide screen the words sit left and right of the window, on a tall one
     above and below; each is sized once, on measure, to fit its side. */
  var pool = document.getElementById('bazen');
  var poolWin = pool && pool.querySelector('[data-pool-win]');
  var poolScrim = pool && pool.querySelector('.pool__scrim');
  var poolTitle = pool && pool.querySelector('.pool__title');
  var poolWords = pool ? Array.prototype.slice.call(pool.querySelectorAll('.pool__w')) : [];
  var poolStage = pool && pool.querySelector('[data-sc-stage]');
  var PW = null, poolKey = '';
  if (pool) measureHooks.push(function () {
    var W = VW, H = VH, wide = W > H * 0.9, gut = clamp(W * 0.05, 16, 64), bar = 64;
    var w0 = wide ? Math.min(W * 0.27, 470) : W * 0.6;
    var h0 = wide ? Math.min(H * 0.66, w0 * 1.5) : Math.min(H * 0.46, w0 * 1.45);
    var gap = wide ? clamp(W * 0.022, 16, 40) : clamp(H * 0.022, 12, 24);
    poolTitle.style.setProperty('--pool-fs', '100px');
    var m = poolWords.map(function (el) { return { w: el.offsetWidth, h: el.offsetHeight }; });
    var widest = Math.max(m[0].w, m[1].w);
    var fs = wide ? Math.min(W * 0.085, H * 0.17, ((W - w0) / 2 - gap - gut) / widest * 100)
                  : Math.min(W * 0.17, (W - 2 * gut) / widest * 100, ((H - h0) / 2 - gap - bar) / 1.05);
    fs = Math.max(28, fs);
    poolTitle.style.setProperty('--pool-fs', fs.toFixed(1) + 'px');
    var k = fs / 100;
    PW = { W: W, H: H, wide: wide, w0: w0, h0: h0, cy0: H * (wide ? 0.53 : 0.52), gap: gap,
           ws: m.map(function (q) { return { w: q.w * k, h: q.h * k }; }) };
    poolKey = '';
  });
  function drawPool() {
    if (!PW) return;
    var p = prog(pool), e = reduce ? 1 : smooth(0.03, 0.6, p);
    var fade = reduce ? 0 : 1 - smooth(0.2, 0.46, p), dark = smooth(0.46, 0.66, p);
    var key = e.toFixed(4) + '|' + fade.toFixed(3) + '|' + dark.toFixed(3) + '|' + PW.W + 'x' + PW.H;
    if (key === poolKey) return; poolKey = key;
    var W = PW.W, H = PW.H, w = lerp(PW.w0, W, e), h = lerp(PW.h0, H, e), cy = lerp(PW.cy0, H / 2, e);
    var top = cy - h / 2, side = (W - w) / 2, bottom = H - top - h;
    poolWin.style.clipPath = 'inset(' + Math.max(0, top).toFixed(1) + 'px ' + side.toFixed(1) + 'px ' + Math.max(0, bottom).toFixed(1) + 'px ' + side.toFixed(1) + 'px round ' + (8 * (1 - e)).toFixed(1) + 'px)';
    var a = PW.ws[0], b = PW.ws[1], ax, ay, bx, by;
    if (PW.wide) { ax = side - PW.gap - a.w; ay = cy - a.h / 2; bx = side + w + PW.gap; by = cy - b.h / 2; }
    else { ax = (W - a.w) / 2; ay = top - PW.gap - a.h; bx = (W - b.w) / 2; by = top + h + PW.gap; }
    poolWords[0].style.transform = 'translate3d(' + ax.toFixed(1) + 'px,' + ay.toFixed(1) + 'px,0)';
    poolWords[1].style.transform = 'translate3d(' + bx.toFixed(1) + 'px,' + by.toFixed(1) + 'px,0)';
    poolWords[0].style.opacity = poolWords[1].style.opacity = fade.toFixed(3);
    poolScrim.style.opacity = dark.toFixed(3);
    poolStage.setAttribute('data-sc-verify-state', 'open:' + e.toFixed(2));
  }

  /* --------------------------------------------------------- the loop
     Reads first (scroll position, cached geometry, engine progress), writes
     after, once per frame, and only for what is on screen. */
  var lastT = performance.now();
  var lightOn = null, wellness = document.getElementById('wellness');
  function frame(now) {
    var dt = Math.min(64, now - lastT); lastT = now;
    SY = scrollY; vel = vel * 0.86 + (SY - lastY) * 0.14; lastY = SY;

    // which hour are we in
    var cur = sections[0], mid = VH * 0.5;
    for (var i = 0; i < sections.length; i++) if (topOf(sections[i]) <= mid) cur = sections[i];

    // warmth: 0 outdoors, the fire carries it to 1, and it stays warm inside
    var pp = prog(peak), w = topOf(peak) > 0 ? 0 : smooth(0.12, 0.74, pp);
    var light = topOf(morning) < 40;

    var wq = Math.round(w * 50) / 50;                     // 2% steps: invisible, and fewer restyles
    if (wq !== lastW) { lastW = wq; regrade(barEl, wq); regrade(peak, wq); }
    var rw = wq >= 1 ? 1 : 0;
    if (rw !== rootW) { rootW = rw; regrade(root, rw); }
    if (warmth && onScreen(peak, 0.2)) warmth(pp, w, dt);

    // the clock and the thermometer
    var temp = parseFloat(cur.getAttribute('data-temp')) || 0;
    if (cur === peak) temp = -8 + 30 * w;
    var h = cur.getAttribute('data-hour'), tt = fmtT(temp);
    if (h !== shown.h) {
      clockH.textContent = h;
      if (shown.h) { var a = clockH.classList.contains('tick-a'); clockH.classList.toggle('tick-a', !a); clockH.classList.toggle('tick-b', a); }
      shown.h = h;
    }
    if (tt !== shown.t) { clockT.textContent = tt; shown.t = tt; }
    if (cur.id !== shown.id) {
      shown.id = cur.id;
      for (var j = 0; j < stayLinks.length; j++) stayLinks[j].setAttribute('aria-current', stayLinks[j].getAttribute('href') === '#' + cur.id ? 'true' : 'false');
    }
    if (light !== lightOn) { lightOn = light; root.toggleAttribute('data-light', light); }

    setLive(hero, onScreen(hero, 0.05));
    setLive(peak, onScreen(peak, 0.2));
    var liveWell = setLive(wellness, onScreen(wellness, 0));
    var liveRooms = setLive(roomsSec, onScreen(roomsSec, 0.15));
    if (pool && setLive(pool, onScreen(pool, 0.2))) drawPool();
    for (var k = 0; k < snows.length; k++) if (liveState.get(snows[k].host)) snows[k].s.draw(dt, vel);
    if (steam && liveWell) steam(dt);
    if (lookGL && onScreen(look, 0.2)) lookGL();
    if (liveRooms) drawRooms();

    requestAnimationFrame(frame);
  }
  measure();
  requestAnimationFrame(frame);

  /* ------------------------------------- keyboard focus inside the rail
     A focused room card must be on screen: park the pan act at the progress
     where that card is centred. */
  var rooms = document.getElementById('sobe');
  if (rooms) rooms.addEventListener('focusin', function (e) {
    var rail = rooms.querySelector('.rail'), item = e.target.closest('.room, .rail__facts, .rail__lead');
    if (!item) return;
    var over = rail.scrollWidth - innerWidth; if (over <= 0) return;
    var p = clamp((item.offsetLeft + item.offsetWidth / 2 - innerWidth / 2) / over, 0, 1);
    var top = rooms.getBoundingClientRect().top + scrollY, travel = rooms.offsetHeight - innerHeight;
    scrollTo({ top: top + p * travel, behavior: 'instant' });
  });

  /* --------------------------------------------------------- the form */
  var form = document.getElementById('ask');
  if (form) {
    var err = form.querySelector('.ask__err');
    var today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    var iso = today.toISOString().slice(0, 10);
    form.od.min = iso; form.do.min = iso;
    form.od.addEventListener('change', function () { if (form.od.value) form.do.min = form.od.value; });
    var sum = form.querySelector('[data-sum]');
    function summary() {
      var a = form.od.value, b = form.do.value;
      if (!a || !b || b <= a) { sum.hidden = true; return; }
      var n = Math.round((new Date(b) - new Date(a)) / 864e5), hol = [];
      for (var yy = +a.slice(0, 4); yy <= +b.slice(0, 4); yy++) {
        if (a <= yy + '-12-24' && yy + '-12-24' < b) hol.push(t('am.eve', 'Badnjak'));
        if (a <= yy + '-12-31' && yy + '-12-31' < b) hol.push(t('am.nye', 'Silvestrovo'));
      }
      var txt = '<strong>' + n + ' ' + t(n === 1 ? 'am.night1' : 'am.nights', n === 1 ? 'noćenje' : 'noćenja') + '</strong> · ' + form.gosti.value + ' ' + t('am.guestsN', 'gostiju');
      if (hol.length) txt += ' · <span class="hol">' + t('am.incl', 'uključuje') + ' ' + hol.join(' + ') + '</span>';
      sum.innerHTML = txt; sum.hidden = false;
    }
    ['change', 'input'].forEach(function (ev) { form.addEventListener(ev, summary); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var bad = [];
      ['od', 'do', 'ime', 'email'].forEach(function (n) {
        var f = form[n], ok = f.value.trim() !== '' && (n !== 'email' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.value));
        f.setAttribute('aria-invalid', ok ? 'false' : 'true'); if (!ok) bad.push(f);
      });
      if (!bad.length && form.do.value <= form.od.value) { form.do.setAttribute('aria-invalid', 'true'); bad.push(form.do); err.textContent = t('am.errDates', 'Odlazak mora biti nakon dolaska.'); }
      else if (bad.length) err.textContent = t('am.err', 'Ispunite datume, ime i ispravnu e-poštu.');
      if (bad.length) { err.hidden = false; bad[0].focus(); return; }
      err.hidden = true;
      var nights = Math.round((new Date(form.do.value) - new Date(form.od.value)) / 864e5);
      var subj = 'Villa Arka · ' + form.od.value + ' / ' + form.do.value + ' · ' + form.gosti.value;
      var body = [
        t('am.in', 'Dolazak') + ': ' + form.od.value,
        t('am.out', 'Odlazak') + ': ' + form.do.value + ' (' + nights + ')',
        t('am.guests', 'Gosti') + ': ' + form.gosti.value,
        t('am.name', 'Ime i prezime') + ': ' + form.ime.value,
        t('am.email', 'E-pošta') + ': ' + form.email.value,
        '', form.poruka.value
      ].join('\n');
      location.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
    });
  }

  /* ------------------------------------------------ map, only on request */
  var mapBtn = document.querySelector('[data-map-load]');
  if (mapBtn) mapBtn.addEventListener('click', function () {
    var box = mapBtn.closest('[data-map]'), f = document.createElement('iframe');
    f.title = 'OpenStreetMap · Villa Arka'; f.loading = 'lazy';
    f.src = 'https://www.openstreetmap.org/export/embed.html?bbox=14.915%2C45.352%2C14.965%2C45.377&layer=mapnik&marker=45.36434%2C14.94010';
    box.textContent = ''; box.appendChild(f);
  });
})();
