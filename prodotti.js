/* Prodotti reali: quelli con i valori letti in etichetta.
   Servono a sostituire le stime di dieta.json, che sono medie di categoria.
   Restano nello stato utente: il dominio in data/dieta.json non si tocca. */
'use strict';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function prodotti() { S.prodotti ||= []; return S.prodotti; }

/** Prodotto che sostituisce un alimento del piano, se ce n'e' uno. */
function overrideDi(nome) {
  return prodotti().find(p => p.sostituisce === nome) || null;
}
/**
 * Valori nutrizionali per 100 g/ml di un alimento del piano, tenendo conto
 * di un eventuale prodotto reale che lo sostituisce. E' il punto in cui una
 * stima diventa un valore verificato.
 */
function alimento(nome) {
  const base = D.alimenti[nome];
  if (!base) return null;
  const o = overrideDi(nome);
  if (!o) return base;
  return { ...base, kcal: o.kcal, p: o.p, c: o.c, g: o.g, fibre: o.fibre,
           fonte: 'verificato', prodotto: o.nome };
}

/**
 * Tutto quello che si puo' mangiare, in un elenco solo: gli alimenti del piano
 * piu' i prodotti reali che NON sostituiscono gia' un alimento.
 *
 * Quelli collegati non si ripetono: se lo Skyr sostituisce lo yogurt greco, i
 * suoi valori arrivano gia' da alimento('yogurt greco') e mostrarlo due volte
 * darebbe due righe che dicono la stessa cosa con due nomi diversi. Quelli
 * scollegati invece prima non comparivano da nessuna parte — li registravi col
 * codice a barre e poi non c'era modo di mangiarli.
 */
