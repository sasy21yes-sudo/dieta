/* Il giorno nel dettaglio: porzioni cambiate solo per oggi, e la scheda che
   raccoglie tutto quello che di quel giorno l'app sa. */
'use strict';

/**
 * Macro di un pasto in un giorno PRECISO.
 * Il piano dice 50 g di salsa; se quel giorno ne hai usati 100, il conto deve
 * seguire te e non il piano. Le porzioni cambiate stanno nel log del giorno,
 * quindi non toccano il pasto per tutti gli altri giorni.
 */
/**
 * Gli ingredienti di un pasto COME SONO STATI QUEL GIORNO.
 *
 * Due strati sopra il piano, tutti e due nel log del giorno e nessuno dei due
 * nel pasto: le quantita' cambiate (`porzioni`) e gli alimenti sostituiti
 * (`swap`). Sono chiavi diverse ma la stessa idea — il piano dice cosa era
 * previsto, il diario dice cos'e' successo, e il secondo non riscrive il primo.
 *
 * Tutti e due sono indicizzati sul nome dell'ingrediente DEL PIANO, anche
 * quando quell'ingrediente e' stato sostituito: quello e' il posto nella
 * ricetta, e non cambia perche' ci hai messo dentro un'altra cosa.
 */
/**
 * Il pasto che quel giorno ha preso il posto di quello previsto.
 *
 * E' il terzo strato sopra il piano, dopo le quantita' e le sostituzioni di
 * ingrediente, e sta allo stesso livello: il piano dice cosa era previsto, il
 * diario dice cos'e' successo. La chiave resta il codice dello SLOT — il posto
 * nella giornata — cosi' la spunta, le porzioni e tutto il resto continuano a
 * parlare della stessa riga anche dopo il cambio.
 */
/* ===================================================== quello che hai mangiato
 *
 * **Il piano e' un modello, il diario e' un fatto**, e finora la seconda meta'
 * non era vera: `consumed(k)` rileggeva ogni volta la ricetta dal piano, e
 * `d.pasti[code]` era un semplice `true`. Conseguenza: correggere una ricetta
 * oggi — o riassegnare uno slot della settimana — **riscriveva mesi di
 * storico**. Una pasta portata da 749 a 900 kcal spostava all'indietro tutte
 * le giornate in cui era stata spuntata, e con loro il bilancio energetico da
 * cui il filtro di Kalman stima il dispendio.
 *
 * La cura e' congelare **al momento della spunta**, e solo quel pasto: e'
 * l'istante in cui una riga smette di essere "quello che dovrei mangiare" e
 * diventa "quello che ho mangiato". Ticchi la colazione e la colazione si
 * fissa; se piu' tardi correggi la ricetta del pranzo, il pranzo di oggi —
 * che non hai ancora spuntato — segue la versione nuova, che e' giusto.
 *
 * Si congela la **ricetta effettiva** (dopo un eventuale cambio di pasto) con
 * il suo elenco di ingredienti, piu' slot e ora. Gli strati del giorno —
 * porzioni, sostituzioni, aggiunti — stanno gia' nel diario e continuano ad
 * applicarsi sopra: non c'e' niente da duplicare.
 *
 * Cosa NON si congela, ed e' una scelta: i valori nutrizionali degli alimenti.
 * Collegare un prodotto reale a un alimento **deve** correggere i conti
 * ovunque — e' una funzione dichiarata, non un effetto collaterale — e li' la
 * stima di prima era il numero sbagliato, non un fatto storico.
 */
/* ================================================= la chiave e' il PASTO
 *
 * Tutti gli strati del giorno — spunta, sostituzioni, porzioni, alimenti
 * aggiunti, ricetta congelata — sono indicizzati qui sotto con una chiave
 * sola, e per molto tempo quella chiave e' stata **il codice della ricetta**.
 * Funzionava finche' una ricetta compariva una volta sola nella giornata, e
 * si rompeva nel caso piu' banale che esista: le stesse mandorle allo
 * spuntino delle 11 e a quello delle 16:30. I due pasti condividevano tutto —
 * spuntarne uno spuntava l'altro, sostituire in uno sostituiva in tutti e due.
 *
 * La chiave giusta e' l'**id del pasto**: il posto nella giornata, che non
 * cambia ne' quando cambi la ricetta ne' quando lo sposti.
 */
const chiaveP = s => (s && (s.id || s.codice)) || null;

/** Il pasto di quel giorno con quella chiave. */
function pastoSlot(sid, k) {
  return slotsGiorno(k).find(x => chiaveP(x) === sid) || null;
}

/**
 * La ricetta che il **piano** prevede per quel pasto, prima di ogni
 * sostituzione del giorno.
 * Il ripiego serve ai registri scritti prima che i pasti avessero un id: li'
 * la chiave *era* il codice della ricetta, e resta leggibile.
 */
function codiceBase(sid, k) {
  const s = pastoSlot(sid, k);
  return s ? s.codice : sid;
}

function congelaPasto(sid, k) {
  const d = day(k);
  const eff = pastoDelGiorno(sid, k);
  const p = pasto(eff);
  if (!p) return;
  const slot = pastoSlot(sid, k);
  d.fatti ||= {};
  d.fatti[sid] = {
    code: eff, nome: p.nome || eff,
    slot: slot?.slot || '', ora: slot?.ora || '',
    ingredienti: (p.ingredienti || []).map(i => ({ ...i })),
    // senza ingredienti (una ricetta scritta a macro) si tiene il totale
    macro: p.ingredienti?.length ? null : { ...p.macro }
  };
}
function scongelaPasto(sid, k) {
  const d = S.log[k];
  if (d?.fatti) { delete d.fatti[sid]; if (!Object.keys(d.fatti).length) delete d.fatti; }
}
/** La ricetta come era quando l'hai spuntata, se c'e'. */
const pastoFatto = (sid, k) => S.log[k]?.fatti?.[sid] || null;

/**
 * La ricetta di quel pasto **in quel giorno**: la copia congelata se c'e',
 * altrimenti quella del piano.
 *
 * Serve ovunque si guardi un pasto dentro una giornata, e non solo per i
 * conti. Il caso che lo rende evidente: la scheda dice "cosa e' cambiato
 * rispetto al piano", e su un giorno congelato quel confronto va fatto con la
 * ricetta di allora — altrimenti basta correggere il piano oggi perche' una
 * giornata mai toccata si metta a dichiarare "modificato +150 kcal".
 */
function ricettaGiorno(sid, k) {
  const f = pastoFatto(sid, k);
  if (f?.ingredienti?.length) return f;
  return pasto(pastoDelGiorno(sid, k));
}

