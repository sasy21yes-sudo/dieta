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
  return h;
}
const stazioni = () => HX?.stazioni || [];
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
  const lib = HX.allenamenti;
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

/* ================================================================= vista */
let hxTab = 'gara';

function viewHyrox(v) {
  if (!HX) { v.append(el('div', 'card', '<p class="muted">Dati HYROX non caricati.</p>')); return; }
  const h = HXS();
  const wrap = el('div', 'hx');
  v.append(wrap);

  /* ---- testata ---- */
  const gg = giorniAllaGara();
  const hero = el('div', 'hx-hero');
  hero.append(el('div', 'hx-kicker', 'Road to'));
  hero.append(el('div', 'hx-logo', 'HYROX'));
  const P = pacing(h.profilo.target_min * 60);
  const prev = previsioneFinish();
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
  const bimp = el('button', 'hx-btn', 'Imposta gara e target');
  bimp.onclick = () => sheetGara();
  hero.append(bimp);
  wrap.append(hero);

  /* ---- navigazione interna ---- */
  const nav = el('div', 'hx-tabs');
  for (const [id, lab] of [['gara', 'Gara'], ['stazioni', 'Stazioni'], ['piano', 'Piano'],
                           ['sim', 'Simulazioni'], ['dati', 'Dati'], ['check', 'Race day']]) {
    const b = el('button', hxTab === id ? 'on' : null, lab);
    b.onclick = () => { hxTab = id; route(); };
    nav.append(b);
  }
  wrap.append(nav);

  ({ gara: hxGara, stazioni: hxStazioni, piano: hxPiano,
     sim: hxSim, dati: hxDati, check: hxCheck }[hxTab])(wrap, h, P, prev);
}

/* ------------------------------------------------------------ scheda gara */
function hxGara(w, h, P, prev) {
  /* previsione */
  const c = el('div', 'hx-card');
  c.append(el('div', 'hx-h', 'Tempo previsto'));
  if (!prev) {
    c.append(el('p', 'hx-p',
      'Servono almeno quattro record di stazione, oppure una simulazione intera. Registra qualcosa nella scheda Stazioni e la previsione compare.'));
  } else {
    c.append(el('div', 'hx-big', hms(prev.sec)));
    const d = prev.sec - h.profilo.target_min * 60;
    c.append(el('div', 'hx-delta ' + (d <= 0 ? 'ok' : 'no'),
      `${d <= 0 ? '−' : '+'}${hms(Math.abs(d))} rispetto al target · ±${hms(prev.banda)}`));
    c.append(el('p', 'hx-p', {
      tendenza: `Dalla tendenza delle tue ${prev.n} simulazioni intere, proiettata al giorno della gara${prev.secSett ? ` (${prev.secSett <= 0 ? '−' : '+'}${mmss(Math.abs(prev.secSett))} a settimana)` : ''}.`,
      unica: 'Da una sola simulazione: e\' un punto, non una tendenza.',
      ultima: 'Dall\'ultima simulazione registrata.',
      montaggio: `Montato dai tuoi ${prev.n} record di stazione piu' una stima delle corse, con un +8% di penale. I record si fanno a freddo e da soli: in gara ogni stazione costa di piu', e sommare i migliori senza penale darebbe un numero che non vedrai mai.`
    }[prev.metodo]));
  }
  w.append(c);

  /* piano dei passaggi */
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
    `Il roxzone (${mmss(P.perRox)} a stazione, ${mmss(P.perRox * 8)} in totale) e' gia' dentro i passaggi cumulati. E' il tempo piu' facile da recuperare di tutta la gara: non richiede di essere piu' forti, solo di non fermarsi.`));
  w.append(pc);

  /* punti deboli */
  const gaps = gapStazioni().filter(g => g.gap != null);
  if (gaps.length) {
    const gc = el('div', 'hx-card');
    gc.append(el('div', 'hx-h', 'Dove perdi piu\' tempo'));
    gc.append(el('p', 'hx-p', 'Differenza fra il tuo record e il passo che servirebbe per il target.'));
    for (const g of gaps.slice(0, 5)) {
      const r = el('div', 'hx-gap' + (g.gap > 0 ? '' : ' ok'));
      r.innerHTML = `<span class="nm">${esc(g.nome)}</span>
        <span class="v">${mmss(g.mio)}</span>
        <span class="d">${g.gap > 0 ? '+' : '−'}${mmss(Math.abs(g.gap))}</span>`;
      gc.append(r);
    }
    const peggio = gaps[0];
    if (peggio && peggio.gap > 0)
      gc.append(el('p', 'hx-note',
        `<strong>${esc(peggio.nome)}</strong> — ${esc(peggio.chiave)}`));
    w.append(gc);
  }
}

