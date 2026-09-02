let CORPO = null;                                 // data/corpo.json
/* Palestra: registro delle sedute, mappa muscolare, progressione, previsione.
   Il catalogo degli esercizi sta in data/palestra.json, non qui: stessa regola
   di dieta.json — il dominio e' dato, non codice. */
'use strict';

let PD = null;                                    // data/palestra.json

function P() {
  S.palestra ||= {};
  S.palestra.sessioni ||= {};
  S.palestra.esercizi ||= [];
  return S.palestra;
}
/** Catalogo = esercizi del file + quelli aggiunti dall'utente. */
/**
 * Il catalogo: i 59 di base piu' i tuoi, **e i tuoi vincono sull'id**.
 *
 * Prima era una semplice concatenazione, e `esercizio(id)` restituisce il
 * primo che trova: una voce tua con lo stesso id di una di base restava quindi
 * invisibile per sempre. Conseguenza pratica: gli esercizi del catalogo non si
 * potevano correggere. Se per te la panca inclinata lavora piu' le spalle che
 * il petto — dipende da come la fai — non c'era modo di dirlo, e la mappa
 * muscolare continuava a colorare quello che diceva il file.
 *
 * Sovrascrivere per id invece di creare un doppione e' anche l'unica strada
 * che non spezza niente: lo storico dei carichi, il volume settimanale e la
 * forma-fatica sono indicizzati sull'id, e un id nuovo li dividerebbe in due.
 */
function catalogo() {
  const miei = P().esercizi;
  const suoi = new Set(miei.map(e => e.id));
  return (PD?.esercizi || []).filter(e => !suoi.has(e.id)).concat(miei);
}
/** Esiste nel file di base con quell'id? Serve a distinguere una correzione. */
const diBase = id => (PD?.esercizi || []).some(e => e.id === id);
function esercizio(id) { return catalogo().find(e => e.id === id) || null; }
function muscoli() { return PD?.muscoli || []; }
function muscolo(id) { return muscoli().find(m => m.id === id) || null; }

/* ==================================================================== motore */

/**
 * Massimale stimato con la formula di Epley, corretta col RIR.
 * Una serie da 8 con 2 ripetizioni in serbatoio vale quanto una da 10 a
 * cedimento: sommare il RIR alle ripetizioni e' quello che rende confrontabili
 * serie fatte con sforzo diverso. Resta una stima: sopra le 12 ripetizioni
 * Epley sovrastima, e va letta come tendenza, non come un massimale vero.
 */
function e1rm(kg, reps, rir) {
  const r = (+reps || 0) + (+rir || 0);
  if (!(kg > 0) || r <= 0) return 0;
  return kg * (1 + r / 30);
}

/* ------------------------------------------------- quanto vale una serie
 *
 * Uno stripping non e' una serie e non e' due: e' una serie piu' N code fatte
 * a cedimento senza recupero. La convenzione piu' diffusa — e quella che
 * quest'app usa dappertutto — e' mezza serie per scarico, mentre i chili si
 * sommano per intero perche' quelli sono stati sollevati davvero.
 *
 * Erano due righe copiate in cinque posti e mancavano in altri tre: il
 * tonnellaggio per seduta, il tonnellaggio del resoconto e il conteggio delle
 * serie delle statistiche ignoravano gli scarichi, quindi la stessa seduta
 * valeva di piu' o di meno a seconda di quale schermata la guardava.
 */
function serieEquivalenti(x) { return 1 + (x?.drop || []).length * 0.5; }
function tonnellaggioSerie(x) {
  return (+x?.kg || 0) * (+x?.reps || 0)
    + (x?.drop || []).reduce((a, d) => a + (+d.kg || 0) * (+d.reps || 0), 0);
}
/** Ripetizioni totali della serie, scarichi compresi. */
function ripetizioniSerie(x) {
  return (+x?.reps || 0) + (x?.drop || []).reduce((a, d) => a + (+d.reps || 0), 0);
}

/** Quanto una serie stimola un muscolo: 1 se primario, 0.5 se secondario. */
function pesoMuscolare(ex, mus) {
  if (!ex) return 0;
  if ((ex.primari || []).includes(mus)) return 1;
  if ((ex.secondari || []).includes(mus)) return 0.5;
  return 0;
}
/** Le serie vicine al cedimento stimolano di piu': RIR 0 vale 1.5, RIR 3+ vale 1. */
const sforzo = rir => 1 + (3 - Math.min(Math.max(+rir || 0, 0), 3)) / 6;

/** Tutte le serie registrate in un giorno, appiattite. */
function serieDelGiorno(k) {
  const s = P().sessioni[k];
  if (!s || !Array.isArray(s.serie)) return [];
  return s.serie;
}

/** Serie pesate e tonnellaggio per muscolo su un elenco di giorni. */
function volumeMuscoli(days) {
  const out = {};
  for (const m of muscoli()) out[m.id] = { serie: 0, tonn: 0, sedute: new Set() };
  for (const k of days) {
    for (const s of serieDelGiorno(k)) {
      const ex = esercizio(s.ex); if (!ex) continue;
      for (const m of muscoli()) {
        const w = pesoMuscolare(ex, m.id); if (!w) continue;
        out[m.id].serie += w * serieEquivalenti(s);
        out[m.id].tonn += w * tonnellaggioSerie(s);
        out[m.id].sedute.add(k);
      }
    }
  }
  for (const id in out) out[id].sedute = out[id].sedute.size;
  return out;
}

/**
 * Modello forma-fatica (Banister). Ogni seduta lascia due tracce che svaniscono
 * a velocita' diverse: la fatica in circa una settimana, la forma in sei. La
 * prontezza e' la differenza. E' il modello che risponde alla domanda "questo
 * muscolo e' ancora stanco o e' pronto?" senza doverla indovinare.
 *
 * L'impulso non e' il tonnellaggio — un leg press e un'alzata laterale non
 * sono confrontabili in chili — ma le serie pesate per il coinvolgimento del
 * muscolo e per quanto vicino al cedimento sono state portate.
 */
function formaFatica(mus, fino = today(), giorni = 120) {
  const M = PD?.modello || { tau_forma: 42, tau_fatica: 7, k_forma: 1, k_fatica: 2 };
  let forma = 0, fatica = 0;
  for (let i = giorni; i >= 0; i--) {
    const k = addDays(fino, -i);
    let imp = 0;
    for (const s of serieDelGiorno(k)) {
      const ex = esercizio(s.ex); if (!ex) continue;
      const w = pesoMuscolare(ex, mus); if (!w) continue;
      // gli scarichi si fanno a cedimento: stimolo pieno, mezza serie
      imp += w * sforzo(s.rir) * serieEquivalenti(s);
    }
    if (imp) {
      forma += imp; fatica += imp;
    }
    // decadimento di un giorno
    forma *= Math.exp(-1 / M.tau_forma);
    fatica *= Math.exp(-1 / M.tau_fatica);
  }
  return { forma, fatica, prontezza: M.k_forma * forma - M.k_fatica * fatica };
}

/** Serie storica di forma/fatica/prontezza per il grafico. */
function serieFormaFatica(mus, days) {
  return days.map(k => ({ k, ...formaFatica(mus, k, 90) }));
}

/* Memoria di una passata sola.
   Misurato: statoMuscoli() chiama formaFatica() per tutti e tredici i muscoli,
   e ognuna riscorre 121 giorni di registro — 1573 giorni scanditi a ogni
   apertura della scheda Gym. Subito dopo scaricoConsigliato() ne rifa'
   altrettanti. Con pochi dati non si nota; con due anni di sedute su un
   telefono vecchio si notera'. La chiave e' il giorno piu' la revisione dello
   stato, la stessa che usa gia' il motore di previsione: se registri una serie
   il numero cambia e la cache cade da sola. */
const _ffCache = new Map();
/**
 * La forma-fatica e' memorizzata per muscolo: dopo qualunque modifica alle
 * serie continuerebbe a rispondere coi numeri di prima. Era gia' scritto a
 * mano in tre punti e mancava nel quarto — quello che cancellava una serie
 * dalla seduta libera.
 */
function scordaFatica() { _ffCache.clear(); }
function ffKey(k) {
  return k + '|' + Object.keys(P().sessioni || {}).length + '|' + (S.model?.rev || 0);
}
function formaFaticaCache(mus, fino) {
  const key = ffKey(fino) + '|' + mus;
  if (_ffCache.has(key)) return _ffCache.get(key);
  if (_ffCache.size > 200) _ffCache.clear();     // non e' un archivio, e' un respiro
  const v = formaFatica(mus, fino);
  _ffCache.set(key, v);
  return v;
}

/** Stato di ogni muscolo: volume settimanale + forma/fatica. */
function statoMuscoli(k = today()) {
  const sett = windowDays(k, 7);
  const vol = volumeMuscoli(sett);
  const V = PD?.volume || { min_serie: 10, ottimale: 16, max_serie: 22 };
  // scala comune per la mappa: il massimo corrente, altrimenti i colori
  // di due muscoli non sarebbero confrontabili fra loro
  const ff = {};
  for (const m of muscoli()) ff[m.id] = formaFaticaCache(m.id, k);
  const maxFat = Math.max(0.001, ...Object.values(ff).map(x => x.fatica));
  const maxForma = Math.max(0.001, ...Object.values(ff).map(x => x.forma));
  const rifVolume = Math.max(V.min_serie || 10,
    ...muscoli().map(m => vol[m.id].serie));
  const out = {};
  for (const m of muscoli()) {
    const v = vol[m.id], f = ff[m.id];
    const rl = typeof caricoRelativo === 'function'
      ? caricoRelativo(m.id, k) : { dati: false, rel: null };
    out[m.id] = {
      id: m.id, nome: m.nome, serie: v.serie, tonn: v.tonn, sedute: v.sedute,
      forma: f.forma, fatica: f.fatica, prontezza: f.prontezza,
      nFatica: f.fatica / maxFat,
      nForma: f.forma / maxForma,
      // Il volume si misurava su una costante (22 serie): in una settimana
      // normale il gruppo piu' allenato ne fa otto, quindi la mappa usava un
      // terzo della tavolozza e sembrava spenta. Si normalizza sul gruppo piu'
      // caricato della settimana — come gia' fanno fatica e forma — con un
      // pavimento al minimo consigliato, o una settimana da due serie in tutto
      // si dipingerebbe come una settimana piena.
      nVolume: Math.min(1, v.serie / rifVolume),
      stato: v.serie === 0 ? 'fermo'
           : v.serie < V.min_serie ? 'sotto'
           : v.serie > V.max_serie ? 'sopra' : 'ok',
      /* "Pronto" era `fatica < forma * 0.55`, cioe' una soglia fissa su un
         rapporto che per costruzione sta sempre sotto: l'app diceva pronto
         anche il giorno dopo una seduta pesante. Ora il confronto e' con il
         regime di quel muscolo — vedi caricoRelativo() — e senza abbastanza
         storia non si dice niente invece di dire "pronto". */
      rel: rl.rel, relDati: rl.dati,
      pronto: rl.dati ? rl.rel < 1.25 : null
    };
  }
  return out;
}

/* ------------------------------------------------------ spesa energetica */
/**
 * Calorie bruciate in una giornata di allenamento, palestra e HYROX insieme.
 *
 * ATTENZIONE, e' il punto dove quasi tutte le app sbagliano: questo numero NON
 * va sommato al target ne' sottratto dall'introito. Il dispendio stimato dal
 * filtro di Kalman nasce dal bilancio energetico osservato — introito contro
 * variazione del peso — e quindi CONTIENE GIA' tutto quello che ti muovi,
 * allenamenti compresi. Sommarlo di nuovo significherebbe contare due volte lo
 * stesso lavoro e mangiare di piu' credendo di essere in pari.
 *
 * Serve a un'altra cosa: misurare il carico di lavoro nel tempo, vedere le
 * settimane vuote e capire quanto pesa una seduta rispetto a un'altra.
 */
function kcalAllenamento(k) {
  const M = PD?.met; if (!M) return { tot: 0, righe: [] };
  const peso = lastWeight() ?? D.profilo.peso_iniziale_kg;
  const met = (m, min) => m * 3.5 * peso / 200 * min;
  const righe = [];

  const ser = serieDelGiorno(k);
  if (ser.length) {
    const sess = P().sessioni[k];
    // durata dichiarata se c'e', altrimenti stimata dalle serie (tempo sotto
    // tensione piu' recupero): e' una stima, e la UI lo dice
    const min = sess?.durata || Math.min(150, Math.max(15, ser.length * M.minuti_per_serie));
    righe.push({ tipo: 'Pesi', min, kcal: met(M.pesi, min), stimata: !sess?.durata });
  }

  const sim = (S.hyrox?.sim || []).find(s => s.data === k && s.totale > 0);
  if (sim) {
    const min = sim.totale / 60;
    const km = (sim.corse || []).filter(x => x > 0).length;
    // la corsa si conta a chilometri, che e' piu' preciso dei MET
    const kcalCorsa = km * peso * M.corsa_kcal_per_kg_km;
    const minStaz = Math.max(0, min - (sim.corse || []).reduce((a, b) => a + (b || 0), 0) / 60);
    righe.push({ tipo: 'Gara', min, kcal: kcalCorsa + met(M.simulazione, minStaz) });
  } else {
    const hs = S.hyrox?.sessioni?.[k];
    if (hs && hs.fatto) {
      const a = HX?.allenamenti.find(x => x.id === hs.id);
      const min = hs.durata || a?.durata || 45;
      righe.push({ tipo: 'HYROX', min, kcal: met(M[a?.tipo] ?? M.capacita, min) });
    }
  }
  // il cardio ha il suo conto — sulla corsa a chilometri, sul resto a MET —
  // e finisce nello stesso totale: e' sempre lavoro fatto
  if (typeof cardioDi === 'function') for (const c of cardioDi(k))
    righe.push({ tipo: cardioTipo(c.tipo).n, min: Math.round((c.durata_s || 0) / 60),
                 kcal: c.kcal ?? kcalCardio(c) });

  return { tot: righe.reduce((a, r) => a + r.kcal, 0), righe };
}

/**
 * Tendenza dei carichi, calcolata invece che dichiarata a mano.
 *
 * Il massimale stimato con Epley corretto col RIR e' gia' la variabile che
 * mette d'accordo "meno ripetizioni ma piu' peso" e "stesso peso ma piu'
 * ripetizioni": due sedute con lo stesso e1RM sono progresso zero, comunque
 * siano composte. Quindi si guarda la pendenza dell'e1RM esercizio per
 * esercizio, la si normalizza sul valore corrente — un +2,5 kg su 60 non vale
 * come su 200 — e si prende la MEDIANA fra esercizi, che un singolo record
 * fortunato non riesce a spostare.
 */
function caricoTrend(k = today(), settimane = 8) {
  const da = addDays(k, -settimane * 7);
  const usati = [...new Set(Object.keys(P().sessioni).filter(x => x >= da && x <= k)
    .flatMap(x => serieDelGiorno(x).map(s => s.ex)))];
  const pend = [];
  for (const id of usati) {
    const serie = e1rmPerSeduta(id).filter(x => x.k >= da && x.k <= k);
    if (serie.length < 3) continue;
    const t0 = new Date(serie[0].k);
    const pts = serie.map(s => ({ x: (new Date(s.k) - t0) / 864e5, y: s.v }));
    const R = regressione(pts);
    const base = avg(serie.map(s => s.v));
    if (!R || !(base > 0)) continue;
    pend.push({ id, nome: esercizio(id)?.nome || id,
                pctSett: (R.m * 7) / base * 100, r2: R.r2, n: serie.length });
  }
  if (pend.length < 2) return { stato: null, n: pend.length, pend };
  const ord = pend.map(x => x.pctSett).sort((a, b) => a - b);
  const med = ord.length % 2 ? ord[(ord.length - 1) / 2]
    : (ord[ord.length / 2 - 1] + ord[ord.length / 2]) / 2;
  return {
    stato: med > 0.3 ? 'su' : med < -0.3 ? 'giu' : 'fermi',
    mediana: med, n: pend.length,
    pend: pend.slice().sort((a, b) => b.pctSett - a.pctSett)
  };
}

/* ---------------------------------------------------- progressione e forza */
/** Tutte le serie di un esercizio, in ordine di data. */
function serieEsercizio(id) {
  const out = [];
  for (const k of Object.keys(P().sessioni).sort())
    for (const s of serieDelGiorno(k)) if (s.ex === id) out.push({ k, ...s });
  return out;
}
/** Il miglior massimale stimato di ogni seduta. */
function e1rmPerSeduta(id) {
  const per = {};
  for (const s of serieEsercizio(id)) {
    const v = e1rm(s.kg, s.reps, s.rir);
    if (v > (per[s.k] || 0)) per[s.k] = v;
  }
  return Object.keys(per).sort().map(k => ({ k, v: per[k] }));
}

