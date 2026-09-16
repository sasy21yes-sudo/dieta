/* Le leve di un giorno del piano.
 *
 * **La domanda che il piano non sapeva ricevere.** L'editor della settimana
 * dice benissimo *com'e'* un giorno — le calorie, le tre quote, la pastiglia
 * del verdetto, "mancano 340 kcal al target" — e poi lascia li'. Quello che
 * manca e' la riga dopo: *e allora cosa tocco?* Con cinque pasti, sei
 * ingredienti l'uno e ventiquattro ricette, provare a mano vuol dire aprire
 * un pasto, cambiare un peso, tornare indietro a vedere il totale, e
 * ricominciare. Una decina di tocchi per ogni tentativo.
 *
 * Qui si sceglie **quale numero muovere e da che parte** — piu' proteine,
 * meno grassi, piu' calorie — e l'app propone le mosse concrete: una
 * **porzione** da cambiare in un pasto, oppure una **ricetta** da sostituire.
 * Ognuna dice di quanto sposta quel macro, dove finisce il giorno e se il
 * verdetto della giornata cambia.
 *
 * Tre regole, e sono quelle che rendono l'elenco un consiglio invece di un
 * catalogo:
 *
 * 1. **Ordina per "quanto ottieni meno quanto rompi".** Alzare le proteine
 *    portando i grassi a +40% non e' una mossa buona: il punteggio e' il
 *    guadagno sul macro chiesto, in percentuale del suo target, **meno** il
 *    peggioramento degli altri tre rispetto ai loro. E' il senso di
 *    "cercando di mantenere i vari target".
 * 2. **Non propone mosse che non si sentono.** Sotto i quattro grammi di
 *    proteine o le quaranta calorie non e' una leva, e' rumore: la porzione
 *    si muove a scatti di cinque grammi e sotto quella soglia la voce non
 *    entra in elenco.
 * 3. **Non triplica una porzione per far tornare un numero.** Il tetto e'
 *    due volte e mezza la quantita' di partenza: oltre, quella non e' piu'
 *    la stessa ricetta — la stessa ragione per cui le sostituzioni di un
 *    pasto si fermano a x1,6.
 *
 * E una cosa detta chiaramente nel foglio: **qui si cambia il piano**, cioe'
 * tutte le settimane. Per il singolo giorno ci sono le porzioni del diario,
 * che e' un'altra cosa e sta in un altro posto.
 */
'use strict';

/* I quattro numeri su cui si ragiona. `min` e' la mossa piu' piccola che
   valga la pena proporre: sotto quella non si sente, e un elenco di mosse
   che non si sentono e' un elenco che si impara a saltare. */
const LEV_VOCI = [
  { id: 'kcal', n: 'Calorie', art: 'le calorie', su: 'sulle calorie', u: 'kcal', dec: 0, min: 40 },
  { id: 'p', n: 'Proteine', art: 'le proteine', su: 'sulle proteine', u: 'g', dec: 0, min: 4 },
  { id: 'c', n: 'Carboidrati', art: 'i carboidrati', su: 'sui carboidrati', u: 'g', dec: 0, min: 8 },
  { id: 'g', n: 'Grassi', art: 'i grassi', su: 'sui grassi', u: 'g', dec: 0, min: 3 }
];
const LEV_MAX = 8;          // quante mosse in elenco
const LEV_PER_PASTO = 2;    // e quante dallo stesso pasto
const LEV_TETTO = 2.5;      // quanto si puo' allargare una porzione
/* E quanto si puo' stringere: **un quarto**, non zero. Alla prova l'elenco
   proponeva "olio EVO 10 -> 0 g" e "latte soia 250 -> 0 ml", cioe' di
   togliere l'ingrediente — che e' un'altra cosa, e si fa gia' dentro il
   pasto. Una leva cambia una porzione: dimezzare l'olio e' un consiglio,
   cancellarlo e' una modifica alla ricetta. */
const LEV_FONDO = 0.25;

const levVoce = id => LEV_VOCI.find(v => v.id === id) || LEV_VOCI[0];

