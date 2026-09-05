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

/* ====================================================== autoscatto

   Il problema e' banale e blocca tutto: le foto dei progressi si fanno da
   soli, in casa, e con <input capture> si finisce nella fotocamera di
   sistema — dove il timer c'e', ma bisogna trovarlo, e a ogni scatto si
   ripassa da li'. Serve un autoscatto dentro l'app.

   Percio' qui la fotocamera e' nostra: getUserMedia per l'anteprima dal vivo,
   un conto alla rovescia, e il fotogramma catturato su canvas che poi passa
   per la stessa compressione di prima. Il file picker resta: serve per le
   foto che hai gia' in galleria, e come riserva dove getUserMedia non parte.

   Tre dettagli che su iPhone non sono facoltativi:
   - playsinline, altrimenti Safari apre il video a schermo intero e
     l'anteprima sparisce dietro il player;
   - le tracce vanno fermate a mano quando si chiude, o la spia della
     fotocamera resta accesa;
   - l'anteprima frontale si specchia in CSS perche' e' cosi' che ci si
     aspetta di vedersi, ma lo scatto si salva NON specchiato: due foto a
     mesi di distanza devono essere confrontabili, e un ribaltamento in
     mezzo rovinerebbe il confronto a cursore.
*/

/* ====================================================== guide di inquadratura

   Il problema delle foto dei progressi non e' la qualita' dello scatto: e' che
   fra una e l'altra cambia la distanza, l'altezza del telefono e l'angolo, e
   allora due foto a due mesi di distanza non sono confrontabili. Il confronto
   a cursore lo rende evidente: se l'inquadratura balla, sembra che sia
   cambiato il corpo quando e' cambiato il fotografo.

   Tre guide, in ordine di quanto servono davvero:

   1. FANTASMA — l'ultimo scatto di quella posa in trasparenza sopra
      l'anteprima. E' quello che conta: allinei te stesso alla foto di prima e
      l'inquadratura torna identica senza dover ricordare niente. Le app
      dedicate all'allineamento fanno esattamente questo.
   2. SAGOMA — una figura di riferimento, per il primo scatto quando un
      fantasma non c'e' ancora. Si riusa la silhouette neutra di
      data/corpo.json: serve a dire "stai a questa distanza", non a fare
      anatomia.
   3. GRIGLIA — i terzi. Aiuta a tenere il telefono dritto e il corpo
      centrato, ed e' la guida piu' leggera quando le altre due danno fastidio.

   L'opacita' si regola perche' con una foto scura il fantasma sparisce e con
   una chiara copre l'anteprima. */

const GUIDE_FOTO = [
  { id: 'nessuna', n: 'Niente' },
  { id: 'griglia', n: 'Griglia' },
  { id: 'sagoma', n: 'Sagoma' },
  { id: 'fantasma', n: 'Ultimo scatto' }
];

/** La griglia dei terzi, piu' due tacche per testa e piedi. */
function svgGriglia() {
  const s = mk('svg', { viewBox: '0 0 100 133', preserveAspectRatio: 'none',
    class: 'gd-svg', 'aria-hidden': 'true' });
  const linea = (x1, y1, x2, y2, forte) => s.append(mk('line', { x1, y1, x2, y2,
    stroke: '#fff', 'stroke-width': forte ? .7 : .4,
    opacity: forte ? .85 : .5, 'vector-effect': 'non-scaling-stroke' }));
  for (const f of [1 / 3, 2 / 3]) {
    linea(f * 100, 0, f * 100, 133);
    linea(0, f * 133, 100, f * 133);
  }
  // le due tacche dove dovrebbero cadere testa e piedi: e' la distanza dal
  // telefono che cambia di piu' fra uno scatto e l'altro
  for (const y of [10, 123]) {
    linea(6, y, 20, y, true);
    linea(80, y, 94, y, true);
  }
  return s;
}

