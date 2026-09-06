/* La fotocamera a schermo intero.
 *
 * Per un po' la fotocamera e' vissuta **dentro un foglio**: un riquadro 3:4
 * alto meta' schermo, con sotto i bottoni, le pastiglie delle guide, il
 * cursore della trasparenza e tre paragrafi di spiegazione. Funzionava, e
 * chiedeva la cosa sbagliata: quando si inquadra si guarda **l'immagine**, e
 * un'anteprima grande come un francobollo in mezzo a un modulo non si guarda.
 *
 * Adesso e' quello che tutti sanno gia' usare — l'anteprima e' lo schermo, i
 * comandi ci stanno sopra, e in fondo c'e' il cerchio bianco. Le opzioni non
 * spariscono: stanno dietro le pastiglie in alto e si aprono in una riga
 * sola, come il timer e il flash della fotocamera di sistema.
 *
 * **Una sola schermata, due mestieri**, e cambia quello che serve:
 *
 * | | `progressi` | `piatto` |
 * |---|---|---|
 * | perche' | ti fotografi da solo, in casa | hai il piatto davanti |
 * | timer | serve: devi tornare al tuo posto | no: il telefono ce l'hai in mano |
 * | guida | fantasma, sagoma, griglia | la cornice del piatto |
 * | fotocamera | quasi sempre la frontale | quasi sempre la posteriore |
 *
 * **Si salva quello che si vede.** L'anteprima e' `object-fit: cover`, quindi
 * ai lati (o sopra e sotto) del fotogramma c'e' sempre una parte che sullo
 * schermo non c'e'. Salvarla vorrebbe dire consegnare una foto diversa da
 * quella che si e' inquadrata — e su una foto dei progressi, dove il punto e'
 * che due scatti siano confrontabili, sarebbe proprio il difetto che le guide
 * esistono per evitare. `camfCattura()` ritaglia il fotogramma esattamente
 * come lo ritaglia il CSS.
 *
 * E resta la regola di sempre: la frontale si vede specchiata perche' e' come
 * ci si aspetta di vedersi, ma **il file si salva dritto**.
 */
'use strict';

const CAMF_TIMER = [0, 3, 5, 10, 15];

/* Lo stato vive qui e non nella chiusura, perche' `camfChiudi()` deve poter
   spegnere il flusso da fuori — un `pagehide`, un cambio di rotta, un altro
   pezzo di app che apre un foglio. Una spia della fotocamera che resta accesa
   e' la cosa peggiore che questa schermata possa lasciare dietro di se'. */
let camf = null;

function camfChiudi() {
  if (!camf) return;
  const c = camf; camf = null;
  if (c.tick) clearInterval(c.tick);
  if (c.url) URL.revokeObjectURL(c.url);
  if (c.stream) c.stream.getTracks().forEach(t => t.stop());
  c.root?.remove();
  document.documentElement.classList.remove('camf-on');
}

/**
 * Che pezzo della sorgente si vede davvero dentro un riquadro `cover`.
 *
 * E' una funzione a se' perche' e' l'unica riga di conto di questo file, ed
 * e' l'unica che si puo' provare senza una fotocamera: con un video vero
 * dentro non si prova niente.
 */
function camfRitaglio(vw, vh, bw, bh) {
  /* `cover` scala col fattore piu' grande dei due e taglia il resto: la
     porzione visibile della sorgente e' quella del riquadro riportata
     indietro con lo stesso fattore. */
  const f = Math.max(bw / vw, bh / vh);
  const sw = Math.min(vw, bw / f), sh = Math.min(vh, bh / f);
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
}

/** Il fotogramma **come si vede**: stesso ritaglio che fa `object-fit:cover`. */
function camfCattura(video, box) {
  const vw = video.videoWidth || 720, vh = video.videoHeight || 960;
  const bw = box.clientWidth || vw, bh = box.clientHeight || vh;
  const { sx, sy, sw, sh } = camfRitaglio(vw, vh, bw, bh);
  const cv = document.createElement('canvas');
  cv.width = Math.round(sw); cv.height = Math.round(sh);
  cv.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return new Promise((ok, no) => cv.toBlob(
    b => b ? ok(b) : no(new Error('cattura fallita')), 'image/jpeg', .92));
}

/**
 * Apre la fotocamera.
 *
 * @param {object} o
 *   modo      'progressi' | 'piatto'
 *   posa      per i progressi: fronte / lato / schiena
 *   aiuto     la riga sopra il cerchio bianco
 *   onScatto  (blobOFile) => void — chiamata **dopo** aver spento tutto
 */