/* -------------------------------------------------------- scheda stazioni */
function hxStazioni(w, h) {
  const std = (HX.standard[h.profilo.categoria] || HX.standard.open)[h.profilo.sesso] || {};
  const P = pacing(h.profilo.target_min * 60);
  const c = el('div', 'hx-card');
  c.append(el('div', 'hx-h', 'Le otto stazioni'));
  c.append(el('p', 'hx-p', 'Tocca una stazione per registrare il tuo tempo migliore.'));
  const grid = el('div', 'hx-grid');
  for (const [i, st] of stazioni().entries()) {
    const mio = h.pb[st.id], tgt = P.righe.find(r => r.id === st.id)?.target;
    const t = el('button', 'hx-tile' + (mio ? ' has' : ''));
    t.innerHTML = `<span class="n">0${i + 1}</span>
      <span class="nm">${esc(st.breve)}</span>
      <span class="ms">${esc(st.misura)}</span>
      <span class="pb">${mio ? mmss(mio) : '—'}</span>
      <span class="tg">target ${mmss(tgt)}</span>
      <span class="st">${esc(std[st.id] || '')}</span>`;
    t.onclick = () => sheetStazione(st);
    grid.append(t);
  }
  c.append(grid);
  w.append(c);

  const sc = el('div', 'hx-card');
  sc.append(el('div', 'hx-h', 'Standard della tua categoria'));
  sc.append(el('p', 'hx-p',
    `${esc((HX.categorie.find(x => x.id === h.profilo.categoria) || {}).nome)} · ${h.profilo.sesso === 'f' ? 'donne' : 'uomini'}`));
  for (const st of stazioni()) {
    // "plain": qui la terza colonna e' un dato di regolamento, non uno scarto.
    // Col rosso degli scarti sembrerebbe un giudizio su un peso ufficiale.
    const r = el('div', 'hx-gap plain');
    r.innerHTML = `<span class="nm">${esc(st.nome)}</span>
      <span class="v">${esc(st.misura)}</span><span class="d">${esc(std[st.id] || '—')}</span>`;
    sc.append(r);
  }
  sc.append(el('p', 'hx-note', esc(HX.meta.verifica)));
  w.append(sc);
}

/* ----------------------------------------------------------- scheda piano */
function hxPiano(w, h) {
  const pw = pianoSettimana();
  const c = el('div', 'hx-card');
  c.append(el('div', 'hx-h', 'Fase: ' + pw.fase.nome));
  const sett = settimaneAllaGara();
  c.append(el('p', 'hx-p',
    (sett != null ? `${sett} settiman${sett === 1 ? 'a' : 'e'} alla gara. ` : '')
    + esc(pw.fase.nota)));
  if (pw.deboli.length)
    c.append(el('p', 'hx-note', 'Il programma insiste su '
      + pw.deboli.map(id => esc(stazione(id)?.nome.toLowerCase() || id)).join(', ')
      + ': sono le stazioni dove perdi piu\' tempo.'));
  w.append(c);

  const sc = el('div', 'hx-card');
  sc.append(el('div', 'hx-h', 'Settimana proposta'));
  for (const a of pw.sessioni) {
    const r = el('button', 'hx-sess' + (a.mirato ? ' mirato' : ''));
    r.innerHTML = `<span class="tp">${esc(a.tipo)}</span>
      <span class="nm">${esc(a.nome)}</span>
      <span class="du">${a.durata}'</span>`;
    r.onclick = () => sheetAllenamento(a);
    sc.append(r);
  }
  sc.append(el('p', 'hx-note',
    'Sette proposte per una settimana: prendine quante ne reggi, non tutte. Il volume che non recuperi non allena, affatica soltanto.'));
  w.append(sc);

  const lc = el('div', 'hx-card');
  lc.append(el('div', 'hx-h', 'Catalogo completo'));
  for (const a of HX.allenamenti) {
    const r = el('button', 'hx-sess');
    r.innerHTML = `<span class="tp">${esc(a.tipo)}</span>
      <span class="nm">${esc(a.nome)}</span><span class="du">${a.durata}'</span>`;
    r.onclick = () => sheetAllenamento(a);
    lc.append(r);
  }
  w.append(lc);
}

