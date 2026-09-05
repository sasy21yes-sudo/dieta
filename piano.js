/* Profili e piano personalizzato.
 *
 * data/dieta.json resta la fonte di verita' di BASE — quel piano e' stato
 * costruito e verificato a monte, e non va toccato. Quello che l'utente crea
 * si sovrappone come strato: alimenti aggiunti, ricette composte, target propri,
 * settimana riorganizzata. D e' la fusione dei due, ricostruita a ogni
 * modifica. Cosi' un secondo utente puo' avere una dieta completamente diversa
 * senza che il file di partenza cambi di una virgola.
 */
'use strict';

const PROF_KEY = 'dieta.profili';
let DBASE = null;                       // data/dieta.json come sta sul disco

/* ------------------------------------------------------------- profili */
function profili() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PROF_KEY)); } catch { p = null; }
  if (!p || !Array.isArray(p.lista) || !p.lista.length)
    p = { lista: [{ id: 'principale', nome: 'Principale' }], attivo: 'principale' };
  if (!p.lista.some(x => x.id === p.attivo)) p.attivo = p.lista[0].id;
  return p;
}
function salvaProfili(p) { localStorage.setItem(PROF_KEY, JSON.stringify(p)); }
function profiloAttivo() { const p = profili(); return p.lista.find(x => x.id === p.attivo); }
/** La chiave di localStorage dipende dal profilo: gli stati restano separati. */
function chiaveStato() {
  const p = profili();
  return p.attivo === 'principale' ? KEY : KEY + ':' + p.attivo;
}

function creaProfilo(nome) {
  const p = profili();
  const id = nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) + '-' + uid().slice(0, 4);
  p.lista.push({ id, nome });
  p.attivo = id;
  salvaProfili(p);
  return id;
}
function cambiaProfilo(id) {
  const p = profili();
  if (!p.lista.some(x => x.id === id)) return;
  p.attivo = id; salvaProfili(p);
  location.reload();                    // ricarica tutto: stato e piano cambiano insieme
}

/* --------------------------------------------------------- fusione piano */
function piano() {
  S.piano ||= {};
  const p = S.piano;
  p.alimenti ||= {}; p.pasti ||= {}; p.target ||= {}; p.profilo ||= {};
  p.integratori ||= {};       // nome -> voce modificata, oppure { tolto: true }
  return p;
}

/** Sette giorni senza pasti assegnati, con la struttura degli slot del file. */
function settimanaVuota() {
  return DBASE.settimana.map(g => ({
    giorno: g.giorno, attivita: '',
    pasti: (g.pasti || []).map(s => ({ slot: s.slot, ora: s.ora, codice: null })),
    totali: M0()
  }));
}

/**
 * Target di partenza per chi comincia da zero: Mifflin-St Jeor per il
 * metabolismo a riposo, per il fattore di attivita' del modello, proteine a
 * 2 g/kg, grassi al 25% delle calorie, il resto carboidrati. E' un punto di
 * partenza calcolato, non un piano: la scheda Target lo dice e lo fa cambiare.
 */
function targetNeutro() {
  const g = { acqua_l: DBASE.target.acqua_l, passi: DBASE.target.passi,
              sonno_h: DBASE.target.sonno_h, p_per_kg: 2,
              min_p_per_pasto: DBASE.target.min_p_per_pasto,
              kcal: 0, p: 0, c: 0, g: 0, fibre: 0 };
  const pr = { ...DBASE.profilo, ...piano().profilo };
  const peso = piano().profilo?.peso_iniziale_kg;
  if (!(peso > 0 && pr.altezza_cm > 0 && pr.eta > 0)) return g;
  const bmr = 10 * peso + 6.25 * pr.altezza_cm - 5 * pr.eta + (pr.sesso === 'f' ? -161 : 5);
  const kcal = Math.round(bmr * (DBASE.modello?.laf || 1.35) / 10) * 10;
  const prot = Math.round(peso * 2);
  const gr = Math.round(kcal * 0.25 / 9);
  return { ...g, kcal, p: prot, g: gr,
           c: Math.max(0, Math.round((kcal - prot * 4 - gr * 9) / 4)),
           fibre: Math.round(kcal / 1000 * 14) };
}

/**
 * D = base + strato dell'utente.
 *
 * Attenzione: data/dieta.json NON e' il piano di tutti, e' un ESEMPIO — con
 * dentro nome, eta', peso e misure di una persona reale. Chi installa l'app
 * per la prima volta non deve ritrovarsi quei dati addosso, quindi finche' non
 * sceglie il piano resta vuoto e i suoi valori si calcolano dal suo profilo.
 * Chi sceglie l'esempio se lo prende tutto, ed e' suo da modificare.
 */
/* ==================================================== l'identita' di un pasto
 *
 * **Il diario era indicizzato sul codice della RICETTA, non sul pasto.** Due
 * pasti diversi che usano la stessa ricetta — le mandorle allo spuntino delle
 * 11 e a quello delle 16:30, che e' una cosa normalissima — condividevano
 * quindi tutto: la spunta, le sostituzioni, le porzioni, gli alimenti
 * aggiunti. Spuntando quello della mattina si spuntava anche quello del
 * pomeriggio; sostituendo la ricetta in uno la si sostituiva in tutti e due.
 * Segnalato con uno screenshot che lo mostra su due righe della stessa
 * giornata.
 *
 * La chiave giusta e' il **pasto**, che e' il posto nella giornata, e ogni
 * pasto ha bisogno di un'identita' che non dipenda ne' dalla ricetta che ci
 * sta dentro ne' dalla sua posizione — perche' i pasti si riordinano, si
 * rinominano e cambiano ricetta di continuo.
 *
 * `idPasto()` la assegna a chi non ce l'ha. La forma `g<giorno>-<posizione>`
 * vale solo come punto di partenza per il piano di base, che e' un file
 * statico e quindi ha posizioni stabili: appena l'utente tocca la settimana lo
 * strato in `S.piano` viene scritto con gli id dentro, e da quel momento sono
 * suoi e non si muovono piu'.
 */
function idPasto(gi, si) { return 'g' + gi + '-' + si; }

/**
 * Mette un id a ogni pasto che non ce l'ha, e lo **salva** se il piano e'
 * gia' dell'utente. L'ordine per orario si applica dopo: altrimenti la
 * posizione da cui nasce l'id cambierebbe a ogni fusione.
 */
function assegnaIdPasti() {
  const p = piano();
  let scritto = false;
  for (const [gi, g] of (D.settimana || []).entries()) {
    for (const [si, sl] of (g.pasti || []).entries()) {
      if (!sl.id) sl.id = idPasto(gi, si);
      const mio = p.settimana?.[gi]?.pasti?.[si];
      if (mio && !mio.id) { mio.id = sl.id; scritto = true; }
    }
  }
  if (scritto) save();
}

function fondiPiano() {
  const p = piano();
  const esempio = S.settings?.pianoBase === 'esempio';
  D = {
    ...DBASE,
    // il database degli alimenti resta sempre: sono valori nutrizionali
    // generici, non dati di nessuno
    alimenti: { ...DBASE.alimenti, ...p.alimenti },
    profilo: esempio ? { ...DBASE.profilo, ...p.profilo }
      : { nome: '', eta: null, altezza_cm: null, peso_iniziale_kg: null,
          sesso: 'm', ...p.profilo },
    target: esempio ? { ...DBASE.target, ...p.target }
      : { ...targetNeutro(), ...p.target },
    pasti: esempio ? { ...DBASE.pasti, ...p.pasti } : { ...p.pasti },
    settimana: p.settimana || (esempio ? DBASE.settimana : settimanaVuota()),
    // i valori di partenza delle misure sono di quella persona, non di chi installa
    misure: esempio ? DBASE.misure : DBASE.misure.map(m => ({ ...m, base: null })),
    integratori: fondiIntegratori(esempio),
    /* Il fisico di riferimento e' una SCELTA, non un default.
       Finora `target_fisico` arrivava da `...DBASE` per tutti, quindi anche chi
       cominciava da zero si ritrovava addosso il fisico di una persona reale
       scelta da qualcun altro — la stessa cosa che questo file vieta per il
       nome, l'eta' e le misure di partenza. Con il piano vuoto non c'e'
       nessuno finche' non lo scegli, e la colonna "Manca" resta vuota. */
    target_fisico: p.fisico
      ? { ...p.fisico, rapporti: p.fisico.rapporti || DBASE.target_fisico.rapporti }
      : (esempio ? DBASE.target_fisico : null)
  };
  /* Le misure del riferimento vivono anche su `D.misure[].target`: da li'
     escono la colonna "Manca" di Corpo e la sagoma tratteggiata. Vanno tenute
     insieme al fisico, o la figura di riferimento sarebbe di uno e la tabella
     di un altro. */
  const mt = p.misureTarget || (D.target_fisico ? D.target_fisico.misure : null);
  D.misure = D.misure.map(m => ({
    ...m, target: mt ? (mt[m.id] ?? null) : (esempio ? m.target : null)
  }));
  /* L'ordine per orario si applica QUI, in lettura, e non solo quando si
     aggiunge uno slot: cosi' vale per il piano di esempio, per una settimana
     arrivata da un file di scambio e per qualunque altra strada — e vale
     ovunque, perche' tutti leggono D.settimana. E' idempotente e non tocca le
     voci senza ora, che restano dove le hai messe trascinandole. */
  D.settimana = D.settimana.map(g => ({
    ...g,
    pasti: (g.pasti || []).map(x => ({ ...x })),
    totali: totaliGiorno(g)
  }));
  // prima l'id, che nasce dalla posizione, e solo dopo l'ordine per orario
  assegnaIdPasti();
  for (const g of D.settimana) g.pasti = ordinaSlotOrari(g.pasti);
}

/**
 * L'integrazione, fusa come tutto il resto.
 *
 * Era una lista fissa dentro data/dieta.json: cinque voci uguali per chiunque,
 * non togliibili e non modificabili. Ma l'integrazione e' la parte piu'
 * personale del piano — dipende da cosa mangi, da cosa ti ha detto il medico,
 * da cosa hai in casa — e una lista che non si tocca la si smette
 * semplicemente di guardare.
 *
 * Ora la base resta la base, e sopra ci va il tuo strato: modifiche, aggiunte,
 * e rimozioni marcate come tolte invece che cancellate: cosi' se cambi idea la
 * voce di partenza e' ancora li'.
 *
 * Con il piano vuoto non si eredita niente: le cinque voci sono le scelte di
 * un'altra persona, esattamente come i pasti.
 */
function fondiIntegratori(esempio) {
  const mio = piano().integratori || {};
  const base = esempio ? DBASE.integratori : [];
  const out = [];
  for (const s of base) {
    const m = mio[s.nome];
    if (m?.tolto) continue;
    out.push(m ? { ...s, ...m } : s);
  }
  for (const [nome, v] of Object.entries(mio)) {
    if (v.tolto || base.some(s => s.nome === nome)) continue;
    out.push({ ...v, nome, mio: true });
  }
  return out;
}

/** Tocca oggi? Vale per i giornalieri; i settimanali hanno una logica loro. */
function integratoreOggi(s, k = today()) {
  return s.cadenza !== 'settimanale';
}

/**
 * Lo stato SETTIMANALE di un integratore a cadenza settimanale.
 *
 * Il filtro "mostra solo quello che tocca oggi" era giusto per i giornalieri
 * e sbagliato per questi: la B12 spariva sei giorni su sette, e chi se la
 * dimenticava il lunedi non poteva piu' segnarla da nessuna parte. Ma una B12
 * presa di martedi e' comunque presa — quello che conta e' che nella settimana
 * ci sia, non il giorno esatto.
 *
 * Quindi si guarda la settimana intera: se e' gia' stata presa la riga dice
 * quando ed e' chiusa, se non ancora resta li' finche' non la segni, in
 * qualunque giorno.
 */
function settimanaDi(k = today()) {
  const gi = dayIdx(k);
  const lun = addDays(k, -gi);
  return Array.from({ length: 7 }, (_, i) => addDays(lun, i));
}
function statoSettimanale(s, k = today()) {
  const gg = settimanaDi(k);
  const preso = gg.find(g => S.log[g]?.integratori?.[s.nome]);
  return { preso: preso || null, giorni: gg,
           toccava: gg[Math.min(6, Math.max(0, s.giorno ?? 0))],
           passato: dayIdx(k) >= (s.giorno ?? 0) };
}

/** Quante volte l'hai preso, sui giorni in cui toccava. */
function aderenzaIntegratore(nome, k = today(), n = 30) {
  const s = D.integratori.find(x => x.nome === nome);
  if (!s) return null;
  if (s.cadenza === 'settimanale') {
    // su quattro settimane, in quante c'e' almeno una presa: contare i giorni
    // darebbe 4 su 30 anche a chi non ne ha saltata nemmeno una
    const sett = [];
    for (let w = 0; w < Math.round(n / 7); w++) {
      const gg = settimanaDi(addDays(k, -7 * w))
        .filter(g => g <= k && (typeof inPausa !== 'function' || !inPausa(g)));
      if (gg.length) sett.push(gg.some(g => S.log[g]?.integratori?.[nome]));
    }
    if (!sett.length) return null;
    const presi = sett.filter(Boolean).length;
    return { presi, su: sett.length, pct: Math.round(presi / sett.length * 100),
             unita: 'settimane' };
  }
  const gg = windowDays(k, n).filter(g => (typeof inPausa !== 'function' || !inPausa(g)));
  if (!gg.length) return null;
  const presi = gg.filter(g => S.log[g]?.integratori?.[nome]).length;
  return { presi, su: gg.length, pct: Math.round(presi / gg.length * 100), unita: 'giorni' };
}

/* ------------------------------------------------------------- editor */
const CADENZE = ['giornaliera', 'settimanale'];
const PRIORITA_INT = ['obbligatorio', 'alto valore', 'consigliato', 'cibo'];

function sezIntegratori(v) {
  const p = piano();
  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come funziona</div>
     <div class="muted">Quello che prendi lo decidi tu: aggiungi, cambia la dose
     o togli una voce. Le modifiche valgono solo per questo profilo, e il file di
     partenza resta com'e'. Cambiando la lista cambiano anche i promemoria del
     calendario, che si generano da qui.</div>`));

  const c = el('div', 'card');
  c.append(el('h2', 'sec', `In elenco (${D.integratori.length})`));
  c.lastChild.style.marginTop = '0';
  if (!D.integratori.length)
    c.append(el('p', 'muted', 'Nessun integratore. Se non ne prendi, va benissimo cosi\'.'));
  for (const s of D.integratori) {
    const ad = aderenzaIntegratore(s.nome);
    const r = el('button', 'prod');
    r.innerHTML = `<div class="grow"><div class="nm">${esc(s.nome)}${
        s.mio ? ' <span class="pill ok">tuo</span>' : ''}</div>
      <div class="mt">${esc(s.dose || '')} · ${esc(s.cadenza || '')}${
        s.ora ? ' · ' + esc(s.ora) : ''}</div></div>
      ${ad ? `<div class="kc">${ad.pct}%<br><span class="mt">${ad.presi}/${ad.su} ${esc(ad.unita || '')}</span></div>` : ''}`;
    r.onclick = () => sheetIntegratore(s.nome);
    c.append(r);
  }
  const b = el('button', 'btn wide pri', 'Aggiungine uno');
  b.style.marginTop = '10px';
  b.onclick = () => sheetIntegratore(null);
  c.append(b);
  v.append(c);

  v.append(el('div', 'card flat',
    `<div class="eyebrow">La percentuale a destra</div>
     <div class="muted">E' quante volte l'hai segnato sui giorni in cui toccava,
     negli ultimi trenta — i giorni in pausa non contano. Serve a vedere quale
     salti davvero: di solito non e' quello che credi.</div>`));
}