function camApri(o = {}) {
  camfChiudi();
  const piatto = o.modo === 'piatto';
  const c = camf = {
    modo: o.modo || 'progressi',
    posa: o.posa || 'fronte',
    onScatto: o.onScatto || (() => {}),
    fronte: piatto ? false : !!(S.settings?.camFronte ?? true),
    attesa: piatto ? 0 : +(S.settings?.autoscatto ?? 10),
    guida: piatto ? (S.settings?.guidaPiatto || 'cornice')
                  : (S.settings?.guidaFoto || 'fantasma'),
    opac: +(S.settings?.guidaOpacita ?? 45),
    aperto: null, stream: null, tick: null, url: null
  };

  const root = c.root = el('div', 'camf');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', piatto ? 'Fotografa il piatto' : 'Autoscatto');

  /* --- l'anteprima, che e' lo schermo --- */
  const v = c.box = el('div', 'camf-v');
  const video = c.video = el('video');
  video.autoplay = true; video.muted = true; video.playsInline = true;
  video.setAttribute('playsinline', '');   // su iOS serve anche l'attributo
  const ov = c.ov = el('div', 'gd-strato camf-ov');
  const conto = c.conto = el('div', 'camf-n'); conto.hidden = true;
  v.append(video, ov, conto);
  /* Lo specchio si mette subito e non quando arriva il flusso: e' una scelta,
     non una conseguenza, e messa dopo fa vedere l'anteprima ribaltarsi un
     istante dopo essere comparsa. */
  v.classList.toggle('specchio', c.fronte);
  root.append(v);

  /* --- la barra in alto: chiudi a sinistra, le pastiglie al centro --- */
  const top = el('div', 'camf-top');
  const x = el('button', 'camf-t camf-x', '&#10005;');
  x.setAttribute('aria-label', 'Chiudi la fotocamera');
  x.onclick = camfChiudi;
  const chips = c.chips = el('div', 'camf-chips');
  top.append(x, chips);
  v.append(top);

  /* La riga delle opzioni si apre **sopra** l'anteprima e non sotto: sotto
     c'e' il cerchio bianco, e un pannello che spinge il cerchio piu' in giu'
     lo sposta da sotto il pollice proprio mentre si sta per scattare. */
  const pan = c.pan = el('div', 'camf-pan'); pan.hidden = true;
  v.append(pan);

  const aiuto = c.aiuto = el('div', 'camf-aiuto');
  aiuto.innerHTML = o.aiuto || (piatto
    ? '<b>Inquadra bene il piatto</b><span>dall’alto, tutto dentro la cornice</span>'
    : '<b>Mettiti in posa</b><span>appoggia il telefono e torna al tuo posto</span>');
  v.append(aiuto);

  const err = c.err = el('div', 'camf-err'); err.hidden = true;
  v.append(err);

  /* --- la barra in fondo: galleria, scatto, gira --- */
  const bot = el('div', 'camf-bot');
  const gal = el('button', 'camf-s', '');
  gal.setAttribute('aria-label', 'Scegli una foto dalla galleria');
  gal.append(icona('immagine', { size: 21 }));
  const inp = c.inp = el('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
  inp.onchange = () => {
    const f = inp.files?.[0]; inp.value = '';
    if (!f) return;
    const fn = c.onScatto; camfChiudi(); fn(f);
  };
  gal.onclick = () => inp.click();

  const shot = c.shot = el('button', 'camf-shot', '<span></span>');
  shot.setAttribute('aria-label', 'Scatta');
  shot.onclick = () => camfVia();

  const flip = c.flip = el('button', 'camf-s', '');
  flip.setAttribute('aria-label', 'Gira la fotocamera');
  flip.append(icona('gira', { size: 21 }));
  flip.onclick = () => {
    c.fronte = !c.fronte;
    if (!piatto) { S.settings.camFronte = c.fronte; save(); }
    camfAccendi();
  };
  bot.append(gal, shot, flip, inp);
  root.append(bot);

  document.body.append(root);
  document.documentElement.classList.add('camf-on');
  camfChips();
  camfGuida();
  camfAccendi();
}

/* ------------------------------------------------------- il flusso video */
async function camfAccendi() {
  const c = camf; if (!c) return;
  if (c.stream) { c.stream.getTracks().forEach(t => t.stop()); c.stream = null; }
  c.err.hidden = true;
  try {
    c.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: c.fronte ? 'user' : 'environment',
               width: { ideal: 1280 }, height: { ideal: 1706 } },
      audio: false
    });
    if (camf !== c) { c.stream.getTracks().forEach(t => t.stop()); return; }
    c.video.srcObject = c.stream;
    c.box.classList.toggle('specchio', c.fronte);
    c.shot.disabled = false; c.flip.disabled = false;
  } catch (e) {
    /* Un vicolo cieco no: la galleria resta aperta, e il motivo vero (il
       permesso, o l'indirizzo non sicuro) si dice invece di lasciarlo
       indovinare. */
    c.shot.disabled = true; c.flip.disabled = true;
    c.err.hidden = false;
    c.err.innerHTML = '<b>Non riesco ad accendere la fotocamera.</b>'
      + '<span>Su iPhone succede se il permesso e’ stato negato — si rimette '
      + 'da Impostazioni &rsaquo; Safari — oppure se l’app e’ aperta da un '
      + 'indirizzo non sicuro. Intanto puoi scegliere una foto dalla galleria.</span>';
  }
}