/** Regressione lineare ai minimi quadrati: pendenza, intercetta, R². */
function regressione(pts) {
  const n = pts.length;
  if (n < 3) return null;
  const x = pts.map(p => p.x), y = pts.map(p => p.y);
  const mx = avg(x), my = avg(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (!sxx) return null;
  const m = sxy / sxx, q = my - m * mx;
  const r2 = syy ? (sxy * sxy) / (sxx * syy) : 0;
  const res = pts.map(p => p.y - (m * p.x + q));
  const sd = Math.sqrt(avg(res.map(r => r * r)) || 0);
  return { m, q, r2, sd, n };
}

/**
 * Previsione della forza: retta sui massimali stimati nel tempo.
 * Non e' un filtro di Kalman come per il peso, e per un buon motivo: qui le
 * osservazioni sono poche e distanti (una per seduta), non una al giorno, e il
 * segnale e' molto piu' grande del rumore. Una retta con la sua banda dice
 * quello che serve senza fingere una precisione che non c'e'.
 */
function previsioneForza(id, orizzonte = 28) {
  const serie = e1rmPerSeduta(id);
  if (serie.length < 3) return null;
  const t0 = new Date(serie[0].k);
  const pts = serie.map(s => ({ x: (new Date(s.k) - t0) / 864e5, y: s.v }));
  const R = regressione(pts);
  if (!R) return null;
  const ultimoX = pts[pts.length - 1].x;
  const fra = R.m * (ultimoX + orizzonte) + R.q;
  return {
    serie, kgSettimana: R.m * 7, r2: R.r2, sd: R.sd, n: R.n,
    ora: serie[serie.length - 1].v, fra, orizzonte,
    // pavimento a 2,5 kg, il disco piu' piccolo: sotto quella soglia la
    // forbice sarebbe piu' fine di quanto si possa caricare
    banda: Math.max(2.5, 1.96 * R.sd * Math.sqrt(1 + 1 / R.n))
  };
}

/**
 * Doppia progressione. Si sale di carico solo quando TUTTE le serie toccano il
 * tetto del range con poco in serbatoio; finche' no, si aggiungono ripetizioni.
 * Alzare il peso prima significa solo fare meno lavoro con un numero piu' bello.
 */
/* ============================================ gli esercizi che si fanno per lato
 *
 * Un curl alternato, un affondo, una row a un braccio: la serie la fai due
 * volte — una per parte — e il carico e' quello di **un** lato. Scritto
 * "3 x 8-10, 20 kg" dice meta' della verita': le serie vere sono sei e i chili
 * in mano sono venti per parte.
 *
 * E' una **dichiarazione, non un indovinello**: il nome non basta. "Affondi"
 * si fanno per lato e non lo dice, "Alzate laterali" ha "laterali" nel nome e
 * si fanno insieme. Quindi c'e' un interruttore nell'editor dell'esercizio, e
 * il catalogo di base parte con quelli in cui la cosa e' fuori discussione.
 *
 * **E' un'etichetta, non un conto.** Il tonnellaggio, il volume per muscolo e
 * la forma-fatica non cambiano: ricalcolarli vorrebbe dire raddoppiare
 * all'indietro tutte le sedute gia' registrate, cioe' riscrivere lo storico
 * per una questione di scrittura. La nota lo dice.
 */
const perLato = ex => !!(ex && ex.lato);
/** "x2" da appendere dove si scrivono le serie o i chili, se serve. */
const x2 = ex => perLato(ex) ? '<span class="x2">\u00d72</span>' : '';

function prossimoPasso(id) {
  const ex = esercizio(id); if (!ex) return null;
  const tutte = serieEsercizio(id);
  if (!tutte.length) return null;
  const ultimoGiorno = tutte[tutte.length - 1].k;
  const ultime = tutte.filter(s => s.k === ultimoGiorno);
  const [lo, hi] = ex.range || [8, 12];
  const soglia = PD?.progressione?.rir_soglia ?? 2;
  const kg = Math.max(...ultime.map(s => +s.kg || 0));
  const tutteAlTetto = ultime.every(s => (+s.reps || 0) >= hi && (+s.rir ?? 9) <= soglia);
  if (tutteAlTetto && ex.incremento > 0) {
    return { tipo: 'carico', kg: kg + ex.incremento, da: kg, reps: lo,
      testo: `Sali a ${nf(kg + ex.incremento, 1)} kg e riparti da ${lo} ripetizioni.` };
  }
  const piuBassa = ultime.reduce((a, b) => (+a.reps || 0) <= (+b.reps || 0) ? a : b);
  if ((+piuBassa.reps || 0) >= hi) {
    return { tipo: 'attesa', kg,
      testo: `Sei al tetto del range ma con RIR alto: ripeti ${nf(kg, 1)} kg cercando di arrivare piu' vicino al cedimento.` };
  }
  return { tipo: 'ripetizioni', kg, reps: (+piuBassa.reps || 0) + 1,
    testo: `Resta a ${nf(kg, 1)} kg e porta la serie piu' bassa a ${(+piuBassa.reps || 0) + 1} ripetizioni (il range e' ${lo}–${hi}).` };
}

/* ============================================================ mappa muscolare
 *
 * Prima era una figura parametrica con sopra dodici ellissi: diceva DOVE, ma
 * un'ellisse sul petto non e' un petto, e a colpo d'occhio non si capiva mai
 * se una zona era accesa perche' l'avevi allenata o perche' la macchia era
 * grande. Ora i tracciati sono anatomici — ogni ventre muscolare ha la sua
 * forma — e il colore riempie esattamente il muscolo.
 *
 * I tracciati vengono da react-native-body-highlighter di ELABBASSI Hicham,
 * licenza MIT, e stanno in data/corpo.json insieme alla nota di licenza.
 * Quello che e' nostro e' la MAPPATURA: i 19 slug della sorgente ricondotti ai
 * 13 muscoli del modello di questa app. Adduttori, tibiale, collo, mani, piedi
 * e ginocchia restano sagoma neutra — non perche' non contino, ma perche' nel
 * modello di questa app non esistono come gruppi, e colorarli vorrebbe dire
 * inventarsi un dato. E' la stessa scelta gia' fatta con free-exercise-db.
 *
 * La figura maschile e quella femminile sono due disegni diversi, e si sceglie
 * dal profilo: mostrare a una donna una silhouette maschile e' il tipo di
 * dettaglio che fa sembrare l'app scritta per qualcun altro.
 */

/** Un livello 0–4 della rampa sequenziale gia' validata. */
/**
 * Dal valore normalizzato alla tinta, e il punto e' la SFUMATURA.
 *
 * Prima erano quattro gradini secchi su una scala lineare: `ceil(v * 4)`.
 * Due difetti che si sommavano e schiacciavano tutto in fondo alla scala.
 *
 * 1. **Il primo gradino teneva un quarto del mondo.** Tutto quello che stava
 *    fra il 2% e il 25% usciva dello stesso identico colore: un muscolo con
 *    due serie e uno con cinque erano indistinguibili, ed e' proprio li' che
 *    sta quasi tutto quello che uno vede in una settimana normale.
 * 2. **La scala era lineare**, ma i dati non lo sono: il volume settimanale
 *    per gruppo e' una distribuzione con la coda a destra — un paio di gruppi
 *    alti e otto bassi — quindi meta' della tavolozza restava inutilizzata.
 *
 * La radice quadrata allunga la parte bassa, che e' dove stanno i dati:
 * 5% e 15% passano da "stesso gradino" a due gradini diversi. E dentro ogni
 * gradino l'opacita' continua a salire, cosi' due muscoli vicini non sono mai
 * esattamente lo stesso colore.
 */
/* I quattro toni della tavolozza sequenziale sono stati scelti con passi di
   luminosita' regolari. Mescolarli fra loro da' una scala continua che
   mantiene quella regolarita', cosa che l'opacita' su una tinta sola non fa:
   al fondo della scala un verde trasparente su fondo scuro sparisce prima di
   diventare "poco". Dove color-mix non c'e' — Safari sotto la 16.2 — si
   ripiega sull'opacita', che e' peggio ma non e' rotto. */
const _mixOK = typeof CSS !== 'undefined' && CSS.supports
  && CSS.supports('color', 'color-mix(in oklab, red, blue)');

function intensita(v) {
  const q = Math.max(0, Math.min(1, v || 0));
  if (q <= 0.015) return { on: false, fill: 'var(--paper)', op: 1 };
  /* Gamma 0,65: la radice quadrata piena allungava troppo e portava anche i
     gruppi da due serie a meta' tavolozza, lasciando inutilizzato il tono
     piu' chiaro. Con 0,65 il fondo resta pallido E il 5% si distingue dal
     15%, che era il punto. */
  const t = Math.pow(q, 0.65);
  if (!_mixOK) return { on: true, fill: 'var(--s4)', op: 0.16 + 0.84 * t };
  /* La scala parte dal colore della superficie e non dal primo tono: cosi'
     gli intervalli diventano quattro invece di tre, e soprattutto "quasi
     niente" torna a somigliare a quasi niente. Con la scala che partiva da
     --s1 anche un gruppo al 2% del piu' caricato usciva verde pieno. */
  const scala = ['var(--wash)', 'var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
  const x = t * (scala.length - 1);
  const i = Math.min(scala.length - 2, Math.floor(x)), f = x - i;
  return { on: true, op: 1,
    fill: `color-mix(in oklab, ${scala[i]} ${((1 - f) * 100).toFixed(1)}%, ${scala[i + 1]})` };
}

/** La vista giusta per profilo e lato. */
function vistaCorpo(vista) {
  if (!CORPO) return null;
  const sesso = D.profilo?.sesso === 'f' ? 'f' : 'm';
  return CORPO.viste[sesso + '-' + vista] || CORPO.viste['m-' + vista] || null;
}

function mappaSVG(vista, stato, modo, onTap) {
  const V = vistaCorpo(vista);
  if (!V) {
    const box = el('div', 'muted');
    box.textContent = 'Sagoma non caricata: serve data/corpo.json.';
    return box;
  }
  const s = mk('svg', { viewBox: V.viewBox, role: 'img',
    'aria-label': `Mappa muscolare, vista ${vista}` });

  /* la sagoma neutra sotto: da' la figura senza chiedere attenzione */
  const g0 = mk('g', { fill: 'var(--wash)', stroke: 'var(--rule)',
    'stroke-width': 1.2, 'stroke-linejoin': 'round' });
  for (const d of V.neutri) g0.append(mk('path', { d }));
  s.append(g0);

  /* i muscoli sopra, ognuno un gruppo cliccabile */
  for (const [id, paths] of Object.entries(V.muscoli)) {
    const st = stato[id];
    const v = !st ? 0
      : modo === 'fatica' ? st.nFatica : modo === 'forma' ? st.nForma : st.nVolume;
    const { on, fill, op } = intensita(v || 0);
    /* I quattro gradini discreti erano il problema, non la soluzione: fra il
       2% e il 25% usciva un colore solo. Ora la scala non ha gradini, quindi
       due muscoli con volumi diversi non hanno mai lo stesso colore. */
    const g = mk('g', {
      fill,
      'fill-opacity': op.toFixed(3),
      stroke: 'var(--pine)', 'stroke-width': 1.1,
      'stroke-linejoin': 'round',
      opacity: on ? 1 : 0.5,
      style: 'cursor:pointer', class: 'mus' + (on ? ' on' : '')
    });
    g.setAttribute('data-mus', id);
    for (const d of paths) g.append(mk('path', { d }));
    if (st) {
      const t = mk('title');
      t.textContent = st.nome;
      g.append(t);
      g.addEventListener('pointerdown', () => onTap(st));
    }
    s.append(g);
  }

  /* i muscoli accesi entrano uno dopo l'altro, dal piu' caldo: e' l'ordine in
     cui li leggeresti comunque */
  if (typeof osserva === 'function') osserva(s, () => {
    if (!motionOk()) return;
    const acc = [...s.querySelectorAll('.mus.on')];
    // l'intensita' ora sta in fill-opacity: animando opacity si parte da zero
    // e si torna a uno, senza toccare il dato che il colore porta
    acc.forEach((g, i) => g.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 320, delay: 60 + i * 70, fill: 'backwards' }));
  });
  return s;
}

/* ==================================================================== viste
 *
 * Gym era una colonna di dodici carte una sotto l'altra: mappa, prontezza,
 * volume, forma-fatica, progressione, tonnellaggio, schede, storico. Tutto
 * utile e tutto sempre in mezzo, per cui per registrare una serie si scorreva
 * mezzo schermo e per rivedere il volume si scorreva l'altro mezzo.
 *
 * Ora e' un ingresso: cosa fai oggi in cima, gli avvisi che non possono
 * aspettare subito sotto, e il resto dentro riquadri con icona e stato — si
 * apre quello che serve. E' lo stesso schema dei cinque passi del Piano, che
 * gia' funziona, non un'invenzione nuova.
 *
 * Regola per decidere cosa sta in cima e cosa dentro un riquadro: in cima ci
 * va quello che cambia oggi e che richiede un'azione. Tutto quello che si
 * guarda ogni tanto e' una sezione.
 */
let gymVista = 'fronte', gymModo = 'volume', gymEx = null, gymTab = null;

/* Icone di sistema, disegnate qui: sono sette tratti, non vale una libreria.
   Tutte sullo stesso riquadro 24x24, stesso spessore, stesso arrotondamento —
   e' quello che le fa sembrare una famiglia invece di sette disegni. */
