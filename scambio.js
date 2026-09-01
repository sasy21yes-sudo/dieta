/* Scambio: portarsi via un pezzo di piano, o farselo dare da qualcuno.

   Il backup completo c'e' gia' e risponde a un'altra domanda: "come non perdo
   quello che ho". Prende tutto — diario, pesate, sedute, foto escluse — e
   quando lo si rimette al posto sostituisce l'archivio, che e' esattamente
   quello che deve fare un backup.

   Qui la domanda e' diversa: voglio dare la MIA dieta a qualcun altro, o
   portarmi le schede di palestra sul secondo profilo, senza portarmi dietro
   sessanta giorni di pesate che non c'entrano niente e che non sono nemmeno
   suoi. Quindi: pezzi separati, e una regola sola.

   La regola e' che l'import AGGIUNGE. Un backup si ripristina e cancella; una
   dieta che ti passa qualcuno si affianca alla tua, e sui nomi che esistono
   gia' si chiede, non si decide di nascosto. */
'use strict';

const SCAMBIO_FMT = 'dieta-scambio/1';

/**
 * Le due parti scambiabili.
 *
 * `raccogli` legge da D e non da S.piano, ed e' una scelta: S.piano e' solo lo
 * strato tuo sopra il file di esempio, e chi sta sul piano di esempio ce l'ha
 * quasi vuoto. Esportare lo strato vorrebbe dire consegnare un file che non
 * contiene la dieta che mangi. Gli alimenti sono l'unica eccezione — i 44 di
 * base ce li ha gia' chiunque installi l'app, e rispedirli sarebbe solo peso e
 * quarantaquattro finti conflitti.
 */
