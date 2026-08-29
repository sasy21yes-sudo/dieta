/* Il target che si ricalibra sul dispendio misurato.
 *
 * PERCHE' ESISTE. L'app aveva due meta' che non si parlavano. Da una parte un
 * filtro di Kalman che dopo qualche settimana di registro sa quanto consumi
 * meglio di qualsiasi formula — e' tutto il punto del motore di previsione.
 * Dall'altra D.target.kcal, un numero messo a mano una volta e mai piu'
 * toccato. Quella conoscenza finiva dentro un grafico e moriva li'.
 *
 * Qui si chiude l'anello, con tre regole che non vanno violate:
 *
 * 1. NON SI APPLICA DA SOLA. Cambiare di nascosto il metro con cui l'app
 *    giudica le giornate significa che un giorno "buono" diventa "storto"
 *    senza che tu abbia fatto niente di diverso. La proposta si accetta.
 * 2. LA CORREZIONE VIENE DALLA MATRICE, non da un'opinione nuova.
 *    regole_calorie in data/dieta.json e' gia' la decisione del piano su peso
 *    x vita x carichi, e l'analisi la applica gia': qui si aggiunge solo il
 *    bottone che la esegue.
 * 3. NIENTE DEFICIT DA FAME. Sotto il metabolismo a riposo per 1,1 non si
 *    scende, e oltre il 25% sotto il dispendio nemmeno — a quel punto il
 *    problema non e' piu' la ricomposizione.
 *
 * E come tutto il resto qui dentro: nessuna data di arrivo. Si sceglie un
 * RITMO, non una scadenza.
 */
'use strict';

/** I ritmi proponibili, in kg a settimana. */
const RITMI = [
  { id: 'giu05', kg: -0.5, n: 'Dimagrire',
    d: 'Circa mezzo chilo a settimana. Sostenibile se non dura per mesi.' },
  { id: 'giu025', kg: -0.25, n: 'Dimagrire piano',
    d: 'Un quarto di chilo. E\' il ritmo che protegge meglio la massa magra.' },
  { id: 'mant', kg: 0, n: 'Mantenere',
    d: 'Il peso resta dov\'e\'. Ricomporsi a peso fermo e\' lento ma reale.' },
  { id: 'su025', kg: 0.25, n: 'Crescere piano',
    d: 'Un quarto di chilo a settimana, quasi tutto utile se ti alleni.' }
];

/** Il ritmo vero delle ultime due settimane, dalla tendenza del peso. */
function ritmoAttuale(k = today()) {
  const a = trendW(k), b = trendW(addDays(k, -14));
  if (a == null || b == null) return null;
  const pesate = windowDays(k, 14).filter(x => S.log[x]?.peso != null).length;
  if (pesate < 8) return null;          // stessa soglia dell'analisi
  return (a - b) / 2;                   // kg a settimana
}

/**
 * Macro coerenti con un totale di calorie.
 * Le proteine restano ancorate al peso corporeo — sono la variabile che
 * protegge la massa magra e non vanno scalate insieme al resto — i grassi al
 * 25% delle calorie, i carboidrati prendono quello che avanza.
 */
function macroPerKcal(kcal) {
  const peso = lastWeight() ?? D.profilo.peso_iniziale_kg ?? 70;
  const pkg = D.target.p_per_kg || 2;
  const p = Math.round(peso * pkg);
  const g = Math.round(kcal * 0.25 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - g * 9) / 4));
  return { kcal: Math.round(kcal), p, c, g };
}

/** Il pavimento sotto cui una proposta non scende mai. */
function kcalMinime() {
  const peso = lastWeight() ?? D.profilo.peso_iniziale_kg ?? 70;
  const bmr = 10 * peso + 6.25 * (D.profilo.altezza_cm || 175)
    - 5 * (D.profilo.eta || 30) + (D.profilo.sesso === 'f' ? -161 : 5);
  return Math.round(bmr * 1.1);
}