/** La sagoma neutra, presa dalla stessa figura della mappa muscolare. */
function svgSagoma(posa) {
  if (typeof CORPO === 'undefined' || !CORPO) return null;
  const sesso = D.profilo?.sesso === 'f' ? 'f' : 'm';
  const lato = posa === 'schiena' ? 'schiena' : 'fronte';
  const V = CORPO.viste[sesso + '-' + lato] || CORPO.viste['m-' + lato];
  if (!V) return null;
  const s = mk('svg', { viewBox: V.viewBox, class: 'gd-svg gd-sag', 'aria-hidden': 'true' });
  const g = mk('g', { fill: 'none', stroke: '#fff', 'stroke-width': 2.2,
    'stroke-linejoin': 'round', opacity: .9 });
  for (const d of V.neutri) g.append(mk('path', { d }));
  for (const paths of Object.values(V.muscoli))
    for (const d of paths) g.append(mk('path', { d }));
  s.append(g);
  return s;
}

/**
 * Il pannello delle guide, da attaccare sotto l'anteprima.
 * `box` e' il contenitore .cam su cui si sovrappongono.
 */
function pannelloGuide(box, posa) {
  let scelta = S.settings?.guidaFoto || 'fantasma';
  let opacita = +(S.settings?.guidaOpacita ?? 45);
  const strato = el('div', 'gd-strato');
  box.append(strato);

  const w = el('div');
  w.append(el('div', 'eyebrow', 'Guida per inquadrare'));
  const seg = el('div', 'seg wrap');
  const slider = el('div', 'gd-op');
  const rng = el('input');
  rng.type = 'range'; rng.min = 10; rng.max = 90; rng.value = opacita;
  slider.append(el('span', 'l', 'trasparenza'), rng);
  const nota = el('p', 'hint');

  let urlFantasma = null;
  const disegna = () => {
    strato.innerHTML = '';
    if (urlFantasma) { URL.revokeObjectURL(urlFantasma); urlFantasma = null; }
    slider.hidden = scelta === 'nessuna' || scelta === 'griglia';
    nota.textContent = '';
    if (scelta === 'griglia') {
      strato.append(svgGriglia());
      nota.textContent = 'I terzi, piu\' due tacche dove far cadere testa e piedi: '
        + 'la distanza dal telefono e\' quello che cambia di piu\' fra uno scatto e l\'altro.';
    } else if (scelta === 'sagoma') {
      const s = svgSagoma(posa);
      if (s) { s.style.opacity = opacita / 100; strato.append(s); }
      // la sorgente non ha una figura di profilo: dirlo invece di far combaciare
      // una posa di fronte con una foto di lato
      nota.textContent = posa === 'lato'
        ? 'Attenzione: questa e\' la figura di fronte, non di profilo — una sagoma '
          + 'laterale non esiste. Di lato usala solo per l\'altezza e la distanza, '
          + 'o passa alla griglia.'
        : 'Una figura di riferimento per la distanza e l\'altezza del telefono. '
          + 'Non devi combaciarci: serve a non cambiare inquadratura.';
    } else if (scelta === 'fantasma') {
      strato.append(el('div', 'gd-att', 'cerco l\'ultimo scatto…'));
      fotoTutte().then(tutte => {
        const mie = tutte.filter(f => f.posa === posa);
        const ult = mie[mie.length - 1];
        strato.innerHTML = '';
        if (!ult) {
          nota.textContent = 'Non c\'e\' ancora uno scatto in questa posa: il fantasma '
            + 'compare dalla seconda volta. Per la prima usa la sagoma o la griglia.';
          const s = svgGriglia(); strato.append(s);
          return;
        }
        urlFantasma = URL.createObjectURL(ult.blob);
        const img = el('img', 'gd-ghost');
        img.src = urlFantasma;
        img.style.opacity = opacita / 100;
        strato.append(img);
        nota.textContent = `Sopra c'e' lo scatto del ${ult.giorno}. Muoviti finche' non `
          + 'ci combaci: e\' l\'unico modo perche\' il confronto a cursore mostri il '
          + 'corpo e non il fotografo.';
      }).catch(() => { strato.innerHTML = ''; });
    }
  };

  for (const g of GUIDE_FOTO) {
    const b = el('button', null, g.n);
    b.setAttribute('aria-pressed', scelta === g.id);
    b.onclick = () => {
      scelta = g.id;
      S.settings.guidaFoto = g.id; save();
      [...seg.children].forEach(x => x.setAttribute('aria-pressed', x === b));
      disegna();
    };
    seg.append(b);
  }
  rng.oninput = () => {
    opacita = +rng.value;
    S.settings.guidaOpacita = opacita; save();
    const t = strato.querySelector('.gd-ghost, .gd-sag');
    if (t) t.style.opacity = opacita / 100;
  };
  w.append(seg, slider, nota);
  disegna();
  return { pannello: w, pulisci: () => { if (urlFantasma) URL.revokeObjectURL(urlFantasma); } };
}

