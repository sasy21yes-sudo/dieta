/* Sfide giornaliere e punteggi di costanza.
   Il catalogo sta in data/sfide.json. Qui c'e' solo il motore e i componenti. */
'use strict';

let SF = null;                                   // data/sfide.json

function SFS() {
  S.sfide ||= {};
  S.sfide.log ||= {};        // { 'YYYY-MM-DD': { id, fatta, saltata } }
  return S.sfide;
}
const catSfida = id => (SF?.categorie || []).find(c => c.id === id) || { nome: '', colore: 1 };

/**
 * La sfida del giorno, scelta in modo deterministico sulla data: lo stesso
 * giorno mostra sempre la stessa, cosi' non si puo' ricaricare finche' non
 * esce quella comoda. Evita le ultime dieci gia' uscite, altrimenti su un
 * catalogo di quaranta se ne rivedrebbero troppe di fila.
 */
function sfidaDelGiorno(k = today()) {
  if (!SF?.sfide?.length) return null;
  const st = SFS();
  if (st.log[k]?.id) {
    const s = SF.sfide.find(x => x.id === st.log[k].id);
    if (s) return s;
  }
  const recenti = new Set();
  for (let i = 1; i <= 10; i++) {
    const id = st.log[addDays(k, -i)]?.id;
    if (id) recenti.add(id);
  }
  const pool = SF.sfide.filter(s => !recenti.has(s.id));
  const lista = pool.length ? pool : SF.sfide;
  return lista[Math.abs(hashData(k)) % lista.length];
}

function statoSfida(k = today()) { return SFS().log[k] || null; }
function segnaSfida(k, come) {
  const st = SFS(), s = sfidaDelGiorno(k);
  if (!s) return;
  if (st.log[k]?.[come]) delete st.log[k];
  else st.log[k] = { id: s.id, [come]: true };
  save();
}

/** Punti accumulati e sfide fatte di fila. */
function puntiSfide(k = today(), n = 365) {
  const st = SFS();
  let punti = 0, fatte = 0, viste = 0;
  for (const g of windowDays(addDays(k, 1), n)) {
    const r = st.log[g]; if (!r) continue;
    viste++;
    if (r.fatta) {
      fatte++;
      punti += (SF?.sfide.find(x => x.id === r.id)?.punti) || 8;
    }
  }
  let filaCorrente = 0;
  for (let i = 0; i < 400; i++) {
    const g = addDays(k, -i);
    if (st.log[g]?.fatta) filaCorrente++;
    else if (i > 0) break;
  }
  return { punti, fatte, viste, fila: filaCorrente };
}

/* ------------------------------------------------------------- costanza */
/**
 * Quattro punteggi, tutti sulla stessa scala 0-100 e tutti calcolati fino a
 * IERI: oggi e' una giornata a meta' e abbasserebbe ogni numero ogni mattina.
 * Non sono un voto sulla persona: dicono quanto e' continuo il registro, che
 * e' l'unica cosa che rende affidabile tutto il resto dell'app.
 */
function costanze(k = today(), n = 28) {
  // i giorni marcati in pausa escono dal conto: se sei stato una settimana con
  // l'influenza, dividere per 28 invece che per 21 non misura la tua costanza,
  // misura che ti sei ammalato
  const giorni = typeof senzaPause === 'function'
    ? senzaPause(windowDays(k, n)) : windowDays(k, n);
  const st = SFS();

  const nutr = giorni.filter(g => {
    const d = S.log[g];
    return d && (Object.keys(d.pasti || {}).length || (d.extra || []).length);
  }).length;

  const allenati = giorni.filter(g =>
    (typeof serieDelGiorno === 'function' && serieDelGiorno(g).length)
    || (typeof cardioDi === 'function' && cardioDi(g).length)
    || S.hyrox?.sessioni?.[g]?.fatto
    || S.log[g]?.allenamento === true).length;
  // il bersaglio non e' "tutti i giorni": e' quante sedute hai detto di reggere
  const seduteObiettivo = (typeof usaHyrox === 'function' && usaHyrox()
    && S.hyrox?.profilo?.sedute)
    || (typeof seduteAbituali === 'function' && seduteAbituali(k)) || 3;
  const attese = Math.max(1, Math.round(giorni.length / 7 * seduteObiettivo));

  const sfideViste = giorni.filter(g => st.log[g]).length;
  const sfideFatte = giorni.filter(g => st.log[g]?.fatta).length;

  const pesate = giorni.filter(g => S.log[g]?.peso != null).length;

  const N = Math.max(1, giorni.length);      // il denominatore vero, pause escluse
  const pct = x => Math.round(Math.max(0, Math.min(1, x)) * 100);
  const nutrizione = pct(nutr / N);
  const allenamento = pct(allenati / attese);
  const sfide = pct(sfideFatte / N);
  const registro = pct(pesate / N);
  // il generale pesa di piu' quello che rende affidabili gli altri numeri
  const generale = pct((nutrizione * 0.35 + allenamento * 0.3
                      + registro * 0.2 + sfide * 0.15) / 100);
  return { n, giorni: giorni.length, saltati: n - giorni.length,
           nutrizione, allenamento, sfide, registro, generale,
           dettaglio: { nutr, allenati, attese, sfideFatte, sfideViste, pesate } };
}

