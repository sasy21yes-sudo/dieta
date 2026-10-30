/* Il mese: basta, devo fare di piu', o altro?
 *
 * L'app sapeva gia' tutto quello che serve per rispondere — il ritmo vero del
 * peso, l'obiettivo scelto con il suo ritmo, cosa si e' mangiato, quanto ci si
 * e' allenati — e non lo metteva mai insieme. La previsione rispondeva a "cosa
 * succederebbe seguendo il piano", la revisione confrontava gli ingressi con i
 * target, e la domanda vera restava senza risposta: *sta funzionando?*
 *
 * Qui la risposta e' una, ed e' costruita in quest'ordine:
 *
 * 1. **il risultato**: il ritmo del peso misurato sulle pesate degli ultimi 28
 *    giorni, contro il ritmo dell'obiettivo. E' l'unico confronto che dice se
 *    basta. Accanto, vita e composizione in chili, che per una ricomposizione
 *    contano piu' della bilancia;
 * 2. **perche'**: quello che ci hai messo dentro — calorie, proteine, quanto
 *    hai registrato, forza, attivita';
 * 3. **una cosa da fare**, una sola. Cambiarne cinque insieme rende
 *    impossibile capire quale ha funzionato.
 *
 * Due regole di sempre: niente si applica da solo (la cosa da fare porta dove
 * si fa), e quando i dati non bastano lo si dice invece di inventare un
 * verdetto.
 */
'use strict';

const MESE_GG = 28;
/* Le linee guida OMS 2020 per gli adulti: 150-300 minuti a settimana di
   attivita' moderata, oppure 75-150 di intensa, e la forza almeno due giorni.
   Un minuto intenso vale due moderati: e' l'equivalenza che usano loro. */
const OMS_MIN = 150;
const OMS_FORZA = 2;
const MET_INTENSO = 6;

/** La regressione del peso sulle pesate della finestra, anomalie escluse. */
function ritmoPeso(k = today(), n = MESE_GG) {
  const pts = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(k, -i), w = S.log[d]?.peso;
    if (w == null) continue;
    if (typeof pesataAnomala === 'function' && pesataAnomala(d)) continue;
    pts.push({ x: n - 1 - i, y: w, k: d });
  }
  if (pts.length < 8) return { ok: false, n: pts.length, perche: 'poche pesate' };
  const span = pts[pts.length - 1].x - pts[0].x;
  if (span < 14) return { ok: false, n: pts.length, perche: 'pesate troppo ravvicinate' };
  const mx = avg(pts.map(p => p.x)), my = avg(pts.map(p => p.y));
  let sxx = 0, sxy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  const m = sxy / sxx;
  const res = pts.map(p => p.y - (my + m * (p.x - mx)));
  const sd = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / Math.max(1, pts.length - 2));
  return { ok: true, kgSett: m * 7, se: (sd / Math.sqrt(sxx)) * 7, n: pts.length, span,
           da: pts[0].k, a: pts[pts.length - 1].k };
}

/** L'ultima rilevazione di una misura fino a quel giorno. */
function misuraAl(id, k) {
  const gg = Object.keys(S.log).filter(d => d <= k && S.log[d]?.misure?.[id] != null).sort();
  if (!gg.length) return null;
  const d = gg[gg.length - 1];
  return { k: d, v: S.log[d].misure[id] };
}

/**
 * Di quanto si e' mossa una misura nell'ultimo mese.
 * Il confronto e' fra l'ultima rilevazione e quella di almeno tre settimane
 * prima — il metro si passa ogni due settimane, e due rilevazioni a sette
 * giorni dicono rumore — ma non oltre i due mesi, che sarebbe un'altra storia.
 */
function cambioMisura(id, k = today()) {
  const ult = misuraAl(id, k);
  if (!ult || ult.k < addDays(k, -MESE_GG)) return null;
  const pre = misuraAl(id, addDays(ult.k, -21));
  if (!pre || pre.k < addDays(ult.k, -60)) return { ora: ult.v, k: ult.k, delta: null };
  return { ora: ult.v, k: ult.k, da: pre.k, prima: pre.v, delta: ult.v - pre.v };
}