function sheetIntegratore(nome) {
  const p = piano();
  const cur = nome ? D.integratori.find(x => x.nome === nome) : null;
  const nuovo = !cur;
  const w = el('div');
  w.append(el('div', 'eyebrow', nuovo ? 'Nuovo' : (cur.mio ? 'Tuo' : 'Del piano di base')));
  w.append(el('h2', 'sec', nuovo ? 'Aggiungi' : esc(cur.nome)));
  w.lastChild.style.marginTop = '0';

  const campo = (id, lab, val, ph) => el('div', 'field',
    `<label>${lab}</label><input type="text" id="in-${id}" value="${
      val != null ? esc(String(val)) : ''}"${ph ? ` placeholder="${ph}"` : ''}>`);
  if (nuovo) w.append(campo('nome', 'Nome', '', 'Magnesio bisglicinato'));
  w.append(campo('dose', 'Dose', cur?.dose, '2000 mcg'));

  let cad = cur?.cadenza || 'giornaliera';
  w.append(el('div', 'eyebrow', 'Ogni quanto'));
  const seg = el('div', 'seg');
  const boxG = el('div', 'field');
  for (const cx of CADENZE) {
    const b = el('button', null, cx);
    b.setAttribute('aria-pressed', cad === cx);
    b.onclick = () => { cad = cx;
      [...seg.children].forEach(x => x.setAttribute('aria-pressed', x === b));
      boxG.hidden = cad !== 'settimanale'; };
    seg.append(b);
  }
  w.append(seg);
  const NOMI = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
  const selG = el('select');
  selG.id = 'in-giorno';
  selG.style.cssText = 'width:100%;padding:9px 10px;border:1px solid var(--rule);'
    + 'border-radius:9px;background:var(--paper);color:var(--ink);font:inherit';
  for (const [i, n] of NOMI.entries())
    selG.append(new Option(n, i, false, i === (cur?.giorno ?? 0)));
  boxG.innerHTML = '<label>Che giorno</label>';
  boxG.append(selG);
  boxG.hidden = cad !== 'settimanale';
  w.append(boxG);

  w.append(campo('ora', 'A che ora', cur?.ora || '09:30', '09:30'));
  let pri = cur?.priorita || 'consigliato';
  w.append(el('div', 'eyebrow', 'Quanto conta'));
  const segP = el('div', 'seg wrap');
  for (const px of PRIORITA_INT) {
    const b = el('button', null, px);
    b.setAttribute('aria-pressed', pri === px);
    b.onclick = () => { pri = px;
      [...segP.children].forEach(x => x.setAttribute('aria-pressed', x === b)); };
    segP.append(b);
  }
  w.append(segP);
  w.append(campo('nota', 'Nota', cur?.nota, 'Con un pasto che contiene grassi'));

  const salva = el('button', 'btn wide pri', 'Salva');
  salva.style.marginTop = '12px';
  salva.onclick = () => {
    const n = nuovo ? $('#in-nome').value.trim() : cur.nome;
    if (!n) { toast('Serve il nome'); return; }
    p.integratori[n] = {
      dose: $('#in-dose').value.trim(), cadenza: cad,
      giorno: cad === 'settimanale' ? +selG.value : undefined,
      ora: $('#in-ora').value.trim() || '09:30',
      priorita: pri, nota: $('#in-nota').value.trim() || undefined
    };
    save(); fondiPiano(); closeSheet(); route(); toast('Salvato');
  };
  w.append(salva);

  if (!nuovo) {
    const via = el('button', 'btn wide', 'Toglilo dall\'elenco');
    via.style.marginTop = '8px';
    via.onclick = () => {
      // marcato, non cancellato: se cambi idea la voce di base e' ancora li'
      p.integratori[cur.nome] = { tolto: true };
      save(); fondiPiano(); closeSheet(); route();
      toast('Tolto: puoi rimetterlo quando vuoi');
    };
    w.append(via);
    if (!cur.mio && p.integratori[cur.nome] && !p.integratori[cur.nome].tolto) {
      const rip = el('button', 'btn wide', 'Torna alla voce di base');
      rip.style.marginTop = '8px';
      rip.onclick = () => {
        delete p.integratori[cur.nome];
        save(); fondiPiano(); closeSheet(); route();
      };
      w.append(rip);
    }
  }
  w.append(el('p', 'note',
    'L\'app non sa cosa ti serve: non misura il sangue e non conosce la tua storia. '
    + 'Tiene l\'elenco che le dai, ti ricorda quando toccano e ti mostra quali '
    + 'salti davvero. Cosa prendere si decide altrove.'));
  sheet(w);
}

/** Somma dei pasti previsti in un giorno del piano. */
function totaliGiorno(g) {
  const t = M0();
  for (const s of g.pasti || []) {
    const pa = pasto(s.codice);
    if (pa && pa.macro) addM(t, pa.macro);
  }
  for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) t[x] = Math.round(t[x] * 10) / 10;
  return t;
}

/** Macro di un ricetta composta: somma degli ingredienti pesati. */
function macroDaIngredienti(ing) {
  const t = M0();
  for (const i of ing) addM(t, foodM(i.alimento, i.qta));
  for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) t[x] = Math.round(t[x] * 10) / 10;
  return t;
}

/* ========================================================== primo avvio */
/**
 * Gate del primo avvio. Finche' non si sceglie, l'app non mostra il piano di
 * nessun altro: e' la differenza fra "app con dentro la dieta di Salvatore" e
 * "app che ti fa la tua".
 */
function pianoScelto() { return !!S.settings?.pianoBase; }

/**
 * Gli interruttori dei moduli.
 * Sta al primo avvio e dentro il passo "Chi sei", perche' e' li' che si decide
 * che app si vuole. Spegnere non cancella: i dati restano e riaccendendo
 * tornano, e la carta lo dice invece di lasciarlo temere.
 */
function cardModuli() {
  const c = el('div', 'card');
  c.append(el('div', 'eyebrow', 'Cosa ti serve'));
  c.append(el('p', 'muted',
    'Due parti dell\'app si possono spegnere. Spegnerle non cancella niente: '
    + 'quello che hai gia\' scritto resta dov\'e\' e riaccendendole torna tutto.'));

  const M = moduli();
  const voce = (chiave, tit, acceso, spento) => {
    const on = M[chiave] === true || (chiave === 'piano' && M[chiave] !== false);
    const r = el('button', 'mod-r' + (on ? ' on' : ''));
    r.innerHTML = '<span class="mod-sw" aria-hidden="true"><i></i></span>'
      + '<span class="body"><span class="t">' + esc(tit) + '</span>'
      + '<span class="d">' + (on ? acceso : spento) + '</span></span>';
    r.setAttribute('role', 'switch');
    r.setAttribute('aria-checked', String(on));
    r.onclick = () => {
      M[chiave] = !on;
      save();
      // il piano cambia le barre e la tab bar: si ridisegna tutto
      if (typeof fondiPiano === 'function') fondiPiano();
      route();
      toast(!on ? 'Acceso' : 'Spento: i dati restano dove sono');
    };
    c.append(r);
  };

  voce('piano', 'Piano alimentare',
    'Ricette assegnate ai sette giorni, lista della spesa, sostituzioni. La scheda Oggi ti dice cosa mangiare.',
    'Nessuna ricetta assegnata: scrivi giorno per giorno quello che mangi e l\'app lo confronta con i tuoi target. Niente lista della spesa.');
  voce('hyrox', 'Road to HYROX',
    'Conto alla rovescia, programma fino alla gara, stazioni e simulazioni dentro la scheda Gym.',
    'La sezione non compare in Gym. La palestra funziona lo stesso, con tutto il resto.');

  c.append(el('p', 'note',
    'I target giornalieri, il peso, la previsione, la palestra, le foto e la revisione '
    + 'settimanale funzionano in tutti e due i casi: non dipendono dal piano.'));
  return c;
}

