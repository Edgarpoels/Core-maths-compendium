/* viz.js \u2014 animated SVG explainers for the Core Maths Compendium.
   Additive & defensive: only touches <figure class="viz" data-viz="\u2026" data-variant="\u2026">.
   Each figure draws itself when scrolled into view; the Replay button plays it again. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var C = { ink: '#12233A', green: '#1B998B', gd: '#147a6e', amber: '#F4A93F', grid: '#E4E9EF', muted: '#63748A', blue: '#3E6FD9', purple: '#6A4FB0', red: '#D64550', paper: '#FBFAF6', white: '#FFFFFF' };
  var ABORT = { abort: true };
  var INSTANT = window.VIZ_INSTANT === true || /[?&]instant\b/.test(location.search) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var uid = 0;

  function ease(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  function fmt(v) { var r = Math.round(v * 100) / 100; return String(r).replace('-', '\u2212'); }
  function rng(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function erf(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
  function Phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function pdf(x, m, s) { return Math.exp(-0.5 * Math.pow((x - m) / s, 2)) / (s * Math.sqrt(2 * Math.PI)); }
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
  function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
  function quart(a) { var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length, h = Math.floor(n / 2); return [med(b.slice(0, h)), med(b), med(b.slice(n % 2 ? h + 1 : h))]; }

  function el(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) { if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]); }
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ---------- drawing helpers (all take the run context c) ---------- */
  function T(c, x, y, s, a) {
    a = a || {}; a.x = x; a.y = y;
    if (!a['font-size']) a['font-size'] = 13;
    if (!a.fill) a.fill = C.ink;
    if (!a['text-anchor']) a['text-anchor'] = 'middle';
    a['font-family'] = 'Inter, Arial, sans-serif';
    return c.el('text', a, s);
  }
  function fade(c, e, ms) { e.setAttribute('opacity', 0); return c.tween(ms || 400, function (p) { e.setAttribute('opacity', p); }); }
  function stroke(c, e, ms) {
    var L = e.getTotalLength ? e.getTotalLength() : 0;
    if (!L) return Promise.resolve();
    e.style.strokeDasharray = L; e.style.strokeDashoffset = L;
    return c.tween(ms || 900, function (p) { e.style.strokeDashoffset = L * (1 - p); }).then(function () { e.style.strokeDasharray = ''; e.style.strokeDashoffset = ''; });
  }
  function line(c, x1, y1, x2, y2, col, w, dash) {
    var a = { x1: x1, y1: y1, x2: x2, y2: y2, stroke: col || C.ink, 'stroke-width': w || 2, 'stroke-linecap': 'round' };
    if (dash) a['stroke-dasharray'] = dash;
    return c.el('line', a);
  }
  function growLine(c, x1, y1, x2, y2, col, w, ms, dash) {
    var l = line(c, x1, y1, x1, y1, col, w, dash);
    return c.tween(ms || 600, function (p) { l.setAttribute('x2', x1 + (x2 - x1) * p); l.setAttribute('y2', y1 + (y2 - y1) * p); }).then(function () { return l; });
  }
  function dot(c, x, y, r, col) { return c.el('circle', { cx: x, cy: y, r: r || 5, fill: col || C.green, stroke: C.white, 'stroke-width': 1.5 }); }
  function rect(c, x, y, w, h, col, extra) { var a = { x: x, y: y, width: w, height: h, fill: col, rx: 3 }; if (extra) for (var k in extra) a[k] = extra[k]; return c.el('rect', a); }
  function pathD(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '); }

  /* axes + grid. o: x0,x1,y0,y1, xt[], yt[], xl, yl, cross (axes through 0), box [L,T,R,B], xlab/ylab fns */
  function plot(c, o) {
    var b = o.box || [64, 24, 572, 262], L = b[0], Tp = b[1], R = b[2], B = b[3];
    var P = {
      L: L, T: Tp, R: R, B: B,
      X: function (v) { return L + (v - o.x0) / (o.x1 - o.x0) * (R - L); },
      Y: function (v) { return B - (v - o.y0) / (o.y1 - o.y0) * (B - Tp); }
    };
    var id = 'vz' + (++uid);
    var defs = c.el('defs', {});
    el('clipPath', { id: id }, defs).appendChild(el('rect', { x: L, y: Tp - 4, width: R - L, height: B - Tp + 8 }));
    P.clip = 'url(#' + id + ')';
    var ax = o.cross ? P.X(0) : L, ay = o.cross ? P.Y(0) : B;
    (o.yt || []).forEach(function (v) {
      line(c, L, P.Y(v), R, P.Y(v), C.grid, 1);
      T(c, ax - 8, P.Y(v) + 4, (o.ylab ? o.ylab(v) : fmt(v)), { 'text-anchor': 'end', 'font-size': 11, fill: C.muted });
    });
    (o.xt || []).forEach(function (v) {
      line(c, P.X(v), Tp, P.X(v), B, C.grid, 1);
      T(c, P.X(v), ay + 17, (o.xlab ? o.xlab(v) : fmt(v)), { 'font-size': 11, fill: C.muted });
    });
    line(c, L, ay, R, ay, C.ink, 1.6);
    line(c, ax, Tp, ax, B, C.ink, 1.6);
    if (o.xl) T(c, (L + R) / 2, B + 40, o.xl, { 'font-size': 12, fill: C.muted });
    if (o.yl) T(c, 16, (Tp + B) / 2, o.yl, { 'font-size': 12, fill: C.muted, transform: 'rotate(-90 16 ' + ((Tp + B) / 2) + ')' });
    return P;
  }
  function samples(P, f, a, b, n) { var pts = [], i, x, y; n = n || 120; for (i = 0; i <= n; i++) { x = a + (b - a) * i / n; y = f(x); if (isFinite(y)) pts.push([P.X(x), P.Y(y)]); } return pts; }
  function curve(c, P, f, a, b, col, w, ms, dash) {
    var e = c.el('path', { d: pathD(samples(P, f, a, b)), fill: 'none', stroke: col, 'stroke-width': w || 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'clip-path': P.clip });
    if (dash) { e.setAttribute('stroke-dasharray', dash); e.setAttribute('opacity', 0); return c.tween(ms || 900, function (p) { e.setAttribute('opacity', p); }).then(function () { return e; }); }
    return stroke(c, e, ms || 900).then(function () { return e; });
  }
  function area(c, P, f, a, b, col, op) {
    var pts = samples(P, f, a, b, 100), y0 = P.Y(0);
    var d = 'M' + P.X(a) + ' ' + y0 + ' ' + pts.map(function (p) { return 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ') + ' L' + P.X(b) + ' ' + y0 + ' Z';
    return c.el('path', { d: d, fill: col, opacity: op == null ? 0.35 : op, 'clip-path': P.clip });
  }
  function legend(c, x, y, col, label, dash) {
    var l = line(c, x, y, x + 22, y, col, 3, dash);
    var t = T(c, x + 28, y + 4, label, { 'text-anchor': 'start', 'font-size': 12, fill: C.ink });
    return [l, t];
  }
  function arrow(c, x1, y1, x2, y2, col, w) {
    var a = Math.atan2(y2 - y1, x2 - x1), h = 9;
    var l = line(c, x1, y1, x2 - Math.cos(a) * 2, y2 - Math.sin(a) * 2, col, w || 2);
    var tip = c.el('path', { d: 'M' + x2 + ' ' + y2 + ' L' + (x2 - h * Math.cos(a - 0.4)) + ' ' + (y2 - h * Math.sin(a - 0.4)) + ' L' + (x2 - h * Math.cos(a + 0.4)) + ' ' + (y2 - h * Math.sin(a + 0.4)) + ' Z', fill: col });
    return [l, tip];
  }
  function label(c, x, y, s, col, size) { var t = T(c, x, y, s, { fill: col || C.ink, 'font-size': size || 13, 'font-weight': 700 }); return fade(c, t, 350).then(function () { return t; }); }

  var FIGS = {};
  var CAP = {};

  /* =============== 1 \u00b7 BOX PLOTS / AVERAGES / SPREAD =============== */
  FIGS.boxplot = function (c, v) {
    if (v === 'sd') {
      var P = plot(c, { x0: -4, x1: 4, y0: 0, y1: 0.9, xt: [0], xlab: function () { return 'mean'; }, yt: [] });
      var wide = function (x) { return pdf(x, 0, 1.3); }, narrow = function (x) { return pdf(x, 0, 0.5); };
      return area(c, P, wide, -4, 4, C.blue, 0.12) && curve(c, P, wide, -4, 4, C.blue, 3, 900).then(function () {
        var lg = legend(c, 360, 50, C.blue, 'large SD: spread out'); return curve(c, P, narrow, -4, 4, C.green, 3, 900).then(function () { legend(c, 360, 74, C.green, 'small SD: clustered'); return label(c, P.X(0), P.Y(0.82) - 6, 'same mean, different spread', C.muted, 12); });
      });
    }
    var data = v === 'averages' ? [2, 3, 3, 4, 5, 6, 7, 20] : v === 'outliers' ? [2, 3, 4, 5, 5, 6, 7, 8, 9, 11, 12, 25] : [2, 3, 4, 5, 5, 6, 7, 8, 9, 11, 12];
    var hi = v === 'outliers' ? 28 : v === 'averages' ? 22 : 14, step = v === 'outliers' ? 4 : 2, xt = [], i;
    for (i = 0; i <= hi; i += step) xt.push(i);
    var Q = plot(c, { x0: 0, x1: hi, y0: 0, y1: 1, xt: xt, yt: [], xl: v === 'averages' ? 'Value' : 'Data value' });
    var seen = {}, dots = [];
    data.forEach(function (d, k) { seen[d] = (seen[d] || 0) + 1; dots.push({ d: d, y: Q.B - 14 - (seen[d] - 1) * 19 }); });
    var els = dots.map(function (o) { var e = dot(c, Q.X(o.d), Q.T, 8, C.green); e.setAttribute('opacity', 0); return e; });
    var run = Promise.resolve();
    els.forEach(function (e, k) { run = run.then(function () { return c.tween(220, function (p) { e.setAttribute('opacity', 1); e.setAttribute('cy', Q.T + (dots[k].y - Q.T) * p); }); }); });
    return run.then(function () {
      var m = mean(data), md = med(data), qs = quart(data);
      if (v === 'averages') {
        return growLine(c, Q.X(md), Q.T + 10, Q.X(md), Q.B, C.blue, 2.5, 500, '6 4').then(function () { return label(c, Q.X(md) - 6, Q.T + 22, 'median ' + fmt(md), C.blue, 12); }).then(function () {
          return growLine(c, Q.X(m), Q.T + 40, Q.X(m), Q.B, C.amber, 2.5, 500, '6 4');
        }).then(function () { return label(c, Q.X(m) + 56, Q.T + 52, 'mean ' + fmt(m), '#b7791f', 12); }).then(function () {
          return label(c, 340, 118, 'the outlier (20) drags the mean upwards', C.muted, 12);
        });
      }
      var iqr = qs[2] - qs[0], lo = qs[0] - 1.5 * iqr, up = qs[2] + 1.5 * iqr;
      var inl = data.filter(function (d) { return d >= lo && d <= up; });
      var wmin = Math.min.apply(null, inl), wmax = Math.max.apply(null, inl), by = Q.T + 40, bh = 54;
      var box = rect(c, Q.X(qs[0]), by, 0, bh, 'rgba(27,153,139,.25)', { stroke: C.gd, 'stroke-width': 2 });
      return c.tween(700, function (p) { box.setAttribute('width', (Q.X(qs[2]) - Q.X(qs[0])) * p); }).then(function () {
        line(c, Q.X(md), by, Q.X(md), by + bh, C.ink, 3);
        return Promise.all([growLine(c, Q.X(qs[0]), by + bh / 2, Q.X(wmin), by + bh / 2, C.gd, 2, 500), growLine(c, Q.X(qs[2]), by + bh / 2, Q.X(wmax), by + bh / 2, C.gd, 2, 500)]);
      }).then(function () {
        line(c, Q.X(wmin), by + 14, Q.X(wmin), by + bh - 14, C.gd, 2); line(c, Q.X(wmax), by + 14, Q.X(wmax), by + bh - 14, C.gd, 2);
        T(c, Q.X(qs[0]), by - 8, 'Q1 = ' + fmt(qs[0]), { 'font-size': 12, fill: C.gd }); T(c, Q.X(md), by + bh + 16, 'median = ' + fmt(md), { 'font-size': 12 }); T(c, Q.X(qs[2]), by - 8, 'Q3 = ' + fmt(qs[2]), { 'font-size': 12, fill: C.gd });
        if (v === 'outliers') {
          var o = data.filter(function (d) { return d > up || d < lo; });
          o.forEach(function (d) { T(c, Q.X(d), by + bh / 2 + 6, '\u00d7', { 'font-size': 26, fill: C.red, 'font-weight': 700 }); T(c, Q.X(d), by + bh + 16, 'outlier', { 'font-size': 12, fill: C.red }); });
          line(c, Q.X(up), by - 22, Q.X(up), by + bh + 4, C.red, 1.5, '5 4');
          return label(c, Q.X(up) - 6, by - 28, 'upper fence = Q3 + 1.5\u00d7IQR = ' + fmt(up), C.red, 11);
        }
        return label(c, 330, 150, 'IQR = Q3 \u2212 Q1 = ' + fmt(iqr) + '  \u2022  range = ' + fmt(wmax - wmin), C.muted, 12);
      });
    });
  };
  CAP['boxplot:averages'] = 'Mean, median and the effect of an outlier on each.';
  CAP['boxplot:box'] = 'Data points \u2192 quartiles \u2192 box-and-whisker plot.';
  CAP['boxplot:outliers'] = 'A point beyond 1.5 \u00d7 IQR from the box is flagged as an outlier.';
  CAP['boxplot:sd'] = 'Same mean, different standard deviation: small SD = clustered, large SD = spread out.';

  /* =============== 2 \u00b7 PERSONAL FINANCE =============== */
  FIGS.growth = function (c, v) {
    var P;
    if (v === 'tax') {
      var segs = [[0, 12570, '#B8C4D2', '0% \u2014 personal allowance'], [12570, 50270, C.green, '20% \u2014 basic rate'], [50270, 60000, C.amber, '40% \u2014 higher rate']];
      var bx = 40, bw = 520, tot = 60000, by = 70, bh = 56, X = function (v2) { return bx + v2 / tot * bw; };
      T(c, 300, 40, 'Income of \u00a360,000 split into tax bands', { 'font-size': 14, 'font-weight': 700 });
      var run = Promise.resolve();
      segs.forEach(function (s, k) { run = run.then(function () { var r = rect(c, X(s[0]), by, 0, bh, s[2]); return c.tween(700, function (p) { r.setAttribute('width', (X(s[1]) - X(s[0])) * p); }).then(function () { T(c, (X(s[0]) + X(s[1])) / 2, by + bh + 20, s[3], { 'font-size': 11, fill: C.muted }); }); }); });
      return run.then(function () {
        var t1 = 0, t2 = (50270 - 12570) * 0.2, t3 = (60000 - 50270) * 0.4;
        return label(c, 300, 190, 'Tax = 0 + \u00a3' + t2.toLocaleString() + ' + \u00a3' + t3.toLocaleString() + ' = \u00a3' + (t1 + t2 + t3).toLocaleString(), C.gd, 15);
      }).then(function () { return label(c, 300, 222, 'Only the income inside each band is taxed at that band\u2019s rate.', C.muted, 12); });
    }
    if (v === 'aer') {
      P = plot(c, { x0: 0, x1: 3, y0: 0, y1: 1600, yt: [0, 400, 800, 1200, 1600], xt: [], yl: 'Value after 10 years (\u00a3)' });
      var vals = [1000 * Math.pow(1.04, 10), 1000 * Math.pow(1 + 0.04 / 12, 120)], cols = [C.blue, C.green], names = ['4% once a year', '4% paid monthly (AER 4.07%)'];
      var chain = Promise.resolve();
      vals.forEach(function (val, k) { chain = chain.then(function () { var x = P.X(0.35 + k * 1.35), w = 130, r = rect(c, x, P.B, w, 0, cols[k]); return c.tween(800, function (p) { var h = (P.B - P.Y(val)) * p; r.setAttribute('y', P.B - h); r.setAttribute('height', h); }).then(function () { T(c, x + w / 2, P.Y(val) - 8, '\u00a3' + val.toFixed(2), { 'font-weight': 700 }); T(c, x + w / 2, P.B + 18, names[k], { 'font-size': 11, fill: C.muted }); }); }); });
      return chain.then(function () { return label(c, 300, 14, 'Same \u00a31,000 \u2014 more frequent compounding earns a little extra', C.gd, 13); });
    }
    if (v === 'currency') {
      var r1 = rect(c, 40, 90, 150, 90, C.paper, { stroke: C.ink, 'stroke-width': 2 }), r2 = rect(c, 410, 90, 150, 90, C.paper, { stroke: C.ink, 'stroke-width': 2 });
      T(c, 115, 118, 'Pounds', { 'font-size': 12, fill: C.muted }); T(c, 485, 118, 'Euros', { 'font-size': 12, fill: C.muted });
      var a = T(c, 115, 158, '\u00a3250', { 'font-size': 26, 'font-weight': 700 }), b = T(c, 485, 158, '\u20ac0', { 'font-size': 26, 'font-weight': 700 });
      var ar = arrow(c, 200, 120, 400, 120, C.green, 3); T(c, 300, 108, '\u00d7 1.16', { 'font-size': 14, fill: C.gd, 'font-weight': 700 });
      return c.tween(1000, function (p) { b.textContent = '\u20ac' + Math.round(290 * p); }).then(function () {
        arrow(c, 400, 160, 200, 160, C.blue, 3); T(c, 300, 186, '\u00f7 1.16', { 'font-size': 14, fill: C.blue, 'font-weight': 700 });
        return label(c, 300, 250, 'Multiply to go to the currency with the bigger number; divide to come back.', C.muted, 12);
      });
    }
    P = plot(c, { x0: 0, x1: 20, y0: 1000, y1: 2800, xt: [0, 5, 10, 15, 20], yt: [1000, 1500, 2000, 2500], xl: 'Years', yl: 'Value (\u00a3)' });
    return curve(c, P, function (x) { return 1000 + 50 * x; }, 0, 20, C.blue, 3, 900).then(function () {
      legend(c, 90, 44, C.blue, 'Simple 5%');
      return curve(c, P, function (x) { return 1000 * Math.pow(1.05, x); }, 0, 20, C.green, 3, 1100);
    }).then(function () {
      legend(c, 90, 66, C.green, 'Compound 5%');
      var g = 1000 * Math.pow(1.05, 20) - 2000;
      line(c, P.X(20), P.Y(2000), P.X(20), P.Y(2000 + g), C.amber, 3);
      return label(c, P.X(20) - 62, P.Y(1760), 'gap \u2248 \u00a3' + Math.round(g), '#b7791f', 12);
    });
  };
  CAP['growth:interest'] = '\u00a31,000 at 5%: compound interest pulls away from simple interest.';
  CAP['growth:tax'] = 'Progressive tax: each band of income is taxed at its own rate.';
  CAP['growth:aer'] = 'AER lets you compare accounts that compound at different frequencies.';
  CAP['growth:currency'] = 'Converting currency: multiply one way, divide the other.';

  /* =============== 3 \u00b7 ESTIMATION =============== */
  FIGS.estimate = function (c, v) {
    if (v === 'rounding') {
      var P = plot(c, { x0: 65, x1: 95, y0: 0, y1: 1, xt: [70, 75, 80, 85, 90], yt: [], xl: 'Length (m)' });
      var yy = P.B - 70;
      return growLine(c, P.X(75), yy, P.X(85), yy, C.green, 8, 900).then(function () {
        dot(c, P.X(75), yy, 8, C.green); c.el('circle', { cx: P.X(85), cy: yy, r: 8, fill: C.white, stroke: C.green, 'stroke-width': 3 });
        dot(c, P.X(80), yy, 6, C.amber);
        T(c, P.X(75), yy - 20, '75', { 'font-weight': 700 }); T(c, P.X(85), yy - 20, '85', { 'font-weight': 700 });
        return label(c, 300, 70, '80 m to the nearest 10 m  \u2192  75 \u2264 length < 85', C.gd, 14);
      }).then(function () { return label(c, 300, 106, 'lower bound included (\u25cf)   upper bound not included (\u25cb)', C.muted, 12); });
    }
    if (v === 'approx') {
      var Q = plot(c, { x0: 0, x1: 3, y0: 0, y1: 120, yt: [0, 40, 80, 120], xt: [], yl: 'Value' });
      var items = [[97.02, C.blue, 'Exact: 4.9 \u00d7 19.8'], [100, C.green, 'Estimate: 5 \u00d7 20']], run = Promise.resolve();
      items.forEach(function (it, k) { run = run.then(function () { var x = Q.X(0.45 + k * 1.3), r = rect(c, x, Q.B, 130, 0, it[1]); return c.tween(800, function (p) { var h = (Q.B - Q.Y(it[0])) * p; r.setAttribute('y', Q.B - h); r.setAttribute('height', h); }).then(function () { T(c, x + 65, Q.Y(it[0]) - 8, String(it[0]), { 'font-weight': 700 }); T(c, x + 65, Q.B + 18, it[2], { 'font-size': 11, fill: C.muted }); }); }); });
      return run.then(function () { return label(c, 300, 14, 'Rounding to 1 s.f. gives an answer within 3% of the true value', C.gd, 13); });
    }
    var boxes = [['20', 'teams'], ['\u00d7 19', 'home games each'], ['\u00d7 40 000', 'seats per ground'], ['\u00d7 0.8', 'average fullness'], ['\u2248 12.2 m', 'attendances']], run2 = Promise.resolve(), tot = [20, 380, 15200000, 12160000];
    T(c, 300, 36, 'Fermi estimate: attendances at Premier League matches in a season', { 'font-size': 13, 'font-weight': 700 });
    boxes.forEach(function (b, k) {
      run2 = run2.then(function () {
        var x = 14 + k * 115, w = k === 4 ? 112 : 106, r = rect(c, x, 80, w, 74, k === 4 ? 'rgba(27,153,139,.2)' : C.paper, { stroke: k === 4 ? C.gd : C.ink, 'stroke-width': 2 });
        var t1 = T(c, x + w / 2, 112, b[0], { 'font-size': k === 4 ? 14 : 18, 'font-weight': 700 }), t2 = T(c, x + w / 2, 138, b[1], { 'font-size': 11, fill: C.muted });
        r.setAttribute('opacity', 0); t1.setAttribute('opacity', 0); t2.setAttribute('opacity', 0);
        return c.tween(450, function (p) { r.setAttribute('opacity', p); t1.setAttribute('opacity', p); t2.setAttribute('opacity', p); });
      });
    });
    return run2.then(function () { return label(c, 300, 214, '20 \u00d7 19 = 380 matches  \u2192  380 \u00d7 40 000 \u00d7 0.8 \u2248 12.2 million', C.gd, 14); }).then(function () { return label(c, 300, 244, 'State every assumption \u2014 the method earns the marks.', C.muted, 12); });
  };
  CAP['estimate:fermi'] = 'Break an unknown quantity into pieces you can estimate, then multiply.';
  CAP['estimate:rounding'] = 'A rounded value hides a range: the lower bound is included, the upper bound is not.';
  CAP['estimate:approx'] = 'Rounding to 1 significant figure gives a quick estimate close to the exact answer.';

  /* =============== 4 \u00b7 CRITICAL ANALYSIS =============== */
  FIGS.critical = function (c, v) {
    var run = Promise.resolve();
    if (v === 'spreadsheet') {
      var vals = [12, 15, 9, 20, 14], x0 = 150, y0 = 40, cw = 130, ch = 34;
      T(c, x0 + cw / 2, y0 - 10, 'B', { fill: C.muted, 'font-size': 12 });
      vals.forEach(function (val, k) {
        run = run.then(function () {
          var r = rect(c, x0, y0 + k * ch, cw, ch, C.white, { stroke: '#B8C4D2', 'stroke-width': 1.5 }); T(c, x0 - 18, y0 + k * ch + 22, String(k + 2), { fill: C.muted, 'font-size': 12 });
          var t = T(c, x0 + cw - 12, y0 + k * ch + 22, String(val), { 'text-anchor': 'end', 'font-size': 15 }); r.setAttribute('opacity', 0); t.setAttribute('opacity', 0);
          return c.tween(250, function (p) { r.setAttribute('opacity', p); t.setAttribute('opacity', p); });
        });
      });
      return run.then(function () {
        var hl = rect(c, x0, y0, cw, 4 * ch, 'rgba(244,169,63,.25)', { stroke: C.amber, 'stroke-width': 3 }); hl.setAttribute('opacity', 0);
        return fade(c, hl, 500);
      }).then(function () {
        T(c, 330, 150, '=SUM(B2:B5)', { 'text-anchor': 'start', 'font-size': 18, fill: C.gd, 'font-weight': 700 });
        T(c, 330, 178, 'gives 56', { 'text-anchor': 'start', 'font-size': 15 });
        return label(c, 450, 120, 'range stops at row 5!', C.red, 13);
      }).then(function () { c.el('rect', { x: x0, y: y0 + 4 * ch, width: cw, height: ch, fill: 'none', stroke: C.red, 'stroke-width': 3, rx: 3 }); return label(c, 330, 222, 'B6 (14) was left out \u2014 the correct total is 70', C.red, 13); });
    }
    if (v === 'models') {
      var P = plot(c, { x0: 0, x1: 10, y0: 0, y1: 170, xt: [0, 2, 4, 6, 8, 10], yt: [0, 50, 100, 150], xl: 'Time', yl: '% of market' });
      var dp = [0, 1, 2, 3, 4].map(function (x) { return [x, 100 * (1 - Math.exp(-0.25 * x))]; });
      dp.forEach(function (p) { dot(c, P.X(p[0]), P.Y(p[1]), 5, C.blue); });
      return growLine(c, P.X(0), P.Y(5), P.X(4.2), P.Y(16 * 4.2 + 5), C.blue, 3, 700).then(function () {
        return growLine(c, P.X(4.2), P.Y(16 * 4.2 + 5), P.X(10), P.Y(165), C.blue, 3, 900, '7 5');
      }).then(function () { T(c, P.X(8.2), P.Y(150) - 8, 'linear model', { fill: C.blue, 'font-size': 12 }); return growLine(c, P.L, P.Y(100), P.R, P.Y(100), C.red, 2, 500, '4 4'); }).then(function () {
        T(c, P.X(2.2), P.Y(100) - 7, 'maximum possible: 100%', { fill: C.red, 'font-size': 11 });
        return curve(c, P, function (x) { return 100 * (1 - Math.exp(-0.25 * x)); }, 0, 10, C.green, 3, 1000);
      }).then(function () { return label(c, 440, 236, 'the line predicts over 100% \u2014 impossible!', C.red, 12); });
    }
    /* misleading axes: two panels side by side */
    var panels = [{ x: 30, lo: 94, hi: 101, t: 'Truncated axis (starts at 94)' }, { x: 330, lo: 0, hi: 110, t: 'Full axis (starts at 0)' }];
    panels.forEach(function (pn) {
      line(c, pn.x, 30, pn.x, 250, C.ink, 1.5); line(c, pn.x, 250, pn.x + 240, 250, C.ink, 1.5);
      T(c, pn.x + 120, 304, pn.t, { 'font-size': 12, fill: C.muted });
      T(c, pn.x - 6, 254, String(pn.lo), { 'text-anchor': 'end', 'font-size': 10, fill: C.muted }); T(c, pn.x - 6, 38, String(pn.hi), { 'text-anchor': 'end', 'font-size': 10, fill: C.muted });
    });
    var rs = [];
    panels.forEach(function (pn) { [[96, C.blue, 'A'], [100, C.green, 'B']].forEach(function (b, k) { var r = rect(c, pn.x + 40 + k * 100, 250, 70, 0, b[1]); rs.push({ r: r, pn: pn, v: b[0], k: k }); T(c, pn.x + 75 + k * 100, 268, 'Brand ' + b[2], { 'font-size': 11, fill: C.ink }); }); });
    return c.tween(1300, function (p) { rs.forEach(function (o) { var h = (o.v - o.pn.lo) / (o.pn.hi - o.pn.lo) * 220 * p; o.r.setAttribute('y', 250 - h); o.r.setAttribute('height', h); }); }).then(function () { return label(c, 300, 18, 'Same data (96 vs 100) \u2014 very different impressions', C.red, 13); });
  };
  CAP['critical:misleading'] = 'A truncated y-axis exaggerates small differences.';
  CAP['critical:spreadsheet'] = 'A formula range that stops one row short gives a wrong total.';
  CAP['critical:models'] = 'A model that fits the data range can fail badly when extrapolated.';

  /* =============== 5 \u00b7 NORMAL DISTRIBUTION =============== */
  FIGS.normal = function (c, v) {
    var f = function (x) { return pdf(x, 0, 1); };
    if (v === 'zscore') {
      var P = plot(c, { x0: -3.5, x1: 3.5, y0: 0, y1: 0.45, xt: [-3, -2, -1, 0, 1, 2, 3], yt: [], xlab: function (z) { return String(Math.round(100 + 15 * z)); } });
      T(c, 300, P.B + 38, 'x (marks)', { 'font-size': 12, fill: C.muted });
      [-3, -2, -1, 0, 1, 2, 3].forEach(function (z) { T(c, P.X(z), P.B + 52, 'z = ' + fmt(z), { 'font-size': 10, fill: C.gd }); });
      return curve(c, P, f, -3.5, 3.5, C.blue, 3, 900).then(function () {
        var a = area(c, P, f, 2, 3.5, C.amber, 0.5); a.setAttribute('opacity', 0);
        return growLine(c, P.X(2), P.B, P.X(2), P.Y(f(2)), C.red, 2.5, 500, '5 4').then(function () { return fade(c, a, 500); });
      }).then(function () { return label(c, 160, 70, 'x = 130, \u03bc = 100, \u03c3 = 15', C.ink, 13); }).then(function () { return label(c, 160, 96, 'z = (130 \u2212 100) / 15 = 2', C.red, 14); }).then(function () { return label(c, 160, 122, 'P(Z > 2) \u2248 ' + (1 - Phi(2)).toFixed(4), C.gd, 13); });
    }
    if (v === 'std') {
      var Q = plot(c, { x0: -3.5, x1: 3.5, y0: 0, y1: 0.45, xt: [-3, -2, -1, 0, 1, 2, 3], yt: [], xl: 'z' });
      var shade = c.el('path', { d: '', fill: C.green, opacity: 0.35, 'clip-path': Q.clip });
      curve(c, Q, f, -3.5, 3.5, C.blue, 3, 700);
      var txt = T(c, 440, 50, 'P(Z < 0.00) = 0.0000', { 'font-size': 15, 'font-weight': 700, fill: C.gd });
      return c.tween(1800, function (p) {
        var z = -3.5 + (1.1 + 3.5) * p, pts = samples(Q, f, -3.5, z, 60);
        shade.setAttribute('d', 'M' + Q.X(-3.5) + ' ' + Q.B + ' ' + pts.map(function (q) { return 'L' + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ') + ' L' + Q.X(z) + ' ' + Q.B + ' Z');
        txt.textContent = 'P(Z < ' + z.toFixed(2).replace('-', '\u2212') + ') = ' + Phi(z).toFixed(4);
      }).then(function () { return label(c, 440, 76, '\u03a6(1.1) = 0.8643', C.gd, 14); }).then(function () { return label(c, 440, 102, 'P(Z > 1.1) = 1 \u2212 0.8643 = 0.1357', C.red, 12); });
    }
    var R = plot(c, { x0: -4, x1: 4, y0: 0, y1: 0.45, xt: [-3, -2, -1, 0, 1, 2, 3], yt: [], xlab: function (z) { return z === 0 ? '\u03bc' : (z > 0 ? '\u03bc+' : '\u03bc\u2212') + Math.abs(z) + '\u03c3'; } });
    var steps = [[3, '99.7%', 'rgba(106,79,176,.18)'], [2, '95%', 'rgba(62,111,217,.25)'], [1, '68%', 'rgba(27,153,139,.35)']];
    return curve(c, R, f, -4, 4, C.ink, 3, 900).then(function () {
      var run = Promise.resolve();
      steps.forEach(function (s, k) { run = run.then(function () { var a = area(c, R, f, -s[0], s[0], s[2].replace(/rgba\((.+),[.\d]+\)/, 'rgb($1)'), 0); var t = parseFloat(s[2].split(',')[3]); return c.tween(600, function (p) { a.setAttribute('opacity', t * p); }).then(function () { var tt = T(c, 74, 50 + k * 22, s[1] + ' within ' + s[0] + '\u03c3', { 'text-anchor': 'start', 'font-size': 13, 'font-weight': 700 }); return fade(c, tt, 300); }); }); });
      return run;
    });
  };
  CAP['normal:bell'] = 'The 68\u201395\u201399.7 rule for a normal distribution.';
  CAP['normal:zscore'] = 'A z-score says how many standard deviations a value is from the mean.';
  CAP['normal:std'] = 'Reading P(Z less than z) from the standard normal distribution.';

  /* =============== 6 \u00b7 CONFIDENCE INTERVALS =============== */
  FIGS.confidence = function (c, v) {
    if (v === 'sampling') {
      var P = plot(c, { x0: -4, x1: 4, y0: 0, y1: 1.3, xt: [0], xlab: function () { return '\u03bc'; }, yt: [] });
      var wide = function (x) { return pdf(x, 0, 1.4); }, nar = function (x) { return pdf(x, 0, 0.35); };
      return curve(c, P, wide, -4, 4, C.blue, 3, 900).then(function () { legend(c, 400, 44, C.blue, 'individual values (\u03c3)'); return curve(c, P, nar, -4, 4, C.green, 3, 1000); }).then(function () { legend(c, 400, 68, C.green, 'sample means (\u03c3/\u221an)'); return label(c, 150, 120, 'sample means vary far less', C.muted, 12); });
    }
    if (v === 'estimation') {
      var Q = plot(c, { x0: 0, x1: 60, y0: 35, y1: 65, xt: [0, 10, 20, 30, 40, 50, 60], yt: [40, 50, 60], xl: 'Sample size n', yl: 'Estimate of mean' });
      var r = rng(7), run = 0, means = [], i, se;
      for (i = 1; i <= 60; i++) { run += 50 + 10 * gauss(r); means.push(run / i); }
      var upper = [], lower = [];
      for (i = 0; i < 60; i++) { se = 1.96 * 10 / Math.sqrt(i + 1); upper.push([Q.X(i + 1), Q.Y(50 + se)]); lower.push([Q.X(i + 1), Q.Y(50 - se)]); }
      var band = c.el('path', { d: '', fill: 'rgba(27,153,139,.18)', 'clip-path': Q.clip }), ln = c.el('path', { d: '', fill: 'none', stroke: C.blue, 'stroke-width': 2.5, 'clip-path': Q.clip });
      line(c, Q.L, Q.Y(50), Q.R, Q.Y(50), C.red, 2, '6 4'); T(c, Q.R - 4, Q.Y(50) - 6, 'true mean 50', { 'text-anchor': 'end', fill: C.red, 'font-size': 11 });
      return c.tween(2600, function (p) {
        var n = Math.max(2, Math.round(60 * p)), up = upper.slice(0, n), lo = lower.slice(0, n).reverse();
        band.setAttribute('d', pathD(up.concat(lo)) + ' Z'); ln.setAttribute('d', pathD(means.slice(0, n).map(function (m, k) { return [Q.X(k + 1), Q.Y(m)]; })));
      }).then(function () { return label(c, 330, 36, 'bigger sample \u2192 narrower confidence interval', C.gd, 13); });
    }
    /* ci: 20 intervals */
    var S = plot(c, { x0: 40, x1: 60, y0: 0, y1: 21, xt: [40, 45, 50, 55, 60], yt: [], xl: 'Sample mean with 95% confidence interval' });
    var rg = rng(11), se2 = 1.96 * 10 / Math.sqrt(25), k, hits = 0, run3 = Promise.resolve();
    line(c, S.X(50), S.T, S.X(50), S.B, C.red, 2, '6 4'); T(c, S.X(50) + 6, 22, 'true mean \u03bc = 50', { fill: C.red, 'font-size': 11, 'text-anchor': 'start' });
    for (k = 1; k <= 20; k++) {
      (function (k) {
        var m = 50 + 10 / 5 * gauss(rg), ok = Math.abs(m - 50) <= se2; if (ok) hits++;
        run3 = run3.then(function () { var y = S.B - k * 11.2, col = ok ? C.green : C.red; var l = line(c, S.X(m - se2), y, S.X(m + se2), y, col, 3); dot(c, S.X(m), y, 3.5, col); l.setAttribute('opacity', 0); return c.tween(150, function (p) { l.setAttribute('opacity', p); }); });
      })(k);
    }
    return run3.then(function () { var t = T(c, 572, 10, hits + ' of 20 intervals contain \u03bc  (red = missed)', { 'text-anchor': 'end', 'font-size': 12, 'font-weight': 700 }); return fade(c, t, 350); });
  };
  CAP['confidence:sampling'] = 'Sample means cluster far more tightly around \u03bc than individual values do.';
  CAP['confidence:ci'] = 'Repeat the sampling: about 95% of 95% confidence intervals capture the true mean.';
  CAP['confidence:estimation'] = 'As the sample grows, the estimate settles and the interval narrows.';

  /* =============== 7 \u00b7 CORRELATION & REGRESSION =============== */
  function pearson(xs, ys) { var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0; xs.forEach(function (x, i) { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); syy += (ys[i] - my) * (ys[i] - my); }); return sxy / Math.sqrt(sxx * syy); }
  function lsrl(xs, ys) { var mx = mean(xs), my = mean(ys), n = xs.length, sxy = 0, sxx = 0, i; for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); } var b = sxy / sxx; return [my - b * mx, b]; }
  FIGS.scatter = function (c, v) {
    var rg = rng(5), xs = [], ys = [], i;
    if (v === 'pmcc') {
      var specs = [['strong positive', 1], ['no correlation', 0], ['strong negative', -1]], run = Promise.resolve();
      specs.forEach(function (sp, k) {
        var x0 = 20 + k * 195, X = [], Y = [], r2 = rng(3 + k * 4);
        for (i = 0; i < 14; i++) { var x = 1 + i * 0.5 + (r2() - 0.5) * 0.3; X.push(x); Y.push(sp[1] === 0 ? 1 + r2() * 6 : (sp[1] > 0 ? 1 + i * 0.45 : 7 - i * 0.45) + (r2() - 0.5) * 1.1); }
        rect(c, x0, 30, 175, 190, C.paper, { stroke: C.grid, 'stroke-width': 1.5 });
        run = run.then(function () {
          var pts = X.map(function (x, j) { var e = dot(c, x0 + 14 + (x - 1) / 6.5 * 147, 210 - (Y[j] - 0.5) / 7.5 * 170, 4.5, C.blue); e.setAttribute('opacity', 0); return e; });
          return c.tween(900, function (p) { pts.forEach(function (e, j) { e.setAttribute('opacity', Math.max(0, Math.min(1, p * pts.length - j))); }); }).then(function () {
            T(c, x0 + 87, 244, 'r = ' + fmt(pearson(X, Y)), { 'font-weight': 700, 'font-size': 15, fill: C.gd }); T(c, x0 + 87, 264, sp[0], { 'font-size': 12, fill: C.muted });
          });
        });
      });
      return run;
    }
    for (i = 0; i < 14; i++) { xs.push(2 + i); ys.push(7 + 2.2 * (2 + i) + (rg() - 0.5) * 12); }
    var P = plot(c, { x0: 0, x1: 18, y0: 0, y1: 60, xt: [0, 3, 6, 9, 12, 15, 18], yt: [0, 20, 40, 60], xl: 'x', yl: 'y' });
    var pts = xs.map(function (x, j) { var e = dot(c, P.X(x), P.Y(ys[j]), 5, C.blue); e.setAttribute('opacity', 0); return e; });
    return c.tween(1000, function (p) { pts.forEach(function (e, j) { e.setAttribute('opacity', Math.max(0, Math.min(1, p * pts.length - j))); }); }).then(function () {
      var ab = lsrl(xs, ys), f = function (x) { return ab[0] + ab[1] * x; };
      return growLine(c, P.X(1.5), P.Y(f(1.5)), P.X(16), P.Y(f(16)), C.green, 3.5, 1000).then(function () {
        T(c, 150, 48, 'y = ' + ab[0].toFixed(1) + ' + ' + ab[1].toFixed(2) + 'x', { 'font-size': 15, 'font-weight': 700, fill: C.gd });
        if (v === 'prediction') {
          var xv = 10, yv = f(xv);
          return growLine(c, P.X(xv), P.B, P.X(xv), P.Y(yv), C.amber, 2.5, 500, '5 4').then(function () { return growLine(c, P.X(xv), P.Y(yv), P.L, P.Y(yv), C.amber, 2.5, 500, '5 4'); }).then(function () {
            dot(c, P.X(xv), P.Y(yv), 6, C.amber); T(c, P.X(xv) + 6, P.Y(yv) + 24, 'x = 10 \u2192 \u0177 \u2248 ' + yv.toFixed(1), { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
            var ex = rect(c, P.X(16.2), P.T, P.R - P.X(16.2), P.B - P.T, 'rgba(214,69,80,.10)'); T(c, (P.X(16.2) + P.R) / 2, P.T + 18, 'beyond', { 'font-size': 11, fill: C.red }); T(c, (P.X(16.2) + P.R) / 2, P.T + 32, 'the data', { 'font-size': 11, fill: C.red });
            return label(c, 330, 324, 'inside the data = interpolation (reliable);  outside = extrapolation (risky)', C.muted, 11);
          });
        }
        return label(c, 150, 74, 'r = ' + fmt(pearson(xs, ys)), C.muted, 13);
      });
    });
  };
  CAP['scatter:pmcc'] = 'The product moment correlation coefficient r measures the strength and direction of a linear relationship.';
  CAP['scatter:line'] = 'The line of best fit (least squares regression line) through the scatter graph.';
  CAP['scatter:prediction'] = 'Use the line to predict inside the data range; be wary of predicting outside it.';

  /* =============== 8 \u00b7 CRITICAL PATH ANALYSIS (activity-on-node boxes, as in the textbook) =============== */
  var NET = {
    w: 132, h: 60,
    boxes: { A: [28, 36, 3, 0, 4], B: [28, 196, 5, 0, 5], C: [234, 36, 4, 3, 8], D: [234, 196, 3, 5, 8], E: [440, 116, 3, 8, 11] },
    links: [['A', 'C', 0], ['B', 'D', 0], ['C', 'E', -14], ['D', 'E', 14]]
  };
  FIGS.network = function (c, v) {
    var N = NET, run = Promise.resolve(), g = {};
    if (v === 'gantt') {
      var P = plot(c, { x0: 0, x1: 12, y0: 0, y1: 5, xt: [0, 2, 4, 6, 8, 10, 12], yt: [], xl: 'Time (days)' });
      var rows = [['A', 0, 3, 1], ['B', 0, 5, 0], ['C', 3, 7, 1], ['D', 5, 8, 0], ['E', 8, 11, 0]];
      rows.forEach(function (rw, k) {
        run = run.then(function () {
          var y = P.T + 10 + k * 44, crit = rw[3] === 0, r = rect(c, P.X(rw[1]), y, 0, 30, crit ? C.red : C.green);
          T(c, P.L - 20, y + 20, rw[0], { 'font-weight': 700 });
          return c.tween(550, function (p) { r.setAttribute('width', (P.X(rw[2]) - P.X(rw[1])) * p); }).then(function () {
            if (!crit) { var fl = rect(c, P.X(rw[2]), y + 8, 0, 14, 'rgba(27,153,139,.25)', { stroke: C.green, 'stroke-dasharray': '4 3' }); return c.tween(350, function (p) { fl.setAttribute('width', (P.X(rw[2] + rw[3]) - P.X(rw[2])) * p); }).then(function () { T(c, P.X(rw[2] + rw[3]) + 6, y + 20, 'float 1', { 'text-anchor': 'start', 'font-size': 11, fill: C.gd }); }); }
          });
        });
      });
      return run.then(function () { legend(c, 380, 60, C.red, 'critical (no float)'); legend(c, 380, 82, C.green, 'has float'); return label(c, 330, 14, 'Project duration: 11 days', C.ink, 13); });
    }
    function boxes() {
      Object.keys(N.boxes).forEach(function (k) {
        run = run.then(function () {
          var b = N.boxes[k], x = b[0], y = b[1], w = N.w, h = N.h, o = {};
          o.rect = c.el('rect', { x: x, y: y, width: w, height: h, rx: 4, fill: C.white, stroke: C.ink, 'stroke-width': 2.5 });
          o.d1 = line(c, x + 34, y, x + 34, y + h, C.ink, 1.5); o.d2 = line(c, x + w - 34, y, x + w - 34, y + h, C.ink, 1.5);
          o.name = T(c, x + w / 2, y + 26, k, { 'font-size': 17, 'font-weight': 700 }); o.dur = T(c, x + w / 2, y + 46, b[2] + ' days', { 'font-size': 11, fill: C.muted });
          o.early = T(c, x + 17, y + h / 2 + 6, String(b[3]), { 'font-size': 15, 'font-weight': 700, fill: C.gd }); o.late = T(c, x + w - 17, y + h / 2 + 6, String(b[4]), { 'font-size': 15, 'font-weight': 700, fill: C.purple });
          o.early.setAttribute('opacity', 0); o.late.setAttribute('opacity', 0); g[k] = o;
          [o.rect, o.d1, o.d2, o.name, o.dur].forEach(function (e) { e.setAttribute('opacity', 0); });
          return c.tween(300, function (p) { [o.rect, o.d1, o.d2, o.name, o.dur].forEach(function (e) { e.setAttribute('opacity', p); }); });
        });
      });
    }
    function arrows() {
      N.links.forEach(function (l) {
        run = run.then(function () {
          var f = N.boxes[l[0]], t = N.boxes[l[1]], x1 = f[0] + N.w, y1 = f[1] + N.h / 2, x2 = t[0] - 1, y2 = t[1] + N.h / 2 + l[2];
          var ln = line(c, x1, y1, x1, y1, C.ink, 2.5);
          return c.tween(450, function (p) { ln.setAttribute('x2', x1 + (x2 - x1) * p); ln.setAttribute('y2', y1 + (y2 - y1) * p); }).then(function () { c.svg.removeChild(ln); var ar = arrow(c, x1, y1, x2, y2, C.ink, 2.5); g[l[0] + l[1]] = ar; });
        });
      });
    }
    boxes(); arrows();
    run = run.then(function () {
      if (v === 'network') { T(c, 300, 290, 'Each box: early time | activity and duration | late time', { 'font-size': 13, 'font-weight': 700, fill: C.muted }); return T(c, 300, 312, '(the early and late boxes are empty until we do the forward and backward passes)', { 'font-size': 11, fill: C.muted }); }
      if (v === 'times') {
        var chain = Promise.resolve();
        ['A', 'B', 'C', 'D', 'E'].forEach(function (k) { chain = chain.then(function () { return fade(c, g[k].early, 420); }); });
        return chain.then(function () { return label(c, 300, 276, 'Forward pass (early times): take the LARGEST value (E waits for C and D).', C.gd, 12); }).then(function () {
          var ch2 = Promise.resolve(); ['E', 'D', 'C', 'B', 'A'].forEach(function (k) { ch2 = ch2.then(function () { return fade(c, g[k].late, 420); }); }); return ch2;
        }).then(function () { return label(c, 300, 298, 'Backward pass (late times): take the SMALLEST value. Minimum time = 11 days.', C.purple, 12); });
      }
      /* critical */
      Object.keys(N.boxes).forEach(function (k) { g[k].early.setAttribute('opacity', 1); g[k].late.setAttribute('opacity', 1); });
      var hl = Promise.resolve();
      ['B', 'D', 'E'].forEach(function (k) { hl = hl.then(function () { g[k].rect.setAttribute('stroke', C.red); g[k].rect.setAttribute('stroke-width', 4); g[k].rect.setAttribute('fill', 'rgba(214,69,80,.10)'); if (k === 'D') g.BD.forEach(function (e) { e.setAttribute('stroke', C.red); if (e.tagName === 'path') e.setAttribute('fill', C.red); }); if (k === 'E') g.DE.forEach(function (e) { e.setAttribute('stroke', C.red); if (e.tagName === 'path') e.setAttribute('fill', C.red); }); return c.wait(450); }); });
      return hl.then(function () { T(c, 94, 118, 'float 1', { 'font-size': 11, fill: C.gd, 'font-weight': 700 }); T(c, 300, 118, 'float 1', { 'font-size': 11, fill: C.gd, 'font-weight': 700 }); return label(c, 300, 284, 'Critical path: B \u2192 D \u2192 E (5 + 3 + 3 = 11 days) \u2014 float = late \u2212 early \u2212 duration = 0', C.red, 12); }).then(function () { return label(c, 300, 306, 'A: 4 \u2212 0 \u2212 3 = 1     C: 8 \u2212 3 \u2212 4 = 1', C.muted, 12); });
    });
    return run;
  };
  CAP['network:network'] = 'An activity network: events (circles) joined by activities (arrows) with durations.';
  CAP['network:times'] = 'Early times (forward pass, take the maximum) and late times (backward pass, take the minimum).';
  CAP['network:critical'] = 'The critical path is the longest route \u2014 any delay on it delays the whole project.';
  CAP['network:gantt'] = 'The same project as a Gantt chart: critical activities have no float.';

  /* =============== 9 \u00b7 PROBABILITY & EXPECTATION =============== */
  FIGS.prob = function (c, v) {
    if (v === 'venn') {
      var a = c.el('circle', { cx: 230, cy: 150, r: 100, fill: 'rgba(62,111,217,.22)', stroke: C.blue, 'stroke-width': 3 }), b = c.el('circle', { cx: 350, cy: 150, r: 100, fill: 'rgba(244,169,63,.28)', stroke: C.amber, 'stroke-width': 3 });
      a.setAttribute('opacity', 0); b.setAttribute('opacity', 0); c.el('rect', { x: 90, y: 30, width: 420, height: 240, fill: 'none', stroke: C.ink, 'stroke-width': 1.5 }); T(c, 104, 48, 'S (30 students)', { 'text-anchor': 'start', 'font-size': 12, fill: C.muted });
      T(c, 190, 80, 'Maths', { fill: C.blue, 'font-weight': 700 }); T(c, 390, 80, 'Physics', { fill: '#b7791f', 'font-weight': 700 });
      return fade(c, a, 500).then(function () { return fade(c, b, 500); }).then(function () {
        var nums = [[190, 156, '13'], [290, 156, '5'], [395, 156, '8'], [470, 250, '4']], run = Promise.resolve();
        nums.forEach(function (n) { run = run.then(function () { var t = T(c, n[0], n[1], n[2], { 'font-size': 24, 'font-weight': 700 }); return fade(c, t, 380); }); }); return run;
      }).then(function () { return label(c, 290, 178, 'both', C.muted, 11); }).then(function () { return label(c, 300, 296, 'P(Maths \u222a Physics) = (13+5+8)/30 = 26/30;   P(Maths \u2229 Physics) = 5/30', C.gd, 12); });
    }
    if (v === 'tree') {
      var ends = [[190, 80, 370, 38, 'Late', '0.3 \u00d7 0.4 = 0.12', '0.4'], [190, 80, 370, 122, 'On time', '0.3 \u00d7 0.6 = 0.18', '0.6'], [190, 220, 370, 178, 'Late', '0.7 \u00d7 0.1 = 0.07', '0.1'], [190, 220, 370, 262, 'On time', '0.7 \u00d7 0.9 = 0.63', '0.9']];
      function br(x1, y1, x2, y2, p, lab, dy) { return growLine(c, x1, y1, x2, y2, C.ink, 2.5, 500).then(function () { T(c, (x1 + x2) / 2 - 8, (y1 + y2) / 2 + (dy || -8), p, { 'font-size': 12, fill: C.blue, 'font-weight': 700 }); if (lab) T(c, x2 + 8, y2 + 4, lab, { 'text-anchor': 'start', 'font-size': 12 }); }); }
      return br(50, 150, 190, 80, '0.3', null, -8).then(function () { T(c, 190, 66, 'Rain', { 'font-size': 12, 'font-weight': 700 }); return br(50, 150, 190, 220, '0.7', null, 16); }).then(function () {
        T(c, 190, 242, 'No rain', { 'font-size': 12, 'font-weight': 700 });
        var chain = Promise.resolve();
        ends.forEach(function (e) { chain = chain.then(function () { return growLine(c, e[0], e[1], e[2], e[3], C.ink, 2.2, 400).then(function () { T(c, (e[0] + e[2]) / 2 - 6, (e[1] + e[3]) / 2 + (e[3] < e[1] ? -7 : 14), e[6], { 'font-size': 11, fill: C.blue, 'font-weight': 700 }); T(c, e[2] + 8, e[3] + 4, e[4], { 'text-anchor': 'start', 'font-size': 12 }); return label(c, e[2] + 135, e[3] + 4, e[5], C.gd, 12); }); }); });
        return chain;
      }).then(function () { return label(c, 330, 304, 'P(late) = 0.12 + 0.07 = 0.19   (multiply along, add between)', C.red, 13); });
    }
    /* expected value */
    var xs = [-3, 2, 10], ps = [0.6, 0.3, 0.1], P = plot(c, { x0: -6, x1: 13, y0: 0, y1: 0.8, xt: [-3, 0, 2, 5, 10], yt: [0, 0.2, 0.4, 0.6], xl: 'Net winnings x (\u00a3)', yl: 'Probability' }), chain2 = Promise.resolve();
    xs.forEach(function (x, k) { chain2 = chain2.then(function () { var r = rect(c, P.X(x) - 26, P.B, 52, 0, k === 0 ? C.red : C.green); return c.tween(650, function (p) { var h = (P.B - P.Y(ps[k])) * p; r.setAttribute('y', P.B - h); r.setAttribute('height', h); }).then(function () { T(c, P.X(x), P.Y(ps[k]) - 8, 'p = ' + ps[k], { 'font-size': 12, 'font-weight': 700 }); }); }); });
    return chain2.then(function () { return label(c, 400, 60, 'E(X) = (\u22123)(0.6) + 2(0.3) + 10(0.1)', C.ink, 13); }).then(function () { return label(c, 400, 82, '= \u22121.8 + 0.6 + 1.0 = \u22120.2', C.ink, 13); }).then(function () {
      var tri = c.el('path', { d: 'M' + P.X(-0.2) + ' ' + (P.B + 2) + ' l-9 16 l18 0 Z', fill: C.amber }); tri.setAttribute('opacity', 0); return fade(c, tri, 500);
    }).then(function () { return label(c, 300, P.B + 62, 'E(X) = \u221220p \u2192 the player loses 20p per game on average', '#b7791f', 12); });
  };
  CAP['prob:venn'] = 'A Venn diagram sorts outcomes into overlapping sets so you can read off probabilities.';
  CAP['prob:tree'] = 'Tree diagram: multiply along the branches, add the end results you want.';
  CAP['prob:expected'] = 'The expected value is the long-run average: sum of (value \u00d7 probability).';

  /* =============== 10 \u00b7 COST-BENEFIT =============== */
  FIGS.costben = function (c, v) {
    if (v === 'risk') {
      var gx = 120, gy = 40, cs = 74, cols = [['#cfeee2', '#f7e9a8', '#f3c27a'], ['#f7e9a8', '#f3c27a', '#ee9b8f'], ['#f3c27a', '#ee9b8f', '#e0707b']], r, k, j, run = Promise.resolve();
      T(c, gx + 111, gy + 3 * cs + 22, 'Impact \u2192', { fill: C.muted, 'font-size': 12 }); T(c, 56, gy + 111, 'Likelihood', { fill: C.muted, 'font-size': 12, transform: 'rotate(-90 56 ' + (gy + 111) + ')' });
      ['low', 'medium', 'high'].forEach(function (s, i) { T(c, gx + i * cs + 37, gy + 3 * cs + 8, s, { 'font-size': 10, fill: C.muted }); T(c, gx - 8, gy + (2 - i) * cs + 40, s, { 'text-anchor': 'end', 'font-size': 10, fill: C.muted }); });
      for (k = 0; k < 3; k++) for (j = 0; j < 3; j++) { (function (k, j) { run = run.then(function () { var cell = rect(c, gx + j * cs, gy + (2 - k) * cs, cs - 3, cs - 3, cols[k][j]); cell.setAttribute('opacity', 0); return fade(c, cell, 120); }); })(k, j); }
      var risks = [['R1', 1, 1], ['R2', 0, 2], ['R3', 2, 0]];
      return run.then(function () { var ch = Promise.resolve(); risks.forEach(function (rk) { ch = ch.then(function () { var x = gx + rk[2] * cs + 37, y = gy + (2 - rk[1]) * cs + 37; var d = dot(c, x, y, 17, C.ink); T(c, x, y + 5, rk[0], { fill: C.white, 'font-size': 12, 'font-weight': 700 }); d.setAttribute('opacity', 0); return fade(c, d, 400); }); }); return ch; }).then(function () { return label(c, 440, 90, 'Expected cost =', C.ink, 14); }).then(function () { return label(c, 440, 114, 'probability \u00d7 cost', C.gd, 14); }).then(function () { return label(c, 440, 150, '0.1 \u00d7 \u00a350 000 = \u00a35 000', C.ink, 12); });
    }
    if (v === 'control') {
      var P = plot(c, { x0: 0, x1: 3, y0: 0, y1: 7000, yt: [0, 2000, 4000, 6000], xt: [], yl: 'Cost per year (\u00a3)' }), run3 = Promise.resolve();
      var bars = [[0.4, [[6000, C.red, 'expected cost of risk']], 'Before'], [1.7, [[2000, C.green, 'control measure'], [2000, C.amber, 'expected cost remaining']], 'After']];
      bars.forEach(function (bar) { run3 = run3.then(function () { var base = 0, items = bar[1].map(function (it) { var r = rect(c, P.X(bar[0]), P.B, 120, 0, it[1]); var b0 = base; base += it[0]; return { r: r, v: it[0], b0: b0, txt: it[2] }; }); return c.tween(900, function (p) { items.forEach(function (o) { var h = (P.B - P.Y(o.v)) * p, y0 = P.Y(o.b0) - h; o.r.setAttribute('y', y0); o.r.setAttribute('height', h); }); }).then(function () { items.forEach(function (o) { T(c, P.X(bar[0]) + 60, P.Y(o.b0 + o.v / 2) + 4, '\u00a3' + o.v.toLocaleString(), { fill: C.white, 'font-weight': 700, 'font-size': 12 }); }); T(c, P.X(bar[0]) + 60, P.B + 18, bar[2], { fill: C.muted, 'font-size': 12 }); }); }); });
      return run3.then(function () { return label(c, 470, 90, 'Saving = 6000 \u2212 (2000 + 2000)', C.ink, 12); }).then(function () { return label(c, 470, 112, '= \u00a32,000 per year \u2192 worth it', C.gd, 13); });
    }
    /* principle: net benefit & payback */
    var Q = plot(c, { x0: -0.6, x1: 6.6, y0: -60, y1: 45, cross: true, xt: [0, 1, 2, 3, 4, 5, 6], yt: [-50, -25, 25], xl: 'Year', yl: '\u00a3 thousands' }), cum = [-50, -35, -20, -5, 10, 25, 40], run4 = Promise.resolve();
    cum.forEach(function (val, i) {
      run4 = run4.then(function () { var net = i === 0 ? -50 : 15, r = rect(c, Q.X(i) - 14, net >= 0 ? Q.Y(0) : Q.Y(0), 28, 0, net >= 0 ? 'rgba(27,153,139,.55)' : 'rgba(214,69,80,.6)'); return c.tween(300, function (p) { var h = Math.abs(Q.Y(net) - Q.Y(0)) * p; r.setAttribute('height', h); r.setAttribute('y', net >= 0 ? Q.Y(0) - h : Q.Y(0)); }); });
    });
    return run4.then(function () { return curve(c, Q, function (x) { var i = Math.floor(x), f = x - i; return i >= 6 ? cum[6] : cum[i] + (cum[i + 1] - cum[i]) * f; }, 0, 6, C.ink, 3, 1100); }).then(function () {
      dot(c, Q.X(3 + 5 / 15), Q.Y(0), 7, C.amber); var tp = T(c, Q.X(3.33) + 14, Q.Y(0) + 34, 'payback \u2248 3.3 years', { 'text-anchor': 'start', fill: '#b7791f', 'font-size': 13, 'font-weight': 700 }); return fade(c, tp, 350);
    }).then(function () { return label(c, 190, 44, 'cost \u00a350k, then +\u00a315k a year', C.muted, 12); });
  };
  CAP['costben:principle'] = 'Cumulative net benefit: the project pays for itself when the line crosses zero.';
  CAP['costben:risk'] = 'A risk matrix combines likelihood and impact; expected cost = probability \u00d7 cost.';
  CAP['costben:control'] = 'A control measure is worth it when the reduction in expected cost beats what it costs.';

  /* =============== 11 \u00b7 GRAPHICAL METHODS =============== */
  FIGS.graph = function (c, v) {
    if (v === 'story') {
      var P = plot(c, { x0: 0, x1: 6, y0: 0, y1: 8, xt: [0, 1, 2, 3, 4, 5, 6], yt: [0, 2, 4, 6, 8], xl: 'Time (hours)', yl: 'Distance from home (km)' }), pts = [[0, 0], [2, 6], [3, 6], [6, 0]], cols = [C.green, C.amber, C.blue], labs = ['walking away', 'stopped', 'walking home'], run = Promise.resolve();
      cols.forEach(function (col, k) { run = run.then(function () { return growLine(c, P.X(pts[k][0]), P.Y(pts[k][1]), P.X(pts[k + 1][0]), P.Y(pts[k + 1][1]), col, 4, 800).then(function () { var mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2; return label(c, P.X(mx) + (k === 2 ? 40 : k === 0 ? 50 : 0), P.Y(my) + (k === 0 ? 16 : -12), labs[k], col === C.amber ? '#b7791f' : col, 12); }); }); });
      return run.then(function () { return label(c, 400, 56, 'steeper = faster, flat = stationary', C.muted, 12); });
    }
    if (v === 'curves') {
      var Q = plot(c, { x0: -3, x1: 4.5, y0: -6, y1: 8, cross: true, xt: [-3, -2, -1, 1, 2, 3, 4], yt: [-4, 4, 8] });
      return curve(c, Q, function (x) { return x * x - 2 * x - 3; }, -3, 4.5, C.blue, 3.5, 1000).then(function () { legend(c, 440, 40, C.blue, 'quadratic'); return curve(c, Q, function (x) { return 0.5 * x * x * x - 2 * x; }, -3, 4.5, C.green, 3.5, 1000); }).then(function () { legend(c, 440, 64, C.green, 'cubic'); return label(c, 140, 70, 'x\u00b2 \u2212 2x \u2212 3: \u222a-shape, roots \u22121 and 3', C.blue, 11); }).then(function () { return label(c, 140, 92, '\u00bdx\u00b3 \u2212 2x: S-shape, 3 roots', C.gd, 11); });
    }
    if (v === 'solve') {
      var S = plot(c, { x0: -3, x1: 5, y0: -5, y1: 8, cross: true, xt: [-2, -1, 1, 2, 3, 4], yt: [-4, 2, 4, 6] }), f = function (x) { return x * x - 2 * x - 3; };
      return curve(c, S, f, -3, 5, C.blue, 3.5, 900).then(function () { return growLine(c, S.L, S.Y(2), S.R, S.Y(2), C.red, 2.5, 700); }).then(function () { T(c, S.R - 6, S.Y(2) - 7, 'y = 2', { 'text-anchor': 'end', fill: C.red, 'font-weight': 700, 'font-size': 12 }); var xs = [1 - Math.sqrt(6), 1 + Math.sqrt(6)], run = Promise.resolve(); xs.forEach(function (x) { run = run.then(function () { dot(c, S.X(x), S.Y(2), 7, C.amber); return growLine(c, S.X(x), S.Y(2), S.X(x), S.Y(0), C.amber, 2, 400, '5 4').then(function () { return label(c, S.X(x), S.Y(0) + 38, 'x \u2248 ' + x.toFixed(2).replace('-', '\u2212'), '#b7791f', 12); }); }); }); return run; }).then(function () { return label(c, 400, 40, 'Solving x\u00b2 \u2212 2x \u2212 3 = 2', C.ink, 12); });
    }
    /* linear */
    var R = plot(c, { x0: -1, x1: 5, y0: -2, y1: 12, cross: true, xt: [-1, 1, 2, 3, 4, 5], yt: [2, 4, 6, 8, 10] });
    return curve(c, R, function (x) { return 2 * x + 1; }, -1, 5, C.blue, 3.5, 900).then(function () {
      dot(c, R.X(0), R.Y(1), 6, C.amber); T(c, R.X(0) - 10, R.Y(1) - 8, 'c = 1', { 'text-anchor': 'end', fill: '#b7791f', 'font-weight': 700, 'font-size': 13 });
      return growLine(c, R.X(1), R.Y(3), R.X(3), R.Y(3), C.green, 2.5, 450).then(function () { return growLine(c, R.X(3), R.Y(3), R.X(3), R.Y(7), C.green, 2.5, 450); });
    }).then(function () { T(c, R.X(2), R.Y(3) + 18, 'run = 2', { fill: C.gd, 'font-size': 12, 'font-weight': 700 }); T(c, R.X(3) + 10, R.Y(5), 'rise = 4', { 'text-anchor': 'start', fill: C.gd, 'font-size': 12, 'font-weight': 700 }); return label(c, 260, 52, 'y = 2x + 1', C.blue, 16); }).then(function () { return label(c, 260, 78, 'gradient m = 4 \u00f7 2 = 2', C.gd, 13); });
  };
  CAP['graph:story'] = 'Reading a graph as a story: slope = speed, flat = stopped.';
  CAP['graph:linear'] = 'y = mx + c: the gradient m is the rate of change, c is the starting value.';
  CAP['graph:curves'] = 'Key features of quadratic and cubic graphs.';
  CAP['graph:solve'] = 'Solutions of an equation are the x-values where two graphs meet.';

  /* =============== 12 \u00b7 RATES OF CHANGE =============== */
  FIGS.rate = function (c, v) {
    if (v === 'speed') {
      var P = plot(c, { x0: 0, x1: 12, y0: 0, y1: 26, xt: [0, 2, 4, 6, 8, 10, 12], yt: [0, 10, 20], xl: 'Time (s)', yl: 'Speed (m/s)' }), vt = function (t) { return t <= 4 ? 5 * t : t <= 8 ? 20 : 20 - 5 * (t - 8); };
      var sh = area(c, P, vt, 0, 12, C.green, 0); return curve(c, P, vt, 0, 12, C.blue, 3.5, 1200).then(function () { return c.tween(700, function (p) { sh.setAttribute('opacity', 0.28 * p); }); }).then(function () { return label(c, P.X(1.6), P.Y(16), 'gradient = 5 m/s\u00b2', C.blue, 12); }).then(function () { return label(c, P.X(6), P.Y(20) - 10, 'gradient = 0', C.muted, 12); }).then(function () { return label(c, P.X(10.4), P.Y(16), 'gradient = \u22125 m/s\u00b2', C.blue, 12); }).then(function () { return label(c, P.X(6), P.Y(8), 'area = distance = 160 m', C.gd, 13); });
    }
    if (v === 'tangent') {
      var Q = plot(c, { x0: 0, x1: 4, y0: 0, y1: 16, xt: [0, 1, 2, 3, 4], yt: [0, 4, 8, 12, 16], xl: 'x', yl: 'y = x\u00b2' }), f = function (x) { return x * x; };
      var tl = line(c, 0, 0, 0, 0, C.red, 2.5), pt = dot(c, 0, 0, 7, C.red), txt = T(c, 200, 60, '', { 'font-size': 15, 'font-weight': 700, fill: C.red });
      curve(c, Q, f, 0, 4, C.blue, 3.5, 700);
      return c.wait(750).then(function () { return c.tween(3200, function (p) { var x = 0.4 + 3.1 * p, m = 2 * x, y = f(x), xa = Math.max(0, x - 1.1), xb = Math.min(4, x + 1.1); tl.setAttribute('x1', Q.X(xa)); tl.setAttribute('y1', Q.Y(y + m * (xa - x))); tl.setAttribute('x2', Q.X(xb)); tl.setAttribute('y2', Q.Y(y + m * (xb - x))); pt.setAttribute('cx', Q.X(x)); pt.setAttribute('cy', Q.Y(y)); txt.textContent = 'x = ' + x.toFixed(1) + '   tangent gradient = ' + m.toFixed(1); }); });
    }
    /* gradient (straight line, constant rate) */
    var R = plot(c, { x0: 0, x1: 3, y0: 0, y1: 140, xt: [0, 0.5, 1, 1.5, 2, 2.5, 3], yt: [0, 40, 80, 120], xl: 'Time (hours)', yl: 'Distance (km)' });
    return curve(c, R, function (x) { return 40 * x; }, 0, 3, C.blue, 3.5, 900).then(function () { return growLine(c, R.X(1), R.Y(40), R.X(2), R.Y(40), C.green, 2.5, 450); }).then(function () { return growLine(c, R.X(2), R.Y(40), R.X(2), R.Y(80), C.green, 2.5, 450); }).then(function () { T(c, R.X(1.5), R.Y(40) + 18, 'run = 1 h', { fill: C.gd, 'font-size': 12, 'font-weight': 700 }); T(c, R.X(2) + 8, R.Y(60), 'rise = 40 km', { 'text-anchor': 'start', fill: C.gd, 'font-size': 12, 'font-weight': 700 }); return label(c, 225, 50, 'gradient = 40 \u00f7 1 = 40 km/h', C.blue, 14); }).then(function () { return label(c, 225, 74, 'constant rate of change', C.muted, 12); });
  };
  CAP['rate:gradient'] = 'The gradient of a distance\u2013time line is the speed: a constant rate of change.';
  CAP['rate:tangent'] = 'On a curve the rate of change varies: it equals the gradient of the tangent at each point.';
  CAP['rate:speed'] = 'Gradient of a speed\u2013time graph = acceleration; area under it = distance.';

  /* =============== 13 \u00b7 EXPONENTIAL FUNCTIONS =============== */
  FIGS.expo = function (c, v) {
    if (v === 'growth') {
      var P = plot(c, { x0: -0.6, x1: 6.8, y0: 0, y1: 72, xt: [0, 1, 2, 3, 4, 5, 6], yt: [0, 16, 32, 48, 64], xl: 'Time (hours)', yl: 'Bacteria' }), run = Promise.resolve();
      for (var k = 0; k <= 6; k++) { (function (k) { run = run.then(function () { var v2 = Math.pow(2, k), r = rect(c, P.X(k) - 16, P.B, 32, 0, C.green); return c.tween(350, function (p) { var h = (P.B - P.Y(v2)) * p; r.setAttribute('y', P.B - h); r.setAttribute('height', h); }).then(function () { T(c, P.X(k), P.Y(v2) - 6, String(v2), { 'font-size': 11, 'font-weight': 700 }); }); }); })(k); }
      return run.then(function () { return curve(c, P, function (x) { return Math.pow(2, x); }, 0, 6, C.blue, 3, 800); }).then(function () { return label(c, 270, 44, 'N = 1 \u00d7 2\u1d57  (doubles every hour)', C.blue, 14); }).then(function () { return label(c, 270, 68, 'constant multiplier: \u00d72 each step', C.muted, 12); });
    }
    if (v === 'e') {
      var Q = plot(c, { x0: -2, x1: 3, y0: -1, y1: 22, cross: true, xt: [-2, -1, 1, 2, 3], yt: [5, 10, 15, 20] }), f = Math.exp;
      var tl = line(c, 0, 0, 0, 0, C.red, 2.5), pt = dot(c, 0, 0, 7, C.red), txt = T(c, 330, 36, '', { 'font-size': 14, 'font-weight': 700, fill: C.red });
      curve(c, Q, f, -2, 3, C.blue, 3.5, 700);
      return c.wait(750).then(function () { return c.tween(3200, function (p) { var x = -1 + 3.8 * p, y = f(x), m = y; x = Math.min(x, 2.95); y = f(x); m = y; var xa = x - 0.9, xb = x + 0.9; tl.setAttribute('x1', Q.X(xa)); tl.setAttribute('y1', Q.Y(y + m * (xa - x))); tl.setAttribute('x2', Q.X(xb)); tl.setAttribute('y2', Q.Y(y + m * (xb - x))); pt.setAttribute('cx', Q.X(x)); pt.setAttribute('cy', Q.Y(y)); txt.textContent = 'x = ' + x.toFixed(1) + '   height = ' + y.toFixed(2) + '   gradient = ' + m.toFixed(2); }); });
    }
    if (v === 'ln') {
      var S = plot(c, { box: [190, 24, 428, 262], x0: -2, x1: 4, y0: -2, y1: 4, cross: true, xt: [-1, 1, 2, 3], yt: [-1, 1, 2, 3] });
      return curve(c, S, Math.exp, -2, 4, C.blue, 3.5, 900).then(function () { legend(c, 440, 50, C.blue, 'y = e\u02e3'); return curve(c, S, Math.log, 0.02, 4, C.green, 3.5, 900); }).then(function () { legend(c, 440, 74, C.green, 'y = ln x'); return curve(c, S, function (x) { return x; }, -2, 4, C.muted, 2, 500, '6 4'); }).then(function () { T(c, S.X(3.1), S.Y(2.55), 'y = x', { fill: C.muted, 'font-size': 11, 'text-anchor': 'start' }); dot(c, S.X(1), S.Y(Math.E), 6, C.amber); dot(c, S.X(Math.E), S.Y(1), 6, C.amber); line(c, S.X(1), S.Y(Math.E), S.X(Math.E), S.Y(1), C.amber, 2, '4 4'); return label(c, 510, 130, 'ln is the mirror image', C.ink, 12); }).then(function () { return label(c, 510, 152, 'of e\u02e3 in the line y = x', C.ink, 12); }).then(function () { return label(c, 510, 190, 'ln(e\u02e3) = x', C.gd, 14); });
    }
    /* compare */
    var R = plot(c, { x0: 0, x1: 6, y0: 0, y1: 70, xt: [0, 1, 2, 3, 4, 5, 6], yt: [0, 20, 40, 60], xl: 'x', yl: 'y' });
    return curve(c, R, function (x) { return 2 * x; }, 0, 6, C.muted, 3, 700).then(function () { legend(c, 90, 44, C.muted, 'linear: y = 2x'); return curve(c, R, function (x) { return x * x; }, 0, 6, C.blue, 3, 800); }).then(function () { legend(c, 90, 66, C.blue, 'quadratic: y = x\u00b2'); return curve(c, R, function (x) { return Math.pow(2, x); }, 0, 6, C.green, 3.5, 1000); }).then(function () { legend(c, 90, 88, C.green, 'exponential: y = 2\u02e3'); return label(c, 360, 70, 'exponential growth', C.gd, 14); }).then(function () { return label(c, 360, 92, 'always wins in the end', C.gd, 14); });
  };
  CAP['expo:growth'] = 'Exponential growth: the quantity is multiplied by the same factor in equal steps.';
  CAP['expo:compare'] = 'Exponential growth eventually overtakes linear and quadratic growth.';
  CAP['expo:e'] = 'For y = e\u02e3 the gradient at every point equals the height of the curve.';
  CAP['expo:ln'] = 'ln x is the inverse of e\u02e3: reflect in the line y = x.';

  /* =============== ENGINE =============== */
  function build(fig) {
    var name = fig.getAttribute('data-viz'), variant = fig.getAttribute('data-variant') || '';
    if (!FIGS[name]) return;
    var wrap = document.createElement('div'); wrap.className = 'viz-stage';
    var svg = el('svg', { viewBox: '0 0 600 330', role: 'img', 'aria-label': (CAP[name + ':' + variant] || name) });
    var bar = document.createElement('div'); bar.className = 'viz-bar';
    var cap = document.createElement('span'); cap.className = 'viz-cap'; cap.textContent = fig.getAttribute('data-caption') || CAP[name + ':' + variant] || '';
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'viz-replay'; btn.textContent = '\u21bb Replay';
    wrap.appendChild(svg); bar.appendChild(cap); bar.appendChild(btn); fig.appendChild(wrap); fig.appendChild(bar);
    var st = { tok: 0, svg: svg, name: name, variant: variant };
    function play() {
      var tok = ++st.tok; while (svg.firstChild) svg.removeChild(svg.firstChild);
      var ctx = {
        svg: svg,
        el: function (t, a, x) { return el(t, a, svg, x); },
        tween: function (ms, fn) {
          return new Promise(function (res, rej) {
            if (tok !== st.tok) { rej(ABORT); return; }
            if (INSTANT) { fn(1); res(); return; }
            var t0 = performance.now();
            (function frame(now) { if (tok !== st.tok) { rej(ABORT); return; } var p = Math.min(1, (now - t0) / ms); fn(ease(p)); if (p < 1) requestAnimationFrame(frame); else res(); })(t0);
          });
        },
        wait: function (ms) { return ctx.tween(ms, function () { }); }
      };
      var out;
      try { out = FIGS[name](ctx, variant); } catch (e) { out = Promise.reject(e); }
      Promise.resolve(out).catch(function (e) { if (e !== ABORT) { fig.setAttribute('data-viz-error', String(e && e.message || e)); if (window.console) console.error('viz error', name, variant, e); } });
    }
    btn.addEventListener('click', play);
    if ('IntersectionObserver' in window && !INSTANT) {
      var obs = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { obs.disconnect(); play(); } }); }, { threshold: 0.35 });
      obs.observe(fig);
    } else { play(); }
  }
  function init() { var list = document.querySelectorAll('figure.viz[data-viz]'), i; for (i = 0; i < list.length; i++) { try { build(list[i]); } catch (e) { if (window.console) console.error(e); } } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
