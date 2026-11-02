/* I controlli fissi sui motori delicati.
 *
 * Ogni verifica fatta finora era a mano, con una pagina headless costruita e
 * buttata via: funziona una volta e poi non protegge piu' niente. Qui restano.
 * Coprono i punti in cui l'app ha gia' sbagliato almeno una volta — il
 * giudizio sul mese, la previsione che partiva dal piano, la chiave dei pasti,
 * il congelamento del passato, lo scarico che scattava da solo.
 *
 * Gli script dell'app si leggono da index.html, cosi' l'elenco non va tenuto
 * allineato a mano: un file nuovo aggiunto la' viene caricato anche qui.
 */
'use strict';

const RISULTATI = [];
function verifica(nome, cond, dettaglio = '') {
  RISULTATI.push({ nome, ok: !!cond, dettaglio });
}
const vicino = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

/* ------------------------------------------------------------- caricamento */
async function caricaApp() {
  const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const srcs = [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  doc.querySelectorAll('script').forEach(s => s.remove());
  document.getElementById('app').innerHTML = doc.body.innerHTML;
  for (const src of srcs) await new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => ko(new Error('non carica ' + src));
    document.body.append(s);
  });
  // init() e' asincrona: si aspetta che il piano e il catalogo ci siano
  for (let i = 0; i < 200 && !(typeof D !== 'undefined' && D?.alimenti && typeof PD !== 'undefined' && PD); i++)
    await new Promise(r => setTimeout(r, 50));
}

/** Stato pulito per un caso: diario, impostazioni, palestra. */
function stato({ log = {}, settings = {}, palestra = {} } = {}) {
  S.log = log;
  S.settings = { pianoBase: 'esempio', moduli: { piano: true, hyrox: false }, ...settings };
  S.palestra = palestra;
  S.piano = {};
  S.model = {};
  fondiPiano();
  // le memorie dei motori sono indicizzate su conteggi: fra un caso e l'altro
  // possono coincidere, e risponderebbero coi numeri del caso prima
  if (typeof _ffCache !== 'undefined') _ffCache.clear();
  if (typeof _trCache !== 'undefined') _trCache.clear();
  _mkey = null;
}

/** Pesate al ritmo dato (kg a settimana) per n giorni, con un rumore fisso. */
function pesate(kgSett, n = 28, w0 = 72, saltaOgni = 0) {
  const log = {};
  const rum = [0.3, -0.2, 0.1, -0.4, 0.2, 0, -0.1, 0.35, -0.25, 0.05];
  for (let i = n - 1; i >= 0; i--) {
    if (saltaOgni && i % saltaOgni) continue;
    const k = addDays(today(), -i);
    log[k] = { pasti: {}, extra: [], peso: +(w0 + kgSett * (n - 1 - i) / 7 + rum[i % 10]).toFixed(2) };
  }
  return log;
}
/** Un giorno registrato con una voce fuori piano da tante kcal. */
function mangia(log, kcal, p = 120, n = 28) {
  for (let i = 1; i <= n; i++) {
    const k = addDays(today(), -i);
    log[k] ||= { pasti: {}, extra: [] };
    log[k].extra.push({ nome: 'giornata', kcal, p, c: 250, g: 70, fibre: 30 });
  }
  return log;
}
const cut = { obiettivo: { id: 'cut', pct: -0.005 } };