/**
 * Gli slot di un giorno: quelli del piano, piu' quelli spuntati che il piano
 * non ha piu'.
 *
 * Riassegnare la cena del mercoledi cambiava `D.settimana`, e la spunta
 * vecchia — che e' indicizzata sul codice della ricetta — restava orfana:
 * spariva da `consumed()` e dalla scheda Oggi, cioe' un pasto registrato
 * scompariva dal registro senza che nessuno lo avesse tolto.
 */
function slotsGiorno(k) {
  const base = (D.settimana[dayIdx(k)]?.pasti || []).map(s => ({ ...s }));
  const f = S.log[k]?.fatti;
  if (!f) return base;
  const visti = new Set(base.map(s => chiaveP(s)));
  for (const [sid, x] of Object.entries(f)) {
    if (visti.has(sid)) continue;
    base.push({ id: sid, codice: x.code || sid, slot: x.slot || 'Registrato',
      ora: x.ora || '', fuoriPiano: true });
  }
  return typeof ordinaSlotOrari === 'function' ? ordinaSlotOrari(base) : base;
}

function pastoDelGiorno(sid, k) {
  const base = codiceBase(sid, k);
  const alt = S.log[k]?.pastoSwap?.[sid];
  /* Il confronto `alt !== base` va fatto **anche in lettura**, non solo
     quando la sostituzione si scrive: se dopo averla messa il piano viene
     riassegnato proprio a quella ricetta, la sostituzione non sostituisce
     piu' niente — ma la scritta "al posto di" resterebbe li' a dichiarare un
     cambio che non c'e' piu'. */
  return (alt && alt !== base && pasto(alt)) ? alt : base;
}

/**
 * Mette (o toglie) il pasto sostitutivo, e con `scala` lo ridimensiona.
 *
 * Cambiando il pasto si buttano via le porzioni e le sostituzioni di
 * ingrediente di quello slot, e non e' una perdita: erano grammi e alimenti
 * di un'altra ricetta. Tenerli vorrebbe dire applicare a un pasto le
 * correzioni fatte su un altro.
 */
function mettePastoSwap(sid, k, nuovo, scala = 1) {
  const d = day(k), code = sid;
  d.pastoSwap ||= {};
  if (d.swap?.[code]) delete d.swap[code];
  if (d.porzioni?.[code]) delete d.porzioni[code];
  // e gli alimenti aggiunti a mano: erano stati messi dentro QUELLA ricetta
  if (d.aggiunti?.[code]) delete d.aggiunti[code];
  if (!nuovo || nuovo === codiceBase(sid, k)) delete d.pastoSwap[code];
  else {
    d.pastoSwap[code] = nuovo;
    // la scala si scrive come porzioni del pasto nuovo: e' lo stesso strato
    // che usa gia' il moltiplicatore, non serve inventarne un altro
    if (scala && Math.abs(scala - 1) > 0.02) {
      const ing = pasto(nuovo)?.ingredienti || [];
      if (ing.length) {
        d.porzioni ||= {};
        d.porzioni[code] = Object.fromEntries(ing.map(i =>
          [i.alimento, Math.max(0, Math.round(i.qta * scala * 10) / 10)]));
      }
    }
  }
  pulisciStrati(d, sid);
  // se quel pasto era gia' spuntato, quello che hai mangiato e' la ricetta
  // NUOVA: la copia congelata va rifatta, o resterebbe quella di prima
  if (d.pasti?.[code]) congelaPasto(code, k);
  save();
}

function ingredientiGiorno(sid, k) {
  const code = sid;
  // la copia congelata vince sul piano: e' il punto unico da cui passano
  // Oggi, il totale del pasto, il foglio delle porzioni e `consumed()`
  const fatto = pastoFatto(code, k);
  const p = fatto?.ingredienti?.length ? fatto : pasto(pastoDelGiorno(code, k));
  if (!p?.ingredienti) return [];
  const sw = S.log[k]?.swap?.[code] || {};
  const por = S.log[k]?.porzioni?.[code] || {};
  const righe = p.ingredienti.map(i => {
    const s = sw[i.alimento];
    return {
      slot: i.alimento,                       // il posto nella ricetta
      alimento: s ? s.a : i.alimento,         // quello che c'e' finito davvero
      qta: por[i.alimento] ?? (s ? s.qta : i.qta),
      qtaPiano: i.qta,
      alPostoDi: s ? i.alimento : null,
      // un prodotto col codice a barre non ha un nome dentro il piano: il
      // diario si tiene il suo id, cosi' puo' registrarlo lo stesso
      prod: s?.prod || null
    };
  });
  /* Il quarto strato: quello che hai aggiunto al pasto solo per oggi.
     Non poteva finire in `extra` — quello e' il fuori piano, che sta fuori
     dai pasti e si conta a parte — o il totale del pasto avrebbe continuato a
     dire il numero della ricetta mentre tu ci avevi messo dentro altro.
     Lo slot e' `agg:<id>` cosi' porzioni e sostituzioni sanno indirizzarlo
     come qualunque altra riga, e l'id resta stabile quando ne togli uno di
     mezzo — con l'indice, togliere il primo sposterebbe le quantita' di
     tutti gli altri. */
  for (const a of (S.log[k]?.aggiunti?.[code] || [])) {
    const slot = 'agg:' + a.id;
    const s2 = sw[slot];
    righe.push({
      slot,
      alimento: s2 ? s2.a : a.a,
      qta: por[slot] ?? (s2 ? s2.qta : a.qta),
      qtaPiano: 0,
      alPostoDi: s2 ? a.a : null,
      prod: s2 ? (s2.prod || null) : (a.prod || null),
      aggiunto: true
    });
  }
  return righe;
}

/** Aggiunge un alimento (o un prodotto) a un pasto, solo per quel giorno. */
function aggiungiAlPasto(code, k, alimento, qta, prod) {
  const d = day(k);
  d.aggiunti ||= {};
  d.aggiunti[code] ||= [];
  d.aggiunti[code].push({ id: uid(), a: alimento, qta: Math.max(0, qta || 0),
                          ...(prod ? { prod } : {}) });
  save();
}

/** Toglie una riga aggiunta, e con lei le sue quantita' e sostituzioni. */
/**
 * Toglie gli strati rimasti vuoti.
 *
 * `d.porzioni[sid] = {}` o `d.swap[sid] = {}` non cambiano nessun conto — chi
 * li legge guarda sempre `Object.keys(...).length` — ma sono uno stato che non
 * dovrebbe esistere, e basta un punto che li legga come "c'e' qualcosa" per
 * far comparire un "modificato" su un pasto che nessuno ha toccato. Si
 * chiudono dove nascono, invece di sperare che nessuno li guardi male.
 */