/**
 * La proposta.
 *
 * Due strade, e la carta le tiene distinte perche' rispondono a due domande
 * diverse: "il piano sta funzionando?" (la matrice) e "il numero di partenza
 * era giusto?" (il dispendio misurato).
 */
function proponiTarget(k = today()) {
  const E = energyModel(k);
  const M = D.modello;
  const tdee = E.tdee, ora = D.target.kcal;
  const ritmo = ritmoAttuale(k);
  const minime = kcalMinime();

  /* --- strada 1: la matrice del piano, se i dati bastano --- */
  let regola = null;
  const ma = weightMA(k), maPrev = weightMA(addDays(k, -7));
  const pesate = windowDays(k, 14).filter(x => S.log[x]?.peso != null).length;
  if (ma && maPrev && pesate >= 8) {
    const rate = ma - maPrev;
    const vita = measTrend('vita', k);
    const vTrend = vita ? (vita.delta > 1 ? 'su' : vita.delta < -1 ? 'giu' : 'stabile') : 'stabile';
    const ct = typeof caricoTrend === 'function' ? caricoTrend(k) : { stato: null };
    const car = ct.stato || S.settings.carichi || 'fermi';
    const r = D.regole_calorie.find(x =>
      rate >= x.peso_kg_sett[0] && rate <= x.peso_kg_sett[1]
      && x.vita === vTrend && x.carichi === car);
    if (r) regola = { ...r, rate, vTrend, car, nuovo: ora + r.azione };
  }

  /* --- strada 2: dal dispendio misurato, scegliendo un ritmo --- */
  // 7700 kcal per chilo: e' la costante del modello, non un numero inventato
  const perKg = M.kcal_per_kg;
  const daRitmo = RITMI.map(r => {
    const grezzo = tdee + (r.kg * perKg) / 7;
    const kcal = Math.round(Math.max(minime, grezzo) / 10) * 10;
    return { ...r, kcal, tagliato: kcal > grezzo + 5 };
  });

  return {
    tdee, sigmaTdee: E.sigma, nCalibrazioni: E.n, daFormula: E.n === 0,
    ora, ritmo, minime, regola, daRitmo,
    // il dispendio e' credibile solo dopo qualche finestra: prima e' la formula
    affidabile: E.n >= 2,
    scarto: ora ? (tdee - ora) / ora : 0
  };
}

/** Scrive il nuovo target nel piano dell'utente. Non tocca il file di base. */
function applicaTarget(kcal, nota) {
  const m = macroPerKcal(kcal);
  const p = piano();
  p.target = { ...p.target, ...m };
  S.settings.targetStorico ||= [];
  S.settings.targetStorico.push({ k: today(), kcal: m.kcal, nota: nota || '' });
  S.model.rev = (S.model.rev || 0) + 1;
  save(); fondiPiano();
}

/* ========================================================== rampa fibre */
/**
 * Le fibre non si triplicano in una settimana.
 *
 * Il piano ne prevede 38 g e chi arriva da un'alimentazione normale sta fra i
 * 15 e i 20. Passare dagli uni agli altri di colpo non e' pericoloso, ma
 * produce una settimana di gonfiore e crampi che fa mollare un piano che per
 * il resto funzionava. Cinque grammi a settimana e' il passo che viene
 * comunemente consigliato, insieme all'acqua: le fibre senza acqua peggiorano
 * le cose invece di migliorarle, ed e' il motivo per cui la carta le nomina
 * tutte e due.
 */
function rampaFibre(k = today()) {
  const gg = windowDays(k, 14);
  const cons = gg.map(x => S.log[x] ? consumed(x) : null)
    .filter(m => m && m.kcal > 400);
  if (cons.length < 4) return null;
  const ora = avg(cons.map(m => m.fibre));
  const tgt = D.target.fibre;
  if (!(tgt > 0) || ora == null) return null;
  const salto = tgt - ora;
  if (salto <= 5) return null;                 // niente rampa da consigliare
  const passi = Math.ceil(salto / 5);
  const acqua = D.target.acqua_l;
  const acquaOra = avg(gg.map(x => S.log[x]?.acqua));
  return {
    ora, tgt, salto, passi, prossimo: Math.round(ora + 5),
    acqua, acquaOra, acquaBassa: acquaOra != null && acquaOra < acqua * 0.8
  };
}

