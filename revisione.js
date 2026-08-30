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

/* --------------------------------------------------------------- periodo
 *
 * Di suo la revisione guarda la settimana chiusa, e resta il default per il
 * motivo di sempre: sette giorni sono l'unita' giusta, il giorno e' rumore e
 * il mese arriva tardi per correggere.
 *
 * Ma il ritmo settimanale non copre tutto. Le due settimane di ferie, il mese
 * fra due visite, i dieci giorni di un ciclo di scarico sono periodi veri, e
 * tagliarli a fette di sette li spezza a meta'. Da qui la scelta delle date.
 *
 * Una regola sopra le altre: il confronto e' sempre con il periodo di **pari
 * lunghezza** subito prima. Mettere venti giorni contro i sette precedenti
 * direbbe che hai camminato tre volte tanto — vero, e senza alcun significato.
 */
let revPeriodo = null;                 // null = la settimana chiusa
const REV_MAX_GG = 366;                // oltre l'anno non e' piu' una revisione

/** Le date da `a` indietro fino a `da`, dalla piu' recente alla piu' vecchia. */
function revGiorni(da, a) {
  const out = [];
  let k = a;
  while (k >= da && out.length < REV_MAX_GG) { out.push(k); k = addDays(k, -1); }
  return out;
}

/** I sette giorni chiusi, e i sette prima di quelli. */
function revPeriodoSettimana(k = today()) {
  // le pause non si tolgono qui: la settimana resta di sette giorni per le
  // date in testata. Si tolgono nel conteggio, dove falserebbero le medie
  const giorni = windowDays(k, 7);
  return { giorni, prima: windowDays(addDays(k, -7), 7),
           da: giorni[6], a: giorni[0], n: 7, custom: false,
           nome: 'settimana', primaNome: 'la settimana prima',
           confronto: 'Rispetto alla settimana prima', su: 'sulla settimana prima' };
}

/** Un periodo qualunque fra due date. Lo compone anche il cruscotto. */
function revPeriodoDate(d1, d2) {
  const [da, a] = d1 <= d2 ? [d1, d2] : [d2, d1];
  const giorni = revGiorni(da, a), n = giorni.length;
  // le preposizioni articolate si scrivono qui una volta: "Rispetto a la
  // settimana prima" e' il genere di dettaglio che fa sembrare l'app tradotta
  const q = n === 7 ? 'sette' : String(n);
  return { giorni, prima: lastDays(addDays(da, -1), n), da, a, n, custom: true,
           nome: 'periodo', primaNome: `i ${q} giorni prima`,
           confronto: `Rispetto ai ${q} giorni prima`, su: `sui ${q} giorni prima` };
}

/** Quello scelto dall'utente, se c'e'; altrimenti la settimana chiusa. */
function revPeriodoAttivo(k = today()) {
  if (!revPeriodo || !revPeriodo.da || !revPeriodo.a) return revPeriodoSettimana(k);
  return revPeriodoDate(revPeriodo.da, revPeriodo.a);
}

/** "12 mar - 18 mar", che in testata si legge meglio di due date ISO. */
function revEtichetta(per) {
  const MM = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu',
              'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const f = k => `${+k.slice(8)} ${MM[+k.slice(5, 7) - 1]}`;
  return `${f(per.da)} \u2013 ${f(per.a)}`;
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
      || (typeof cardioDi === 'function' && cardioDi(x).length)
      || S.hyrox?.sessioni?.[x]?.fatto || S.log[x]?.allenamento === true).length;
    if (n) conta.push(n);
  }
  if (!conta.length) return 0;
  conta.sort((a, b) => a - b);
  return Math.max(1, Math.round(conta[Math.floor(conta.length / 2)]));
}

