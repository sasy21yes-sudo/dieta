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
  const fp = forecast(orizzonte, D.target.kcal, k);
  const pv = proiezioneMisura('vita', orizzonte);
  if (!fp || !pv.ok) return { perche: 'servono piu\' pesate e almeno tre misure della vita', oggi };

  const p = D.profilo;
  const vita = pv.fra, peso = fp.peso;
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

function viewPrevisioni(v) {
  const k = today();

  v.append(el('div', 'card flat',
    `<div class="eyebrow">Come si leggono</div>
     <div class="muted">Ogni proiezione dice dove ti porta il ritmo delle ultime
     settimane <strong>fra ${ORIZZONTE} giorni</strong>, con la forbice dentro cui
     starai. Non c'e' una data di arrivo, e non e' una dimenticanza: dipende dal
     fatto che il ritmo di oggi valga per mesi, e non succede mai. Quello che si
     puo' dire e' se il target sta dentro la forbice oppure no.</div>`));

  /* ---------------------------------------------------------- misure */
  const cm = el('div', 'card');
  cm.append(el('h2', 'sec', 'Le misure'));
  cm.lastChild.style.marginTop = '0';
  const proiezioni = D.misure.map(m => ({ m, p: proiezioneMisura(m.id) }));
  const buone = proiezioni.filter(x => x.p.ok);

  if (!buone.length) {
    cm.append(el('p', 'muted',
      'Nessuna misura ha abbastanza storia per una proiezione. Servono almeno tre '
      + 'rilevazioni distribuite su due settimane: con due punti la retta passa '
      + 'esatta e la forbice verrebbe zero, che sarebbe una certezza finta.'));
    const b = el('button', 'btn wide pri', 'Prendi le misure');
    b.style.marginTop = '10px';
    b.onclick = () => { apri('#/corpo'); };
    cm.append(b);
  } else {
    cm.append(el('div', 'sub',
      'Al ritmo delle ultime settimane. La colonna "fra ' + ORIZZONTE + ' giorni" '
      + 'e\' il centro della forbice, non una promessa.'));
    const tb = el('div', 'cmp');
    tb.append(el('div', 'cmp-h',
      `<span></span><span>Ora</span><span>Fra ${ORIZZONTE}g</span><span>Target</span>`));
    for (const { m, p } of proiezioni) {
      const r = el('button', 'cmp-r tap');
      const dentro = p.ok && m.target != null
        && m.target >= p.fra - p.banda && m.target <= p.fra + p.banda;
      r.innerHTML = `<span>${esc(m.label)}${p.ok
          ? `<em class="${p.cmSettimana < 0 ? 'dn' : 'up'}">${p.cmSettimana > 0 ? '+' : ''}${nf(p.cmSettimana, 2)}/sett</em>`
          : ''}</span>
        <span class="mono">${p.ok ? nf(p.ora, 1) : '—'}</span>
        <span class="mono">${p.ok ? nf(p.fra, 1) + '<em class="pm">±' + nf(p.banda, 1) + '</em>' : '—'}</span>
        <span class="mono ${dentro ? 'good' : 'muted'}">${m.target != null
          ? (dentro ? '✓ ' : '') + nf(m.target, 1) : '—'}</span>`;
      if (p.ok) r.onclick = () => { prevMisura = m.id; route(); };
      else r.onclick = () => toast(p.perche.charAt(0).toUpperCase() + p.perche.slice(1));
      tb.append(r);
    }
    cm.append(tb);
    const conTarget = buone.filter(x => x.m.target != null);
    const dentro = conTarget.filter(x =>
      x.m.target >= x.p.fra - x.p.banda && x.m.target <= x.p.fra + x.p.banda).length;
    if (conTarget.length) cm.append(el('p', 'hint',
      `Il segno di spunta dice che il target cade dentro la forbice: `
      + `${dentro} misur${dentro === 1 ? 'a' : 'e'} su ${conTarget.length}. Le altre non sono in ritardo, `
      + `sono semplicemente piu' lontane di quattro settimane.`));
  }
  v.append(cm);

  /* --- il grafico della misura scelta --- */
  if (buone.length) {
    const sceltaId = buone.some(x => x.m.id === prevMisura) ? prevMisura : buone[0].m.id;
    const scelta = buone.find(x => x.m.id === sceltaId);
    const c = card(scelta.m.label,
      `Rilevazioni vere, poi la retta tratteggiata fino a +${ORIZZONTE} giorni. `
      + `L'area e' la forbice al 95%.`);
    if (buone.length > 1) {
      const seg = el('div', 'seg');
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
      + `<span>±${nf(p.banda, 1)}</span>`
      + `<span>${p.n} rilevazioni</span>`
      + (p.piatta ? `<span>ferma</span>` : `<span>R² ${nf(p.r2, 2)}</span>`)));
    // quanto manca, in tempo: si rifiuta da solo quando non ha senso
    const ct = cardTempo(tempoAlTarget(p, scelta.m.target), scelta.m.label);
    if (ct) c.append(ct);
    c.append(el('p', 'note', p.piatta
      ? 'Questa misura non si e\' mossa di un millimetro fra una rilevazione e '
        + 'l\'altra. Puo\' essere vero, ma capita anche quando si riscrive il valore '
        + 'della volta prima invece di rimisurare davvero.'
      : p.r2 < 0.4
      ? `R² ${nf(p.r2, 2)}: le rilevazioni sono sparse e la retta ci passa in mezzo `
        + `senza spiegarle. La direzione vale poco finche' non ne aggiungi altre.`
      : `R² ${nf(p.r2, 2)}: le rilevazioni stanno abbastanza in fila da rendere `
        + `sensata una retta. Resta una tendenza, non un impegno.`));
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
    cc.append(el('div', 'sub',
      `Peso previsto e vita prevista, dentro la stessa formula che usa la scheda Corpo.`));
    const rows = [
      ['Peso', pc.oggi.peso, pc.peso, 'kg', 1],
      ['Grasso', pc.oggi.bf, pc.bf, '%', 1],
      ['Massa grassa', pc.oggi.fm, pc.fm, 'kg', 1],
      ['Massa magra', pc.oggi.lbm, pc.lbm, 'kg', 1]
    ];
    const tb = el('div', 'cmp');
    tb.append(el('div', 'cmp-h',
      `<span></span><span>Ora</span><span>Fra ${ORIZZONTE}g</span><span>Δ</span>`));
    for (const [lab, ora, fra, u, dec] of rows) {
      if (ora == null || fra == null) continue;
      const d = fra - ora;
      const bene = lab === 'Massa magra' ? d >= -0.1 : d <= 0.1;
      tb.append(el('div', 'cmp-r',
        `<span>${lab}</span><span class="mono">${nf(ora, dec)}</span>
         <span class="mono">${nf(fra, dec)}</span>
         <span class="mono ${bene ? 'good' : 'dn'}">${d > 0 ? '+' : ''}${nf(d, dec)} ${u}</span>`));
    }
    cc.append(tb);
    const ricomp = pc.dFm != null && pc.dLbm != null && pc.dFm < -0.2 && pc.dLbm > -0.2;
    cc.append(el('p', 'muted', ricomp
      ? 'Grasso in calo con la massa magra che tiene: e' + '’ esattamente la ricomposizione, '
        + 'ed e' + '’ il motivo per cui la bilancia da sola non basta a giudicare.'
      : 'Guarda le due righe in basso insieme: lo stesso peso puo' + '’ nascondere due corpi diversi.'));
    cc.append(el('p', 'note',
      'Attenzione a cosa e' + '’ questo numero: una stima costruita su altre due stime — '
      + 'il peso previsto e la vita prevista — passate dentro una formula che da sola '
      + 'sbaglia di tre o quattro punti di grasso. Serve a vedere la direzione, non il '
      + 'valore. Se il grasso scende e la massa magra tiene, la direzione e' + '’ giusta '
      + 'anche se le cifre non lo sono.'));
  }
  v.append(cc);

  /* ---------------------------------------------------------- forza */
  const pf = proiezioniForza(ORIZZONTE);
  const cf = el('div', 'card');
  cf.append(el('h2', 'sec', 'La forza'));
  cf.lastChild.style.marginTop = '0';
  if (!pf.length) {
    cf.append(el('p', 'muted',
      'Nessun esercizio ha tre sedute registrate. Il massimale stimato serve proprio '
      + 'a questo: mette d\'accordo "meno ripetizioni ma piu\' peso" e "stesso peso ma '
      + 'piu\' ripetizioni", che altrimenti non si potrebbero confrontare.'));
  } else {
    cf.append(el('div', 'sub', 'Massimale stimato, proiettato con la stessa retta.'));
    const tb = el('div', 'cmp');
    tb.append(el('div', 'cmp-h',
      `<span></span><span>Ora</span><span>Fra ${ORIZZONTE}g</span><span>R²</span>`));
    for (const p of pf) {
      tb.append(el('div', 'cmp-r',
        `<span>${esc(p.nome)}<em class="${p.kgSettimana < 0 ? 'dn' : 'up'}">${
           p.kgSettimana > 0 ? '+' : ''}${nf(p.kgSettimana, 2)} kg/sett</em></span>
         <span class="mono">${nf(p.ora, 1)}</span>
         <span class="mono">${nf(p.fra, 1)}<em class="pm">±${nf(p.banda, 1)}</em></span>
         <span class="mono muted">${nf(p.r2, 2)}</span>`));
    }
    cf.append(tb);
    cf.append(el('p', 'note',
      'Il massimale stimato viene da Epley corretto col RIR, non da un massimale vero: '
      + 'sopra le dodici ripetizioni sovrastima. E la forza non sale in linea retta per '
      + 'sempre — piu' + '’ ci si avvicina al proprio limite, piu' + '’ la retta e' + '’ ottimista.'));
  }
  v.append(cf);

  /* --------------------------------------------------- rimando al peso */
  const cp = el('div', 'card flat');
  cp.append(el('div', 'eyebrow', 'E il peso?'));
  cp.append(el('div', 'muted',
    'Quello ha un motore a parte, piu' + '’ fine: un filtro che ricalibra il dispendio '
    + 'ogni volta che registri, e che tiene una pagella dei propri errori passati. '
    + 'Sta nella scheda Corpo.'));
  const b = el('button', 'btn wide', 'Apri la previsione del peso');
  b.style.marginTop = '10px';
  b.onclick = () => { apri('#/corpo'); };
  cp.append(b);
  v.append(cp);
}
