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
        // uno scarico di stripping e' lavoro vero ma piu' corto di una serie
        // piena: conta mezza serie, che e' la convenzione piu' diffusa
        out[m.id].serie += w * (1 + (s.drop || []).length * 0.5);
        out[m.id].tonn += w * ((+s.kg || 0) * (+s.reps || 0)
          + (s.drop || []).reduce((a, x) => a + x.kg * x.reps, 0));
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
      // gli scarichi si fanno a cedimento: stimolo pieno, mezza serie
      imp += w * sforzo(s.rir) * (1 + (s.drop || []).length * 0.5);
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

/* ------------------------------------------------------ spesa energetica */
/**
 * Calorie bruciate in una giornata di allenamento, palestra e HYROX insieme.
 *
 * ATTENZIONE, e' il punto dove quasi tutte le app sbagliano: questo numero NON
 * va sommato al target ne' sottratto dall'introito. Il dispendio stimato dal
 * filtro di Kalman nasce dal bilancio energetico osservato — introito contro
 * variazione del peso — e quindi CONTIENE GIA' tutto quello che ti muovi,
 * allenamenti compresi. Sommarlo di nuovo significherebbe contare due volte lo
 * stesso lavoro e mangiare di piu' credendo di essere in pari.
 *
 * Serve a un'altra cosa: misurare il carico di lavoro nel tempo, vedere le
 * settimane vuote e capire quanto pesa una seduta rispetto a un'altra.
 */
function kcalAllenamento(k) {
  const M = PD?.met; if (!M) return { tot: 0, righe: [] };
  const peso = lastWeight() ?? D.profilo.peso_iniziale_kg;
  const met = (m, min) => m * 3.5 * peso / 200 * min;
  const righe = [];

  const ser = serieDelGiorno(k);
  if (ser.length) {
    const sess = P().sessioni[k];
    // durata dichiarata se c'e', altrimenti stimata dalle serie (tempo sotto
    // tensione piu' recupero): e' una stima, e la UI lo dice
    const min = sess?.durata || Math.min(150, Math.max(15, ser.length * M.minuti_per_serie));
    righe.push({ tipo: 'Pesi', min, kcal: met(M.pesi, min), stimata: !sess?.durata });
  }

  const sim = (S.hyrox?.sim || []).find(s => s.data === k && s.totale > 0);
  if (sim) {
    const min = sim.totale / 60;
    const km = (sim.corse || []).filter(x => x > 0).length;
    // la corsa si conta a chilometri, che e' piu' preciso dei MET
    const kcalCorsa = km * peso * M.corsa_kcal_per_kg_km;
    const minStaz = Math.max(0, min - (sim.corse || []).reduce((a, b) => a + (b || 0), 0) / 60);
    righe.push({ tipo: 'Gara', min, kcal: kcalCorsa + met(M.simulazione, minStaz) });
  } else {
    const hs = S.hyrox?.sessioni?.[k];
    if (hs && hs.fatto) {
      const a = HX?.allenamenti.find(x => x.id === hs.id);
      const min = hs.durata || a?.durata || 45;
      righe.push({ tipo: 'HYROX', min, kcal: met(M[a?.tipo] ?? M.capacita, min) });
    }
  }
  return { tot: righe.reduce((a, r) => a + r.kcal, 0), righe };
}

/**
 * Tendenza dei carichi, calcolata invece che dichiarata a mano.
 *
 * Il massimale stimato con Epley corretto col RIR e' gia' la variabile che
 * mette d'accordo "meno ripetizioni ma piu' peso" e "stesso peso ma piu'
 * ripetizioni": due sedute con lo stesso e1RM sono progresso zero, comunque
 * siano composte. Quindi si guarda la pendenza dell'e1RM esercizio per
 * esercizio, la si normalizza sul valore corrente — un +2,5 kg su 60 non vale
 * come su 200 — e si prende la MEDIANA fra esercizi, che un singolo record
 * fortunato non riesce a spostare.
 */