/* ------------------------------------------------------------------- casi */
function casiMese() {
  // il ritmo misurato
  stato({ log: pesate(-0.35), settings: cut });
  const R = ritmoPeso();
  verifica('ritmoPeso ritrova il ritmo vero', R.ok && vicino(R.kgSett, -0.35, 0.06),
    R.ok ? nf(R.kgSett, 3) : R.perche);

  // le cinque risposte di un obiettivo di perdita
  const casi = [[-0.36, 'linea'], [-0.05, 'lento'], [0.25, 'opposto'], [-0.8, 'veloce']];
  for (const [r, atteso] of casi) {
    stato({ log: pesate(r), settings: cut });
    const g = giudizioMese();
    verifica(`perdere grasso a ${r} kg/sett: "${atteso}"`, g.stato === atteso, g.stato);
  }
  stato({ log: pesate(-0.35, 28, 72, 7), settings: cut });
  verifica('quattro pesate in un mese: servono dati', giudizioMese().stato === 'dati');
  stato({ log: pesate(-0.35) });
  verifica('senza obiettivo: chiede di sceglierlo', giudizioMese().stato === 'libero');
  stato({ log: pesate(0.02), settings: { obiettivo: { id: 'ricomp', pct: 0 } } });
  verifica('ricomposizione a peso fermo: in linea', giudizioMese().stato === 'linea');

  // la cosa da fare: prima il piano seguito, poi il piano cambiato
  stato({ log: mangia(pesate(-0.02), 3000), settings: cut });
  verifica('troppo lento mangiando sopra il target: torna al target',
    /Torna al target/.test(giudizioMese().azione.t), giudizioMese().azione.t);
  stato({ log: mangia(pesate(-0.02), 2482), settings: cut });
  const az = giudizioMese().azione;
  verifica('troppo lento seguendo il target: propone un passo, non lo applica',
    /150/.test(az.t) && typeof az.go === 'function', az.t);
  verifica('nessuna azione suggerisce di saltare pasti o digiunare',
    !/salt|digiun|compens/i.test(JSON.stringify(az)));
}

function casiPrevisione() {
  // il titolo e' il ritmo vero, non quello del piano
  stato({ log: mangia(pesate(-0.35), 2000), settings: cut });
  const t = forecastCard(today()).textContent;
  verifica('la previsione apre con il ritmo misurato', /Stai scendendo/.test(t) && /pesate/.test(t),
    t.slice(0, 90));
}

function casiAttivita() {
  stato({ palestra: { cardio: { [today()]: [
    { tipo: 'corsa', durata_s: 1800 }, { tipo: 'camminata', durata_s: 1800 }] },
    sessioni: { [today()]: { serie: [{ ex: 'panca-piana', kg: 60, reps: 8, rir: 2 }] } } } });
  const A = attivitaGiorni([today()]);
  verifica('un minuto intenso vale due moderati', vicino(A.eq, 90, 0.5), nf(A.eq));
  verifica('i pesi contano come giorno di forza, non come minuti', A.forza === 1 && A.int === 30);
}

function casiMisure() {
  const log = {};
  log[addDays(today(), -30)] = { misure: { vita: 86, collo: 37.5 } };
  log[addDays(today(), -2)] = { misure: { vita: 84.6, collo: 37.5 } };
  stato({ log });
  const c = cambioMisura('vita');
  verifica('il cambio del mese confronta con almeno tre settimane prima',
    c && vicino(c.delta, -1.4, 0.01), c && nf(c.delta, 2));
  const log2 = {};
  log2[addDays(today(), -9)] = { misure: { vita: 85 } };
  log2[addDays(today(), -2)] = { misure: { vita: 84.6 } };
  stato({ log: log2 });
  verifica('due misure a una settimana non fanno un mese', cambioMisura('vita').delta === null);

  // composizione: con la stessa vita non c'e' un cambio da dichiarare
  const log3 = pesate(-0.35, 40);
  log3[addDays(today(), -39)].misure = { vita: 85, collo: 37.5 };
  stato({ log: log3 });
  verifica('stessa vita, nessun cambio di composizione inventato', cambioComposizione() === null);
}

function casiDiario() {
  stato({});
  const k = addDays(today(), -3);
  const slots = slotsGiorno(k).filter(s => s.codice && pasto(s.codice));
  verifica('il piano di esempio ha pasti per il test', slots.length > 1);
  if (slots.length < 2) return;

  // le pastiglie del "dove" usano la chiave del pasto, non la ricetta
  const f = campoDove(slots, { code: null }, '');
  const chiavi = [...f.querySelectorAll('button')].map(b => b.dataset.c).filter(Boolean);
  verifica('il "dove" indirizza il pasto (chiaveP), non la ricetta',
    chiavi.length === slots.length && chiavi.every((c, i) => c === chiaveP(slots[i])),
    chiavi.slice(0, 2).join(', '));

  // il passato non si muove quando si corregge una ricetta
  const s = slots[0], sid = chiaveP(s), d = day(k);
  d.pasti[sid] = true; congelaPasto(sid, k);
  const prima = consumed(k).kcal;
  const nuova = JSON.parse(JSON.stringify(D.pasti[s.codice]));
  nuova.ingredienti[0].qta *= 3; nuova.macro = macroDaIngredienti(nuova.ingredienti);
  S.piano.pasti = { [s.codice]: nuova }; fondiPiano();
  verifica('correggere una ricetta non riscrive una giornata spuntata',
    vicino(consumed(k).kcal, prima, 0.5), `${nf(prima)} → ${nf(consumed(k).kcal)}`);

  // una spunta tolta sparisce, non diventa false
  delete d.pasti[sid]; scongelaPasto(sid, k);
  verifica('togliere la spunta non lascia chiavi a false',
    !Object.values(d.pasti).some(v => v === false));
}

