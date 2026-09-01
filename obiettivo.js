/* L'obiettivo, e il fisico a cui punti.
 *
 * PERCHE' ESISTE. Chi apre quest'app per la prima volta e **non e' seguito da
 * un professionista** non sa quante calorie deve mangiare. Non e' una lacuna
 * dell'utente: e' la prima domanda del problema, e fino a qui l'app non la
 * faceva. `targetNeutro()` sputava un numero da Mifflin-St Jeor senza mai
 * chiedere *per fare cosa*, e `cardTarget()` — che il numero lo sa correggere
 * bene — si rifiuta di parlare finche' non ci sono due settimane di registro.
 * Cioe' esattamente nel momento in cui serve, non c'era niente.
 *
 * Chi invece un nutrizionista ce l'ha deve poter ignorare tutto questo: i suoi
 * numeri vengono da una persona che l'ha visto, e nessuna formula qui dentro
 * ne sa di piu'. La carta lo dice e non insiste.
 *
 * COSA FA. Tre passaggi, in quest'ordine:
 *
 *   1. **l'obiettivo** — perdere grasso, restare, ricomporsi, crescere;
 *   2. **il ritmo**, in percentuale del peso corporeo a settimana e non in
 *      chili fissi: mezzo chilo a 55 kg e mezzo chilo a 100 kg sono due
 *      deficit completamente diversi;
 *   3. **i macro**, che dipendono dall'obiettivo e non solo dalle calorie —
 *      in deficit le proteine salgono, perche' e' li' che la massa magra e' a
 *      rischio.
 *
 * Quello che NON fa, e sono le regole di sempre di questo file di progetto:
 * non si applica da solo, non promette una data, non da' voti. Produce una
 * proposta con scritto sopra da dove viene, e la proposta si accetta.
 */
'use strict';

/* ============================================================== l'obiettivo */
/**
 * I ritmi sono in **percentuale del peso a settimana**.
 *
 * Sono intervalli di pratica comune, non misure sull'utente — come le costanti
 * di Banister e le soglie di HYROX, e la UI deve continuare a dirlo. In
 * deficit, oltre l'1% a settimana la quota che se ne va come massa magra sale
 * in fretta; in crescita, oltre lo 0,5% quasi tutto quello che arriva in piu'
 * e' grasso da ritogliere dopo.
 */
const OBIETTIVI = [
  { id: 'cut', n: 'Perdere grasso', pct: -0.005,
    ritmi: [-0.0025, -0.005, -0.0075, -0.01],
    ico: 'giu',
    d: 'Un deficit calorico, con le proteine alte per tenere il muscolo che hai.',
    perche: 'Sotto il dispendio di circa il 15-20%. Il grasso e\' l\'unica cosa '
      + 'che si toglie in fretta, e anche cosi\' "in fretta" vuol dire mesi.',
    p_per_kg: 2.2 },
  { id: 'ricomp', n: 'Ricomporsi', pct: 0, ritmi: null,
    ico: 'uguale',
    d: 'Peso fermo, grasso giu\' e muscolo su. Lento, ma succede davvero.',
    perche: 'A calorie di mantenimento con proteine alte e pesi seri. Funziona '
      + 'soprattutto a chi si allena da poco, a chi riprende dopo una pausa e '
      + 'a chi ha ancora parecchio grasso da usare come carburante.',
    p_per_kg: 2.2 },
  { id: 'mant', n: 'Mantenere', pct: 0, ritmi: null,
    ico: 'uguale',
    d: 'Restare dove sei. Non e\' una pausa: e\' la fase piu\' lunga di tutte.',
    perche: 'Al dispendio misurato. Dopo un taglio serve, e non e\' tempo '
      + 'perso: e\' il periodo in cui il peso nuovo smette di essere una dieta '
      + 'e diventa come mangi.',
    p_per_kg: 1.8 },
  { id: 'bulk', n: 'Crescere', pct: 0.0025,
    ritmi: [0.0015, 0.0025, 0.0035, 0.005],
    ico: 'su',
    d: 'Un surplus piccolo. Piu' + '’ grande non fa crescere di piu\', fa ingrassare.',
    perche: 'Sopra il dispendio del 10-15%. Il muscolo si costruisce a un ritmo '
      + 'suo, che il cibo in eccesso non accelera: quello che avanza diventa '
      + 'grasso e basta.',
    p_per_kg: 1.9 }
];

const obiettivoDi = id => OBIETTIVI.find(o => o.id === id) || OBIETTIVI[1];

