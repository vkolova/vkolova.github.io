/* Trackprint — GPX poster studio */
const $ = (id) => document.getElementById(id);
const U = 1000; // poster width in layout units
const OFM = 'https://tiles.openfreemap.org/styles/';

const STYLES = [
  { id: 'meadow', name: 'Meadow', base: 'positron', sw: 'linear-gradient(135deg,#cfe6c4 50%,#f4f8f1 50%)',
    pal: { bg: '#f7faf4', land: '#eef5e9', green: '#c6e1b8', green2: '#d9ecd0', water: '#9fc8ea', road: '#ffffff', roadCase: '#9aa59a', building: '#e3e8de' } },
  { id: 'sand', name: 'Sand', base: 'positron', sw: 'linear-gradient(135deg,#e9dcc4 50%,#f8f2e6 50%)',
    pal: { bg: '#f8f2e6', land: '#f3ead9', green: '#e4d6b9', green2: '#ece1ca', water: '#c9d6d6', road: '#fffaf0', roadCase: '#bfae8f', building: '#e8dcc5' } },
  { id: 'liberty', name: 'Liberty', base: 'liberty', sw: 'linear-gradient(135deg,#bfdcb0 50%,#f1efe9 50%)' },
  { id: 'bright', name: 'Bright', base: 'bright', sw: 'linear-gradient(135deg,#a8d8f0 50%,#f6f3ea 50%)' },
  { id: 'positron', name: 'Light', base: 'positron', sw: 'linear-gradient(135deg,#dedede 50%,#fafafa 50%)' },
  { id: 'dark', name: 'Dark', base: 'dark', sw: 'linear-gradient(135deg,#222 50%,#3a3a3a 50%)' },
  { id: 'fiord', name: 'Fiord', base: 'fiord', sw: 'linear-gradient(135deg,#3d5266 50%,#52687e 50%)' },
  { id: 'blank', name: 'Blank', base: 'positron', sw: 'repeating-linear-gradient(45deg,#fff 0 6px,#f0f0f0 6px 12px)' },
];

const state = {
  track: null, styleId: 'meadow',
  stats: { distance: true, elevation: true, time: true, pace: true },
};

/* ---------------- GPX parsing ---------------- */
function hav(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Not a valid GPX/XML file');
  let nodes = [...doc.getElementsByTagName('trkpt')];
  if (!nodes.length) nodes = [...doc.getElementsByTagName('rtept')];
  if (!nodes.length) throw new Error('No track points found');
  const pts = nodes.map((n) => {
    const e = n.getElementsByTagName('ele')[0], t = n.getElementsByTagName('time')[0];
    return { lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon'),
      ele: e ? +e.textContent : null, time: t ? Date.parse(t.textContent) : null };
  }).filter((p) => isFinite(p.lat) && isFinite(p.lon));
  const nameEl = doc.querySelector('trk > name') || doc.querySelector('metadata > name') || doc.querySelector('name');
  return buildTrack(pts, nameEl ? nameEl.textContent.trim() : '');
}

function buildTrack(pts, name) {
  let dist = 0, moving = 0;
  pts[0].d = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = hav(pts[i - 1], pts[i]);
    dist += seg; pts[i].d = dist;
    if (pts[i].time && pts[i - 1].time) {
      const dt = (pts[i].time - pts[i - 1].time) / 1000;
      if (dt > 0 && seg / dt > 0.5 && dt < 300) moving += dt;
    }
  }
  // elevation: smooth + hysteresis
  const hasEle = pts.some((p) => p.ele != null);
  let gain = 0, loss = 0, minE = Infinity, maxE = -Infinity;
  if (hasEle) {
    const raw = pts.map((p) => p.ele);
    for (let i = 0; i < raw.length; i++) if (raw[i] == null) raw[i] = raw[i - 1] ?? raw.find((v) => v != null);
    const w = 3;
    const sm = raw.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(raw.length - 1, i + w); j++) { s += raw[j]; c++; } return s / c; });
    let ref = sm[0];
    for (const v of sm) {
      if (v - ref > 2) { gain += v - ref; ref = v; } else if (ref - v > 2) { loss += ref - v; ref = v; }
    }
    pts.forEach((p, i) => { p.se = sm[i]; minE = Math.min(minE, raw[i]); maxE = Math.max(maxE, raw[i]); });
  }
  const t0 = pts.find((p) => p.time)?.time, t1 = [...pts].reverse().find((p) => p.time)?.time;
  const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
  return { name, pts, dist, gain, loss, hasEle, minE, maxE,
    elapsed: t0 && t1 ? (t1 - t0) / 1000 : 0, moving, start: t0 ? new Date(t0) : null,
    bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    center: { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 } };
}

