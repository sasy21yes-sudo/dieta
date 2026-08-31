/* Timer di recupero.
 *
 * Due vincoli iOS che decidono l'intera implementazione:
 *
 * 1. setInterval viene strozzato — e spesso fermato — quando la PWA finisce
 *    in secondo piano. Contare i tick porterebbe a un timer che "si dimentica"
 *    dei minuti passati a schermo spento. Quindi non si conta niente: si
 *    salva l'istante di partenza e a ogni disegno si fa la sottrazione. Se
 *    torni dopo tre minuti il timer e' gia' a zero, che e' la verita'.
 * 2. Non esistono notifiche locali programmate, e navigator.vibrate non e'
 *    implementato in Safari. Il segnale acustico quindi suona SOLO con l'app
 *    aperta e in primo piano — e la UI lo dice, invece di far finta.
 *
 * Il timer sopravvive ai cambi di schermata perche' sta in localStorage:
 * si puo' far partire il recupero, andare a guardare il grafico della forza
 * e tornare indietro.
 */
'use strict';

/** Recuperi tipici, in secondi. Non sono misure: sono valori di uso comune. */
const REC_DEFAULT = { pesante: 180, multi: 120, isolamento: 75, tecnica: 45 };

/** I recuperi che si scelgono davvero, in secondi. */
const REC_SCELTE = [30, 45, 60, 90, 120, 180, 240];
const recTesto = sec => sec % 60 === 0 && sec >= 60
  ? (sec / 60) + '′' : sec >= 60
    ? Math.floor(sec / 60) + '′' + (sec % 60) + '″' : sec + '″';

/**
 * Quanto recupero suggerire per una riga di scheda.
 *
 * Tre livelli, dal piu' specifico al piu' generico, e vince il primo che c'e':
 *
 *   1. `riga.recupero`  — quello che hai scritto su QUESTO esercizio
 *   2. `sc.recupero`    — quello della scheda, per non ripeterlo otto volte
 *   3. il calcolo       — piu' l'esercizio muove carico e articolazioni, piu'
 *                         tempo serve; sotto le 6 ripetizioni si lavora sul
 *                         sistema nervoso e li' i tre minuti non sono un lusso
 *
 * Il terzo e' un valore di uso comune e non una misura su di te — ed e' il
 * motivo per cui i primi due esistono: il recupero giusto lo sai tu.
 */
function recupeoConsigliato(ex, riga, sc) {
  if (riga?.recupero > 0) return riga.recupero;
  if (sc?.recupero > 0) return sc.recupero;
  if (!ex) return REC_DEFAULT.multi;
  const lo = (riga?.reps ?? ex.range?.[0]) || 8;
  if (ex.tipo === 'multi' && lo <= 6) return REC_DEFAULT.pesante;
  if (ex.tipo === 'multi') return REC_DEFAULT.multi;
  return REC_DEFAULT.isolamento;
}
/** Da dove viene il numero, per poterlo dire invece di farlo indovinare. */
function recupeoFonte(riga, sc) {
  if (riga?.recupero > 0) return 'esercizio';
  if (sc?.recupero > 0) return 'scheda';
  return 'auto';
}

/**
 * Il selettore del recupero: pastiglie, non un campo numerico.
 * Nessuno scrive "105 secondi"; si sceglie fra i cinque valori che si usano,
 * e "come dice l'app" resta il default perche' e' quello che serve a chi non
 * ha ancora un'opinione.
 */
function campoRecupero(valore, onCambia, etichetta, notaAuto) {
  const f = el('div', 'field', `<label>${etichetta || 'Recupero fra le serie'}</label>`);
  const seg = el('div', 'seg chips');
  const dipingi = () => [...seg.children].forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.v) === String(valore || 0)));
  const voci = [[0, 'Auto']].concat(REC_SCELTE.map(x => [x, recTesto(x)]));
  for (const [v, lab] of voci) {
    const b = el('button', null, lab);
    b.dataset.v = v;
    b.onclick = () => { valore = v; onCambia(v || 0); dipingi(); };
    seg.append(b);
  }
  f.append(seg); dipingi();
  if (notaAuto) f.append(el('div', 'hint', notaAuto));
  return f;
}