/** I macro di un codice di pasto, zero se quel codice non risolve niente. */
function levM(code) {
  const pa = code ? pasto(code) : null;
  if (!pa) return M0();
  /* gli stessi macro che somma `totaliGiorno()`: due strade diverse per il
     totale di un giorno darebbero due totali diversi nella stessa schermata */
  return pa.macro
    || (typeof macroRicetta === 'function' ? macroRicetta(pa) : null) || M0();
}

/** I totali di un giorno del piano, ricalcolati dai codici che gli passi. */
function levTotali(codici) {
  const t = M0();
  for (const c of codici) addM(t, levM(c));
  for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) t[x] = Math.round(t[x] * 10) / 10;
  return t;
}

/**
 * Quanto ottieni, e quanto rompi.
 *
 * Il guadagno e' il movimento del macro chiesto nella direzione chiesta,
 * misurato **in percentuale del suo target** — cosi' dodici grammi di
 * proteine e centoventi calorie sono confrontabili. Il danno e' la somma di
 * quanto gli altri tre si sono **allontanati** dal loro target: un macro che
 * si avvicina non porta bonus, perche' quello non e' quello che hai chiesto
 * e regalargli punti farebbe vincere mosse che non fanno quello che vuoi.
 */
function levPunteggio(prima, dopo, id, dir) {
  const t = D.target || {};
  const gain = dir * ((dopo[id] || 0) - (prima[id] || 0));
  let danno = 0;
  for (const v of LEV_VOCI) {
    if (v.id === id || !(t[v.id] > 0)) continue;
    const a = Math.abs((prima[v.id] || 0) - t[v.id]);
    const b = Math.abs((dopo[v.id] || 0) - t[v.id]);
    danno += Math.max(0, b - a) / t[v.id];
  }
  return { gain, danno, punti: (t[id] > 0 ? gain / t[id] : 0) - danno };
}

/** Le quantita' si muovono a scatti che si possono pesare in cucina. */
function levArrotonda(q) {
  return q < 100 ? Math.round(q / 5) * 5 : Math.round(q / 10) * 10;
}

/**
 * Quanto bisogna spostare quel macro.
 *
 * Se nella direzione chiesta manca qualcosa per arrivare al target, la mossa
 * punta **esattamente li'**: e' il numero che l'editor gia' scrive sotto il
 * giorno ("mancano 340 kcal"), e proporre meno vorrebbe dire lasciare il
 * lavoro a meta'. Se invece sei gia' oltre e chiedi lo stesso di aumentare —
 * legittimo: il target e' una media settimanale, non un tetto giornaliero —
 * si usa un passo del 6% del target, che sulle calorie fa circa le
 * centocinquanta kcal delle leve del piano.
 */
function levBisogno(tot, id, dir) {
  const t = D.target || {};
  const gap = (t[id] || 0) - (tot[id] || 0);
  const manca = dir > 0 ? Math.max(gap, 0) : Math.max(-gap, 0);
  return Math.max(manca, (t[id] || 0) * 0.06);
}

/* ------------------------------------------------------- le mosse possibili */

/**
 * Le porzioni: per ogni ingrediente di ogni pasto, di quanto va cambiata la
 * quantita' perche' quel macro si muova di quello che serve.
 *
 * Un ingrediente che di quel macro non ne porta (l'olio per le proteine) non
 * puo' muoverlo: si salta invece di proporre una quantita' enorme che non
 * cambierebbe niente.
 */