function iconaGym(id) {
  const P = {
    mappa: 'M12 2.8a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6M8.2 9.4h7.6M8.2 9.4 6.5 15M15.8 9.4 17.5 15M10.3 9.4v11.8M13.7 9.4v11.8',
    progressi: 'M4 18.5 9 12l3.6 3.2L20 6M20 6h-4.6M20 6v4.4',
    cardio: 'M12 20.2S4.2 15 4.2 9.9A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7.8 1.9c0 5.1-7.8 10.3-7.8 10.3z',
    schede: 'M5 5h14M5 10h14M5 15h9M5 20h9',
    esercizi: 'M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10',
    carico: 'M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16M12 12l4-3',
    storico: 'M12 7v5l3.2 2M21 12a9 9 0 1 1-9-9',
    monitor: 'M4 20h16M6 20v-6M11 20V8M16 20v-9M21 20V5',
    hyrox: 'M6 4v16M18 4v16M6 12h12M3 8h3M18 8h3M3 16h3M18 16h3'
  };
  const s = mk('svg', { viewBox: '0 0 24 24', class: 'ic-g', 'aria-hidden': 'true' });
  s.append(mk('path', { d: P[id] || P.schede, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
}

/** Un riquadro dell'ingresso: icona, titolo, e una riga che dice a che punto sei. */
function riquadroGym(id, titolo, stato, fn, acceso) {
  const b = el('button', 'gym-t' + (acceso ? ' on' : ''));
  b.append(iconaGym(id));
  const t = el('span', 'body');
  t.append(el('span', 't', esc(titolo)));
  t.append(el('span', 's', stato));
  b.append(t);
  b.onclick = fn;
  return b;
}

function viewPalestra(v) {
  if (!PD) { v.append(el('div', 'card', '<p class="muted">Catalogo esercizi non caricato.</p>')); return; }
  const k = today();
  if (gymTab) return sezioneGym(v, k);
  const st = statoMuscoli(k);

  /* --- cosa hai fatto oggi, e il bottone per farne --- */
  /* Una seduta senza serie non e' una seduta: e' la traccia di un tocco.
     La stessa regola dello storico, che gia' le salta. Qui reggeva
     l'etichetta del bottone e la riga di riepilogo, e diceva "Continua la
     seduta" (poi "Seduta — 0 serie, 0 kg") a chi non aveva ancora fatto
     niente. */
  const sess = P().sessioni[k];
  const oggi = sess?.serie?.length ? sess : null;
  const card2 = typeof cardioDi === 'function' ? cardioDi(k) : [];
  const testa = el('div', 'card');
  testa.append(el('div', 'eyebrow', 'Oggi'));
  if (oggi || card2.length) {
    const parti = [];
    if (oggi) {
      const ton = oggi.serie.reduce((a, s) => a + (+s.kg || 0) * (+s.reps || 0), 0);
      parti.push(`<strong>${esc(oggi.nome || 'Seduta')}</strong> — ${oggi.serie.length} serie, ${nf(ton)} kg`);
    }
    for (const c of card2)
      parti.push(`<strong>${esc(cardioTipo(c.tipo).n)}</strong> — ${hms2(c.durata_s || 0)}${
        c.distanza_m ? ', ' + nf(c.distanza_m / 1000, 2) + ' km' : ''}`);
    testa.append(el('div', 'muted', parti.join('<br>')));
  } else {
    testa.append(el('div', 'muted', 'Niente registrato oggi.'));
  }
  const rr = el('div', 'row');
  rr.style.cssText = 'gap:8px;margin-top:10px';
  const bReg = el('button', 'btn pri grow', oggi ? 'Continua la seduta' : 'Registra pesi');
  bReg.onclick = () => sheetSeduta(k);
  const bCar = el('button', 'btn grow', 'Cardio');
  bCar.onclick = () => { gymTab = 'cardio'; route(); };
  rr.append(bReg, bCar);
  testa.append(rr);
  v.append(testa);

  /* --- solo cio' che non puo' aspettare: uno scarico consigliato, un dolore
         in corso. Il resto sta dentro i riquadri. --- */
  if (typeof scaricoConsigliato === 'function') {
    const sc = scaricoConsigliato(k);
    if (sc.serve) {
      const a = el('button', 'gym-avv');
      a.innerHTML = '<span class="t">Conviene scaricare</span>'
        + `<span class="d">${esc(sc.motivi.map(m => m.t).slice(0, 2).join('. '))}.</span>`;
      a.onclick = () => { gymTab = 'carico'; route(); };
      v.append(a);
    }
  }
  const acc = typeof acciacchiAttivi === 'function' ? acciacchiAttivi(k) : [];
  if (acc.length) {
    const a = el('button', 'gym-avv');
    a.innerHTML = `<span class="t">${acc.length === 1 ? 'Un dolore in corso' : acc.length + ' dolori in corso'}</span>`
      + `<span class="d">${esc(acc.map(x => muscolo(x.mus)?.nome || x.mus).join(', '))}. `
      + 'Gli esercizi che ci vanno sopra sono nascosti dalle schede.</span>';
    a.onclick = () => { gymTab = 'carico'; route(); };
    v.append(a);
  }

  /* --- i riquadri --- */
  const g = el('div', 'gym-grid');
  const piuCarichi = Object.values(st).filter(s => s.serie > 0)
    .sort((a, b) => b.serie - a.serie).slice(0, 2).map(s => s.nome.toLowerCase());
  g.append(riquadroGym('mappa', 'Mappa muscolare',
    piuCarichi.length ? esc(piuCarichi.join(' e ')) + ' i piu\' caricati'
                      : 'nessuna serie questa settimana',
    () => { gymTab = 'mappa'; route(); }));

  const usati = [...new Set(Object.keys(P().sessioni)
    .flatMap(kk => serieDelGiorno(kk).map(s => s.ex)))];
  const migl = usati.map(id => ({ id, p: previsioneForza(id) })).filter(x => x.p)
    .sort((a, b) => b.p.kgSettimana - a.p.kgSettimana)[0];
  g.append(riquadroGym('progressi', 'Progressi',
    migl ? `${esc(esercizio(migl.id)?.nome || '')} ${migl.p.kgSettimana >= 0 ? '+' : ''}${nf(migl.p.kgSettimana, 2)} kg/sett`
         : 'servono tre sedute per esercizio',
    () => { gymTab = 'progressi'; route(); }));

  const sett = windowDays(k, 7);
  const nCard = typeof cardioDi === 'function'
    ? sett.reduce((a, d) => a + cardioDi(d).length, 0) : 0;
  const kmCard = typeof cardioDi === 'function'
    ? sett.reduce((a, d) => a + cardioDi(d).reduce((x, c) => x + (c.distanza_m || 0), 0), 0) / 1000 : 0;
  g.append(riquadroGym('cardio', 'Cardio',
    nCard ? `${nCard} questa settimana${kmCard ? ' · ' + nf(kmCard, 1) + ' km' : ''}`
          : 'niente questa settimana',
    () => { gymTab = 'cardio'; route(); }));

  const seg = schedeSeguite();
  if (seg.length) {
    const mon = monitoraggioProgramma(seg, k);
    g.append(riquadroGym('monitor', mon.uno ? 'Scheda in corso' : 'Programma in corso',
      mon.pochiDati ? `${mon.sedute.length} sedute: servono dati`
        : mon.cambiare ? (mon.uno ? 'conviene cambiarla' : 'conviene cambiarlo')
        : `${mon.settimane}ª settimana · ${mon.mediana == null ? 'niente da dire'
            : (mon.mediana >= 0 ? '+' : '') + nf(mon.mediana, 1) + '% sui carichi'}`,
      () => { gymTab = 'monitor'; route(); }, mon.cambiare));
  }

  g.append(riquadroGym('schede', 'Schede',
    schede().length ? schede().length + (schede().length === 1 ? ' scheda' : ' schede')
                    : 'nessuna, per ora',
    () => sheetSchede()));

  g.append(riquadroGym('esercizi', 'Esercizi',
    `${catalogo().length} in catalogo · ${P().esercizi.length} tuoi`,
    () => { gymTab = 'esercizi'; route(); }));

  const sc2 = typeof scaricoConsigliato === 'function' ? scaricoConsigliato(k) : { dati: false };
  g.append(riquadroGym('carico', 'Carico e acciacchi',
    !sc2.dati ? 'servono nove sedute'
      : sc2.serve ? 'conviene scaricare'
      : acc.length ? acc.length + ' in corso' : 'sotto controllo',
    () => { gymTab = 'carico'; route(); }, sc2.serve || acc.length));

  const nSed = Object.keys(P().sessioni)
    .filter(x => (P().sessioni[x]?.serie || []).length).length;
  g.append(riquadroGym('storico', 'Storico',
    nSed ? nSed + (nSed === 1 ? ' seduta' : ' sedute') : 'ancora niente',
    () => { gymTab = 'storico'; route(); }));

  if (HX && usaHyrox()) {
    const gg = giorniAllaGara();
    g.append(riquadroGym('hyrox', 'Road to HYROX',
      gg != null ? (gg > 0 ? gg + ' giorni alla gara' : gg === 0 ? 'oggi si corre' : 'gara passata')
                 : '8 km e 8 stazioni',
      () => { apri('#/hyrox'); }));
  }
  v.append(g);
  if (typeof osserva === 'function')
    osserva(g, () => entrata([...g.children], { passo: 40, su: 8 }));
}

/** Torna all'ingresso. Ogni sezione ne ha uno in cima. */
function indietroGym() {
  const b = el('button', 'btn sm', '‹ Gym');
  b.style.marginBottom = '10px';
  b.onclick = () => { gymTab = null; gymEx = null; route(); };
  return b;
}

function sezioneGym(v, k) {
  v.append(indietroGym());
  const st = statoMuscoli(k);
  ({ mappa: sezGymMappa, progressi: sezGymProgressi, cardio: sezGymCardio,
     carico: sezGymCarico, storico: sezGymStorico,
     esercizi: sezGymEsercizi, monitor: sezGymMonitor }[gymTab] || sezGymMappa)(v, k, st);
}

/* -------------------------------------------------------- le sezioni
   Il contenuto e' quello di prima, parola per parola: e' cambiato dove sta,
   non cosa dice. Spostare e riscrivere insieme e' il modo migliore di
   introdurre un bug e non accorgersene. */

function sezGymMappa(v, k, st) {
  const V = PD.volume;
  /* --- mappa muscolare --- */
  const cm = el('div', 'cw');
  cm.append(el('h3', null, 'Mappa muscolare'));
  cm.append(el('div', 'sub', {
    volume: 'Serie pesate nella settimana appena chiusa. Piu' + '’ scuro = piu’ volume.',
    fatica: 'Fatica residua secondo il modello forma–fatica. Piu’ scuro = piu’ stanco.',
    forma: 'Forma accumulata: l’adattamento che resta dopo che la fatica se n’e’ andata.'
  }[gymModo]));

  const modi = el('div', 'seg');
  for (const [id, lab] of [['volume', 'Volume'], ['fatica', 'Stanchi'], ['forma', 'In crescita']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', gymModo === id);
    b.onclick = () => { gymModo = id; route(); };
    modi.append(b);
  }
  cm.append(modi);

  const viste = el('div', 'posebar');
  viste.style.marginTop = '10px';
  for (const [id, lab] of [['fronte', 'Fronte'], ['schiena', 'Schiena']]) {
    const b = el('button', 'btn' + (gymVista === id ? ' pri' : ''), lab);
    b.onclick = () => { gymVista = id; route(); };
    viste.append(b);
  }
  cm.append(viste);

  /* La lettura dice tutti e tre i numeri della mappa, non solo quello del
     modo acceso: sono le tre domande che i tre bottoni qui sopra pongono, e
     toccando un muscolo si vogliono sapere tutte e tre insieme — quanto lo
     alleno, quanto e' stanco, quanto sta crescendo. Prima usciva una frase
     generica ("nella norma") che non si capiva a cosa si riferisse.
     Quello del modo acceso e' in evidenza, cosi' il numero e il colore che
     hai davanti restano legati. */
  const read = el('div', 'read', '<span class="ph">Tocca un muscolo</span>');
  const box = el('div', 'bodywrap gymmap');
  box.append(mappaSVG(gymVista, st, gymModo, s => {
    const voce = (modo, lab, v) => `<span class="${gymModo === modo ? 'ev' : ''}">`
      + `${lab} <b>${v == null ? '—' : nf(v * 100) + '%'}</b></span>`;
    read.innerHTML = `<span><b>${esc(s.nome)}</b></span>`
      + `<span>${nf(s.serie, 1)} serie</span>`
      + voce('volume', 'volume', s.nVolume)
      + voce('fatica', 'stanchezza', s.nFatica)
      + voce('forma', 'in crescita', s.nForma)
      + (s.relDati
        ? `<span>fatica <b>${nf(s.rel, 2)}×</b> il tuo solito`
          + ` · ${s.pronto ? 'nella norma' : 'piu\' carico'}</span>`
        : '<span class="muted">poca storia per il confronto</span>');
  }));
  cm.append(box);
  cm.append(read);
  // la legenda disegna la scala vera: la stessa tinta a intensita' crescente,
  // non quattro colori che sulla mappa non esistono piu'
  cm.append(el('div', 'calscale',
    `<span>${gymModo === 'volume' ? 'poco' : 'basso'}</span>`
    + [.06, .2, .4, .65, 1].map(q => {
        const t2 = intensita(q);
        return `<i style="background:${t2.fill};opacity:${t2.op.toFixed(2)}"></i>`;
      }).join('')
    + `<span>${gymModo === 'volume'
      ? `${nf(Math.max(V.min_serie || 10, ...muscoli().map(m => st[m.id].serie)), 0)} serie`
      : 'alto'}</span>`));
  cm.append(el('p', 'note',
    (gymModo === 'volume'
      ? 'Il colore e\' relativo alla settimana che stai guardando: il pieno e\' il '
        + 'gruppo piu\' caricato, con un minimo di ' + (V.min_serie || 10) + ' serie '
        + 'perche\' una settimana quasi vuota non si dipinga come una piena. '
        + 'Per il confronto con i riferimenti c\'e\' il volume settimanale qui sotto. '
      : 'Il colore e\' relativo: il pieno e\' il gruppo messo peggio, non una soglia. ')
    + 'Le tre percentuali della lettura seguono la stessa regola — ognuna e\' '
    + 'rispetto al gruppo che guida quella classifica, non una quota assoluta: '
    + '"stanchezza 100%" vuol dire "il piu\' stanco di oggi", non "distrutto". '
    + 'Il moltiplicatore accanto e\' invece un confronto con te stesso. '
    + 'I tracciati sono anatomici: ogni ventre muscolare ha la sua forma, e il colore '
    + 'riempie il muscolo vero. La figura segue il sesso del profilo. Adduttori, '
    + 'tibiale e collo restano grigi: esistono nel disegno ma non fra i tredici '
    + 'gruppi che questa app conta, e colorarli vorrebbe dire inventarsi un dato. '
    + 'La silhouette non e’ in scala sulle tue misure — per quella c’e’ la scheda Corpo.'));
  v.append(cm);

  /* --- prontezza --- */
  // pronto puo' essere null (poca storia): quello non e' ne' pronto ne' stanco
  const pronti = Object.values(st).filter(s => s.pronto === true && s.forma > 0.2);
  const stanchi = Object.values(st).filter(s => s.pronto === false && s.fatica > 0.2)
    .sort((a, b) => b.nFatica - a.nFatica);
  const cp = el('div', 'card flat');
  cp.append(el('div', 'eyebrow', 'Cosa allenare oggi'));
  if (!stanchi.length && !pronti.length) {
    cp.append(el('div', 'muted', 'Registra qualche seduta e qui comparira’ quali gruppi sono recuperati e quali no.'));
  } else {
    cp.append(el('div', 'muted',
      (stanchi.length
        ? `Piu’ carichi del solito: <strong>${stanchi.slice(0, 4).map(s => esc(s.nome.toLowerCase())).join(', ')}</strong>. `
        : 'Nessun gruppo porta piu’ fatica del suo solito. ')
      + (pronti.length
        ? `Nella norma o meglio: <strong>${pronti.slice(0, 5).map(s => esc(s.nome.toLowerCase())).join(', ')}</strong>.`
        : '')));
    cp.append(el('div', 'hint',
      'Il confronto non e’ con una soglia fissa ma con il tuo solito su quel '
      + 'muscolo: la fatica di oggi divisa quella che porti normalmente. Sopra '
      + '1,25 e’ "piu’ carico del solito". E’ un modello, non una diagnosi: se '
      + 'un muscolo ti fa male, vince il male.'));
  }
  v.append(cp);

  /* --- volume per muscolo: barre orizzontali --- */
  const righe = muscoli().map(m => ({ nome: m.nome, v: st[m.id].serie, stato: st[m.id].stato }))
    .sort((a, b) => b.v - a.v);
  v.append(chartHBars({
    titolo: 'Volume settimanale', sub: `Serie pesate per gruppo, settimana chiusa. Riferimento ${V.min_serie}–${V.max_serie}.`,
    righe, min: V.min_serie, max: V.max_serie, unit: 'serie',
    note: `I riferimenti sono regole pratiche (<em>${esc(V.fonte)}</em>), non misure su di te: ${esc(V.nota)}`
  }));

  /* --- quanta fatica hai ancora addosso ---
   *
   * Prima erano tre curve — forma, fatica, prontezza — in unita' arbitrarie,
   * e alla domanda "cosa sta misurando?" non rispondeva niente: tre linee
   * senza un'unita' e senza una soglia si guardano una volta e poi si
   * saltano. Peggio: la prontezza di Banister e' SEMPRE positiva per chi si
   * allena (tau 42 contro 7), quindi la curva piu' in evidenza era quella
   * che non poteva dire di no.
   *
   * Il numero che decide qualcosa e' uno solo, ed e' quello che l'app usa
   * gia' ovunque per dire "pronto": quanta fatica residua hai rispetto
   * all'allenamento accumulato. Sotto il 55% il gruppo regge un altro
   * stimolo forte. Un asse, una percentuale, una riga di riferimento.
   */
  const focus = stanchi[0] || Object.values(st).sort((a, b) => b.forma - a.forma)[0];
  const rl = focus && typeof caricoRelativo === 'function'
    ? caricoRelativo(focus.id, k) : null;
  if (focus && rl?.dati) {
    const gg = span(56, k);
    const dentro = new Set(gg);
    // la serie arriva gia' divisa per il regime: 100 e' "come al solito"
    const quota = gg.map(kk => {
      const x = rl.serie.find(y => y.k === kk);
      return x && x.rel != null ? x.rel * 100 : null;
    });
    void dentro;
    const ora = rl.rel * 100;
    const c = el('div', 'card flat');
    c.append(el('div', 'eyebrow', 'Recupero'));
    c.append(el('div', 'muted',
      `Sul <strong>${esc(focus.nome.toLowerCase())}</strong> porti `
      + `<strong>${nf(rl.rel, 2)} volte</strong> la fatica che ti trovi addosso `
      + `di solito: ${ora < 90 ? 'sei piu’ fresco del tuo standard'
        : ora < 125 ? 'sei nella tua norma'
        : ora < 170 ? 'un po’ piu’ carico del solito'
        : 'parecchio piu’ carico del solito'}.`));
    v.append(c);
    v.append(chartLine({
      titolo: `Quanto sei carico — ${focus.nome.toLowerCase()}`,
      sub: 'La fatica che ogni seduta lascia svanisce in circa una settimana. '
        + 'Questa riga e’ quella di oggi divisa quella che porti di solito su '
        + 'questo gruppo: 100 e’ una giornata come le tue altre.',
      days: gg, vals: quota, unit: '%', dec: 0,
      target: 100, tTarget: 'il tuo solito',
      msg: 'Servono alcune sedute su questo gruppo.',
      note: 'Il confronto e’ con te stesso e non con una soglia: chi si allena '
        + 'con regolarita’ ha sempre della fatica addosso, e una soglia fissa '
        + 'direbbe "pronto" anche il giorno dopo una seduta pesante. Il tuo '
        + 'solito e’ la mediana delle ultime sei settimane, cosi’ segue i cambi '
        + 'di volume invece di confrontarti con quello che facevi mesi fa. La '
        + 'costante di tempo della fatica (7 giorni) e’ un valore tipico di '
        + 'letteratura, non calibrato su di te: serve a vedere l’andamento, non '
        + 'a decidere al posto tuo. Se un muscolo ti fa male, vince il male.'
    }));
  }

}

function sezGymProgressi(v, k, st) {
  /* --- progressione per esercizio --- */
  const usati = [...new Set(Object.keys(P().sessioni)
    .flatMap(kk => serieDelGiorno(kk).map(s => s.ex)))];
  if (usati.length) {
    const c = el('div', 'card');
    c.append(el('h2', 'sec', 'Prossimo passo'));
    c.lastChild.style.marginTop = '0';
    c.append(el('p', 'muted', 'Doppia progressione: prima le ripetizioni, poi il carico.'));
    for (const id of usati) {
      const ex = esercizio(id), pp = prossimoPasso(id);
      if (!ex || !pp) continue;
      const r = el('button', 'prod');
      const prev = previsioneForza(id);
      r.innerHTML = `<div class="grow"><div class="nm">${esc(ex.nome)}</div>
        <div class="mt">${esc(pp.testo)}</div></div>
        <div class="kc">${prev ? nf(prev.ora, 1) : '—'}<br><span class="mt">1RM</span></div>`;
      r.onclick = () => { gymEx = id; route(); };
      c.append(r);
    }
    v.append(c);
  }

  /* --- dettaglio esercizio --- */
  if (gymEx) v.append(cardEsercizio(gymEx));

  /* --- tonnellaggio per seduta --- */
  const gg = span(datiRange || 30, k);
  const ton = gg.map(kk => {
    const s = serieDelGiorno(kk);
    return s.length ? s.reduce((a, x) => a + tonnellaggioSerie(x), 0) : null;
  });
  v.append(chartBars({
    titolo: 'Tonnellaggio per seduta', sub: 'Chili sollevati in totale. Utile per vedere i buchi, non per confrontare esercizi diversi.',
    days: gg, vals: ton, unit: 'kg',
    msg: 'Nessuna seduta registrata nel periodo.'
  }));

}

function sezGymCardio(v, k) {
  if (typeof cardCardio === 'function') v.append(cardCardio(k));
  /* tutte le sessioni, non solo quelle di oggi */
  const giorni = Object.keys(cardioTutti()).filter(x => x <= k).sort().reverse().slice(0, 20);
  if (!giorni.length) return;
  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'Le ultime'));
  c.lastChild.style.marginTop = '0';
  for (const g of giorni) for (const [i, r] of cardioDi(g).entries()) {
    const t = cardioTipo(r.tipo), an = andatura(r);
    const row = el('button', 'prod');
    row.innerHTML = `<div class="grow"><div class="nm">${esc(t.n)}${
        r.punti?.length ? ' <span class="pill">tracciato</span>' : ''}</div>
      <div class="mt">${g} · ${hms2(r.durata_s || 0)}${r.distanza_m
        ? ' · ' + nf(r.distanza_m / 1000, 2) + ' km' : ''}${an ? ' · ' + an.v + ' ' + an.u : ''}</div></div>
      <div class="kc">${nf(r.kcal ?? kcalCardio(r))}<br><span class="mt">kcal</span></div>`;
    row.onclick = () => sheetCardioRec(g, i);
    c.append(row);
  }
  v.append(c);
}

function sezGymCarico(v, k) {
  const cs = typeof cardScarico === 'function' ? cardScarico(k) : null;
  if (cs) v.append(cs);
  if (typeof cardAcciacchi === 'function') v.append(cardAcciacchi(k));
}

function sezGymStorico(v, k) {
  /* Aprire la schermata di scelta crea la giornata anche se poi non ci si
     registra niente: una riga "Seduta · 0 serie" nello storico e' il segno di
     un tocco, non di un allenamento. */
  const sedute = Object.keys(P().sessioni)
    .filter(x => (P().sessioni[x]?.serie || []).length)
    .sort().reverse().slice(0, 60);
  if (!sedute.length) {
    v.append(el('div', 'card flat',
      `<div class="eyebrow">Ancora niente</div>
       <div class="muted">Le sedute registrate finiscono qui, con il resoconto
       di ognuna. Comincia da "Registra pesi".</div>`));
    return;
  }

  /* In cima il resoconto dell'ultima: aprire lo storico e vedere un elenco di
     date e' guardare un archivio, non capire com'e' andata. Il resoconto non
     aggiunge conti nuovi — chiede a quelli che ci sono gia'. */
  if (typeof resocontoSeduta === 'function') {
    const r = resocontoSeduta(sedute[0]);
    if (r) v.append(cardResoconto(r));
  }

  /* --- l'elenco ---
   * Rifatto con il linguaggio della Sintesi: un blocco con titolo e
   * sottotitolo, i numeri grossi del periodo, e poi le righe. La barra su
   * ogni riga e' in scala **fra le sedute mostrate**, non in assoluto: serve
   * a vedere a colpo d'occhio quali sono state grosse e quali corte, che e'
   * la domanda che si fa scorrendo uno storico. Sotto c'e' scritto.
   */
  const dati = sedute.map(kk => {
    const s2 = P().sessioni[kk];
    return {
      k: kk, nome: s2.nome || 'Seduta',
      serie: s2.serie.reduce((a, x) => a + serieEquivalenti(x), 0),
      tonn: s2.serie.reduce((a, x) => a + tonnellaggioSerie(x), 0),
      ex: new Set(s2.serie.map(x => x.ex)).size
    };
  });
  const maxT = Math.max(1, ...dati.map(x => x.tonn));
  // il periodo di riferimento dei numeri in testa: le ultime otto settimane
  const daQuando = addDays(k, -56);
  const rec = dati.filter(x => x.k >= daQuando);
  const tot = rec.reduce((a, x) => a + x.tonn, 0);
  const nSer = rec.reduce((a, x) => a + x.serie, 0);

  const c = el('div', 'cw');
  c.append(el('h3', null, 'Le tue sedute'));
  c.append(el('div', 'sub',
    'Le ultime sessanta, dalla piu\' recente. Tocca una seduta per il suo '
    + 'resoconto e per correggere le serie.'));
  const n = el('div', 'an-conta tre');
  n.innerHTML = `<div><b>${rec.length}</b><span>sedute in 8 settimane</span></div>
    <div><b>${nf(nSer, nSer % 1 ? 1 : 0)}</b><span>serie</span></div>
    <div><b>${nf(Math.round(tot / 1000), 1)}</b><span>tonnellate</span></div>`;
  c.append(n);

  const nomiMesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu',
                    'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  let ultimoMese = null;
  for (const x of dati) {
    const d = new Date(x.k);
    const mese = d.getFullYear() + '-' + d.getMonth();
    if (mese !== ultimoMese) {
      ultimoMese = mese;
      c.append(el('div', 'st-mese',
        `${nomiMesi[d.getMonth()]} ${d.getFullYear()}`));
    }
    const r = el('button', 'st-r');
    r.innerHTML = `<span class="gg"><b>${String(d.getDate()).padStart(2, '0')}</b>
        <em>${['do', 'lu', 'ma', 'me', 'gi', 've', 'sa'][d.getDay()]}</em></span>
      <span class="grow"><span class="n">${esc(x.nome)}</span>
        <span class="m">${nf(x.serie, x.serie % 1 ? 1 : 0)} serie · ${x.ex} esercizi</span>
        <span class="bar"><i style="width:${(x.tonn / maxT * 100).toFixed(1)}%"></i></span></span>
      <span class="t">${nf(Math.round(x.tonn))}<em>kg</em></span>
      <span class="go">&rsaquo;</span>`;
    r.onclick = () => typeof sheetResoconto === 'function'
      ? sheetResoconto(x.k) : sheetSeduta(x.k);
    c.append(r);
  }
  c.append(el('p', 'note',
    'La barra e\' in scala fra le sedute qui sopra, non in assoluto: dice '
    + 'quali sono state grosse rispetto alle altre tue, non rispetto a '
    + 'qualcun altro. Gli scarichi di uno stripping contano mezza serie e '
    + 'tutti i loro chili, come in ogni altro conto dell\'app.'));
  v.append(c);
}

/** Scheda di un singolo esercizio: massimale stimato e proiezione. */
function cardEsercizio(id) {
  const ex = esercizio(id), prev = previsioneForza(id);
  const c = el('div', 'cw');
  c.append(el('h3', null, ex.nome));
  if (!prev) {
    c.append(el('div', 'sub', 'Servono almeno tre sedute per stimare una tendenza.'));
    return c;
  }
  c.append(el('div', 'sub',
    `Massimale stimato con Epley corretto col RIR. Tendenza su ${prev.n} sedute.`));
  c.append(el('div', 'kpi',
    `<div class="eyebrow">Massimale stimato</div>
     <div class="big mono">${nf(prev.ora, 1)}<em>kg</em></div>
     <div class="hint">${prev.kgSettimana >= 0 ? '+' : ''}${nf(prev.kgSettimana, 2)} kg a settimana ·
     aderenza alla retta R² ${nf(prev.r2, 2)}</div>`));
  c.append(el('p', 'note',
    `Se la tendenza regge, fra ${prev.orizzonte} giorni il massimale stimato sarebbe `
    + `${nf(prev.fra, 1)} kg (±${nf(prev.banda, 1)}). R² ${nf(prev.r2, 2)} dice quanto i punti stanno sulla retta: `
    + `sotto 0,5 la proiezione vale poco. Epley sopra le 12 ripetizioni sovrastima.`));
  const chiudi = el('button', 'btn wide', 'Chiudi');
  chiudi.onclick = () => { gymEx = null; route(); };
  c.append(chiudi);

  const frag = document.createDocumentFragment();
  frag.append(c);
  frag.append(chartLine({
    titolo: 'Massimale stimato nel tempo',
    sub: 'Un punto per seduta: la serie migliore di quel giorno.',
    days: prev.serie.map(x => x.k), vals: prev.serie.map(x => x.v),
    unit: 'kg', dec: 1
  }));
  return frag;
}

/* --------------------------------------------------------- registrazione */
/** Le serie dell'ultima volta che hai fatto quell'esercizio: servono a
    precompilare, cosi' non si riparte da zero a ogni seduta. */
function ultimoUso(exId, escludi) {
  const giorni = Object.keys(P().sessioni).filter(k => k !== escludi).sort().reverse();
  for (const k of giorni) {
    const ser = serieDelGiorno(k).filter(s => s.ex === exId);
    if (ser.length) return { k, serie: ser };
  }
  return null;
}

function schede() { P().schede ||= []; return P().schede; }
function scheda(id) { return schede().find(s => s.id === id) || null; }

/* ==================================================== la scheda che stai seguendo
 *
 * Una scheda non e' un elenco di esercizi: e' un esperimento con una durata.
 * La domanda che l'app non sapeva rispondere non e' "cosa faccio oggi" — a
 * quella rispondeva gia' — ma "questa roba sta ancora funzionando, e quando la
 * cambio".
 *
 * Quindi una scheda si puo' marcare come SEGUITA, e da li' l'app guarda solo
 * le sedute fatte con quella: quanto e' salito ogni esercizio da quando l'hai
 * cominciata, e se ha smesso di salire.
 */
/*
 * Se ne seguono PIU' DI UNA, ed e' il caso normale.
 *
 * All'inizio la scheda seguita era una sola, e la frase scritta qui sotto
 * ("se ne segui un'altra, questa smette") descriveva un programma fatto di
 * una seduta. Ma quasi nessuno si allena cosi': una scheda per giorno —
 * Giorno 1 spinta, Giorno 2 tirata — e' il modo in cui le schede si scrivono
 * davvero, e con una sola seguita l'app monitorava meta' del lavoro e
 * chiamava "il programma" quella meta'.
 *
 * Quindi si segue un INSIEME. Il monitoraggio resta per scheda, perche' e'
 * li' che la progressione di un esercizio ha senso; il verdetto "quando lo
 * cambio" si calcola invece sull'unione, perche' un programma si cambia
 * intero e non a giorni.
 */
function schedeSeguite() {
  const p = P();
  // chi ne seguiva una sola la ritrova dentro l'elenco: un backup vecchio non
  // e' ambiguo, era gia' un programma di una scheda
  if (p.schedaAttiva && !p.schedeAttive) p.schedeAttive = [p.schedaAttiva];
  if (p.schedaAttiva) delete p.schedaAttiva;
  p.schedeAttive = (p.schedeAttive || []).filter(id => scheda(id));
  return p.schedeAttive;
}
/** La prima, per i punti che ne vogliono ancora una sola. */
function schedaSeguita() { return schedeSeguite()[0] || null; }
function segui(id) { return schedeSeguite().includes(id); }
/** Senza secondo argomento fa l'interruttore. */
function seguiScheda(id, si) {
  const el = schedeSeguite();
  const ora = el.includes(id);
  const vuoi = si == null ? !ora : !!si;
  if (vuoi && !ora) el.push(id);
  if (!vuoi && ora) P().schedeAttive = el.filter(x => x !== id);
  save();
}

/** Le sedute fatte con quella scheda, in ordine. */
function seduteScheda(id) {
  return Object.entries(P().sessioni)
    .filter(([, s]) => s?.scheda === id && (s.serie || []).length)
    .map(([k, s]) => ({ k, serie: s.serie }))
    .sort((a, b) => a.k.localeCompare(b.k));
}

/**
 * Quanto e' salito un esercizio DENTRO quella scheda.
 *
 * Si confrontano le prime due sedute con le ultime due e non la prima con
 * l'ultima: una singola giornata storta — dormito male, allenato di corsa —
 * sposterebbe il verdetto da sola. Sotto le tre sedute non si dice niente:
 * due punti fanno una retta perfetta e non significano nulla.
 */
function progressoEsercizio(exId, sedute) {
  const punti = [];
  for (const s of sedute) {
    const mie = s.serie.filter(x => x.ex === exId);
    if (!mie.length) continue;
    punti.push({ k: s.k, v: Math.max(...mie.map(x => e1rm(x.kg, x.reps, x.rir))) });
  }
  if (punti.length < 3) return { exId, punti, n: punti.length };
  const q = Math.min(2, Math.floor(punti.length / 2));
  const media = a => a.reduce((x, y) => x + y.v, 0) / a.length;
  const inizio = media(punti.slice(0, q));
  const fine = media(punti.slice(-q));
  return { exId, punti, n: punti.length, inizio, fine,
           delta: fine - inizio, pct: inizio > 0 ? (fine - inizio) / inizio * 100 : 0,
           // "fermo" e' entro l'1,5%: sotto quella soglia e' rumore di
           // arrotondamento del RIR, non progresso
           fermo: inizio > 0 && Math.abs((fine - inizio) / inizio) < 0.015 };
}

const SCHEDA_SETT_LUNGA = 8;      // settimane oltre le quali quasi tutti i programmi si esauriscono

/**
 * Il quadro completo, e la risposta a "quando la cambio".
 *
 * Tre segnali indipendenti, e ne servono due — stessa regola dello scarico, e
 * per lo stesso motivo: uno solo si accende anche per caso.
 *
 * 1. **il tempo**: oltre le otto settimane sullo stesso programma i ritorni si
 *    appiattiscono. E' un intervallo di pratica comune, non una legge, e la UI
 *    lo dice.
 * 2. **la progressione si e' fermata**: meta' o piu' degli esercizi con dati
 *    sufficienti non e' salito.
 * 3. **la doppia progressione e' arrivata in fondo**: la maggioranza degli
 *    esercizi e' al tetto del range e chiede solo di caricare — la scheda ha
 *    dato quello che aveva.
 */
function monitoraggioScheda(id, k = today()) {
  const sc = scheda(id);
  if (!sc) return null;
  const sedute = seduteScheda(id);
  const righe = (sc.esercizi || []).map(r => {
    const p = progressoEsercizio(r.ex, sedute);
    return { ...p, riga: r, nome: esercizio(r.ex)?.nome || r.ex,
             passo: typeof prossimoPasso === 'function' ? prossimoPasso(r.ex) : null };
  });
  const conDati = righe.filter(r => r.delta != null);
  const pct = conDati.map(r => r.pct).sort((a, b) => a - b);
  const mediana = pct.length ? pct[Math.floor(pct.length / 2)] : null;

  const prima = sedute[0]?.k || null;
  const ultima = sedute[sedute.length - 1]?.k || null;
  const settimane = prima
    ? Math.max(1, Math.round((new Date(k) - new Date(prima)) / 864e5 / 7)) : 0;
  const alTetto = righe.filter(r => r.passo?.tipo === 'carico').length;

  const segnali = [
    { id: 'tempo', on: settimane >= SCHEDA_SETT_LUNGA,
      t: `${settimane} settimane con questa scheda`,
      d: settimane >= SCHEDA_SETT_LUNGA
        ? `Oltre le ${SCHEDA_SETT_LUNGA} settimane sullo stesso programma i ritorni di solito si appiattiscono. E' un intervallo di pratica comune, non una legge: se stai ancora salendo, sali.`
        : `Sotto le ${SCHEDA_SETT_LUNGA}: c'e' ancora margine in questo blocco.` },
    { id: 'fermo', on: conDati.length >= 2
        && conDati.filter(r => r.fermo || r.delta <= 0).length >= conDati.length / 2,
      t: conDati.length
        ? (n => `${n} ${n === 1 ? 'esercizio fermo' : 'esercizi fermi'} su ${conDati.length}`)
          (conDati.filter(r => r.fermo || r.delta <= 0).length)
        : 'ancora nessun esercizio con tre sedute',
      d: conDati.length < 2
        ? 'Servono almeno tre sedute per esercizio prima di dire se sale o no.'
        : 'Il massimale stimato non e\' salito fra le prime e le ultime sedute.' },
    { id: 'tetto', on: righe.length >= 2 && alTetto >= Math.ceil(righe.length * 0.6),
      t: `${alTetto} ${alTetto === 1 ? 'esercizio' : 'esercizi'} su ${righe.length}`
        + ' al tetto del range',
      d: 'Quando quasi tutto chiede di caricare, la scheda ha dato quello che aveva.' }
  ];
  const accesi = segnali.filter(x => x.on).length;

  return {
    sc, sedute, righe, conDati, mediana, prima, ultima, settimane, alTetto, segnali,
    pochiDati: sedute.length < 3,
    cambiare: !((sedute.length < 3)) && accesi >= 2,
    accesi
  };
}

/* ============================================ questa scheda, oggi, ha senso?
 *
 * La domanda arriva nel momento in cui si apre "registra pesi" con tre schede
 * davanti, e fino a ora l'app la lasciava a chi si allena: la mappa muscolare
 * sapeva benissimo che i pettorali erano ancora in debito di recupero, ma
 * quella informazione stava due schermate piu' in la' e nessuno la andava a
 * prendere con le mani sulla panca.
 *
 * Il conto e' una media pesata, e il peso conta: una scheda che mette dodici
 * serie sui pettorali e due sui polpacci non e' "meta' petto e meta'
 * polpacci". Ogni gruppo entra per quanto quella scheda lo carica davvero —
 * serie della riga per coinvolgimento dell'esercizio, cioe' esattamente il
 * peso che usano gia' la mappa e il volume settimanale.
 *
 * La soglia e' la stessa di tutto il resto (fatica sotto il 55% della forma),
 * perche' due schermate che usano soglie diverse direbbero due cose diverse
 * dello stesso muscolo lo stesso giorno. E resta quello che e': un modello,
 * non una diagnosi. Se un muscolo fa male, vince il male — e la UI lo dice.
 */
function prontezzaScheda(sc, k = today(), stato) {
  const st = stato || statoMuscoli(k);
  const pesi = new Map();
  for (const riga of (sc.esercizi || [])) {
    const ex = esercizio(riga.ex); if (!ex) continue;
    const n = typeof serieDiRiga === 'function' ? serieDiRiga(riga) : (riga.serie || 1);
    for (const m of muscoli()) {
      const w = pesoMuscolare(ex, m.id); if (!w) continue;
      pesi.set(m.id, (pesi.get(m.id) || 0) + w * n);
    }
  }
  if (!pesi.size) return null;

  let somma = 0, tot = 0, storia = 0;
  const gruppi = [];
  for (const [id, peso] of pesi) {
    const f = st[id];
    if (!f) continue;
    tot += peso;
    // il metro e' il regime di quel muscolo, non una soglia: senza abbastanza
    // storia il gruppo non entra nel giudizio invece di entrarci come fresco
    const rel = f.relDati ? f.rel : null;
    if (rel != null) { storia += peso; somma += peso * rel; }
    gruppi.push({ id, nome: f.nome, peso, rel, stanco: rel != null && rel >= 1.25 });
  }
  if (!tot) return null;
  if (storia < tot * 0.34) return { dati: false, gruppi };

  const quota = somma / storia;          // media pesata sui gruppi che hanno storia
  const stanchi = gruppi.filter(x => x.stanco).sort((a, b) => b.peso - a.peso);
  const quotaStanca = stanchi.reduce((a, x) => a + x.peso, 0) / tot;

  /* Quattro casi, e le parole contano: "sconsigliata" sarebbe un giudizio su
     una scheda, e la scheda non ha fatto niente di male. Quello che e' carico
     e' il corpo, e per oggi. */
  const liv = quota < 0.9 ? 0 : quota < 1.25 ? 1 : quota < 1.7 ? 2 : 3;
  const eti = ['ci sta', 'nella norma', 'gruppi carichi', 'meglio domani'][liv];
  const cls = ['ok', 'ok', 'warn', 'bad'][liv];
  const nomi = stanchi.slice(0, 3).map(x => x.nome.toLowerCase());
  const perche = liv === 0
    ? 'I gruppi che allena sono piu\' freschi del tuo solito.'
    : liv === 1
      ? 'I gruppi che allena stanno come stanno di solito.'
      : `${nomi.length === 1 ? 'Porta ancora fatica' : 'Portano ancora fatica'} `
        + `${nomi.join(', ')} — ${nf(quotaStanca * 100)}% del lavoro di questa `
        + `scheda, a ${nf(quota, 2)}× il solito.`;

  return { dati: true, quota, liv, eti, cls, perche, stanchi, gruppi, quotaStanca };
}

/**
 * Lo stesso quadro, sul programma intero.
 *
 * Le tre domande cambiano scala insieme al soggetto: quanto e' salito un
 * esercizio si guarda dentro la sua scheda (confrontare la panca del Giorno 1
 * con quella del Giorno 2 vorrebbe dire mettere insieme due sedute diverse),
 * ma "e' ora di cambiare" si guarda sull'unione, perche' un programma si
 * cambia intero.
 */
function monitoraggioProgramma(ids, k = today()) {
  const parti = ids.map(id => monitoraggioScheda(id, k)).filter(Boolean);
  if (!parti.length) return null;
  const sedute = parti.reduce((a, m) => a.concat(m.sedute), [])
    .sort((a, b) => a.k.localeCompare(b.k));
  const righe = parti.reduce((a, m) => a.concat(m.righe.map(r => ({ ...r, sc: m.sc }))), []);
  const conDati = righe.filter(r => r.delta != null);
  const pct = conDati.map(r => r.pct).sort((a, b) => a - b);
  const mediana = pct.length ? pct[Math.floor(pct.length / 2)] : null;
  const prima = sedute[0]?.k || null;
  const ultima = sedute.length ? sedute[sedute.length - 1].k : null;
  const settimane = prima
    ? Math.max(1, Math.round((new Date(k) - new Date(prima)) / 864e5 / 7)) : 0;
  const alTetto = righe.filter(r => r.passo?.tipo === 'carico').length;
  const fermi = conDati.filter(r => r.fermo || r.delta <= 0).length;
  const uno = parti.length === 1;
  const cosa = uno ? 'questa scheda' : 'questo programma';

  const segnali = [
    { id: 'tempo', on: settimane >= SCHEDA_SETT_LUNGA,
      t: `${settimane} ${settimane === 1 ? 'settimana' : 'settimane'} con ${cosa}`,
      d: settimane >= SCHEDA_SETT_LUNGA
        ? `Oltre le ${SCHEDA_SETT_LUNGA} settimane sullo stesso programma i ritorni di solito si appiattiscono. E' un intervallo di pratica comune, non una legge: se stai ancora salendo, sali.`
        : `Sotto le ${SCHEDA_SETT_LUNGA}: c'e' ancora margine in questo blocco.` },
    { id: 'fermo', on: conDati.length >= 2 && fermi >= conDati.length / 2,
      t: conDati.length
        ? `${fermi} ${fermi === 1 ? 'esercizio fermo' : 'esercizi fermi'} su ${conDati.length}`
        : 'ancora nessun esercizio con tre sedute',
      d: conDati.length < 2
        ? 'Servono almeno tre sedute per esercizio prima di dire se sale o no.'
        : 'Il massimale stimato non e\' salito fra le prime e le ultime sedute.' },
    { id: 'tetto', on: righe.length >= 2 && alTetto >= Math.ceil(righe.length * 0.6),
      t: `${alTetto} ${alTetto === 1 ? 'esercizio' : 'esercizi'} su ${righe.length}`
        + ' al tetto del range',
      d: 'Quando quasi tutto chiede di caricare, il blocco ha dato quello che aveva.' }
  ];
  const accesi = segnali.filter(x => x.on).length;
  // con due schede servono tre sedute per almeno una: un Giorno 2 fatto una
  // volta sola non deve tenere in ostaggio il verdetto su tutto il resto
  const pochiDati = !parti.some(m => m.sedute.length >= 3);

  return { parti, uno, cosa, sedute, righe, conDati, mediana, prima, ultima,
           settimane, alTetto, segnali, accesi, pochiDati,
           cambiare: !pochiDati && accesi >= 2 };
}

/**
 * Punto d'ingresso della registrazione. Se la seduta e' vuota chiede COME
 * registrare, invece di buttare l'utente in un modulo di inserimento serie per
 * serie: con una scheda si aggiornano solo carico e ripetizioni, che e' l'unica
 * cosa che cambia davvero da una settimana all'altra.
 */
function sheetSeduta(k) {
  const p = P();
  /* **Aprire non registra.** Qui stava `p.sessioni[k] ||= {...}`, cioe' la
     giornata di palestra nasceva nel momento in cui si guardava la schermata
     di scelta: bastava toccare "Registra pesi" e chiudere per lasciarsi
     dietro una seduta a zero serie, che da li' in poi faceva scrivere
     "Continua la seduta" sulla carta di Gym e "Seduta — 0 serie" nel
     riepilogo. Un bottone che promette di continuare un lavoro mai
     cominciato, e che infatti riportava alla schermata di scelta senza
     continuare niente.
     Adesso la seduta la creano i due punti in cui una serie viene scritta
     davvero: la guida e il salvataggio del modulo. */
  const sVecchia = p.sessioni[k];
  if (sVecchia && !sVecchia.serie?.length) { delete p.sessioni[k]; save(); }
  /* Una seduta guidata lasciata a meta' riprende da dove era.
     Chiudere il foglio per sbaglio — o perche' e' suonato il telefono — non
     e' una decisione: e' un incidente, e passare di nuovo da "come registri?"
     costringe a ritrovare la scheda giusta in un elenco mentre si e' sotto un
     bilanciere. Se c'e' una guida in corso su una scheda che esiste ancora,
     si torna li' e basta.

     Ma "a meta'" vuol dire che qualcosa e' stato fatto. Aprendo una scheda e
     richiudendola subito restava una guida a zero serie, e da li' in poi
     "registra pesi" portava dentro quella scheda ogni volta, proponendo di
     riprendere una seduta che non era mai cominciata. Una guida senza
     nemmeno una serie non e' un lavoro interrotto: e' un tocco, e si
     cancella invece di trascinarsela dietro. */
  const g = p.sessioni[k]?.guida;
  if (g && !p.sessioni[k].serie.length) { delete p.sessioni[k].guida; save(); }
  else if (g?.scheda && scheda(g.scheda) && typeof sheetGuidata === 'function')
    return sheetGuidata(k, g.scheda);
  // sempre la schermata di scelta: prima, se c'erano gia' delle serie, si
  // finiva dritti nella seduta libera e alle schede non si arrivava piu'
  return sheetSceltaModo(k);
}

function sheetSceltaModo(k) {
  const p = P(), gia = p.sessioni[k]?.serie?.length || 0;
  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', 'Come registri?'));
  w.lastChild.style.marginTop = '0';

  // chi arriva qui con una guida in corso l'ha voluto: sheetSeduta() lo
  // avrebbe gia' riportato dentro. Il modo di uscirne resta scritto.
  // Vale la stessa regola: senza nemmeno una serie non c'e' niente da
  // riprendere, e proporlo sarebbe una domanda su un lavoro mai iniziato
  const guida = gia ? P().sessioni[k]?.guida : null;
  if (guida?.scheda && scheda(guida.scheda)) {
    const rip = el('button', 'btn wide pri',
      `Riprendi "${scheda(guida.scheda).nome}" da dove eri`);
    rip.onclick = () => sheetGuidata(k, guida.scheda);
    w.append(rip);
    const ab = el('button', 'btn wide', 'Abbandona la guida e registra a mano');
    ab.style.marginTop = '8px';
    ab.onclick = () => {
      delete P().sessioni[k].guida; save(); sheetSceltaModo(k);
    };
    w.append(ab);
    w.append(el('p', 'hint',
      'Abbandonare la guida non cancella niente: le serie gia\' fatte restano, '
      + 'e si continua dal modulo.'));
  }

  if (gia) {
    // dallo storico si arriva qui su una seduta di tre mesi fa, e "continua
    // quella di oggi" era la frase sbagliata: li' non si continua niente, si
    // va a vedere cosa c'e' scritto e semmai si corregge
    const oggi = k === today();
    const cont = el('button', 'btn wide pri',
      oggi ? `Continua quella di oggi — ${gia} serie registrate finora`
           : `Apri e correggi — ${gia} ${gia === 1 ? 'serie' : 'serie'} registrate`);
    cont.onclick = () => sheetLibero(k);
    w.append(cont);
    w.append(el('p', 'hint', oggi
      ? 'Scegliendo una scheda qui sotto, le serie registrate finora oggi vengono sostituite da quelle nuove.'
      : 'Toccando una serie la apri: si correggono carico, ripetizioni, RIR e '
        + 'anche l\'esercizio, se e\' stato scelto quello sbagliato.'));
  }

  const list = schede();
  if (list.length) {
    w.append(el('p', 'muted', 'Con una scheda gli esercizi e il numero di serie sono gia\' fissati: tu aggiorni solo carico e ripetizioni.'));
    // lo stato dei muscoli si calcola una volta per tutte le schede: e' lo
    // stesso corpo, e formaFatica gira su tredici gruppi per centoventi giorni
    const stato = statoMuscoli(k);
    const pron = list.map(sc => ({ sc, p: prontezzaScheda(sc, k, stato) }));
    const buone = pron.filter(x => x.p?.dati).sort((a, b) => a.p.quota - b.p.quota);
    for (const { sc, p } of pron) {
      const r = el('button', 'prod sk-p');
      const nEx = sc.esercizi.length;
      const nSer = sc.esercizi.reduce((a, e) => a + (e.serie || 0), 0);
      const migliore = buone.length > 1 && buone[0].sc.id === sc.id && p.liv <= 1;
      r.innerHTML = `<div class="grow">
        <div class="nm">${esc(sc.nome)}${p?.dati
          ? ` <span class="pill ${p.cls}">${esc(p.eti)}</span>` : ''}${
          migliore ? ' <span class="pill ok">la piu\' fresca</span>' : ''}</div>
        <div class="mt">${nEx} esercizi · ${nSer} serie</div>
        ${p?.dati ? `<div class="mt why">${esc(p.perche)}</div>` : ''}</div>
        <div class="kc">usa &rsaquo;</div>`;
      r.onclick = () => sheetDaScheda(k, sc.id);
      w.append(r);
    }
    if (pron.some(x => x.p?.dati))
      w.append(el('p', 'note',
        'La pastiglia guarda i gruppi che quella scheda allena davvero, pesati '
        + 'per quanto li carica, e li confronta con <strong>il tuo solito su '
        + 'quei gruppi</strong>: non con una soglia, che su questo modello '
        + 'direbbe "pronto" sempre. E\' lo stesso metro della mappa muscolare, '
        + 'ed e\' un modello e non una diagnosi: se hai voglia di allenarti, '
        + 'allenati. Se un muscolo ti fa male, vince il male.'));
    else if (list.length)
      w.append(el('p', 'note',
        'Fra qualche seduta qui comparira\' anche se i gruppi di ogni scheda '
        + 'sono riposati o no: serve un po\' di storico per dirlo.'));
  } else {
    w.append(el('div', 'card flat',
      `<div class="eyebrow">Non hai ancora schede</div>
       <div class="muted">Una scheda si crea una volta e poi si riusa: gli esercizi
       e le serie restano fissi, e a ogni seduta aggiorni solo i carichi. Puoi anche
       registrare una seduta libera adesso e salvarla come scheda alla fine.</div>`));
  }

  const b1 = el('button', 'btn wide', 'Gestisci le schede');
  b1.style.marginTop = '10px';
  b1.onclick = () => sheetSchede();
  w.append(b1);

  const b2 = el('button', 'btn wide' + (gia ? '' : ' pri'),
    'Seduta libera, esercizio per esercizio');
  b2.style.marginTop = '8px';
  b2.onclick = () => sheetLibero(k, true);
  w.append(b2);

  /* Una seduta registrata per sbaglio — il giorno sbagliato, due volte la
     stessa — restava li' per sempre, e non e' un dettaglio: entra nel volume
     settimanale, nella forma-fatica, nel monitoraggio della scheda e nel
     conteggio delle sedute della revisione. Un dato falso che non si puo'
     togliere sporca tutti i motori che lo leggono. */
  if (gia) {
    const del = el('button', 'btn wide');
    del.style.marginTop = '14px';
    del.textContent = 'Elimina la seduta di questo giorno';
    del.onclick = () => {
      if (!confirm(`Eliminare le ${gia} serie registrate il ${k}? Non si puo' annullare.`)) return;
      delete P().sessioni[k];
      scordaFatica();
      save(); closeSheet(); route();
      toast('Seduta eliminata');
    };
    w.append(del);
    w.append(el('p', 'note',
      'Toglie solo le serie di palestra di quel giorno. Il cardio si elimina dalla '
      + 'sua scheda, e il resto del diario non viene toccato.'));
  }
  sheet(w);
}

/** "50x6, 40x5" -> gli scarichi di uno stripping. */
function parseScarichi(txt) {
  if (!txt) return [];
  return String(txt).split(/[,;]+/).map(p => {
    const m = p.trim().match(/^([\d.,]+)\s*[x×*]\s*(\d+)$/i);
    if (!m) return null;
    const kg = parseNum(m[1]), reps = parseNum(m[2]);
    return kg != null && reps > 0 ? { kg, reps } : null;
  }).filter(Boolean);
}
const scarichiTesto = d => (d || []).map(x => `${nf(x.kg, 1)}x${x.reps}`).join(', ');

/**
 * Con cosa lo sostituisco.
 *
 * Primi quelli che allenano **gli stessi muscoli**: quando un attrezzo e'
 * occupato la domanda non e' "cosa mi somiglia di nome" ma "cosa mi allena la
 * stessa cosa", e un elenco alfabetico a quella domanda non risponde.
 */
function sheetScegliRicambio(exOrig, onScelto, torna) {
  const orig = esercizio(exOrig);
  const prim = new Set(orig?.primari || []);
  const punti = e => e.id === exOrig ? -1
    : (e.primari || []).filter(x => prim.has(x)).length * 2
      + (e.secondari || []).filter(x => prim.has(x)).length;

  const w = el('div');
  w.append(el('div', 'eyebrow', 'Solo per questa seduta'));
  w.append(el('h2', 'sec', 'Al posto di ' + esc(orig?.nome || exOrig)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'La scheda non cambia: vale domani com\'e\' scritta. Le serie che registri '
    + 'portano l\'esercizio nuovo, ed e\' quello che finisce nello storico dei '
    + 'carichi e nella mappa muscolare.'));

  const simili = catalogo().filter(e => punti(e) >= 2)
    .sort((a, b) => punti(b) - punti(a)).slice(0, 4);
  if (simili.length) {
    w.append(el('div', 'eyebrow', 'Allenano la stessa cosa'));
    for (const e of simili) {
      const b = el('button', 'prod');
      b.innerHTML = `<div class="grow"><div class="nm">${esc(e.nome)}</div>
        <div class="mt">${esc(e.attrezzo)}</div></div><div class="kc">usa &rsaquo;</div>`;
      b.onclick = () => onScelto(e.id);
      w.append(b);
    }
  }
  w.append(el('div', 'eyebrow', 'Oppure un altro'));
  w.append(selettoreCercabile(
    catalogo().filter(e => e.id !== exOrig)
      .sort((a, b) => punti(b) - punti(a) || a.nome.localeCompare(b.nome))
      .map(e => ({ v: e.id, lab: e.nome,
        sub: e.attrezzo + (punti(e) > 0 ? ' \u00b7 stessi muscoli' : '') })),
    null, id => onScelto(id), 'Cerca un esercizio\u2026'));

  const ind = el('button', 'btn wide');
  ind.style.marginTop = '12px';
  ind.textContent = 'Lascia com\'e\'';
  ind.onclick = () => (torna ? torna() : closeSheet());
  w.append(ind);
  sheet(w);
}

/** Seduta da scheda: si toccano solo carico, ripetizioni e RIR. */
function sheetDaScheda(k, schedaId, sostPre) {
  const p = P(), sc = scheda(schedaId);
  if (!sc) return sheetSceltaModo(k);
  const et = etichetteScheda(sc.esercizi);

  /* **Le caselle mostrano quello che hai gia' registrato OGGI.**
     Ci si arriva quasi sempre da "Correggi qualcosa a mano" a fine seduta
     guidata, e li' il modulo veniva riempito da `ultimoUso(ex, k)` — che
     esclude oggi apposta, perche' nasce per rispondere a "l'ultima volta
     quanto avevi fatto?". Il risultato era che il modulo si apriva con i
     numeri della settimana scorsa (o vuoto, se era la prima volta con quella
     scheda) e "Salva la seduta", che fa `s.serie = serie`, li scriveva sopra
     al lavoro appena fatto. Correggere una serie cancellava le altre venti.

     Le serie di oggi si consumano **in ordine e con un cursore per
     esercizio**, non con l'indice della riga: una scheda puo' avere lo stesso
     esercizio su due righe, e leggere tutte e due dalla stessa posizione le
     farebbe apparire duplicate. */
  const serieOggi = {};
  for (const x of (p.sessioni[k]?.serie || [])) (serieOggi[x.ex] ||= []).push(x);
  const gia = Object.keys(serieOggi).length > 0;
  const cursore = {};
  const daOggi = (exId, si, nSerie) => {
    const base = cursore[exId] ?? 0;
    if (si === nSerie - 1) cursore[exId] = base + nSerie;   // dopo l'ultima
    return (serieOggi[exId] || [])[base + si] || null;
  };

  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', esc(sc.nome)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', gia
    ? 'Le caselle sono gia\' piene con quello che hai registrato oggi: correggi '
      + 'quello che serve e salva. Una serie che lasci vuota viene tolta.'
    : 'Gli esercizi e le serie sono quelli della scheda. Scrivi solo cosa hai fatto davvero: se salti una serie, lascia vuote le ripetizioni.'));

  /* Questo modulo va bene per registrare a fine seduta o per correggere. Ma
     mentre ti alleni non serve un modulo con quaranta caselle: serve sapere
     cosa fare adesso. Da qui si passa alla guida serie per serie. */
  if (typeof sheetGuidata === 'function') {
    const gd = el('button', 'btn wide pri', 'Guidami serie per serie');
    gd.onclick = () => sheetGuidata(k, sc.id);
    w.append(gd);
    w.append(el('p', 'hint',
      'Un esercizio alla volta, con il recupero che parte da solo quando segni '
      + 'la serie come fatta. Questo modulo resta qui sotto per correggere '
      + 'dopo, o per scrivere tutto in una volta a fine seduta.'));
  }

  /* **L'esercizio si puo' cambiare anche qui.**
     La guida ce l'ha; questo modulo no, e chi registra a fine seduta si
     trovava a dover scrivere sotto il nome sbagliato. La sostituzione vale
     per **questo modulo**: la scheda non si tocca — vale anche domani — e le
     serie che salvi portano gia' l'esercizio nuovo, che e' il dato che finisce
     nello storico dei carichi e nella mappa muscolare. */
  const sost = { ...(sostPre || {}) };
  const exRiga = riga => sost[riga.ex] || riga.ex;

  for (const [ei, riga] of sc.esercizi.entries()) {
    const ex = esercizio(exRiga(riga));
    if (!ex) continue;
    const prec = ultimoUso(exRiga(riga), k);
    const lo = riga.reps, hi = riga.repsMax || riga.reps;
    const t = tecnica(riga.tecnica);
    const nSerie = serieDiRiga(riga);
    const scar = scarichiDiRiga(riga);
    const rp = usaRestPause(sc, riga);

    const box = el('div', 'card flat');
    box.style.marginBottom = '10px';
    const cap = el('div', 'row between');
    cap.innerHTML = `<strong><span class="sk-g">${et[ei].testo}</span> ${esc(ex.nome)}</strong>
       <span class="mono muted" style="font-size:11px">${nSerie}${x2(ex)} × ${
         riga.piram?.length ? esc(listaTesto(riga.piram)) : rangeTesto(riga)}</span>`;
    box.append(cap);
    // in una superserie il recupero sta DOPO la coppia, non in mezzo:
    // se la riga dopo e' attaccata a questa, qui il timer non ci va
    if (!sc.esercizi[ei + 1]?.superserie)
      cap.querySelector('span:last-child').before(bottoneRecupero(ex, riga, sc));
    cap.querySelector('span:last-child').before(bottoneEsecuzione(exRiga(riga)));
    const av = typeof avvisoAcciacco === 'function' ? avvisoAcciacco(exRiga(riga), k) : null;
    if (av) box.append(av);
    if (exRiga(riga) !== riga.ex) box.append(el('div', 'hint',
      `Al posto di <strong>${esc(esercizio(riga.ex)?.nome || riga.ex)}</strong>, `
      + 'solo per questa seduta.'));
    if (riga.tecnica && riga.tecnica !== 'normale')
      box.append(el('div', 'hint', `<strong>${esc(t.nome)}${
        riga.tecnica === 'stripping' && riga.strip?.length
          ? ' ' + esc(listaTesto(riga.strip)) : ''}</strong> — ${esc(t.d)}`));
    else if (rp)
      box.append(el('div', 'hint',
        `<strong>Rest-pause ×${ripartenze(riga)}</strong> — dalla scheda intera. `
        + 'Scrivi il totale delle ripetizioni, ripartenze comprese.'));
    if (riga.superserie && ei > 0)
      box.append(el('div', 'hint',
        `Subito dopo ${esc(esercizio(sc.esercizi[ei - 1].ex)?.nome || '')}, senza recupero.`));

    /* Cambiare l'esercizio ridisegna il modulo, e quello che era scritto nelle
       caselle si perde: e' il motivo per cui il bottone e' piccolo e sta in
       fondo alla scheda dell'esercizio, non in cima. */
    const cambia = el('button', 'btn wide');
    cambia.style.marginTop = '8px';
    cambia.textContent = exRiga(riga) !== riga.ex
      ? 'Rimetti ' + (esercizio(riga.ex)?.nome || 'quello della scheda')
      : 'Non posso farlo \u00b7 cambia esercizio';
    cambia.onclick = () => {
      if (exRiga(riga) !== riga.ex) {
        delete sost[riga.ex];
        sheetDaScheda(k, schedaId, sost);
        return;
      }
      sheetScegliRicambio(riga.ex, nuovo => {
        sost[riga.ex] = nuovo;
        sheetDaScheda(k, schedaId, sost);
      }, () => sheetDaScheda(k, schedaId, sost));
    };
    box.append(cambia);

    const pp = prossimoPasso(exRiga(riga));
    if (pp) box.append(el('div', 'hint', esc(pp.testo)));
    else if (prec) box.append(el('div', 'hint',
      `L'ultima volta (${prec.k}): ${prec.serie.map(x => `${nf(x.kg, 1)}×${x.reps}`).join(', ')}.`));

    box.append(el('div', 'setrow sethead',
      `<span class="n"></span><span>kg${x2(ex)}</span><span>rip</span><span>RIR</span>`));
    for (let si = 0; si < nSerie; si++) {
      // prima quello di oggi, poi l'ultima volta, poi il peso della scheda
      const d = daOggi(riga.ex, si, nSerie) || prec?.serie[si] || {};
      const row = el('div', 'setrow');
      row.innerHTML = `<span class="n">${si + 1}</span>
        <input type="text" inputmode="decimal" id="sc-${ei}-${si}-kg" value="${d.kg ?? riga.kg ?? ''}">
        <input type="text" inputmode="numeric" id="sc-${ei}-${si}-rp" value="${d.reps ?? ''}" placeholder="${esc(bersaglioTesto(riga, si))}">
        <input type="text" inputmode="numeric" id="sc-${ei}-${si}-rr" value="${d.rir ?? 2}">`;
      box.append(row);
      if (scar.length) {
        // il campo resta uno solo e a testo libero, ma il segnaposto adesso
        // dice quali scarichi la scheda si aspetta invece di un esempio a caso
        const es = scar.map((r2, i2) => `${nf((d.kg ?? riga.kg ?? 50) * (1 - .2 * (i2 + 1)), 0)}x${r2 ?? '?'}`).join(', ');
        const sr = el('div', 'field');
        sr.style.margin = '4px 0 8px';
        sr.innerHTML = `<input type="text" id="sc-${ei}-${si}-dr"
          value="${esc(scarichiTesto(d.drop))}" placeholder="scarichi: ${esc(es)}">`;
        box.append(sr);
      }
    }
    w.append(box);
  }

  w.append(el('p', 'hint', RIR_SPIEGA));

  const salva = el('button', 'btn wide pri', gia ? 'Salva le correzioni' : 'Salva la seduta');
  salva.onclick = () => {
    const serie = [];
    // il cursore riparte da zero: la lettura e' la stessa del disegno, e le
    // serie di oggi vanno riappaiate nello stesso ordine
    for (const key of Object.keys(cursore)) cursore[key] = 0;
    for (const [ei, riga] of sc.esercizi.entries()) {
      if (!esercizio(riga.ex)) continue;
      const nS = serieDiRiga(riga);
      const exSalva = exRiga(riga);
      for (let si = 0; si < nS; si++) {
        // il recupero vero non sta nel modulo, ma e' un dato registrato dalla
        // guida: da li' escono la durata della seduta e il recupero medio del
        // resoconto. Correggere il carico non deve buttarlo via
        const orig = daOggi(riga.ex, si, nS);
        const reps = parseNum(($('#sc-' + ei + '-' + si + '-rp') || {}).value);
        if (!(reps > 0)) continue;                 // serie non fatta: si salta
        const rec = { ex: exSalva,
          kg: parseNum(($('#sc-' + ei + '-' + si + '-kg') || {}).value) ?? 0,
          reps, rir: parseNum(($('#sc-' + ei + '-' + si + '-rr') || {}).value) ?? 2 };
        if (orig?.rec_s > 0) rec.rec_s = orig.rec_s;
        if (riga.tecnica && riga.tecnica !== 'normale') rec.tecnica = riga.tecnica;
        if (riga.superserie) rec.superserie = true;
        const dr = parseScarichi(($('#sc-' + ei + '-' + si + '-dr') || {}).value);
        if (dr.length) rec.drop = dr;
        serie.push(rec);
      }
    }
    /* Svuotare tutte le caselle e salvare vuol dire "cancella la seduta", ed
       e' una cosa troppo grossa per farla di sfuggita quando qui dentro c'era
       gia' del lavoro registrato. */
    if (!serie.length) {
      if (!gia) { toast('Non hai compilato nessuna serie'); return; }
      if (!confirm('Hai lasciato vuote tutte le caselle: la seduta di oggi '
        + 'verrebbe eliminata. Vuoi davvero?')) return;
      delete p.sessioni[k];
      scordaFatica(); save(); closeSheet(); route();
      toast('Seduta eliminata'); return;
    }
    // la giornata nasce qui, con la prima serie vera dentro: aprendo il
    // modulo e uscendo non deve restare niente nel registro
    const s = p.sessioni[k] ||= { nome: '', serie: [] };
    s.serie = serie;
    s.nome = sc.nome;
    s.scheda = sc.id;
    // le serie sono cambiate: la forma-fatica e' memorizzata per muscolo e
    // continuerebbe a rispondere con i numeri di prima
    if (typeof scordaFatica === 'function') scordaFatica();
    save(); closeSheet(); route();
    const nDrop = serie.reduce((a, x) => a + (x.drop?.length || 0), 0);
    toast(`${serie.length} serie registrate${nDrop ? ` + ${nDrop} scarichi` : ''}`);
  };
  w.append(salva);

  const ind = el('button', 'btn wide', 'Torna indietro');
  ind.style.marginTop = '8px';
  ind.onclick = () => sheetSceltaModo(k);
  w.append(ind);
  sheet(w);
}