/* =============================================================== carta */
function cardTarget(k = today()) {
  const t = proponiTarget(k);
  const c = el('div', 'card');
  c.append(el('div', 'eyebrow', 'Il target contro il dispendio misurato'));

  if (t.daFormula) {
    c.append(el('div', 'muted',
      'Il dispendio e\' ancora quello della formula di Mifflin-St Jeor: il motore '
      + 'non ha abbastanza storia per ricalibrarlo. Servono circa due settimane di '
      + 'pesate e di pasti registrati, poi questa scheda comincia a dire qualcosa '
      + 'che la formula non sa.'));
    return c;
  }

  const su = t.tdee > t.ora;
  c.append(el('div', 'read',
    `<span><b>${nf(t.tdee)}</b> kcal spesi</span>`
    + `<span>±${nf(t.sigmaTdee)}</span>`
    + `<span>target ${nf(t.ora)}</span>`
    + (t.ritmo != null ? `<span>${t.ritmo > 0 ? '+' : ''}${nf(t.ritmo, 2)} kg/sett</span>` : '')));
  c.append(el('div', 'muted',
    `Il motore ha ricalibrato il dispendio <strong>${t.nCalibrazioni} volte</strong> sui tuoi dati. `
    + (Math.abs(t.scarto) < .04
      ? 'Il target e\' praticamente sul dispendio: stai mangiando quanto consumi.'
      : `Il tuo target e\' <strong>${nf(Math.abs(t.tdee - t.ora))} kcal ${su ? 'sotto' : 'sopra'}</strong> `
        + `quello che spendi${t.ritmo != null
          ? `, ed e\' coerente con i ${nf(Math.abs(t.ritmo), 2)} kg a settimana che stai ${t.ritmo < 0 ? 'perdendo' : 'prendendo'}` : ''}.`)));

  /* --- la correzione della matrice, se c'e' --- */
  if (t.regola && t.regola.azione !== 0) {
    const box = el('div', 'tg-reg');
    box.innerHTML = `<span class="t">${esc(t.regola.esito)}</span>
      <span class="d">Peso ${t.regola.rate > 0 ? '+' : ''}${nf(t.regola.rate, 2)} kg a settimana,
      vita ${esc(t.regola.vTrend)}, carichi ${esc(t.regola.car)}. La matrice del piano
      per questa combinazione dice <strong>${t.regola.azione > 0 ? '+' : ''}${t.regola.azione} kcal</strong>.</span>`;
    const b = el('button', 'btn wide pri');
    b.style.marginTop = '10px';
    b.textContent = `Porta il target a ${nf(t.regola.nuovo)} kcal`;
    b.onclick = () => confermaTarget(t.regola.nuovo, t.regola.esito, t);
    box.append(b);
    c.append(box);
  } else if (t.regola) {
    c.append(el('div', 'hint',
      `<strong>${esc(t.regola.esito)}.</strong> Peso, vita e carichi si muovono insieme come devono: `
      + 'la matrice del piano dice di non toccare niente.'));
  }

  /* --- oppure: ripartire dal dispendio --- */
  c.append(el('div', 'eyebrow', 'Oppure ricalcolalo da qui'));
  c.append(el('p', 'muted',
    'Scegli un ritmo, non una data. Il target diventa il dispendio misurato piu\' o '
    + 'meno quello che serve a muoversi a quella velocita\'.'));
  for (const r of t.daRitmo) {
    const b = el('button', 'tg-r' + (Math.abs(r.kcal - t.ora) < 30 ? ' on' : ''));
    b.innerHTML = `<span class="k">${nf(r.kcal)}</span>
      <span class="body"><span class="t">${esc(r.n)}</span>
      <span class="d">${esc(r.d)}${r.tagliato
        ? ' <em>Alzato al minimo di sicurezza.</em>' : ''}</span></span>`;
    b.onclick = () => confermaTarget(r.kcal, r.n, t);
    c.append(b);
  }

  c.append(el('p', 'note',
    `Il pavimento e\' ${nf(t.minime)} kcal, cioe\' il tuo metabolismo a riposo per 1,1: `
    + 'sotto non si scende, perche\' li\' non stai piu\' ricomponendo, stai solo mangiando '
    + 'poco. E il dispendio stimato ha una sua incertezza: la proposta e\' un punto di '
    + 'partenza da verificare sulle prossime due settimane, non una misura.'));
  return c;
}

/** Conferma esplicita: cambiare il metro non e' una cosa che si fa di sfuggita. */
function confermaTarget(kcal, nota, t) {
  const m = macroPerKcal(kcal);
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Nuovo target'));
  w.append(el('h2', 'sec', nf(kcal) + ' kcal'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', esc(nota) + '.'));

  const tb = el('div', 'cmp');
  tb.append(el('div', 'cmp-h', '<span></span><span>Ora</span><span>Nuovo</span><span>Δ</span>'));
  for (const [lab, id, u] of [['Calorie', 'kcal', ''], ['Proteine', 'p', 'g'],
                              ['Carboidrati', 'c', 'g'], ['Grassi', 'g', 'g']]) {
    const a = D.target[id], b = m[id], d = b - a;
    tb.append(el('div', 'cmp-r',
      `<span>${lab}</span><span class="mono">${nf(a)}</span>
       <span class="mono">${nf(b)}</span>
       <span class="mono ${Math.abs(d) < 1 ? 'muted' : ''}">${d > 0 ? '+' : ''}${nf(d)} ${u}</span>`));
  }
  w.append(tb);
  w.append(el('p', 'hint',
    'Le proteine restano ancorate al tuo peso, non scalano con le calorie: sono la '
    + 'variabile che protegge la massa magra. I grassi stanno al 25%, i carboidrati '
    + 'prendono quello che avanza.'));
  w.append(el('p', 'note',
    'Cambia il metro con cui l\'app giudica le giornate: le barre di Oggi, l\'analisi, '
    + 'i consigli e la revisione settimanale useranno questo numero. I giorni gia\' '
    + 'registrati non cambiano.'));

  const ok = el('button', 'btn wide pri', 'Applica');
  ok.onclick = () => {
    applicaTarget(kcal, nota);
    closeSheet(); route();
    toast('Target aggiornato');
  };
  w.append(ok);
  const no = el('button', 'btn wide', 'Lascia com\'e\'');
  no.style.marginTop = '8px';
  no.onclick = () => { closeSheet(); };
  w.append(no);
  sheet(w);
}

/** La carta della rampa fibre: compare solo quando il salto e' vero. */
function cardRampaFibre(k = today()) {
  const r = rampaFibre(k);
  if (!r) return null;
  const c = el('div', 'card');
  c.append(el('div', 'eyebrow', 'Fibre: sali per gradini'));
  c.append(el('div', 'muted',
    `Ne mangi <strong>${nf(r.ora, 1)} g</strong> al giorno e il target ne chiede `
    + `<strong>${nf(r.tgt)}</strong>: sono ${nf(r.salto, 1)} g di salto. Farlo in un colpo `
    + 'non e\' pericoloso, ma produce una settimana di gonfiore e crampi che fa mollare '
    + 'un piano che per il resto funzionava.'));
  c.append(el('div', 'hint',
    `Punta a <strong>${r.prossimo} g</strong> questa settimana, poi altri cinque la `
    + `prossima. Da dove sei ci arrivi in circa ${r.passi} settimane.`));
  if (r.acquaBassa) c.append(el('div', 'hint acciacco',
    `<strong>E bevi.</strong> Sei a ${nf(r.acquaOra, 1)} L contro ${nf(r.acqua, 1)}: `
    + 'le fibre senza acqua peggiorano le cose invece di migliorarle.'));
  return c;
}