function caricoTrend(k = today(), settimane = 8) {
  const da = addDays(k, -settimane * 7);
  const usati = [...new Set(Object.keys(P().sessioni).filter(x => x >= da && x <= k)
    .flatMap(x => serieDelGiorno(x).map(s => s.ex)))];
  const pend = [];
  for (const id of usati) {
    const serie = e1rmPerSeduta(id).filter(x => x.k >= da && x.k <= k);
    if (serie.length < 3) continue;
    const t0 = new Date(serie[0].k);
    const pts = serie.map(s => ({ x: (new Date(s.k) - t0) / 864e5, y: s.v }));
    const R = regressione(pts);
    const base = avg(serie.map(s => s.v));
    if (!R || !(base > 0)) continue;
    pend.push({ id, nome: esercizio(id)?.nome || id,
                pctSett: (R.m * 7) / base * 100, r2: R.r2, n: serie.length });
  }
  if (pend.length < 2) return { stato: null, n: pend.length, pend };
  const ord = pend.map(x => x.pctSett).sort((a, b) => a - b);
  const med = ord.length % 2 ? ord[(ord.length - 1) / 2]
    : (ord[ord.length / 2 - 1] + ord[ord.length / 2]) / 2;
  return {
    stato: med > 0.3 ? 'su' : med < -0.3 ? 'giu' : 'fermi',
    mediana: med, n: pend.length,
    pend: pend.slice().sort((a, b) => b.pctSett - a.pctSett)
  };
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

  const cScar = typeof cardScarico === 'function' ? cardScarico(k) : null;
  if (cScar) v.append(cScar);
  if (typeof cardAcciacchi === 'function') v.append(cardAcciacchi(k));

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
  // sempre la schermata di scelta: prima, se c'erano gia' delle serie, si
  // finiva dritti nella seduta libera e alle schede non si arrivava piu'
  return sheetSceltaModo(k);
}

function sheetSceltaModo(k) {
  const p = P(), gia = p.sessioni[k]?.serie?.length || 0;
  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', 'Come registri?'));
  w.lastChild.style.marginTop = '0';

  if (gia) {
    const cont = el('button', 'btn wide pri',
      `Continua quella di oggi — ${gia} serie registrate finora`);
    cont.onclick = () => sheetLibero(k);
    w.append(cont);
    w.append(el('p', 'hint',
      'Scegliendo una scheda qui sotto, le serie registrate finora oggi vengono sostituite da quelle nuove.'));
  }

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

  const b2 = el('button', 'btn wide' + (gia ? '' : ' pri'),
    'Seduta libera, esercizio per esercizio');
  b2.style.marginTop = '8px';
  b2.onclick = () => sheetLibero(k);
  w.append(b2);
  sheet(w);
}

/** "50x6, 40x5" -> gli scarichi di uno stripping. */
function parseScarichi(txt) {
  if (!txt) return [];
  return String(txt).split(/[,;]+/).map(p => {
    const m = p.trim().match(/^([\d.,]+)\s*[x×*]\s*(\d+)$/i);
    if (!m) return null;
    const kg = parseNum(m[1]), reps = parseNum(m[2]);
    return kg != null && reps > 0 ? { kg, reps } : null;
  }).filter(Boolean);
}
const scarichiTesto = d => (d || []).map(x => `${nf(x.kg, 1)}x${x.reps}`).join(', ');