const LIVELLI_COSTANZA = [
  { min: 85, nome: 'Ferrea', d: 'Il registro e\' continuo: ogni numero che leggi qui dentro vale.' },
  { min: 65, nome: 'Solida', d: 'Abbastanza continua da fidarsi delle medie e delle previsioni.' },
  { min: 45, nome: 'A tratti', d: 'I buchi cominciano a rendere rumorose le medie: le conclusioni reggono meno.' },
  { min: 20, nome: 'Sfilacciata', d: 'Troppi giorni vuoti: i motori lavorano al buio e le previsioni valgono poco.' },
  { min: 0,  nome: 'Da riprendere', d: 'Ricomincia da una cosa sola: la pesata del mattino. Il resto viene dietro.' }
];
const livelloCostanza = v => LIVELLI_COSTANZA.find(l => v >= l.min) || LIVELLI_COSTANZA[4];

/* ====================================================== la fiamma

   La striscia di giorni era una riga di testo in fondo a una carta, e una riga
   di testo non si guarda. Qui diventa una fiamma che CRESCE davvero con i
   giorni: non e' decorazione, e' la stessa informazione disegnata invece che
   scritta — l'altezza del riempimento interno viene dal numero.

   Sei stadi, non un continuo: a occhio nudo la differenza fra 14 e 15 giorni
   non si vede comunque, e fingere una precisione che l'occhio non coglie
   sarebbe come mettere due decimali su una stima.

   Lo sfarfallio e' l'unica animazione infinita di tutta l'app, dura 2,4 s e
   muove solo transform. Con reduced-motion la fiamma sta ferma: resta piena
   allo stesso modo, perche' e' il riempimento a portare il dato. */

const STADI_FIAMMA = [
  { min: 60, q: 1,   n: 'Fuoco vivo',   d: 'Due mesi. A questo punto non e\' piu\' disciplina, e\' abitudine.' },
  { min: 21, q: .82, n: 'Fiamma alta',  d: 'Tre settimane: la soglia oltre la quale saltare un giorno costa fatica.' },
  { min: 7,  q: .62, n: 'Fiamma',       d: 'Una settimana piena. Il registro comincia a essere affidabile.' },
  { min: 3,  q: .42, n: 'Presa',        d: 'Tre giorni. E\' il tratto in cui di solito si molla: tienila.' },
  { min: 1,  q: .24, n: 'Scintilla',    d: 'Cominciato. Domani vale piu\' di oggi.' },
  { min: 0,  q: 0,   n: 'Spenta',       d: 'Basta registrare qualcosa — anche solo la pesata — per riaccenderla.' }
];
const stadioFiamma = n => STADI_FIAMMA.find(s => n >= s.min) || STADI_FIAMMA[5];

/**
 * La fiamma. `dim` e' il lato in pixel; il numero sta accanto, non dentro:
 * dentro sarebbe illeggibile sotto i quaranta pixel.
 */
function fiamma(giorni, dim = 34) {
  const st = stadioFiamma(giorni);
  const box = el('span', 'fiamma' + (giorni ? '' : ' off'));
  box.style.setProperty('--f', dim + 'px');
  // il riempimento parte dal basso: clip a una frazione dell'altezza
  const y = (1 - st.q) * 24;
  box.innerHTML = '<svg viewBox="0 0 24 26" aria-hidden="true">'
    + '<defs><clipPath id="fc' + Math.round(st.q * 100) + '">'
    + '<rect x="0" y="' + y.toFixed(1) + '" width="24" height="26"/>'
    + '</clipPath></defs>'
    + '<path class="cont" d="M12,1.5 C13.4,6.4 18.5,8.2 18.5,14.2 '
    + 'a6.5,6.5 0 0 1 -13,0 C5.5,10.6 8.2,9.6 9.2,6.4 '
    + 'c1.6,1.4 1.9,3 1.6,4.6 C12.6,9.4 12.9,5.4 12,1.5 Z"/>'
    + (st.q > 0
      ? '<path class="pieno" clip-path="url(#fc' + Math.round(st.q * 100) + ')" '
        + 'd="M12,1.5 C13.4,6.4 18.5,8.2 18.5,14.2 '
        + 'a6.5,6.5 0 0 1 -13,0 C5.5,10.6 8.2,9.6 9.2,6.4 '
        + 'c1.6,1.4 1.9,3 1.6,4.6 C12.6,9.4 12.9,5.4 12,1.5 Z"/>'
      : '')
    + '</svg>';
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', giorni + ' giorni di fila');
  return box;
}