const SCAMBIO_PARTI = {
  dieta: {
    n: 'Il piano alimentare',
    d: 'Target, alimenti tuoi, ricette composte, la settimana, gli integratori.',
    breve: 'dieta',
    raccogli() {
      const solomiei = {};
      for (const [k, v] of Object.entries(D.alimenti))
        if (JSON.stringify(v) !== JSON.stringify(DBASE.alimenti[k])) solomiei[k] = v;
      return {
        target: { ...D.target },
        alimenti: solomiei,
        pasti: JSON.parse(JSON.stringify(D.pasti)),
        // i totali si ricalcolano da soli: portarseli dietro vuol dire
        // portarsi dietro anche il rischio che non tornino
        settimana: D.settimana.map(g => ({ giorno: g.giorno, attivita: g.attivita || '',
          pasti: (g.pasti || []).map(s => ({ slot: s.slot, ora: s.ora, codice: s.codice })) })),
        integratori: D.integratori.map(s => ({ ...s }))
      };
    },
    conta(d) {
      const a = Object.keys(d.alimenti || {}).length;
      const p = Object.keys(d.pasti || {}).length;
      const g = (d.settimana || []).length;
      const i = (d.integratori || []).length;
      return [
        [a, a === 1 ? 'alimento tuo' : 'alimenti tuoi'],
        [p, p === 1 ? 'ricetta composta' : 'ricette composte'],
        [g, g === 1 ? 'giorno di settimana' : 'giorni di settimana'],
        [i, i === 1 ? 'integratore' : 'integratori']
      ];
    },
    scontri(d) {
      const out = [];
      for (const k of Object.keys(d.alimenti || {})) if (D.alimenti[k]) out.push(k);
      for (const k of Object.keys(d.pasti || {}))
        if (D.pasti[k]) out.push(D.pasti[k].nome || k);
      for (const s of (d.integratori || []))
        if (D.integratori.some(x => x.nome === s.nome)) out.push(s.nome);
      return out;
    },
    applica(d, opz) {
      const p = piano();
      let n = 0;
      for (const [k, v] of Object.entries(d.alimenti || {}))
        if (opz.sovrascrivi || !D.alimenti[k]) { p.alimenti[k] = v; n++; }
      for (const [k, v] of Object.entries(d.pasti || {}))
        if (opz.sovrascrivi || !D.pasti[k]) { p.pasti[k] = v; n++; }
      for (const s of (d.integratori || [])) {
        if (!opz.sovrascrivi && D.integratori.some(x => x.nome === s.nome)) continue;
        const { nome, mio, ...resto } = s;
        p.integratori[nome] = resto; n++;
      }
      if (opz.settimana && (d.settimana || []).length) {
        p.settimana = d.settimana.map(g => ({ ...g, totali: M0() })); n++;
      }
      if (opz.target && Object.keys(d.target || {}).length) {
        p.target = { ...p.target, ...d.target }; n++;
      }
      fondiPiano();
      return n;
    }
  },

  schede: {
    n: 'Le schede di palestra',
    d: 'Le schede, con dentro gli esercizi tuoi che servono a farle girare.',
    breve: 'schede',
    raccogli() {
      const sch = schede();
      // un esercizio personalizzato che resta indietro lascia dall'altra parte
      // una riga che punta al nulla: vanno con la scheda
      const usati = new Set(sch.flatMap(s => (s.esercizi || []).map(e => e.ex)));
      return {
        schede: JSON.parse(JSON.stringify(sch)),
        esercizi: P().esercizi.filter(e => usati.has(e.id)).map(e => ({ ...e })),
        esec: Object.fromEntries(Object.entries(P().esec || {})
          .filter(([k]) => usati.has(k)))
      };
    },
    conta(d) {
      const s = (d.schede || []).length, e = (d.esercizi || []).length;
      return [[s, s === 1 ? 'scheda' : 'schede'],
              [e, e === 1 ? 'esercizio tuo' : 'esercizi tuoi']];
    },
    scontri(d) {
      const mie = schede();
      return (d.schede || []).map(s => s.nome).filter(n => mie.some(x => x.nome === n));
    },
    /* Gli esercizi del catalogo di base non viaggiano nel file: ce li ha gia'
       chiunque abbia l'app, e spedirne cinquantanove sarebbe solo peso. Ma
       "chiunque" vale finche' i due dispositivi hanno lo stesso
       data/palestra.json — uno fermo a una versione vecchia, o un id
       personalizzato che l'export non ha allegato, e la riga arriva puntando
       al nulla. Non e' un motivo per rifiutare il file: e' un motivo per
       dirlo, perche' altrimenti la scheda si apre con delle righe vuote e non
       si capisce di chi sia la colpa. */
    orfani(d) {
      const noti = new Set(catalogo().map(x => x.id)
        .concat((d.esercizi || []).map(x => x.id)));
      const out = new Set();
      for (const sc of (d.schede || []))
        for (const r of (sc.esercizi || []))
          if (r.ex && !noti.has(r.ex)) out.add(r.ex);
      return [...out];
    },
    applica(d, opz) {
      const mie = schede(), cat = P().esercizi;
      let n = 0;
      // prima gli esercizi: una scheda che arriva prima dei suoi esercizi
      // resterebbe con le righe vuote finche' non si ricarica
      for (const e of (d.esercizi || []))
        if (!catalogo().some(x => x.id === e.id)) { cat.push(e); n++; }
      P().esec = { ...(d.esec || {}), ...(P().esec || {}) };
      for (const s of (d.schede || [])) {
        const i = mie.findIndex(x => x.nome === s.nome);
        if (i >= 0 && !opz.sovrascrivi) continue;
        // id sempre nuovo: due schede con lo stesso id, e la seconda non si
        // apre piu' — scheda(id) trova sempre la prima
        const rec = { ...s, id: uid() };
        if (i >= 0) mie[i] = rec; else mie.push(rec);
        n++;
      }
      return n;
    }
  }
};

/** Il file da scaricare: una o piu' parti, sempre con la stessa busta. */
function fileScambio(quali) {
  const parti = {};
  for (const t of quali) parti[t] = SCAMBIO_PARTI[t].raccogli();
  return { formato: SCAMBIO_FMT, quando: today(),
           da: profiloAttivo()?.nome || D.profilo?.nome || '', parti };
}

function contiScambio(parti) {
  const out = [];
  for (const [t, d] of Object.entries(parti || {}))
    if (SCAMBIO_PARTI[t]) out.push(...SCAMBIO_PARTI[t].conta(d).filter(([n]) => n > 0));
  return out;
}

