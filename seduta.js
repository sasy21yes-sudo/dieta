/* La seduta guidata: un passo alla volta.
 *
 * `sheetDaScheda` e' un modulo con tutte le serie della scheda in una schermata
 * sola. Va benissimo a fine seduta o per correggere, ed e' esattamente la cosa
 * sbagliata da avere in mano mentre ti alleni: fra una serie e l'altra non
 * serve vedere quaranta caselle, serve sapere **cosa fare adesso** e quanto
 * manca prima della prossima.
 *
 * Quindi qui c'e' una carta sola: l'esercizio, la serie, il bersaglio, tre
 * numeri da confermare, e un bottone. Toccato quello, la serie e' scritta nel
 * registro — non in un buffer — e parte il recupero. Se l'app si chiude a
 * meta' seduta, quello che hai fatto e' gia' salvato: `s.guida` ricorda solo a
 * che punto eri.
 *
 * Tre cose che il modulo non sapeva fare e che qui vengono gratis:
 *
 * 1. **le superserie si fanno alternate.** Il modulo chiedeva tutte le serie di
 *    A1 e poi tutte quelle di A2, che e' l'ordine in cui si SCRIVONO, non
 *    quello in cui si FANNO. Qui l'ordine e' A1-1, A2-1, recupero, A1-2, A2-2:
 *    dentro la coppia non c'e' recupero, e il timer parte solo alla fine
 * 2. **il bersaglio della serie e' quello giusto**, non il range generico: in
 *    un piramidale 12-10-8 la seconda serie chiede 10, e lo dice
 * 3. **gli scarichi dello stripping hanno una casella ciascuno**, con le
 *    ripetizioni che la scheda si aspetta gia' scritte accanto
 */
'use strict';

/**
 * L'ordine vero della seduta.
 *
 * Le righe attaccate (superserie) formano un gruppo; dentro un giro si fa una
 * serie per riga, poi si ricomincia. Il numero di giri e' il massimo fra le
 * righe del gruppo — se una ne ha tre e l'altra due, l'ultimo giro ha una riga
 * sola, che e' quello che succede davvero in sala.
 */
function passiScheda(sc) {
  const righe = (sc.esercizi || []).filter(r => esercizio(r.ex));
  const et = etichetteScheda(sc.esercizi || []);
  const passi = [];
  let i = 0;
  while (i < (sc.esercizi || []).length) {
    // il gruppo: questa riga piu' tutte quelle attaccate dopo di lei
    let j = i + 1;
    while (j < sc.esercizi.length && sc.esercizi[j].superserie) j++;
    const gruppo = [];
    for (let x = i; x < j; x++) if (esercizio(sc.esercizi[x].ex)) gruppo.push(x);
    const giri = Math.max(1, ...gruppo.map(x => serieDiRiga(sc.esercizi[x])));
    for (let g = 0; g < giri; g++) {
      const dentro = gruppo.filter(x => g < serieDiRiga(sc.esercizi[x]));
      dentro.forEach((x, n) => {
        passi.push({
          ei: x, si: g, riga: sc.esercizi[x], et: et[x],
          // dentro una coppia il recupero non c'e': il timer parte sull'ultima
          recupero: n === dentro.length - 1,
          insieme: dentro.length > 1,
          prossimo: n < dentro.length - 1 ? sc.esercizi[dentro[n + 1]] : null
        });
      });
    }
    i = j;
  }
  void righe;
  return passi;
}

/** A che punto sei: l'indice del passo, o passi.length se hai finito. */
function passoCorrente(k, sc) {
  const s = P().sessioni[k];
  const n = passiScheda(sc).length;
  const i = s?.guida?.scheda === sc.id ? (s.guida.i || 0) : 0;
  return Math.max(0, Math.min(n, i));
}

/** Il carico da proporre: l'ultima volta, poi la scheda, poi niente. */
function caricoProposto(riga, k, si) {
  const prec = ultimoUso(riga.ex, k);
  const d = prec?.serie?.[si] ?? prec?.serie?.[prec.serie.length - 1];
  return d?.kg ?? riga.kg ?? null;
}