/** Peso, grasso, magra e grassa a una certa data, con le misure di allora. */
function composizioneAl(k) {
  const peso = trendW(k);
  if (peso == null) return null;
  const bia = typeof ultimaBia === 'function' ? ultimaBia(k) : null;
  const vita = misuraAl('vita', k), collo = misuraAl('collo', k), fi = misuraAl('fianchi', k);
  let bf = null, quando = null;
  if (bia?.fresca) { bf = bia.bf; quando = 'bia:' + bia.k; }
  else if (vita && collo && collo.v >= 32 && collo.v <= 48) {
    bf = bodyFat(vita.v, collo.v, D.profilo.altezza_cm, D.profilo.sesso, fi?.v);
    quando = 'vita:' + vita.k;
  }
  if (bf == null) return { peso };
  const fm = peso * bf / 100;
  return { peso, bf, fm, lbm: peso - fm, quando };
}

/**
 * Come si e' divisa la variazione di peso nel mese.
 * Vale solo se la composizione ha un dato **nuovo** fra le due date — un'altra
 * misura della vita o un'altra bioimpedenza. Con la stessa vita la percentuale
 * resta quella, e grassa e magra si sposterebbero in proporzione al peso: un
 * numero che sembra una misura e non lo e'.
 */
function cambioComposizione(k = today()) {
  const ora = composizioneAl(k), pri = composizioneAl(addDays(k, -MESE_GG));
  if (!ora || !pri || ora.bf == null || pri.bf == null) return null;
  if (ora.quando === pri.quando) return null;
  return { ora, prima: pri, dFm: ora.fm - pri.fm, dLbm: ora.lbm - pri.lbm, dBf: ora.bf - pri.bf };
}

/**
 * Attivita' su un elenco di giorni: minuti equivalenti (un minuto intenso ne
 * vale due) e giorni di forza. I pesi non entrano nei minuti: per l'OMS la
 * forza e' una raccomandazione a parte, e sommarli farebbe sembrare coperto il
 * cuore da chi fa solo panca.
 */
function attivitaGiorni(giorni) {
  let mod = 0, int = 0, forza = 0, sedute = 0;
  for (const d of giorni) {
    if (typeof serieDelGiorno === 'function' && serieDelGiorno(d).length) { forza++; sedute++; }
    if (typeof cardioDi === 'function') for (const c of cardioDi(d)) {
      const min = (c.durata_s || 0) / 60, met = cardioTipo(c.tipo).met || 0;
      if (met >= MET_INTENSO) int += min; else if (met >= 3) mod += min;
      sedute++;
    }
    const hs = S.hyrox?.sessioni?.[d];
    if (hs?.fatto) { int += hs.durata || 45; sedute++; }
  }
  return { mod, int, eq: mod + 2 * int, forza, sedute };
}

/** La settimana di calendario in corso, da lunedi' a oggi. */
function settimanaInCorso(k = today()) {
  const out = [];
  for (let i = dayIdx(k); i >= 0; i--) out.push(addDays(k, -i));
  return out;
}

/** Calorie, proteine e registro sui giorni chiusi della finestra. */
function ingressiMese(k = today()) {
  const giorni = lastDays(addDays(k, -1), MESE_GG);
  let n = 0, kcal = 0, p = 0, tk = 0, tp = 0;
  for (const d of giorni) {
    const c = consumed(d);
    if (!(c.kcal > 0)) continue;
    const t = dayTarget(d);
    n++; kcal += c.kcal; p += c.p; tk += t.kcal || 0; tp += t.p || 0;
  }
  if (!n) return { n: 0, giorni: giorni.length };
  return { n, giorni: giorni.length, kcal: kcal / n, p: p / n,
           tKcal: tk / n, tP: tp / n,
           rKcal: tk ? kcal / tk : null, rP: tp ? p / tp : null };
}

/* Le parole del verdetto: titolo, colore, e la riga sotto. */
const MESE_STATI = {
  linea:   { t: 'In linea', cls: 'ok' },
  lento:   { t: 'Troppo lento', cls: 'warn' },
  veloce:  { t: 'Troppo veloce', cls: 'warn' },
  opposto: { t: 'Nella direzione sbagliata', cls: 'bad' },
  giu:     { t: 'Stai perdendo peso', cls: 'warn' },
  su:      { t: 'Stai prendendo peso', cls: 'warn' },
  incerto: { t: 'Non ancora chiaro', cls: 'mute' },
  dati:    { t: 'Servono piu\' pesate', cls: 'mute' },
  libero:  { t: 'Scegli un obiettivo', cls: 'mute' }
};