/* Demo loop so the editor is never empty */
function sampleTrack() {
  const c = { lat: 42.905, lon: 24.30 }, pts = [], N = 900;
  const t0 = Date.parse('2026-05-16T08:00:00Z');
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.028 * (1 + 0.28 * Math.sin(3 * a + 0.7) + 0.12 * Math.sin(7 * a) + 0.04 * Math.sin(23 * a));
    pts.push({ lat: c.lat + r * Math.sin(a) * 0.62, lon: c.lon + r * Math.cos(a) * 1.25,
      ele: 520 + 380 * Math.sin(a / 2) ** 2 + 60 * Math.sin(5 * a) + 15 * Math.sin(17 * a),
      time: t0 + i * 17000 });
  }
  return buildTrack(pts, 'Sample Trail Loop 2026');
}

/* ---------------- Formatting ---------------- */
const fmtDur = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min ${String(s % 60).padStart(2, '0')}s`; };
function parseDur(str) {
  const p = str.trim().split(':').map(Number); if (!p.length || p.some(isNaN)) return null;
  return p.reduce((a, v) => a * 60 + v, 0) * (p.length === 2 ? 60 : 1);
}
function timeSeconds() {
  const o = parseDur($('timeOverride').value || '');
  if (o) return o;
  const t = state.track; return $('timeMode').value === 'moving' && t.moving ? t.moving : t.elapsed;
}
function getStats() {
  const t = state.track, out = [], km = t.dist / 1000, sec = timeSeconds();
  if (state.stats.distance) out.push(['Distance', km >= 100 ? `${km.toFixed(0)} km` : `${km.toFixed(km < 10 ? 2 : 1)} km`]);
  if (state.stats.elevation && t.hasEle) out.push(['Elevation gain', `${Math.round(t.gain)} m`]);
  if (state.stats.time && sec) out.push(['Time', fmtDur(sec)]);
  if (state.stats.pace && sec && km) {
    if ($('paceUnit').value === 'speed') out.push(['Speed', `${(km / (sec / 3600)).toFixed(1)} km/h`]);
    else { const p = Math.round(sec / km); out.push(['Pace', `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')} /km`]); }
  }
  return out;
}
function dateText() {
  const v = $('date').value, f = $('dateFmt').value; if (!v || f === 'none') return '';
  const d = new Date(v + 'T12:00:00');
  if (f === 'year') return String(d.getFullYear());
  if (f === 'dots') return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
const coordText = (c) => `${Math.abs(c.lat).toFixed(4)}° ${c.lat >= 0 ? 'N' : 'S'} · ${Math.abs(c.lon).toFixed(4)}° ${c.lon >= 0 ? 'E' : 'W'}`;

/* ---------------- Layout ---------------- */
function posterMM() {
  let w, h;
  if ($('size').value === 'custom') { w = +$('cw').value || 210; h = +$('ch').value || 297; }
  else [w, h] = $('size').value.split('x').map(Number);
  if ($('orient').value === 'l' && h > w) [w, h] = [h, w];
  if ($('orient').value === 'p' && w > h) [w, h] = [h, w];
  return { w, h };
}

function layout() {
  const { w, h } = posterMM(), H = (U * h) / w, L = $('layout').value;
  const m = L === 'full' ? 0 : +$('margin').value * 9;
  const land = H < U * 1.05;
  const prof = $('prof').value !== 'none' && state.track.hasEle;
  const below = prof && $('profPos').value === 'below' && L !== 'bold';
  const profH = land ? 70 : 95;
  let footer = { classic: 300, editorial: 210, bold: 230, full: 250 }[L];
  if (land) footer *= 0.78;
  const map = { x: m, y: m, w: U - 2 * m, h: H - m - footer - (below ? profH + 12 : 0) };
  if (L === 'full') map.h = H;
  const footerTop = L === 'full' ? H - footer : map.y + map.h + (below ? profH + 12 : 0);
  let profile = null;
  if (prof) profile = below ? { x: map.x, y: map.y + map.h + 12, w: map.w, h: profH, below: true }
    : { x: map.x, y: (L === 'full' ? footerTop : map.y + map.h) - profH * 1.15, w: map.w, h: profH * 1.15, below: false };
  return { H, m, map, footerTop, footer, profile, L, land };
}

/* ---------------- Map ---------------- */
let map, mapReady = false;
const styleDef = () => STYLES.find((s) => s.id === state.styleId);

function recolor(style, def) {
  const p = def.pal, showLabels = $('labels').checked;
  style.layers = style.layers.filter((l) => {
    if (l.type === 'symbol') return showLabels && def.id !== 'blank';
    if (def.id === 'blank') return l.type === 'background';
    return true;
  });
  if (def.id === 'blank') { style.layers.forEach((l) => (l.paint = { 'background-color': $('bg').value })); return style; }
  if (!p) return style;
  for (const l of style.layers) {
    const id = l.id, key = l.type === 'fill' ? 'fill-color' : l.type === 'line' ? 'line-color' : l.type === 'background' ? 'background-color' : null;
    if (!key) continue;
    l.paint = l.paint || {};
    let c = null;
    if (l.type === 'background') c = p.bg;
    else if (/water|ocean|lake|river|stream|canal/.test(id)) c = p.water;
    else if (/wood|forest/.test(id)) c = p.green;
    else if (/grass|park|scrub|meadow|landcover|wetland|farmland|cemetery|pitch/.test(id)) c = p.green2;
    else if (/building/.test(id)) c = p.building;
    else if (/casing|outline/.test(id) && /road|highway|street|bridge|tunnel|path/.test(id)) c = p.roadCase;
    else if (/rail/.test(id)) c = p.roadCase;
    else if (/road|highway|street|bridge|tunnel|path|track|minor|major|motorway|trunk|primary|secondary|service/.test(id)) c = l.type === 'line' ? (/path|track|minor|service/.test(id) ? p.roadCase : p.road) : p.road;
    else if (/boundary|admin/.test(id)) c = p.roadCase;
    else if (/landuse|residential|aeroway|ice|glacier/.test(id)) c = p.land;
    if (c) { l.paint[key] = c; if (l.type === 'fill') delete l.paint['fill-pattern']; }
  }
  return style;
}

function routeGeo() {
  const coords = state.track.pts.map((p) => [p.lon, p.lat]);
  return { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { k: 'line' }, geometry: { type: 'LineString', coordinates: coords } },
    { type: 'Feature', properties: { k: 'start' }, geometry: { type: 'Point', coordinates: coords[0] } },
    { type: 'Feature', properties: { k: 'end' }, geometry: { type: 'Point', coordinates: coords[coords.length - 1] } },
  ] };
}

