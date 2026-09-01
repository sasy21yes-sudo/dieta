/* ROAD TO HYROX — formato di gara, passaggi, simulazioni, piano.
   Il dominio (sequenza, standard, allenamenti, fasi) sta in data/hyrox.json.
   Qui c'e' solo il motore e la vista. */
'use strict';

let HX = null;                                   // data/hyrox.json

/* ------------------------------------------------------------ tempo */
/** Secondi -> m:ss. */
function mmss(s) {
  if (s == null || !isFinite(s)) return '—';
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
/** Secondi -> h:mm:ss, che e' come si legge un tempo di gara. */
function hms(s) {
  if (s == null || !isFinite(s)) return '—';
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
           : `${m}:${String(s % 60).padStart(2, '0')}`;
}
/** Accetta "5:42", "1:28:14" o secondi secchi. */
function parseTempo(v) {
  if (v == null) return null;
  const t = String(v).trim().replace(',', '.');
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const p = t.split(':').map(x => parseFloat(x));
  if (p.some(x => isNaN(x))) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2]
       : p.length === 2 ? p[0] * 60 + p[1] : p[0];
}

/* ------------------------------------------------------------ stato */
function HXS() {
  S.hyrox ||= {};
  const h = S.hyrox;
  h.profilo ||= {};
  h.profilo.categoria ||= 'open';
  h.profilo.sesso ||= (D.profilo.sesso || 'm');
  h.profilo.target_min ||= 90;
  h.pb ||= {};
  h.sim ||= [];
  h.sessioni ||= {};
  h.checklist ||= {};
  // se non ha ancora detto niente, si assume palestra attrezzata: e' il caso
  // piu' comune, e chi non ha l'attrezzo se ne accorge subito
  h.attrezzi ||= null;
  return h;
}
const stazioni = () => HX?.stazioni || [];
/** L'attrezzatura dichiarata; null = ha tutto. */
function attrezziMiei() {
  const a = HXS().attrezzi;
  return a === null ? (HX?.attrezzatura || []).map(x => x.id) : a;
}
const hoAttrezzo = id => !id || attrezziMiei().includes(id);
/** Un allenamento e' fattibile se hai TUTTO quello che richiede. */
const fattibile = a => (a.richiede || []).every(hoAttrezzo);
const stazione = id => stazioni().find(s => s.id === id) || null;

/** Giorni alla gara. Un conto alla rovescia su una DATA DI GARA e' legittimo:
    la gara esiste davvero in calendario. Quello vietato in questo progetto e'
    il conto alla rovescia su un obiettivo di peso, che una data non ce l'ha. */
function giorniAllaGara() {
  const d = HXS().profilo.data_gara;
  if (!d) return null;
  return Math.round((new Date(d) - new Date(today())) / 864e5);
}
function settimaneAllaGara() {
  const g = giorniAllaGara();
  return g == null ? null : Math.max(0, Math.ceil(g / 7));
}
function faseCorrente() {
  const w = settimaneAllaGara();
  if (w == null) return HX.fasi[0];
  return HX.fasi.find(f => w <= f.da_settimana && w >= f.a_settimana) || HX.fasi[0];
}

/* -------------------------------------------------------- ripartizione */
/**
 * Come si spartisce il tempo fra corsa, stazioni e roxzone.
 * Se c'e' almeno una simulazione registrata usa LA TUA ripartizione: le medie
 * del file valgono finche' non ci sono dati tuoi, non un minuto di piu'.
 */
function ripartizione() {
  const sims = HXS().sim.filter(s => s.tipo === 'intera' && s.totale > 0);
  if (!sims.length) return { ...HX.ripartizione, mia: false };
  const ult = sims.slice(-3);
  const q = { corsa: 0, stazioni: 0, roxzone: 0 };
  for (const s of ult) {
    const corsa = (s.corse || []).reduce((a, b) => a + (b || 0), 0);
    const st = Object.values(s.stazioni || {}).reduce((a, b) => a + (b || 0), 0);
    const rox = Math.max(0, s.totale - corsa - st);
    q.corsa += corsa / s.totale; q.stazioni += st / s.totale; q.roxzone += rox / s.totale;
  }
  for (const k in q) q[k] /= ult.length;
  return { ...q, mia: true, n: ult.length };
}

/** Piano dei passaggi: quanto devi stare su ogni segmento per il tuo target. */
function pacing(targetSec) {
  const R = ripartizione();
  const perCorsa = (targetSec * R.corsa) / HX.formato.corse;
  const totStaz = targetSec * R.stazioni;
  const perRox = (targetSec * R.roxzone) / stazioni().length;
  const out = [];
  let cum = 0;
  for (const seg of HX.sequenza) {
    if (seg.tipo === 'corsa') {
      cum += perCorsa;
      out.push({ ...seg, nome: seg.nome, target: perCorsa, cum, unita: '/km' });
    } else {
      const st = stazione(seg.id);
      const t = totStaz * (st?.quota || 0.125);
      cum += t + perRox;
      out.push({ ...seg, nome: st?.nome || seg.id, target: t, cum,
                 rox: perRox, misura: st?.misura });
    }
  }
  return { righe: out, perCorsa, perRox, totStaz, R, totale: cum };
}

/* --------------------------------------------------------- previsione */
/**
 * Tempo di arrivo previsto.
 * Con almeno due simulazioni intere usa la tendenza di quelle. Altrimenti lo
 * costruisce dai record di stazione piu' una stima delle corse: e' un montaggio,
 * e va detto, perche' sommare i record migliori di stazioni fatte a freddo
 * sottostima sempre una gara vera.
 */