function levPorzioni(gi, id, dir) {
  const g = D.settimana[gi];
  if (!g) return [];
  const codici = (g.pasti || []).map(s => s.codice);
  const prima = levTotali(codici);
  const bisogno = levBisogno(prima, id, dir);
  const fuori = [];

  (g.pasti || []).forEach((s, si) => {
    const parti = partiPasto(s.codice);
    parti.forEach((cod, pi) => {
      const pa = pasto(cod);
      if (!pa?.ingredienti?.length) return;
      const solo = typeof PRE_ALI === 'string' && String(cod).startsWith(PRE_ALI);
      const base = codiceBaseRic(cod);
      const ric = solo ? null : pasto(base);
      const pesi = solo ? null : { ...(scomponiRicetta(cod)?.pesi || {}) };

      for (const ing of pa.ingredienti) {
        const a = alimento(ing.alimento);
        if (!a) continue;
        const per = (a[id] || 0) / 100;          // per grammo
        if (!(per > 0)) continue;                // non muove quel macro
        const q0 = ing.qta || 0;
        if (!(q0 > 0)) continue;                 // gia' tolto: non e' una porzione
        const grezzo = q0 + dir * bisogno / per;
        const q1 = Math.min(Math.max(levArrotonda(grezzo), levArrotonda(q0 * LEV_FONDO)),
                            levArrotonda(q0 * LEV_TETTO));
        if (Math.abs(q1 - q0) < 5) continue;

        let nuovo;
        if (solo) nuovo = codiceAlimento(ing.alimento, q1);
        else {
          const p2 = { ...pesi };
          const qRic = (ric?.ingredienti || []).find(x => x.alimento === ing.alimento)?.qta;
          if (q1 === qRic) delete p2[ing.alimento]; else p2[ing.alimento] = q1;
          nuovo = codiceRicetta(base, p2);
        }
        const parti2 = parti.slice();
        parti2[pi] = nuovo;
        const cod2 = codicePasto(parti2);
        const dopo = levTotali(codici.map((c, i) => i === si ? cod2 : c));
        fuori.push({
          tipo: 'porzione', si, gi, codice: cod2, dopo,
          nome: ing.alimento, slot: s.slot, q0, q1,
          dove: parti.length > 1 || !solo ? (pa.nome || '') : '',
          unita: a.unita || 'g',
          ...levPunteggio(prima, dopo, id, dir)
        });
      }
    });
  });
  return fuori;
}

/**
 * Le ricette: al posto di quella che c'e' in quel pasto, un'altra.
 *
 * Solo sui pasti fatti di **una** ricetta sola. Su un pasto composto —
 * `piu:` — sostituire l'intero blocco vorrebbe dire buttare via anche la
 * parte che andava bene, e quale delle due si stia cambiando non si capisce
 * dal nome della riga.
 */
function levRicette(gi, id, dir) {
  const g = D.settimana[gi];
  if (!g) return [];
  const codici = (g.pasti || []).map(s => s.codice);
  const prima = levTotali(codici);
  const fuori = [];

  (g.pasti || []).forEach((s, si) => {
    const parti = partiPasto(s.codice);
    if (parti.length !== 1) return;
    const base = codiceBaseRic(parti[0]);
    const attuale = pasto(parti[0]);
    if (!attuale) return;
    /* quelle che il giorno ha gia': la stessa ricetta due volte nello stesso
       giorno non e' un consiglio, e' un giorno che si ripete */
    const gia = new Set(codici.map(c => codiceBaseRic(partiPasto(c)[0])));
    for (const code of Object.keys(D.pasti || {})) {
      if (code === base || gia.has(code)) continue;
      const alt = pasto(code);
      if (!alt) continue;
      const dopo = levTotali(codici.map((c, i) => i === si ? code : c));
      /* Il momento della giornata non esclude niente — mangiare a colazione
         quello che di solito sta a cena e' una scelta — ma la riga lo dice
         invece di nasconderlo. E' la stessa regola di `pastiEquivalenti()`. */
      const ab = typeof slotAbituale === 'function' ? slotAbituale(code) : '';
      fuori.push({
        tipo: 'ricetta', si, gi, codice: code, dopo,
        slot: s.slot, da: attuale.nome || base, a: alt.nome || code,
        altrove: ab && ab !== s.slot ? ab : '',
        ...levPunteggio(prima, dopo, id, dir)
      });
    }
  });
  return fuori;
}

/**
 * Le mosse migliori, mescolando porzioni e ricette.
 *
 * Il tetto per pasto non e' cosmesi: senza, un pranzo con sei ingredienti
 * ricchi di carboidrati si prende tutto l'elenco e il consiglio diventa
 * "tocca il pranzo" detto sei volte. Due per pasto lasciano vedere che la
 * stessa cosa si puo' ottenere anche altrove.
 */