/** L'obiettivo scelto, con il suo ritmo. Nessuno di default: si sceglie. */
function obiettivoAttivo() {
  const o = S.settings.obiettivo;
  if (!o || !OBIETTIVI.some(x => x.id === o.id)) return null;
  const base = obiettivoDi(o.id);
  return { ...base, pct: o.pct ?? base.pct };
}

/* ================================================= dal dispendio alle calorie */
/**
 * Il metabolismo a riposo, Mifflin-St Jeor.
 * Sta qui perche' tre file lo riscrivevano identico, e tre copie di una
 * formula prima o poi diventano tre formule.
 */
function bmrDi(peso, altezza, eta, sesso) {
  const w = peso || 70, h = altezza || 175, a = eta || 30;
  return 10 * w + 6.25 * h - 5 * a + (sesso === 'f' ? -161 : 5);
}

/**
 * La proposta completa: calorie e macro, con scritto da dove escono.
 *
 * Il dispendio e' quello **misurato** appena il motore ha abbastanza storia;
 * prima e' Mifflin per il livello di attivita', e la carta lo dichiara — sono
 * due numeri con due affidabilita' diverse e confonderli e' il modo piu'
 * rapido di far seguire per sei settimane un target sbagliato.
 */
function pianoCalorico(idObiettivo, pctScelta, k = today()) {
  const ob = obiettivoDi(idObiettivo);
  const pct = pctScelta ?? ob.pct;
  const peso = lastWeight() ?? trendW(k) ?? D.profilo.peso_iniziale_kg ?? 70;
  const h = D.profilo.altezza_cm, eta = D.profilo.eta, sesso = D.profilo.sesso;
  const bmr = bmrDi(peso, h, eta, sesso);

  const E = typeof energyModel === 'function' ? energyModel(k) : { tdee: null, n: 0 };
  const misurato = E.n >= 2 && E.tdee > 0;
  const tdee = misurato ? E.tdee : Math.round(bmr * (D.modello?.laf || 1.35));

  /* Il ritmo in kg a settimana, e da li' le calorie: 7700 kcal per chilo e'
     la densita' del tessuto adiposo, gia' nel modello. Vale per il grasso —
     su un surplus e' un'approssimazione generosa, e la carta lo dice. */
  const kgSett = peso * pct;
  const grezzo = tdee + (kgSett * (D.modello?.kcal_per_kg || 7700)) / 7;

  /* Due pavimenti, e vince il piu' alto.
     Il primo e' il metabolismo a riposo per 1,1, che c'era gia'. Il secondo e'
     il 25% sotto il dispendio: sotto quella soglia il problema non e' piu' la
     ricomposizione, e il file di progetto lo scriveva da tempo senza che
     nessuno lo applicasse davvero. */
  const pav1 = Math.round(bmr * 1.1);
  const pav2 = Math.round(tdee * 0.75);
  const pavimento = Math.max(pav1, pav2);
  const kcal = Math.round(Math.max(pavimento, grezzo) / 10) * 10;
  const tagliato = kcal > grezzo + 5;

  /* --- i macro ---
     Le proteine vengono dall'obiettivo e non dalle calorie: sono la variabile
     che protegge la massa magra, e in deficit servono di piu' proprio perche'
     e' li' che la massa magra e' a rischio. Il grasso ha il suo pavimento
     (0,6 g/kg, letteratura, non una misura), sopra il quale sta al 25% delle
     calorie. I carboidrati prendono quello che resta: sono l'unico dei tre a
     non avere un fabbisogno minimo, ed e' per questo che fanno da cuscinetto. */
  const p = Math.round(peso * ob.p_per_kg);
  // pavimentoGrassi() prende un GIORNO, non un peso: passargli 69,8 gli
  // farebbe cercare la pesata del 1970. Il ripiego resta 0,6 g/kg.
  const gPav = (typeof pavimentoGrassi === 'function' && pavimentoGrassi(k))
    || Math.round(peso * 0.6);
  const g = Math.max(gPav, Math.round(kcal * 0.25 / 9));
  const c = Math.max(0, Math.round((kcal - p * 4 - g * 9) / 4));
  // 14 g ogni 1000 kcal e' la raccomandazione generale, e scala con quanto
  // mangi invece di essere un numero fisso uguale per tutti
  const fibre = Math.round(kcal / 1000 * 14);

  return {
    ob, pct, peso, bmr, tdee, misurato, nCal: E.n || 0,
    kgSett, kcal, grezzo: Math.round(grezzo), pavimento, tagliato,
    quotaTdee: tdee ? (kcal - tdee) / tdee : 0,
    macro: { kcal, p, c, g, fibre },
    gPavimento: gPav, pPerKg: ob.p_per_kg
  };
}