function viewBenvenuto(v) {
  const c = el('div', 'card');
  c.append(el('div', 'eyebrow', 'Primo avvio'));
  c.append(el('h2', 'sec', 'Da cosa vuoi partire?'));
  c.lastChild.style.marginTop = '0';
  c.append(el('p', 'muted',
    'L\'app funziona in due modi. Puoi costruire il tuo piano da zero, oppure caricare quello vegano di esempio e poi cambiarlo come vuoi. In entrambi i casi tutto resta modificabile.'));
  v.append(c);

  const vuoto = el('button', 'step mio');
  vuoto.innerHTML = `<span class="n">1</span>
    <span class="body">
      <span class="t">Comincio da zero</span>
      <span class="d">Metti i tuoi dati e i tuoi target, componi i pasti che mangi davvero.</span>
      <span class="s">Consigliato · resta il database di ${Object.keys(DBASE.alimenti).length} alimenti per comporre i pasti</span>
    </span><span class="go">›</span>`;
  vuoto.onclick = () => { S.settings.pianoBase = 'vuoto'; save(); fondiPiano();
    pianoTab = 'profilo'; apri('#/piano'); };
  v.append(vuoto);

  const esempio = el('button', 'step');
  esempio.innerHTML = `<span class="n">2</span>
    <span class="body">
      <span class="t">Carica il piano vegano di esempio</span>
      <span class="d">Un piano completo gia' pronto: ${Object.keys(DBASE.pasti).length} pasti su sette giorni, ${nf(DBASE.target.kcal)} kcal e ${DBASE.target.p} g di proteine.</span>
      <span class="s">Attenzione: contiene i dati di un'altra persona (eta', altezza, peso, misure). Cambiali dal passo "Chi sei".</span>
    </span><span class="go">›</span>`;
  esempio.onclick = () => {
    if (!confirm('Il piano di esempio porta con se\' profilo, target, ricette e misure di partenza di un\'altra persona. Li vedrai finche\' non li cambi. Procedo?')) return;
    S.settings.pianoBase = 'esempio'; save(); fondiPiano();
    apri('#/oggi');
  };
  v.append(esempio);

  v.append(cardModuli());

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Si puo' cambiare idea</div>
     <div class="muted">Da Impostazioni puoi caricare l'esempio anche dopo, o
     ricominciare da zero. Quello che hai gia' scritto tu non viene toccato.
     Anche gli interruttori qui sopra si spostano quando vuoi, dal passo
     "Chi sei".</div>`));
}

/* =============================================================== vista */
/* Il piano si costruisce in cinque passi, in ordine: chi sei, quanto mangiare,
   cosa mangi, come lo combini, quando. Prima erano cinque schede con etichette
   secche e nessuna spiegazione: non si capiva ne' cosa fossero ne' da dove
   cominciare. Ora ogni passo dice cosa fa, perche' serve e a che punto sei. */
let pianoTab = null;

/** Stato dei cinque passi: dire cosa manca vale piu' che farlo cercare. */
function pianoPassi() {
  const p = piano();
  const nAli = Object.keys(p.alimenti).length;
  const nPas = Object.keys(p.pasti).length;
  const baseAli = Object.keys(DBASE.alimenti).length;
  const basePas = Object.keys(DBASE.pasti).length;
  return [
    { id: 'profilo', t: 'Chi sei',
      d: 'Nome, età, altezza, peso di partenza, sesso.',
      perche: 'Servono a stimare il dispendio a riposo e a disegnare in scala la figura della scheda Corpo. Senza, l’app usa i dati di esempio.',
      mio: Object.keys(p.profilo).length > 0,
      // con il piano vuoto nome, eta' e altezza sono nulli: usciva
      // ", null anni, null cm"
      stato: [D.profilo.nome ? esc(D.profilo.nome) : null,
              D.profilo.eta ? D.profilo.eta + ' anni' : null,
              D.profilo.altezza_cm ? D.profilo.altezza_cm + ' cm' : null]
        .filter(Boolean).join(', ') || 'ancora da compilare' },
    { id: 'target', t: 'Quanto mangiare',
      d: 'Calorie e macro da centrare ogni giorno.',
      perche: 'E’ il metro con cui l’app giudica le giornate: analisi, cruscotto, consigli e previsione del peso partono tutti da qui.',
      mio: Object.keys(p.target).length > 0,
      // a zero i target non sono target: targetNeutro() non puo' calcolarli
      // finche' non c'e' il profilo, e dirlo e' piu' utile di "0 kcal"
      stato: D.target.kcal > 0
        ? `${nf(D.target.kcal)} kcal · ${D.target.p} P · ${D.target.c} C · ${D.target.g} G · ${D.target.fibre} fibre`
        : 'si calcolano appena metti peso, altezza ed eta\'' },
    { id: 'integratori', t: 'Cosa integri',
      d: 'Aggiungi, cambia o togli quello che prendi.',
      perche: 'Da qui escono la checklist del diario e i promemoria del calendario. E' + '\u2019 la parte piu' + '\u2019 personale del piano: la lista di partenza vale per chi l' + '\u2019 ha scritta, non per forza per te.',
      mio: Object.keys(p.integratori).length > 0,
      stato: D.integratori.length ? D.integratori.length + ' voci' : 'nessuna' },
    ...(usaPiano() ? [
    { id: 'alimenti', t: 'Lista ingredienti',
      d: 'Tutto quello che mangi, in un elenco solo: a mano, col codice a barre o da internet.',
      perche: 'Sono i mattoni delle ricette. Puoi saltare questo passo: i ' + baseAli + ' del piano di partenza bastano per cominciare.',
      mio: nAli > 0,
      stato: nAli ? `${nAli} tuoi, oltre ai ${baseAli} di base` : `${baseAli} di base, nessuno tuo` },
    { id: 'pasti', t: 'Le tue ricette',
      d: 'Componi le ricette pesando gli ingredienti.',
      perche: 'I macro si calcolano da soli mentre aggiungi. Una ricetta composta qui puoi assegnarla a qualunque giorno della settimana.',
      mio: nPas > 0,
      stato: nPas ? `${nPas} tuoi, oltre ai ${basePas} di base` : `${basePas} di base, nessuno tuo` },
    { id: 'settimana', t: 'Quando li mangi',
      d: 'Assegna le ricette ai pasti dei sette giorni.',
      perche: 'E’ quello che vedi nella scheda Oggi: da qui escono le barre dei macro, il totale residuo e la lista della spesa.',
      mio: !!p.settimana,
      stato: p.settimana ? 'riorganizzata da te' : 'quella del piano di partenza' }
    ] : [])
  ];
}

function viewPiano(v) {
  if (pianoTab) return pianoSezione(v);

  /* --- profilo attivo --- */
  const P0 = profili();
  const cp = el('div', 'card');
  cp.append(el('div', 'eyebrow', 'Stai modificando il profilo'));
  const sel = el('select');
  sel.style.cssText = 'width:100%;padding:11px;border:1px solid var(--rule);border-radius:9px;'
    + 'background:var(--paper);color:var(--ink);font:inherit;font-weight:600;margin:6px 0 10px';
  for (const x of P0.lista) sel.append(new Option(x.nome, x.id, false, x.id === P0.attivo));
  sel.onchange = () => cambiaProfilo(sel.value);
  cp.append(sel);
  const bn = el('button', 'btn wide', 'Crea un secondo profilo');
  bn.onclick = () => {
    const n = prompt('Nome del profilo (per esempio: Marco)');
    if (!n || !n.trim()) return;
    creaProfilo(n.trim()); location.reload();
  };
  cp.append(bn);
  cp.append(el('p', 'hint',
    'Ogni profilo ha il suo diario, il suo piano, le sue foto e la sua palestra, separati del tutto. Il piano di partenza e’ lo stesso file per tutti: quello che cambi vale solo per il profilo attivo.'));
  if (P0.lista.length > 1 && P0.attivo !== 'principale') {
    const bd = el('button', 'btn wide');
    bd.style.marginTop = '8px';
    bd.textContent = 'Elimina questo profilo';
    bd.onclick = () => {
      if (!confirm(`Eliminare "${profiloAttivo().nome}" con tutto il suo diario? Non si puo’ annullare.`)) return;
      localStorage.removeItem(chiaveStato());
      const p = profili();
      p.lista = p.lista.filter(x => x.id !== p.attivo);
      p.attivo = p.lista[0].id; salvaProfili(p);
      location.reload();
    };
    cp.append(bd);
  }
  v.append(cp);

  /* Le calorie giorno per giorno stanno **in cima al piano**, non solo dentro
     il passo della settimana: chi apre il piano vuole sapere prima di tutto se
     quello che ha costruito regge, e per saperlo non deve entrare in un passo. */
  if (usaPiano() && typeof cardControlloPiano === 'function') {
    const cc = cardControlloPiano(today(), true);
    if (cc) v.append(cc);
  }

  /* --- che cos'e' un piano --- */
  const passi = pianoPassi();
  const miei = passi.filter(x => x.mio).length;
  // con il piano spento le domande sono due, non cinque: dirne cinque e
  // mostrarne due sembrerebbe un pezzo mancante
  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come funziona</div>
     <div class="muted">${usaPiano()
       ? `Un piano risponde a cinque domande, in quest’ordine:
          <strong>chi sei</strong>, <strong>quanto mangiare</strong>, <strong>cosa</strong>,
          <strong>come lo combini</strong>, <strong>quando</strong>.`
       : `Con il piano alimentare spento restano le due domande che contano comunque:
          <strong>chi sei</strong> e <strong>quanto mangiare</strong>. Da lì escono i
          target contro cui l’app misura quello che registri ogni giorno.`}
     Puoi fermarti a qualsiasi punto: quello che non tocchi resta come nel piano
     di partenza, e l’app continua a funzionare.</div>
     <div class="hint" style="margin-top:8px">Hai personalizzato ${miei} passi su ${passi.length}.</div>`));

  /* --- i passi --- */
  for (const [i, s] of passi.entries()) {
    const c = el('button', 'step' + (s.mio ? ' mio' : ''));
    c.innerHTML = `<span class="n">${i + 1}</span>
      <span class="body">
        <span class="t">${esc(s.t)}</span>
        <span class="d">${s.d}</span>
        <span class="s">${s.mio ? 'Personalizzato' : 'Come il piano di base'} · ${s.stato}</span>
      </span>
      <span class="go">›</span>`;
    c.onclick = () => { pianoTab = s.id; route(); };
    v.append(c);
  }
  if (typeof osserva === 'function' && v.querySelector('.step'))
    osserva(v.querySelector('.step'),
      () => entrata([...v.querySelectorAll('.step')], { passo: 55, su: 10 }));

  const base = el('div', 'card flat');
  base.append(el('div', 'eyebrow', 'Piano di partenza'));
  base.append(el('div', 'muted', S.settings.pianoBase === 'esempio'
    ? 'Stai usando il piano vegano di esempio come base.'
    : 'Stai costruendo il piano da zero: nessuna ricetta preimpostata.'));
  const alt = el('button', 'btn wide');
  alt.style.marginTop = '8px';
  alt.textContent = S.settings.pianoBase === 'esempio'
    ? 'Svuota e riparti da zero' : 'Carica il piano vegano di esempio';
  alt.onclick = () => {
    const verso = S.settings.pianoBase === 'esempio' ? 'vuoto' : 'esempio';
    if (!confirm(verso === 'esempio'
      ? 'Carico il piano di esempio come base. Quello che hai gia\' modificato tu resta com\'e\'.'
      : 'Tolgo il piano di esempio. Restano solo le tue modifiche e il database degli alimenti.')) return;
    S.settings.pianoBase = verso; save(); fondiPiano(); route();
    toast(verso === 'esempio' ? 'Esempio caricato' : 'Piano svuotato');
  };
  base.append(alt);
  v.append(base);

  /* --- passarlo, o farselo passare --- */
  const sc = el('div', 'card flat');
  sc.append(el('div', 'eyebrow', 'Passalo a qualcuno'));
  sc.append(el('div', 'muted',
    'Un file JSON con il piano e basta: target, alimenti tuoi, ricette, settimana, '
    + 'integratori. Non il diario, non le pesate, non le foto — quelli sono tuoi '
    + 'e non servono a chi riceve il piano. Caricandone uno si aggiunge al tuo: '
    + 'sui nomi che esistono gia’ te lo chiede prima.'));
  const bsc = el('button', 'btn wide', 'Esporta o importa un piano');
  bsc.style.marginTop = '8px';
  bsc.onclick = () => sheetScambio();
  sc.append(bsc);
  v.append(sc);

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Se ti sei perso</div>
     <div class="muted">Il caso piu’ comune sono i primi due passi e basta: metti i tuoi
     dati e i tuoi target, e continui a usare i pasti gia’ pronti. Comporre pasti e
     riorganizzare la settimana serve solo se il piano di partenza non ti va bene.</div>`));
}

/** Una sezione aperta, con l'intestazione che dice sempre dove sei. */
function pianoSezione(v) {
  const passi = pianoPassi();
  const i = passi.findIndex(x => x.id === pianoTab);
  // i passi non sono sempre gli stessi sei: col piano alimentare spento sono
  // due, e chiedere un passo che in questa configurazione non esiste faceva
  // morire il disegno su `s.t` — una pagina bianca invece dell'elenco
  if (i < 0) { pianoTab = null; return viewPiano(v); }
  const s = passi[i];

  const testa = el('div', 'card');
  const back = el('button', 'btn sm', '‹ Il piano');
  back.onclick = () => { pianoTab = null; route(); };
  testa.append(back);
  testa.append(el('div', 'eyebrow', `Passo ${i + 1} di ${passi.length}`));
  testa.lastChild.style.marginTop = '10px';
  /* Il titolo del passo, e accanto quello che si puo' fare al passo intero.
     Per adesso ce l'ha solo la settimana: il piano su carta e' un'azione su
     tutti e sette i giorni, quindi non ha una casa dentro nessuno di loro. */
  const tit = el('div', 'row between');
  tit.style.marginTop = '2px';
  tit.append(el('h2', 'sec', esc(s.t)));
  tit.firstChild.style.marginTop = '0';
  if (pianoTab === 'settimana' && typeof pdfPiano === 'function') {
    const dl = el('button', 'btn-piu btn-ico');
    dl.title = 'Scarica il piano in PDF';
    dl.setAttribute('aria-label', 'Scarica il piano in PDF');
    dl.append(icona('download', { size: 18 }));
    dl.onclick = () => scaricaPiano();
    tit.append(dl);
  }
  testa.append(tit);
  testa.append(el('p', 'muted', s.perche));
  v.append(testa);

  ({ profilo: sezProfilo, target: sezTarget, alimenti: sezAlimenti,
     integratori: sezIntegratori,
     pasti: sezPasti, settimana: sezSettimana }[pianoTab])(v);

  const nav = el('div', 'row between');
  nav.style.marginTop = '4px';
  if (i > 0) {
    const p = el('button', 'btn sm', '‹ ' + passi[i - 1].t);
    p.onclick = () => { pianoTab = passi[i - 1].id; route(); };
    nav.append(p);
  } else nav.append(el('span'));
  if (i < passi.length - 1) {
    const n = el('button', 'btn sm pri', passi[i + 1].t + ' ›');
    n.onclick = () => { pianoTab = passi[i + 1].id; route(); };
    nav.append(n);
  } else {
    const n = el('button', 'btn sm pri', 'Ho finito');
    n.onclick = () => { pianoTab = null; route(); };
    nav.append(n);
  }
  v.append(nav);
}

/* ------------------------------------------------------------ dati utente */
/**
 * Chi sei.
 *
 * L'ordine e' cambiato, e non e' un dettaglio di gusto. Prima veniva "cosa ti
 * serve" — gli interruttori dei moduli — e solo dopo il nome e l'eta': si
 * apriva il primo passo del piano e la prima domanda era quali parti dell'app
 * spegnere, cioe' una scelta che si puo' fare solo dopo aver capito cosa fa.
 *
 * Ora: chi sei (le foto, se ci sei gia'), i dati che servono ai conti, e in
 * fondo cosa ti serve — che e' la domanda giusta da fare per ultima, quando
 * hai gia' visto il resto.
 */
function profiloCompilato() {
  const p = D.profilo || {};
  return !!(p.nome && p.altezza_cm > 0 && p.eta > 0);
}

function sezProfilo(v) {
  const p = piano();
  // le anteprime sono blob URL: senza questo se ne accumula una terna a ogni
  // ridisegno della schermata
  if (typeof liberaUrl === 'function') liberaUrl();

  /* --- 1. tu, come ti vedi cambiare ---
     Sta sopra ai numeri perche' e' l'unica parte di questa schermata che parla
     di te e non dei tuoi dati. Compare solo a profilo fatto: al primo avvio
     sarebbe una scatola vuota davanti a un modulo da riempire. */
  if (profiloCompilato()) v.append(cardFotoProfilo());

  /* --- 2. i dati anagrafici --- */
  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'I tuoi dati'));
  c.lastChild.style.marginTop = '0';
  c.append(el('p', 'muted',
    'Servono al calcolo del dispendio a riposo e alla figura in scala. '
    + 'Restano su questo telefono: l\'app non ha un server a cui mandarli.'));
  const campo = (id, lab, val, unit) => el('div', 'field',
    `<label>${lab}${unit ? ` <span class="muted">(${unit})</span>` : ''}</label>
     <input type="text" inputmode="${id === 'nome' ? 'text' : 'decimal'}" id="pf-${id}"
            value="${val != null ? esc(String(val)) : ''}">`);
  c.append(campo('nome', 'Nome', D.profilo.nome));
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  g.append(campo('eta', 'Eta', D.profilo.eta, 'anni'),
           campo('altezza_cm', 'Altezza', D.profilo.altezza_cm, 'cm'),
           campo('peso_iniziale_kg', 'Peso di partenza', D.profilo.peso_iniziale_kg, 'kg'));
  c.append(g);

  const fs = el('div', 'field', '<label>Sesso</label>');
  const ss = el('div', 'seg');
  for (const [val, lab] of [['m', 'Uomo'], ['f', 'Donna']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', D.profilo.sesso === val);
    b.onclick = () => { p.profilo.sesso = val; save(); fondiPiano(); route(); };
    ss.append(b);
  }
  fs.append(ss); c.append(fs);
  c.append(el('div', 'hint',
    'Il sesso entra solo nella formula di Mifflin-St Jeor (+5 per gli uomini, −161 per le donne), nella stima del grasso — che ha coefficienti diversi — e nella silhouette della mappa muscolare.'));

  const b = el('button', 'btn wide pri', 'Salva');
  b.onclick = () => {
    p.profilo.nome = $('#pf-nome').value.trim() || 'Utente';
    for (const id of ['eta', 'altezza_cm', 'peso_iniziale_kg']) {
      const n = parseNum($('#pf-' + id).value);
      if (n != null && n > 0) p.profilo[id] = n;
    }
    save(); fondiPiano(); route(); toast('Profilo aggiornato');
  };
  c.append(b);
  v.append(c);

  /* --- 3. cosa ti serve, per ultimo --- */
  v.append(cardModuli());
}

/**
 * Le foto dei progressi, viste da qui.
 *
 * Non e' un doppione della scheda Foto: li' si scatta e si confronta, qui si
 * vede a colpo d'occhio se il filo c'e' ancora. Il numero che conta non e'
 * quante foto hai ma da quanto non ne fai una: e' la costanza a rendere
 * confrontabili due scatti, non la qualita' del singolo.
 */
function cardFotoProfilo() {
  const c = el('div', 'card');
  c.append(el('div', 'row between',
    '<div><div class="eyebrow">Come ti vedi cambiare</div>'
    + '<div class="tname">Le tue foto</div></div>'));
  const corpo = el('div');
  c.append(corpo);
  corpo.append(el('p', 'muted', 'Carico…'));

  const vai = el('button', 'btn wide');
  vai.style.marginTop = '10px';
  vai.textContent = 'Apri le foto dei progressi';
  vai.onclick = () => { apri('#/foto'); };
  c.append(vai);

  if (typeof fotoTutte === 'function') fotoTutte().then(tutte => {
    corpo.innerHTML = '';
    if (!tutte.length) {
      corpo.append(el('p', 'muted',
        'Nessuno scatto ancora. Il primo e\' il riferimento: da li\' in poi ogni '
        + 'confronto ha senso, e in un mese si vede quello che la bilancia non dice.'));
      return;
    }
    const ultime = new Map();
    for (const f of tutte) {
      const q = ultime.get(f.posa);
      if (!q || f.giorno > q.giorno) ultime.set(f.posa, f);
    }
    const ultimo = tutte.reduce((a, b2) => a.giorno >= b2.giorno ? a : b2);
    const gg = Math.round((new Date(today()) - new Date(ultimo.giorno)) / 864e5);
    corpo.append(el('div', 'read',
      `<span><b>${tutte.length}</b> ${tutte.length === 1 ? 'scatto' : 'scatti'}</span>`
      + `<span>${ultime.size} ${ultime.size === 1 ? 'posa' : 'pose'}</span>`
      + `<span>${gg === 0 ? 'l\'ultimo oggi' : gg === 1 ? 'l\'ultimo ieri'
        : gg + ' giorni dall\'ultimo'}</span>`));

    const gr = el('div', 'foto-tris');
    for (const [posa, lab] of (typeof POSE !== 'undefined' ? POSE : [])) {
      const f = ultime.get(posa);
      const fig = el('figure');
      if (f) {
        const u = URL.createObjectURL(f.blob);
        if (typeof fotoUrls !== 'undefined') fotoUrls.push(u);
        fig.innerHTML = `<img src="${u}" alt="${esc(lab)}">`
          + `<figcaption>${esc(lab.toLowerCase())} · ${esc(f.giorno.slice(5))}</figcaption>`;
      } else {
        fig.className = 'vuota';
        fig.innerHTML = `<figcaption>${esc(lab.toLowerCase())}<br>mai</figcaption>`;
      }
      gr.append(fig);
    }
    corpo.append(gr);
    if (gg >= 14) corpo.append(el('div', 'hint',
      `L'ultima e' di ${gg} giorni fa. Non c'e' una cadenza giusta, ma sotto le due `
      + 'settimane fra uno scatto e l\'altro il confronto diventa rumore: il corpo '
      + 'non cambia cosi\' in fretta.'));
  }).catch(() => {
    corpo.innerHTML = '';
    corpo.append(el('p', 'muted', 'Archivio foto non disponibile su questo browser.'));
  });
  return c;
}

/* ---------------------------------------------------------------- target */
function sezTarget(v) {
  const p = piano();
  /* L'obiettivo viene PRIMA di tutto: e' la domanda a cui gli altri numeri
     sono la risposta, e finora non la faceva nessuno. */
  if (typeof cardObiettivo === 'function') v.append(cardObiettivo());
  if (typeof cardFisico === 'function') v.append(cardFisico());
  if (typeof cardTarget === 'function') v.append(cardTarget());
  if (typeof cardRampaFibre === 'function') { const rf = cardRampaFibre(); if (rf) v.append(rf); }
  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'Target giornalieri'));
  c.lastChild.style.marginTop = '0';

  /* calcolatore: da qui esce una proposta, non un obbligo */
  const bmr = 10 * (lastWeight() ?? D.profilo.peso_iniziale_kg)
    + 6.25 * D.profilo.altezza_cm - 5 * D.profilo.eta + (D.profilo.sesso === 'm' ? 5 : -161);
  const E = energyModel();
  c.append(el('div', 'card flat',
    `<div class="eyebrow">Da dove partire</div>
     <div class="muted">Metabolismo a riposo stimato <strong>${nf(bmr)} kcal</strong>
     (Mifflin-St Jeor). Il dispendio totale che il motore stima adesso e'
     <strong>${nf(E.tdee)} kcal</strong>${E.n ? ` , ricalibrato ${E.n} volte sui tuoi dati` : ', ancora da formula'}.
     Per crescere piano si sta 10–15% sopra, per dimagrire piano 10–15% sotto.</div>`));

  // niente nf() dentro un input: formatterebbe 2482 come "2.482" e rileggerlo
  // darebbe 2,482 kcal. Nei campi va il numero grezzo.
  const campo = (id, lab, unit) => el('div', 'field',
    `<label>${lab}${unit ? ` <span class="muted">(${unit})</span>` : ''}</label>
     <input type="text" inputmode="decimal" id="tg-${id}" value="${D.target[id] ?? ''}">`);
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  g.append(campo('kcal', 'Calorie', 'kcal'), campo('p', 'Proteine', 'g'),
           campo('c', 'Carboidrati', 'g'), campo('g', 'Grassi', 'g'),
           campo('fibre', 'Fibre', 'g'), campo('acqua_l', 'Acqua', 'L'),
           campo('passi', 'Passi', ''), campo('sonno_h', 'Sonno', 'h'));
  c.append(g);

  const eco = el('div', 'read');
  const ricalcola = () => {
    // Il primo giro e' differito di un tick, e in quel tick la pagina puo'
    // essere gia' stata sostituita: chi apre questo passo e tocca subito una
    // voce che porta altrove lasciava dietro un TypeError. Nessuno se ne
    // accorgeva — l'eco e' un di piu' e non lo aspetta nessuno — ma
    // un'eccezione in console e' la cosa che nasconde quelle vere.
    if (!$('#tg-kcal')) return;
    const k = parseNum($('#tg-kcal').value) || 0, pr = parseNum($('#tg-p').value) || 0;
    const ca = parseNum($('#tg-c').value) || 0, gr = parseNum($('#tg-g').value) || 0;
    const somma = pr * 4 + ca * 4 + gr * 9;
    eco.innerHTML = `<span>Dai macro: <b>${nf(somma)} kcal</b></span>`
      + `<span>${Math.abs(somma - k) < 60 ? 'coerente' : `scarto ${nf(somma - k)} kcal`}</span>`
      + `<span>${lastWeight() ? nf(pr / (lastWeight() || 1), 2) + ' g/kg' : ''}</span>`;
  };
  c.append(eco);
  setTimeout(ricalcola, 0);
  c.querySelectorAll('input').forEach(i => i.oninput = ricalcola);

  const b = el('button', 'btn wide pri', 'Salva target');
  b.onclick = () => {
    for (const id of ['kcal', 'p', 'c', 'g', 'fibre', 'acqua_l', 'passi', 'sonno_h']) {
      const n = parseNum($('#tg-' + id).value);
      if (n != null && n >= 0) p.target[id] = n;
    }
    save(); fondiPiano(); route(); toast('Target aggiornati');
  };
  c.append(b);
  c.append(el('p', 'hint',
    'I macro non devono per forza tornare esatti alle calorie: 4 kcal per grammo di proteine e carboidrati e 9 per i grassi sono valori di tabella, e gli alimenti reali si discostano. Uno scarto sotto le 60 kcal e\' normale.'));

  /* Il target e la settimana pianificata sono due cose diverse: le barre
     della scheda Oggi vengono dalla somma dei pasti previsti, non da qui. Se i
     due numeri divergono l'app lo deve dire, altrimenti si insegue un target
     che nessun pasto del piano puo' centrare.

     Qui resta la **media**, che risponde alla domanda di questo passo ("il
     numero che ho scritto e' quello che il piano produce?"). Il giorno per
     giorno sta nel passo della settimana, dove i giorni si compongono. */
  const cp = typeof controlloPiano === 'function' ? controlloPiano() : null;
  if (cp && cp.pieni) {
    const sotto = cp.sottoPavimento.length;
    if (Math.abs(cp.scartoMedia ?? 0) > 0.08) {
      const f = el('div', 'flag warn');
      /* Il vecchio testo offriva "oppure riporta il target a <media>". Con una
         media sotto il pavimento quello e' un consiglio sbagliato: propone di
         adeguare il metro alla fame, ed e' esattamente il modo in cui un'app
         smette di protestare proprio quando la situazione peggiora. */
      f.innerHTML = `<div class="ico">!</div><div class="grow">
        <h4>Il piano non centra questo target</h4>
        <p>I pasti assegnati fanno in media <strong>${nf(cp.media)} kcal</strong>,
        cioe' ${cp.media > cp.tgt ? nf(cp.media - cp.tgt) + ' in piu\''
          : nf(cp.tgt - cp.media) + ' in meno'} del target che hai impostato. Le barre
        della scheda Oggi seguono i pasti, non questo numero.
        ${cp.media < cp.pav.pavimento
          ? `E quella media e\' sotto il tuo pavimento di ${nf(cp.pav.pavimento)} kcal:
             la strada non e\' abbassare il target fin li\', sono i pasti.`
          : `Per farli coincidere cambia i pasti nella settimana, oppure riporta il
             target a ${nf(cp.media)}.`}</p></div>`;
      c.append(f);
    } else {
      c.append(el('div', 'read',
        `<span>Settimana pianificata: <b>${nf(cp.media)} kcal</b> di media</span>`
        + '<span>coerente col target</span>'));
    }
    if (sotto) {
      const b = el('button', 'flag bad tap');
      b.innerHTML = `<div class="ico">!</div><div class="grow">
        <h4>${sotto === 1 ? 'Un giorno del piano e\' sotto il minimo'
          : sotto + ' giorni del piano sono sotto il minimo'}</h4>
        <p>${esc(cp.sottoPavimento.map(g => g.giorno).join(', '))}: sotto le
        ${nf(cp.pav.pavimento)} kcal calcolate sul tuo corpo. Tocca per vedere
        quali e sistemarli.</p></div>`;
      b.onclick = () => { pianoTab = 'settimana'; route(); };
      c.append(b);
    }
  }

  v.append(c);
}

/* -------------------------------------------------------------- alimenti */
/**
 * "Lista ingredienti" e la vecchia pagina "I tuoi prodotti" sono la stessa schermata.
 *
 * Erano due, con due bottoni "aggiungi", due ricerche su internet e due
 * lettori di codici a barre, e la differenza fra un "alimento" e un "prodotto"
 * era chiara solo a chi aveva scritto il codice. Sotto restano due cose — un
 * alimento e' un nome dentro una ricetta, un prodotto e' una scatola con
 * un'etichetta — ma la domanda di chi usa l'app e' una sola.
 */
function sezAlimenti(v) {
  if (typeof elencoAlimenti === 'function') {
    elencoAlimenti(v, { titolo: 'Lista ingredienti' });
    v.append(el('div', 'card flat',
      `<div class="eyebrow">Come si legge</div>
       <div class="muted">I ${Object.keys(DBASE.alimenti).length} del piano di
       partenza ci sono gia': puoi correggerli e la versione modificata vale solo
       per questo profilo, il file resta com'e'. La <strong>categoria</strong>
       serve al motore delle sostituzioni, che cerca alternative dentro la stessa
       famiglia.</div>`));
    return;
  }
  // ripiego se prodotti.js non e' caricato: meglio un elenco spoglio che niente
  const b = el('button', 'btn wide pri', 'Aggiungi un alimento');
  b.onclick = () => sheetAlimento(null);
  v.append(b);
}

/**
 * L'editor di un alimento.
 * `pre` arriva dalla ricerca su Open Food Facts e riempie i campi; resta un
 * modulo normale, perche' i valori dell'archivio vanno guardati prima di
 * essere accettati, non solo importati.
 */
function sheetAlimento(nome, pre) {
  const p = piano();
  const cur = nome ? D.alimenti[nome] : (pre || null);
  const w = el('div');
  w.append(el('div', 'eyebrow', nome ? 'Alimento' : pre ? 'Da Open Food Facts' : 'Nuovo alimento'));
  w.append(el('h2', 'sec', nome ? esc(nome) : 'Valori per 100 ' + (cur?.unita || 'g')));
  w.lastChild.style.marginTop = '0';

  /* Quello che c'e' scritto nel modulo adesso. Serve a una cosa sola: se apri
     la ricerca e poi torni indietro, i campi devono essere ancora pieni. Un
     foglio che si riapre vuoto fa perdere il lavoro, ed e' un errore gia'
     fatto una volta con l'editor delle schede. */
  const compilato = () => {
    const v = id => ($('#al-' + id)?.value ?? '').trim();
    if (!$('#al-kcal')) return pre;                 // il modulo non c'e' ancora
    return { ...(pre || {}), nome: v('nome'), categoria: v('categoria'),
      kcal: v('kcal'), p: v('p'), c: v('c'), g: v('g'), fibre: v('fibre') };
  };

  /* Il codice a barre sta qui, dove uno ha in mano la confezione. Prima era
     solo dentro la pagina Prodotti, che si raggiunge dal menu in alto a
     destra: la funzione c'era e non la trovava nessuno. */
  if (!nome && typeof leggiCodice === 'function') {
    const bc = el('button', 'btn wide');
    bc.textContent = 'Leggi il codice a barre';
    bc.style.marginBottom = '8px';
    bc.onclick = () => {
      const indietro = compilato();
      leggiCodice(a => {
        if (!a) { sheetAlimento(null, indietro); return; }
        sheetAlimento(null, {
          ...indietro,
          nome: [a.nome, a.marca].filter(Boolean).join(' — ').slice(0, 60)
                || indietro?.nome || '',
          kcal: a.kcal ?? indietro?.kcal, p: a.p ?? indietro?.p,
          c: a.c ?? indietro?.c, g: a.g ?? indietro?.g,
          fibre: a.fibre ?? indietro?.fibre,
          unita: a.unita || indietro?.unita,
          categoria: indietro?.categoria || '',
          barcode: a.codice, origine: a.origine || null,
          /* Il controllo di coerenza vale anche qui: i valori di Open Food
             Facts li inseriscono le persone, e un prodotto che dichiara 30
             kcal con 20 g di proteine e' un errore di battitura, non un
             alimento. Sui prodotti gia' registrati non serve: quei numeri li
             ha scritti l'utente leggendo l'etichetta. */
          avviso: a.origine && typeof coerenza === 'function' ? coerenza(a) : null
        });
      });
    };
    w.append(bc);
  }

  /* la ricerca online: solo sui nuovi, e solo se il file c'e' */
  if (!nome && typeof sheetCercaAlimento === 'function') {
    const cerca = el('button', 'btn wide');
    cerca.textContent = pre ? 'Cerca un altro prodotto' : 'Cerca su internet';
    cerca.style.marginBottom = '12px';
    cerca.onclick = () => {
      const indietro = compilato();
      const q = ($('#al-nome')?.value || '').trim();   // parte da cio' che hai scritto
      sheetCercaAlimento(a => {
        if (!a) { sheetAlimento(null, indietro); return; }
        sheetAlimento(null, {
          nome: [a.nome, a.marca].filter(Boolean).join(' — ').slice(0, 60),
          kcal: a.kcal, p: a.p, c: a.c, g: a.g, fibre: a.fibre,
          unita: a.unita, categoria: indietro?.categoria || '', fonte: 'stima',
          origine: 'openfoodfacts', barcode: a.codice, avviso: a.coerenza
        });
      }, q);
    };
    w.append(cerca);
  }
  if (pre?.avviso && pre.avviso.d) {
    const av = el('div', 'hint' + (pre.avviso.stato === 'incoerente' ? ' acciacco' : ''));
    av.innerHTML = '<strong>Controlla questi numeri.</strong> ' + esc(pre.avviso.d);
    w.append(av);
  }
  /* Se i valori di questo alimento vengono dall'etichetta di un prodotto, va
     detto QUI: e' il posto dove uno li guarda, e senza quella riga sembrano
     numeri usciti dal nulla — o peggio, si prova a correggerli a mano senza
     capire perche' tornano quelli di prima. */
  const pr = nome && typeof overrideDi === 'function' ? overrideDi(nome) : null;
  if (pr) {
    const box = el('div', 'card flat');
    box.append(el('div', 'eyebrow', 'I numeri vengono da un\'etichetta'));
    box.append(el('div', 'muted',
      `<strong>${esc(pr.nome)}</strong>${pr.marca ? ' · ' + esc(pr.marca) : ''}`
      + `${pr.barcode ? ' · ' + esc(pr.barcode) : ''}. Finche' e' collegato, quello `
      + 'che scrivi qui sotto non cambia i conti: li decide il prodotto.'));
    const b2 = el('button', 'btn wide');
    b2.style.marginTop = '9px';
    b2.textContent = 'Apri il prodotto';
    b2.onclick = () => sheetProdotto(pr);
    box.append(b2);
    w.append(box);
  }

  const campo = (id, lab, val, mode) => el('div', 'field',
    `<label>${lab}</label><input type="text" inputmode="${mode || 'decimal'}"
      id="al-${id}" value="${val != null ? esc(String(val)) : ''}">`);
  if (!nome) w.append(campo('nome', 'Nome', pre?.nome, 'text'));
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  g.append(campo('kcal', 'Calorie', cur?.kcal), campo('p', 'Proteine (g)', cur?.p),
           campo('c', 'Carboidrati (g)', cur?.c), campo('g', 'Grassi (g)', cur?.g),
           campo('fibre', 'Fibre (g)', cur?.fibre));
  w.append(g);

  /* La categoria si sceglie fra quelle che esistono gia'.
     Era un campo di testo con un datalist, cioe' in pratica da riscrivere ogni
     volta — e il motore delle sostituzioni confronta stringhe, quindi "legumi"
     e "Legumi" diventavano due famiglie separate senza che nessuno se ne
     accorgesse. Scriverne una nuova si puo' ancora, ma e' la seconda strada e
     non la prima. */
  const fc = el('div', 'field', '<label>Categoria</label>');
  const inCat = el('input');
  inCat.type = 'text'; inCat.id = 'al-categoria';
  inCat.value = cur?.categoria || '';
  inCat.placeholder = 'come si chiama la famiglia';
  inCat.style.display = 'none';
  const cats = [...new Set(Object.values(D.alimenti).map(x => x.categoria).filter(Boolean))]
    .sort((x, y) => x.localeCompare(y));
  const chipsCat = el('div', 'seg wrap chips');
  const segna = () => [...chipsCat.children].forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.cat === inCat.value)));
  for (const cx of cats) {
    const b = el('button', null, cx);
    b.dataset.cat = cx;
    b.onclick = () => { inCat.value = cx; inCat.style.display = 'none'; segna(); };
    chipsCat.append(b);
  }
  const nuova = el('button', null, '+ nuova');
  nuova.dataset.cat = '::nuova::';        // non coincide mai con una categoria vera
  nuova.onclick = () => {
    inCat.style.display = '';
    inCat.value = '';
    inCat.focus();
    segna();
    nuova.setAttribute('aria-pressed', 'true');
  };
  chipsCat.append(nuova);
  fc.append(chipsCat, inCat);
  // una categoria che non e' fra quelle note va mostrata nel campo, o
  // aprendo l'alimento sembrerebbe che non ne abbia una
  if (inCat.value && !cats.includes(inCat.value)) inCat.style.display = '';
  segna();
  w.append(fc);
  w.append(el('div', 'hint',
    'Serve al motore delle sostituzioni, che cerca alternative dentro la stessa '
    + 'famiglia. Senza sceglierne una finisce in <strong>altro</strong>, insieme a '
    + 'tutto quello che una famiglia sua non ce l\'ha: e\' un posto vero, non un '
    + 'vuoto, e le alternative le cerchera\' li\' dentro.'));

  let confermato = false;
  if (pre?.origine) {
    const ck = el('button', 'btn wide');
    ck.textContent = 'Li ho controllati sulla confezione';
    ck.setAttribute('aria-pressed', 'false');
    ck.onclick = () => {
      confermato = !confermato;
      ck.setAttribute('aria-pressed', String(confermato));
      ck.classList.toggle('pri', confermato);
      ck.textContent = confermato ? '✓ Controllati sulla confezione'
                                  : 'Li ho controllati sulla confezione';
    };
    w.append(ck);
    w.append(el('div', 'hint',
      'Senza questa conferma l\'alimento resta marcato <strong>stima</strong>, e l\'app '
      + 'lo dice ovunque compaia. Non e\' una formalita\': i valori stimati vanno letti '
      + 'come un ordine di grandezza.'));
  }

  const b = el('button', 'btn wide pri', 'Salva');
  b.style.marginTop = '10px';
  b.onclick = () => {
    const n = nome || $('#al-nome').value.trim();
    if (!n) { toast('Serve il nome'); return; }
    const num = id => parseNum($('#al-' + id).value) ?? 0;
    p.alimenti[n] = {
      kcal: num('kcal'), p: num('p'), c: num('c'), g: num('g'), fibre: num('fibre'),
      categoria: $('#al-categoria').value.trim() || 'altro',
      unita: cur?.unita || 'g',
      // un valore preso da un archivio collaborativo non e' "letto in etichetta":
      // resta stima finche' non lo confermi tu sulla confezione
      fonte: pre?.origine && !confermato ? 'stima' : 'verificato'
    };
    if (pre?.barcode) p.alimenti[n].barcode = pre.barcode;
    if (pre?.origine && !confermato) p.alimenti[n].origine = pre.origine;
    if (p.alimenti[n].kcal <= 0) { toast('Le calorie non possono essere zero'); return; }
    save(); fondiPiano(); closeSheet(); route(); toast('Alimento salvato');
  };
  w.append(b);
  if (nome && p.alimenti[nome]) {
    const r = el('button', 'btn wide', 'Ripristina il valore di base');
    r.style.marginTop = '8px';
    r.onclick = () => {
      delete p.alimenti[nome]; save(); fondiPiano(); closeSheet(); route(); toast('Ripristinato');
    };
    if (DBASE.alimenti[nome]) w.append(r);
  }
  sheet(w);
}

/* ----------------------------------------------------------------- pasti */
function sezPasti(v) {
  const p = piano();
  const b = el('button', 'btn wide pri', 'Componi una ricetta');
  b.onclick = () => sheetPasto(null);
  v.append(b);

  /* **La ricerca.** Con una ventina di ricette l'elenco e' gia' piu' lungo
     dello schermo, e trovare "pasta e ceci" voleva dire scorrere. Cerca nel
     nome e negli **ingredienti**, che e' la domanda vera quando si compone un
     giorno: non "come si chiama" ma "cosa ho con dentro il tofu".
     Il filtro non passa da `route()`: ridisegnare la vista a ogni lettera fa
     perdere il fuoco al campo e su un telefono chiude la tastiera. */
  const cer = el('div', 'field');
  cer.style.margin = '12px 0 4px';
  cer.innerHTML = '<input type="text" id="pt-cerca" placeholder="Cerca una ricetta '
    + 'o un ingrediente\u2026" autocomplete="off">';
  v.append(cer);
  const conte = el('div');
  v.append(conte);
  const inp = cer.querySelector('input');

  const cerca = (pa, q) => {
    if (!q) return true;
    const testo = [pa.nome || '', ...(pa.ingredienti || []).map(i => i.alimento)]
      .join(' ').toLowerCase();
    return q.split(/\s+/).every(t => testo.includes(t));
  };

  const miei = Object.keys(p.pasti);
  const lista = (titolo, ids, sub, q) => {
    const trovati = ids.filter(id => {
      const pa = D.pasti[id] || DBASE.pasti[id];
      return pa && cerca(pa, q);
    });
    if (!trovati.length) return 0;
    const c = el('div', 'card');
    c.append(el('h2', 'sec', titolo + ' (' + trovati.length + ')'));
    c.lastChild.style.marginTop = '0';
    if (sub) c.append(el('p', 'muted', sub));
    for (const id of trovati.sort()) {
      /* Con il piano vuoto D.pasti contiene SOLO i pasti tuoi: i ventiquattro
         di base non sono fusi dentro. Cercarli li' dava undefined e il passo
         "Come li combini" andava in crash all'apertura — cioe' esattamente
         sul percorso consigliato a chi comincia da zero. */
      const pa = D.pasti[id] || DBASE.pasti[id];
      if (!pa) continue;
      const r = el('button', 'prod');
      r.innerHTML = `<div class="grow"><div class="nm">${esc(pa.nome || id)}</div>
        <div class="mt">${(pa.ingredienti || []).length} ingredienti · ${nf(pa.macro.p, 0)}P</div></div>
        <div class="kc">${nf(pa.macro.kcal)}<br><span class="mt">kcal</span></div>`;
      r.onclick = () => sheetPasto(id);
      c.append(r);
    }
    conte.append(c);
    return trovati.length;
  };

  const disegna = () => {
    const q = inp.value.trim().toLowerCase();
    conte.innerHTML = '';
    const n = lista('Composte da te', miei, null, q)
      + lista('Nel piano di base', Object.keys(DBASE.pasti),
              'Toccane una per usarla come punto di partenza.', q);
    if (!n) conte.append(el('p', 'hint', q
      ? 'Nessuna ricetta con "' + esc(q) + '" nel nome o fra gli ingredienti.'
      : 'Non hai ancora nessuna ricetta. Con il bottone qui sopra ne componi una.'));
  };
  inp.oninput = disegna;
  disegna();
}

function sheetPasto(id) {
  const p = piano();
  // come sopra: un pasto di base va cercato anche nel file di partenza
  const base = id ? (D.pasti[id] || DBASE.pasti[id]) : null;
  const stato = {
    codice: id && p.pasti[id] ? id : (id ? id + '-mio' : 'pasto-' + uid().slice(0, 5)),
    nome: base?.nome || '',
    ing: (base?.ingredienti || []).map(x => ({ ...x }))
  };

  const w = el('div');
  w.append(el('div', 'eyebrow', id ? 'Modifica ricetta' : 'Nuova ricetta'));
  w.append(el('h2', 'sec', 'Composizione'));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Nome del pasto</label><input type="text" id="pt-nome" value="${esc(stato.nome)}">`));

  const tot = el('div', 'read');
  const lista = el('div');
  let aperto = null;
  const aggiornaTot = () => {
    const m = macroDaIngredienti(stato.ing);
    tot.innerHTML = `<span><b>${nf(m.kcal)} kcal</b></span><span>${nf(m.p, 1)} P</span>`
      + `<span>${nf(m.c, 1)} C</span><span>${nf(m.g, 1)} G</span><span>${nf(m.fibre, 1)} fibre</span>`;
  };
  const disegna = () => {
    lista.innerHTML = '';
    if (!stato.ing.length)
      lista.append(el('p', 'muted', 'Nessun ingrediente. Aggiungine uno qui sotto e i macro si calcolano da soli.'));
    for (const [i, ing] of stato.ing.entries()) {
      const a = D.alimenti[ing.alimento];
      const m = a ? foodM(ing.alimento, ing.qta) : M0();
      const r = el('div', 'cmp-r');
      r.style.cursor = 'pointer';
      r.innerHTML = `<span>${esc(ing.alimento)}<span class="mm">${macroRiga(m)}</span></span>
        <span class="mono qv">${nf(ing.qta)} ${esc(a?.unita || 'g')}</span>
        <span class="mono muted kv">${nf(m.kcal)} kcal</span>`;
      // Tocco = apri l'editor sotto la riga. Prima c'era un prompt() del
      // browser: fuori dal design, senza unita' di misura e senza modo di
      // vedere l'effetto sul totale mentre si cambia la quantita'.
      r.onclick = () => { aperto = aperto === i ? null : i; disegna(); };
      lista.append(r);

      if (aperto === i) {
        const ed = el('div', 'qedit');
        ed.innerHTML = `<button class="btn sm" data-d="-10">−10</button>
          <input type="text" inputmode="decimal" value="${ing.qta}"
                 aria-label="Quantita in ${esc(a?.unita || 'g')}">
          <button class="btn sm" data-d="10">+10</button>
          <button class="btn sm rm">Togli</button>`;
        const inp = ed.querySelector('input');
        const rinfresca = () => {
          const mm = a ? foodM(ing.alimento, stato.ing[i].qta) : M0();
          r.querySelector('.qv').textContent = nf(stato.ing[i].qta) + ' ' + (a?.unita || 'g');
          r.querySelector('.kv').textContent = nf(mm.kcal) + ' kcal';
          r.querySelector('.mm').textContent = macroRiga(mm);
          aggiornaTot();
        };
        ed.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
          const n = Math.max(0, (parseNum(inp.value) || 0) + (+b.dataset.d));
          inp.value = n; stato.ing[i].qta = n; rinfresca();
        });
        inp.oninput = () => {
          const n = parseNum(inp.value);
          if (n != null && n >= 0) { stato.ing[i].qta = n; rinfresca(); }
        };
        ed.querySelector('.rm').onclick = () => {
          stato.ing.splice(i, 1); aperto = null; disegna();
        };
        lista.append(ed);
      }
    }
    aggiornaTot();
  };
  disegna();
  w.append(lista);
  w.append(tot);

  /* aggiunta ingrediente */
  const add = el('div', 'card flat');
  add.style.marginTop = '12px';
  add.append(el('div', 'eyebrow', 'Aggiungi un ingrediente'));
  /* Era una tendina su cinquanta voci, cioe' un elenco da scorrere col
     pollice. Ed erano solo gli alimenti: un prodotto registrato col codice a
     barre non compariva, che e' esattamente la cosa che uno ha in mano quando
     compone un pasto. Adesso ci sono anche quelli e, scegliendone uno, entra
     nel piano da solo — una ricetta ha bisogno di un nome, e glielo diamo. */
  let scelto = null;
  if (typeof selettoreCercabile === 'function' && typeof mangiabili === 'function') {
    const opz = mangiabili().map(x => ({
      v: x.id, lab: x.nome,
      sub: `${x.fonte === 'prodotto' ? (x.marca ? x.marca + ' · ' : '') + 'da aggiungere · ' : ''}`
        + `${nf(x.kcal)} kcal · ${nf(x.p, 1)} P per 100 ${x.unita}`
    }));
    add.append(selettoreCercabile(opz, null, v => { scelto = v; },
      'pane, tofu, la tua barretta…'));
  } else {
    const sa = el('select');
    sa.id = 'pt-al';
    for (const n of Object.keys(D.alimenti).sort()) sa.append(new Option(n, n));
    add.append(sa);
  }
  add.append(el('div', 'field',
    '<label>Quantita</label><input type="text" inputmode="decimal" id="pt-q" value="100">'));
  const ba = el('button', 'btn wide', 'Aggiungi');
  ba.onclick = () => {
    const q = parseNum($('#pt-q').value);
    if (!(q > 0)) { toast('Quantita non valida'); return; }
    let nome = null;
    if (scelto) {
      const x = mangiabile(scelto);
      if (!x) { toast('Scegli un ingrediente'); return; }
      // un prodotto diventa un alimento sul momento: la ricetta ha bisogno di
      // un nome, e lasciarlo fuori sarebbe un vicolo cieco
      nome = x.fonte === 'prodotto' && typeof prodottoInAlimento === 'function'
        ? prodottoInAlimento(prodotti().find(pp => pp.id === scelto.slice(2)))
        : x.nome;
      if (x.fonte === 'prodotto') toast(nome + ': aggiunto agli alimenti');
    } else if ($('#pt-al')) {
      nome = $('#pt-al').value;
    }
    if (!nome) { toast('Scegli un ingrediente'); return; }
    stato.ing.push({ alimento: nome, qta: q });
    disegna();
  };
  add.append(ba);
  w.append(add);

  const salva = el('button', 'btn wide pri', 'Salva la ricetta');
  salva.style.marginTop = '10px';
  salva.onclick = () => {
    const nome = $('#pt-nome').value.trim();
    if (!nome) { toast('Serve il nome'); return; }
    if (!stato.ing.length) { toast('Serve almeno un ingrediente'); return; }
    p.pasti[stato.codice] = {
      nome, ingredienti: stato.ing, macro: macroDaIngredienti(stato.ing)
    };
    save(); fondiPiano(); closeSheet(); route(); toast('Ricetta salvata');
  };
  w.append(salva);
  if (id && p.pasti[id]) {
    const del = el('button', 'btn wide', 'Elimina');
    del.style.marginTop = '8px';
    del.onclick = () => {
      if (!confirm('Eliminare questa ricetta?')) return;
      delete p.pasti[id]; save(); fondiPiano(); closeSheet(); route(); toast('Eliminato');
    };
    w.append(del);
  }
  sheet(w);
}