function leveGiorno(gi, id, dir) {
  const v = levVoce(id);
  const tutte = [...levPorzioni(gi, id, dir), ...levRicette(gi, id, dir)]
    .filter(x => x.gain >= v.min)
    .sort((a, b) => b.punti - a.punti);
  const conta = {}, viste = new Set(), out = [];
  for (const x of tutte) {
    /* La stessa ricetta proposta per quattro pasti diversi e' una riga sola
       ripetuta quattro volte: alla prova l'elenco era "metti la pizza a
       colazione", "metti la pizza a pranzo", "metti la pizza allo spuntino".
       Una ricetta entra una volta, nel pasto in cui rende di piu'. */
    if (x.tipo === 'ricetta') {
      if (viste.has(x.codice)) continue;
      viste.add(x.codice);
    }
    if ((conta[x.si] || 0) >= LEV_PER_PASTO) continue;
    conta[x.si] = (conta[x.si] || 0) + 1;
    out.push(x);
    if (out.length >= LEV_MAX) break;
  }
  return out;
}

/** Scrive la mossa nel piano. La prima modifica clona la settimana di base. */
function levApplica(m) {
  const p = piano();
  p.settimana ||= JSON.parse(JSON.stringify(
    S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
  p.settimana[m.gi].pasti[m.si].codice = m.codice;
  save(); fondiPiano();
}

/* ------------------------------------------------------------- il foglio */

const levSegno = (q, dec = 0) =>
  (q > 0 ? '+' : '−') + nf(Math.abs(q), dec);

/**
 * `sheetLeve(gi)` — quale numero muovere, e le mosse per muoverlo.
 *
 * La voce e la direzione partono **gia' scelte** su quello che in quel giorno
 * e' piu' fuori: aprire il foglio e trovare quattro pastiglie spente
 * vorrebbe dire far scegliere prima di aver detto cosa c'e' da scegliere. La
 * scelta resta, ed e' un tocco.
 */
function sheetLeve(gi, id, dir) {
  const g = D.settimana[gi];
  if (!g) return;
  const t = D.target || {};
  const tot = g.totali || M0();

  /* la proposta d'apertura: il macro piu' lontano dal suo target, e la
     direzione che lo riavvicina */
  if (!id) {
    let peggio = null;
    for (const v of LEV_VOCI) {
      if (!(t[v.id] > 0)) continue;
      const d = ((tot[v.id] || 0) - t[v.id]) / t[v.id];
      if (!peggio || Math.abs(d) > Math.abs(peggio.d)) peggio = { v, d };
    }
    id = peggio ? peggio.v.id : 'kcal';
    dir = peggio && peggio.d > 0 ? -1 : 1;
  }
  const voce = levVoce(id);

  const w = el('div');
  w.append(el('div', 'eyebrow', esc(g.giorno || '')));
  w.append(el('h2', 'sec', 'Aggiusta i macro'));
  w.lastChild.style.marginTop = '0';

  const assegnati = (g.pasti || []).filter(x => pasto(x.codice)).length;
  if (!assegnati) {
    w.append(el('p', 'muted',
      'Questo giorno non ha ancora nessuna ricetta assegnata: non c\'e\' niente '
      + 'da spostare. Aggiungi un pasto e torna qui.'));
    const x0 = el('button', 'btn wide', 'Chiudi');
    x0.style.marginTop = '12px';
    x0.onclick = closeSheet;
    w.append(x0);
    sheet(w);
    return;
  }

  /* --- com'e' adesso, voce per voce --- */
  const tab = el('div', 'cmp');
  tab.append(el('div', 'cmp-h',
    '<span></span><span>Ora</span><span>Target</span><span>Scarto</span>'));
  for (const v of LEV_VOCI) {
    const ora = tot[v.id] || 0, tg = t[v.id] || 0;
    const d = tg > 0 ? ora - tg : null;
    const buono = d != null && Math.abs(d) / tg < 0.08;
    tab.append(el('div', 'cmp-r',
      `<span>${v.n}</span><span class="mono">${nf(ora)}</span>
       <span class="mono muted">${tg ? nf(tg) : '—'}</span>
       <span class="mono ${buono ? 'good' : d == null ? 'muted' : 'fuori'}">${
         d == null ? '—' : levSegno(d)}</span>`));
  }
  w.append(tab);

  /* --- cosa muovere, e da che parte --- */
  w.append(el('div', 'eyebrow', 'Cosa vuoi muovere'));
  const seg = el('div', 'seg');
  for (const v of LEV_VOCI) {
    const b = el('button', null, v.n);
    b.setAttribute('aria-pressed', String(v.id === id));
    b.onclick = () => sheetLeve(gi, v.id, dir);
    seg.append(b);
  }
  w.append(seg);
  const seg2 = el('div', 'seg');
  seg2.style.marginTop = '6px';
  for (const [d2, lab] of [[1, 'di piu\''], [-1, 'di meno']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', String(d2 === dir));
    b.onclick = () => sheetLeve(gi, id, d2);
    seg2.append(b);
  }
  w.append(seg2);

  /* --- le mosse --- */
  const mosse = leveGiorno(gi, id, dir);
  const cPiano = typeof controlloPiano === 'function' ? controlloPiano() : null;
  const statoOra = cPiano && typeof statoGiorno === 'function'
    ? statoGiorno(tot.kcal || 0, assegnati, cPiano) : null;

  w.append(el('h2', 'sec',
    `${dir > 0 ? 'Per alzare' : 'Per abbassare'} ${voce.art}`));
  if (!mosse.length) {
    w.append(el('p', 'muted',
      'Non c\'e\' nessuna mossa che sposti abbastanza senza stravolgere il '
      + 'giorno. Di solito vuol dire che serve un pasto in piu\' (o uno in '
      + 'meno), non una porzione diversa.'));
  }
  for (const m of mosse) {
    const r = el('button', 'prod');
    const dk = (m.dopo.kcal || 0) - (tot.kcal || 0);
    const eff = [`${levSegno(m.gain * dir, voce.dec)} ${voce.u === 'g' ? 'g di ' + voce.n.toLowerCase() : 'kcal'}`];
    if (voce.id !== 'kcal' && Math.abs(dk) >= 1) eff.push(levSegno(dk) + ' kcal');
    const sg = cPiano && typeof statoGiorno === 'function'
      ? statoGiorno(m.dopo.kcal || 0, assegnati, cPiano) : null;
    const cambia = sg && statoOra && sg.stato !== statoOra.stato;
    r.innerHTML = `<div class="grow">
        <div class="mt">${esc(m.slot || '')}${
          m.tipo === 'porzione' && m.dove ? ' · ' + esc(m.dove) : ''}</div>
        <div class="nm">${m.tipo === 'porzione'
          ? `${esc(m.nome)} ${nf(m.q0)} → ${nf(m.q1)} ${esc(m.unita)}`
          : `${esc(m.da)} → ${esc(m.a)}`}${
          m.altrove ? ` <span class="pill">di solito a ${
            esc(String(m.altrove).toLowerCase())}</span>` : ''}${
          cambia ? ` <span class="pill ${sg.cls}">${esc(sg.eti)}</span>` : ''}</div>
        <div class="mt">${esc(eff.join(' · '))} · il giorno farebbe ${
          nf(m.dopo.kcal)} kcal</div></div>`;
    r.onclick = () => {
      levApplica(m);
      closeSheet(); route();
      toast(m.tipo === 'porzione'
        ? `${m.nome}: ${nf(m.q1)} ${m.unita}` : `Ricetta cambiata: ${m.a}`);
    };
    w.append(r);
  }

  w.append(el('p', 'note',
    'L\'ordine e\' quanto la mossa ti da\' ' + esc(voce.su)
    + ' <strong>meno</strong> quanto allontana gli altri tre dal loro target: '
    + 'una mossa che alza le proteine sfondando i grassi finisce in fondo. '
    + 'Le quantita\' sono arrotondate a scatti che si possono pesare: nessuna '
    + 'porzione viene allargata oltre due volte e mezza, ne\' ridotta sotto un '
    + 'quarto. Togliere del tutto un ingrediente si fa dentro il pasto: e\' una '
    + 'modifica alla ricetta, non una leva.'));
  w.append(el('p', 'note',
    'Queste cambiano <strong>il piano</strong>, cioe\' tutte le settimane. Per '
    + 'aggiustare un giorno solo ci sono le porzioni dentro il pasto, nella '
    + 'scheda Oggi.'));

  const x = el('button', 'btn wide', 'Chiudi');
  x.style.marginTop = '12px';
  x.onclick = closeSheet;
  w.append(x);
  sheet(w);
}
