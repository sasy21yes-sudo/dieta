/* Dove stai andando: le proiezioni che non riguardano il peso.
 *
 * REGOLA CHE VALE PER TUTTE, e che viene dal motore del peso: si proietta la
 * TENDENZA a un orizzonte fisso con una banda, mai una data di arrivo. "Il
 * target lo raggiungi il 14 marzo" e' un conto alla rovescia travestito da
 * previsione: presuppone che il ritmo di oggi valga per mesi, cosa che non
 * succede mai, e trasforma un dato in una scadenza da mancare.
 *
 * Quello che si puo' dire onestamente e': al ritmo delle ultime settimane,
 * fra quattro settimane sarai in questo intervallo — e il target ci sta
 * dentro oppure no.
 *
 * Tutte usano la stessa macchina: retta ai minimi quadrati sui dati veri,
 * banda dai residui, e R2 mostrato perche' una retta si puo' tirare anche
 * dentro una nuvola di punti che non dice niente. Non c'e' un filtro di
 * Kalman come sul peso: li' le osservazioni sono quotidiane e il rumore
 * enorme, qui sono poche e distanti, ed e' lo stesso motivo per cui la
 * proiezione della forza in palestra usa una retta.
 */
'use strict';

const ORIZZONTE = 28;

/** Le rilevazioni di una misura, in ordine. */
function serieMisura(id) {
  return Object.keys(S.log).filter(k => S.log[k]?.misure?.[id] != null).sort()
    .map(k => ({ k, v: S.log[k].misure[id] }));
}

/**
 * Proiezione di una circonferenza.
 * Servono almeno tre rilevazioni su almeno due settimane: con due punti la
 * retta passa esatta e la banda sarebbe zero, cioe' una finta certezza.
 */
function proiezioneMisura(id, orizzonte = ORIZZONTE) {
  const serie = serieMisura(id);
  if (serie.length < 3) return { id, serie, perche: 'servono almeno tre rilevazioni' };
  const t0 = new Date(serie[0].k);
  const giorni = s => (new Date(s.k) - t0) / 864e5;
  const span = giorni(serie[serie.length - 1]);
  if (span < 14) return { id, serie, perche: 'servono almeno due settimane fra la prima e l\'ultima' };
  const R = regressione(serie.map(s => ({ x: giorni(s), y: s.v })));
  if (!R) return { id, serie, perche: 'le rilevazioni sono tutte nello stesso giorno' };
  const fra = R.m * (span + orizzonte) + R.q;
  // una misura che non si e' mai mossa non ha varianza da spiegare: li' R2
  // vale zero per costruzione, e mostrarlo come "la retta non spiega niente"
  // sarebbe il contrario di cio' che e' successo
  const piatta = serie.every(x => x.v === serie[0].v);
  return {
    id, serie, ok: true, orizzonte,
    ora: serie[serie.length - 1].v,
    fra, cmSettimana: R.m * 7, r2: R.r2, n: R.n, piatta,
    /* Banda di predizione: rumore dei residui piu' l'incertezza della retta.
       Con il pavimento a mezzo centimetro, che e' la risoluzione vera con cui
       si legge un metro da sarto: qualche punto quasi allineato fa collassare
       i residui a zero, e una forbice di +/- 0,0 cm sarebbe una precisione che
       nessuno possiede. */
    banda: Math.max(0.5, 1.96 * R.sd * Math.sqrt(1 + 1 / R.n)),
    span
  };
}

/**
 * Composizione fra quattro settimane.
 *
 * E' una stima costruita su altre due stime — il peso previsto e la vita
 * prevista — e passata dentro una formula che gia' sbaglia di tre o quattro
 * punti. Non e' un motivo per non mostrarla: e' un motivo per dire ogni volta
 * che serve a vedere la DIREZIONE, cioe' se il grasso scende mentre la massa
 * magra tiene, e non il numero.
 */
