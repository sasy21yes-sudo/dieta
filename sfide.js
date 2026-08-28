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
  const giorni = windowDays(k, n);
  const st = SFS();

  const nutr = giorni.filter(g => {
    const d = S.log[g];
    return d && (Object.keys(d.pasti || {}).length || (d.extra || []).length);
  }).length;

  const allenati = giorni.filter(g =>
    (typeof serieDelGiorno === 'function' && serieDelGiorno(g).length)
    || S.hyrox?.sessioni?.[g]?.fatto
    || S.log[g]?.allenamento === true).length;
  // il bersaglio non e' "tutti i giorni": e' quante sedute hai detto di reggere
  const attese = Math.max(1, Math.round(n / 7 * (S.hyrox?.profilo?.sedute || 4)));

  const sfideViste = giorni.filter(g => st.log[g]).length;
  const sfideFatte = giorni.filter(g => st.log[g]?.fatta).length;

  const pesate = giorni.filter(g => S.log[g]?.peso != null).length;

  const pct = x => Math.round(Math.max(0, Math.min(1, x)) * 100);
  const nutrizione = pct(nutr / n);
  const allenamento = pct(allenati / attese);
  const sfide = pct(sfideFatte / n);
  const registro = pct(pesate / n);
  // il generale pesa di piu' quello che rende affidabili gli altri numeri
  const generale = pct((nutrizione * 0.35 + allenamento * 0.3
                      + registro * 0.2 + sfide * 0.15) / 100);
  return { n, nutrizione, allenamento, sfide, registro, generale,
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
  c.append(el('h3', 'sfida-t', (fatta ? '✓ ' : '') + esc(s.t)));
  c.append(el('p', 'sfida-d', esc(s.d)));

  if (!fatta && !saltata) {
    const r = el('div', 'row');
    r.style.gap = '8px';
    const ok = el('button', 'btn pri grow', 'Fatta');
    ok.onclick = () => { segnaSfida(k, 'fatta'); route(); toast(`+${s.punti} punti`); };
    const no = el('button', 'btn', 'Oggi no');
    no.onclick = () => { segnaSfida(k, 'saltata'); route(); };
    r.append(ok, no);
    c.append(r);
  } else {
    const undo = el('button', 'btn wide', fatta ? 'Annulla' : 'Ci riprovo');
    undo.onclick = () => { segnaSfida(k, fatta ? 'fatta' : 'saltata'); route(); };
    c.append(undo);
  }

  c.append(el('div', 'sfida-f',
    `<span>${p.punti} punti in tutto</span>`
    + (p.fila > 1 ? `<span>${p.fila} giorni di fila</span>` : '')
    + `<span>${p.fatte} sfide fatte</span>`));
  return c;
}

/** Il blocco costanza per la scheda Dati. */
function cardCostanza(k, n) {
  const co = costanze(k, n);
  const liv = livelloCostanza(co.generale);
  const c = el('div', 'cw');
  c.append(el('h3', null, 'Costanza'));
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