function addRoute() {
  if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: routeGeo() });
  const lineF = ['==', ['get', 'k'], 'line'];
  const base = { type: 'line', source: 'route', filter: lineF, layout: { 'line-cap': 'round', 'line-join': 'round' } };
  map.addLayer({ ...base, id: 'route-under', paint: {} });
  map.addLayer({ ...base, id: 'route-main', paint: {} });
  map.addLayer({ id: 'route-pts', type: 'circle', source: 'route', filter: ['!=', ['get', 'k'], 'line'], paint: {} });
  styleRoute();
}

function styleRoute() {
  if (!map || !map.getLayer('route-main')) return;
  const k = posterPx() / U, w = +$('rw').value * k, col = $('rc').value, st = $('rstyle').value;
  const dark = ['dark', 'fiord'].includes(state.styleId);
  map.setPaintProperty('route-main', 'line-color', col);
  map.setPaintProperty('route-main', 'line-width', w);
  map.setPaintProperty('route-main', 'line-dasharray', st === 'dashed' ? [2, 1.6] : [1, 0]);
  const u = { outline: [dark ? '#000' : '#fff', w * 2.2, 1, 0], glow: [col, w * 4, 0.28, w * 1.6] }[st];
  map.setLayoutProperty('route-under', 'visibility', u ? 'visible' : 'none');
  if (u) { map.setPaintProperty('route-under', 'line-color', u[0]); map.setPaintProperty('route-under', 'line-width', u[1]); map.setPaintProperty('route-under', 'line-opacity', u[2]); map.setPaintProperty('route-under', 'line-blur', u[3]); }
  map.setLayoutProperty('route-pts', 'visibility', $('markers').checked ? 'visible' : 'none');
  map.setPaintProperty('route-pts', 'circle-radius', w * 1.25);
  map.setPaintProperty('route-pts', 'circle-color', ['match', ['get', 'k'], 'start', '#ffffff', col]);
  map.setPaintProperty('route-pts', 'circle-stroke-color', col);
  map.setPaintProperty('route-pts', 'circle-stroke-width', w * 0.6);
}