/* --------------------------------------------------- scatto e conto alla rovescia */
function camfVia() {
  const c = camf; if (!c || c.tick) return;
  if (!c.attesa) return camfScatta();
  if (typeof recSbloccaAudio === 'function') recSbloccaAudio();
  let n = c.attesa;
  c.conto.hidden = false; c.conto.textContent = n;
  c.root.classList.add('conta');
  c.shot.setAttribute('aria-label', 'Annulla il conto alla rovescia');
  /* Sui secondi veri e non sui tick: iOS strozza `setInterval` e un conto
     che si fida dei tick arriva a zero quando gli pare. */
  const fine = Date.now() + c.attesa * 1000;
  c.tick = setInterval(() => {
    if (camf !== c) return;
    const r = Math.ceil((fine - Date.now()) / 1000);
    if (r === n) return;
    n = r;
    if (n > 0) {
      c.conto.textContent = n;
      if (typeof pulsa === 'function') pulsa(c.conto, { scala: 1.25, dur: 320 });
      if (n <= 3 && typeof recBip === 'function') recBip(1);
      return;
    }
    clearInterval(c.tick); c.tick = null;
    c.conto.hidden = true;
    if (typeof recBip === 'function') recBip(2);
    camfScatta();
  }, 120);
  c.shot.onclick = () => camfAnnulla();
}

function camfAnnulla() {
  const c = camf; if (!c) return;
  if (c.tick) { clearInterval(c.tick); c.tick = null; }
  c.conto.hidden = true;
  c.root.classList.remove('conta');
  c.shot.setAttribute('aria-label', 'Scatta');
  c.shot.onclick = () => camfVia();
}

async function camfScatta() {
  const c = camf; if (!c) return;
  c.box.classList.add('flash');
  try {
    const blob = await camfCattura(c.video, c.box);
    const fn = c.onScatto;
    camfChiudi();
    fn(blob);
  } catch (e) {
    c.box.classList.remove('flash');
    camfAnnulla();
    if (typeof toast === 'function') toast('Lo scatto non e\' riuscito: riprova.');
  }
}

/* ------------------------------------------------------------ le pastiglie */
function camfChips() {
  const c = camf; if (!c) return;
  c.chips.innerHTML = '';
  const chip = (id, testo, acceso) => {
    const b = el('button', 'camf-c' + (acceso ? ' on' : ''), esc(testo));
    b.setAttribute('aria-expanded', String(c.aperto === id));
    b.onclick = () => { c.aperto = c.aperto === id ? null : id; camfChips(); camfPan(); };
    c.chips.append(b);
    return b;
  };
  if (c.modo !== 'piatto')
    chip('timer', c.attesa ? c.attesa + '″' : 'niente timer', !!c.attesa);
  chip('guida', camfNomeGuida(), c.guida !== 'nessuna');
  camfPan();
}

function camfNomeGuida() {
  const c = camf;
  if (c.modo === 'piatto')
    return { cornice: 'cornice', griglia: 'griglia', nessuna: 'niente guida' }[c.guida] || 'cornice';
  return { nessuna: 'niente guida', griglia: 'griglia', sagoma: 'sagoma',
           fantasma: 'ultimo scatto' }[c.guida] || 'guida';
}

