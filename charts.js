/* Grafici e cruscotto.
   Nessuna libreria: SVG costruito a mano, cosi' l'app resta senza build step.
   La tavolozza sta in viz.css ed e' stata validata, non scelta a occhio. */
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const VW = 320;                                  // larghezza del viewBox

function mk(tag, a) {
  const e = document.createElementNS(NS, tag);
  for (const k in a) if (a[k] != null) e.setAttribute(k, a[k]);
  return e;
}
function svgEl(h) {
  const s = mk('svg', { viewBox: `0 0 ${VW} ${h}`, role: 'img' });
  return s;
}

/* ------------------------------------------------------------- dati */
/** Le ultime n date, dalla piu' vecchia alla piu' recente. */
function span(n, k = today()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(k, -i));
  return out;
}
/** Quanto e' completa la giornata: 0 = niente, 1 = tutto il nucleo. */
function dayScore(k) {
  const d = S.log[k];
  if (!d) return 0;
  let n = 0;
  if (d.peso != null) n++;
  if (Object.keys(d.pasti || {}).length) n++;
  if (d.acqua != null) n++;
  if (d.passi != null) n++;
  if (d.sonno != null) n++;
  return n / 5;
}
/** Giorni consecutivi con almeno qualcosa registrato, a ritroso da oggi. */
function streak(k = today()) {
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const d = addDays(k, -i);
    if (dayScore(d) > 0) n++;
    else if (i > 0) break;            // oggi puo' essere ancora vuoto
  }
  return n;
}

/* --------------------------------------------------------- primitivi */
function card(titolo, sub) {
  const c = el('div', 'cw');
  c.append(el('h3', null, esc(titolo)));
  if (sub) c.append(el('div', 'sub', sub));
  return c;
}
function vuoto(titolo, sub, msg) {
  const c = card(titolo, sub);
  c.append(el('p', 'note', msg));
  return c;
}

/**
 * Valori di scala "tondi" (1, 2, 5 x potenza di dieci). Dividere l'intervallo
 * in parti uguali produce etichette come 0,82 e 1,65 che arrotondate danno due
 * volte "2": numeri diversi con la stessa etichetta, che e' peggio di nessuna
 * etichetta.
 */
function niceTicks(lo, hi, n = 4) {
  const grezzo = (hi - lo) / n;
  if (!(grezzo > 0)) return [lo];
  const mag = Math.pow(10, Math.floor(Math.log10(grezzo)));
  const norm = grezzo / mag;
  const passo = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / passo) * passo; v <= hi + passo * 1e-6; v += passo)
    out.push(+v.toFixed(8));
  return out.length ? out : [lo];
}

/** Griglia orizzontale + etichette dell'asse. Un asse solo, mai due.
    L'unita' non sta sull'asse: appesa all'etichetta piu' alta sborderebbe
    fuori dal riquadro. Sta nel sottotitolo e nella riga di lettura. */
function grid(g) {
  const frag = document.createDocumentFragment();
  const ticks = niceTicks(g.lo, g.hi);
  const passo = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const dec = passo >= 1 ? 0 : passo >= 0.1 ? 1 : 2;
  for (const val of ticks) {
    const y = g.y(val);
    frag.append(mk('line', { x1: g.l, x2: g.l + g.w, y1: y, y2: y,
      stroke: 'var(--grid)', 'stroke-width': 1 }));
    const t = mk('text', { x: g.l - 5, y: y + 3.4, 'text-anchor': 'end',
      fill: 'var(--ink-3)', 'font-size': 9, 'font-family': 'var(--mono)' });
    t.textContent = nf(val, dec);
    frag.append(t);
  }
  return frag;
}
/** Poche date, non una per barra: le etichette fitte non si leggono. */
function xLabels(g, days) {
  const frag = document.createDocumentFragment();
  const n = days.length, quanti = Math.min(4, n);
  for (let i = 0; i < quanti; i++) {
    const idx = Math.round(i * (n - 1) / Math.max(quanti - 1, 1));
    const t = mk('text', { x: g.x(idx), y: g.t + g.h + 12, 'text-anchor': 'middle',
      fill: 'var(--ink-3)', 'font-size': 9, 'font-family': 'var(--mono)' });
    t.textContent = days[idx].slice(8) + '/' + days[idx].slice(5, 7);
    frag.append(t);
  }
  return frag;
}