function casiScarico() {
  // dieci settimane regolari, carichi in salita: niente scarico da un segnale solo
  const sessioni = {};
  for (let i = 70; i >= 0; i--) {
    const k = addDays(today(), -i);
    if (![1, 3, 5].includes(new Date(k).getDay())) continue;
    const kg = 50 + (70 - i) * 0.1;
    sessioni[k] = { serie: [
      { ex: 'panca-piana', kg, reps: 8, rir: 2 }, { ex: 'panca-piana', kg, reps: 8, rir: 2 },
      { ex: 'squat', kg: kg + 20, reps: 8, rir: 2 }, { ex: 'squat', kg: kg + 20, reps: 8, rir: 2 }] };
  }
  stato({ palestra: { sessioni } });
  const sc = scaricoConsigliato();
  verifica('volume regolare e forza in salita: nessuno scarico obbligato',
    sc.dati && !sc.serve, `serve=${sc.serve} filata=${sc.filata}`);
}

/** Gli spunti di oggi: nascono dai numeri, si fanno con un tocco. */
function casiSpunti() {
  const k = today();
  stato({ settings: { moduli: { piano: false, hyrox: false }, ...cut } });
  day(k).extra.push({ nome: 'colazione', kcal: 400, p: 15, c: 60, g: 10, fibre: 5 });
  const S0 = spuntiOggi(k);
  const pr = S0.lista.find(s => s.id === 'proteine');
  verifica("mancano proteine: lo spunto c'e' e porta tre proposte", pr && pr.proposte.length === 3,
    pr ? pr.t : S0.lista.map(s => s.id).join(','));
  if (pr) {
    verifica('le proposte sono porzioni da mangiare (20-250 g, fino a ~30 g di proteine)',
      pr.proposte.every(x => x.qta >= 20 && x.qta <= 250 && x.pq <= 40));
    const p0 = consumed(k).p;
    aggiungiProposta(k, pr.proposte[0]);
    verifica('un tocco su una proposta la registra', consumed(k).p > p0 + 5,
      `${nf(p0)} -> ${nf(consumed(k).p)}`);
  }
  verifica('nessuno spunto suggerisce di saltare pasti, digiunare o compensare',
    !/salt|digiun|compens/i.test(JSON.stringify(spuntiOggi(k).lista.map(s => [s.t, s.d]))));
  verifica("settimana senza attivita': piu' di uno spunto calcolato", spuntiOggi(k).tutti >= 2);
  const c = cardSpunti(k);
  verifica('la carta degli spunti si disegna senza parole rotte', !/NaN|undefined|\bnull\b/.test(c.textContent));
}

