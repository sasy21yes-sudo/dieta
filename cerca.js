/* Un selettore che si puo' cercare, e la dispensa.
 *
 * Il selettore nasce da un problema concreto: il catalogo esercizi e il
 * database alimenti sono liste da decine di voci, e un <select> nativo su
 * iPhone diventa una ruota da far girare col pollice. Qui invece si scrive
 * due lettere e si sceglie.
 *
 * La ricerca ignora accenti e maiuscole, e da' la precedenza a chi COMINCIA
 * con quello che hai scritto: cercando "pan" la panca viene prima del
 * pane integrale, che pure lo contiene.
 */
'use strict';

/** Toglie accenti e maiuscole: "Pomodorì" e "pomodori" devono incontrarsi. */
const piatto = s => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Ordina per pertinenza: prima chi comincia con la chiave, poi chi la
 * contiene, e a parita' in ordine alfabetico. Senza chiave, tutto in ordine.
 */
function filtraOpzioni(opzioni, q) {
  const s = piatto(q).trim();
  if (!s) return opzioni.slice();
  const out = [];
  for (const o of opzioni) {
    const t = piatto(o.lab), i = t.indexOf(s);
    if (i < 0 && !(o.sub && piatto(o.sub).includes(s))) continue;
    out.push({ o, rango: i === 0 ? 0 : i > 0 ? 1 : 2, i });
  }
  out.sort((a, b) => a.rango - b.rango || a.o.lab.localeCompare(b.o.lab));
  return out.map(x => x.o);
}

/**
 * Un campo che apre una lista filtrabile.
 * opzioni: [{ v, lab, sub? }]. onScegli riceve il valore.
 * Torna l'elemento; `.valore()` legge la scelta corrente.
 */
function selettoreCercabile(opzioni, valore, onScegli, ph = 'Cerca…') {
  let scelto = valore;
  const box = el('div', 'sel-c');
  const inp = el('input');
  inp.type = 'text';
  inp.placeholder = ph;
  inp.autocomplete = 'off';
  inp.className = 'sel-i';
  const cur = opzioni.find(o => o.v === valore);
  inp.value = cur ? cur.lab : '';
  const lista = el('div', 'sel-l');
  lista.hidden = true;

  const disegna = () => {
    lista.innerHTML = '';
    const trovate = filtraOpzioni(opzioni, inp.dataset.q ?? '');
    if (!trovate.length) {
      lista.append(el('div', 'sel-vuoto', 'Nessuna corrispondenza'));
      return;
    }
    for (const o of trovate.slice(0, 40)) {
      const b = el('button', 'sel-o' + (o.v === scelto ? ' on' : ''));
      b.type = 'button';
      b.innerHTML = `<span class="l">${esc(o.lab)}</span>`
        + (o.sub ? `<span class="s">${esc(o.sub)}</span>` : '');
      b.onclick = () => {
        scelto = o.v; inp.value = o.lab; inp.dataset.q = '';
        lista.hidden = true;
        onScegli?.(o.v, o);
      };
      lista.append(b);
    }
    if (trovate.length > 40)
      lista.append(el('div', 'sel-vuoto', `…e altre ${trovate.length - 40}. Scrivi qualche lettera in piu'.`));
  };

  // al tocco si svuota il campo: altrimenti la voce gia' scelta filtrerebbe
  // la lista fino a se stessa, e sembrerebbe rotto
  inp.onfocus = () => { inp.dataset.q = ''; inp.select(); lista.hidden = false; disegna(); };
  inp.oninput = () => { inp.dataset.q = inp.value; lista.hidden = false; disegna(); };
  inp.onblur = () => setTimeout(() => {
    lista.hidden = true;
    const o = opzioni.find(x => x.v === scelto);
    inp.value = o ? o.lab : '';
  }, 180);

  box.append(inp, lista);
  box.valore = () => scelto;
  box.imposta = v => {
    scelto = v;
    const o = opzioni.find(x => x.v === v);
    inp.value = o ? o.lab : '';
  };
  return box;
}

