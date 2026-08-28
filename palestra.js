/* Palestra: registro delle sedute, mappa muscolare, progressione, previsione.
   Il catalogo degli esercizi sta in data/palestra.json, non qui: stessa regola
   di dieta.json — il dominio e' dato, non codice. */
'use strict';

let PD = null;                                    // data/palestra.json

function P() {
  S.palestra ||= {};
  S.palestra.sessioni ||= {};
  S.palestra.esercizi ||= [];
  return S.palestra;
}
/** Catalogo = esercizi del file + quelli aggiunti dall'utente. */
function catalogo() { return (PD?.esercizi || []).concat(P().esercizi); }
function esercizio(id) { return catalogo().find(e => e.id === id) || null; }
function muscoli() { return PD?.muscoli || []; }
function muscolo(id) { return muscoli().find(m => m.id === id) || null; }

/* ==================================================================== motore */

/**
 * Massimale stimato con la formula di Epley, corretta col RIR.
 * Una serie da 8 con 2 ripetizioni in serbatoio vale quanto una da 10 a
 * cedimento: sommare il RIR alle ripetizioni e' quello che rende confrontabili
 * serie fatte con sforzo diverso. Resta una stima: sopra le 12 ripetizioni
 * Epley sovrastima, e va letta come tendenza, non come un massimale vero.
 */
function e1rm(kg, reps, rir) {
  const r = (+reps || 0) + (+rir || 0);
  if (!(kg > 0) || r <= 0) return 0;
  return kg * (1 + r / 30);
}

/** Quanto una serie stimola un muscolo: 1 se primario, 0.5 se secondario. */
function pesoMuscolare(ex, mus) {
  if (!ex) return 0;
  if ((ex.primari || []).includes(mus)) return 1;
  if ((ex.secondari || []).includes(mus)) return 0.5;
  return 0;
}
/** Le serie vicine al cedimento stimolano di piu': RIR 0 vale 1.5, RIR 3+ vale 1. */
const sforzo = rir => 1 + (3 - Math.min(Math.max(+rir || 0, 0), 3)) / 6;

/** Tutte le serie registrate in un giorno, appiattite. */
function serieDelGiorno(k) {
  const s = P().sessioni[k];
  if (!s || !Array.isArray(s.serie)) return [];
  return s.serie;
}

/** Serie pesate e tonnellaggio per muscolo su un elenco di giorni. */
function volumeMuscoli(days) {
  const out = {};
  for (const m of muscoli()) out[m.id] = { serie: 0, tonn: 0, sedute: new Set() };
  for (const k of days) {
    for (const s of serieDelGiorno(k)) {
      const ex = esercizio(s.ex); if (!ex) continue;
      for (const m of muscoli()) {
        const w = pesoMuscolare(ex, m.id); if (!w) continue;
        out[m.id].serie += w;
        out[m.id].tonn += w * (+s.kg || 0) * (+s.reps || 0);
        out[m.id].sedute.add(k);
      }
    }
  }
  for (const id in out) out[id].sedute = out[id].sedute.size;
  return out;
}

/**
 * Modello forma-fatica (Banister). Ogni seduta lascia due tracce che svaniscono
 * a velocita' diverse: la fatica in circa una settimana, la forma in sei. La
 * prontezza e' la differenza. E' il modello che risponde alla domanda "questo
 * muscolo e' ancora stanco o e' pronto?" senza doverla indovinare.
 *
 * L'impulso non e' il tonnellaggio — un leg press e un'alzata laterale non
 * sono confrontabili in chili — ma le serie pesate per il coinvolgimento del
 * muscolo e per quanto vicino al cedimento sono state portate.
 */
function formaFatica(mus, fino = today(), giorni = 120) {
  const M = PD?.modello || { tau_forma: 42, tau_fatica: 7, k_forma: 1, k_fatica: 2 };
  let forma = 0, fatica = 0;
  for (let i = giorni; i >= 0; i--) {
    const k = addDays(fino, -i);
    let imp = 0;
    for (const s of serieDelGiorno(k)) {
      const ex = esercizio(s.ex); if (!ex) continue;
      const w = pesoMuscolare(ex, mus); if (!w) continue;
      imp += w * sforzo(s.rir);
    }
    if (imp) {
      forma += imp; fatica += imp;
    }
    // decadimento di un giorno
    forma *= Math.exp(-1 / M.tau_forma);
    fatica *= Math.exp(-1 / M.tau_fatica);
  }
  return { forma, fatica, prontezza: M.k_forma * forma - M.k_fatica * fatica };
}

/** Serie storica di forma/fatica/prontezza per il grafico. */
function serieFormaFatica(mus, days) {
  return days.map(k => ({ k, ...formaFatica(mus, k, 90) }));
}

/** Stato di ogni muscolo: volume settimanale + forma/fatica. */
function statoMuscoli(k = today()) {
  const sett = windowDays(k, 7);
  const vol = volumeMuscoli(sett);
  const V = PD?.volume || { min_serie: 10, ottimale: 16, max_serie: 22 };
  // scala comune per la mappa: il massimo corrente, altrimenti i colori
  // di due muscoli non sarebbero confrontabili fra loro
  const ff = {};
  for (const m of muscoli()) ff[m.id] = formaFatica(m.id, k);
  const maxFat = Math.max(0.001, ...Object.values(ff).map(x => x.fatica));
  const maxForma = Math.max(0.001, ...Object.values(ff).map(x => x.forma));
  const out = {};
  for (const m of muscoli()) {
    const v = vol[m.id], f = ff[m.id];
    out[m.id] = {
      id: m.id, nome: m.nome, serie: v.serie, tonn: v.tonn, sedute: v.sedute,
      forma: f.forma, fatica: f.fatica, prontezza: f.prontezza,
      nFatica: f.fatica / maxFat,
      nForma: f.forma / maxForma,
      nVolume: Math.min(1, v.serie / (V.max_serie || 22)),
      stato: v.serie === 0 ? 'fermo'
           : v.serie < V.min_serie ? 'sotto'
           : v.serie > V.max_serie ? 'sopra' : 'ok',
      pronto: f.fatica < f.forma * 0.55
    };
  }
  return out;
}

