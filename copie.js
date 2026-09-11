/* Le copie automatiche, in IndexedDB.
 *
 * Segnalato cosi': *"il mio iPhone e' andato out of memory e ha cancellato
 * tutti i dati; l'ultimo backup era di una settimana prima, le foto
 * nell'IndexedDB si sono mantenute"*. Cioe': localStorage e' sparito, il
 * magazzino accanto no. E il backup, fino a quel giorno, stava solo nel file
 * che l'utente si ricorda di esportare — l'unica copia che dipende dalla
 * memoria di una persona.
 *
 * Adesso ogni tre giorni l'app mette da parte **lo stesso backup del menu**
 * (`esportabile()`: tutti i profili, formato 2) in un database IndexedDB suo.
 * Non si inventa un formato: rimettere una copia passa da `sheetImport()`,
 * cioe' dalla stessa anteprima e dalla stessa conferma di un file esportato.
 *
 * Tre regole la tengono una rete e non una trappola:
 *
 * 1. **Una giornata vuota non si copia.** Dopo una cancellazione l'app
 *    riparte a zero, e una copia di zero spingerebbe fuori quelle buone.
 * 2. **La copia piu' completa non si butta mai.** Se ne tengono le ultime
 *    cinque *piu'* quella con piu' giorni registrati: di solito coincidono,
 *    e smettono di coincidere esattamente dopo una perdita — cioe' quando
 *    serve che non coincidano.
 * 3. **Non lancia mai.** Se IndexedDB non risponde l'app vive lo stesso: e'
 *    una rete di sicurezza, non un pezzo da cui dipende qualcosa.
 *
 * E un limite detto e non nascosto: sta **sullo stesso telefono**. Protegge
 * dal caso che e' successo — il diario perso, il resto rimasto — non da
 * "Cancella dati siti web" ne' dalla rimozione dell'app dalla Home, dove se
 * ne va insieme a tutto. Il file esportato resta l'unica copia fuori.
 */
'use strict';

const COPIE_DB = 'dieta-copie', COPIE_ST = 'copie';
const COPIE_OGNI_GG = 3;        // ogni quanti giorni se ne fa una
const COPIE_TENUTE = 5;         // quante se ne tengono, piu' la piu' completa

let copieCache = null;          // l'elenco, letto una volta e poi tenuto
let copiaInCorso = false;

/* Un database suo e non una tabella in piu' in quello delle foto: aggiungere
   una tabella vorrebbe dire alzare la versione di `dieta-foto` e passare
   dall'aggiornamento di un magazzino che contiene gli scatti di mesi. Per una
   comodita' non vale il rischio. */