function pulisciStrati(d, sid) {
  for (const nome of ['porzioni', 'swap', 'aggiunti']) {
    const o = d[nome]; if (!o) continue;
    const v = o[sid];
    if (v && (Array.isArray(v) ? !v.length : !Object.keys(v).length)) delete o[sid];
    if (!Object.keys(o).length) delete d[nome];
  }
  if (d.pastoSwap && !Object.keys(d.pastoSwap).length) delete d.pastoSwap;
}

function togliDalPasto(code, k, slot) {
  const d = day(k);
  const id = String(slot).replace(/^agg:/, '');
  if (d.aggiunti?.[code]) {
    d.aggiunti[code] = d.aggiunti[code].filter(x => x.id !== id);
    if (!d.aggiunti[code].length) delete d.aggiunti[code];
    if (!Object.keys(d.aggiunti).length) delete d.aggiunti;
  }
  if (d.porzioni?.[code]) delete d.porzioni[code][slot];
  if (d.swap?.[code]) delete d.swap[code][slot];
  pulisciStrati(d, code);
  save();
}

/**
 * I macro di una riga di ingrediente, prodotto sciolto compreso.
 *
 * Serve perche' una riga puo' puntare a due cose diverse: un alimento del
 * piano, che si risolve per nome, o un prodotto registrato col codice a barre,
 * che un nome dentro il piano non ce l'ha. Chi legge una riga non deve sapere
 * quale delle due: chiede i macro e li ottiene.
 */
function macroIngrediente(i, qta) {
  const q = qta ?? i.qta;
  if (i.prod && typeof macroMangiabile === 'function') {
    const m = macroMangiabile('p:' + i.prod, q);
    if (m) return m;
  }
  return foodM(i.alimento, q);
}

/**
 * I macro di una ricetta, **anche quando e' una copia congelata**.
 *
 * `congelaPasto()` scrive `macro: null` sulle ricette che hanno degli
 * ingredienti, ed e' voluto: i macro si ricalcolano da quelli, cosi'
 * collegare un prodotto reale corregge anche i pasti gia' registrati. Ma chi
 * leggeva `p.macro` senza saperlo si trovava `null` in mano, e da li'
 * nascevano **tre difetti dello stesso ceppo**, tutti su un pasto spuntato:
 * il confronto col piano dichiarava l'intero pasto come differenza
 * (`+533 kcal` su un pasto che nessuno aveva toccato), "Sostituisci l'intero
 * pasto" non trovava nessuna ricetta equivalente, e la sua intestazione
 * moriva su `null.kcal`.
 *
 * Un posto solo da cui leggere i macro di una ricetta, quindi, come `pasto()`
 * e' l'unico da cui leggerla.
 */
function macroRicetta(p) {
  if (p?.macro?.kcal != null) return p.macro;
  const m = M0();
  for (const i of (p?.ingredienti || [])) addM(m, macroIngrediente(i, i.qta));
  for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) m[x] = Math.round(m[x] * 10) / 10;
  return m;
}

/** L'unita' di misura di una riga di ingrediente. */
function unitaIngrediente(i) {
  if (i.prod && typeof prodotti === 'function') {
    const pr = prodotti().find(x => x.id === i.prod);
    if (pr) return pr.unita || 'g';
  }
  return D.alimenti[i.alimento]?.unita || 'g';
}

function mealMGiorno(sid, k) {
  const code = sid, eff = pastoDelGiorno(sid, k);
  const sw = S.log[k]?.swap?.[code];
  const por = S.log[k]?.porzioni?.[code];
  const agg = S.log[k]?.aggiunti?.[code];
  const fatto = pastoFatto(code, k);
  const p = fatto?.ingredienti?.length ? fatto : pasto(eff);
  /* Gli aggiunti contano come gli altri tre strati. Mancavano, e la
     conseguenza era la peggiore possibile: aggiungendo qualcosa a un pasto e
     basta, il totale continuava a dire il numero della ricetta. Un pasto che
     mente sulle calorie e' peggio di un pasto che non si puo' modificare. */
  /* Un pasto congelato va SEMPRE ricalcolato dalla sua copia, anche senza
     nessuno strato addosso: e' tutto il punto. `mealM(eff)` rileggerebbe la
     ricetta dal piano di adesso, cioe' proprio il numero che non deve piu'
     cambiare. */
  const cambiato = !!fatto || eff !== code
    || (por && Object.keys(por).length) || (sw && Object.keys(sw).length)
    || (agg && agg.length);
  if (!cambiato || !p?.ingredienti) {
    return fatto?.macro ? { ...fatto.macro } : mealM(eff);
  }
  const m = M0();
  for (const i of ingredientiGiorno(code, k)) addM(m, macroIngrediente(i));
  for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) m[x] = Math.round(m[x] * 10) / 10;
  return m;
}

/** Quante cose sono state cambiate in quel pasto, quel giorno. */
function porzioniCambiate(code, k) {
  return ingredientiGiorno(code, k)
    .filter(i => i.alPostoDi || i.qta !== i.qtaPiano).length;
}