/**
 * Il giudizio sul mese.
 *
 * Le fasce sono larghe di proposito: con un obiettivo di −0,35 kg a settimana
 * "in linea" va da −0,18 a −0,53. Il peso di tendenza ha un rumore vero, e
 * fasce strette farebbero cambiare verdetto ogni due giorni.
 */
function giudizioMese(k = today()) {
  const R = ritmoPeso(k), ob = typeof obiettivoAttivo === 'function' ? obiettivoAttivo() : null;
  const w = trendW(k);
  const I = ingressiMese(k);
  const A = attivitaGiorni(lastDays(k, MESE_GG));
  const sett = MESE_GG / 7;
  const att = { eqSett: A.eq / sett, forzaSett: A.forza / sett, sedute: A.sedute };
  const vita = cambioMisura('vita', k);
  const comp = cambioComposizione(k);
  const base = { R, ob, w, I, att, vita, comp };

  if (!R.ok) return { ...base, stato: 'dati', azione: azioneMese('dati', base) };
  if (!ob) return { ...base, stato: 'libero', azione: azioneMese('libero', base) };

  const obSett = ob.pct * w;                    // kg a settimana, col segno
  const r = R.kgSett, ci = 1.96 * R.se;
  let stato;
  if (ob.pct < 0 || ob.pct > 0) {
    const s = Math.sign(ob.pct), rr = r * s, oo = Math.abs(obSett);
    if (ci > oo) stato = 'incerto';
    else if (rr <= -0.05) stato = 'opposto';
    else if (rr < 0.5 * oo) stato = 'lento';
    else if (rr > 1.5 * oo) stato = 'veloce';
    else stato = 'linea';
  } else {
    const fascia = Math.max(0.07, 0.0015 * w);
    if (ci > 2 * fascia) stato = 'incerto';
    else if (r < -fascia) stato = 'giu';
    else if (r > fascia) stato = 'su';
    else stato = 'linea';
  }
  const g = { ...base, stato, obSett };
  g.azione = azioneMese(stato, g);
  return g;
}

/**
 * La cosa da fare, una sola, e dove si fa.
 *
 * L'ordine delle domande e' quello che evita il consiglio sbagliato: prima se
 * i dati bastano, poi se il piano e' stato seguito — abbassare il target a chi
 * non lo sta centrando vorrebbe dire correggere il metro invece del gesto — e
 * solo alla fine se il piano va cambiato. Mai saltare pasti, mai compensare:
 * il passo e' sempre di circa 150 kcal al giorno, cioe' una delle leve del
 * piano, e si decide altrove.
 */
