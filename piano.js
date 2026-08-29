/* Profili e piano personalizzato.
 *
 * data/dieta.json resta la fonte di verita' di BASE — quel piano e' stato
 * costruito e verificato a monte, e non va toccato. Quello che l'utente crea
 * si sovrappone come strato: alimenti aggiunti, pasti composti, target propri,
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
    misure: esempio ? DBASE.misure : DBASE.misure.map(m => ({ ...m, base: null }))
  };
  D.settimana = D.settimana.map(g => ({ ...g, totali: totaliGiorno(g) }));
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

/** Macro di un pasto composto: somma degli ingredienti pesati. */
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
    pianoTab = 'profilo'; location.hash = '#/piano'; route(); };
  v.append(vuoto);

  const esempio = el('button', 'step');
  esempio.innerHTML = `<span class="n">2</span>
    <span class="body">
      <span class="t">Carica il piano vegano di esempio</span>
      <span class="d">Un piano completo gia' pronto: ${Object.keys(DBASE.pasti).length} pasti su sette giorni, ${nf(DBASE.target.kcal)} kcal e ${DBASE.target.p} g di proteine.</span>
      <span class="s">Attenzione: contiene i dati di un'altra persona (eta', altezza, peso, misure). Cambiali dal passo "Chi sei".</span>
    </span><span class="go">›</span>`;
  esempio.onclick = () => {
    if (!confirm('Il piano di esempio porta con se\' profilo, target, pasti e misure di partenza di un\'altra persona. Li vedrai finche\' non li cambi. Procedo?')) return;
    S.settings.pianoBase = 'esempio'; save(); fondiPiano();
    location.hash = '#/oggi'; route();
  };
  v.append(esempio);

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Si puo' cambiare idea</div>
     <div class="muted">Da Impostazioni puoi caricare l'esempio anche dopo, o
     ricominciare da zero. Quello che hai gia' scritto tu non viene toccato.</div>`));
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
      stato: `${esc(D.profilo.nome)}, ${D.profilo.eta} anni, ${D.profilo.altezza_cm} cm` },
    { id: 'target', t: 'Quanto mangiare',
      d: 'Calorie e macro da centrare ogni giorno.',
      perche: 'E’ il metro con cui l’app giudica le giornate: analisi, cruscotto, consigli e previsione del peso partono tutti da qui.',
      mio: Object.keys(p.target).length > 0,
      stato: `${nf(D.target.kcal)} kcal · ${D.target.p} g di proteine` },
    { id: 'alimenti', t: 'Cosa mangi',
      d: 'Aggiungi i tuoi alimenti o correggi quelli del piano.',
      perche: 'Sono i mattoni dei pasti. Puoi saltare questo passo: i ' + baseAli + ' del piano di partenza bastano per cominciare.',
      mio: nAli > 0,
      stato: nAli ? `${nAli} tuoi, oltre ai ${baseAli} di base` : `${baseAli} di base, nessuno tuo` },
    { id: 'pasti', t: 'Come li combini',
      d: 'Componi i pasti pesando gli ingredienti.',
      perche: 'I macro si calcolano da soli mentre aggiungi. Un pasto composto qui puoi assegnarlo a qualunque giorno della settimana.',
      mio: nPas > 0,
      stato: nPas ? `${nPas} tuoi, oltre ai ${basePas} di base` : `${basePas} di base, nessuno tuo` },
    { id: 'settimana', t: 'Quando li mangi',
      d: 'Assegna i pasti agli slot dei sette giorni.',
      perche: 'E’ quello che vedi nella scheda Oggi: da qui escono le barre dei macro, il totale residuo e la lista della spesa.',
      mio: !!p.settimana,
      stato: p.settimana ? 'riorganizzata da te' : 'quella del piano di partenza' }
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
  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come funziona</div>
     <div class="muted">Un piano risponde a cinque domande, in quest’ordine:
     <strong>chi sei</strong>, <strong>quanto mangiare</strong>, <strong>cosa</strong>,
     <strong>come lo combini</strong>, <strong>quando</strong>.
     Puoi fermarti a qualsiasi punto: quello che non tocchi resta come nel piano
     di partenza, e l’app continua a funzionare.</div>
     <div class="hint" style="margin-top:8px">Hai personalizzato ${miei} passi su ${passi.length}.</div>`));

  /* --- i cinque passi --- */
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

  const base = el('div', 'card flat');
  base.append(el('div', 'eyebrow', 'Piano di partenza'));
  base.append(el('div', 'muted', S.settings.pianoBase === 'esempio'
    ? 'Stai usando il piano vegano di esempio come base.'
    : 'Stai costruendo il piano da zero: nessun pasto preimpostato.'));
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
function sezProfilo(v) {
  const p = piano();
  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'Chi sei'));
  c.lastChild.style.marginTop = '0';
  c.append(el('p', 'muted', 'Servono al calcolo del dispendio a riposo e alla figura in scala.'));
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
    'Il sesso entra solo nella formula di Mifflin-St Jeor (+5 per gli uomini, −161 per le donne) e nella stima del grasso, che ha coefficienti diversi.'));

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
}

/* ---------------------------------------------------------------- target */
function sezTarget(v) {
  const p = piano();
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
function sezAlimenti(v) {
  const p = piano();
  const mieiIds = Object.keys(p.alimenti);
  const b = el('button', 'btn wide pri', 'Aggiungi un alimento');
  b.onclick = () => sheetAlimento(null);
  v.append(b);

  if (mieiIds.length) {
    const c = el('div', 'card');
    c.append(el('h2', 'sec', `Aggiunti da te (${mieiIds.length})`));
    c.lastChild.style.marginTop = '0';
    for (const n of mieiIds.sort()) {
      const a = D.alimenti[n];
      const r = el('button', 'prod');
      r.innerHTML = `<div class="grow"><div class="nm">${esc(n)}</div>
        <div class="mt">${nf(a.p, 1)}P ${nf(a.c, 1)}C ${nf(a.g, 1)}G · ${esc(a.categoria || '')}</div></div>
        <div class="kc">${nf(a.kcal)}<br><span class="mt">/100${esc(a.unita || 'g')}</span></div>`;
      r.onclick = () => sheetAlimento(n);
      c.append(r);
    }
    v.append(c);
  }
  const c2 = el('div', 'card');
  c2.append(el('h2', 'sec', `Nel piano di base (${Object.keys(DBASE.alimenti).length})`));
  c2.lastChild.style.marginTop = '0';
  c2.append(el('p', 'muted', 'Puoi modificarli: la versione modificata vale solo per questo profilo, il file di partenza resta com\'e\'.'));
  for (const n of Object.keys(DBASE.alimenti).sort()) {
    const a = D.alimenti[n];
    const r = el('button', 'prod');
    r.innerHTML = `<div class="grow"><div class="nm">${esc(n)}</div>
      <div class="mt">${nf(a.kcal)} kcal · ${esc(a.categoria || '')}</div></div>
      ${p.alimenti[n] ? '<span class="pill ok">modificato</span>' : ''}`;
    r.onclick = () => sheetAlimento(n);
    c2.append(r);
  }
  v.append(c2);
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
  const campo = (id, lab, val, mode) => el('div', 'field',
    `<label>${lab}</label><input type="text" inputmode="${mode || 'decimal'}"
      id="al-${id}" value="${val != null ? esc(String(val)) : ''}">`);
  if (!nome) w.append(campo('nome', 'Nome', pre?.nome, 'text'));
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  g.append(campo('kcal', 'Calorie', cur?.kcal), campo('p', 'Proteine (g)', cur?.p),
           campo('c', 'Carboidrati (g)', cur?.c), campo('g', 'Grassi (g)', cur?.g),
           campo('fibre', 'Fibre (g)', cur?.fibre),
           campo('categoria', 'Categoria', cur?.categoria, 'text'));
  w.append(g);
  // le categorie gia' in uso come suggerimento: il motore delle sostituzioni
  // confronta stringhe, e "legumi" contro "Legumi" sarebbero due mondi separati
  const dl = el('datalist'); dl.id = 'al-cats';
  for (const cx of [...new Set(Object.values(D.alimenti).map(x => x.categoria).filter(Boolean))].sort())
    dl.append(new Option(cx));
  w.append(dl);
  g.querySelector('#al-categoria')?.setAttribute('list', 'al-cats');
  w.append(el('div', 'hint',
    'La categoria serve al motore delle sostituzioni: cerca alternative solo dentro la stessa categoria.'));

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
  const b = el('button', 'btn wide pri', 'Componi un pasto');
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
      const pa = D.pasti[id];
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
  const base = id ? D.pasti[id] : null;
  const stato = {
    codice: id && p.pasti[id] ? id : (id ? id + '-mio' : 'pasto-' + uid().slice(0, 5)),
    nome: base?.nome || '',
    ing: (base?.ingredienti || []).map(x => ({ ...x }))
  };

  const w = el('div');
  w.append(el('div', 'eyebrow', id ? 'Modifica pasto' : 'Nuovo pasto'));
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
      r.innerHTML = `<span>${esc(ing.alimento)}</span>
        <span class="mono qv">${nf(ing.qta)} ${esc(a?.unita || 'g')}</span>
        <span class="mono muted kv">${nf(m.kcal)} kcal</span>
        <span class="mono pv">${nf(m.p, 1)}P</span>`;
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
          r.querySelector('.pv').textContent = nf(mm.p, 1) + 'P';
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
  const sa = el('select');
  sa.id = 'pt-al';
  sa.style.cssText = 'width:100%;padding:9px 10px;border:1px solid var(--rule);border-radius:9px;'
    + 'background:var(--paper);color:var(--ink);font:inherit;margin-bottom:8px';
  for (const n of Object.keys(D.alimenti).sort()) sa.append(new Option(n, n));
  add.append(sa);
  add.append(el('div', 'field',
    '<label>Quantita</label><input type="text" inputmode="decimal" id="pt-q" value="100">'));
  const ba = el('button', 'btn wide', 'Aggiungi');
  ba.onclick = () => {
    const q = parseNum($('#pt-q').value);
    if (!(q > 0)) { toast('Quantita non valida'); return; }
    stato.ing.push({ alimento: $('#pt-al').value, qta: q });
    disegna();
  };
  add.append(ba);
  w.append(add);

  const salva = el('button', 'btn wide pri', 'Salva il pasto');
  salva.style.marginTop = '10px';
  salva.onclick = () => {
    const nome = $('#pt-nome').value.trim();
    if (!nome) { toast('Serve il nome'); return; }
    if (!stato.ing.length) { toast('Serve almeno un ingrediente'); return; }
    p.pasti[stato.codice] = {
      nome, ingredienti: stato.ing, macro: macroDaIngredienti(stato.ing)
    };
    save(); fondiPiano(); closeSheet(); route(); toast('Pasto salvato');
  };
  w.append(salva);
  if (id && p.pasti[id]) {
    const del = el('button', 'btn wide', 'Elimina');
    del.style.marginTop = '8px';
    del.onclick = () => {
      if (!confirm('Eliminare questo pasto?')) return;
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
  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come funziona</div>
     <div class="muted">Ogni giorno ha i suoi pasti. Tocca un pasto per cambiare
     quello assegnato o per toglierlo, oppure aggiungine uno: <strong>il numero di
     pasti puo essere diverso da un giorno all altro</strong>. I totali si
     ricalcolano da soli.</div>`));

  for (const [gi, g] of sett.entries()) {
    const c = el('div', 'card');
    c.append(el('div', 'row between',
      `<strong style="font-family:var(--serif);font-size:16px">${esc(g.giorno)}</strong>
       <span class="mono muted" style="font-size:11px">${nf(g.totali.kcal)} kcal · ${nf(g.totali.p, 0)} P</span>`));
    for (const [si, s] of (g.pasti || []).entries()) {
      const pa = D.pasti[s.codice];
      const r = el('button', 'prod');
      r.innerHTML = `<div class="grow"><div class="mt">${esc(s.slot)}${s.ora ? ' · ' + esc(s.ora) : ''}</div>
        <div class="nm">${esc(pa?.nome || s.codice)}</div></div>
        <div class="kc">${pa ? nf(pa.macro.kcal) : '—'}</div>`;
      r.onclick = () => cambiaSlot(gi, si);
      c.append(r);
    }
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

/** Aggiunge un pasto a un giorno: il numero di pasti non e' fisso. */
function nuovoSlot(gi) {
  const p = piano();
  p.settimana ||= JSON.parse(JSON.stringify(
    S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
  const g = p.settimana[gi];
  const w = el('div');
  w.append(el('div', 'eyebrow', esc(g.giorno)));
  w.append(el('h2', 'sec', 'Nuovo pasto'));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Come si chiama</label>
     <input type="text" id="ns-slot" placeholder="Spuntino del pomeriggio">`));
  w.append(el('div', 'field',
    `<label>A che ora <span class="muted">(facoltativo)</span></label>
     <input type="text" id="ns-ora" placeholder="16:30">`));
  const b = el('button', 'btn wide pri', 'Aggiungi');
  b.onclick = () => {
    const nome = $('#ns-slot').value.trim();
    if (!nome) { toast('Serve un nome'); return; }
    g.pasti.push({ slot: nome, ora: $('#ns-ora').value.trim() || '', codice: null });
    save(); fondiPiano(); closeSheet(); route(); toast('Pasto aggiunto');
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
  w.append(el('h2', 'sec', 'Scegli il pasto'));
  w.lastChild.style.marginTop = '0';
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
  const via = el('button', 'btn wide');
  via.style.marginTop = '12px';
  via.textContent = 'Togli questo pasto dal giorno';
  via.onclick = () => {
    if (!confirm(`Tolgo "${s.slot}" da ${g.giorno}?`)) return;
    g.pasti.splice(si, 1);
    save(); fondiPiano(); closeSheet(); route(); toast('Pasto tolto');
  };
  w.append(via);
  sheet(w);
}