/* ---------------------------------------------------- progressione e forza */
/** Tutte le serie di un esercizio, in ordine di data. */
function serieEsercizio(id) {
  const out = [];
  for (const k of Object.keys(P().sessioni).sort())
    for (const s of serieDelGiorno(k)) if (s.ex === id) out.push({ k, ...s });
  return out;
}
/** Il miglior massimale stimato di ogni seduta. */
function e1rmPerSeduta(id) {
  const per = {};
  for (const s of serieEsercizio(id)) {
    const v = e1rm(s.kg, s.reps, s.rir);
    if (v > (per[s.k] || 0)) per[s.k] = v;
  }
  return Object.keys(per).sort().map(k => ({ k, v: per[k] }));
}

/** Regressione lineare ai minimi quadrati: pendenza, intercetta, R². */
function regressione(pts) {
  const n = pts.length;
  if (n < 3) return null;
  const x = pts.map(p => p.x), y = pts.map(p => p.y);
  const mx = avg(x), my = avg(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (!sxx) return null;
  const m = sxy / sxx, q = my - m * mx;
  const r2 = syy ? (sxy * sxy) / (sxx * syy) : 0;
  const res = pts.map(p => p.y - (m * p.x + q));
  const sd = Math.sqrt(avg(res.map(r => r * r)) || 0);
  return { m, q, r2, sd, n };
}

/**
 * Previsione della forza: retta sui massimali stimati nel tempo.
 * Non e' un filtro di Kalman come per il peso, e per un buon motivo: qui le
 * osservazioni sono poche e distanti (una per seduta), non una al giorno, e il
 * segnale e' molto piu' grande del rumore. Una retta con la sua banda dice
 * quello che serve senza fingere una precisione che non c'e'.
 */
function previsioneForza(id, orizzonte = 28) {
  const serie = e1rmPerSeduta(id);
  if (serie.length < 3) return null;
  const t0 = new Date(serie[0].k);
  const pts = serie.map(s => ({ x: (new Date(s.k) - t0) / 864e5, y: s.v }));
  const R = regressione(pts);
  if (!R) return null;
  const ultimoX = pts[pts.length - 1].x;
  const fra = R.m * (ultimoX + orizzonte) + R.q;
  return {
    serie, kgSettimana: R.m * 7, r2: R.r2, sd: R.sd, n: R.n,
    ora: serie[serie.length - 1].v, fra, orizzonte,
    banda: 1.96 * R.sd * Math.sqrt(1 + 1 / R.n)
  };
}

/**
 * Doppia progressione. Si sale di carico solo quando TUTTE le serie toccano il
 * tetto del range con poco in serbatoio; finche' no, si aggiungono ripetizioni.
 * Alzare il peso prima significa solo fare meno lavoro con un numero piu' bello.
 */
function prossimoPasso(id) {
  const ex = esercizio(id); if (!ex) return null;
  const tutte = serieEsercizio(id);
  if (!tutte.length) return null;
  const ultimoGiorno = tutte[tutte.length - 1].k;
  const ultime = tutte.filter(s => s.k === ultimoGiorno);
  const [lo, hi] = ex.range || [8, 12];
  const soglia = PD?.progressione?.rir_soglia ?? 2;
  const kg = Math.max(...ultime.map(s => +s.kg || 0));
  const tutteAlTetto = ultime.every(s => (+s.reps || 0) >= hi && (+s.rir ?? 9) <= soglia);
  if (tutteAlTetto && ex.incremento > 0) {
    return { tipo: 'carico', kg: kg + ex.incremento, da: kg, reps: lo,
      testo: `Sali a ${nf(kg + ex.incremento, 1)} kg e riparti da ${lo} ripetizioni.` };
  }
  const piuBassa = ultime.reduce((a, b) => (+a.reps || 0) <= (+b.reps || 0) ? a : b);
  if ((+piuBassa.reps || 0) >= hi) {
    return { tipo: 'attesa', kg,
      testo: `Sei al tetto del range ma con RIR alto: ripeti ${nf(kg, 1)} kg cercando di arrivare piu' vicino al cedimento.` };
  }
  return { tipo: 'ripetizioni', kg, reps: (+piuBassa.reps || 0) + 1,
    testo: `Resta a ${nf(kg, 1)} kg e porta la serie piu' bassa a ${(+piuBassa.reps || 0) + 1} ripetizioni (il range e' ${lo}–${hi}).` };
}

/* ============================================================ mappa muscolare */
/**
 * Muscoli disegnati sulla stessa figura parametrica della scheda Corpo, cosi'
 * la mappa ha le proporzioni delle misure registrate. La silhouette di schiena
 * e' la stessa di fronte: e' schematica, serve a dire DOVE, non a fare
 * anatomia.
 */
function regioniMuscolari(m, vista) {
  const F = FIG, cx = F.CX, W = widths(m);
  const nw = W.collo, cw = W.torace, ww = W.vita, hw = W.fianchi;
  const tw = W.coscia, aw = W.braccio, sw = W.spalla;
  const ax = Math.max(hw * 0.52, tw + 4);
  const E = (id, x, y, rx, ry, rot) => ({ id, tag: 'ellipse', x, y, rx, ry, rot: rot || 0 });
  const R = (id, x, y, w2, h2, r) => ({ id, tag: 'rect', x: x - w2, y: y - h2,
    w: w2 * 2, h: h2 * 2, r: r || 6 });

  if (vista === 'fronte') return [
    E('trapezi', cx - nw * 1.5, F.yNeck + 7, nw * 0.85, 7, -18),
    E('trapezi', cx + nw * 1.5, F.yNeck + 7, nw * 0.85, 7, 18),
    E('spalle', cx - sw * 0.78, F.ySh + 12, sw * 0.20, 13),
    E('spalle', cx + sw * 0.78, F.ySh + 12, sw * 0.20, 13),
    E('petto', cx - cw * 0.44, F.yPit - 6, cw * 0.40, 15, -8),
    E('petto', cx + cw * 0.44, F.yPit - 6, cw * 0.40, 15, 8),
    E('bicipiti', cx - cw * 1.00, F.yPit + 28, aw * 0.70, 19),
    E('bicipiti', cx + cw * 1.00, F.yPit + 28, aw * 0.70, 19),
    E('avambracci', cx - cw * 1.10, F.yElbow + 32, aw * 0.55, 21),
    E('avambracci', cx + cw * 1.10, F.yElbow + 32, aw * 0.55, 21),
    R('addome', cx, (F.yPit + F.yWaist) / 2 + 12, ww * 0.30, 26, 9),
    E('quadricipiti', cx - ax * 0.92, F.yCrotch + 58, tw * 0.62, 42),
    E('quadricipiti', cx + ax * 0.92, F.yCrotch + 58, tw * 0.62, 42)
  ];
  return [
    R('trapezi', cx, F.yPit - 18, cw * 0.52, 24, 12),
    E('spalle', cx - sw * 0.78, F.ySh + 12, sw * 0.20, 13),
    E('spalle', cx + sw * 0.78, F.ySh + 12, sw * 0.20, 13),
    E('dorsali', cx - cw * 0.50, F.yPit + 22, cw * 0.46, 27, 12),
    E('dorsali', cx + cw * 0.50, F.yPit + 22, cw * 0.46, 27, -12),
    E('tricipiti', cx - cw * 1.00, F.yPit + 28, aw * 0.70, 19),
    E('tricipiti', cx + cw * 1.00, F.yPit + 28, aw * 0.70, 19),
    R('lombari', cx, F.yWaist + 8, ww * 0.34, 15, 7),
    E('glutei', cx - hw * 0.40, F.yHip + 8, hw * 0.36, 16),
    E('glutei', cx + hw * 0.40, F.yHip + 8, hw * 0.36, 16),
    E('femorali', cx - ax * 0.92, F.yCrotch + 62, tw * 0.58, 42),
    E('femorali', cx + ax * 0.92, F.yCrotch + 62, tw * 0.58, 42),
    E('polpacci', cx - ax * 0.84, F.yCalf + 2, tw * 0.48, 26),
    E('polpacci', cx + ax * 0.84, F.yCalf + 2, tw * 0.48, 26)
  ];
}

/** Un livello 0–4 della rampa sequenziale gia' validata. */
function livello(v) { return v <= 0.02 ? 0 : Math.max(1, Math.min(4, Math.ceil(v * 4))); }

function mappaSVG(vista, stato, modo, onTap) {
  const cur = figMeas(Object.fromEntries(D.misure.map(m => [m.id, lastMeas(m.id)])));
  const f = figure(cur);
  const s = mk('svg', { viewBox: `0 0 ${FIG.W} ${FIG.H}`, role: 'img',
    'aria-label': `Mappa muscolare, vista ${vista}` });
  const sagoma = d => mk('path', { d, fill: 'var(--wash)', stroke: 'var(--rule)',
    'stroke-width': 1.6, 'stroke-linejoin': 'round' });
  s.append(sagoma(f.corpo));
  f.braccia.forEach(d => s.append(sagoma(d)));
  s.append(mk('ellipse', { cx: f.testa.cx, cy: f.testa.cy.toFixed(1),
    rx: f.testa.rx.toFixed(1), ry: f.testa.ry.toFixed(1),
    fill: 'var(--wash)', stroke: 'var(--rule)', 'stroke-width': 1.6 }));

  for (const r of regioniMuscolari(cur, vista)) {
    const st = stato[r.id]; if (!st) continue;
    const v = modo === 'fatica' ? st.nFatica : modo === 'forma' ? st.nForma : st.nVolume;
    const l = livello(v);
    const attr = { fill: l ? `var(--s${l})` : 'var(--paper)',
      stroke: 'var(--pine)', 'stroke-width': .8, opacity: l ? .92 : .5,
      style: 'cursor:pointer' };
    let e;
    if (r.tag === 'ellipse') {
      e = mk('ellipse', { cx: r.x.toFixed(1), cy: r.y.toFixed(1),
        rx: r.rx.toFixed(1), ry: r.ry.toFixed(1), ...attr });
      if (r.rot) e.setAttribute('transform', `rotate(${r.rot} ${r.x.toFixed(1)} ${r.y.toFixed(1)})`);
    } else {
      e = mk('rect', { x: r.x.toFixed(1), y: r.y.toFixed(1),
        width: r.w.toFixed(1), height: r.h.toFixed(1), rx: r.r, ...attr });
    }
    e.addEventListener('pointerdown', () => onTap(st));
    s.append(e);
  }
  return s;
}

/* ==================================================================== viste */
let gymVista = 'fronte', gymModo = 'volume', gymEx = null;

function viewPalestra(v) {
  if (!PD) { v.append(el('div', 'card', '<p class="muted">Catalogo esercizi non caricato.</p>')); return; }
  const k = today(), st = statoMuscoli(k);
  const V = PD.volume;

  /* --- ingresso a Road to HYROX --- */
  if (HX) {
    const hxb = el('button', 'hx-entry');
    const gg = giorniAllaGara();
    const hp = S.hyrox?.profilo;
    hxb.innerHTML = `<span class="k">Road to</span><span class="l">HYROX</span>
      <span class="d">${gg != null
        ? `${gg > 0 ? gg + ' giorni alla gara' : gg === 0 ? 'Oggi si corre' : 'Gara passata da ' + (-gg) + ' giorni'} · obiettivo ${hms((hp?.target_min || 90) * 60)}`
        : '8 km di corsa e 8 stazioni. Piano dei passaggi, simulazioni, punti deboli e programma settimanale.'}</span>
      <span class="g">Apri &rsaquo;</span>`;
    hxb.onclick = () => { location.hash = '#/hyrox'; };
    v.append(hxb);
  }

  /* --- seduta di oggi --- */
  const oggi = P().sessioni[k];
  const testa = el('div', 'card');
  testa.append(el('div', 'eyebrow', 'Oggi'));
  if (oggi) {
    const n = oggi.serie.length, ton = oggi.serie.reduce((a, s) => a + (+s.kg || 0) * (+s.reps || 0), 0);
    testa.append(el('div', 'muted',
      `<strong>${esc(oggi.nome || 'Seduta')}</strong> — ${n} serie, ${nf(ton)} kg di tonnellaggio.`));
  } else {
    testa.append(el('div', 'muted', 'Nessuna seduta registrata oggi.'));
  }
  const bReg = el('button', 'btn wide pri', oggi ? 'Continua la seduta' : 'Registra un allenamento');
  bReg.style.marginTop = '10px';
  bReg.onclick = () => sheetSeduta(k);
  testa.append(bReg);
  v.append(testa);

  /* --- mappa muscolare --- */
  const cm = el('div', 'cw');
  cm.append(el('h3', null, 'Mappa muscolare'));
  cm.append(el('div', 'sub', {
    volume: 'Serie pesate nella settimana appena chiusa. Piu' + '’ scuro = piu’ volume.',
    fatica: 'Fatica residua secondo il modello forma–fatica. Piu’ scuro = piu’ stanco.',
    forma: 'Forma accumulata: l’adattamento che resta dopo che la fatica se n’e’ andata.'
  }[gymModo]));

  const modi = el('div', 'seg');
  for (const [id, lab] of [['volume', 'Volume'], ['fatica', 'Stanchi'], ['forma', 'In crescita']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', gymModo === id);
    b.onclick = () => { gymModo = id; route(); };
    modi.append(b);
  }
  cm.append(modi);

  const viste = el('div', 'posebar');
  viste.style.marginTop = '10px';
  for (const [id, lab] of [['fronte', 'Fronte'], ['schiena', 'Schiena']]) {
    const b = el('button', 'btn' + (gymVista === id ? ' pri' : ''), lab);
    b.onclick = () => { gymVista = id; route(); };
    viste.append(b);
  }
  cm.append(viste);

  const read = el('div', 'read', '<span class="ph">Tocca un muscolo</span>');
  const box = el('div', 'bodywrap gymmap');
  box.append(mappaSVG(gymVista, st, gymModo, s => {
    read.innerHTML = `<span><b>${esc(s.nome)}</b></span>`
      + `<span>${nf(s.serie, 1)} serie/sett</span>`
      + `<span>fatica ${nf(s.nFatica * 100)}%</span>`
      + `<span>${s.pronto ? 'pronto' : 'in recupero'}</span>`;
  }));
  cm.append(box);
  cm.append(read);
  cm.append(el('div', 'calscale',
    '<span>poco</span>' + [1, 2, 3, 4].map(n => `<i style="background:var(--s${n})"></i>`).join('')
    + '<span>molto</span>'));
  cm.append(el('p', 'note',
    'La silhouette di schiena e’ la stessa di fronte: e’ schematica, serve a dire dove, non a fare anatomia. Le proporzioni pero’ sono le tue, prese dalle misure registrate.'));
  v.append(cm);

  /* --- prontezza --- */
  const pronti = Object.values(st).filter(s => s.pronto && s.forma > 0.2);
  const stanchi = Object.values(st).filter(s => !s.pronto && s.fatica > 0.2)
    .sort((a, b) => b.nFatica - a.nFatica);
  const cp = el('div', 'card flat');
  cp.append(el('div', 'eyebrow', 'Cosa allenare oggi'));
  if (!stanchi.length && !pronti.length) {
    cp.append(el('div', 'muted', 'Registra qualche seduta e qui comparira’ quali gruppi sono recuperati e quali no.'));
  } else {
    cp.append(el('div', 'muted',
      (stanchi.length
        ? `Ancora in recupero: <strong>${stanchi.slice(0, 4).map(s => esc(s.nome.toLowerCase())).join(', ')}</strong>. `
        : 'Nessun gruppo e’ in debito di recupero. ')
      + (pronti.length
        ? `Pronti: <strong>${pronti.slice(0, 5).map(s => esc(s.nome.toLowerCase())).join(', ')}</strong>.`
        : '')));
    cp.append(el('div', 'hint',
      'Un gruppo e’ "pronto" quando la fatica residua e’ scesa sotto il 55% della forma accumulata. E’ una soglia di modello, non una diagnosi: se un muscolo ti fa male, vince il male.'));
  }
  v.append(cp);

  /* --- volume per muscolo: barre orizzontali --- */
  const righe = muscoli().map(m => ({ nome: m.nome, v: st[m.id].serie, stato: st[m.id].stato }))
    .sort((a, b) => b.v - a.v);
  v.append(chartHBars({
    titolo: 'Volume settimanale', sub: `Serie pesate per gruppo, settimana chiusa. Riferimento ${V.min_serie}–${V.max_serie}.`,
    righe, min: V.min_serie, max: V.max_serie, unit: 'serie',
    note: `I riferimenti sono regole pratiche (<em>${esc(V.fonte)}</em>), non misure su di te: ${esc(V.nota)}`
  }));

  /* --- forma / fatica nel tempo --- */
  const focus = stanchi[0] || Object.values(st).sort((a, b) => b.forma - a.forma)[0];
  if (focus && focus.forma > 0.05) {
    const gg = span(56, k);
    const ff = serieFormaFatica(focus.id, gg);
    v.append(chartEmphasis({
      titolo: `Forma e fatica — ${focus.nome.toLowerCase()}`,
      sub: 'La fatica sale e scende in giorni, la forma resta per settimane. La prontezza e’ la differenza.',
      days: gg, dec: 1,
      serie: [
        { nome: 'prontezza', vals: ff.map(x => x.prontezza), forte: true },
        { nome: 'forma', vals: ff.map(x => x.forma) },
        { nome: 'fatica', vals: ff.map(x => x.fatica) }
      ],
      note: 'Unita’ arbitrarie: conta la forma delle curve, non il valore. Costanti di tempo 42 giorni per la forma e 7 per la fatica, valori tipici di letteratura non calibrati su di te.'
    }));
  }

  /* --- progressione per esercizio --- */
  const usati = [...new Set(Object.keys(P().sessioni)
    .flatMap(kk => serieDelGiorno(kk).map(s => s.ex)))];
  if (usati.length) {
    const c = el('div', 'card');
    c.append(el('h2', 'sec', 'Prossimo passo'));
    c.lastChild.style.marginTop = '0';
    c.append(el('p', 'muted', 'Doppia progressione: prima le ripetizioni, poi il carico.'));
    for (const id of usati) {
      const ex = esercizio(id), pp = prossimoPasso(id);
      if (!ex || !pp) continue;
      const r = el('button', 'prod');
      const prev = previsioneForza(id);
      r.innerHTML = `<div class="grow"><div class="nm">${esc(ex.nome)}</div>
        <div class="mt">${esc(pp.testo)}</div></div>
        <div class="kc">${prev ? nf(prev.ora, 1) : '—'}<br><span class="mt">1RM</span></div>`;
      r.onclick = () => { gymEx = id; route(); };
      c.append(r);
    }
    v.append(c);
  }

  /* --- dettaglio esercizio --- */
  if (gymEx) v.append(cardEsercizio(gymEx));

  /* --- tonnellaggio per seduta --- */
  const gg = span(datiRange || 30, k);
  const ton = gg.map(kk => {
    const s = serieDelGiorno(kk);
    return s.length ? s.reduce((a, x) => a + (+x.kg || 0) * (+x.reps || 0), 0) : null;
  });
  v.append(chartBars({
    titolo: 'Tonnellaggio per seduta', sub: 'Chili sollevati in totale. Utile per vedere i buchi, non per confrontare esercizi diversi.',
    days: gg, vals: ton, unit: 'kg',
    msg: 'Nessuna seduta registrata nel periodo.'
  }));

  /* --- schede ed esercizi --- */
  const cs = el('div', 'card');
  cs.append(el('h2', 'sec', 'Schede ed esercizi'));
  cs.lastChild.style.marginTop = '0';
  cs.append(el('p', 'muted',
    'Una scheda si crea una volta e si riusa: gli esercizi e le serie restano fissi, e a ogni seduta aggiorni solo i carichi.'));
  const b1 = el('button', 'btn wide');
  b1.textContent = `Le tue schede (${schede().length})`;
  b1.onclick = () => sheetSchede();
  cs.append(b1);
  const b2 = el('button', 'btn wide');
  b2.style.marginTop = '8px';
  b2.textContent = `I tuoi esercizi (${P().esercizi.length})`;
  b2.onclick = () => sheetEsercizi();
  cs.append(b2);
  v.append(cs);

  /* --- storico --- */
  const sedute = Object.keys(P().sessioni).sort().reverse().slice(0, 12);
  if (sedute.length) {
    const c = el('div', 'card');
    c.append(el('h2', 'sec', 'Ultime sedute'));
    c.lastChild.style.marginTop = '0';
    for (const kk of sedute) {
      const s = P().sessioni[kk];
      const r = el('button', 'prod');
      const ton2 = s.serie.reduce((a, x) => a + (+x.kg || 0) * (+x.reps || 0), 0);
      r.innerHTML = `<div class="grow"><div class="nm">${esc(s.nome || 'Seduta')}</div>
        <div class="mt">${kk} · ${s.serie.length} serie · ${nf(ton2)} kg</div></div>`;
      r.onclick = () => sheetSeduta(kk);
      c.append(r);
    }
    v.append(c);
  }
}

/** Scheda di un singolo esercizio: massimale stimato e proiezione. */
function cardEsercizio(id) {
  const ex = esercizio(id), prev = previsioneForza(id);
  const c = el('div', 'cw');
  c.append(el('h3', null, ex.nome));
  if (!prev) {
    c.append(el('div', 'sub', 'Servono almeno tre sedute per stimare una tendenza.'));
    return c;
  }
  c.append(el('div', 'sub',
    `Massimale stimato con Epley corretto col RIR. Tendenza su ${prev.n} sedute.`));
  c.append(el('div', 'kpi',
    `<div class="eyebrow">Massimale stimato</div>
     <div class="big mono">${nf(prev.ora, 1)}<em>kg</em></div>
     <div class="hint">${prev.kgSettimana >= 0 ? '+' : ''}${nf(prev.kgSettimana, 2)} kg a settimana ·
     aderenza alla retta R² ${nf(prev.r2, 2)}</div>`));
  c.append(el('p', 'note',
    `Se la tendenza regge, fra ${prev.orizzonte} giorni il massimale stimato sarebbe `
    + `${nf(prev.fra, 1)} kg (±${nf(prev.banda, 1)}). R² ${nf(prev.r2, 2)} dice quanto i punti stanno sulla retta: `
    + `sotto 0,5 la proiezione vale poco. Epley sopra le 12 ripetizioni sovrastima.`));
  const chiudi = el('button', 'btn wide', 'Chiudi');
  chiudi.onclick = () => { gymEx = null; route(); };
  c.append(chiudi);

  const frag = document.createDocumentFragment();
  frag.append(c);
  frag.append(chartLine({
    titolo: 'Massimale stimato nel tempo',
    sub: 'Un punto per seduta: la serie migliore di quel giorno.',
    days: prev.serie.map(x => x.k), vals: prev.serie.map(x => x.v),
    unit: 'kg', dec: 1
  }));
  return frag;
}

/* --------------------------------------------------------- registrazione */
/** Le serie dell'ultima volta che hai fatto quell'esercizio: servono a
    precompilare, cosi' non si riparte da zero a ogni seduta. */
function ultimoUso(exId, escludi) {
  const giorni = Object.keys(P().sessioni).filter(k => k !== escludi).sort().reverse();
  for (const k of giorni) {
    const ser = serieDelGiorno(k).filter(s => s.ex === exId);
    if (ser.length) return { k, serie: ser };
  }
  return null;
}

function schede() { P().schede ||= []; return P().schede; }
function scheda(id) { return schede().find(s => s.id === id) || null; }

/**
 * Punto d'ingresso della registrazione. Se la seduta e' vuota chiede COME
 * registrare, invece di buttare l'utente in un modulo di inserimento serie per
 * serie: con una scheda si aggiornano solo carico e ripetizioni, che e' l'unica
 * cosa che cambia davvero da una settimana all'altra.
 */
function sheetSeduta(k) {
  const p = P();
  p.sessioni[k] ||= { nome: '', serie: [] };
  if (!p.sessioni[k].serie.length) return sheetSceltaModo(k);
  return sheetLibero(k);
}

function sheetSceltaModo(k) {
  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', 'Come registri?'));
  w.lastChild.style.marginTop = '0';

  const list = schede();
  if (list.length) {
    w.append(el('p', 'muted', 'Con una scheda gli esercizi e il numero di serie sono gia\' fissati: tu aggiorni solo carico e ripetizioni.'));
    for (const sc of list) {
      const r = el('button', 'prod');
      const nEx = sc.esercizi.length;
      const nSer = sc.esercizi.reduce((a, e) => a + (e.serie || 0), 0);
      r.innerHTML = `<div class="grow"><div class="nm">${esc(sc.nome)}</div>
        <div class="mt">${nEx} esercizi · ${nSer} serie</div></div>
        <div class="kc">usa &rsaquo;</div>`;
      r.onclick = () => sheetDaScheda(k, sc.id);
      w.append(r);
    }
  } else {
    w.append(el('div', 'card flat',
      `<div class="eyebrow">Non hai ancora schede</div>
       <div class="muted">Una scheda si crea una volta e poi si riusa: gli esercizi
       e le serie restano fissi, e a ogni seduta aggiorni solo i carichi. Puoi anche
       registrare una seduta libera adesso e salvarla come scheda alla fine.</div>`));
  }

  const b1 = el('button', 'btn wide', 'Gestisci le schede');
  b1.style.marginTop = '10px';
  b1.onclick = () => sheetSchede();
  w.append(b1);

  const b2 = el('button', 'btn wide pri', 'Seduta libera, esercizio per esercizio');
  b2.style.marginTop = '8px';
  b2.onclick = () => sheetLibero(k);
  w.append(b2);
  sheet(w);
}

/** Seduta da scheda: si toccano solo carico, ripetizioni e RIR. */
function sheetDaScheda(k, schedaId) {
  const p = P(), sc = scheda(schedaId);
  if (!sc) return sheetSceltaModo(k);
  const s = p.sessioni[k];
  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', esc(sc.nome)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', 'Esercizi e serie sono quelli della scheda. Cambia solo quello che hai fatto davvero.'));

  for (const [ei, riga] of sc.esercizi.entries()) {
    const ex = esercizio(riga.ex);
    if (!ex) continue;
    const prec = ultimoUso(riga.ex, k);
    const [lo, hi] = ex.range || [8, 12];
    const box = el('div', 'card flat');
    box.style.marginBottom = '10px';
    box.append(el('div', 'row between',
      `<strong>${esc(ex.nome)}</strong>
       <span class="mono muted" style="font-size:11px">${riga.serie} serie · ${lo}–${hi} rip</span>`));
    const pp = prossimoPasso(riga.ex);
    if (pp) box.append(el('div', 'hint', esc(pp.testo)));
    else if (prec) box.append(el('div', 'hint',
      `L'ultima volta (${prec.k}): ${prec.serie.map(x => `${nf(x.kg, 1)}×${x.reps}`).join(', ')}.`));

    for (let si = 0; si < riga.serie; si++) {
      const d = prec?.serie[si] || {};
      const kg = d.kg ?? riga.kg ?? '';
      const rp = d.reps ?? riga.reps ?? lo;
      const rr = d.rir ?? 2;
      const row = el('div', 'setrow');
      row.innerHTML = `<span class="n">${si + 1}</span>
        <input type="text" inputmode="decimal" id="sc-${ei}-${si}-kg" value="${kg}" placeholder="kg">
        <input type="text" inputmode="numeric" id="sc-${ei}-${si}-rp" value="${rp}" placeholder="rip">
        <input type="text" inputmode="numeric" id="sc-${ei}-${si}-rr" value="${rr}" placeholder="RIR">`;
      box.append(row);
    }
    w.append(box);
  }

  const salva = el('button', 'btn wide pri', 'Salva la seduta');
  salva.onclick = () => {
    const serie = [];
    for (const [ei, riga] of sc.esercizi.entries()) {
      if (!esercizio(riga.ex)) continue;
      for (let si = 0; si < riga.serie; si++) {
        const reps = parseNum(($('#sc-' + ei + '-' + si + '-rp') || {}).value);
        if (!(reps > 0)) continue;                 // serie non fatta: si salta
        serie.push({ ex: riga.ex,
          kg: parseNum(($('#sc-' + ei + '-' + si + '-kg') || {}).value) ?? 0,
          reps, rir: parseNum(($('#sc-' + ei + '-' + si + '-rr') || {}).value) ?? 2 });
      }
    }
    if (!serie.length) { toast('Nessuna serie compilata'); return; }
    s.serie = serie;
    s.nome = sc.nome;
    s.scheda = sc.id;
    save(); closeSheet(); route(); toast(`${serie.length} serie registrate`);
  };
  w.append(salva);

  const ind = el('button', 'btn wide', 'Torna indietro');
  ind.style.marginTop = '8px';
  ind.onclick = () => sheetSceltaModo(k);
  w.append(ind);
  sheet(w);
}