/** Fiamma + numero + nome dello stadio: il blocco completo. */
function bloccoFiamma(giorni, compatto) {
  const st = stadioFiamma(giorni);
  const b = el('div', 'fi-blocco' + (compatto ? ' cp' : ''));
  b.append(fiamma(giorni, compatto ? 28 : 44));
  const t = el('span', 'fi-t');
  const num = el('span', 'fi-n', String(giorni));
  t.append(num);
  const lab = el('span', 'fi-l');
  lab.textContent = giorni === 1 ? 'giorno di fila' : 'giorni di fila';
  t.append(lab);
  if (!compatto) {
    const s = el('span', 'fi-s');
    s.textContent = st.n;
    t.append(s);
  }
  b.append(t);
  if (typeof osserva === 'function')
    osserva(b, () => contaSu(num, giorni, { dur: 700 }));
  return b;
}

/* ---------------------------------------------------------- componenti */
/** Anello di punteggio: un numero solo merita una forma sola, non un grafico. */
function anello(pct, etichetta, sotto, tinta) {
  const R = 25, C = 2 * Math.PI * R, W = 68;
  const box = el('div', 'ring');
  const s = mk('svg', { viewBox: `0 0 ${W} ${W}` });
  s.append(mk('circle', { cx: W / 2, cy: W / 2, r: R, fill: 'none',
    stroke: 'var(--wash)', 'stroke-width': 7 }));
  s.append(mk('circle', { cx: W / 2, cy: W / 2, r: R, fill: 'none',
    stroke: tinta || 'var(--pine)', 'stroke-width': 7, 'stroke-linecap': 'round',
    'stroke-dasharray': `${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}`,
    transform: `rotate(-90 ${W / 2} ${W / 2})` }));
  const t = mk('text', { x: W / 2, y: W / 2 + 5, 'text-anchor': 'middle',
    'font-size': 17, 'font-weight': 600, fill: 'var(--ink)',
    'font-family': 'var(--sans)' });
  t.textContent = pct;
  s.append(t);
  box.append(s);
  if (typeof osserva === 'function') osserva(box, () => {
    riempiAnello(s.querySelectorAll('circle')[1], pct / 100);
    contaSu(t, pct, { dur: 900 });
  });
  box.append(el('div', 'rl', esc(etichetta)));
  if (sotto) box.append(el('div', 'rs', esc(sotto)));
  return box;
}