/* --------------------------------------------------------------- stato */
function recStato() {
  try { return JSON.parse(localStorage.getItem('dieta.rec') || 'null'); }
  catch { return null; }
}
function recScrivi(v) {
  try {
    if (v) localStorage.setItem('dieta.rec', JSON.stringify(v));
    else localStorage.removeItem('dieta.rec');
  } catch {}
}
const recRestanti = st => !st ? 0
  : Math.max(0, Math.round(st.sec - (Date.now() - st.t0) / 1000));

/* ---------------------------------------------------------------- suono */
let recAudio = null;
/**
 * Il contesto audio va creato dentro il tocco che avvia il timer: iOS non
 * lascia partire suoni che l'utente non ha chiesto, e un contesto creato al
 * caricamento della pagina nasce sospeso e resta muto per sempre.
 */
function recSbloccaAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    recAudio ||= new AC();
    if (recAudio.state === 'suspended') recAudio.resume();
  } catch {}
}
function recBip(n = 3) {
  if (!recAudio || recAudio.state !== 'running') return;
  const t0 = recAudio.currentTime;
  for (let i = 0; i < n; i++) {
    const o = recAudio.createOscillator(), g = recAudio.createGain();
    o.type = 'sine';
    o.frequency.value = i === n - 1 ? 990 : 660;
    // attacco e rilascio morbidi: un'onda quadra secca fa "click" e disturba
    g.gain.setValueAtTime(0, t0 + i * .26);
    g.gain.linearRampToValueAtTime(.22, t0 + i * .26 + .02);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + i * .26 + .2);
    o.connect(g); g.connect(recAudio.destination);
    o.start(t0 + i * .26); o.stop(t0 + i * .26 + .22);
  }
}

/* ----------------------------------------------------------------- barra */
let recTick = null;

/**
 * `tieni` = non sparire allo scadere.
 *
 * Il timer lanciato da un bottone e' un promemoria e dopo venti secondi si
 * toglie da solo. Quello di una seduta guidata no: li' il tempo oltre il
 * recupero e' un dato — se fra due serie sono passati quattro minuti invece di
 * due, quella e' un'altra seduta — quindi la barra resta, diventa rossa e
 * conta all'insu'. Sparisce quando parte la serie dopo, o quando la chiudi.
 */
function avviaRecupero(sec, etichetta, tieni) {
  recSbloccaAudio();
  recScrivi({ t0: Date.now(), sec: Math.round(sec), lab: etichetta || '',
              suonato: false, tieni: !!tieni });
  recBarra();
}
function fermaRecupero() {
  recScrivi(null);
  document.getElementById('recbar')?.remove();
  if (recTick) { clearInterval(recTick); recTick = null; }
}
/**
 * +30 / -30.
 *
 * A timer in corso vuol dire quello che sembra: allunga o accorcia il
 * recupero. A timer **gia' scaduto** no — e li' sommare trenta secondi a un
 * recupero finito da un minuto e mezzo non cambiava niente sullo schermo, che
 * e' il modo migliore di far credere che il bottone sia rotto. Chi lo tocca
 * in quel momento sta chiedendo trenta secondi ancora **da adesso**, quindi il
 * recupero riparte. E il "-30" a tempo scaduto non ha niente da accorciare:
 * il bottone e' li' spento invece di non fare nulla in silenzio.
 */
function spostaRecupero(d) {
  const st = recStato(); if (!st) return;
  if (recRestanti(st) === 0) {
    if (d <= 0) return;
    recScrivi({ t0: Date.now(), sec: Math.max(5, d), lab: st.lab,
                suonato: false, tieni: st.tieni });
    recDisegna();
    return;
  }
  st.sec = Math.max(5, st.sec + d);
  if (recRestanti(st) > 0) st.suonato = false;
  recScrivi(st);
  recDisegna();
}

/** Costruisce la barra se manca, poi la tiene aggiornata. */
function recBarra() {
  const st = recStato();
  if (!st) { fermaRecupero(); return; }
  let b = document.getElementById('recbar');
  if (!b) {
    b = document.createElement('div');
    b.id = 'recbar';
    b.innerHTML = `<div class="rec-fill"></div>
      <div class="rec-in">
        <button class="rec-b" data-d="-30">−30</button>
        <div class="rec-mid"><span class="rec-t">0:00</span><span class="rec-l"></span></div>
        <button class="rec-b" data-d="30">+30</button>
        <button class="rec-x" aria-label="chiudi">✕</button>
      </div>`;
    b.querySelectorAll('.rec-b').forEach(x =>
      x.onclick = () => spostaRecupero(+x.dataset.d));
    b.querySelector('.rec-x').onclick = fermaRecupero;
    document.body.append(b);
  }
  if (recTick) clearInterval(recTick);
  recTick = setInterval(recDisegna, 250);
  recDisegna();
}