/** In che momento della giornata quel pasto compare di solito nella settimana. */
function slotAbituale(code) {
  const conta = new Map();
  for (const g of (D.settimana || []))
    for (const sl of (g.pasti || []))
      if (sl.codice === code) conta.set(sl.slot, (conta.get(sl.slot) || 0) + 1);
  if (!conta.size) return '';
  return [...conta.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * I pasti che possono prendere il posto di questo, a parita' di macro.
 *
 * Stessa idea del motore delle sostituzioni sugli alimenti, un piano sopra:
 * si riscala il candidato per far combaciare le calorie — entro limiti
 * ragionevoli, perche' meta' porzione di un pasto non e' piu' quel pasto — e
 * poi si ordina per distanza sui quattro macro. Il momento della giornata non
 * esclude niente: mangiare a cena quello che il piano metteva a colazione e'
 * una scelta, non un errore, e la riga lo dice invece di nasconderlo.
 */
function pastiEquivalenti(code, k, n = 8) {
  const eff = pastoDelGiorno(code, k);
  const src = ricettaGiorno(code, k);
  const m0 = macroRicetta(src);
  if (!m0.kcal) return [];
  const out = [];
  for (const [id, p] of Object.entries(D.pasti)) {
    if (id === eff || !p?.macro?.kcal || !p.ingredienti?.length) continue;
    const scala = Math.max(0.6, Math.min(1.6, m0.kcal / p.macro.kcal));
    const m = {};
    for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) m[x] = (p.macro[x] || 0) * scala;
    let dist = 0;
    for (const x of ['kcal', 'p', 'c', 'g']) {
      const base = Math.max(m0[x] || 0, 5);
      dist += Math.abs(m[x] - (m0[x] || 0)) / base;
    }
    out.push({ id, nome: p.nome, slot: slotAbituale(id), scala, macro: m, dist });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, n);
}

/** La sostituzione attiva su quell'ingrediente, quel giorno. */
function swapDelGiorno(code, k, slot) { return S.log[k]?.swap?.[code]?.[slot] || null; }

/**
 * Mette (o toglie) una sostituzione, solo per quel giorno.
 *
 * Togliendola sparisce anche la quantita' cambiata di quel posto: erano
 * grammi dell'alimento sostituito, e riportarli sull'originale vorrebbe dire
 * inventarsi una porzione che nessuno ha scelto.
 */
function metteSwap(code, k, slot, nuovo, qta, prod) {
  const d = day(k);
  d.swap ||= {}; d.swap[code] ||= {};
  if (!nuovo) {
    delete d.swap[code][slot];
    if (d.porzioni?.[code]) delete d.porzioni[code][slot];
  } else {
    d.swap[code][slot] = prod ? { a: nuovo, qta, prod } : { a: nuovo, qta };
    if (d.porzioni?.[code]) delete d.porzioni[code][slot];
  }
  if (!Object.keys(d.swap[code]).length) delete d.swap[code];
  pulisciStrati(d, code);
  save();
}

/* ------------------------------------------------- porzioni di un pasto */
function sheetPorzioni(k, code) {
  // il pasto di quel giorno: puo' non essere quello del piano perche' lo hai
  // cambiato, o perche' e' congelato dalla spunta
  const p = ricettaGiorno(code, k);
  if (!p) return;
  const d = day(k);
  d.porzioni ||= {};
  const stato = { ...(d.porzioni[code] || {}) };

  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', esc(p.nome || code)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Cambia le quantita\' solo per questo giorno. La ricetta nel piano resta com\'e\': domani torna alle sue.'));

  // la via d'uscita per chi quel pasto non lo mangia proprio
  const cambia = el('button', 'btn wide');
  cambia.style.marginBottom = '12px';
  /* "Cambia la ricetta" suonava come "modificala", che e' quello che fa il
     resto di questa scheda. Qui invece si butta via tutta la ricetta prevista
     e se ne mette un'altra, per oggi. */
  cambia.textContent = 'Sostituisci l\'intero pasto \u203a';
  cambia.onclick = () => sheetCambiaPasto(k, code);
  w.append(cambia);

  /* Scalare tutto insieme e' il caso piu' frequente — "oggi ho mangiato
     mezza porzione" — e farlo ingrediente per ingrediente e' cinque tocchi
     invece di uno. Il moltiplicatore parte sempre dalle quantita' del PIANO,
     non da quelle gia' modificate: altrimenti due tocchi su ×0,5 darebbero
     un quarto, che nessuno si aspetta. */
  const scale = el('div', 'seg');
  scale.style.marginBottom = '10px';
  for (const f of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const b = el('button', null, f === 1 ? 'piano' : '×' + nf(f, f % 1 ? 2 : 0));
    b.onclick = () => {
      for (const i of ingOggi()) {
        const base = i.alPostoDi ? i.qta : i.qtaPiano;
        const n = Math.max(0, Math.round(base * f * 10) / 10);
        if (n === base) delete stato[i.slot]; else stato[i.slot] = n;
      }
      disegna();
      if (typeof pulsa === 'function') pulsa(tot);
    };
    scale.append(b);
  }

  const tot = el('div', 'read');
  const diff = el('div', 'diffm');
  diff.hidden = true;
  const lista = el('div');
  /* Il metro del confronto e' il pasto come lo prevede il PIANO per questo
     slot, non il pasto che c'e' oggi: se hai gia' cambiato l'intero pasto,
     confrontarlo con se stesso direbbe sempre zero. */
  /* Il metro e' `codiceBase()`, cioe' la ricetta che il **piano** mette in
     quello slot — non `pasto(code)`, che con una chiave di pasto (`g0-2`) non
     trovava niente, e nemmeno la ricetta di oggi, che confrontata con se
     stessa da' sempre zero. Misurato prima della correzione: un pasto
     sostituito e non ancora spuntato diceva "nessuna differenza" invece di
     +102 kcal. Se il piano quello slot non ce l'ha piu' — un pasto registrato
     e poi tolto dalla settimana — non c'e' niente con cui confrontarsi, e il
     metro torna a essere la ricetta stessa: la riga sparisce, invece di
     dichiarare "modificato" un pasto di cui il piano ha perso l'originale. */
  const pianoM = () => {
    const b = codiceBase(code, k);
    const orig = b ? pasto(b) : null;
    return orig ? macroRicetta(orig) : macroRicetta(p);
  };
  // gli ingredienti di oggi, non quelli del piano: se uno e' stato sostituito
  // le quantita' si contano sull'alimento che c'e' davvero
  const ingOggi = () => ingredientiGiorno(code, k);
  const macroOra = () => {
    const m = M0();
    for (const i of ingOggi()) addM(m, macroIngrediente(i, stato[i.slot] ?? i.qta));
    return m;
  };
  /* Il confronto con il piano su TUTTI i macro, non solo sulle calorie.
     Sostituendo un alimento le calorie tornano quasi sempre — il motore
     riscala apposta — e quello che si sposta sono le proteine o i grassi:
     dire solo "+12 kcal" nasconde esattamente la parte che cambia. */
  const aggiorna = () => {
    const m = macroOra();
    const base = pianoM();
    tot.innerHTML = `<span><b>${nf(m.kcal)} kcal</b></span>`
      + `<span>${nf(m.p, 1)} P</span><span>${nf(m.c, 1)} C</span>`
      + `<span>${nf(m.g, 1)} G</span><span>${nf(m.fibre, 1)} fibre</span>`;
    diff.innerHTML = '';
    const voci = [['kcal', 'kcal', 0], ['p', 'P', 1], ['c', 'C', 1],
                  ['g', 'G', 1], ['fibre', 'fibre', 1]]
      .map(([id, l, dec]) => [l, (m[id] || 0) - (base[id] || 0), dec])
      .filter(([, q, dec]) => Math.abs(q) >= (dec ? 0.5 : 1));
    if (!voci.length) { diff.hidden = true; return; }
    diff.hidden = false;
    diff.innerHTML = '<span class="l">rispetto al piano</span>'
      + voci.map(([l, q, dec]) => `<span class="${q > 0 ? 'su' : 'giu'}">`
        + `${q > 0 ? '+' : '−'}${nf(Math.abs(q), dec)} ${esc(l)}</span>`).join('');
  };
  /* Salvare le porzioni prima di uscire verso un altro foglio: senza,
     aprendo "sostituisci" si perdevano le quantita' appena toccate. */
  const tieni = () => {
    if (Object.keys(stato).length) d.porzioni[code] = stato;
    else delete d.porzioni[code];
    pulisciStrati(d, code);
    save();
  };

  const disegna = () => {
    lista.innerHTML = '';
    const righe = ingOggi();
    if (!righe.length)
      lista.append(el('p', 'muted', 'Questa ricetta non ha ingredienti.'));
    for (const i of righe) {
      const unita = unitaIngrediente(i);
      const rif = i.alPostoDi ? i.qta : i.qtaPiano;
      const q = stato[i.slot] ?? i.qta;
      const cambiato = q !== rif && !i.aggiunto;
      const tolto = q === 0;
      const riga = el('div', 'porz'
        + (cambiato ? ' mod' : '') + (tolto ? ' tolto' : '')
        + (i.aggiunto ? ' agg' : ''));
      riga.innerHTML = `<span class="nm">${esc(i.alimento)}
          ${i.alPostoDi ? `<em>al posto di ${esc(i.alPostoDi)}</em>` : ''}
          ${i.aggiunto ? '<em>aggiunto oggi</em>' : ''}
          ${cambiato ? `<em class="qta">piano: ${nf(rif)} ${esc(unita)}</em>` : ''}</span>
        <button class="btn sm" data-d="-10">−</button>
        <input type="text" inputmode="decimal" value="${q}">
        <button class="btn sm" data-d="10">+</button>
        <span class="u">${esc(unita)}</span>`;
      const inp = riga.querySelector('input');
      // il bottone si decide dopo, ma setta() deve poterlo aggiornare: a zero
      // il cestino diventa un "rimettilo", o l'unico modo di tornare indietro
      // sarebbe riscrivere a mano la quantita' del piano
      let sincBottone = () => {};
      const setta = n => {
        n = Math.max(0, Math.round(n * 10) / 10);
        if (n === rif) delete stato[i.slot]; else stato[i.slot] = n;
        inp.value = n;
        riga.classList.toggle('mod', n !== rif && !i.aggiunto);
        riga.classList.toggle('tolto', n === 0);
        const em = riga.querySelector('em.qta');
        if (n !== rif && !i.aggiunto && !em)
          riga.querySelector('.nm').insertAdjacentHTML('beforeend',
            `<em class="qta">piano: ${nf(rif)} ${esc(unita)}</em>`);
        if ((n === rif || i.aggiunto) && em) em.remove();
        sincBottone(n === 0);
        aggiorna();
      };
      riga.querySelectorAll('[data-d]').forEach(b => b.onclick = () =>
        setta((parseNum(inp.value) || 0) + (+b.dataset.d)));
      inp.oninput = () => { const n = parseNum(inp.value); if (n != null && n >= 0) setta(n); };

      /* Le due azioni della riga. Stanno qui e non nella lista di Oggi
         perche' e' qui che si ha il pasto davanti: fuori erano due tocchi
         sulla riga sbagliata in mezzo a cinque ingredienti. */
      const az = el('div', 'porz-az');
      const bs = el('button', 'ico-b');
      bs.title = 'Sostituisci questo alimento';
      bs.setAttribute('aria-label', 'Sostituisci ' + i.alimento);
      bs.append(icona('repeat', { size: 17 }));
      bs.onclick = () => {
        tieni();
        sheetSwap(i.alimento, stato[i.slot] ?? i.qta,
          { k, code, slot: i.slot, prod: i.prod, torna: () => sheetPorzioni(k, code) });
      };
      az.append(bs);

      const bt = el('button', 'ico-b');
      if (i.aggiunto) {
        /* Una riga aggiunta oggi si cancella davvero: non ha un posto nella
           ricetta a cui tornare, e lasciarla a zero sarebbe una riga vuota
           che non serve a nessuno. */
        bt.classList.add('rosso');
        bt.title = 'Togli dalla ricetta';
        bt.append(icona('trash', { size: 17 }));
        bt.onclick = () => {
          togliDalPasto(code, k, i.slot);
          delete stato[i.slot];
          disegna();
        };
      } else {
        /* Un ingrediente del piano invece non si cancella: si porta a zero.
           Il piano e' la ricetta e vale anche domani — quello che cambia e'
           quanto ne hai mangiato oggi, e zero e' una quantita' come le altre. */
        sincBottone = t => {
          bt.innerHTML = '';
          bt.classList.toggle('rosso', !t);
          bt.title = t ? 'Rimettilo' : 'Togli per oggi';
          bt.setAttribute('aria-label', (t ? 'Rimetti ' : 'Togli ') + i.alimento);
          bt.append(icona(t ? 'undo' : 'trash', { size: 17 }));
        };
        sincBottone(tolto);
        bt.onclick = () => setta((parseNum(inp.value) || 0) === 0 ? (rif || 1) : 0);
      }
      az.append(bt);
      riga.append(az);
      lista.append(riga);
    }
    aggiorna();
  };
  disegna();
  w.append(el('div', 'eyebrow', 'Scala tutta la ricetta'));
  w.append(scale);
  w.append(lista);

  const badd = el('button', 'btn wide agg-b');
  badd.style.marginTop = '10px';
  badd.append(icona('plus', { size: 17 }));
  badd.append(el('span', null, 'Aggiungi un alimento a questa ricetta'));
  badd.onclick = () => {
    tieni();
    sheetAggiungiAlPasto(k, code);
  };
  w.append(badd);

  w.append(tot);
  w.append(diff);

  const salva = el('button', 'btn wide pri', 'Salva per oggi');
  salva.style.marginTop = '12px';
  salva.onclick = () => {
    if (Object.keys(stato).length) d.porzioni[code] = stato;
    else delete d.porzioni[code];
    pulisciStrati(d, code);
    save(); closeSheet(); route(); toast('Porzioni aggiornate');
  };
  w.append(salva);

  if (Object.keys(d.porzioni[code] || {}).length) {
    const r = el('button', 'btn wide', 'Torna alle quantita del piano');
    r.style.marginTop = '8px';
    r.onclick = () => { delete d.porzioni[code]; save(); closeSheet(); route(); toast('Ripristinate'); };
    w.append(r);
  }
  sheet(w);
}

