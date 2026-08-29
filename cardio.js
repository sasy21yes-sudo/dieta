/* Cardio: registrazione, tracciato GPS, e la cartolina da condividere.
 *
 * IL VINCOLO CHE DECIDE TUTTO, e va detto prima di promettere: su iPhone una
 * pagina web NON puo' registrare un percorso con lo schermo spento. Appena
 * l'app va in secondo piano iOS la sospende e il GPS smette di arrivare. Non
 * e' un limite di questa implementazione, e' come funziona Safari: le app che
 * lo fanno sono native e chiedono un permesso "sempre" che al web non esiste.
 *
 * Quindi: si tiene lo schermo acceso con la Wake Lock API (Safari 16.4+), e la
 * schermata lo dice PRIMA di partire invece di far scoprire a fine corsa che
 * mancano otto chilometri. Chi non vuole tenere il telefono in mano registra
 * a mano — durata e distanza — e i conti tornano lo stesso.
 *
 * La cartolina non ha una mappa sotto. I tile di OpenStreetMap mandano
 * Access-Control-Allow-Origin (verificato, si potrebbero disegnare nel canvas
 * senza sporcarlo), ma la loro usage policy chiede di non appoggiarsi al
 * server pubblico per traffico applicativo, e da un browser non si puo'
 * nemmeno mandare uno User-Agent che identifichi l'app. Il tracciato nudo su
 * fondo pieno, per come la vedo, e' anche piu' bello: e' la forma della corsa,
 * senza il rumore delle strade intorno.
 */
'use strict';

const CARDIO_TIPI = [
  { id: 'corsa', n: 'Corsa', met: 9.8, gps: true, passo: 'min' },
  { id: 'camminata', n: 'Camminata', met: 3.8, gps: true, passo: 'min' },
  { id: 'bici', n: 'Bici', met: 7.5, gps: true, passo: 'kmh' },
  { id: 'nuoto', n: 'Nuoto', met: 7.0, gps: false, passo: 'min' },
  { id: 'vogatore', n: 'Vogatore', met: 8.0, gps: false, passo: 'min' },
  { id: 'ellittica', n: 'Ellittica', met: 5.0, gps: false, passo: null },
  { id: 'altro', n: 'Altro cardio', met: 6.0, gps: false, passo: null }
];
const cardioTipo = id => CARDIO_TIPI.find(t => t.id === id) || CARDIO_TIPI[6];

function cardioTutti() { P().cardio ||= {}; return P().cardio; }
function cardioDi(k) { return cardioTutti()[k] || []; }

/**
 * Calorie di una sessione cardio.
 * Sulla corsa si usa il costo per chilometro (1,036 kcal per kg per km del
 * catalogo) invece del MET: e' molto meno sensibile all'andatura, e su una
 * corsa lenta il MET medio sbaglia parecchio. Sul resto il MET va bene.
 */
function kcalCardio(rec) {
  const peso = lastWeight() ?? D.profilo.peso_iniziale_kg ?? 70;
  const t = cardioTipo(rec.tipo);
  const min = (rec.durata_s || 0) / 60;
  const km = (rec.distanza_m || 0) / 1000;
  if (rec.tipo === 'corsa' && km > 0)
    return Math.round(km * peso * (PD?.met?.corsa_kcal_per_kg_km ?? 1.036));
  return Math.round(t.met * 3.5 * peso / 200 * min);
}

/* --------------------------------------------------------------- formati */
const hms2 = s => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
           : `${m}:${String(x).padStart(2, '0')}`;
};
/** Passo o velocita', a seconda di cosa ha senso per quel tipo. */
function andatura(rec) {
  const t = cardioTipo(rec.tipo);
  const km = (rec.distanza_m || 0) / 1000, s = rec.durata_s || 0;
  if (!km || !s || !t.passo) return null;
  if (t.passo === 'kmh') return { v: nf(km / (s / 3600), 1), u: 'km/h' };
  const secKm = s / km;
  return { v: `${Math.floor(secKm / 60)}:${String(Math.round(secKm % 60)).padStart(2, '0')}`,
           u: 'min/km' };
}