const CAM_ATTESE = [3, 5, 10, 15];
let camStream = null, camTimer = null, camPulisci = null;

function camChiudi() {
  camPulisci?.(); camPulisci = null;
  if (camTimer) { clearInterval(camTimer); camTimer = null; }
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
}

/** Il fotogramma corrente del video, come Blob JPEG. */
function camScatta(video) {
  const cv = document.createElement('canvas');
  cv.width = video.videoWidth || 720;
  cv.height = video.videoHeight || 960;
  cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
  return new Promise((ok, no) => cv.toBlob(
    b => b ? ok(b) : no(new Error('cattura fallita')), 'image/jpeg', .92));
}

function sheetFotocamera(posa) {
  let fronte = false;                       // di norma la posteriore: e' migliore
  let attesa = +(S.settings?.autoscatto ?? 10);
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Autoscatto · ' + esc(posa)));
  w.append(el('h2', 'sec', 'Mettiti in posa'));
  w.lastChild.style.marginTop = '0';

  const box = el('div', 'cam');
  const video = el('video');
  video.autoplay = true; video.muted = true; video.playsInline = true;
  video.setAttribute('playsinline', '');    // iOS vuole anche l'attributo
  const conto = el('div', 'cam-n');
  conto.hidden = true;
  box.append(video, conto);
  w.append(box);

  const stato = el('p', 'muted', 'Accendo la fotocamera…');
  w.append(stato);

  const G = pannelloGuide(box, posa);
  camPulisci = G.pulisci;
  w.append(G.pannello);

  /* --- scelta dell'attesa --- */
  w.append(el('div', 'eyebrow', 'Quanti secondi'));
  const seg = el('div', 'seg');
  for (const s of CAM_ATTESE) {
    const b = el('button', null, s + '″');
    b.setAttribute('aria-pressed', attesa === s);
    b.onclick = () => {
      attesa = s;
      S.settings.autoscatto = s; save();
      [...seg.children].forEach(x => x.setAttribute('aria-pressed', x === b));
    };
    seg.append(b);
  }
  w.append(seg);

  const via = el('button', 'btn wide pri', 'Avvia l\'autoscatto');
  via.disabled = true;
  w.append(via);

  const gira = el('button', 'btn wide', 'Gira la fotocamera');
  gira.style.marginTop = '8px';
  gira.disabled = true;
  w.append(gira);

  w.append(el('p', 'note',
    'Il conto alla rovescia si vede sullo schermo e si sente, ma solo con l\'app '
    + 'in primo piano: una pagina web non puo\' suonare da spenta. Appoggia il '
    + 'telefono, torna al tuo posto e aspetta i tre bip finali.'));

  const ind = el('button', 'btn wide', 'Scegli una foto dalla galleria');
  ind.style.marginTop = '8px';
  ind.onclick = () => { camChiudi(); closeSheet(); document.getElementById('foto-file')?.click(); };
  w.append(ind);

  async function accendi() {
    camChiudi();
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: fronte ? 'user' : 'environment',
                 width: { ideal: 1280 }, height: { ideal: 1706 } },
        audio: false
      });
      video.srcObject = camStream;
      box.classList.toggle('specchio', fronte);
      stato.textContent = fronte
        ? 'Fotocamera frontale: ti vedi come allo specchio, ma lo scatto viene salvato dritto.'
        : 'Fotocamera posteriore. Appoggia il telefono contro qualcosa di stabile.';
      via.disabled = false; gira.disabled = false;
    } catch (e) {
      stato.innerHTML = 'Non riesco ad accendere la fotocamera. Su iPhone succede se '
        + 'hai negato il permesso — si rimette da <em>Impostazioni &rsaquo; Safari</em> — '
        + 'oppure se stai aprendo l\'app da un indirizzo non sicuro. '
        + 'Intanto puoi usare la galleria qui sotto.';
      via.disabled = true; gira.disabled = true;
    }
  }
  gira.onclick = () => { fronte = !fronte; accendi(); };

  via.onclick = () => {
    if (camTimer) return;
    if (typeof recSbloccaAudio === 'function') recSbloccaAudio();
    let n = attesa;
    conto.hidden = false; conto.textContent = n;
    via.disabled = true; gira.disabled = true; via.textContent = 'Conto alla rovescia…';
    // si conta sui secondi veri, non sui tick: se il telefono strozza il timer
    // il conto resta onesto
    const fine = Date.now() + attesa * 1000;
    camTimer = setInterval(async () => {
      const r = Math.ceil((fine - Date.now()) / 1000);
      if (r === n) return;
      n = r;
      if (n > 0) {
        conto.textContent = n;
        if (typeof pulsa === 'function') pulsa(conto, { scala: 1.25, dur: 320 });
        if (n <= 3 && typeof recBip === 'function') recBip(1);
        return;
      }
      clearInterval(camTimer); camTimer = null;
      conto.textContent = '';
      box.classList.add('flash');
      if (typeof recBip === 'function') recBip(2);
      try {
        const blob = await camScatta(video);
        camChiudi();
        await salvaScatto(blob, posa);
      } catch (err) {
        box.classList.remove('flash');
        stato.textContent = 'Lo scatto non e\' riuscito: riprova.';
        via.disabled = false; gira.disabled = false; via.textContent = 'Avvia l\'autoscatto';
      }
    }, 120);
  };

  sheet(w);
  accendi();
}