function loadStyle() {
  const def = styleDef(); mapReady = false;
  map.setStyle(OFM + def.base, { diff: false, transformStyle: (_prev, next) => recolor(structuredClone(next), def) });
}

function initMap() {
  map = new maplibregl.Map({ container: 'map', style: { version: 8, sources: {}, layers: [] }, center: [state.track.center.lon, state.track.center.lat], zoom: 11,
    preserveDrawingBuffer: true, attributionControl: false, fadeDuration: 0, maxPitch: 0, dragRotate: false, pitchWithRotate: false, touchPitch: false });
  map.on('style.load', () => { addRoute(); mapReady = true; });
  map.on('moveend', draw);
  loadStyle();
  fitRoute(false);
}

function fitRoute(animate = true) {
  if (!map) return;
  const r = map.getContainer().getBoundingClientRect(), lay = layout(), k = posterPx() / U;
  const pad = Math.min(r.width, r.height) * 0.12;
  const bottom = lay.profile && !lay.profile.below ? lay.profile.h * k + pad * 0.5 : pad;
  map.fitBounds(state.track.bounds, { padding: { top: pad, left: pad, right: pad, bottom: Math.min(bottom, r.height * 0.5) }, animate, duration: animate ? 500 : 0 });
}

/* ---------------- Preview sizing ---------------- */
let previewW = 500;
const posterPx = () => previewW;
function sizePoster() {
  const { w, h } = posterMM(), st = $('stage'), sr = st.getBoundingClientRect();
  const availW = sr.width - 56, availH = (innerWidth <= 800 ? innerHeight * 0.8 : sr.height) - 90;
  previewW = Math.max(200, Math.min(availW, (availH * w) / h));
  const P = $('poster'); P.style.width = previewW + 'px'; P.style.height = (previewW * h) / w + 'px';
  const lay = layout(), k = previewW / U, M = $('map');
  Object.assign(M.style, { left: lay.map.x * k + 'px', top: lay.map.y * k + 'px', width: lay.map.w * k + 'px', height: lay.map.h * k + 'px' });
  if (map) { map.resize(); styleRoute(); }
  draw();
}

/* ---------------- Overlay drawing (shared by preview + export) ---------------- */
function fitFont(ctx, text, weight, family, size, maxW) {
  let s = size; ctx.font = `${weight} ${s}px "${family}"`;
  while (ctx.measureText(text).width > maxW && s > 6) { s *= 0.95; ctx.font = `${weight} ${s}px "${family}"`; }
  return s;
}
function spaced(ctx, text, x, y, sp, align) {
  if ('letterSpacing' in ctx) { ctx.letterSpacing = sp + 'px'; const wd = ctx.measureText(text).width; ctx.textAlign = 'left';
    const sx = align === 'center' ? x - (wd - sp) / 2 : align === 'right' ? x - wd + sp : x; ctx.fillText(text, sx, y); ctx.letterSpacing = '0px'; return; }
  ctx.textAlign = align; ctx.fillText(text, x, y);
}