/** Distanza fra due punti sulla sfera. */
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ============================================================ tracciamento */
let trk = null;     // { tipo, t0, punti, dist, watch, lock, tick, onAgg }

function tracciaAttiva() { return !!trk; }

async function avviaTraccia(tipo, onAgg) {
  if (!navigator.geolocation) throw new Error('Questo telefono non espone la posizione.');
  trk = { tipo, t0: Date.now(), punti: [], dist: 0, scartati: 0, onAgg, lock: null };

  /* lo schermo deve restare acceso, altrimenti iOS sospende la pagina e il
     GPS smette di arrivare a meta' corsa */
  try { trk.lock = await navigator.wakeLock?.request('screen'); } catch {}

  trk.watch = navigator.geolocation.watchPosition(pos => {
    const { latitude: la, longitude: lo, accuracy: acc } = pos.coords;
    // punti troppo imprecisi allungano il percorso di centinaia di metri:
    // meglio buttarli che gonfiare la distanza
    if (acc != null && acc > 35) { trk.scartati++; return; }
    const p = [la, lo, Math.round((Date.now() - trk.t0) / 1000)];
    const ult = trk.punti[trk.punti.length - 1];
    if (ult) {
      const d = haversine(ult, p);
      // sotto i due metri e' rumore del ricevitore, non movimento
      if (d < 2) return;
      trk.dist += d;
    }
    trk.punti.push(p);
    trk.onAgg?.(statoTraccia());
  }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });

  trk.tick = setInterval(() => trk?.onAgg?.(statoTraccia()), 1000);
  return statoTraccia();
}

function statoTraccia() {
  if (!trk) return null;
  const durata_s = Math.round((Date.now() - trk.t0) / 1000);
  return { tipo: trk.tipo, durata_s, distanza_m: Math.round(trk.dist),
           n: trk.punti.length, scartati: trk.scartati };
}

/** Chiude la registrazione e torna il record, senza salvarlo. */
function fermaTraccia() {
  if (!trk) return null;
  const st = statoTraccia();
  navigator.geolocation.clearWatch(trk.watch);
  clearInterval(trk.tick);
  try { trk.lock?.release(); } catch {}
  const rec = { id: uid(), tipo: trk.tipo, ...st,
                punti: trk.punti.map(p => [+p[0].toFixed(5), +p[1].toFixed(5), p[2]]),
                quando: new Date(trk.t0).toISOString() };
  delete rec.n;
  trk = null;
  return rec;
}
function annullaTraccia() {
  if (!trk) return;
  navigator.geolocation.clearWatch(trk.watch);
  clearInterval(trk.tick);
  try { trk.lock?.release(); } catch {}
  trk = null;
}

function salvaCardio(k, rec) {
  const L = cardioTutti();
  (L[k] ||= []).push({ ...rec, kcal: kcalCardio(rec) });
  save();
}

/* ============================================================== cartolina */
/** Legge la tavolozza validata dal CSS invece di riscriverla a mano qui. */
function tinte() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n, f) => (cs.getPropertyValue(n) || '').trim() || f;
  return { ink: g('--ink', '#16181c'), paper: g('--paper', '#fbfaf7'),
           pine: g('--pine', '#1f5c46'), amber: g('--amber', '#b0761f'),
           wash: g('--wash', '#eeeae1') };
}

/**
 * La cartolina: 1080x1350, tracciato al centro, tre numeri sotto.
 *
 * Il tracciato si proietta in equirettangolare corretta sulla latitudine —
 * senza il coseno un percorso a Milano verrebbe schiacciato di un terzo in
 * orizzontale — e si scala mantenendo il rapporto, altrimenti un fuori-e-torna
 * dritto diventerebbe un cerchio.
 */