function azioneMese(stato, g) {
  const target = { bt: 'Apri “Quanto mangiare”',
    go: () => { if (typeof pianoTab !== 'undefined') pianoTab = 'target'; apri('#/piano'); } };
  const gym = { bt: 'Apri Gym', go: () => apri('#/palestra') };
  const I = g.I, att = g.att;
  const poco = I.n < I.giorni / 2;
  if (stato === 'dati') return {
    t: 'Pesati almeno quattro mattine a settimana',
    d: `Negli ultimi ${MESE_GG} giorni ci sono ${g.R.n} pesate utili. Ne servono almeno otto, `
      + 'distribuite su due settimane, per distinguere un ritmo dall\'oscillazione dell\'acqua.' };
  if (stato === 'libero') return {
    t: 'Scegli cosa stai cercando di fare',
    d: 'Perdere grasso, ricomporsi, mantenere o crescere: senza un obiettivo il ritmo si vede, '
      + 'ma non si puo\' dire se basta.', ...target };
  if (stato === 'incerto') return {
    t: 'Continua cosi\' ancora una o due settimane',
    d: 'Le pesate oscillano piu\' di quanto il peso si sia mosso: per ora il ritmo non si '
      + 'distingue dal rumore. Pesarsi ogni mattina lo rende chiaro prima.' };
  if (poco) return {
    t: 'Registra quello che mangi',
    d: `Hai registrato ${I.n} giorni su ${I.giorni}. Prima di cambiare il piano serve sapere se `
      + 'lo stai seguendo: con meta\' delle giornate vuote non si puo\' dire.' };

  const sopra = I.rKcal != null && I.rKcal > 1.05, sotto = I.rKcal != null && I.rKcal < 0.95;
  const dk = I.tKcal != null ? Math.round(I.kcal - I.tKcal) : 0;
  const proteBasse = I.rP != null && I.rP < 0.9;
  const proteRiga = proteBasse
    ? `Le proteine sono a ${nf(I.p)} g contro ${nf(I.tP)}: portarle al target protegge la massa magra.`
    : null;
  const cut = g.ob.pct < 0, bulk = g.ob.pct > 0;

  if ((cut && (stato === 'lento' || stato === 'opposto')) || (!cut && !bulk && stato === 'su')) {
    if (sopra) return { t: 'Torna al target, prima di abbassarlo',
      d: `In media hai mangiato ${nf(dk)} kcal al giorno sopra il target. Centrarlo e\' gia\' la `
        + 'correzione: abbassare il numero non serve se non lo si sta seguendo.' };
    if (att.eqSett < OMS_MIN) return { t: 'Aggiungi un po\' di movimento, oppure 150 kcal in meno',
      d: `Il target lo stai seguendo. Fai ${nf(att.eqSett)} minuti di attivita\' a settimana, sotto i `
        + `${OMS_MIN} delle linee guida: due camminate veloci da mezz'ora, o circa 150 kcal in meno `
        + 'al giorno, spostano il ritmo verso l\'obiettivo.', ...target };
    return { t: 'Abbassa il target di circa 150 kcal',
      d: 'Il target lo stai seguendo e ti muovi abbastanza: il dispendio vero e\' piu\' basso di '
        + 'quanto il piano supponeva. Un passo da 150 kcal al giorno, poi si riguarda fra un mese.',
      ...target };
  }
  if (cut && stato === 'veloce') return {
    t: 'Rallenta: circa 150 kcal in piu\' al giorno',
    d: (sotto ? `Stai mangiando ${nf(-dk)} kcal sotto il target. ` : '')
      + 'Scendere piu\' in fretta del ritmo scelto costa massa magra ed e\' difficile da reggere.'
      + (proteRiga ? ' ' + proteRiga : ''), ...target };
  if ((bulk && (stato === 'lento' || stato === 'opposto')) || (!cut && !bulk && stato === 'giu')) {
    if (sotto) return { t: 'Arriva al target, prima di alzarlo',
      d: `In media hai mangiato ${nf(-dk)} kcal al giorno sotto il target: centrarlo e\' gia\' la correzione.` };
    return { t: 'Alza il target di circa 150 kcal',
      d: 'Il target lo stai seguendo e il peso non sale quanto serve: il dispendio e\' piu\' alto '
        + 'di quanto il piano supponeva.', ...target };
  }
  if (bulk && stato === 'veloce') return {
    t: 'Rallenta: circa 150 kcal in meno al giorno',
    d: 'Salire piu\' in fretta del ritmo scelto aggiunge soprattutto grasso.', ...target };

  // in linea: la cosa da fare e' non cambiare niente, salvo un buco evidente
  if (proteBasse) return { t: 'Il ritmo va bene: alza le proteine', d: proteRiga };
  if (att.forzaSett < OMS_FORZA) return {
    t: 'Il ritmo va bene: aggiungi la forza',
    d: `${nf(att.forzaSett, 1)} giorni di pesi a settimana: con almeno ${OMS_FORZA} quello che `
      + 'perdi o prendi e\' piu\' grasso e meno muscolo.', ...gym };
  if (g.ob.id === 'ricomp' && g.vita?.delta != null && g.vita.delta > 0.5) return {
    t: 'Peso fermo, ma la vita sale',
    d: 'In una ricomposizione la bilancia resta ferma e la vita scende. Se sale, conviene un '
      + 'piccolo deficit: circa 150 kcal in meno.', ...target };
  return { t: 'Non cambiare niente', d: 'Il ritmo e\' quello che hai scelto. Riguarda fra un mese.' };
}