/* ------------------------------------------------------------- la schermata */
function sheetGuidata(k, schedaId) {
  const p = P(), sc = scheda(schedaId);
  if (!sc) return sheetSceltaModo(k);
  p.sessioni[k] ||= { nome: '', serie: [] };
  const s = p.sessioni[k];

  // una seduta gia' cominciata con un'altra scheda non si sovrascrive di
  // nascosto: sono serie vere, e chi le ha fatte deve poter dire di no
  if (s.serie.length && s.scheda && s.scheda !== sc.id) {
    if (!confirm(`Oggi hai gia' registrato ${s.serie.length} serie con "${
      s.nome || 'un\'altra scheda'}". Ricominciare con "${sc.nome}" le sostituisce.`))
      return sheetSceltaModo(k);
    s.serie = [];
  }
  const passi = passiScheda(sc);
  if (!s.guida || s.guida.scheda !== sc.id) {
    s.scheda = sc.id; s.nome = sc.nome;
    // chi ha gia' scritto delle serie a mano oggi non deve riscriverle: la
    // guida scrive un record per passo, quindi quante ne ha gia' e' anche a
    // che punto e'. E' una stima, ma l'alternativa e' ricominciare da capo
    s.guida = { scheda: sc.id, i: Math.min(s.serie.length, passi.length) };
    save();
  }
  const idx = passoCorrente(k, sc);
  const w = el('div', 'guida');

  /* --- finita --- */
  if (idx >= passi.length) {
    // il recupero dell'ultima serie non serve piu' a niente: non c'e' una
    // serie dopo da aspettare, e una barra che conta sulla schermata di fine
    // chiede di stare fermi per un lavoro che non arrivera'
    fermaRecupero();
    w.append(el('div', 'eyebrow', esc(sc.nome)));
    w.append(el('h2', 'sec', 'Seduta finita'));
    w.lastChild.style.marginTop = '0';
    w.append(el('p', 'muted',
      `${s.serie.length} ${s.serie.length === 1 ? 'serie registrata' : 'serie registrate'}. `
      + 'Sono gia\' salvate: non c\'e\' niente da confermare.'));
    w.append(riepilogoGuida(k));
    const fine = el('button', 'btn wide pri', 'Chiudi');
    fine.onclick = () => {
      delete s.guida; save(); fermaRecupero(); closeSheet(); route();
      toast(`${s.serie.length} serie registrate`);
    };
    w.append(fine);
    const rif = el('button', 'btn wide', 'Correggi qualcosa a mano');
    rif.style.marginTop = '8px';
    rif.onclick = () => { delete s.guida; save(); sheetDaScheda(k, sc.id); };
    w.append(rif);
    return sheet(w);
  }

  const passo = passi[idx];
  const riga = passo.riga;
  const ex = esercizio(riga.ex);
  const scar = scarichiDiRiga(riga);
  const rp = usaRestPause(sc, riga);
  const bers = bersaglioTesto(riga, passo.si);
  const kgProp = caricoProposto(riga, k, passo.si);
  const pp = prossimoPasso(riga.ex);

  /* --- dove sei --- */
  w.append(el('div', 'eyebrow', `${esc(sc.nome)} · passo ${idx + 1} di ${passi.length}`));
  const barra = el('div', 'gd-prog');
  barra.append(el('i', null, ''));
  barra.firstChild.style.width = (100 * idx / passi.length).toFixed(1) + '%';
  w.append(barra);

  w.append(el('h2', 'sec', esc(ex.nome)));
  w.lastChild.style.marginTop = '6px';

  const sotto = [`<span class="sk-g">${esc(passo.et.testo)}</span>`,
    `serie <b>${passo.si + 1}</b> di ${serieDiRiga(riga)}`,
    `bersaglio <b>${esc(bers)}</b> ${+bers === 1 ? 'ripetizione' : 'ripetizioni'}`];
  if (kgProp != null) sotto.push(`${nf(kgProp, 1)} kg l'ultima volta`);
  // quanto durera' il recupero si sa prima di cominciare la serie, non dopo:
  // e' meta' della decisione su come farla
  if (passo.recupero && idx + 1 < passi.length)
    sotto.push(`recupero <b>${recTesto(recupeoConsigliato(ex, riga, sc))}</b>`);
  w.append(el('div', 'read', sotto.map(x => `<span>${x}</span>`).join('')));

  const av = typeof avvisoAcciacco === 'function' ? avvisoAcciacco(riga.ex, k) : null;
  if (av) w.append(av);

  /* --- cosa chiede questa serie --- */
  if (riga.tecnica === 'stripping')
    w.append(el('div', 'gd-tec',
      `<strong>Stripping</strong> — arrivi a ${esc(bers)}, poi cali subito il peso `
      + `e continui: ${scar.map(x => x == null ? 'uno scarico'
          : x + ' ripetizioni').join(', poi ')}. Senza recupero in mezzo.`));
  else if (riga.tecnica === 'piramidale')
    w.append(el('div', 'gd-tec',
      `<strong>Piramidale</strong> — questa serie chiede <b>${esc(bers)}</b> ripetizioni`
      + (riga.piram?.length ? ` (l'elenco e' ${esc(listaTesto(riga.piram))})` : '')
      + '. Il carico sale a ogni serie: mettine un po\' piu\' della volta prima.'));
  else if (rp)
    w.append(el('div', 'gd-tec',
      `<strong>Rest-pause ×${ripartenze(riga)}</strong> — finita la serie, 15-20 `
      + 'secondi di pausa e riprendi, per '
      + `${ripartenze(riga)} ${ripartenze(riga) === 1 ? 'volta' : 'volte'}. `
      + 'Scrivi il <b>totale</b> delle ripetizioni, ripartenze comprese.'));
  if (passo.insieme && passo.prossimo)
    w.append(el('div', 'gd-tec ss',
      `<strong>Superserie</strong> — appena finita questa vai subito su `
      + `<b>${esc(esercizio(passo.prossimo.ex)?.nome || '')}</b>, senza recupero.`));
  if (pp && passo.si === 0) w.append(el('div', 'hint', esc(pp.testo)));

  /* --- i tre numeri ---
     Il kg arriva gia' scritto perche' e' quello che hai messo sul bilanciere e
     quasi sempre e' lo stesso della volta prima. Le ripetizioni no: quelle
     sono l'unica cosa che la serie ti ha detto, e il bersaglio sta nel
     segnaposto proprio perche' non venga scambiato per una risposta. Un
     campo prevompilato col bersaglio registrerebbe quello che DOVEVI fare. */
  const g = el('div', 'gd-in');
  g.innerHTML = `<div class="field"><label>kg</label>
      <input type="text" inputmode="decimal" id="gd-kg" value="${kgProp ?? ''}"></div>
    <div class="field"><label>rip fatte</label>
      <input type="text" inputmode="numeric" id="gd-rp" placeholder="${esc(bers)}"></div>
    <div class="field"><label>RIR</label>
      <input type="text" inputmode="numeric" id="gd-rr" value="2"></div>`;
  w.append(g);

  /* Le ripetizioni si toccano, non si scrivono: aprire la tastiera con le mani
     sudate per un numero fra 5 e 15 e' il modo piu' lento di dire "otto". Le
     pastiglie stanno intorno al bersaglio, che e' dove finiscono quasi tutte
     le serie; il campo resta li' per i casi fuori scala. */
  const centro = parseNum(bers) || riga.reps || 8;
  const vicini = [];
  for (let n = Math.max(1, centro - 3); n <= centro + 3; n++) vicini.push(n);
  const chip = el('div', 'seg chips gd-rip');
  const segna = n => {
    $('#gd-rp').value = n;
    [...chip.children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.n === n));
  };
  for (const n of vicini) {
    const b = el('button', null, String(n));
    b.dataset.n = n;
    b.onclick = () => segna(n);
    chip.append(b);
  }
  w.append(chip);
  w.append(el('div', 'hint',
    'Quante ne hai fatte davvero, non quante ne chiedeva la scheda: e\' da '
    + 'quel numero che escono il massimale stimato e la progressione.'));

  const drops = [];
  if (scar.length) {
    const cd = el('div', 'gd-drop');
    cd.append(el('div', 'lab', 'Scarichi'));
    scar.forEach((r2, i2) => {
      const f = el('div', 'gd-in due');
      f.innerHTML = `<div class="field"><label>kg</label>
          <input type="text" inputmode="decimal" id="gd-dk-${i2}"></div>
        <div class="field"><label>rip</label>
          <input type="text" inputmode="numeric" id="gd-dr-${i2}"
            placeholder="${r2 ?? ''}"></div>`;
      cd.append(f);
      drops.push(i2);
    });
    cd.append(el('div', 'hint',
      'Lascia vuoto quello che non hai fatto. Ogni scarico conta mezza serie '
      + 'nel volume: e\' lavoro vero, ma piu\' corto.'));
    w.append(cd);
  }

  if (rp) {
    const b20 = el('button', 'btn wide', 'Pausa di 20 secondi');
    b20.style.marginTop = '4px';
    b20.onclick = () => avviaRecupero(20, 'rest-pause · ' + ex.nome);
    w.append(b20);
  }

  /* --- il bottone che fa tutto --- */
  const fatto = el('button', 'btn wide pri gd-ok');
  fatto.textContent = passo.recupero ? 'Serie completata' : 'Fatta — vai al prossimo';
  fatto.onclick = () => {
    /* Senza ripetizioni non si registra. Prima il bersaglio faceva da
       ripiego, e questo significava scrivere nel registro quello che la
       scheda chiedeva invece di quello che e' successo — proprio il numero da
       cui escono massimale stimato, doppia progressione e verdetto sulla
       scheda. Se la serie non l'hai fatta c'e' "Salta questa serie". */
    const reps = parseNum($('#gd-rp').value);
    if (!(reps > 0)) {
      toast('Quante ripetizioni hai fatto?');
      $('#gd-rp').focus();
      return;
    }
    const rec = { ex: riga.ex,
      kg: parseNum($('#gd-kg').value) ?? 0,
      reps,
      rir: parseNum($('#gd-rr').value) ?? 2 };
    if (riga.tecnica && riga.tecnica !== 'normale') rec.tecnica = riga.tecnica;
    else if (rp) rec.tecnica = 'rest-pause';
    if (riga.superserie) rec.superserie = true;
    const dr = [];
    for (const i2 of drops) {
      const kg = parseNum(($('#gd-dk-' + i2) || {}).value);
      const rr = parseNum(($('#gd-dr-' + i2) || {}).value) ?? scar[i2];
      if (kg != null && rr > 0) dr.push({ kg, reps: rr });
    }
    if (dr.length) rec.drop = dr;
    s.serie.push(rec);
    s.guida = { scheda: sc.id, i: idx + 1 };
    s.scheda = sc.id; s.nome = sc.nome;
    if (typeof _ffCache !== 'undefined' && _ffCache.clear) _ffCache.clear();
    save();
    /* Dentro una superserie il recupero non c'e': si va di la' e basta.
       E dopo l'ultima serie della seduta nemmeno: non c'e' niente da
       recuperare, e una barra che conta sulla schermata "seduta finita"
       chiede di aspettare per una serie che non esiste. */
    if (passo.recupero && idx + 1 < passi.length) {
      const sec = recupeoConsigliato(ex, riga, sc);
      avviaRecupero(sec, ex.nome, true);
    }
    sheetGuidata(k, sc.id);
  };
  w.append(fatto);

  const salta = el('button', 'btn wide', 'Salta questa serie');
  salta.style.marginTop = '8px';
  salta.onclick = () => {
    s.guida = { scheda: sc.id, i: idx + 1 };
    save(); sheetGuidata(k, sc.id);
  };
  w.append(salta);

  if (idx > 0) {
    const ind = el('button', 'btn wide', 'Torna alla serie prima');
    ind.style.marginTop = '8px';
    ind.onclick = () => {
      // tornare indietro toglie l'ultima serie scritta: e' l'unico modo per
      // correggere un numero sbagliato senza uscire dalla guida
      if (s.serie.length) s.serie.pop();
      s.guida = { scheda: sc.id, i: idx - 1 };
      if (typeof _ffCache !== 'undefined' && _ffCache.clear) _ffCache.clear();
      save(); fermaRecupero(); sheetGuidata(k, sc.id);
    };
    w.append(ind);
  }

  const esci = el('button', 'btn wide', 'Metti in pausa e chiudi');
  esci.style.marginTop = '8px';
  esci.onclick = () => { closeSheet(); route();
    toast('Le serie fatte sono salvate: riaprendo la scheda riprendi da qui'); };
  w.append(esci);

  if (s.serie.length) w.append(riepilogoGuida(k));
  w.append(el('p', 'hint', RIR_SPIEGA));
  sheet(w);
}

/** Quello che hai gia' messo dentro, cosi' non serve fidarsi. */
function riepilogoGuida(k) {
  const s = P().sessioni[k];
  const c = el('div', 'gd-fatte');
  c.append(el('div', 'lab', `Fatte finora (${s.serie.length})`));
  const perEx = new Map();
  for (const x of s.serie) {
    const n = esercizio(x.ex)?.nome || x.ex;
    if (!perEx.has(n)) perEx.set(n, []);
    perEx.get(n).push(x);
  }
  for (const [nome, lista] of perEx) {
    const r = el('div', 'r');
    r.innerHTML = `<span class="n">${esc(nome)}</span>
      <span class="v">${lista.map(x => `${nf(x.kg, 1)}×${x.reps}${
        x.drop?.length ? '+' + x.drop.length : ''}`).join(' · ')}</span>`;
    c.append(r);
  }
  return c;
}