/* ============================================ il fisico di riferimento */
let FISICI = null;
/** Il catalogo, caricato una volta. Fallisce piano: senza, la carta lo dice. */
async function caricaFisici() {
  if (FISICI) return FISICI;
  try {
    const r = await fetch('data/fisici.json');
    FISICI = await r.json();
  } catch (e) { FISICI = { fisici: [] }; }
  return FISICI;
}

/** FFMI: massa magra sul quadrato dell'altezza, normalizzata a 1,80 m. */
function ffmi(lbm, altezzaCm) {
  if (!(lbm > 0 && altezzaCm > 0)) return null;
  const m = altezzaCm / 100;
  const grezzo = lbm / (m * m);
  return { grezzo, norm: grezzo + 6.1 * (1.8 - m) };
}

/**
 * Il fisico di riferimento, **riportato sulla tua altezza**.
 *
 * E' la parte che rende la cosa onesta invece di un poster. I centimetri di
 * qualcuno alto 1,90 non dicono niente a chi e' alto 1,65: quello che si
 * trasferisce sono i rapporti. Le circonferenze scalano con l'altezza; la
 * massa magra con il **quadrato** dell'altezza, che e' la definizione stessa
 * dell'FFMI — ed e' anche il motivo per cui il peso finale puo' venire molto
 * diverso da quello dichiarato senza che nessuno abbia sbagliato i conti.
 */
function scalaFisico(f, altezzaCm) {
  const h = altezzaCm || f.altezza_cm;
  const r = h / f.altezza_cm;
  const lbmOrig = f.peso_kg * (1 - f.bf_pct / 100);
  const lbm = lbmOrig * r * r;
  const peso = lbm / (1 - f.bf_pct / 100);
  const mis = {};
  for (const [id, v] of Object.entries(f.misure || {})) mis[id] = +(v * r).toFixed(1);
  return {
    ...f, altezza_cm: h, scalato: Math.abs(r - 1) > 0.005,
    fattore: r, peso_kg: +peso.toFixed(1), massa_magra_kg: +lbm.toFixed(1),
    misure: mis,
    rapporti: {
      vita_altezza: mis.vita ? +(mis.vita / h).toFixed(3) : null,
      torace_vita: mis.torace && mis.vita ? +(mis.torace / mis.vita).toFixed(3) : null
    },
    ffmi: ffmi(lbm, h)
  };
}

/**
 * Quanto chiede, e se e' roba che un corpo costruisce da solo.
 *
 * Non e' un giudizio sul fisico scelto ne' su chi lo sceglie: e' l'unica
 * informazione che serve prima di puntare a un numero, e non averla e' il
 * motivo per cui la gente insegue per anni una cosa che non succede.
 */
function verdettoFisico(fs, k = today()) {
  const C = typeof composition === 'function' ? composition(k) : null;
  const tetto = (D.profilo.sesso === 'f' ? 22 : 25);
  const n = fs.ffmi?.norm;
  const liv = n == null ? null
    : n > tetto ? 'oltre' : n > tetto - 1.5 ? 'tetto' : n > tetto - 4 ? 'alto' : 'ok';
  const eti = { oltre: 'oltre il limite naturale', tetto: 'al limite naturale',
                alto: 'impegnativo ma raggiungibile', ok: 'raggiungibile' }[liv];
  const dLbm = C?.lbm != null ? fs.massa_magra_kg - C.lbm : null;
  const dFm = C?.fm != null
    ? (fs.peso_kg * fs.bf_pct / 100) - C.fm : null;
  return { liv, eti, tetto, ffmi: n, dLbm, dFm, ora: C };
}

/** Lo scrive nel piano. Come tutto il resto: solo se lo chiedi tu. */
function applicaFisico(fs) {
  const p = piano();
  p.fisico = {
    id: fs.id, nome: fs.nome, opera: fs.opera, fonte: fs.fonte,
    nota: fs.nota, chiave: fs.chiave, scalato: fs.scalato,
    altezza_cm: fs.altezza_cm, peso_kg: fs.peso_kg, bf_pct: fs.bf_pct,
    bf_pct_citato: fs.bf_pct_citato,
    massa_magra_kg: fs.massa_magra_kg, misure: fs.misure, rapporti: fs.rapporti
  };
  /* Le misure del target vivono anche su D.misure[].target: e' da li' che
     escono la colonna "Manca" e la sagoma tratteggiata di Corpo. Cambiare il
     fisico e lasciare quelle vecchie darebbe una figura di riferimento che non
     e' ne' l'una ne' l'altra. */
  p.misureTarget = { ...fs.misure };
  save(); fondiPiano();
}