/* ------------------------------------------------------------------ esporta */

function sheetScambio() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Un pezzo alla volta'));
  w.append(el('h2', 'sec', 'Passa il piano, non l\'archivio'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Il backup completo serve a non perdere quello che hai, e quando lo rimetti '
    + 'sostituisce tutto. Questo serve a un\'altra cosa: dare la tua dieta a '
    + 'qualcuno, o portarti le schede sul secondo profilo, senza portarti dietro '
    + 'il diario e le pesate.'));

  const bottone = (quali, etichetta) => {
    const f = fileScambio(quali);
    const righe = contiScambio(f.parti);
    const c = el('div', 'card flat');
    c.append(el('div', 'eyebrow', esc(etichetta)));
    c.append(el('div', 'muted', esc(quali.length === 1
      ? SCAMBIO_PARTI[quali[0]].d
      : 'Dieta e schede in un file solo. Il diario resta fuori.')));
    c.append(el('div', 'hint', righe.length
      ? righe.map(([n, l]) => `${n} ${esc(l)}`).join(' · ')
      : 'Qui non hai ancora niente da esportare.'));
    const b = el('button', 'btn wide');
    b.style.marginTop = '9px';
    b.textContent = 'Scarica';
    b.disabled = !righe.length;
    b.onclick = () => {
      download(`dieta-${quali.join('-')}-${today()}.json`,
        JSON.stringify(f, null, 1), 'application/json');
      toast('File scaricato');
    };
    c.append(b);
    w.append(c);
  };

  bottone(['dieta'], 'Solo il piano alimentare');
  bottone(['schede'], 'Solo le schede di palestra');
  bottone(['dieta', 'schede'], 'Tutti e due');

  const imp = el('button', 'btn wide pri', 'Carica un file');
  imp.style.marginTop = '12px';
  imp.onclick = () => {
    const i = el('input');
    i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = () => {
      const file = i.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try { sheetCaricaScambio(JSON.parse(r.result)); }
        catch (e) { toast('File non valido: ' + (e.message || 'illeggibile')); }
      };
      r.readAsText(file);
    };
    i.click();
  };
  w.append(imp);

  w.append(el('p', 'note',
    'Caricando si aggiunge: quello che hai resta dov\'e\', e il diario non viene '
    + 'toccato in nessun caso. Sui nomi che esistono gia\' te lo chiedo prima.'));

  const ch = el('button', 'btn wide', 'Chiudi');
  ch.style.marginTop = '8px';
  ch.onclick = closeSheet;
  w.append(ch);
  sheet(w);
}

/* ------------------------------------------------------------------- carica */