function drawProfile(ctx, r, k) {
  const t = state.track, style = $('prof').value, col = $('pc').value;
  const N = 260, pts = [], step = t.dist / N; let j = 0;
  for (let i = 0; i <= N; i++) { const d = i * step; while (j < t.pts.length - 1 && t.pts[j + 1].d < d) j++; pts.push(t.pts[j].se); }
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const x0 = r.x * k, y0 = r.y * k, w = r.w * k, h = r.h * k;
  const top = y0 + h * 0.12, bot = y0 + h - (r.below ? 0 : h * 0.02);
  const X = (i) => x0 + (i / N) * w, Y = (v) => bot - ((v - lo) / span) * (bot - top);
  ctx.save();
  if (!r.below) { // soften map behind profile
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h); const bg = $('bg').value;
    g.addColorStop(0, hexA(bg, 0)); g.addColorStop(0.55, hexA(bg, 0.7)); g.addColorStop(1, hexA(bg, 0.95));
    ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
  }
  const path = () => { ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); };
  if (style === 'bars') {
    const bw = w / N; ctx.fillStyle = col;
    for (let i = 0; i < N; i += 2) ctx.fillRect(X(i), Y(pts[i]), bw * 1.4, bot - Y(pts[i]));
  } else {
    if (style !== 'line') {
      path(); ctx.lineTo(X(N), bot); ctx.lineTo(X(0), bot); ctx.closePath();
      if (style === 'fade') { const g = ctx.createLinearGradient(0, top, 0, bot); g.addColorStop(0, hexA(col, 0.55)); g.addColorStop(1, hexA(col, 0.03)); ctx.fillStyle = g; }
      else ctx.fillStyle = hexA(col, 0.85);
      ctx.fill();
    }
    path(); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 2 * k); ctx.lineJoin = 'round'; ctx.stroke();
  }
  if ($('profLabels').checked) {
    ctx.fillStyle = hexA($('fg').value, 0.65); ctx.font = `500 ${11 * k}px "JetBrains Mono"`; ctx.textAlign = 'left';
    const lab = (txt, y) => { const tw = ctx.measureText(txt).width; ctx.fillStyle = hexA($('bg').value, 0.85); ctx.fillRect(x0 + 3 * k, y - 11 * k, tw + 8 * k, 15 * k); ctx.fillStyle = hexA($('fg').value, 0.75); ctx.fillText(txt, x0 + 7 * k, y); };
    lab(`${Math.round(t.maxE)} m`, top - 6 * k); lab(`${Math.round(t.minE)} m`, bot - 4 * k);
  }
  ctx.restore();
}
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

function drawOverlay(ctx, pxW) {
  const lay = layout(), k = pxW / U, H = lay.H * k, fg = $('fg').value, bg = $('bg').value, font = $('font').value;
  const titleW = $('font').value === 'Fraunces' ? 700 : font === 'JetBrains Mono' ? 500 : font === 'Archivo' ? 800 : 600;
  const title = $('title').value || 'Untitled activity', sub = [$('subtitle').value, dateText()].filter(Boolean).join('  ·  ');
  const stats = getStats(), m = lay.m, cx = (U / 2) * k;
  ctx.textBaseline = 'alphabetic';
  if (lay.L === 'full') { // paper band with soft edge over the map
    const ft = lay.footerTop * k, g = ctx.createLinearGradient(0, ft - 120 * k, 0, ft);
    g.addColorStop(0, hexA(bg, 0)); g.addColorStop(1, bg); ctx.fillStyle = g; ctx.fillRect(0, ft - 120 * k, pxW, 120 * k);
    ctx.fillStyle = bg; ctx.fillRect(0, ft, pxW, H - ft);
  }
  if (lay.profile) drawProfile(ctx, lay.profile, k);
  if ($('frame').checked) { ctx.strokeStyle = fg; ctx.lineWidth = 1.5 * k; const f = Math.max(m * 0.45, 14) * k; ctx.strokeRect(f, f, pxW - 2 * f, H - 2 * f); }

  const fy = lay.footerTop * k, fh = lay.footer * k, inner = (U - 2 * Math.max(m, 50)) * k;
  ctx.fillStyle = fg;
  const statLine = (y, labelled, align = 'center', x = cx, maxW = inner) => {
    if (!stats.length) return;
    const n = stats.length, colW = maxW / n;
    stats.forEach(([lab, val], i) => {
      const sx = align === 'center' ? x - maxW / 2 + colW * (i + 0.5) : x - maxW + colW * (i + 0.5);
      if (labelled) { ctx.fillStyle = hexA(fg, 0.5); ctx.font = `500 ${10.5 * k}px "JetBrains Mono"`; spaced(ctx, lab.toUpperCase(), sx, y, 1.2 * k, 'center'); }
      ctx.fillStyle = fg; ctx.font = `600 ${(labelled ? 19 : 24) * k}px "${font}"`; ctx.textAlign = 'center';
      ctx.fillText(val, sx, y + (labelled ? 28 * k : 0));
    });
  };

  if (lay.L === 'classic' || lay.L === 'full') {
    const sz = fitFont(ctx, title.toUpperCase(), titleW, font, 56 * k, inner);
    const ty = fy + fh * 0.3; spaced(ctx, title.toUpperCase(), cx, ty, sz * 0.12, 'center');
    ctx.fillRect(cx - 36 * k, ty + 22 * k, 72 * k, 2 * k);
    let y = ty + 66 * k;
    if (stats.length) { ctx.font = `400 ${24 * k}px "${font}"`; ctx.textAlign = 'center'; ctx.fillText(stats.map((s) => s[1]).join('   ·   '), cx, y); y += 38 * k; }
    ctx.fillStyle = hexA(fg, 0.7); ctx.font = `400 ${15 * k}px "JetBrains Mono"`;
    const meta = [sub, $('coords').checked ? coordText(state.track.center) : ''].filter(Boolean);
    meta.forEach((t) => { spaced(ctx, t, cx, y, 1.5 * k, 'center'); y += 24 * k; });
  } else if (lay.L === 'editorial') {
    const lx = (m || 40) * k, half = (U - 2 * (m || 40)) * k;
    const sz = fitFont(ctx, title, titleW, font, 50 * k, half * 0.52);
    ctx.textAlign = 'left'; ctx.fillText(title, lx, fy + fh * 0.42);
    ctx.fillStyle = hexA(fg, 0.65); ctx.font = `500 ${13 * k}px "JetBrains Mono"`;
    spaced(ctx, sub.toUpperCase(), lx, fy + fh * 0.42 + 34 * k, 1.6 * k, 'left');
    if ($('coords').checked) spaced(ctx, coordText(state.track.center), lx, fy + fh * 0.42 + 56 * k, 1 * k, 'left');
    statLine(fy + fh * 0.36, true, 'right', lx + half, half * 0.46);
    void sz;
  } else { // bold
    const sz = fitFont(ctx, title.toUpperCase(), titleW, font, 60 * k, inner);
    ctx.textAlign = 'center'; ctx.fillText(title.toUpperCase(), cx, fy + fh * 0.32);
    let y = fy + fh * 0.32 + 34 * k;
    if (sub) { ctx.fillStyle = hexA(fg, 0.6); ctx.font = `500 ${13 * k}px "JetBrains Mono"`; spaced(ctx, sub.toUpperCase(), cx, y, 1.6 * k, 'center'); }
    statLine(y + 40 * k, true);
    void sz;
  }
  ctx.fillStyle = hexA(fg, 0.45); ctx.font = `400 ${9 * k}px "Inter Tight"`; ctx.textAlign = 'center';
  ctx.fillText('Map data © OpenStreetMap contributors · Tiles: OpenFreeMap', cx, H - Math.max(m * 0.5, 14) * k - ($('frame').checked ? 8 * k : 0));
}