/**
 * Aggiungere un alimento a un pasto, solo per oggi.
 *
 * Diverso dal "fuori piano": quello e' cibo che non appartiene a nessun
 * pasto e si conta a parte. Questo entra DENTRO il pasto, quindi il totale
 * della scheda su Oggi e la spunta dicono la verita' — che e' il motivo per
 * cui non si poteva riusare `extra`.
 */
function sheetAggiungiAlPasto(k, code) {
  /* `code` a null vuol dire "chiedimi anche dove": e' la scorciatoia da Oggi,
     dove si sa cosa si e' mangiato ma non si e' ancora deciso se appartiene a
     un pasto del piano o al fuori piano. Con un codice invece la destinazione
     e' gia' quella, e chiederla sarebbe una domanda con una risposta sola. */
  const dest = { code };
  const slots = usaPiano()
    ? slotsGiorno(k).filter(x => ricettaGiorno(chiaveP(x), k)) : [];
  if (!code && !slots.length) dest.code = null;      // resta il fuori piano

  const p = code ? ricettaGiorno(code, k) : null;
  const w = el('div');
  w.append(el('div', 'eyebrow', code ? esc(p?.nome || code) : (k === today() ? 'Oggi' : k)));
  w.append(el('h2', 'sec', 'Aggiungi un alimento'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', code
    ? 'Entra dentro questa ricetta e <strong>solo per oggi</strong>: il totale '
      + 'della scheda lo conta, e domani la ricetta torna quella del piano.'
    : 'Scegli cosa, quanto e dove finisce. Vale <strong>solo per oggi</strong>: '
      + 'dentro una ricetta il piano non cambia, e domani torna quella prevista.'));

  const scelto = { v: null };
  // il selettore vuole {v, lab, sub}: mangiabili() parla un'altra lingua, ed
  // e' la stessa conversione che fa gia' la sostituzione
  const opz = (typeof mangiabili === 'function' ? mangiabili() : []).map(x => ({
    v: x.id, lab: x.nome,
    sub: `${x.fonte === 'prodotto' ? (x.marca ? x.marca + ' · ' : 'tuo prodotto · ') : ''}`
      + `${nf(x.kcal)} kcal · ${nf(x.p, 1)} P per 100 ${x.unita}`
  }));
  const f = el('div', 'field', '<label>Cosa</label>');
  const anteprima = el('div', 'read');
  f.append(selettoreCercabile(opz, null, v => { scelto.v = v; stima(); }, 'Cerca…'));
  w.append(f);

  w.append(el('div', 'field',
    `<label>Quanto</label>
     <input type="text" inputmode="decimal" id="ag-q" value="100">
     <div class="hint">Nell'unita' dell'alimento: grammi, millilitri o pezzi.</div>`));

  /* Quanto pesa quello che stai per aggiungere, prima di aggiungerlo: e' la
     differenza fra "metto la granola" e "metto duecento calorie". */
  const stima = () => {
    const x = scelto.v && typeof mangiabile === 'function' ? mangiabile(scelto.v) : null;
    const q = parseNum(($('#ag-q') || {}).value);
    if (!x || !(q > 0)) { anteprima.innerHTML = ''; return; }
    const m = typeof macroMangiabile === 'function' ? macroMangiabile(scelto.v, q) : null;
    if (!m) { anteprima.innerHTML = ''; return; }
    anteprima.innerHTML = `<span><b>+${nf(m.kcal)} kcal</b></span>`
      + `<span>+${nf(m.p, 1)} P</span><span>+${nf(m.c, 1)} C</span>`
      + `<span>+${nf(m.g, 1)} G</span>`
      + (x.stima ? '<span class="muted">valore stimato</span>' : '');
  };
  w.append(anteprima);
  const campoQ = w.querySelector('#ag-q');
  if (campoQ) campoQ.oninput = stima;

  /* --- dove finisce --- */
  if (!code && slots.length) {
    const fd = el('div', 'field', '<label>Dove</label>');
    const seg = el('div', 'seg chips');
    const voci = slots.map(x => [x.codice,
      `${x.slot}${x.ora ? ' ' + x.ora : ''}`]).concat([[null, 'Fuori piano']]);
    // il pasto piu' vicino all'ora di adesso e' quasi sempre quello giusto:
    // chi registra qualcosa lo fa mentre lo sta mangiando
    const ora = new Date().getHours() * 60 + new Date().getMinutes();
    let best = null, dist = 1e9;
    for (const x of slots) {
      const m = typeof oraMinuti === 'function' ? oraMinuti(x.ora) : null;
      if (m == null) continue;
      const dd = Math.abs(m - ora);
      if (dd < dist) { dist = dd; best = x.codice; }
    }
    dest.code = k === today() ? best : null;
    const dipingi = () => [...seg.children].forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.c || '') === String(dest.code || '')));
    for (const [c, lab] of voci) {
      const b = el('button', null, lab);
      b.dataset.c = c || '';
      b.onclick = () => { dest.code = c; dipingi(); };
      seg.append(b);
    }
    fd.append(seg);
    fd.append(el('div', 'hint',
      'Dentro una ricetta conta nel totale di quella ricetta; nel fuori piano resta '
      + 'una voce a se\'. Parte gia\' scelto quello piu\' vicino a adesso.'));
    w.append(fd);
    dipingi();
  }

  const ok = el('button', 'btn wide pri', 'Aggiungi');
  ok.onclick = () => {
    const v = scelto.v;
    if (!v) { toast('Scegli prima un alimento'); return; }
    const q = parseNum($('#ag-q').value);
    if (!(q > 0)) { toast('Quanto?'); return; }
    // un prodotto col codice a barre non ha un nome dentro il piano: si tiene
    // il suo id, come fa gia' la sostituzione
    const prod = String(v).startsWith('p:') ? String(v).slice(2) : null;
    const x = typeof mangiabile === 'function' ? mangiabile(v) : null;
    const nome = x?.nome || String(v).replace(/^a:/, '');
    if (dest.code) {
      aggiungiAlPasto(dest.code, k, nome, q, prod);
      if (code) { sheetPorzioni(k, code); toast('Aggiunto per oggi'); }
      else { closeSheet(); route(); toast(nome + ' in ' + (pasto(pastoDelGiorno(dest.code, k))?.nome || 'quel pasto')); }
    } else {
      // fuori piano: i macro si calcolano, non si chiedono
      const m = typeof macroMangiabile === 'function' ? macroMangiabile(v, q) : null;
      if (!m) { toast('Non riesco a calcolare i macro'); return; }
      day(k).extra.push({ nome: `${nome} ${nf(q)} ${x?.unita || 'g'}`,
        kcal: Math.round(m.kcal), p: m.p, c: m.c, g: m.g, fibre: m.fibre });
      save(); closeSheet(); route(); toast('Registrato fuori piano');
    }
  };
  w.append(ok);
  const ann = el('button', 'btn wide', 'Annulla');
  ann.style.marginTop = '8px';
  ann.onclick = () => { if (code) sheetPorzioni(k, code); else { closeSheet(); route(); } };
  w.append(ann);
  sheet(w);
}