/** Seduta libera: esercizio per esercizio, serie per serie. */
function sheetLibero(k) {
  const p = P(), s = p.sessioni[k];
  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', 'Seduta libera'));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Nome della seduta</label>
     <input type="text" id="s-nome" placeholder="Push A" value="${esc(s.nome || '')}">`));

  const lista = el('div');
  const disegna = () => {
    lista.innerHTML = '';
    if (!s.serie.length) {
      lista.append(el('p', 'muted', 'Nessuna serie. Aggiungine una qui sotto.'));
      return;
    }
    let ultimo = null;
    s.serie.forEach((x, i) => {
      const ex = esercizio(x.ex);
      if (ex && ex.id !== ultimo) {
        const h = el('div', 'eyebrow', esc(ex.nome));
        h.style.marginTop = '12px';
        lista.append(h);
        ultimo = ex.id;
      }
      const r = el('div', 'cmp-r');
      r.innerHTML = `<span class="mono">serie ${i + 1}</span>
        <span class="mono">${nf(x.kg, 1)} kg</span>
        <span class="mono">${x.reps} rip</span>
        <span class="mono muted">RIR ${x.rir}</span>`;
      r.style.cursor = 'pointer';
      r.onclick = () => {
        if (!confirm('Togliere questa serie?')) return;
        s.serie.splice(i, 1); save(); disegna();
      };
      lista.append(r);
    });
  };
  disegna();
  w.append(lista);

  const box = el('div', 'card flat');
  box.style.marginTop = '12px';
  box.append(el('div', 'eyebrow', 'Aggiungi una serie'));
  const selEx = el('select');
  selEx.id = 's-ex';
  selEx.style.cssText = 'width:100%;padding:9px 10px;border:1px solid var(--rule);'
    + 'border-radius:9px;background:var(--paper);color:var(--ink);font:inherit;margin-bottom:8px';
  const ultimoEx = s.serie.length ? s.serie[s.serie.length - 1].ex : null;
  for (const e of catalogo().slice().sort((a, b) => a.nome.localeCompare(b.nome)))
    selEx.append(new Option(`${e.nome} — ${e.attrezzo}`, e.id, false, e.id === ultimoEx));
  box.append(selEx);

  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 8px';
  const campo = (id, lab, val) => el('div', 'field',
    `<label>${lab}</label><input type="text" inputmode="decimal" id="s-${id}" value="${val ?? ''}">`);
  const prec = s.serie.filter(x => x.ex === ultimoEx).pop();
  g.append(campo('kg', 'kg', prec?.kg), campo('reps', 'rip', prec?.reps), campo('rir', 'RIR', prec?.rir ?? 2));
  box.append(g);

  const add = el('button', 'btn wide pri', 'Aggiungi serie');
  add.onclick = () => {
    const kg = parseNum($('#s-kg').value), reps = parseNum($('#s-reps').value);
    const rir = parseNum($('#s-rir').value) ?? 2;
    if (reps == null || reps <= 0) { toast('Servono le ripetizioni'); return; }
    s.serie.push({ ex: $('#s-ex').value, kg: kg ?? 0, reps, rir });
    s.nome = $('#s-nome').value.trim();
    save(); disegna(); toast('Serie aggiunta');
  };
  box.append(add);
  const sugg = ultimoEx ? prossimoPasso(ultimoEx) : null;
  if (sugg) box.append(el('div', 'hint', esc(sugg.testo)));
  w.append(box);

  if (s.serie.length) {
    const asch = el('button', 'btn wide', 'Salva questa seduta come scheda');
    asch.style.marginTop = '10px';
    asch.onclick = () => {
      const n = prompt('Nome della scheda', $('#s-nome').value.trim() || 'Nuova scheda');
      if (!n || !n.trim()) return;
      const per = {};
      for (const x of s.serie) {
        per[x.ex] ||= { ex: x.ex, serie: 0, reps: x.reps, kg: x.kg };
        per[x.ex].serie++;
      }
      schede().push({ id: uid(), nome: n.trim(), esercizi: Object.values(per) });
      save(); toast('Scheda creata');
    };
    w.append(asch);
  }

  const fine = el('button', 'btn wide', 'Chiudi');
  fine.style.marginTop = '8px';
  fine.onclick = () => {
    s.nome = $('#s-nome').value.trim();
    if (!s.serie.length) delete p.sessioni[k];
    save(); closeSheet(); route();
  };
  w.append(fine);
  sheet(w);
}

/* ------------------------------------------------------------- schede */
function sheetSchede() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Schede'));
  w.append(el('h2', 'sec', 'Le tue schede'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Una scheda fissa gli esercizi e il numero di serie. Quando la usi aggiorni solo carico e ripetizioni: e\' l\'unica cosa che cambia da una settimana all\'altra.'));
  const list = schede();
  if (!list.length) w.append(el('p', 'hint', 'Nessuna scheda ancora.'));
  for (const sc of list) {
    const r = el('button', 'prod');
    r.innerHTML = `<div class="grow"><div class="nm">${esc(sc.nome)}</div>
      <div class="mt">${sc.esercizi.map(e => esc(esercizio(e.ex)?.nome || e.ex)).join(' · ')}</div></div>`;
    r.onclick = () => sheetScheda(sc.id);
    w.append(r);
  }
  const b = el('button', 'btn wide pri', 'Nuova scheda');
  b.style.marginTop = '10px';
  b.onclick = () => sheetScheda(null);
  w.append(b);
  sheet(w);
}

function sheetScheda(id) {
  const sc = id ? scheda(id) : { id: uid(), nome: '', esercizi: [] };
  const stato = { nome: sc.nome, esercizi: sc.esercizi.map(x => ({ ...x })) };
  const w = el('div');
  w.append(el('div', 'eyebrow', id ? 'Modifica scheda' : 'Nuova scheda'));
  w.append(el('h2', 'sec', 'Composizione'));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Nome</label><input type="text" id="sk-nome" value="${esc(stato.nome)}" placeholder="Push A">`));

  const lista = el('div');
  const disegna = () => {
    lista.innerHTML = '';
    if (!stato.esercizi.length) {
      lista.append(el('p', 'muted', 'Nessun esercizio. Aggiungine uno qui sotto.'));
      return;
    }
    stato.esercizi.forEach((riga, i) => {
      const ex = esercizio(riga.ex);
      const r = el('div', 'cmp-r');
      r.style.cursor = 'pointer';
      r.innerHTML = `<span>${esc(ex?.nome || riga.ex)}</span>
        <span class="mono">${riga.serie} serie</span>
        <span class="mono muted">${riga.reps} rip</span>
        <span class="mono">${riga.kg ? nf(riga.kg, 1) + ' kg' : '—'}</span>`;
      r.onclick = () => {
        if (!confirm(`Togliere ${ex?.nome || riga.ex} dalla scheda?`)) return;
        stato.esercizi.splice(i, 1); disegna();
      };
      lista.append(r);
    });
  };
  disegna();
  w.append(lista);

  const box = el('div', 'card flat');
  box.style.marginTop = '12px';
  box.append(el('div', 'eyebrow', 'Aggiungi un esercizio'));
  const sel = el('select');
  sel.id = 'sk-ex';
  sel.style.cssText = 'width:100%;padding:9px 10px;border:1px solid var(--rule);'
    + 'border-radius:9px;background:var(--paper);color:var(--ink);font:inherit;margin-bottom:8px';
  for (const e of catalogo().slice().sort((a, b) => a.nome.localeCompare(b.nome)))
    sel.append(new Option(`${e.nome} — ${e.attrezzo}`, e.id));
  box.append(sel);
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 8px';
  g.innerHTML = `<div class="field"><label>Serie</label>
      <input type="text" inputmode="numeric" id="sk-serie" value="3"></div>
    <div class="field"><label>Rip</label>
      <input type="text" inputmode="numeric" id="sk-reps" value="8"></div>
    <div class="field"><label>kg</label>
      <input type="text" inputmode="decimal" id="sk-kg" value=""></div>`;
  box.append(g);
  const ba = el('button', 'btn wide', 'Aggiungi');
  ba.onclick = () => {
    const n = parseNum($('#sk-serie').value);
    if (!(n > 0 && n <= 12)) { toast('Da 1 a 12 serie'); return; }
    stato.esercizi.push({ ex: $('#sk-ex').value, serie: Math.round(n),
      reps: parseNum($('#sk-reps').value) ?? 8, kg: parseNum($('#sk-kg').value) ?? 0 });
    disegna();
  };
  box.append(ba);
  w.append(box);

  const salva = el('button', 'btn wide pri', 'Salva la scheda');
  salva.style.marginTop = '10px';
  salva.onclick = () => {
    const nome = $('#sk-nome').value.trim();
    if (!nome) { toast('Serve il nome'); return; }
    if (!stato.esercizi.length) { toast('Serve almeno un esercizio'); return; }
    const rec = { id: sc.id, nome, esercizi: stato.esercizi };
    const L = schede();
    const i = L.findIndex(x => x.id === rec.id);
    if (i >= 0) L[i] = rec; else L.push(rec);
    save(); closeSheet(); route(); toast('Scheda salvata');
  };
  w.append(salva);
  if (id) {
    const del = el('button', 'btn wide', 'Elimina la scheda');
    del.style.marginTop = '8px';
    del.onclick = () => {
      if (!confirm(`Eliminare "${sc.nome}"? Le sedute gia' registrate restano.`)) return;
      P().schede = schede().filter(x => x.id !== id);
      save(); closeSheet(); route(); toast('Eliminata');
    };
    w.append(del);
  }
  sheet(w);
}