function revMetriche(per) {
  const filtra = g => typeof senzaPause === 'function' ? senzaPause(g) : g;
  // un periodo interamente in pausa non si filtra a zero: si lascia com'e',
  // altrimenti non resterebbe niente da confrontare e la revisione direbbe
  // "nessun dato" quando invece i dati ci sono, sono solo da non giudicare
  const q = filtra(per.giorni), p0 = filtra(per.prima);
  const questa = q.length ? q : per.giorni;
  const prima = p0.length ? p0 : per.prima;
  const cons = g => g.map(x => S.log[x] ? consumed(x) : null).filter(m => m && m.kcal > 400);
  const cm = (g, id) => { const c = cons(g); return c.length ? c.reduce((a, m) => a + m[id], 0) / c.length : null; };
  const md = (g, id) => mediaSu(g, x => S.log[x]?.[id]);
  const sed = g => contaSu2(g, x => (typeof serieDelGiorno === 'function' && serieDelGiorno(x).length)
      || (typeof cardioDi === 'function' && cardioDi(x).length)
    || S.hyrox?.sessioni?.[x]?.fatto || S.log[x]?.allenamento === true);
  const T = D.target;
  // con HYROX spento il numero di sedute a settimana non lo dichiara nessuno:
  // si prende il ritmo abituale delle ultime otto settimane, non una costante
  // l'obiettivo e' per settimana: su un periodo di altra lunghezza si scala,
  // altrimenti un mese risulterebbe sempre "sopra" e cinque giorni sempre sotto
  const perSett = (typeof usaHyrox === 'function' && usaHyrox()
    && S.hyrox?.profilo?.sedute) || seduteAbituali(per.a) || 3;
  const seduteObiettivo = Math.max(1, Math.round(perSett * per.n / 7));

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
      pre: contaSu2(prima, x => S.log[x]?.peso != null), tgt: per.n, unit: '', dec: 0, verso: 'su' }
  ];
}

/**
 * Cosa non ha funzionato, come si sistema, e la UNA cosa da cambiare.
 * L'ordine di priorita' non e' l'ordine in cui i controlli sono scritti: e'
 * quello dell'impatto reale. Il sonno prima dei passi, il registro prima delle
 * fibre, perche' senza dati non si corregge niente.
 */
