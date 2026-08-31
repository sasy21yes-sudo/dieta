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
  // la chiave dipende dal profilo attivo: due utenti, due diari separati
  try { S = JSON.parse(localStorage.getItem(chiaveStato())) || null; } catch { S = null; }
  if (!S) S = { log: {}, spesa: {}, settings: { start: today() } };
  normalize();
}
/* ============================================================== moduli

   Non tutti vogliono la stessa app. C'e' chi si costruisce il piano
   settimanale e ci si attiene, e c'e' chi vuole solo scrivere cosa ha mangiato
   oggi e vedere se torna con i target. Allo stesso modo HYROX interessa a
   pochi, e a chi non gara e' solo una sezione in piu' da ignorare.

   Spegnere un modulo NON cancella niente: i dati restano dove sono e
   riaccendendolo tornano tutti. Nasconde soltanto le parti di interfaccia che
   non servono, e con esse i conti che ne dipendono.

   Se il modulo non c'e' — backup vecchio, o profilo nato prima di questa
   modifica — vale la regola di prima: il piano c'era sempre, quindi resta
   acceso. HYROX invece si accende solo se ci sono dati veri dentro, perche'
   accenderlo a tutti riproporrebbe a tutti una sezione che quasi nessuno usa.
   In nessuno dei due casi si perde un dato: si perde al massimo una voce di
   menu, che si riaccende con un tocco. */
function modulliDaStato() {
  const h = S.hyrox || {};
  const usati = !!(h.profilo?.gara || Object.keys(h.pb || {}).length
    || (h.sim || []).length || Object.keys(h.sessioni || {}).length
    || Object.keys(h.checklist || {}).length);
  return { piano: true, hyrox: usati };
}
function moduli() {
  S.settings ||= {};
  if (!S.settings.moduli) S.settings.moduli = modulliDaStato();
  return S.settings.moduli;
}
const usaPiano = () => moduli().piano !== false;
const usaHyrox = () => moduli().hyrox === true;

/** Riempie i campi mancanti: serve all'avvio e dopo l'import di un backup
    vecchio, scritto da una versione che certe chiavi non le aveva. */