/* ================================================================ la carta */

/** Il ritmo scritto per un umano: "−0,17 kg a settimana". */
function ritmoTesto(x) {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${nf(Math.abs(x), 2)} kg`;
}

/** Una riga dell'elenco "cosa ci hai messo": nome, valore, metro, e se va. */
function rigaIngresso(lab, val, metro, stato) {
  return `<div class="ms-r"><span class="l">${lab}</span>`
    + `<span class="v">${val}</span><span class="m">${metro}</span>`
    + `<span class="s ${stato}">${stato === 'ok' ? '✓' : stato === 'warn' ? '!' : '–'}</span></div>`;
}

function cardMese(k = today()) {
  const g = giudizioMese(k), S0 = MESE_STATI[g.stato];
  const c = el('div', 'card mese');
  c.append(el('div', 'eyebrow', `Ultimi ${MESE_GG} giorni`));
  c.append(el('div', 'ms-ver ' + S0.cls, `<span class="dot"></span><b>${S0.t}</b>`));

  /* --- il risultato: tre riquadri, e i chili sono chili --- */
  const T = el('div', 'ms-tiles');
  const tile = (et, v, sub, cls = '') =>
    `<div class="ms-t ${cls}"><span class="et">${et}</span><span class="v">${v}</span>`
    + `<span class="sub">${sub}</span></div>`;
  let h = '';
  const segno = x => x > 0 ? '+' : x < 0 ? '−' : '';
  if (g.R.ok) h += tile('Peso',
    `${segno(g.R.kgSett)}${nf(Math.abs(g.R.kgSett), 2)}<em>kg</em>`,
    'a settimana' + (g.obSett != null ? `, obiettivo ${ritmoTesto(g.obSett)}` : ''));
  else h += tile('Peso', '–', `${g.R.n} pesate su 8`);
  if (g.vita?.delta != null) h += tile('Vita', `${g.vita.delta > 0 ? '+' : g.vita.delta < 0 ? '−' : ''}${nf(Math.abs(g.vita.delta), 1)}<em>cm</em>`,
    `${nf(g.vita.ora, 1)} cm adesso`);
  else h += tile('Vita', g.vita ? `${nf(g.vita.ora, 1)}<em>cm</em>` : '–',
    g.vita ? 'manca una misura di un mese fa' : 'nessuna misura recente');
  if (g.comp) h += tile('Grasso', `${g.comp.dFm > 0 ? '+' : '−'}${nf(Math.abs(g.comp.dFm), 1)}<em>kg</em>`,
    `magra ${g.comp.dLbm > 0 ? '+' : '−'}${nf(Math.abs(g.comp.dLbm), 1)} kg`);
  else h += tile('Grasso', '–', 'serve una misura nuova della vita');
  T.innerHTML = h;
  c.append(T);

  /* --- la cosa da fare --- */
  const a = g.azione;
  const box = el('div', 'ms-fai');
  box.innerHTML = `<span class="et">La cosa da fare</span><b>${esc(a.t)}</b>`
    + (a.d ? `<p>${esc(a.d)}</p>` : '');
  // la cosa da fare porta dove si fa, e non la fa: niente si applica da solo
  if (a.go) {
    const b = el('button', 'btn wide');
    b.textContent = a.bt;
    b.onclick = a.go;
    box.append(b);
  }
  c.append(box);

  /* --- perche': cosa ci hai messo --- */
  const I = g.I, at = g.att;
  const st = (r, lo = 0.95, hi = 1.05) => r == null ? 'mute' : r >= lo && r <= hi ? 'ok' : 'warn';
  let rr = '';
  rr += rigaIngresso('Registro', `${I.n}/${I.giorni}`, 'giorni', I.n >= I.giorni * 0.75 ? 'ok' : I.n >= I.giorni / 2 ? 'mute' : 'warn');
  if (I.n) {
    rr += rigaIngresso('Calorie', nf(I.kcal), `/ ${nf(I.tKcal)} kcal`, st(I.rKcal));
    rr += rigaIngresso('Proteine', nf(I.p), `/ ${nf(I.tP)} g`, I.rP == null ? 'mute' : I.rP >= 0.9 ? 'ok' : 'warn');
  }
  rr += rigaIngresso('Forza', nf(at.forzaSett, 1), `/ ${OMS_FORZA} giorni a sett.`, at.forzaSett >= OMS_FORZA ? 'ok' : 'warn');
  rr += rigaIngresso('Attività', nf(at.eqSett), `/ ${OMS_MIN} min a sett.`, at.eqSett >= OMS_MIN ? 'ok' : 'warn');
  const det = el('div', 'ms-in');
  det.innerHTML = `<span class="et">Cosa ci hai messo</span>${rr}`;
  c.append(det);

  c.append(el('p', 'note',
    'Il ritmo del peso e\' la retta sulle pesate del mese, non due pesate agli estremi. '
    + 'Calorie e proteine sono la media dei giorni registrati fino a ieri. I minuti di attività '
    + 'contano doppi quando l\'attività e\' intensa (corsa, BJJ, nuoto), come fanno le '
    + 'linee guida OMS; i pesi contano a parte, come giorni di forza.'));
  return c;
}

/** La versione corta, in cima a Corpo: il verdetto e una riga, e porta al mese. */
function cardMeseCorta(k = today()) {
  const g = giudizioMese(k), S0 = MESE_STATI[g.stato];
  const b = el('button', 'card mese corta');
  const riga = g.R.ok
    ? `${ritmoTesto(g.R.kgSett)} a settimana` + (g.obSett != null ? ` · obiettivo ${ritmoTesto(g.obSett)}` : '')
    : `${g.R.n} pesate utili nell'ultimo mese`;
  b.innerHTML = `<span class="eyebrow">Il mese</span>`
    + `<span class="ms-ver ${S0.cls}"><span class="dot"></span><b>${S0.t}</b></span>`
    + `<span class="ms-riga">${riga}</span>`
    + `<span class="ms-fai-c">${esc(g.azione.t)}</span><span class="go">›</span>`;
  b.onclick = () => { andTab = 'mese'; apri('#/andamento'); };
  return b;
}