/** Dal calendario un allenamento si aggiunge, si corregge e si toglie. */
function casiCalendario() {
  const ieri = addDays(today(), -1), l_altro = addDays(today(), -2);
  const conferma = window.confirm;
  window.confirm = () => true;
  try {
    stato({ palestra: { cardio: { [ieri]: [{ id: 'c1', tipo: 'camminata', durata_s: 1800 }] },
      sessioni: { [ieri]: { serie: [{ ex: 'panca-piana', kg: 60, reps: 8, rir: 2 }] } } } });

    sheetRiassuntoGiorno(ieri);
    verifica('il resoconto di un giorno con pesi mostra anche il cardio, e si tocca',
      !!document.querySelector('#sheet-body .gd-cardio'));
    verifica('il resoconto ha "Elimina la seduta"',
      [...document.querySelectorAll('#sheet-body button')].some(b => /Elimina la seduta/.test(b.textContent)));

    sheetCardioModifica(ieri, 0);
    document.querySelector('#sheet-body #cm-min').value = '45';
    document.querySelector('#sheet-body #cm-k').value = l_altro;
    document.querySelector('#sheet-body [data-t="corsa"]').click();
    [...document.querySelectorAll('#sheet-body button')].find(b => b.textContent === 'Salva').click();
    const spostata = cardioDi(l_altro)[0];
    verifica('una sessione si corregge e si sposta di giorno',
      !cardioDi(ieri).length && spostata?.durata_s === 2700 && spostata?.tipo === 'corsa',
      JSON.stringify(spostata));
    verifica('le calorie si ricalcolano sul tipo nuovo', spostata?.kcal === kcalCardio(spostata));

    eliminaSeduta(ieri);
    verifica('una seduta di pesi si elimina', !P().sessioni[ieri]);
  } finally {
    window.confirm = conferma;
    if (typeof closeSheet === 'function') closeSheet();
  }
}

/** Il grafico degli errori regge gli errori negativi, e la pagella giudica la previsione mostrata. */
function casiPrevisioni() {
  const prev = [];
  const err = [0.3, -0.4, 0.1, -0.2, 0.5, -0.6, 0.05];
  err.forEach((e, i) => {
    const t = addDays(today(), -10 + i);
    prev.push({ fatta: addDays(t, -7), h: 7, target: t, previsto: 70, reale: 70 + e, errore: e,
                banda: 0.45, dentro: Math.abs(e) <= 0.45 });
    prev.push({ fatta: addDays(t, -14), h: 14, target: t, previsto: 70, reale: 70 + e, errore: e,
                banda: 0.6, dentro: true });
  });
  const c = chartErrori(prev, { mae: 0.3, colpiti: 0.7 });
  const rect = [...c.querySelectorAll('svg rect')].filter(r => r.getAttribute('rx') === '2');
  const svgH = 140;
  verifica('errori: una barra per previsione a una settimana, non due per data', rect.length === err.length,
    rect.length + ' barre');
  verifica('errori: anche le barre negative stanno dentro il disegno',
    rect.every(r => +r.getAttribute('y') >= 0 && +r.getAttribute('y') + +r.getAttribute('height') <= svgH));
  verifica('errori: fuori dalla forbice e\' ambra, dentro e\' verde',
    rect.some(r => r.getAttribute('fill') === 'var(--amber)') && rect.some(r => r.getAttribute('fill') === 'var(--pine)'));

  // il registro salva la previsione sul ritmo vero, non quella del piano
  stato({ log: mangia(pesate(-0.35), 2000), settings: cut });
  ledgerRecord(today());
  const p7 = S.model.prev.find(p => p.fatta === today() && p.h === 7);
  const w = trendW(today()), R = ritmoPeso(today());
  verifica('la pagella registra la previsione che la carta mostra (ritmo misurato)',
    p7 && vicino(p7.previsto, w + R.kgSett, 0.02), p7 && `${nf(p7.previsto, 2)} vs ${nf(w + R.kgSett, 2)}`);
}

