/* La spesa, e la dispensa che la alimenta.
 *
 * Il rework nasce da una domanda che la vecchia pagina non si poneva: **una
 * lista della spesa non si legge, si cammina.** Era un elenco per categoria
 * del file di dominio (legumi, cereali, verdura...) con una spunta e un peso,
 * cioe' l'ordine con cui i dati stanno scritti — non l'ordine in cui uno
 * attraversa il negozio.
 *
 * Guardando cosa fanno le app che questo mestiere lo fanno da anni, quattro
 * cose ricorrono e valgono la pena:
 *
 *   1. **l'ordine delle corsie si sistema una volta** (AnyList): le categorie
 *      si trascinano nell'ordine del TUO supermercato, e da li' in poi la
 *      lista e' il percorso;
 *   2. **quello che prendi scende in fondo** (Apple Promemoria dalla iOS 13,
 *      e ormai chiunque): davanti resta solo quello che manca;
 *   3. **un colpo d'occhio su quanto manca** — la barra di completamento, che
 *      su una lista lunga e' l'unica cosa che dice "ci siamo quasi";
 *   4. **un colore per corsia** (Bring!): scorrendo si riconosce la sezione
 *      prima di leggerla.
 *
 * Due cose le facciamo meglio, e sono quelle che nessuna di quelle app puo'
 * fare perche' non sa cosa mangi:
 *
 *   - **le quantita' non le scrivi tu**: escono dalla somma delle ricette
 *     assegnate ai sette giorni;
 *   - **la dispensa chiude il cerchio**. Finora era un elenco di tutti gli
 *     alimenti del piano con un campo numerico accanto — un modulo, e infatti
 *     nessuno lo compilava. Adesso "ne ho gia'" sta sulla riga della spesa,
 *     dove la domanda nasce, e a fine spesa quello che hai preso entra in
 *     dispensa con un tocco. Non si scala da sola mentre spunti i pasti — su
 *     quello il file di progetto e' netto, e ha ragione: un inventario che non
 *     torna e' peggio di nessun inventario — ma "ho comprato queste cose" e'
 *     un fatto dichiarato da te, non una deduzione.
 */
'use strict';

/* Le corsie, nell'ordine in cui le attraversi. Si tengono in
   `S.settings.corsie`: le categorie nuove finiscono in fondo, quelle sparite
   si ignorano, cosi' cambiando piano l'ordine non si rompe. */
function corsieOrdine(categorie) {
  S.settings.corsie ||= [];
  const noto = S.settings.corsie.filter(c => categorie.includes(c));
  const nuove = categorie.filter(c => !noto.includes(c)).sort();
  return noto.concat(nuove);
}
function corsieSalva(ordine) {
  S.settings.corsie = ordine.slice();
  save();
}

/* Un colore per corsia, stabile: deriva dal nome, cosi' la stessa categoria ha
   sempre la stessa tinta e non serve una tabella da mantenere quando il piano
   ne introduce una nuova. Sono tonalita' e non colori del tema: qui servono a
   distinguere, non a dire "bene" o "male". */
