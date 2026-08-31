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

/**
 * Il carico da proporre, in ordine di quanto e' vicino alla verita':
 *
 *   1. **la serie di prima, oggi.** Se hai appena fatto 60 kg su questo
 *      esercizio, la serie dopo si fa con 60 finche' non decidi altrimenti —
 *      e il caso normale e' proprio quello. Riscriverlo a ogni serie era il
 *      lavoro che l'app faceva fare a te
 *   2. la stessa serie dell'ultima volta che hai fatto quell'esercizio
 *   3. l'ultima serie dell'ultima volta
 *   4. il peso di partenza scritto nella scheda
 */
function caricoProposto(riga, k, si) {
  const oggi = (P().sessioni[k]?.serie || []).filter(x => x.ex === riga.ex);
  if (oggi.length) return oggi[oggi.length - 1].kg ?? riga.kg ?? null;
  const prec = ultimoUso(riga.ex, k);
  const d = prec?.serie?.[si] ?? prec?.serie?.[prec.serie.length - 1];
  return d?.kg ?? riga.kg ?? null;
}
/** Da dove viene, per poterlo scrivere invece di farlo indovinare. */
function fonteCarico(riga, k) {
  if ((P().sessioni[k]?.serie || []).some(x => x.ex === riga.ex)) return 'oggi';
  return ultimoUso(riga.ex, k) ? 'ultima' : riga.kg ? 'scheda' : null;
}

/* =========================================================== il recupero
 *
 * Prima era una barra che compariva sopra il foglio mentre la carta della
 * serie dopo era gia' li'. Sbagliato per come funziona una seduta: fra due
 * serie non c'e' niente da fare tranne aspettare, e mettere davanti i campi
 * della serie successiva significa chiedere di compilarli adesso — cioe'
 * prima di averla fatta.
 *
 * Quindi il recupero **e'** la schermata. Un anello che si svuota, quanto
 * manca al centro, e in fondo cosa arriva dopo. Quando scade non sparisce:
 * diventa rosso e conta all'insu', perche' quel tempo e' un dato.
 *
 * Lo stato vive dove viveva prima (`dieta.rec` in localStorage, via
 * `avviaRecupero`), quindi sopravvive a un ricaricamento e la barra torna a
 * fare il suo mestiere appena esci dal foglio: `recDisegna()` la nasconde
 * finche' l'anello e' sullo schermo, invece di disegnare due timer.
 */
function anelloRecupero(st) {
  const R = 62, C = 2 * Math.PI * R;
  const svg = mk('svg', { viewBox: '0 0 160 160', class: 'gd-anello',
                          'aria-hidden': 'true' });
  svg.append(mk('circle', { cx: 80, cy: 80, r: R, fill: 'none',
    stroke: 'var(--rule)', 'stroke-width': 11 }));
  const arco = mk('circle', { cx: 80, cy: 80, r: R, fill: 'none',
    stroke: 'var(--pine)', 'stroke-width': 11, 'stroke-linecap': 'round',
    'stroke-dasharray': C, 'stroke-dashoffset': 0,
    transform: 'rotate(-90 80 80)' });
  svg.append(arco);
  return { svg, arco, C };
}