/** Aggiusta i macro: sposta quello scelto, tiene fermo il resto, scrive quello che dice. */
function casiLeve() {
  verifica('il sistema 3x3 si risolve esatto',
    JSON.stringify(levSolve([[2, 1, 0], [1, 3, 1], [0, 1, 4]], [3, 5, 5]).map(x => +x.toFixed(6))) === '[1,1,1]');

  stato();
  const ric = JSON.stringify(D.pasti);
  for (const [id, dv] of [['p', 10], ['c', -20], ['g', -6]]) {
    const r = leveGiorno(0, id, dv, 'altri');
    const m = [...r.porzioni, ...r.nuovi, ...r.ricette].find(x => x.buona);
    const altri = LEV_VOCI.filter(v => v.id !== id);
    verifica(`${id} ${dv > 0 ? '+' : ''}${dv}: si sposta e gli altri due restano fermi`,
      m && vicino(m.d[id], dv, levVoce(id).tol * 2) && altri.every(v => Math.abs(m.d[v.id]) <= v.tol * 2),
      m ? JSON.stringify(m.d) : 'nessuna proposta');
  }
  const k = leveGiorno(0, 'p', 10, 'kcal');
  const mk = k.porzioni.find(x => x.buona);
  verifica('proteine +10 a calorie ferme: le calorie non si muovono',
    mk && vicino(mk.d.p, 10, 4) && Math.abs(mk.d.kcal) <= 2 * LEV_TOL_KCAL, mk ? JSON.stringify(mk.d) : 'nessuna');

  // applicata, il giorno finisce dove la riga aveva scritto, e il registro non si muove
  const m = leveGiorno(2, 'p', 15, 'altri').porzioni.find(x => x.buona);
  if (m) {
    levApplica(2, m);
    const t = D.settimana[2].totali;
    verifica('applicata, il giorno fa quello che la proposta scriveva',
      vicino(t.kcal, m.dopo.kcal, 1) && vicino(t.p, m.dopo.p, 0.5), `${nf(t.kcal)} contro ${nf(m.dopo.kcal)}`);
    verifica('applicata, le ricette del registro restano quelle', JSON.stringify(D.pasti) === ric);
  } else verifica('proteine +15 il mercoledi\' ha una proposta', false);

  // piu' macro insieme
  stato();
  const tutte = r => [...r.porzioni, ...r.nuovi, ...r.ricette];
  const mm = tutte(leveGiorno(0, { p: 10, c: -20, g: 0 })).find(x => x.buona);
  verifica('proteine +10 e carboidrati −20 insieme, grassi fermi',
    mm && vicino(mm.d.p, 10, 4) && vicino(mm.d.c, -20, 6) && Math.abs(mm.d.g) <= 3, mm ? JSON.stringify(mm.d) : 'nessuna');

  // porta a target: ogni macro finisce piu' vicino al suo target (o resta li')
  const tg = D.target;
  for (const gi of [1, 4, 6]) {
    const tot = levTotali(D.settimana[gi].pasti.map(s => s.codice));
    const d = {};
    for (const v of LEV_VOCI) d[v.id] = levDeltaVerso(v.id, tot, tg, false);
    const best = tutte(leveGiorno(gi, d)).find(x => x.buona);
    verifica(`porta a target il giorno ${gi}: ogni macro si avvicina`,
      !LEV_VOCI.some(v => d[v.id]) || (best && LEV_VOCI.every(v =>
        Math.abs(best.dopo[v.id] - tg[v.id]) <= Math.abs(tot[v.id] - tg[v.id]) + v.tol * 2)),
      best ? JSON.stringify(best.d) + ' da ' + JSON.stringify(d) : 'nessuna');
  }

  // un pasto bloccato non si tocca, in nessuna proposta
  stato();
  levRegole().pasti.push('Pranzo');
  const iPr = D.settimana[0].pasti.findIndex(s => s.slot === 'Pranzo');
  const conBlocco = tutte(leveGiorno(0, 'p', 10, 'altri'));
  verifica('il pranzo bloccato resta com\'e\'', conBlocco.length > 0
    && conBlocco.every(m => m.codici[iPr] === D.settimana[0].pasti[iPr].codice), conBlocco.length + ' proposte');

  // tutti gli ingredienti bloccati: resta solo aggiungere qualcosa
  stato();
  const reg = levRegole();
  for (const s of D.settimana[0].pasti)
    for (const i of (pasto(s.codice)?.ingredienti || [])) reg.ingredienti.push(i.alimento);
  const soloNuovi = leveGiorno(0, 'p', 10, 'altri');
  verifica('ingredienti bloccati: nessuna dose cambiata, si propone un alimento nuovo',
    !soloNuovi.porzioni.length && !soloNuovi.ricette.length && soloNuovi.nuovi.length > 0
    && soloNuovi.nuovi.every(m => m.cambi.every(c => c.it.nuovo)),
    `${soloNuovi.porzioni.length} porzioni, ${soloNuovi.nuovi.length} nuovi`);
  const nv = soloNuovi.nuovi[0];
  if (nv) {
    levApplica(0, nv);
    const c = nv.cambi[0];
    verifica('l\'alimento nuovo entra nel pasto come parte in piu\', la ricetta resta',
      partiPasto(D.settimana[0].pasti[c.it.si].codice).includes(codiceAlimento(c.it.nome, c.q)));
  }

  // la soglia di proteine dei pasti principali
  stato();
  const min = D.target.min_p_per_pasto;
  let rotte = 0;
  for (const gi of [0, 2, 5]) for (const d of [{ p: -20 }, { c: 30 }, { g: -8 }]) {
    const prima = D.settimana[gi].pasti.map(s => s.codice);
    for (const m of tutte(leveGiorno(gi, d)))
      D.settimana[gi].pasti.forEach((s, si) => {
        if (!LEV_PRINCIPALI.includes(s.slot)) return;
        const a = levM(prima[si]).p, b = levM(m.codici[si]).p;
        if (a >= min && b < min) rotte++;
      });
  }
  verifica(`nessuna proposta porta un pasto principale sotto ${min} g di proteine`, rotte === 0, rotte + ' casi');

  // una proposta scartata non torna
  stato();
  const r1 = leveGiorno(2, 'g', -6, 'altri');
  const prima1 = tutte(r1)[0];
  levRegole().scartati.push(levFirma(prima1));
  const r2 = tutte(leveGiorno(2, 'g', -6, 'altri'));
  verifica('una proposta scartata non viene riproposta',
    !r2.some(m => JSON.stringify(levFirma(m)) === JSON.stringify(levFirma(prima1))));

  stato({ settings: { pianoBase: 'vuoto' } });
  const v = leveGiorno(0, 'p', 10, 'altri');
  verifica('piano vuoto: nessuna proposta, nessun errore', !tutte(v).length);
}

