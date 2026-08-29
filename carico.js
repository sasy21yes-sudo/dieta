/* Gestione del carico: quando scaricare, e cosa evitare quando qualcosa fa male.
 *
 * Sono due funzioni diverse dello stesso problema — non spingere quando il
 * corpo dice di no — e per questo stanno insieme.
 *
 * Nessuna delle due da' un verdetto medico. Lo scarico e' una raccomandazione
 * costruita su segnali che l'app gia' misura; gli acciacchi sono una cosa che
 * DICHIARI tu, e l'app si limita a ricordarsela e a togliere di mezzo gli
 * esercizi che ci vanno sopra. Se un dolore non passa, la risposta giusta non
 * e' in questa app.
 */
'use strict';

/* ============================================================== scarico */

/**
 * La traiettoria giornaliera di forma, fatica e prontezza di un muscolo, in
 * una sola passata. formaFatica() ricalcola tutto da capo a ogni chiamata: per
 * avere lo storico servirebbero quaranta chiamate per muscolo, cioe' migliaia
 * di scansioni dello stesso registro. Qui si scorre una volta e si annota.
 */
const _trCache = new Map();
function traiettoriaFatica(mus, fino = today(), giorni = 120) {
  const key = mus + '|' + fino + '|' + giorni + '|'
    + Object.keys(P().sessioni || {}).length;
  if (_trCache.has(key)) return _trCache.get(key);
  const out = traiettoriaFaticaCalc(mus, fino, giorni);
  if (_trCache.size > 120) _trCache.clear();
  _trCache.set(key, out);
  return out;
}
function traiettoriaFaticaCalc(mus, fino, giorni) {
  const M = PD?.modello || { tau_forma: 42, tau_fatica: 7, k_forma: 1, k_fatica: 2 };
  const df = Math.exp(-1 / M.tau_forma), dt = Math.exp(-1 / M.tau_fatica);
  let forma = 0, fatica = 0;
  const out = [];
  for (let i = giorni; i >= 0; i--) {
    const k = addDays(fino, -i);
    let imp = 0;
    for (const s of serieDelGiorno(k)) {
      const ex = esercizio(s.ex); if (!ex) continue;
      const w = pesoMuscolare(ex, mus); if (!w) continue;
      imp += w * sforzo(s.rir) * (1 + (s.drop || []).length * 0.5);
    }
    forma += imp; fatica += imp;
    forma *= df; fatica *= dt;
    out.push({ k, forma, fatica, prontezza: M.k_forma * forma - M.k_fatica * fatica });
  }
  return out;
}