function previsioneFinish() {
  const h = HXS();
  const sims = h.sim.filter(s => s.tipo === 'intera' && s.totale > 0)
    .sort((a, b) => a.data.localeCompare(b.data));
  if (sims.length >= 2) {
    const t0 = new Date(sims[0].data);
    const pts = sims.map(s => ({ x: (new Date(s.data) - t0) / 864e5, y: s.totale }));
    const R = regressione(pts);
    const ultimo = sims[sims.length - 1];
    if (R) {
      const gg = giorniAllaGara();
      const x = pts[pts.length - 1].x + (gg != null ? Math.max(0, gg) : 0);
      return { sec: Math.max(60 * 40, R.m * x + R.q), metodo: 'tendenza',
               n: sims.length, ultimo: ultimo.totale, banda: 1.96 * (R.sd || 60),
               secSett: R.m * 7 };
    }
    return { sec: ultimo.totale, metodo: 'ultima', n: sims.length, ultimo: ultimo.totale, banda: 180 };
  }
  if (sims.length === 1)
    return { sec: sims[0].totale, metodo: 'unica', n: 1, ultimo: sims[0].totale, banda: 240 };

  // montaggio dai record
  const pb = h.pb;
  const hoStaz = stazioni().filter(s => pb[s.id] > 0);
  if (hoStaz.length < 4) return null;
  const totStaz = stazioni().reduce((a, s) => a + (pb[s.id] || mediaStazione(s)), 0);
  const R = ripartizione();
  const corsa = pb.corsa_km ? pb.corsa_km * HX.formato.corse
    : (totStaz / R.stazioni) * R.corsa;
  const rox = ((totStaz + corsa) / (R.stazioni + R.corsa)) * R.roxzone;
  // i record sono fatti a freddo e da soli: in gara ogni stazione costa di piu'
  const penale = 1.08;
  return { sec: (totStaz + corsa + rox) * penale, metodo: 'montaggio',
           n: hoStaz.length, banda: 420, penale };
}
/** Riempimento per le stazioni senza record: la quota del target dichiarato. */
function mediaStazione(st) {
  const t = HXS().profilo.target_min * 60;
  return t * HX.ripartizione.stazioni * st.quota;
}

/* ------------------------------------------------------ punti deboli */
/** Quanti secondi ti costa ogni stazione rispetto al passo del tuo target. */
function gapStazioni() {
  const h = HXS(), P = pacing(h.profilo.target_min * 60);
  const out = [];
  for (const st of stazioni()) {
    const bersaglio = P.righe.find(r => r.id === st.id)?.target || 0;
    const mio = h.pb[st.id] || null;
    out.push({
      id: st.id, nome: st.nome, breve: st.breve, misura: st.misura,
      target: bersaglio, mio, gap: mio != null ? mio - bersaglio : null,
      chiave: st.chiave
    });
  }
  return out.sort((a, b) => (b.gap ?? -1e9) - (a.gap ?? -1e9));
}

/** Degrado delle corse dentro una simulazione: la "corsa compromessa". */
function degradoCorsa(sim) {
  const c = (sim.corse || []).map((v, i) => ({ x: i, y: v })).filter(p => p.y > 0);
  if (c.length < 4) return null;
  const R = regressione(c);
  if (!R) return null;
  return { perGiro: R.m, prima: c[0].y, ultima: c[c.length - 1].y,
           delta: c[c.length - 1].y - c[0].y, r2: R.r2, n: c.length };
}

/* ------------------------------------------------------ piano settimana */
/**
 * Programma della settimana. Sceglie fra gli allenamenti del catalogo in base
 * alla fase (quante settimane mancano) e alle stazioni piu' in ritardo: se
 * perdi due minuti sulla slitta, la slitta compare piu' spesso.
 */
function pianoSettimana(k = today()) {
  const fase = faseCorrente();
  const deboli = gapStazioni().filter(g => g.gap > 0).slice(0, 3).map(g => g.id);
  // solo quello che puoi davvero fare: proporre la slitta a chi non ce l'ha
  // non e' un programma, e' una lista della spesa
  const lib = HX.allenamenti.filter(fattibile);
  const scelte = [];
  const seed = hashData(k.slice(0, 7));           // stabile dentro il mese
  let i = 0;
  for (const [tipo, quante] of Object.entries(fase.mix)) {
    const candidati = lib.filter(a => a.tipo === tipo);
    if (!candidati.length) continue;
    // prima quelli che toccano una stazione debole
    const ordinati = candidati.slice().sort((a, b) => {
      const pa = (a.stazioni || []).some(s => deboli.includes(s)) ? 0 : 1;
      const pb2 = (b.stazioni || []).some(s => deboli.includes(s)) ? 0 : 1;
      return pa - pb2;
    });
    for (let n = 0; n < quante; n++)
      scelte.push({ ...ordinati[(Math.abs(seed) + i++ + n) % ordinati.length],
        mirato: (ordinati[(Math.abs(seed) + i + n - 1) % ordinati.length].stazioni || [])
          .some(s => deboli.includes(s)) });
  }
  return { fase, deboli, sessioni: scelte.slice(0, 7) };
}

/* ---------------------------------------------------- volume settimanale */
function volumeHyrox(days) {
  const h = HXS();
  const out = { corsa: 0, forza: 0, compromesso: 0, erg: 0, capacita: 0, simulazione: 0, test: 0 };
  for (const k of days) {
    const s = h.sessioni[k];
    if (!s || !s.fatto) continue;
    const a = HX.allenamenti.find(x => x.id === s.id);
    if (a) out[a.tipo] = (out[a.tipo] || 0) + (s.durata || a.durata || 0);
  }
  return out;
}

/* ------------------------------------------------------- capacita' fisica */
/**
 * Che atleta sei adesso, letto dai dati che l'app ha gia': i massimali della
 * palestra, il lavoro aerobico registrato, i record di stazione. Serve al
 * programma: a chi ha gambe deboli non si danno altre ripetute, si da' forza.
 *
 * Le soglie sono rapporti di uso comune (massimale su peso corporeo), non
 * misure su di te: servono a dire "molto sotto / in linea / sopra", non a
 * dare un voto.
 */
function capacitaFisica(k = today()) {
  const peso = lastWeight() ?? D.profilo.peso_iniziale_kg;
  const meglio = ids => {
    let v = 0, chi = null;
    for (const id of ids) {
      if (typeof e1rmPerSeduta !== 'function') break;
      const s = e1rmPerSeduta(id);
      if (!s.length) continue;
      const m = Math.max(...s.map(x => x.v));
      if (m > v) { v = m; chi = id; }
    }
    return v ? { kg: v, rap: v / peso, id: chi } : null;
  };
  const fascia = (r, lo, hi) => r == null ? null : r < lo ? 'debole' : r > hi ? 'forte' : 'in linea';

  const gambe = meglio(['squat', 'leg-press', 'stacco', 'hip-thrust', 'affondi']);
  const tirata = meglio(['rematore', 'trazioni', 'lat-machine', 'pulley', 'stacco']);

  /* motore aerobico: minuti di corsa e lavoro compromesso nelle ultime 4 settimane */
  let minAer = 0;
  for (const d of span(28, k)) {
    const s = HXS().sessioni[d];
    if (!s || !s.fatto) continue;
    const a = HX.allenamenti.find(x => x.id === s.id);
    if (a && ['corsa', 'compromesso', 'simulazione'].includes(a.tipo))
      minAer += s.durata || a.durata || 0;
  }
  const perSett = minAer / 4;
  const passi = avg(span(28, k).map(d => S.log[d]?.passi).filter(x => x != null));

  const ct = typeof caricoTrend === 'function' ? caricoTrend(k) : { stato: null };

  return {
    peso,
    gambe: gambe ? { ...gambe, fascia: fascia(gambe.rap, 1.2, 1.8) } : null,
    tirata: tirata ? { ...tirata, fascia: fascia(tirata.rap, 0.8, 1.2) } : null,
    aerobico: { minSett: perSett,
                fascia: perSett < 90 ? 'debole' : perSett > 180 ? 'forte' : 'in linea' },
    passi, carichi: ct.stato,
    dati: !!(gambe || tirata || perSett > 0)
  };
}