function disegnaCartolina(rec, opts = {}) {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const T = tinte();
  const scuro = opts.tema !== 'chiaro';
  const fondo = scuro ? T.ink : T.paper;
  const testo = scuro ? T.paper : T.ink;
  const tenue = scuro ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.45)';

  /* fondo con un alone che da' profondita' senza disturbare il tracciato */
  x.fillStyle = fondo; x.fillRect(0, 0, W, H);
  const alone = x.createRadialGradient(W / 2, H * .42, 40, W / 2, H * .42, W * .78);
  alone.addColorStop(0, scuro ? 'rgba(255,255,255,.075)' : 'rgba(0,0,0,.05)');
  alone.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = alone; x.fillRect(0, 0, W, H);

  const M = 84;
  const tipo = cardioTipo(rec.tipo);

  /* --- testata --- */
  x.fillStyle = tenue;
  x.font = '600 26px ui-monospace, SFMono-Regular, Menlo, monospace';
  x.textBaseline = 'alphabetic';
  const data = (rec.quando || '').slice(0, 10) || today();
  x.fillText(data.split('-').reverse().join('/').toUpperCase(), M, M + 20);
  x.textAlign = 'right';
  x.fillText('DIETA', W - M, M + 20);
  x.textAlign = 'left';

  x.fillStyle = testo;
  x.font = '700 74px ui-serif, Georgia, "Times New Roman", serif';
  x.fillText(tipo.n, M, M + 108);
  // un filo d'accento sotto il titolo: aggancia la testata al tracciato
  x.fillStyle = T.pine;
  x.fillRect(M, M + 132, 74, 5);

  /* --- il tracciato --- */
  const pts = rec.punti || [];
  const box = { t: M + 170, h: H - M - 330 - (M + 170) + 170 };
  const areaY = M + 186, areaH = 690;
  if (pts.length > 3) {
    const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const kx = Math.cos(lat0 * Math.PI / 180);
    const px = pts.map(p => [p[1] * kx, -p[0]]);
    const xs = px.map(p => p[0]), ys = px.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = x1 - x0 || 1e-9, h = y1 - y0 || 1e-9;
    const areaW = W - M * 2;
    // stesso fattore sui due assi: la forma del percorso e' l'informazione
    const s = Math.min(areaW / w, areaH / h) * .92;
    const ox = M + (areaW - w * s) / 2, oy = areaY + (areaH - h * s) / 2;
    const P = p => [ox + (p[0] - x0) * s, oy + (p[1] - y0) * s];

    x.lineJoin = 'round'; x.lineCap = 'round';
    // alone morbido sotto la linea: la stacca dal fondo senza contorni duri
    x.save();
    x.shadowColor = T.pine; x.shadowBlur = 34;
    x.strokeStyle = T.pine; x.lineWidth = 16;
    x.beginPath();
    px.forEach((p, i) => { const q = P(p); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); });
    x.stroke();
    x.restore();

    // la linea vera, sfumata dall'inizio alla fine: si vede da dove sei partito
    const a = P(px[0]), b = P(px[px.length - 1]);
    const grad = x.createLinearGradient(a[0], a[1], b[0], b[1]);
    grad.addColorStop(0, T.pine); grad.addColorStop(1, T.amber);
    x.strokeStyle = grad; x.lineWidth = 11;
    x.beginPath();
    px.forEach((p, i) => { const q = P(p); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); });
    x.stroke();

    const punto = (q, col) => {
      x.beginPath(); x.arc(q[0], q[1], 15, 0, 7);
      x.fillStyle = fondo; x.fill();
      x.lineWidth = 7; x.strokeStyle = col; x.stroke();
    };
    punto(a, T.pine); punto(b, T.amber);
  } else {
    /* Senza tracciato il centro non va lasciato vuoto ne' riempito con una
       riga finta: ci si mette il numero che quella sessione ha comunque —
       l'energia spesa — grande quanto merita. */
    const kc = rec.kcal ?? kcalCardio(rec);
    x.textAlign = 'center';
    x.fillStyle = T.pine;
    x.font = '700 260px ui-sans-serif, -apple-system, system-ui, sans-serif';
    x.fillText(nf(kc), W / 2, areaY + areaH / 2 + 70);
    x.fillStyle = tenue;
    x.font = '600 32px ui-monospace, SFMono-Regular, Menlo, monospace';
    x.fillText('KCAL', W / 2, areaY + areaH / 2 + 130);
    x.font = '400 26px ui-monospace, SFMono-Regular, Menlo, monospace';
    x.fillText('registrata a mano, senza tracciato', W / 2, areaY + areaH - 20);
    x.textAlign = 'left';
  }

  /* --- i numeri --- */
  const an = andatura(rec);
  const voci = [
    ['DISTANZA', rec.distanza_m ? nf(rec.distanza_m / 1000, 2) : '—', 'km'],
    ['TEMPO', hms2(rec.durata_s || 0), ''],
    an ? ['ANDATURA', an.v, an.u] : ['ENERGIA', nf(rec.kcal ?? kcalCardio(rec)), 'kcal']
  ];
  const yN = H - M - 96;
  x.strokeStyle = scuro ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.1)';
  x.lineWidth = 2;
  x.beginPath(); x.moveTo(M, yN - 108); x.lineTo(W - M, yN - 108); x.stroke();
  voci.forEach((v, i) => {
    const cx = M + (W - M * 2) * (i + .5) / voci.length;
    x.textAlign = 'center';
    x.fillStyle = tenue;
    x.font = '600 24px ui-monospace, SFMono-Regular, Menlo, monospace';
    x.fillText(v[0], cx, yN - 62);
    x.fillStyle = testo;
    x.font = '700 68px ui-sans-serif, -apple-system, system-ui, sans-serif';
    x.fillText(v[1], cx, yN);
    if (v[2]) {
      x.fillStyle = tenue;
      x.font = '400 26px ui-monospace, SFMono-Regular, Menlo, monospace';
      x.fillText(v[2], cx, yN + 34);
    }
  });
  x.textAlign = 'left';
  return cv;
}