/** Percentile su un elenco gia' filtrato dai nulli. */
function perc(vals, q) {
  const v = vals.filter(x => x != null && !isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (i - lo);
}

/** Serie pesate totali di una settimana, sommate su tutti i muscoli. */
function seriePesateSettimana(k) {
  const v = volumeMuscoli(windowDays(k, 7));
  return Object.values(v).reduce((a, x) => a + x.serie, 0);
}

/**
 * Serve una settimana di scarico?
 *
 * Non basta un segnale solo: la fatica alta da sola vuol dire semplicemente
 * che ti stai allenando, ed e' quello che deve succedere. Lo scarico si
 * giustifica quando la fatica alta si accompagna a qualcosa che NON migliora
 * piu' — forza ferma o in calo — oppure a troppe settimane di fila senza mai
 * una piu' leggera.
 */
function scaricoConsigliato(k = today()) {
  const sedute = Object.keys(P().sessioni || {})
    .filter(d => d <= k && (P().sessioni[d].serie || []).length);
  if (sedute.length < 9)
    return { serve: false, dati: false,
             d: 'Servono almeno nove sedute registrate prima di poter dire qualcosa sul carico.' };

  /* --- 1. carico acuto contro carico cronico ---
     Il primo tentativo confrontava la fatica con la forma e non scattava mai:
     con tau_forma 42 contro tau_fatica 7, chiunque si alleni con regolarita'
     ha la forma sei volte la fatica, per costruzione del modello. Il numero
     che dice qualcosa e' il RAPPORTO fra le due diviso il suo valore di
     regime — l'idea del rapporto fra carico acuto e cronico, qui con medie
     esponenziali invece che a finestra mobile. A regime vale 1 per
     definizione; sopra 1,5 vuol dire che hai caricato molto piu' del solito
     e il corpo non ha ancora avuto il tempo di adattarsi.
     E' un indicatore discusso in letteratura, non una legge: qui e' uno dei
     segnali, mai l'unico. */
  const allenati = [], stanchi = [], acr = [];
  for (const m of muscoli()) {
    const tr = traiettoriaFatica(m.id, k, 84);
    const oggi = tr[tr.length - 1];
    if (!oggi || oggi.forma < 0.5) continue;      // muscolo che non alleni
    allenati.push(m.nome);
    const M = PD?.modello || { tau_forma: 42, tau_fatica: 7 };
    const regime = M.tau_fatica / M.tau_forma;
    const r = (oggi.fatica / oggi.forma) / regime;
    acr.push(r);
    if (r >= 1.35) stanchi.push(`${m.nome} (${nf(r, 2)}×)`);
  }
  const acrMediano = acr.length ? perc(acr, .5) : null;

  /* --- 2. forza ferma o in calo --- */
  const fermi = [];
  for (const e of catalogo()) {
    const pts = e1rmPerSeduta(e.id).filter(p => p.k >= addDays(k, -42));
    if (pts.length < 4) continue;
    const r = regressione(pts.map((p, i) => ({ x: i, y: p.v })));
    if (r && r.m <= 0) fermi.push(e.nome);
  }

  /* --- 3. settimane di fila senza una piu' leggera --- */
  const vol = [];
  for (let w = 0; w < 10; w++) vol.push(seriePesateSettimana(addDays(k, -7 * w)));
  const rif = [...vol].filter(x => x > 0).sort((a, b) => a - b);
  const mediana = rif.length ? rif[Math.floor(rif.length / 2)] : 0;
  let filata = 0;
  for (const s of vol) { if (mediana && s >= mediana * .8) filata++; else break; }

  const ultimo = P().ultimoScarico || null;
  const daUltimo = ultimo ? Math.round((new Date(k) - new Date(ultimo)) / 864e5) : null;

  const motivi = [];
  // il conto per muscolo dice DOVE, la mediana dice QUANTO: la mediana e' il
  // criterio, perche' un solo muscolo fuori scala e' una seduta, non un ciclo
  if (acrMediano != null && acrMediano >= 1.35 && stanchi.length >= 2)
    motivi.push({ t: `Carico acuto a ${nf(acrMediano, 2)} volte il tuo regime`,
      d: `Piu' carico del solito su ${stanchi.length} muscoli su ${allenati.length} (${stanchi.slice(0, 3).join(', ')}) e l'adattamento non e' ancora arrivato. Il conto e' fatto muscolo per muscolo sul tuo storico, non su una soglia uguale per tutti.` });
  if (fermi.length >= 2)
    motivi.push({ t: `La forza e' ferma o in calo su ${fermi.length} esercizi`,
      d: `${fermi.slice(0, 3).join(', ')}${fermi.length > 3 ? ' e altri' : ''}. Con la fatica alta, un massimale stimato che non sale non e' un limite genetico: e' recupero mancato.` });
  if (filata >= 6)
    motivi.push({ t: `${filata} settimane di fila sopra il tuo volume abituale`,
      d: 'Nessuna settimana piu' + '’ leggera in mezzo. Prima o poi la si prende comunque, meglio sceglierla.' });
  if (daUltimo != null && daUltimo >= 42)
    motivi.push({ t: `Ultimo scarico ${daUltimo} giorni fa`,
      d: 'Un ciclo tipico ne prevede uno ogni sei-otto settimane.' });
  else if (daUltimo == null && sedute.length >= 20 && filata >= 6)
    motivi.push({ t: 'Non hai mai segnato una settimana di scarico',
      d: 'Puo' + '\u2019 darsi che tu ne abbia fatte senza segnarle. Se non e\' cosi\', questa e\' la prima.' });

  const forte = motivi.length >= 2 || filata >= 8;
  return {
    serve: forte, dati: true, motivi, stanchi, fermi, filata, acr: acrMediano,
    d: forte
      ? 'Piu' + '’ di un segnale punta nella stessa direzione. Una settimana piu' + '’ leggera adesso costa poco e sblocca il mese dopo.'
      : motivi.length === 1
        ? 'Un segnale solo: da tenere d\'occhio, non da correre a scaricare.'
        : 'Nessun segnale di sovraccarico. Il carico regge, continua cosi' + '’.',
    come: [
      'Stessi esercizi e stessi carichi: e' + '’ quello che tiene su la tecnica e l\'adattamento.',
      'Meta' + '’ delle serie. Se ne fai 4, falle 2.',
      'Fermati a RIR 3–4: nessuna serie vicina al cedimento.',
      'Una settimana, poi si riprende da dove si era rimasti — non da meno.'
    ]
  };
}

/** Carta per la scheda Gym. */
function cardScarico(k = today()) {
  const s = scaricoConsigliato(k);
  if (!s.dati || (!s.serve && !s.motivi.length)) return null;
  const c = el('div', s.serve ? 'card scarico on' : 'card scarico');
  c.append(el('div', 'eyebrow', s.serve ? 'Conviene scaricare' : 'Carico sotto controllo'));
  c.append(el('div', 'muted', esc(s.d)));
  if (s.motivi.length) {
    const ul = el('div', 'sc-motivi');
    for (const m of s.motivi) {
      const r = el('div', 'sc-m');
      r.innerHTML = `<span class="t">${esc(m.t)}</span><span class="c">${esc(m.d)}</span>`;
      ul.append(r);
    }
    c.append(ul);
    if (typeof osserva === 'function')
      osserva(ul, () => entrata([...ul.children], { passo: 70 }));
  }
  if (s.serve) {
    const b = el('button', 'btn wide pri', 'Come si fa uno scarico');
    b.style.marginTop = '10px';
    b.onclick = () => sheetScarico(s, k);
    c.append(b);
  }
  return c;
}

function sheetScarico(s, k) {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Settimana di scarico'));
  w.append(el('h2', 'sec', 'Meno serie, stessi carichi'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Scaricare non vuol dire fermarsi. Il riposo totale fa scendere anche la forma, '
    + 'che ci ha messo settimane a salire; togliere volume tenendo l\'intensita\' fa '
    + 'scendere solo la fatica, che e\' esattamente quello che serve.'));
  const ol = el('div', 'sc-come');
  for (const [i, r] of s.come.entries()) {
    const x = el('div', 'sc-p');
    x.innerHTML = `<span class="n">${i + 1}</span><span class="c">${esc(r)}</span>`;
    ol.append(x);
  }
  w.append(ol);
  if (typeof osserva === 'function') osserva(ol, () => entrata([...ol.children], { passo: 80 }));

  const b = el('button', 'btn wide pri', 'Segno che questa settimana e\' di scarico');
  b.style.marginTop = '12px';
  b.onclick = () => {
    P().ultimoScarico = k; save(); closeSheet(); route();
    toast('Scarico segnato: te lo ricordo fra sei settimane');
  };
  w.append(b);
  w.append(el('p', 'note',
    'Serve solo a non riproportelo ogni giorno e a contare da quanto non ne fai uno. '
    + 'Non cambia nessun calcolo.'));
  sheet(w);
}

/* ============================================================ acciacchi */

const LIV_ACCIACCO = [
  { v: 1, n: 'Fastidio', d: 'Si sente, ma non cambia come ti muovi. Gli esercizi restano, occhio alla tecnica.' },
  { v: 2, n: 'Dolore', d: 'Limita il movimento o il carico. Via gli esercizi che ci vanno sopra come primari.' },
  { v: 3, n: 'Infortunio', d: 'Non si carica. Via tutto quello che lo coinvolge, anche di rimbalzo.' }
];
const livAcciacco = v => LIV_ACCIACCO.find(x => x.v === +v) || LIV_ACCIACCO[0];

function acciacchi() { P().acciacchi ||= []; return P().acciacchi; }
const acciacchiAttivi = (k = today()) =>
  acciacchi().filter(a => a.dal <= k && (!a.al || a.al >= k));

/**
 * Un esercizio va evitato?
 * Livello 2 blocca gli esercizi in cui il muscolo dolorante e' primario;
 * livello 3 blocca anche quelli in cui e' solo secondario, perche' con un
 * infortunio vero il coinvolgimento indiretto basta a peggiorarlo.
 */
function acciaccoSuEsercizio(exId, k = today()) {
  const ex = esercizio(exId); if (!ex) return null;
  for (const a of acciacchiAttivi(k)) {
    if ((ex.primari || []).includes(a.mus)) { if (a.livello >= 2) return a; }
    else if ((ex.secondari || []).includes(a.mus)) { if (a.livello >= 3) return a; }
  }
  return null;
}
/** L'avviso da infilare sopra una riga di allenamento, o null. */
function avvisoAcciacco(exId, k = today()) {
  const a = acciaccoSuEsercizio(exId, k);
  if (!a) return null;
  const m = muscolo(a.mus);
  const d = el('div', 'hint acciacco');
  d.innerHTML = `<strong>${esc(livAcciacco(a.livello).n)} a ${esc(m?.nome || a.mus)}</strong> — `
    + `questo esercizio ci va sopra. ${esc(a.nota || 'Salta o sostituisci.')}`;
  return d;
}

function cardAcciacchi(k = today()) {
  const att = acciacchiAttivi(k);
  const c = el('div', 'card');
  c.append(el('div', 'row between',
    `<strong>Dolori e infortuni</strong><span class="mono muted" style="font-size:11px">${
      att.length ? att.length + ' in corso' : 'nessuno'}</span>`));
  if (!att.length) {
    c.append(el('div', 'muted',
      'Se qualcosa fa male, segnalo: l\'app toglie dalle schede e dal programma HYROX '
      + 'gli esercizi che ci vanno sopra, invece di proportele e basta.'));
  } else {
    for (const a of att) {
      const m = muscolo(a.mus), L = livAcciacco(a.livello);
      const r = el('button', 'acc-r');
      const gg = Math.round((new Date(k) - new Date(a.dal)) / 864e5);
      r.innerHTML = `<span class="lv l${a.livello}">${esc(L.n)}</span>
        <span class="nm">${esc(m?.nome || a.mus)}</span>
        <span class="gg">da ${gg} giorn${gg === 1 ? 'o' : 'i'}</span>`;
      r.onclick = () => sheetAcciacco(a.id);
      c.append(r);
    }
    const bloccati = catalogo().filter(e => acciaccoSuEsercizio(e.id, k));
    if (bloccati.length) c.append(el('div', 'hint',
      `${bloccati.length} esercizi in pausa: ${esc(bloccati.slice(0, 4).map(e => e.nome).join(', '))}${
        bloccati.length > 4 ? ' e altri' : ''}.`));
  }
  const b = el('button', 'btn wide', att.length ? 'Aggiungine uno' : 'Segna un dolore');
  b.style.marginTop = '10px';
  b.onclick = () => sheetAcciacco(null);
  c.append(b);
  return c;
}

function sheetAcciacco(id) {
  const a = acciacchi().find(x => x.id === id)
    || { id: uid(), mus: muscoli()[0]?.id, livello: 1, dal: today(), al: null, nota: '' };
  const nuovo = !acciacchi().some(x => x.id === a.id);

  const w = el('div');
  w.append(el('div', 'eyebrow', nuovo ? 'Nuovo' : 'In corso da ' + a.dal));
  w.append(el('h2', 'sec', nuovo ? 'Segna un dolore' : muscolo(a.mus)?.nome || 'Dolore'));
  w.lastChild.style.marginTop = '0';

  const selM = el('select');
  selM.id = 'ac-mus';
  selM.style.cssText = 'width:100%;padding:9px 10px;border:1px solid var(--rule);'
    + 'border-radius:9px;background:var(--paper);color:var(--ink);font:inherit';
  for (const m of muscoli()) selM.append(new Option(m.nome, m.id, false, m.id === a.mus));
  const f1 = el('div', 'field', '<label>Dove</label>');
  f1.append(selM); w.append(f1);

  w.append(el('div', 'eyebrow', 'Quanto e\' serio'));
  const seg = el('div', 'seg');
  let liv = a.livello;
  const spiega = el('div', 'hint', esc(livAcciacco(liv).d));
  for (const L of LIV_ACCIACCO) {
    const b = el('button', null, L.n);
    b.setAttribute('aria-pressed', liv === L.v);
    b.onclick = () => {
      liv = L.v;
      [...seg.children].forEach(x => x.setAttribute('aria-pressed', x === b));
      spiega.textContent = L.d;
    };
    seg.append(b);
  }
  w.append(seg); w.append(spiega);

  w.append(el('div', 'field',
    `<label>Da quando</label><input type="date" id="ac-dal" value="${esc(a.dal)}">`));
  w.append(el('div', 'field',
    `<label>Nota (facoltativa)</label><input type="text" id="ac-nota"
      placeholder="p.es. solo in allungamento" value="${esc(a.nota || '')}">`));

  const salva = el('button', 'btn wide pri', 'Salva');
  salva.onclick = () => {
    a.mus = $('#ac-mus').value;
    a.livello = liv;
    a.dal = $('#ac-dal').value || today();
    a.nota = $('#ac-nota').value.trim();
    a.al = null;
    if (nuovo) acciacchi().push(a);
    save(); closeSheet(); route();
    toast('Segnato: le schede lo terranno presente');
  };
  w.append(salva);

  if (!nuovo) {
    const chiudi = el('button', 'btn wide', 'E\' passato');
    chiudi.style.marginTop = '8px';
    chiudi.onclick = () => {
      a.al = today(); save(); closeSheet(); route();
      toast('Chiuso: gli esercizi tornano disponibili');
    };
    w.append(chiudi);
    const el2 = el('button', 'btn wide', 'Elimina');
    el2.style.marginTop = '8px';
    el2.onclick = () => {
      const i = acciacchi().findIndex(x => x.id === a.id);
      if (i >= 0) acciacchi().splice(i, 1);
      save(); closeSheet(); route();
    };
    w.append(el2);
  }
  w.append(el('p', 'note',
    'L\'app non sa cosa hai: registra quello che le dici e smette di proporti gli '
    + 'esercizi che caricano quella zona. Un dolore che dura piu' + '’ di due settimane '
    + 'o che peggiora va guardato da qualcuno, non gestito da un\'app.'));
  sheet(w);
}
