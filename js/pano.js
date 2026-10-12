/* Villa Arka · 360 viewer.
   A small WebGL renderer for equirectangular panoramas (one texture per room,
   converted from the villa's original krpano cube tiles), plus the full-screen
   tour that every [data-tour] button opens. No library, no third party.

   Angles follow the original tour: h (yaw) in degrees, positive to the right;
   v in degrees, positive DOWN (krpano's atv). Internally pitch is positive up. */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var TOUR = global.VA_TOUR || { scenes: [], groups: {} };
  var byId = {};
  TOUR.scenes.forEach(function (s) { byId[s.id] = s; });
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function lang() { return document.documentElement.lang || 'hr'; }
  function title(s) { return (s && (s.t[lang()] || s.t.en)) || ''; }

  /* --------------------------------------------------------------- shaders */
  var VS = 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}';
  var FS = [
    'precision highp float;',
    'varying vec2 v;',
    'uniform sampler2D A;uniform sampler2D B;uniform float mixB;',
    'uniform float yaw;uniform float pitch;uniform float t;uniform float aspect;',
    'vec2 equi(vec3 d){return vec2(atan(d.x,d.z)/6.2831853+.5,.5-asin(clamp(d.y,-1.,1.))/3.1415927);}',
    'void main(){',
    ' vec3 d=normalize(vec3(v.x*t*aspect,v.y*t,1.));',
    ' float cp=cos(pitch),sp=sin(pitch);',
    ' d=vec3(d.x,d.y*cp+d.z*sp,-d.y*sp+d.z*cp);',
    ' float cy=cos(yaw),sy=sin(yaw);',
    ' d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);',
    ' vec2 uv=equi(d);',
    ' vec4 c=texture2D(A,uv);',
    ' if(mixB>0.){c=mix(c,texture2D(B,uv),mixB);}',
    ' gl_FragColor=vec4(c.rgb,1.);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- viewer */
  function Pano(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.yaw = 0; this.pitch = 0; this.fov = opts.fov || 80; // vertical fov, degrees
    this.minFov = 34; this.maxFov = 100;
    this.mixB = 0; this.frame = 0; this.texA = null; this.texB = null;
    this.onrender = null;
    // canvas size cached from a ResizeObserver, so drawing never reads layout
    var self0 = this;
    this.cw = canvas.clientWidth; this.ch = canvas.clientHeight;
    if ('ResizeObserver' in window) new ResizeObserver(function (es) {
      var r = es[0].contentRect; self0.cw = r.width; self0.ch = r.height; self0.draw();
    }).observe(canvas);
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' }) ||
             canvas.getContext('experimental-webgl');
    this.gl = gl;
    if (!gl) return;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    var prog = gl.createProgram();
    [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]].forEach(function (s) {
      var sh = gl.createShader(s[0]); gl.shaderSource(sh, s[1]); gl.compileShader(sh); gl.attachShader(prog, sh);
    });
    gl.linkProgram(prog); gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    var self = this;
    ['A', 'B', 'mixB', 'yaw', 'pitch', 't', 'aspect'].forEach(function (n) { self.u[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(this.u.A, 0); gl.uniform1i(this.u.B, 1);
  }

  Pano.prototype.ok = function () { return !!this.gl; };

  /* Phones and small GPUs get the 2048 texture; everything else the 4096. */
  Pano.prototype.src = function (id) {
    var big = this.maxTex >= 4096 && !(matchMedia('(max-width: 860px)').matches && matchMedia('(pointer: coarse)').matches);
    return 'pano/' + id + (big ? '' : '-m') + '.webp';
  };

  Pano.prototype.texture = function (img) {
    var gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    // Power-of-two equirect: REPEAT on s closes the seam at ±180°. No mipmaps,
    // because a mip lookup across that seam draws a hairline.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  };

  /* Upload a big panorama in horizontal strips over several frames, so a
     4096px texture never costs one long frame. Falls back to a single upload
     where createImageBitmap cannot crop. */
  Pano.prototype.textureAsync = function (img) {
    var gl = this.gl, self = this, W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, ROWS = 256;
    // strips are cut from an already decoded ImageBitmap; an <img> source would be re-decoded per strip
    if (typeof createImageBitmap !== 'function' || H <= ROWS || !(window.ImageBitmap && img instanceof ImageBitmap)) {
      var t = this.texture(img); if (img.close) img.close(); return Promise.resolve(t);
    }
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, W, H, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    var y = 0;
    return new Promise(function (res) {
      (function next() {
        var h = Math.min(ROWS, H - y), y0 = y;
        createImageBitmap(img, 0, y0, W, h).then(function (bmp) {
          requestAnimationFrame(function () {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, gl.RGB, gl.UNSIGNED_BYTE, bmp);
            if (bmp.close) bmp.close();
            y = y0 + h;
            if (y < H) next(); else { if (img.close) img.close(); res(tex); }
          });
        }, function () { gl.deleteTexture(tex); res(self.texture(img)); });
      })();
    });
  };

  var cache = {};
  function loadImage(url) {
    if (!cache[url]) {
      cache[url] = new Promise(function (res, rej) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () { (img.decode ? img.decode() : Promise.resolve()).then(function () { res(img); }, function () { res(img); }); };
        img.onerror = function () { delete cache[url]; rej(new Error('pano ' + url)); };
        img.src = url;
      });
    }
    return cache[url];
  }
  /* The fast path: fetch the file once (the compressed bytes are what we
     cache, a megabyte or two), decode it off the main thread into an
     ImageBitmap only when the room is shown, and free the bitmap after the
     upload. Old browsers fall back to an <img>. */
  var blobs = {}, canBitmap = typeof createImageBitmap === 'function' && typeof fetch === 'function';
  function loadBlob(url) {
    if (!blobs[url]) blobs[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error('pano ' + url); return r.blob(); })
      .catch(function (e) { delete blobs[url]; throw e; });
    return blobs[url];
  }
  function decodePano(url) {
    if (!canBitmap) return loadImage(url);
    return loadBlob(url).then(function (b) { return createImageBitmap(b); }).catch(function () { return loadImage(url); });
  }
  Pano.preload = function (url) { return (canBitmap ? loadBlob(url) : loadImage(url)).catch(function () {}); };

  /* Load a room. With fade, the previous room cross-dissolves into the new one. */
  Pano.prototype.show = function (id, fade) {
    var self = this;
    if (!this.gl) return Promise.reject(new Error('no webgl'));
    return decodePano(this.src(id)).then(function (img) { return self.textureAsync(img); }).then(function (tex) {
      var gl = self.gl;
      if (self.texB) gl.deleteTexture(self.texB);
      if (fade && self.texA && !reduce) {
        self.texB = self.texA; self.texA = tex; self.mixB = 1;
        var t0 = performance.now();
        (function step(now) {
          var k = Math.min(1, (now - t0) / 520);
          self.mixB = 1 - (k * k * (3 - 2 * k));
          self.draw();
          if (k < 1) requestAnimationFrame(step);
          else { gl.deleteTexture(self.texB); self.texB = null; self.mixB = 0; self.draw(); }
        })(t0);
      } else {
        if (self.texA) gl.deleteTexture(self.texA);
        self.texA = tex; self.texB = null; self.mixB = 0;
      }
      self.draw();
      return tex;
    });
  };

  Pano.prototype.size = function () {
    var c = this.canvas, dpr = Math.min(devicePixelRatio || 1, 1.75);
    if (!this.cw) { this.cw = c.clientWidth; this.ch = c.clientHeight; }
    var w = Math.round(this.cw * dpr), h = Math.round(this.ch * dpr);
    if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
    return [this.cw, this.ch];
  };

  Pano.prototype.draw = function () {
    var gl = this.gl;
    if (!gl || !this.texA) return;
    this.size();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texB || this.texA);
    gl.uniform1f(this.u.mixB, this.mixB);
    gl.uniform1f(this.u.yaw, this.yaw * DEG);
    gl.uniform1f(this.u.pitch, this.pitch * DEG);
    gl.uniform1f(this.u.t, Math.tan(this.fov * DEG / 2));
    gl.uniform1f(this.u.aspect, this.canvas.width / this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.onrender) this.onrender();
  };

  /* Screen position (CSS px) of a hotspot given in the original tour's h/v. */
  Pano.prototype.project = function (h, v) {
    var w = this.cw || this.canvas.clientWidth, hgt = this.ch || this.canvas.clientHeight;
    var lon = h * DEG, lat = -v * DEG;
    var x = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
    var cy = Math.cos(this.yaw * DEG), sy = Math.sin(this.yaw * DEG);
    var x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    var cp = Math.cos(this.pitch * DEG), sp = Math.sin(this.pitch * DEG);
    var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    if (z2 <= 0.05) return null;
    var t = Math.tan(this.fov * DEG / 2), a = w / hgt;
    var sx = (x1 / z2) / (t * a), sy2 = (y2 / z2) / t;
    if (Math.abs(sx) > 1.15 || Math.abs(sy2) > 1.15) return null;
    return { x: (sx + 1) / 2 * w, y: (1 - sy2) / 2 * hgt };
  };

  /* Hotspot buttons for a scene, laid over a viewer. */
  function Spots(layer, pano, onpick) {
    this.layer = layer; this.pano = pano; this.items = []; this.onpick = onpick;
  }
  Spots.prototype.set = function (scene) {
    var self = this;
    this.layer.textContent = '';
    this.items = (scene ? scene.spots : []).map(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'spot';
      b.textContent = title(byId[s.to]);
      b.addEventListener('click', function (e) { e.stopPropagation(); self.onpick(s.to); });
      self.layer.appendChild(b);
      return { el: b, s: s };
    });
    this.place();
  };
  Spots.prototype.place = function () {
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i], q = this.pano.project(it.s.h, it.s.v);
      if (q) {
        it.el.removeAttribute('data-off'); it.el.tabIndex = 0;
        it.el.style.transform = 'translate3d(' + (q.x - 12).toFixed(1) + 'px,' + (q.y - 18).toFixed(1) + 'px,0)';
      } else { it.el.setAttribute('data-off', ''); it.el.tabIndex = -1; }
    }
  };

  /* ------------------------------------------------------------- the tour */
  var Tour = {
    dlg: null, pano: null, spots: null, cur: null, opener: null,
    rotate: false, gyro: false, raf: 0, idleAt: 0,
    vel: 0, drag: null, pinch: null,

    init: function () {
      var dlg = this.dlg = document.getElementById('tour');
      if (!dlg) return;
      var self = this;
      document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-tour]');
        if (!b) return;
        e.preventDefault();
        self.open(b.getAttribute('data-tour'), b);
      });
      dlg.addEventListener('close', function () { self.closed(); });
      dlg.querySelector('[data-tool="close"]').addEventListener('click', function () { dlg.close(); });
      dlg.querySelector('[data-tool="rotate"]').addEventListener('click', function () { self.setRotate(!self.rotate); });
      dlg.querySelector('[data-tool="full"]').addEventListener('click', function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (dlg.requestFullscreen) dlg.requestFullscreen().catch(function () {});
      });
      var gb = dlg.querySelector('[data-tool="gyro"]');
      if ('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches) {
        gb.hidden = false;
        gb.addEventListener('click', function () { self.setGyro(!self.gyro); });
      }
      if (/^#360\//.test(location.hash)) {
        var id = location.hash.slice(5);
        if (byId[id]) setTimeout(function () { self.open(id); }, 60);
      }
    },

    buildRooms: function () {
      var nav = this.dlg.querySelector('.tour__rooms'), self = this;
      nav.textContent = '';
      ['house', 'fun', 'out'].forEach(function (g) {
        var h = document.createElement('h4');
        h.textContent = (TOUR.groups[g] || {})[lang()] || g;
        var ul = document.createElement('ul');
        TOUR.scenes.filter(function (s) { return s.g === g; }).forEach(function (s) {
          var li = document.createElement('li'), b = document.createElement('button');
          b.type = 'button'; b.setAttribute('data-go', s.id);
          var img = document.createElement('img');
          img.src = 'pano/thumb-' + s.id + '.webp'; img.alt = ''; img.loading = 'lazy'; img.width = 160; img.height = 106;
          var span = document.createElement('span'); span.textContent = title(s);
          b.appendChild(img); b.appendChild(span);
          b.addEventListener('click', function () { self.go(s.id); });
          li.appendChild(b); ul.appendChild(li);
        });
        nav.appendChild(h); nav.appendChild(ul);
      });
    },

    open: function (id, opener) {
      if (!byId[id]) id = 'dnevni-boravak';
      var dlg = this.dlg, self = this;
      this.opener = opener || document.activeElement;
      if (!this.pano) {
        this.pano = new Pano(dlg.querySelector('.tour__gl'), { fov: 82 });
        if (!this.pano.ok()) { location.href = 'pano/' + id + '.webp'; return; }
        this.spots = new Spots(dlg.querySelector('.tour__spots'), this.pano, function (to) { self.go(to, true); });
        this.bindInput();
        this.buildRooms();
      }
      if (!dlg.open) dlg.showModal();
      document.documentElement.style.overflow = 'hidden';
      this.go(id, false);
      this.loop();
    },

    closed: function () {
      cancelAnimationFrame(this.raf); this.raf = 0;
      this.setGyro(false);
      document.documentElement.style.overflow = '';
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      if (/^#360\//.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
      if (this.opener && this.opener.focus) this.opener.focus({ preventScroll: true });
    },

    go: function (id, fade) {
      var s = byId[id]; if (!s) return;
      var self = this, dlg = this.dlg;
      this.cur = s;
      dlg.querySelector('[data-tour-title]').textContent = title(s);
      dlg.setAttribute('aria-label', 'Villa Arka 360°: ' + title(s));
      dlg.querySelectorAll('[data-go]').forEach(function (b) {
        var on = b.getAttribute('data-go') === id;
        b.setAttribute('aria-current', on ? 'true' : 'false');
        if (on && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
      history.replaceState(null, '', '#360/' + id);
      dlg.classList.add('is-switching');
      this.spots.set(null);
      this.pano.show(id, fade).then(function () {
        if (self.cur !== s) return;
        if (!fade) { self.pano.yaw = s.yaw || 0; self.pano.pitch = 0; self.pano.fov = 82; }
        dlg.classList.remove('is-switching');
        self.spots.set(s);
        self.pano.draw();
        s.spots.forEach(function (sp) { Pano.preload(self.pano.src(sp.to)); });
      }, function () { dlg.classList.remove('is-switching'); });
    },

    setRotate: function (on) {
      this.rotate = on && !reduce;
      this.dlg.querySelector('[data-tool="rotate"]').setAttribute('aria-pressed', String(this.rotate));
    },

    setGyro: function (on) {
      var self = this, b = this.dlg && this.dlg.querySelector('[data-tool="gyro"]');
      if (!b) return;
      if (!on) {
        if (this.gyroFn) removeEventListener('deviceorientation', this.gyroFn);
        this.gyro = false; this.gyroFn = null; b.setAttribute('aria-pressed', 'false'); return;
      }
      var start = function () {
        var base = null;
        self.gyroFn = function (e) {
          if (e.alpha == null) return;
          var ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
          var yaw = -e.alpha, pitch = (ang === 0 ? e.beta - 90 : (ang === 90 ? -e.gamma - 90 : e.gamma - 90));
          if (ang !== 0) yaw -= ang;
          if (base === null) base = { yaw: yaw, at: self.pano.yaw };
          self.pano.yaw = base.at + (yaw - base.yaw);
          self.pano.pitch = Math.max(-85, Math.min(85, ang === 0 ? e.beta - 90 : pitch));
          self.touched();
        };
        addEventListener('deviceorientation', self.gyroFn);
        self.gyro = true; b.setAttribute('aria-pressed', 'true'); self.setRotate(false);
      };
      var D = global.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function') D.requestPermission().then(function (r) { if (r === 'granted') start(); }).catch(function () {});
      else start();
    },

    touched: function () { this.idleAt = performance.now(); this.dlg.classList.add('is-touched'); },

    bindInput: function () {
      var self = this, c = this.pano.canvas, pts = {};
      function px() { return self.pano.fov / c.clientHeight; } // degrees per CSS pixel
      c.addEventListener('pointerdown', function (e) {
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pts);
        if (ids.length === 2) {
          var a = pts[ids[0]], b = pts[ids[1]];
          self.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: self.pano.fov }; self.drag = null;
        } else { self.drag = { x: e.clientX, y: e.clientY, t: performance.now() }; self.vel = 0; }
        self.touched(); self.setRotate(false);
      });
      addEventListener('pointermove', function (e) {
        if (!pts[e.pointerId]) return;
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pts);
        if (self.pinch && ids.length === 2) {
          var a = pts[ids[0]], b = pts[ids[1]];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          self.pano.fov = Math.max(self.pano.minFov, Math.min(self.pano.maxFov, self.pinch.fov * self.pinch.d / d));
        } else if (self.drag) {
          var k = px(), dx = e.clientX - self.drag.x, dy = e.clientY - self.drag.y, now = performance.now();
          self.pano.yaw -= dx * k * 1.1;
          self.pano.pitch = Math.max(-85, Math.min(85, self.pano.pitch + dy * k));
          self.vel = -dx * k * 1.1 / Math.max(8, now - self.drag.t) * 16;
          self.drag = { x: e.clientX, y: e.clientY, t: now };
        }
        self.touched();
      });
      function up(e) {
        delete pts[e.pointerId];
        if (Object.keys(pts).length < 2) self.pinch = null;
        if (!Object.keys(pts).length) self.drag = null;
      }
      addEventListener('pointerup', up); addEventListener('pointercancel', up);
      c.addEventListener('wheel', function (e) {
        e.preventDefault();
        self.pano.fov = Math.max(self.pano.minFov, Math.min(self.pano.maxFov, self.pano.fov * (1 + e.deltaY * 0.0012)));
        self.touched();
      }, { passive: false });
      this.dlg.addEventListener('keydown', function (e) {
        var k = e.key, p = self.pano, hit = true;
        if (e.target.tagName === 'BUTTON' && (k === 'Enter' || k === ' ')) return;
        if (k === 'ArrowLeft') p.yaw -= 8; else if (k === 'ArrowRight') p.yaw += 8;
        else if (k === 'ArrowUp') p.pitch = Math.min(85, p.pitch + 6); else if (k === 'ArrowDown') p.pitch = Math.max(-85, p.pitch - 6);
        else if (k === '+' || k === '=') p.fov = Math.max(p.minFov, p.fov - 6); else if (k === '-') p.fov = Math.min(p.maxFov, p.fov + 6);
        else hit = false;
        if (hit && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); self.touched(); }
      });
    },

    loop: function () {
      var self = this, last = performance.now();
      cancelAnimationFrame(this.raf);
      (function tick(now) {
        if (!self.dlg.open) return;
        var dt = Math.min(64, now - last); last = now;
        var p = self.pano;
        if (!self.drag && Math.abs(self.vel) > 0.002) { p.yaw += self.vel * dt / 16; self.vel *= Math.pow(0.9, dt / 16); }
        if (self.rotate) p.yaw += 0.006 * dt;
        p.draw(); self.spots.place();
        self.raf = requestAnimationFrame(tick);
      })(last);
    }
  };

  global.VAPano = Pano;
  global.VASpots = Spots;
  global.VATour = Tour;
  global.VAScenes = byId;
})(window);