/** Geometria del riquadro di disegno. */
function geo(h, left = 36) {
  const t = 8, b = 22, l = left, r = 6;
  const g = { t, b, l, r, w: VW - l - r, h: h - t - b, lo: 0, hi: 1 };
  g.scale = (lo, hi) => { g.lo = lo; g.hi = hi || lo + 1; return g; };
  g.y = v => g.t + (1 - (v - g.lo) / (g.hi - g.lo || 1)) * g.h;
  g.x = i => g.l + (g.n > 1 ? i / (g.n - 1) : 0.5) * g.w;
  g.xb = i => g.l + (i + 0.5) * (g.w / g.n);      // centro della barra i
  return g;
}

/**
 * Lettura al tocco. Su un telefono non esiste il passaggio del mouse, quindi
 * il tooltip diventa una riga sotto il grafico che si aggiorna trascinando.
 */
function tappable(svg, read, g, days, fmt, barre) {
  const cross = mk('line', { y1: g.t, y2: g.t + g.h, stroke: 'var(--ink-3)',
    'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
  svg.append(cross);
  const hit = mk('rect', { x: g.l, y: g.t, width: g.w, height: g.h,
    fill: 'transparent', style: 'touch-action:pan-y' });
  svg.append(hit);
  const mostra = e => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * VW;
    const t = (px - g.l) / g.w;
    let i = barre ? Math.floor(t * g.n) : Math.round(t * (g.n - 1));
    i = Math.max(0, Math.min(g.n - 1, i));
    const x = barre ? g.xb(i) : g.x(i);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x);
    cross.setAttribute('opacity', .8);
    read.innerHTML = fmt(i);
  };
  hit.addEventListener('pointerdown', mostra);
  hit.addEventListener('pointermove', e => { if (e.pressure > 0 || e.buttons) mostra(e); });
  return svg;
}