/** Comprime, salva, aggiorna. Unico punto in cui una foto entra in archivio. */
async function salvaScatto(fileOBlob, posa) {
  toast('Elaboro…');
  const { blob, w: bw, h: bh } = await comprimi(fileOBlob);
  await fotoSalva({ id: uid(), giorno: today(), posa, blob, w: bw, h: bh,
                    peso: S.log[today()]?.peso ?? null });
  // contatore per i traguardi: le foto stanno in IndexedDB e i traguardi
  // si calcolano su S, che e' sincrono
  S.settings.nFoto = (S.settings.nFoto || 0) + 1; save();
  closeSheet(); route(); toast('Scatto salvato');
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
  inp.id = 'foto-file';
  inp.type = 'file'; inp.accept = 'image/*';
  inp.style.display = 'none';
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    try { await salvaScatto(file, fotoPosa); }
    catch (e) { toast('Non riesco a leggere l\'immagine'); }
  };
  v.append(inp);

  const auto = el('button', 'btn wide pri', 'Autoscatto');
  auto.onclick = () => sheetFotocamera(fotoPosa);
  v.append(auto);
  v.append(el('p', 'hint',
    'Appoggia il telefono, avvia il conto alla rovescia e mettiti in posa. '
    + 'Da soli non si scatta in nessun altro modo.'));

  const scegli = el('button', 'btn wide', 'Scegli una foto che hai gia\'');
  scegli.style.marginTop = '4px';
  scegli.onclick = () => inp.click();
  v.append(scegli);

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
      c.append(sliderConfronto(a, b));
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