function proiezioneComposizione(orizzonte = ORIZZONTE, k = today()) {
  const oggi = composition(k);
  if (oggi.bf == null) return { perche: 'manca il calcolo della composizione di oggi' };
  /* Il peso fra un mese e' quello del ritmo vero, non del piano: e' lo stesso
     errore che faceva il titolo della previsione, che diceva "fermo" con le
     pesate in discesa. Prima la retta sulle pesate del mese, poi il modello
     con quello che mangi davvero, e il piano solo se non c'e' altro. */
  const fp = forecast(orizzonte, realIntake(k) ?? D.target.kcal, k);
  const R = typeof ritmoPeso === 'function' ? ritmoPeso(k) : { ok: false };
  const pv = proiezioneMisura('vita', orizzonte);
  if (!fp || !pv.ok) return { perche: 'servono piu\' pesate e almeno tre misure della vita', oggi };

  const p = D.profilo;
  const vita = pv.fra, peso = R.ok ? fp.base + R.kgSett * orizzonte / 7 : fp.peso;
  const collo = lastMeas('collo'), fianchi = lastMeas('fianchi');
  // bodyFat(vita, collo, altezza, sesso, fianchi): posizionale, e sui profili
  // femminili pretende anche i fianchi
  const bf = bodyFat(vita, collo, p.altezza_cm, p.sesso, fianchi);
  if (bf == null) return { perche: 'il collo non e\' registrato, e senza non si calcola', oggi };
  const lbm = peso * (1 - bf / 100), fm = peso - lbm;
  return {
    ok: true, orizzonte, oggi,
    peso, vita, bf, lbm, fm,
    dPeso: peso - oggi.peso, dBf: bf - oggi.bf,
    dLbm: oggi.lbm != null ? lbm - oggi.lbm : null,
    dFm: oggi.fm != null ? fm - oggi.fm : null,
    bandaPeso: fp.banda, bandaVita: pv.banda
  };
}

/** Gli esercizi con abbastanza storia, dal piu' documentato. */
function proiezioniForza(orizzonte = ORIZZONTE, quanti = 5) {
  if (typeof previsioneForza !== 'function') return [];
  return catalogo().map(e => {
    const p = previsioneForza(e.id, orizzonte);
    return p ? { ...p, id: e.id, nome: e.nome } : null;
  }).filter(Boolean).sort((a, b) => b.n - a.n).slice(0, quanti);
}

/* ============================================== quanto manca, in tempo
 *
 * Per molto tempo qui non c'e' stato niente del genere, e la regola era netta:
 * niente date di arrivo. La ragione non era filosofica, era aritmetica — il
 * tempo e' distanza diviso ritmo, e quando il ritmo si avvicina a zero
 * l'errore relativo esplode. Un contatore che dice "fra 15 mesi" mentre
 * l'intervallo vero va da sette mesi a MAI non e' una previsione, e' una
 * rassicurazione inventata.
 *
 * Ma il conto, fatto per bene, non e' sempre inutile: propagando la banda che
 * il motore gia' calcola si vede che con un ritmo netto l'intervallo e'
 * stretto — 66-102 giorni su un punto di 80 — e li' il numero vale.
 *
 * Quindi non un contatore, ma una risposta che sa in quale dei quattro casi
 * si trova e si rifiuta quando deve:
 *
 *   ci sei             — la differenza e' dentro la forbice
 *   stretto            — "fra 2 e 3 mesi"
 *   largo              — "fra 4 mesi e un anno", detto con l'avvertenza
 *   indistinguibile    — il ritmo non e' diverso da zero: non si dice niente
 *   lontano            — ti stai muovendo dall'altra parte
 *
 * E non e' un conto alla rovescia: si ricalcola ogni volta sul ritmo di
 * adesso, quindi puo' anche allungarsi. Un conto alla rovescia scende e
 * basta, e diventa una scadenza da mancare.
 */