function sheetCaricaScambio(f) {
  if (!f || typeof f !== 'object') { toast('File non valido'); return; }
  // un backup completo finito qui per sbaglio non e' un errore dell'utente:
  // e' un file giusto nella porta sbagliata, e va detto quale e' quella giusta
  if (f.formato !== SCAMBIO_FMT) {
    // e nella direzione opposta si fa lo stesso: si apre quello giusto invece
    // di mandare a cercare un bottone
    if ((f.log || f.profili || f.formato === 2) && typeof sheetImport === 'function') {
      toast('Questo e\' un backup completo: te lo apro di la\'');
      sheetImport(f);
      return;
    }
    toast('Formato non riconosciuto');
    return;
  }
  const parti = Object.entries(f.parti || {}).filter(([t]) => SCAMBIO_PARTI[t]);
  if (!parti.length) { toast('Il file non contiene niente di riconoscibile'); return; }

  const w = el('div');
  w.append(el('div', 'eyebrow', 'Dal file'));
  w.append(el('h2', 'sec', parti.length > 1 ? 'Piano e schede' : SCAMBIO_PARTI[parti[0][0]].n));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', `Esportato il ${esc(f.quando || '?')}${
    f.da ? ' dal profilo "' + esc(f.da) + '"' : ''}.`));
  for (const [n, l] of contiScambio(f.parti))
    w.append(el('div', 'imp-riga', `<span class="n">${n} ${esc(l)}</span>`));

  const opz = { sovrascrivi: false, settimana: false, target: false };

  /* --- le righe che qui non hanno un esercizio --- */
  const orfani = parti.flatMap(([t, d]) =>
    SCAMBIO_PARTI[t].orfani ? SCAMBIO_PARTI[t].orfani(d) : []);
  if (orfani.length)
    w.append(el('div', 'hint acciacco',
      `<strong>${orfani.length} ${orfani.length === 1 ? 'esercizio non esiste'
        : 'esercizi non esistono'} su questo dispositivo</strong>: `
      + `${esc(orfani.slice(0, 4).join(', '))}${orfani.length > 4 ? ' e altri' : ''}. `
      + 'Le schede si caricano lo stesso, ma quelle righe resteranno vuote. '
      + 'Di solito vuol dire che qui l\'app e\' a una versione piu\' vecchia: '
      + 'aggiornala dal menu e ricarica il file.'));

  /* --- i doppioni si dicono prima --- */
  const scontri = parti.flatMap(([t, d]) => SCAMBIO_PARTI[t].scontri(d));
  if (scontri.length) {
    w.append(el('div', 'hint acciacco',
      `<strong>${scontri.length} ${scontri.length === 1 ? 'nome esiste' : 'nomi esistono'} `
      + `gia'</strong>: ${esc(scontri.slice(0, 4).join(', '))}`
      + `${scontri.length > 4 ? ' e altri' : ''}.`));
    const seg = el('div', 'seg wrap');
    for (const [v, lab] of [[false, 'Tieni i miei'], [true, 'Prendi quelli del file']]) {
      const b = el('button', null, lab);
      b.setAttribute('aria-pressed', String(opz.sovrascrivi === v));
      b.onclick = () => { opz.sovrascrivi = v;
        [...seg.children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
      seg.append(b);
    }
    w.append(seg);
  }

  /* --- settimana e target: non arrivano di default, e c'e' un motivo --- */
  const dieta = f.parti.dieta;
  const inter = (etichetta, testo, set) => {
    const b = el('button', 'mod-r');
    let on = false;
    const dip = () => {
      b.className = 'mod-r' + (on ? ' on' : '');
      b.innerHTML = '<span class="mod-sw" aria-hidden="true"><i></i></span>'
        + '<span class="body"><span class="t">' + esc(etichetta) + '</span>'
        + '<span class="d">' + esc(testo) + '</span></span>';
      b.setAttribute('aria-checked', String(on));
    };
    b.setAttribute('role', 'switch');
    b.style.marginTop = '10px';
    b.onclick = () => { on = !on; set(on); dip(); };
    dip();
    w.append(b);
  };
  if (dieta && (dieta.settimana || []).length)
    inter('Prendi anche la settimana',
      'Rifa\' l\'assegnazione delle ricette ai sette giorni con quella del file. Senza, '
      + 'le ricette arrivano e le metti dove vuoi tu.',
      v => { opz.settimana = v; });
  if (dieta && Object.keys(dieta.target || {}).length)
    inter('Prendi anche i target',
      'Calorie e macro giornalieri del file al posto dei tuoi. Sono tarati su chi '
      + 'ha fatto quel piano — altezza, peso, eta\' — non su di te.',
      v => { opz.target = v; });

  const ok = el('button', 'btn wide pri', 'Aggiungi al mio piano');
  ok.style.marginTop = '14px';
  ok.onclick = () => {
    let n = 0;
    for (const [t, d] of parti) n += SCAMBIO_PARTI[t].applica(d, opz);
    save();
    closeSheet();
    route();
    toast(n === 1 ? '1 voce aggiunta' : n + ' voci aggiunte');
  };
  w.append(ok);

  const no = el('button', 'btn wide', 'Annulla');
  no.style.marginTop = '8px';
  no.onclick = closeSheet;
  w.append(no);

  w.append(el('p', 'note',
    'Il diario non viene toccato: pesate, pasti spuntati e sedute registrate '
    + 'restano esattamente dov\'erano.'));
  sheet(w);
}