/** Seduta da scheda: si toccano solo carico, ripetizioni e RIR. */
function sheetDaScheda(k, schedaId) {
  const p = P(), sc = scheda(schedaId);
  if (!sc) return sheetSceltaModo(k);
  const s = p.sessioni[k];
  const et = etichetteScheda(sc.esercizi);

  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', esc(sc.nome)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Gli esercizi e le serie sono quelli della scheda. Scrivi solo cosa hai fatto davvero: se salti una serie, lascia vuote le ripetizioni.'));

  for (const [ei, riga] of sc.esercizi.entries()) {
    const ex = esercizio(riga.ex);
    if (!ex) continue;
    const prec = ultimoUso(riga.ex, k);
    const lo = riga.reps, hi = riga.repsMax || riga.reps;
    const t = tecnica(riga.tecnica);

    const box = el('div', 'card flat');
    box.style.marginBottom = '10px';
    const cap = el('div', 'row between');
    cap.innerHTML = `<strong><span class="sk-g">${et[ei].testo}</span> ${esc(ex.nome)}</strong>
       <span class="mono muted" style="font-size:11px">${riga.serie} × ${lo}–${hi}</span>`;
    box.append(cap);
    // in una superserie il recupero sta DOPO la coppia, non in mezzo:
    // se la riga dopo e' attaccata a questa, qui il timer non ci va
    if (!sc.esercizi[ei + 1]?.superserie)
      cap.querySelector('span:last-child').before(bottoneRecupero(ex, riga));
    const av = typeof avvisoAcciacco === 'function' ? avvisoAcciacco(riga.ex, k) : null;
    if (av) box.append(av);
    if (riga.tecnica && riga.tecnica !== 'normale')
      box.append(el('div', 'hint', `<strong>${esc(t.nome)}</strong> — ${esc(t.d)}`));
    if (riga.superserie && ei > 0)
      box.append(el('div', 'hint',
        `Subito dopo ${esc(esercizio(sc.esercizi[ei - 1].ex)?.nome || '')}, senza recupero.`));

    const pp = prossimoPasso(riga.ex);
    if (pp) box.append(el('div', 'hint', esc(pp.testo)));
    else if (prec) box.append(el('div', 'hint',
      `L'ultima volta (${prec.k}): ${prec.serie.map(x => `${nf(x.kg, 1)}×${x.reps}`).join(', ')}.`));

    box.append(el('div', 'setrow sethead',
      '<span class="n"></span><span>kg</span><span>rip</span><span>RIR</span>'));
    for (let si = 0; si < riga.serie; si++) {
      const d = prec?.serie[si] || {};
      const row = el('div', 'setrow');
      row.innerHTML = `<span class="n">${si + 1}</span>
        <input type="text" inputmode="decimal" id="sc-${ei}-${si}-kg" value="${d.kg ?? riga.kg ?? ''}">
        <input type="text" inputmode="numeric" id="sc-${ei}-${si}-rp" value="${d.reps ?? ''}" placeholder="${lo}–${hi}">
        <input type="text" inputmode="numeric" id="sc-${ei}-${si}-rr" value="${d.rir ?? 2}">`;
      box.append(row);
      if (riga.tecnica === 'stripping') {
        const sr = el('div', 'field');
        sr.style.margin = '4px 0 8px';
        sr.innerHTML = `<input type="text" id="sc-${ei}-${si}-dr"
          value="${esc(scarichiTesto(d.drop))}" placeholder="scarichi: 50x6, 40x5">`;
        box.append(sr);
      }
    }
    w.append(box);
  }

  w.append(el('p', 'hint', RIR_SPIEGA));

  const salva = el('button', 'btn wide pri', 'Salva la seduta');
  salva.onclick = () => {
    const serie = [];
    for (const [ei, riga] of sc.esercizi.entries()) {
      if (!esercizio(riga.ex)) continue;
      for (let si = 0; si < riga.serie; si++) {
        const reps = parseNum(($('#sc-' + ei + '-' + si + '-rp') || {}).value);
        if (!(reps > 0)) continue;                 // serie non fatta: si salta
        const rec = { ex: riga.ex,
          kg: parseNum(($('#sc-' + ei + '-' + si + '-kg') || {}).value) ?? 0,
          reps, rir: parseNum(($('#sc-' + ei + '-' + si + '-rr') || {}).value) ?? 2 };
        if (riga.tecnica && riga.tecnica !== 'normale') rec.tecnica = riga.tecnica;
        if (riga.superserie) rec.superserie = true;
        const dr = parseScarichi(($('#sc-' + ei + '-' + si + '-dr') || {}).value);
        if (dr.length) rec.drop = dr;
        serie.push(rec);
      }
    }
    if (!serie.length) { toast('Non hai compilato nessuna serie'); return; }
    s.serie = serie;
    s.nome = sc.nome;
    s.scheda = sc.id;
    save(); closeSheet(); route();
    const nDrop = serie.reduce((a, x) => a + (x.drop?.length || 0), 0);
    toast(`${serie.length} serie registrate${nDrop ? ` + ${nDrop} scarichi` : ''}`);
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
  const ultimoEx = s.serie.length ? s.serie[s.serie.length - 1].ex : null;
  // il catalogo passa le quaranta voci: una ruota da far girare col pollice
  // non e' un modo di scegliere un esercizio. Si scrive, si sceglie.
  const selEx = selettoreCercabile(
    catalogo().slice().sort((a, b) => a.nome.localeCompare(b.nome))
      .map(e => ({ v: e.id, lab: e.nome, sub: e.attrezzo })),
    ultimoEx, () => aggiornaAvviso(), 'Cerca un esercizio…');
  selEx.style.marginBottom = '8px';
  box.append(selEx);
  const avv = el('div');
  const aggiornaAvviso = () => {
    avv.innerHTML = '';
    const x = typeof avvisoAcciacco === 'function' ? avvisoAcciacco(selEx.valore(), k) : null;
    if (x) avv.append(x);
  };
  aggiornaAvviso();
  box.append(avv);

  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 8px';
  const campo = (id, lab, val) => el('div', 'field',
    `<label>${lab}</label><input type="text" inputmode="decimal" id="s-${id}" value="${val ?? ''}">`);
  const prec = s.serie.filter(x => x.ex === ultimoEx).pop();
  g.append(campo('kg', 'kg', prec?.kg), campo('reps', 'rip', prec?.reps), campo('rir', 'RIR', prec?.rir ?? 2));
  box.append(g);

  box.append(el('div', 'hint', RIR_SPIEGA));

  const add = el('button', 'btn wide pri', 'Aggiungi serie');
  add.onclick = () => {
    const kg = parseNum($('#s-kg').value), reps = parseNum($('#s-reps').value);
    const rir = parseNum($('#s-rir').value) ?? 2;
    if (reps == null || reps <= 0) { toast('Servono le ripetizioni'); return; }
    s.serie.push({ ex: selEx.valore(), kg: kg ?? 0, reps, rir });
    s.nome = $('#s-nome').value.trim();
    save(); disegna();
    // la serie e' appena finita: il recupero parte da solo, che e' il momento
    // in cui serve. Il tocco su Aggiungi e' anche il gesto che sblocca l'audio
    const exf = esercizio(selEx.valore());
    avviaRecupero(recupeoConsigliato(exf), exf?.nome || 'recupero');
    toast('Serie aggiunta — recupero avviato');
  };
  box.append(add);
  const sugg = ultimoEx ? prossimoPasso(ultimoEx) : null;
  if (sugg) box.append(el('div', 'hint', esc(sugg.testo)));
  w.append(box);

  const back = el('button', 'btn wide', 'Usa una scheda invece');
  back.style.marginTop = '10px';
  back.onclick = () => { s.nome = $('#s-nome').value.trim(); save(); sheetSceltaModo(k); };
  w.append(back);

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
/* Una scheda e' la lista degli esercizi di una seduta: quali, quante serie, in
   che range di ripetizioni, con che tecnica. Il carico invece cambia ogni
   volta, e infatti si aggiorna quando la usi.
   Prima toccare una riga la CANCELLAVA e non c'era modo di modificarla: da qui
   l'impressione di poter inserire roba senza capire cosa. */

/* Sigla che compare in ogni modulo di registrazione: va spiegata dove la si
   digita, non solo nella documentazione. */
const RIR_SPIEGA = `<strong>RIR</strong> = ripetizioni in riserva: quante ne `
  + `avresti ancora potute fare a fine serie prima di fermarti. RIR 0 vuol dire `
  + `a cedimento, RIR 2 che te ne restavano due. Serve a rendere confrontabili `
  + `serie fatte con sforzo diverso, ed e' la variabile su cui l'app decide `
  + `quando farti aumentare il carico.`;

const TECNICHE = [
  { id: 'normale', nome: 'Normale',
    d: 'Serie standard con recupero pieno fra una e l\'altra.' },
  { id: 'stripping', nome: 'Stripping',
    d: 'Arrivi a fine serie, cali subito il peso e continui senza recupero. Ogni scarico conta come lavoro in piu\' nel volume settimanale.' },
  { id: 'rest-pause', nome: 'Rest-pause',
    d: 'Fine serie, 15-20 secondi di pausa, altre ripetizioni con lo stesso peso. Si registra come una serie sola col totale delle ripetizioni.' },
  { id: 'piramidale', nome: 'Piramidale',
    d: 'Il carico sale a ogni serie e le ripetizioni scendono. Il range indicato e\' quello dell\'ultima serie.' }
];
const tecnica = id => TECNICHE.find(t => t.id === id) || TECNICHE[0];

/** Etichette A1/A2/B/C: le lettere raggruppano le superserie. */
function etichetteScheda(esercizi) {
  const out = [];
  let lettera = 64, dentro = 0;
  for (const [i, e] of esercizi.entries()) {
    if (i === 0 || !e.superserie) { lettera++; dentro = 1; }
    else dentro++;
    const gruppo = String.fromCharCode(lettera);
    const prossimo = esercizi[i + 1];
    const inGruppo = dentro > 1 || (prossimo && prossimo.superserie);
    out.push({ testo: inGruppo ? gruppo + dentro : gruppo, gruppo, inGruppo });
  }
  return out;
}

function sheetSchede() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Schede'));
  w.append(el('h2', 'sec', 'Le tue schede'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Una scheda e\' la lista degli esercizi di una seduta: <strong>quali, quante serie e in che range di ripetizioni</strong>. Il carico no: quello cambia ogni volta, e lo aggiorni quando la usi.'));
  const list = schede();
  if (!list.length) w.append(el('p', 'hint', 'Nessuna scheda ancora.'));
  for (const sc of list) {
    const r = el('button', 'prod');
    const nSer = sc.esercizi.reduce((a, e) => a + (e.serie || 0), 0);
    r.innerHTML = `<div class="grow"><div class="nm">${esc(sc.nome)}</div>
      <div class="mt">${sc.esercizi.length} esercizi · ${nSer} serie</div></div>
      <div class="kc">apri &rsaquo;</div>`;
    r.onclick = () => sheetScheda(sc.id);
    w.append(r);
  }
  const b = el('button', 'btn wide pri', 'Nuova scheda');
  b.style.marginTop = '10px';
  b.onclick = () => sheetScheda(null);
  w.append(b);
  sheet(w);
}