/**
 * Una serie gia' registrata: si corregge.
 *
 * Il caso non e' raro ed e' diverso da "l'ho aggiunta per sbaglio": e' il
 * carico rimasto quello della volta prima, le ripetizioni segnate a memoria a
 * fine seduta, l'esercizio scelto dalla riga sopra nell'elenco. Sono tutti
 * numeri che finiscono dentro il massimale stimato, la doppia progressione, il
 * volume per muscolo e il verdetto sulla scheda: lasciarli sbagliati sporca
 * tutto quello che ne esce, e l'unica alternativa era cancellare e riscrivere.
 *
 * L'esercizio si puo' cambiare perche' e' l'errore piu' frequente di tutti, e
 * perche' e' quello che nessun'altra schermata sa riparare.
 */
function sheetSerie(k, i, onChiudi) {
  const s = P().sessioni[k];
  const x = s?.serie?.[i];
  if (!x) return onChiudi ? onChiudi() : closeSheet();
  const chiudi = onChiudi || (() => { closeSheet(); route(); });
  // si lavora su una copia: uscendo con "annulla" non deve restare niente
  const b = { ...x, drop: (x.drop || []).map(d => ({ ...d })) };

  const w = el('div');
  w.append(el('div', 'eyebrow', `${k === today() ? 'Oggi' : k} · serie ${i + 1}`));
  w.append(el('h2', 'sec', esc(esercizio(x.ex)?.nome || x.ex)));
  w.lastChild.style.marginTop = '0';

  const f = el('div', 'field', '<label>Esercizio</label>');
  const sel = selettoreCercabile(
    catalogo().slice().sort((a, c) => a.nome.localeCompare(c.nome))
      .map(e => ({ v: e.id, lab: e.nome, sub: e.attrezzo })),
    b.ex, v => { b.ex = v; }, 'Cerca un esercizio…');
  f.append(sel);
  f.append(el('div', 'hint',
    'Cambiarlo sposta questa serie da un esercizio all\'altro: lo storico dei '
    + 'carichi e il volume per muscolo si aggiornano da soli.'));
  w.append(f);

  const g = el('div', 'gd-in');
  g.innerHTML = `<div class="field"><label>kg</label>
      <input type="text" inputmode="decimal" id="se-kg" value="${b.kg ?? ''}"></div>
    <div class="field"><label>rip fatte</label>
      <input type="text" inputmode="numeric" id="se-rp" value="${b.reps ?? ''}"></div>
    <div class="field"><label>RIR</label>
      <input type="text" inputmode="numeric" id="se-rr" value="${b.rir ?? 2}"></div>`;
  w.append(g);

  if (b.drop.length) {
    const cd = el('div', 'gd-drop');
    cd.append(el('div', 'lab', 'Scarichi'));
    b.drop.forEach((d, j) => {
      const fr = el('div', 'gd-in due');
      fr.innerHTML = `<div class="field"><label>kg</label>
          <input type="text" inputmode="decimal" id="se-dk-${j}" value="${d.kg ?? ''}"></div>
        <div class="field"><label>rip</label>
          <input type="text" inputmode="numeric" id="se-dr-${j}" value="${d.reps ?? ''}"></div>`;
      cd.append(fr);
    });
    cd.append(el('div', 'hint',
      'Svuotando le due caselle lo scarico sparisce. Ognuno conta mezza serie '
      + 'nel volume.'));
    w.append(cd);
  }

  const ok = el('button', 'btn wide pri', 'Salva la correzione');
  ok.onclick = () => {
    const reps = parseNum($('#se-rp').value);
    if (!(reps > 0)) { toast('Quante ripetizioni?'); return; }
    if (!b.ex) { toast('Scegli un esercizio'); return; }
    x.ex = b.ex;
    x.kg = parseNum($('#se-kg').value) ?? 0;
    x.reps = reps;
    x.rir = parseNum($('#se-rr').value) ?? 2;
    const dr = [];
    b.drop.forEach((d, j) => {
      const kg = parseNum(($('#se-dk-' + j) || {}).value);
      const rp = parseNum(($('#se-dr-' + j) || {}).value);
      if (kg != null && rp > 0) dr.push({ kg, reps: rp });
    });
    if (dr.length) x.drop = dr; else delete x.drop;
    scordaFatica();
    save(); chiudi(); toast('Serie corretta');
  };
  w.append(ok);

  const ann = el('button', 'btn wide', 'Annulla');
  ann.style.marginTop = '8px';
  ann.onclick = () => chiudi();
  w.append(ann);

  const del = el('button', 'btn wide', 'Elimina questa serie');
  del.style.marginTop = '8px';
  del.onclick = () => {
    if (!confirm(`Togliere la serie ${i + 1} di ${esercizio(x.ex)?.nome || x.ex}?`)) return;
    s.serie.splice(i, 1);
    if (!s.serie.length) delete P().sessioni[k];
    scordaFatica();
    save(); chiudi(); toast('Serie eliminata');
  };
  w.append(del);
  w.append(el('p', 'note',
    'Correggere una serie rifa i conti che la usano: massimale stimato, '
    + 'progressione, volume per muscolo e forma-fatica. Il resto della seduta '
    + 'non si muove.'));
  sheet(w);
}