function copieDb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(COPIE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(COPIE_ST, { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
function copieTx(mode, fn) {
  return copieDb().then(d => new Promise((ok, no) => {
    const t = d.transaction(COPIE_ST, mode), s = t.objectStore(COPIE_ST);
    const req = fn(s);
    t.oncomplete = () => ok(req && req.result);
    t.onerror = () => no(t.error);
  }));
}

/** Tutte le copie, la piu' recente prima. */
async function copieElenco() {
  if (copieCache) return copieCache;
  const a = await copieTx('readonly', s => s.getAll());
  copieCache = (a || []).sort((x, y) => y.ts - x.ts);
  return copieCache;
}

/** La copia con piu' giorni registrati; a parita', la piu' recente. */
function copiaPiuCompleta(a) {
  return a.reduce((m, x) => (!m || x.giorni > m.giorni ? x : m), null);
}

/** I giorni con qualcosa dentro, sommati su tutti i profili del backup. */
function copieGiorni(o) {
  let n = 0;
  for (const st of Object.values(o?.stati || {}))
    for (const d of Object.values(st?.log || {}))
      if (d && giornoPieno(d)) n++;
  return n;
}

/** "9 set": in una riga di menu si legge meglio di una data ISO. */
function copieData(k) {
  const M = typeof MESI_BR !== 'undefined' ? MESI_BR
    : ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return k ? `${+k.slice(8)} ${M[+k.slice(5, 7) - 1]}` : '';
}

/** Ne fa una adesso. `null` se non c'e' niente da proteggere. */
async function copiaAdesso() {
  const o = esportabile();
  const giorni = copieGiorni(o);
  if (!giorni) return null;
  const testo = JSON.stringify(o);
  const ts = Date.now();
  const r = { id: new Date(ts).toISOString(), ts, quando: today(), giorni,
              profili: Object.keys(o.stati || {}).length, byte: testo.length, testo };
  await copieTx('readwrite', s => s.put(r));
  copieCache = null;
  await copiePota();
  return r;
}

/** Le ultime cinque, piu' la piu' completa. Il resto si butta. */
async function copiePota() {
  const a = await copieElenco();
  const tieni = new Set(a.slice(0, COPIE_TENUTE).map(x => x.id));
  const ricca = copiaPiuCompleta(a);
  if (ricca) tieni.add(ricca.id);
  const via = a.filter(x => !tieni.has(x.id));
  if (!via.length) return;
  await copieTx('readwrite', s => { for (const x of via) s.delete(x.id); });
  copieCache = null;
}

/**
 * Se sono passati tre giorni dall'ultima, ne fa una.
 *
 * Gira all'avvio e quando l'app torna in primo piano: su iOS una web app
 * aggiunta alla Home resta in memoria per giorni senza ripartire, e un
 * controllo solo all'avvio in quei giorni non girerebbe mai.
 */
async function copiaSeServe() {
  if (copiaInCorso) return;
  try {
    if (!S || !DBASE) return;
    // la schermata di benvenuto e' uno stato vuoto per definizione
    if (typeof pianoScelto === 'function' && !pianoScelto()) return;
  } catch { return; }
  copiaInCorso = true;
  /* Un tempo massimo, perche' su iOS `indexedDB.open` a volte resta appeso
     senza rispondere ne' si' ne' no: senza, il lucchetto qui sopra resterebbe
     chiuso e fino al prossimo riavvio non si farebbe piu' nessuna copia. */
  const tetto = new Promise((_, no) => setTimeout(() => no(new Error('tempo')), 15000));
  try {
    await Promise.race([(async () => {
      const ult = (await copieElenco())[0];
      if (ult && addDays(ult.quando, COPIE_OGNI_GG) > today()) return;
      await copiaAdesso();
    })(), tetto]);
  } catch { /* nessun IndexedDB, o appeso: l'app vive lo stesso */ }
  finally { copiaInCorso = false; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') copiaSeServe();
});

/** Rimettere una copia e' importare un backup: stessa anteprima, stessa conferma. */
function copiaRimetti(x) {
  let o = null;
  try { o = JSON.parse(x.testo); } catch {}
  if (!o) { toast('Questa copia non si legge'); return; }
  sheetImport(o);
}

/* ------------------------------------------------------------- il foglio */
function sheetCopie() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Sul telefono, ogni ' + COPIE_OGNI_GG + ' giorni'));
  w.append(el('h2', 'sec', 'Copie automatiche'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Ogni tre giorni l’app mette da parte una copia di tutti i profili — '
    + 'diario, piano, palestra, prodotti — nello stesso magazzino delle foto. '
    + 'Toccane una: prima ti mostra cosa contiene, poi chiede conferma.'));

  const lista = el('div');
  lista.append(el('p', 'hint', 'Leggo le copie…'));
  w.append(lista);

  const riempi = a => {
    lista.innerHTML = '';
    if (!a.length) {
      lista.append(el('p', 'hint', 'Nessuna copia ancora: la prima si fa da sola '
        + 'appena c’e’ almeno un giorno registrato.'));
      return;
    }
    const ricca = copiaPiuCompleta(a);
    for (const [i, x] of a.entries()) {
      const b = el('button', 'nav-r');
      const tag = i === 0 ? 'la piu’ recente'
        : x === ricca ? 'la piu’ completa' : '';
      b.innerHTML = '<span class="ic"></span>'
        + `<span class="body"><span class="t">${esc(copieData(x.quando))}</span>`
        + `<span class="d">${x.giorni} giorn${x.giorni === 1 ? 'o' : 'i'} registrat`
        + `${x.giorni === 1 ? 'o' : 'i'} · ${x.profili} profil${x.profili === 1 ? 'o' : 'i'}`
        + ` · ${nf(x.byte / 1024, 0)} kB</span></span>`
        + (tag ? `<span class="st">${tag}</span>` : '')
        + '<span class="go">›</span>';
      if (typeof icona === 'function') b.querySelector('.ic').append(icona('copie', { size: 19 }));
      b.onclick = () => copiaRimetti(x);
      lista.append(b);
    }
  };

  const ora = el('button', 'btn wide', 'Fai una copia adesso');
  ora.style.marginTop = '12px';
  ora.onclick = async () => {
    ora.disabled = true;
    try {
      const r = await copiaAdesso();
      toast(r ? 'Copia fatta' : 'Non c’e’ ancora niente da copiare');
      riempi(await copieElenco());
    } catch { toast('IndexedDB non risponde: esporta il file dal menu'); }
    ora.disabled = false;
  };
  w.append(ora);

  /* Il limite si dice qui, dove si decide quanto fidarsi. */
  const nota = el('p', 'note',
    'Stanno sullo stesso telefono: proteggono da una perdita come quella del '
    + 'diario, quando il resto rimane, non da «Cancella dati siti web» '
    + 'ne’ dalla rimozione dell’app dalla Home — li’ se ne vanno '
    + 'insieme a tutto. La copia fuori dal telefono resta il file esportato.');
  w.append(nota);

  const x = el('button', 'btn wide pri', 'Chiudi');
  x.style.marginTop = '14px';
  x.onclick = closeSheet;
  w.append(x);
  sheet(w);

  copieElenco().then(riempi).catch(() => {
    lista.innerHTML = '';
    lista.append(el('p', 'hint', 'IndexedDB non risponde su questo browser: '
      + 'le copie automatiche non ci sono. Resta il backup esportato dal menu.'));
    ora.remove();
  });
}

/**
 * La carta in cima alla schermata di benvenuto.
 *
 * Dopo una cancellazione l'app riparte da li', e li' la prima domanda —
 * *"da cosa vuoi partire?"* — ha una risposta che nessuna delle due strade
 * offriva: **da dove eri**. Se una copia c'e' sta sopra tutto; se non c'e'
 * la carta non compare, e chi installa per la prima volta non vede niente.
 */
function cartaRipristino() {
  const c = el('div', 'card copie-rip');
  c.hidden = true;
  copieElenco().then(a => {
    if (!a.length) return;
    const x = a[0];
    c.append(el('div', 'eyebrow', 'Trovata sul telefono'));
    c.append(el('h2', 'sec', 'C’e’ una copia dei tuoi dati'));
    c.lastChild.style.marginTop = '0';
    /* "dell'11", non "del 11": uno, otto e undici cominciano per vocale */
    const gg = +x.quando.slice(8);
    const del = [1, 8, 11].includes(gg) ? 'Dell’' : 'Del ';
    c.append(el('p', 'muted',
      `${del}<strong>${esc(copieData(x.quando))}</strong>, con <strong>${x.giorni} giorni `
      + `registrati</strong>${x.profili > 1 ? ' in ' + x.profili + ' profili' : ''}. `
      + 'Se il telefono ha perso il diario, rimettila da qui: prima ti mostra '
      + 'cosa contiene.'));
    const b = el('button', 'btn wide pri', 'Guarda e rimetti');
    b.onclick = () => copiaRimetti(x);
    c.append(b);
    if (a.length > 1) {
      const t = el('button', 'btn wide', 'Tutte le copie (' + a.length + ')');
      t.style.marginTop = '8px';
      t.onclick = () => sheetCopie();
      c.append(t);
    }
    c.hidden = false;
  }).catch(() => {});
  return c;
}