/* ================================================================ le carte */
/**
 * "Quanto devo mangiare?"
 *
 * E' la prima carta del passo "Quanto mangiare", prima di tutto il resto,
 * perche' e' la prima domanda — e finora l'unica schermata che sapeva
 * rispondere (`cardTarget`) taceva per le prime due settimane.
 */
function cardObiettivo(k = today()) {
  const c = el('div', 'card');
  c.append(el('div', 'eyebrow', 'Per fare cosa'));
  c.append(el('h2', 'sec', 'Il tuo obiettivo'));
  c.lastChild.style.marginTop = '0';

  /* Chi ha un professionista non ha bisogno di niente di tutto questo, e
     dirglielo per primo e' piu' onesto che lasciarglielo scoprire in fondo. */
  c.append(el('p', 'muted',
    'Se ti segue un nutrizionista o un medico, i numeri sono i suoi: scrivili '
    + 'qui sotto a mano e salta questa carta. Nessuna formula qui dentro ha '
    + 'visto il tuo sangue ne\' la tua storia. Serve a chi non ha nessuno che '
    + 'gliel\'abbia detto, e non deve tirare a indovinare.'));

  if (!(D.profilo.altezza_cm > 0 && D.profilo.eta > 0
        && (lastWeight() || D.profilo.peso_iniziale_kg) > 0)) {
    c.append(el('div', 'hint',
      'Prima serve il profilo: peso, altezza ed eta\'. Senza quelli non si '
      + 'calcola nemmeno il metabolismo a riposo, che e\' il punto di partenza '
      + 'di tutto il resto.'));
    const b = el('button', 'btn wide');
    b.style.marginTop = '8px';
    b.textContent = 'Vai a "Chi sei"';
    b.onclick = () => { pianoTab = 'profilo'; route(); };
    c.append(b);
    return c;
  }

  const att = obiettivoAttivo();
  const scelto = att ? att.id : null;

  /* --- i quattro obiettivi --- */
  for (const o of OBIETTIVI) {
    const pc = pianoCalorico(o.id, o.id === scelto ? att.pct : null, k);
    const b = el('button', 'ob-r' + (o.id === scelto ? ' on' : ''));
    b.innerHTML = `<span class="k">${nf(pc.kcal)}<em>kcal</em></span>
      <span class="body"><span class="t">${esc(o.n)}</span>
      <span class="d">${o.d}</span>
      <span class="s">${pc.kgSett === 0 ? 'peso fermo'
        : `${pc.kgSett > 0 ? '+' : ''}${nf(pc.kgSett, 2)} kg a settimana`}${
        pc.tagliato ? ' · alzato al minimo di sicurezza' : ''}</span></span>`;
    b.onclick = () => sheetObiettivo(o.id, k);
    c.append(b);
  }

  const pc = pianoCalorico(scelto || 'ricomp', att?.pct, k);
  c.append(el('p', 'note',
    (pc.misurato
      ? `Il dispendio da cui partono e\' <strong>${nf(pc.tdee)} kcal</strong>, misurato sui tuoi dati e ricalibrato ${pc.nCal} volte.`
      : `Il dispendio da cui partono e\' <strong>${nf(pc.tdee)} kcal</strong>, e per ora e\' una <strong>formula</strong> (Mifflin-St Jeor per il livello di attivita\'): il motore non ha ancora abbastanza registro per misurarlo. Fra un paio di settimane questo numero diventa tuo, e i target vanno rifatti da qui.`)
    + ' I ritmi sono intervalli di pratica comune, non misure su di te.'));

  if (att) {
    const stessa = Math.abs(pc.kcal - D.target.kcal) < 30;
    c.append(el('div', 'hint',
      stessa
        ? `Stai puntando a <strong>${esc(att.n).toLowerCase()}</strong>, e i tuoi target sono gia\' quelli che ne escono.`
        : `Stai puntando a <strong>${esc(att.n).toLowerCase()}</strong>, ma i tuoi target dicono ${nf(D.target.kcal)} kcal invece di ${nf(pc.kcal)}. Riaprilo per aggiornarli.`));
  }
  return c;
}