/** Seduta libera: esercizio per esercizio, serie per serie. */
function sheetLibero(k, crea = false) {
  const p = P();
  /* Qui si entra in due modi opposti, e vanno distinti:
     - **scegliendo "seduta libera"** dalla schermata di scelta: e' l'inizio
       di una giornata, e la giornata nasce adesso (`crea`);
     - **tornando da una serie cancellata**: se era l'ultima, la seduta e'
       sparita dal registro, e ricrearla vuota rimetterebbe dentro proprio
       quello che si e' appena tolto. Li' si torna alla scelta. */
  if (crea) p.sessioni[k] ||= { nome: '', serie: [] };
  if (!p.sessioni[k]) return sheetSceltaModo(k);
  const s = p.sessioni[k];
  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', 'Seduta libera'));
  w.lastChild.style.marginTop = '0';
  w.append(el('div', 'field',
    `<label>Nome della seduta</label>
     <input type="text" id="s-nome" placeholder="Push A" value="${esc(s.nome || '')}">`));

  const lista = el('div');
  const disegna = () => {
    lista.innerHTML = '';
    if (!s.serie.length) {
      lista.append(el('p', 'muted', 'Nessuna serie. Aggiungine una qui sotto.'));
      return;
    }
    let ultimo = null;
    s.serie.forEach((x, i) => {
      const ex = esercizio(x.ex);
      if (ex && ex.id !== ultimo) {
        const h = el('div', 'eyebrow', esc(ex.nome));
        h.style.marginTop = '12px';
        lista.append(h);
        ultimo = ex.id;
      }
      /* Toccare una riga la APRE. Cancellarla al tocco era la stessa regola
         gia' imparata sulle righe di scheda e qui era rimasta: nello storico
         una serie sbagliata quasi sempre non e' di troppo — e' segnata male,
         con il peso della volta prima o dieci ripetizioni invece di otto — e
         l'unica uscita era buttarla e riscriverla da capo. */
      const r = el('button', 'serie-r');
      r.innerHTML = `<span class="mono n">serie ${i + 1}</span>
        <span class="mono">${nf(x.kg, 1)} kg</span>
        <span class="mono">${x.reps} rip</span>
        <span class="mono muted">RIR ${x.rir}</span>
        ${x.drop?.length ? `<span class="mono muted">+${x.drop.length}</span>` : ''}
        <span class="go">&rsaquo;</span>`;
      r.onclick = () => sheetSerie(k, i, () => sheetLibero(k));
      lista.append(r);
    });
  };
  disegna();
  w.append(lista);

  const box = el('div', 'card flat');
  box.style.marginTop = '12px';
  box.append(el('div', 'eyebrow', 'Aggiungi una serie'));
  const ultimoEx = s.serie.length ? s.serie[s.serie.length - 1].ex : null;
  // il catalogo passa le quaranta voci: una ruota da far girare col pollice
  // non e' un modo di scegliere un esercizio. Si scrive, si sceglie.
  const selEx = selettoreCercabile(
    catalogo().slice().sort((a, b) => a.nome.localeCompare(b.nome))
      .map(e => ({ v: e.id, lab: e.nome, sub: e.attrezzo })),
    ultimoEx, () => aggiornaAvviso(), 'Cerca un esercizio…');
  selEx.style.marginBottom = '8px';
  box.append(selEx);
  const avv = el('div');
  const aggiornaAvviso = () => {
    avv.innerHTML = '';
    const x = typeof avvisoAcciacco === 'function' ? avvisoAcciacco(selEx.valore(), k) : null;
    if (x) avv.append(x);
    const r = el('div', 'row');
    r.style.margin = '2px 0 8px';
    r.append(bottoneEsecuzione(selEx.valore()));
    avv.append(r);
  };
  aggiornaAvviso();
  box.append(avv);

  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 8px';
  const campo = (id, lab, val) => el('div', 'field',
    `<label>${lab}</label><input type="text" inputmode="decimal" id="s-${id}" value="${val ?? ''}">`);
  const prec = s.serie.filter(x => x.ex === ultimoEx).pop();
  g.append(campo('kg', 'kg', prec?.kg), campo('reps', 'rip', prec?.reps), campo('rir', 'RIR', prec?.rir ?? 2));
  box.append(g);

  box.append(el('div', 'hint', RIR_SPIEGA));

  const add = el('button', 'btn wide pri', 'Aggiungi serie');
  add.onclick = () => {
    const kg = parseNum($('#s-kg').value), reps = parseNum($('#s-reps').value);
    const rir = parseNum($('#s-rir').value) ?? 2;
    if (reps == null || reps <= 0) { toast('Servono le ripetizioni'); return; }
    s.serie.push({ ex: selEx.valore(), kg: kg ?? 0, reps, rir });
    s.nome = $('#s-nome').value.trim();
    save(); disegna();
    // la serie e' appena finita: il recupero parte da solo, che e' il momento
    // in cui serve. Il tocco su Aggiungi e' anche il gesto che sblocca l'audio
    const exf = esercizio(selEx.valore());
    avviaRecupero(recupeoConsigliato(exf), exf?.nome || 'recupero');
    toast('Serie aggiunta — recupero avviato');
  };
  box.append(add);
  const sugg = ultimoEx ? prossimoPasso(ultimoEx) : null;
  if (sugg) box.append(el('div', 'hint', esc(sugg.testo)));
  w.append(box);

  const back = el('button', 'btn wide', 'Usa una scheda invece');
  back.style.marginTop = '10px';
  back.onclick = () => { s.nome = $('#s-nome').value.trim(); save(); sheetSceltaModo(k); };
  w.append(back);

  if (s.serie.length) {
    const asch = el('button', 'btn wide', 'Salva questa seduta come scheda');
    asch.style.marginTop = '10px';
    asch.onclick = () => {
      const n = prompt('Nome della scheda', $('#s-nome').value.trim() || 'Nuova scheda');
      if (!n || !n.trim()) return;
      const per = {};
      for (const x of s.serie) {
        per[x.ex] ||= { ex: x.ex, serie: 0, reps: x.reps, kg: x.kg };
        per[x.ex].serie++;
      }
      schede().push({ id: uid(), nome: n.trim(), esercizi: Object.values(per) });
      save(); toast('Scheda creata');
    };
    w.append(asch);
  }

  const fine = el('button', 'btn wide', 'Chiudi');
  fine.style.marginTop = '8px';
  fine.onclick = () => {
    s.nome = $('#s-nome').value.trim();
    if (!s.serie.length) delete p.sessioni[k];
    save(); closeSheet(); route();
  };
  w.append(fine);
  sheet(w);
}

/* ------------------------------------------------------------- schede */
/* Una scheda e' la lista degli esercizi di una seduta: quali, quante serie, in
   che range di ripetizioni, con che tecnica. Il carico invece cambia ogni
   volta, e infatti si aggiorna quando la usi.
   Prima toccare una riga la CANCELLAVA e non c'era modo di modificarla: da qui
   l'impressione di poter inserire roba senza capire cosa. */

/* Sigla che compare in ogni modulo di registrazione: va spiegata dove la si
   digita, non solo nella documentazione. */
const RIR_SPIEGA = `<strong>RIR</strong> = ripetizioni in riserva: quante ne `
  + `avresti ancora potute fare a fine serie prima di fermarti. RIR 0 vuol dire `
  + `a cedimento, RIR 2 che te ne restavano due. Serve a rendere confrontabili `
  + `serie fatte con sforzo diverso, ed e' la variabile su cui l'app decide `
  + `quando farti aumentare il carico.`;

