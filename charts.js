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
  // i pasti spuntati OPPURE il fuori piano: una giornata registrata solo
  // come "ho mangiato una pizza da 900 kcal" e' una giornata registrata, e
  // `consumed()` la conta eccome. E' lo stesso criterio del punteggio di
  // nutrizione in costanze()
  // i valori veri, non le chiavi: una spunta tolta lasciava `false` dietro
  if (Object.values(d.pasti || {}).some(Boolean) || (d.extra || []).length) n++;
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
  // l'animazione parte quando la carta entra in vista, una volta sola:
  // animarne venti al caricamento farebbe scattare il telefono senza che
  // nessuna si veda davvero
  if (typeof animaCarta === 'function') setTimeout(() => animaCarta(c), 0);
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
/**
 * La media del periodo, giornata in corso compresa.
 *
 * Per un po' si e' fermata a ieri, per una ragione vera: la giornata di oggi
 * e' a meta' — i pasti non sono ancora tutti spuntati, i passi non ancora
 * tutti fatti — e infilarla nella media la tira giu' ogni mattina.
 *
 * Il prezzo pero' era piu' alto del problema: la media non corrispondeva ai
 * dati disegnati sul grafico, e su un periodo di sette giorni escluderne uno
 * cambia il numero di un settimo senza che si veda perche'. Meglio una media
 * che al mattino e' bassa ma che si puo' verificare a mano contando le barre.
 *
 * La usano sia la riga di riepilogo sia la linea disegnata sul grafico: se
 * fossero due conti diversi prima o poi direbbero due numeri diversi, ed e'
 * il tipo di incoerenza che fa perdere fiducia in tutto il resto.
 */
function mediaPeriodo(days, vals) {
  const v = vals.filter(x => x != null && !isNaN(x));
  return v.length ? avg(v) : null;
}

/**
 * Le righe di riferimento: target e media.
 * Non sono serie, sono annotazioni, e si distinguono anche senza colore —
 * tratteggio lungo il target, corto la media — perche' l'identita' non deve
 * mai stare solo nel colore.
 */
/**
 * Le righe di riferimento: target e media.
 *
 * Non sono serie, sono annotazioni, e si distinguono anche senza colore —
 * tratteggio lungo il target, corto la media — perche' l'identita' non deve
 * mai stare solo nel colore.
 *
 * Il punto difficile e' DOVE mettere le etichette. Stavano sempre a destra, e
 * a destra c'e' l'ultimo dato: sui grafici a barre finivano regolarmente sopra
 * le barre verdi. Adesso si guarda da che parte i dati sono piu' lontani da
 * quella riga e l'etichetta va li', dove c'e' aria. Sotto ci resta comunque
 * una piastrina del colore del fondo: dove i dati riempiono tutto il riquadro
 * non esiste un lato libero, e almeno la scritta si legge.
 */
function righeRiferimento(s, g, o, media, vals) {
  // le piastrine occupate, per chi disegna un'etichetta dopo di noi
  const occupate = [];
  const righe = [
    { v: o.target, col: 'var(--rif)', dash: '5 4', t: o.tTarget || 'target' },
    { v: media, col: 'var(--media)', dash: '2 4', t: 'media' }
  ].filter(r => r.v != null && r.v >= g.lo && r.v <= g.hi)
    .map(r => ({ ...r, y: g.y(r.v) }));
  if (!righe.length) return occupate;

  /** Quanto i dati di un lato stanno lontani dal valore v. */
  const distanza = (v, da, a) => {
    if (!vals || !vals.length) return 0;
    const n = vals.length;
    const q = vals.slice(Math.floor(n * da), Math.max(1, Math.ceil(n * a)))
      .filter(x => x != null && !isNaN(x));
    if (!q.length) return Infinity;          // nessun dato di qua: tutto libero
    return q.reduce((acc, x) => acc + Math.abs(x - v), 0) / q.length;
  };

  /* Quando target e media quasi coincidono — ed e' proprio il caso in cui fa
     piacere vederlo — le due etichette finiscono una sopra l'altra e si
     leggono come una parola sola. Provato: con target 2482 e media 2488
     usciva "tmegaea". Si allontanano di quel tanto che basta, sopra e sotto. */
  const vicine = righe.length === 2 && Math.abs(righe[0].y - righe[1].y) < 11;
  righe.sort((a, b) => a.y - b.y);

  for (const [n, r] of righe.entries()) {
    s.append(mk('line', { x1: g.l, x2: g.l + g.w, y1: r.y, y2: r.y,
      stroke: r.col, 'stroke-width': 1.5, 'stroke-dasharray': r.dash }));

    // il lato con piu' aria fra il dato e la riga
    const sinistra = distanza(r.v, 0, .34) > distanza(r.v, .66, 1);
    // sopra la riga di norma; con due righe attaccate, la piu' bassa va sotto
    const dy = vicine && n === 1 ? 10 : -4;
    const y = r.y + dy;
    const larg = r.t.length * 5.2 + 7;
    const x = sinistra ? g.l + 3 : g.l + g.w - 2;

    // la piastrina: il fondo della carta, non un colore nuovo
    s.append(mk('rect', { x: sinistra ? x - 3 : x - larg + 3, y: y - 8,
      width: larg, height: 11, rx: 3, fill: 'var(--paper)', opacity: .88 }));
    const t = mk('text', { x, y, 'text-anchor': sinistra ? 'start' : 'end',
      'font-size': 8.5, 'font-family': 'var(--mono)', fill: r.col });
    t.textContent = r.t;
    s.append(t);
    occupate.push({ x1: sinistra ? x - 3 : x - larg + 3,
                    x2: (sinistra ? x - 3 : x - larg + 3) + larg,
                    y1: y - 8, y2: y + 3 });
  }
  return occupate;
}

