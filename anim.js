/* Toolkit di animazione.
 *
 * Tre regole che valgono per tutto quello che c'e' qui dentro:
 *
 * 1. prefers-reduced-motion non e' un ripiego, e' la prima cosa da guardare.
 *    Circa una persona su tre naviga con le animazioni ridotte, per emicrania,
 *    vertigini o semplice preferenza. Quando e' attivo NON si anima: si salta
 *    direttamente allo stato finale, che resta sempre leggibile da solo.
 * 2. Si anima solo quello che entra in vista (IntersectionObserver), e una
 *    volta sola. Animare venti grafici tutti insieme al caricamento e' un modo
 *    sicuro di far scattare il telefono e di non far vedere niente.
 * 3. Si animano opacita' e transform, piu' stroke-dashoffset sugli SVG:
 *    sono le proprieta' che il browser compone sulla GPU. Animare width o top
 *    fa ricalcolare il layout a ogni fotogramma.
 */
'use strict';

/** L'utente vuole le animazioni? Si richiede ogni volta: puo' cambiare idea. */
function motionOk() {
  try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return true; }
}

/** Esegue fn quando l'elemento entra in vista, una volta sola. */
function osserva(elm, fn) {
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      fn(e.target);
    }
  }, { threshold: .18, rootMargin: '0px 0px -40px 0px' });
  io.observe(elm);
}

/* --------------------------------------------------------------- numeri */
/**
 * Conta da un valore all'altro.
 * Volutamente in JavaScript e non col trucco di @property + counter(): quello
 * e' elegantissimo ma sa contare solo interi grezzi, e qui i numeri vanno
 * formattati all'italiana (2.482, non 2482) e spesso con decimali.
 */
function testoNum(v, { dec = 0, suffisso = '', prefisso = '', segno = false } = {}) {
  return prefisso + (segno && v > 0 ? '+' : '') + nf(v, dec) + suffisso;
}
function contaSu(elm, a, opts = {}) {
  const { da = 0, dec = 0, dur = 900 } = opts;
  const scrivi = v => { elm.textContent = testoNum(v, opts); };
  if (!motionOk() || !isFinite(a)) { scrivi(a || 0); return; }
  const t0 = performance.now();
  const passo = now => {
    const t = Math.min(1, (now - t0) / dur);
    // easing "out expo": parte veloce e si posa, che e' come si legge un numero
    const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    scrivi(da + (a - da) * e);
    if (t < 1) requestAnimationFrame(passo);
  };
  scrivi(da);
  requestAnimationFrame(passo);
}

/* ----------------------------------------------------------------- SVG */
/**
 * Disegna un tracciato come se lo si stesse tirando con la penna.
 * Si misura la lunghezza vera del path, la si usa come trattino e si fa
 * scorrere l'offset da tutto a zero: e' la tecnica classica di Jake Archibald,
 * l'unica che funziona senza librerie.
 */
function disegnaPath(path, { dur = 1100, ritardo = 0 } = {}) {
  let len = 0;
  try { len = path.getTotalLength(); } catch { len = 0; }
  if (!len || !motionOk()) return;
  path.style.strokeDasharray = len;   // con offset 0 non si vede: e' una linea intera
  path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
    { duration: dur, delay: ritardo, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' });
}

/** Le barre crescono dal basso: si scala, non si cambia l'altezza. */
function cresciBarre(nodi, { dur = 620, passo = 26 } = {}) {
  if (!motionOk()) return;
  nodi.forEach((r, i) => {
    const y = +r.getAttribute('y'), h = +r.getAttribute('height');
    if (!isFinite(y) || !isFinite(h)) return;
    const base = y + h;                       // il piede della barra resta fermo
    r.animate([{ transform: `translateY(${h}px) scaleY(0)` }, { transform: 'none' }],
      { duration: dur, delay: i * passo, easing: 'cubic-bezier(.2,.7,.3,1)',
        fill: 'backwards' });
    r.style.transformOrigin = `0px ${base}px`;
  });
}

/** L'anello si riempie ruotando: si anima l'offset, non il dasharray. */
function anelloFermo(circle, quota) {
  const r = +circle.getAttribute('r');
  if (!r) return 0;
  const C = 2 * Math.PI * r;
  circle.setAttribute('stroke-dasharray', `${C} ${C}`);
  circle.setAttribute('stroke-dashoffset', C * (1 - Math.max(0, Math.min(1, quota))));
  return C;
}
function riempiAnello(circle, quota, { dur = 1000, ritardo = 120 } = {}) {
  const C = anelloFermo(circle, quota);
  if (!C || !motionOk()) return;
  circle.animate([{ strokeDashoffset: C }, { strokeDashoffset: C * (1 - quota) }],
    { duration: dur, delay: ritardo, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' });
}

/* --------------------------------------------------------------- blocchi */
/** Entrata scaglionata: ogni riga sale di poco e sfuma, sfalsata sulla precedente. */
function entrata(nodi, { passo = 55, dur = 420, su = 12 } = {}) {
  if (!motionOk()) return;
  nodi.forEach((n, i) => n.animate(
    [{ opacity: 0, transform: `translateY(${su}px)` }, { opacity: 1, transform: 'none' }],
    { duration: dur, delay: i * passo, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }));
}

/** Un colpo secco per dire "e' successo qualcosa": si usa con parsimonia. */
function pulsa(elm, { scala = 1.06, dur = 460 } = {}) {
  if (!motionOk()) return;
  elm.animate([{ transform: 'none' }, { transform: `scale(${scala})` }, { transform: 'none' }],
    { duration: dur, easing: 'cubic-bezier(.3,1.4,.5,1)' });
}

/**
 * Coriandoli per un traguardo. Nessuna libreria: sono dodici quadratini che
 * cadono ruotando e si tolgono da soli. Con reduced-motion non esistono
 * proprio — e' esattamente il tipo di movimento decorativo che va tolto.
 */
function coriandoli(host) {
  if (!motionOk()) return;
  const tinte = ['var(--pine)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--amber)'];
  const box = el('div', 'confetti');
  for (let i = 0; i < 14; i++) {
    const p = el('i');
    p.style.background = tinte[i % tinte.length];
    p.style.left = (6 + Math.random() * 88) + '%';
    box.append(p);
    p.animate([
      { transform: 'translateY(-10px) rotate(0deg)', opacity: 1 },
      { transform: `translateY(${90 + Math.random() * 70}px) rotate(${180 + Math.random() * 360}deg)`,
        opacity: 0 }
    ], { duration: 900 + Math.random() * 700, delay: Math.random() * 260,
         easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
  }
  host.append(box);
  setTimeout(() => box.remove(), 2200);
}

/**
 * Anima una carta di grafico quando entra in vista: linee disegnate, barre
 * che crescono, anelli che si riempiono. Si chiama una volta sulla carta e
 * pensa lei a trovare i pezzi.
 */
function animaCarta(carta) {
  osserva(carta, () => {
    const svg = carta.querySelector('svg');
    if (!svg) return;
    const linee = [...svg.querySelectorAll('path')]
      .filter(p => p.getAttribute('fill') === 'none' && p.getAttribute('stroke'));
    linee.forEach((p, i) => disegnaPath(p, { ritardo: i * 160 }));
    const barre = [...svg.querySelectorAll('rect')]
      .filter(r => r.getAttribute('fill') && r.getAttribute('fill') !== 'transparent');
    cresciBarre(barre);
    const punti = [...svg.querySelectorAll('circle')];
    if (punti.length && motionOk())
      punti.forEach((c, i) => c.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 300, delay: 420 + i * 12, fill: 'backwards' }));
  });
}