const TECNICHE = [
  { id: 'normale', nome: 'Normale',
    d: 'Serie standard con recupero pieno fra una e l\'altra.' },
  { id: 'stripping', nome: 'Stripping',
    d: 'Arrivi a fine serie, cali subito il peso e continui senza recupero. Scrivi qui sotto le ripetizioni di ogni scarico: "3 serie da 8, poi 6 e 4" si scrive serie 3, rip 8, scarichi 6-4. Ogni scarico conta mezza serie nel volume.' },
  { id: 'rest-pause', nome: 'Rest-pause',
    d: 'Fine serie, 15-20 secondi di pausa, altre ripetizioni con lo stesso peso. Quante ripartenze lo dici tu; si registra come una serie sola col totale delle ripetizioni.' },
  { id: 'piramidale', nome: 'Piramidale',
    d: 'Il carico sale a ogni serie e le ripetizioni scendono. Scrivi le ripetizioni serie per serie — 12-10-8 — e il numero di serie viene da solo: il carico lo alzi tu mentre ti alleni.' }
];
const tecnica = id => TECNICHE.find(t => t.id === id) || TECNICHE[0];

/* ------------------------------------------- come si legge una riga di scheda
 *
 * Tre campi nuovi, tutti facoltativi, e nessuna scheda gia' scritta cambia di
 * significato senza di loro:
 *
 *   strip:  [6, 4]      gli scarichi di uno stripping, in ripetizioni.
 *                       "Stripping 3x8-6-4" = serie 3, reps 8, strip [6,4]
 *   piram:  [12, 10, 8] le ripetizioni serie per serie di un piramidale.
 *                       Quante serie sono lo dice la lunghezza dell'elenco
 *   rpMini: 2           quante ripartenze in un rest-pause
 *
 * Le funzioni qui sotto sono l'unico posto in cui questi campi si leggono:
 * chi disegna una scheda o guida una seduta chiede a loro e non guarda dentro
 * la riga, cosi' una riga vecchia e una nuova si comportano uguale.
 */

/** Un range e' un range solo se i due estremi sono diversi: 3x8 non e' 3x8-8. */
function rangeTesto(riga) {
  const lo = riga.reps, hi = riga.repsMax || riga.reps;
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}
/** Quante serie ha davvero questa riga. */
function serieDiRiga(riga) {
  return riga.piram?.length ? riga.piram.length : Math.max(1, riga.serie || 1);
}
/** Le ripetizioni bersaglio della serie si, o null se vale il range. */
function repsBersaglio(riga, si) {
  if (riga.piram?.length) return riga.piram[Math.min(si, riga.piram.length - 1)];
  return null;
}
/** Il bersaglio scritto per esteso: "8", "8-12", o il gradino del piramidale. */
function bersaglioTesto(riga, si) {
  const b = repsBersaglio(riga, si);
  return b != null ? String(b) : rangeTesto(riga);
}
/**
 * Gli scarichi di uno stripping. Una scheda vecchia non ha `strip` e dichiara
 * solo la tecnica: vale uno scarico senza bersaglio, che e' esattamente come
 * si comportava prima.
 */
function scarichiDiRiga(riga) {
  if ((riga.tecnica || 'normale') !== 'stripping') return [];
  return riga.strip?.length ? riga.strip.slice() : [null];
}
/** Il rest-pause e' una tecnica della riga, come lo stripping. */
function usaRestPause(sc, riga) {
  return (riga.tecnica || 'normale') === 'rest-pause';
}
function ripartenze(riga) { return Math.max(1, riga.rpMini || 2); }

/** "12-10-8", "12, 10, 8", "12 10 8" -> [12, 10, 8]. */
function parseLista(txt) {
  if (!txt) return [];
  return String(txt).split(/[^\d]+/).map(x => parseInt(x, 10))
    .filter(n => Number.isFinite(n) && n > 0 && n <= 100);
}
const listaTesto = a => (a || []).join('-');

/** Etichette A1/A2/B/C: le lettere raggruppano le superserie. */
function etichetteScheda(esercizi) {
  const out = [];
  let lettera = 64, dentro = 0;
  for (const [i, e] of esercizi.entries()) {
    if (i === 0 || !e.superserie) { lettera++; dentro = 1; }
    else dentro++;
    const gruppo = String.fromCharCode(lettera);
    const prossimo = esercizi[i + 1];
    const inGruppo = dentro > 1 || (prossimo && prossimo.superserie);
    out.push({ testo: inGruppo ? gruppo + dentro : gruppo, gruppo, inGruppo });
  }
  return out;
}

function sheetSchede() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Schede'));
  w.append(el('h2', 'sec', 'Le tue schede'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Una scheda e\' la lista degli esercizi di una seduta: <strong>quali, quante serie e in che range di ripetizioni</strong>. Il carico no: quello cambia ogni volta, e lo aggiorni quando la usi.'));
  const list = schede();
  if (!list.length) w.append(el('p', 'hint', 'Nessuna scheda ancora.'));
  schedeSeguite();
  for (const sc of list) {
    const r = el('button', 'prod');
    const nSer = sc.esercizi.reduce((a, e) => a + (e.serie || 0), 0);
    const n = seduteScheda(sc.id).length;
    r.innerHTML = `<div class="grow"><div class="nm">${esc(sc.nome)}${
        segui(sc.id) ? ' <span class="pill ok">la segui</span>' : ''}</div>
      <div class="mt">${sc.esercizi.length} esercizi · ${nSer} serie${
        n ? ' · ' + n + (n === 1 ? ' seduta' : ' sedute') : ''}</div></div>
      <div class="kc">apri &rsaquo;</div>`;
    r.onclick = () => sheetScheda(sc.id);
    w.append(r);
  }
  if (list.length)
    w.append(el('p', 'hint',
      'Le schede che <strong>segui</strong> sono quelle che l\'app monitora: '
      + 'guarda solo le sedute fatte con loro e ti dice quando il programma ha '
      + 'finito di dare. Puoi seguirne <strong>piu\' di una</strong> — Giorno 1 e '
      + 'Giorno 2 sono un programma solo. Si sceglie aprendo la scheda.'));
  const b = el('button', 'btn wide pri', 'Nuova scheda');
  b.style.marginTop = '10px';
  b.onclick = () => sheetScheda(null);
  w.append(b);

  // una scheda che funziona la si vuole passare a qualcuno, o portare
  // sull'altro profilo: e' qui che viene in mente, non dentro le impostazioni
  const sc2 = el('button', 'btn wide', 'Esporta o importa schede');
  sc2.style.marginTop = '8px';
  sc2.onclick = () => sheetScambio();
  w.append(sc2);
  w.append(el('p', 'note',
    'Un file JSON con le schede e gli esercizi tuoi che ci stanno dentro. '
    + 'Caricandone uno le schede si aggiungono alle tue.'));
  sheet(w);
}

function sheetScheda(id, statoPre) {
  const sc = id ? scheda(id) : { id: uid(), nome: '', esercizi: [] };
  // statoPre serve a tornare qui dall'editor di una riga senza perdere ne'
  // il nome che stavi scrivendo ne' le righe aggiunte e non ancora salvate
  const stato = statoPre
    || { nome: sc.nome, recupero: sc.recupero || 0,
         esercizi: sc.esercizi.map(x => ({ ...x })) };

  const w = el('div');
  w.append(el('div', 'eyebrow', id ? 'Scheda' : 'Nuova scheda'));
  w.append(el('h2', 'sec', 'Cosa contiene'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Metti gli esercizi nell\'ordine in cui li fai. Per ognuno: quante serie e fra quante e quante ripetizioni vuoi stare. Il peso di partenza e\' facoltativo — se lo lasci vuoto, la prima volta lo scrivi mentre ti alleni.'));
  w.append(el('div', 'field',
    `<label>Nome della scheda</label>
     <input type="text" id="sk-nome" value="${esc(stato.nome)}" placeholder="Esempio: Push A">`));

  /* Il recupero della scheda: quello che vale per tutti gli esercizi che non
     dicono altro. Dichiararlo qui una volta e' il caso normale — chi si
     allena in un certo modo recupera in un certo modo — e le eccezioni si
     scrivono sulla riga, dove si vedono. */
  w.append(campoRecupero(stato.recupero, v => { stato.recupero = v; disegna(); },
    'Recupero fra le serie',
    'Vale per tutta la scheda. "Auto" lascia decidere all\'app: piu\' lungo '
    + 'sui fondamentali pesanti, piu\' corto sugli isolamenti. Un esercizio '
    + 'puo\' avere il suo, e in quel caso vince il suo.'));

  const lista = el('div');
  const disegna = () => {
    lista.innerHTML = '';
    if (!stato.esercizi.length) {
      lista.append(el('p', 'muted', 'Ancora nessun esercizio. Usa il pulsante qui sotto.'));
      return;
    }
    lista.append(el('div', 'sk-h',
      '<span></span><span>Esercizio</span><span>Serie</span><span>Rip</span><span>kg</span><span></span>'));
    const et = etichetteScheda(stato.esercizi);
    stato.esercizi.forEach((riga, i) => {
      const ex = esercizio(riga.ex);
      const t = tecnica(riga.tecnica);
      const r = el('button', 'sk-r' + (et[i].inGruppo ? ' grp' : ''));
      // la tecnica compare con il suo dettaglio: "stripping 6-4" dice cosa
      // devi fare, "stripping" dice solo che qualcosa succedera'
      const dett = riga.tecnica === 'stripping' && riga.strip?.length
        ? ' ' + listaTesto(riga.strip)
        : riga.tecnica === 'piramidale' && riga.piram?.length
          ? ' ' + listaTesto(riga.piram)
        : riga.tecnica === 'rest-pause' ? ' x' + ripartenze(riga) : '';
      // il recupero compare solo se e' suo: quello della scheda e' scritto
      // una volta sola qui sopra, e ripeterlo su ogni riga sarebbe rumore
      const rec = riga.recupero > 0 ? ' · rec ' + recTesto(riga.recupero) : '';
      r.innerHTML = `<span class="g">${et[i].testo}</span>
        <span class="nm">${esc(ex?.nome || riga.ex)}
          ${riga.tecnica && riga.tecnica !== 'normale'
            ? `<em>${esc(t.nome.toLowerCase() + dett + rec)}</em>`
            : rec ? `<em>${esc(rec.replace(' · ', ''))}</em>` : ''}</span>
        <span class="v">${serieDiRiga(riga)}${x2(ex)}</span>
        <span class="v">${rangeTesto(riga)}</span>
        <span class="v">${riga.kg ? nf(riga.kg, 1) + x2(ex) : '—'}</span>
        <span class="go">›</span>`;
      r.onclick = () => {
        stato.nome = $('#sk-nome').value;      // non perdere quello che ha scritto
        sheetRigaScheda(stato, i, () => sheetScheda(id, stato));
      };
      lista.append(r);
    });
    const gruppi = new Set(et.filter(x => x.inGruppo).map(x => x.gruppo));
    if (gruppi.size) lista.append(el('p', 'hint',
      'Le righe con la stessa lettera sono in superserie: si fanno una dietro l\'altra senza recupero in mezzo.'));
  };
  disegna();
  w.append(lista);

  const badd = el('button', 'btn wide', '+ Aggiungi un esercizio');
  badd.style.marginTop = '10px';
  badd.onclick = () => {
    stato.nome = $('#sk-nome').value;
    sheetRigaScheda(stato, null, () => sheetScheda(id, stato));
  };
  w.append(badd);

  const salva = el('button', 'btn wide pri', 'Salva la scheda');
  salva.style.marginTop = '8px';
  salva.onclick = () => {
    const nome = $('#sk-nome').value.trim();
    if (!nome) { toast('Serve il nome della scheda'); return; }
    if (!stato.esercizi.length) { toast('Serve almeno un esercizio'); return; }
    const rec = { id: sc.id, nome, esercizi: stato.esercizi };
    if (stato.recupero > 0) rec.recupero = stato.recupero;
    const L = schede();
    const i = L.findIndex(x => x.id === rec.id);
    if (i >= 0) L[i] = rec; else L.push(rec);
    save(); closeSheet(); route(); toast('Scheda salvata');
  };
  w.append(salva);

  if (id) {
    const seguita = segui(id);
    const altre = schedeSeguite().filter(x => x !== id).length;
    const bs = el('button', 'btn wide' + (seguita ? ' pri' : ''));
    bs.style.marginTop = '8px';
    bs.textContent = seguita ? '\u2713 La stai seguendo' : 'Segui questa scheda';
    bs.onclick = () => {
      seguiScheda(id);
      closeSheet(); route();
      toast(seguita ? 'Non la segui piu\'' : 'Da ora l\'app la monitora');
    };
    w.append(bs);
    w.append(el('p', 'hint',
      seguita
        ? 'L\'app guarda le sedute fatte con questa scheda e ti dice quando la '
          + 'progressione si ferma. Toccando di nuovo smetti, e le altre restano.'
        : 'Seguirla vuol dire che l\'app misura i progressi su di lei — quanto sale '
          + 'ogni esercizio, e quando conviene passare a un altro blocco.'
          + (altre ? ` Le altre ${altre === 1 ? 'che segui gia\' resta' : 'che segui gia\' restano'}: `
              + 'un programma e\' fatto di piu\' giornate.' : '')));

    const del = el('button', 'btn wide', 'Elimina la scheda');
    del.style.marginTop = '8px';
    del.onclick = () => {
      if (!confirm(`Eliminare "${sc.nome}"? Le sedute gia' registrate restano.`)) return;
      P().schede = schede().filter(x => x.id !== id);
      P().schedeAttive = schedeSeguite().filter(x => x !== id);
      save(); closeSheet(); route(); toast('Eliminata');
    };
    w.append(del);
  }
  sheet(w);
}

/** Una riga della scheda: si apre per modificarla, non per cancellarla. */
function sheetRigaScheda(stato, idx, onChiudi) {
  const nuovo = idx == null;
  const riga = nuovo
    ? { ex: catalogo()[0]?.id, serie: 3, reps: 8, repsMax: 12, kg: 0,
        tecnica: 'normale', superserie: false }
    : { ...stato.esercizi[idx] };

  const w = el('div');
  w.append(el('div', 'eyebrow', nuovo ? 'Aggiungi' : 'Modifica'));
  w.append(el('h2', 'sec', nuovo ? 'Un esercizio nella scheda'
    : esc(esercizio(riga.ex)?.nome || riga.ex)));
  w.lastChild.style.marginTop = '0';

  /* Con cinquantanove esercizi in catalogo una tendina non e' piu' un
     selettore: e' un elenco da scorrere col pollice fino a trovare la voce
     giusta, e su iPhone la tendina di sistema copre mezzo schermo. Lo stesso
     campo cercabile degli alimenti risolve la stessa cosa. */
  if (nuovo) {
    const f = el('div', 'field', '<label>Quale esercizio</label>');
    const opz = catalogo().slice()
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map(e => ({ v: e.id, lab: e.nome,
        sub: `${e.attrezzo} · ${(e.primari || []).join(', ') || 'nessun gruppo'}` }));
    const applica = id => {
      riga.ex = id;
      const ex = esercizio(id);
      if (ex?.range) { $('#rg-lo').value = ex.range[0]; $('#rg-hi').value = ex.range[1]; }
    };
    f.append(selettoreCercabile(opz, riga.ex, applica, 'panca, curl, squat…'));
    f.append(el('div', 'hint',
      'Scrivi due lettere e la lista si stringe. Non lo trovi? Aggiungilo da '
      + '"Esercizi" nella scheda Gym, a mano o dal catalogo online.'));
    w.append(f);
  }

  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0 8px';
  g.innerHTML = `<div class="field"><label>Serie</label>
      <input type="text" inputmode="numeric" id="rg-serie" value="${riga.serie}"></div>
    <div class="field"><label>Rip da</label>
      <input type="text" inputmode="numeric" id="rg-lo" value="${riga.reps}"></div>
    <div class="field"><label>Rip a</label>
      <input type="text" inputmode="numeric" id="rg-hi" value="${riga.repsMax || riga.reps}"></div>
    <div class="field"><label>kg</label>
      <input type="text" inputmode="decimal" id="rg-kg" value="${riga.kg || ''}"></div>`;
  w.append(g);
  w.append(el('p', 'hint',
    'Il range di ripetizioni serve alla doppia progressione: si sale di carico '
    + 'solo quando tutte le serie arrivano al numero piu\' alto. '
    + '<strong>Se metti lo stesso numero da tutte e due le parti — 8 e 8 — non '
    + 'c\'e\' range</strong>: la scheda dice 3×8 e la progressione si gioca sul '
    + 'carico. Lasciando vuoto "Rip a" vale lo stesso numero di "Rip da".'));

  /* tecnica, e i campi che ognuna si porta dietro.
     Prima la tecnica era solo un'etichetta: dicevi "piramidale" e poi in sala
     ti ricordavi tu che le ripetizioni scendevano. Ora ogni tecnica ha il suo
     numero, e quel numero e' quello che la seduta guidata ti mette davanti. */
  const ft = el('div', 'field', '<label>Tecnica</label>');
  const seg = el('div', 'seg');
  const spieg = el('div', 'hint');
  const extra = el('div');
  const dipingi = () => {
    const cor = riga.tecnica || 'normale';
    [...seg.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.t === cor));
    spieg.textContent = tecnica(cor).d;
    extra.innerHTML = '';
    if (cor === 'stripping') {
      const f = el('div', 'field',
        `<label>Scarichi <span class="muted">(ripetizioni)</span></label>
         <input type="text" inputmode="numeric" id="rg-strip"
           value="${esc(listaTesto(riga.strip))}" placeholder="6-4">
         <div class="hint">Uno per scarico, in ordine. Lasciandolo vuoto vale un
           solo scarico, com'era prima.</div>`);
      f.querySelector('input').oninput = e => { riga.strip = parseLista(e.target.value); };
      extra.append(f);
    }
    if (cor === 'piramidale') {
      const f = el('div', 'field',
        `<label>Ripetizioni serie per serie</label>
         <input type="text" inputmode="numeric" id="rg-piram"
           value="${esc(listaTesto(riga.piram))}" placeholder="12-10-8">
         <div class="hint">Il numero di serie lo decide questo elenco, e il campo
           "Serie" qui sopra viene aggiornato da solo.</div>`);
      f.querySelector('input').oninput = e => {
        riga.piram = parseLista(e.target.value);
        if (riga.piram.length) $('#rg-serie').value = riga.piram.length;
      };
      extra.append(f);
    }
    if (cor === 'rest-pause') {
      const f = el('div', 'field',
        `<label>Ripartenze <span class="muted">(dopo la serie)</span></label>
         <input type="text" inputmode="numeric" id="rg-rp"
           value="${riga.rpMini || 2}" placeholder="2">
         <div class="hint">Quante volte riprendi dopo i 15-20 secondi di pausa.</div>`);
      f.querySelector('input').oninput = e => {
        const n = parseNum(e.target.value);
        riga.rpMini = n > 0 ? Math.round(n) : 2;
      };
      extra.append(f);
    }
  };
  for (const t of TECNICHE) {
    const b = el('button', null, t.nome);
    b.dataset.t = t.id;
    b.onclick = () => { riga.tecnica = t.id; dipingi(); };
    seg.append(b);
  }
  ft.append(seg); ft.append(spieg); ft.append(extra); dipingi();
  w.append(ft);

  /* Il recupero di QUESTO esercizio, che vince su quello della scheda.
     "Auto" qui non vuol dire "calcolalo": vuol dire "vale quello della
     scheda, e se la scheda non lo dice allora calcolalo". */
  w.append(campoRecupero(riga.recupero, v => { riga.recupero = v; },
    'Recupero di questo esercizio',
    'Vale solo per lui. Con "Auto" segue la scheda, e se anche la scheda dice '
    + 'auto lo decide l\'app.'));

  /* superserie */
  const primo = !nuovo && idx === 0;
  if (!primo) {
    const fs = el('div', 'field', '<label>Superserie</label>');
    const ss = el('div', 'seg');
    for (const [val, lab] of [[false, 'A se stante'], [true, 'Attaccato al precedente']]) {
      const b = el('button', null, lab);
      b.setAttribute('aria-pressed', !!riga.superserie === val);
      b.onclick = () => { riga.superserie = val;
        [...ss.children].forEach(x => x.setAttribute('aria-pressed', x.textContent === lab)); };
      ss.append(b);
    }
    fs.append(ss);
    fs.append(el('div', 'hint',
      'Attaccato al precedente significa: lo fai subito dopo, senza recupero in mezzo. Le due righe prendono la stessa lettera (A1, A2).'));
    w.append(fs);
  }

  /* posizione */
  if (!nuovo && stato.esercizi.length > 1) {
    const fp = el('div', 'field', '<label>Posizione</label>');
    const rp = el('div', 'seg');
    const su = el('button', null, '↑ Su'), giu = el('button', null, '↓ Giu');
    su.onclick = () => {
      if (idx === 0) return;
      stato.esercizi.splice(idx - 1, 0, stato.esercizi.splice(idx, 1)[0]);
      onChiudi();
    };
    giu.onclick = () => {
      if (idx >= stato.esercizi.length - 1) return;
      stato.esercizi.splice(idx + 1, 0, stato.esercizi.splice(idx, 1)[0]);
      onChiudi();
    };
    rp.append(su, giu); fp.append(rp); w.append(fp);
  }

  const ok = el('button', 'btn wide pri', nuovo ? 'Aggiungi alla scheda' : 'Salva');
  ok.onclick = () => {
    // senza esercizio la riga punterebbe al nulla e la scheda si aprirebbe vuota
    if (!riga.ex) { toast('Scegli prima un esercizio'); return; }
    const n = parseNum($('#rg-serie').value);
    if (!(n > 0 && n <= 12)) { toast('Da 1 a 12 serie'); return; }
    const lo = parseNum($('#rg-lo').value) ?? 8;
    // "Rip a" vuoto non e' un errore: vuol dire che non c'e' un range
    const hiTxt = ($('#rg-hi').value || '').trim();
    const hi = hiTxt ? (parseNum(hiTxt) ?? lo) : lo;
    const tec = riga.tecnica || 'normale';
    const rec = {
      ex: riga.ex,
      serie: Math.round(n), reps: Math.round(lo), repsMax: Math.round(Math.max(lo, hi)),
      kg: parseNum($('#rg-kg').value) ?? 0,
      tecnica: tec, superserie: !!riga.superserie
    };
    if (tec === 'stripping') {
      const st = parseLista(($('#rg-strip') || {}).value);
      if (st.length) rec.strip = st;
    }
    if (tec === 'piramidale') {
      const pi = parseLista(($('#rg-piram') || {}).value);
      if (pi.length) {
        rec.piram = pi;
        // il numero di serie e la busta del range vengono dall'elenco: cosi'
        // la doppia progressione e il monitoraggio continuano a leggere i
        // campi di sempre senza sapere che esiste un piramidale
        rec.serie = pi.length;
        rec.reps = Math.min(...pi);
        rec.repsMax = Math.max(...pi);
      }
    }
    if (tec === 'rest-pause') {
      const rp = parseNum(($('#rg-rp') || {}).value);
      if (rp > 0) rec.rpMini = Math.round(rp);
    }
    if (riga.recupero > 0) rec.recupero = riga.recupero;
    if (nuovo) stato.esercizi.push(rec); else stato.esercizi[idx] = rec;
    onChiudi();                        // torna alla scheda, non chiude tutto
  };
  w.append(ok);

  const ann = el('button', 'btn wide', 'Annulla');
  ann.style.marginTop = '8px';
  ann.onclick = () => onChiudi();
  w.append(ann);

  if (!nuovo) {
    const del = el('button', 'btn wide', 'Togli dalla scheda');
    del.style.marginTop = '8px';
    del.onclick = () => { stato.esercizi.splice(idx, 1); onChiudi(); };
    w.append(del);
  }
  sheet(w);
}

