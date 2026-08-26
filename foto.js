/* Foto dei progressi.
   Stanno in IndexedDB e non in localStorage: un singolo scatto supererebbe
   da solo l'intera quota. Non escono mai dal telefono — non c'e' nessun
   server a cui mandarle — e per lo stesso motivo NON finiscono nel backup
   JSON: vanno salvate a parte. */
'use strict';

const FDB = 'dieta-foto', FST = 'scatti';
const POSE = [['fronte', 'Fronte'], ['lato', 'Lato'], ['schiena', 'Schiena']];

function fdb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(FDB, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(FST, { keyPath: 'id' });
      s.createIndex('giorno', 'giorno');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
function ftx(mode, fn) {
  return fdb().then(d => new Promise((ok, no) => {
    const t = d.transaction(FST, mode), s = t.objectStore(FST);
    const req = fn(s);
    t.oncomplete = () => ok(req && req.result);
    t.onerror = () => no(t.error);
  }));
}
const fotoTutte = () => ftx('readonly', s => s.getAll()).then(a => (a || [])
  .sort((x, y) => (x.giorno + x.id).localeCompare(y.giorno + y.id)));
const fotoSalva = r => ftx('readwrite', s => s.put(r));
const fotoElimina = id => ftx('readwrite', s => s.delete(id));

/**
 * Ridimensiona e comprime prima di salvare. Uno scatto da telefono e' 3–5 MB:
 * a un anno di foto quotidiane la quota salterebbe, e senza compressione
 * l'app diventerebbe inutilizzabile molto prima.
 */
function comprimi(file, lato = 1280, q = .82) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, lato / Math.max(img.width, img.height));
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? ok({ blob: b, w, h }) : no(new Error('conversione fallita')),
        'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('immagine illeggibile')); };
    img.src = url;
  });
}

/* ---------------------------------------------------------------- vista */
let fotoPosa = 'fronte';
const fotoUrls = [];
function liberaUrl() { while (fotoUrls.length) URL.revokeObjectURL(fotoUrls.pop()); }