/**
 * Confronto a cursore: la foto di adesso sopra quella di prima, tagliata da
 * una riga che si trascina.
 *
 * Perche' non due foto affiancate: affiancate se ne guarda una alla volta e
 * il cervello non tiene a mente i contorni. Sovrapposte, con il taglio che
 * si muove, la differenza si vede nel punto esatto in cui passa la riga —
 * che su un mese di dieta e' l'unico modo di accorgersene.
 *
 * Il taglio usa clip-path e non due contenitori di larghezza variabile:
 * cambiare la larghezza fa ricalcolare il layout a ogni pixel di
 * trascinamento, clip-path no.
 */
function sliderConfronto(a, b) {
  const ua = URL.createObjectURL(a.blob), ub = URL.createObjectURL(b.blob);
  fotoUrls.push(ua, ub);
  const box = el('div', 'cfr');
  box.innerHTML = `<img class="sotto" src="${ua}" alt="prima">
    <img class="sopra" src="${ub}" alt="dopo">
    <span class="riga"><i></i></span>
    <span class="tag sx">${esc(a.giorno.slice(5))}</span>
    <span class="tag dx">${esc(b.giorno.slice(5))}</span>`;
  const sopra = box.querySelector('.sopra'), riga = box.querySelector('.riga');
  const metti = v => {
    const q = Math.max(0, Math.min(1, v));
    sopra.style.clipPath = `inset(0 0 0 ${q * 100}%)`;
    riga.style.left = (q * 100) + '%';
  };
  const daEvento = e => {
    const r = box.getBoundingClientRect();
    metti((e.clientX - r.left) / r.width);
  };
  let giu = false;
  box.addEventListener('pointerdown', e => {
    giu = true;
    try { box.setPointerCapture(e.pointerId); } catch {}
    daEvento(e);
  });
  box.addEventListener('pointermove', e => { if (giu) { e.preventDefault(); daEvento(e); } });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
    box.addEventListener(ev, () => { giu = false; });
  metti(.5);

  /* All'entrata in vista la riga fa un giro completo. E' il modo piu' corto
     di far capire che si trascina senza scrivere "trascina" da nessuna parte
     — e con reduced-motion resta ferma a meta', che si capisce comunque. */
  if (typeof osserva === 'function') osserva(box, () => {
    if (!motionOk()) return;
    const t0 = performance.now(), dur = 1600;
    const passo = now => {
      const t = Math.min(1, (now - t0) / dur);
      metti(.5 + Math.sin(t * Math.PI * 2) * .42);
      if (t < 1) requestAnimationFrame(passo); else metti(.5);
    };
    requestAnimationFrame(passo);
  });
  return box;
}


/* ============================================ le foto dentro un backup
 *
 * Il backup completo porta **tutto** quello che sta in `localStorage`:
 * verificato campo per campo, non ne perde nemmeno uno. Le foto pero' non
 * stanno li' — sono Blob in IndexedDB, perche' in `localStorage` non ci
 * starebbero — e restavano fuori. La cosa era scritta in fondo al foglio
 * dell'import, cioe' **dopo**, quando il file l'hai gia' fatto: chi esporta
 * e chiude non lo legge mai.
 *
 * Adesso hanno un file loro, e si rimettono dalla stessa porta. Il formato e'
 * JSON con le immagini in base64 e non uno zip, per una ragione sola: cosi'
 * si **rilegge**. Uno zip scritto a mano andrebbe anche letto a mano, e un
 * export che non si puo' reimportare non e' un backup, e' un salvataggio.
 *
 * Il prezzo e' il 33% di peso in piu' della base64, e si dichiara prima di
 * cominciare invece di far scoprire un file da settanta megabyte a
 * scaricamento finito.
 */
const FOTO_FMT = 'dieta-foto/1';

const bloB64 = b => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => no(r.error);
  r.readAsDataURL(b);
});

/** Quante sono e quanto pesano, prima di decidere. */
async function fotoPeso() {
  const t = await fotoTutte();
  const byte = t.reduce((a, f) => a + (f.blob?.size || 0), 0);
  return { n: t.length, byte, stima: Math.round(byte * 1.37) };
}