/* ------------------------------------------- programma fino al giorno gara */
/** In che giorni della settimana ti alleni, a seconda di quante sedute reggi. */
const GIORNI_SEDUTA = {
  2: [1, 4], 3: [0, 2, 4], 4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5]
};
/* Quando le sedute possibili sono meno di quelle che la fase vorrebbe, si
   tiene quello che pesa di piu' sul risultato e si lascia cadere il resto. */
const PRIORITA = ['simulazione', 'compromesso', 'corsa', 'forza', 'capacita', 'erg', 'test'];

/**
 * Le sedute di UNA settimana, scelte dalla fase e corrette sulle tue capacita':
 * piu' forza se le gambe sono deboli, piu' corsa se il motore non regge, e
 * insistendo sulle stazioni dove perdi piu' tempo.
 */
function sessioniSettimana(settRestanti, deboli, cap, quante, seme) {
  const fase = HX.fasi.find(f => settRestanti <= f.da_settimana && settRestanti >= f.a_settimana)
    || HX.fasi[0];
  const mix = { ...fase.mix };
  if (cap.gambe?.fascia === 'debole') mix.forza = (mix.forza || 0) + 1;
  if (cap.tirata?.fascia === 'debole') mix.forza = (mix.forza || 0) + 1;
  if (cap.aerobico?.fascia === 'debole') mix.corsa = (mix.corsa || 0) + 1;

  const tipi = [];
  for (const t of PRIORITA)
    for (let i = 0; i < (mix[t] || 0); i++) tipi.push(t);
  while (tipi.length < quante) tipi.push('corsa');

  const lib = HX.allenamenti.filter(fattibile);
  const usati = new Set();
  const out = [];
  for (const t of tipi.slice(0, quante)) {
    const cand = lib.filter(a => a.tipo === t);
    if (!cand.length) continue;
    // prima quelli che toccano una stazione debole, poi quelli non ancora usati
    const ord = cand.slice().sort((a, b) => {
      const pa = (a.stazioni || []).some(s => deboli.includes(s)) ? 0 : 1;
      const pb = (b.stazioni || []).some(s => deboli.includes(s)) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (usati.has(a.id) ? 1 : 0) - (usati.has(b.id) ? 1 : 0);
    });
    const scelto = ord[Math.abs(seme + out.length) % ord.length];
    usati.add(scelto.id);
    out.push({ ...scelto, fase,
      mirato: (scelto.stazioni || []).some(s => deboli.includes(s)) });
  }
  return { fase, sessioni: out };
}

/**
 * Il calendario da oggi al giorno della gara, un giorno per riga.
 * L'ultima settimana e' scarico, la vigilia e' riposo e il giorno della gara
 * e' la gara: non ci si allena il giorno prima sperando di guadagnare qualcosa.
 */
function pianoFinoAllaGara(da = today()) {
  const gg = giorniAllaGara();
  if (gg == null || gg < 0) return null;
  const quante = HXS().profilo.sedute || 4;
  const giorniOk = GIORNI_SEDUTA[quante] || GIORNI_SEDUTA[4];
  const cap = capacitaFisica(da);
  const deboli = gapStazioni().filter(g => g.gap > 0).slice(0, 3).map(g => g.id);
  const h = HXS();

  const righe = [];
  let coda = [], faseSett = null;
  for (let i = 0; i <= Math.min(gg, 180); i++) {
    const k = addDays(da, i), gi = dayIdx(k);
    const restaSett = Math.max(0, Math.ceil((gg - i) / 7));

    if (i === 0 || gi === 0) {
      const w = sessioniSettimana(restaSett, deboli, cap, quante, hashData(k));
      coda = w.sessioni.slice();
      faseSett = w.fase;
    }
    const fatto = h.sessioni[k]?.fatto ? h.sessioni[k] : null;

    if (i === gg) { righe.push({ k, gi, restaSett, fase: faseSett, gara: true }); continue; }
    if (gg - i === 1) {
      righe.push({ k, gi, restaSett, fase: faseSett, riposo: true,
        nota: 'Vigilia: riposo. Prepara la borsa e rileggi i passaggi.' });
      continue;
    }
    if (gg - i === 2) {
      righe.push({ k, gi, restaSett, fase: faseSett, fatto,
        a: { id: 'scarico', nome: 'Sgambata leggera', tipo: 'corsa', durata: 20,
             descrizione: '15-20 minuti molto facili con tre o quattro allunghi. Serve a sciogliere, non ad allenare.' } });
      continue;
    }
    if (giorniOk.includes(gi) && coda.length) {
      righe.push({ k, gi, restaSett, fase: faseSett, a: coda.shift(), fatto });
    } else {
      righe.push({ k, gi, restaSett, fase: faseSett, riposo: true, fatto });
    }
  }
  return { righe, quante, cap, deboli, troncato: gg > 180 };
}

const NOMI_GIORNO = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const NOMI_MESE = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu',
                   'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
function etichettaGiorno(k, i) {
  if (i === 0) return 'OGGI';
  if (i === 1) return 'domani';
  const d = new Date(k);
  return `${NOMI_GIORNO[dayIdx(k)]} ${d.getDate()} ${NOMI_MESE[d.getMonth()]}`;
}

/* ================================================================= viste */
/* Tre sezioni, non sei: il conto alla rovescia sta sempre in testa, il piano
   dice cosa fare, le stazioni dicono a che punto sei e da li' parte la
   simulazione. Tutto il resto era navigazione in piu'. */