/** Le schermate nuove si disegnano anche senza niente dentro, e senza parole rotte. */
function casiVuoto() {
  for (const base of ['vuoto', 'esempio']) {
    stato({ settings: { pianoBase: base } });
    const v = document.createElement('div');
    for (const f of [cardMese, cardAnelliSettimana]) v.append(f());
    viewCorpo(v); viewPrevisioni(v); viewPalestra(v); sezTarget(v); viewDiario(v);
    const t = v.textContent;
    verifica(`piano ${base} senza dati: niente NaN, undefined o null a schermo`,
      !/NaN|undefined|\bnull\b/.test(t), (t.match(/.{30}(NaN|undefined|\bnull\b).{10}/) || [''])[0]);
  }
  // la revisione disegna davvero i suoi pallini (non solo l'animazione)
  stato({ log: mangia(pesate(-0.3, 40), 2300), settings: cut });
  const vr = document.createElement('div');
  viewRevisione(vr);
  verifica('il manubrio della revisione ha i pallini disegnati',
    vr.querySelectorAll('svg circle').length >= 4, vr.querySelectorAll('svg circle').length + ' cerchi');
  stato({ settings: { pianoBase: 'esempio' } });
  verifica('senza pesate il mese chiede pesate, non inventa un verdetto', giudizioMese().stato === 'dati');
}

/* ------------------------------------------------------------------ via */
(async () => {
  const out = document.getElementById('esito');
  try {
    await caricaApp();
    for (const f of [casiMese, casiPrevisione, casiAttivita, casiMisure, casiDiario, casiScarico, casiCalendario, casiSpunti, casiPrevisioni, casiLeve, casiVuoto]) {
      try { f(); } catch (e) { verifica(f.name + ' non deve lanciare', false, e.message); }
    }
  } catch (e) {
    verifica('l\'app si carica', false, e.message);
  }
  const ko = RISULTATI.filter(r => !r.ok);
  document.title = ko.length ? `FALLITI ${ko.length}/${RISULTATI.length}` : `OK ${RISULTATI.length}/${RISULTATI.length}`;
  out.innerHTML = `<b class="${ko.length ? 'ko' : 'ok'}">${document.title}</b>\n\n`
    + RISULTATI.map(r => `<span class="${r.ok ? 'ok' : 'ko'}">${r.ok ? '✓' : '✗'}</span> ${r.nome}`
      + (r.dettaglio && !r.ok ? `  — ${r.dettaglio}` : '')).join('\n');
})();