function corsiaTinta(nome) {
  let h = 0;
  for (const ch of String(nome)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 42% 45%)`;
}

/* Arrotonda prima di decidere quanti decimali mostrare: 110 grammi che
   arrivano da un prodotto fra due numeri in virgola mobile valgono
   110.00000000000001, e uscivano come "110,0 g" — un decimale che non
   significa niente su una quantita' da mettere nel carrello. */
const spesaQta = (n0, u) => {
  const n = Math.round((+n0 || 0) * 10) / 10;
  return u === 'ml'
    ? (n >= 1000 ? `${nf(n / 1000, 2)} L` : `${nf(n)} ml`)
    : n >= 1000 ? `${nf(n / 1000, 2)} kg` : `${nf(n, n % 1 ? 1 : 0)} g`;
};

/**
 * Tutto quello che serve alla pagina, in una passata.
 * `voci` e' piatto e ordinato per corsia: la vista non deve piu' incrociare
 * due strutture per sapere cosa mostrare.
 */
function spesaStato() {
  const byCat = typeof fabbisognoNetto === 'function' ? fabbisognoNetto() : shoppingList();
  const cats = corsieOrdine(Object.keys(byCat));
  const voci = [];
  for (const cat of cats)
    for (const it of (byCat[cat] || [])) {
      const compra = it.compra ?? it.q;
      voci.push({ ...it, cat, compra, preso: !!S.spesa[it.nome] });
    }
  const daPrendere = voci.filter(x => x.compra > 0);
  const presi = daPrendere.filter(x => x.preso);
  const coperte = voci.filter(x => x.compra <= 0);
  return {
    cats, voci, daPrendere, presi, coperte,
    fatto: presi.length, totale: daPrendere.length,
    quota: daPrendere.length ? presi.length / daPrendere.length : 0
  };
}

/* ============================================================== la pagina */
function viewSpesa(v) {
  if (!usaPiano()) {
    const c = el('div', 'card');
    c.append(el('div', 'eyebrow', 'Serve il piano'));
    c.append(el('div', 'muted',
      'La lista della spesa e\' la somma degli ingredienti delle ricette assegnate ai sette '
      + 'giorni. Con il piano alimentare spento quelle ricette non esistono, e non c\'e\' niente '
      + 'da sommare.'));
    const b = el('button', 'btn wide pri', 'Accendi il piano alimentare');
    b.style.marginTop = '10px';
    b.onclick = () => { if (typeof pianoTab !== 'undefined') pianoTab = 'profilo';
      location.hash = '#/piano'; };
    c.append(b);
    v.append(c);
    return;
  }

  const st = spesaStato();
  if (!st.voci.length) {
    v.append(el('div', 'card flat',
      `<div class="eyebrow">Niente da comprare</div>
       <div class="muted">Nessuna ricetta e' assegnata ai sette giorni, quindi
       non c'e' niente da sommare. Si assegnano in Piano, ultimo passo.</div>`));
    return;
  }

  /* --- la testata: quanto manca, in una barra --- */
  v.append(cardSpesaTesta(st));

  /* --- le corsie --- */
  const daFare = st.daPrendere.filter(x => !x.preso);
  const perCorsia = new Map();
  for (const x of daFare) {
    if (!perCorsia.has(x.cat)) perCorsia.set(x.cat, []);
    perCorsia.get(x.cat).push(x);
  }

  if (!daFare.length) {
    v.append(el('div', 'card sp-fine',
      `<div class="eyebrow">Carrello pieno</div>
       <div class="muted">Hai preso tutto quello che serviva. Qui sotto puoi
       far entrare la spesa in dispensa: la prossima lista terra' conto di
       quello che hai in casa.</div>`));
  }

  for (const [cat, items] of perCorsia) {
    const c = el('div', 'card sp-cor');
    c.style.setProperty('--tinta', corsiaTinta(cat));
    const h = el('div', 'sp-h');
    h.innerHTML = `<span class="dot"></span>
      <span class="nm">${esc(cat[0].toUpperCase() + cat.slice(1))}</span>
      <span class="n">${items.length}</span>`;
    c.append(h);
    for (const it of items) c.append(rigaSpesa(it));
    v.append(c);
  }

  /* --- quello che hai gia' preso, in fondo e chiuso --- */
  if (st.presi.length) v.append(cardPresi(st));

  /* --- quello che la dispensa copre gia' --- */
  if (st.coperte.length) v.append(cardCoperte(st));

  v.append(cardCorsie(st));
}

/** Testata: la barra, i due numeri, e cosa fare quando hai finito. */
function cardSpesaTesta(st) {
  const c = el('div', 'card sp-testa');
  c.append(el('div', 'eyebrow', 'Lista della spesa'));
  const r = el('div', 'sp-num');
  r.innerHTML = `<div><b>${st.totale - st.fatto}</b><span>da prendere</span></div>
    <div><b>${st.fatto}</b><span>nel carrello</span></div>`
    + (st.coperte.length
      ? `<div><b>${st.coperte.length}</b><span>gia' in casa</span></div>` : '');
  c.append(r);

  const barra = el('div', 'sp-bar');
  const i = el('i');
  i.style.width = (st.quota * 100).toFixed(1) + '%';
  barra.append(i);
  c.append(barra);
  c.append(el('div', 'sp-sotto',
    st.totale ? `${st.fatto} di ${st.totale} · settimana intera, quantita' dalle ricette`
      : 'La dispensa copre tutto quello che serviva.'));

  /* Il cerchio si chiude qui: quello che hai preso entra in dispensa, e la
     lista della prossima settimana lo sottrae. Non e' una deduzione — e' un
     fatto che dichiari tu, ed e' la differenza fra questo e uno scarico
     automatico mentre spunti le ricette, che questo progetto non vuole. */
  if (st.fatto) {
    const b = el('button', 'btn wide pri');
    b.style.marginTop = '12px';
    b.textContent = `Ho comprato ${st.fatto === 1 ? 'questa cosa' : 'queste ' + st.fatto + ' cose'}`;
    b.onclick = () => sheetFineSpesa(st);
    c.append(b);
  }
  return c;
}