function mangiabili() {
  const out = Object.keys(D.alimenti).sort().map(n => {
    const al = alimento(n);
    return { id: 'a:' + n, nome: n, fonte: 'piano', unita: al.unita || 'g',
             kcal: al.kcal, p: al.p, c: al.c, g: al.g, fibre: al.fibre || 0,
             stima: al.fonte === 'stima', marca: al.prodotto || null };
  });
  for (const p of prodotti()) {
    if (p.sostituisce) continue;          // gia' dentro, sotto il nome del piano
    out.push({ id: 'p:' + p.id, nome: p.nome, fonte: 'prodotto',
               unita: p.unita || 'g', kcal: p.kcal, p: p.p, c: p.c, g: p.g,
               fibre: p.fibre || 0, stima: false, marca: p.marca || null });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Un mangiabile dal suo id, e i macro per una quantita'. */
function mangiabile(id) { return mangiabili().find(x => x.id === id) || null; }
function macroMangiabile(id, qta) {
  const x = mangiabile(id);
  if (!x) return null;
  const f = qta / 100;
  // due decimali: 60 g di una barretta da 12 g di grassi danno 7,1999999999,
  // e quel numero finisce cosi' com'e' dentro il diario salvato
  const r = v => Math.round(v * f * 100) / 100;
  return { kcal: r(x.kcal), p: r(x.p), c: r(x.c), g: r(x.g), fibre: r(x.fibre) };
}

/* --------------------------------------------------------------- vista */
/* ==================================================== un elenco solo
 *
 * Per molto tempo ce n'erano due, e non si capiva quale fosse quale.
 *
 * - "Cosa mangi", nel piano: gli alimenti, cioe' i nomi che le ricette usano.
 * - "I tuoi prodotti", dal menu: i prodotti reali col codice a barre, che si
 *   collegano a un alimento per sostituirne i valori stimati.
 *
 * Sotto sono due cose diverse e restano tali — un alimento e' un nome dentro
 * una ricetta, un prodotto e' una scatola con un'etichetta — ma per chi usa
 * l'app sono la stessa domanda: *le cose che mangio, e quanto fanno*. Due
 * schermate con due bottoni "aggiungi" ciascuna, due ricerche su internet e
 * due lettori di codici a barre erano una risposta sbagliata a una domanda
 * sola.
 *
 * Adesso l'elenco e' uno, lo stesso in tutti e due i punti d'ingresso, e ogni
 * riga dice **da dove viene il suo numero**: letto in etichetta, stimato, o
 * corretto da te. E' quella l'informazione che serve, non a quale dei due
 * registri interni appartiene la voce.
 */
function vociAlimentari() {
  const p = piano();
  const out = [];
  for (const nome of Object.keys(D.alimenti)) {
    // alimento() e non D.alimenti: se un prodotto lo sostituisce, la riga deve
    // mostrare i numeri che l'app usa davvero, non quelli che ha rimpiazzato —
    // altrimenti dice "etichetta" e accanto scrive la stima
    const a = alimento(nome);
    const pr = overrideDi(nome);
    out.push({
      tipo: 'alimento', nome, a,
      marca: pr?.marca || '', barcode: pr?.barcode || a.barcode || '',
      mio: !!p.alimenti[nome], base: !!DBASE.alimenti[nome],
      etichetta: !!pr || a.fonte === 'verificato',
      stima: !pr && a.fonte === 'stima',
      prodotto: pr || null
    });
  }
  /* I prodotti non collegati a niente: fino a ieri stavano in un elenco a
     parte e non li vedeva nessuno. Stanno qui, marcati per quello che sono —
     roba che hai registrato ma che le ricette non sanno ancora usare. */
  for (const pr of prodotti()) {
    if (pr.sostituisce && D.alimenti[pr.sostituisce]) continue;
    out.push({
      tipo: 'prodotto', nome: pr.nome, a: pr, marca: pr.marca || '',
      barcode: pr.barcode || '', mio: true, base: false,
      etichetta: true, stima: false, fuoriPiano: true, prodotto: pr
    });
  }
  return out.sort((x, y) => x.nome.localeCompare(y.nome));
}

const FILTRI_ALIMENTI = [
  ['tutti', 'Tutti', () => true],
  ['miei', 'Tuoi', v => v.mio],
  ['etichetta', 'Da etichetta', v => v.etichetta],
  ['stima', 'Stimati', v => v.stima],
  ['fuori', 'Fuori piano', v => v.fuoriPiano]
];

/**
 * L'elenco, con la ricerca e i filtri. Lo usano sia il passo "Cosa mangi" del
 * piano sia la voce del menu: e' letteralmente la stessa schermata, cosi' non
 * si puo' piu' arrivare in due posti diversi e trovare due cose diverse.
 *
 * Il filtro non passa da route(): ridisegnare a ogni lettera fa perdere il
 * fuoco al campo e su un telefono chiude la tastiera.
 */
function elencoAlimenti(v, opt = {}) {
  const c = el('div', 'cw');
  const testa = el('div', 'row between');
  testa.append(el('h3', null, opt.titolo || 'Quello che mangi'));
  const piu = el('button', 'btn-piu');
  piu.textContent = '+';
  piu.title = 'Aggiungi';
  piu.setAttribute('aria-label', 'Aggiungi un alimento');
  piu.onclick = () => sheetAggiungiAlimento();
  testa.append(piu);
  c.append(testa);

  const tutte = vociAlimentari();
  const nStima = tutte.filter(x => x.stima).length;
  c.append(el('div', 'sub',
    `${tutte.length} voci. Ogni riga dice da dove viene il suo numero: `
    + `<strong>etichetta</strong> se l'hai letto sulla confezione, `
    + `<strong>stima</strong> se e' una media di categoria.`
    + (nStima ? ` Ne restano ${nStima} stimate.` : '')));

  const f = el('div', 'field');
  const inp = el('input');
  inp.type = 'search';
  inp.placeholder = 'pane, tofu, la tua barretta…';
  inp.autocomplete = 'off';
  f.append(inp);
  c.append(f);

  let filtro = 'tutti';
  const chips = el('div', 'seg wrap chips');
  for (const [id, lab, fn] of FILTRI_ALIMENTI) {
    const n = tutte.filter(fn).length;
    if (!n && id !== 'tutti') continue;
    const b = el('button', null, `${lab} ${n}`);
    b.setAttribute('aria-pressed', String(filtro === id));
    b.onclick = () => {
      filtro = id;
      [...chips.children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      disegna();
    };
    chips.append(b);
  }
  c.append(chips);

  const lista = el('div');
  c.append(lista);

  const disegna = () => {
    const q = inp.value.trim().toLowerCase();
    const test = (FILTRI_ALIMENTI.find(x => x[0] === filtro) || [])[2] || (() => true);
    lista.innerHTML = '';
    const righe = tutte.filter(x => {
      if (!test(x)) return false;
      if (!q) return true;
      const t = [x.nome, x.marca, x.a.categoria || '', x.barcode].join(' ').toLowerCase();
      return q.split(/\s+/).every(w => t.includes(w));
    });
    if (!righe.length) {
      lista.append(el('p', 'hint',
        'Nessuna corrispondenza. Col + qui sopra lo aggiungi: a mano, col codice '
        + 'a barre, o cercandolo su internet.'));
      return;
    }
    for (const x of righe) {
      const r = el('button', 'prod');
      const a = x.a;
      r.innerHTML = `<div class="grow"><div class="nm">${esc(x.nome)}</div>
          <div class="mt">${x.marca ? esc(x.marca) + ' · ' : ''}${macroRiga(a)}${
            a.categoria ? ' · ' + esc(a.categoria) : ''}</div>
          <div class="tags">${
            x.fuoriPiano ? '<span class="pill warn">fuori piano</span>' : ''}${
            x.etichetta ? '<span class="pill ok">etichetta</span>' : ''}${
            x.stima ? '<span class="pill warn">stima</span>' : ''}${
            x.mio && !x.fuoriPiano ? '<span class="pill">tuo</span>' : ''}</div></div>
        <div class="kc">${nf(a.kcal)}<br><span class="mt">/100${esc(a.unita || 'g')}</span></div>`;
      r.onclick = () => x.tipo === 'prodotto' ? sheetProdotto(x.prodotto)
                                              : sheetAlimento(x.nome);
      lista.append(r);
    }
    lista.append(el('p', 'hint', `${righe.length} su ${tutte.length}.`));
  };
  inp.oninput = disegna;
  disegna();
  v.append(c);
}

/** Le tre strade per aggiungerne uno, tutte da un posto solo. */
function sheetAggiungiAlimento() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Aggiungi'));
  w.append(el('h2', 'sec', 'Una cosa che mangi'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Tre strade, e cambia solo da dove arrivano i numeri: quello che scrivi tu '
    + 'dalla confezione vale piu\' di quello che arriva da un archivio pubblico, '
    + 'e l\'app continua a dirlo ovunque compaia.'));

  const b1 = el('button', 'btn wide pri', 'Leggi il codice a barre');
  b1.onclick = () => leggiCodice(a => {
    if (!a) { sheetAggiungiAlimento(); return; }
    sheetAlimento(null, {
      nome: [a.nome, a.marca].filter(Boolean).join(' — ').slice(0, 60),
      kcal: a.kcal, p: a.p, c: a.c, g: a.g, fibre: a.fibre, unita: a.unita,
      barcode: a.codice, origine: a.origine || null,
      avviso: a.origine && typeof coerenza === 'function' ? coerenza(a) : null
    });
  });
  w.append(b1);

  const b2 = el('button', 'btn wide', 'Cerca su internet');
  b2.style.marginTop = '8px';
  b2.onclick = () => sheetCercaAlimento(a => {
    if (!a) { sheetAggiungiAlimento(); return; }
    sheetAlimento(null, {
      nome: [a.nome, a.marca].filter(Boolean).join(' — ').slice(0, 60),
      kcal: a.kcal, p: a.p, c: a.c, g: a.g, fibre: a.fibre, unita: a.unita,
      fonte: 'stima', origine: 'openfoodfacts', barcode: a.codice, avviso: a.coerenza
    });
  });
  w.append(b2);

  const b3 = el('button', 'btn wide', 'Scrivilo a mano');
  b3.style.marginTop = '8px';
  b3.onclick = () => sheetAlimento(null);
  w.append(b3);

  const ch = el('button', 'btn wide', 'Chiudi');
  ch.style.marginTop = '14px';
  ch.onclick = closeSheet;
  w.append(ch);
  sheet(w);
}

/**
 * La vecchia schermata "I tuoi prodotti" e' diventata questa, ed e' la stessa
 * del passo "Cosa mangi". Resta raggiungibile dal menu e da un vecchio
 * segnalibro: e' lo stesso posto, non uno parallelo.
 */
function viewProdotti(v) {
  elencoAlimenti(v);

  const stime = vociAlimentari().filter(x => x.stima);
  if (stime.length) {
    const c = el('div', 'card flat');
    c.append(el('div', 'eyebrow', 'Perche\' conviene'));
    c.append(el('div', 'muted',
      `${stime.length} voci hanno valori <strong>stimati</strong>: medie di `
      + 'categoria, non l\'etichetta di quello che compri davvero. Aprendone una e '
      + 'leggendo il codice a barre, o copiando i numeri dalla confezione, tutti i '
      + 'conti dell\'app cominciano a usare quelli veri — pasti, sostituzioni, '
      + 'analisi e previsione.'));
    v.append(c);
  }
}

/* ------------------------------------------------------ scheda prodotto */
function sheetProdotto(p) {
  const nuovo = !p || p.nuovo;
  const w = el('div');
  w.append(el('div', 'eyebrow', nuovo ? 'Nuovo prodotto' : 'Prodotto'));
  w.append(el('h2', 'sec', nuovo ? 'Valori in etichetta' : esc(p.nome)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', 'Copia i valori <strong>per 100 g o 100 ml</strong>, come stanno sulla confezione.'));

  const campo = (id, lab, val, unit) => el('div', 'field',
    `<label>${lab}${unit ? ` <span class="muted">(${unit})</span>` : ''}</label>
     <input type="text" inputmode="${id === 'nome' || id === 'marca' ? 'text' : 'decimal'}"
            id="p-${id}" value="${val != null ? esc(String(val)) : ''}">`);

  w.append(campo('nome', 'Nome', p?.nome));
  w.append(campo('marca', 'Marca', p?.marca));
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  g.append(campo('kcal', 'Calorie', p?.kcal, 'kcal'),
           campo('p', 'Proteine', p?.p, 'g'),
           campo('c', 'Carboidrati', p?.c, 'g'),
           campo('g', 'Grassi', p?.g, 'g'),
           campo('fibre', 'Fibre', p?.fibre, 'g'),
           campo('barcode', 'Codice a barre', p?.barcode));
  w.append(g);

  /* Il collegamento a un alimento del piano.
     E' la parte che decide se questo prodotto conta davvero: senza, resta una
     scheda che nessuna ricetta sa usare. Con cinquanta alimenti la tendina non
     era piu' un selettore — stesso problema degli esercizi — quindi campo
     cercabile. */
  const f = el('div', 'field', '<label>Prende il posto di</label>');
  let sost = p?.sostituisce || '';
  if (typeof selettoreCercabile === 'function') {
    const opz = [{ v: '', lab: '— nessuno: resta fuori dal piano —', sub: '' }].concat(
      Object.keys(D.alimenti).sort().map(n => ({
        v: n, lab: n,
        sub: `${nf(D.alimenti[n].kcal)} kcal · ${D.alimenti[n].fonte === 'stima'
          ? 'valore stimato: conviene proprio questo' : 'gia\' verificato'}`
      })));
    f.append(selettoreCercabile(opz, sost, x => { sost = x || ''; }, 'a quale alimento…'));
  } else {
    const selt = el('select');
    selt.id = 'p-sost';
    selt.append(new Option('— nessuno —', ''));
    for (const n of Object.keys(D.alimenti).sort())
      selt.append(new Option(n, n, false, sost === n));
    selt.onchange = () => { sost = selt.value; };
    f.append(selt);
  }
  f.append(el('div', 'hint',
    'Collegandolo, l\'app usa <strong>questi</strong> valori al posto di quelli del '
    + 'piano in tutti i conti: pasti, sostituzioni, analisi, previsione. Senza '
    + 'collegamento il prodotto resta registrato ma le ricette non lo vedono — '
    + 'compare solo quando scrivi un pasto fuori piano.'));
  w.append(f);

  const salva = el('button', 'btn wide pri', 'Salva');
  salva.onclick = () => {
    const get = id => $('#p-' + id).value.trim();
    const nome = get('nome');
    if (!nome) { toast('Serve almeno il nome'); return; }
    const num = id => parseNum(get(id)) ?? 0;
    const rec = {
      id: (p && p.id) || uid(), nome, marca: get('marca'),
      unita: p?.unita || 'g', barcode: get('barcode'),
      kcal: num('kcal'), p: num('p'), c: num('c'), g: num('g'), fibre: num('fibre'),
      sostituisce: sost || null,
      creato: (p && p.creato) || today()
    };
    if (rec.kcal <= 0) { toast('Le calorie non possono essere zero'); return; }
    const L = prodotti();
    const i = L.findIndex(x => x.id === rec.id);
    if (i >= 0) L[i] = rec; else L.push(rec);
    save(); closeSheet(); route(); toast('Prodotto salvato');
  };
  w.append(salva);

  if (!nuovo && p.id) {
    const del = el('button', 'btn wide', 'Elimina');
    del.style.marginTop = '8px';
    del.onclick = () => {
      if (!confirm(`Eliminare "${p.nome}"? I conti torneranno ai valori del piano.`)) return;
      S.prodotti = prodotti().filter(x => x.id !== p.id);
      save(); closeSheet(); route(); toast('Eliminato');
    };
    w.append(del);
  }
  sheet(w);
}

/* ------------------------------------------------------ codice a barre */
function BarcodeSupport() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
      && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
}

/**
 * Il punto d'ingresso del codice a barre, da qualunque parte lo si chiami.
 *
 * Stava solo dentro la pagina Prodotti, che si raggiunge dal menu in alto a
 * destra: cioe' nel punto piu' lontano possibile da dove uno ha in mano la
 * confezione. Ora chi vuole leggere un codice chiama questa, e riceve i valori
 * indietro invece di finire per forza nel registro dei prodotti.
 *
 * `onValori` riceve `{ codice, nome, marca, kcal, p, c, g, fibre, unita,
 * origine }` — con `origine: 'openfoodfacts'` quando i numeri vengono da li',
 * che e' l'informazione da cui dipende se l'alimento nasce stima o verificato.
 * Riceve `{ codice }` e basta se l'utente sceglie di scrivere lui i valori, e
 * `null` se torna indietro. Senza callback il comportamento e' quello di
 * prima: si finisce nel registro dei prodotti.
 */
function leggiCodice(onValori) {
  return BarcodeSupport() ? sheetScan(onValori) : sheetCodiceManuale(onValori);
}

function sheetScan(onValori) {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Scansione'));
  w.append(el('h2', 'sec', 'Inquadra il codice'));
  w.lastChild.style.marginTop = '0';
  const wrap = el('div', 'scanwrap',
    `<video id="scanbox" playsinline muted autoplay></video><div class="aim"></div>`);
  w.append(wrap);
  const stato = el('p', 'muted', 'Avvio della fotocamera…');
  w.append(stato);

  let stream = null, vivo = true;
  const chiudi = () => { vivo = false; if (stream) stream.getTracks().forEach(t => t.stop()); };

  const stop = el('button', 'btn wide', 'Annulla');
  stop.onclick = () => { chiudi(); if (onValori) onValori(null); else closeSheet(); };
  w.append(stop);
  sheet(w);
  $('#sheet-backdrop').addEventListener('click', chiudi, { once: true });

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } });
      const vid = $('#scanbox'); vid.srcObject = stream; await vid.play();
      stato.textContent = 'Cerco un codice…';
      const det = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      const giro = async () => {
        if (!vivo) return;
        try {
          const found = await det.detect(vid);
          if (found.length) {
            const code = found[0].rawValue;
            chiudi();
            trovato(code, onValori);
            return;
          }
        } catch { /* fotogramma non leggibile, si riprova */ }
        requestAnimationFrame(giro);
      };
      giro();
    } catch (e) {
      stato.innerHTML = 'Fotocamera non disponibile: ' + esc(e.message || 'permesso negato')
        + '. Puoi registrare il prodotto a mano.';
    }
  })();
}

