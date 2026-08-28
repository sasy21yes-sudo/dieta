/* Dieta — PWA offline per il piano vegano di ricomposizione.
   Nessuna dipendenza, nessun build step. Stato in localStorage. */
'use strict';

const KEY = 'dieta.v1';
let D = null;                 // dieta.json
let S = null;                 // stato utente

/* ---------------------------------------------------------------- utils */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t);
  if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const nf = (n, d = 0) => n.toLocaleString('it-IT',
  { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dkey = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10); };
const today = () => dkey(new Date());
const dayIdx = d => (new Date(d).getDay() + 6) % 7;   // 0 = lunedì
const addDays = (k, n) => { const d = new Date(k); d.setDate(d.getDate() + n); return dkey(d); };

/**
 * Legge un numero accettando sia il punto sia la virgola. Serve perché su
 * tastiera italiana si digita 67,5 e <input type="number"> considera quel
 * valore non valido: .value torna stringa vuota, +"" fa 0, e il campo diventa
 * inutilizzabile senza dare nessun errore. Per questo i campi numerici sono
 * type="text" con inputmode="decimal": la tastiera resta quella dei numeri,
 * ma il testo digitato arriva intero fin qui.
 */
function parseNum(v) {
  if (v == null) return undefined;
  const t = String(v).trim().replace(',', '.');
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return undefined;
  const n = parseFloat(t);
  return isNaN(n) ? undefined : n;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2200);
}

/* ---------------------------------------------------------------- stato */
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)) || null; } catch { S = null; }
  if (!S) S = { log: {}, spesa: {}, settings: { start: today() } };
  normalize();
}
/** Riempie i campi mancanti: serve all'avvio e dopo l'import di un backup
    vecchio, scritto da una versione che certe chiavi non le aveva. */
function normalize() {
  S.log ||= {}; S.spesa ||= {}; S.settings ||= { start: today() };
  S.model ||= {}; S.model.prev ||= []; S.prodotti ||= [];
  S.palestra ||= {}; S.palestra.sessioni ||= {}; S.palestra.esercizi ||= [];
  for (const k of Object.keys(S.log)) {
    const d = S.log[k]; if (!d || typeof d !== 'object') { delete S.log[k]; continue; }
    d.pasti ||= {}; d.extra ||= []; d.misure ||= {}; d.integratori ||= {};
  }
}

/**
 * Accetta anche i backup delle versioni precedenti. Un file vecchio non ha
 * model, prodotti o palestra, e puo' avere giornate senza le sotto-chiavi:
 * normalize() le ricostruisce. Se il file e' direttamente la mappa dei giorni
 * (formato piu' vecchio, senza involucro) lo si riconosce dalle chiavi-data e
 * lo si avvolge, invece di rifiutarlo.
 */
function migra(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.log && typeof o.log === 'object') return o;
  const chiavi = Object.keys(o);
  const sonoDate = chiavi.length && chiavi.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (sonoDate) return { log: o, spesa: {}, settings: { start: chiavi.sort()[0] } };
  return null;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { toast('Memoria piena: esporta un backup'); }
}
function day(k = today()) {
  S.log[k] ||= { pasti: {}, extra: [], misure: {}, integratori: {} };
  const d = S.log[k];
  d.pasti ||= {}; d.extra ||= []; d.misure ||= {}; d.integratori ||= {};
  return d;
}

/* ------------------------------------------------------------ nutrizione */
const M0 = () => ({ kcal: 0, p: 0, c: 0, g: 0, fibre: 0 });
function addM(a, b, k = 1) {
  for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) a[x] += (b[x] || 0) * k;
  return a;
}
function foodM(nome, qta) {
  const a = alimento(nome); if (!a) return M0();   // rispetta i prodotti reali
  const m = M0(); return addM(m, a, qta / 100);
}
function mealM(code) {
  const p = D.pasti[code]; if (!p) return M0();
  // I macro del piano sono precalcolati e verificati a monte: si usano cosi'
  // come sono. L'unica eccezione e' un ingrediente per cui l'utente ha
  // registrato il prodotto vero letto in etichetta — li' la stima va superata.
  if (p.ingredienti && p.ingredienti.some(i => overrideDi(i.alimento))) {
    const m = M0();
    for (const i of p.ingredienti) addM(m, foodM(i.alimento, i.qta));
    return m;
  }
  return { ...p.macro };
}
/** Macro effettivamente consumate: pasti spuntati + extra fuori piano. */
function consumed(k) {
  const d = day(k), t = M0();
  const plan = D.settimana[dayIdx(k)];
  for (const s of plan.pasti) if (d.pasti[s.codice]) addM(t, mealM(s.codice));
  for (const e of d.extra) addM(t, e);
  return t;
}
function dayTarget(k) { return D.settimana[dayIdx(k)].totali; }

/* --------------------------------------------------- motore sostituzioni */
/** Trova alimenti della stessa categoria che replicano il macro dominante. */
function swaps(nome, qta, n = 5) {
  const a = alimento(nome); if (!a) return [];
  const src = foodM(nome, qta);
  // se >20% delle calorie viene da proteine, la proteina è il vincolo
  const dom = a.kcal && (a.p * 4) / a.kcal > 0.2 ? 'p' : 'kcal';
  const out = [];
  for (const k of Object.keys(D.alimenti)) {
    const v = alimento(k);
    if (k === nome || v.categoria !== a.categoria) continue;
    if (!v[dom]) continue;
    const q = (src[dom] / v[dom]) * 100;
    if (q < 3 || q > 900) continue;
    const m = foodM(k, q);
    // distanza normalizzata su kcal e sui tre macro
    let dist = 0;
    for (const x of ['kcal', 'p', 'c', 'g']) {
      const base = Math.max(src[x], 5);
      dist += Math.abs(m[x] - src[x]) / base;
    }
    out.push({ nome: k, qta: q, macro: m, dist, unita: v.unita, fonte: v.fonte });
  }
  out.sort((x, y) => x.dist - y.dist);
  return out.slice(0, n);
}

/* ------------------------------------------------------- medie e trend */
function lastDays(k, n) {
  const out = []; for (let i = 0; i < n; i++) out.push(addDays(k, -i)); return out;
}
/**
 * Ancora delle medie: il giorno PRIMA di quello indicato.
 * Oggi e' una giornata a meta' — i pasti non sono ancora tutti spuntati, i
 * passi non sono ancora tutti fatti — e infilarla in una media la tira giu'
 * sistematicamente. Le medie di comportamento e introito si fermano a ieri.
 * Il peso fa eccezione ed e' l'unica: la pesata del mattino e' un dato
 * completo, non un pezzo di giornata, quindi la tendenza la usa subito.
 */