/** Una riga della lista: spunta, nome, quanto, e "ne ho gia'". */
function rigaSpesa(it) {
  const row = el('div', 'sp-r' + (it.preso ? ' preso' : ''));
  const box = el('button', 'sp-box');
  box.setAttribute('aria-label', (it.preso ? 'Togli dal carrello ' : 'Metti nel carrello ') + it.nome);
  box.setAttribute('aria-pressed', String(it.preso));
  if (typeof icona === 'function') box.append(icona('check', { size: 15 }));
  const tocca = () => {
    S.spesa[it.nome] = !it.preso;
    if (!S.spesa[it.nome]) delete S.spesa[it.nome];
    save(); route();
  };
  box.onclick = tocca;
  row.append(box);

  const nm = el('div', 'grow');
  nm.innerHTML = `<span class="n">${esc(it.nome)}</span>`
    + (it.ho > 0
      ? `<span class="d">serve ${spesaQta(it.q, it.unita)} · in casa ${spesaQta(it.ho, it.unita)}</span>`
      : '');
  nm.onclick = tocca;
  row.append(nm);
  row.append(el('span', 'sp-q', spesaQta(it.compra, it.unita)));

  /* "Ne ho gia'" sta qui, sulla riga, e non in un modulo a parte: e' qui che
     la domanda nasce — davanti allo scaffale, o davanti alla lista prima di
     uscire. Il vecchio foglio chiedeva di scorrere quarantaquattro alimenti
     con un campo numerico ciascuno, ed era il motivo per cui restava vuoto. */
  const casa = el('button', 'sp-casa');
  casa.title = 'Quanto ne hai gia\' in casa';
  casa.setAttribute('aria-label', 'Quanto ne hai gia\' in casa di ' + it.nome);
  if (typeof icona === 'function') casa.append(icona('home', { size: 16 }));
  casa.onclick = e => { e.stopPropagation(); sheetHoInCasa(it); };
  row.append(casa);
  return row;
}

/** Il blocco chiuso di quello che e' gia' nel carrello. */
function cardPresi(st) {
  const c = el('div', 'card sp-presi');
  const h = el('button', 'sp-h apri');
  const aperto = { v: false };
  const lista = el('div');
  lista.hidden = true;
  const dipingi = () => {
    h.innerHTML = `<span class="dot fatto"></span>
      <span class="nm">Nel carrello</span>
      <span class="n">${st.presi.length}</span>
      <span class="go">${aperto.v ? '&and;' : '&or;'}</span>`;
    lista.hidden = !aperto.v;
  };
  h.onclick = () => { aperto.v = !aperto.v; dipingi(); };
  for (const it of st.presi) lista.append(rigaSpesa(it));
  dipingi();
  c.append(h, lista);
  return c;
}