function tempoAlTarget(p, target) {
  if (target == null || !p || !p.ok) return null;
  const dist = target - p.ora;
  const oriz = p.orizzonte;

  // se il target e' gia' dentro la forbice della proiezione, ci sei
  if (Math.abs(dist) <= p.banda) return { stato: 'ci-sei' };

  /* Il ritmo e i suoi estremi, ricavati dalla banda a fine orizzonte: sono
     gli stessi numeri che la scheda mostra gia', non un secondo calcolo che
     un giorno direbbe qualcosa di diverso. */
  const r = (p.fra - p.ora) / oriz;
  const rA = ((p.fra - p.banda) - p.ora) / oriz;
  const rB = ((p.fra + p.banda) - p.ora) / oriz;
  const lo = Math.min(rA, rB), hi = Math.max(rA, rB);

  const verso = Math.sign(dist);
  // entrambi gli estremi vanno dalla parte sbagliata: ti stai allontanando
  if (Math.sign(lo) === -verso && Math.sign(hi) === -verso)
    return { stato: 'lontano', ritmo: r };
  // gli estremi stanno a cavallo dello zero: "mai" e' dentro l'intervallo
  if (Math.sign(lo) !== Math.sign(hi) || lo === 0 || hi === 0)
    return { stato: 'incerto', ritmo: r };

  const utili = [lo, hi].filter(x => Math.sign(x) === verso).map(x => dist / x);
  const tLo = Math.min(...utili), tHi = Math.max(...utili);
  if (!isFinite(tLo) || tLo <= 0) return { stato: 'incerto', ritmo: r };
  return {
    stato: tHi > tLo * 2.2 ? 'largo' : 'stretto',
    giorniLo: tLo, giorniHi: tHi, punto: dist / r, ritmo: r
  };
}

/** Giorni in una durata leggibile: sotto i due mesi in giorni, poi in mesi. */
function durata(g) {
  if (g < 14) return Math.round(g) + ' giorni';
  if (g < 70) return Math.round(g / 7) + ' settimane';
  if (g < 730) return Math.round(g / 30.4) + ' mesi';
  return nf(g / 365, 1) + ' anni';
}

/**
 * Un intervallo di tempo, con l'unita' detta una volta sola.
 * "fra 5 mesi e 8 mesi" e' scritto male: l'unita' va in fondo, e si sceglie
 * quella che rende leggibile l'estremo piu' grande.
 */
function intervalloDurata(lo, hi) {
  const U = [[14, 1, 'giorni'], [70, 7, 'settimane'], [730, 30.4, 'mesi'], [Infinity, 365, 'anni']];
  const [, div, nome] = U.find(u => hi < u[0]) || U[3];
  const dec = div >= 365 ? 1 : 0;
  const a = nf(lo / div, dec), b = nf(hi / div, dec);
  return a === b ? `circa ${b} ${nome}` : `fra ${a} e ${b} ${nome}`;
}

/** La frase da mettere sotto il grafico, o null se non c'e' niente da dire. */
function frasiTempo(t, nome) {
  if (!t) return null;
  if (t.stato === 'ci-sei')
    return { t: 'Ci sei', d: `${nome} e' dentro la forbice del target. Non c'e' un tempo `
      + 'da aspettare: c\'e\' da restarci.' };
  if (t.stato === 'lontano')
    return { t: 'Ti stai allontanando', d: 'Al ritmo delle ultime settimane la distanza dal '
      + 'target cresce invece di scendere. Non e\' un giudizio sulla settimana: e\' la '
      + 'direzione della retta, e una retta si raddrizza.' };
  if (t.stato === 'incerto')
    return { t: 'Troppo presto per dirlo', d: 'Il ritmo attuale non e\' abbastanza diverso '
      + 'da zero: dentro la forbice ci sta anche "non ci arrivi". Qualsiasi numero '
      + 'metterei qui sarebbe inventato. Servono altre rilevazioni.' };
  const R = intervalloDurata(t.giorniLo, t.giorniHi);
  if (t.stato === 'largo')
    return { t: 'A questo ritmo, ' + R,
      d: 'L\'intervallo e\' largo perche\' il ritmo varia parecchio: il numero da tenere '
       + 'e\' quello alto, non quello basso. Si stringe da solo man mano che registri.' };
  return { t: 'A questo ritmo, ' + R,
    d: 'Il ritmo delle ultime settimane e\' abbastanza costante da rendere sensato questo '
     + 'intervallo. Si ricalcola ogni volta: se rallenti si allunga, e va bene cosi\'.' };
}