/**
 * Ripiego quando il browser non ha BarcodeDetector — che oggi e' il caso di
 * Safari su iPhone. Leggere un codice a barre dalla fotocamera senza quella
 * API richiede una libreria di decodifica vera (ZXing e simili): e' una
 * dipendenza esterna, e questo progetto non ne ha nessuna. Nel frattempo il
 * codice si puo' digitare, e da li' in poi tutto funziona uguale.
 */
function sheetCodiceManuale(onValori) {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Codice a barre'));
  w.append(el('h2', 'sec', 'Digita il codice'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Questo browser non sa leggere i codici dalla fotocamera: su iPhone manca '
    + 'l\'API che serve, e per farlo davvero servirebbe una libreria esterna. '
    + 'Il numero sotto le barre pero\' funziona allo stesso modo — e una volta '
    + 'registrato il prodotto non serve piu\'.'));
  w.append(el('div', 'field',
    '<label>Numero sotto il codice</label>'
    + '<input type="text" inputmode="numeric" id="bc-v" placeholder="8001234567890">'));
  const go = el('button', 'btn wide pri', 'Cerca');
  go.onclick = () => {
    const c = $('#bc-v').value.trim();
    if (!/^\d{6,14}$/.test(c)) { toast('Un codice a barre ha da 6 a 14 cifre'); return; }
    trovato(c, onValori);
  };
  w.append(go);
  if (onValori) {
    const ind = el('button', 'btn wide', 'Torna indietro');
    ind.style.marginTop = '8px';
    ind.onclick = () => onValori(null);
    w.append(ind);
  }
  sheet(w);
}