/** La conferma: il ritmo si sceglie qui, e i macro si vedono prima. */
function sheetObiettivo(id, k = today()) {
  let pct = null;
  const w = el('div');
  const dis = el('div');

  const disegna = () => {
    const pc = pianoCalorico(id, pct, k);
    const o = pc.ob;
    dis.innerHTML = '';
    dis.append(el('div', 'eyebrow', 'Obiettivo'));
    dis.append(el('h2', 'sec', esc(o.n)));
    dis.lastChild.style.marginTop = '0';
    dis.append(el('p', 'muted', o.perche));

    /* --- il ritmo, dove ha senso sceglierlo --- */
    if (o.ritmi) {
      dis.append(el('div', 'eyebrow', 'A che ritmo'));
      const seg = el('div', 'seg wrap');
      for (const v of o.ritmi) {
        const q = pianoCalorico(id, v, k);
        const b = el('button', null,
          `${q.kgSett > 0 ? '+' : ''}${nf(q.kgSett, 2)} kg/sett`);
        b.setAttribute('aria-pressed', String(Math.abs(v - pc.pct) < 1e-6));
        // un ritmo che il pavimento taglia non e' quel ritmo: chiederlo e
        // ottenere le calorie di quello prima e' un bottone che mente
        if (q.tagliato) b.classList.add('bloc');
        b.onclick = () => { pct = v; disegna(); };
        seg.append(b);
      }
      dis.append(seg);
      if (o.ritmi.some(v => pianoCalorico(id, v, k).tagliato))
        dis.append(el('div', 'hint',
          'I ritmi barrati chiedono meno calorie del pavimento: sceglierli da\' '
          + 'comunque il pavimento, quindi il peso scenderebbe piu\' piano di '
          + 'quanto dice l\'etichetta. Sul tuo peso, un deficit piu\' aggressivo '
          + 'di cosi\' non sta in piedi.'));
      dis.append(el('p', 'hint',
        `E\' <strong>${nf(Math.abs(pc.pct) * 100, 2)}% del tuo peso a settimana</strong>. `
        + (pc.pct < 0
          ? 'Oltre l\'1% la quota che se ne va come massa magra sale in fretta, e quello che perdi non torna gratis.'
          : pc.pct > 0
            ? 'Oltre lo 0,5% quasi tutto quello che arriva in piu\' e\' grasso: il muscolo si costruisce a un ritmo suo, e il cibo in eccesso non lo accelera.'
            : 'A peso fermo il numero sulla bilancia non dice niente: qui a misurare sono il metro e lo specchio.')));
    }

    /* --- il conto --- */
    const r = el('div', 'read');
    r.innerHTML = `<span>dispendio <b>${nf(pc.tdee)}</b></span>
      <span>${pc.quotaTdee >= 0 ? '+' : ''}${nf(pc.quotaTdee * 100, 0)}%</span>
      <span>target <b>${nf(pc.kcal)}</b></span>`;
    dis.append(r);
    if (pc.tagliato) dis.append(el('div', 'hint',
      `Il ritmo che hai scelto chiederebbe ${nf(pc.grezzo)} kcal, ma il pavimento e\' `
      + `<strong>${nf(pc.pavimento)}</strong> — il piu\' alto fra il tuo metabolismo a `
      + 'riposo per 1,1 e il 25% sotto il dispendio. Sotto quella soglia non stai piu\' '
      + 'ricomponendo: stai solo mangiando poco, e il corpo risponde spegnendo cose.'));

    /* --- i macro --- */
    const m = pc.macro;
    const g = el('div', 'cmp');
    g.append(el('div', 'cmp-h',
      '<span></span><span>Nuovo</span><span>Ora</span><span>Diff</span>'));
    const riga = (lab, nuovo, ora, unit) => {
      const d = nuovo - (ora || 0);
      g.append(el('div', 'cmp-r',
        `<span>${lab}</span><span class="mono">${nf(nuovo)}</span>
         <span class="mono muted">${ora ? nf(ora) : '—'}</span>
         <span class="mono ${Math.abs(d) < 1 ? 'good' : ''}">${
           Math.abs(d) < 1 ? '=' : (d > 0 ? '+' : '') + nf(d)}<em>${unit}</em></span>`));
    };
    riga('Calorie', m.kcal, D.target.kcal, '');
    riga('Proteine', m.p, D.target.p, ' g');
    riga('Carboidrati', m.c, D.target.c, ' g');
    riga('Grassi', m.g, D.target.g, ' g');
    riga('Fibre', m.fibre, D.target.fibre, ' g');
    dis.append(g);
    dis.append(el('p', 'note',
      `Le proteine sono <strong>${nf(pc.pPerKg, 1)} g per kg</strong> e non scalano con le `
      + 'calorie: sono la variabile che protegge la massa magra, e in deficit servono di '
      + `piu\' proprio perche\' li\' e\' a rischio. I grassi non scendono sotto ${nf(pc.gPavimento)} g `
      + '(0,6 g/kg, valore di letteratura e non una misura su di te), i carboidrati '
      + 'prendono quello che resta. Le fibre sono 14 g ogni 1000 kcal.'));

    const ok = el('button', 'btn wide pri', 'Usa questi target');
    ok.onclick = () => {
      S.settings.obiettivo = { id, pct: pc.pct, k: today() };
      const pl = piano();
      pl.target = { ...pl.target, ...m, p_per_kg: pc.pPerKg };
      S.settings.targetStorico ||= [];
      S.settings.targetStorico.push({ k: today(), kcal: m.kcal, nota: o.n });
      S.model.rev = (S.model.rev || 0) + 1;
      save(); fondiPiano(); closeSheet(); route();
      toast('Obiettivo: ' + o.n.toLowerCase());
    };
    dis.append(ok);
    const solo = el('button', 'btn wide', 'Tieni solo l\'obiettivo, non i target');
    solo.style.marginTop = '8px';
    solo.onclick = () => {
      S.settings.obiettivo = { id, pct: pc.pct, k: today() };
      save(); closeSheet(); route();
      toast('Obiettivo segnato, target invariati');
    };
    dis.append(solo);
    dis.append(el('p', 'hint',
      'Il secondo serve a chi i target li ha gia\' da qualcun altro: l\'app sa cosa '
      + 'stai cercando di fare — e la revisione settimanale lo usa per giudicare — '
      + 'senza toccare i numeri che segui.'));
  };

  disegna();
  w.append(dis);
  sheet(w);
}