const ieri = (k = today()) => addDays(k, -1);
/** Finestra di n giorni che finisce ieri. */
function windowDays(k, n) { return lastDays(ieri(k), n); }
function avg(vals) {
  const v = vals.filter(x => typeof x === 'number' && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function weightMA(k, n = 7) {
  return avg(lastDays(k, n).map(d => S.log[d]?.peso));
}
function measTrend(id, k) {
  const days = Object.keys(S.log).filter(d => S.log[d]?.misure?.[id] != null).sort();
  if (days.length < 2) return null;
  const last = S.log[days[days.length - 1]].misure[id];
  const first = S.log[days[0]].misure[id];
  return { last, delta: last - first, n: days.length };
}

/* ------------------------------------------------ composizione corporea */
/** Ultima misura registrata per un punto, con fallback sul valore di partenza. */
function lastMeas(id) {
  const days = Object.keys(S.log).filter(d => S.log[d]?.misure?.[id] != null).sort();
  if (days.length) return S.log[days[days.length - 1]].misure[id];
  return D.misure.find(x => x.id === id)?.base ?? null;
}
function lastWeight() {
  const days = Object.keys(S.log).filter(d => S.log[d]?.peso != null).sort();
  return days.length ? S.log[days[days.length - 1]].peso : null;
}

/** Formula della Marina USA. Errore reale ±3–4 punti: è una stima, non una DEXA. */
function bodyFat(vita, collo, h) {
  if (!(vita > 0 && collo > 0 && h > 0) || vita - collo < 5) return null;
  const bf = 495 / (1.0324 - 0.19077 * Math.log10(vita - collo)
                           + 0.15456 * Math.log10(h)) - 450;
  return bf > 2 && bf < 60 ? bf : null;
}

/** Composizione stimata oggi, già confrontata con il fisico target. */
function composition(k = today()) {
  const h = D.profilo.altezza_cm, TF = D.target_fisico;
  const vita = lastMeas('vita'), collo = lastMeas('collo'), torace = lastMeas('torace');
  const peso = trendW(k) ?? lastWeight() ?? D.profilo.peso_iniziale_kg;
  // un collo fuori scala falsa tutto: 7 cm di errore valgono 5 punti di grasso
  const colloSospetto = collo != null && (collo < 32 || collo > 48);
  const bf = colloSospetto ? null : bodyFat(vita, collo, h);
  const lbm = bf != null ? peso * (1 - bf / 100) : null;
  const fm = bf != null ? peso - lbm : null;
  return {
    peso, vita, collo, torace, colloSospetto, bf, lbm, fm,
    vitaAltezza: vita ? vita / h : null,
    toraceVita: torace && vita ? torace / vita : null,
    t: { peso: TF.peso_kg, bf: TF.bf_pct, lbm: TF.massa_magra_kg,
         vitaAltezza: TF.rapporti.vita_altezza, toraceVita: TF.rapporti.torace_vita },
    dLbm: lbm != null ? TF.massa_magra_kg - lbm : null,
    dFm: fm != null ? fm - (TF.peso_kg * TF.bf_pct / 100) : null
  };
}

/* --------------------------------------------- motore di previsione */
/** Peso di tendenza: media su finestra elastica, tollera i giorni saltati. */
function trendW(k = today(), n = 7) {
  const vals = [];
  for (let i = 0; i < n * 2 && vals.length < n; i++) {
    const w = S.log[addDays(k, -i)]?.peso;
    if (w != null) vals.push(w);
  }
  return vals.length ? avg(vals) : null;
}

/** Rumore giornaliero misurato sui dati dell'utente, non su una costante. */
function dailyNoise() {
  const res = [];
  for (const d of Object.keys(S.log).sort()) {
    if (S.log[d]?.peso == null) continue;
    const ma = weightMA(d, 7);
    if (ma != null) res.push(S.log[d].peso - ma);
  }
  if (res.length < 8) return D.modello.sigma_peso_giornaliero;
  const m = avg(res);
  return Math.max(0.2, Math.min(2, Math.sqrt(avg(res.map(x => (x - m) ** 2)))));
}

/** Dispendio a priori: Mifflin-St Jeor × fattore di attività. */
function priorTDEE() {
  const p = D.profilo, w = lastWeight() ?? p.peso_iniziale_kg;
  const bmr = 10 * w + 6.25 * p.altezza_cm - 5 * p.eta + (p.sesso === 'm' ? 5 : -161);
  return bmr * D.modello.laf;
}

/**
 * Dispendio osservato su una finestra, dal bilancio energetico:
 *   TDEE = introito medio − (variazione del peso di tendenza × 7700) / giorni
 */
function observedTDEE(k, span) {
  const M = D.modello;
  k = ieri(k);                       // l'introito di oggi e' ancora parziale
  const w1 = trendW(k), w0 = trendW(addDays(k, -span));
  if (w1 == null || w0 == null) return null;
  const ins = [];
  for (let i = 0; i < span; i++) {
    const dk = addDays(k, -i);
    const c = S.log[dk] ? consumed(dk) : null;
    if (c && c.kcal > 800) ins.push(c.kcal);
  }
  if (ins.length < Math.ceil(span * 0.6)) return null;
  const intake = avg(ins), dw = w1 - w0;
  // il peso di tendenza è una media di ~7 pesate: l'errore sulla differenza di
  // due medie vale sigma·√(2/7), riportato al giorno dividendo per span
  const sigma = Math.max(40, (dailyNoise() * M.kcal_per_kg * Math.sqrt(2 / 7)) / span);
  return { tdee: intake - (dw * M.kcal_per_kg) / span, sigma, intake, dw, span,
           copertura: ins.length / span };
}

/**
 * Filtro di Kalman sul dispendio: parte dalla formula, poi a ogni finestra
 * confronta previsto e osservato e sposta la stima di quanto merita — poco
 * se l'osservazione è rumorosa, molto se è pulita. Se le ultime innovazioni
 * puntano tutte nello stesso verso il modello è rimasto indietro, e allora
 * gli si allarga il passo perché recuperi.
 */
let _mkey = null, _mval = null;
function energyModel(k = today()) {
  const sig = k + '|' + Object.keys(S.log).length + '|' + (S.model?.rev || 0);
  if (_mkey === sig) return _mval;
  const M = D.modello, days = Object.keys(S.log).filter(x => x <= k).sort();
  let mu = priorTDEE(), s2 = M.sigma_tdee_prior ** 2;
  const steps = [], innov = [];
  const span = Math.max(14, M.min_giorni_calibrazione);
  let prev = null;
  for (let cur = addDays(days[0] || k, span); cur <= k; cur = addDays(cur, 7)) {
    const o = observedTDEE(cur, span);
    if (!o) continue;
    const gap = prev ? Math.round((new Date(cur) - new Date(prev)) / 864e5) : span;
    let q = (M.deriva_tdee_giorno ** 2) * gap;
    if (innov.length >= 3 && Math.abs(innov.slice(-3).reduce((a, b) => a + b, 0)) === 3) q *= 4;
    s2 += q;
    const K = s2 / (s2 + o.sigma ** 2), y = o.tdee - mu;
    mu += K * y; s2 = (1 - K) * s2;
    innov.push(Math.sign(y));
    steps.push({ k: cur, obs: o.tdee, mu, K, sigma: Math.sqrt(s2), copertura: o.copertura });
    prev = cur;
  }
  _mkey = sig;
  _mval = { tdee: mu, sigma: Math.sqrt(s2), n: steps.length, steps,
            prior: priorTDEE(), ultimo: steps[steps.length - 1] || null };
  return _mval;
}

/** Previsione del peso di tendenza a h giorni, con banda di confidenza. */
function forecast(h, intake, k = today()) {
  const M = D.modello, E = energyModel(k), w = trendW(k);
  if (w == null) return null;
  const rate = (intake - E.tdee) / M.kcal_per_kg;          // kg al giorno
  const sTrend = dailyNoise() / Math.sqrt(7);
  const sTdee = (E.sigma * h) / M.kcal_per_kg;
  const sd = Math.sqrt(sTdee ** 2 + sTrend ** 2);
  return { h, base: w, peso: w + rate * h, delta: rate * h, settimana: rate * 7,
           sd, banda: 1.96 * sd, tdee: E.tdee, sigmaTdee: E.sigma, intake,
           n: E.n, rumore: dailyNoise() };
}

/** Introito medio reale delle ultime due settimane, se ce n'è abbastanza. */
function realIntake(k = today()) {
  const o = observedTDEE(k, 14) || observedTDEE(k, 21);
  return o ? o.intake : null;
}

/* ------------------------------------------- registro delle previsioni */
/** Deposita le previsioni di oggi, così potranno essere verificate a scadenza. */
function ledgerRecord(k = today()) {
  S.model ||= {}; S.model.prev ||= [];
  if (trendW(k) == null) return;
  let added = 0;
  for (const h of [7, 14]) {
    if (S.model.prev.some(p => p.fatta === k && p.h === h)) continue;
    const f = forecast(h, D.target.kcal, k);
    if (!f) continue;
    S.model.prev.push({ fatta: k, h, target: addDays(k, h),
      previsto: +f.peso.toFixed(2), banda: +f.banda.toFixed(2),
      tdee: Math.round(f.tdee) });
    added++;
  }
  if (S.model.prev.length > 80) S.model.prev = S.model.prev.slice(-80);
  if (added) save();
}

/** Verifica le previsioni scadute contro il dato reale: è la pagella del motore. */
function ledgerScore(k = today()) {
  const L = S.model?.prev || [], done = [];
  for (const p of L) {
    if (p.target > k) continue;
    const real = trendW(p.target);
    if (real == null) continue;
    p.reale = +real.toFixed(2);
    p.errore = +(real - p.previsto).toFixed(2);
    p.dentro = Math.abs(p.errore) <= p.banda;
    done.push(p);
  }
  const aperte = L.filter(p => p.target > k).length;
  if (!done.length) return { n: 0, aperte };
  const errs = done.map(p => p.errore);
  return { n: done.length, aperte, mae: avg(errs.map(Math.abs)), bias: avg(errs),
           colpiti: done.filter(p => p.dentro).length / done.length,
           ultime: done.slice(-6) };
}

/* ------------------------------------------------- motore "cosa sbaglio" */
function analyse(k = today()) {
  const F = [], T = D.target;
  const d7 = windowDays(k, 7), d14 = windowDays(k, 14);
  const logged = d7.filter(x => S.log[x]).length;

  if (logged < 3) {
    F.push(['warn', '!', 'Servono più dati',
      `Hai registrato ${logged} giorni sugli ultimi 7. L'analisi diventa affidabile da 7 giorni in su — prima di allora qualsiasi conclusione è rumore.`]);
    return F;
  }

  // --- calorie e proteine effettive (dai pasti spuntati)
  const cons = d7.map(x => S.log[x] ? consumed(x) : null).filter(Boolean)
                 .filter(m => m.kcal > 400);
  if (cons.length >= 3) {
    const ak = avg(cons.map(m => m.kcal)), ap = avg(cons.map(m => m.p));
    const af = avg(cons.map(m => m.fibre));
    const dk = (ak - T.kcal) / T.kcal;
    if (dk < -0.10) F.push(['bad', '↓', 'Mangi meno del piano',
      `Media ${nf(ak)} kcal contro un target di ${nf(T.kcal)} (${nf(dk * 100, 0)}%). In ricomposizione il deficit involontario è il modo più comune di non crescere: stai allenandoti senza il materiale per costruire.`]);
    else if (dk > 0.10) F.push(['warn', '↑', 'Mangi più del piano',
      `Media ${nf(ak)} kcal contro ${nf(T.kcal)}. Non è un dramma su una settimana, ma se continua vedrai salire la vita prima dei carichi.`]);
    if (ap < T.p * 0.9) F.push(['bad', 'P', 'Proteine sotto target',
      `Media ${nf(ap, 1)} g contro ${T.p} g. È la variabile che protegge la massa magra: prima di toccare qualsiasi altra cosa, sistema questa.`]);
    if (af && af < 25) F.push(['warn', 'F', 'Fibre basse',
      `Media ${nf(af, 1)} g. Il piano ne prevede ~${T.fibre}. Se stai saltando i legumi, stai anche perdendo ferro e sazietà.`]);
  }

  // --- peso: media mobile 7 giorni contro quella di 7 giorni prima
  const ma = weightMA(k), maPrev = weightMA(addDays(k, -7));
  const pesate = d14.filter(x => S.log[x]?.peso != null).length;
  if (ma && maPrev && pesate >= 8) {
    const rate = ma - maPrev;                        // kg / settimana
    const vita = measTrend('vita', k);
    const vTrend = vita ? (vita.delta > 1 ? 'su' : vita.delta < -1 ? 'giu' : 'stabile') : 'stabile';
    const car = S.settings.carichi || 'fermi';
    let hit = null;
    for (const r of D.regole_calorie) {
      const [lo, hi] = r.peso_kg_sett;
      if (rate >= lo && rate <= hi && r.vita === vTrend && r.carichi === car) { hit = r; break; }
    }
    const seg = `Media mobile ${nf(ma, 2)} kg (${rate >= 0 ? '+' : ''}${nf(rate, 2)} kg/sett), vita ${vTrend}, carichi ${car}.`;
    if (hit && hit.azione === 0)
      F.push(['ok', '✓', hit.esito, `${seg} È lo scenario che stavi cercando: non cambiare le calorie.`]);
    else if (hit)
      F.push(['warn', hit.azione > 0 ? '↑' : '↓', hit.esito,
        `${seg} La regola dice: ${hit.azione > 0 ? '+' : ''}${hit.azione} kcal/die. Aspetta di avere 3 settimane piene prima di applicarla.`]);
    else
      F.push(['ok', '=', 'Andamento nella norma', seg]);
  } else {
    F.push(['warn', '!', 'Pesate insufficienti',
      `${pesate} pesate negli ultimi 14 giorni. Servono almeno 8 per calcolare una media mobile che significhi qualcosa. Pesati al mattino, dopo il bagno, prima di bere.`]);
  }

  // --- idratazione, sonno, Coca Zero, passi
  const aq = avg(d7.map(x => S.log[x]?.acqua));
  if (aq != null && aq < 2) F.push(['warn', 'H', 'Bevi poco',
    `Media ${nf(aq, 1)} L al giorno contro un target di ${T.acqua_l} L. Con ${T.fibre} g di fibre l'acqua non è opzionale: fibre alte e acqua bassa significano gonfiore e stitichezza.`]);

  const sn = avg(d7.map(x => S.log[x]?.sonno));
  if (sn != null && sn < 6.5) F.push(['bad', 'Z', 'Dormi troppo poco',
    `Media ${nf(sn, 1)} ore. Il sonno insufficiente abbassa la sintesi proteica e alza la fame serale. Passare a 7 ore farebbe più della somma di tutti gli aggiustamenti sui macro.`]);

  const cz = avg(d7.map(x => S.log[x]?.coca));
  if (cz != null && cz >= 3) F.push(['warn', 'C', 'Molta Coca Zero',
    `Media ${nf(cz, 1)} lattine al giorno. Non è un problema calorico, è un problema di caffeina: l'emivita è 5–6 ore, quindi quella delle 18:00 è ancora in circolo a mezzanotte. Stop dopo le 16:00.`]);

  const ps = avg(d7.map(x => S.log[x]?.passi));
  if (ps != null && ps < 6000) F.push(['warn', 'S', 'Passi in calo',
    `Media ${nf(ps)} al giorno. Sei già molto sedentario: i passi sono la leva più indolore per alzare il dispendio senza toccare la dieta.`]);

  // --- aderenza e pasti fuori piano
  const ad = d7.map(x => S.log[x]?.aderenza).filter(Boolean);
  const ok = ad.filter(a => a === 'ok').length;
  if (ad.length >= 4 && ok / ad.length < 0.7) F.push(['warn', 'A', 'Aderenza bassa',
    `${ok} giorni pieni su ${ad.length}. Se succede spesso non è mancanza di disciplina: è il piano che non ti sta bene. Guarda i motivi che hai annotato e cambia i pasti che salti sempre.`]);

  // --- sintomi gastrointestinali -> indizio glutine
  const gi = d7.filter(x => S.log[x]?.gi).length;
  if (gi >= 2) F.push(['warn', 'G', 'Sintomi gastrointestinali ricorrenti',
    `${gi} giorni su 7. Straccetti Garden Gourmet e Fette Veg contengono glutine di frumento come primo ingrediente proteico. Provane una settimana senza e vedi se cambia qualcosa.`]);

  // --- B12
  const b12 = d7.some(x => S.log[x]?.integratori?.['B12 (cianocobalamina)']);
  if (!b12) F.push(['bad', 'B', 'B12 non registrata',
    `Nessuna assunzione negli ultimi 7 giorni. È l'unico integratore non negoziabile di una dieta vegana e la carenza è silenziosa per mesi.`]);

  // --- distribuzione proteica di oggi
  const dd = day(k), plan = D.settimana[dayIdx(k)];
  const main = plan.pasti.filter(s => ['Colazione', 'Pranzo', 'Cena'].includes(s.slot));
  const low = main.filter(s => dd.pasti[s.codice] && D.pasti[s.codice].macro.p < T.min_p_per_pasto);
  if (low.length) F.push(['warn', 'L', 'Dose proteica bassa in un pasto',
    `Oggi ${low.length} pasto/i principali sotto i ${T.min_p_per_pasto} g. Da fonti vegetali sotto quella soglia la leucina non basta ad attivare la sintesi proteica: meglio ridistribuire che aggiungere alla fine della giornata.`]);

  if (!F.some(f => f[0] !== 'ok')) F.unshift(['ok', '✓', 'Niente da correggere',
    'Sugli ultimi 7 giorni non emergono scostamenti. Continua così e lascia lavorare il tempo.']);
  return F;
}

/* ---------------------------------------------------------- persistenza */
/**
 * Su iOS i dati di questa app vivono soltanto qui: niente server, niente
 * account, nessuna copia altrove. Sopravvivono alla chiusura e al riavvio del
 * telefono, ma NON a "Cancella dati siti web" e non alla rimozione dell'app
 * dalla schermata Home. Per questo l'export non e' un extra: e' la rete.
 */
async function persist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();   // il browser puo' rifiutare
  } catch { return false; }
}