const recOltre = st => !st ? 0
  : Math.max(0, Math.round((Date.now() - st.t0) / 1000 - st.sec));
/* Oltre un'ora quello non e' piu' un recupero, e' una barra dimenticata
   accesa. La soglia e' la stessa che usa recRiprendi(): due regole diverse
   per lo stesso stato erano una barra che spariva riaprendo l'app e restava
   tenendola aperta. */
const REC_OLTRE_MAX = 3600;

function recDisegna() {
  const st = recStato(), b = document.getElementById('recbar');
  if (!st || !b) { fermaRecupero(); return; }
  const r = recRestanti(st);
  const mmss = n => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  // oltre il recupero il numero non si ferma a 0:00 — riparte col segno piu',
  // che e' l'unica cosa che dice "stai perdendo tempo" senza scriverlo
  const oltre = r === 0 && st.tieni ? recOltre(st) : 0;
  if (oltre > REC_OLTRE_MAX) { fermaRecupero(); return; }
  b.querySelector('.rec-t').textContent = oltre ? '+' + mmss(oltre) : mmss(r);
  b.querySelector('.rec-l').textContent = st.lab || 'recupero';
  b.querySelector('.rec-fill').style.width = (100 * r / Math.max(1, st.sec)) + '%';
  b.classList.toggle('fatto', r === 0);
  b.classList.toggle('oltre', !!oltre);
  const meno = b.querySelector('.rec-b[data-d="-30"]');
  if (meno) meno.disabled = r === 0;
  /* Sotto un foglio aperto la barra non la vede nessuno, ed e' esattamente la
     situazione della seduta guidata: il foglio resta li' tutto il tempo. Con
     un foglio aperto la barra "tenuta" sale in cima e passa sopra. */
  b.classList.toggle('sopra', !!st.tieni && !document.getElementById('sheet')?.hidden);
  if (r === 0 && !st.suonato) {
    st.suonato = true; recScrivi(st);
    recBip();
    if (typeof pulsa === 'function') pulsa(b, { scala: 1.03, dur: 420 });
    // dopo venti secondi si toglie da sola: e' un promemoria, non un allarme.
    // Non pero' dentro una seduta guidata, dove il tempo oltre il recupero e'
    // un dato e la barra deve restare finche' non parte la serie dopo
    // La chiusura vale per QUESTO recupero: senza il confronto su t0, un
    // timer partito dieci secondi dopo si vedeva chiudere la barra sotto il
    // naso dal promemoria di quello prima
    if (!st.tieni) {
      const mio = st.t0;
      setTimeout(() => {
        const s2 = recStato();
        if (s2 && s2.suonato && s2.t0 === mio) fermaRecupero();
      }, 20000);
    }
  }
}

/** Alla ripresa dell'app la barra torna da sola, con il tempo giusto. */
function recRiprendi() {
  const st = recStato();
  // una barra "tenuta" torna anche a tempo scaduto: e' li' apposta per dire
  // da quanto sei fermo, e tornare dall'app in secondo piano non lo cancella
  if (st && (recRestanti(st) > 0 || (st.tieni && recOltre(st) < 3600))) recBarra();
  else if (st) recScrivi(null);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) recRiprendi();
});

/**
 * Il bottone da mettere accanto a una serie. Fa una cosa sola: far partire
 * il recupero giusto per quell'esercizio, senza chiedere niente.
 */
function bottoneRecupero(ex, riga, sc) {
  const sec = recupeoConsigliato(ex, riga, sc);
  const b = el('button', 'rec-go');
  b.type = 'button';
  b.textContent = `⏱ ${sec >= 60 ? Math.round(sec / 60 * 10) / 10 + '′' : sec + '″'}`;
  b.title = 'Avvia il recupero';
  b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    avviaRecupero(sec, ex?.nome || 'recupero');
  };
  return b;
}