function schermataRecupero(k, sc, passi, idx, s) {
  const st = recStato();
  const prossimo = passi[idx];
  const ex = esercizio(prossimo?.riga?.ex);
  const w = el('div', 'guida gd-rec');

  w.append(el('div', 'eyebrow', `${esc(sc.nome)} · recupero`));
  const { svg, arco, C } = anelloRecupero(st);
  const box = el('div', 'gd-ring');
  box.append(svg);
  const mid = el('div', 'mid');
  mid.innerHTML = `<div class="t">0:00</div><div class="l">recupero</div>`;
  box.append(mid);
  w.append(box);

  const mmss = n => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  let sonato = false;
  const dipingi = () => {
    const x = recStato();
    if (!x) return;
    const r = recRestanti(x);
    const oltre = r === 0 ? recOltre(x) : 0;
    mid.querySelector('.t').textContent = oltre ? '+' + mmss(oltre) : mmss(r);
    mid.querySelector('.l').textContent = oltre ? 'oltre il recupero'
      : 'su ' + recTesto(x.sec);
    arco.setAttribute('stroke-dashoffset', String(C * (1 - r / Math.max(1, x.sec))));
    arco.setAttribute('stroke', oltre ? 'var(--alert)' : 'var(--pine)');
    box.classList.toggle('oltre', !!oltre);
    if (!r && !sonato) { sonato = true; if (typeof recBip === 'function') recBip(); }
  };
  dipingi();
  const tick = setInterval(() => {
    if (!document.body.contains(box)) { clearInterval(tick); return; }
    dipingi();
  }, 250);

  /* i due bottoni, che qui sono grandi: si toccano col dorso della mano */
  const riga = el('div', 'gd-piu');
  for (const d of [-30, 30]) {
    const b = el('button', 'btn');
    b.textContent = (d > 0 ? '+' : '−') + Math.abs(d) + '″';
    b.onclick = () => { spostaRecupero(d); sonato = recRestanti(recStato()) === 0; dipingi(); };
    riga.append(b);
  }
  w.append(riga);

  /* cosa arriva dopo: e' l'unica cosa da sapere mentre aspetti */
  if (ex) {
    const bers = bersaglioTesto(prossimo.riga, prossimo.si);
    w.append(el('div', 'gd-poi',
      `<span class="l">poi</span><span class="n">${esc(ex.nome)}</span>
       <span class="d">serie ${prossimo.si + 1} di ${serieDiRiga(prossimo.riga)}
       · bersaglio ${esc(bers)}</span>`));
  }

  const vai = el('button', 'btn wide pri gd-ok', 'Recupero finito, vai');
  vai.onclick = () => {
    chiudiRecupero(k, s);
    sheetGuidata(k, sc.id);
  };
  w.append(vai);

  const esci = el('button', 'btn wide', 'Metti in pausa e chiudi');
  esci.style.marginTop = '8px';
  esci.onclick = () => { closeSheet(); route();
    toast('Il recupero continua nella barra in basso'); };
  w.append(esci);

  w.append(el('p', 'note',
    'Il tempo che passa qui viene registrato sulla serie appena fatta: e\' il '
    + 'recupero vero, non quello previsto, ed e\' quello che dice se una seduta '
    + 'e\' stata densa o lunga.'));
  return w;
}

/**
 * Chiude il recupero e ne scrive la durata VERA sulla serie appena fatta.
 *
 * Non su quella che sta per arrivare: il recupero appartiene alla serie che
 * lo ha reso necessario. Sopra l'ora non si registra niente — quello non e'
 * un recupero, e' il telefono lasciato aperto sul tavolo.
 */