/** Giorni con qualcosa dentro davvero, non solo la struttura vuota. */
function loggedDays() {
  return Object.keys(S.log).filter(k => {
    const d = S.log[k]; if (!d) return false;
    return d.peso != null || Object.keys(d.pasti || {}).length
        || Object.keys(d.misure || {}).length;
  }).sort();
}

/** Giorni registrati dall'ultimo backup; 0 se non e' ancora il caso di insistere. */
function backupDue() {
  const days = loggedDays(); if (!days.length) return 0;
  const last = S.settings.backup;
  const nuovi = last ? days.filter(k => k > last).length : days.length;
  return nuovi >= 20 ? nuovi : 0;
}

function exportBackup() {
  download('dieta-backup-' + today() + '.json', JSON.stringify(S, null, 1),
           'application/json');
  S.settings.backup = today(); save();
}

/** Promemoria in cima a Oggi, solo quando serve davvero. */
function backupBanner(v) {
  const n = backupDue(); if (!n) return;
  const mai = !S.settings.backup;
  const c = el('div', 'card flat');
  c.append(el('div', 'eyebrow', 'Backup'));
  c.append(el('div', 'muted', n + ' giorni registrati ' + (mai
    ? 'e nessun backup finora' : 'dall\'ultimo backup')
    + '. Se svuoti i dati di Safari o togli l\'app dalla schermata Home questo '
    + 'storico non torna piu\': non ne esiste una copia da nessun\'altra parte.'));
  const b = el('button', 'btn wide', 'Esporta adesso');
  b.style.marginTop = '10px';
  b.onclick = () => { exportBackup(); route(); toast('Backup scaricato'); };
  c.append(b);
  v.append(c);
}

/* --------------------------------------------------------------- router */
const ROUTES = { oggi: viewOggi, diario: viewDiario, corpo: viewCorpo,
                 dati: viewDati, analisi: viewAnalisi, spesa: viewSpesa,
                 prodotti: viewProdotti, foto: viewFoto };
const TITLES = { oggi: 'Oggi', diario: 'Diario', corpo: 'Corpo',
                 dati: 'Dati', analisi: 'Analisi', spesa: 'Spesa',
                 prodotti: 'Prodotti', foto: 'Foto' };

function route() {
  const name = (location.hash.replace('#/', '') || 'oggi').split('?')[0];
  const fn = ROUTES[name] || viewOggi;
  $('#top-title').textContent = TITLES[name] || 'Oggi';
  document.querySelectorAll('#tabbar a').forEach(a =>
    a.toggleAttribute('aria-current', a.dataset.tab === name));
  const v = $('#view'); v.innerHTML = '';
  if (name === 'oggi') backupBanner(v);
  fn(v); window.scrollTo(0, 0);
}

/* ---------------------------------------------------------- vista OGGI */
let viewDate = today();

