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

/**
 * D = base + strato dell'utente. Gli oggetti si fondono per chiave, cosi'
 * modificare un alimento non cancella gli altri; la settimana invece si
 * sostituisce in blocco, perche' un piano riorganizzato a meta' non avrebbe
 * senso.
 */
function fondiPiano() {
  const p = piano();
  D = {
    ...DBASE,
    profilo:  { ...DBASE.profilo, ...p.profilo },
    target:   { ...DBASE.target, ...p.target },
    alimenti: { ...DBASE.alimenti, ...p.alimenti },
    pasti:    { ...DBASE.pasti, ...p.pasti },
    settimana: p.settimana || DBASE.settimana
  };
  // i totali della settimana vanno ricalcolati se i pasti sono cambiati
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

/* =============================================================== vista */
let pianoTab = 'profilo';

function viewPiano(v) {
  const P0 = profili();

  /* --- profili --- */
  const cp = el('div', 'card');
  cp.append(el('div', 'eyebrow', 'Profilo attivo'));
  const sel = el('select');
  sel.style.cssText = 'width:100%;padding:10px;border:1px solid var(--rule);border-radius:9px;'
    + 'background:var(--paper);color:var(--ink);font:inherit;margin:6px 0 10px';
  for (const x of P0.lista) sel.append(new Option(x.nome, x.id, false, x.id === P0.attivo));
  sel.onchange = () => cambiaProfilo(sel.value);
  cp.append(sel);
  const bn = el('button', 'btn wide', 'Nuovo profilo');
  bn.onclick = () => {
    const n = prompt('Nome del profilo (per esempio: Marco)');
    if (!n || !n.trim()) return;
    creaProfilo(n.trim()); location.reload();
  };
  cp.append(bn);
  cp.append(el('p', 'hint',
    'Ogni profilo ha il suo diario, il suo piano e le sue foto, separati del tutto. '
    + 'Il piano di partenza e\' lo stesso file per tutti: quello che cambi qui vale solo per questo profilo.'));
  if (P0.lista.length > 1 && P0.attivo !== 'principale') {
    const bd = el('button', 'btn wide');
    bd.style.marginTop = '8px';
    bd.textContent = 'Elimina questo profilo';
    bd.onclick = () => {
      if (!confirm(`Eliminare "${profiloAttivo().nome}" con tutto il suo diario? Non si puo' annullare.`)) return;
      localStorage.removeItem(chiaveStato());
      const p = profili();
      p.lista = p.lista.filter(x => x.id !== p.attivo);
      p.attivo = p.lista[0].id; salvaProfili(p);
      location.reload();
    };
    cp.append(bd);
  }
  v.append(cp);

  /* --- schede --- */
  const seg = el('div', 'seg');
  for (const [id, lab] of [['profilo', 'Dati'], ['target', 'Target'],
                           ['alimenti', 'Alimenti'], ['pasti', 'Pasti'], ['settimana', 'Settimana']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', pianoTab === id);
    b.onclick = () => { pianoTab = id; route(); };
    seg.append(b);
  }
  const box = el('div', 'card flat');
  box.append(el('div', 'eyebrow', 'Cosa modifichi'));
  box.append(seg);
  v.append(box);

  ({ profilo: sezProfilo, target: sezTarget, alimenti: sezAlimenti,
     pasti: sezPasti, settimana: sezSettimana }[pianoTab])(v);
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

function sheetAlimento(nome) {
  const p = piano();
  const cur = nome ? D.alimenti[nome] : null;
  const w = el('div');
  w.append(el('div', 'eyebrow', nome ? 'Alimento' : 'Nuovo alimento'));
  w.append(el('h2', 'sec', nome ? esc(nome) : 'Valori per 100 g'));
  w.lastChild.style.marginTop = '0';
  const campo = (id, lab, val, mode) => el('div', 'field',
    `<label>${lab}</label><input type="text" inputmode="${mode || 'decimal'}"
      id="al-${id}" value="${val != null ? esc(String(val)) : ''}">`);
  if (!nome) w.append(campo('nome', 'Nome', '', 'text'));
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  g.append(campo('kcal', 'Calorie', cur?.kcal), campo('p', 'Proteine (g)', cur?.p),
           campo('c', 'Carboidrati (g)', cur?.c), campo('g', 'Grassi (g)', cur?.g),
           campo('fibre', 'Fibre (g)', cur?.fibre),
           campo('categoria', 'Categoria', cur?.categoria, 'text'));
  w.append(g);
  w.append(el('div', 'hint',
    'La categoria serve al motore delle sostituzioni: cerca alternative solo dentro la stessa categoria.'));

  const b = el('button', 'btn wide pri', 'Salva');
  b.onclick = () => {
    const n = nome || $('#al-nome').value.trim();
    if (!n) { toast('Serve il nome'); return; }
    const num = id => parseNum($('#al-' + id).value) ?? 0;
    p.alimenti[n] = {
      kcal: num('kcal'), p: num('p'), c: num('c'), g: num('g'), fibre: num('fibre'),
      categoria: $('#al-categoria').value.trim() || 'altro',
      unita: cur?.unita || 'g', fonte: 'verificato'
    };
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
  const disegna = () => {
    lista.innerHTML = '';
    for (const [i, ing] of stato.ing.entries()) {
      const a = D.alimenti[ing.alimento];
      const r = el('div', 'cmp-r');
      r.style.cursor = 'pointer';
      const m = a ? foodM(ing.alimento, ing.qta) : M0();
      r.innerHTML = `<span>${esc(ing.alimento)}</span>
        <span class="mono">${nf(ing.qta)} ${esc(a?.unita || 'g')}</span>
        <span class="mono muted">${nf(m.kcal)} kcal</span>
        <span class="mono">${nf(m.p, 1)}P</span>`;
      r.onclick = () => {
        const q = prompt(`Quanti ${a?.unita || 'g'} di ${ing.alimento}? (0 per toglierlo)`, ing.qta);
        if (q == null) return;
        const n = parseNum(q);
        if (n == null) return;
        if (n <= 0) stato.ing.splice(i, 1); else stato.ing[i].qta = n;
        disegna();
      };
      lista.append(r);
    }
    const m = macroDaIngredienti(stato.ing);
    tot.innerHTML = `<span><b>${nf(m.kcal)} kcal</b></span><span>${nf(m.p, 1)} P</span>`
      + `<span>${nf(m.c, 1)} C</span><span>${nf(m.g, 1)} G</span><span>${nf(m.fibre, 1)} fibre</span>`;
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
     <div class="muted">Ogni giorno ha degli slot (colazione, pranzo, cena…). Tocca uno
     slot per cambiare il pasto assegnato. I totali si ricalcolano da soli.</div>`));

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

function cambiaSlot(gi, si) {
  const p = piano();
  // la prima modifica clona la settimana di base: da li' in poi e' tua
  p.settimana ||= JSON.parse(JSON.stringify(DBASE.settimana));
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
  sheet(w);
}
