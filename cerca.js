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

  /* Qui c'e' stato un tentativo di far salire il foglio sopra la tastiera e
     di portare il campo in cima a ogni tocco. **Tolto**: lo scroll diventava
     imprevedibile, e in particolare `scrollIntoView` girava a ogni tasto
     battuto, quindi la pagina si muoveva sotto le dita mentre si scriveva.
     Un rimedio peggiore del male che curava. Se si riprova, la regola e' che
     lo scroll non si tocca durante la digitazione. */
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

/* La vecchia dispensa era un foglio con dentro TUTTI gli alimenti del piano e
   un campo numerico per ciascuno: quarantaquattro righe da compilare, e
   infatti restava vuota. Ora la domanda "quanto ne ho" si fa dalla riga della
   spesa, dove nasce, e la dispensa e' una pagina che mostra solo quello che
   hai davvero — vedi `spesa.js`. Questa resta come ponte per i vecchi
   richiami: porta li'. */
function sheetDispensa() {
  closeSheet();
  apri('#/dispensa');
}