function viewOggi(v) {
  const k = viewDate, plan = D.settimana[dayIdx(k)], d = day(k);

  // selettore giorno
  const nav = el('div', 'card flat');
  nav.append(el('div', 'eyebrow', esc(plan.attivita)));
  const r = el('div', 'row between');
  r.append(el('button', 'btn sm', '‹'),
           el('div', 'grow', `<strong style="font-family:var(--serif);font-size:17px">${esc(plan.giorno)}</strong>
             <div class="muted mono" style="font-size:11px">${k}${k === today() ? ' · oggi' : ''}</div>`),
           el('button', 'btn sm', '›'));
  r.children[0].onclick = () => { viewDate = addDays(viewDate, -1); route(); };
  r.children[2].onclick = () => { viewDate = addDays(viewDate, 1); route(); };
  r.children[1].style.textAlign = 'center';
  nav.append(r); v.append(nav);

  // barre macro
  const cons = consumed(k), tgt = dayTarget(k);
  const box = el('div', 'card');
  const g = el('div', 'macros');
  for (const [id, lab, dec] of [['kcal', 'kcal', 0], ['p', 'prot', 0],
                                ['c', 'carb', 0], ['g', 'gras', 0]]) {
    const pc = tgt[id] ? cons[id] / tgt[id] : 0;
    const cls = pc > 1.15 ? 'way' : pc > 1.02 ? 'over' : '';
    g.append(el('div', 'macro',
      `<div class="lab">${lab}</div><div class="val">${nf(cons[id], dec)}</div>
       <div class="of">/ ${nf(tgt[id], dec)}</div>
       <div class="bar"><i class="${cls}" style="width:${Math.min(pc * 100, 100)}%"></i></div>`));
  }
  box.append(g);
  const rest = tgt.kcal - cons.kcal;
  box.append(el('div', 'muted', rest > 0
    ? `Restano <strong>${nf(rest)} kcal</strong> e <strong>${nf(Math.max(tgt.p - cons.p, 0), 1)} g</strong> di proteine.`
    : `Sei a <strong>${nf(-rest)} kcal</strong> oltre il totale del giorno. Non compensare domani: conta la media della settimana.`));
  box.lastChild.style.marginTop = '10px';
  v.append(box);

  // pasti
  for (const s of plan.pasti) {
    const p = D.pasti[s.codice], done = !!d.pasti[s.codice];
    const m = el('div', 'meal' + (done ? ' done' : ''));
    const h = el('div', 'meal-h');
    const tick = el('button', 'tick', '✓');
    tick.onclick = () => { d.pasti[s.codice] = !done; save(); route(); };
    h.append(tick, el('div', 'grow',
      `<div class="meal-slot">${esc(s.slot)} · ${s.ora}</div>
       <div class="meal-name">${esc(p.nome)}</div>`),
      el('div', 'meal-kcal', `${nf(p.macro.kcal)}<br>${nf(p.macro.p, 1)} P`));
    m.append(h);
    const ul = el('ul', 'ings');
    for (const ing of p.ingredienti) {
      const li = el('li', null,
        `<span class="grow">${esc(ing.alimento)} <span class="swap">sostituisci</span></span>
         <span class="q">${nf(ing.qta, ing.qta % 1 ? 1 : 0)} ${D.alimenti[ing.alimento]?.unita || 'g'}</span>`);
      li.onclick = () => sheetSwap(ing.alimento, ing.qta);
      ul.append(li);
    }
    m.append(ul); v.append(m);
  }

  // fuori piano
  const ex = el('div', 'card');
  ex.append(el('h2', 'sec', 'Fuori piano'));
  ex.append(el('p', 'muted', 'Registralo e basta. Non serve compensare: il bilancio è settimanale.'));
  for (const [i, e] of d.extra.entries()) {
    const row = el('div', 'row between');
    row.style.cssText = 'padding:8px 0;border-top:1px solid var(--rule)';
    row.append(el('div', 'grow', esc(e.nome)),
      el('span', 'pill', `${nf(e.kcal)} kcal · ${nf(e.p, 1)} P`));
    const del = el('button', 'btn sm', '×');
    del.onclick = () => { d.extra.splice(i, 1); save(); route(); };
    row.append(del); ex.append(row);
  }
  const add = el('button', 'btn wide', '+ Aggiungi pasto fuori piano');
  add.style.marginTop = '10px';
  add.onclick = () => sheetExtra(k);
  ex.append(add); v.append(ex);
}

/* ------------------------------------------------------ sheet: swap */
function sheet(html) {
  $('#sheet-body').innerHTML = ''; $('#sheet-body').append(html);
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }

function sheetSwap(nome, qta) {
  const wrap = el('div');
  const a = D.alimenti[nome], src = foodM(nome, qta);
  wrap.append(el('div', 'eyebrow', 'Sostituzioni equivalenti'));
  wrap.append(el('h2', 'sec',
    `${nf(qta, qta % 1 ? 1 : 0)} ${a.unita} di ${esc(nome)}`));
  wrap.lastChild.style.marginTop = '0';
  wrap.append(el('p', 'muted',
    `${nf(src.kcal)} kcal · ${nf(src.p, 1)} P · ${nf(src.c, 1)} C · ${nf(src.g, 1)} G`));

  const curated = D.sostituzioni_consigliate.filter(s => s.da === nome);
  if (curated.length) {
    wrap.append(el('h2', 'sec', 'Consigliate'));
    for (const s of curated) wrap.append(el('div', 'swapopt',
      `<div class="grow"><strong>${esc(s.a)}</strong>
         <div class="d">${esc(s.nota || '')}</div></div>
       <div class="mono">${nf(s.qta_a, s.qta_a % 1 ? 1 : 0)} g</div>`));
  }

  wrap.append(el('h2', 'sec', 'Calcolate a parità di macro'));
  const list = swaps(nome, qta);
  if (!list.length) wrap.append(el('p', 'muted', 'Nessuna alternativa nella stessa categoria.'));
  for (const s of list) {
    const dk = s.macro.kcal - src.kcal, dp = s.macro.p - src.p;
    wrap.append(el('div', 'swapopt',
      `<div class="grow"><strong>${esc(s.nome)}</strong>
         <div class="d">${dk >= 0 ? '+' : ''}${nf(dk)} kcal ·
           ${dp >= 0 ? '+' : ''}${nf(dp, 1)} P${s.fonte === 'stima' ? ' · valore stimato' : ''}</div></div>
       <div class="mono">${nf(s.qta, s.qta < 20 ? 1 : 0)} ${s.unita}</div>`));
  }
  const b = el('button', 'btn wide pri', 'Chiudi'); b.style.marginTop = '14px';
  b.onclick = closeSheet; wrap.append(b);
  sheet(wrap);
}

