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

/**
 * Quanto recupero suggerire per una riga di scheda.
 * La logica e' quella che userebbe chiunque in sala: piu' l'esercizio muove
 * carico e articolazioni, piu' tempo serve. Sotto le 6 ripetizioni si sta
 * lavorando sul sistema nervoso, e li' i tre minuti non sono un lusso.
 */
function recupeoConsigliato(ex, riga) {
  if (!ex) return REC_DEFAULT.multi;
  const lo = (riga?.reps ?? ex.range?.[0]) || 8;
  if (ex.tipo === 'multi' && lo <= 6) return REC_DEFAULT.pesante;
  if (ex.tipo === 'multi') return REC_DEFAULT.multi;
  return REC_DEFAULT.isolamento;
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

function avviaRecupero(sec, etichetta) {
  recSbloccaAudio();
  recScrivi({ t0: Date.now(), sec: Math.round(sec), lab: etichetta || '', suonato: false });
  recBarra();
}
function fermaRecupero() {
  recScrivi(null);
  document.getElementById('recbar')?.remove();
  if (recTick) { clearInterval(recTick); recTick = null; }
}
function spostaRecupero(d) {
  const st = recStato(); if (!st) return;
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

function recDisegna() {
  const st = recStato(), b = document.getElementById('recbar');
  if (!st || !b) { fermaRecupero(); return; }
  const r = recRestanti(st);
  b.querySelector('.rec-t').textContent =
    Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0');
  b.querySelector('.rec-l').textContent = st.lab || 'recupero';
  b.querySelector('.rec-fill').style.width = (100 * r / Math.max(1, st.sec)) + '%';
  b.classList.toggle('fatto', r === 0);
  if (r === 0 && !st.suonato) {
    st.suonato = true; recScrivi(st);
    recBip();
    if (typeof pulsa === 'function') pulsa(b, { scala: 1.03, dur: 420 });
    // dopo venti secondi si toglie da sola: e' un promemoria, non un allarme
    setTimeout(() => { const s2 = recStato(); if (s2 && s2.suonato) fermaRecupero(); }, 20000);
  }
}

/** Alla ripresa dell'app la barra torna da sola, con il tempo giusto. */
function recRiprendi() {
  const st = recStato();
  if (st && recRestanti(st) > 0) recBarra();
  else if (st) recScrivi(null);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) recRiprendi();
});

/**
 * Il bottone da mettere accanto a una serie. Fa una cosa sola: far partire
 * il recupero giusto per quell'esercizio, senza chiedere niente.
 */
function bottoneRecupero(ex, riga) {
  const sec = recupeoConsigliato(ex, riga);
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