/* ==================================================== il fisico di riferimento */
/** La carta: che fisico stai puntando, e cosa chiede. */
function cardFisico(k = today()) {
  const c = el('div', 'card');
  c.append(el('div', 'eyebrow', 'Il metro del "manca"'));
  c.append(el('h2', 'sec', 'Fisico di riferimento'));
  c.lastChild.style.marginTop = '0';

  const t = D.target_fisico;
  if (t?.nome) {
    c.append(el('div', 'fis-h',
      `<span class="t">${esc(t.nome)}</span>`
      + (t.opera ? `<span class="d">${esc(t.opera)}</span>` : '')));
    const r = el('div', 'read');
    r.innerHTML = `<span><b>${nf(t.peso_kg, 1)}</b> kg</span>
      <span><b>${nf(t.bf_pct, 0)}</b>% grasso</span>
      <span>vita <b>${nf(t.misure?.vita, 0)}</b></span>`;
    c.append(r);
    if (t.scalato) c.append(el('div', 'hint',
      `Riportato sulla tua altezza (${nf(D.profilo.altezza_cm)} cm): i centimetri `
      + 'dichiarati valgono per la statura di chi li ha dichiarati, e su un corpo '
      + 'piu\' alto o piu\' basso non vogliono dire la stessa cosa.'));
    if (t.chiave) c.append(el('p', 'muted', esc(t.chiave)));
  } else {
    c.append(el('p', 'muted',
      'Nessuno, per ora. La colonna "Manca" della scheda Corpo e la sagoma '
      + 'tratteggiata hanno bisogno di un riferimento: puoi sceglierne uno da '
      + 'un elenco, o lasciar perdere e guardare solo come ti muovi tu.'));
  }

  const b = el('button', 'btn wide' + (t?.nome ? '' : ' pri'));
  b.style.marginTop = '10px';
  b.textContent = t?.nome ? 'Cambia riferimento' : 'Scegline uno';
  b.onclick = () => sheetFisici(k);
  c.append(b);
  c.append(el('p', 'note',
    'Le misure di queste persone sono <strong>dichiarazioni</strong> — interviste, '
    + 'schede promozionali, articoli — e nessuno le ha mai verificate col metro. '
    + 'Servono a dare una direzione alle proporzioni, non un numero da centrare al '
    + 'decimo. E i tuoi non saranno mai quelli: l\'ossatura non si allena.'));
  return c;
}