function revDiagnosi(per) {
  const questa = per.giorni;
  const M = revMetriche(per);
  // "questa settimana" e "nel periodo" non sono la stessa frase: la diagnosi
  // deve leggersi uguale in entrambi i casi, e non c'e' modo di scriverlo una
  // volta sola senza che una delle due suoni sbagliata
  const NP = per.custom ? 'nel periodo' : 'in settimana';
  const m = id => M.find(x => x.id === id);
  const T = D.target;
  const errori = [];
  const agg = (peso, id, t, cosa, come) => errori.push({ peso, id, t, cosa, come });

  const reg = m('registro');
  if (reg.ora <= Math.floor(per.n / 2)) agg(100, 'registro', 'Troppi giorni senza pesata',
    `${reg.ora} pesate su ${per.n}. Sotto la meta' la media mobile non significa niente, e senza quella il motore di previsione resta fermo alla formula: tutti i numeri che leggi valgono meno.`,
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
    `${sed.ora} sedute su ${sed.tgt} attese ${NP}. Un periodo sotto non rompe niente; se succede due volte di fila, il problema non e' la volonta\' ma il numero che hai scelto.`,
    `Se ${sed.tgt} sono troppe, abbassale a ${Math.max(2, sed.tgt - 1)}: un programma che rispetti batte sempre uno piu' ambizioso che salti.`);

  const kc = m('kcal');
  if (kc.ora != null) {
    const scarto = (kc.ora - T.kcal) / T.kcal;
    if (scarto < -0.12) agg(76, 'kcal', 'Mangi meno del piano',
      `Media ${nf(kc.ora)} kcal contro ${nf(T.kcal)} (${nf(scarto * 100)}%). Il deficit involontario e' il modo piu' comune di allenarsi senza costruire: il materiale non c'e'.`,
      'Guarda quale pasto salti piu' + 'spesso e sostituiscilo con qualcosa che mangeresti davvero. Non serve aggiungere alla cena quello che manca al mattino.');
    else if (scarto > 0.12) agg(70, 'kcal', 'Mangi piu\' del piano',
      `Media ${nf(kc.ora)} kcal contro ${nf(T.kcal)}. Su un periodo breve non e' un problema; se continua, la vita sale prima dei carichi.`,
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
  return { metriche: M, errori, priorita, giorni: questa, per };
}

/** Il giudizio di sintesi: una parola, e il perche'. */
function revVerdetto(diag) {
  const n = diag.errori.length;
  const grave = diag.errori.filter(e => e.peso >= 80).length;
  const nome = diag.per?.custom ? 'periodo' : 'settimana';
  if (!n) return { parola: 'Impeccabile', d: 'Nessuno scostamento degno di nota. Continua cosi\' e lascia lavorare il tempo.' };
  if (grave === 0 && n <= 2) return { parola: 'Buona', d: 'Qualche dettaglio da limare, niente che cambi la direzione.' };
  if (grave === 0) return { parola: 'Nella norma', d: 'Diverse cose da sistemare, nessuna urgente. Prendine una.' };
  if (grave === 1) return { parola: 'Da correggere', d: 'Una cosa importante e\' scivolata. Vale la pena occuparsene subito.' };
  return { parola: nome === 'settimana' ? 'Settimana storta' : 'Periodo storto',
           d: 'Piu\' di una cosa importante e\' saltata. Non e\' il momento di cambiare il piano: e\' il momento di tornare a registrare.' };
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
  // l'impegno e' settimanale per costruzione: si guarda sempre la settimana
  // chiusa, anche se sullo schermo l'utente sta guardando un altro periodo
  const sett = revPeriodoSettimana(k);
  if (imp.settimana === sett.giorni[0]) return null;      // e' quello in corso
  const ora = revDiagnosi(sett);
  const ancora = ora.errori.find(e => e.t === imp.cosa);
  return { imp, risolto: !ancora, gravita: ancora ? ancora.peso : 0,
           priorita: ora.priorita && ora.priorita.t === imp.cosa };
}

/* ================================================================= vista */
function viewRevisione(v) {
  const k = today();
  const per = revPeriodoAttivo(k);
  const diag = revDiagnosi(per);
  const ver = revVerdetto(diag);
  const questa = per.giorni;
  // la costanza deve coprire lo stesso tratto: costanze() conta all'indietro
  // dal giorno PRIMA di quello che gli passi, quindi si parte dal giorno dopo
  const co = typeof costanze === 'function' ? costanze(addDays(per.a, 1), per.n) : null;

  /* --- testata --- */
  const testa = el('div', 'rev-hero');
  testa.append(el('div', 'rev-kick',
    `${per.custom ? per.n + ' giorni' : 'Settimana chiusa'} · ${revEtichetta(per)}`));
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

  v.append(cardPeriodoRevisione(per));

  /* --- l'impegno della settimana scorsa ---
     Vale solo sulla settimana: e' un patto che si chiude di domenica, e su un
     periodo scelto a mano non ci sarebbe niente a cui agganciarlo. */
  const es = per.custom ? null : esitoImpegno(k);
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
  cn.append(el('h3', null, per.confronto));
  cn.append(el('div', 'sub', `Una riga per voce. Il pallino vuoto e\' ${per.primaNome}, quello pieno il periodo che stai guardando: la lunghezza del tratto e\' quanto ti sei mosso.`));
  cn.append(chartPendenza(diag.metriche, per));
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
    const optD = { dec: m.dec, segno: true, suffisso: ' ' + per.su };
    const uguale = d != null && Math.abs(d) < .5 / Math.pow(10, m.dec);
    box.innerHTML = `<span class="l">${esc(m.lab)}</span>
      <span class="v">${esc(testoNum(m.ora, { dec: m.dec }))}</span>
      <span class="d ${d == null ? '' : uguale ? '' : meglio ? 'up' : 'dn'}">${
        d == null ? 'niente prima' : uguale ? 'come ' + per.primaNome
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
    ce.append(el('p', 'note', 'Su questo tratto non emergono scostamenti degni di nota. E\' il caso piu\' raro e il piu\' noioso da leggere: va benissimo cosi\'.'));
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
    const imp = per.custom ? null : impegno();
    const sett = revPeriodoSettimana(k).giorni[0];
    if (imp && imp.settimana === sett) {
      const g = el('div', 'rev-imp preso');
      g.innerHTML = `<span class="t">Impegno preso</span>`
        + `<span class="d">${esc(imp.cosa)}</span>`;
      const via = el('button', 'btn wide');
      via.textContent = 'Ci ho ripensato, toglilo';
      via.onclick = () => { delete S.settings.impegno; save(); route(); };
      g.append(via);
      cp.append(g);
    } else if (!per.custom) {
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
  const bp = el('button', 'btn wide');
  bp.style.marginTop = '10px';
  bp.textContent = 'Scarica il resoconto in PDF';
  bp.onclick = () => scaricaResoconto(per);
  fine.append(bp);
  const b = el('button', 'btn wide pri', per.custom
    ? 'Ho letto, torna a oggi' : 'Ho letto, chiudi la revisione');
  b.style.marginTop = '8px';
  b.onclick = () => {
    // "letta" vale per la settimana: chiudere un periodo scelto a mano non
    // deve zittire la revisione di domenica, che e' un'altra cosa
    if (!per.custom) { S.settings.revisioneLetta = today(); save(); }
    location.hash = '#/oggi';
  };
  fine.append(b);
  v.append(fine);
}

/* --------------------------------------------------------- scelta del periodo
 *
 * Due modi, e non tre: la settimana chiusa (quella che l'app propone da sola
 * la domenica) oppure due date. Le scorciatoie da 14, 30 e 90 giorni non sono
 * un terzo modo, sono le date gia' riempite: nove volte su dieci e' quello che
 * si vuole, e chi vuole "dal 3 al 19" li corregge.
 */
function cardPeriodoRevisione(per) {
  const c = el('div', 'card flat');
  c.append(el('div', 'eyebrow', 'Periodo di riferimento'));

  const seg = el('div', 'seg');
  for (const [cust, lab] of [[false, 'Settimana chiusa'], [true, 'Scegli le date']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', String(per.custom === cust));
    b.onclick = () => {
      if (!cust) { revPeriodo = null; route(); return; }
      // si parte dalla settimana che stavi guardando, non da un mese a caso
      const s0 = revPeriodoSettimana();
      revPeriodo = { da: per.custom ? per.da : s0.da, a: per.custom ? per.a : s0.a };
      route();
    };
    seg.append(b);
  }
  c.append(seg);

  if (!per.custom) {
    c.append(el('p', 'hint',
      'I sette giorni chiusi, confrontati con i sette prima. E\' l\'unita\' su cui '
      + 'la revisione e\' costruita: il giorno da solo e\' rumore, il mese arriva '
      + 'tardi per correggere.'));
  } else {
    const g = el('div');
    g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px';
    const campo = (chiave, lab) => {
      const f = el('div', 'field', `<label>${lab}</label>`);
      const i = el('input');
      i.type = 'date'; i.value = per[chiave]; i.max = today();
      i.onchange = () => {
        if (!i.value) return;
        revPeriodo = { ...revPeriodo, [chiave]: i.value };
        route();
      };
      f.append(i); g.append(f);
    };
    campo('da', 'Dal giorno');
    campo('a', 'Al giorno');
    c.append(g);

    const rapide = el('div', 'seg wrap gg');
    rapide.style.marginTop = '4px';
    for (const n of [7, 14, 30, 90]) {
      const b = el('button', null, n + ' gg');
      b.setAttribute('aria-pressed', String(per.n === n && per.a === ieri()));
      b.onclick = () => {
        const gg = windowDays(today(), n);
        revPeriodo = { da: gg[n - 1], a: gg[0] };
        route();
      };
      rapide.append(b);
    }
    c.append(rapide);

    c.append(el('p', 'hint',
      `${per.n} giorni, confrontati con ${per.primaNome}. Il confronto e\' sempre con `
      + 'un tratto della stessa lunghezza: mettere venti giorni contro sette direbbe '
      + 'che hai camminato tre volte tanto, che e\' vero e non significa niente.'));
    if (per.a >= today())
      c.append(el('div', 'hint acciacco',
        'Il periodo arriva a oggi, e oggi non e\' finito: pasti, passi e acqua '
        + 'sono a meta\', e tirano giu\' le medie. Per un conto pulito fermati a ieri.'));
    if (per.n < 4)
      c.append(el('div', 'hint acciacco',
        `${per.n} giorni sono pochi perche\' le medie dicano qualcosa: quello che leggi `
        + 'qui sotto e\' piu\' vicino al singolo giorno che a una tendenza.'));
  }
  return c;
}