/** Gli anelli della settimana in Gym: attività e forza, come Fitness. */
function cardAnelliSettimana(k = today()) {
  const gg = settimanaInCorso(k), A = attivitaGiorni(gg);
  const qa = A.eq / OMS_MIN, qf = A.forza / OMS_FORZA;
  const c = el('div', 'card anelli');
  const svg = `<svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="tr a" cx="60" cy="60" r="50" fill="none" stroke-width="14"></circle>
      <circle class="ar a" cx="60" cy="60" r="50" fill="none" stroke-width="14" stroke-linecap="round"></circle>
      <circle class="tr f" cx="60" cy="60" r="33" fill="none" stroke-width="14"></circle>
      <circle class="ar f" cx="60" cy="60" r="33" fill="none" stroke-width="14" stroke-linecap="round"></circle>
    </svg>`;
  const ring = el('div', 'an-r', svg);
  c.append(ring);
  const t = el('div', 'an-t');
  t.innerHTML = `<span class="eyebrow">Questa settimana</span>
    <div class="an-l a"><i></i><span class="n">Attività</span>
      <span class="v">${nf(A.eq)}<em>/${OMS_MIN} min</em></span></div>
    <div class="an-l f"><i></i><span class="n">Forza</span>
      <span class="v">${A.forza}<em>/${OMS_FORZA} giorni</em></span></div>
    <span class="an-s">${A.int ? `${nf(A.int)} min intensi contano doppio` : 'cardio e sport, non i pesi'}</span>`;
  c.append(t);
  const [aA, aF] = [ring.querySelector('.ar.a'), ring.querySelector('.ar.f')];
  // pieni al valore giusto prima di qualunque animazione
  if (typeof anelloFermo === 'function') { anelloFermo(aA, Math.min(qa, 1)); anelloFermo(aF, Math.min(qf, 1)); }
  if (typeof osserva === 'function' && typeof riempiAnello === 'function')
    osserva(ring, () => { riempiAnello(aA, Math.min(qa, 1)); riempiAnello(aF, Math.min(qf, 1), { ritardo: 260 }); });
  return c;
}