async function fotoEsporta() {
  const t = await fotoTutte();
  if (!t.length) { toast('Non hai nessuna foto'); return 0; }
  toast('Preparo ' + t.length + ' foto…');
  const scatti = [];
  for (const f of t) scatti.push({
    id: f.id, giorno: f.giorno, posa: f.posa, w: f.w, h: f.h,
    peso: f.peso ?? null, dati: await bloB64(f.blob)
  });
  download('dieta-foto-' + today() + '.json',
    JSON.stringify({ formato: FOTO_FMT, quando: today(), n: scatti.length, scatti }),
    'application/json');
  return scatti.length;
}

/** Rimette gli scatti. Stesso id = stessa foto: si sovrascrive, non si duplica. */
async function fotoImporta(o) {
  const arr = Array.isArray(o?.scatti) ? o.scatti : [];
  let n = 0;
  for (const s of arr) {
    if (!s?.dati || !s.id) continue;
    const blob = await (await fetch(s.dati)).blob();
    await fotoSalva({ id: s.id, giorno: s.giorno || today(), posa: s.posa || 'fronte',
                      blob, w: s.w || 0, h: s.h || 0, peso: s.peso ?? null });
    n++;
  }
  /* Il contatore dei traguardi vive in `S` perche' i traguardi si calcolano
     sincroni: dopo un import va riallineato, o resta quello di prima. */
  const tutte = await fotoTutte();
  S.settings.nFoto = tutte.length; save();
  return n;
}

/** Il foglio: quanto pesa, cosa contiene, e le due direzioni. */
async function sheetFotoBackup() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Le foto'));
  w.append(el('h2', 'sec', 'Un file a parte'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Il backup completo porta tutto quello che sta nella memoria del browser: '
    + 'diario, piano, palestra, prodotti, impostazioni. Le foto no — sono '
    + 'immagini in IndexedDB, e in un file di testo ci stanno solo se le si '
    + 'riscrive come testo. Questo e\u2019 quel file.'));

  const info = el('div', 'read');
  info.innerHTML = '<span>conto in corso…</span>';
  w.append(info);

  const esp = el('button', 'btn wide pri', 'Salva le foto');
  esp.style.marginTop = '10px';
  esp.disabled = true;
  esp.onclick = async () => {
    esp.disabled = true;
    const n = await fotoEsporta();
    if (n) toast(n + ' foto salvate');
    esp.disabled = false;
  };
  w.append(esp);

  const imp = el('button', 'btn wide', 'Rimetti le foto da un file');
  imp.style.marginTop = '8px';
  imp.onclick = () => {
    const i = el('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = () => {
      const f = i.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          const o = JSON.parse(r.result);
          if (o?.formato !== FOTO_FMT) { toast('Non e\u2019 un file di foto'); return; }
          toast('Rimetto ' + (o.n || 0) + ' foto…');
          const n = await fotoImporta(o);
          closeSheet(); route();
          toast(n + ' foto rimesse');
        } catch (e) { toast('File non valido: ' + (e.message || 'illeggibile')); }
      };
      r.readAsText(f);
    };
    i.click();
  };
  w.append(imp);
  w.append(el('p', 'note',
    'Rimettendole si aggiungono a quelle che hai: uno scatto con lo stesso '
    + 'codice sostituisce se stesso, non si duplica. Il file e\u2019 circa un '
    + 'terzo piu\u2019 grande delle foto, perche\u2019 dentro un JSON le immagini '
    + 'si scrivono come testo.'));
  sheet(w);

  const p = await fotoPeso();
  info.innerHTML = `<span>${p.n} ${p.n === 1 ? 'foto' : 'foto'}</span>`
    + `<span>${nf(p.byte / 1048576, 1)} MB sul telefono</span>`
    + `<span>file circa ${nf(p.stima / 1048576, 1)} MB</span>`;
  esp.disabled = !p.n;
  if (!p.n) esp.textContent = 'Non hai ancora nessuna foto';
}