/**
 * Grafico a manubrio: una riga per metrica, due pallini (settimana prima,
 * questa) uniti da un segmento. L'asse e' uno solo — la percentuale del
 * proprio target — perche' e' l'unico metro che mette sulla stessa riga i
 * passi e i litri d'acqua. Il segmento colorato dice la direzione: verde
 * verso il target, ambra lontano.
 */
function chartPendenza(metriche, per) {
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
  leg.innerHTML = `<span><i class="dt vuoto"></i>${esc(per?.primaNome || 'il periodo prima')}</span>
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
    `Ogni riga e\' in percentuale del suo target: e\' l\'unico modo di mettere i passi e i litri d\'acqua sullo stesso disegno. Le voci senza pallino vuoto non avevano un valore ${per?.primaNome || 'prima'}.`));
  return box;
}

/* ================================================== il resoconto stampabile
 *
 * Serve a una cosa che sullo schermo non si puo' fare: portarselo via. Il
 * medico, il nutrizionista, l'allenatore non installano l'app per guardare i
 * tuoi numeri, e uno screenshot di sei schermate non e' un documento.
 *
 * Il contenuto e' lo stesso della schermata, nello stesso ordine, con le
 * stesse parole: verdetto, numeri a confronto, cosa non ha funzionato, come si
 * sistema, la sola cosa da cambiare. Riscriverlo per la carta avrebbe voluto
 * dire mantenere due testi che dicono la stessa cosa, e prima o poi due testi
 * che dicono cose diverse.
 *
 * I colori sono quelli del tema chiaro e sono fissi: un PDF si stampa su carta
 * bianca, e generare il resoconto scuro solo perche' il telefono e' in modalita'
 * notturna vorrebbe dire consegnare una pagina nera.
 */