/* ------------------------------------------------------------- settimana */
function sezSettimana(v) {
  const p = piano();
  const sett = D.settimana;
  // meglio dirlo prima che dopo aver toccato uno slot a vuoto
  if (!Object.keys(D.pasti).length) {
    const av = el('div', 'card');
    av.append(el('div', 'eyebrow', 'Prima le ricette'));
    av.append(el('div', 'muted',
      'La settimana e\' l\'ultimo passo: assegna ai giorni le ricette che hai composto. '
      + 'Non ne hai ancora nessuno, quindi qui per ora c\'e\' solo la struttura degli '
      + 'orari.'));
    const b = el('button', 'btn wide pri', 'Vai a comporre una ricetta');
    b.style.marginTop = '10px';
    b.onclick = () => { pianoTab = 'pasti'; route(); };
    av.append(b);
    v.append(av);
  }
  /* In cima resta il riepilogo — quale giorno, e la direzione contro
     l'obiettivo, che e' una proprieta' della settimana e non ha una casa su
     un singolo giorno. Il verdetto del singolo giorno sta sul giorno. */
  if (typeof cardControlloPiano === 'function') {
    const cc = cardControlloPiano(today(), true);
    if (cc) v.append(cc);
  }
  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come funziona</div>
     <div class="muted">Un giorno e' fatto di <strong>pasti</strong> — colazione,
     pranzo, uno spuntino — e dentro ogni pasto ci va una <strong>ricetta</strong>.
     Tocca un pasto per cambiare la ricetta o per toglierla, oppure aggiungi un
     pasto: <strong>il numero di pasti puo essere diverso da un giorno
     all'altro</strong>. I totali si ricalcolano da soli.</div>`));

  /* Il verdetto sta **sul giorno**, non solo in cima alla pagina: un giorno da
     600 kcal nasce qui, mentre lo componi, ed e' qui che va detto. Una carta
     di riepilogo in testa la vedi quando risali, cioe' dopo — e "dopo" e' il
     momento in cui non stai piu' guardando quel giorno. */
  const cPiano = typeof controlloPiano === 'function' ? controlloPiano() : null;

  for (const [gi, g] of sett.entries()) {
    const c = el('div', 'card');
    const assegnati = (g.pasti || []).filter(x => pasto(x.codice)).length;
    const sg = (typeof statoGiorno === 'function' && cPiano)
      ? statoGiorno(g.totali.kcal, assegnati, cPiano) : null;
    if (sg && sg.stato !== 'ok' && sg.stato !== 'vuoto') c.classList.add('gg-' + sg.stato);
    c.append(el('div', 'row between',
      `<strong style="font-family:var(--serif);font-size:16px">${esc(g.giorno)}${
        sg && sg.stato !== 'vuoto'
          ? ` <span class="pill ${sg.cls}">${esc(sg.eti)}</span>` : ''}</strong>
       <span class="mono muted" style="font-size:11px">${nf(g.totali.kcal)} kcal · ${macroRiga(g.totali)}</span>`));
    /* **Come sono divise le calorie di questo giorno.** I grammi da soli non
       si confrontano fra giorni di dimensione diversa: 77 g di grassi su 2400
       kcal e 77 su 3200 sono due giornate con una struttura diversa, e la
       percentuale e' l'unica forma in cui quel confronto si legge. La barra
       usa le stesse tre tinte di "Da dove vengono le calorie". */
    const qm = typeof quoteMacro === 'function' ? quoteMacro(g.totali) : null;
    if (qm) {
      const mb = el('div', 'gg-m');
      mb.innerHTML = `<span class="b">${['p', 'c', 'g'].map((x, j) =>
          `<u class="m${j + 1}" style="width:${qm[x].toFixed(1)}%"></u>`).join('')}</span>
        <span class="q mono">${nf(qm.p, 0)}% P · ${nf(qm.c, 0)}% C · ${nf(qm.g, 0)}% G</span>`;
      c.append(mb);
    }
    if (sg?.frase) c.append(el('div', 'gg-f ' + sg.cls, esc(sg.frase)));
    const righe = [];
    for (const [si, s] of (g.pasti || []).entries()) {
      const pa = pasto(s.codice);
      const senzOra = oraMinuti(s.ora) == null;
      // s.codice e' null finche' non assegni, ed esc(null) stampava "null":
      // con il piano vuoto erano sette giorni di righe che dicevano "null"
      const r = el('button', 'prod riga-slot' + (pa ? '' : ' vuoto'));
      r.innerHTML = `${senzOra ? '<span class="drag-h" aria-hidden="true">\u2261</span>' : ''}
        <div class="grow"><div class="mt">${esc(s.slot)}${s.ora ? ' · ' + esc(s.ora) : ''}</div>
        <div class="nm">${pa ? esc(pa.nome || s.codice) : 'Da assegnare'}${
          pa?.pesiPiano ? ' <span class="pill">pesi tuoi</span>' : ''}</div></div>
        <div class="kc">${pa ? nf(pa.macro.kcal) : '+'}</div>`;
      r.onclick = () => {
        // il tocco che ha appena trascinato la riga non deve anche aprirla
        if (r.dataset.trascinata) { delete r.dataset.trascinata; return; }
        cambiaSlot(gi, si);
      };
      righe.push(r);
      c.append(r);
    }
    trascinaRighe(righe, i => oraMinuti(g.pasti[i].ora) == null, (from, to) => {
      const p2 = piano();
      p2.settimana ||= JSON.parse(JSON.stringify(
        S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
      const arr = p2.settimana[gi].pasti;
      arr.splice(to, 0, arr.splice(from, 1)[0]);
      save(); fondiPiano(); route();
    });
    const add = el('button', 'btn wide');
    add.style.marginTop = '10px';
    add.textContent = '+ Aggiungi un pasto a ' + g.giorno.toLowerCase();
    add.onclick = () => nuovoSlot(gi);
    c.append(add);
    v.append(c);
  }

  if (p.settimana) {
    const b = el('button', 'btn wide', 'Ripristina la settimana di base');
    b.onclick = () => {
      if (!confirm('Tornare alla settimana del piano di partenza?')) return;
      delete p.settimana; save(); fondiPiano(); route(); toast('Ripristinata');
    };
    v.append(b);
  }
}

/* ------------------------------------------------- l'ordine dei pasti
 *
 * Un giorno si legge dall'alto in basso come lo si vive, quindi i pasti con
 * un orario vanno in ordine di orario: aggiungere uno spuntino delle 16:30 e
 * vederlo comparire dopo la cena e' il genere di cosa che fa riscrivere il
 * giorno da capo.
 *
 * Ma non tutti i pasti hanno un'ora, e per quelli non esiste un ordine
 * "giusto" da calcolare: l'unico che lo sa e' chi mangia. Quindi le voci
 * senza orario NON si spostano da sole — restano dove sono state messe — e si
 * riordinano trascinandole.
 *
 * Da cui la regola: si ordinano solo le voci con l'ora, e finiscono nelle
 * posizioni che le voci con l'ora occupavano gia'. Le altre restano inchiodate
 * al loro indice.
 */
function oraMinuti(ora) {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(ora || ''));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

function ordinaSlotOrari(pasti) {
  const dove = [], conOra = [];
  pasti.forEach((s, i) => {
    if (oraMinuti(s.ora) != null) { dove.push(i); conOra.push(s); }
  });
  conOra.sort((a, b) => oraMinuti(a.ora) - oraMinuti(b.ora));
  dove.forEach((i, n) => { pasti[i] = conOra[n]; });
  return pasti;
}

/**
 * Riordino per trascinamento, con i pointer events.
 *
 * L'HTML5 drag-and-drop su iOS non esiste: col dito non parte proprio, e
 * l'unico modo di spostare una riga su un telefono e' seguire il pointer a
 * mano. Le altre righe si spostano davvero mentre trascini — senza, non si
 * capisce dove andra' a finire quella che hai in mano.
 */
function trascinaRighe(righe, puoMuovere, onSposta) {
  righe.forEach((r, i) => {
    const h = r.querySelector('.drag-h');
    if (!h || !puoMuovere(i)) return;
    h.style.touchAction = 'none';
    h.onpointerdown = ev => {
      ev.preventDefault(); ev.stopPropagation();
      const rects = righe.map(x => x.getBoundingClientRect());
      const passo = rects.length > 1 ? rects[1].top - rects[0].top : rects[i].height;
      const y0 = ev.clientY;
      let to = i, mosso = false;
      // senza cattura il dito che esce dalla maniglia perde il trascinamento;
      // se il browser la rifiuta si va avanti lo stesso invece di fermarsi qui
      try { h.setPointerCapture(ev.pointerId); } catch { /* pazienza */ }
      r.classList.add('trascino');

      const muovi = e => {
        const dy = e.clientY - y0;
        if (Math.abs(dy) > 4) mosso = true;
        r.style.transform = `translateY(${dy}px)`;
        const cy = rects[i].top + rects[i].height / 2 + dy;
        to = 0;
        for (let j = 0; j < rects.length; j++) {
          if (j === i) continue;
          if (rects[j].top + rects[j].height / 2 < cy) to++;
        }
        righe.forEach((x, j) => {
          if (j === i) return;
          const su = i < to && j > i && j <= to;
          const giu = to < i && j >= to && j < i;
          x.style.transform = su ? `translateY(${-passo}px)`
            : giu ? `translateY(${passo}px)` : '';
        });
      };
      const finito = () => {
        h.onpointermove = null; h.onpointerup = null; h.onpointercancel = null;
        righe.forEach(x => { x.style.transform = ''; });
        r.classList.remove('trascino');
        // il tocco che ha trascinato non deve anche aprire la riga
        if (mosso) r.dataset.trascinata = '1';
        if (mosso && to !== i) onSposta(i, to);
      };
      h.onpointermove = muovi;
      h.onpointerup = finito;
      h.onpointercancel = finito;
    };
  });
}

/** Aggiunge un pasto a un giorno: il numero di pasti non e' fisso. */
/**
 * L'ora nel formato che `<input type="time">` accetta: **HH:MM** con lo zero
 * davanti. Un orario scritto a mano nelle versioni di prima poteva essere
 * "9:15", e il campo nativo con quel valore si presenta **vuoto** — senza
 * dire niente, e salvando cancellerebbe l'ora che c'era.
 */
function oraValida(o) {
  const m = String(o || '').match(/^(\d{1,2})[:.](\d{1,2})$/);
  if (!m) return '';
  const h = +m[1], mi = +m[2];
  if (!(h >= 0 && h < 24 && mi >= 0 && mi < 60)) return '';
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

function nuovoSlot(gi) {
  const p = piano();
  p.settimana ||= JSON.parse(JSON.stringify(
    S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
  const g = p.settimana[gi];
  const w = el('div');
  w.append(el('div', 'eyebrow', esc(g.giorno)));
  /* Qui si aggiunge un **pasto**, cioe' un momento della giornata con un nome
     e un'ora: la ricetta e' quello che ci si mette dentro dopo. Si chiamava
     "Nuova ricetta" e prometteva un'altra cosa — un piatto da comporre — che
     sta nel passo "Le tue ricette". */
  w.append(el('h2', 'sec', 'Nuovo pasto'));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Come si chiama</label>
     <input type="text" id="ns-slot" placeholder="Spuntino del pomeriggio">
     <div class="hint">E' il momento della giornata, non il piatto: "Colazione",
     "Pre-nanna". La ricetta la scegli dopo.</div>`));
  w.append(el('div', 'field',
    `<label>A che ora <span class="muted">(facoltativo)</span></label>
     <input type="time" id="ns-ora">
     <div class="hint">Con l'ora il pasto si mette da solo al posto giusto nella
     giornata. Senza, resta dove lo aggiungi e lo sposti trascinandolo.</div>`));
  const b = el('button', 'btn wide pri', 'Aggiungi');
  b.onclick = () => {
    const nome = $('#ns-slot').value.trim();
    if (!nome) { toast('Serve un nome'); return; }
    const ora = $('#ns-ora').value.trim();
    if (ora && oraMinuti(ora) == null) { toast('L\'ora si scrive cosi\': 16:30'); return; }
    // un id vero e non derivato dalla posizione: questo pasto puo' essere
    // spostato, e la sua identita' non deve seguirlo
    g.pasti.push({ id: 'p' + uid(), slot: nome, ora, codice: null });
    ordinaSlotOrari(g.pasti);
    save(); fondiPiano(); closeSheet(); route();
    toast(ora ? 'Pasto aggiunto alle ' + ora
      : 'Pasto aggiunto in fondo: trascinalo dove vuoi');
  };
  w.append(b);
  sheet(w);
}

/**
 * **I pesi di questo pasto**, dentro il piano e non solo per oggi.
 *
 * E' l'editor del codice `ric:` (vedi `codiceRicetta()` in app.js): la ricetta
 * resta una — nome, elenco, posto nella lista — e questo slot della settimana
 * si tiene le sue quantita', tutte le settimane.
 *
 * Tre cose che lo distinguono dal foglio delle porzioni del diario:
 *
 * - **vale sempre**, non un giorno solo, quindi entra nei totali del giorno,
 *   nella lista della spesa e nelle barre di Oggi di ogni lunedi';
 * - **non ha il cestino ne' la sostituzione**: quelli sono strati del diario,
 *   e togliere un ingrediente dal piano si fa nella ricetta. Qui si porta a
 *   zero, che e' la stessa cosa detta con i pesi;
 * - **torna a `cambiaSlot`**, non chiude tutto: e' l'editor di una riga, e
 *   chiudere il foglio da cui si e' arrivati e' l'errore gia' pagato con le
 *   righe di scheda in palestra.
 */
function sheetPesiSlot(gi, si, pi = 0) {
  const p = piano();
  p.settimana ||= JSON.parse(JSON.stringify(
    S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
  const s = p.settimana[gi].pasti[si];
  // un pasto puo' avere piu' ricette dentro: i pesi si toccano su una alla
  // volta, o non si saprebbe a quale ricetta appartiene una riga ripetuta
  const cod = partiPasto(s.codice)[pi];
  const base = codiceBaseRic(cod);
  const ric = pasto(base);
  if (!ric?.ingredienti?.length) { cambiaSlot(gi, si); return; }
  const stato = { ...(scomponiRicetta(cod)?.pesi || {}) };

  const w = el('div');
  w.append(el('div', 'eyebrow',
    `${esc(p.settimana[gi].giorno || D.settimana[gi]?.giorno || '')} \u00b7 ${esc(s.slot)}`));
  w.append(el('h2', 'sec', esc(ric.nome || base)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Quanto ne metti <strong>in questo pasto</strong>. La ricetta non cambia: '
    + 'resta com\'e\' dappertutto, e negli altri giorni in cui la usi resta con '
    + 'i suoi pesi. Questi valgono tutte le settimane, non solo oggi.'));

  const tot = el('div', 'read');
  const diff = el('div', 'diffm');
  diff.hidden = true;
  const lista = el('div');

  const macroOra = () => {
    const m = M0();
    for (const i of ric.ingredienti) addM(m, foodM(i.alimento, stato[i.alimento] ?? i.qta));
    for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) m[x] = Math.round(m[x] * 10) / 10;
    return m;
  };
  const aggiorna = () => {
    const m = macroOra(), b = macroRicetta(ric);
    tot.innerHTML = `<span><b>${nf(m.kcal)} kcal</b></span>`
      + `<span>${nf(m.p, 1)} P</span><span>${nf(m.c, 1)} C</span>`
      + `<span>${nf(m.g, 1)} G</span><span>${nf(m.fibre, 1)} fibre</span>`;
    const voci = [['kcal', 'kcal', 0], ['p', 'P', 1], ['c', 'C', 1],
                  ['g', 'G', 1], ['fibre', 'fibre', 1]]
      .map(([id, l, dec]) => [l, (m[id] || 0) - (b[id] || 0), dec])
      .filter(([, q, dec]) => Math.abs(q) >= (dec ? 0.5 : 1));
    diff.hidden = !voci.length;
    diff.innerHTML = voci.length
      ? '<span class="l">rispetto alla ricetta</span>'
        + voci.map(([l, q, dec]) => `<span class="${q > 0 ? 'su' : 'giu'}">`
          + `${q > 0 ? '+' : '\u2212'}${nf(Math.abs(q), dec)} ${esc(l)}</span>`).join('')
      : '';
  };

  for (const i of ric.ingredienti) {
    const unita = D.alimenti[i.alimento]?.unita || 'g';
    const q0 = stato[i.alimento] ?? i.qta;
    const riga = el('div', 'porz' + (q0 !== i.qta ? ' mod' : '') + (q0 === 0 ? ' tolto' : ''));
    riga.innerHTML = `<span class="nm">${esc(i.alimento)}
        ${q0 !== i.qta ? `<em class="qta">ricetta: ${nf(i.qta)} ${esc(unita)}</em>` : ''}</span>
      <button class="btn sm" data-d="-10">\u2212</button>
      <input type="text" inputmode="decimal" value="${q0}">
      <button class="btn sm" data-d="10">+</button>
      <span class="u">${esc(unita)}</span>`;
    const inp = riga.querySelector('input');
    const setta = n => {
      n = Math.max(0, Math.round(n * 10) / 10);
      if (n === i.qta) delete stato[i.alimento]; else stato[i.alimento] = n;
      inp.value = n;
      riga.classList.toggle('mod', n !== i.qta);
      riga.classList.toggle('tolto', n === 0);
      const em = riga.querySelector('em.qta');
      if (n !== i.qta && !em) riga.querySelector('.nm').insertAdjacentHTML('beforeend',
        `<em class="qta">ricetta: ${nf(i.qta)} ${esc(unita)}</em>`);
      if (n === i.qta && em) em.remove();
      aggiorna();
    };
    riga.querySelectorAll('[data-d]').forEach(b => b.onclick = () =>
      setta((parseNum(inp.value) || 0) + (+b.dataset.d)));
    inp.oninput = () => { const n = parseNum(inp.value); if (n != null && n >= 0) setta(n); };
    lista.append(riga);
  }
  w.append(lista, tot, diff);

  /* Scalare tutta la ricetta e' il caso piu' frequente — "quel giorno ne
     mangio meta'" — e farlo ingrediente per ingrediente e' cinque tocchi
     invece di uno. Riparte sempre dai pesi della **ricetta**, non da quelli
     gia' toccati: due tocchi su x0,5 darebbero un quarto. */
  const scale = el('div', 'seg');
  scale.style.marginTop = '10px';
  for (const f of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const b = el('button', null, f === 1 ? 'ricetta' : '\u00d7' + nf(f, f % 1 ? 2 : 0));
    b.onclick = () => {
      for (const i of ric.ingredienti) {
        const n = Math.max(0, Math.round(i.qta * f * 10) / 10);
        if (n === i.qta) delete stato[i.alimento]; else stato[i.alimento] = n;
      }
      scriviPesi(gi, si, pi, base, stato); sheetPesiSlot(gi, si, pi);
    };
    scale.append(b);
  }
  w.append(scale);

  const salva = el('button', 'btn wide pri', 'Salva i pesi di questo pasto');
  salva.style.marginTop = '12px';
  salva.onclick = () => {
    scriviPesi(gi, si, pi, base, stato);
    closeSheet(); route();
    toast(Object.keys(stato).length ? 'Pesi salvati per questo pasto'
      : 'Rimessi i pesi della ricetta');
  };
  w.append(salva);

  if (Object.keys(scomponiRicetta(cod)?.pesi || {}).length) {
    const via = el('button', 'btn wide');
    via.style.marginTop = '8px';
    via.textContent = 'Rimetti i pesi della ricetta';
    via.onclick = () => {
      scriviPesi(gi, si, pi, base, {});
      closeSheet(); route(); toast('Rimessi i pesi della ricetta');
    };
    w.append(via);
  }
  const ind = el('button', 'btn wide', '\u2039 Torna al pasto');
  ind.style.marginTop = '8px';
  ind.onclick = () => cambiaSlot(gi, si);
  w.append(ind);

  aggiorna();
  sheet(w);
}

/** Scrive i pesi di **una** parte del pasto, lasciando le altre come sono. */
function scriviPesi(gi, si, pi, base, pesi) {
  const p = piano(), s = p.settimana[gi].pasti[si];
  const parti = partiPasto(s.codice);
  parti[pi] = codiceRicetta(base, pesi);
  s.codice = codicePasto(parti);
  save(); fondiPiano();
}

function cambiaSlot(gi, si) {
  const p = piano();
  // la prima modifica clona la settimana di base: da li' in poi e' tua
  p.settimana ||= JSON.parse(JSON.stringify(
    S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
  const g = p.settimana[gi], s = g.pasti[si];
  const w = el('div');
  w.append(el('div', 'eyebrow', `${esc(g.giorno)} · ${esc(s.slot)}`));
  w.append(el('h2', 'sec', 'Cosa c\'e\' in questo pasto'));
  w.lastChild.style.marginTop = '0';

  /* **Come viene il giorno.** E' il momento in cui il giorno si compone, e
     quindi il momento in cui serve saperlo: scegliere una ricetta al buio e
     scoprire due schermate dopo che quel giorno fa 900 kcal vuol dire tornare
     indietro a rifare. Il conto si fa **senza** la ricetta che c'e' adesso in
     questo slot, cosi' ogni riga puo' dire dove porterebbe. */
  const gd = D.settimana[gi];
  const cPiano = typeof controlloPiano === 'function' ? controlloPiano() : null;
  const attuale = pasto(gd?.pasti?.[si]?.codice);
  const senza = (gd?.totali?.kcal || 0) - (attuale?.macro?.kcal || 0);
  const nAltri = (gd?.pasti || []).filter((x, i) => i !== si && pasto(x.codice)).length;
  const sgOra = cPiano && typeof statoGiorno === 'function'
    ? statoGiorno(gd.totali.kcal, nAltri + (attuale ? 1 : 0), cPiano) : null;
  if (sgOra && cPiano.tgt > 0) {
    const r = el('div', 'read');
    r.innerHTML = `<span>oggi <b>${nf(gd.totali.kcal)}</b> kcal</span>`
      + `<span>target ${nf(cPiano.tgt)}</span>`
      + `<span class="${sgOra.cls === 'ok' ? '' : sgOra.cls}">${esc(sgOra.eti)}</span>`;
    w.append(r);
    if (sgOra.frase) w.append(el('div', 'gg-f ' + sgOra.cls, esc(sgOra.frase)));
    w.append(el('p', 'hint',
      'Sotto ogni ricetta c\'e\' a quanto arriverebbe <strong>questo giorno</strong> '
      + 'scegliendola. Non e\' un voto sulla ricetta: una colazione da 300 kcal e\' '
      + 'una colazione, non un errore.'));
  }

  /* **Cosa c'e' dentro.** Un pranzo non e' sempre un piatto: e' la pasta
     **e** l'insalata, il primo **e** la frutta. Le parti si elencano qui,
     ognuna con i suoi macro, il suo editor dei pesi e il suo cestino — e
     scegliere una ricetta qui sotto ne **aggiunge** una, invece di
     sostituire quella che c'e'. */
  const parti = partiPasto(s.codice);
  if (parti.length) {
    const box = el('div');
    box.style.margin = '14px 0 4px';
    parti.forEach((c, pi) => {
      const pa = pasto(c);
      const pesi = scomponiRicetta(c)?.pesi;
      const r = el('div', 'prod');
      r.innerHTML = `<div class="grow"><div class="nm">${esc(pa?.nome || c)}${
          pesi && Object.keys(pesi).length
            ? ' <span class="pill">pesi tuoi</span>' : ''}</div>
        <div class="mt">${pa ? `${nf(pa.macro.p, 0)}P ${nf(pa.macro.c, 0)}C `
          + `${nf(pa.macro.g, 0)}G` : 'ricetta non trovata'}</div></div>
        <div class="kc">${pa ? nf(pa.macro.kcal) : '\u2014'}</div>`;
      const az = el('div', 'porz-az');
      if (pa?.ingredienti?.length) {
        const bp = el('button', 'btn sm', 'pesi');
        bp.title = 'Cambia le quantita\' di questa ricetta in questo pasto';
        bp.onclick = () => sheetPesiSlot(gi, si, pi);
        az.append(bp);
      }
      const bt = el('button', 'btn sm', '\u2715');
      bt.title = 'Togli questa ricetta dal pasto';
      bt.setAttribute('aria-label', 'Togli ' + (pa?.nome || c));
      bt.onclick = () => {
        const q = partiPasto(s.codice);
        q.splice(pi, 1);
        s.codice = codicePasto(q);
        save(); fondiPiano(); cambiaSlot(gi, si);
      };
      az.append(bt);
      r.append(az);
      box.append(r);
    });
    if (parti.length > 1 && attuale?.macro) {
      const t = el('div', 'read');
      t.innerHTML = `<span><b>${nf(attuale.macro.kcal)} kcal</b></span>`
        + `<span>${nf(attuale.macro.p, 1)} P</span>`
        + `<span>${nf(attuale.macro.c, 1)} C</span>`
        + `<span>${nf(attuale.macro.g, 1)} G</span>`
        + `<span>${nf(attuale.macro.fibre, 1)} fibre</span>`;
      box.append(t);
      box.append(el('p', 'note',
        'Gli ingredienti ripetuti fra le ricette si sommano in una riga sola: '
        + 'e\' quello che finisce nella lista della spesa e nelle porzioni del '
        + 'giorno.'));
    }
    w.append(box);
  }

  w.append(el('h2', 'sec', parti.length ? 'Aggiungi un\'altra ricetta' : 'Scegli la ricetta'));
  if (parti.length) w.append(el('p', 'muted',
    'Si aggiunge a quello che c\'e\' gia\': un pranzo puo\' essere due piatti.'));

  /**
   * **Un pasto puo' essere un alimento solo.**
   *
   * Per mettere uno yogurt di soia allo spuntino bisognava comporre una
   * ricetta con dentro un ingrediente: un giro assurdo, e un elenco di ricette
   * che si riempie di voci che ricette non sono. Qui si sceglie l'alimento e
   * la quantita', e il pasto e' fatto — il codice diventa `ali:<qta>:<nome>`
   * e da li' in poi si comporta come qualunque altra ricetta: macro
   * calcolati, lista della spesa, spunta, porzioni, resoconto.
   */
  const sezAlimento = () => {
    const box = el('div');
    box.append(el('h2', 'sec', 'Oppure un alimento solo'));
    box.append(el('p', 'muted',
      'Uno yogurt, una mela, un frullato gia\' pronto: non serve farne una '
      + 'ricetta. Scegli cosa e quanto, e il pasto e\' fatto.'));
    const opz = Object.keys(D.alimenti).sort((a, b) => a.localeCompare(b))
      .map(nome => {
        const al = alimento(nome) || {};
        return { v: nome, lab: nome.charAt(0).toUpperCase() + nome.slice(1),
          sub: `${nf(al.kcal || 0)} kcal / 100 ${al.unita || 'g'}` };
      });
    let scelto = null;
    const eco = el('div');
    const qta = el('div', 'field',
      `<label>Quanto</label>
       <input type="text" inputmode="decimal" id="cs-aq" value="150">`);
    const disegna = () => {
      eco.innerHTML = '';
      if (!scelto) return;
      const q = parseNum($('#cs-aq')?.value) ?? 0;
      const m = foodM(scelto, q);
      const r = el('div', 'read');
      r.innerHTML = `<span><b>${nf(m.kcal)}</b> kcal</span>`
        + `<span>${nf(m.p, 0)}P ${nf(m.c, 0)}C ${nf(m.g, 0)}G</span>`
        + (cPiano && cPiano.tgt > 0
          ? `<span>il giorno farebbe ${nf(senza + m.kcal)}</span>` : '');
      eco.append(r);
      const ok = el('button', 'btn wide pri');
      ok.style.marginTop = '8px';
      ok.textContent = 'Metti ' + scelto + ' in questo pasto';
      ok.onclick = () => {
        const q2 = parseNum($('#cs-aq').value);
        if (!(q2 > 0)) { toast('Serve una quantita\''); return; }
        s.codice = codicePasto([...partiPasto(s.codice), codiceAlimento(scelto, q2)]);
        save(); fondiPiano(); closeSheet(); route(); toast('Pasto aggiornato');
      };
      eco.append(ok);
    };
    box.append(selettoreCercabile(opz, null, v => { scelto = v; disegna(); },
      'Cerca un alimento\u2026'));
    box.append(qta);
    qta.querySelector('input').oninput = disegna;
    box.append(eco);
    return box;
  };

  /* Con il piano vuoto D.pasti e' vuoto, e questo foglio mostrava il titolo,
     un vuoto, e il bottone per togliere lo slot: sembrava rotto, e in pratica
     lo era — non c'era nessuna strada da qui in avanti. Un elenco vuoto va
     detto, e va detto DOVE si va a riempirlo. */
  const quanti = Object.keys(D.pasti).length;
  if (!quanti) {
    w.append(el('p', 'muted',
      'Non hai ancora composto nessuna ricetta, quindi non c\'e\' niente da assegnare a '
      + 'questo pasto. Le ricette si costruiscono nel passo <strong>"Le tue ricette"</strong>: '
      + 'scegli gli alimenti e le quantita\', i macro si calcolano da soli, e da li\' in '
      + 'poi quella ricetta la metti in qualunque giorno.'));
    const vai = el('button', 'btn wide pri', 'Vai a comporre una ricetta');
    vai.onclick = () => { pianoTab = 'pasti'; closeSheet(); route(); };
    w.append(vai);
    // senza ricette la strada c'e' lo stesso: un alimento non ne ha bisogno
    w.append(sezAlimento());
    const ind = el('button', 'btn wide', 'Torna alla settimana');
    ind.style.marginTop = '8px';
    ind.onclick = closeSheet;
    w.append(ind);
    w.append(el('p', 'note',
      'Il pasto resta dov\'e\': un giorno con gli orari gia\' impostati e le ricette ancora '
      + 'da scegliere e\' un piano a meta\', non un piano rotto.'));
    sheet(w);
    return;
  }

  /* Anche qui la ricerca, ed e' l'elenco piu' lungo dell'app: ventiquattro
     ricette, e ci si arriva sapendo gia' cosa si vuole mettere. Cerca nel
     nome e negli ingredienti, come il passo delle ricette. */
  const cerca = el('div', 'field');
  cerca.innerHTML = '<input type="text" id="cs-cerca" autocomplete="off" '
    + 'placeholder="Cerca una ricetta o un ingrediente…">';
  w.append(cerca);
  const elenco = el('div');
  w.append(elenco);
  const testoRic = pa => [pa.nome || '',
    ...(pa.ingredienti || []).map(i => i.alimento)].join(' ').toLowerCase();

  const disegnaRic = () => {
  const q = (cerca.querySelector('input').value || '').trim().toLowerCase();
  const par = q ? q.split(/\s+/) : [];
  elenco.innerHTML = '';
  let n = 0;
  for (const [code, pa] of Object.entries(D.pasti)
      .sort((a, b) => (a[1].nome || '').localeCompare(b[1].nome || ''))) {
    const t = testoRic(pa);
    if (!par.every(x => t.includes(x))) continue;
    n++;
    const r = el('button', 'prod');
    /* Dove porterebbe questa ricetta, su questo giorno.
       La pastiglia compare **solo se cambia lo stato** rispetto a com'e' il
       giorno adesso. Senza quella regola, su un giorno con un pasto solo
       uscivano ventidue "sotto il minimo" identici: vero per tutte e quindi
       inutile per sceglierne una — quel giorno e' corto perche' ha un pasto,
       non perche' la ricetta sia sbagliata. Ventidue etichette rosse uguali
       sono il modo migliore per insegnare a ignorare le etichette rosse.
       Il numero, invece, resta sempre: quello dice davvero dove vai. */
    const dopo = senza + pa.macro.kcal;
    const sgD = cPiano && cPiano.tgt > 0 && typeof statoGiorno === 'function'
      ? statoGiorno(dopo, nAltri + 1, cPiano) : null;
    const cambia = sgD && sgOra && sgD.stato !== sgOra.stato;
    r.innerHTML = `<div class="grow"><div class="nm">${esc(pa.nome || code)}${
        cambia ? ` <span class="pill ${sgD.cls}">${esc(sgD.eti)}</span>` : ''}</div>
      <div class="mt">${nf(pa.macro.p, 0)}P ${nf(pa.macro.c, 0)}C ${nf(pa.macro.g, 0)}G${
        sgD ? ` · il giorno farebbe ${nf(dopo)} kcal` : ''}</div></div>
      <div class="kc">${nf(pa.macro.kcal)}${
        parti.some(c => codiceBaseRic(c) === code)
          ? '<br><span class="mt">gia\' dentro</span>' : ''}</div>`;
    r.onclick = () => {
      // si **aggiunge** a quello che c'e': sostituire era l'unico modo, ed e'
      // il motivo per cui un pranzo di due piatti andava composto come una
      // terza ricetta che duplica le altre due
      s.codice = codicePasto([...partiPasto(s.codice), code]);
      save(); fondiPiano(); closeSheet(); route();
      toast(parti.length ? 'Aggiunta al pasto' : 'Pasto aggiornato');
    };
    elenco.append(r);
  }
  if (!n) elenco.append(el('p', 'hint',
    'Nessuna ricetta con quelle parole nel nome o fra gli ingredienti. '
    + "Se e' un alimento solo, qui sotto lo metti senza farne una ricetta."));
  };
  cerca.querySelector('input').oninput = disegnaRic;
  disegnaRic();

  w.append(sezAlimento());

  /* L'ora si imposta qui, e cambiandola il pasto si rimette al posto giusto
     nella giornata: un orario che non riordina niente e' solo un'etichetta. */
  const fo = el('div', 'field',
    `<label>A che ora <span class="muted">(facoltativo)</span></label>
     <input type="time" id="cs-ora" value="${esc(oraValida(s.ora))}">`);
  const bo = el('button', 'btn wide');
  bo.style.marginTop = '4px';
  bo.textContent = 'Salva l\'ora';
  bo.onclick = () => {
    const ora = $('#cs-ora').value.trim();
    if (ora && oraMinuti(ora) == null) { toast('L\'ora si scrive cosi\': 16:30'); return; }
    s.ora = ora;
    ordinaSlotOrari(g.pasti);
    save(); fondiPiano(); closeSheet(); route();
    toast(ora ? 'Rimesso in ordine' : 'Ora tolta: lo sposti trascinandolo');
  };
  fo.append(bo);
  w.append(fo);

  /* Svuotare l'assegnazione e togliere lo slot sono due cose diverse, e prima
     c'era solo la seconda: chi voleva solo cambiare idea si ritrovava senza
     la colazione del martedi'. */
  if (s.codice) {
    const sv = el('button', 'btn wide');
    sv.style.marginTop = '12px';
    sv.textContent = parti.length > 1
      ? 'Svuota il pasto, lascia il posto' : 'Togli solo la ricetta, lascia il pasto';
    sv.onclick = () => {
      s.codice = null; save(); fondiPiano(); closeSheet(); route();
      toast('Pasto svuotato: il posto e l\'ora restano');
    };
    w.append(sv);
  }

  const via = el('button', 'btn wide');
  via.style.marginTop = '8px';
  // questo toglie il PASTO, cioe' lo slot intero con la sua ora: e' un'altra
  // cosa dal togliere la ricetta che ci sta dentro, ed e' il bottone sopra
  via.textContent = 'Togli questo pasto dal giorno';
  via.onclick = () => {
    if (!confirm(`Tolgo "${s.slot}" da ${g.giorno}? Sparisce il pasto, con la sua ora.`)) return;
    g.pasti.splice(si, 1);
    save(); fondiPiano(); closeSheet(); route(); toast('Pasto tolto');
  };
  w.append(via);
  sheet(w);
}

/* ==================================================== il piano su carta
 *
 * Il resoconto risponde a "com'e' andata"; questo risponde a "cosa devo
 * mangiare", ed e' una domanda che si fa **davanti al frigo**, dove il
 * telefono e' spesso in un'altra stanza e quasi sempre con le mani sporche.
 * Da qui un foglio: i sette giorni con i loro pasti, e in fondo le ricette
 * con i grammi.
 *
 * Le ricette stanno in fondo e **una volta sola**, non sotto ogni giorno:
 * la stessa colazione compare sette volte su sette, e ristamparla ogni volta
 * farebbe quattro pagine di ripetizioni al posto di una di elenco. E si
 * numerano, cosi' la riga del giorno rimanda al punto in cui i grammi stanno
 * scritti.
 *
 * I colori sono `RES_C`, gli stessi del resoconto, e per la stessa ragione:
 * un PDF si stampa su carta bianca, e sono due fogli dello stesso quaderno.
 */
function pdfPiano() {
  const doc = pdfNuovo();
  const X = doc.M, W = doc.larghezza;
  const nome = (typeof profiloAttivo === 'function' && profiloAttivo()?.nome)
    || D.profilo?.nome || '';
  const T = D.target || {};

  /* le ricette usate nella settimana, ognuna con il suo numero. La chiave e'
     il codice **intero**: "pasta con tonno 50/150" e la stessa pesata 150/50
     sono due righe diverse nella lista della spesa, e devono esserlo anche
     qui — e' proprio il caso per cui i pesi per giorno esistono */
  const ricette = new Map();
  for (const g of D.settimana)
    for (const s of (g.pasti || [])) {
      const pa = s.codice && pasto(s.codice);
      if (pa && !ricette.has(s.codice))
        ricette.set(s.codice, { n: ricette.size + 1, pa });
    }

  const titolo = t => {
    doc.serve(70);
    doc.y += 16;
    doc.linea(X, doc.y, X + W, doc.y, { col: RES_C.rule });
    doc.y += 13;
    doc.testo(t, X, doc.y, { size: 11, bold: true, col: RES_C.pine });
    doc.y += 8;
  };

  /* --- testata --- */
  doc.nuovaPagina();
  doc.y += 6;
  doc.testo('PIANO SETTIMANALE', X, doc.y, { size: 8.5, bold: true, col: RES_C.ink3 });
  doc.y += 22;
  doc.testo(nome || 'Il tuo piano', X, doc.y, { size: 20, bold: true, col: RES_C.ink });
  doc.y += 15;
  doc.testo(`Generato il ${today()}`, X, doc.y, { size: 9, col: RES_C.ink3 });
  doc.y += 6;

  if (T.kcal > 0) {
    doc.y += 12;
    doc.rett(X, doc.y, W, 30, { fill: RES_C.wash });
    doc.testo('Il target giornaliero', X + 10, doc.y + 12,
      { size: 8, bold: true, col: RES_C.ink3 });
    doc.testo(`${nf(T.kcal)} kcal · ${macroRiga(T, ' · ')}`, X + W - 10, doc.y + 12,
      { size: 9, col: RES_C.ink, align: 'right' });
    doc.testo('E’ il metro, non la somma dei pasti: i due possono non coincidere.',
      X + 10, doc.y + 24, { size: 7.5, col: RES_C.ink3 });
    doc.y += 30;
  }

  /* --- i sette giorni --- */
  for (const g of D.settimana) {
    const slots = (g.pasti || []).filter(s => s.codice && pasto(s.codice));
    doc.serve(46 + (g.pasti || []).length * 14);
    doc.y += 18;
    doc.testo(nomeGiorno(g.giorno), X, doc.y, { size: 12, bold: true, col: RES_C.ink });
    const tot = g.totali || { kcal: 0 };
    doc.testo(`${nf(tot.kcal)} kcal · ${macroRiga(tot, ' · ')}`, X + W, doc.y,
      { size: 8.5, col: RES_C.ink2, align: 'right' });
    doc.y += 4;
    doc.linea(X, doc.y, X + W, doc.y, { col: RES_C.rule });

    if (!(g.pasti || []).length) {
      doc.y += 13;
      doc.testo('Nessun pasto assegnato.', X, doc.y, { size: 9, col: RES_C.ink3 });
      doc.y += 3;
      continue;
    }
    // le quote dicono com'e' fatta la giornata; le calorie da sole no
    const qm = typeof quoteMacro === 'function' ? quoteMacro(tot) : null;
    if (qm) {
      doc.y += 11;
      doc.testo(`${nf(qm.p, 0)}% proteine · ${nf(qm.c, 0)}% carboidrati · `
        + `${nf(qm.g, 0)}% grassi`, X, doc.y, { size: 7.5, col: RES_C.ink3 });
    }
    for (const s of (g.pasti || [])) {
      const pa = s.codice && pasto(s.codice);
      const r = ricette.get(s.codice);
      doc.serve(16);
      doc.y += 13.5;
      doc.testo(s.ora || '—', X, doc.y, { size: 8.5, col: RES_C.ink3 });
      doc.testo(s.slot || '', X + 34, doc.y, { size: 8.5, col: RES_C.ink3 });
      doc.testo(pa ? `${pa.nome || s.codice}${r ? `  (${r.n})` : ''}` : 'Da assegnare',
        X + 120, doc.y, { size: 9, col: pa ? RES_C.ink : RES_C.ink3 });
      if (pa) {
        const m = macroRicetta(pa) || {};
        doc.testo(macroRiga(m, ' '), X + W - 46, doc.y,
          { size: 7.5, col: RES_C.ink3, align: 'right' });
        doc.testo(nf(m.kcal), X + W, doc.y, { size: 9, col: RES_C.ink, align: 'right' });
      }
    }
    doc.y += 5;
    if (!slots.length) continue;
  }

  /* --- le ricette, una volta sola --- */
  if (ricette.size) {
    titolo('Le ricette, con i grammi');
    doc.y += 6;
    for (const [, r] of ricette) {
      const ing = r.pa.ingredienti || [];
      doc.serve(26 + ing.length * 12);
      doc.y += 14;
      doc.testo(`(${r.n})  ${r.pa.nome || ''}`, X, doc.y,
        { size: 9.5, bold: true, col: RES_C.ink });
      const m = macroRicetta(r.pa) || {};
      doc.testo(`${nf(m.kcal)} kcal · ${macroRiga(m, ' · ')}`, X + W, doc.y,
        { size: 8, col: RES_C.ink2, align: 'right' });
      doc.y += 3;
      doc.linea(X, doc.y, X + W, doc.y, { col: RES_C.rule, w: .35 });
      if (!ing.length) {
        doc.y += 12;
        doc.testo('Un alimento solo, senza ricetta.', X + 10, doc.y,
          { size: 8.5, col: RES_C.ink3 });
        doc.y += 2;
        continue;
      }
      for (const i of ing) {
        doc.serve(14);
        doc.y += 11.5;
        doc.testo(i.alimento, X + 10, doc.y, { size: 8.5, col: RES_C.ink2 });
        const u = typeof unitaIngrediente === 'function' ? unitaIngrediente(i) : 'g';
        doc.testo(`${nf(i.qta, i.qta % 1 ? 1 : 0)} ${u}`, X + W, doc.y,
          { size: 8.5, col: RES_C.ink, align: 'right' });
      }
      doc.y += 3;
    }
    doc.y += 8;
    doc.paragrafo('I grammi sono quelli del piano. Le porzioni cambiate su una '
      + 'singola giornata dal diario non compaiono qui: valgono per quel giorno, '
      + 'e questo foglio e’ la settimana.',
      { size: 8, col: RES_C.ink3, interlinea: 11 });
  }

  doc.chiudi((d, i, n) => {
    const y = d.H - 26;
    d.linea(X, y, X + W, y, { col: RES_C.rule, w: .4 });
    d.testo(`Dieta · piano settimanale · ${today()}`, X, y + 10,
      { size: 7.5, col: RES_C.ink3 });
    d.testo(`${i} / ${n}`, X + W, y + 10, { size: 7.5, col: RES_C.ink3, align: 'right' });
  });
  return doc.bytes();
}

function scaricaPiano() {
  scaricaPdf(`piano-settimanale-${today()}.pdf`, pdfPiano());
  toast('Piano scaricato');
}