/* ------------------------------------------------------------ grafici */
/** Serie temporale: punti grezzi in grigio, tendenza in accento. */
function chartLine(o) {
  const pts = o.days.map((k, i) => ({ k, i, v: o.vals[i] }));
  const dati = pts.filter(p => p.v != null);
  if (dati.length < 2)
    return vuoto(o.titolo, o.sub, 'Servono almeno due rilevazioni.');
  const c = card(o.titolo, o.sub);
  const H = o.h || 140, g = geo(H); g.n = o.days.length;
  const tutti = dati.map(p => p.v).concat(o.target != null ? [o.target] : [])
    .concat(o.band ? o.band.map(b => b.lo).concat(o.band.map(b => b.hi)) : []);
  const min = Math.min(...tutti), max = Math.max(...tutti);
  const pad = (max - min || 1) * .12;
  g.scale(min - pad, max + pad);
  const s = svgEl(H);
  s.append(grid(g));

  if (o.target != null)
    s.append(mk('line', { x1: g.l, x2: g.l + g.w, y1: g.y(o.target), y2: g.y(o.target),
      stroke: 'var(--ink-3)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));

  if (o.band) {
    const su = o.band.map(b => `${g.x(b.i)},${g.y(b.hi)}`).join(' ');
    const giu = o.band.slice().reverse().map(b => `${g.x(b.i)},${g.y(b.lo)}`).join(' ');
    s.append(mk('polygon', { points: su + ' ' + giu, fill: 'var(--pine)', opacity: .12 }));
  }
  // punti grezzi: contesto, non protagonisti
  if (o.punti !== false)
    for (const p of dati)
      s.append(mk('circle', { cx: g.x(p.i), cy: g.y(p.v), r: 1.9, fill: 'var(--ink-3)' }));

  const linea = o.ma ? o.ma.map((v, i) => v == null ? null : { i, v }).filter(Boolean) : dati;
  s.append(mk('path', { d: linea.map((p, j) => (j ? 'L' : 'M') + g.x(p.i) + ',' + g.y(p.v)).join(' '),
    fill: 'none', stroke: 'var(--pine)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  s.append(xLabels(g, o.days));
  c.append(s);
  const read = el('div', 'read', `<span class="ph">Tocca il grafico per leggere un giorno</span>`);
  c.append(read);
  tappable(s, read, g, o.days, i => {
    const v = o.vals[i];
    return `<span>${o.days[i].slice(8)}/${o.days[i].slice(5, 7)}</span>`
      + `<span><b>${v == null ? '—' : nf(v, o.dec ?? 0) + (o.unit ? ' ' + o.unit : '')}</b></span>`
      + (o.ma && o.ma[i] != null ? `<span>tendenza ${nf(o.ma[i], o.dec ?? 1)}</span>` : '');
  });
  if (o.note) c.append(el('p', 'note', o.note));
  return c;
}

/** Barre giornaliere con linea di riferimento. */
function chartBars(o) {
  const dati = o.vals.filter(v => v != null);
  if (!dati.length) return vuoto(o.titolo, o.sub, o.msg || 'Nessun dato ancora.');
  const c = card(o.titolo, o.sub);
  const H = o.h || 132, g = geo(H); g.n = o.days.length;
  const max = Math.max(...dati, o.target || 0) * 1.1;
  g.scale(0, max || 1);
  const s = svgEl(H);
  s.append(grid(g));
  const bw = Math.max(2, g.w / g.n - 2);          // 2px di respiro fra le barre
  o.vals.forEach((v, i) => {
    if (v == null) return;
    const y = g.y(v), hgt = Math.max(1.5, g.y(0) - y);
    s.append(mk('rect', { x: g.xb(i) - bw / 2, y, width: bw, height: hgt, rx: 2,
      fill: o.colore || 'var(--pine)',
      opacity: o.target && v < o.target * .8 ? .45 : 1 }));
  });
  if (o.target != null)
    s.append(mk('line', { x1: g.l, x2: g.l + g.w, y1: g.y(o.target), y2: g.y(o.target),
      stroke: 'var(--ink-2)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
  s.append(xLabels(g, o.days));
  c.append(s);
  const read = el('div', 'read', `<span class="ph">Tocca una barra</span>`);
  c.append(read);
  tappable(s, read, g, o.days, i => {
    const v = o.vals[i];
    return `<span>${o.days[i].slice(8)}/${o.days[i].slice(5, 7)}</span>`
      + `<span><b>${v == null ? 'non registrato' : nf(v, o.dec ?? 0) + (o.unit ? ' ' + o.unit : '')}</b></span>`
      + (o.target != null && v != null
        ? `<span>${v >= o.target ? '+' : ''}${nf(v - o.target, o.dec ?? 0)} sul target</span>` : '');
  }, true);
  if (o.note) c.append(el('p', 'note', o.note));
  return c;
}

/** Barre impilate: parte sul tutto. Massimo tre serie, con legenda. */
function chartStack(o) {
  const somma = o.days.map((_, i) => o.serie.reduce((a, s) => a + (s.vals[i] || 0), 0));
  if (!somma.some(v => v > 0)) return vuoto(o.titolo, o.sub, o.msg || 'Nessun dato ancora.');
  const c = card(o.titolo, o.sub);
  const H = o.h || 132, g = geo(H); g.n = o.days.length;
  g.scale(0, o.pct ? 100 : Math.max(...somma) * 1.05);
  const s = svgEl(H);
  s.append(grid(g));
  const bw = Math.max(2, g.w / g.n - 2);
  o.days.forEach((_, i) => {
    if (!somma[i]) return;
    let acc = 0;
    o.serie.forEach((se, j) => {
      let v = se.vals[i] || 0;
      if (o.pct) v = v / somma[i] * 100;
      if (v <= 0) return;
      const y0 = g.y(acc), y1 = g.y(acc + v);
      // 2px di superficie fra i segmenti: senza, i colori si toccano
      s.append(mk('rect', { x: g.xb(i) - bw / 2, y: y1, width: bw,
        height: Math.max(1, y0 - y1 - 1.5), rx: 1.5, fill: `var(--c${j + 1})` }));
      acc += v;
    });
  });
  s.append(xLabels(g, o.days));
  c.append(s);
  const leg = el('div', 'leg', o.serie.map((se, j) =>
    `<span><i style="background:var(--c${j + 1})"></i>${esc(se.nome)}</span>`).join(''));
  c.append(leg);
  const read = el('div', 'read', `<span class="ph">Tocca una barra</span>`);
  c.append(read);
  tappable(s, read, g, o.days, i =>
    `<span>${o.days[i].slice(8)}/${o.days[i].slice(5, 7)}</span>` +
    o.serie.map((se, j) => {
      const v = se.vals[i] || 0;
      const q = o.pct && somma[i] ? (v / somma[i] * 100) : v;
      return `<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--c${j + 1})"></i> ${esc(se.nome)} <b>${nf(q, 0)}${o.pct ? '%' : ''}</b></span>`;
    }).join(''), true);
  if (o.note) c.append(el('p', 'note', o.note));
  return c;
}

/** Piu' linee con una sola in evidenza: le altre fanno da contesto. */
function chartEmphasis(o) {
  const usabili = o.serie.filter(se => se.vals.some(v => v != null));
  if (!usabili.length) return vuoto(o.titolo, o.sub, 'Nessuna misura registrata.');
  const c = card(o.titolo, o.sub);
  const H = o.h || 140, g = geo(H); g.n = o.days.length;
  const tutti = usabili.flatMap(se => se.vals.filter(v => v != null));
  const min = Math.min(...tutti), max = Math.max(...tutti);
  const pad = (max - min || 1) * .12;
  g.scale(min - pad, max + pad);
  const s = svgEl(H);
  s.append(grid(g));
  for (const se of usabili) {
    const p = se.vals.map((v, i) => v == null ? null : { i, v }).filter(Boolean);
    if (p.length < 2) continue;
    s.append(mk('path', { d: p.map((q, j) => (j ? 'L' : 'M') + g.x(q.i) + ',' + g.y(q.v)).join(' '),
      fill: 'none', stroke: se.forte ? 'var(--pine)' : 'var(--ink-3)',
      'stroke-width': se.forte ? 2.2 : 1.3, opacity: se.forte ? 1 : .5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    // etichetta diritta all'ultimo punto: l'identita' non e' solo colore
    const u = p[p.length - 1];
    const t = mk('text', { x: g.x(u.i) - 2, y: g.y(u.v) - 5, 'text-anchor': 'end',
      'font-size': 9.5, 'font-family': 'var(--mono)',
      fill: se.forte ? 'var(--pine)' : 'var(--ink-3)' });
    t.textContent = se.nome;
    s.append(t);
  }
  s.append(xLabels(g, o.days));
  c.append(s);
  if (o.note) c.append(el('p', 'note', o.note));
  return c;
}

/** Calendario a intensita': quanto e' stata completa ogni giornata. */
function chartCal(o) {
  const c = card(o.titolo, o.sub);
  const giorni = o.days;
  // allinea al lunedi'
  const pre = dayIdx(giorni[0]);
  c.append(el('div', 'caldays', ['L', 'M', 'M', 'G', 'V', 'S', 'D']
    .map(d => `<span>${d}</span>`).join('')));
  const grid2 = el('div', 'cal');
  // append() restituisce undefined, non il nodo: le celle di riempimento
  // vanno create e nascoste prima di aggiungerle
  for (let i = 0; i < pre; i++) {
    const vuota = el('i');
    vuota.style.visibility = 'hidden';
    grid2.append(vuota);
  }
  const oggi = today();
  for (const k of giorni) {
    const sc = o.level(k);
    const cell = el('i');
    if (sc > 0) cell.dataset.l = Math.max(1, Math.ceil(sc * 4));
    if (k === oggi) cell.dataset.today = '1';
    cell.title = k + ' — ' + o.label(k);
    cell.onclick = () => { read.innerHTML = `<span>${k}</span><span><b>${o.label(k)}</b></span>`; };
    grid2.append(cell);
  }
  c.append(grid2);
  c.append(el('div', 'calscale',
    `<span>meno</span><i style="background:var(--wash);border:1px solid var(--rule)"></i>`
    + [1, 2, 3, 4].map(n => `<i style="background:var(--s${n})"></i>`).join('')
    + `<span>piu'</span>`));
  const read = el('div', 'read', `<span class="ph">Tocca un giorno</span>`);
  c.append(read);
  if (o.note) c.append(el('p', 'note', o.note));
  return c;
}

/** Riquadro statistico: quando il dato e' un numero solo, il numero E' il grafico. */
function tile(o) {
  const t = el('div', 'tile');
  t.append(el('div', 'k', esc(o.k)));
  t.append(el('div', 'v', `${o.v}${o.unit ? `<em>${esc(o.unit)}</em>` : ''}`));
  if (o.d) t.append(el('div', 'd ' + (o.dir || 'flat'), o.d));
  if (o.spark && o.spark.filter(x => x != null).length > 2) {
    const p = o.spark.map((v, i) => v == null ? null : { i, v }).filter(Boolean);
    const lo = Math.min(...p.map(q => q.v)), hi = Math.max(...p.map(q => q.v));
    const W = 100, H = 22;
    const x = i => (i / Math.max(o.spark.length - 1, 1)) * W;
    const y = v => 3 + (1 - (v - lo) / (hi - lo || 1)) * (H - 6);
    const s = mk('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
    s.append(mk('path', { d: p.map((q, j) => (j ? 'L' : 'M') + x(q.i) + ',' + y(q.v)).join(' '),
      fill: 'none', stroke: 'var(--pine)', 'stroke-width': 1.6,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke' }));
    t.append(s);
  }
  return t;
}

/* ========================================================== cruscotto */
let datiRange = 30;

function viewDati(v) {
  const k = today();
  const giorni = span(datiRange, k);
  const val = (kk, f) => { const d = S.log[kk]; return d ? (f(d) ?? null) : null; };

  /* --- selettore di periodo, una riga sopra i grafici --- */
  const sel = el('div', 'card flat');
  sel.append(el('div', 'eyebrow', 'Periodo'));
  const seg = el('div', 'seg');
  for (const n of [7, 30, 90, 180]) {
    const b = el('button', null, n + ' gg');
    b.setAttribute('aria-pressed', datiRange === n);
    b.onclick = () => { datiRange = n; route(); };
    seg.append(b);
  }
  sel.append(seg); v.append(sel);

  /* --- riquadri di testa --- */
  const kpis = el('div', 'kpis');
  const st = streak(k);
  const registrati = giorni.filter(d => dayScore(d) > 0).length;
  const ma = trendW(k), maPrev = trendW(addDays(k, -7));
  const C = composition(k);
  const pesi = giorni.map(d => val(d, x => x.peso));

  kpis.append(tile({ k: 'Giorni di fila', v: st, unit: st === 1 ? 'giorno' : 'giorni',
    d: `${registrati} su ${datiRange} nel periodo`, dir: 'flat' }));
  kpis.append(tile({ k: 'Peso di tendenza', v: ma ? nf(ma, 2) : '—', unit: 'kg',
    d: ma && maPrev ? `${ma - maPrev >= 0 ? '+' : ''}${nf(ma - maPrev, 2)} in 7 giorni` : 'servono piu\' pesate',
    dir: !ma || !maPrev ? 'flat' : Math.abs(ma - maPrev) < .35 ? 'flat' : (ma > maPrev ? 'up' : 'dn'),
    spark: pesi }));

  const cons = giorni.map(d => S.log[d] ? consumed(d) : null);
  // i grafici mostrano anche oggi, ma la MEDIA no: la giornata in corso non e'
  // finita e tirerebbe giu' il numero ogni mattina
  const kcalOk = giorni.filter(d => d < today())
    .map(d => S.log[d] ? consumed(d) : null)
    .map(m => m && m.kcal > 400 ? m.kcal : null).filter(Boolean);
  kpis.append(tile({ k: 'Calorie medie', v: kcalOk.length ? nf(avg(kcalOk)) : '—', unit: 'kcal',
    d: kcalOk.length ? `target ${nf(D.target.kcal)} · fino a ieri` : 'nessun pasto spuntato',
    dir: 'flat', spark: cons.map(m => m && m.kcal > 400 ? m.kcal : null) }));

  const vita = lastMeas('vita');
  kpis.append(tile({ k: 'Vita', v: vita != null ? nf(vita, 1) : '—', unit: 'cm',
    d: vita != null ? `${nf(Math.abs(vita - D.target_fisico.misure.vita), 1)} cm dal target`
                    : 'mai misurata', dir: 'flat' }));
  v.append(kpis);

  /* --- calendario --- */
  v.append(chartCal({
    titolo: 'Costanza',
    sub: 'Quanto e\' completa ogni giornata: peso, pasti spuntati, acqua, passi, sonno.',
    days: span(Math.min(datiRange, 182), k),
    level: dayScore,
    label: d => {
      const sc = dayScore(d);
      if (!sc) return 'niente registrato';
      return Math.round(sc * 5) + ' voci su 5';
    },
    note: 'La costanza del registro conta piu\' della singola giornata perfetta: il motore di previsione diventa preciso solo con una serie continua.'
  }));

  /* --- peso --- */
  const maSerie = giorni.map(d => weightMA(d));
  const f28 = forecast(28, D.target.kcal, k);
  v.append(chartLine({
    titolo: 'Peso', sub: 'Punti grigi: le pesate. Linea: la media mobile a 7 giorni, l\'unica che contiene informazione.',
    days: giorni, vals: pesi, ma: maSerie, unit: 'kg', dec: 1,
    note: f28 ? `Al ritmo attuale, fra 28 giorni la tendenza sarebbe ${nf(f28.peso, 2)} kg (±${nf(f28.banda, 2)}).` : null
  }));

  /* --- calorie e proteine --- */
  v.append(chartBars({
    titolo: 'Calorie', sub: 'Dai pasti effettivamente spuntati, non da quelli previsti.',
    days: giorni, vals: cons.map(m => m && m.kcal > 400 ? m.kcal : null),
    target: D.target.kcal, unit: 'kcal',
    msg: 'Spunta i pasti nella scheda Oggi e qui comparira\' l\'andamento.',
    note: 'La riga tratteggiata e\' il target. Le barre piu\' chiare sono giornate sotto l\'80%.'
  }));
  v.append(chartBars({
    titolo: 'Proteine', sub: 'La variabile che protegge la massa magra.',
    days: giorni, vals: cons.map(m => m && m.kcal > 400 ? m.p : null),
    target: D.target.p, unit: 'g', dec: 0
  }));

  /* --- ripartizione dei macro --- */
  v.append(chartStack({
    titolo: 'Da dove vengono le calorie', sub: 'Quota di ogni macro sul totale del giorno.',
    days: giorni, pct: true, unit: '%',
    serie: [
      { nome: 'Proteine', vals: cons.map(m => m ? m.p * 4 : 0) },
      { nome: 'Carboidrati', vals: cons.map(m => m ? m.c * 4 : 0) },
      { nome: 'Grassi', vals: cons.map(m => m ? m.g * 9 : 0) }
    ],
    msg: 'Nessun pasto spuntato nel periodo.'
  }));

  /* --- fibre --- */
  v.append(chartBars({
    titolo: 'Fibre', sub: `Il piano ne prevede ${D.target.fibre} g. Salti troppo bruschi danno gonfiore.`,
    days: giorni, vals: cons.map(m => m && m.kcal > 400 ? m.fibre : null),
    target: D.target.fibre, unit: 'g'
  }));

  /* --- abitudini --- */
  v.append(chartBars({
    titolo: 'Passi', sub: 'La leva piu\' indolore per alzare il dispendio senza toccare la dieta.',
    days: giorni, vals: giorni.map(d => val(d, x => x.passi)), target: D.target.passi
  }));
  v.append(chartBars({
    titolo: 'Sonno', sub: 'Sotto le 6,5 ore calano la sintesi proteica e il controllo della fame.',
    days: giorni, vals: giorni.map(d => val(d, x => x.sonno)), target: D.target.sonno_h,
    unit: 'h', dec: 1
  }));
  v.append(chartBars({
    titolo: 'Acqua', sub: `Con ${D.target.fibre} g di fibre l'acqua non e' opzionale.`,
    days: giorni, vals: giorni.map(d => val(d, x => x.acqua)), target: D.target.acqua_l,
    unit: 'L', dec: 1
  }));
  v.append(chartBars({
    titolo: 'Coca Zero', sub: 'Non e\' un problema calorico: e\' caffeina, e l\'emivita e\' 5–6 ore.',
    days: giorni, vals: giorni.map(d => val(d, x => x.coca)), unit: 'lattine',
    colore: 'var(--ink-3)'
  }));

  /* --- come stai --- */
  v.append(chartEmphasis({
    titolo: 'Fame ed energia', sub: 'Se la fame sale mentre l\'energia scende, il deficit e\' troppo aggressivo.',
    days: giorni, dec: 0,
    serie: [
      { nome: 'energia', vals: giorni.map(d => val(d, x => x.energia)), forte: true },
      { nome: 'fame', vals: giorni.map(d => val(d, x => x.fame)) }
    ]
  }));

  /* --- misure --- */
  const misSerie = D.misure.map(m => ({
    nome: m.label.split(' ')[0].toLowerCase(),
    forte: m.id === 'vita',
    vals: giorni.map(d => S.log[d]?.misure?.[m.id] ?? null)
  })).filter(s => s.vals.some(x => x != null));
  v.append(chartEmphasis({
    titolo: 'Misure', sub: 'La vita e\' in evidenza: e\' il segnale che distingue muscolo da grasso.',
    days: giorni, unit: 'cm', dec: 0, serie: misSerie
  }));

  /* --- composizione --- */
  const comp = giorni.map(d => {
    const w = weightMA(d);
    const vv = S.log[d]?.misure?.vita, cc = S.log[d]?.misure?.collo;
    if (w == null || vv == null || cc == null) return null;
    const bf = bodyFat(vv, cc, D.profilo.altezza_cm);
    if (bf == null) return null;
    return { magra: w * (1 - bf / 100), grassa: w * bf / 100 };
  });
  v.append(chartStack({
    titolo: 'Composizione stimata', sub: 'Serve peso, vita e collo nello stesso giorno. Stima da formula: ±3–4 punti.',
    days: giorni, unit: 'kg',
    serie: [
      { nome: 'Massa magra', vals: comp.map(c => c ? c.magra : 0) },
      { nome: 'Massa grassa', vals: comp.map(c => c ? c.grassa : 0) }
    ],
    msg: 'Registra peso, vita e collo nello stesso giorno per vedere la composizione nel tempo.',
    note: 'E\' il grafico che dice se stai facendo ricomposizione: la barra totale puo\' restare ferma mentre le due parti si scambiano.'
  }));

  /* --- il motore --- */
  const E = energyModel(k);
  if (E.n > 0) {
    const gg = E.steps.map(s => s.k);
    v.append(chartLine({
      titolo: 'Dispendio stimato', sub: 'Come il motore ha corretto la sua stima man mano che arrivavano i dati.',
      days: gg, vals: E.steps.map(s => s.obs), ma: E.steps.map(s => s.mu),
      unit: 'kcal', dec: 0,
      note: `Punti: il dispendio osservato su ogni finestra. Linea: la stima del filtro, che si fida dell'osservazione solo quanto merita. Partiva da ${nf(E.prior)} kcal da formula.`
    }));
  }
  const L = ledgerScore(k);
  if (L.n >= 3) {
    const ultime = (S.model.prev || []).filter(p => p.errore != null).slice(-datiRange);
    v.append(chartBars({
      titolo: 'Errore delle previsioni', sub: 'Ogni barra e\' una previsione scaduta: quanto ha sbagliato, in kg.',
      days: ultime.map(p => p.target), vals: ultime.map(p => p.errore),
      unit: 'kg', dec: 2,
      note: `Errore medio ${nf(L.mae, 2)} kg, ${nf(L.colpiti * 100)}% dentro la banda dichiarata. Se le barre stanno tutte dallo stesso lato il modello e\' in ritardo e il filtro allarga il passo.`
    }));
  }

  /* --- integratori --- */
  const sup = D.integratori.map(s => ({
    nome: s.nome,
    n: giorni.filter(d => S.log[d]?.integratori?.[s.nome]).length
  }));
  const ci = card('Integratori', `Giorni con assunzione registrata su ${datiRange}.`);
  const tb = el('div', 'cmp');
  tb.append(el('div', 'cmp-h', '<span></span><span>Giorni</span><span>%</span><span></span>'));
  for (const s of sup) {
    const pct = Math.round(s.n / datiRange * 100);
    tb.append(el('div', 'cmp-r',
      `<span>${esc(s.nome)}</span><span class="mono">${s.n}</span>
       <span class="mono muted">${pct}%</span>
       <span class="mono ${pct >= 80 ? 'good' : ''}">${pct >= 80 ? '✓' : ''}</span>`));
  }
  ci.append(tb);
  v.append(ci);

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come leggerli</div>
     <div class="muted">Nessuno di questi grafici va letto su un giorno solo. La
     linea di tendenza e le medie del periodo dicono qualcosa; il singolo punto
     quasi mai. Se un grafico e\' vuoto non e\' rotto: mancano i dati, e finche\'
     mancano l\'app preferisce non inventarli.</div>`));
}