let hxTab = 'piano';

function viewHyrox(v) {
  /* Si puo' arrivarci da un vecchio segnalibro anche con il modulo spento.
     Non e' un errore: e' una sezione che hai deciso di non usare, e la si
     riaccende da qui senza dover andare a cercare l'interruttore. */
  if (typeof usaHyrox === 'function' && !usaHyrox()) {
    const c = el('div', 'card');
    c.append(el('div', 'eyebrow', 'Sezione spenta'));
    c.append(el('h2', 'sec', 'Road to HYROX'));
    c.lastChild.style.marginTop = '0';
    c.append(el('div', 'muted',
      'Otto chilometri di corsa e otto stazioni. L\'hai lasciata spenta perche\' non '
      + 'gareggi: se cambi idea si riaccende qui, e quello che avevi gia\' registrato '
      + 'e\' rimasto dov\'era.'));
    const b = el('button', 'btn wide pri', 'Accendi Road to HYROX');
    b.style.marginTop = '10px';
    b.onclick = () => { moduli().hyrox = true; save(); route(); toast('Acceso'); };
    c.append(b);
    const i = el('button', 'btn wide', 'Torna in palestra');
    i.style.marginTop = '8px';
    i.onclick = () => { apri('#/palestra'); };
    c.append(i);
    v.append(c);
    return;
  }
  if (!HX) { v.append(el('div', 'card', '<p class="muted">Dati HYROX non caricati.</p>')); return; }
  const h = HXS();
  const wrap = el('div', 'hx');
  v.append(wrap);

  const gg = giorniAllaGara();
  const P = pacing(h.profilo.target_min * 60);
  const prev = previsioneFinish();

  const hero = el('div', 'hx-hero');
  hero.append(el('div', 'hx-kicker', 'Road to'));
  hero.append(el('div', 'hx-logo', 'HYROX'));
  hero.append(el('div', 'hx-clock',
    gg == null ? '<span class="hx-set">Imposta la data della gara</span>'
    : gg > 0 ? `<b>${gg}</b><span>giorn${gg === 1 ? 'o' : 'i'} alla gara</span>`
    : gg === 0 ? '<b>OGGI</b><span>si corre</span>'
    : `<b>${-gg}</b><span>giorni dalla gara</span>`));
  const dati = el('div', 'hx-meta');
  dati.innerHTML =
    `<div><span>Categoria</span><b>${esc((HX.categorie.find(c => c.id === h.profilo.categoria) || {}).nome || '—')} ${h.profilo.sesso === 'f' ? 'donne' : 'uomini'}</b></div>
     <div><span>Target</span><b>${hms(h.profilo.target_min * 60)}</b></div>
     <div><span>Previsto</span><b>${prev ? hms(prev.sec) : '—'}</b></div>`;
  hero.append(dati);
  const bimp = el('button', 'hx-btn', 'Imposta gara, target e attrezzatura');
  bimp.onclick = () => sheetGara();
  hero.append(bimp);
  wrap.append(hero);

  const nav = el('div', 'hx-tabs');
  for (const [id, lab] of [['piano', 'Il piano'], ['stazioni', 'Stazioni'], ['gara', 'Giorno della gara']]) {
    const b = el('button', hxTab === id ? 'on' : null, lab);
    b.onclick = () => { hxTab = id; route(); };
    nav.append(b);
  }
  wrap.append(nav);

  ({ piano: hxPiano, stazioni: hxStazioni, gara: hxGara }[hxTab])(wrap, h, P, prev);
}

/* ----------------------------------------------------------- 1. IL PIANO */
let hxTutto = false;

