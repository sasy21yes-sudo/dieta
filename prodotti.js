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
function viewProdotti(v) {
  const list = prodotti();

  const intro = el('div', 'card flat');
  intro.append(el('div', 'eyebrow', 'Perche\' serve'));
  intro.append(el('div', 'muted',
    `Nel piano ${Object.values(D.alimenti).filter(a => a.fonte === 'stima').length} alimenti
     hanno valori <strong>stimati</strong>: medie di categoria, non l'etichetta del
     prodotto che compri davvero. Registrando qui il prodotto e collegandolo,
     tutti i conti dell'app iniziano a usare i numeri veri.`));
  v.append(intro);

  const b = el('button', 'btn wide pri', 'Aggiungi un prodotto');
  b.onclick = () => sheetProdotto(null);
  v.append(b);

  // il bottone c'e' sempre: se il browser non sa leggere i codici lo dice,
  // invece di sparire lasciando credere che la funzione non esista
  const bs = el('button', 'btn wide', 'Scansiona un codice a barre');
  bs.style.marginTop = '8px';
  bs.onclick = () => BarcodeSupport() ? sheetScan() : sheetCodiceManuale();
  v.append(bs);

  v.append(el('h2', 'sec', `I tuoi prodotti (${list.length})`));
  if (!list.length) {
    v.append(el('div', 'card', el('p', 'muted',
      'Nessuno ancora. Il primo da registrare e\' quello che compri piu\' spesso: e\' quello che sposta di piu\' i conti.').outerHTML));
  } else {
    const c = el('div', 'card');
    for (const p of list.slice().sort((a, b2) => a.nome.localeCompare(b2.nome))) {
      const r = el('button', 'prod');
      r.innerHTML = `<div class="grow">
          <div class="nm">${esc(p.nome)}</div>
          <div class="mt">${p.marca ? esc(p.marca) + ' · ' : ''}${nf(p.p, 1)}P ${nf(p.c, 1)}C ${nf(p.g, 1)}G
          ${p.sostituisce ? ' · sostituisce ' + esc(p.sostituisce) : ''}</div>
        </div>
        <div class="kc">${nf(p.kcal)}<br><span class="mt">/100${esc(p.unita || 'g')}</span></div>`;
      r.onclick = () => sheetProdotto(p);
      c.append(r);
    }
    v.append(c);
  }

  /* quali stime restano da sostituire */
  const stime = Object.entries(D.alimenti)
    .filter(([n, a]) => a.fonte === 'stima' && !overrideDi(n))
    .map(([n]) => n).sort();
  if (stime.length) {
    const c = el('div', 'card');
    c.append(el('h2', 'sec', 'Ancora stimati'));
    c.lastChild.style.marginTop = '0';
    c.append(el('p', 'muted', 'Tocca una voce per registrare il prodotto vero che usi al suo posto.'));
    for (const n of stime) {
      const r = el('button', 'prod');
      const a = D.alimenti[n];
      r.innerHTML = `<div class="grow"><div class="nm">${esc(n)}</div>
        <div class="mt">${nf(a.kcal)} kcal · ${macroRiga(a)} /100${esc(a.unita || 'g')}</div></div>
        <span class="pill warn">stima</span>`;
      r.onclick = () => sheetProdotto({ nome: n, sostituisce: n, unita: a.unita,
        kcal: a.kcal, p: a.p, c: a.c, g: a.g, fibre: a.fibre, nuovo: true });
      c.append(r);
    }
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

  /* collegamento a un alimento del piano */
  const f = el('div', 'field', `<label>Sostituisce nel piano</label>`);
  const selt = el('select');
  selt.id = 'p-sost';
  selt.style.cssText = 'width:100%;padding:9px 10px;border:1px solid var(--rule);'
    + 'border-radius:9px;background:var(--paper);color:var(--ink);font:inherit';
  selt.append(new Option('— nessuno —', ''));
  for (const n of Object.keys(D.alimenti).sort())
    selt.append(new Option(n + (D.alimenti[n].fonte === 'stima' ? '  (stima)' : ''), n,
      false, p?.sostituisce === n));
  f.append(selt);
  f.append(el('div', 'hint', 'Se lo colleghi, l\'app usera\' questi valori al posto di quelli del piano in tutti i conti: pasti, analisi, previsione.'));
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
      sostituisce: $('#p-sost').value || null,
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

function sheetScan() {
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
  stop.onclick = () => { chiudi(); closeSheet(); };
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
            trovato(code);
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
function sheetCodiceManuale() {
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
    trovato(c);
  };
  w.append(go);
  sheet(w);
}

function trovato(code) {
  const noto = prodotti().find(p => p.barcode === code);
  if (noto) { closeSheet(); sheetProdotto(noto); toast('Prodotto gia\' registrato'); return; }

  const w = el('div');
  w.append(el('div', 'eyebrow', 'Codice letto'));
  w.append(el('h2', 'sec', code));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Non e\' fra i tuoi prodotti. Puoi inserire i valori a mano leggendoli in etichetta — e\' il modo piu\' affidabile — oppure cercarli in Open Food Facts, un archivio pubblico e collaborativo.'));
  w.append(el('p', 'hint',
    'La ricerca invia il solo codice a barre a openfoodfacts.org. Nessun tuo dato personale esce dal telefono, ma serve la rete e i valori di quell\'archivio sono inseriti dagli utenti: vanno confrontati con la confezione.'));

  const man = el('button', 'btn wide pri', 'Inserisco a mano');
  man.onclick = () => { closeSheet(); sheetProdotto({ barcode: code, nuovo: true }); };
  w.append(man);

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
      closeSheet();
      sheetProdotto({
        nuovo: true, barcode: code,
        nome: j.product.product_name || '', marca: (j.product.brands || '').split(',')[0].trim(),
        kcal: Math.round(n['energy-kcal_100g'] ?? 0),
        p: n.proteins_100g ?? 0, c: n.carbohydrates_100g ?? 0,
        g: n.fat_100g ?? 0, fibre: n.fiber_100g ?? 0
      });
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