function normalize() {
  S.log ||= {}; S.spesa ||= {}; S.dispensa ||= {}; S.settings ||= { start: today() };
  S.settings.pause ||= [];
  S.model ||= {}; S.model.prev ||= []; S.prodotti ||= [];
  S.palestra ||= {}; S.palestra.sessioni ||= {}; S.palestra.esercizi ||= [];
  S.palestra.schede ||= []; S.palestra.acciacchi ||= [];
  S.palestra.esec ||= {}; S.palestra.cardio ||= {};   // esercizio -> esecuzione nel catalogo pubblico
  // dedotto dai dati la prima volta, poi e' una scelta dell'utente
  if (!S.settings.moduli) S.settings.moduli = modulliDaStato();
  // hyrox mancava: un backup fatto prima di questa riga si importava
  // senza gara, record e simulazioni
  S.sfide ||= {}; S.sfide.log ||= {};
  S.hyrox ||= {}; S.hyrox.profilo ||= {}; S.hyrox.pb ||= {};
  S.hyrox.sim ||= []; S.hyrox.sessioni ||= {}; S.hyrox.checklist ||= {};
  S.piano ||= {}; S.piano.alimenti ||= {}; S.piano.pasti ||= {};
  S.piano.target ||= {}; S.piano.profilo ||= {};
  for (const k of Object.keys(S.log)) {
    const d = S.log[k]; if (!d || typeof d !== 'object') { delete S.log[k]; continue; }
    d.pasti ||= {}; d.extra ||= []; d.misure ||= {}; d.integratori ||= {};
    d.porzioni ||= {};
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
  try { localStorage.setItem(chiaveStato(), JSON.stringify(S)); }
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
/**
 * I quattro macro in una riga sola, senza le calorie.
 *
 * Sta qui e non in tre posti diversi perche' e' comparso in tre posti diversi
 * — pasto del giorno, fuori piano, anteprima — e tre versioni della stessa
 * riga diventano prima o poi tre ordini diversi degli stessi numeri.
 */
function macroRiga(m, sep = ' ') {
  // compatta di proposito: "23P 81C 22G 9fib" sta in novanta pixel, e la
  // stessa riga con i puntini in mezzo ne prendeva centocinquanta, cioe' meta'
  // della larghezza di un telefono per quattro numeri
  return [[m.p, 'P'], [m.c, 'C'], [m.g, 'G'], [m.fibre, 'fib']]
    .map(([v, l]) => `${nf(v || 0, (v || 0) < 10 ? 1 : 0)}${l}`).join(sep);
}
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
  for (const s of plan.pasti) if (d.pasti[s.codice])
    addM(t, typeof mealMGiorno === 'function' ? mealMGiorno(s.codice, k) : mealM(s.codice));
  for (const e of d.extra) addM(t, e);
  return t;
}
/** Se al giorno non e' assegnato nessun pasto, il metro sono i target. */
function dayTarget(k) {
  const t = D.settimana[dayIdx(k)].totali;
  return (t && t.kcal > 0) ? t : { ...D.target };
}

/* --------------------------------------------------- motore sostituzioni */
/* Le parole che non distinguono un alimento da un altro: "latte di soia" e
   "latte al cioccolato" hanno in comune solo rumore, e contarlo farebbe
   sembrare parenti due cose che non lo sono. */
const PAROLE_VUOTE = new Set(['di', 'al', 'alla', 'ai', 'con', 'e', 'a', 'in', 'da',
  'del', 'della', 'dei', 'delle', 'lo', 'la', 'il', 'i', 'gli', 'le', 'un', 'una']);

function paroleAlimento(s) {
  return String(s).toLowerCase()
    .replace(/[^a-zà-ù0-9]+/g, ' ').trim().split(/\s+/)
    .filter(x => x && !PAROLE_VUOTE.has(x));
}

/**
 * Quanto due alimenti si somigliano NEL NOME, da 0 a 1.
 *
 * Serve a un caso che il solo confronto dei macro sbagliava sempre: se uno ha
 * in dispensa "latte di soia" e "latte di soia proteico", il secondo e' la
 * sostituzione piu' ovvia che esista — ed e' proprio quella che il motore
 * scartava, perche' i macro sono diversi apposta e la distanza lo mandava in
 * fondo, o fuori del tutto se stava in un'altra categoria.
 *
 * Un nome contenuto nell'altro vale 1: e' la stessa cosa in un'altra versione.
 * Altrimenti si contano le parole in comune sul totale.
 */
function affinitaNome(a, b) {
  const x = String(a).toLowerCase().trim(), y = String(b).toLowerCase().trim();
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 1;
  const A = new Set(paroleAlimento(x)), B = new Set(paroleAlimento(y));
  if (!A.size || !B.size) return 0;
  let comuni = 0;
  for (const w of A) if (B.has(w)) comuni++;
  return comuni / (A.size + B.size - comuni);
}

/**
 * Le alternative a un alimento, in ordine di quanto gli assomigliano.
 *
 * Due criteri, non uno: i macro riscalati sul dominante (proteine se danno piu'
 * del 20% delle calorie, altrimenti calorie) e l'affinita' del nome. La
 * categoria resta il recinto — sostituire il pane con il tonno non aiuta
 * nessuno — ma **una variante dello stesso alimento entra anche da un'altra
 * categoria**: "latte di soia proteico" puo' stare fra i proteici mentre il
 * latte sta fra le bevande, e restano la stessa cosa in due versioni.
 */
const AFFINE_PARENTI = 0.5;      // meta' delle parole in comune: stessa famiglia

function swaps(nome, qta, n = 8) {
  const a = alimento(nome); if (!a) return [];
  const src = foodM(nome, qta);
  // se >20% delle calorie viene da proteine, la proteina è il vincolo
  const dom = a.kcal && (a.p * 4) / a.kcal > 0.2 ? 'p' : 'kcal';
  const out = [];
  for (const k of Object.keys(D.alimenti)) {
    const v = alimento(k);
    if (k === nome) continue;
    const aff = affinitaNome(nome, k);
    /* Fuori categoria si entra solo da parenti stretti, o l'elenco diventa un
       catalogo e smette di essere un consiglio. Meta' delle parole in comune
       e' la soglia giusta: "latte soia cioccolato" e "latte di soia proteico"
       ne condividono due su quattro e sono la stessa cosa in due versioni,
       mentre "latte di mandorla" si ferma a un terzo e resta fuori. */
    if (v.categoria !== a.categoria && aff < AFFINE_PARENTI) continue;
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
    // l'affinita' del nome accorcia la distanza fino a meta': non la annulla,
    // perche' una variante con i macro molto diversi resta una scelta e non
    // un'equivalenza, e infatti la riga continua a mostrare lo scarto
    out.push({ nome: k, qta: q, macro: m, dist: dist * (1 - 0.5 * aff), scarto: dist,
               variante: aff >= AFFINE_PARENTI, unita: v.unita, fonte: v.fonte });
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

/**
 * Formula della Marina USA. Errore reale ±3–4 punti: è una stima, non una DEXA.
 * Uomini e donne hanno equazioni diverse, e quella femminile richiede anche i
 * fianchi: usare la maschile su una donna sbaglia di parecchi punti, quindi
 * senza la misura dei fianchi è meglio non rispondere.
 */
function bodyFat(vita, collo, h, sesso, fianchi) {
  if (!(vita > 0 && collo > 0 && h > 0)) return null;
  let bf;
  if ((sesso || D.profilo.sesso) === 'f') {
    if (!(fianchi > 0)) return null;
    const somma = vita + fianchi - collo;
    if (somma <= 0) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(somma)
                        + 0.22100 * Math.log10(h)) - 450;
  } else {
    if (vita - collo < 5) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(vita - collo)
                       + 0.15456 * Math.log10(h)) - 450;
  }
  return bf > 2 && bf < 60 ? bf : null;
}

/** Composizione stimata oggi, già confrontata con il fisico target. */
function composition(k = today()) {
  const h = D.profilo.altezza_cm, TF = D.target_fisico;
  const vita = lastMeas('vita'), collo = lastMeas('collo'), torace = lastMeas('torace');
  const peso = trendW(k) ?? lastWeight() ?? D.profilo.peso_iniziale_kg;
  // un collo fuori scala falsa tutto: 7 cm di errore valgono 5 punti di grasso
  const colloSospetto = collo != null && (collo < 32 || collo > 48);
  const bf = colloSospetto ? null
    : bodyFat(vita, collo, h, D.profilo.sesso, lastMeas('fianchi'));
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
/**
 * Peso di tendenza: media su finestra elastica, tollera i giorni saltati.
 * Da quando esiste peso.js le pesate fuori scala vengono scartate: una sola
 * sbagliata di due chili sposta la media di 0,3 kg, e quei 0,3 kg diventano
 * 165 kcal al giorno di dispendio inventato dentro il bilancio energetico.
 */
function trendW(k = today(), n = 7) {
  if (typeof trendWRobusto === 'function') return trendWRobusto(k, n).peso;
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
  let sigma = Math.max(40, (dailyNoise() * M.kcal_per_kg * Math.sqrt(2 / 7)) / span);
  // una finestra che attraversa il confine fra follicolare e luteale contiene
  // acqua che il bilancio energetico legge come grasso: non la si sottrae —
  // quanta sia non lo sappiamo — si dice al filtro di fidarsi meno
  if (typeof inflazioneCiclo === 'function') sigma *= inflazioneCiclo(k, span);
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

/* --------------------------------------------- quello che registri spesso

   Con il piano spento il registro a mano e' l'unico modo di usare l'app, e si
   rifanno gli stessi cinque alimenti ogni giorno. Cercarli ogni volta e' il
   costo piu' alto e piu' stupido dell'intera applicazione.

   Si contano le voci gia' registrate e si ordinano per un misto di quante
   volte e quanto di recente: la sola frequenza terrebbe in cima per settimane
   una cosa mangiata tutti i giorni del mese scorso e mai piu'. */
function extraFrequenti(k = today(), quanti = 6) {
  const conti = new Map();
  for (const g of Object.keys(S.log)) {
    if (g > k) continue;
    const eta = Math.round((new Date(k) - new Date(g)) / 864e5);
    if (eta > 60) continue;
    // meta' peso ogni tre settimane: quello di ieri conta piu' di quello di un mese fa
    const peso = Math.pow(0.5, eta / 21);
    for (const e of (S.log[g].extra || [])) {
      if (!e.nome) continue;
      const c = conti.get(e.nome) || { ...e, n: 0, punti: 0, ultimo: g };
      c.n++; c.punti += peso;
      if (g > c.ultimo) { c.ultimo = g; Object.assign(c, e, { n: c.n, punti: c.punti, ultimo: g }); }
      conti.set(e.nome, c);
    }
  }
  return [...conti.values()].sort((x, y) => y.punti - x.punti).slice(0, quanti);
}

/* ------------------------------------------------------- giorni in pausa

   Vacanza, influenza, trasferta. Fino a ieri quella settimana entrava nella
   diagnosi e ti diceva che avevi sbagliato tutto — che e' vero e inutile
   insieme. Marcare una pausa NON cancella niente: i dati restano e si vedono
   ovunque, ma la revisione e i punteggi di costanza saltano quei giorni,
   perche' giudicare una settimana d'ospedale col metro di una normale non
   misura niente. */
function pause() { S.settings.pause ||= []; return S.settings.pause; }
function inPausa(k) {
  return pause().some(p => k >= p.dal && k <= (p.al || '9999'));
}
function pausaDi(k) {
  return pause().find(p => k >= p.dal && k <= (p.al || '9999')) || null;
}
/** Toglie dai giorni di una finestra quelli in pausa. */
function senzaPause(giorni) { return giorni.filter(g => !inPausa(g)); }

/* ------------------------------------------------- motore "cosa sbaglio" */
/**
 * Il pavimento dei grassi.
 *
 * Sotto una certa quota i grassi smettono di essere una voce del bilancio e
 * diventano un problema di funzionamento: sono il substrato degli ormoni
 * steroidei e il veicolo delle vitamine liposolubili, e un piano che li
 * schiaccia per far posto al resto si paga altrove. La letteratura mette il
 * minimo prudenziale fra 0,6 e 0,8 g per kg di peso: qui si usa 0,6, il bordo
 * basso, perche' e' una soglia d'allarme e non un obiettivo.
 *
 * Come tutte le costanti di letteratura di quest'app non e' una misura
 * sull'utente, e dove compare la UI lo dice.
 */
function pavimentoGrassi(k = today()) {
  const peso = (typeof weightMA === 'function' && weightMA(k))
    || D.profilo?.peso_iniziale_kg;
  return peso > 0 ? Math.round(peso * 0.6) : null;
}

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

    /* Carboidrati e grassi non sono contorno degli altri due. Il carboidrato
       e' il carburante del lavoro pesante; il grasso ha un pavimento sotto il
       quale non e' piu' una questione di bilancio. Le calorie da sole non
       bastano a vederlo: si puo' centrare il totale ed essere fuori su tutti
       e due, uno in su e uno in giu'. */
    const ac = avg(cons.map(m => m.c)), ag = avg(cons.map(m => m.g));
    if (T.c && ac != null && ac < T.c * 0.85) F.push(['warn', 'C', 'Carboidrati sotto il target',
      `Media ${nf(ac)} g contro ${T.c} g. Sono il carburante delle serie pesanti e il modo piu' rapido di rimettere glicogeno: quando calano il primo segno non è sulla bilancia, è sulle ultime ripetizioni e sul recupero fra le serie.`]);
    else if (T.c && ac != null && ac > T.c * 1.2) F.push(['warn', 'C', 'Carboidrati sopra il target',
      `Media ${nf(ac)} g contro ${T.c} g. Di per sé non è un problema; guarda però se proteine o grassi sono scesi per fare posto, perché è lì che si perde qualcosa.`]);

    const pav = pavimentoGrassi(k);
    if (T.g && ag != null && pav && ag < pav) F.push(['bad', 'G', 'Grassi sotto il minimo',
      `Media ${nf(ag)} g, sotto i ${pav} g che corrispondono a 0,6 g per kg di peso. Sotto quella quota i grassi non sono più una voce del bilancio: sono il substrato degli ormoni steroidei e il veicolo delle vitamine liposolubili. È un valore di letteratura, non una misura su di te.`]);
    else if (T.g && ag != null && ag < T.g * 0.8) F.push(['warn', 'G', 'Grassi sotto il target',
      `Media ${nf(ag)} g contro ${T.g} g. Sei sopra il minimo, quindi non è urgente: è però la voce più facile da riportare in linea, perché bastano pochi grammi di frutta secca o di olio.`]);
    else if (T.g && ag != null && ag > T.g * 1.25) F.push(['warn', 'G', 'Grassi sopra il target',
      `Media ${nf(ag)} g contro ${T.g} g. Nove calorie al grammo contro quattro: senza accorgersene comprimono i carboidrati, e i carboidrati sono quelli che ti fanno finire l'allenamento.`]);
  }

  // --- peso: media mobile 7 giorni contro quella di 7 giorni prima
  const ma = weightMA(k), maPrev = weightMA(addDays(k, -7));
  const pesate = d14.filter(x => S.log[x]?.peso != null).length;
  if (ma && maPrev && pesate >= 8) {
    const rate = ma - maPrev;                        // kg / settimana
    const vita = measTrend('vita', k);
    const vTrend = vita ? (vita.delta > 1 ? 'su' : vita.delta < -1 ? 'giu' : 'stabile') : 'stabile';
    // i carichi non si dichiarano piu' a mano: si leggono dalle schede
    const ct = typeof caricoTrend === 'function' ? caricoTrend(k) : { stato: null };
    const car = ct.stato || S.settings.carichi || 'fermi';
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
  // il pasto di oggi, non quello previsto: se lo hai cambiato conta il nuovo
  const low = main.filter(s => {
    if (!dd.pasti[s.codice]) return false;
    const m = typeof mealMGiorno === 'function' ? mealMGiorno(s.codice, k)
      : D.pasti[s.codice]?.macro;
    return m && m.p < T.min_p_per_pasto;
  });
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

/**
 * Il backup di TUTTI i profili, non solo di quello aperto.
 *
 * Prima si esportava JSON.stringify(S), cioe' il profilo attivo e basta: chi
 * ne aveva un secondo si portava a casa mezzo archivio senza accorgersene,
 * perche' il file sembrava completo. Ora il formato ha una busta con dentro
 * ogni profilo, e resta capace di rileggere i file vecchi — che sono
 * esattamente lo stato nudo, e vengono trattati come un profilo solo.
 */
function esportabile() {
  const P = profili();
  const stati = {};
  for (const x of P.lista) {
    const chiave = x.id === 'principale' ? KEY : KEY + ':' + x.id;
    // il profilo attivo si prende dalla memoria, non dal disco: potrebbe
    // esserci qualcosa non ancora salvato
    if (x.id === P.attivo) { stati[x.id] = S; continue; }
    try { stati[x.id] = JSON.parse(localStorage.getItem(chiave) || 'null'); } catch {}
  }
  return { formato: 2, app: 'dieta', quando: today(),
           profili: P, stati };
}

/** Cosa c'e' dentro un file, in una riga leggibile prima di sovrascrivere. */
function riassuntoBackup(o) {
  const righe = [];
  const conta = (nome, st) => {
    if (!st || !st.log) return;
    const gg = Object.keys(st.log).sort();
    const pesate = gg.filter(g => st.log[g]?.peso != null).length;
    const sedute = Object.keys(st.palestra?.sessioni || {}).length;
    righe.push({ nome, giorni: gg.length, da: gg[0], a: gg[gg.length - 1], pesate, sedute });
  };
  if (o.formato === 2) {
    for (const p of o.profili.lista) conta(p.nome, o.stati[p.id]);
  } else {
    conta('Profilo unico', o);
  }
  return righe;
}

function exportBackup() {
  const o = esportabile();
  const n = Object.keys(o.stati).length;
  download('dieta-backup-' + today() + '.json', JSON.stringify(o, null, 1),
           'application/json');
  S.settings.backup = today(); save();
  return n;
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

/* ----------------------------------------------------- consiglio del giorno */
/**
 * Preferisce sempre un consiglio che nasce dai TUOI dati a uno generico: un
 * suggerimento che descrive la tua settimana viene letto, uno da bugiardino
 * no. I generici entrano solo quando non c'e' niente di specifico da dire, e
 * ruotano in modo deterministico sulla data: lo stesso giorno mostra lo stesso
 * consiglio, cosi' non cambia a ogni tocco.
 */
function consiglioDelGiorno(k = today()) {
  const T = D.target, d7 = windowDays(k, 7);
  const cons = d7.map(x => S.log[x] ? consumed(x) : null).filter(m => m && m.kcal > 400);
  const media = id => avg(d7.map(x => S.log[x]?.[id]));

  const mirati = [];
  const collo = lastMeas('collo');
  if (collo != null && (collo < 32 || collo > 48)) mirati.push({
    t: 'Rimisura il collo', c: `Con ${nf(collo, 1)} cm la stima del grasso resta bloccata:
    la formula si regge sulla differenza vita-collo e un valore fuori scala la rende inutile.
    E' la misura che sblocca meta' della scheda Corpo.` });

  if (cons.length >= 3) {
    const ap = avg(cons.map(m => m.p));
    if (ap < T.p * 0.9) mirati.push({
      t: 'Proteine sotto target', c: `Media ${nf(ap, 0)} g contro ${T.p}. In ricomposizione
      e' la variabile che protegge la massa magra mentre tutto il resto si muove:
      prima di toccare qualsiasi altra cosa, sistema questa.` });
    const af = avg(cons.map(m => m.fibre));
    if (af && af < T.fibre * 0.7) mirati.push({
      t: 'Fibre indietro', c: `Media ${nf(af, 0)} g contro ${T.fibre} previsti. Di solito
      significa che stai saltando i legumi, e con loro se ne vanno anche ferro e sazieta'.` });
  }
  const sn = media('sonno');
  if (sn != null && sn < 6.5) mirati.push({
    t: 'Dormi poco', c: `Media ${nf(sn, 1)} ore. Il sonno insufficiente alza la fame del
    giorno dopo e abbassa la sintesi proteica: sistemarlo sposta piu' della somma di
    tutti gli aggiustamenti sui macro.` });
  const aq = media('acqua');
  if (aq != null && aq < T.acqua_l * 0.75) mirati.push({
    t: 'Bevi poco per le fibre che mangi', c: `Media ${nf(aq, 1)} L contro ${T.acqua_l}.
    Con ${T.fibre} g di fibre l'acqua non e' un dettaglio: fibre alte e acqua bassa
    danno gonfiore, non regolarita'.` });

  const pesate = windowDays(k, 14).filter(x => S.log[x]?.peso != null).length;
  if (pesate < 6) mirati.push({
    t: 'Servono piu\' pesate', c: `${pesate} negli ultimi 14 giorni. Sotto le otto la media
    mobile non significa niente, e senza quella il motore di previsione resta fermo
    alla stima da formula.` });

  if (typeof statoMuscoli === 'function' && PD) {
    const st = statoMuscoli(k);
    const fermi = Object.values(st).filter(x => x.serie === 0 && x.forma > 0.15);
    if (fermi.length) mirati.push({
      t: 'Un gruppo e\' rimasto indietro', c: `Questa settimana non hai allenato
      ${fermi.slice(0, 3).map(x => x.nome.toLowerCase()).join(', ')}. Non e' un dramma su una
      settimana, ma la forma accumulata svanisce in circa sei settimane se non la ritocchi.` });
  }
  if (backupDue()) mirati.push({
    t: 'Fai un backup', c: 'Hai parecchi giorni registrati dall\'ultimo export. I dati stanno solo su questo telefono: senza un file salvato altrove, svuotare Safari significa ricominciare.' });

  if (mirati.length) {
    // ruota anche fra i mirati, cosi' non vedi sempre lo stesso
    const i = Math.abs(hashData(k)) % mirati.length;
    return { ...mirati[i], mirato: true, quanti: mirati.length };
  }
  const G = D.consigli || [];
  if (!G.length) return null;
  return { ...G[Math.abs(hashData(k)) % G.length], mirato: false };
}
/** Numero stabile ricavato dalla data: stesso giorno, stesso consiglio. */
function hashData(k) {
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return h;
}

function cardConsiglio(k) {
  const c = consiglioDelGiorno(k);
  if (!c) return null;
  const box = el('div', 'card advice' + (c.mirato ? ' mirato' : ''));
  box.append(el('div', 'eyebrow', c.mirato ? 'Dai tuoi dati' : 'Consiglio del giorno'));
  box.append(el('h3', 'advice-t', esc(c.t)));
  box.append(el('p', 'advice-c', esc(c.c.replace(/\s+/g, ' ').trim())));
  return box;
}

/* --------------------------------------------------------------- router */
const ROUTES = { oggi: viewOggi, diario: viewDiario, corpo: viewCorpo,
                 palestra: viewPalestra, andamento: viewAndamento,
                 spesa: viewSpesa, prodotti: viewProdotti, foto: viewFoto,
                 piano: viewPiano, hyrox: viewHyrox, benvenuto: viewBenvenuto,
                 importa: viewImporta, salute: viewSalute,
                 previsioni: viewPrevisioni };
const TITLES = { oggi: 'Oggi', diario: 'Diario', corpo: 'Corpo',
                 palestra: 'Palestra', dati: 'Dati', analisi: 'Analisi',
                 andamento: 'Andamento',
                 spesa: 'Spesa', prodotti: 'Alimenti', foto: 'Foto',
                 piano: 'Piano', hyrox: 'Road to HYROX', benvenuto: 'Benvenuto',
                 revisione: 'La settimana', importa: 'Importo da Salute',
                 salute: 'Dati dal telefono', previsioni: 'Dove stai andando' };

function route() {
  let name = (location.hash.replace('#/', '') || 'oggi').split('?')[0];
  // finche' non si e' scelto da cosa partire non si mostra il piano di nessuno
  if (typeof pianoScelto === 'function' && !pianoScelto()) name = 'benvenuto';
  /* #/dati, #/analisi e #/revisione erano tre schermate e ora sono tre viste
     di una: restano indirizzi validi — ci puntano i link dentro l'app e i
     segnalibri di chi ce li ha — e aprono Andamento sulla vista giusta. */
  if (typeof rottaAndamento === 'function') name = rottaAndamento(name);
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
  r.children[1].style.cursor = 'pointer';
  if (typeof sheetGiorno === 'function') r.children[1].onclick = () => sheetGiorno(k);
  nav.append(r); v.append(nav);

  if (k === today()) {
    if (typeof cardPesataAnomala === 'function') {
      const ca = cardPesataAnomala(k); if (ca) v.append(ca);
    }
    if (typeof revisionePronta === 'function' && revisionePronta(k)) {
      const inv = el('button', 'card rev-invito');
      inv.innerHTML = `<span class="eyebrow">La settimana e' chiusa</span>
        <span class="t">Guarda com'e' andata</span>
        <span class="d">Il confronto con la settimana prima, cosa non ha funzionato e la sola cosa da cambiare.</span>
        <span class="g">Apri la revisione &rsaquo;</span>`;
      inv.onclick = () => { location.hash = '#/revisione'; };
      v.append(inv);
      if (typeof pulsa === 'function') setTimeout(() => pulsa(inv), 250);
    }
    const cc = cardConsiglio(k); if (cc) v.append(cc);
    if (typeof cardSfida === 'function') { const cs = cardSfida(k); if (cs) v.append(cs); }
  }

  // barre macro
  const cons = consumed(k), tgt = dayTarget(k);
  const box = el('div', 'card');
  const g = el('div', 'macros');
  /* Quattro voci e non cinque: le fibre hanno il loro grafico nel cruscotto e
     la loro riga in ogni pasto, ma qui erano la quinta colonna su un telefono
     e stringevano le altre quattro — che sono quelle che si guardano dieci
     volte al giorno. */
  for (const [id, lab, dec] of [['kcal', 'kcal', 0], ['p', 'prot', 0],
                                ['c', 'carb', 0], ['g', 'gras', 0]]) {
    const pc = tgt[id] ? cons[id] / tgt[id] : 0;
    const cls = pc > 1.15 ? 'way' : pc > 1.02 ? 'over' : '';
    const mb = el('div', 'macro',
      `<div class="lab">${lab}</div><div class="val">${nf(cons[id], dec)}</div>
       <div class="of">/ ${nf(tgt[id], dec)}</div>
       <div class="bar"><i class="${cls}" style="width:${Math.min(pc * 100, 100)}%"></i></div>`);
    g.append(mb);
    // la barra cresce da sinistra con scaleX: animare width farebbe ricalcolare
    // il layout a ogni fotogramma, e la larghezza e' gia' quella giusta
    if (typeof osserva === 'function') osserva(mb, () => {
      if (!motionOk()) return;
      const i = mb.querySelector('.bar i');
      i.style.transformOrigin = 'left center';
      i.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }],
        { duration: 620, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
      contaSu(mb.querySelector('.val'), cons[id], { dec, dur: 700 });
    });
  }
  box.append(g);
  const rest = tgt.kcal - cons.kcal;
  const manca = ([id, nome]) => {
    const q = (tgt[id] || 0) - (cons[id] || 0);
    return q > 0.5 ? `<strong>${nf(q)} g</strong> di ${nome}` : null;
  };
  const resti = [['p', 'proteine'], ['c', 'carboidrati'], ['g', 'grassi']]
    .map(manca).filter(Boolean);
  box.append(el('div', 'muted', rest > 0
    ? `Restano <strong>${nf(rest)} kcal</strong>${resti.length
        ? ': ' + resti.slice(0, -1).join(', ') + (resti.length > 1 ? ' e ' : '') + resti[resti.length - 1]
        : ''}.`
    : `Sei a <strong>${nf(-rest)} kcal</strong> oltre il totale del giorno. Non compensare domani: conta la media della settimana.`));
  box.lastChild.style.marginTop = '10px';
  v.append(box);

  // pasti — solo se il piano e' acceso
  if (!usaPiano()) {
    v.append(cardGiornoLibero(k, d));
    return;
  }
  if (!plan.pasti.some(s => D.pasti[s.codice])) {
    const av = el('div', 'card flat');
    av.append(el('div', 'eyebrow', 'Giornata da comporre'));
    av.append(el('div', 'muted',
      'A questo giorno non e ancora assegnato nessun pasto. Vai in Piano, passo "Quando li mangi", e scegli cosa mettere in ogni slot.'));
    const b = el('button', 'btn wide pri', 'Apri il piano');
    b.style.marginTop = '10px';
    b.onclick = () => { if (typeof pianoTab !== 'undefined') pianoTab = 'settimana';
      location.hash = '#/piano'; };
    av.append(b);
    v.append(av);
  }
  for (const s of plan.pasti) {
    // il pasto che c'e' oggi: se lo hai cambiato, si vede quello
    const eff = typeof pastoDelGiorno === 'function'
      ? pastoDelGiorno(s.codice, k) : s.codice;
    const p = D.pasti[eff], done = !!d.pasti[s.codice];
    // slot senza pasto: con il piano vuoto e' la norma, non un errore
    if (!p) {
      const vuoto = el('button', 'meal vuoto');
      vuoto.innerHTML = `<div class="meal-h"><div class="grow">
        <div class="meal-slot">${esc(s.slot)}${s.ora ? ' · ' + esc(s.ora) : ''}</div>
        <div class="meal-name">Da assegnare</div></div></div>`;
      vuoto.onclick = () => { if (typeof pianoTab !== 'undefined') pianoTab = 'settimana';
        location.hash = '#/piano'; };
      v.append(vuoto);
      continue;
    }
    const m = el('div', 'meal' + (done ? ' done' : ''));
    const h = el('div', 'meal-h');
    const tick = el('button', 'tick', '✓');
    tick.onclick = () => {
      // il rimbalzo conferma il tocco prima che la pagina si ridisegni: senza,
      // su un telefono lento sembra che non sia successo niente
      if (!done && typeof pulsa === 'function') pulsa(tick, { scala: 1.35, dur: 320 });
      d.pasti[s.codice] = !done; save();
      setTimeout(route, done ? 0 : 130);
    };
    // toccare il nome del pasto apre le porzioni DI QUEL GIORNO: il piano dice
    // 50 g di salsa, ma se oggi ne hai usati 100 il conto deve seguire te
    const testa = el('div', 'grow tap',
      `<div class="meal-slot">${esc(s.slot)} · ${s.ora}</div>
       <div class="meal-name">${esc(p.nome)}${eff !== s.codice
         ? ' <em class="mod-tag">al posto di ' + esc(D.pasti[s.codice]?.nome || s.codice) + '</em>'
         : typeof porzioniCambiate === 'function' && porzioniCambiate(s.codice, k)
         ? ' <em class="mod-tag">porzioni cambiate</em>' : ''}</div>`);
    if (typeof sheetPorzioni === 'function' && p.ingredienti)
      testa.onclick = () => sheetPorzioni(k, s.codice);
    h.append(tick, testa,
      el('div', 'meal-kcal', (() => {
        // prima c'erano solo calorie e proteine, e per sapere quanti
        // carboidrati aveva un pasto bisognava aprirlo e sommare a mano
        const mg = typeof mealMGiorno === 'function' ? mealMGiorno(s.codice, k) : p.macro;
        return `<b>${nf(mg.kcal)}</b> kcal<span class="mm">${macroRiga(mg)}</span>`;
      })()));
    m.append(h);
    const ul = el('ul', 'ings');
    // gli ingredienti di OGGI: se uno e' stato sostituito qui si vede quello
    // che c'e' davvero, non quello che il piano prevedeva
    const ingg = typeof ingredientiGiorno === 'function'
      ? ingredientiGiorno(s.codice, k)
      : p.ingredienti.map(i => ({ slot: i.alimento, alimento: i.alimento, qta: i.qta,
                                  qtaPiano: i.qta, alPostoDi: null }));
    for (const ing of ingg) {
      const li = el('li', ing.alPostoDi ? 'sost' : null,
        `<span class="grow">${esc(ing.alimento)}
           ${ing.alPostoDi ? `<em class="dapiano">al posto di ${esc(ing.alPostoDi)}</em>` : ''}
           <span class="swap">${ing.alPostoDi ? 'cambia' : 'sostituisci'}</span></span>
         <span class="q">${nf(ing.qta, ing.qta % 1 ? 1 : 0)} ${
           typeof unitaIngrediente === 'function' ? esc(unitaIngrediente(ing))
             : (D.alimenti[ing.alimento]?.unita || 'g')}</span>`);
      li.onclick = () => sheetSwap(ing.alimento, ing.qta,
        { k, code: s.codice, slot: ing.slot, prod: ing.prod });
      ul.append(li);
    }
    m.append(ul); v.append(m);
  }

  // fuori piano
  v.append(listaExtra(k, d, true));
}

/**
 * L'elenco di quello che hai mangiato scrivendolo a mano.
 * Con il piano acceso e' il "fuori piano", l'eccezione. Con il piano spento
 * e' l'unico registro che c'e', e allora cambia nome e tono: non c'e' niente
 * da cui essere fuori.
 */
function listaExtra(k, d, conPiano) {
  const ex = el('div', 'card');
  ex.append(el('h2', 'sec', conPiano ? 'Fuori piano' : 'Cosa hai mangiato'));
  ex.lastChild.style.marginTop = conPiano ? '' : '0';
  ex.append(el('p', 'muted', conPiano
    ? 'Registralo e basta. Non serve compensare: il bilancio è settimanale.'
    : 'Aggiungi quello che mangi durante la giornata. Cercando un alimento i macro li calcola lui — tutti e cinque; altrimenti scrivi tu calorie e proteine.'));
  for (const [i, e] of d.extra.entries()) {
    const row = el('div', 'row between');
    row.style.cssText = 'padding:8px 0;border-top:1px solid var(--rule)';
    row.append(el('div', 'grow',
      `${esc(e.nome)}<span class="mm">${macroRiga(e)}</span>`),
      el('span', 'pill', `${nf(e.kcal)} kcal`));
    const del = el('button', 'btn sm', '×');
    del.onclick = () => { d.extra.splice(i, 1); save(); route(); };
    row.append(del); ex.append(row);
  }
  if (!d.extra.length) ex.append(el('p', 'hint', conPiano
    ? 'Niente fuori piano oggi.' : 'Ancora niente registrato oggi.'));
  const add = el('button', 'btn wide' + (conPiano ? '' : ' pri'),
    conPiano ? '+ Aggiungi pasto fuori piano' : '+ Aggiungi quello che hai mangiato');
  add.style.marginTop = '10px';
  add.onclick = () => sheetExtra(k);
  ex.append(add);
  return ex;
}

/** La scheda Oggi quando il piano e' spento: solo il registro del giorno. */
function cardGiornoLibero(k, d) {
  const box = el('div');
  box.append(listaExtra(k, d, false));
  const c = el('div', 'card flat');
  c.append(el('div', 'eyebrow', 'Stai andando a mano libera'));
  c.append(el('div', 'muted',
    'Il piano alimentare e\' spento: nessun pasto assegnato ai giorni, nessuna lista '
    + 'della spesa. Le barre qui sopra misurano quello che registri contro i target '
    + 'della scheda "Quanto mangiare", e tutto il resto — peso, previsione, palestra, '
    + 'revisione settimanale — funziona esattamente come prima.'));
  const b = el('button', 'btn wide');
  b.style.marginTop = '10px';
  b.textContent = 'Accendi il piano alimentare';
  b.onclick = () => { if (typeof pianoTab !== 'undefined') pianoTab = 'profilo';
    location.hash = '#/piano'; };
  c.append(b);
  box.append(c);
  return box;
}

/* ------------------------------------------------------ sheet: swap */
function sheet(html) {
  $('#sheet-body').innerHTML = ''; $('#sheet-body').append(html);
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }

/**
 * Le sostituzioni, e il bottone che le applica davvero.
 *
 * Per molto tempo questo foglio era una tabella: diceva "al posto di 100 g di
 * riso vanno 120 g di patate" e poi lasciava li'. Chi la sostituzione la
 * faceva davvero doveva andare in "porzioni", azzerare l'ingrediente
 * originale e aggiungere l'altro come pasto fuori piano — tre schermate per
 * una cosa che l'app aveva gia' calcolato.
 *
 * Ora si applica, e vale SOLO PER QUEL GIORNO. E' la stessa regola delle
 * porzioni ed e' quella giusta: il pasto nel piano e' la ricetta, il diario
 * dice cos'e' successo quel giorno. Sostituire il riso per sempre si fa
 * nell'editor del pasto, che e' un'altra cosa e un altro posto.
 *
 * `ctx` porta il giorno e il codice del pasto. Senza, il foglio resta quello
 * di prima e informa e basta: e' il caso di chi lo apre da un punto dove non
 * c'e' una giornata a cui applicarlo.
 */
function sheetSwap(nome, qta, ctx) {
  const wrap = el('div');
  /* Quello che c'e' adesso in quel posto puo' essere un alimento del piano
     oppure un prodotto col codice a barre, che nel piano un nome non ce l'ha:
     i suoi valori si prendono dal registro dei prodotti. */
  const pr = ctx?.prod && typeof mangiabile === 'function'
    ? mangiabile('p:' + ctx.prod) : null;
  const a = D.alimenti[nome] || pr;
  const src = pr && typeof macroMangiabile === 'function'
    ? (macroMangiabile('p:' + ctx.prod, qta) || M0())
    : foodM(nome, qta);
  /* Il motore delle alternative ragiona per categoria, e un prodotto non ne
     ha una: si parte dall'ingrediente che il PIANO prevedeva in quel posto,
     che e' comunque la domanda giusta — "cos'altro ci puo' andare". */
  const rif = ctx?.slot && D.alimenti[ctx.slot] ? ctx.slot
    : (D.alimenti[nome] ? nome : null);
  const attiva = ctx && typeof swapDelGiorno === 'function'
    ? swapDelGiorno(ctx.code, ctx.k, ctx.slot ?? nome) : null;

  wrap.append(el('div', 'eyebrow', 'Sostituzioni equivalenti'));
  wrap.append(el('h2', 'sec',
    `${nf(qta, qta % 1 ? 1 : 0)} ${a?.unita || 'g'} di ${esc(nome)}`));
  wrap.lastChild.style.marginTop = '0';
  wrap.append(el('p', 'muted', `${nf(src.kcal)} kcal · ${macroRiga(src)}`
    + (pr ? ' · <span class="mono">dalla tua etichetta</span>' : '')));

  if (ctx) wrap.append(el('p', 'hint',
    'Quello che scegli vale <strong>solo per oggi</strong>: il pasto nel piano '
    + 'resta com\'e\' e domani torna al suo ingrediente. Per cambiarlo per sempre '
    + 'si passa dall\'editor del pasto, in Piano.'));

  if (attiva) {
    const box = el('div', 'card flat');
    box.append(el('div', 'eyebrow', 'Adesso al suo posto c\'e\''));
    box.append(el('div', 'muted',
      `<strong>${esc(attiva.a)}</strong> · ${nf(attiva.qta, attiva.qta % 1 ? 1 : 0)} `
      + `${esc(D.alimenti[attiva.a]?.unita || 'g')}`));
    const via = el('button', 'btn wide');
    via.style.marginTop = '9px';
    via.textContent = 'Rimetti ' + nome;
    via.onclick = () => {
      metteSwap(ctx.code, ctx.k, ctx.slot ?? nome, null);
      closeSheet(); route(); toast('Rimesso ' + nome);
    };
    box.append(via);
    wrap.append(box);
  }

  /** Una riga scegliibile: se c'e' un giorno a cui applicarla, la applica. */
  const opzione = (titolo, dettaglio, alimento, quanto, tag) => {
    const r = el(ctx ? 'button' : 'div', 'swapopt');
    r.innerHTML = `<div class="grow"><strong>${esc(titolo)}</strong>${
         tag ? `<span class="pill ok">${esc(tag)}</span>` : ''}
         <div class="d">${dettaglio}</div></div>
       <div class="mono">${nf(quanto, quanto % 1 ? 1 : 0)} ${
         esc(D.alimenti[alimento]?.unita || 'g')}${ctx ? ' ›' : ''}</div>`;
    if (ctx) r.onclick = () => {
      metteSwap(ctx.code, ctx.k, ctx.slot ?? nome, alimento, quanto);
      closeSheet(); route();
      toast(alimento + ' al posto di ' + nome + ', solo per oggi');
    };
    wrap.append(r);
  };

  const curated = (D.sostituzioni_consigliate || []).filter(x => x.da === rif
    && D.alimenti[x.a]);
  if (curated.length) {
    wrap.append(el('h2', 'sec', 'Consigliate'));
    for (const x of curated) opzione(x.a, esc(x.nota || ''), x.a, x.qta_a);
  }

  wrap.append(el('h2', 'sec', 'Calcolate a parita’ di macro'));
  const list = rif ? swaps(rif, qta) : [];
  if (!list.length) wrap.append(el('p', 'muted', 'Nessuna alternativa nella stessa categoria.'));
  else if (rif !== nome) wrap.append(el('p', 'hint',
    `Calcolate su <strong>${esc(rif)}</strong>, l\'ingrediente che il piano prevede `
    + 'in questo posto: quello che ci hai messo oggi e\' un prodotto, e i prodotti '
    + 'non hanno una categoria da cui partire.'));
  for (const x of list) {
    // il motore riscala sul macro dominante, ma la sostituzione la paghi su
    // tutti e quattro: vedere solo lo scarto in proteine nasconde la meta'
    // dei casi in cui il cambio costa venti grammi di carboidrati
    const dk = x.macro.kcal - src.kcal;
    const dd = ([id, l]) => {
      const q = x.macro[id] - src[id];
      return `${q >= 0 ? '+' : '−'}${nf(Math.abs(q), 1)} ${l}`;
    };
    opzione(x.nome,
      `${dk >= 0 ? '+' : '−'}${nf(Math.abs(dk))} kcal · `
      + [['p', 'P'], ['c', 'C'], ['g', 'G'], ['fibre', 'fib']].map(dd).join(' · ')
      + (x.fonte === 'stima' ? ' · valore stimato' : ''),
      x.nome, x.qta, x.variante ? 'stesso alimento, altra versione' : null);
  }

  /* --- e se nessuna delle proposte e' quella giusta ---
     Il motore ordina per somiglianza, ma "somigliante" non e' "voluto": chi
     ha in casa il latte proteico oggi e quello normale domani sta scegliendo,
     non cercando un'equivalenza. Qui si prende qualunque alimento, la
     quantita' si propone a parita' di macro dominante e resta modificabile. */
  if (ctx && typeof selettoreCercabile === 'function' && typeof mangiabili === 'function') {
    wrap.append(el('h2', 'sec', 'Oppure scegli tu'));
    let scelto = null;
    const f = el('div', 'field');
    const q = el('div', 'field',
      `<label>Quanto ne metti</label>
       <input type="text" inputmode="decimal" id="sw-q" value="">`);
    q.hidden = true;
    const ant = el('div', 'read');
    ant.hidden = true;
    const ok = el('button', 'btn wide pri', 'Usa questo');
    ok.style.marginTop = '10px';
    ok.hidden = true;

    const aggiorna = () => {
      const x = mangiabile(scelto);
      if (!x) return;
      const qta2 = parseNum($('#sw-q')?.value) ?? 0;
      const m = macroMangiabile(scelto, qta2) || M0();
      const dd2 = ([id, l]) => {
        const v = (m[id] || 0) - (src[id] || 0);
        return `<span>${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 1)} ${l}</span>`;
      };
      ant.innerHTML = `<span><b>${nf(m.kcal)} kcal</b></span>`
        + `<span>${(m.kcal - src.kcal) >= 0 ? '+' : '−'}${nf(Math.abs(m.kcal - src.kcal))} kcal</span>`
        + [['p', 'P'], ['c', 'C'], ['g', 'G'], ['fibre', 'fib']].map(dd2).join('')
        + (x.stima ? '<span class="mono muted">valore stimato</span>' : '');
    };

    /* Tutto quello che si puo' mangiare, prodotti col codice a barre compresi.
       Prima erano esclusi perche' la ricetta di un pasto ragiona per nomi di
       alimenti e un prodotto sciolto un nome dentro il piano non ce l'ha — ma
       il problema era del modello, non dell'utente: se lo hai registrato e
       stasera lo mangi, il diario deve saperlo scrivere. Adesso la
       sostituzione si porta dietro l'id del prodotto. */
    const opz = mangiabili().filter(x => x.nome !== nome).map(x => ({
      v: x.id, lab: x.nome,
      sub: `${x.fonte === 'prodotto' ? (x.marca ? x.marca + ' · ' : 'tuo prodotto · ') : ''}${
        nf(x.kcal)} kcal · ${nf(x.p, 1)} P per 100 ${x.unita}`
    }));
    f.append(selettoreCercabile(opz, null, id => {
      scelto = id;
      const x = mangiabile(id);
      ok.textContent = 'Usa ' + (x ? x.nome : 'questo');
      // la quantita' proposta pareggia il macro dominante, come fa il motore:
      // e' un punto di partenza, non un vincolo
      const dom2 = src.p * 4 > src.kcal * 0.2 ? 'p' : 'kcal';
      const per100 = x ? x[dom2 === 'p' ? 'p' : 'kcal'] : 0;
      const prop = per100 > 0 ? Math.round((src[dom2] / per100) * 100) : 100;
      $('#sw-q').value = Math.max(1, Math.min(2000, prop));
      q.hidden = false; ant.hidden = false; ok.hidden = false;
      aggiorna();
    }, 'latte proteico, avena, la tua barretta…'));
    wrap.append(f, q, ant);
    wrap.addEventListener('input', e => { if (e.target.id === 'sw-q') aggiorna(); });

    ok.onclick = () => {
      const x = mangiabile(scelto);
      const qta2 = parseNum($('#sw-q').value);
      if (!x || !(qta2 > 0)) { toast('Serve una quantita\''); return; }
      // un prodotto si porta dietro il suo id: e' l'unico modo di ritrovarne
      // i valori, visto che nel piano un nome non ce l'ha
      metteSwap(ctx.code, ctx.k, ctx.slot ?? nome, x.nome, qta2,
        x.fonte === 'prodotto' ? scelto.slice(2) : null);
      closeSheet(); route();
      toast(x.nome + ' al posto di ' + nome + ', solo per oggi');
    };
    wrap.append(ok);
    wrap.append(el('p', 'note',
      'La quantita\' proposta pareggia il macro che conta di piu\' in questo '
      + 'alimento — le proteine se ne danno piu\' di un quinto delle calorie, '
      + 'altrimenti le calorie. Cambiala e i quattro scarti si aggiornano. '
      + 'Ci sono anche i prodotti registrati col codice a barre: quelli usano i '
      + 'valori della loro etichetta.'));
  }

  const b = el('button', 'btn wide pri', 'Chiudi');
  b.style.marginTop = '14px';
  b.onclick = closeSheet;
  wrap.append(b);
  sheet(wrap);
}

function sheetExtra(k) {
  const w = el('div');
  w.append(el('div', 'eyebrow', usaPiano() ? 'Fuori piano' : 'Registro del giorno'));
  w.append(el('h2', 'sec', 'Cosa hai mangiato'));
  w.lastChild.style.marginTop = '0';

  /* Le cose che registri spesso, a portata di un tocco solo. */
  const freq = extraFrequenti(k);
  if (freq.length) {
    w.append(el('div', 'eyebrow', 'Di solito registri'));
    const chips = el('div', 'chips');
    for (const f of freq) {
      const b = el('button', 'chip');
      b.innerHTML = `<span class="n">${esc(f.nome)}</span>`
        + `<span class="k">${nf(f.kcal)} kcal</span>`;
      b.onclick = () => {
        const { nome, kcal, p, c, g: gr, fibre } = f;
        day(k).extra.push({ nome, kcal, p, c: c || 0, g: gr || 0, fibre: fibre || 0 });
        save(); closeSheet(); route(); toast('Registrato');
      };
      chips.append(b);
    }
    w.append(chips);
    if (typeof osserva === 'function')
      osserva(chips, () => entrata([...chips.children], { passo: 40, su: 6 }));
  }

  /* Scrivere kcal e proteine a mano per ogni cosa e' sopportabile finche' e'
     l'eccezione. Con il piano spento diventa l'unico modo di usare l'app, e
     allora non lo e' piu': si sceglie l'alimento e la quantita', e i macro —
     tutti e cinque, non solo due — li fa lui. */
  let scelto = null;
  if (typeof selettoreCercabile === 'function') {
    const f = el('div', 'field', '<label>Cerca un alimento o un tuo prodotto</label>');
    // l'elenco comprende i prodotti registrati col codice a barre: prima
    // restavano nel registro dei prodotti senza poter finire in una giornata
    const opz = (typeof mangiabili === 'function' ? mangiabili() : []).map(x => ({
      v: x.id, lab: x.nome,
      sub: `${x.fonte === 'prodotto' ? (x.marca ? x.marca + ' · ' : 'tuo prodotto · ') : ''}${
        nf(x.kcal)} kcal · ${nf(x.p, 1)} P · ${nf(x.c, 1)} C · ${nf(x.g, 1)} G per 100 ${x.unita}`
    }));
    const selA = selettoreCercabile(opz, null, n => { scelto = n; aggiorna(); },
      'pane, tofu, la tua barretta…');
    f.append(selA);
    w.append(f);
  }
  const fq = el('div', 'field',
    '<label>Quantita (g o ml)</label><input type="text" inputmode="decimal" id="x-q" value="100">');
  fq.hidden = true;
  w.append(fq);
  const anteprima = el('div', 'read');
  anteprima.hidden = true;
  w.append(anteprima);

  w.append(el('div', 'field',
    `<label>Oppure scrivilo tu</label><input type="text" id="x-n" placeholder="Es. cornetto al bar">`));
  const g = el('div'); g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
  g.append(el('div', 'field', `<label>kcal</label><input type="text" id="x-k" inputmode="numeric">`),
           el('div', 'field', `<label>Proteine (g)</label><input type="text" id="x-p" inputmode="decimal">`));
  w.append(g);

  const macroScelti = () => {
    if (!scelto) return null;
    const q = parseNum($('#x-q')?.value) ?? 100;
    const x = typeof mangiabile === 'function' ? mangiabile(scelto) : null;
    if (!x) return null;
    return { id: scelto, nome: x.nome, unita: x.unita, stima: x.stima,
             prodotto: x.fonte === 'prodotto', q, m: macroMangiabile(scelto, q) };
  };
  const aggiorna = () => {
    const s = macroScelti();
    fq.hidden = !s; anteprima.hidden = !s;
    if (!s) return;
    anteprima.innerHTML = `<span><b>${nf(s.m.kcal)} kcal</b></span><span>${nf(s.m.p, 1)} P</span>`
      + `<span>${nf(s.m.c, 1)} C</span><span>${nf(s.m.g, 1)} G</span><span>${nf(s.m.fibre, 1)} fibre</span>`;
    if (s.stima) anteprima.innerHTML += '<span class="mono muted">valore stimato</span>';
    else if (s.prodotto)
      anteprima.innerHTML += '<span class="mono muted">dalla tua etichetta</span>';
  };
  w.addEventListener('input', e => { if (e.target.id === 'x-q') aggiorna(); });

  const b = el('button', 'btn wide pri', 'Registra');
  b.onclick = () => {
    const s = macroScelti();
    if (s) {
      day(k).extra.push({ nome: `${s.nome} · ${nf(s.q)} ${s.unita}`, ...s.m });
    } else {
      const n = $('#x-n').value.trim();
      const kc = parseNum($('#x-k').value) || 0;
      if (!n && !kc) { toast('Scegli un alimento o scrivi cosa hai mangiato'); return; }
      day(k).extra.push({ nome: n || 'Fuori piano', kcal: kc,
        p: parseNum($('#x-p').value) || 0, c: 0, g: 0, fibre: 0 });
    }
    save(); closeSheet(); route(); toast('Registrato');
  };
  w.append(b); sheet(w);
}

/* --------------------------------------------------------- vista DIARIO */
/* ==================================================================== acqua
 *
 * Era un campo numerico in litri, e chiedeva la cosa sbagliata: nessuno beve
 * "0,25 L", si beve un bicchiere. E soprattutto l'acqua non si registra una
 * volta al giorno — si aggiunge otto volte — quindi ogni registrazione doveva
 * costare un tocco, non "apri la tastiera, cancella 1.2, scrivi 1.4".
 *
 * I recipienti sono quattro perche' quattro sono quelli che uno ha in casa, e
 * i millilitri sono quelli tipici: un bicchiere da tavola sta fra i 200 e i
 * 250, una tazza da colazione sui 250, la bottiglietta da banco e' 500, la
 * bottiglia grande 1,5 L. Sono capienze convenzionali, non misure: chi ha una
 * borraccia da 750 scrive il numero, e il campo per farlo e' rimasto.
 */
const BICCHIERI = [
  { id: 'bicchiere', n: 'Bicchiere', ml: 200 },
  { id: 'tazza', n: 'Tazza', ml: 250 },
  { id: 'bottiglietta', n: 'Bottiglietta', ml: 500 },
  { id: 'bottiglia', n: 'Bottiglia', ml: 1500 }
];

/** I quattro recipienti, disegnati. Sette tratti l'uno, come le icone di Gym. */
function iconaBicchiere(id) {
  const P = {
    // un tronco di cono: il bicchiere da tavola
    bicchiere: 'M7.5 4h9l-1.2 16h-6.6z',
    // la tazza, col manico
    tazza: 'M6 5h11v9a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 6 14zM17 7.5h1.8a2.4 2.4 0 0 1 0 4.8H17',
    // la bottiglietta: collo corto, spalle piene
    bottiglietta: 'M10 3h4v2.6l1.8 2.6V21H8.2V8.2L10 5.6z',
    // la bottiglia grande: collo lungo
    bottiglia: 'M10.2 2.6h3.6v4l2 2.8V21H8.2V9.4l2-2.8z'
  };
  const s = mk('svg', { viewBox: '0 0 24 24', class: 'ic-g', 'aria-hidden': 'true' });
  s.append(mk('path', { d: P[id] || P.bicchiere, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  return s;
}

/**
 * La bottiglia che si riempie.
 *
 * Il livello e' scritto nell'SVG prima di qualunque animazione: se
 * l'IntersectionObserver non scatta, o il browser non anima, il disegno e'
 * comunque giusto — e' il riempimento a portare il dato, il movimento e' solo
 * il modo in cui ci arriva.
 */
function bottigliaSVG(quota) {
  const q = Math.max(0, Math.min(1, quota || 0));
  const W = 74, H = 122;
  const s = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bott', 'aria-hidden': 'true' });
  const sagoma = 'M27 6h20v13.5l9 12.5v78a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6V32l9-12.5z';
  const cid = 'bott-clip-' + Math.random().toString(36).slice(2, 7);
  const cp = mk('clipPath', { id: cid });
  cp.append(mk('path', { d: sagoma }));
  s.append(cp);
  s.append(mk('path', { d: sagoma, fill: 'var(--wash)' }));
  const g = mk('g', { 'clip-path': `url(#${cid})`, class: 'liv' });
  // l'acqua parte dal fondo: alta quanto la quota, e con la superficie mossa
  const h = 6 + q * (H - 12);
  const y = H - h;
  g.append(mk('path', {
    d: `M-4 ${y + 4} q 10 -5 20 0 t 20 0 t 20 0 t 20 0 V${H + 4} H-4 Z`,
    fill: 'var(--media)', opacity: q ? .85 : 0
  }));
  s.append(g);
  s.append(mk('path', { d: sagoma, fill: 'none', stroke: 'var(--ink-3)',
    'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
  return { svg: s, gruppo: g };
}

/**
 * La carta dell'acqua.
 *
 * `d.sorsi` e' l'elenco dei millilitri aggiunti, e non e' ridondante rispetto
 * a `d.acqua`: serve a togliere l'ultimo esattamente com'era, senza chiedere
 * a chi ha toccato per sbaglio di ricordarsi quanto valeva.
 */
function cardAcqua(k) {
  const d = day(k);
  const tgt = D.target?.acqua_l || 2.5;
  const litri = d.acqua || 0;
  const quota = tgt ? litri / tgt : 0;

  const c = el('div', 'card acqua');
  c.append(el('div', 'eyebrow', 'Acqua'));

  const testa = el('div', 'acq-testa');
  const { svg, gruppo } = bottigliaSVG(quota);
  testa.append(svg);
  const nums = el('div', 'acq-num');
  const manca = Math.max(0, tgt - litri);
  // il numero sta in uno span suo: contaSu() scrive textContent, e con l'unita'
  // dentro lo stesso nodo la "L" sparirebbe al primo fotogramma
  nums.innerHTML = `<div class="v"><span class="n">${nf(litri, 2)}</span><em>L</em></div>
    <div class="t">su ${nf(tgt, 2)} L</div>
    <div class="s">${litri >= tgt
      ? 'target raggiunto'
      : `ne mancano ${nf(manca, 2)} L`}</div>`;
  testa.append(nums);
  c.append(testa);
  if (typeof osserva === 'function' && typeof motionOk === 'function')
    osserva(c, () => {
      if (!motionOk()) return;
      gruppo.style.transformOrigin = 'bottom';
      gruppo.animate([{ transform: 'scaleY(0)' }, { transform: 'none' }],
        { duration: 700, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' });
      contaSu(nums.querySelector('.v .n'), litri, { dec: 2, dur: 700 });
    });

  const aggiungi = ml => {
    const dd = day(k);
    dd.sorsi = [...(dd.sorsi || []), ml];
    dd.acqua = Math.round(((dd.acqua || 0) + ml / 1000) * 1000) / 1000;
    save(); route();
  };

  const g = el('div', 'acq-grid');
  for (const b of BICCHIERI) {
    const bt = el('button', 'acq-b');
    bt.append(iconaBicchiere(b.id));
    bt.append(el('span', 'n', esc(b.n)));
    bt.append(el('span', 'ml', b.ml >= 1000 ? nf(b.ml / 1000, 1) + ' L' : b.ml + ' ml'));
    bt.onclick = () => {
      if (typeof pulsa === 'function') pulsa(bt, { scala: 1.08, dur: 260 });
      setTimeout(() => aggiungi(b.ml), 90);
    };
    g.append(bt);
  }
  c.append(g);

  const riga = el('div', 'row');
  riga.style.cssText = 'gap:8px;margin-top:10px';
  const undo = el('button', 'btn sm');
  const ultimo = (d.sorsi || [])[(d.sorsi || []).length - 1];
  undo.textContent = ultimo
    ? `Annulla ${ultimo >= 1000 ? nf(ultimo / 1000, 1) + ' L' : ultimo + ' ml'}`
    : 'Annulla l\'ultimo';
  undo.disabled = !ultimo;
  undo.onclick = () => {
    const dd = day(k);
    const ml = (dd.sorsi || []).pop();
    if (!ml) return;
    dd.acqua = Math.max(0, Math.round(((dd.acqua || 0) - ml / 1000) * 1000) / 1000);
    if (!dd.sorsi.length) delete dd.sorsi;
    save(); route();
  };
  riga.append(undo);

  const man = el('button', 'btn sm', 'Scrivi tu');
  man.onclick = () => sheetAcquaManuale(k);
  riga.append(man);
  c.append(riga);

  if ((d.sorsi || []).length) c.append(el('div', 'hint',
    `Oggi: ${d.sorsi.map(x => x >= 1000 ? nf(x / 1000, 1) + ' L' : x + ' ml').join(' + ')}.`));
  c.append(el('p', 'note',
    'Le capienze sono quelle convenzionali, non misurate: un bicchiere da tavola '
    + 'sta fra i 200 e i 250 ml. Per una borraccia da 750 o per correggere il '
    + 'totale c\'e\' "scrivi tu".'));
  return c;
}

/** Il totale a mano: per le borracce che non stanno in nessuna delle quattro. */
function sheetAcquaManuale(k) {
  const d = day(k);
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Acqua'));
  w.append(el('h2', 'sec', 'Scrivi il totale'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Il totale di oggi, in litri. Scrivendolo qui l\'elenco dei bicchieri di oggi '
    + 'si azzera: da quel momento il numero sei tu ad averlo deciso, e i tocchi '
    + 'successivi ripartono da li\'.'));
  w.append(el('div', 'field',
    `<label>Litri</label><input type="text" inputmode="decimal" id="aq-v"
      value="${d.acqua != null ? esc(String(d.acqua)) : ''}">`));
  const ok = el('button', 'btn wide pri', 'Salva');
  ok.onclick = () => {
    const n = parseNum($('#aq-v').value);
    if (n == null || n < 0 || n > 20) { toast('Un numero fra 0 e 20'); return; }
    const dd = day(k);
    dd.acqua = n;
    delete dd.sorsi;
    save(); closeSheet(); route();
  };
  w.append(ok);
  const ann = el('button', 'btn wide', 'Annulla');
  ann.style.marginTop = '8px';
  ann.onclick = closeSheet;
  w.append(ann);
  sheet(w);
}

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

  if (D.profilo?.sesso === 'f' && typeof cardCiclo === 'function') v.append(cardCiclo(k));

  v.append(cardAcqua(k));

  const c1 = el('div', 'card');
  c1.append(el('h2', 'sec', 'Ogni giorno'));
  c1.lastChild.style.marginTop = '0';
  c1.append(num('peso', 'Peso', 'kg', '0.01'));
  const grid = el('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  // l'acqua non e' piu' qui: ha una carta sua, perche' e' l'unica voce del
  // diario che si registra otto volte al giorno e non una
  grid.append(num('coca', 'Coca Zero', 'lattine', '1'),
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
  // solo quello che tocca oggi: la B12 settimanale in mezzo agli altri sei
  // giorni su sette era una riga da ignorare, e a furia di ignorarla si
  // finisce per ignorare anche le altre
  const oggiInt = typeof integratoreOggi === 'function'
    ? D.integratori.filter(s => integratoreOggi(s, k)) : D.integratori;
  if (!D.integratori.length) {
    c3.append(el('p', 'muted',
      'Nessun integratore in elenco. Se ne prendi, aggiungili dal piano: da li\' '
      + 'escono questa checklist e i promemoria del calendario.'));
  }
  for (const s of oggiInt) {
    const on = !!d.integratori[s.nome];
    const ad = typeof aderenzaIntegratore === 'function' ? aderenzaIntegratore(s.nome, k) : null;
    const row = el('div', 'buy' + (on ? ' got' : ''));
    row.append(el('div', 'box', '✓'),
      el('div', 'grow', `<div><strong>${esc(s.nome)}</strong></div>
        <div class="muted" style="font-size:12px">${esc(s.dose || '')} · ${esc(s.cadenza || '')}${s.nota ? ' · ' + esc(s.nota) : ''}${
          ad && ad.su >= 5 ? ` · <span class="mono">${ad.pct}% su ${ad.su} ${ad.unita || 'giorni'}</span>` : ''}</div>`),
      el('span', 'pill' + (s.priorita === 'obbligatorio' ? ' bad' : ''), esc(s.priorita || '')));
    row.onclick = () => {
      if (!on && typeof pulsa === 'function') pulsa(row.firstChild, { scala: 1.3, dur: 300 });
      d.integratori[s.nome] = !on; save();
      setTimeout(route, on ? 0 : 120);
    };
    c3.append(row);
  }
  /* I settimanali stanno in un blocco loro, con lo stato della SETTIMANA:
     restano segnabili in qualunque giorno finche' non li segni. */
  const sett = D.integratori.filter(s => s.cadenza === 'settimanale');
  if (sett.length && typeof statoSettimanale === 'function') {
    const NOMI = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
    c3.append(el('div', 'eyebrow', 'Questa settimana'));
    for (const s of sett) {
      const stw = statoSettimanale(s, k);
      const on = !!stw.preso;
      const row = el('div', 'buy' + (on ? ' got' : ''));
      const giornoIdx = Math.min(6, Math.max(0, s.giorno ?? 0));
      const quando = on
        ? `presa ${stw.preso === k ? 'oggi' : NOMI[dayIdx(stw.preso)]}`
        : stw.passato
          ? `toccava ${NOMI[giornoIdx]}, non ancora segnata`
          : `tocca ${NOMI[giornoIdx]}`;
      row.append(el('div', 'box', '✓'),
        el('div', 'grow', `<div><strong>${esc(s.nome)}</strong></div>
          <div class="muted" style="font-size:12px">${esc(s.dose || '')} · ${quando}</div>`),
        el('span', 'pill' + (s.priorita === 'obbligatorio' && !on ? ' bad' : ''),
           esc(s.priorita || '')));
      row.onclick = () => {
        // si segna sul giorno in cui l'hai presa davvero, non su quello previsto
        if (on) delete day(stw.preso).integratori[s.nome];
        else {
          if (!on && typeof pulsa === 'function') pulsa(row.firstChild, { scala: 1.3, dur: 300 });
          day(k).integratori[s.nome] = true;
        }
        save(); setTimeout(route, on ? 0 : 120);
      };
      c3.append(row);
    }
  }

  const bi = el('button', 'btn wide', 'Modifica cosa prendi');
  bi.style.marginTop = '10px';
  bi.onclick = () => { if (typeof pianoTab !== 'undefined') pianoTab = 'integratori';
    location.hash = '#/piano'; };
  c3.append(bi);
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
  /* Il file di dominio tiene ancora il nome della persona da cui queste misure
     sono state prese e il racconto di come ci si e' arrivati. Qui non servono:
     quello che conta sono i numeri e il fatto che siano stime. Il nome di un
     attore in cima alla scheda del proprio corpo e' un paragone, e un paragone
     non e' un dato. */
  const ct = el('div', 'card');
  ct.append(el('div', 'row between',
    `<div><div class="eyebrow">Target</div>
       <div class="tname">Il fisico di riferimento</div></div>
     <span class="pill">${esc(TF.fonte)}</span>`));
  ct.append(el('p', 'muted',
    'Le misure verso cui stai andando. Non e\' un obiettivo di peso: fra dove sei '
    + 'e dove vuoi arrivare la bilancia cambia poco e cambiano le proporzioni, ed '
    + 'e\' per questo che qui sotto c\'e\' il metro e non solo il peso.'));
  if (TF.fonte === 'stima')
    ct.append(el('p', 'hint',
      'Valori stimati, non rilevati: servono a dare una direzione alle proporzioni, '
      + 'non sono una soglia da centrare al decimo.'));
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
  cm.append(el('p', 'muted', 'Al mattino, a digiuno, prima di bere. Sempre allo stesso modo: '
    + 'la costanza del punto conta piu' + '\u2019 della precisione del metro.'));
  const fatteOggi = D.misure.filter(m => day(k).misure[m.id] != null).length;
  const giro = el('button', 'btn wide' + (fatteOggi ? '' : ' pri'));
  giro.style.marginBottom = '10px';
  giro.textContent = fatteOggi
    ? `Rifai il giro · ${fatteOggi} su ${D.misure.length} gia\u2019 prese oggi`
    : 'Prendi le misure · una alla volta';
  giro.onclick = () => sheetMisura(D.misure[0], k, D.misure);
  cm.append(giro);
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
    r.onclick = () => sheetMisura(m, k);   // una sola, fuori dal giro
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

  /* --- le altre proiezioni --- */
  if (typeof viewPrevisioni === 'function') {
    const b = el('button', 'card rev-invito');
    b.innerHTML = `<span class="eyebrow">Non solo il peso</span>
      <span class="t">Dove stai andando</span>
      <span class="d">Misure, grasso e massa magra, forza: dove ti porta il ritmo
      delle ultime settimane, con la forbice dentro cui starai.</span>
      <span class="g">Apri le proiezioni &rsaquo;</span>`;
    b.onclick = () => { location.hash = '#/previsioni'; };
    v.append(b);
  }
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
  // i punti grezzi uniti da una linea tenue: senza, sembrano sparsi a caso
  // rispetto alla media mobile, che e' una serie diversa
  const grezza = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.w).toFixed(1)}`).join(' ');
  c.append(el('div', null, `<svg class="chart" viewBox="0 0 ${W} ${HT}">
    ${fc}<path d="${grezza}" fill="none" stroke="var(--ink-3)" stroke-width="1" opacity=".35"/>
    <path d="${line}" fill="none" stroke="var(--pine)" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`));
  c.append(el('div', 'leg',
    '<span><i style="background:var(--ink-3)"></i>pesata del giorno</span>'
    + '<span><i style="background:var(--pine)"></i>media mobile a 7 giorni</span>'
    + (f ? '<span><i style="background:var(--pine);opacity:.35"></i>previsione</span>' : '')));

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

/**
 * Una sagoma neutra con il metro disegnato dove va messo.
 * Le coordinate x e y sono gia' in data/dieta.json su ogni misura, in
 * percentuale del riquadro: finora non le usava nessuno.
 */
function figuraPunto(m) {
  const W = 120, H = 260;
  const y = (m.y / 100 * H).toFixed(1);
  const box = el('div', 'mis-fig');
  box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" '
    + 'xmlns="http://www.w3.org/2000/svg" role="img" '
    + 'aria-label="Dove passare il metro per ' + esc(m.label) + '">'
    // una sagoma di riferimento, non una figura in scala: quella sta in Corpo,
    // e qui distrarrebbe da quello che si deve guardare, cioe' la riga
    + '<g fill="none" stroke="var(--rule)" stroke-width="2.4" '
    + 'stroke-linejoin="round" stroke-linecap="round">'
    + '<circle cx="60" cy="21" r="13"/>'
    + '<path d="M60,34 L60,43"/>'
    + '<path d="M42,49 Q60,43 78,49 L84,97 Q80,123 76,151 L44,151 Q40,123 36,97 Z"/>'
    + '<path d="M42,51 L26,105 L22,141"/><path d="M78,51 L94,105 L98,141"/>'
    + '<path d="M48,151 L44,207 L42,247"/><path d="M72,151 L76,207 L78,247"/>'
    + '</g>'
    + '<line x1="14" x2="106" y1="' + y + '" y2="' + y + '" '
    + 'stroke="var(--pine)" stroke-width="2.4" stroke-dasharray="5 4"/>'
    + '<circle cx="' + (m.x / 100 * W).toFixed(1) + '" cy="' + y + '" r="6" '
    + 'fill="var(--pine)"/></svg>';
  return box;
}

/**
 * Il foglio di una misura.
 *
 * Il problema delle circonferenze non e' scrivere il numero: e' prenderlo
 * sempre nello stesso punto. Due centimetri di scarto fra una volta e l'altra
 * sono piu' grandi di qualunque cambiamento reale in un mese, e il grafico
 * delle misure diventa rumore. Per questo qui viene prima COME si misura e
 * dove, e solo dopo il campo.
 *
 * `seq` fa il giro completo: si prendono tutte di fila, senza tornare indietro
 * al menu ogni volta.
 */
function sheetMisura(m, k, seq) {
  const w = el('div'), d = day(k);
  const i = seq ? seq.findIndex(x => x.id === m.id) : -1;
  w.append(el('div', 'eyebrow', seq ? `Misura ${i + 1} di ${seq.length}` : 'Misura'));
  w.append(el('h2', 'sec', esc(m.label)));
  w.lastChild.style.marginTop = '0';

  if (m.come) w.append(el('p', 'muted', esc(m.come)));
  if (m.x != null && m.y != null) w.append(figuraPunto(m));

  /* --- a che punto sei --- */
  const cur = lastMeas(m.id);
  const giorni = Object.keys(S.log).filter(x => S.log[x]?.misure?.[m.id] != null).sort();
  const ultima = giorni[giorni.length - 1];
  const info = el('div', 'read');
  info.innerHTML = (cur != null
      ? `<span><b>${nf(cur, 1)} cm</b> l'ultima volta</span>`
        + (ultima && ultima !== k ? `<span>${ultima}</span>` : '')
      : '<span>Mai presa</span>')
    + (m.target != null ? `<span>target ${nf(m.target, 1)}</span>` : '')
    + (cur != null && m.target != null
      ? `<span>${Math.abs(m.target - cur) <= 1 ? 'ci sei'
        : nf(Math.abs(m.target - cur), 1) + ' cm ' + (m.target > cur ? 'da mettere' : 'da togliere')}</span>`
      : '');
  w.append(info);

  /* --- il campo, con i mezzi centimetri a portata di pollice --- */
  const riga = el('div', 'mis-in');
  const meno = el('button', 'btn', '−');
  const inp = el('input');
  inp.type = 'text'; inp.inputMode = 'decimal'; inp.id = 'm-v';
  inp.value = d.misure[m.id] ?? cur ?? '';
  const piu = el('button', 'btn', '+');
  const passo = v => {
    const n = (parseNum(inp.value) ?? cur ?? 0) + v;
    inp.value = Math.max(0, Math.round(n * 10) / 10);
    controlla();
  };
  meno.onclick = () => passo(-0.5);
  piu.onclick = () => passo(0.5);
  riga.append(meno, inp, el('span', 'u', 'cm'), piu);
  w.append(riga);

  /* Un valore fuori scala e' quasi sempre un metro letto male o una cifra
     saltata, non un corpo cambiato. Non si rifiuta — magari e' vero — ma si
     dice, perche' una misura sbagliata resta nei grafici per mesi e sposta
     anche la stima del grasso. */
  const av = el('div', 'hint');
  w.append(av);
  const controlla = () => {
    const val = parseNum(inp.value);
    const fuori = val != null && m.min != null && (val < m.min || val > m.max);
    if (fuori) {
      av.hidden = false;
      av.innerHTML = `<strong>${nf(val, 1)} cm e' fuori scala</strong> per `
        + `${esc(m.label.toLowerCase())}: di solito sta fra ${m.min} e ${m.max} cm. `
        + 'Ricontrolla il metro. Se e\' giusto, salvalo pure.';
    } else if (m.nota) {
      av.hidden = false; av.textContent = m.nota + '.';
    } else {
      av.hidden = true; av.textContent = '';
    }
  };
  inp.oninput = controlla;
  controlla();

  const salva = poi => {
    const raw = inp.value.trim(), val = parseNum(raw);
    // campo vuoto = cancella; numero valido = salva; scritto male = fermati e
    // dillo, invece di azzerare in silenzio una misura che l'utente credeva
    // di aver aggiornato
    if (raw === '') delete d.misure[m.id];
    else if (val > 0 && val < 300) d.misure[m.id] = val;
    else { toast('Valore non valido'); return; }
    S.model ||= {}; S.model.rev = (S.model.rev || 0) + 1;
    save();
    if (poi) { sheetMisura(poi, k, seq); return; }
    closeSheet(); route();
    toast(seq ? 'Misure aggiornate' : 'Misura salvata');
  };

  if (seq && i >= 0 && i < seq.length - 1) {
    const avanti = el('button', 'btn wide pri', 'Avanti · ' + esc(seq[i + 1].label));
    avanti.onclick = () => salva(seq[i + 1]);
    w.append(avanti);
    const salta = el('button', 'btn wide', 'Salta questa');
    salta.style.marginTop = '8px';
    salta.onclick = () => sheetMisura(seq[i + 1], k, seq);
    w.append(salta);
  } else {
    const b = el('button', 'btn wide pri', seq ? 'Finito' : 'Salva');
    b.onclick = () => salva(null);
    w.append(b);
  }
  sheet(w);
}

/* -------------------------------------------------------- vista ANALISI */
/**
 * La sintesi: cosa non torna, adesso.
 *
 * Era la scheda "Analisi", una delle tre porte alla stessa domanda — insieme a
 * Dati e alla Revisione. Ora e' la prima delle tre viste di Andamento, e ha
 * smesso di ripetere quello che dicono le altre due: la costanza si calcola e
 * si mostra una volta sola, e i grafici stanno nella vista accanto.
 *
 * Resta un motore a regole diverso da quello della revisione, e la differenza
 * e' il tempo: qui gli ultimi sette giorni chiusi e basta, li' un periodo
 * scelto, con il confronto e la sola cosa da cambiare.
 */
function sezSintesi(v) {
  const k = today();
  const c = el('div', 'card flat');
  c.append(el('div', 'eyebrow', 'Carichi in palestra'));
  const ct = typeof caricoTrend === 'function' ? caricoTrend() : { stato: null, n: 0 };
  if (ct.stato) {
    // non si dichiara piu' a mano: si legge dalle schede
    const parola = { su: 'in salita', fermi: 'fermi', giu: 'in calo' }[ct.stato];
    c.append(el('p', 'muted',
      `I carichi sono <strong>${parola}</strong>: mediana ${ct.mediana >= 0 ? '+' : ''}${nf(ct.mediana, 2)}% a settimana
       sul massimale stimato, su ${ct.n} esercizi con almeno tre sedute negli ultimi due mesi.
       Non serve piu' dichiararlo: viene dalle serie che registri.`));
    const tb = el('div', 'cmp');
    tb.append(el('div', 'cmp-h', '<span></span><span>%/sett</span><span>Sedute</span><span></span>'));
    for (const x of ct.pend.slice(0, 6))
      tb.append(el('div', 'cmp-r',
        `<span>${esc(x.nome)}</span>
         <span class="mono ${x.pctSett > 0 ? 'good' : ''}">${x.pctSett >= 0 ? '+' : ''}${nf(x.pctSett, 2)}</span>
         <span class="mono muted">${x.n}</span><span></span>`));
    c.append(tb);
    c.append(el('p', 'hint',
      'Il massimale stimato mette d\'accordo "meno ripetizioni ma piu\' peso" e "stesso peso ma piu\' ripetizioni": due sedute con lo stesso valore sono progresso zero, comunque siano composte. Si usa la mediana fra esercizi perche\' un singolo record fortunato non sposti il giudizio.'));
  } else {
    c.append(el('p', 'muted',
      `Servono almeno due esercizi con tre sedute ciascuno negli ultimi due mesi
       perche\' l'app possa calcolarli da sola${ct.n ? ` (adesso ne ha ${ct.n})` : ''}.
       Finche\' mancano, dichiaralo tu: serve alla regola sulle calorie, perche\'
       peso e vita da soli non bastano a decidere.`));
    const seg = el('div', 'seg');
    for (const [val, lab] of [['su', 'In salita'], ['fermi', 'Fermi'], ['giu', 'In calo']]) {
      const b = el('button', null, lab);
      b.setAttribute('aria-pressed', (S.settings.carichi || 'fermi') === val);
      b.onclick = () => { S.settings.carichi = val; save(); route(); };
      seg.append(b);
    }
    c.append(seg);
  }

  /* --- cosa non torna, e quanto --- */
  const trovati = analyse();
  const problemi = trovati.filter(f => f[0] !== 'ok').length;
  const buone = trovati.length - problemi;

  // la costanza sta qui e in nessun altro posto: prima era un anello in questa
  // schermata e una carta intera in Dati, cioe' lo stesso numero due volte a
  // due dita di distanza
  if (typeof cardCostanza === 'function') v.append(cardCostanza(k, 28));

  const testa = el('div', 'cw');
  testa.append(el('h3', null, 'La settimana in un colpo d\'occhio'));
  testa.append(el('div', 'sub',
    'Medie degli ultimi sette giorni chiusi, confrontate con i tuoi target. La barra dice quanto, il segno verticale dove doveva arrivare.'));
  const r = el('div', 'an-conta solo');
  r.innerHTML = `<div><b>${buone}</b><span>cose a posto</span></div>
     <div class="${problemi ? 'warn' : ''}"><b>${problemi}</b><span>da sistemare</span></div>`;
  testa.append(r);
  if (typeof metriche === 'function')
    for (const m of metriche(k, 7)) testa.append(meter(m));
  v.append(testa);

  v.append(el('h2', 'sec', problemi ? 'Cosa posso migliorare' : 'Tutto a posto'));
  for (const [kind, ico, title, body] of trovati) {
    v.append(el('div', 'flag ' + kind,
      `<div class="ico">${ico}</div>
       <div class="grow"><h4>${esc(title)}</h4><p>${body}</p></div>`));
  }

  /* I carichi stavano in cima, ed era il posto sbagliato: non sono una
     diagnosi, sono un ingrediente della regola sulle calorie. */
  v.append(c);

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Promemoria</div>
     <div class="muted">Non modificare le calorie prima di 3 settimane di dati puliti,
     mai più di ±200 kcal per volta, mai in base a una singola pesata.</div>`));
}

/* ---------------------------------------------------------- vista SPESA */
function shoppingList() {
  const need = {};
  for (const g of D.settimana)
    for (const s of g.pasti) {
      const p = D.pasti[s.codice];          // con il piano vuoto lo slot e' libero
      if (!p || !p.ingredienti) continue;
      for (const i of p.ingredienti)
        need[i.alimento] = (need[i.alimento] || 0) + i.qta;
    }
  const byCat = {};
  for (const [nome, q] of Object.entries(need)) {
    const cat = D.alimenti[nome]?.categoria || 'altro';
    (byCat[cat] ||= []).push({ nome, q, unita: D.alimenti[nome]?.unita || 'g' });
  }
  for (const l of Object.values(byCat)) l.sort((a, b) => a.nome.localeCompare(b.nome));
  return byCat;
}

function viewSpesa(v) {
  if (!usaPiano()) {
    const c = el('div', 'card');
    c.append(el('div', 'eyebrow', 'Serve il piano'));
    c.append(el('div', 'muted',
      'La lista della spesa e\' la somma degli ingredienti dei pasti assegnati ai sette '
      + 'giorni. Con il piano alimentare spento quei pasti non esistono, e non c\'e\' niente '
      + 'da sommare.'));
    const b = el('button', 'btn wide pri', 'Accendi il piano alimentare');
    b.style.marginTop = '10px';
    b.onclick = () => { if (typeof pianoTab !== 'undefined') pianoTab = 'profilo';
      location.hash = '#/piano'; };
    c.append(b);
    v.append(c);
    return;
  }
  const conDisp = typeof fabbisognoNetto === 'function';
  const inCasa = conDisp ? Object.keys(dispensa()).length : 0;
  v.append(el('div', 'card flat',
    `<div class="eyebrow">Fabbisogno settimanale</div>
     <div class="muted">Quantità totali dei 7 giorni${
       inCasa ? ', meno quello che hai gia\' in dispensa' : ''}. Arrotonda per eccesso alle confezioni intere.</div>`));

  if (conDisp) {
    const bd = el('button', 'btn wide');
    bd.textContent = inCasa ? `Dispensa · ${inCasa} voci in casa` : 'Cosa hai gia\' in casa';
    bd.style.marginBottom = '12px';
    bd.onclick = sheetDispensa;
    v.append(bd);
  }

  const byCat = conDisp ? fabbisognoNetto() : shoppingList();
  const qta = (n, u) => u === 'ml' ? `${nf(n)} ml`
    : n >= 1000 ? `${nf(n / 1000, 2)} kg` : `${nf(n, n % 1 ? 1 : 0)} g`;
  for (const [cat, items] of Object.entries(byCat)) {
    // una categoria interamente coperta dalla dispensa non va mostrata vuota:
    // si dice che e' a posto
    const daComprare = items.filter(it => (it.compra ?? it.q) > 0);
    v.append(el('h2', 'sec', cat[0].toUpperCase() + cat.slice(1)));
    const c = el('div', 'card');
    if (!daComprare.length) {
      c.append(el('div', 'muted', 'Tutto gia\' in casa.'));
      v.append(c); continue;
    }
    for (const it of daComprare) {
      const got = !!S.spesa[it.nome];
      const row = el('div', 'buy' + (got ? ' got' : ''));
      const nm = el('div', 'grow nm');
      nm.innerHTML = esc(it.nome) + (it.ho > 0
        ? `<em class="gia">serve ${qta(it.q, it.unita)}, in casa ${qta(it.ho, it.unita)}</em>` : '');
      row.append(el('div', 'box', '✓'), nm,
                 el('span', 'qt', qta(it.compra ?? it.q, it.unita)));
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
  if (usaPiano()) for (const [i, g] of D.settimana.entries())
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

/**
 * L'anteprima di un backup prima di applicarlo.
 *
 * L'import sostituisce tutto e non si annulla. Chiedere "procedo?" mostrando
 * solo un numero di giorni non basta: due file si assomigliano, e quello
 * sbagliato cancella l'archivio buono. Qui si vede cosa c'e' dentro — profili,
 * intervallo di date, pesate, sedute — e solo dopo si decide.
 */
function sheetImport(grezzo) {
  const v2 = grezzo && grezzo.formato === 2 && grezzo.stati;
  const o = v2 ? grezzo : migra(grezzo);
  if (!o) { toast('Formato non riconosciuto'); return; }
  const righe = riassuntoBackup(v2 ? grezzo : o);
  if (!righe.length) { toast('Il file non contiene nessun diario'); return; }

  const w = el('div');
  w.append(el('div', 'eyebrow', 'Cosa c\'e\' nel file'));
  w.append(el('h2', 'sec', v2 ? righe.length + ' profili' : 'Backup di un profilo'));
  w.lastChild.style.marginTop = '0';
  if (grezzo.quando) w.append(el('p', 'muted', 'Esportato il ' + esc(grezzo.quando) + '.'));
  else w.append(el('p', 'muted',
    'Formato vecchio, di prima che il backup portasse tutti i profili: '
    + 'lo leggo lo stesso e lo tratto come un profilo solo.'));

  for (const r of righe) {
    const b = el('div', 'imp-riga');
    b.innerHTML = `<span class="n">${esc(r.nome)}</span>`
      + `<span class="d">${r.giorni} giorni · dal ${esc(r.da || '?')} al ${esc(r.a || '?')}</span>`
      + `<span class="d">${r.pesate} pesate · ${r.sedute} sedute</span>`;
    w.append(b);
  }

  /* --- cosa c'e' adesso, per il confronto --- */
  const ora = Object.keys(S.log).length;
  w.append(el('div', 'hint', ora
    ? `Adesso in memoria hai <strong>${ora} giorni</strong> nel profilo aperto. `
      + 'Importare li sostituisce, e non si torna indietro.'
    : 'Adesso non hai nessun giorno registrato: non c\'e\' niente da perdere.'));

  if (ora) {
    const salva = el('button', 'btn wide');
    salva.textContent = 'Prima esporta quello che ho adesso';
    salva.onclick = () => { exportBackup(); toast('Esportato: ora puoi importare'); };
    w.append(salva);
  }

  const ok = el('button', 'btn wide pri', 'Importa e sostituisci');
  ok.style.marginTop = '8px';
  ok.onclick = () => {
    if (v2) {
      // ogni profilo torna nella sua chiave, poi si ricarica: stato, piano e
      // indice dei profili devono cambiare insieme
      for (const p of grezzo.profili.lista) {
        const st = grezzo.stati[p.id];
        if (!st) continue;
        const chiave = p.id === 'principale' ? KEY : KEY + ':' + p.id;
        localStorage.setItem(chiave, JSON.stringify(st));
      }
      salvaProfili(grezzo.profili);
      toast('Importato: ricarico');
      setTimeout(() => location.reload(), 400);
      return;
    }
    S = o; normalize(); fondiPiano(); save(); closeSheet(); route();
    toast('Backup importato');
  };
  w.append(ok);
  const no = el('button', 'btn wide', 'Annulla');
  no.style.marginTop = '8px';
  no.onclick = closeSheet;
  w.append(no);

  w.append(el('p', 'note',
    'Le foto non sono nel file: stanno in IndexedDB perche\' in localStorage non '
    + 'ci starebbero, e vanno salvate a parte dalla scheda Foto.'));
  sheet(w);
}

/* --------------------------------------------------------------- pause */
/** Il foglio dei periodi in pausa. */
function sheetPause() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Vacanza, influenza, trasferta'));
  w.append(el('h2', 'sec', 'Giorni che non contano'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Una settimana d\'ospedale giudicata col metro di una normale non misura '
    + 'niente: dice solo che e\' andata male, cosa che sapevi. Marcando una pausa '
    + 'i dati restano tutti — si vedono nei grafici e nel diario — ma la revisione '
    + 'settimanale e i punteggi di costanza saltano quei giorni.'));

  const L = pause();
  if (!L.length) w.append(el('p', 'hint', 'Nessuna pausa segnata.'));
  for (const [i, p] of L.entries()) {
    const r = el('div', 'row between');
    r.style.cssText = 'padding:10px 0;border-top:1px solid var(--rule)';
    r.append(el('div', 'grow',
      `<strong>${esc(p.nota || 'Pausa')}</strong>
       <div class="mono muted" style="font-size:11px">dal ${esc(p.dal)}${
         p.al ? ' al ' + esc(p.al) : ' — ancora aperta'}</div>`));
    const x = el('button', 'btn sm', '×');
    x.onclick = () => { L.splice(i, 1); save(); closeSheet(); sheetPause(); };
    r.append(x);
    w.append(r);
  }

  w.append(el('div', 'field',
    `<label>Dal</label><input type="date" id="pa-dal" value="${today()}">`));
  w.append(el('div', 'field',
    `<label>Al (vuoto = ancora in corso)</label><input type="date" id="pa-al">`));
  w.append(el('div', 'field',
    `<label>Cosa</label><input type="text" id="pa-n" placeholder="Vacanza, influenza…">`));
  const b = el('button', 'btn wide pri', 'Aggiungi');
  b.onclick = () => {
    const dal = $('#pa-dal').value, al = $('#pa-al').value || null;
    if (!dal) { toast('Serve almeno la data di inizio'); return; }
    if (al && al < dal) { toast('La fine viene prima dell\'inizio'); return; }
    L.push({ dal, al, nota: $('#pa-n').value.trim() });
    save(); closeSheet(); route(); toast('Segnata');
  };
  w.append(b);
  w.append(el('p', 'note',
    'Non e\' un modo di nascondere le settimane storte: quelle servono, ed e\' da '
    + 'quelle che la revisione impara. E\' per i giorni in cui il piano non era '
    + 'nemmeno in gioco.'));
  sheet(w);
}

/* --------------------------------------------------------------- menu */
/**
 * Il profilo, dalla testata.
 *
 * Al suo posto c'era l'icona della fotocamera, che portava dritta alle foto
 * dei progressi: un solo pezzo dell'app promosso al posto piu' visibile che
 * esiste, mentre "chi sono, quale profilo sto usando, come mi vedo cambiare"
 * non aveva nessuna porta. Le foto stanno qui dentro, dove uno le cerca quando
 * pensa a se stesso, e non in cima a ogni schermata.
 */
function sheetProfilo() {
  const w = el('div');
  const P0 = typeof profili === 'function' ? profili() : { lista: [], attivo: null };
  const nome = D.profilo?.nome || (typeof profiloAttivo === 'function'
    ? profiloAttivo()?.nome : '') || '';

  w.append(el('div', 'eyebrow', 'Profilo'));
  w.append(el('h2', 'sec', nome ? esc(nome) : 'Non hai ancora un nome'));
  w.lastChild.style.marginTop = '0';

  const d = [];
  if (D.profilo?.eta) d.push(D.profilo.eta + ' anni');
  if (D.profilo?.altezza_cm) d.push(nf(D.profilo.altezza_cm) + ' cm');
  const pw = typeof lastWeight === 'function' ? lastWeight() : null;
  if (pw) d.push(nf(pw, 1) + ' kg');
  const gg = Object.keys(S.log || {}).length;
  d.push(gg + (gg === 1 ? ' giorno registrato' : ' giorni registrati'));
  w.append(el('p', 'muted', d.join(' · ')));

  const vai = (t, sub2, fn) => {
    const b = el('button', 'nav-r');
    b.innerHTML = `<span class="body"><span class="t">${esc(t)}</span>
      <span class="d">${esc(sub2)}</span></span><span class="go">›</span>`;
    b.onclick = () => { closeSheet(); fn(); };
    w.append(b);
  };
  vai('Foto dei progressi', 'Uno scatto al giorno nella stessa posa: e\' l\'unico modo '
    + 'di vedere un cambiamento che sulla bilancia non si vede.',
    () => { location.hash = '#/foto'; });
  vai('Chi sei', 'Nome, eta\', altezza, peso di partenza, e quali parti dell\'app ti servono.',
    () => { if (typeof pianoTab !== 'undefined') pianoTab = 'profilo';
      location.hash = '#/piano'; route(); });
  vai('Il piano', 'Target, alimenti, pasti, settimana: i cinque passi.',
    () => { if (typeof pianoTab !== 'undefined') pianoTab = null;
      location.hash = '#/piano'; });
  vai('Quello che mangi', 'L\'elenco degli alimenti e dei prodotti, con da dove viene '
    + 'il numero di ognuno. Da qui si aggiunge e si confronta.',
    () => { location.hash = '#/prodotti'; });

  /* --- i profili, se ce n'e' piu' di uno --- */
  if (P0.lista.length > 1) {
    const c = el('div', 'card flat');
    c.append(el('div', 'eyebrow', 'Cambia profilo'));
    c.append(el('div', 'muted',
      'Ognuno ha il suo diario, il suo piano, le sue foto e la sua palestra, '
      + 'separati del tutto.'));
    const seg = el('div', 'seg wrap');
    for (const x of P0.lista) {
      const b = el('button', null, x.nome);
      b.setAttribute('aria-pressed', String(x.id === P0.attivo));
      if (x.id !== P0.attivo) b.onclick = () => cambiaProfilo(x.id);
      seg.append(b);
    }
    c.append(seg);
    w.append(c);
  }

  const ch = el('button', 'btn wide pri', 'Chiudi');
  ch.style.marginTop = '12px';
  ch.onclick = closeSheet;
  w.append(ch);
  sheet(w);
}

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

  if (usaPiano()) mk('Lista della spesa',
     'Il fabbisogno della settimana sommato per categoria, con la spunta. Nasce dai '
     + 'pasti assegnati ai giorni: senza piano non avrebbe niente da sommare.',
     () => { closeSheet(); location.hash = '#/spesa'; });

  mk('Scarica i promemoria (.ics)',
     'iOS non permette a una web app di programmare notifiche locali. Questo file crea gli eventi ricorrenti nel Calendario: pasti, integratori, pesata e revisione domenicale. Aprilo una volta e le notifiche arrivano native, senza server.',
     () => { download('dieta-promemoria.ics', icsFile(), 'text/calendar'); toast('Aprilo con Calendario'); });

  mk('Passi e sonno dal telefono',
     'Nessuna pagina web puo\' leggere Salute — il permesso non esiste. Un Comando pero\' si\': legge il dato e apre l\'app col numero dentro l\'indirizzo. Qui c\'e\' la procedura.',
     () => { closeSheet(); location.hash = '#/salute'; });

  mk('Giorni che non contano',
     'Vacanza, influenza, trasferta: i dati restano tutti, ma la revisione settimanale e i punteggi di costanza saltano quei giorni.',
     () => sheetPause());

  mk('Esporta backup', 'Tutti i profili in un file solo. La memoria del browser può essere svuotata, e non esiste '
     + 'copia altrove. È l\'unico modo per non perdere lo storico.'
     + (S.settings.backup ? ' Ultimo backup: ' + S.settings.backup + '.'
                          : ' Non ne hai ancora fatto nessuno.'),
     () => { const n = exportBackup(); toast(n > 1 ? n + ' profili esportati' : 'Backup scaricato'); });

  mk('Passa la dieta o le schede',
     'Un pezzo solo, non tutto l\'archivio: il piano alimentare, le schede di palestra, '
     + 'o tutti e due. Serve a darli a qualcun altro o a portarli sul secondo profilo. '
     + 'Caricandone uno si aggiunge a quello che hai, non lo sostituisce.',
     () => sheetScambio());

  mk('Importa backup', 'Prima ti mostra cosa contiene il file, poi chiede conferma.', () => {
    const i = el('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = () => {
      const f = i.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const grezzo = JSON.parse(r.result);
          // sovrascrivere tutto alla cieca e' il modo piu' rapido di perdere
          // l'archivio: prima si guarda cosa c'e' nel file
          sheetImport(grezzo);
        } catch (e) { toast('File non valido: ' + (e.message || 'illeggibile')); }
      };
      r.readAsText(f);
    };
    i.click();
  });

  mk('Versione e aggiornamenti',
     'Quale versione stai usando e se ce n\'e\' una piu\' nuova. Su iPhone una web app '
     + 'aggiunta alla Home a volte viene ripristinata dalla memoria invece di ricaricare, '
     + 'e resta indietro senza dirlo.',
     () => sheetVersione());

  const days = Object.keys(S.log).length;
  const stato = el('div', 'card flat',
    `<div class="eyebrow">Stato</div>
     <div class="muted">${days} giorni registrati · target ${nf(D.target.kcal)} kcal,
     ${D.target.p} g proteine · versione dati ${D.meta.versione}
     <span class="vers"></span></div>`);
  w.append(stato);
  versioneInUso().then(v => {
    const t = stato.querySelector('.vers');
    if (t && v) t.textContent = ' · app ' + v;
  });

  const b = el('button', 'btn wide pri', 'Chiudi');
  b.onclick = closeSheet; w.append(b);
  sheet(w);
}

/* --------------------------------------------------------------- avvio */
async function init() {
  if (typeof recRiprendi === 'function') recRiprendi();
  load();
  try {
    DBASE = await (await fetch('data/dieta.json', { cache: 'no-cache' })).json();
    fondiPiano();       // D = piano di base + modifiche di questo profilo
    // il catalogo palestra non e' vitale: se manca, il resto dell'app vive
    try { PD = await (await fetch('data/palestra.json', { cache: 'no-cache' })).json(); }
    catch { PD = null; }
    try { HX = await (await fetch('data/hyrox.json', { cache: 'no-cache' })).json(); }
    catch { HX = null; }
    try { CORPO = await (await fetch('data/corpo.json', { cache: 'no-cache' })).json(); }
    catch { CORPO = null; }
    try { SF = await (await fetch('data/sfide.json', { cache: 'no-cache' })).json(); }
    catch { SF = null; }
  } catch {
    $('#view').innerHTML = '<div class="card">Dati non caricati. Serve un server HTTP (anche GitHub Pages): aprire il file da disco non funziona.</div>';
    return;
  }
  // il ⋯ apre le impostazioni e basta: prima passava da una tendina con tre
  // voci, due delle quali portavano dove porta gia' l'icona del profilo
  $('#btn-menu').onclick = sheetMenu;
  $('#btn-profilo').onclick = () => sheetProfilo();
  $('#sheet-backdrop').onclick = closeSheet;
  addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/oggi';
  route();
  persist();
  registraSW();
}
init();

/* ==================================================== prendere la versione nuova
 *
 * Il service worker e' rete-prima, quindi una versione nuova arriva alla prima
 * navigazione. Il guaio e' che su iOS una web app aggiunta alla Home spesso non
 * naviga per niente: riaprendola dall'icona il sistema ripristina il documento
 * che era gia' in memoria, con dentro il JavaScript vecchio. Il worker si
 * aggiorna sotto, la pagina no.
 *
 * E dentro una PWA a schermo intero non c'e' la barra del browser, quindi non
 * c'e' un bottone di ricarica; il pull-to-refresh non c'e' perche' il body ha
 * `overscroll-behavior: none`. Messe insieme le due cose: non esisteva NESSUN
 * modo, dall'interno dell'app, di prendere una versione nuova. Si restava a
 * guardare la copia vecchia convinti che le modifiche non fossero arrivate.
 *
 * Tre pezzi, e il terzo e' quello che conta:
 * 1. a ogni ritorno in primo piano si richiede al browser di ricontrollare sw.js
 * 2. quando un worker nuovo e' pronto compare una striscia con "Ricarica"
 * 3. in Impostazioni c'e' un controllo esplicito, che dice anche quale versione
 *    stai usando: senza quel numero non si puo' nemmeno capire se il problema
 *    e' il telefono o il codice
 *
 * Non si ricarica MAI da soli: la pagina puo' avere sotto un pasto a meta' di
 * inserimento, e una ricarica a sorpresa lo butterebbe via.
 */
let SW_REG = null;

const numeroV = k => +(String(k).match(/v(\d+)/)?.[1] || 0);

/** La versione che stai usando davvero: il nome della cache del worker. */
async function versioneInUso() {
  try {
    const ks = (await caches.keys()).filter(k => k.startsWith('dieta-v'));
    return ks.sort((a, b) => numeroV(a) - numeroV(b)).pop() || null;
  } catch { return null; }
}

/** Quella pubblicata: si legge da sw.js, saltando ogni cache. */
async function versionePubblicata() {
  const r = await fetch('sw.js?v=' + Date.now(), { cache: 'no-store' });
  const t = await r.text();
  return t.match(/const V = '([^']+)'/)?.[1] || null;
}

function bannerAggiornamento() {
  if ($('#upd')) return;
  const b = el('div', 'upd');
  b.id = 'upd';
  b.append(el('span', 'grow', 'C\'e\' una versione nuova dell\'app.'));
  const go = el('button', 'btn sm pri', 'Ricarica');
  go.onclick = () => location.reload();
  const no = el('button', 'btn sm', 'Dopo');
  no.onclick = () => b.remove();
  b.append(go, no);
  document.body.append(b);
}

function registraSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    SW_REG = reg;
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        // "installed" con un controller gia' presente vuol dire versione nuova
        // pronta; senza controller e' la primissima installazione, e li' non
        // c'e' niente da annunciare
        if (nw.state === 'installed' && navigator.serviceWorker.controller)
          bannerAggiornamento();
      });
    });
  }).catch(() => {});

  // riaprendo l'app dall'icona iOS spesso non ricarica niente: e' qui che si
  // chiede al browser di andare a vedere se sw.js e' cambiato
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && SW_REG) SW_REG.update().catch(() => {});
  });
}

/** Il controllo a mano, con il numero di versione in chiaro. */
async function sheetVersione() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Versione'));
  w.append(el('h2', 'sec', 'Aggiornamenti'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'L\'app si aggiorna da sola quando la riapri, ma su iPhone una web app '
    + 'aggiunta alla Home a volte viene solo ripristinata dalla memoria, e resta '
    + 'quella di prima. Qui si controlla e si ricarica a mano.'));

  const riga = el('div', 'read');
  riga.innerHTML = '<span>controllo in corso…</span>';
  w.append(riga);

  const b = el('button', 'btn wide pri', 'Controlla adesso');
  b.style.marginTop = '12px';
  w.append(b);
  const ric = el('button', 'btn wide', 'Ricarica comunque');
  ric.style.marginTop = '8px';
  ric.onclick = () => location.reload();
  w.append(ric);
  w.append(el('p', 'note',
    'Ricaricare non tocca i dati: diario, piano, foto e schede stanno in una '
    + 'memoria separata dal codice dell\'app.'));

  const guarda = async () => {
    riga.innerHTML = '<span>controllo in corso…</span>';
    const [in_uso, pub] = await Promise.all([
      versioneInUso(),
      versionePubblicata().catch(() => null)
    ]);
    if (SW_REG) SW_REG.update().catch(() => {});
    riga.innerHTML = `<span>in uso <b>${esc(in_uso || 'non registrata')}</b></span>`
      + `<span>pubblicata <b>${esc(pub || 'non raggiungibile')}</b></span>`;
    if (pub && in_uso && numeroV(pub) > numeroV(in_uso)) {
      riga.innerHTML += '<span class="mono">c\'e\' una versione nuova</span>';
      bannerAggiornamento();
      b.textContent = 'Ricarica e prendi la nuova';
      b.onclick = () => location.reload();
    } else if (pub && in_uso) {
      riga.innerHTML += '<span class="mono muted">sei aggiornato</span>';
      b.textContent = 'Controlla di nuovo';
      b.onclick = guarda;
    } else {
      b.textContent = 'Riprova';
      b.onclick = guarda;
    }
  };
  b.onclick = guarda;
  sheet(w);
  guarda();
}