/** Quello che non serve comprare perche' e' gia' in dispensa. */
function cardCoperte(st) {
  const c = el('div', 'card flat sp-cop');
  c.append(el('div', 'eyebrow', 'Gia\' in casa, non serve comprarlo'));
  const l = el('div', 'sp-cop-l');
  for (const it of st.coperte)
    l.append(el('span', 'tag',
      `${esc(it.nome)} <em>${spesaQta(it.ho, it.unita)}</em>`));
  c.append(l);
  c.append(el('p', 'note',
    'La dispensa copre gia\' il fabbisogno della settimana per queste voci. '
    + 'Si aggiorna dalla riga della spesa o dalla scheda della dispensa.'));
  return c;
}

/**
 * L'ordine delle corsie.
 *
 * E' la cosa che rende una lista camminabile, e nessun algoritmo puo'
 * indovinarla: il percorso dentro un negozio lo conosce solo chi ci va. Si
 * trascina una volta e resta. La maniglia e' un elemento a se' — col dito,
 * se il trascinamento partisse da tutta la riga, non si potrebbe piu'
 * scorrere la pagina.
 */
function cardCorsie(st) {
  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'L\'ordine del tuo negozio'));
  c.lastChild.style.marginTop = '0';
  c.append(el('p', 'muted',
    'Metti le corsie nell\'ordine in cui le attraversi: da li\' in poi la '
    + 'lista e\' il percorso, e non si torna indietro per una cosa dimenticata.'));
  const ordine = st.cats.slice();
  const box = el('div');
  const disegna = () => {
    box.innerHTML = '';
    const righe = ordine.map((cat, i) => {
      const r = el('div', 'riga-slot sp-ord');
      r.style.setProperty('--tinta', corsiaTinta(cat));
      r.innerHTML = `<span class="drag-h" aria-hidden="true">⋮⋮</span>
        <span class="dot"></span>
        <span class="grow">${esc(cat[0].toUpperCase() + cat.slice(1))}</span>
        <span class="n">${i + 1}</span>`;
      box.append(r);
      return r;
    });
    if (typeof trascinaRighe === 'function')
      trascinaRighe(righe, () => true, (da, a) => {
        ordine.splice(a, 0, ordine.splice(da, 1)[0]);
        corsieSalva(ordine);
        disegna();
      });
  };
  disegna();
  c.append(box);
  c.append(el('p', 'note',
    'Vale per tutti i negozi allo stesso modo: l\'app ne conosce uno solo, '
    + 'ed e\' una semplificazione dichiarata. Le categorie nuove finiscono in '
    + 'fondo, quelle che spariscono dal piano non lasciano buchi.'));
  return c;
}

/* ======================================================= i due fogli */