function hxPiano(w, h) {
  const cap = capacitaFisica();

  /* che atleta sei */
  const cc = el('div', 'hx-card');
  cc.append(el('div', 'hx-h', 'Da dove parti'));
  if (!cap.dati) {
    cc.append(el('p', 'hx-p',
      'Non ho ancora abbastanza dati per tararti addosso il programma. Registra qualche seduta in Gym e segna gli allenamenti qui: da li leggo forza delle gambe, forza di tirata e motore aerobico, e il programma cambia di conseguenza.'));
  } else {
    const riga = (nome, o, testo) => {
      const r = el('div', 'hx-gap' + (o?.fascia === 'forte' ? ' ok'
        : o?.fascia === 'in linea' ? ' plain' : ''));
      r.innerHTML = `<span class="nm">${esc(nome)}</span>
        <span class="v">${esc(testo)}</span>
        <span class="d">${o?.fascia ? esc(o.fascia) : '—'}</span>`;
      cc.append(r);
    };
    riga('Forza gambe', cap.gambe, cap.gambe
      ? `${nf(cap.gambe.kg, 0)} kg · ${nf(cap.gambe.rap, 2)}× peso` : 'nessun dato');
    riga('Forza di tirata', cap.tirata, cap.tirata
      ? `${nf(cap.tirata.kg, 0)} kg · ${nf(cap.tirata.rap, 2)}× peso` : 'nessun dato');
    riga('Motore aerobico', cap.aerobico, `${nf(cap.aerobico.minSett)} min/sett`);
    if (cap.carichi) {
      const r = el('div', 'hx-gap plain');
      r.innerHTML = `<span class="nm">Carichi in palestra</span>
        <span class="v">${cap.carichi === 'su' ? 'in salita' : cap.carichi === 'giu' ? 'in calo' : 'fermi'}</span>
        <span class="d"></span>`;
      cc.append(r);
    }
    cc.append(el('p', 'hx-note',
      'Le soglie sono rapporti di uso comune fra massimale e peso corporeo, non misure su di te: dicono "molto sotto / in linea / sopra", non danno un voto. Cinque stazioni su otto stanno in piedi sulle gambe, tre sulla tirata.'));
  }
  w.append(cc);

  /* il calendario vero e proprio */
  const cal = pianoFinoAllaGara();
  const cp = el('div', 'hx-card');
  cp.append(el('div', 'hx-h', 'Da oggi al giorno della gara'));

  if (!cal) {
    cp.append(el('p', 'hx-p',
      'Imposta la data della gara e qui compare il programma giorno per giorno, da oggi fino alla partenza.'));
    w.append(cp);
    return;
  }

  /* quante sedute a settimana */
  const fs = el('div', 'hx-tabs');
  fs.style.marginBottom = '10px';
  for (const n of [2, 3, 4, 5, 6]) {
    const b = el('button', (h.profilo.sedute || 4) === n ? 'on' : null, n + ' a sett.');
    b.onclick = () => { h.profilo.sedute = n; save(); route(); };
    fs.append(b);
  }
  cp.append(fs);

  const perche = [];
  if (cal.deboli.length) perche.push('insiste su '
    + cal.deboli.map(id => esc(stazione(id)?.nome.toLowerCase() || id)).join(', '));
  if (cap.gambe?.fascia === 'debole' || cap.tirata?.fascia === 'debole')
    perche.push('aggiunge forza, perche\' la tua e\' sotto i valori tipici');
  if (cap.aerobico?.fascia === 'debole')
    perche.push('aggiunge corsa: sotto i 90 minuti a settimana il motore non regge otto chilometri');
  const mancano = HX.attrezzatura.filter(a => !hoAttrezzo(a.id));
  if (mancano.length) perche.push('evita ' + mancano.map(a => esc(a.nome.toLowerCase())).join(', ')
    + ' e usa le sedute di ripiego');
  if (perche.length)
    cp.append(el('p', 'hx-p', 'Il programma ' + perche.join('; ') + '.'));

  const limite = hxTutto ? cal.righe.length : Math.min(cal.righe.length, 21);
  let settVista = null;
  const lista = el('div', 'cal-l');
  for (let i = 0; i < limite; i++) {
    const r = cal.righe[i];
    if (r.restaSett !== settVista) {
      settVista = r.restaSett;
      lista.append(el('div', 'cal-w',
        `<span>${r.restaSett === 0 ? 'settimana di gara' : r.restaSett + ' settimane alla gara'}</span>
         <span>${esc(r.fase ? r.fase.nome : '')}</span>`));
    }
    const row = el('button', 'cal-d'
      + (i === 0 ? ' oggi' : '') + (r.gara ? ' gara' : '')
      + (r.riposo ? ' rip' : '') + (r.fatto ? ' fatta' : ''));
    const nome = r.gara ? 'GARA'
      : r.riposo ? 'Riposo'
      : (r.fatto ? '✓ ' : '') + (r.a?.nome || '');
    row.innerHTML = `<span class="g">${esc(etichettaGiorno(r.k, i))}</span>
      <span class="n">${esc(nome)}${r.a?.ripiego ? '<em>ripiego</em>' : ''}
        ${r.nota ? `<em>${esc(r.nota)}</em>` : ''}</span>
      <span class="t">${r.a ? r.a.durata + "'" : ''}</span>`;
    if (r.a) row.onclick = () => sheetAllenamento(r.a, r.k);
    lista.append(row);
  }
  cp.append(lista);

  if (cal.righe.length > 21) {
    const b = el('button', 'hx-btn ghost',
      hxTutto ? 'Mostra solo i prossimi 21 giorni'
              : `Mostra tutti i ${cal.righe.length} giorni`);
    b.onclick = () => { hxTutto = !hxTutto; route(); };
    cp.append(b);
  }
  cp.append(el('p', 'hx-note',
    'Il programma si ricalcola da solo mentre i dati cambiano: se migliori una stazione smette di insistere, se cambi attrezzatura cambia gli esercizi. Tocca un giorno per leggere la seduta e segnarla come fatta. Saltare un giorno non rompe niente — quello che non recuperi non allena.'));
  w.append(cp);
}

/* --------------------------------------------------------- 2. STAZIONI */
function hxStazioni(w, h) {
  const std = (HX.standard[h.profilo.categoria] || HX.standard.open)[h.profilo.sesso] || {};
  const P = pacing(h.profilo.target_min * 60);

  const c = el('div', 'hx-card');
  c.append(el('div', 'hx-h', 'Le otto stazioni'));
  c.append(el('p', 'hx-p', 'Tocca una stazione per il tuo tempo migliore, lo standard della categoria e come sostituirla se ti manca l\'attrezzo.'));
  const grid = el('div', 'hx-grid');
  for (const [i, st] of stazioni().entries()) {
    const mio = h.pb[st.id], tgt = P.righe.find(r => r.id === st.id)?.target;
    const t = el('button', 'hx-tile' + (mio ? ' has' : ''));
    t.innerHTML = `<span class="n">0${i + 1}</span>
      <span class="nm">${esc(st.breve)}</span>
      <span class="ms">${esc(st.misura)}</span>
      <span class="pb">${mio ? mmss(mio) : '—'}</span>
      <span class="tg">target ${mmss(tgt)}</span>
      <span class="st">${esc(std[st.id] || '')}${hoAttrezzo(st.richiede) ? '' : ' · non l\'hai'}</span>`;
    t.onclick = () => sheetStazione(st);
    grid.append(t);
  }
  c.append(grid);
  c.append(el('p', 'hx-note', esc(HX.meta.verifica)));
  w.append(c);

  /* simulazione */
  const sc = el('div', 'hx-card');
  sc.append(el('div', 'hx-h', 'Simulazione'));
  sc.append(el('p', 'hx-p',
    'La gara intera a cronometro e\' un test, non un allenamento: al massimo ogni 4-6 settimane, e va recuperata come una gara. La mezza costa molto meno e dice quasi le stesse cose. I tempi che registri aggiornano i record da soli.'));
  const b = el('button', 'hx-btn', 'Registra una simulazione completa');
  b.onclick = () => sheetSim(null);
  sc.append(b);
  w.append(sc);

  const sims = h.sim.slice().sort((a, b2) => b2.data.localeCompare(a.data));
  for (const s of sims) {
    const box = el('div', 'hx-card');
    const corsa = (s.corse || []).reduce((a, x) => a + (x || 0), 0);
    const staz = Object.values(s.stazioni || {}).reduce((a, x) => a + (x || 0), 0);
    const rox = Math.max(0, (s.totale || 0) - corsa - staz);
    box.append(el('div', 'hx-h', `${s.tipo === 'intera' ? 'Intera' : 'Mezza'} · ${s.data}`));
    box.append(el('div', 'hx-big', hms(s.totale)));
    const q = el('div', 'hx-quote');
    q.innerHTML = `<div><span>Corsa</span><b>${hms(corsa)}</b><em>${nf(corsa / (s.totale || 1) * 100)}%</em></div>
      <div><span>Stazioni</span><b>${hms(staz)}</b><em>${nf(staz / (s.totale || 1) * 100)}%</em></div>
      <div><span>Roxzone</span><b>${hms(rox)}</b><em>${nf(rox / (s.totale || 1) * 100)}%</em></div>`;
    box.append(q);
    const dg = degradoCorsa(s);
    if (dg) {
      box.append(el('p', 'hx-note',
        `Corsa compromessa: dal primo all'ultimo chilometro hai perso <strong>${mmss(Math.abs(dg.delta))}</strong> `
        + `(${dg.perGiro >= 0 ? '+' : '−'}${Math.abs(dg.perGiro).toFixed(0)} s a giro). `
        + (Math.abs(dg.perGiro) < 6 ? 'Degrado contenuto: il ritmo di partenza era sostenibile.'
          : 'Degrado alto: quasi sempre significa primi due chilometri troppo veloci, non mancanza di motore.')));
      box.append(chartBars({
        titolo: 'Le otto corse', sub: 'Tempo di ogni chilometro, nell\'ordine di gara.',
        days: (s.corse || []).map((_, i) => 'Corsa ' + (i + 1)), vals: s.corse, unit: 's', dec: 0
      }));
    }
    const mod = el('button', 'hx-btn ghost', 'Modifica o elimina');
    mod.onclick = () => sheetSim(s);
    box.append(mod);
    w.append(box);
  }

  const conStaz = h.sim.filter(s => s.stazioni && Object.keys(s.stazioni).length)
    .sort((a, b) => a.data.localeCompare(b.data));
  if (conStaz.length >= 2)
    w.append(chartEmphasis({
      titolo: 'Stazioni nel tempo', sub: 'In evidenza quella dove perdi piu\' tempo.',
      days: conStaz.map(s => s.data), unit: 's', dec: 0,
      serie: gapStazioni().slice(0, 4).map((g, i) => ({
        nome: g.breve.toLowerCase(), forte: i === 0,
        vals: conStaz.map(s => s.stazioni[g.id] || null) }))
    }));
}