/* ============================================================= dispensa */
/*
 * Quello che hai gia' in casa non va comprato di nuovo. La lista della spesa
 * sa quanto serve nella settimana; la dispensa sa quanto ce n'e'. La
 * differenza e' l'unica cifra che serve davanti allo scaffale.
 *
 * Non si tenta di scalare la dispensa da sola mano a mano che mangi: sarebbe
 * un inventario, e un inventario che non torna e' peggio di nessun
 * inventario. Lo aggiorni tu quando fai la spesa, in trenta secondi.
 */
function dispensa() { S.dispensa ||= {}; return S.dispensa; }

/** Serve, ho, compro. */
function fabbisognoNetto() {
  const byCat = shoppingList(), disp = dispensa(), out = {};
  for (const [cat, items] of Object.entries(byCat)) {
    out[cat] = items.map(it => {
      const ho = +disp[it.nome] || 0;
      return { ...it, ho, compra: Math.max(0, it.q - ho) };
    });
  }
  return out;
}

function sheetDispensa() {
  const disp = dispensa();
  const byCat = shoppingList();
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Cosa hai gia\''));
  w.append(el('h2', 'sec', 'Dispensa'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Scrivi quanto ne hai in casa. La lista della spesa toglie questa quantita\' '
    + 'da quella che serve, e ti resta davanti solo quello che devi davvero comprare.'));

  const tutte = [];
  for (const items of Object.values(byCat)) tutte.push(...items);
  tutte.sort((a, b) => a.nome.localeCompare(b.nome));

  const cerca = el('input');
  cerca.type = 'text'; cerca.placeholder = 'Filtra…'; cerca.className = 'sel-i';
  cerca.style.marginBottom = '10px';
  w.append(cerca);

  const lista = el('div');
  const disegna = () => {
    lista.innerHTML = '';
    const q = piatto(cerca.value);
    for (const it of tutte) {
      if (q && !piatto(it.nome).includes(q)) continue;
      const r = el('div', 'porz');
      const ho = +disp[it.nome] || 0;
      r.innerHTML = `<span class="nm">${esc(it.nome)}<em>serve ${nf(it.q)} ${esc(it.unita)}</em></span>
        <button class="btn sm" data-d="-50">−</button>
        <input type="text" inputmode="decimal" value="${ho || ''}" placeholder="0">
        <button class="btn sm" data-d="50">+</button>
        <span class="u">${esc(it.unita)}</span>`;
      const inp = r.querySelector('input');
      const setta = n => {
        n = Math.max(0, Math.round(n * 10) / 10);
        if (n) disp[it.nome] = n; else delete disp[it.nome];
        inp.value = n || '';
        r.classList.toggle('mod', n > 0);
        save();
      };
      r.classList.toggle('mod', ho > 0);
      r.querySelectorAll('[data-d]').forEach(b => b.onclick = () =>
        setta((parseNum(inp.value) || 0) + (+b.dataset.d)));
      inp.oninput = () => { const n = parseNum(inp.value); if (n != null && n >= 0) setta(n); };
      lista.append(r);
    }
    if (!lista.children.length) lista.append(el('p', 'muted', 'Niente che corrisponda.'));
  };
  cerca.oninput = disegna;
  disegna();
  w.append(lista);

  const az = el('button', 'btn wide', 'Svuota la dispensa');
  az.style.marginTop = '12px';
  az.onclick = () => {
    if (!confirm('Azzerare tutte le quantita\' in casa?')) return;
    S.dispensa = {}; save(); closeSheet(); route();
  };
  w.append(az);
  const ok = el('button', 'btn wide pri', 'Fatto');
  ok.style.marginTop = '8px';
  ok.onclick = () => { save(); closeSheet(); route(); };
  w.append(ok);
  sheet(w);
}