/** Quanto ne hai in casa: un numero solo, dove serve. */
function sheetHoInCasa(it) {
  const disp = dispensa();
  const w = el('div');
  w.append(el('div', 'eyebrow', esc(it.cat)));
  w.append(el('h2', 'sec', esc(it.nome)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    `Per la settimana ne servono <strong>${spesaQta(it.q, it.unita)}</strong>. `
    + 'Quello che hai gia\' in casa viene sottratto, e nella lista resta solo '
    + 'la differenza.'));

  const stato = { v: +disp[it.nome] || 0 };
  const grande = el('div', 'ho-v');
  const riga = el('div', 'ho-r');
  const meno = el('button', 'stp big', '−');
  const piu = el('button', 'stp big', '+');
  const passo = it.unita === 'ml' ? 100 : 50;
  const mostra = () => {
    grande.innerHTML = `<span class="n">${nf(stato.v, stato.v % 1 ? 1 : 0)}</span>`
      + `<em>${esc(it.unita)}</em>`;
    resta.textContent = stato.v >= it.q
      ? 'Basta e avanza: non finisce in lista.'
      : `Da comprare: ${spesaQta(Math.max(0, it.q - stato.v), it.unita)}.`;
  };
  meno.onclick = () => { stato.v = Math.max(0, stato.v - passo); mostra(); };
  piu.onclick = () => { stato.v += passo; mostra(); };
  riga.append(meno, grande, piu);
  w.append(riga);
  const resta = el('div', 'ho-resta');
  w.append(resta);
  mostra();

  const rapide = el('div', 'seg chips');
  for (const q of [0, Math.round(it.q / 2), Math.round(it.q), Math.round(it.q * 2)]) {
    if (q > 0 && rapide.querySelector(`[data-q="${q}"]`)) continue;
    const b = el('button', null, q === 0 ? 'niente' : spesaQta(q, it.unita));
    b.dataset.q = q;
    b.onclick = () => { stato.v = q; mostra(); };
    rapide.append(b);
  }
  w.append(rapide);

  const ok = el('button', 'btn wide pri', 'Salva');
  ok.onclick = () => {
    if (stato.v > 0) disp[it.nome] = stato.v; else delete disp[it.nome];
    save(); closeSheet(); route();
  };
  w.append(ok);
  const ann = el('button', 'btn wide', 'Annulla');
  ann.style.marginTop = '8px';
  ann.onclick = () => { closeSheet(); route(); };
  w.append(ann);
  sheet(w);
}

/** Fine spesa: quello che hai preso entra in dispensa. */
function sheetFineSpesa(st) {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Fine spesa'));
  w.append(el('h2', 'sec', `${st.fatto} ${st.fatto === 1 ? 'cosa presa' : 'cose prese'}`));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Quello che hai comprato puo\' entrare in dispensa: la lista della '
    + 'prossima settimana lo sottrae da quello che serve. Non succede da solo '
    + 'mentre spunti le ricette — quello sarebbe un inventario che non torna — '
    + 'ma questo lo stai dichiarando tu.'));

  const l = el('div', 'sp-cop-l');
  for (const it of st.presi)
    l.append(el('span', 'tag',
      `${esc(it.nome)} <em>+${spesaQta(it.compra, it.unita)}</em>`));
  w.append(l);

  const ok = el('button', 'btn wide pri', 'Mettila in dispensa e svuota la lista');
  ok.onclick = () => {
    const disp = dispensa();
    for (const it of st.presi)
      disp[it.nome] = Math.round(((+disp[it.nome] || 0) + it.compra) * 10) / 10;
    S.spesa = {};
    save(); closeSheet(); route();
    toast('In dispensa, e lista pulita');
  };
  w.append(ok);

  const solo = el('button', 'btn wide', 'Svuota solo la lista');
  solo.style.marginTop = '8px';
  solo.onclick = () => { S.spesa = {}; save(); closeSheet(); route(); toast('Lista azzerata'); };
  w.append(solo);

  const ann = el('button', 'btn wide', 'Annulla');
  ann.style.marginTop = '8px';
  ann.onclick = () => { closeSheet(); route(); };
  w.append(ann);
  sheet(w);
}

/* ========================================================== la dispensa
 *
 * Era un foglio con dentro tutti gli alimenti del piano e un campo numerico
 * per ciascuno: un modulo di quarantaquattro righe da compilare, e infatti
 * restava vuoto. Adesso mostra **solo quello che hai**, e la domanda "quanto
 * ne ho" si risponde dalla riga della spesa, dove nasce.
 *
 * Il numero che aggiunge e' **per quanto ti basta**: le stesse quantita' che
 * fanno la lista dicono anche quante settimane copre quello che hai in casa.
 * E' un conto che nessuna app di dispensa fa, perche' per farlo bisogna
 * sapere cosa mangi.
 */
