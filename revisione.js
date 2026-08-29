/* Revisione settimanale.
 *
 * La settimana e' l'unita' di misura giusta per questa app: il giorno e' pieno
 * di rumore, il mese arriva troppo tardi per correggere. Qui si confronta la
 * settimana appena chiusa con quella prima, si dice cosa non ha funzionato,
 * come si sistema e — la parte che conta — QUALE UNA COSA cambiare.
 *
 * Il tono resta descrittivo. Non c'e' nessun voto sulla persona e nessuna
 * riga suggerisce di saltare pasti o di compensare: il bilancio e' settimanale
 * per definizione, ed e' proprio questa schermata a dirlo.
 */
'use strict';

/** I sette giorni chiusi, e i sette prima di quelli. */
function settimane(k = today()) {
  // le pause non si tolgono qui: la settimana resta di sette giorni per le
  // date in testata. Si tolgono nel conteggio, dove falserebbero le medie
  const questa = windowDays(k, 7);
  const prima = windowDays(addDays(k, -7), 7);
  return { questa, prima };
}

/** Quanti giorni di questa settimana erano in pausa. */
function pausaSettimana(giorni) {
  return typeof inPausa === 'function' ? giorni.filter(inPausa).length : 0;
}

function mediaSu(giorni, fn) {
  const v = giorni.map(fn).filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function contaSu2(giorni, fn) { return giorni.filter(fn).length; }

/**
 * Le metriche della settimana, ognuna con il valore di adesso, quello di
 * prima e il bersaglio. `verso` dice in che direzione e' un miglioramento:
 * serve a colorare il delta senza doverlo decidere ogni volta a mano.
 */
/**
 * Quante sedute a settimana fai di solito.
 * Serve come metro quando non c'e' un obiettivo dichiarato: confrontarti con
 * un 4 tirato fuori dal nulla direbbe "sotto" a chi si allena tre volte per
 * scelta, il che e' un giudizio e non una misura.
 */
function seduteAbituali(k = today(), settimane = 8) {
  const conta = [];
  for (let w = 1; w <= settimane; w++) {
    const gg = windowDays(addDays(k, -7 * (w - 1)), 7);
    const n = gg.filter(x => (typeof serieDelGiorno === 'function' && serieDelGiorno(x).length)
      || S.hyrox?.sessioni?.[x]?.fatto || S.log[x]?.allenamento === true).length;
    if (n) conta.push(n);
  }
  if (!conta.length) return 0;
  conta.sort((a, b) => a - b);
  return Math.max(1, Math.round(conta[Math.floor(conta.length / 2)]));
}

function metricheSettimana(k = today()) {
  const s0 = settimane(k);
  const filtra = g => typeof senzaPause === 'function' ? senzaPause(g) : g;
  // una settimana interamente in pausa non si filtra a zero: si lascia com'e',
  // altrimenti non resterebbe niente da confrontare e la revisione direbbe
  // "nessun dato" quando invece i dati ci sono, sono solo da non giudicare
  const q = filtra(s0.questa), p0 = filtra(s0.prima);
  const questa = q.length ? q : s0.questa;
  const prima = p0.length ? p0 : s0.prima;
  const cons = g => g.map(x => S.log[x] ? consumed(x) : null).filter(m => m && m.kcal > 400);
  const cm = (g, id) => { const c = cons(g); return c.length ? c.reduce((a, m) => a + m[id], 0) / c.length : null; };
  const md = (g, id) => mediaSu(g, x => S.log[x]?.[id]);
  const sed = g => contaSu2(g, x => (typeof serieDelGiorno === 'function' && serieDelGiorno(x).length)
    || S.hyrox?.sessioni?.[x]?.fatto || S.log[x]?.allenamento === true);
  const T = D.target;
  // con HYROX spento il numero di sedute a settimana non lo dichiara nessuno:
  // si prende il ritmo abituale delle ultime otto settimane, non una costante
  const seduteObiettivo = (typeof usaHyrox === 'function' && usaHyrox()
    && S.hyrox?.profilo?.sedute) || seduteAbituali(k) || 3;

  return [
    { id: 'kcal', lab: 'Calorie', ora: cm(questa, 'kcal'), pre: cm(prima, 'kcal'),
      tgt: T.kcal, unit: 'kcal', dec: 0, verso: 'target' },
    { id: 'p', lab: 'Proteine', ora: cm(questa, 'p'), pre: cm(prima, 'p'),
      tgt: T.p, unit: 'g', dec: 0, verso: 'su' },
    { id: 'fibre', lab: 'Fibre', ora: cm(questa, 'fibre'), pre: cm(prima, 'fibre'),
      tgt: T.fibre, unit: 'g', dec: 0, verso: 'su' },
    { id: 'acqua', lab: 'Acqua', ora: md(questa, 'acqua'), pre: md(prima, 'acqua'),
      tgt: T.acqua_l, unit: 'L', dec: 1, verso: 'su' },
    { id: 'sonno', lab: 'Sonno', ora: md(questa, 'sonno'), pre: md(prima, 'sonno'),
      tgt: T.sonno_h, unit: 'h', dec: 1, verso: 'su' },
    { id: 'passi', lab: 'Passi', ora: md(questa, 'passi'), pre: md(prima, 'passi'),
      tgt: T.passi, unit: '', dec: 0, verso: 'su' },
    { id: 'sedute', lab: 'Allenamenti', ora: sed(questa), pre: sed(prima),
      tgt: seduteObiettivo, unit: '', dec: 0, verso: 'su' },
    { id: 'registro', lab: 'Giorni registrati', ora: contaSu2(questa, x => S.log[x]?.peso != null),
      pre: contaSu2(prima, x => S.log[x]?.peso != null), tgt: 7, unit: '', dec: 0, verso: 'su' }
  ];
}

/**
 * Cosa non ha funzionato, come si sistema, e la UNA cosa da cambiare.
 * L'ordine di priorita' non e' l'ordine in cui i controlli sono scritti: e'
 * quello dell'impatto reale. Il sonno prima dei passi, il registro prima delle
 * fibre, perche' senza dati non si corregge niente.
 */
function diagnosiSettimana(k = today()) {
  const { questa } = settimane(k);
  const M = metricheSettimana(k);
  const m = id => M.find(x => x.id === id);
  const T = D.target;
  const errori = [];
  const agg = (peso, id, t, cosa, come) => errori.push({ peso, id, t, cosa, come });

  const reg = m('registro');
  if (reg.ora <= 3) agg(100, 'registro', 'Troppi giorni senza pesata',
    `${reg.ora} pesate su 7. Sotto le quattro la media mobile non significa niente, e senza quella il motore di previsione resta fermo alla formula: tutti i numeri che leggi valgono meno.`,
    'Pesati appena sveglio, dopo il bagno, prima di bere. Trenta secondi, sempre alla stessa ora: e\' l\'unica abitudine da cui dipendono tutte le altre.');

  const p = m('p');
  if (p.ora != null && p.ora < T.p * 0.9) agg(92, 'p', 'Proteine sotto il target',
    `Media ${nf(p.ora)} g contro ${T.p}. In ricomposizione e' la variabile che protegge la massa magra mentre tutto il resto si muove: e' quella che si sistema per prima.`,
    `Ti mancano circa ${nf(T.p - p.ora)} g al giorno. Il punto piu' facile e' la colazione, dove quasi tutti stanno sotto i 20 g: aggiungere una fonte proteica li' vale piu' che aumentare la cena.`);

  const sn = m('sonno');
  if (sn.ora != null && sn.ora < 6.5) agg(88, 'sonno', 'Dormi troppo poco',
    `Media ${nf(sn.ora, 1)} ore. Il sonno insufficiente alza la fame del giorno dopo e abbassa la sintesi proteica: agisce contemporaneamente su quanto mangi e su quanto costruisci.`,
    'Sposta indietro la sveglia della sera, non avanti quella del mattino. E l\'ultimo caffe entro le 16: l\'emivita della caffeina e\' cinque-sei ore.');

  const sed = m('sedute');
  if (sed.ora < sed.tgt) agg(80, 'sedute', 'Meno allenamenti del previsto',
    `${sed.ora} sedute su ${sed.tgt} che avevi detto di reggere. Una settimana sotto non rompe niente; se succede due volte di fila, il problema non e' la volonta\' ma il numero che hai scelto.`,
    `Se ${sed.tgt} sono troppe, abbassale a ${Math.max(2, sed.tgt - 1)}: un programma che rispetti batte sempre uno piu' ambizioso che salti.`);

  const kc = m('kcal');
  if (kc.ora != null) {
    const scarto = (kc.ora - T.kcal) / T.kcal;
    if (scarto < -0.12) agg(76, 'kcal', 'Mangi meno del piano',
      `Media ${nf(kc.ora)} kcal contro ${nf(T.kcal)} (${nf(scarto * 100)}%). Il deficit involontario e' il modo piu' comune di allenarsi senza costruire: il materiale non c'e'.`,
      'Guarda quale pasto salti piu' + 'spesso e sostituiscilo con qualcosa che mangeresti davvero. Non serve aggiungere alla cena quello che manca al mattino.');
    else if (scarto > 0.12) agg(70, 'kcal', 'Mangi piu\' del piano',
      `Media ${nf(kc.ora)} kcal contro ${nf(T.kcal)}. Su una settimana non e' un problema; se continua, la vita sale prima dei carichi.`,
      'Prima di togliere calorie, controlla che il piano sia ancora quello giusto: se il target e\' vecchio di due mesi il problema e\' il target, non la settimana.');
  }

  const aq = m('acqua');
  if (aq.ora != null && aq.ora < T.acqua_l * 0.75) agg(58, 'acqua', 'Bevi poco per le fibre che mangi',
    `Media ${nf(aq.ora, 1)} L contro ${nf(T.acqua_l, 1)}. Fibre alte e acqua bassa danno gonfiore e stitichezza, non regolarita'.`,
    'Bottiglia in vista sulla scrivania: si beve quello che si vede. Un bicchiere prima di ogni pasto sono gia\' tre.');

  const fb = m('fibre');
  if (fb.ora != null && fb.ora < T.fibre * 0.7) agg(52, 'fibre', 'Fibre indietro',
    `Media ${nf(fb.ora)} g contro ${T.fibre}. Di solito significa che stai saltando i legumi, e con loro se ne vanno anche ferro e sazieta'.`,
    'Una porzione di legumi al giorno chiude quasi tutto il divario da sola. Alza gradualmente: piu' + ' di 5 g a settimana di salto si sente sulla pancia.');

  const ps = m('passi');
  if (ps.ora != null && ps.ora < T.passi * 0.7) agg(44, 'passi', 'Poco movimento fuori dagli allenamenti',
    `Media ${nf(ps.ora)} passi contro ${nf(T.passi)}. E' la leva piu' indolore sul dispendio: non fa venire fame come il cardio e non costa recupero.`,
    'Duemila passi in piu\' sono circa venti minuti di camminata, o le scale al posto dell\'ascensore per una settimana.');

  errori.sort((a, b) => b.peso - a.peso);
  const priorita = errori[0] || null;
  return { metriche: M, errori, priorita, giorni: questa };
}

/** Il giudizio di sintesi: una parola, e il perche'. */
function verdettoSettimana(diag) {
  const n = diag.errori.length;
  const grave = diag.errori.filter(e => e.peso >= 80).length;
  if (!n) return { parola: 'Impeccabile', d: 'Nessuno scostamento degno di nota. Continua cosi\' e lascia lavorare il tempo.' };
  if (grave === 0 && n <= 2) return { parola: 'Buona', d: 'Qualche dettaglio da limare, niente che cambi la direzione.' };
  if (grave === 0) return { parola: 'Nella norma', d: 'Diverse cose da sistemare, nessuna urgente. Prendine una.' };
  if (grave === 1) return { parola: 'Da correggere', d: 'Una cosa importante e\' scivolata. Vale la pena occuparsene subito.' };
  return { parola: 'Settimana storta', d: 'Piu\' di una cosa importante e\' saltata. Non e\' il momento di cambiare il piano: e\' il momento di tornare a registrare.' };
}

/**
 * La leva giusta per la priorita' della settimana.
 *
 * Il file data/dieta.json contiene una chiave leve: quattro mosse da +/-150
 * kcal scritte a mano da chi ha costruito il piano — "+25 g di burro
 * d'arachidi a colazione". Erano li' dalla prima versione e non le leggeva
 * nessuno. Sono esattamente la risposta alla domanda che la revisione
 * lasciava aperta.
 *
 * Si sceglie per SEGNO: se mangi meno del piano servono le leve che aggiungono,
 * se mangi di piu' quelle che tolgono. Sulle altre priorita' — sonno, passi,
 * acqua — non si propone niente: le calorie non c'entrano, e infilarcele
 * sarebbe un consiglio a caso.
 */
function levaPerPriorita(p) {
  const leve = D.leve || [];
  if (!leve.length || !p) return [];
  const su = /sotto il target|mangi meno|proteine/i.test(p.t);
  const giu = /sopra il target|mangi piu/i.test(p.t);
  if (!su && !giu) return [];
  return leve.filter(l => su ? l.delta_kcal > 0 : l.delta_kcal < 0).slice(0, 2);
}

/** L'impegno in corso, se e' di questa settimana o della precedente. */
function impegno() { return S.settings?.impegno || null; }

/**
 * L'impegno della settimana scorsa e' stato mantenuto?
 * Non lo chiede all'utente e basta: guarda se la metrica che aveva generato la
 * priorita' e' migliorata davvero. Una domanda a cui si puo' rispondere "si'"
 * senza che sia vero non serve a niente.
 */
function esitoImpegno(k = today()) {
  const imp = impegno();
  if (!imp) return null;
  const { questa } = settimane(k);
  if (imp.settimana === questa[0]) return null;      // e' quello in corso
  const ora = diagnosiSettimana(k);
  const ancora = ora.errori.find(e => e.t === imp.cosa);
  return { imp, risolto: !ancora, gravita: ancora ? ancora.peso : 0,
           priorita: ora.priorita && ora.priorita.t === imp.cosa };
}

/* ================================================================= vista */
function viewRevisione(v) {
  const k = today();
  const diag = diagnosiSettimana(k);
  const ver = verdettoSettimana(diag);
  const { questa, prima } = settimane(k);
  const co = typeof costanze === 'function' ? costanze(k, 7) : null;

  /* --- testata --- */
  const testa = el('div', 'rev-hero');
  testa.append(el('div', 'rev-kick',
    `Settimana chiusa · ${questa[6].slice(8)}/${questa[6].slice(5, 7)} – ${questa[0].slice(8)}/${questa[0].slice(5, 7)}`));
  const parola = el('div', 'rev-parola', esc(ver.parola));
  testa.append(parola);
  testa.append(el('div', 'rev-sotto', esc(ver.d)));

  if (co) {
    const box = el('div', 'rev-anello');
    const R = 34, W = 86;
    const s = mk('svg', { viewBox: `0 0 ${W} ${W}` });
    s.append(mk('circle', { cx: W / 2, cy: W / 2, r: R, fill: 'none',
      stroke: 'var(--wash)', 'stroke-width': 8 }));
    const arco = mk('circle', { cx: W / 2, cy: W / 2, r: R, fill: 'none',
      stroke: 'var(--pine)', 'stroke-width': 8, 'stroke-linecap': 'round',
      transform: `rotate(-90 ${W / 2} ${W / 2})` });
    s.append(arco);
    box.append(s);
    const num = el('div', 'rev-anello-n', nf(co.generale, 0));
    anelloFermo(arco, co.generale / 100);   // stato finale subito leggibile
    box.append(num);
    box.append(el('div', 'rev-anello-l', 'costanza'));
    testa.append(box);
    osserva(box, () => {
      riempiAnello(arco, co.generale / 100);
      contaSu(num, co.generale, { dur: 1000 });
    });
  }
  v.append(testa);
  osserva(parola, () => pulsa(parola, { scala: 1.05, dur: 620 }));

  /* --- l'impegno della settimana scorsa --- */
  const es = esitoImpegno(k);
  if (es) {
    const ci = el('div', 'card imp-esito' + (es.risolto ? ' ok' : ''));
    ci.append(el('div', 'eyebrow', 'L\'impegno della settimana scorsa'));
    ci.append(el('div', 'imp-t', esc(es.imp.cosa)));
    ci.append(el('div', 'muted', es.risolto
      ? 'Non compare piu\' fra le cose che non hanno funzionato. Non e\' una tua '
        + 'impressione: e\' sparito dai numeri. Tienilo, e passa al prossimo.'
      : es.priorita
        ? 'E\' ancora la prima cosa che non funziona. Non e\' un rimprovero: vuol dire '
          + 'che la mossa scelta era troppo grande, o che non era quella giusta. '
          + 'Prova a spezzarla in qualcosa di piu\' piccolo.'
        : 'C\'e\' ancora, ma pesa meno di prima: qualcosa si e\' mosso. Vale la pena '
          + 'tenerlo un\'altra settimana.'));
    const b = el('button', 'btn wide');
    b.style.marginTop = '10px';
    b.textContent = es.risolto ? 'Chiudilo' : 'Lo lascio perdere';
    b.onclick = () => { delete S.settings.impegno; save(); route(); };
    ci.append(b);
    v.append(ci);
    if (es.risolto) osserva(ci, () => { pulsa(ci); coriandoli(ci); });
    ci.style.position = 'relative';
  }

  /* --- i numeri, con il confronto --- */
  const cn = el('div', 'cw');
  cn.append(el('h3', null, 'Rispetto alla settimana prima'));
  cn.append(el('div', 'sub', 'Una riga per voce. Il pallino vuoto e\' la settimana prima, quello pieno questa: la lunghezza del tratto e\' quanto ti sei mosso.'));
  cn.append(chartPendenza(diag.metriche));
  v.append(cn);

  /* --- griglia dei numeri animati --- */
  const g = el('div', 'rev-nums');
  for (const m of diag.metriche) {
    if (m.ora == null) continue;
    const d = m.pre == null ? null : m.ora - m.pre;
    const meglio = d == null ? null
      : m.verso === 'target' ? Math.abs(m.ora - m.tgt) < Math.abs(m.pre - m.tgt)
      : d > 0;
    const box = el('div', 'rev-num');
    const optD = { dec: m.dec, segno: true, suffisso: ' sulla settimana prima' };
    const uguale = d != null && Math.abs(d) < .5 / Math.pow(10, m.dec);
    box.innerHTML = `<span class="l">${esc(m.lab)}</span>
      <span class="v">${esc(testoNum(m.ora, { dec: m.dec }))}</span>
      <span class="d ${d == null ? '' : uguale ? '' : meglio ? 'up' : 'dn'}">${
        d == null ? 'prima settimana' : uguale ? 'come la settimana prima'
          : esc(testoNum(d, optD))}</span>`;
    g.append(box);
    osserva(box, () => {
      contaSu(box.querySelector('.v'), m.ora, { dec: m.dec, dur: 850 });
      if (d != null && !uguale) contaSu(box.querySelector('.d'), d, { ...optD, dur: 850 });
    });
  }
  v.append(g);
  osserva(g, () => entrata([...g.children], { passo: 45 }));

  /* --- cosa non ha funzionato --- */
  const ce = el('div', 'cw');
  ce.append(el('h3', null, diag.errori.length ? 'Cosa non ha funzionato' : 'Non e\' andato storto niente'));
  if (!diag.errori.length) {
    ce.append(el('p', 'note', 'Su questa settimana non emergono scostamenti degni di nota. E\' il caso piu\' raro e il piu\' noioso da leggere: va benissimo cosi\'.'));
  } else {
    ce.append(el('div', 'sub', 'In ordine di quanto pesa sul risultato, non di quanto e\' evidente.'));
    for (const [i, e] of diag.errori.entries()) {
      const r = el('div', 'rev-err' + (e.peso >= 80 ? ' grave' : ''));
      r.innerHTML = `<span class="n">${i + 1}</span>
        <span class="b"><span class="t">${esc(e.t)}</span>
        <span class="c">${e.cosa}</span></span>`;
      ce.append(r);
    }
    osserva(ce, () => entrata([...ce.querySelectorAll('.rev-err')], { passo: 90 }));
  }
  v.append(ce);

  /* --- come migliorare --- */
  if (diag.errori.length) {
    const cm = el('div', 'cw');
    cm.append(el('h3', null, 'Come si sistema'));
    cm.append(el('div', 'sub', 'Una mossa concreta per ognuna. Non servono tutte insieme.'));
    for (const e of diag.errori) {
      const r = el('div', 'rev-fix');
      r.innerHTML = `<span class="t">${esc(e.t)}</span><span class="c">${e.come}</span>`;
      cm.append(r);
    }
    osserva(cm, () => entrata([...cm.querySelectorAll('.rev-fix')], { passo: 80 }));
    v.append(cm);
  }

  /* --- la priorita', e l'impegno che ne nasce --- */
  if (diag.priorita) {
    const cp = el('div', 'rev-prio');
    cp.append(el('div', 'rev-kick', 'Se cambi una cosa sola'));
    cp.append(el('div', 'rev-prio-t', esc(diag.priorita.t)));
    cp.append(el('div', 'rev-prio-c', diag.priorita.come));

    /* La leva concreta, se ce n'e' una che c'entra.
       In data/dieta.json c'e' `leve`: quattro mosse da 150 kcal scritte a mano
       da chi il piano l'ha costruito. Fino a ieri quel campo non lo leggeva
       nessuno — la revisione diceva "mangi meno del piano" e poi ti lasciava
       li' a inventarti come rimediare. */
    const lv = levaPerPriorita(diag.priorita);
    if (lv.length) {
      const box = el('div', 'rev-leve');
      box.append(el('div', 'rev-kick', 'Una mossa gia\' pronta'));
      for (const l of lv) {
        const r = el('div', 'rev-leva');
        r.innerHTML = `<span class="k">${l.delta_kcal > 0 ? '+' : ''}${l.delta_kcal}</span>`
          + `<span class="a">${esc(l.azione)}</span>`;
        box.append(r);
      }
      cp.append(box);
    }

    /* L'impegno. Una diagnosi che nessuno ricorda la settimana dopo e' un
       elenco, non un ciclo: qui si prende nota di UNA cosa e domenica
       prossima l'app chiede se e' andata. */
    const imp = impegno();
    const sett = questa[0];
    if (imp && imp.settimana === sett) {
      const g = el('div', 'rev-imp preso');
      g.innerHTML = `<span class="t">Impegno preso</span>`
        + `<span class="d">${esc(imp.cosa)}</span>`;
      const via = el('button', 'btn wide');
      via.textContent = 'Ci ho ripensato, toglilo';
      via.onclick = () => { delete S.settings.impegno; save(); route(); };
      g.append(via);
      cp.append(g);
    } else {
      const b = el('button', 'btn wide pri');
      b.style.marginTop = '12px';
      b.textContent = 'Prendo questo impegno per la settimana';
      b.onclick = () => {
        S.settings.impegno = { settimana: sett, cosa: diag.priorita.t,
                               come: diag.priorita.come, preso: today() };
        save(); route();
        toast('Domenica prossima ti chiedo com\'e\' andata');
      };
      cp.append(b);
    }

    cp.append(el('p', 'rev-prio-n',
      'Una alla volta, non tutte. Cambiare cinque cose insieme rende impossibile capire quale ha funzionato, e la settimana prossima saresti al punto di prima con piu\' confusione.'));
    v.append(cp);
    osserva(cp, () => pulsa(cp, { scala: 1.015, dur: 700 }));
  }

  /* --- traguardi sbloccati in settimana --- */
  if (typeof traguardi === 'function') {
    const presi = traguardi().filter(t => t.preso);
    if (presi.length) {
      const ct = el('div', 'cw');
      ct.style.position = 'relative';   // i coriandoli sono in overlay assoluto
      ct.append(el('h3', null, 'Traguardi raggiunti'));
      ct.append(el('div', 'sub', `${presi.length} in tutto. Non si perdono piu'.`));
      const gr = el('div', 'trofei');
      for (const t of presi.slice(-6)) {
        const b = el('div', 'trofeo on');
        b.innerHTML = `<span class="ic">★</span><span class="nm">${esc(t.n)}</span>`;
        gr.append(b);
      }
      ct.append(gr);
      v.append(ct);
      osserva(gr, () => { entrata([...gr.children], { passo: 70 }); coriandoli(ct); });
    }
  }

  /* --- chiusura --- */
  const fine = el('div', 'card flat');
  fine.append(el('div', 'eyebrow', 'Il bilancio e\' settimanale'));
  fine.append(el('div', 'muted',
    'Una cena fuori piano non annulla sei giorni buoni e non va compensata saltando il pasto dopo. Questa schermata esiste proprio per guardare la settimana intera invece del singolo giorno.'));
  const b = el('button', 'btn wide pri', 'Ho letto, chiudi la revisione');
  b.style.marginTop = '10px';
  b.onclick = () => {
    S.settings.revisioneLetta = today(); save();
    location.hash = '#/oggi';
  };
  fine.append(b);
  v.append(fine);
}

/**
 * Grafico a manubrio: una riga per metrica, due pallini (settimana prima,
 * questa) uniti da un segmento. L'asse e' uno solo — la percentuale del
 * proprio target — perche' e' l'unico metro che mette sulla stessa riga i
 * passi e i litri d'acqua. Il segmento colorato dice la direzione: verde
 * verso il target, ambra lontano.
 */
function chartPendenza(metriche) {
  const righe = metriche.filter(m => m.ora != null && m.tgt);
  const box = el('div');
  if (!righe.length) {
    box.append(el('p', 'note', 'Servono almeno alcuni giorni registrati per fare il confronto.'));
    return box;
  }
  const W = 320, L = 96, RH = 22, TOP = 22;
  const H = TOP + righe.length * RH + 20;
  const x0 = L, x1 = W - 14, MAX = 1.35;
  const s = mk('svg', { viewBox: `0 0 ${W} ${H}` });
  const X = q => x0 + Math.max(0, Math.min(MAX, q)) / MAX * (x1 - x0);
  const testo = (x, y, t, o = {}) => {
    const n = mk('text', Object.assign({ x, y, 'font-size': 9.5,
      'font-family': 'var(--sans)', fill: 'var(--ink-2)' }, o));
    n.textContent = t; s.append(n); return n;
  };

  /* le tacche: 0, meta', target. Niente valori tondi arbitrari — qui i numeri
     tondi che contano sono questi tre */
  for (const [q, lab] of [[0, '0'], [.5, '50%'], [1, 'target']]) {
    const x = X(q), forte = q === 1;
    s.append(mk('line', { x1: x, x2: x, y1: TOP - 4, y2: H - 18,
      stroke: forte ? 'var(--ink-3)' : 'var(--rule)', 'stroke-width': 1,
      'stroke-dasharray': forte ? '4 4' : null, opacity: forte ? .65 : 1 }));
    testo(x, H - 6, lab, { 'text-anchor': 'middle', 'font-size': 8.5,
      'font-family': 'var(--mono)', fill: forte ? 'var(--ink-2)' : 'var(--ink-3)' });
  }

  righe.forEach((m, i) => {
    const y = TOP + i * RH + RH / 2;
    const qb = m.ora / m.tgt, qa = m.pre == null ? null : m.pre / m.tgt;
    const meglio = qa == null ? null : m.verso === 'target'
      ? Math.abs(qb - 1) < Math.abs(qa - 1) : qb > qa;
    const fermo = qa != null && Math.abs(qb - qa) < .02;
    const tinta = qa == null ? 'var(--pine)' : fermo ? 'var(--ink-3)'
      : meglio ? 'var(--pine)' : 'var(--amber)';
    testo(L - 8, y + 3.2, m.lab, { 'text-anchor': 'end', fill: 'var(--ink-2)' });
    if (qa != null && !fermo) {
      s.append(mk('path', { d: `M${X(qa)},${y} L${X(qb)},${y}`, fill: 'none',
        stroke: tinta, 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: .85 }));
      s.append(mk('circle', { cx: X(qa), cy: y, r: 2.6, fill: 'var(--paper)',
        stroke: 'var(--ink-3)', 'stroke-width': 1.4 }));
    }
    s.append(mk('circle', { cx: X(qb), cy: y, r: 4, fill: tinta }));
  });
  box.append(s);

  const leg = el('div', 'legend');
  leg.innerHTML = `<span><i class="dt vuoto"></i>settimana prima</span>
    <span><i class="dt" style="background:var(--pine)"></i>verso il target</span>
    <span><i class="dt" style="background:var(--amber)"></i>lontano dal target</span>`;
  box.append(leg);

  osserva(box, () => {
    [...s.querySelectorAll('path')].forEach((p, i) => disegnaPath(p, { dur: 560, ritardo: 120 + i * 70 }));
    if (motionOk())
      [...s.querySelectorAll('circle')].forEach((c, i) =>
        c.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }],
          { duration: 320, delay: 160 + i * 40, easing: 'cubic-bezier(.3,1.4,.5,1)',
            fill: 'backwards' }));
  });
  box.append(el('p', 'note',
    'Ogni riga e\' in percentuale del suo target: e\' l\'unico modo di mettere i passi e i litri d\'acqua sullo stesso disegno. Le voci senza pallino vuoto non avevano un valore la settimana prima.'));
  return box;
}

/** Va mostrata? La domenica sera, o il lunedi, se non l'hai gia' letta. */
function revisionePronta(k = today()) {
  const gi = dayIdx(k);
  if (gi !== 6 && gi !== 0) return false;
  const letta = S.settings?.revisioneLetta;
  if (!letta) return true;
  return Math.abs(Math.round((new Date(k) - new Date(letta)) / 864e5)) >= 5;
}