/** L'elenco. Ognuno riportato sulla tua altezza, con cosa chiederebbe. */
function sheetFisici(k = today()) {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Dichiarazioni, non misure'));
  w.append(el('h2', 'sec', 'A che fisico punti'));
  w.lastChild.style.marginTop = '0';
  const cor = el('div');
  cor.append(el('p', 'muted', 'Carico l\'elenco...'));
  w.append(cor);
  sheet(w);

  caricaFisici().then(F => {
    cor.innerHTML = '';
    const h = D.profilo.altezza_cm;
    if (!F.fisici?.length) {
      cor.append(el('p', 'muted',
        'L\'elenco non si e\' caricato. Serve la connessione la prima volta; '
        + 'poi resta in cache.'));
      return;
    }
    if (!(h > 0)) cor.append(el('div', 'hint',
      'Senza la tua altezza i numeri restano quelli dichiarati da loro, e non '
      + 'vogliono dire granche\': compilala in "Chi sei" e questa pagina li '
      + 'riporta sulla tua statura.'));

    cor.append(el('p', 'muted',
      'Ordinati per quanta massa magra chiedono sulla tua struttura. Il proprio '
      + 'sesso non filtra niente: le proporzioni si guardano lo stesso, e '
      + 'nascondere meta\' elenco sarebbe una scelta fatta al posto tuo.'));

    const mio = D.profilo.sesso || 'm';
    const lista = F.fisici.slice().sort((a, b) =>
      (a.sesso === mio ? 0 : 1) - (b.sesso === mio ? 0 : 1)
      || (a.peso_kg * (1 - a.bf_pct / 100)) / Math.pow(a.altezza_cm / 100, 2)
       - (b.peso_kg * (1 - b.bf_pct / 100)) / Math.pow(b.altezza_cm / 100, 2));

    for (const f of lista) {
      const fs = scalaFisico(f, h);
      const v = verdettoFisico(fs, k);
      const b = el('button', 'fis-r' + (D.target_fisico?.id === f.id ? ' on' : ''));
      b.innerHTML = `<span class="body">
          <span class="t">${esc(f.nome)}
            <span class="pill ${v.liv === 'oltre' ? 'warn' : v.liv === 'tetto' ? 'amb' : 'ok'}">${esc(v.eti)}</span></span>
          <span class="d">${esc(f.opera)}</span>
          <span class="n mono">${nf(fs.peso_kg, 1)} kg · ${nf(f.bf_pct, 0)}% ·
            vita ${nf(fs.misure.vita, 0)} · FFMI ${nf(v.ffmi, 1)}</span>
          ${v.dLbm != null ? `<span class="s">${v.dLbm > 0
            ? `+${nf(v.dLbm, 1)} kg di massa magra da costruire`
            : `${nf(v.dLbm, 1)} kg di massa magra rispetto a ora`}${
            v.dFm != null && v.dFm < 0 ? `, ${nf(Math.abs(v.dFm), 1)} kg di grasso da togliere` : ''}</span>` : ''}
        </span><span class="go">›</span>`;
      b.onclick = () => sheetFisico(fs, v, k);
      cor.append(b);
    }

    cor.append(el('p', 'note',
      `L'<strong>FFMI</strong> e\' la massa magra divisa il quadrato dell'altezza, `
      + `normalizzata a 1,80 m: e\' il modo in cui si confronta la muscolosita\' fra `
      + `corpi di statura diversa. Sopra ${mio === 'f' ? 22 : 25} si esce da quello che `
      + `un corpo costruisce da solo — e\' il riferimento piu\' citato, da uno studio del `
      + `1995 su atleti prima e dopo l'era degli steroidi. Come tutte le soglie qui `
      + `dentro e\' pratica comune e non una legge: qualcuno lo supera senza niente, e `
      + `moltissimi non ci arrivano mai.`));

    if (D.target_fisico?.nome) {
      const via = el('button', 'btn wide');
      via.style.marginTop = '12px';
      via.textContent = 'Non voglio un riferimento';
      via.onclick = () => {
        const p = piano();
        delete p.fisico; delete p.misureTarget;
        save(); fondiPiano(); closeSheet(); route();
        toast('Riferimento tolto');
      };
      cor.append(via);
      cor.append(el('p', 'hint',
        'Senza riferimento restano i tuoi numeri e come si muovono, che e\' '
        + 'l\'unico confronto davvero tuo. La colonna "Manca" sparisce.'));
    }
  });
}