/* --------------------------------------------------- 3. GIORNO DELLA GARA */
function hxGara(w, h, P, prev) {
  const c = el('div', 'hx-card');
  c.append(el('div', 'hx-h', 'Tempo previsto'));
  if (!prev) {
    c.append(el('p', 'hx-p',
      'Servono almeno quattro record di stazione, oppure una simulazione intera. Registrali nella scheda Stazioni.'));
  } else {
    c.append(el('div', 'hx-big', hms(prev.sec)));
    const d = prev.sec - h.profilo.target_min * 60;
    c.append(el('div', 'hx-delta ' + (d <= 0 ? 'ok' : 'no'),
      `${d <= 0 ? '−' : '+'}${hms(Math.abs(d))} rispetto al target · ±${hms(prev.banda)}`));
    c.append(el('p', 'hx-p', {
      tendenza: `Dalla tendenza delle tue ${prev.n} simulazioni intere, proiettata al giorno della gara${prev.secSett ? ` (${prev.secSett <= 0 ? '−' : '+'}${mmss(Math.abs(prev.secSett))} a settimana)` : ''}.`,
      unica: 'Da una sola simulazione: e\' un punto, non una tendenza.',
      ultima: 'Dall\'ultima simulazione registrata.',
      montaggio: `Montato dai tuoi ${prev.n} record di stazione piu' una stima delle corse, con un +8% di penale: i record si fanno a freddo e da soli, in gara ogni stazione costa di piu'.`
    }[prev.metodo]));
  }
  w.append(c);

  const sims = h.sim.filter(s => s.totale > 0).sort((a, b) => a.data.localeCompare(b.data));
  if (sims.length >= 2)
    w.append(chartLine({
      titolo: 'Come stai andando', sub: 'Ogni punto e\' una simulazione. La riga tratteggiata e\' il target.',
      days: sims.map(s => s.data), vals: sims.map(s => s.totale / 60),
      unit: 'min', dec: 1, target: h.profilo.target_min
    }));

  const pc = el('div', 'hx-card');
  pc.append(el('div', 'hx-h', 'Piano dei passaggi'));
  pc.append(el('p', 'hx-p',
    P.R.mia ? `Calcolato sulla TUA ripartizione, dalle ultime ${P.R.n} simulazioni.`
            : 'Calcolato su una ripartizione media. Appena registri una simulazione intera passa alla tua.'));
  const tb = el('div', 'hx-split');
  tb.append(el('div', 'hx-split-h', '<span>#</span><span>Segmento</span><span>Target</span><span>Passaggio</span>'));
  for (const r of P.righe) {
    const row = el('div', 'hx-split-r' + (r.tipo === 'corsa' ? ' run' : ''));
    row.innerHTML = `<span class="n">${r.n}</span>
      <span class="nm">${esc(r.nome)}${r.misura ? `<em>${esc(r.misura)}</em>` : '<em>1000 m</em>'}</span>
      <span class="t">${mmss(r.target)}</span>
      <span class="c">${hms(r.cum)}</span>`;
    tb.append(row);
  }
  pc.append(tb);
  pc.append(el('p', 'hx-note',
    `Roxzone ${mmss(P.perRox)} a stazione, ${mmss(P.perRox * 8)} in tutto, gia' dentro i passaggi. E' il tempo piu' facile da recuperare: non serve essere piu' forti, serve non fermarsi.`));
  w.append(pc);

  const gaps = gapStazioni().filter(g => g.gap != null);
  if (gaps.length) {
    const gc = el('div', 'hx-card');
    gc.append(el('div', 'hx-h', 'Dove perdi piu\' tempo'));
    for (const g of gaps.slice(0, 5)) {
      const r = el('div', 'hx-gap' + (g.gap > 0 ? '' : ' ok'));
      r.innerHTML = `<span class="nm">${esc(g.nome)}</span>
        <span class="v">${mmss(g.mio)}</span>
        <span class="d">${g.gap > 0 ? '+' : '−'}${mmss(Math.abs(g.gap))}</span>`;
      gc.append(r);
    }
    if (gaps[0]?.gap > 0)
      gc.append(el('p', 'hx-note', `<strong>${esc(gaps[0].nome)}</strong> — ${esc(gaps[0].chiave)}`));
    w.append(gc);
  }

  const cl = el('div', 'hx-card');
  cl.append(el('div', 'hx-h', 'Checklist'));
  for (const x of HX.checklist) {
    const on = !!h.checklist[x.id];
    const r = el('button', 'hx-check' + (on ? ' on' : ''));
    r.innerHTML = `<span class="bx">${on ? '✓' : ''}</span>
      <span class="tx"><b>${esc(x.t)}</b><em>${esc(x.n)}</em></span>`;
    r.onclick = () => { h.checklist[x.id] = !on; save(); route(); };
    cl.append(r);
  }
  w.append(cl);

  const peso = lastWeight() ?? D.profilo.peso_iniziale_kg;
  const nc = el('div', 'hx-card');
  nc.append(el('div', 'hx-h', 'Cosa mangiare e bere'));
  nc.append(el('div', 'hx-quote',
    `<div><span>Carboidrati 3h prima</span><b>${nf(peso * 1.5, 0)}–${nf(peso * 2, 0)} g</b><em>sui tuoi ${nf(peso, 0)} kg</em></div>
     <div><span>Acqua 2h prima</span><b>${nf(peso * 7, 0)} ml</b><em>poi solo sorsi</em></div>
     <div><span>Gel 30' prima</span><b>25–30 g</b><em>di carboidrati</em></div>`));
  nc.append(el('p', 'hx-note',
    'Quantita\' orientative da linee guida generali sull\'endurance, scalate sul tuo peso: non sono un piano nutrizionale personalizzato e vanno provate in allenamento. Il giorno della gara non si sperimenta niente di nuovo.'));
  w.append(nc);

  const sc = el('div', 'hx-card');
  sc.append(el('div', 'hx-h', 'Strategia'));
  sc.append(el('p', 'hx-p',
    'I primi due chilometri decidono la gara: quasi tutti li corrono troppo forte e lo pagano dal burpee in poi.'));
  for (const st of stazioni()) {
    const r = el('div', 'hx-tip');
    r.innerHTML = `<b>${esc(st.nome)}</b><span>${esc(st.chiave)}</span>`;
    sc.append(r);
  }
  w.append(sc);
}