/**
 * Cambiare tutto il pasto, non un ingrediente alla volta.
 *
 * La sostituzione per alimento risolve "il tofu oggi non ce l'ho". Questa
 * risolve un'altra cosa: "oggi quel pasto non lo mangio", che e' il caso in
 * cui uno esce dal piano del tutto. Finora l'unica strada era spuntare niente
 * e riscrivere la giornata come fuori piano, cioe' buttare via il piano per
 * un pasto.
 */
function sheetCambiaPasto(k, code) {
  const eff = pastoDelGiorno(code, k);
  const src = ricettaGiorno(code, k);
  if (!src) return;
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Sostituisci l\'intero pasto'));
  w.append(el('h2', 'sec', esc(src.nome)));
  w.lastChild.style.marginTop = '0';
  const srcM = macroRicetta(src);
  w.append(el('p', 'muted', `${nf(srcM.kcal)} kcal · ${macroRiga(srcM)}`));
  w.append(el('p', 'hint',
    'Vale <strong>solo per oggi</strong>, come le porzioni: il piano resta com\'e\' '
    + 'e domani torna il pasto previsto. Le quantita\' e le sostituzioni di '
    + 'ingrediente gia\' fatte su questo pasto vengono azzerate — erano di un\'altra '
    + 'ricetta.'));

  if (eff !== code) {
    const base = codiceBase(code, k);
    const box = el('div', 'card flat');
    box.append(el('div', 'eyebrow', 'Il piano qui prevedeva'));
    box.append(el('div', 'muted', `<strong>${esc(pasto(base)?.nome || base)}</strong>`));
    const via = el('button', 'btn wide');
    via.style.marginTop = '9px';
    via.textContent = 'Rimetti la ricetta del piano';
    via.onclick = () => {
      mettePastoSwap(code, k, null);
      closeSheet(); route(); toast('Rimessa la ricetta del piano');
    };
    box.append(via);
    w.append(box);
  }

  const list = pastiEquivalenti(code, k);
  w.append(el('h2', 'sec', 'A parita’ di macro'));
  if (!list.length) {
    w.append(el('p', 'muted',
      'Non ci sono altre ricette composte fra cui scegliere. Si compongono in '
      + 'Piano, passo "Le tue ricette".'));
  }
  for (const x of list) {
    const dk = x.macro.kcal - srcM.kcal;
    const dd = ([id, l]) => {
      const q = (x.macro[id] || 0) - (srcM[id] || 0);
      return `${q >= 0 ? '+' : '−'}${nf(Math.abs(q), 1)} ${l}`;
    };
    const r = el('button', 'swapopt');
    r.innerHTML = `<div class="grow"><strong>${esc(x.nome)}</strong>
        <div class="d">${dk >= 0 ? '+' : '−'}${nf(Math.abs(dk))} kcal · ${
          [['p', 'P'], ['c', 'C'], ['g', 'G'], ['fibre', 'fib']].map(dd).join(' · ')}${
          x.slot ? ' · di solito a ' + esc(x.slot.toLowerCase()) : ''}</div></div>
      <div class="mono">${Math.abs(x.scala - 1) > 0.02
        ? '×' + nf(x.scala, 2) : 'intero'} ›</div>`;
    r.onclick = () => {
      mettePastoSwap(code, k, x.id, x.scala);
      closeSheet(); route();
      toast(x.nome + ' al posto di ' + src.nome + ', solo per oggi');
    };
    w.append(r);
  }
  w.append(el('p', 'note',
    'Il moltiplicatore riscala tutti gli ingredienti per far combaciare le '
    + 'calorie, e si ferma fra ×0,6 e ×1,6: oltre quei limiti mezza porzione '
    + 'di una ricetta non e’ piu’ quella ricetta. Le quantita’ restano modificabili '
    + 'una per una qui accanto.'));

  /* **Oppure una qualunque.**
     La stessa regola gia' imparata sulle sostituzioni di ingrediente: il
     motore ordina per somiglianza, ma "somigliante" non e' "voluto". Stasera
     puoi avere voglia di una cosa che con i macro di stamattina non c'entra
     niente, e l'app deve saperla scrivere invece di costringerti a spuntare
     niente e riscrivere la giornata come fuori piano. */
  w.append(el('h2', 'sec', 'Oppure scegline una qualunque'));
  w.append(el('p', 'muted',
    'Tutte le ricette che hai, anche quelle lontanissime da questa. '
    + 'Scegliendola vedi subito cosa cambia.'));

  const opz = Object.entries(D.pasti)
    .filter(([id]) => id !== eff)
    .map(([id, pa]) => ({ v: id, lab: pa.nome || id,
      sub: `${nf(pa.macro.kcal)} kcal \u00b7 ${nf(pa.macro.p, 0)}P ${
        nf(pa.macro.c, 0)}C ${nf(pa.macro.g, 0)}G` }))
    .sort((a, b) => a.lab.localeCompare(b.lab));

  const esito = el('div');
  if (!opz.length) {
    w.append(el('p', 'muted', 'Non ne hai altre.'));
  } else {
    w.append(selettoreCercabile(opz, null, (id) => {
      esito.innerHTML = '';
      const pa = pasto(id);
      if (!pa) return;
      const dd = ([mid, l]) => {
        const q = (pa.macro[mid] || 0) - (srcM[mid] || 0);
        return `${q >= 0 ? '+' : '\u2212'}${nf(Math.abs(q), 1)} ${l}`;
      };
      const dk = pa.macro.kcal - srcM.kcal;
      const r = el('div', 'read');
      r.innerHTML = `<span>${nf(pa.macro.kcal)} kcal</span>`
        + `<span>${dk >= 0 ? '+' : '\u2212'}${nf(Math.abs(dk))} kcal</span>`
        + `<span>${[['p', 'P'], ['c', 'C'], ['g', 'G']].map(dd).join(' \u00b7 ')}</span>`;
      esito.append(r);

      const metti = (scala, testo) => {
        const b = el('button', 'btn wide' + (scala === 1 ? ' pri' : ''));
        b.style.marginTop = '8px';
        b.textContent = testo;
        b.onclick = () => {
          mettePastoSwap(code, k, id, scala);
          closeSheet(); route();
          toast(pa.nome + ' al posto di ' + src.nome + ', solo per oggi');
        };
        esito.append(b);
      };
      metti(1, 'Metti "' + (pa.nome || id) + '" intera');
      /* Il pareggio delle calorie si offre solo se sta dentro i limiti gia'
         dichiarati: oltre quelli mezza porzione non e' piu' quella ricetta,
         ed e' la stessa soglia che usa l'elenco a parita' di macro. */
      const sc = pa.macro.kcal > 0 ? srcM.kcal / pa.macro.kcal : 0;
      if (sc >= 0.6 && sc <= 1.6 && Math.abs(sc - 1) > 0.05)
        metti(+sc.toFixed(2),
          `\u2026oppure \u00d7${nf(sc, 2)}, per pareggiare le ${nf(srcM.kcal)} kcal`);
    }, 'Cerca fra le tue ricette\u2026'));
    w.append(esito);
  }

  const ch = el('button', 'btn wide pri', 'Chiudi');
  ch.style.marginTop = '12px';
  ch.onclick = closeSheet;
  w.append(ch);
  sheet(w);
}