/* ----------------------------------------------------- scheda simulazioni */
function hxSim(w, h) {
  const c = el('div', 'hx-card');
  c.append(el('div', 'hx-h', 'Simulazioni'));
  c.append(el('p', 'hx-p',
    'Una gara intera a cronometro e\' un test, non un allenamento: al massimo ogni 4-6 settimane. La mezza costa molto meno e dice quasi le stesse cose.'));
  const b = el('button', 'hx-btn', 'Registra una simulazione');
  b.onclick = () => sheetSim(null);
  c.append(b);
  w.append(c);

  const sims = h.sim.slice().sort((a, b2) => b2.data.localeCompare(a.data));
  if (!sims.length) return;

  for (const s of sims) {
    const sc = el('div', 'hx-card');
    const corsa = (s.corse || []).reduce((a, x) => a + (x || 0), 0);
    const staz = Object.values(s.stazioni || {}).reduce((a, x) => a + (x || 0), 0);
    const rox = Math.max(0, (s.totale || 0) - corsa - staz);
    sc.append(el('div', 'hx-h', `${s.tipo === 'intera' ? 'Intera' : 'Mezza'} · ${s.data}`));
    sc.append(el('div', 'hx-big', hms(s.totale)));
    const q = el('div', 'hx-quote');
    q.innerHTML = `<div><span>Corsa</span><b>${hms(corsa)}</b><em>${nf(corsa / (s.totale || 1) * 100)}%</em></div>
      <div><span>Stazioni</span><b>${hms(staz)}</b><em>${nf(staz / (s.totale || 1) * 100)}%</em></div>
      <div><span>Roxzone</span><b>${hms(rox)}</b><em>${nf(rox / (s.totale || 1) * 100)}%</em></div>`;
    sc.append(q);

    const dg = degradoCorsa(s);
    if (dg) {
      sc.append(el('p', 'hx-note',
        `Corsa compromessa: dal primo all'ultimo chilometro hai perso <strong>${mmss(Math.abs(dg.delta))}</strong> `
        + `(${dg.perGiro >= 0 ? '+' : '−'}${Math.abs(dg.perGiro).toFixed(0)} s a giro). `
        + (Math.abs(dg.perGiro) < 6
          ? 'Degrado contenuto: il ritmo di partenza era sostenibile.'
          : 'Degrado alto: quasi sempre significa primi due chilometri troppo veloci, non mancanza di motore.')));
      sc.append(chartBars({
        titolo: 'Le otto corse', sub: 'Tempo di ogni chilometro, nell\'ordine di gara.',
        days: (s.corse || []).map((_, i) => 'Corsa ' + (i + 1)),
        vals: s.corse, unit: 's', dec: 0
      }));
    }
    const del = el('button', 'hx-btn ghost', 'Modifica o elimina');
    del.onclick = () => sheetSim(s);
    sc.append(del);
    w.append(sc);
  }
}

/* ------------------------------------------------------------ scheda dati */
function hxDati(w, h) {
  const sims = h.sim.filter(s => s.totale > 0).sort((a, b) => a.data.localeCompare(b.data));

  if (sims.length >= 2) {
    w.append(chartLine({
      titolo: 'Tempo di arrivo', sub: 'Ogni punto e\' una simulazione. La linea e\' la tendenza.',
      days: sims.map(s => s.data), vals: sims.map(s => s.totale / 60),
      unit: 'min', dec: 1,
      note: 'In minuti. Il target e\' ' + h.profilo.target_min + ' minuti.',
      target: h.profilo.target_min
    }));
  }

  /* tempi di stazione nel tempo */
  const conStaz = sims.filter(s => s.stazioni && Object.keys(s.stazioni).length);
  if (conStaz.length >= 2) {
    w.append(chartEmphasis({
      titolo: 'Stazioni nel tempo', sub: 'In evidenza quella dove perdi piu\' tempo.',
      days: conStaz.map(s => s.data), unit: 's', dec: 0,
      serie: gapStazioni().slice(0, 4).map((g, i) => ({
        nome: g.breve.toLowerCase(), forte: i === 0,
        vals: conStaz.map(s => s.stazioni[g.id] || null)
      }))
    }));
  }

  /* ripartizione */
  if (sims.length) {
    w.append(chartStack({
      titolo: 'Dove se ne va il tempo', sub: 'Corsa, stazioni e roxzone su ogni simulazione.',
      days: sims.map(s => s.data), pct: true, unit: '%',
      serie: [
        { nome: 'Corsa', vals: sims.map(s => (s.corse || []).reduce((a, x) => a + (x || 0), 0)) },
        { nome: 'Stazioni', vals: sims.map(s => Object.values(s.stazioni || {}).reduce((a, x) => a + (x || 0), 0)) },
        { nome: 'Roxzone', vals: sims.map(s => Math.max(0, s.totale
            - (s.corse || []).reduce((a, x) => a + (x || 0), 0)
            - Object.values(s.stazioni || {}).reduce((a, x) => a + (x || 0), 0))) }
      ]
    }));
  }

  /* volume settimanale per tipo */
  const sett = span(28);
  const vol = volumeHyrox(sett);
  const righe = Object.entries(vol).filter(([, m]) => m > 0)
    .map(([t, m]) => ({ nome: t, v: m })).sort((a, b) => b.v - a.v);
  if (righe.length) {
    w.append(chartHBars({
      titolo: 'Minuti per tipo di lavoro', sub: 'Ultime 4 settimane, sedute segnate come fatte.',
      righe, unit: 'min',
      note: 'In fase di costruzione il lavoro compromesso dovrebbe essere la fetta piu\' grande dopo la corsa.'
    }));
  } else {
    const c = el('div', 'hx-card');
    c.append(el('div', 'hx-h', 'Minuti per tipo di lavoro'));
    c.append(el('p', 'hx-p', 'Segna come fatte le sedute nella scheda Piano e qui comparira\' la ripartizione del lavoro.'));
    w.append(c);
  }

  /* record */
  const rc = el('div', 'hx-card');
  rc.append(el('div', 'hx-h', 'Record personali'));
  const gaps = gapStazioni();
  for (const g of gaps) {
    const r = el('div', 'hx-gap' + (g.gap != null && g.gap <= 0 ? ' ok' : ''));
    r.innerHTML = `<span class="nm">${esc(g.nome)}</span>
      <span class="v">${g.mio ? mmss(g.mio) : '—'}</span>
      <span class="d">${g.gap == null ? '' : (g.gap > 0 ? '+' : '−') + mmss(Math.abs(g.gap))}</span>`;
    rc.append(r);
  }
  if (h.pb.corsa_km) {
    const r = el('div', 'hx-gap');
    r.innerHTML = `<span class="nm">Ritmo su 1 km</span><span class="v">${mmss(h.pb.corsa_km)}</span><span class="d"></span>`;
    rc.append(r);
  }
  w.append(rc);
}