/** Condivide o scarica. Su iPhone il foglio di condivisione accetta i file. */
async function condividiCartolina(rec) {
  const cv = disegnaCartolina(rec);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if (!blob) { toast('Non riesco a generare l\'immagine'); return; }
  const file = new File([blob], `dieta-${rec.tipo}-${(rec.quando || '').slice(0, 10)}.png`,
    { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Immagine scaricata');
}

/* =============================================================== interfaccia */

/** La carta in Gym: cosa hai fatto oggi e i due modi di aggiungerne. */
function cardCardio(k = today()) {
  const oggi = cardioDi(k);
  const c = el('div', 'card');
  c.append(el('div', 'row between',
    `<strong>Cardio</strong><span class="mono muted" style="font-size:11px">${
      oggi.length ? oggi.length + ' oggi' : 'niente oggi'}</span>`));

  if (!oggi.length) {
    c.append(el('div', 'muted',
      'Corsa, camminata, bici, nuoto. Entra nel conto delle sedute della settimana '
      + 'e nella spesa energetica — che resta una misura del lavoro fatto, non '
      + 'calorie da rimangiare: quelle stanno gia\' dentro il dispendio stimato.'));
  }
  for (const [i, r] of oggi.entries()) {
    const t = cardioTipo(r.tipo), an = andatura(r);
    const row = el('button', 'cd-r');
    row.innerHTML = `<span class="nm">${esc(t.n)}${r.punti?.length
        ? ' <em class="pill">tracciato</em>' : ''}</span>
      <span class="mt">${hms2(r.durata_s || 0)}${r.distanza_m
        ? ' · ' + nf(r.distanza_m / 1000, 2) + ' km' : ''}${an ? ' · ' + an.v + ' ' + an.u : ''}</span>
      <span class="kc">${nf(r.kcal ?? kcalCardio(r))}<br><span class="mt">kcal</span></span>`;
    row.onclick = () => sheetCardioRec(k, i);
    c.append(row);
  }

  const r1 = el('div', 'row');
  r1.style.cssText = 'gap:8px;margin-top:10px';
  const gps = el('button', 'btn pri grow', 'Registra col GPS');
  gps.onclick = () => sheetTraccia();
  const man = el('button', 'btn grow', 'Scrivilo a mano');
  man.onclick = () => sheetCardioManuale(k);
  r1.append(gps, man);
  c.append(r1);
  return c;
}

/** Il foglio di una sessione salvata: numeri, tracciato, e la cartolina. */
function sheetCardioRec(k, i) {
  const r = cardioDi(k)[i];
  if (!r) return;
  const t = cardioTipo(r.tipo), an = andatura(r);
  const w = el('div');
  w.append(el('div', 'eyebrow', esc(k)));
  w.append(el('h2', 'sec', esc(t.n)));
  w.lastChild.style.marginTop = '0';

  const prev = el('div', 'cd-prev');
  prev.append(disegnaCartolina(r));
  w.append(prev);

  w.append(el('div', 'read',
    `<span><b>${r.distanza_m ? nf(r.distanza_m / 1000, 2) + ' km' : '—'}</b></span>`
    + `<span>${hms2(r.durata_s || 0)}</span>`
    + (an ? `<span>${an.v} ${an.u}</span>` : '')
    + `<span>${nf(r.kcal ?? kcalCardio(r))} kcal</span>`));

  const sh = el('button', 'btn wide pri', 'Condividi l\'immagine');
  sh.onclick = () => condividiCartolina(r);
  w.append(sh);

  const del = el('button', 'btn wide', 'Elimina');
  del.style.marginTop = '8px';
  del.onclick = () => {
    if (!confirm('Eliminare questa sessione?')) return;
    cardioTutti()[k].splice(i, 1);
    if (!cardioTutti()[k].length) delete cardioTutti()[k];
    save(); closeSheet(); route();
  };
  w.append(del);

  w.append(el('p', 'note',
    'L\'immagine e\' 1080×1350 e si genera qui sul telefono: non passa da nessun '
    + 'server, e la posizione non esce da questa app.'));
  sheet(w);
}

/** Registrazione a mano: due campi e via. */
function sheetCardioManuale(k) {
  let tipo = 'corsa';
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Senza GPS'));
  w.append(el('h2', 'sec', 'Cosa hai fatto'));
  w.lastChild.style.marginTop = '0';

  const seg = el('div', 'seg wrap');
  for (const t of CARDIO_TIPI) {
    const b = el('button', null, t.n);
    b.setAttribute('aria-pressed', t.id === tipo);
    b.onclick = () => { tipo = t.id;
      [...seg.children].forEach(x => x.setAttribute('aria-pressed', x === b)); };
    seg.append(b);
  }
  w.append(seg);

  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px;margin-top:12px';
  g.innerHTML = `<div class="field"><label>Minuti</label>
      <input type="text" inputmode="numeric" id="cd-min" value="30"></div>
    <div class="field"><label>Distanza <span class="muted">(km)</span></label>
      <input type="text" inputmode="decimal" id="cd-km" placeholder="facoltativa"></div>`;
  w.append(g);

  const b = el('button', 'btn wide pri', 'Salva');
  b.onclick = () => {
    const min = parseNum($('#cd-min').value);
    if (!(min > 0)) { toast('Servono i minuti'); return; }
    const km = parseNum($('#cd-km').value) || 0;
    salvaCardio(k, { id: uid(), tipo, durata_s: Math.round(min * 60),
      distanza_m: Math.round(km * 1000), punti: [],
      quando: new Date(k + 'T12:00:00').toISOString() });
    closeSheet(); route(); toast('Registrato');
  };
  w.append(b);
  w.append(el('p', 'note',
    'La distanza e\' facoltativa ovunque tranne che sulla corsa, dove serve al '
    + 'conto delle calorie: li\' si usa il costo per chilometro invece del MET, '
    + 'perche\' cambia molto meno con l\'andatura.'));
  sheet(w);
}

/* -------------------------------------------------------- la registrazione */
function sheetTraccia() {
  const tipiGps = CARDIO_TIPI.filter(t => t.gps);
  let tipo = 'corsa';
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Col GPS'));
  w.append(el('h2', 'sec', 'Registra il percorso'));
  w.lastChild.style.marginTop = '0';

  w.append(el('div', 'hint acciacco',
    '<strong>Lo schermo deve restare acceso.</strong> Una pagina web su iPhone '
    + 'viene sospesa appena va in secondo piano, e il GPS smette di arrivare: '
    + 'non e\' un difetto di questa app, e\' come funziona Safari. L\'app tiene '
    + 'acceso lo schermo da sola, ma se blocchi il telefono o cambi applicazione '
    + 'la registrazione si ferma li\'. Se non vuoi tenerlo in mano, scrivi durata '
    + 'e distanza a mano: i conti vengono identici.'));

  const seg = el('div', 'seg');
  for (const t of tipiGps) {
    const b = el('button', null, t.n);
    b.setAttribute('aria-pressed', t.id === tipo);
    b.onclick = () => { tipo = t.id;
      [...seg.children].forEach(x => x.setAttribute('aria-pressed', x === b)); };
    seg.append(b);
  }
  w.append(seg);

  const live = el('div', 'cd-live');
  live.hidden = true;
  live.innerHTML = '<div class="v"><span class="n" id="cd-d">0,00</span><span class="u">km</span></div>'
    + '<div class="v"><span class="n" id="cd-t">0:00</span><span class="u">tempo</span></div>'
    + '<div class="v"><span class="n" id="cd-p">—</span><span class="u">min/km</span></div>';
  w.append(live);
  const stato = el('p', 'muted');
  w.append(stato);

  const via = el('button', 'btn wide pri', 'Parti');
  const stop = el('button', 'btn wide', 'Fermati e salva');
  stop.hidden = true; stop.style.marginTop = '8px';
  const ann = el('button', 'btn wide', 'Annulla');
  ann.hidden = true; ann.style.marginTop = '8px';
  w.append(via, stop, ann);

  const agg = st => {
    if (!st) return;
    $('#cd-d').textContent = nf(st.distanza_m / 1000, 2);
    $('#cd-t').textContent = hms2(st.durata_s);
    const a = andatura(st);
    $('#cd-p').textContent = a ? a.v : '—';
    stato.textContent = st.n
      ? `${st.n} punti registrati${st.scartati ? `, ${st.scartati} scartati perche' imprecisi` : ''}.`
      : 'Aspetto il primo aggancio del GPS: all\'aperto ci mette pochi secondi.';
  };

  via.onclick = async () => {
    via.disabled = true; via.textContent = 'Accendo il GPS…';
    try {
      await avviaTraccia(tipo, agg);
      live.hidden = false; via.hidden = true;
      stop.hidden = false; ann.hidden = false;
      agg(statoTraccia());
    } catch (e) {
      via.disabled = false; via.textContent = 'Parti';
      stato.textContent = 'Non riesco ad accedere alla posizione. Su iPhone si '
        + 'rimette da Impostazioni, Safari, Posizione.';
    }
  };
  stop.onclick = () => {
    const rec = fermaTraccia();
    if (!rec || rec.durata_s < 20) { toast('Troppo breve per salvarla'); closeSheet(); return; }
    const k = rec.quando.slice(0, 10);
    salvaCardio(k, rec);
    closeSheet(); route();
    // la cartolina si apre subito: e' il momento in cui la si vuole vedere
    setTimeout(() => sheetCardioRec(k, cardioDi(k).length - 1), 260);
  };
  ann.onclick = () => { annullaTraccia(); closeSheet(); };
  sheet(w);
}