function trovato(code, onValori) {
  const noto = prodotti().find(p => p.barcode === code);
  if (noto) {
    // gia' registrato: i valori li ha scritti l'utente leggendo l'etichetta,
    // quindi non sono una stima e non portano `origine`
    if (onValori) {
      onValori({ codice: code, nome: noto.nome, marca: noto.marca, unita: noto.unita,
                 kcal: noto.kcal, p: noto.p, c: noto.c, g: noto.g, fibre: noto.fibre });
      return;
    }
    closeSheet(); sheetProdotto(noto); toast('Prodotto gia\' registrato'); return;
  }

  const w = el('div');
  w.append(el('div', 'eyebrow', 'Codice letto'));
  w.append(el('h2', 'sec', code));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Non e\' fra i tuoi prodotti. Puoi inserire i valori a mano leggendoli in etichetta — e\' il modo piu\' affidabile — oppure cercarli in Open Food Facts, un archivio pubblico e collaborativo.'));
  w.append(el('p', 'hint',
    'La ricerca invia il solo codice a barre a openfoodfacts.org. Nessun tuo dato personale esce dal telefono, ma serve la rete e i valori di quell\'archivio sono inseriti dagli utenti: vanno confrontati con la confezione.'));

  const man = el('button', 'btn wide pri', 'Inserisco a mano');
  man.onclick = () => {
    if (onValori) { onValori({ codice: code }); return; }
    closeSheet(); sheetProdotto({ barcode: code, nuovo: true });
  };
  w.append(man);

  if (onValori) {
    const ind = el('button', 'btn wide');
    ind.style.marginTop = '8px';
    ind.textContent = 'Torna indietro';
    ind.onclick = () => onValori(null);
    w.append(ind);
  }

  const online = el('button', 'btn wide', 'Cerca su Open Food Facts');
  online.style.marginTop = '8px';
  online.onclick = async () => {
    online.disabled = true; online.textContent = 'Cerco…';
    try {
      const r = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}` +
        `?fields=product_name,brands,nutriments`, { headers: { Accept: 'application/json' } });
      const j = await r.json();
      const n = j?.product?.nutriments;
      if (!j?.product || !n) throw new Error('non trovato');
      const dati = {
        nome: j.product.product_name || '', marca: (j.product.brands || '').split(',')[0].trim(),
        kcal: Math.round(n['energy-kcal_100g'] ?? 0),
        p: n.proteins_100g ?? 0, c: n.carbohydrates_100g ?? 0,
        g: n.fat_100g ?? 0, fibre: n.fiber_100g ?? 0
      };
      if (onValori) {
        onValori({ codice: code, unita: 'g', origine: 'openfoodfacts', ...dati });
        return;
      }
      closeSheet();
      sheetProdotto({ nuovo: true, barcode: code, ...dati });
      toast('Controlla i valori con l\'etichetta');
    } catch {
      online.disabled = false; online.textContent = 'Cerca su Open Food Facts';
      toast('Non trovato: inseriscilo a mano');
    }
  };
  w.append(online);
  sheet(w);
}

/* ============================================ ricerca per nome su Open Food Facts

   Tutto il dialogo con Open Food Facts sta in questo file, codice a barre e
   ricerca per nome insieme: e' l'unico posto da cui esce una richiesta di rete.

   Perche' proprio /cgi/search.pl e non gli altri due:
   - /api/v2/search accetta search_terms ma non li usa davvero per ordinare —
     provato con "fagioli borlotti" e torna un formaggio marocchino su quattro
     milioni di risultati;
   - search.openfoodfacts.org (il motore nuovo) cerca benissimo ma NON manda
     Access-Control-Allow-Origin, quindi dal browser la risposta e' inagibile;
   - /cgi/search.pl cerca bene, manda ACAO *, e il preflight con X-User-Agent
     passa (e resta in cache venti giorni). E' l'unico dei tre utilizzabile.

   L'archivio e' collaborativo: i valori li inseriscono le persone, e sbagliano.
   Per questo ogni risultato passa da coerenza() prima di essere mostrato. */

const OFF_UA = 'Dieta-PWA/1.0 (app personale, nessuna raccolta dati)';

/**
 * I macro tornano con le calorie dichiarate?
 * 4 kcal al grammo per proteine e carboidrati, 9 per i grassi, 2 per le fibre
 * (in etichetta UE le fibre sono fuori dai carboidrati). Uno scarto sotto il
 * 15% e' normale — sono valori di tabella su alimenti reali. Sopra il 30%
 * qualcuno ha sbagliato a digitare, ed e' giusto dirlo prima che quel numero
 * finisca dentro il bilancio energetico.
 */
function coerenza(a) {
  if (!(a.kcal > 0)) return { stato: 'no-kcal', d: 'Calorie mancanti nell\'archivio.' };
  const teor = 4 * (a.p || 0) + 4 * (a.c || 0) + 9 * (a.g || 0) + 2 * (a.fibre || 0);
  if (!teor) return { stato: 'no-macro', d: 'Macro mancanti: ci sono solo le calorie.' };
  const scarto = Math.abs(teor - a.kcal) / a.kcal;
  if (scarto <= .15) return { stato: 'ok', scarto };
  if (scarto <= .30) return { stato: 'dubbio', scarto,
    d: `I macro darebbero ${nf(teor)} kcal invece di ${nf(a.kcal)}. Puo' starci, ma controlla.` };
  return { stato: 'incoerente', scarto,
    d: `I macro darebbero ${nf(teor)} kcal contro le ${nf(a.kcal)} dichiarate. Qualcuno ha sbagliato a inserirli.` };
}

