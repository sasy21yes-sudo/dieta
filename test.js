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

/** Le schermate nuove si disegnano anche senza niente dentro, e senza parole rotte. */
function casiVuoto() {
  for (const base of ['vuoto', 'esempio']) {
    stato({ settings: { pianoBase: base } });
    const v = document.createElement('div');
    for (const f of [cardMese, cardMeseCorta, cardAnelliSettimana]) v.append(f());
    viewCorpo(v); viewPrevisioni(v); viewPalestra(v);
    const t = v.textContent;
    verifica(`piano ${base} senza dati: niente NaN, undefined o null a schermo`,
      !/NaN|undefined|\bnull\b/.test(t), (t.match(/.{30}(NaN|undefined|\bnull\b).{10}/) || [''])[0]);
  }
  stato({ settings: { pianoBase: 'esempio' } });
  verifica('senza pesate il mese chiede pesate, non inventa un verdetto', giudizioMese().stato === 'dati');
}

/* ------------------------------------------------------------------ via */
(async () => {
  const out = document.getElementById('esito');
  try {
    await caricaApp();
    for (const f of [casiMese, casiPrevisione, casiAttivita, casiMisure, casiDiario, casiScarico, casiVuoto]) {
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