/** La carta della sfida, su Oggi. */
function cardSfida(k) {
  const s = sfidaDelGiorno(k);
  if (!s) return null;
  const st = statoSfida(k), fatta = !!st?.fatta, saltata = !!st?.saltata;
  const cat = catSfida(s.cat);
  const p = puntiSfide(k);

  const c = el('div', 'card sfida' + (fatta ? ' ok' : saltata ? ' skip' : ''));
  c.append(el('div', 'row between',
    `<span class="eyebrow">Sfida di oggi · ${esc(cat.nome)}</span>
     <span class="mono sf-p">+${s.punti}</span>`));
  /* Il segno di spunta si disegna invece di comparire: e' un fotogramma solo
     ma e' quello che fa sentire che l'hai fatta tu, non che era gia' cosi'. */
  const tit = el('h3', 'sfida-t');
  if (fatta) {
    const sv = mk('svg', { viewBox: '0 0 24 24', class: 'sf-tick' });
    sv.append(mk('path', { d: 'M4,13 L9.5,18.5 L20,6', fill: 'none',
      stroke: 'var(--pine)', 'stroke-width': 3, 'stroke-linecap': 'round',
      'stroke-linejoin': 'round' }));
    tit.append(sv);
  }
  tit.append(document.createTextNode(esc(s.t).replace(/&[a-z]+;/g, m =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&quot;': '"' }[m] || m))));
  c.append(tit);
  c.append(el('p', 'sfida-d', esc(s.d)));

  if (!fatta && !saltata) {
    const r = el('div', 'row');
    r.style.gap = '8px';
    const ok = el('button', 'btn pri grow', 'Fatta');
    ok.onclick = () => {
      // i coriandoli prima del route(): dopo, la carta e' un altro elemento
      if (typeof coriandoli === 'function') coriandoli(c);
      if (typeof pulsa === 'function') pulsa(c, { scala: 1.02, dur: 380 });
      segnaSfida(k, 'fatta');
      setTimeout(() => { route(); toast(`+${s.punti} punti`); }, 260);
    };
    const no = el('button', 'btn', 'Oggi no');
    no.onclick = () => { segnaSfida(k, 'saltata'); route(); };
    r.append(ok, no);
    c.append(r);
  } else {
    const undo = el('button', 'btn wide', fatta ? 'Annulla' : 'Ci riprovo');
    undo.onclick = () => { segnaSfida(k, fatta ? 'fatta' : 'saltata'); route(); };
    c.append(undo);
  }

  /* Il piede: la fiamma della striscia, e i punti che salgono contando. */
  const f = el('div', 'sfida-f');
  // la fiamma sta in Dati, sopra gli anelli: qui rubava la scena alla sfida
  f.append(el('span', 'mono muted',
    (typeof streak === 'function' ? streak(k) : p.fila) + ' giorni di fila'));
  const nums = el('div', 'sf-nums');
  const np = el('span', 'v'), nf2 = el('span', 'v');
  nums.append(el('span', 'l', 'punti'), np, el('span', 'l', 'fatte'), nf2);
  f.append(nums);
  c.append(f);
  if (typeof osserva === 'function') osserva(nums, () => {
    contaSu(np, p.punti, { dur: 800 });
    contaSu(nf2, p.fatte, { dur: 800 });
  });
  // stato finale scritto subito: se l'osservatore non scatta la carta e' giusta
  np.textContent = nf(p.punti); nf2.textContent = nf(p.fatte);

  if (typeof osserva === 'function' && fatta)
    osserva(c, () => {
      const t = c.querySelector('.sf-tick path');
      if (t && typeof disegnaPath === 'function') disegnaPath(t, { dur: 420 });
    });
  return c;
}

/** Il blocco costanza per la scheda Dati. */
function cardCostanza(k, n) {
  const co = costanze(k, n);
  const liv = livelloCostanza(co.generale);
  const c = el('div', 'cw');
  c.append(el('h3', null, 'Costanza'));
  if (typeof streak === 'function') {
    const fb = bloccoFiamma(streak(k));
    fb.style.margin = '2px 0 10px';
    c.append(fb);
  }
  c.append(el('div', 'sub',
    `Ultimi ${co.n} giorni fino a ieri. Non e' un voto su di te: dice quanto e' continuo il registro, che e' cio' che rende affidabile tutto il resto.`));

  const riga = el('div', 'rings');
  riga.append(anello(co.generale, 'Generale', liv.nome));
  riga.append(anello(co.nutrizione, 'Nutrizione', `${co.dettaglio.nutr}/${co.n} giorni`, 'var(--c1)'));
  riga.append(anello(co.allenamento, 'Allenamento', `${co.dettaglio.allenati}/${co.dettaglio.attese} sedute`, 'var(--c2)'));
  riga.append(anello(co.sfide, 'Sfide', `${co.dettaglio.sfideFatte}/${co.n}`, 'var(--c3)'));
  c.append(riga);

  c.append(el('p', 'note', `<strong>${esc(liv.nome)}</strong> — ${esc(liv.d)}`));
  c.append(el('p', 'note',
    `Il punteggio generale pesa nutrizione 35%, allenamento 30%, pesate 20%, sfide 15%. L'allenamento non si misura su tutti i giorni ma sulle ${S.hyrox?.profilo?.sedute || 4} sedute a settimana che hai dichiarato di reggere: riposare quando serve non abbassa il punteggio.`));
  return c;
}

/* ------------------------------------------------------ menu a tendina */
/**
 * I tre puntini aprono un menu, non direttamente le impostazioni: profilo,
 * ingredienti e impostazioni erano tre cose diverse nascoste dietro lo stesso
 * gesto.
 */
function menuTendina() {
  const vecchio = $('#dropdown');
  if (vecchio) { vecchio.remove(); return; }
  const dd = el('div');
  dd.id = 'dropdown';
  const voce = (t, sotto, fn) => {
    const b = el('button');
    b.innerHTML = `<span class="t">${esc(t)}</span><span class="s">${esc(sotto)}</span>`;
    b.onclick = () => { dd.remove(); fn(); };
    dd.append(b);
  };
  voce('Profilo', 'Chi sei, target, profili multipli', () => {
    if (typeof pianoTab !== 'undefined') pianoTab = 'profilo';
    location.hash = '#/piano';
  });
  voce('Liste ingredienti', 'Alimenti del piano e prodotti reali', () => {
    if (typeof pianoTab !== 'undefined') pianoTab = 'alimenti';
    location.hash = '#/piano';
  });
  voce('Impostazioni', 'Backup, promemoria, foto, prodotti', () => sheetMenu());
  $('#top-actions').append(dd);
  setTimeout(() => {
    const chiudi = e => {
      if (dd.contains(e.target) || e.target.id === 'btn-menu') return;
      dd.remove(); document.removeEventListener('pointerdown', chiudi);
    };
    document.addEventListener('pointerdown', chiudi);
  }, 0);
}

/* ------------------------------------------------------------ traguardi */
/**
 * I traguardi si leggono dai dati gia' registrati: non chiedono niente in piu'
 * e non si possono perdere. Servono a rendere visibile il tempo passato, che
 * e' l'unica cosa che costruisce davvero un fisico — e che nessun grafico
 * settimanale riesce a mostrare.
 */
function valoreTraguardo(tipo) {
  switch (tipo) {
    case 'pesate': return Object.values(S.log).filter(d => d?.peso != null).length;
    case 'fila': return typeof streak === 'function' ? streak() : 0;
    case 'sedute': return Object.keys(S.palestra?.sessioni || {})
      .filter(k => (S.palestra.sessioni[k].serie || []).length).length;
    case 'schede': return (S.palestra?.schede || []).length;
    case 'sfide': return Object.values(S.sfide?.log || {}).filter(x => x.fatta).length;
    case 'punti': return puntiSfide().punti;
    case 'prodotti': return (S.prodotti || []).length;
    case 'sim': return (S.hyrox?.sim || []).length;
    case 'backup': return S.settings?.backup ? 1 : 0;
    case 'foto': return S.settings?.nFoto || 0;
    case 'vita': {
      const g = Object.keys(S.log).filter(k => S.log[k]?.misure?.vita != null).sort();
      if (g.length < 2) return 0;
      return Math.max(0, S.log[g[0]].misure.vita - S.log[g[g.length - 1]].misure.vita);
    }
    case 'forza': {
      if (typeof e1rmPerSeduta !== 'function') return 0;
      let best = 0;
      const usati = [...new Set(Object.keys(S.palestra?.sessioni || {})
        .flatMap(k => (S.palestra.sessioni[k].serie || []).map(s => s.ex)))];
      for (const id of usati) {
        const serie = e1rmPerSeduta(id);
        if (serie.length < 2) continue;
        const primo = serie[0].v, ultimo = Math.max(...serie.map(x => x.v));
        if (primo > 0) best = Math.max(best, (ultimo - primo) / primo * 100);
      }
      return best;
    }
    default: return 0;
  }
}

function traguardi() {
  return (SF?.traguardi || []).map(t => {
    const v = valoreTraguardo(t.tipo);
    return { ...t, val: v, preso: v >= t.soglia,
             quota: Math.max(0, Math.min(1, v / t.soglia)) };
  });
}

function cardTraguardi() {
  const list = traguardi();
  if (!list.length) return null;
  const presi = list.filter(t => t.preso);
  const prossimi = list.filter(t => !t.preso).sort((a, b) => b.quota - a.quota).slice(0, 3);
  const c = el('div', 'cw');
  c.append(el('h3', null, 'Traguardi'));
  c.append(el('div', 'sub', `${presi.length} su ${list.length}. Si sbloccano da soli sui dati che registri: non chiedono niente in piu' e non si possono perdere.`));

  const g = el('div', 'trofei');
  for (const t of list) {
    const b = el('div', 'trofeo' + (t.preso ? ' on' : ''));
    b.innerHTML = `<span class="ic">${t.preso ? '★' : '☆'}</span>
      <span class="nm">${esc(t.n)}</span>
      <span class="ds">${esc(t.d)}</span>`;
    b.title = t.d;
    g.append(b);
  }
  c.append(g);

  if (prossimi.length) {
    c.append(el('div', 'eyebrow', 'I piu vicini'));
    c.lastChild.style.marginTop = '12px';
    for (const t of prossimi)
      c.append(meter({ lab: t.n, val: Math.round(t.val * 10) / 10, tgt: t.soglia,
        unit: '', dec: t.tipo === 'vita' || t.tipo === 'forza' ? 1 : 0, tolleranza: 0 }));
  }
  c.append(el('p', 'note', esc(SF.nota_traguardi || '')));
  return c;
}