/** Da record grezzo di Open Food Facts a un alimento come lo vuole il piano. */
function daOFF(p) {
  const n = p.nutriments || {};
  const num = x => (typeof x === 'number' && isFinite(x)) ? x : null;
  let kcal = num(n['energy-kcal_100g']);
  if (!(kcal > 0)) {
    // certi prodotti hanno solo i kilojoule
    const kj = num(n['energy-kj_100g']) ?? (n.energy_unit === 'kJ' ? num(n.energy_100g) : null);
    if (kj > 0) kcal = kj / 4.184;
    else if (n.energy_unit === 'kcal') kcal = num(n.energy_100g);
  }
  const q = (p.quantity || '').toLowerCase();
  const liquido = /\d\s*(ml|cl)\b/.test(q) || /\d\s*l\b/.test(q);
  const a = {
    codice: p.code,
    nome: (p.product_name || '').trim(),
    marca: (p.brands || '').split(',')[0].trim(),
    quantita: p.quantity || '',
    unita: liquido ? 'ml' : 'g',
    kcal: kcal != null ? Math.round(kcal) : 0,
    p: num(n.proteins_100g) ?? 0,
    c: num(n.carbohydrates_100g) ?? 0,
    g: num(n.fat_100g) ?? 0,
    fibre: num(n.fiber_100g) ?? 0
  };
  a.coerenza = coerenza(a);
  return a;
}