/* ============================================ catalogo esercizi da internet

   Perche' un file statico e non una API. Sono state provate tutte e tre le
   strade prima di scegliere:

   - wger.de ha una bella API REST, muscoli e attrezzi strutturati, e pure
     l'italiano. Ma l'endpoint di ricerca /exercise/search/ oggi risponde 404 —
     l'hanno tolto — e il parametro ?search= viene ignorato: torna comunque
     tutti e 862 gli esercizi. Senza ricerca lato server resterebbe scaricare
     l'intero catalogo, che con descrizioni, immagini e traduzioni pesa 5,5 MB.
   - ExerciseDB e API Ninjas vogliono una chiave. Qui non c'e' nessun server
     dove nasconderla, e una chiave dentro il codice della pagina e' una
     chiave regalata.
   - free-exercise-db e' un JSON statico su jsDelivr: 873 esercizi, ACAO *,
     168 KB compressi. Nessuna API da farsi deprecare sotto i piedi.

   E soprattutto ha i due campi che servono davvero a QUESTA app: i muscoli
   primari e secondari, che alimentano mappa muscolare, volume, forma-fatica e
   il filtro degli acciacchi; e mechanic (compound/isolation), da cui esce il
   tipo dell'esercizio e quindi il recupero consigliato. wger il secondo non
   ce l'ha proprio.

   Il prezzo, che la UI dice: i nomi sono in inglese. */

const EXDB_URL = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json';
const EXDB_KEY = 'dieta.exdb';

/* I 17 gruppi della fonte contro i 13 del modello di questa app.
   adductors e neck restano SENZA corrispondenza di proposito: infilarli a
   forza dentro glutei o trapezi sporcherebbe la mappa muscolare e il conteggio
   del volume, che sono la ragione per cui i muscoli esistono qui dentro.
   Meglio dirlo e far scegliere. */
const MUSC_EXDB = {
  abdominals: 'addome', abductors: 'glutei', biceps: 'bicipiti',
  calves: 'polpacci', chest: 'petto', forearms: 'avambracci', glutes: 'glutei',
  hamstrings: 'femorali', lats: 'dorsali', 'lower back': 'lombari',
  'middle back': 'dorsali', quadriceps: 'quadricipiti', shoulders: 'spalle',
  traps: 'trapezi', triceps: 'tricipiti'
};
/* Gli attrezzi vanno ricondotti alle cinque parole che l'app gia' usa: un
   sesto valore inventato qui non comparirebbe da nessuna parte. */
const ATTR_EXDB = {
  barbell: 'bilanciere', 'e-z curl bar': 'bilanciere', dumbbell: 'manubri',
  kettlebells: 'manubri', 'medicine ball': 'manubri', cable: 'cavi',
  bands: 'cavi', machine: 'macchina', 'body only': 'corpo libero',
  'exercise ball': 'corpo libero', 'foam roll': 'corpo libero', other: 'corpo libero'
};
const INCR_ATTR = { bilanciere: 2.5, manubri: 2, cavi: 2.5, macchina: 5, 'corpo libero': 0 };

/** Da record della fonte a esercizio come lo vuole questa app. */
function daExdb(x) {
  const map = l => {
    const dentro = [], fuori = [];
    for (const m of [].concat(l || [])) {
      const id = MUSC_EXDB[m];
      if (id) { if (!dentro.includes(id)) dentro.push(id); } else fuori.push(m);
    }
    return { dentro, fuori };
  };
  const P1 = map(x.p), P2 = map(x.s);
  const attrezzo = ATTR_EXDB[x.e] || 'corpo libero';
  const multi = x.m !== 'isolation';           // in dubbio si tratta da multi
  return {
    nome: x.n, attrezzo, tipo: multi ? 'multi' : 'isolamento',
    primari: P1.dentro,
    // un muscolo primario che finisce secondario altrove sarebbe contato due volte
    secondari: P2.dentro.filter(m => !P1.dentro.includes(m)),
    range: multi ? [6, 10] : [10, 15],
    incremento: INCR_ATTR[attrezzo] ?? 2.5,
    exdbId: exdbCartella(x.n),           // i due fotogrammi dell'esecuzione
    nonMappati: [...new Set([...P1.fuori, ...P2.fuori])],
    origine: 'free-exercise-db'
  };
}

/**
 * Il catalogo, scaricato una volta e tenuto da parte.
 * La versione salvata butta istruzioni e immagini — il 90% del peso — e
 * scende da 1 MB a 90 KB, che stanno in localStorage senza dare fastidio al
 * diario. Da li' in poi la ricerca funziona anche senza rete.
 */
