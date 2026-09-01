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
    pasti: ordinaSlotOrari((g.pasti || []).map(x => ({ ...x }))),
    totali: totaliGiorno(g)
  }));
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
    const pa = D.pasti[s.codice];
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
      d: 'Assegna le ricette agli slot dei sette giorni.',
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
  const s = passi[i];

  const testa = el('div', 'card');
  const back = el('button', 'btn sm', '‹ Il piano');
  back.onclick = () => { pianoTab = null; route(); };
  testa.append(back);
  testa.append(el('div', 'eyebrow', `Passo ${i + 1} di ${passi.length}`));
  testa.lastChild.style.marginTop = '10px';
  testa.append(el('h2', 'sec', esc(s.t)));
  testa.lastChild.style.marginTop = '2px';
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

  // Il target e la settimana pianificata sono due cose diverse: le barre della
  // scheda Oggi vengono dalla somma dei pasti previsti, non da qui. Se i due
  // numeri divergono l'app lo deve dire, altrimenti si insegue un target che
  // nessun pasto del piano puo' centrare.
  const mediaPiano = avg(D.settimana.map(g => g.totali.kcal));
  const scarto = mediaPiano - (D.target.kcal || 0);
  if (Math.abs(scarto) > (D.target.kcal || 1) * 0.08) {
    c.append(el('div', 'flag warn',
      `<div class="ico">!</div><div class="grow"><h4>Il piano non centra questo target</h4>
       <p>I pasti assegnati nella settimana fanno in media <strong>${nf(mediaPiano)} kcal</strong>,
       cioe' ${scarto > 0 ? nf(scarto) + ' in piu' : nf(-scarto) + ' in meno'} del target che hai
       impostato. Le barre della scheda Oggi seguono i pasti, non questo numero: per farli
       coincidere cambia i pasti nella scheda Settimana, oppure riporta il target
       a ${nf(mediaPiano)}.</p></div>`));
  } else {
    c.append(el('div', 'read',
      `<span>Settimana pianificata: <b>${nf(mediaPiano)} kcal</b> di media</span><span>coerente col target</span>`));
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

  const miei = Object.keys(p.pasti);
  const lista = (titolo, ids, sub) => {
    if (!ids.length) return;
    const c = el('div', 'card');
    c.append(el('h2', 'sec', titolo));
    c.lastChild.style.marginTop = '0';
    if (sub) c.append(el('p', 'muted', sub));
    for (const id of ids.sort()) {
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
    v.append(c);
  };
  lista(`Composti da te (${miei.length})`, miei);
  lista(`Nel piano di base (${Object.keys(DBASE.pasti).length})`,
        Object.keys(DBASE.pasti), 'Toccane uno per usarlo come punto di partenza.');
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
  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come funziona</div>
     <div class="muted">Ogni giorno ha i suoi slot. Tocca uno slot per cambiare
     la ricetta assegnata o per toglierla, oppure aggiungine uno: <strong>il numero
     di ricette puo essere diverso da un giorno all altro</strong>. I totali si
     ricalcolano da soli.</div>`));

  for (const [gi, g] of sett.entries()) {
    const c = el('div', 'card');
    c.append(el('div', 'row between',
      `<strong style="font-family:var(--serif);font-size:16px">${esc(g.giorno)}</strong>
       <span class="mono muted" style="font-size:11px">${nf(g.totali.kcal)} kcal · ${macroRiga(g.totali)}</span>`));
    const righe = [];
    for (const [si, s] of (g.pasti || []).entries()) {
      const pa = D.pasti[s.codice];
      const senzOra = oraMinuti(s.ora) == null;
      // s.codice e' null finche' non assegni, ed esc(null) stampava "null":
      // con il piano vuoto erano sette giorni di righe che dicevano "null"
      const r = el('button', 'prod riga-slot' + (pa ? '' : ' vuoto'));
      r.innerHTML = `${senzOra ? '<span class="drag-h" aria-hidden="true">\u2261</span>' : ''}
        <div class="grow"><div class="mt">${esc(s.slot)}${s.ora ? ' · ' + esc(s.ora) : ''}</div>
        <div class="nm">${pa ? esc(pa.nome || s.codice) : 'Da assegnare'}</div></div>
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
    add.textContent = '+ Aggiungi una ricetta a ' + g.giorno.toLowerCase();
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
function nuovoSlot(gi) {
  const p = piano();
  p.settimana ||= JSON.parse(JSON.stringify(
    S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
  const g = p.settimana[gi];
  const w = el('div');
  w.append(el('div', 'eyebrow', esc(g.giorno)));
  w.append(el('h2', 'sec', 'Nuova ricetta'));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Come si chiama</label>
     <input type="text" id="ns-slot" placeholder="Spuntino del pomeriggio">`));
  w.append(el('div', 'field',
    `<label>A che ora <span class="muted">(facoltativo)</span></label>
     <input type="text" inputmode="numeric" id="ns-ora" placeholder="16:30">
     <div class="hint">Con l'ora il pasto si mette da solo al posto giusto nella
     giornata. Senza, resta dove lo aggiungi e lo sposti trascinandolo.</div>`));
  const b = el('button', 'btn wide pri', 'Aggiungi');
  b.onclick = () => {
    const nome = $('#ns-slot').value.trim();
    if (!nome) { toast('Serve un nome'); return; }
    const ora = $('#ns-ora').value.trim();
    if (ora && oraMinuti(ora) == null) { toast('L\'ora si scrive cosi\': 16:30'); return; }
    g.pasti.push({ slot: nome, ora, codice: null });
    ordinaSlotOrari(g.pasti);
    save(); fondiPiano(); closeSheet(); route();
    toast(ora ? 'Aggiunto alle ' + ora : 'Aggiunto in fondo: trascinalo dove vuoi');
  };
  w.append(b);
  sheet(w);
}

function cambiaSlot(gi, si) {
  const p = piano();
  // la prima modifica clona la settimana di base: da li' in poi e' tua
  p.settimana ||= JSON.parse(JSON.stringify(
    S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
  const g = p.settimana[gi], s = g.pasti[si];
  const w = el('div');
  w.append(el('div', 'eyebrow', `${esc(g.giorno)} · ${esc(s.slot)}`));
  w.append(el('h2', 'sec', 'Scegli la ricetta'));
  w.lastChild.style.marginTop = '0';

  /* Con il piano vuoto D.pasti e' vuoto, e questo foglio mostrava il titolo,
     un vuoto, e il bottone per togliere lo slot: sembrava rotto, e in pratica
     lo era — non c'era nessuna strada da qui in avanti. Un elenco vuoto va
     detto, e va detto DOVE si va a riempirlo. */
  const quanti = Object.keys(D.pasti).length;
  if (!quanti) {
    w.append(el('p', 'muted',
      'Non hai ancora composto nessuna ricetta, quindi non c\'e\' niente da assegnare a '
      + 'questo slot. Le ricette si costruiscono nel passo <strong>"Le tue ricette"</strong>: '
      + 'scegli gli alimenti e le quantita\', i macro si calcolano da soli, e da li\' in '
      + 'poi quella ricetta la metti in qualunque giorno.'));
    const vai = el('button', 'btn wide pri', 'Vai a comporre una ricetta');
    vai.onclick = () => { pianoTab = 'pasti'; closeSheet(); route(); };
    w.append(vai);
    const ind = el('button', 'btn wide', 'Torna alla settimana');
    ind.style.marginTop = '8px';
    ind.onclick = closeSheet;
    w.append(ind);
    w.append(el('p', 'note',
      'Lo slot resta dov\'e\': un giorno con gli orari gia\' impostati e le ricette ancora '
      + 'da scegliere e\' un piano a meta\', non un piano rotto.'));
    sheet(w);
    return;
  }

  for (const [code, pa] of Object.entries(D.pasti)
      .sort((a, b) => (a[1].nome || '').localeCompare(b[1].nome || ''))) {
    const r = el('button', 'prod');
    r.innerHTML = `<div class="grow"><div class="nm">${esc(pa.nome || code)}</div>
      <div class="mt">${nf(pa.macro.p, 0)}P ${nf(pa.macro.c, 0)}C ${nf(pa.macro.g, 0)}G</div></div>
      <div class="kc">${nf(pa.macro.kcal)}${code === s.codice ? '<br><span class="mt">attuale</span>' : ''}</div>`;
    r.onclick = () => {
      s.codice = code; save(); fondiPiano(); closeSheet(); route(); toast('Slot aggiornato');
    };
    w.append(r);
  }
  /* L'ora si imposta qui, e cambiandola il pasto si rimette al posto giusto
     nella giornata: un orario che non riordina niente e' solo un'etichetta. */
  const fo = el('div', 'field',
    `<label>A che ora <span class="muted">(facoltativo)</span></label>
     <input type="text" inputmode="numeric" id="cs-ora" value="${esc(s.ora || '')}"
            placeholder="16:30">`);
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
    sv.textContent = 'Lascia lo slot vuoto';
    sv.onclick = () => {
      s.codice = null; save(); fondiPiano(); closeSheet(); route();
      toast('Slot svuotato: l\'orario resta');
    };
    w.append(sv);
  }

  const via = el('button', 'btn wide');
  via.style.marginTop = '8px';
  via.textContent = 'Togli questa ricetta dal giorno';
  via.onclick = () => {
    if (!confirm(`Tolgo "${s.slot}" da ${g.giorno}?`)) return;
    g.pasti.splice(si, 1);
    save(); fondiPiano(); closeSheet(); route(); toast('Ricetta tolta');
  };
  w.append(via);
  sheet(w);
}