/* ------------------------------------------------- esercizi personalizzati */
function sheetEsercizi() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Esercizi'));
  w.append(el('h2', 'sec', 'I tuoi esercizi'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Aggiungi quello che fai e non e\' in catalogo. I gruppi muscolari servono alla mappa e al conteggio del volume: senza, l\'esercizio non colora niente.'));
  const miei = P().esercizi;
  if (!miei.length) w.append(el('p', 'hint', 'Nessun esercizio tuo, per ora.'));
  for (const e of miei) {
    const r = el('button', 'prod');
    r.innerHTML = `<div class="grow"><div class="nm">${esc(e.nome)}</div>
      <div class="mt">${esc(e.attrezzo)} · ${(e.primari || []).join(', ')}</div></div>`;
    r.onclick = () => sheetEsercizio(e.id);
    w.append(r);
  }
  const b = el('button', 'btn wide pri', 'Nuovo esercizio');
  b.style.marginTop = '10px';
  b.onclick = () => sheetEsercizio(null);
  w.append(b);
  sheet(w);
}

function sheetEsercizio(id) {
  const miei = P().esercizi;
  const cur = id ? miei.find(x => x.id === id) : null;
  const stato = { primari: [...(cur?.primari || [])], secondari: [...(cur?.secondari || [])] };
  const w = el('div');
  w.append(el('div', 'eyebrow', id ? 'Modifica' : 'Nuovo esercizio'));
  w.append(el('h2', 'sec', esc(cur?.nome || 'Esercizio')));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Nome</label><input type="text" id="ex-nome" value="${esc(cur?.nome || '')}">`));
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  g.innerHTML = `<div class="field"><label>Attrezzo</label>
      <input type="text" id="ex-att" value="${esc(cur?.attrezzo || 'manubri')}"></div>
    <div class="field"><label>Incremento (kg)</label>
      <input type="text" inputmode="decimal" id="ex-inc" value="${cur?.incremento ?? 2.5}"></div>
    <div class="field"><label>Rip minime</label>
      <input type="text" inputmode="numeric" id="ex-lo" value="${cur?.range?.[0] ?? 8}"></div>
    <div class="field"><label>Rip massime</label>
      <input type="text" inputmode="numeric" id="ex-hi" value="${cur?.range?.[1] ?? 12}"></div>`;
  w.append(g);

  const gruppo = (titolo, chiave) => {
    const f = el('div', 'field', `<label>${titolo}</label>`);
    const box = el('div');
    box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    for (const m of muscoli()) {
      const b = el('button', 'btn sm', m.nome);
      const on = () => stato[chiave].includes(m.id);
      const dip = () => { b.style.background = on() ? 'var(--pine)' : '';
                          b.style.color = on() ? '#fff' : ''; };
      b.onclick = () => {
        const i = stato[chiave].indexOf(m.id);
        if (i >= 0) stato[chiave].splice(i, 1); else stato[chiave].push(m.id);
        dip();
      };
      dip(); box.append(b);
    }
    f.append(box);
    return f;
  };
  w.append(gruppo('Muscoli primari', 'primari'));
  w.append(gruppo('Muscoli secondari', 'secondari'));

  const salva = el('button', 'btn wide pri', 'Salva');
  salva.onclick = () => {
    const nome = $('#ex-nome').value.trim();
    if (!nome) { toast('Serve il nome'); return; }
    if (!stato.primari.length) { toast('Serve almeno un muscolo primario'); return; }
    const rec = {
      id: cur?.id || ('mio-' + uid()), nome,
      attrezzo: $('#ex-att').value.trim() || 'altro', tipo: 'mio',
      primari: stato.primari, secondari: stato.secondari,
      range: [parseNum($('#ex-lo').value) ?? 8, parseNum($('#ex-hi').value) ?? 12],
      incremento: parseNum($('#ex-inc').value) ?? 2.5
    };
    const i = miei.findIndex(x => x.id === rec.id);
    if (i >= 0) miei[i] = rec; else miei.push(rec);
    save(); closeSheet(); route(); toast('Esercizio salvato');
  };
  w.append(salva);
  if (cur) {
    const del = el('button', 'btn wide', 'Elimina');
    del.style.marginTop = '8px';
    del.onclick = () => {
      if (!confirm('Eliminare questo esercizio?')) return;
      P().esercizi = miei.filter(x => x.id !== cur.id);
      save(); closeSheet(); route(); toast('Eliminato');
    };
    w.append(del);
  }
  sheet(w);
}