function camfPan() {
  const c = camf; if (!c) return;
  const p = c.pan;
  p.innerHTML = ''; p.hidden = !c.aperto;
  /* Il pannello si apre esattamente dove sta la riga d'aiuto: due testi
     bianchi sovrapposti non si leggono ne' l'uno ne' l'altro, e comunque chi
     ha appena aperto le opzioni non sta piu' leggendo il consiglio. */
  c.root.classList.toggle('apre', !!c.aperto);
  if (!c.aperto) return;

  const riga = el('div', 'camf-riga');
  const scelte = c.aperto === 'timer'
    ? CAMF_TIMER.map(s => [String(s), s ? s + '″' : 'off', () => {
        c.attesa = s; S.settings.autoscatto = s; save(); camfChips();
      }])
    : (c.modo === 'piatto'
        ? [['cornice', 'Cornice'], ['griglia', 'Griglia'], ['nessuna', 'Niente']]
        : [['fantasma', 'Ultimo scatto'], ['sagoma', 'Sagoma'],
           ['griglia', 'Griglia'], ['nessuna', 'Niente']])
        .map(([id, n]) => [id, n, () => {
          c.guida = id;
          if (c.modo === 'piatto') S.settings.guidaPiatto = id;
          else S.settings.guidaFoto = id;
          save(); camfChips(); camfGuida();
        }]);

  for (const [id, n, fn] of scelte) {
    const b = el('button', null, esc(n));
    const attiva = c.aperto === 'timer' ? String(c.attesa) === id : c.guida === id;
    b.setAttribute('aria-pressed', String(attiva));
    b.onclick = fn;
    riga.append(b);
  }
  p.append(riga);

  /* La trasparenza serve solo dove c'e' qualcosa di sovrapposto da vedere
     attraverso: su una foto scura il fantasma sparisce, su una chiara copre
     l'anteprima. */
  if (c.aperto === 'guida' && (c.guida === 'fantasma' || c.guida === 'sagoma')) {
    const s = el('div', 'camf-op');
    const r = el('input');
    r.type = 'range'; r.min = 10; r.max = 90; r.value = c.opac;
    r.setAttribute('aria-label', 'Trasparenza della guida');
    r.oninput = () => {
      c.opac = +r.value; S.settings.guidaOpacita = c.opac; save();
      const t = c.ov.querySelector('.gd-ghost, .gd-sag');
      if (t) t.style.opacity = c.opac / 100;
    };
    s.append(el('span', 'l', 'trasparenza'), r);
    p.append(s);
  }
  if (c.nota) p.append(el('p', 'camf-nota', c.nota));
}

/* ------------------------------------------------------------- le guide */
function camfGuida() {
  const c = camf; if (!c) return;
  c.ov.innerHTML = '';
  if (c.url) { URL.revokeObjectURL(c.url); c.url = null; }
  c.nota = '';

  if (c.guida === 'cornice') {
    /* Quattro angoli e non un rettangolo chiuso: un bordo intero invita a far
       combaciare il piatto col bordo, e non e' quello che serve — serve che
       il piatto ci stia **dentro** tutto.
       In CSS e non in SVG perche' il riquadro deve restare **quadrato** a
       qualunque proporzione di schermo: con `preserveAspectRatio: none` gli
       angoli si allungavano in verticale su un telefono stretto e alto, e
       quattro angoli di forma diversa non sembrano piu' una cornice. */
    c.ov.append(el('div', 'camf-cor', '<i></i><i></i><i></i><i></i>'));
  } else if (c.guida === 'griglia') {
    c.ov.append(svgGriglia());
  } else if (c.guida === 'sagoma') {
    const s = svgSagoma(c.posa);
    if (s) { s.style.opacity = c.opac / 100; c.ov.append(s); }
    c.nota = c.posa === 'lato'
      ? 'Questa e’ la figura di fronte: una sagoma di profilo non esiste. '
        + 'Di lato serve solo per l’altezza e la distanza.'
      : 'Non devi combaciarci: serve a non cambiare inquadratura.';
    camfPan();
  } else if (c.guida === 'fantasma') {
    c.ov.append(el('div', 'gd-att', 'cerco l\'ultimo scatto…'));
    fotoProgressi().then(tutte => {
      if (camf !== c || c.guida !== 'fantasma') return;
      const mie = tutte.filter(f => f.posa === c.posa);
      const ult = mie[mie.length - 1];
      c.ov.innerHTML = '';
      if (!ult) {
        c.ov.append(svgGriglia());
        c.nota = 'In questa posa non c’e’ ancora uno scatto: il fantasma '
          + 'compare dalla seconda volta. Intanto la griglia.';
        camfPan();
        return;
      }
      c.url = URL.createObjectURL(ult.blob);
      const img = el('img', 'gd-ghost');
      img.src = c.url;
      img.style.opacity = c.opac / 100;
      c.ov.append(img);
      c.nota = 'Sopra c’e’ lo scatto del ' + ult.giorno
        + '. Muoviti finche’ non ci combaci.';
      camfPan();
    }).catch(() => { if (camf === c) c.ov.innerHTML = ''; });
  }
  camfPan();
}

/* La spia della fotocamera non deve restare accesa perche' si e' cambiata
   pagina o si e' messa l'app in secondo piano. */
addEventListener('hashchange', () => camfChiudi());
addEventListener('pagehide', () => camfChiudi());