function sheetExtra(k) {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Fuori piano'));
  w.append(el('h2', 'sec', 'Cosa hai mangiato'));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Descrizione</label><input type="text" id="x-n" placeholder="Es. cornetto al bar">`));
  const g = el('div'); g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
  g.append(el('div', 'field', `<label>kcal</label><input type="text" id="x-k" inputmode="numeric">`),
           el('div', 'field', `<label>Proteine (g)</label><input type="text" id="x-p" inputmode="decimal">`));
  w.append(g);
  const b = el('button', 'btn wide pri', 'Registra');
  b.onclick = () => {
    const n = $('#x-n').value.trim() || 'Fuori piano';
    day(k).extra.push({ nome: n, kcal: parseNum($('#x-k').value) || 0, p: parseNum($('#x-p').value) || 0,
                        c: 0, g: 0, fibre: 0 });
    save(); closeSheet(); route(); toast('Registrato');
  };
  w.append(b); sheet(w);
}

/* --------------------------------------------------------- vista DIARIO */
function viewDiario(v) {
  const k = viewDate, d = day(k);
  const set = (id, val) => { d[id] = val; save(); };

  // stesso giorno selezionato della scheda Oggi: si naviga il giorno, non la scheda
  const nav = el('div', 'card flat');
  nav.append(el('div', 'eyebrow', 'Giorno'));
  const r = el('div', 'row between');
  const nomi = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
  r.append(el('button', 'btn sm', '‹'),
    el('div', 'grow', `<strong style="font-family:var(--serif);font-size:17px">${nomi[dayIdx(k)].toUpperCase()}</strong>
       <div class="muted mono" style="font-size:11px">${k}${k === today() ? ' · oggi' : ''}</div>`),
    el('button', 'btn sm', '›'));
  r.children[0].onclick = () => { viewDate = addDays(viewDate, -1); route(); };
  r.children[2].onclick = () => {
    if (viewDate >= today()) { toast('Il futuro non si registra'); return; }
    viewDate = addDays(viewDate, 1); route();
  };
  r.children[1].style.textAlign = 'center';
  nav.append(r); v.append(nav);

  if (k !== today()) {
    const t = el('button', 'btn wide');
    t.textContent = 'Torna a oggi';
    t.style.marginBottom = '12px';
    t.onclick = () => { viewDate = today(); route(); };
    v.append(t);
  }

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Regola</div>
     <div class="muted">Pesati al mattino, dopo il bagno, prima di bere o mangiare.
     Una singola pesata non contiene informazione: conta solo la media a 7 giorni.</div>`));

  const num = (id, lab, unit, step, hint) => {
    const f = el('div', 'field',
      `<label>${lab}${unit ? ` <span class="muted">(${unit})</span>` : ''}</label>
       <input type="text" inputmode="decimal" id="f-${id}"
              value="${d[id] ?? ''}">${hint ? `<div class="hint">${hint}</div>` : ''}`);
    f.querySelector('input').oninput = e => set(id, parseNum(e.target.value));
    return f;
  };

  const c1 = el('div', 'card');
  c1.append(el('h2', 'sec', 'Ogni giorno'));
  c1.lastChild.style.marginTop = '0';
  c1.append(num('peso', 'Peso', 'kg', '0.01'));
  const grid = el('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  grid.append(num('acqua', 'Acqua', 'L', '0.25'), num('coca', 'Coca Zero', 'lattine', '1'),
              num('passi', 'Passi', '', '100'), num('sonno', 'Sonno', 'ore', '0.5'));
  c1.append(grid);

  const tr = el('div', 'field', `<label>Allenamento</label>`);
  const seg = el('div', 'seg');
  for (const [val, lab] of [[true, 'Sì'], [false, 'No']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', d.allenamento === val);
    b.onclick = () => { set('allenamento', val); route(); };
    seg.append(b);
  }
  tr.append(seg); c1.append(tr); v.append(c1);

  const c2 = el('div', 'card');
  c2.append(el('h2', 'sec', 'Come stai'));
  c2.lastChild.style.marginTop = '0';
  for (const [id, lab] of [['fame', 'Fame'], ['energia', 'Energia']]) {
    const f = el('div', 'field', `<label>${lab} <span class="muted">1–10</span></label>`);
    const s = el('div', 'seg');
    for (let i = 1; i <= 10; i++) {
      const b = el('button', null, i);
      b.setAttribute('aria-pressed', d[id] === i);
      b.onclick = () => { set(id, i); route(); };
      s.append(b);
    }
    f.append(s); c2.append(f);
  }
  const fa = el('div', 'field', `<label>Aderenza al piano</label>`);
  const sa = el('div', 'seg');
  for (const [val, lab] of [['ok', 'Piena'], ['parz', 'Parziale'], ['no', 'Saltata']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', d.aderenza === val);
    b.onclick = () => { set('aderenza', val); route(); };
    sa.append(b);
  }
  fa.append(sa); c2.append(fa);

  const fg = el('div', 'field', `<label>Sintomi gastrointestinali</label>`);
  const sg = el('div', 'seg');
  for (const [val, lab] of [[true, 'Sì'], [false, 'No']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', d.gi === val);
    b.onclick = () => { set('gi', val); route(); };
    sg.append(b);
  }
  fg.append(sg); c2.append(fg); v.append(c2);

  // integratori
  const c3 = el('div', 'card');
  c3.append(el('h2', 'sec', 'Integrazione'));
  c3.lastChild.style.marginTop = '0';
  for (const s of D.integratori) {
    const on = !!d.integratori[s.nome];
    const row = el('div', 'buy' + (on ? ' got' : ''));
    row.append(el('div', 'box', '✓'),
      el('div', 'grow', `<div><strong>${esc(s.nome)}</strong></div>
        <div class="muted" style="font-size:12px">${esc(s.dose)} · ${esc(s.cadenza)}${s.nota ? ' · ' + esc(s.nota) : ''}</div>`),
      el('span', 'pill' + (s.priorita === 'obbligatorio' ? ' bad' : ''), esc(s.priorita)));
    row.onclick = () => { d.integratori[s.nome] = !on; save(); route(); };
    c3.append(row);
  }
  v.append(c3);
}

/* ---------------------------------------------------------- vista CORPO */
/* La figura non è un disegno: è un grafico. Ogni larghezza viene dalla
   circonferenza misurata, quindi la sagoma cambia quando cambiano i numeri.
   Resta comunque schematica — serve a vedere le proporzioni, non a fare
   una scansione del corpo. */
/* Punti di repere, in unità SVG. Le proporzioni verticali seguono il canone
   anatomico: inguine a metà altezza, ginocchio al 73%, caviglia al 94%. */
const FIG = { W: 240, H: 520, CX: 120,
  yCrown: 26, yChin: 83, yNeck: 96, ySh: 114, yPit: 142,
  yWaist: 197, yHip: 235, yCrotch: 254, yElbow: 197, yWrist: 254, yHand: 288,
  yKnee: 354, yCalf: 388, yAnkle: 459, ySole: 482 };

/* Mezze larghezze del template, tarate su una figura maschile ben proporzionata
   alta quanto il riquadro. Corrispondono al fisico di riferimento in
   target_fisico.misure: disegnato con quelle misure, l'omino È il template.
   Le misure dell'utente lo modulano per rapporto, così la figura resta sempre
   ben disegnata e insieme onesta sui numeri. */
const TPL = { collo: 17.5, torace: 46, vita: 37, fianchi: 43, coscia: 22, braccio: 14.5 };

function widths(m) {
  const R = D.target_fisico.misure;
  const w = {};
  for (const id of Object.keys(TPL))
    w[id] = TPL[id] * (m[id] > 0 && R[id] > 0 ? m[id] / R[id] : 1);
  // La spalla non si misura col metro: nasce dalla gabbia toracica più il
  // deltoide, quindi risponde sia al torace sia al braccio.
  w.spalla = w.torace * 0.86 + w.braccio * 1.62;
  return w;
}

/** Catmull-Rom → Bézier: curve morbide che passano per i punti dati. */
function smooth(pts, close) {
  if (pts.length < 2) return '';
  const n = v => v.toFixed(1);
  let d = 'M ' + n(pts[0][0]) + ' ' + n(pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    d += ' C ' + n(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + n(p1[1] + (p2[1] - p0[1]) / 6)
       + ' ' + n(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + n(p2[1] - (p3[1] - p1[1]) / 6)
       + ' ' + n(p2[0]) + ' ' + n(p2[1]);
  }
  return d + (close ? ' Z' : '');
}

/** Misure da usare per disegnare, con ripiego sui valori di partenza. */
function figMeas(src) {
  const g = id => src[id] ?? D.misure.find(m => m.id === id)?.base ?? null;
  return {
    collo: g('collo') || 37, torace: g('torace') || 91, vita: g('vita') || 85,
    fianchi: g('fianchi') || g('vita') || 90, coscia: g('coscia') || 52,
    braccio: g('braccio') || 30
  };
}

/** Sagoma completa: corpo (tronco + gambe + piedi), braccia, testa. */
function figure(m) {
  const F = FIG, cx = F.CX, W = widths(m);
  const nw = W.collo, cw = W.torace, ww = W.vita, hw = W.fianchi;
  const tw = W.coscia, aw = W.braccio, sw = W.spalla;

  // --- tronco: la spalla appartiene al tronco, così la silhouette ha
  //     le spalle larghe della foto invece del gancio da appendiabiti
  const busto = [
    // il collo sale DENTRO la testa: fermarlo sotto il mento lascia un vuoto,
    // perché l'ellisse si assottiglia a zero sul fondo
    [nw * 0.92, F.yChin - 13], [nw, F.yNeck],
    // il trapezio si allarga in fretta perché la spalla sta solo ~30 unità
    // sotto il mento: allungare il collo è ciò che produce l'appendiabiti
    [nw * 1.55, F.yNeck + 5], [sw * 0.62, F.yNeck + 11], [sw * 0.88, F.ySh - 2],
    // due punti oltre il massimo: senza, la spalla resta uno spigolo netto
    [sw, F.ySh + 4], [sw * 0.96, F.ySh + 16],
    [cw * 1.05, F.yPit - 2], [cw, F.yPit + 8], [cw * 0.98, F.yPit + 26],
    [ww, F.yWaist], [hw * 0.96, F.yHip - 16], [hw, F.yHip]
  ];

  // --- gambe: le cosce non possono compenetrarsi, l'asse si allarga se sono grosse
  const ax = Math.max(hw * 0.50, tw + 3.5);
  const lvG = [
    { y: F.yCrotch + 28, x: ax,        w: tw },
    { y: F.yKnee - 22,   x: ax * 0.91, w: tw * 0.56 },
    { y: F.yKnee,        x: ax * 0.90, w: tw * 0.49 },
    { y: F.yCalf,        x: ax * 0.88, w: tw * 0.57 },
    { y: F.yAnkle,       x: ax * 0.83, w: tw * 0.23 },
    // due livelli quasi coincidenti: la suola esce piatta invece che a uncino
    { y: F.ySole - 3,    x: ax * 0.82, w: tw * 0.30 },
    { y: F.ySole,        x: ax * 0.82, w: tw * 0.30 }   // piede
  ];

  // Tronco e gambe sono un profilo unico: se il tronco si chiudesse per conto
  // suo, il suo bordo inferiore verrebbe disegnato sopra le cosce e la figura
  // sembrerebbe in mutande. L'apice dell'inguine chiude i due lati.
  const half = busto
    .concat([[ax + tw * 0.99, F.yCrotch - 12]])                  // anca → coscia
    .concat(lvG.map(l => [l.x + l.w, l.y]))                      // esterno, giù
    .concat(lvG.slice().reverse().map(l => [l.x - l.w, l.y]));   // interno, su
  const corpo = smooth(half.map(p => [cx + p[0], p[1]])
    .concat([[cx, F.yCrotch]])
    .concat(half.slice().reverse().map(p => [cx - p[0], p[1]])), true);

  // --- braccia: definite dal BORDO ESTERNO, che in alto coincide con la
  // spalla del tronco. Disegnate DIETRO il busto: la parte alta resta coperta
  // e il braccio emerge da solo sotto l'ascella, dove il tronco si restringe.
  // Sopra il busto invece la cupola del deltoide spunterebbe oltre il trapezio
  // e la spalla verrebbe a punta.
  const lvB = [
    { y: F.ySh + 6,     o: sw * 0.99, w: aw * 1.22 },   // deltoide
    { y: F.yPit + 6,    o: sw * 1.00, w: aw * 1.00 },
    { y: F.yElbow,      o: sw * 1.01, w: aw * 0.60 },
    { y: F.yWrist - 26, o: sw * 1.03, w: aw * 0.64 },   // avambraccio
    { y: F.yWrist,      o: sw * 1.00, w: aw * 0.42 },
    { y: F.yHand,       o: sw * 1.02, w: aw * 0.52 }    // mano
  ].map(l => ({ y: l.y, x: l.o - l.w, w: l.w }));

  const braccio = s => {
    const out = lvB.map(l => [cx + s * (l.x + l.w), l.y]);
    const inn = lvB.slice().reverse().map(l => [cx + s * (l.x - l.w), l.y]);
    const t = lvB[lvB.length - 1], h = lvB[0];
    return smooth(out
      .concat([[cx + s * t.x, t.y + t.w * 1.1]])     // punta della mano
      .concat(inn)
      .concat([[cx + s * h.x, h.y - h.w * 0.15]]),   // capo, coperto dal busto
      true);
  };

  // profili aperti per la sagoma target: sovrapporre le forme chiuse
  // taglierebbe la figura con i loro bordi inferiori
  const apri = (pts, s) => smooth(pts.map(p => [cx + s * p[0], p[1]]), false);
  const bordo = (lv, s) => apri(lv.map(l => [l.x + l.w, l.y]), s);

  return {
    corpo, braccia: [braccio(1), braccio(-1)],
    profili: [apri(busto.slice(1), 1), apri(busto.slice(1), -1),
              bordo(lvB, 1), bordo(lvB, -1), bordo(lvG, 1), bordo(lvG, -1)],
    // La testa NON si scala sulla circonferenza del collo: non è una misura
    // del cranio. Legarcela faceva rimpicciolire la testa fino a sembrare
    // spillata sul corpo quando il collo era fuori scala.
    testa: { cx, cy: (F.yCrown + F.yChin) / 2, rx: (F.ySole - F.yCrown) * 0.0405,
             ry: (F.yChin - F.yCrown) / 2 }, nw, cw, ww, hw, tw, aw, sw };
}

/** SVG: sagoma attuale piena, target tratteggiato SOPRA — se stesse dietro
    sparirebbe dove il target è più stretto, cioè proprio dove conta. */
function bodySVG(cur, tgt) {
  const a = figure(cur), b = tgt ? figure(tgt) : null;
  const solid = d => '<path d="' + d + '" fill="var(--pine-soft)" '
    + 'stroke="var(--pine)" stroke-width="2" stroke-linejoin="round"/>';
  const ghost = b ? '<g fill="none" stroke="var(--pine)" stroke-width="1.6" '
    + 'stroke-dasharray="6 4" stroke-linecap="round" opacity=".55">'
    + b.profili.map(d => '<path d="' + d + '"/>').join('') + '</g>' : '';
  return '<svg viewBox="0 0 ' + FIG.W + ' ' + FIG.H + '" '
    + 'xmlns="http://www.w3.org/2000/svg" role="img" '
    + 'aria-label="Figura in scala sulle misure registrate">'
    + '<g>' + a.braccia.map(solid).join('') + solid(a.corpo)
    + '<ellipse cx="' + a.testa.cx + '" cy="' + a.testa.cy.toFixed(1) + '" '
    + 'rx="' + a.testa.rx.toFixed(1) + '" ry="' + a.testa.ry.toFixed(1) + '" '
    + 'fill="var(--pine-soft)" stroke="var(--pine)" stroke-width="2"/></g>'
    + ghost + '</svg>';
}

/* ------------------------------------------------------------ vista */
function viewCorpo(v) {
  const k = today(), C = composition(k), TF = D.target_fisico;
  ledgerRecord(k);

  /* --- target --- */
  const ct = el('div', 'card');
  ct.append(el('div', 'row between',
    `<div><div class="eyebrow">Target</div>
       <div class="tname">${esc(TF.nome)}</div></div>
     <span class="pill">${esc(TF.fonte)}</span>`));
  ct.append(el('p', 'muted', esc(TF.chiave)));
  if (TF.fonte === 'stima')
    ct.append(el('p', 'hint', `Valore stimato. ${esc(TF.nota)}`));
  v.append(ct);

  /* --- figura --- */
  const curM = figMeas(Object.fromEntries(D.misure.map(m => [m.id, lastMeas(m.id)])));
  const cf = el('div', 'card');
  cf.append(el('div', 'bodywrap', bodySVG(curM, TF.misure)));
  cf.append(el('div', 'legend',
    `<span><i class="sw sw-now"></i>Ora</span>
     <span><i class="sw sw-tgt"></i>Target</span>`));
  cf.append(el('p', 'hint',
    'La sagoma è disegnata sulle circonferenze registrate: cambia quando cambiano i numeri. È schematica, serve a leggere le proporzioni.'));
  v.append(cf);

  /* --- composizione --- */
  const cc = el('div', 'card');
  cc.append(el('h2', 'sec', 'Composizione'));
  cc.lastChild.style.marginTop = '0';
  if (C.colloSospetto) {
    cc.append(el('div', 'flag warn',
      `<div class="ico">!</div><div class="grow"><h4>Collo da rimisurare</h4>
       <p>${nf(C.collo, 1)} cm è fuori scala (la norma è 36–40). La stima del grasso
       si regge sulla differenza vita−collo: 7 cm di errore lì valgono 5 punti di
       grasso qui, quindi finché non lo rimisuri non calcolo niente.</p></div>`));
  }
  const cmp = el('div', 'cmp');
  cmp.append(el('div', 'cmp-h', '<span></span><span>Ora</span><span>Target</span><span>Manca</span>'));
  const rowC = (lab, now, tgt, dec, unit, inv) => {
    if (now == null) return;
    const d = tgt - now, vicino = Math.abs(d) <= Math.abs(tgt) * 0.03;
    cmp.append(el('div', 'cmp-r',
      `<span>${lab}</span>
       <span class="mono">${nf(now, dec)}</span>
       <span class="mono muted">${nf(tgt, dec)}</span>
       <span class="mono ${vicino ? 'good' : ''}">${vicino ? '✓'
         : (d > 0 ? '+' : '') + nf(d, dec) + `<em>${unit}</em>`}</span>`));
  };
  rowC('Peso', C.peso, C.t.peso, 1, ' kg');
  if (C.bf != null) {
    rowC('Grasso', C.bf, C.t.bf, 1, ' %');
    rowC('Massa magra', C.lbm, C.t.lbm, 1, ' kg');
    rowC('Massa grassa', C.fm, C.t.peso * C.t.bf / 100, 1, ' kg');
  }
  if (C.vitaAltezza) rowC('Vita / altezza', C.vitaAltezza, C.t.vitaAltezza, 2, '');
  if (C.toraceVita) rowC('Torace / vita', C.toraceVita, C.t.toraceVita, 2, '');
  cc.append(cmp);
  if (C.bf != null)
    cc.append(el('p', 'hint',
      `Grasso stimato con la formula della Marina USA da vita, collo e altezza: ±3–4 punti di errore reale. Serve a vedere la direzione, non il valore assoluto. Da qui al target ci sono ${nf(Math.abs(C.dFm), 1)} kg di grasso in meno e ${nf(Math.abs(C.dLbm), 1)} kg di muscolo in più — lo stesso numero sulla bilancia, un corpo diverso.`));
  v.append(cc);

  /* --- misure --- */
  const cm = el('div', 'card');
  cm.append(el('h2', 'sec', 'Misure'));
  cm.lastChild.style.marginTop = '0';
  cm.append(el('p', 'muted', 'Al mattino, a digiuno, senza trattenere il respiro. Tocca una riga per registrarla.'));
  const tb = el('div', 'cmp');
  tb.append(el('div', 'cmp-h', '<span></span><span>Ora</span><span>Target</span><span>Manca</span>'));
  for (const m of D.misure) {
    // measTrend vuole due rilevazioni per dare un delta; il valore corrente
    // invece esiste già dalla prima, e deve essere lo stesso che usa la
    // composizione — altrimenti le due tabelle si contraddicono
    const tr = measTrend(m.id, k), cur = lastMeas(m.id);
    const d = cur != null && m.target != null ? m.target - cur : null;
    const vicino = d != null && Math.abs(d) <= 1;
    const dl = tr && Math.abs(tr.delta) >= 0.5
      ? `<em class="${tr.delta > 0 ? 'up' : 'dn'}">${tr.delta > 0 ? '+' : ''}${nf(tr.delta, 1)}</em>` : '';
    const r = el('button', 'cmp-r tap',
      `<span>${esc(m.label)}${dl}</span>
       <span class="mono">${cur != null ? nf(cur, 1) : '—'}</span>
       <span class="mono muted">${m.target != null ? nf(m.target, 1) : '—'}</span>
       <span class="mono ${vicino ? 'good' : ''}">${d == null ? '—' :
         vicino ? '✓' : (d > 0 ? '+' : '') + nf(d, 1)}</span>`);
    r.onclick = () => sheetMisura(m, k);
    tb.append(r);
  }
  cm.append(tb);
  const nota = D.misure.find(m => m.nota);
  if (nota) cm.append(el('p', 'hint', `<strong>${esc(nota.label)}:</strong> ${esc(nota.nota)}.`));
  v.append(cm);

  /* --- previsione --- */
  v.append(forecastCard(k));

  /* --- grafico peso --- */
  v.append(weightCard(k));
}

/* ------------------------------------------------------- previsione */
function forecastCard(k) {
  const c = el('div', 'card'), E = energyModel(k), M = D.modello;
  c.append(el('h2', 'sec', 'Previsione'));
  c.lastChild.style.marginTop = '0';

  const w = trendW(k);
  if (w == null) {
    c.append(el('p', 'muted',
      'Serve almeno una pesata. Il motore prevede la linea di tendenza, non il numero del mattino: quello oscilla di ±1 kg per acqua e contenuto intestinale, e non contiene informazione.'));
    return c;
  }

  const cal = E.n > 0;
  c.append(el('div', 'kpi',
    `<div><div class="eyebrow">Dispendio stimato</div>
       <div class="big mono">${nf(E.tdee)}<em>kcal/die</em></div>
       <div class="hint">±${nf(E.sigma)} · ${cal
         ? `ricalibrato ${E.n} volt${E.n === 1 ? 'a' : 'e'} sui tuoi dati`
         : `ancora da formula (Mifflin-St Jeor × ${M.laf}), non dai tuoi dati`}</div></div>`));

  const fp = forecast(7, D.target.kcal, k);
  const f28 = forecast(28, D.target.kcal, k);
  const ri = realIntake(k);
  const fr = ri != null ? forecast(7, ri, k) : null;

  const line = (lab, f) => `<div class="cmp-r">
      <span>${lab}</span>
      <span class="mono">${nf(f.peso, 2)}<em> kg</em></span>
      <span class="mono muted">±${nf(f.banda, 2)}</span>
      <span class="mono">${f.delta >= 0 ? '+' : ''}${nf(f.delta, 2)}</span></div>`;
  const g = el('div', 'cmp');
  g.append(el('div', 'cmp-h', '<span>Se segui il piano</span><span>Tendenza</span><span>Banda</span><span>Δ</span>'));
  g.append(el('div', null, line('Fra 7 giorni', fp) + line('Fra 28 giorni', f28)));
  c.append(g);

  if (fr && Math.abs(fr.settimana - fp.settimana) > 0.05)
    c.append(el('p', 'hint',
      `Mangiando invece come nelle ultime due settimane (${nf(ri)} kcal di media) il ritmo sarebbe ${fr.settimana >= 0 ? '+' : ''}${nf(fr.settimana, 2)} kg a settimana invece di ${fp.settimana >= 0 ? '+' : ''}${nf(fp.settimana, 2)}.`));

  const rum = fp.rumore;
  c.append(el('div', 'card flat',
    `<div class="eyebrow">Domani sulla bilancia</div>
     <div class="muted">Fra ${nf(w - 1.96 * rum, 1)} e ${nf(w + 1.96 * rum, 1)} kg.
     È una banda larga ${nf(3.92 * rum, 1)} kg perché il tuo rumore giornaliero
     misurato è ±${nf(rum, 2)} kg: qualsiasi singola pesata dentro questo
     intervallo non dice assolutamente niente. Per questo il motore prevede la
     media, non il mattino.</div>`));

  /* pagella */
  const L = ledgerScore(k);
  const p = el('div', 'card flat');
  p.append(el('div', 'eyebrow', 'Quanto ci prende'));
  if (!L.n) {
    p.append(el('div', 'muted',
      `${L.aperte} prevision${L.aperte === 1 ? 'e' : 'i'} in attesa di verifica. Ogni giorno il motore deposita una previsione a 7 e a 14 giorni; quando la data arriva la confronta con il peso reale e si corregge. La prima pagella compare fra una settimana.`));
  } else {
    p.append(el('div', 'muted',
      `Su ${L.n} prevision${L.n === 1 ? 'e' : 'i'} verificat${L.n === 1 ? 'a' : 'e'}:
       errore medio <strong>${nf(L.mae, 2)} kg</strong>,
       ${nf(L.colpiti * 100)}% dentro la banda dichiarata.
       ${Math.abs(L.bias) > 0.15
         ? `Sbaglia sistematicamente per ${L.bias > 0 ? 'difetto' : 'eccesso'}
            (${L.bias > 0 ? '+' : ''}${nf(L.bias, 2)} kg): il dispendio stimato si sta
            ancora spostando, e il filtro ha allargato il passo per recuperare.`
         : 'Nessuna deriva sistematica: la stima del dispendio è assestata.'}`));
    const t = el('div', 'led');
    for (const x of L.ultime.slice().reverse())
      t.append(el('div', 'led-r' + (x.dentro ? ' ok' : ''),
        `<span class="mono">${x.fatta.slice(5)}</span>
         <span class="mono">→ ${nf(x.previsto, 2)}</span>
         <span class="mono">reale ${nf(x.reale, 2)}</span>
         <span class="mono">${x.errore >= 0 ? '+' : ''}${nf(x.errore, 2)}</span>`));
    p.append(t);
  }
  c.append(p);

  c.append(el('p', 'hint',
    'Nessuna data di arrivo: a questi ritmi qualsiasi proiezione oltre il mese è finzione, e un conto alla rovescia peggiorerebbe le decisioni invece di migliorarle. Il motore dice a che velocità stai andando adesso, e quanto si fida di sé.'));
  return c;
}

/* ---------------------------------------------------------- grafico */
function weightCard(k) {
  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'Peso'));
  c.lastChild.style.marginTop = '0';
  const days = Object.keys(S.log).filter(x => S.log[x]?.peso != null).sort();
  if (days.length < 2) {
    c.append(el('p', 'muted', 'Servono almeno due pesate. La linea che conterà è la media mobile a 7 giorni, non i singoli punti.'));
    return c;
  }
  const pts = days.map(x => ({ k: x, w: S.log[x].peso }));
  const ma = pts.map(p => ({ k: p.k, w: weightMA(p.k) })).filter(p => p.w);
  const H = 28, f = forecast(H, D.target.kcal, k);
  const W = 320, HT = 140, PX = 8, PY = 12;
  const span = days.length - 1 + (f ? H : 0);
  const all = pts.map(p => p.w).concat(ma.map(p => p.w));
  if (f) all.push(f.peso + f.banda, f.peso - f.banda);
  const lo = Math.min(...all) - 0.3, hi = Math.max(...all) + 0.3;
  const sx = i => PX + (i / Math.max(span, 1)) * (W - PX * 2);
  const sy = w => PY + (1 - (w - lo) / (hi - lo || 1)) * (HT - PY * 2);
  const idx = Object.fromEntries(days.map((x, i) => [x, i]));
  const last = days.length - 1;

  const dots = pts.map((p, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.w).toFixed(1)}" r="1.8" fill="var(--ink-3)"/>`).join('');
  const line = ma.map((p, i) => `${i ? 'L' : 'M'}${sx(idx[p.k]).toFixed(1)},${sy(p.w).toFixed(1)}`).join(' ');
  let fc = '';
  if (f) {
    const x0 = sx(last), x1 = sx(last + H), y0 = sy(f.base);
    fc = `<path d="M${x0},${y0} L${x1},${sy(f.peso + f.banda).toFixed(1)}
            L${x1},${sy(f.peso - f.banda).toFixed(1)} Z"
            fill="var(--pine)" opacity=".13"/>
          <path d="M${x0},${y0} L${x1},${sy(f.peso).toFixed(1)}" fill="none"
            stroke="var(--pine)" stroke-width="1.8" stroke-dasharray="4 3"/>`;
  }
  c.append(el('div', null, `<svg class="chart" viewBox="0 0 ${W} ${HT}">
    ${fc}<path d="${line}" fill="none" stroke="var(--pine)" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`));

  const cur = weightMA(days[last]), prev = weightMA(addDays(days[last], -7));
  c.append(el('div', 'row between',
    `<span class="muted">Media mobile 7 giorni</span>
     <span class="mono"><strong>${nf(cur, 2)} kg</strong>${prev
       ? ` <span class="pill ${Math.abs(cur - prev) < 0.35 ? 'ok' : 'warn'}">${cur - prev >= 0 ? '+' : ''}${nf(cur - prev, 2)}/sett</span>` : ''}</span>`));
  c.lastChild.style.marginTop = '8px';
  if (f) c.append(el('p', 'hint',
    `Il tratteggio è la previsione a 28 giorni seguendo il piano; l'area è la banda di confidenza al 95%, e si allarga perché l'incertezza sul dispendio si accumula giorno dopo giorno.`));
  return c;
}

function sheetMisura(m, k) {
  const w = el('div'), d = day(k);
  w.append(el('div', 'eyebrow', 'Misura'));
  w.append(el('h2', 'sec', esc(m.label)));
  w.lastChild.style.marginTop = '0';
  if (m.target != null) {
    const cur = lastMeas(m.id);
    w.append(el('p', 'muted', `Target ${nf(m.target, 1)} cm${cur != null
      ? ` · ora ${nf(cur, 1)} · ${Math.abs(m.target - cur) <= 1 ? 'ci sei'
        : `${nf(Math.abs(m.target - cur), 1)} cm ${m.target > cur ? 'da mettere' : 'da togliere'}`}` : ''}.`));
  }
  w.append(el('div', 'field',
    `<label>Centimetri</label><input type="text" inputmode="decimal"
      id="m-v" value="${d.misure[m.id] ?? lastMeas(m.id) ?? ''}">
     ${m.nota ? `<div class="hint">${esc(m.nota)}</div>` : ''}`));
  const b = el('button', 'btn wide pri', 'Salva');
  b.onclick = () => {
    const raw = $('#m-v').value.trim(), val = parseNum(raw);
    // campo vuoto = cancella; numero valido = salva; scritto male = fermati e
    // dillo, invece di azzerare in silenzio una misura che l'utente credeva
    // di aver aggiornato
    if (raw === '') delete d.misure[m.id];
    else if (val > 0 && val < 300) d.misure[m.id] = val;
    else { toast('Valore non valido'); return; }
    S.model ||= {}; S.model.rev = (S.model.rev || 0) + 1;
    save(); closeSheet(); route(); toast('Misura salvata');
  };
  w.append(b); sheet(w);
}

/* -------------------------------------------------------- vista ANALISI */
function viewAnalisi(v) {
  const c = el('div', 'card flat');
  c.append(el('div', 'eyebrow', 'Carichi in palestra'));
  c.append(el('p', 'muted', 'Serve alla regola sulle calorie: senza questo dato peso e vita da soli non bastano a decidere.'));
  const seg = el('div', 'seg');
  for (const [val, lab] of [['su', 'In salita'], ['fermi', 'Fermi'], ['giu', 'In calo']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', (S.settings.carichi || 'fermi') === val);
    b.onclick = () => { S.settings.carichi = val; save(); route(); };
    seg.append(b);
  }
  c.append(seg); v.append(c);

  v.append(el('h2', 'sec', 'Cosa sto sbagliando'));
  for (const [kind, ico, title, body] of analyse()) {
    v.append(el('div', 'flag ' + kind,
      `<div class="ico">${ico}</div>
       <div class="grow"><h4>${esc(title)}</h4><p>${body}</p></div>`));
  }

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Promemoria</div>
     <div class="muted">Non modificare le calorie prima di 3 settimane di dati puliti,
     mai più di ±200 kcal per volta, mai in base a una singola pesata.</div>`));
}

/* ---------------------------------------------------------- vista SPESA */
function shoppingList() {
  const need = {};
  for (const g of D.settimana)
    for (const s of g.pasti)
      for (const i of D.pasti[s.codice].ingredienti)
        need[i.alimento] = (need[i.alimento] || 0) + i.qta;
  const byCat = {};
  for (const [nome, q] of Object.entries(need)) {
    const cat = D.alimenti[nome]?.categoria || 'altro';
    (byCat[cat] ||= []).push({ nome, q, unita: D.alimenti[nome]?.unita || 'g' });
  }
  for (const l of Object.values(byCat)) l.sort((a, b) => a.nome.localeCompare(b.nome));
  return byCat;
}

function viewSpesa(v) {
  v.append(el('div', 'card flat',
    `<div class="eyebrow">Fabbisogno settimanale</div>
     <div class="muted">Quantità totali dei 7 giorni. Arrotonda per eccesso alle confezioni intere.</div>`));
  const byCat = shoppingList();
  for (const [cat, items] of Object.entries(byCat)) {
    v.append(el('h2', 'sec', cat[0].toUpperCase() + cat.slice(1)));
    const c = el('div', 'card');
    for (const it of items) {
      const got = !!S.spesa[it.nome];
      const row = el('div', 'buy' + (got ? ' got' : ''));
      const q = it.unita === 'ml' ? `${nf(it.q)} ml` :
        it.q >= 1000 ? `${nf(it.q / 1000, 2)} kg` : `${nf(it.q, it.q % 1 ? 1 : 0)} g`;
      row.append(el('div', 'box', '✓'), el('div', 'grow nm', esc(it.nome)),
                 el('span', 'qt', q));
      row.onclick = () => { S.spesa[it.nome] = !got; save(); route(); };
      c.append(row);
    }
    v.append(c);
  }
  const b = el('button', 'btn wide', 'Azzera la lista');
  b.onclick = () => { S.spesa = {}; save(); route(); };
  v.append(b);
}

/* ------------------------------------------------ calendario (notifiche) */
function icsFile() {
  const pad = n => String(n).padStart(2, '0');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dieta//IT',
             'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Dieta'];
  const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const monday = new Date(base); monday.setDate(base.getDate() - dayIdx(base));
  const ev = (uid, title, hh, mm, rule, alarm) => {
    const st = new Date(monday); st.setHours(hh, mm, 0, 0);
    const f = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const en = new Date(st.getTime() + 20 * 60000);
    L.push('BEGIN:VEVENT', `UID:${uid}@dieta`, `DTSTART:${f(st)}`, `DTEND:${f(en)}`,
      `SUMMARY:${title}`, `RRULE:${rule}`,
      'BEGIN:VALARM', `TRIGGER:-PT${alarm}M`, 'ACTION:DISPLAY',
      `DESCRIPTION:${title}`, 'END:VALARM', 'END:VEVENT');
  };
  const slots = {};
  for (const [i, g] of D.settimana.entries())
    for (const s of g.pasti) (slots[`${s.slot}|${s.ora}`] ||= []).push(DAYS[i]);
  let n = 0;
  for (const [key, days] of Object.entries(slots)) {
    const [slot, ora] = key.split('|'), [hh, mm] = ora.split(':').map(Number);
    ev(`meal${n++}`, `${slot}`, hh, mm,
       `FREQ=WEEKLY;BYDAY=${[...new Set(days)].join(',')}`, 10);
  }
  for (const s of D.integratori) {
    const [hh, mm] = (s.ora || '09:30').split(':').map(Number);
    ev(`sup${n++}`, `${s.nome} — ${s.dose}`, hh, mm,
       s.cadenza === 'settimanale' ? 'FREQ=WEEKLY;BYDAY=MO' : 'FREQ=DAILY', 0);
  }
  ev(`weigh${n++}`, 'Pesati (a digiuno, dopo il bagno)', 8, 55, 'FREQ=DAILY', 0);
  ev(`rev${n++}`, 'Revisione settimanale: medie, vita, carichi', 19, 0,
     'FREQ=WEEKLY;BYDAY=SU', 0);
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = el('a'); a.href = url; a.download = name; document.body.append(a);
  a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* --------------------------------------------------------------- menu */
function sheetMenu() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Impostazioni'));
  w.append(el('h2', 'sec', 'Dati e promemoria'));
  w.lastChild.style.marginTop = '0';

  const mk = (label, hint, fn) => {
    const b = el('button', 'btn wide', label);
    b.style.marginBottom = '4px'; b.onclick = fn;
    w.append(b); w.append(el('p', 'muted', hint));
    w.lastChild.style.margin = '0 0 14px';
  };

  mk('Scarica i promemoria (.ics)',
     'iOS non permette a una web app di programmare notifiche locali. Questo file crea gli eventi ricorrenti nel Calendario: pasti, integratori, pesata e revisione domenicale. Aprilo una volta e le notifiche arrivano native, senza server.',
     () => { download('dieta-promemoria.ics', icsFile(), 'text/calendar'); toast('Aprilo con Calendario'); });

  mk('Prodotti e codici a barre',
     'Registra i prodotti che compri davvero, con i valori letti in etichetta. Collegandoli al piano, l\'app smette di usare le stime.',
     () => { closeSheet(); location.hash = '#/prodotti'; });

  mk('Foto dei progressi',
     'Uno scatto al giorno nella stessa posa. Restano sul telefono e non entrano nel backup JSON: sono troppo grandi.',
     () => { closeSheet(); location.hash = '#/foto'; });

  mk('Esporta backup', 'La memoria del browser può essere svuotata, e non esiste '
     + 'copia altrove. È l\'unico modo per non perdere lo storico.'
     + (S.settings.backup ? ' Ultimo backup: ' + S.settings.backup + '.'
                          : ' Non ne hai ancora fatto nessuno.'),
     () => { exportBackup(); toast('Backup scaricato'); });

  mk('Importa backup', 'Sostituisce i dati attuali con quelli del file.', () => {
    const i = el('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = () => {
      const f = i.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const o = migra(JSON.parse(r.result));
          if (!o) throw new Error('formato non riconosciuto');
          const nuovi = Object.keys(o.log).length, ora = Object.keys(S.log).length;
          if (ora && !confirm('Il file contiene ' + nuovi + ' giorni e sostituira\' i '
              + ora + ' che hai adesso in memoria. Non si puo\' annullare. Procedo?')) return;
          S = o; normalize(); save(); closeSheet(); route(); toast('Backup importato');
        } catch (e) { toast('File non valido: ' + (e.message || 'illeggibile')); }
      };
      r.readAsText(f);
    };
    i.click();
  });

  const days = Object.keys(S.log).length;
  w.append(el('div', 'card flat',
    `<div class="eyebrow">Stato</div>
     <div class="muted">${days} giorni registrati · target ${nf(D.target.kcal)} kcal,
     ${D.target.p} g proteine · versione dati ${D.meta.versione}</div>`));

  const b = el('button', 'btn wide pri', 'Chiudi');
  b.onclick = closeSheet; w.append(b);
  sheet(w);
}

/* --------------------------------------------------------------- avvio */
async function init() {
  load();
  try {
    D = await (await fetch('data/dieta.json', { cache: 'no-cache' })).json();
  } catch {
    $('#view').innerHTML = '<div class="card">Dati non caricati. Serve un server HTTP (anche GitHub Pages): aprire il file da disco non funziona.</div>';
    return;
  }
  $('#btn-menu').onclick = sheetMenu;
  $('#btn-foto').onclick = () => { location.hash = '#/foto'; };
  $('#sheet-backdrop').onclick = closeSheet;
  addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/oggi';
  route();
  persist();
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