/* ================================================================ schede */
function sheetGara() {
  const h = HXS();
  const w = el('div');
  w.append(el('div', 'eyebrow', 'HYROX'));
  w.append(el('h2', 'sec', 'La tua gara'));
  w.lastChild.style.marginTop = '0';

  w.append(el('div', 'field',
    `<label>Data della gara</label>
     <input type="date" id="hx-data" value="${esc(h.profilo.data_gara || '')}">`));

  const fc = el('div', 'field', '<label>Categoria</label>');
  const sc = el('div', 'seg');
  for (const c of HX.categorie) {
    const b = el('button', null, c.nome);
    b.setAttribute('aria-pressed', h.profilo.categoria === c.id);
    b.onclick = () => { h.profilo.categoria = c.id; save(); closeSheet(); sheetGara(); };
    sc.append(b);
  }
  fc.append(sc); w.append(fc);

  const fs = el('div', 'field', '<label>Categoria di sesso</label>');
  const ss = el('div', 'seg');
  for (const [id, lab] of [['m', 'Uomini'], ['f', 'Donne']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', h.profilo.sesso === id);
    b.onclick = () => { h.profilo.sesso = id; save(); closeSheet(); sheetGara(); };
    ss.append(b);
  }
  fs.append(ss); w.append(fs);

  w.append(el('div', 'field',
    `<label>Tempo obiettivo <span class="muted">(minuti)</span></label>
     <input type="text" inputmode="decimal" id="hx-target" value="${h.profilo.target_min}">
     <div class="hint">Riferimenti: ${HX.livelli.map(l => `${esc(l.nome)} ${l.finish_min}′`).join(' · ')}</div>`));

  w.append(el('div', 'field',
    `<label>Ritmo su 1 km da fresco <span class="muted">(m:ss, facoltativo)</span></label>
     <input type="text" inputmode="numeric" id="hx-km" value="${h.pb.corsa_km ? mmss(h.pb.corsa_km) : ''}">
     <div class="hint">Serve a montare la previsione quando non hai ancora fatto una simulazione.</div>`));

  /* attrezzatura disponibile: cambia il programma, non solo un'etichetta */
  const fa = el('div', 'field', '<label>Cosa hai a disposizione</label>');
  const box = el('div');
  box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  const miei = attrezziMiei();
  for (const at of HX.attrezzatura) {
    const b2 = el('button', 'btn sm', at.nome);
    const on = () => attrezziMiei().includes(at.id);
    const dip = () => { b2.style.background = on() ? 'var(--pine)' : '';
                        b2.style.color = on() ? '#fff' : ''; };
    b2.onclick = () => {
      const cur = attrezziMiei().slice();
      const i = cur.indexOf(at.id);
      if (i >= 0) cur.splice(i, 1); else cur.push(at.id);
      h.attrezzi = cur; save(); dip();
    };
    dip(); box.append(b2);
  }
  fa.append(box);
  fa.append(el('div', 'hint',
    'Il programma settimanale propone solo allenamenti che puoi davvero fare. Per le stazioni che non puoi allenare, come sostituirle sta dentro la scheda della stazione.'));
  w.append(fa);

  const fq = el('div', 'field', '<label>Sedute a settimana</label>');
  const sq = el('div', 'seg');
  for (const n of [2, 3, 4, 5, 6]) {
    const b2 = el('button', null, String(n));
    b2.setAttribute('aria-pressed', (h.profilo.sedute || 4) === n);
    b2.onclick = () => { h.profilo.sedute = n; save();
      [...sq.children].forEach(x => x.setAttribute('aria-pressed', x.textContent === String(n))); };
    sq.append(b2);
  }
  fq.append(sq);
  fq.append(el('div', 'hint', 'Quante volte a settimana riesci ad allenarti davvero. Il programma giorno per giorno si adatta a questo numero.'));
  w.append(fq);

  const b = el('button', 'btn wide pri', 'Salva');
  b.onclick = () => {
    h.profilo.data_gara = $('#hx-data').value || null;
    const t = parseNum($('#hx-target').value);
    if (t > 30 && t < 240) h.profilo.target_min = t;
    const km = parseTempo($('#hx-km').value);
    if (km > 120) h.pb.corsa_km = km; else if (!$('#hx-km').value.trim()) delete h.pb.corsa_km;
    save(); closeSheet(); route(); toast('Gara aggiornata');
  };
  w.append(b);
  sheet(w);
}

function sheetStazione(st) {
  const h = HXS();
  const w = el('div');
  w.append(el('div', 'eyebrow', st.misura));
  w.append(el('h2', 'sec', esc(st.nome)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', esc(st.chiave)));
  const std = (HX.standard[h.profilo.categoria] || HX.standard.open)[h.profilo.sesso] || {};
  if (std[st.id]) w.append(el('div', 'card flat',
    `<div class="eyebrow">Standard</div><div class="muted">${esc(std[st.id])}</div>`));
  if (st.alternativa && !hoAttrezzo(st.richiede))
    w.append(el('div', 'card flat',
      `<div class="eyebrow">Non hai l'attrezzo</div>
       <div class="muted">${esc(st.alternativa)}</div>`));
  w.append(el('div', 'field',
    `<label>Tuo tempo migliore <span class="muted">(m:ss)</span></label>
     <input type="text" inputmode="numeric" id="hx-pb" value="${h.pb[st.id] ? mmss(h.pb[st.id]) : ''}">`));
  const P = pacing(h.profilo.target_min * 60);
  const tgt = P.righe.find(r => r.id === st.id)?.target;
  w.append(el('p', 'hint', `Per il tuo target servirebbe <strong>${mmss(tgt)}</strong>.`));
  const b = el('button', 'btn wide pri', 'Salva');
  b.onclick = () => {
    const raw = $('#hx-pb').value.trim();
    if (!raw) { delete h.pb[st.id]; }
    else {
      const t = parseTempo(raw);
      if (!(t > 10 && t < 3600)) { toast('Tempo non valido'); return; }
      h.pb[st.id] = t;
    }
    save(); closeSheet(); route(); toast('Salvato');
  };
  w.append(b);
  sheet(w);
}

function sheetAllenamento(a, giorno) {
  const h = HXS(), k = giorno || today();
  const w = el('div');
  w.append(el('div', 'eyebrow', a.tipo + ' · ' + a.durata + ' minuti'));
  w.append(el('h2', 'sec', esc(a.nome)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', esc(a.descrizione)));
  if ((a.stazioni || []).length)
    w.append(el('p', 'hint', 'Stazioni allenate: '
      + a.stazioni.map(id => esc(stazione(id)?.nome || id)).join(', ')));
  if ((a.richiede || []).length)
    w.append(el('p', 'hint', 'Serve: '
      + a.richiede.map(id => esc((HX.attrezzatura.find(x => x.id === id) || {}).nome || id)).join(', ')));
  else
    w.append(el('p', 'hint', 'Non serve nessun attrezzo.'));
  const fatto = h.sessioni[k]?.id === a.id && h.sessioni[k]?.fatto;
  if (k !== today()) w.append(el('p', 'hint', 'Giorno: ' + k));
  const b = el('button', 'btn wide pri', fatto ? 'Segnata come fatta oggi' : 'Segna come fatta oggi');
  b.onclick = () => {
    if (fatto) delete h.sessioni[k];
    else h.sessioni[k] = { id: a.id, durata: a.durata, fatto: true };
    save(); closeSheet(); route(); toast(fatto ? 'Rimossa' : 'Registrata');
  };
  w.append(b);
  sheet(w);
}

function sheetSim(sim) {
  const h = HXS();
  const nuovo = !sim;
  const s = sim || { id: uid(), data: today(), tipo: 'intera', corse: [], stazioni: {}, totale: 0 };
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Simulazione'));
  w.append(el('h2', 'sec', nuovo ? 'Nuova' : esc(s.data)));
  w.lastChild.style.marginTop = '0';

  w.append(el('div', 'field',
    `<label>Data</label><input type="date" id="sm-data" value="${esc(s.data)}">`));
  const ft = el('div', 'field', '<label>Tipo</label>');
  const st2 = el('div', 'seg');
  for (const [id, lab] of [['intera', 'Intera'], ['mezza', 'Mezza']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', s.tipo === id);
    b.onclick = () => { s.tipo = id; [...st2.children].forEach(x =>
      x.setAttribute('aria-pressed', x.textContent === lab)); };
    st2.append(b);
  }
  ft.append(st2); w.append(ft);

  w.append(el('div', 'field',
    `<label>Tempo totale <span class="muted">(h:mm:ss)</span></label>
     <input type="text" inputmode="numeric" id="sm-tot" value="${s.totale ? hms(s.totale) : ''}">`));

  w.append(el('div', 'eyebrow', 'Le corse (m:ss)'));
  const gr = el('div');
  gr.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  for (let i = 0; i < 8; i++)
    gr.append(el('div', 'field',
      `<label>Corsa ${i + 1}</label><input type="text" inputmode="numeric"
        id="sm-r${i}" value="${s.corse[i] ? mmss(s.corse[i]) : ''}">`));
  w.append(gr);

  w.append(el('div', 'eyebrow', 'Le stazioni (m:ss)'));
  const gs = el('div');
  gs.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  for (const st of stazioni())
    gs.append(el('div', 'field',
      `<label>${esc(st.breve)}</label><input type="text" inputmode="numeric"
        id="sm-${st.id}" value="${s.stazioni[st.id] ? mmss(s.stazioni[st.id]) : ''}">`));
  w.append(gs);

  const b = el('button', 'btn wide pri', 'Salva');
  b.onclick = () => {
    s.data = $('#sm-data').value || today();
    s.totale = parseTempo($('#sm-tot').value) || 0;
    if (!(s.totale > 600)) { toast('Serve il tempo totale'); return; }
    s.corse = [];
    for (let i = 0; i < 8; i++) s.corse[i] = parseTempo($('#sm-r' + i).value) || 0;
    s.stazioni = {};
    for (const st of stazioni()) {
      const t = parseTempo($('#sm-' + st.id).value);
      if (t > 0) {
        s.stazioni[st.id] = t;
        // una simulazione aggiorna i record se e' andata meglio
        if (!h.pb[st.id] || t < h.pb[st.id]) h.pb[st.id] = t;
      }
    }
    if (nuovo) h.sim.push(s);
    save(); closeSheet(); route(); toast('Simulazione salvata');
  };
  w.append(b);
  if (!nuovo) {
    const d = el('button', 'btn wide', 'Elimina');
    d.style.marginTop = '8px';
    d.onclick = () => {
      if (!confirm('Eliminare questa simulazione?')) return;
      h.sim = h.sim.filter(x => x.id !== s.id);
      save(); closeSheet(); route(); toast('Eliminata');
    };
    w.append(d);
  }
  sheet(w);
}