let raf = 0;
function draw() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const c = $('overlay'), P = $('poster'), dpr = devicePixelRatio || 1, r = P.getBoundingClientRect();
    c.width = r.width * dpr; c.height = r.height * dpr;
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    P.style.background = $('bg').value;
    if (state.track) drawOverlay(ctx, r.width);
  });
}

/* ---------------- Export ---------------- */
function setStatus(t) { $('status').textContent = t; }
async function renderPoster() {
  const { w, h } = posterMM(), dpi = +$('dpi').value;
  let outW = Math.round((w / 25.4) * dpi), outH = Math.round((h / 25.4) * dpi);
  const maxSide = 9000; if (Math.max(outW, outH) > maxSide) { const s = maxSide / Math.max(outW, outH); outW = Math.round(outW * s); outH = Math.round(outH * s); }
  const fam = $('font').value;
  await Promise.all([document.fonts.load(`800 20px "${fam}"`), document.fonts.load(`600 20px "${fam}"`), document.fonts.load(`400 20px "${fam}"`), document.fonts.load('500 20px "JetBrains Mono"'), document.fonts.load('400 20px "Inter Tight"')]);
  const lay = layout(), scale = outW / previewW, oldPR = map.getPixelRatio();
  const gl = map.painter?.context?.gl; const maxTex = gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) : 8192;
  const cw = map.getContainer().clientWidth, chh = map.getContainer().clientHeight;
  const pr = Math.min(scale, maxTex / Math.max(cw, chh));
  setStatus('Rendering map tiles at high resolution…');
  map.setPixelRatio(pr); styleRoute();
  await new Promise((res) => { const t = setTimeout(res, 15000); map.once('idle', () => { clearTimeout(t); res(); }); map.triggerRepaint(); });
  const out = document.createElement('canvas'); out.width = outW; out.height = outH;
  const ctx = out.getContext('2d');
  ctx.fillStyle = $('bg').value; ctx.fillRect(0, 0, outW, outH);
  const k = outW / U;
  ctx.drawImage(map.getCanvas(), lay.map.x * k, lay.map.y * k, lay.map.w * k, lay.map.h * k);
  map.setPixelRatio(oldPR); styleRoute();
  drawOverlay(ctx, outW);
  return { out, w, h };
}
const slug = () => ($('title').value || 'poster').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'poster';
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function doExport(kind) {
  if (!mapReady) return setStatus('Map is still loading…');
  $('png').disabled = $('pdf').disabled = true;
  try {
    const { out, w, h } = await renderPoster();
    setStatus('Encoding…');
    if (kind === 'png') {
      const blob = await new Promise((r) => out.toBlob(r, 'image/png')); download(blob, slug() + '.png');
    } else {
      const pdf = new jspdf.jsPDF({ orientation: w > h ? 'l' : 'p', unit: 'mm', format: [w, h], compress: true });
      pdf.addImage(out.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, w, h);
      download(pdf.output('blob'), slug() + '.pdf');
    }
    setStatus(`Saved ${out.width}×${out.height}px ${kind.toUpperCase()}`);
  } catch (e) { console.error(e); setStatus('Export failed: ' + e.message); }
  finally { $('png').disabled = $('pdf').disabled = false; }
}