/** La scheda di uno, con tutto quello che chiede prima di sceglierlo. */
function sheetFisico(fs, v, k = today()) {
  const w = el('div');
  w.append(el('div', 'eyebrow', esc(fs.opera)));
  w.append(el('h2', 'sec', esc(fs.nome)));
  w.lastChild.style.marginTop = '0';

  const r = el('div', 'read');
  r.innerHTML = `<span><b>${nf(fs.peso_kg, 1)}</b> kg</span>
    <span><b>${nf(fs.bf_pct, 0)}</b>% grasso</span>
    <span>FFMI <b>${nf(v.ffmi, 1)}</b></span>`;
  w.append(r);

  if (fs.scalato) w.append(el('div', 'hint',
    `Questi numeri sono <strong>riportati sui tuoi ${nf(fs.altezza_cm)} cm</strong>. `
    + `Dichiarati erano ${nf(fs.peso_kg / (fs.fattore * fs.fattore), 1)} kg a `
    + `${nf(fs.altezza_cm / fs.fattore)} cm: le circonferenze scalano con l'altezza, la `
    + 'massa magra col suo quadrato, ed e\' per questo che il peso puo\' venire molto '
    + 'diverso senza che nessuno abbia sbagliato i conti.'));

  /* --- il verdetto: e' roba che un corpo costruisce da solo? --- */
  const box = el('div', 'flag ' + (v.liv === 'oltre' ? 'bad'
    : v.liv === 'tetto' ? 'warn' : 'ok'));
  const testo = {
    oltre: `FFMI ${nf(v.ffmi, 1)}, sopra il ${v.tetto} che si prende come limite di quello `
      + 'che un corpo costruisce da solo. Non e\' un divieto ed e\' una soglia di pratica '
      + 'comune, non una legge — ma inseguire per anni un numero che quasi nessuno '
      + 'raggiunge senza aiuti e\' il modo piu\' sicuro di sentirsi sempre indietro.',
    tetto: `FFMI ${nf(v.ffmi, 1)}, a un soffio dal ${v.tetto} che si prende come limite `
      + 'naturale. Si puo\' fare, e vuol dire anni in cui l\'allenamento e\' la cosa piu\' '
      + 'importante che fai.',
    alto: `FFMI ${nf(v.ffmi, 1)}: parecchio, ma dentro quello che si costruisce. `
      + 'Sono anni di lavoro, non mesi.',
    ok: `FFMI ${nf(v.ffmi, 1)}: e\' nella zona che la maggior parte delle persone puo\' `
      + 'raggiungere allenandosi con costanza.'
  }[v.liv] || '';
  box.innerHTML = `<div class="ico">${v.liv === 'ok' ? '=' : '!'}</div>
    <div class="grow"><h4>${esc(v.eti)}</h4><p>${testo}</p></div>`;
  w.append(box);

  /* --- da dove sei a li' --- */
  if (v.dLbm != null || v.dFm != null) {
    const g = el('div', 'cmp');
    g.append(el('div', 'cmp-h',
      '<span></span><span>Ora</span><span>Li\'</span><span>Manca</span>'));
    const riga = (lab, ora, la, dec, unit) => {
      if (ora == null || la == null) return;
      const d = la - ora;
      g.append(el('div', 'cmp-r',
        `<span>${lab}</span><span class="mono">${nf(ora, dec)}</span>
         <span class="mono muted">${nf(la, dec)}</span>
         <span class="mono">${d > 0 ? '+' : ''}${nf(d, dec)}<em>${unit}</em></span>`));
    };
    riga('Massa magra', v.ora?.lbm, fs.massa_magra_kg, 1, ' kg');
    riga('Massa grassa', v.ora?.fm, fs.peso_kg * fs.bf_pct / 100, 1, ' kg');
    riga('Peso', v.ora?.peso, fs.peso_kg, 1, ' kg');
    for (const m of D.misure) {
      if (fs.misure[m.id] == null) continue;
      riga(m.label, lastMeas(m.id), fs.misure[m.id], 1, ' cm');
    }
    w.append(g);
    w.append(el('p', 'note',
      'Nessuna previsione su quanto ci vuole, e non e\' una dimenticanza: '
      + 'dipende da quanto ti alleni da quanti anni, e una data qui sarebbe una '
      + 'scadenza da mancare. Quello che l\'app sa dire sul tempo sta in "Dove '
      + 'stai andando", e lo dice come intervallo — quando i dati bastano.'));
  }

  if (fs.nota) w.append(el('p', 'muted', esc(fs.nota)));
  if (fs.bf_pct_citato) w.append(el('div', 'hint',
    `Nelle interviste si legge <strong>${nf(fs.bf_pct_citato)}%</strong> di grasso. `
    + `Quella e\' condizione da giorno di riprese, non uno stato in cui si vive: qui il `
    + `riferimento operativo e\' ${nf(fs.bf_pct)}%, che da\' lo stesso aspetto e si tiene.`));

  const ok = el('button', 'btn wide pri', 'Usa questo come riferimento');
  ok.onclick = () => {
    applicaFisico(fs); closeSheet(); route();
    toast('Riferimento: ' + fs.nome);
  };
  w.append(ok);
  const ind = el('button', 'btn wide', 'Torna all\'elenco');
  ind.style.marginTop = '8px';
  ind.onclick = () => sheetFisici(k);
  w.append(ind);
  sheet(w);
}