/**
 * Le etichette diritte in fondo alle serie, senza che si accavallino.
 *
 * Erano disegnate tutte all'ultimo punto della propria serie, e quando due
 * serie finiscono vicine — che e' la norma, non l'eccezione: e' proprio
 * quando le curve si toccano che si guarda il grafico — le due parole si
 * stampavano una sopra l'altra. Su "forma e fatica" uscivano tre etichette e
 * la riga della media tutte dentro venti pixel: illeggibile.
 *
 * Si risolve come si risolvono sempre queste cose: si parte dalla posizione
 * voluta, si ordina, e si spinge via chi si sovrappone tenendo un margine
 * minimo. In piu' si scansano le piastrine gia' occupate dalle righe di
 * riferimento, che sono state disegnate prima.
 */
function etichetteSerie(s, g, voci, occupate = []) {
  const ALT = 11, GAP = 1.5;
  const basso = g.t + g.h - 2, alto = g.t + 9;
  const lab = voci.map(v => ({ ...v, y: Math.min(basso, Math.max(alto, v.y)) }))
    .sort((a, b) => a.y - b.y);

  // spinta verso il basso, poi verso l'alto: due passate bastano perche' dopo
  // la prima le etichette sono gia' in ordine e distanziate almeno una volta
  for (let i = 1; i < lab.length; i++)
    if (lab[i].y - lab[i - 1].y < ALT + GAP) lab[i].y = lab[i - 1].y + ALT + GAP;
  const sfora = lab.length ? lab[lab.length - 1].y - basso : 0;
  if (sfora > 0) for (const l of lab) l.y = Math.max(alto, l.y - sfora);

  for (const l of lab) {
    const larg = l.testo.length * 5.2 + 7;
    let x = l.x;
    let box = { x1: x - larg + 3, x2: x + 3, y1: l.y - 8, y2: l.y + 3 };
    // se finisce sopra una piastrina gia' scritta, si sposta a sinistra
    const tocca = b => occupate.some(o =>
      b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);
    let giri = 0;
    while (tocca(box) && giri++ < 3) {
      x -= larg + 6;
      box = { x1: x - larg + 3, x2: x + 3, y1: l.y - 8, y2: l.y + 3 };
    }
    if (x - larg < g.l) x = l.x;               // meglio sovrapposto che fuori
    s.append(mk('rect', { x: x - larg + 3, y: l.y - 8, width: larg, height: ALT,
      rx: 3, fill: 'var(--paper)', opacity: .88 }));
    const t = mk('text', { x, y: l.y, 'text-anchor': 'end',
      'font-size': 9.5, 'font-family': 'var(--mono)', fill: l.col });
    t.textContent = l.testo;
    s.append(t);
    occupate.push(box);
  }
}


/**
 * Il riepilogo sotto ogni grafico: ultimo valore, media del periodo, target.
 * Gli stessi tre numeri che sul grafico sono la serie e le due righe.
 */
function riepilogo(o) {
  const { days, vals, dec = 0, unit = '', target = null } = o;
  const oggi = today();
  const buoni = vals.map((v, i) => ({ v, k: days[i] }))
    .filter(x => x.v != null && !isNaN(x.v));
  if (!buoni.length) return null;
  const media = mediaPeriodo(days, vals);
  const ultimo = buoni[buoni.length - 1];
  const pezzi = [
    `<span><b>${nf(ultimo.v, dec)}</b>${unit ? ' ' + esc(unit) : ''} ${
      ultimo.k === oggi ? 'oggi' : 'l\'ultimo'}</span>`
  ];
  if (media != null) pezzi.push(`<span>media ${nf(media, dec)}</span>`);
  if (target != null) {
    // il nome della riga arriva da chi disegna: "target" su una soglia da non
    // superare direbbe che ci vuoi arrivare
    const nomeT = o.tTarget || 'target';
    pezzi.push(`<span>${esc(nomeT)} ${nf(target, dec)}</span>`);
    if (media != null) {
      const d = media - target;
      pezzi.push(`<span class="${Math.abs(d) < Math.max(1, target * .04) ? 'good' : ''}">${
        d > 0 ? '+' : ''}${nf(d, dec)} ${o.tTarget ? 'dalla riga' : 'sul target'}</span>`);
    }
  }
  const r = el('div', 'riep');
  r.innerHTML = pezzi.join('');
  return r;
}

/** Legenda uniforme: un pallino e un nome. Mai due serie senza. */
function legenda(voci) {
  const l = el('div', 'leg');
  l.innerHTML = voci.map(v => `<span><i style="background:${v.col}${
    v.vuoto ? ';box-shadow:inset 0 0 0 1.5px var(--ink-3)' : ''}"></i>${esc(v.n)}</span>`).join('');
  return l;
}

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
/** Poche date, non una per barra: le etichette fitte non si leggono.
    L'ascissa deve essere la STESSA dei segni: una linea sta sul punto i, una
    barra sta al centro della sua fetta. Usare g.x per entrambi sfalsava le
    etichette dei grafici a barre di mezza barra — invisibile su novanta giorni,
    evidente su sette. */