/* -------------------------------------------------------- scheda race day */
function hxCheck(w, h) {
  const c = el('div', 'hx-card');
  c.append(el('div', 'hx-h', 'Checklist gara'));
  for (const x of HX.checklist) {
    const on = !!h.checklist[x.id];
    const r = el('button', 'hx-check' + (on ? ' on' : ''));
    r.innerHTML = `<span class="bx">${on ? '✓' : ''}</span>
      <span class="tx"><b>${esc(x.t)}</b><em>${esc(x.n)}</em></span>`;
    r.onclick = () => { h.checklist[x.id] = !on; save(); route(); };
    c.append(r);
  }
  w.append(c);

  /* alimentazione del giorno gara, agganciata al piano */
  const nc = el('div', 'hx-card');
  nc.append(el('div', 'hx-h', 'Il giorno della gara'));
  const peso = lastWeight() ?? D.profilo.peso_iniziale_kg;
  nc.append(el('div', 'hx-quote',
    `<div><span>Carboidrati 3h prima</span><b>${nf(peso * 1.5, 0)}–${nf(peso * 2, 0)} g</b><em>${nf(peso, 0)} kg di peso</em></div>
     <div><span>Acqua 2h prima</span><b>${nf(peso * 7, 0)} ml</b><em>poi solo sorsi</em></div>
     <div><span>Gel 30' prima</span><b>25–30 g</b><em>di carboidrati</em></div>`));
  nc.append(el('p', 'hx-note',
    'Quantita\' orientative da linee guida generali sullo sport di endurance, scalate sul tuo peso: non sono un piano nutrizionale personalizzato, e vanno provate in allenamento prima della gara. Il giorno della gara non si sperimenta niente di nuovo.'));
  w.append(nc);

  const sc = el('div', 'hx-card');
  sc.append(el('div', 'hx-h', 'Strategia'));
  sc.append(el('p', 'hx-p',
    'I primi due chilometri sono quelli che decidono la gara: quasi tutti li corrono troppo forte e lo pagano dal burpee in poi. Il piano dei passaggi esiste per quello.'));
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

function sheetAllenamento(a) {
  const h = HXS(), k = today();
  const w = el('div');
  w.append(el('div', 'eyebrow', a.tipo + ' · ' + a.durata + ' minuti'));
  w.append(el('h2', 'sec', esc(a.nome)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted', esc(a.descrizione)));
  if ((a.stazioni || []).length)
    w.append(el('p', 'hint', 'Stazioni allenate: '
      + a.stazioni.map(id => esc(stazione(id)?.nome || id)).join(', ')));
  const fatto = h.sessioni[k]?.id === a.id && h.sessioni[k]?.fatto;
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