function viewFoto(v) {
  liberaUrl();

  const intro = el('div', 'card flat');
  intro.append(el('div', 'eyebrow', 'Come si usa'));
  intro.append(el('div', 'muted',
    'Stessa posa, stessa luce, stessa ora del giorno — meglio al mattino a digiuno. '
    + 'Le differenze reali su un mese sono piccole: e\' la costanza dell\'inquadratura '
    + 'che le rende visibili, non la qualita\' dello scatto.'));
  v.append(intro);

  const bar = el('div', 'posebar');
  for (const [id, lab] of POSE) {
    const b = el('button', 'btn' + (fotoPosa === id ? ' pri' : ''), lab);
    b.onclick = () => { fotoPosa = id; route(); };
    bar.append(b);
  }
  v.append(bar);

  const inp = el('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.style.display = 'none';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    toast('Elaboro…');
    try {
      const { blob, w, h } = await comprimi(f);
      await fotoSalva({ id: uid(), giorno: today(), posa: fotoPosa, blob, w, h,
                        peso: S.log[today()]?.peso ?? null });
      route(); toast('Scatto salvato');
    } catch (e) { toast('Non riesco a leggere l\'immagine'); }
  };
  v.append(inp);
  const scatta = el('button', 'btn wide pri', 'Scatta o scegli una foto');
  scatta.onclick = () => inp.click();
  v.append(scatta);

  const cont = el('div');
  v.append(cont);

  fotoTutte().then(tutte => {
    const mie = tutte.filter(f => f.posa === fotoPosa);
    if (!mie.length) {
      cont.append(el('div', 'card', '<p class="muted">Nessuno scatto in questa posa. '
        + 'Il primo e\' il riferimento: da li\' in poi ogni confronto ha senso.</p>'));
      return;
    }

    /* --- confronto primo/ultimo --- */
    if (mie.length >= 2) {
      const a = mie[0], b = mie[mie.length - 1];
      const c = el('div', 'cw');
      c.append(el('h3', null, 'Primo e ultimo'));
      c.append(el('div', 'sub', `${a.giorno} → ${b.giorno} · ${giorniFra(a.giorno, b.giorno)} giorni`));
      const gr = el('div');
      gr.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
      for (const f of [a, b]) {
        const u = URL.createObjectURL(f.blob); fotoUrls.push(u);
        const fig = el('figure');
        fig.style.cssText = 'margin:0;position:relative;aspect-ratio:3/4;border-radius:9px;overflow:hidden;background:var(--wash)';
        fig.innerHTML = `<img src="${u}" style="width:100%;height:100%;object-fit:cover;display:block">
          <figcaption style="position:absolute;left:0;right:0;bottom:0;font-family:var(--mono);font-size:10px;color:#fff;padding:9px 5px 4px;background:linear-gradient(transparent,rgba(0,0,0,.72));text-align:center">
          ${f.giorno.slice(5)}${f.peso != null ? ' · ' + nf(f.peso, 1) + ' kg' : ''}</figcaption>`;
        gr.append(fig);
      }
      c.append(gr);
      cont.append(c);
    }

    /* --- timelapse --- */
    if (mie.length >= 3) cont.append(lapseCard(mie));

    /* --- galleria --- */
    const c = el('div', 'card');
    c.append(el('h2', 'sec', `Tutti gli scatti (${mie.length})`));
    c.lastChild.style.marginTop = '0';
    const gal = el('div', 'shots');
    for (const f of mie.slice().reverse()) {
      const u = URL.createObjectURL(f.blob); fotoUrls.push(u);
      const fig = el('figure');
      fig.innerHTML = `<img src="${u}" alt="${esc(f.giorno)}">`
        + `<figcaption>${esc(f.giorno.slice(5))}</figcaption>`;
      fig.onclick = () => sheetScatto(f, u);
      gal.append(fig);
    }
    c.append(gal);
    cont.append(c);

    /* --- avviso backup --- */
    const av = el('div', 'card flat');
    av.append(el('div', 'eyebrow', 'Attenzione al backup'));
    av.append(el('div', 'muted',
      `Le foto <strong>non</strong> entrano nel backup JSON: sono troppo grandi. '
       Stanno solo qui, in questo telefono. Se svuoti i dati di Safari o togli
       l'app dalla schermata Home, spariscono.`.replace(/'\s+/, ' ')));
    navigator.storage?.estimate?.().then(e => {
      if (!e || !e.usage) return;
      av.append(el('div', 'hint',
        `Spazio in uso: ${nf(e.usage / 1048576, 1)} MB su ${nf(e.quota / 1048576, 0)} MB disponibili.`));
    }).catch(() => {});
    cont.append(av);
  }).catch(e => {
    cont.append(el('div', 'card', `<p class="muted">Archivio foto non disponibile: ${esc(e.message || e)}</p>`));
  });
}

function giorniFra(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 864e5);
}

/* ------------------------------------------------------------ timelapse */
function lapseCard(mie) {
  const c = el('div', 'cw');
  c.append(el('h3', null, 'Timelapse'));
  c.append(el('div', 'sub',
    `${mie.length} scatti su ${giorniFra(mie[0].giorno, mie[mie.length - 1].giorno)} giorni. `
    + 'Scorri a mano o premi Riproduci.'));

  const box = el('div', 'lapse');
  const img = el('img');
  box.append(img); c.append(box);

  const info = el('div', 'read');
  c.append(info);

  const bar = el('div', 'lapsebar');
  const play = el('button', 'btn sm', '▶');
  const rng = el('input');
  rng.type = 'range'; rng.min = 0; rng.max = mie.length - 1; rng.value = mie.length - 1;
  bar.append(play, rng); c.append(bar);

  const urls = mie.map(f => { const u = URL.createObjectURL(f.blob); fotoUrls.push(u); return u; });
  let i = mie.length - 1, timer = null;
  const mostra = n => {
    i = n; img.src = urls[n]; rng.value = n;
    const f = mie[n];
    info.innerHTML = `<span><b>${f.giorno}</b></span>`
      + `<span>${n + 1} di ${mie.length}</span>`
      + (f.peso != null ? `<span>${nf(f.peso, 1)} kg</span>` : '')
      + `<span>giorno ${giorniFra(mie[0].giorno, f.giorno)}</span>`;
  };
  rng.oninput = () => mostra(+rng.value);
  play.onclick = () => {
    if (timer) { clearInterval(timer); timer = null; play.textContent = '▶'; return; }
    play.textContent = '❚❚';
    if (i >= mie.length - 1) i = -1;
    timer = setInterval(() => {
      if (i >= mie.length - 1) { clearInterval(timer); timer = null; play.textContent = '▶'; return; }
      mostra(i + 1);
    }, 420);
  };
  mostra(i);
  c.append(el('p', 'note',
    'Non e\' un file video: l\'app non puo\' generarne uno senza librerie esterne. '
    + 'E\' una sequenza sfogliabile, che per guardare i progressi fa lo stesso lavoro.'));
  return c;
}

/* --------------------------------------------------------- singolo scatto */
function sheetScatto(f, url) {
  const w = el('div');
  w.append(el('div', 'eyebrow', esc(f.posa)));
  w.append(el('h2', 'sec', f.giorno));
  w.lastChild.style.marginTop = '0';
  const box = el('div', 'lapse');
  box.style.maxHeight = '46vh';
  box.innerHTML = `<img src="${url}">`;
  w.append(box);
  w.append(el('p', 'muted',
    `${f.w}×${f.h} px${f.peso != null ? ' · ' + nf(f.peso, 1) + ' kg quel giorno' : ''}`));

  const sc = el('button', 'btn wide', 'Salva sul telefono');
  sc.onclick = () => {
    const a = document.createElement('a');
    a.href = url; a.download = `dieta-${f.posa}-${f.giorno}.jpg`; a.click();
  };
  w.append(sc);

  const del = el('button', 'btn wide');
  del.style.marginTop = '8px';
  del.textContent = 'Elimina scatto';
  del.onclick = async () => {
    if (!confirm('Eliminare questo scatto? Non si puo\' annullare.')) return;
    await fotoElimina(f.id); closeSheet(); route(); toast('Eliminato');
  };
  w.append(del);
  sheet(w);
}