/* ---------------- Wiring ---------------- */
function applyTrack(t, fileName) {
  state.track = t;
  $('title').value = t.name || (fileName || 'My activity').replace(/\.gpx$/i, '');
  if (t.start) $('date').value = t.start.toISOString().slice(0, 10);
  $('fileinfo').textContent = `${fileName || 'Sample'} · ${t.pts.length} pts · ${(t.dist / 1000).toFixed(1)} km`;
  if (map && map.getSource('route')) map.getSource('route').setData(routeGeo());
  sizePoster(); fitRoute(false);
}
function readFile(f) {
  const r = new FileReader();
  r.onload = () => { try { applyTrack(parseGPX(r.result), f.name); setStatus(''); } catch (e) { setStatus('Could not read GPX: ' + e.message); } };
  r.readAsText(f);
}

function buildSwatches() {
  const box = $('mapStyles');
  STYLES.forEach((s) => {
    const b = document.createElement('button'); b.className = 'swatch'; b.type = 'button';
    b.setAttribute('aria-pressed', s.id === state.styleId); b.innerHTML = `<i style="background:${s.sw}"></i><span>${s.name}</span>`;
    b.onclick = () => { state.styleId = s.id; box.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', x === b));
      if (['dark', 'fiord'].includes(s.id)) { $('bg').value = '#141414'; $('fg').value = '#f2f2f2'; }
      else if (['dark', 'fiord'].includes($('bg').dataset.last)) { $('bg').value = '#ffffff'; $('fg').value = '#111111'; }
      $('bg').dataset.last = s.id; loadStyle(); draw(); };
    box.appendChild(b);
  });
}

function init() {
  buildSwatches();
  state.track = sampleTrack();
  sizePoster(); initMap(); applyTrack(state.track, 'sample-loop.gpx');
  $('gpx').onchange = (e) => e.target.files[0] && readFile(e.target.files[0]);
  const d = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); d.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); d.classList.remove('over'); }));
  d.addEventListener('drop', (e) => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
  const relayout = ['size', 'orient', 'cw', 'ch', 'layout', 'margin', 'prof', 'profPos'];
  relayout.forEach((id) => $(id).addEventListener('input', () => { $('customRow').hidden = $('size').value !== 'custom'; sizePoster(); fitRoute(false); }));
  ['title', 'subtitle', 'date', 'dateFmt', 'font', 'fg', 'frame', 'coords', 'paceUnit', 'timeMode', 'timeOverride', 'pc', 'profLabels'].forEach((id) => $(id).addEventListener('input', draw));
  $('bg').addEventListener('input', () => { if (state.styleId === 'blank') loadStyle(); draw(); });
  ['rc', 'rw', 'rstyle', 'markers'].forEach((id) => $(id).addEventListener('input', styleRoute));
  $('labels').addEventListener('change', loadStyle);
  document.querySelectorAll('[data-stat]').forEach((c) => c.addEventListener('change', () => { state.stats[c.dataset.stat] = c.checked; draw(); }));
  $('fit').onclick = () => fitRoute(true);
  $('png').onclick = () => doExport('png'); $('pdf').onclick = () => doExport('pdf');
  addEventListener('resize', sizePoster);
  document.fonts.ready.then(draw);
}
init();