/* ------------------------------------------------ la giornata in dettaglio */
/** Tutto quello che l'app sa di un giorno, in una scheda sola. */
function sheetGiorno(k) {
  const d = S.log[k];
  const plan = { ...D.settimana[dayIdx(k)], pasti: slotsGiorno(k) };
  const w = el('div');
  const nomi = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k === addDays(today(), -1) ? 'Ieri' : k));
  w.append(el('h2', 'sec', nomi[dayIdx(k)][0].toUpperCase() + nomi[dayIdx(k)].slice(1)));
  w.lastChild.style.marginTop = '0';

  if (!d) {
    w.append(el('p', 'muted', 'Di questo giorno non e\' stato registrato niente.'));
    sheet(w); return;
  }

  /* macro */
  const c = consumed(k), t = dayTarget(k);
  const g = el('div', 'cmp');
  g.append(el('div', 'cmp-h', '<span></span><span>Preso</span><span>Target</span><span>Δ</span>'));
  for (const [id, lab, dec] of [['kcal', 'Calorie', 0], ['p', 'Proteine', 0],
                                ['c', 'Carboidrati', 0], ['g', 'Grassi', 0], ['fibre', 'Fibre', 0]]) {
    if (!t[id]) continue;
    const diff = c[id] - t[id];
    g.append(el('div', 'cmp-r',
      `<span>${lab}</span><span class="mono">${nf(c[id], dec)}</span>
       <span class="mono muted">${nf(t[id], dec)}</span>
       <span class="mono ${Math.abs(diff) <= t[id] * 0.08 ? 'good' : ''}">${diff >= 0 ? '+' : ''}${nf(diff, dec)}</span>`));
  }
  w.append(g);

  /* pasti */
  const fatti = (plan.pasti || []).filter(s => d.pasti?.[chiaveP(s)]);
  if (fatti.length || (d.extra || []).length) {
    w.append(el('div', 'eyebrow', 'Cosa hai mangiato'));
    w.lastChild.style.marginTop = '14px';
    for (const s of fatti) {
      const p = ricettaGiorno(chiaveP(s), k); if (!p) continue;
      const m = mealMGiorno(chiaveP(s), k);
      const nMod = porzioniCambiate(chiaveP(s), k);
      w.append(el('div', 'cmp-r',
        `<span>${esc(p.nome || s.codice)}${nMod ? ` <em class="mod-tag">${nMod} porzion${nMod === 1 ? 'e' : 'i'} cambiat${nMod === 1 ? 'a' : 'e'}</em>` : ''}</span>
         <span class="mono">${nf(m.kcal)}</span><span class="mono muted">${nf(m.p, 0)}P</span><span></span>`));
    }
    for (const e of (d.extra || []))
      w.append(el('div', 'cmp-r',
        `<span>${esc(e.nome)} <em class="mod-tag">fuori piano</em></span>
         <span class="mono">${nf(e.kcal)}</span><span class="mono muted">${nf(e.p, 0)}P</span><span></span>`));
  }

  /* abitudini */
  const ab = [['peso', 'Peso', 'kg', 2], ['acqua', 'Acqua', 'L', 1],
              ['passi', 'Passi', '', 0], ['sonno', 'Sonno', 'h', 1],
              ['coca', 'Coca Zero', 'lattine', 0], ['fame', 'Fame', '/10', 0],
              ['energia', 'Energia', '/10', 0]].filter(x => d[x[0]] != null);
  if (ab.length) {
    w.append(el('div', 'eyebrow', 'Come e andata'));
    w.lastChild.style.marginTop = '14px';
    const q = el('div', 'hx-quote');
    q.style.gridTemplateColumns = 'repeat(3,1fr)';
    q.innerHTML = ab.map(([id, lab, u, dec]) =>
      `<div><span>${lab}</span><b>${nf(d[id], dec)}</b><em>${u}</em></div>`).join('');
    w.append(q);
  }

  /* allenamento */
  const ser = typeof serieDelGiorno === 'function' ? serieDelGiorno(k) : [];
  const hs = S.hyrox?.sessioni?.[k];
  const brucia = typeof kcalAllenamento === 'function' ? kcalAllenamento(k) : { tot: 0, righe: [] };
  if (ser.length || hs?.fatto) {
    w.append(el('div', 'eyebrow', 'Allenamento'));
    w.lastChild.style.marginTop = '14px';
    if (ser.length) {
      const per = {};
      for (const s of ser) (per[s.ex] ||= []).push(s);
      for (const [ex, l] of Object.entries(per))
        w.append(el('div', 'cmp-r',
          `<span>${esc(esercizio(ex)?.nome || ex)}</span>
           <span class="mono">${l.length} serie</span>
           <span class="mono muted">${l.map(x => `${nf(x.kg, 0)}×${x.reps}`).join(' ')}</span><span></span>`));
    }
    if (hs?.fatto) {
      const a = HX?.allenamenti.find(x => x.id === hs.id);
      w.append(el('div', 'cmp-r',
        `<span>${esc(a?.nome || hs.id)}</span><span class="mono">HYROX</span>
         <span class="mono muted">${hs.durata || a?.durata || ''}'</span><span></span>`));
    }
    if (brucia.tot > 0)
      w.append(el('p', 'hint',
        `Spesa stimata ${nf(brucia.tot)} kcal. Non va sommata al target: il dispendio del motore contiene gia' gli allenamenti.`));
  }

  /* sfida e integratori */
  const sf = S.sfide?.log?.[k];
  if (sf) {
    const s = SF?.sfide.find(x => x.id === sf.id);
    w.append(el('div', 'cmp-r',
      `<span>Sfida: ${esc(s?.t || sf.id)}</span>
       <span class="mono ${sf.fatta ? 'good' : ''}">${sf.fatta ? '✓ fatta' : 'saltata'}</span><span></span><span></span>`));
  }
  const integ = Object.keys(d.integratori || {}).filter(x => d.integratori[x]);
  if (integ.length) w.append(el('p', 'hint', 'Integratori: ' + integ.map(esc).join(', ') + '.'));
  const mis = Object.entries(d.misure || {});
  if (mis.length) w.append(el('p', 'hint',
    'Misure: ' + mis.map(([id, v]) => `${esc(id)} ${nf(v, 1)} cm`).join(' · ') + '.'));

  const vai = el('button', 'btn wide pri', 'Apri questo giorno');
  vai.style.marginTop = '14px';
  vai.onclick = () => { viewDate = k; closeSheet(); apri('#/oggi'); };
  w.append(vai);
  sheet(w);
}