let _exdb = null;
async function catalogoOnline({ forza = false } = {}) {
  if (_exdb && !forza) return _exdb;
  if (!forza) {
    try {
      const c = JSON.parse(localStorage.getItem(EXDB_KEY) || 'null');
      if (c && c.v === 1 && Array.isArray(c.dati) && c.dati.length) return (_exdb = c.dati);
    } catch {}
  }
  const r = await fetch(EXDB_URL, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const grezzo = await r.json();
  const dati = grezzo.filter(x => x.name && (x.primaryMuscles || []).length)
    .map(x => ({ n: x.name, p: x.primaryMuscles, s: x.secondaryMuscles,
                 e: x.equipment, m: x.mechanic }));
  _exdb = dati;
  // se la memoria e' piena non e' un errore: si continua senza salvarlo
  try { localStorage.setItem(EXDB_KEY, JSON.stringify({ v: 1, quando: today(), dati })); }
  catch {}
  return dati;
}
const catalogoScaricato = () => {
  try { return !!JSON.parse(localStorage.getItem(EXDB_KEY) || 'null')?.dati?.length; }
  catch { return false; }
};

/**
 * Ricerca nel catalogo. Il filtro e' locale, non una chiamata per tasto: il
 * file e' gia' tutto qui, quindi si puo' cercare mentre si scrive senza
 * mandare niente a nessuno.
 */
function sheetCercaEsercizio(onScegli) {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Catalogo pubblico'));
  w.append(el('h2', 'sec', 'Cerca un esercizio'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    '873 esercizi con i gruppi muscolari gia' + '\u2019 assegnati. I nomi sono in '
    + 'inglese: quando lo salvi puoi riscriverlo come lo chiami tu.'));

  const inp = el('input');
  inp.type = 'search'; inp.className = 'sel-i'; inp.placeholder = 'squat, row, curl…';
  inp.autocomplete = 'off';
  w.append(inp);
  const esiti = el('div');
  w.append(esiti);

  const disegna = lista => {
    esiti.innerHTML = '';
    if (!lista.length) {
      esiti.append(el('p', 'muted', 'Niente che corrisponda. I nomi sono in inglese: '
        + 'per il rematore prova "row", per lo stacco "deadlift".'));
      return;
    }
    esiti.append(el('div', 'eyebrow', lista.length + ' risultati'));
    for (const e of lista.slice(0, 30)) {
      const r = el('button', 'off-r');
      const nomi = ids => ids.map(i => muscolo(i)?.nome || i).join(', ');
      r.innerHTML = '<span class="nm">' + esc(e.nome)
        + (e.nonMappati.length ? ' <span class="pill">gruppo da scegliere</span>' : '')
        + '</span><span class="mt">' + esc(e.attrezzo) + ' · '
        + (e.tipo === 'multi' ? 'multiarticolare' : 'isolamento') + '</span>'
        + '<span class="mc">' + esc(nomi(e.primari))
        + (e.secondari.length ? ' <em>+ ' + esc(nomi(e.secondari)) + '</em>' : '') + '</span>';
      r.onclick = () => onScegli(e);
      esiti.append(r);
    }
    if (lista.length > 30)
      esiti.append(el('div', 'sel-vuoto', 'e altri ' + (lista.length - 30)
        + '. Scrivi qualche lettera in piu' + '\u2019.'));
  };

  const cerca = () => {
    const q = inp.value.trim();
    if (!_exdb) return;
    if (q.length < 2) { esiti.innerHTML = ''; return; }
    const opz = _exdb.map(x => ({ v: x, lab: x.n, sub: ATTR_EXDB[x.e] || '' }));
    disegna(filtraOpzioni(opz, q).map(o => daExdb(o.v)));
  };
  inp.oninput = cerca;

  const stato = el('p', 'muted', 'Carico il catalogo…');
  esiti.append(stato);
  catalogoOnline().then(() => {
    stato.remove();
    inp.focus(); cerca();
    if (!inp.value) esiti.append(el('p', 'hint', 'Scrivi almeno due lettere.'));
  }).catch(() => {
    stato.textContent = '';
    stato.className = 'muted';
    stato.append(document.createTextNode(
      'Non riesco a scaricare il catalogo. La prima volta servono la rete e circa '
      + '170 KB; dopo resta salvato e funziona anche offline.'));
  });

  w.append(el('p', 'note',
    'La fonte e' + '\u2019 free-exercise-db, di pubblico dominio. I muscoli vengono '
    + 'ricondotti ai tredici di questa app; due gruppi della fonte — adduttori e '
    + 'collo — qui non esistono, e in quel caso il muscolo lo scegli tu invece di '
    + 'vederlo infilato a forza nel gruppo sbagliato. Serie e incrementi non ci '
    + 'sono nella fonte: sono valori di partenza ricavati da attrezzo e tipo.'));

  const agg = el('button', 'btn wide');
  agg.textContent = 'Riscarica il catalogo';
  agg.onclick = () => {
    agg.disabled = true; agg.textContent = 'Scarico…';
    catalogoOnline({ forza: true }).then(() => { agg.textContent = 'Aggiornato'; cerca(); })
      .catch(() => { agg.disabled = false; agg.textContent = 'Non riesco: serve la rete'; });
  };
  w.append(agg);
  const ind = el('button', 'btn wide', 'Torna indietro');
  ind.style.marginTop = '8px';
  ind.onclick = () => onScegli(null);
  w.append(ind);
  sheet(w);
}

/* ================================================ come si esegue

   Sul video, la risposta onesta e' che non esiste una fonte usabile.
   Verificato prima di rinunciarci: wger ha 78 video su 862 esercizi — il 9% —
   e sono file .MOV da 34 a 60 MB l'uno. Sessanta megabyte per guardare come si
   fa uno stacco, su una connessione dati, non e' una funzionalita': e' un
   dispetto. Le librerie a pagamento vogliono una chiave, e qui non c'e' nessun
   server dove nasconderla.

   Quello che c'e' davvero, e per TUTTI e 873 gli esercizi, sono due
   fotogrammi: posizione di partenza e di arrivo, circa 70 KB l'uno. Alternati
   in loop fanno vedere il movimento — non e' un video e la UI non lo chiama
   cosi', ma per capire dove va il bilanciere e fin dove si scende e' quello
   che serve. Chi vuole il video vero ha il collegamento a YouTube, che apre
   fuori dall'app.

   Il collegamento fra un esercizio e i suoi fotogrammi si fa una volta e resta
   in S.palestra.esec: gli esercizi del catalogo di base hanno nomi italiani e
   indovinare l'accoppiamento a tentativi produrrebbe l'esecuzione sbagliata,
   che e' peggio di nessuna esecuzione. */

const EXDB_IMG = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/';

function esecMappa() { P().esec ||= {}; return P().esec; }

/** L'id nel catalogo pubblico: dall'import, o dal collegamento fatto a mano. */
function esecDi(exId) {
  const e = esercizio(exId);
  return e?.exdbId || esecMappa()[exId] || null;
}

/** Dal nome del catalogo alla cartella delle immagini: "Barbell Squat" -> "Barbell_Squat". */
const exdbCartella = nome => (nome || '').trim().replace(/\s+/g, '_');

/**
 * I due fotogrammi che si alternano.
 * Il cambio e' un semplice toggle di opacita' ogni 900 ms — abbastanza lento
 * da leggere la posizione, abbastanza veloce da far capire che sono due
 * momenti dello stesso gesto. Con reduced-motion non si alterna: si mettono
 * affiancati, che e' lo stesso contenuto senza il movimento.
 */
function cardEsecuzione(cartella, nome) {
  const box = el('div');
  const url = i => EXDB_IMG + encodeURIComponent(cartella) + '/' + i + '.jpg';
  const anima = typeof motionOk === 'function' ? motionOk() : true;

  if (!anima) {
    const g = el('div', 'esec-due');
    g.innerHTML = `<figure><img src="${url(0)}" alt="Posizione di partenza"><figcaption>partenza</figcaption></figure>`
      + `<figure><img src="${url(1)}" alt="Posizione di arrivo"><figcaption>arrivo</figcaption></figure>`;
    box.append(g);
  } else {
    const g = el('div', 'esec');
    g.innerHTML = `<img class="a" src="${url(0)}" alt="Esecuzione di ${esc(nome)}">`
      + `<img class="b" src="${url(1)}" alt="">`
      + '<span class="esec-t">partenza</span>';
    box.append(g);
    let su = false;
    const et = g.querySelector('.esec-t');
    const t = setInterval(() => {
      if (!g.isConnected) { clearInterval(t); return; }
      su = !su;
      g.classList.toggle('fine', su);
      et.textContent = su ? 'arrivo' : 'partenza';
    }, 900);
  }

  const err = el('p', 'hint');
  err.hidden = true;
  err.textContent = 'Le immagini non si caricano: la prima volta serve la rete.';
  box.querySelectorAll('img').forEach(i => i.onerror = () => { err.hidden = false; });
  box.append(err);

  box.append(el('p', 'note',
    'Due fotogrammi, partenza e arrivo, dallo stesso catalogo pubblico degli '
    + 'esercizi. Non e' + '’ un video: nessun archivio libero ne ha uno per tutti '
    + 'gli esercizi, e quelli che esistono pesano decine di megabyte l\'uno.'));

  const yt = el('button', 'btn wide');
  yt.textContent = 'Cerca il video su YouTube';
  yt.onclick = () => window.open(
    'https://www.youtube.com/results?search_query='
    + encodeURIComponent(nome + ' proper form'), '_blank', 'noopener');
  box.append(yt);
  return box;
}

/** Il foglio: l'esecuzione se c'e', altrimenti come collegarla. */
function sheetEsecuzione(exId) {
  const e = esercizio(exId);
  const cart = esecDi(exId);
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Come si esegue'));
  w.append(el('h2', 'sec', esc(e?.nome || 'Esercizio')));
  w.lastChild.style.marginTop = '0';

  if (cart) {
    w.append(cardEsecuzione(cart, e?.nome || cart.replace(/_/g, ' ')));
    const cambia = el('button', 'btn wide');
    cambia.style.marginTop = '8px';
    cambia.textContent = 'Non e’ questo: collegane un altro';
    cambia.onclick = () => collegaEsecuzione(exId);
    w.append(cambia);
  } else {
    w.append(el('p', 'muted',
      'Questo esercizio non e’ collegato al catalogo pubblico, quindi non so quale '
      + 'sia. Cercalo una volta e da qui in poi l\'esecuzione compare da sola, anche '
      + 'dentro la scheda mentre ti alleni.'));
    const b = el('button', 'btn wide pri', 'Collega l\'esecuzione');
    b.onclick = () => collegaEsecuzione(exId);
    w.append(b);
  }
  sheet(w);
}

/** Si sceglie dal catalogo pubblico, e la scelta resta. */
function collegaEsecuzione(exId) {
  sheetCercaEsercizio(scelto => {
    if (!scelto) { sheetEsecuzione(exId); return; }
    esecMappa()[exId] = exdbCartella(scelto.nome);
    save();
    sheetEsecuzione(exId);
    toast('Collegato');
  });
}

/** Il bottoncino da mettere accanto al nome di un esercizio. */
function bottoneEsecuzione(exId) {
  const b = el('button', 'esec-go');
  b.type = 'button';
  b.textContent = esecDi(exId) ? '▶ esecuzione' : '? esecuzione';
  b.title = 'Come si esegue';
  b.onclick = ev => {
    ev.preventDefault(); ev.stopPropagation();
    sheetEsecuzione(exId);
  };
  return b;
}

/* ------------------------------------------------- esercizi personalizzati */
/**
 * La sezione della scheda seguita: come sta andando, e quando cambiarla.
 *
 * Non da' un voto e non dice "bravo": mostra di quanto e' salito ogni
 * esercizio e quali segnali sono accesi. La decisione resta di chi si allena —
 * l'app non sa se questo blocco era di scarico o se hai avuto l'influenza.
 */
function sezGymMonitor(v, k) {
  const ids = schedeSeguite();
  if (!ids.length) {
    const c = el('div', 'card');
    c.append(el('div', 'eyebrow', 'Nessuna scheda seguita'));
    c.append(el('div', 'muted',
      'Segna le schede che stai facendo e da li\' l\'app guarda solo le sedute '
      + 'fatte con quelle: quanto sale ogni esercizio, e quando il programma ha '
      + 'finito di dare. Puoi segnarne piu\' di una — Giorno 1 e Giorno 2 sono '
      + 'un programma solo.'));
    const b = el('button', 'btn wide pri', 'Scegli le schede');
    b.style.marginTop = '10px';
    b.onclick = () => sheetSchede();
    c.append(b);
    v.append(c);
    return;
  }
  const mon = monitoraggioProgramma(ids, k);

  /* --- testata --- */
  const t = el('div', 'card');
  t.append(el('div', 'eyebrow', 'Stai seguendo'));
  t.append(el('h2', 'sec', mon.uno ? esc(mon.parti[0].sc.nome)
    : `${mon.parti.length} schede`));
  t.lastChild.style.marginTop = '2px';
  if (!mon.uno) {
    // le giornate del programma, con quante sedute ognuna: e' la prima cosa
    // che si vuole sapere, perche' e' quasi sempre una a rimanere indietro
    const gio = el('div', 'gio-r');
    for (const m of mon.parti) {
      const x = el('div', 'gio');
      x.innerHTML = `<span class="n">${esc(m.sc.nome)}</span>
        <span class="s">${m.sedute.length} ${m.sedute.length === 1 ? 'seduta' : 'sedute'}</span>`;
      gio.append(x);
    }
    t.append(gio);
  }
  t.append(el('div', 'read',
    `<span><b>${mon.sedute.length}</b> sedute in tutto</span>`
    + `<span>${mon.settimane} ${mon.settimane === 1 ? 'settimana' : 'settimane'}</span>`
    + (mon.mediana == null ? '<span>carichi: servono dati</span>'
      : `<span>carichi <b>${mon.mediana >= 0 ? '+' : ''}${nf(mon.mediana, 1)}%</b></span>`)
    + (mon.ultima ? `<span>ultima ${esc(mon.ultima)}</span>` : '')));
  const cambia = el('button', 'btn wide');
  cambia.style.marginTop = '10px';
  cambia.textContent = mon.uno ? 'Cambia le schede che segui' : 'Aggiungi o togli una scheda';
  cambia.onclick = () => sheetSchede();
  t.append(cambia);
  v.append(t);

  if (mon.pochiDati) {
    v.append(el('div', 'card flat',
      `<div class="eyebrow">Ancora presto</div>
       <div class="muted">${mon.sedute.length} sedute registrate con
       ${mon.uno ? 'questa scheda' : 'queste schede'}. Da tre in su per scheda i
       confronti cominciano a significare qualcosa: con due punti la retta passa
       esatta e non dice niente.</div>`));
  }

  /* --- quanto e' salito ogni esercizio, scheda per scheda ---
     Il raggruppamento non e' ordine: la panca del Giorno 1 e quella del
     Giorno 2 sono due serie di dati diverse, e mescolarle in un elenco solo
     farebbe sembrare doppioni due righe che non lo sono. */
  const max = Math.max(6, ...mon.conDati.map(r => Math.abs(r.pct)));
  for (const m of mon.parti) {
    const c = el('div', 'cw');
    c.append(el('h3', null, mon.uno ? 'Come sta andando, esercizio per esercizio'
      : esc(m.sc.nome)));
    if (mon.uno || m === mon.parti[0])
      c.append(el('div', 'sub',
        'Massimale stimato con Epley corretto col RIR: media delle prime due sedute '
        + 'contro le ultime due. Una giornata storta da sola non sposta il verdetto.'));
    else
      c.append(el('div', 'sub',
        `${m.sedute.length} ${m.sedute.length === 1 ? 'seduta registrata' : 'sedute registrate'} con questa.`));
    for (const r of m.righe) {
      const riga = el('div', 'prog-r');
      if (r.delta == null) {
        riga.innerHTML = `<span class="nm">${esc(r.nome)}</span>
          <span class="bar"></span>
          <span class="v muted">${r.n} ${r.n === 1 ? 'seduta' : 'sedute'}</span>`;
      } else {
        const q = Math.min(1, Math.abs(r.pct) / max) * 50;
        const su = r.pct > 0;
        riga.innerHTML = `<span class="nm">${esc(r.nome)}
            <em>${nf(r.inizio, 1)} → ${nf(r.fine, 1)} kg</em></span>
          <span class="bar"><i class="${r.fermo ? 'fermo' : su ? 'su' : 'giu'}"
            style="${su ? 'left:50%' : 'right:50%'};width:${q.toFixed(1)}%"></i>
            <b></b></span>
          <span class="v ${r.fermo ? '' : su ? 'su' : 'giu'}">${
            r.pct >= 0 ? '+' : ''}${nf(r.pct, 1)}%</span>`;
      }
      c.append(riga);
    }
    if (mon.uno || m === mon.parti[mon.parti.length - 1]) {
      const leg = el('div', 'legend');
      leg.innerHTML = `<span><i class="dt" style="background:var(--pine)"></i>in salita</span>
        <span><i class="dt" style="background:var(--ink-3)"></i>fermo (meno dell'1,5%)</span>
        <span><i class="dt" style="background:var(--amber)"></i>in calo</span>`;
      c.append(leg);
      c.append(el('p', 'note',
        'La riga verticale al centro e\' lo zero. Le barre sono in scala fra loro, '
        + 'non in percentuale assoluta: servono a vedere chi tira e chi no.'
        + (mon.uno ? '' : ' La scala e\' la stessa per tutte le schede, cosi\' le '
          + 'giornate si confrontano fra loro.')));
    }
    v.append(c);
  }

  /* --- il prossimo passo --- */
  const pp = mon.righe.filter(r => r.passo);
  if (pp.length) {
    const cp = el('div', 'cw');
    cp.append(el('h3', null, 'Il prossimo passo'));
    cp.append(el('div', 'sub',
      'Doppia progressione: si sale di carico solo quando tutte le serie toccano '
      + 'il tetto del range con RIR basso.'));
    for (const r of pp) {
      const x = el('div', 'rev-fix');
      x.innerHTML = `<span class="t">${esc(r.nome)}${mon.uno ? ''
        : ` <em class="dove">${esc(r.sc.nome)}</em>`}</span>
        <span class="c">${esc(r.passo.testo)}</span>`;
      cp.append(x);
    }
    v.append(cp);
  }

  /* --- quando cambiarlo --- */
  const cq = el('div', 'card' + (mon.cambiare ? ' imp-esito' : ' flat'));
  cq.append(el('div', 'eyebrow', mon.uno ? 'Quando cambiarla' : 'Quando cambiarlo'));
  cq.append(el('h2', 'sec', mon.pochiDati ? 'Troppo presto per dirlo'
    : mon.cambiare ? (mon.uno ? 'Conviene cambiarla' : 'Conviene cambiarlo')
    : (mon.uno ? 'Tienila ancora' : 'Tienilo ancora')));
  cq.lastChild.style.marginTop = '2px';
  cq.append(el('p', 'muted', mon.pochiDati
    ? `Servono almeno tre sedute registrate con ${mon.uno ? 'questa scheda' : 'una delle schede'}.`
    : mon.cambiare
      ? `Sono accesi ${mon.accesi} segnali su tre. Non e' un obbligo: e' il momento in cui, di solito, un blocco nuovo rende piu' di uno vecchio.`
      : `Segnali accesi: ${mon.accesi} su tre. Ne servono due, e uno solo si accende anche per caso.`));
  for (const sg of mon.segnali) {
    const r = el('div', 'sig-r' + (sg.on ? ' on' : ''));
    r.innerHTML = `<span class="p"></span>
      <span class="b"><span class="t">${esc(sg.t)}</span>
      <span class="d">${esc(sg.d)}</span></span>`;
    cq.append(r);
  }
  cq.append(el('p', 'note',
    'Le otto settimane sono un intervallo di pratica comune, non una misura su '
    + 'di te: se stai ancora salendo su tutto, continuare e\' la scelta giusta. '
    + (mon.uno ? '' : 'I segnali si contano sul programma intero, perche\' un '
      + 'programma si cambia intero: una giornata sola che si e\' fermata si '
      + 'sistema dentro, senza buttare le altre. ')
    + 'E una scheda si cambia anche perche\' e\' noiosa — quello l\'app non lo '
    + 'sa e non prova a indovinarlo.'));
  v.append(cq);
}

/* ------------------------------------------------------- tutti gli esercizi
 *
 * Prima "Esercizi" apriva un foglio con dentro solo i propri, e i cinquantanove
 * del catalogo non si vedevano da nessuna parte: per sapere se una cosa c'era
 * gia' bisognava aprire una scheda e scorrere la tendina. Ora e' una pagina,
 * con tutto dentro e la ricerca sopra.
 *
 * Il filtro non passa da route(): ridisegnare la vista a ogni lettera fa
 * perdere il fuoco al campo, e su un telefono la tastiera si chiude.
 */
function sezGymEsercizi(v) {
  const c = el('div', 'cw');
  const testa = el('div', 'row between');
  testa.append(el('h3', null, 'Esercizi'));
  const piu = el('button', 'btn-piu');
  piu.textContent = '+';
  piu.title = 'Aggiungi un esercizio';
  piu.setAttribute('aria-label', 'Aggiungi un esercizio');
  piu.onclick = () => sheetAggiungiEsercizio();
  testa.append(piu);
  c.append(testa);
  c.append(el('div', 'sub',
    `${catalogo().length} in tutto, di cui ${P().esercizi.length} tuoi. `
    + 'Tocca una voce per vederne i gruppi muscolari; i tuoi si possono anche modificare.'));

  const f = el('div', 'field');
  const inp = el('input');
  inp.type = 'search';
  inp.placeholder = 'panca, curl, manubri…';
  inp.autocomplete = 'off';
  f.append(inp);
  c.append(f);

  /* I gruppi come filtro a parte, e non solo dentro la ricerca a testo: la
     domanda vera non e' "come si chiama" ma "cosa ho per i femorali", e a
     quella si risponde toccando, non scrivendo. Un gruppo che non ha nessun
     esercizio non compare: sarebbe un bottone che porta a una lista vuota. */
  let gruppo = null;
  const conta = new Map();
  for (const e of catalogo())
    for (const m of new Set([...(e.primari || []), ...(e.secondari || [])]))
      conta.set(m, (conta.get(m) || 0) + 1);

  const chips = el('div', 'seg wrap chips');
  const chip = (id, lab) => {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', String(gruppo === id));
    b.onclick = () => {
      // ritoccare il gruppo scelto lo toglie: e' il modo piu' rapido di
      // tornare a vedere tutto senza cercare un bottone "azzera"
      gruppo = gruppo === id ? null : id;
      [...chips.children].forEach(x => x.setAttribute('aria-pressed',
        String(x === b && gruppo !== null)));
      chips.firstChild.setAttribute('aria-pressed', String(gruppo === null));
      disegna();
    };
    chips.append(b);
    return b;
  };
  chip(null, 'Tutti');
  for (const m of muscoli()) if (conta.get(m.id)) chip(m.id, m.nome);
  c.append(chips);

  const lista = el('div');
  c.append(lista);

  const nomeM = id => (typeof muscolo === 'function' && muscolo(id)?.nome) || id;
  const disegna = () => {
    const q = inp.value.trim().toLowerCase();
    lista.innerHTML = '';
    const tutti = catalogo().slice().sort((a, b) => a.nome.localeCompare(b.nome));
    const mio = new Set(P().esercizi.map(e => e.id));
    const trovati = tutti.filter(e => {
      if (gruppo && !(e.primari || []).includes(gruppo)
          && !(e.secondari || []).includes(gruppo)) return false;
      if (!q) return true;
      const testo = [e.nome, e.attrezzo, ...(e.primari || []).map(nomeM),
                     ...(e.secondari || []).map(nomeM)].join(' ').toLowerCase();
      return q.split(/\s+/).every(t => testo.includes(t));
    });
    if (!trovati.length) {
      lista.append(el('p', 'hint',
        'Nessuna corrispondenza. Con il + qui sopra lo aggiungi, a mano o dal catalogo online.'));
      return;
    }
    for (const e of trovati) {
      const r = el('button', 'prod');
      // col filtro acceso si segna se quel gruppo e' primario o secondario:
      // e' la differenza fra "allena i femorali" e "li usa un po'"
      const ruolo = gruppo
        ? ((e.primari || []).includes(gruppo) ? 'primario' : 'secondario') : null;
      r.innerHTML = `<div class="grow"><div class="nm">${esc(e.nome)}</div>
        <div class="mt">${esc(e.attrezzo)} · ${(e.primari || []).map(nomeM).join(', ')
          || 'nessun gruppo'}</div></div>
        ${ruolo === 'secondario' ? '<span class="pill">secondario</span>' : ''}
        ${mio.has(e.id) ? '<span class="pill ok">tuo</span>' : ''}
        ${esecDi(e.id) ? '<span class="pill esec" title="Ci sono i fotogrammi'
          + ' dell\'esecuzione">&#9654;</span>' : ''}`;
      // sempre la scheda: da li' si corregge e si guarda l'esecuzione, e non
      // serve piu' sapere in anticipo se quell'esercizio e' tuo o del catalogo
      r.onclick = () => sheetSchedaEsercizio(e.id);
      lista.append(r);
    }
    lista.append(el('p', 'hint', `${trovati.length} su ${tutti.length}`
      + (gruppo ? ` con ${nomeM(gruppo).toLowerCase()} fra i muscoli coinvolti` : '') + '.'));
  };
  inp.oninput = disegna;
  disegna();
  v.append(c);
}

/** Il + : le due strade per aggiungerne uno, dette per quello che sono. */
function sheetAggiungiEsercizio() {
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Aggiungi'));
  w.append(el('h2', 'sec', 'Un esercizio nuovo'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'I gruppi muscolari servono alla mappa e al conteggio del volume: senza, '
    + 'l\'esercizio non colora niente e non conta da nessuna parte.'));

  const online = el('button', 'btn wide pri');
  online.textContent = catalogoScaricato()
    ? 'Cerca nel catalogo online' : 'Cerca in un catalogo online';
  online.onclick = () => sheetCercaEsercizio(e => {
    if (!e) { sheetAggiungiEsercizio(); return; }
    sheetEsercizio(null, e);
  });
  w.append(online);
  w.append(el('p', 'muted',
    '873 esercizi con i gruppi muscolari gia\' assegnati. Si scarica una volta '
    + 'e da li\' in poi funziona anche senza rete.'));
  w.lastChild.style.margin = '6px 0 14px';

  const mano = el('button', 'btn wide', 'Scrivilo a mano');
  mano.onclick = () => sheetEsercizio(null);
  w.append(mano);
  w.append(el('p', 'muted',
    'Nome, attrezzo, e i muscoli che lavorano. Serve per quello che il catalogo '
    + 'non ha: le macchine della tua palestra, le varianti che ti ha dato qualcuno.'));
  w.lastChild.style.margin = '6px 0 0';

  const ch = el('button', 'btn wide', 'Chiudi');
  ch.style.marginTop = '14px';
  ch.onclick = closeSheet;
  w.append(ch);
  sheet(w);
}

/** La scheda di un esercizio del catalogo di base: si legge, non si modifica. */
function sheetSchedaEsercizio(id) {
  const e = esercizio(id);
  if (!e) return;
  const nomeM = x => (typeof muscolo === 'function' && muscolo(x)?.nome) || x;
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Catalogo'));
  w.append(el('h2', 'sec', esc(e.nome)));
  w.lastChild.style.marginTop = '0';
  const r = el('div', 'read');
  r.innerHTML = `<span>${esc(e.attrezzo)}</span>`
    + `<span>${e.tipo === 'isolamento' ? 'isolamento' : 'multiarticolare'}</span>`
    + (perLato(e) ? '<span>un lato per volta</span>' : '')
    + (e.range ? `<span>${e.range[0]}–${e.range[1]} ripetizioni</span>` : '')
    + (e.incremento ? `<span>+${nf(e.incremento, e.incremento % 1 ? 1 : 0)} kg per volta</span>` : '');
  w.append(r);
  w.append(el('p', 'muted',
    `<strong>Primari:</strong> ${(e.primari || []).map(nomeM).join(', ') || '—'}`
    + `<br><strong>Secondari:</strong> ${(e.secondari || []).map(nomeM).join(', ') || '—'}`));
  w.append(el('p', 'hint',
    'Range e incremento sono valori di partenza del catalogo, non calibrati su di te: '
    + 'nella scheda li cambi come vuoi.'));

  /* "Come si esegue" c'era, ma **solo se l'esercizio era gia' collegato** ai
     fotogrammi del catalogo pubblico: da Gym > Esercizi non ci si arrivava
     mai, perche' il collegamento si fa proprio da li'. Adesso il bottone c'e'
     sempre, e dice se il collegamento manca invece di nascondersi. */
  if (typeof sheetEsecuzione === 'function') {
    const gia = !!esecMappa()[id];
    const b = el('button', 'btn wide',
      gia ? 'Come si esegue' : 'Collega l\'esecuzione');
    b.onclick = () => sheetEsecuzione(id);
    w.append(b);
    if (!gia) w.append(el('p', 'hint',
      'Due fotogrammi dal catalogo pubblico, partenza e arrivo. Il collegamento '
      + 'si fa una volta: i nomi italiani non si possono indovinare, e mostrare '
      + 'l\'esecuzione sbagliata e\' peggio che non mostrarne nessuna.'));
  }

  const mod = el('button', 'btn wide', diBase(id) && !P().esercizi.some(x => x.id === id)
    ? 'Correggilo' : 'Modifica');
  mod.style.marginTop = '8px';
  mod.onclick = () => sheetEsercizio(id);
  w.append(mod);
  w.append(el('p', 'hint',
    'Muscoli, tipo, range e incremento: le tue correzioni valgono ovunque — '
    + 'mappa muscolare, volume, recupero consigliato — e lo storico dei carichi '
    + 'non si spezza, perche' + '\u2019 l\'esercizio resta lo stesso.'));

  const ch = el('button', 'btn wide pri', 'Chiudi');
  ch.style.marginTop = '8px';
  ch.onclick = closeSheet;
  w.append(ch);
  sheet(w);
}

/**
 * L'editor di un esercizio tuo.
 * `pre` arriva dal catalogo online e riempie i campi: resta un modulo, perche'
 * i gruppi muscolari li deve poter correggere chi lo fa, non chi lo importa.
 */
function sheetEsercizio(id, pre) {
  const miei = P().esercizi;
  // anche uno del catalogo di base: salvandolo nasce una tua versione con lo
  // stesso id, che da quel momento vince ovunque
  const cur = id ? esercizio(id) : (pre || null);
  const eraTuo = !!(id && miei.some(x => x.id === id));
  const stato = { lato: !!cur?.lato,
                  primari: [...(cur?.primari || [])], secondari: [...(cur?.secondari || [])],
                  tipo: cur?.tipo === 'isolamento' ? 'isolamento' : 'multi' };
  const w = el('div');
  w.append(el('div', 'eyebrow', id
    ? (eraTuo ? 'Modifica' : 'Correggi quello del catalogo')
    : pre ? 'Dal catalogo' : 'Nuovo esercizio'));
  w.append(el('h2', 'sec', esc(cur?.nome || 'Esercizio')));
  w.lastChild.style.marginTop = '0';

  if (!id && typeof sheetCercaEsercizio === 'function') {
    const cb = el('button', 'btn wide');
    cb.textContent = pre ? 'Cerca un altro esercizio' : 'Cerca in un catalogo online';
    cb.style.marginBottom = '12px';
    cb.onclick = () => sheetCercaEsercizio(e => sheetEsercizio(null, e || pre));
    w.append(cb);
  }
  if (pre?.nonMappati?.length) {
    const av = el('div', 'hint acciacco');
    av.innerHTML = '<strong>Un gruppo non ha corrispondenza qui.</strong> Nella fonte '
      + 'questo esercizio lavora anche ' + esc(pre.nonMappati.join(', '))
      + ', che nel modello di questa app non esiste. Scegli tu se aggiungerlo a un '
      + 'altro gruppo o lasciarlo perdere: non lo indovino al posto tuo.';
    w.append(av);
  }
  w.append(el('div', 'field',
    `<label>Nome</label><input type="text" id="ex-nome" value="${esc(cur?.nome || '')}">`));
  if (pre) w.append(el('div', 'hint',
    'Il nome arriva dalla fonte ed e' + '\u2019 in inglese: riscrivilo come lo chiami tu, '
    + 'sara' + '\u2019 quello che vedrai nelle schede.'));
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 10px';
  g.innerHTML = `<div class="field"><label>Attrezzo</label>
      <input type="text" id="ex-att" value="${esc(cur?.attrezzo || 'manubri')}" list="ex-atts"></div>
    <div class="field"><label>Incremento (kg)</label>
      <input type="text" inputmode="decimal" id="ex-inc" value="${cur?.incremento ?? 2.5}"></div>
    <div class="field"><label>Rip minime</label>
      <input type="text" inputmode="numeric" id="ex-lo" value="${cur?.range?.[0] ?? 8}"></div>
    <div class="field"><label>Rip massime</label>
      <input type="text" inputmode="numeric" id="ex-hi" value="${cur?.range?.[1] ?? 12}"></div>`;
  const dlA = el('datalist'); dlA.id = 'ex-atts';
  for (const a of ['bilanciere', 'manubri', 'cavi', 'macchina', 'corpo libero'])
    dlA.append(new Option(a));
  w.append(dlA);
  w.append(g);

  const gruppo = (titolo, chiave) => {
    const f = el('div', 'field', `<label>${titolo}</label>`);
    const box = el('div');
    box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    for (const m of muscoli()) {
      const b = el('button', 'btn sm', m.nome);
      const on = () => stato[chiave].includes(m.id);
      const dip = () => { b.style.background = on() ? 'var(--pine)' : '';
                          b.style.color = on() ? '#fff' : ''; };
      b.onclick = () => {
        const i = stato[chiave].indexOf(m.id);
        if (i >= 0) stato[chiave].splice(i, 1); else stato[chiave].push(m.id);
        dip();
      };
      dip(); box.append(b);
    }
    f.append(box);
    return f;
  };
  w.append(gruppo('Muscoli primari', 'primari'));
  w.append(gruppo('Muscoli secondari', 'secondari'));

  /* Prima gli esercizi tuoi nascevano tutti con tipo 'mio', che nessuna parte
     del codice sa leggere: il timer di recupero li trattava percio' sempre da
     isolamento, 75 secondi anche su uno stacco. */
  const ft = el('div', 'field', '<label>Tipo</label>');
  const segT = el('div', 'seg');
  for (const [v, lab, d] of [['multi', 'Multiarticolare', 'piu' + '\u2019 articolazioni: stacco, panca, squat'],
                             ['isolamento', 'Isolamento', 'una sola: curl, alzate, estensioni']]) {
    const b = el('button', null, lab);
    b.setAttribute('aria-pressed', stato.tipo === v);
    b.onclick = () => {
      stato.tipo = v;
      [...segT.children].forEach(x => x.setAttribute('aria-pressed', x === b));
      notaT.textContent = d;
    };
    segT.append(b);
  }
  const notaT = el('div', 'hint', stato.tipo === 'multi'
    ? 'piu' + '\u2019 articolazioni: stacco, panca, squat' : 'una sola: curl, alzate, estensioni');
  ft.append(segT); ft.append(notaT);
  w.append(ft);
  w.append(el('div', 'hint',
    'Serve al recupero consigliato dal timer: un multiarticolare pesante chiede tre '
    + 'minuti, un isolamento poco piu' + '\u2019 di uno.'));

  /* Il nome non basta a dedurlo: "Affondi" si fanno per lato e non lo dicono,
     "Alzate laterali" hanno "laterali" nel nome e si fanno insieme. */
  const sw = el('button', 'sw-r' + (stato.lato ? ' on' : ''));
  sw.style.marginTop = '10px';
  const dis = () => {
    sw.innerHTML = `<span class="body"><span class="t">Si fa un lato per volta</span>
      <span class="d">Curl alternati, affondi, row a un braccio. Le serie e i chili
      vengono scritti con un <b>\u00d72</b> accanto: la serie la fai due volte e il
      peso e\' quello di una parte sola.</span></span>
      <span class="box">${stato.lato ? '&check;' : ''}</span>`;
    sw.classList.toggle('on', !!stato.lato);
  };
  dis();
  sw.onclick = () => { stato.lato = !stato.lato; dis(); };
  w.append(sw);
  w.append(el('div', 'hint',
    'E\' solo il modo in cui il numero viene scritto: tonnellaggio, volume per '
    + 'muscolo e forma-fatica restano quelli che sono. Raddoppiarli adesso vorrebbe '
    + 'dire riscrivere all\'indietro tutte le sedute gia\' registrate.'));

  const salva = el('button', 'btn wide pri', 'Salva');
  salva.onclick = () => {
    const nome = $('#ex-nome').value.trim();
    if (!nome) { toast('Serve il nome'); return; }
    if (!stato.primari.length) { toast('Serve almeno un muscolo primario'); return; }
    const rec = {
      id: cur?.id || ('mio-' + uid()), nome,
      attrezzo: $('#ex-att').value.trim() || 'altro', tipo: stato.tipo,
      ...(stato.lato ? { lato: true } : {}),
      primari: stato.primari, secondari: stato.secondari,
      range: [parseNum($('#ex-lo').value) ?? 8, parseNum($('#ex-hi').value) ?? 12],
      incremento: parseNum($('#ex-inc').value) ?? 2.5
    };
    if (pre?.origine) rec.origine = pre.origine;
    if (pre?.exdbId || cur?.exdbId) rec.exdbId = pre?.exdbId || cur.exdbId;
    // correggendo uno di base l'id resta lo stesso: e' quello che tiene
    // insieme lo storico dei carichi e il volume gia' registrato
    if (id) rec.id = id;
    const i = miei.findIndex(x => x.id === rec.id);
    if (i >= 0) miei[i] = rec; else miei.push(rec);
    save(); closeSheet(); route(); toast('Esercizio salvato');
  };
  w.append(salva);
  // su un esercizio del catalogo mai corretto non c'e' niente da rimettere e
  // niente da eliminare: un bottone disabilitato e' una domanda senza risposta
  if (id && (eraTuo || !diBase(id))) {
    const base = diBase(id);
    const del = el('button', 'btn wide',
      base ? 'Rimetti quello del catalogo' : 'Elimina');
    del.style.marginTop = '8px';
    del.onclick = () => {
      if (!confirm(base
        ? 'Butto via le tue correzioni e rimetto l\'esercizio come sta nel catalogo?'
        : 'Eliminare questo esercizio?')) return;
      P().esercizi = miei.filter(x => x.id !== id);
      save(); closeSheet(); route();
      toast(base ? 'Rimesso come nel catalogo' : 'Eliminato');
    };
    w.append(del);
  }
  sheet(w);
}