/**
 * Cerca per nome. Si interroga solo su richiesta esplicita, mai a ogni tasto:
 * Open Food Facts chiede di stare sotto le dieci ricerche al minuto, e un
 * autocomplete le brucerebbe in cinque secondi di digitazione.
 */
async function cercaAlimentiOFF(q, { segnale } = {}) {
  const url = 'https://world.openfoodfacts.org/cgi/search.pl'
    + '?search_simple=1&action=process&json=1&page_size=20'
    + '&fields=code,product_name,brands,quantity,nutriments'
    + '&search_terms=' + encodeURIComponent(q);
  // il User-Agent vero il browser non lo lascia impostare; Open Food Facts
  // accetta X-User-Agent proprio per questo, e il preflight lo consente
  const r = await fetch(url, { signal: segnale,
    headers: { Accept: 'application/json', 'X-User-Agent': OFF_UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.products || []).map(daOFF)
    .filter(a => a.nome && a.kcal > 0)
    // i pasticci veri in fondo: restano visibili, ma non per primi
    .sort((x, y) => (x.coerenza.stato === 'incoerente') - (y.coerenza.stato === 'incoerente'));
}

/**
 * Il foglio di ricerca. onScegli riceve l'alimento normalizzato.
 * Non salva niente da solo: porta i valori nel modulo, dove si controllano.
 */
function sheetCercaAlimento(onScegli, iniziale = '') {
  let ctrl = null;
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Open Food Facts'));
  w.append(el('h2', 'sec', 'Cerca un alimento'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Archivio pubblico e collaborativo, oltre tre milioni di prodotti. '
    + 'Scrivi il nome come sta sulla confezione — marca compresa, se ce l\'ha.'));

  const riga = el('div', 'off-cerca');
  const inp = el('input');
  inp.type = 'search'; inp.className = 'sel-i'; inp.placeholder = 'Fagioli borlotti…';
  inp.value = iniziale; inp.autocomplete = 'off';
  const go = el('button', 'btn pri', 'Cerca');
  riga.append(inp, go);
  w.append(riga);

  const esiti = el('div');
  w.append(esiti);

  const mostra = lista => {
    esiti.innerHTML = '';
    if (!lista.length) {
      esiti.append(el('p', 'muted',
        'Nessun prodotto con quel nome, o nessuno con i valori nutrizionali compilati. '
        + 'Prova con meno parole, oppure inseriscilo a mano: e\' sempre il modo piu\' affidabile.'));
      return;
    }
    esiti.append(el('div', 'eyebrow', `${lista.length} risultati`));
    for (const a of lista) {
      const r = el('button', 'off-r' + (a.coerenza.stato === 'incoerente' ? ' sos' : ''));
      const badge = a.coerenza.stato === 'incoerente' ? '<span class="pill no">non torna</span>'
        : a.coerenza.stato === 'dubbio' ? '<span class="pill">da controllare</span>' : '';
      r.innerHTML = `<span class="nm">${esc(a.nome)} ${badge}</span>
        <span class="mt">${esc([a.marca, a.quantita].filter(Boolean).join(' · ')) || '&nbsp;'}</span>
        <span class="mc">${nf(a.kcal)} kcal · ${nf(a.p, 1)}P ${nf(a.c, 1)}C ${nf(a.g, 1)}G${
          a.fibre ? ' ' + nf(a.fibre, 1) + 'F' : ''} <em>per 100 ${a.unita}</em></span>`;
      r.onclick = () => { ctrl?.abort(); onScegli(a); };
      esiti.append(r);
    }
    if (typeof osserva === 'function')
      osserva(esiti, () => entrata([...esiti.children], { passo: 35 }));
  };

  const cerca = async () => {
    const q = inp.value.trim();
    if (q.length < 2) { toast('Scrivi almeno due lettere'); return; }
    ctrl?.abort(); ctrl = new AbortController();
    go.disabled = true; go.textContent = '…';
    esiti.innerHTML = '';
    esiti.append(el('p', 'muted', 'Cerco su openfoodfacts.org…'));
    try {
      mostra(await cercaAlimentiOFF(q, { segnale: ctrl.signal }));
    } catch (e) {
      if (e.name === 'AbortError') return;
      esiti.innerHTML = '';
      esiti.append(el('p', 'muted',
        'Non riesco a raggiungere l\'archivio. Serve la rete: offline questa ricerca non '
        + 'funziona, ma tutto il resto dell\'app si\'.'));
    } finally { go.disabled = false; go.textContent = 'Cerca'; }
  };
  go.onclick = cerca;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cerca(); } };

  w.append(el('p', 'hint',
    'Esce dal telefono solo il testo che scrivi qui, verso openfoodfacts.org. '
    + 'Nessun tuo dato personale, nessun peso, nessun diario.'));
  w.append(el('p', 'note',
    'I valori li inseriscono gli utenti dell\'archivio e possono essere sbagliati: '
    + 'l\'app controlla che i macro tornino con le calorie e segnala quelli che non '
    + 'quadrano, ma l\'etichetta sulla confezione resta l\'unica fonte sicura. '
    + 'Per questo un alimento importato da qui nasce marcato <strong>stima</strong>.'));

  const ind = el('button', 'btn wide', 'Torna indietro');
  ind.onclick = () => { ctrl?.abort(); onScegli(null); };
  w.append(ind);
  sheet(w);
  if (iniziale) cerca();
}