function xLabels(g, days, barre) {
  const frag = document.createDocumentFragment();
  const n = days.length, quanti = Math.min(4, n);
  const px = i => barre ? g.xb(i) : g.x(i);
  for (let i = 0; i < quanti; i++) {
    const idx = Math.round(i * (n - 1) / Math.max(quanti - 1, 1));
    const t = mk('text', { x: px(idx), y: g.t + g.h + 12, 'text-anchor': 'middle',
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
  // la scala deve contenere anche le righe di riferimento, o la media finirebbe
  // fuori dal riquadro proprio nei periodi in cui interessa
  const media0 = mediaPeriodo(o.days, o.ma || o.vals);
  const tutti = dati.map(p => p.v).concat(o.target != null ? [o.target] : [])
    .concat(media0 != null ? [media0] : [])
    .concat(o.band ? o.band.map(b => b.lo).concat(o.band.map(b => b.hi)) : []);
  const min = Math.min(...tutti), max = Math.max(...tutti);
  const pad = (max - min || 1) * .12;
  g.scale(min - pad, max + pad);
  const s = svgEl(H);
  s.append(grid(g));

  // le righe di riferimento vanno sotto la serie: sono lo sfondo su cui si
  // legge, non qualcosa che le passa davanti
  const mediaL = mediaPeriodo(o.days, o.ma || o.vals);
  righeRiferimento(s, g, o, mediaL, o.ma || o.vals);

  if (o.band) {
    const su = o.band.map(b => `${g.x(b.i)},${g.y(b.hi)}`).join(' ');
    const giu = o.band.slice().reverse().map(b => `${g.x(b.i)},${g.y(b.lo)}`).join(' ');
    s.append(mk('polygon', { points: su + ' ' + giu, fill: 'var(--pine)', opacity: .12 }));
  }
  // Punti grezzi: contesto, non protagonisti. Quando c'e' anche la tendenza
  // li si unisce con una linea sottilissima: senza, il lettore vede puntini
  // sparsi lontani dalla curva e pensa che il grafico sia disallineato, mentre
  // sono due serie diverse - il dato del giorno e la sua media mobile.
  if (o.punti !== false) {
    if (o.ma && dati.length > 1)
      s.append(mk('path', { d: dati.map((p, j) => (j ? 'L' : 'M') + g.x(p.i) + ',' + g.y(p.v)).join(' '),
        fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1, opacity: .35,
        'stroke-linejoin': 'round' }));
    for (const p of dati)
      s.append(mk('circle', { cx: g.x(p.i), cy: g.y(p.v), r: 1.9, fill: 'var(--ink-3)' }));
  }

  const linea = o.ma ? o.ma.map((v, i) => v == null ? null : { i, v }).filter(Boolean) : dati;
  s.append(mk('path', { d: linea.map((p, j) => (j ? 'L' : 'M') + g.x(p.i) + ',' + g.y(p.v)).join(' '),
    fill: 'none', stroke: 'var(--pine)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  s.append(xLabels(g, o.days));
  c.append(s);
  // due serie sul grafico = legenda obbligatoria, altrimenti l'identita' e'
  // affidata solo al colore e la distanza fra punti e linea sembra un errore
  // la legenda c'e' sempre, anche con una serie sola: senza, la linea verde e
  // il tratteggio grigio sono due cose che il lettore deve indovinare
  {
    const voci = o.ma
      ? [{ n: o.puntiNome || 'valore del giorno', col: 'var(--ink-3)' },
         { n: o.maNome || 'media mobile a 7 giorni', col: 'var(--pine)' }]
      : [{ n: o.serieNome || 'valore registrato', col: 'var(--pine)' }];
    // non sempre la riga di riferimento e' un "target": su "quanta fatica hai
    // addosso" e' una soglia, e chiamarla target direbbe che vuoi arrivarci
    if (o.target != null) voci.push({ n: o.tTarget || 'target', col: 'var(--rif)' });
    if (media0 != null) voci.push({ n: 'media dei ' + o.days.length + ' giorni', col: 'var(--media)' });
    if (o.band) voci.push({ n: 'previsione con banda al 95%', col: 'var(--pine-soft)' });
    c.append(legenda(voci));
  }
  const rp = riepilogo({ days: o.days, vals: o.ma || o.vals, dec: o.dec,
    unit: o.unit, target: o.target, tTarget: o.tTarget });
  if (rp) c.append(rp);
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
  const mediaB = mediaPeriodo(o.days, o.vals);
  const max = Math.max(...dati, o.target || 0, mediaB || 0) * 1.1;
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
  righeRiferimento(s, g, o, mediaB, o.vals);
  s.append(xLabels(g, o.days, true));
  c.append(s);
  c.append(legenda([{ n: o.serieNome || o.titolo.toLowerCase(), col: 'var(--pine)' }]
    .concat(o.target != null ? [{ n: 'target', col: 'var(--rif)' }] : [])
    .concat(mediaB != null ? [{ n: 'media dei ' + o.days.length + ' giorni', col: 'var(--media)' }] : [])));
  const rp = riepilogo({ days: o.days, vals: o.vals, dec: o.dec, unit: o.unit,
    target: o.target });
  if (rp) c.append(rp);
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
  s.append(xLabels(g, o.days, true));
  c.append(s);
  const leg = el('div', 'leg', o.serie.map((se, j) =>
    `<span><i style="background:var(--c${j + 1})"></i>${esc(se.nome)}</span>`).join(''));
  c.append(leg);
  /* In un'area impilata l'occhio legge le proporzioni, non i valori: la media
     di ogni fascia e' il numero che poi si va comunque a cercare. */
  {
    /* Su un grafico disegnato in percentuale la media in valore assoluto da
       sola non basta — e viceversa: la quota dice **com'e' fatta** la giornata,
       il numero dice **quanto e' grande**. Due giornate con la stessa torta
       possono essere una a 180 g di carboidrati e l'altra a 320, ed e' proprio
       la cosa che questa carta non faceva vedere. */
    /* Le medie si fanno **sugli stessi giorni**, e sono quelli in cui c'e'
       qualcosa: le serie riportano `0` per i giorni vuoti, quindi mediarle su
       tutto il periodo mentre il totale si media solo sui giorni pieni dava
       tre quote che sommate facevano 70% invece di 100 — e tre medie in kcal
       piu' basse del vero di tutto il rapporto fra i due denominatori. */
    const tot = o.days.map((_, i) => o.serie.reduce((a, se) => a + (se.vals[i] || 0), 0));
    const pieni = tot.map((x, i) => x > 0 ? i : -1).filter(i => i >= 0);
    const media = vals => pieni.length
      ? pieni.reduce((a, i) => a + (vals[i] || 0), 0) / pieni.length : 0;
    const totMedia = media(tot);
    const pezzi = pieni.length ? o.serie.map(se => {
      const m = media(se.vals);
      const q = (o.pct && totMedia > 0) ? ` <em>${nf(m / totMedia * 100, 0)}%</em>` : '';
      return '<span>' + esc(se.nome) + ' <b>' + nf(m, o.dec ?? 0)
        + (o.pct ? ' kcal' : '') + '</b>' + q + '</span>';
    }) : [];
    if (pezzi.length) {
      const r = el('div', 'riep');
      r.innerHTML = '<span class="fino">media del periodo</span>' + pezzi.join('');
      c.append(r);
    }
  }
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
  const forteE = usabili.find(se => se.forte) || usabili[0];
  const mediaE = mediaPeriodo(o.days, forteE.vals);
  const tutti = usabili.flatMap(se => se.vals.filter(v => v != null))
    .concat(o.target != null ? [o.target] : []).concat(mediaE != null ? [mediaE] : []);
  const min = Math.min(...tutti), max = Math.max(...tutti);
  const pad = (max - min || 1) * .12;
  g.scale(min - pad, max + pad);
  const s = svgEl(H);
  s.append(grid(g));
  // la media della serie in evidenza: sulle altre sarebbe una riga per serie,
  // e tre righe orizzontali su un grafico a tre linee non le legge nessuno
  const occupate = righeRiferimento(s, g, o, mediaE, forteE.vals) || [];
  const etich = [];
  for (const se of usabili) {
    const p = se.vals.map((v, i) => v == null ? null : { i, v }).filter(Boolean);
    if (p.length < 2) continue;
    s.append(mk('path', { d: p.map((q, j) => (j ? 'L' : 'M') + g.x(q.i) + ',' + g.y(q.v)).join(' '),
      fill: 'none', stroke: se.forte ? 'var(--pine)' : 'var(--ink-3)',
      'stroke-width': se.forte ? 2.2 : 1.3, opacity: se.forte ? 1 : .5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    // etichetta diritta all'ultimo punto: l'identita' non e' solo colore
    const u = p[p.length - 1];
    etich.push({ testo: se.nome, x: g.x(u.i) - 2, y: g.y(u.v) - 5,
      col: se.forte ? 'var(--pine)' : 'var(--ink-3)' });
  }
  etichetteSerie(s, g, etich, occupate);
  s.append(xLabels(g, o.days));
  c.append(s);
  /* Questo grafico era l'unico senza legenda ne' riga di lettura, e in mezzo
     agli altri sembrava disallineato — perche' lo era: gli mancavano due righe
     che tutti gli altri hanno. */
  c.append(legenda(usabili.map(se => ({
    n: se.nome, col: se.forte ? 'var(--pine)' : 'var(--ink-3)' }))
    .concat(o.target != null ? [{ n: 'target', col: 'var(--rif)' }] : [])
    .concat(mediaE != null ? [{ n: 'media di ' + forteE.nome, col: 'var(--media)' }] : [])));
  const forte = forteE;
  const rp = riepilogo({ days: o.days, vals: forte.vals, dec: o.dec,
    unit: o.unit, target: o.target });
  if (rp) c.append(rp);
  const read = el('div', 'read',
    `<span class="ph">Tocca il grafico per leggere un giorno</span>`);
  c.append(read);
  tappable(s, read, g, o.days, i => usabili
    .map(se => se.vals[i] == null ? null : `<span>${esc(se.nome)} <b>${nf(se.vals[i], o.dec ?? 0)}</b></span>`)
    .filter(Boolean).join('') || '<span>niente registrato</span>');
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
    cell.onclick = () => {
      read.innerHTML = `<span>${k}</span><span><b>${o.label(k)}</b></span>`;
      if (typeof sheetGiorno === 'function' && dayScore(k) > 0) sheetGiorno(k);
    };
    grid2.append(cell);
  }
  c.append(grid2);
  /* La rampa e' la legenda del calendario. C'era gia', ma diceva "meno / piu'",
     che non dice quanto: ora dice cosa significano davvero i quattro toni. */
  const sc = el('div', 'calscale');
  sc.innerHTML = '<span>niente</span>'
    + '<i style="background:var(--wash);border:1px solid var(--rule)"></i>'
    + [1, 2, 3, 4].map(n => `<i style="background:var(--s${n})"></i>`).join('')
    + '<span>5 voci su 5</span>';
  c.append(sc);
  const read = el('div', 'read', `<span class="ph">Tocca un giorno</span>`);
  c.append(read);
  if (o.note) c.append(el('p', 'note', o.note));
  return c;
}

/**
 * Barre orizzontali. Forma giusta quando le categorie hanno nomi lunghi e sono
 * tante: in verticale le etichette andrebbero ruotate e diventerebbero
 * illeggibili. Facoltativa una fascia di riferimento sulla pista.
 */
function chartHBars(o) {
  const card2 = card(o.titolo, o.sub);
  const vals = o.righe.map(r => r.v);
  const max = Math.max(o.max || 0, ...vals, 1) * 1.06;
  const pct = v => Math.max(0, Math.min(100, v / max * 100));
  for (const r of o.righe) {
    const row = el('div', 'hb');
    const fascia = (o.min != null && o.max != null)
      ? `<b style="left:${pct(o.min)}%;width:${pct(o.max) - pct(o.min)}%"></b>` : '';
    row.innerHTML = `<span class="hb-l">${esc(r.nome)}</span>
      <span class="hb-t">${fascia}<i style="width:${pct(r.v).toFixed(1)}%"></i></span>
      <span class="hb-v mono">${nf(r.v, 1)}</span>`;
    if (r.stato === 'fermo') row.classList.add('off');
    if (r.stato === 'sopra') row.classList.add('over');
    card2.append(row);
  }
  if (o.min != null)
    card2.append(el('div', 'read',
      `<span class="ph">La fascia chiara e' il riferimento ${nf(o.min)}–${nf(o.max)} ${esc(o.unit || '')}</span>`));
  if (o.note) card2.append(el('p', 'note', o.note));
  return card2;
}

/**
 * Indicatore: una barra con sopra il segno del bersaglio.
 * Forma giusta quando il dato e' UN numero confrontato con UN riferimento —
 * un grafico a barre con una barra sola sarebbe solo un numero travestito.
 * La barra dice quanto, il segno dice dove doveva arrivare, il colore dice
 * soltanto se sei dentro o fuori: non e' un voto.
 */
function meter(o) {
  const box = el('div', 'meter');
  const max = Math.max(o.val || 0, o.tgt || 1) * 1.15;
  const pct = v => Math.max(0, Math.min(100, (v || 0) / max * 100));
  const dentro = o.val != null && o.tgt
    && Math.abs(o.val - o.tgt) <= o.tgt * (o.tolleranza ?? 0.1);
  const sotto = o.val != null && o.tgt && o.val < o.tgt;
  /* Il colore dice **dentro o fuori**, e basta: e' scritto qui sopra da
     sempre, e il codice invece usava tre colori — verde dentro, ambra sopra
     e grigio sotto. Ma il grigio in quest'app e' il colore di "non c'e'
     dato" (`--ink-3` e' anche il testo spento), quindi una media dell'acqua
     mezzo litro sotto il target si leggeva come una riga disattivata invece
     che come uno scarto. Sotto e sopra sono tutti e due "fuori"; da che parte
     lo dice la riga di testo, che c'e' gia'. */
  const classe = o.val == null ? 'vuoto' : dentro ? 'ok' : 'fuori';
  box.innerHTML = `
    <div class="mt-h"><span class="mt-l">${esc(o.lab)}</span>
      <span class="mt-v mono">${o.val == null ? '—' : nf(o.val, o.dec ?? 0)}
        <em>/ ${nf(o.tgt, o.dec ?? 0)} ${esc(o.unit || '')}</em></span></div>
    <div class="mt-t">
      <i style="width:${pct(o.val).toFixed(1)}%" class="${classe}"></i>
      <b style="left:${pct(o.tgt).toFixed(1)}%"></b>
    </div>
    <div class="mt-n">${o.val == null ? esc(o.vuoto || 'nessun dato')
      : dentro ? 'in linea col target'
      : `${sotto ? '−' : '+'}${nf(Math.abs(o.val - o.tgt), o.dec ?? 0)} ${esc(o.unit || '')} ${sotto ? 'sotto' : 'sopra'}`}</div>`;
  return box;
}

/** Le medie della settimana chiusa contro i target, pronte per gli indicatori. */
function metriche(k = today(), n = 7) {
  const giorni = windowDays(k, n);
  const cons = giorni.map(x => S.log[x] ? consumed(x) : null).filter(m => m && m.kcal > 400);
  const md = id => avg(giorni.map(x => S.log[x]?.[id]));
  const cm = id => cons.length ? avg(cons.map(m => m[id])) : null;
  return [
    { id: 'kcal', lab: 'Calorie', val: cm('kcal'), tgt: D.target.kcal, unit: 'kcal',
      vuoto: 'nessun pasto spuntato' },
    { id: 'p', lab: 'Proteine', val: cm('p'), tgt: D.target.p, unit: 'g', tolleranza: .08 },
    { id: 'c', lab: 'Carboidrati', val: cm('c'), tgt: D.target.c, unit: 'g' },
    { id: 'g', lab: 'Grassi', val: cm('g'), tgt: D.target.g, unit: 'g' },
    { id: 'fibre', lab: 'Fibre', val: cm('fibre'), tgt: D.target.fibre, unit: 'g' },
    { id: 'acqua', lab: 'Acqua', val: md('acqua'), tgt: D.target.acqua_l, unit: 'L', dec: 1 },
    { id: 'sonno', lab: 'Sonno', val: md('sonno'), tgt: D.target.sonno_h, unit: 'h', dec: 1 },
    { id: 'passi', lab: 'Passi', val: md('passi'), tgt: D.target.passi, unit: '' }
  ];
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

/**
 * Le tre icone dei riquadri d'azione del cruscotto.
 * Stesso riquadro 24x24, stesso spessore e stesso arrotondamento delle otto
 * di Gym: e' quello che le fa sembrare una famiglia invece di tre disegni
 * capitati li'.
 */
function iconaDati(id) {
  const P = {
    revisione: 'M12 21a9 9 0 1 1 9-9M12 7v5l3 2M21 12l-2.5 3.2L16 12',
    previsioni: 'M4 17.5 9.5 11l3.5 3.2L20 6.5M20 6.5h-4.8M20 6.5v4.6M4 21h16',
    pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12.5h4M10 16.5h4'
  };
  const s = mk('svg', { viewBox: '0 0 24 24', class: 'ic-g', 'aria-hidden': 'true' });
  s.append(mk('path', { d: P[id] || P.pdf, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
}

/* ============================================================== andamento
 *
 * Alla domanda "come sta andando" rispondevano tre schermate diverse: Dati con
 * venti grafici, Analisi con un motore a regole, la Revisione con un altro.
 * Si sovrapponevano davvero e non per impressione — la costanza era calcolata
 * e mostrata due volte, le otto metriche contro il target comparivano sia
 * come barre in Analisi sia come riga di riepilogo sotto ogni grafico — e
 * soprattutto obbligavano a scegliere una porta prima di sapere cosa c'era
 * dentro.
 *
 * Adesso e' una tab con tre viste, in ordine di quanto sono impegnative:
 * **Sintesi** dice cosa non torna adesso, **Grafici** fa vedere i numeri,
 * **Revisione** giudica un periodo e chiede di cambiare una cosa.
 *
 * I vecchi indirizzi restano validi: #/dati, #/analisi e #/revisione aprono
 * Andamento sulla vista giusta. Ci puntano parecchi link dentro l'app, e
 * riscriverli tutti per un cambio di navigazione e' il modo piu' sicuro di
 * romperne uno.
 */
let andTab = 'sintesi';

const AND_VISTE = [
  ['sintesi', 'Sintesi', 'Cosa non torna negli ultimi sette giorni chiusi.'],
  ['grafici', 'Grafici', 'I numeri giorno per giorno, sul periodo che scegli.'],
  ['revisione', 'Revisione', 'Il giudizio su un periodo, e la sola cosa da cambiare.']
];

/** Traduce i vecchi indirizzi nella vista giusta di Andamento. */
function rottaAndamento(name) {
  const mappa = { dati: 'grafici', analisi: 'sintesi', revisione: 'revisione' };
  if (mappa[name]) { andTab = mappa[name]; return 'andamento'; }
  return name;
}

function viewAndamento(v) {
  const barra = el('div', 'card flat');
  const seg = el('div', 'seg');
  for (const [id, lab] of AND_VISTE) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', String(andTab === id));
    b.onclick = () => { andTab = id; route(); };
    seg.append(b);
  }
  barra.append(seg);
  const d = (AND_VISTE.find(x => x[0] === andTab) || [])[2];
  if (d) barra.append(el('div', 'hint', d));
  v.append(barra);

  ({ sintesi: sezSintesi, grafici: viewDati, revisione: viewRevisione }[andTab]
    || sezSintesi)(v);
}

/* ========================================================== cruscotto */
let datiRange = 30;
/* La fine del periodo. Di suo e' oggi — un cruscotto guarda avanti — ma con
   le date scelte a mano si sposta, e con lei si sposta TUTTO: tendenza del
   peso, composizione, costanza. Muovere i grafici e lasciare i riquadri su
   "adesso" darebbe una pagina che parla di due momenti diversi. */
let datiFine = null;

/**
 * Fissa il periodo del cruscotto dai suoi due estremi.
 *
 * Lo stato resta (lunghezza, fine) perche' e' quello che serve a mezza
 * pagina — "27 su 30", la costanza, il calendario — ma l'unico modo di
 * scriverlo e' passare da qui con tutte e due le date, cosi' non si puo' piu'
 * cambiarne una e dimenticarsi l'altra.
 */
/**
 * Il periodo della scheda Andamento, scritto in un posto solo.
 *
 * Erano **due periodi diversi nella stessa scheda**: `datiRange`/`datiFine`
 * per i grafici e `revPeriodo` per la revisione. Ogni vista aveva il suo
 * selettore e il suo bottone "Scarica il resoconto in PDF", quindi si
 * sceglievano trenta giorni in Grafici, si passava a Revisione e si scaricava
 * la settimana. Da fuori sembrava che il filtro non arrivasse al PDF, e in un
 * certo senso era vero: arrivava il filtro dell'altra pagina.
 *
 * I **default** restano diversi, ed e' voluto: il cruscotto nasce su trenta
 * giorni perche' guarda un andamento, la revisione sulla settimana chiusa
 * perche' e' l'unita' su cui e' costruita e perche' l'impegno e "ho letto" si
 * agganciano li'. Ma appena si sceglie, la scelta vale per tutte e due.
 *
 * `preset` serve a non perdere una distinzione che si vede: i quattro bottoni
 * del cruscotto tengono `datiFine` a null — "finisce oggi, e segue oggi" — e
 * scrivendoci una data si accenderebbe "Date" come se le avesse messe
 * l'utente.
 */
function periodoAndamento(da, a, preset = null) {
  const s = revPeriodoSettimana();
  if (!da || !a) {                          // la settimana chiusa
    revPeriodo = null;
    datiFine = s.a; datiRange = s.n;
    return;
  }
  const [d1, d2] = da <= a ? [da, a] : [a, da];
  /* Se il tratto scelto **e'** la settimana chiusa, allora e' la settimana
     chiusa: cosi' l'impegno e "ho letto" non spariscono solo perche' ci si e'
     arrivati dal selettore delle date invece che dal bottone. */
  revPeriodo = (d1 === s.da && d2 === s.a) ? null : { da: d1, a: d2 };
  if (preset) { datiFine = null; datiRange = preset; }
  else datiIntervallo(d1, d2);
}

function datiIntervallo(d1, d2) {
  const [da, a] = d1 <= d2 ? [d1, d2] : [d2, d1];
  datiFine = a;
  datiRange = Math.max(1, Math.min(730,
    Math.round((new Date(a) - new Date(da)) / 864e5) + 1));
}

function viewDati(v) {
  const k = datiFine || today();
  const giorni = span(datiRange, k);
  const val = (kk, f) => { const d = S.log[kk]; return d ? (f(d) ?? null) : null; };

  /* --- selettore di periodo, una riga sopra i grafici --- */
  const sel = el('div', 'card flat');
  sel.append(el('div', 'eyebrow', 'Periodo'));
  const seg = el('div', 'seg wrap gg');
  for (const n of [7, 30, 90, 180]) {
    const b = el('button', null, n + ' gg');
    b.setAttribute('aria-pressed', String(!datiFine && datiRange === n));
    b.onclick = () => { periodoAndamento(span(n, today())[0], today(), n); route(); };
    seg.append(b);
  }
  const bd = el('button', null, 'Date');
  bd.setAttribute('aria-pressed', String(!!datiFine));
  bd.onclick = () => {
    // entrando si tengono le date che stai gia' guardando, uscendo si torna
    // alla stessa lunghezza che finisce oggi: in nessuno dei due versi il
    // periodo deve cambiare da solo sotto le mani
    if (datiFine) periodoAndamento(span(datiRange, today())[0], today(), datiRange);
    else periodoAndamento(giorni[0], giorni[giorni.length - 1]);
    route();
  };
  seg.append(bd);
  sel.append(seg);

  /* Le due date. Non sono un quinto preset: sono l'unico modo di guardare un
     tratto che non finisce oggi — le due settimane di ferie di marzo, il mese
     fra due visite. I preset restano perche' nove volte su dieci basta uno. */
  if (datiFine) {
    const g = el('div');
    g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px';
    const da = giorni[0], a = giorni[giorni.length - 1];
    const campo = (val, lab, onC) => {
      const f = el('div', 'field', `<label>${lab}</label>`);
      const i = el('input');
      i.type = 'date'; i.value = val; i.max = today();
      i.onchange = () => { if (i.value) { onC(i.value); route(); } };
      f.append(i); g.append(f);
    };
    /* Le due date sono i due estremi, e si scrivono SEMPRE tutti e due.
       Prima "Al giorno" toccava solo la fine e lasciava stare la lunghezza:
       spostando la fine indietro di un mese il periodo scivolava intero e
       anche la data di inizio si muoveva da sola. Dall'esterno sembrava che
       il filtro non funzionasse, ed era esattamente quello che succedeva. */
    campo(da, 'Dal giorno', x => periodoAndamento(x, a));
    campo(a, 'Al giorno', x => periodoAndamento(da, x));
    sel.append(g);
    sel.append(el('p', 'hint', `${datiRange} giorni, dal ${da} al ${a}.`
      + (a >= today() ? ' Oggi non e\' finito: le medie di giornata lo escludono.' : '')));
  }
  v.append(sel);

  /* --- riquadri di testa --- */
  const kpis = el('div', 'kpis');
  const st = streak(k);
  const registrati = giorni.filter(d => dayScore(d) > 0).length;
  const ma = trendW(k), maPrev = trendW(addDays(k, -7));
  const C = composition(k);
  const pesi = giorni.map(d => val(d, x => x.peso));

  /* Qui c'era "giorni di fila", che e' esattamente il numero della fiamma piu'
     sotto: due volte lo stesso dato a due dita di distanza. Al suo posto un
     numero che nessun altro riquadro dava — quanto hai registrato nel periodo,
     che e' la premessa perche' tutti gli altri valgano qualcosa. */
  kpis.append(tile({ k: 'Giornate registrate', v: registrati, unit: 'su ' + datiRange,
    d: registrati ? `${Math.round(registrati / datiRange * 100)}% del periodo`
                  : 'niente in questo periodo', dir: 'flat' }));
  void st;
  kpis.append(tile({ k: 'Peso di tendenza', v: ma ? nf(ma, 2) : '—', unit: 'kg',
    d: ma && maPrev ? `${ma - maPrev >= 0 ? '+' : ''}${nf(ma - maPrev, 2)} in 7 giorni` : 'servono piu\' pesate',
    dir: !ma || !maPrev ? 'flat' : Math.abs(ma - maPrev) < .35 ? 'flat' : (ma > maPrev ? 'up' : 'dn'),
    spark: pesi }));

  const cons = giorni.map(d => S.log[d] ? consumed(d) : null);
  // giornata in corso compresa, come tutte le altre medie: cosi' il numero
  // qui e le barre del grafico piu' sotto raccontano lo stesso periodo
  const kcalOk = giorni
    .map(d => S.log[d] ? consumed(d) : null)
    .map(m => m && m.kcal > 400 ? m.kcal : null).filter(Boolean);
  kpis.append(tile({ k: 'Calorie medie', v: kcalOk.length ? nf(avg(kcalOk)) : '—', unit: 'kcal',
    d: kcalOk.length ? `target ${nf(D.target.kcal)} · ${kcalOk.length} giorni` : 'nessun pasto spuntato',
    dir: 'flat', spark: cons.map(m => m && m.kcal > 400 ? m.kcal : null) }));

  const brucia = giorni.map(d => typeof kcalAllenamento === 'function'
    ? kcalAllenamento(d) : { tot: 0, righe: [] });
  const gAll = giorni.filter((d, i) => brucia[i].tot > 0).length;
  kpis.append(tile({ k: 'Allenamenti', v: gAll, unit: 'nel periodo',
    d: gAll ? `${nf(gAll / datiRange * 7, 1)} a settimana` : 'nessuno registrato',
    dir: 'flat', spark: brucia.map(b => b.tot || null) }));

  const vita = lastMeas('vita');
  kpis.append(tile({ k: 'Vita', v: vita != null ? nf(vita, 1) : '—', unit: 'cm',
    d: vita == null ? 'mai misurata'
      : D.target_fisico?.misure?.vita
        ? `${nf(Math.abs(vita - D.target_fisico.misure.vita), 1)} cm dal target`
        : 'nessun riferimento scelto', dir: 'flat' }));
  v.append(kpis);

  /* --- le due schermate che nascono da questi numeri ---
     Erano due bottoni larghi identici a tutti gli altri bottoni dell'app, e
     nessuno li leggeva come "vai in un'altra schermata". Ora sono due righe di
     navigazione: titolo, una riga che dice cosa ci trovi, e la freccia. */
  const nav = el('div', 'card');
  nav.append(el('div', 'eyebrow', 'Da questi numeri'));
  nav.append(el('div', 'muted',
    'Le due cose che i grafici qui sopra non fanno: guardare avanti, e uscire '
    + 'dall\'app. Il giudizio sul periodo sta nella vista <strong>Revisione</strong>, '
    + 'qui sopra.'));

  /* Erano due righe di testo con una freccetta, indistinguibili da un
     paragrafo: si leggevano e non si toccavano. Ora sono riquadri con l'icona
     e, soprattutto, con lo STATO — quante cose non hanno funzionato, dove
     porta il ritmo, quanti giorni copre il file. Un bottone che dice gia' cosa
     troverai dentro e' l'unica differenza fra una voce di menu e
     un'informazione. */
  const gAz = el('div', 'act-grid');
  const azione = (ic, t, stato, fn) => {
    const b = el('button', 'act-t');
    b.append(iconaDati(ic));
    const body = el('span', 'body');
    body.append(el('span', 't', esc(t)));
    body.append(el('span', 's', stato));
    b.append(body);
    b.onclick = fn;
    gAz.append(b);
  };

  // la revisione non e' piu' un altrove: e' la vista qui accanto
  let statoPrev = 'servono tre misure su due settimane';
  try {
    const pm = typeof proiezioneMisura === 'function' ? proiezioneMisura('vita') : null;
    if (pm && pm.ok)
      statoPrev = `vita ${nf(pm.ora, 1)} → ${nf(pm.fra, 1)} cm (±${nf(pm.banda, 1)})`
        + ` fra ${pm.orizzonte} giorni`;
  } catch { /* idem */ }
  azione('previsioni', 'Dove stai andando', statoPrev,
    () => { apri('#/previsioni'); });

  if (typeof scaricaResoconto === 'function')
    azione('pdf', 'Il resoconto in PDF',
      // il periodo scritto sul bottone, come su quello della revisione: sono
      // due porte allo stesso documento, e quale tratto ne esce non deve
      // essere una sorpresa
      `${datiRange} giorni · ${revEtichetta({ da: giorni[0], a: giorni[giorni.length - 1] })}`,
      () => scaricaResoconto(revPeriodoDate(giorni[0], giorni[giorni.length - 1])));

  nav.append(gAz);
  v.append(nav);
  if (typeof osserva === 'function')
    osserva(gAz, () => entrata([...gAz.children], { passo: 60, su: 8 }));

  /* --- costanza a punteggio --- */

  /* --- calendario --- */
  v.append(chartCal({
    // si chiamava anche questa "Costanza", come la carta degli anelli due dita
    // piu' su: due titoli identici che dicono cose diverse
    titolo: 'Il registro, giorno per giorno',
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
  /* Carboidrati e grassi hanno il loro grafico, non solo la fetta nello
     stack: la ripartizione dice come sono divise le calorie di quel giorno,
     ma non quanti grammi sono — e due giorni con la stessa torta possono
     essere uno a 180 g di carboidrati e l'altro a 320. */
  v.append(chartBars({
    titolo: 'Carboidrati', sub: 'Il carburante del lavoro pesante: si vede sulle ultime ripetizioni prima che sulla bilancia.',
    days: giorni, vals: cons.map(m => m && m.kcal > 400 ? m.c : null),
    target: D.target.c, unit: 'g', dec: 0
  }));
  const pav = typeof pavimentoGrassi === 'function' ? pavimentoGrassi(k) : null;
  v.append(chartBars({
    titolo: 'Grassi', sub: 'Non solo calorie: sono il substrato degli ormoni e il veicolo delle vitamine liposolubili.',
    days: giorni, vals: cons.map(m => m && m.kcal > 400 ? m.g : null),
    target: D.target.g, unit: 'g', dec: 0,
    note: pav ? `Sotto i ${pav} g al giorno — 0,6 g per kg del tuo peso — la questione smette `
      + 'di essere il bilancio calorico. E\' una soglia di letteratura, non una misura su di te.' : null
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

  /* --- spesa energetica dell'allenamento --- */
  const tipi = ['Pesi', 'HYROX', 'Gara'];
  const perTipo = tipi.map(t => ({
    nome: t, vals: brucia.map(b => (b.righe.find(r => r.tipo === t) || {}).kcal || 0)
  }));
  v.append(chartStack({
    titolo: 'Calorie bruciate', sub: 'Stima della spesa di ogni seduta, palestra e HYROX insieme.',
    days: giorni, unit: 'kcal', serie: perTipo,
    msg: 'Registra una seduta in Gym o segna un allenamento in HYROX e qui comparira\' il carico di lavoro.',
    note: '<strong>Da non sommare al target.</strong> Il dispendio stimato dal motore nasce dal bilancio fra quanto mangi e come cambia il peso, quindi contiene gia\' tutto quello che ti muovi, allenamenti compresi. Sommare anche questo numero significherebbe contare due volte lo stesso lavoro. Serve a vedere il carico nel tempo e le settimane vuote, non a mangiare di piu\'.'
  }));

  const minuti = giorni.map((d, i) => brucia[i].righe.reduce((x, r) => x + r.min, 0) || null);
  v.append(chartBars({
    titolo: 'Minuti di allenamento', sub: 'Durata dichiarata dove c\'e\', stimata dalle serie dove manca.',
    days: giorni, vals: minuti, unit: 'min',
    msg: 'Nessun allenamento nel periodo.'
  }));

  /* introito contro dispendio: un asse solo, stessa unita' */
  const E0 = energyModel(k);
  v.append(chartBars({
    titolo: 'Introito contro dispendio', sub: 'Barre: quanto hai mangiato. Riga: il dispendio che il motore stima adesso.',
    days: giorni, vals: cons.map(m => m && m.kcal > 400 ? m.kcal : null),
    target: E0.tdee, unit: 'kcal',
    msg: 'Spunta i pasti per vedere il confronto.',
    note: `Sopra la riga sei in surplus, sotto in deficit. La riga vale ${nf(E0.tdee)} kcal ${E0.n ? `e si e' ricalibrata ${E0.n} volte sui tuoi dati` : 'e viene ancora dalla formula'}: si muove col tempo, quindi il confronto va letto su settimane, non su un giorno.`
  }));

  /* --- come stai --- */
  v.append(chartEmphasis({
    titolo: 'Fame ed energia',
    // il diario chiede da 1 a 10, non da 1 a 5: la scritta diceva un'altra cosa
    sub: 'Da 1 a 10, come le hai dichiarate nel diario. Se la fame sale mentre l\'energia scende, il deficit e\' troppo aggressivo.',
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
  /* Dove c'e' una bioimpedenza vince lei: il giorno in cui e' stata fatta e'
     l'unico in cui questo grafico ha una misura invece di una stima, e
     coprirla con la formula butterebbe via il dato migliore della serie. */
  const comp = giorni.map(d => {
    const w = weightMA(d);
    if (w == null) return null;
    const misurata = S.log[d]?.bia?.bf;
    let bf = misurata > 0 ? misurata : null;
    if (bf == null) {
      const vv = S.log[d]?.misure?.vita, cc = S.log[d]?.misure?.collo;
      if (vv == null || cc == null) return null;
      bf = bodyFat(vv, cc, D.profilo.altezza_cm, D.profilo.sesso,
        S.log[d]?.misure?.fianchi);
    }
    if (bf == null) return null;
    return { magra: w * (1 - bf / 100), grassa: w * bf / 100 };
  });
  const quanteBia = giorni.filter(d => S.log[d]?.bia?.bf > 0).length;
  v.append(chartStack({
    titolo: 'Composizione stimata',
    sub: 'Serve peso, vita e collo nello stesso giorno. Stima da formula: ±3–4 punti.'
      + (quanteBia ? ` Nei ${quanteBia === 1 ? 'giorno' : quanteBia + ' giorni'} in cui hai fatto una bioimpedenza vale quella, che e' una misura.` : ''),
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

  if (typeof cardTraguardi === 'function') { const tg = cardTraguardi(); if (tg) v.append(tg); }

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come leggerli</div>
     <div class="muted">Nessuno di questi grafici va letto su un giorno solo. La
     linea di tendenza e le medie del periodo dicono qualcosa; il singolo punto
     quasi mai. Se un grafico e\' vuoto non e\' rotto: mancano i dati, e finche\'
     mancano l\'app preferisce non inventarli.</div>`));
}