function sheetScheda(id, statoPre) {
  const sc = id ? scheda(id) : { id: uid(), nome: '', esercizi: [] };
  // statoPre serve a tornare qui dall'editor di una riga senza perdere ne'
  // il nome che stavi scrivendo ne' le righe aggiunte e non ancora salvate
  const stato = statoPre || { nome: sc.nome, esercizi: sc.esercizi.map(x => ({ ...x })) };

  const w = el('div');
  w.append(el('div', 'eyebrow', id ? 'Scheda' : 'Nuova scheda'));
  w.append(el('h2', 'sec', 'Cosa contiene'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Metti gli esercizi nell\'ordine in cui li fai. Per ognuno: quante serie e fra quante e quante ripetizioni vuoi stare. Il peso di partenza e\' facoltativo — se lo lasci vuoto, la prima volta lo scrivi mentre ti alleni.'));
  w.append(el('div', 'field',
    `<label>Nome della scheda</label>
     <input type="text" id="sk-nome" value="${esc(stato.nome)}" placeholder="Esempio: Push A">`));

  const lista = el('div');
  const disegna = () => {
    lista.innerHTML = '';
    if (!stato.esercizi.length) {
      lista.append(el('p', 'muted', 'Ancora nessun esercizio. Usa il pulsante qui sotto.'));
      return;
    }
    lista.append(el('div', 'sk-h',
      '<span></span><span>Esercizio</span><span>Serie</span><span>Rip</span><span>kg</span><span></span>'));
    const et = etichetteScheda(stato.esercizi);
    stato.esercizi.forEach((riga, i) => {
      const ex = esercizio(riga.ex);
      const t = tecnica(riga.tecnica);
      const r = el('button', 'sk-r' + (et[i].inGruppo ? ' grp' : ''));
      r.innerHTML = `<span class="g">${et[i].testo}</span>
        <span class="nm">${esc(ex?.nome || riga.ex)}
          ${riga.tecnica && riga.tecnica !== 'normale'
            ? `<em>${esc(t.nome.toLowerCase())}</em>` : ''}</span>
        <span class="v">${riga.serie}</span>
        <span class="v">${riga.reps}–${riga.repsMax || riga.reps}</span>
        <span class="v">${riga.kg ? nf(riga.kg, 1) : '—'}</span>
        <span class="go">›</span>`;
      r.onclick = () => {
        stato.nome = $('#sk-nome').value;      // non perdere quello che ha scritto
        sheetRigaScheda(stato, i, () => sheetScheda(id, stato));
      };
      lista.append(r);
    });
    const gruppi = new Set(et.filter(x => x.inGruppo).map(x => x.gruppo));
    if (gruppi.size) lista.append(el('p', 'hint',
      'Le righe con la stessa lettera sono in superserie: si fanno una dietro l\'altra senza recupero in mezzo.'));
  };
  disegna();
  w.append(lista);

  const badd = el('button', 'btn wide', '+ Aggiungi un esercizio');
  badd.style.marginTop = '10px';
  badd.onclick = () => {
    stato.nome = $('#sk-nome').value;
    sheetRigaScheda(stato, null, () => sheetScheda(id, stato));
  };
  w.append(badd);

  const salva = el('button', 'btn wide pri', 'Salva la scheda');
  salva.style.marginTop = '8px';
  salva.onclick = () => {
    const nome = $('#sk-nome').value.trim();
    if (!nome) { toast('Serve il nome della scheda'); return; }
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

/** Una riga della scheda: si apre per modificarla, non per cancellarla. */
function sheetRigaScheda(stato, idx, onChiudi) {
  const nuovo = idx == null;
  const riga = nuovo
    ? { ex: catalogo()[0]?.id, serie: 3, reps: 8, repsMax: 12, kg: 0,
        tecnica: 'normale', superserie: false }
    : { ...stato.esercizi[idx] };

  const w = el('div');
  w.append(el('div', 'eyebrow', nuovo ? 'Aggiungi' : 'Modifica'));
  w.append(el('h2', 'sec', nuovo ? 'Un esercizio nella scheda'
    : esc(esercizio(riga.ex)?.nome || riga.ex)));
  w.lastChild.style.marginTop = '0';

  if (nuovo) {
    const f = el('div', 'field', '<label>Quale esercizio</label>');
    const sel = el('select');
    sel.id = 'rg-ex';
    sel.style.cssText = 'width:100%;padding:10px;border:1px solid var(--rule);'
      + 'border-radius:9px;background:var(--paper);color:var(--ink);font:inherit';
    for (const e of catalogo().slice().sort((a, b) => a.nome.localeCompare(b.nome)))
      sel.append(new Option(`${e.nome} — ${e.attrezzo}`, e.id, false, e.id === riga.ex));
    sel.onchange = () => {
      const ex = esercizio(sel.value);
      if (ex?.range) { $('#rg-lo').value = ex.range[0]; $('#rg-hi').value = ex.range[1]; }
    };
    f.append(sel);
    f.append(el('div', 'hint', 'Non lo trovi? Aggiungilo da "I tuoi esercizi" nella scheda Gym.'));
    w.append(f);
  }

  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0 8px';
  g.innerHTML = `<div class="field"><label>Serie</label>
      <input type="text" inputmode="numeric" id="rg-serie" value="${riga.serie}"></div>
    <div class="field"><label>Rip da</label>
      <input type="text" inputmode="numeric" id="rg-lo" value="${riga.reps}"></div>
    <div class="field"><label>Rip a</label>
      <input type="text" inputmode="numeric" id="rg-hi" value="${riga.repsMax || riga.reps}"></div>
    <div class="field"><label>kg</label>
      <input type="text" inputmode="decimal" id="rg-kg" value="${riga.kg || ''}"></div>`;
  w.append(g);
  w.append(el('p', 'hint',
    'Il range di ripetizioni serve alla doppia progressione: si sale di carico solo quando tutte le serie arrivano al numero piu\' alto.'));

  /* tecnica */
  const ft = el('div', 'field', '<label>Tecnica</label>');
  const seg = el('div', 'seg');
  const spieg = el('div', 'hint');
  const dipingi = () => {
    [...seg.children].forEach(b => b.setAttribute('aria-pressed',
      b.dataset.t === (riga.tecnica || 'normale')));
    spieg.textContent = tecnica(riga.tecnica).d;
  };
  for (const t of TECNICHE) {
    const b = el('button', null, t.nome);
    b.dataset.t = t.id;
    b.onclick = () => { riga.tecnica = t.id; dipingi(); };
    seg.append(b);
  }
  ft.append(seg); ft.append(spieg); dipingi();
  w.append(ft);

  /* superserie */
  const primo = !nuovo && idx === 0;
  if (!primo) {
    const fs = el('div', 'field', '<label>Superserie</label>');
    const ss = el('div', 'seg');
    for (const [val, lab] of [[false, 'A se stante'], [true, 'Attaccato al precedente']]) {
      const b = el('button', null, lab);
      b.setAttribute('aria-pressed', !!riga.superserie === val);
      b.onclick = () => { riga.superserie = val;
        [...ss.children].forEach(x => x.setAttribute('aria-pressed', x.textContent === lab)); };
      ss.append(b);
    }
    fs.append(ss);
    fs.append(el('div', 'hint',
      'Attaccato al precedente significa: lo fai subito dopo, senza recupero in mezzo. Le due righe prendono la stessa lettera (A1, A2).'));
    w.append(fs);
  }

  /* posizione */
  if (!nuovo && stato.esercizi.length > 1) {
    const fp = el('div', 'field', '<label>Posizione</label>');
    const rp = el('div', 'seg');
    const su = el('button', null, '↑ Su'), giu = el('button', null, '↓ Giu');
    su.onclick = () => {
      if (idx === 0) return;
      stato.esercizi.splice(idx - 1, 0, stato.esercizi.splice(idx, 1)[0]);
      onChiudi();
    };
    giu.onclick = () => {
      if (idx >= stato.esercizi.length - 1) return;
      stato.esercizi.splice(idx + 1, 0, stato.esercizi.splice(idx, 1)[0]);
      onChiudi();
    };
    rp.append(su, giu); fp.append(rp); w.append(fp);
  }

  const ok = el('button', 'btn wide pri', nuovo ? 'Aggiungi alla scheda' : 'Salva');
  ok.onclick = () => {
    const n = parseNum($('#rg-serie').value);
    if (!(n > 0 && n <= 12)) { toast('Da 1 a 12 serie'); return; }
    const lo = parseNum($('#rg-lo').value) ?? 8;
    const hi = parseNum($('#rg-hi').value) ?? lo;
    const rec = {
      ex: nuovo ? $('#rg-ex').value : riga.ex,
      serie: Math.round(n), reps: Math.round(lo), repsMax: Math.round(Math.max(lo, hi)),
      kg: parseNum($('#rg-kg').value) ?? 0,
      tecnica: riga.tecnica || 'normale', superserie: !!riga.superserie
    };
    if (nuovo) stato.esercizi.push(rec); else stato.esercizi[idx] = rec;
    onChiudi();                        // torna alla scheda, non chiude tutto
  };
  w.append(ok);

  const ann = el('button', 'btn wide', 'Annulla');
  ann.style.marginTop = '8px';
  ann.onclick = () => onChiudi();
  w.append(ann);

  if (!nuovo) {
    const del = el('button', 'btn wide', 'Togli dalla scheda');
    del.style.marginTop = '8px';
    del.onclick = () => { stato.esercizi.splice(idx, 1); onChiudi(); };
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