function chiudiRecupero(k, s) {
  const st = recStato();
  if (st) {
    const vero = Math.round((Date.now() - st.t0) / 1000);
    const ultima = s.serie[s.serie.length - 1];
    if (ultima && vero > 0 && vero < 3600) ultima.rec_s = vero;
  }
  if (s.guida) delete s.guida.attesa;
  fermaRecupero();
  save();
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

  /* Se c'e' un recupero in corso, la schermata e' quella: la serie dopo si
     compila quando si va a farla, non mentre si aspetta. */
  if (s.guida?.attesa && recStato() && idx < passi.length)
    return sheet(schermataRecupero(k, sc, passi, idx, s));
  // un recupero segnato ma senza piu' stato (ricaricato, o chiuso a mano):
  // la giornata riprende dalla serie, non resta appesa
  if (s.guida?.attesa) { delete s.guida.attesa; save(); }

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
  if (kgProp != null) {
    const fc = fonteCarico(riga, k);
    sotto.push(`${nf(kgProp, 1)} kg ${fc === 'oggi' ? 'la serie prima'
      : fc === 'ultima' ? "l'ultima volta" : 'da scheda'}`);
  }
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
    scordaFatica();
    save();
    /* Dentro una superserie il recupero non c'e': si va di la' e basta.
       E dopo l'ultima serie della seduta nemmeno: non c'e' niente da
       recuperare, e una barra che conta sulla schermata "seduta finita"
       chiede di aspettare per una serie che non esiste. */
    if (passo.recupero && idx + 1 < passi.length) {
      const sec = recupeoConsigliato(ex, riga, sc);
      avviaRecupero(sec, ex.nome, true);
      s.guida.attesa = 1;
      save();
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
      delete s.guida.attesa;
      scordaFatica();
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


/* ===================================================== il resoconto di una seduta
 *
 * Non un voto: i numeri di quella giornata messi accanto a quelli che l'app
 * ha gia'. E' un motore che non ne inventa nessuno di suo — chiede a quelli
 * che ci sono, che e' il motivo per cui i conti tornano con la mappa
 * muscolare, con i progressi e col resoconto in PDF:
 *
 *   serieEquivalenti / tonnellaggioSerie  quanto vale una serie, scarichi compresi
 *   volumeMuscoli                         dove e' finito il lavoro
 *   e1rm / e1rmPerSeduta                  se qualcosa non era mai stato fatto
 *   formaFatica                           su che gambe ci sei arrivato
 *   prossimoPasso                         cosa chiede la prossima volta
 *
 * Il confronto e' con le **sedute confrontabili**: quelle fatte con la stessa
 * scheda se ce n'e' una, tutte le altre altrimenti. Confrontare una giornata
 * di gambe con la media di tutto direbbe soltanto che le gambe pesano piu'
 * delle braccia.
 */
function resocontoSeduta(k) {
  const s = P().sessioni[k];
  if (!s || !(s.serie || []).length) return null;
  const serie = s.serie;

  const nSerie = serie.reduce((a, x) => a + serieEquivalenti(x), 0);
  const tonn = serie.reduce((a, x) => a + tonnellaggioSerie(x), 0);
  const reps = serie.reduce((a, x) => a + ripetizioniSerie(x), 0);
  const conRir = serie.filter(x => x.rir != null);
  const rir = conRir.length ? conRir.reduce((a, x) => a + (+x.rir || 0), 0) / conRir.length : null;
  const scarichi = serie.reduce((a, x) => a + (x.drop?.length || 0), 0);

  /* per esercizio, nell'ordine in cui li hai fatti */
  const ordine = [];
  const perEx = new Map();
  for (const x of serie) {
    if (!perEx.has(x.ex)) { perEx.set(x.ex, { ex: x.ex, n: 0, tonn: 0, top: 0 }); ordine.push(x.ex); }
    const v = perEx.get(x.ex);
    v.n += serieEquivalenti(x);
    v.tonn += tonnellaggioSerie(x);
    v.top = Math.max(v.top, e1rm(x.kg, x.reps, x.rir));
  }
  const esercizi = ordine.map(id => ({ ...perEx.get(id),
    nome: esercizio(id)?.nome || id }));

  /* dove e' finito il lavoro: gli stessi numeri della mappa muscolare */
  const vol = typeof volumeMuscoli === 'function' ? volumeMuscoli([k]) : {};
  const muscoli_ = Object.entries(vol)
    .filter(([, v]) => v.serie > 0.4)
    .map(([id, v]) => ({ id, nome: muscolo(id)?.nome || id, serie: v.serie }))
    .sort((a, b) => b.serie - a.serie);

  /* quanto e' durata: i recuperi veri dove ci sono, piu' il tempo sotto il
     carico. Se i recuperi registrati sono meno di meta' non si scrive niente:
     una durata stimata su tre serie di dieci non e' una durata */
  const conRec = serie.filter(x => x.rec_s > 0);
  const durata = conRec.length >= Math.ceil(serie.length / 2)
    ? Math.round((conRec.reduce((a, x) => a + x.rec_s, 0) + reps * 3) / 60)
    : null;
  const recMedio = conRec.length
    ? Math.round(conRec.reduce((a, x) => a + x.rec_s, 0) / conRec.length) : null;

  /* le sedute confrontabili, prima di questa */
  const tutte = Object.keys(P().sessioni)
    .filter(x => x < k && (P().sessioni[x]?.serie || []).length);
  const stessaScheda = s.scheda
    ? tutte.filter(x => P().sessioni[x].scheda === s.scheda) : [];
  const base = (stessaScheda.length >= 2 ? stessaScheda : tutte).sort().reverse().slice(0, 6);
  const conf = base.length ? {
    n: base.length,
    // la frase deve reggere sia dopo "sopra" sia dopo "il confronto e' con"
    quali: stessaScheda.length >= 2
      ? 'la media di questa scheda' : 'la media delle ultime sedute',
    tonn: base.reduce((a, x) => a + P().sessioni[x].serie
      .reduce((b, y) => b + tonnellaggioSerie(y), 0), 0) / base.length,
    serie: base.reduce((a, x) => a + P().sessioni[x].serie
      .reduce((b, y) => b + serieEquivalenti(y), 0), 0) / base.length
  } : null;
  const scarto = conf && conf.tonn > 0 ? (tonn - conf.tonn) / conf.tonn * 100 : null;

  /* record stimati: un massimale che prima non c'era mai stato */
  const record = [];
  for (const e of esercizi) {
    if (!(e.top > 0)) continue;
    const storia = (typeof e1rmPerSeduta === 'function' ? e1rmPerSeduta(e.ex) : [])
      .filter(x => x.k < k);
    if (storia.length < 2) continue;          // con un punto solo non e' un record
    const prima = Math.max(...storia.map(x => x.v));
    if (e.top > prima * 1.005)
      record.push({ nome: e.nome, ora: e.top, prima, su: (e.top - prima) / prima * 100 });
  }

  /* su che gambe ci sei arrivato: la prontezza del muscolo piu' colpito,
     letta il giorno PRIMA — dopo la seduta la fatica e' quella della seduta */
  /* La soglia e' la stessa di statoMuscoli() — fatica sotto il 55% della
     forma — e non e' un caso: confrontare la prontezza di Banister con una
     soglia assoluta non direbbe niente, perche' con tau 42 contro 7 chi si
     allena ce l'ha sempre positiva. Vale il rapporto, e vale quello che gia'
     usa la mappa muscolare, o due schermate direbbero due cose diverse dello
     stesso muscolo lo stesso giorno. */
  let prontezza = null;
  if (muscoli_.length && typeof formaFatica === 'function') {
    const ff = formaFatica(muscoli_[0].id, addDays(k, -1));
    if (ff && ff.forma > 0.5)
      prontezza = { mus: muscoli_[0].nome,
                    pronto: ff.fatica < ff.forma * 0.55,
                    quota: ff.fatica / ff.forma };
  }

  /* il titolo: un fatto, non un voto */
  let titolo, perche;
  if (record.length) {
    titolo = record.length === 1 ? 'Un massimale stimato mai visto prima'
      : `${record.length} massimali stimati mai visti prima`;
    perche = 'Epley sulle ripetizioni piu' + '’ il RIR: e’ una stima, non una prova di forza.';
  } else if (scarto != null && scarto >= 12) {
    titolo = 'Piu’ lavoro del solito';
    perche = `${nf(Math.abs(scarto))}% di tonnellaggio sopra ${conf.quali}.`;
  } else if (scarto != null && scarto <= -20) {
    titolo = 'Piu’ leggera del solito';
    perche = `${nf(Math.abs(scarto))}% di tonnellaggio sotto ${conf.quali}. `
      + 'Non e’ un problema: una scarica serve, e la scheda non e’ un obbligo.';
  } else if (conf) {
    titolo = 'In linea con le ultime';
    perche = `Tonnellaggio a ${scarto >= 0 ? '+' : ''}${nf(scarto)}% su ${conf.quali}.`;
  } else {
    titolo = 'La prima con cui confrontare le prossime';
    perche = 'Da qui in poi questa seduta diventa il metro delle altre.';
  }

  return { k, s, serie, nSerie, tonn, reps, rir, scarichi, esercizi, muscoli: muscoli_,
           durata, recMedio, conf, scarto, record, prontezza, titolo, perche };
}

/**
 * La carta del resoconto. Corta di proposito: un titolo, quattro numeri e
 * due righe. Il dettaglio sta gia' in mappa muscolare, progressi e volume, e
 * ripeterlo qui vorrebbe dire mantenere due versioni degli stessi conti.
 */
function cardResoconto(r) {
  const c = el('div', 'card res');
  c.append(el('div', 'eyebrow', `${esc(r.k)}${r.s.nome ? ' · ' + esc(r.s.nome) : ''}`));
  c.append(el('h2', 'sec', esc(r.titolo)));
  c.lastChild.style.marginTop = '2px';
  c.append(el('p', 'muted', esc(r.perche)));

  const g = el('div', 'res-n');
  const cella = (v, l) => `<div><div class="v">${v}</div><div class="l">${l}</div></div>`;
  g.innerHTML = cella(nf(r.nSerie, r.nSerie % 1 ? 1 : 0), 'serie')
    + cella(nf(r.tonn), 'kg sollevati')
    + cella(r.rir == null ? '—' : nf(r.rir, 1), 'RIR medio')
    + cella(r.durata == null ? '—' : r.durata + '′', 'durata');
  c.append(g);

  if (r.muscoli.length) {
    const top = r.muscoli.slice(0, 3)
      .map(m => `${esc(m.nome)} <b>${nf(m.serie, 1)}</b>`).join(' · ');
    c.append(el('div', 'res-r', `<span class="l">Dove e’ finito</span>${top}`));
  }
  if (r.record.length)
    c.append(el('div', 'res-r su', `<span class="l">Record stimati</span>`
      + r.record.map(x => `${esc(x.nome)} <b>${nf(x.ora, 1)} kg</b> (+${nf(x.su, 1)}%)`).join(' · ')));
  if (r.recMedio != null)
    c.append(el('div', 'res-r',
      `<span class="l">Recupero vero</span>${recTesto(r.recMedio)} in media fra le serie`));
  if (r.scarichi)
    c.append(el('div', 'res-r',
      `<span class="l">Scarichi</span>${r.scarichi} `
      + `${r.scarichi === 1 ? 'scarico' : 'scarichi'}, mezza serie ciascuno nel volume`));
  if (r.prontezza)
    c.append(el('div', 'res-r',
      `<span class="l">Ci sei arrivato</span>${esc(r.prontezza.mus)}: `
      + `${r.prontezza.pronto ? 'riposato' : 'con della fatica addosso'}, `
      + `<b>${nf(r.prontezza.quota * 100)}%</b> di fatica sulla forma il giorno prima`));

  c.append(el('p', 'note',
    (r.conf ? `Il confronto e’ con ${r.conf.quali}: ${r.conf.n} sedute, `
      + `${nf(r.conf.tonn)} kg e ${nf(r.conf.serie, 1)} serie in media. ` : '')
    + 'I numeri sono gli stessi che alimentano mappa muscolare, volume e '
    + 'progressi: qui sono solo messi insieme. Non e’ un voto sulla seduta.'));
  return c;
}

/**
 * Una seduta aperta dallo storico: prima cos’e’ stata, poi cosa c’e’
 * scritto dentro. L’ordine conta — chi apre una seduta di tre settimane fa
 * quasi sempre vuole ricordarsela, non correggerla.
 */
function sheetResoconto(k) {
  const r = resocontoSeduta(k);
  if (!r) return sheetSceltaModo(k);
  const w = el('div');
  w.append(cardResoconto(r));

  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'Le serie'));
  c.lastChild.style.marginTop = '0';
  c.append(el('p', 'muted',
    'Toccane una per correggerla: carico, ripetizioni, RIR, e anche l’esercizio.'));
  let ultimo = null;
  r.serie.forEach((x, i) => {
    const ex = esercizio(x.ex);
    if (ex && ex.id !== ultimo) {
      const h = el('div', 'eyebrow', esc(ex.nome));
      h.style.marginTop = '10px';
      c.append(h);
      ultimo = ex.id;
    }
    const riga = el('button', 'serie-r');
    riga.innerHTML = `<span class="mono n">serie ${i + 1}</span>
      <span class="mono">${nf(x.kg, 1)} kg</span>
      <span class="mono">${x.reps} rip</span>
      <span class="mono muted">RIR ${x.rir}</span>
      ${x.drop?.length ? `<span class="mono muted">+${x.drop.length}</span>` : ''}
      <span class="go">&rsaquo;</span>`;
    riga.onclick = () => sheetSerie(k, i, () => sheetResoconto(k));
    c.append(riga);
  });
  w.append(c);

  const mod = el('button', 'btn wide', 'Aggiungi o togli serie');
  mod.onclick = () => sheetLibero(k);
  w.append(mod);

  const ch = el('button', 'btn wide', 'Chiudi');
  ch.style.marginTop = '8px';
  ch.onclick = () => { closeSheet(); route(); };
  w.append(ch);
  sheet(w);
}