/** Il blocco, con la sua classe secondo quanto e' affidabile. */
function cardTempo(t, nome) {
  const f = frasiTempo(t, nome);
  if (!f) return null;
  const cls = { 'ci-sei': ' ok', lontano: ' no', incerto: ' ni', largo: ' ni' }[t.stato] || '';
  const c = el('div', 'tempo' + cls);
  c.innerHTML = `<span class="t">${esc(f.t)}</span><span class="d">${esc(f.d)}</span>`;
  return c;
}

/* ============================================================== grafico */
/**
 * Storia piena, proiezione tratteggiata, banda intorno.
 * L'asse x e' il TEMPO vero e non l'indice della rilevazione: le misure si
 * prendono quando capita, e spaziarle uguali farebbe sembrare costante un
 * ritmo che non lo e'.
 */
function chartProiezione(serie, pr, o = {}) {
  const H = 150, g = geo(H);
  const t0 = new Date(serie[0].k);
  const gg = s => (new Date(s.k) - t0) / 864e5;
  const spanD = gg(serie[serie.length - 1]);
  const tot = spanD + pr.orizzonte;
  const X = d => g.l + (tot ? d / tot : 0) * g.w;

  const vals = serie.map(s => s.v)
    .concat([pr.fra - pr.banda, pr.fra + pr.banda])
    .concat(o.target != null ? [o.target] : []);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min || 1) * .12;
  g.scale(min - pad, max + pad);
  const s = svgEl(H);
  s.append(grid(g));

  if (o.target != null) {
    s.append(mk('line', { x1: g.l, x2: g.l + g.w, y1: g.y(o.target), y2: g.y(o.target),
      stroke: 'var(--ink-3)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    const t = mk('text', { x: g.l + g.w, y: g.y(o.target) - 4, 'text-anchor': 'end',
      'font-size': 8.5, 'font-family': 'var(--mono)', fill: 'var(--ink-3)' });
    t.textContent = 'target';
    s.append(t);
  }

  // il cuneo della banda: parte stretto dall'ultimo dato e si allarga
  const xu = X(spanD), yu = g.y(serie[serie.length - 1].v), xf = X(tot);
  s.append(mk('polygon', {
    points: `${xu},${yu} ${xf},${g.y(pr.fra + pr.banda)} ${xf},${g.y(pr.fra - pr.banda)}`,
    fill: 'var(--pine)', opacity: .13 }));
  s.append(mk('path', { d: `M${xu},${yu} L${xf},${g.y(pr.fra)}`, fill: 'none',
    stroke: 'var(--pine)', 'stroke-width': 2, 'stroke-dasharray': '5 4',
    'stroke-linecap': 'round' }));

  s.append(mk('path', {
    d: serie.map((p, i) => (i ? 'L' : 'M') + X(gg(p)) + ',' + g.y(p.v)).join(' '),
    fill: 'none', stroke: 'var(--pine)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  for (const p of serie)
    s.append(mk('circle', { cx: X(gg(p)), cy: g.y(p.v), r: 2.4, fill: 'var(--pine)' }));
  s.append(mk('circle', { cx: xf, cy: g.y(pr.fra), r: 3.4, fill: 'var(--paper)',
    stroke: 'var(--pine)', 'stroke-width': 2 }));

  // etichette x: prima rilevazione, ultima, orizzonte
  const eti = (x, testo) => {
    const t = mk('text', { x, y: g.t + g.h + 12, 'text-anchor': 'middle',
      'font-size': 9, 'font-family': 'var(--mono)', fill: 'var(--ink-3)' });
    t.textContent = testo; s.append(t);
  };
  eti(g.l, serie[0].k.slice(8) + '/' + serie[0].k.slice(5, 7));
  eti(xf, '+' + pr.orizzonte + 'g');
  return s;
}

/* =============================================================== vista */
let prevMisura = null;

/**
 * "Dove stai andando", in frasi.
 *
 * Segnalato con "non si capisce molto bene", ed era giusto: una tabella da
 * quattro colonne con `±` e `/sett` stretti dentro ogni cella, l'R² in
 * colonna, e la composizione con chili e percentuali sotto le stesse
 * intestazioni. Ogni numero era vero, e la pagina non rispondeva a niente.
 *
 * Adesso ogni misura e' una riga che si legge ad alta voce — "da 84,6 a
 * 83,5 cm, ±0,5" — la composizione e' tutta in chili come in Corpo, e l'R²
 * compare solo quando dice qualcosa: quando e' basso, e quindi la retta vale
 * poco.
 */
function viewPrevisioni(v) {
  const k = today();

  v.append(el('div', 'card flat',
    `<div class="muted">Dove ti porta il ritmo delle ultime settimane <strong>fra
     ${ORIZZONTE} giorni</strong>, con la forbice dentro cui starai. Una direzione,
     non una data di arrivo.</div>`));

  /* ---------------------------------------------------------- misure */
  const cm = el('div', 'card');
  cm.append(el('h2', 'sec', 'Le misure'));
  cm.lastChild.style.marginTop = '0';
  const proiezioni = D.misure.map(m => ({ m, p: proiezioneMisura(m.id) }));
  const buone = proiezioni.filter(x => x.p.ok);
  if (!buone.length) {
    cm.append(el('p', 'muted',
      'Nessuna misura ha abbastanza storia: servono almeno tre rilevazioni su due '
      + 'settimane. Con due punti la retta passa esatta e la forbice sarebbe zero, cioe\' '
      + 'una certezza finta.'));
    const b = el('button', 'btn wide pri', 'Prendi le misure');
    b.style.marginTop = '10px';
    b.onclick = () => { apri('#/corpo'); };
    cm.append(b);
  } else {
    for (const { m, p } of proiezioni) {
      const r = el('button', 'pv-r tap' + (p.ok && m.id === prevMisura ? ' on' : ''));
      let frase;
      if (!p.ok) frase = `<span class="muted">${esc(p.perche)}</span>`;
      else if (Math.abs(p.fra - p.ora) < 0.3) frase = `resta intorno a ${nf(p.ora, 1)} cm`;
      else {
        frase = `da ${nf(p.ora, 1)} a <strong>${nf(p.fra, 1)} cm</strong>, ±${nf(p.banda, 1)}`;
        const t = m.target != null ? tempoAlTarget(p, m.target) : null;
        if (t?.stato === 'ci-sei') frase += ' · riferimento dentro';
        else if (t?.stato === 'lontano') frase += ' · si allontana dal riferimento';
      }
      r.innerHTML = `<b>${esc(m.label)}</b><span>${frase}</span>`;
      r.onclick = p.ok ? () => { prevMisura = m.id; route(); } : null;
      cm.append(r);
    }
  }
  v.append(cm);

  /* --- il grafico della misura scelta --- */
  if (buone.length) {
    const sceltaId = buone.some(x => x.m.id === prevMisura) ? prevMisura : buone[0].m.id;
    const scelta = buone.find(x => x.m.id === sceltaId);
    const c = card(scelta.m.label,
      `Le rilevazioni, poi la retta tratteggiata fino a ${ORIZZONTE} giorni con la sua forbice.`);
    if (buone.length > 1) {
      // sei misure non stanno in una riga: si scorre, invece di schiacciare i nomi
      const seg = el('div', 'seg scorre');
      seg.style.marginBottom = '8px';
      for (const { m } of buone) {
        const b = el('button', null, m.label.split(' ')[0]);
        b.setAttribute('aria-pressed', m.id === sceltaId);
        b.onclick = () => { prevMisura = m.id; route(); };
        seg.append(b);
      }
      c.append(seg);
    }
    c.append(chartProiezione(scelta.p.serie, scelta.p, { target: scelta.m.target }));
    const p = scelta.p;
    c.append(el('div', 'read',
      `<span><b>${nf(p.fra, 1)} cm</b> fra ${ORIZZONTE} giorni</span>`
      + `<span>±${nf(p.banda, 1)}</span><span>${p.n} rilevazioni</span>`));
    const ct = cardTempo(tempoAlTarget(p, scelta.m.target), scelta.m.label);
    if (ct) c.append(ct);
    // l'R² si nomina solo quando avverte: alto, non aggiunge niente
    if (p.piatta) c.append(el('p', 'note',
      'Non si e\' mossa di un millimetro fra una rilevazione e l\'altra. Puo\' essere vero, '
      + 'ma capita anche riscrivendo il valore della volta prima invece di rimisurare.'));
    else if (p.r2 < 0.4) c.append(el('p', 'note',
      `Le rilevazioni sono sparse (R² ${nf(p.r2, 2)}): la direzione vale poco finche' `
      + 'non ne aggiungi altre.'));
    v.append(c);
  }

  /* ---------------------------------------------------- composizione */
  const pc = proiezioneComposizione(ORIZZONTE, k);
  const cc = el('div', 'card');
  cc.append(el('h2', 'sec', 'Grasso e massa magra'));
  cc.lastChild.style.marginTop = '0';
  if (!pc.ok) {
    cc.append(el('p', 'muted', 'Non calcolabile: ' + esc(pc.perche) + '.'));
  } else {
    cc.append(el('div', 'cmp-big',
      `<b class="mono">${nf(pc.oggi.bf, 1)}<em>%</em> → ${nf(pc.bf, 1)}<em>%</em></b>`
      + `<span>di grasso fra ${ORIZZONTE} giorni</span>`));
    const tb = el('div', 'cmp');
    tb.append(el('div', 'cmp-h',
      '<span>kg</span><span>Ora</span><span>+28 gg</span><span>Cambio</span>'));
    const riga = (lab, ora, fra, buono, cls = '') => {
      if (ora == null || fra == null) return;
      const d = fra - ora;
      const col = Math.abs(d) < 0.1 ? '' : buono(d) ? 'good' : 'dn';
      tb.append(el('div', 'cmp-r ' + cls,
        `<span>${lab}</span><span class="mono">${nf(ora, 1)}</span>
         <span class="mono">${nf(fra, 1)}</span>
         <span class="mono ${col}">${d > 0.05 ? '+' : d < -0.05 ? '−' : ''}${nf(Math.abs(d), 1)}</span>`));
    };
    riga('Massa magra', pc.oggi.lbm, pc.lbm, d => d > 0);
    riga('Massa grassa', pc.oggi.fm, pc.fm, d => d < 0);
    riga('Peso', pc.oggi.peso, pc.peso, () => true, 'tot');
    cc.append(tb);
    const ricomp = pc.dFm != null && pc.dLbm != null && pc.dFm < -0.2 && pc.dLbm > -0.2;
    cc.append(el('p', 'note', (ricomp
      ? 'Grasso in calo con la magra che tiene: e\' la direzione giusta. '
      : '')
      + 'E\' una stima su due proiezioni — peso e vita — dentro una formula che sbaglia di '
      + 'tre o quattro punti: guarda la direzione, non la cifra.'));
  }
  v.append(cc);

  /* ---------------------------------------------------------- forza */
  const pf = proiezioniForza(ORIZZONTE);
  const cf = el('div', 'card');
  cf.append(el('h2', 'sec', 'La forza'));
  cf.lastChild.style.marginTop = '0';
  if (!pf.length) {
    cf.append(el('p', 'muted',
      'Nessun esercizio ha tre sedute registrate: il massimale stimato ha bisogno di '
      + 'almeno tre punti per avere una direzione.'));
  } else {
    for (const p of pf) {
      cf.append(el('div', 'pv-r',
        `<b>${esc(p.nome)}</b><span>massimale stimato da ${nf(p.ora, 1)} a `
        + `<strong>${nf(p.fra, 1)} kg</strong>, ±${nf(p.banda, 1)}</span>`));
    }
    cf.append(el('p', 'note',
      'Il massimale viene da Epley corretto col RIR, non da un massimale vero. E la forza non '
      + 'sale in linea retta per sempre: vicino al proprio limite la retta e\' ottimista.'));
  }
  v.append(cf);

  /* --------------------------------------------------- rimando al peso */
  const cp = el('div', 'card flat');
  cp.append(el('div', 'muted',
    'Il peso ha un motore suo, che ricalibra il dispendio a ogni registrazione: sta in Corpo, '
    + 'e il giudizio sul mese in Andamento.'));
  const b = el('button', 'btn wide', 'Apri Il mese');
  b.style.marginTop = '10px';
  b.onclick = () => { andTab = 'mese'; apri('#/andamento'); };
  cp.append(b);
  v.append(cp);
}