function viewDispensa(v) {
  const disp = dispensa();
  const nomi = Object.keys(disp).filter(n => disp[n] > 0).sort();
  const serve = {};
  for (const items of Object.values(shoppingList()))
    for (const it of items) serve[it.nome] = it;

  const c = el('div', 'card sp-testa');
  c.append(el('div', 'eyebrow', 'Dispensa'));
  const tot = nomi.length;
  const coperti = nomi.filter(n => serve[n] && disp[n] >= serve[n].q).length;
  const r = el('div', 'sp-num');
  r.innerHTML = `<div><b>${tot}</b><span>voci in casa</span></div>`
    + (tot ? `<div><b>${coperti}</b><span>coprono la settimana</span></div>` : '');
  c.append(r);
  c.append(el('div', 'sp-sotto', tot
    ? 'Quello che c\'e\' qui viene sottratto dalla lista della spesa.'
    : 'Vuota: la lista della spesa chiede tutto quello che serve.'));
  v.append(c);

  if (!tot) {
    v.append(el('div', 'card flat',
      `<div class="eyebrow">Come si riempie</div>
       <div class="muted">Non c'e' un modulo da compilare. Sulla lista della
       spesa ogni riga ha l'icona della casa: tocchi, dici quanto ne hai, e
       quella quantita' sparisce da quello che devi comprare. Oppure a fine
       spesa fai entrare in dispensa quello che hai messo nel carrello.</div>`));
    const b = el('button', 'btn wide pri', 'Vai alla lista della spesa');
    b.style.marginTop = '10px';
    b.onclick = () => { location.hash = '#/spesa'; };
    v.append(b);
    return;
  }

  const lista = el('div', 'card');
  lista.append(el('h2', 'sec', 'Cosa hai in casa'));
  lista.lastChild.style.marginTop = '0';
  for (const n of nomi) {
    const it = serve[n];
    const unita = it?.unita || D.alimenti[n]?.unita || 'g';
    const q = disp[n];
    // quante settimane copre: il fabbisogno settimanale e' gia' calcolato, e
    // dividerlo e' l'unica cosa che mancava per rendere utile questo numero
    const sett = it && it.q > 0 ? q / it.q : null;
    /* La barra sta su una riga sua e non dentro il nome: infilata nella
       colonna di sinistra passava sotto la quantita' a destra, e due cose
       sovrapposte in un elenco sembrano un errore di impaginazione. */
    const row = el('div', 'dp-r');
    row.innerHTML = `<span class="grow"><span class="n">${esc(n)}</span>
        <span class="d">${sett == null ? 'non serve in questa settimana'
          : sett >= 1 ? `copre ${nf(sett, sett >= 10 ? 0 : 1)} settimane`
          : `copre ${nf(sett * 7, 0)} giorni su 7`}</span></span>
      <span class="q">${spesaQta(q, unita)}</span>`;
    const barra = el('span', 'dp-bar');
    const i = el('i');
    i.style.width = Math.min(100, (sett || 0) * 100).toFixed(0) + '%';
    if (sett != null && sett >= 1) i.classList.add('pieno');
    barra.append(i);
    row.append(barra);
    row.onclick = () => sheetHoInCasa(it || { nome: n, q: 0, unita, cat: 'dispensa', ho: q });
    lista.append(row);
  }
  v.append(lista);

  const b = el('button', 'btn wide', 'Svuota la dispensa');
  b.onclick = () => {
    if (!confirm('Togliere tutte le ' + tot + ' voci dalla dispensa?')) return;
    S.dispensa = {}; save(); route(); toast('Dispensa svuotata');
  };
  v.append(b);
  v.append(el('p', 'note',
    'La dispensa non si scala da sola mentre spunti le ricette, ed e\' una '
    + 'scelta: un inventario che non torna e\' peggio di nessun inventario. '
    + 'Si aggiorna quando lo dici tu — dalla riga della spesa o a fine spesa.'));
}