const RES_C = {
  ink: [21, 26, 31], ink2: [74, 85, 96], ink3: [138, 147, 160],
  pine: [18, 89, 74], amber: [138, 93, 15],
  rule: [221, 227, 232], wash: [244, 247, 249], carta: [255, 255, 255]
};

function scaricaResoconto(per) {
  const bytes = pdfResoconto(per || revPeriodoAttivo());
  scaricaPdf(`resoconto-${per.da}_${per.a}.pdf`, bytes);
  toast('Resoconto scaricato');
}

function pdfResoconto(per) {
  const diag = revDiagnosi(per);
  const ver = revVerdetto(diag);
  const doc = pdfNuovo();
  const X = doc.M, W = doc.larghezza;
  const nome = (typeof profiloAttivo === 'function' && profiloAttivo()?.nome)
    || D.profilo?.nome || '';

  const titolo = t => {
    // il titolo si prende con se' anche tre righe di testo: un'intestazione
    // in fondo alla pagina e il suo paragrafo in cima alla successiva e' il
    // modo piu' rapido di far sembrare rotto un documento che non lo e'
    doc.serve(82);
    doc.y += 16;
    doc.linea(X, doc.y, X + W, doc.y, { col: RES_C.rule });
    doc.y += 13;
    doc.testo(t, X, doc.y, { size: 11, bold: true, col: RES_C.pine });
    doc.y += 8;
  };

  /* --- testata --- */
  doc.nuovaPagina();
  doc.y += 6;
  doc.testo('RESOCONTO', X, doc.y, { size: 8.5, bold: true, col: RES_C.ink3 });
  doc.y += 22;
  doc.testo(revEtichetta(per), X, doc.y, { size: 21, bold: true, col: RES_C.ink });
  doc.y += 15;
  doc.testo(`${per.n} giorni${nome ? ' · ' + nome : ''} · confronto con ${per.primaNome}`,
    X, doc.y, { size: 9.5, col: RES_C.ink2 });
  doc.y += 6;

  /* --- verdetto --- */
  const hVer = 30 + Math.max(1, pdfRighe(ver.d, W - 24, 9.5, false).length) * 13;
  doc.serve(hVer);
  doc.y += 12;
  doc.rett(X, doc.y, W, hVer, { fill: RES_C.wash });
  const y0 = doc.y;
  doc.y += 20;
  doc.testo(ver.parola, X + 12, doc.y, { size: 15, bold: true, col: RES_C.ink });
  doc.y += 8;
  doc.paragrafo(ver.d, { x: X + 12, w: W - 24, size: 9.5, col: RES_C.ink2, interlinea: 13 });
  doc.y = y0 + hVer;

  /* --- la tabella dei numeri --- */
  titolo('I numeri, e come si sono mossi');
  const col = [X, X + W - 300, X + W - 215, X + W - 130, X + W];
  const intest = ['Voce', 'Periodo', per.custom ? 'Prima' : 'Sett. prima', 'Target', 'Scarto'];
  doc.y += 14;
  intest.forEach((t, i) => doc.testo(t, col[i], doc.y,
    { size: 8, bold: true, col: RES_C.ink3, align: i ? 'right' : 'left' }));
  doc.y += 5;
  doc.linea(X, doc.y, X + W, doc.y, { col: RES_C.rule });

  for (const m of diag.metriche) {
    doc.serve(18);
    doc.y += 14;
    const val = (v, dec) => v == null ? '—' : nf(v, dec);
    const sc = m.ora == null || !m.tgt ? null : (m.ora - m.tgt) / m.tgt * 100;
    doc.testo(m.lab, col[0], doc.y, { size: 9.5, col: RES_C.ink });
    doc.testo(val(m.ora, m.dec) + (m.unit ? ' ' + m.unit : ''), col[1], doc.y,
      { size: 9.5, bold: true, col: RES_C.ink, align: 'right' });
    doc.testo(val(m.pre, m.dec), col[2], doc.y, { size: 9.5, col: RES_C.ink3, align: 'right' });
    doc.testo(val(m.tgt, m.dec), col[3], doc.y, { size: 9.5, col: RES_C.ink2, align: 'right' });
    // il colore dello scarto segue `verso`: per le calorie contano i due lati,
    // per le proteine solo quello sotto
    const bene = sc == null ? null : m.verso === 'target' ? Math.abs(sc) <= 8 : sc >= -8;
    doc.testo(sc == null ? '—' : (sc > 0 ? '+' : '') + nf(sc, 0) + '%', col[4], doc.y,
      { size: 9.5, col: bene === null ? RES_C.ink3 : bene ? RES_C.pine : RES_C.amber,
        align: 'right' });
    doc.y += 5;
    doc.linea(X, doc.y, X + W, doc.y, { col: RES_C.rule, w: .4 });
  }
  doc.y += 8;
  doc.paragrafo('Lo scarto e’ rispetto al target, non rispetto al periodo prima. '
    + 'Le medie di introito escludono i giorni senza pasti spuntati: una giornata '
    + 'non registrata non e’ una giornata a zero calorie.',
    { size: 8, col: RES_C.ink3, interlinea: 11 });

  /* --- il manubrio, lo stesso disegno della schermata --- */
  const righe = diag.metriche.filter(m => m.ora != null && m.tgt);
  if (righe.length) {
    titolo(per.confronto);
    const RH = 17, LAB = 108, hG = righe.length * RH + 30;
    doc.serve(hG + 14);
    doc.y += 12;
    const gy = doc.y, gx0 = X + LAB, gx1 = X + W - 26, MAXQ = 1.35;
    const PX = q => gx0 + Math.max(0, Math.min(MAXQ, q)) / MAXQ * (gx1 - gx0);
    for (const [q, lab] of [[0, '0'], [.5, '50%'], [1, 'target']]) {
      const x = PX(q), forte = q === 1;
      doc.linea(x, gy, x, gy + righe.length * RH + 6,
        { col: forte ? RES_C.ink3 : RES_C.rule, tratto: forte ? '3 3' : null });
      doc.testo(lab, x, gy + righe.length * RH + 17,
        { size: 7.5, col: RES_C.ink3, align: 'center' });
    }
    righe.forEach((m, i) => {
      const y = gy + i * RH + RH / 2;
      const qb = m.ora / m.tgt, qa = m.pre == null ? null : m.pre / m.tgt;
      const meglio = qa == null ? null : m.verso === 'target'
        ? Math.abs(qb - 1) < Math.abs(qa - 1) : qb > qa;
      const fermo = qa != null && Math.abs(qb - qa) < .02;
      const tinta = qa == null ? RES_C.pine : fermo ? RES_C.ink3
        : meglio ? RES_C.pine : RES_C.amber;
      doc.testo(m.lab, gx0 - 8, y + 2.6, { size: 8, col: RES_C.ink2, align: 'right' });
      if (qa != null && !fermo) {
        doc.linea(PX(qa), y, PX(qb), y, { col: tinta, w: 2 });
        doc.cerchio(PX(qa), y, 2.2, { fill: RES_C.carta, stroke: RES_C.ink3, w: 1 });
      }
      doc.cerchio(PX(qb), y, 3.2, { fill: tinta });
    });
    doc.y = gy + hG;
    doc.paragrafo('Ogni riga e’ in percentuale del suo target: e’ l’unico modo di '
      + 'mettere i passi e i litri d’acqua sullo stesso disegno. Il pallino vuoto e’ '
      + `${per.primaNome}, quello pieno il periodo del resoconto. Verde vuol dire verso il `
      + 'target, ambra lontano.', { size: 8, col: RES_C.ink3, interlinea: 11 });
  }

  /* --- cosa non ha funzionato --- */
  titolo(diag.errori.length ? 'Cosa non ha funzionato' : 'Non e’ andato storto niente');
  doc.y += 10;
  if (!diag.errori.length) {
    doc.paragrafo('Su questo tratto non emergono scostamenti degni di nota. E’ il caso '
      + 'piu’ raro e il piu’ noioso da leggere: va benissimo cosi’.',
      { size: 9.5, col: RES_C.ink2 });
  } else {
    doc.paragrafo('In ordine di quanto pesa sul risultato, non di quanto e’ evidente.',
      { size: 8.5, col: RES_C.ink3, interlinea: 12 });
    doc.y += 4;
    for (const [i, e] of diag.errori.entries()) {
      doc.serve(46);
      doc.y += 10;
      doc.testo(String(i + 1), X, doc.y + 9, { size: 12, bold: true, col: RES_C.ink3 });
      doc.testo(e.t, X + 20, doc.y + 9, { size: 10.5, bold: true, col: RES_C.ink });
      doc.y += 14;
      doc.paragrafo(e.cosa, { x: X + 20, w: W - 20, size: 9, col: RES_C.ink2, interlinea: 12.5 });
    }
  }

  /* --- come si sistema --- */
  if (diag.errori.length) {
    titolo('Come si sistema');
    doc.y += 10;
    doc.paragrafo('Una mossa concreta per ognuna. Non servono tutte insieme.',
      { size: 8.5, col: RES_C.ink3, interlinea: 12 });
    for (const e of diag.errori) {
      doc.serve(44);
      doc.y += 10;
      doc.testo(e.t, X, doc.y + 8, { size: 9.5, bold: true, col: RES_C.ink });
      doc.y += 13;
      doc.paragrafo(e.come, { size: 9, col: RES_C.ink2, interlinea: 12.5 });
    }
  }

  /* --- la priorita' --- */
  if (diag.priorita) {
    const lv = levaPerPriorita(diag.priorita);
    const testi = [diag.priorita.come, ...lv.map(l =>
      `${l.delta_kcal > 0 ? '+' : ''}${l.delta_kcal} kcal — ${l.azione}`)];
    const h = 46 + testi.reduce((a, t) =>
      a + pdfRighe(pdfTesto(t), W - 24, 9, false).length * 12.5, 0);
    doc.serve(h + 14);
    doc.y += 18;
    doc.rett(X, doc.y, W, h, { fill: RES_C.wash });
    doc.rett(X, doc.y, 3, h, { fill: RES_C.pine });
    const yb = doc.y;
    doc.y += 16;
    doc.testo('SE CAMBI UNA COSA SOLA', X + 12, doc.y, { size: 7.5, bold: true, col: RES_C.ink3 });
    doc.y += 15;
    doc.testo(diag.priorita.t, X + 12, doc.y, { size: 11.5, bold: true, col: RES_C.ink });
    doc.y += 7;
    for (const t of testi)
      doc.paragrafo(t, { x: X + 12, w: W - 24, size: 9, col: RES_C.ink2, interlinea: 12.5 });
    doc.y = yb + h;
  }

  /* --- chiusura --- */
  titolo('Come va letto');
  doc.y += 10;
  doc.paragrafo('Il bilancio e’ settimanale: una cena fuori piano non annulla sei giorni '
    + 'buoni e non va compensata saltando il pasto dopo. Questo foglio guarda il periodo '
    + 'intero proprio per non giudicare il singolo giorno.\n'
    + 'I valori di composizione corporea e di dispendio energetico che l’app calcola '
    + 'altrove sono stime, non misure: servono a dare una direzione. Qui dentro non ce ne '
    + 'sono, ma i target da cui nascono gli scarti sono quelli del tuo piano, e valgono '
    + 'quanto vale il piano.', { size: 9, col: RES_C.ink2, interlinea: 12.5 });

  /* --- pie' di pagina, quando si sa quante sono --- */
  doc.chiudi((d, i, n) => {
    const y = d.H - 26;
    d.linea(X, y, X + W, y, { col: RES_C.rule, w: .4 });
    d.testo(`Dieta · generato il ${today()}`, X, y + 10,
      { size: 7.5, col: RES_C.ink3 });
    d.testo(`${i} / ${n}`, X + W, y + 10, { size: 7.5, col: RES_C.ink3, align: 'right' });
  });

  return doc.bytes();
}

/** Va mostrata? La domenica sera, o il lunedi, se non l'hai gia' letta. */
function revisionePronta(k = today()) {
  const gi = dayIdx(k);
  if (gi !== 6 && gi !== 0) return false;
  const letta = S.settings?.revisioneLetta;
  if (!letta) return true;
  return Math.abs(Math.round((new Date(k) - new Date(letta)) / 864e5)) >= 5;
}
