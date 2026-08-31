/* Le statistiche del periodo: i conti che servono a chi legge il resoconto.
 *
 * Sono qui e non dentro revisione.js per una ragione precisa: la revisione
 * risponde a "cosa cambio domani", ed e' fatta di poche voci pesate. Questo e'
 * un altro mestiere — quello che un nutrizionista o un medico si aspetta di
 * trovare quando gli porti dei dati: dove si concentra il problema nella
 * settimana, quale pasto salta, cosa entra fuori piano, quanto e' completo il
 * registro da cui esce tutto il resto.
 *
 * Nessuna di queste funzioni tocca il DOM e nessuna giudica: producono numeri.
 * Il giudizio, dove serve, sta altrove — e su parecchie di queste voci non ci
 * va per niente. "Il pasto che salti piu' spesso" e' un fatto utile; farne una
 * colpa non aggiungerebbe niente e romperebbe la regola sul tono.
 */
'use strict';

const GG_NOMI = ['Lunedi', 'Martedi', 'Mercoledi', 'Giovedi', 'Venerdi', 'Sabato', 'Domenica'];

/** Media dei valori non nulli, o null. */
function statMedia(v) {
  const b = v.filter(x => x != null && !isNaN(x));
  return b.length ? b.reduce((a, x) => a + x, 0) / b.length : null;
}

/** I giorni del periodo in ordine cronologico, pause comprese. */
function statGiorni(per) { return [...per.giorni].reverse(); }

/**
 * Quanto e' completo il registro.
 *
 * Va per prima in ogni resoconto, e non e' burocrazia: tutte le medie che
 * seguono valgono quanto vale questa riga. Una media di calorie su nove giorni
 * registrati su trenta non e' la tua alimentazione, e' quello che hai avuto
 * voglia di scrivere.
 */
function statRegistro(per) {
  const gg = statGiorni(per);
  const con = k => S.log[k];
  return {
    giorni: gg.length,
    registrati: gg.filter(k => typeof dayScore === 'function' ? dayScore(k) > 0 : con(k)).length,
    pesate: gg.filter(k => S.log[k]?.peso != null).length,
    conPasti: gg.filter(k => S.log[k]
      && (Object.keys(S.log[k].pasti || {}).length || (S.log[k].extra || []).length)).length,
    completezza: statMedia(gg.map(k => typeof dayScore === 'function' ? dayScore(k) : null)),
    inPausa: typeof inPausa === 'function' ? gg.filter(inPausa).length : 0
  };
}

/**
 * La ripartizione media: quanta parte delle calorie viene da ogni macro, e i
 * grammi per chilo di peso.
 *
 * I g/kg sono il modo in cui proteine e grassi si leggono in clinica: "135 g"
 * non dice niente senza sapere quanto pesa la persona, "1,9 g/kg" si.
 */
function statMacro(per) {
  const gg = statGiorni(per);
  const cons = gg.map(k => S.log[k] ? consumed(k) : null).filter(m => m && m.kcal > 400);
  if (!cons.length) return null;
  const m = id => statMedia(cons.map(x => x[id]));
  const kcal = m('kcal'), p = m('p'), c = m('c'), g = m('g');
  const peso = (typeof weightMA === 'function' && weightMA(per.a))
    || D.profilo?.peso_iniziale_kg || null;
  const quota = v => kcal ? v * 100 / kcal : null;
  return {
    giorni: cons.length, kcal, p, c, g, fibre: m('fibre'),
    quotaP: quota(p * 4), quotaC: quota(c * 4), quotaG: quota(g * 9),
    peso,
    pPerKg: peso ? p / peso : null,
    gPerKg: peso ? g / peso : null,
    fibrePer1000: kcal ? m('fibre') * 1000 / kcal : null
  };
}

/**
 * Come si distribuisce la settimana.
 *
 * E' la domanda che un professionista fa sempre e che l'app non sapeva
 * rispondere: non "quanto mangi", ma QUANDO le cose vanno storte. Il sabato e
 * la domenica sono quasi sempre un'altra dieta rispetto al mercoledi, e la
 * media dei sette giorni li nasconde tutti e due.
 */
function statSettimana(per) {
  const gg = statGiorni(per);
  const per_g = GG_NOMI.map((nome, i) => ({ nome, i, date: [] }));
  for (const k of gg) per_g[dayIdx(k)].date.push(k);

  const T = D.target;
  for (const r of per_g) {
    const cons = r.date.map(k => S.log[k] ? consumed(k) : null).filter(m => m && m.kcal > 400);
    r.giorni = r.date.length;
    r.registrati = r.date.filter(k => typeof dayScore === 'function' && dayScore(k) > 0).length;
    r.kcal = statMedia(cons.map(m => m.kcal));
    r.p = statMedia(cons.map(m => m.p));
    r.c = statMedia(cons.map(m => m.c));
    r.g = statMedia(cons.map(m => m.g));
    r.passi = statMedia(r.date.map(k => S.log[k]?.passi));
    r.sonno = statMedia(r.date.map(k => S.log[k]?.sonno));
    r.sedute = r.date.filter(k =>
      allenatoIl(k)).length;
    /* "Aderenza" qui e' una cosa sola e dichiarata: quanto le calorie del
       giorno si avvicinano al target. Non e' un voto sul cibo — questa app non
       ne da' — e' la distanza da un numero che l'utente ha scelto. */
    r.scarto = r.kcal != null && T.kcal ? (r.kcal - T.kcal) / T.kcal : null;
    r.aderenza = r.scarto == null ? null : Math.max(0, 100 - Math.abs(r.scarto) * 100);
    r.quotaAllen = r.giorni ? r.sedute * 100 / r.giorni : null;
  }
  const conDati = per_g.filter(r => r.kcal != null);
  const conAllen = per_g.filter(r => r.giorni > 0);
  return {
    giorni: per_g,
    migliore: conDati.length ? conDati.reduce((a, b) => a.aderenza >= b.aderenza ? a : b) : null,
    peggiore: conDati.length ? conDati.reduce((a, b) => a.aderenza <= b.aderenza ? a : b) : null,
    piuAllenato: conAllen.length
      ? conAllen.reduce((a, b) => a.quotaAllen >= b.quotaAllen ? a : b) : null,
    menoAllenato: conAllen.length
      ? conAllen.reduce((a, b) => a.quotaAllen <= b.quotaAllen ? a : b) : null
  };
}

/**
 * I pasti, uno per uno: quante volte era previsto e quante l'hai spuntato.
 *
 * Il denominatore e' il numero di volte in cui quello slot compare nel piano
 * dentro il periodo, non il numero di giorni: la colazione c'e' sette volte a
 * settimana, uno spuntino puo' esserci tre.
 */
function statPasti(per) {
  if (typeof usaPiano === 'function' && !usaPiano()) return null;
  const gg = statGiorni(per);
  const perSlot = new Map();
  const perPasto = new Map();
  for (const k of gg) {
    const giorno = D.settimana[dayIdx(k)];
    const log = S.log[k];
    for (const sl of (giorno?.pasti || [])) {
      if (!sl.codice) continue;
      const nome = D.pasti[sl.codice]?.nome || sl.codice;
      const preso = !!log?.pasti?.[sl.codice];
      for (const [mappa, chiave, etichetta] of
           [[perSlot, sl.slot, sl.slot], [perPasto, sl.codice, nome]]) {
        const r = mappa.get(chiave) || { chiave, nome: etichetta, previsti: 0, spuntati: 0 };
        r.previsti++; if (preso) r.spuntati++;
        mappa.set(chiave, r);
      }
    }
  }
  const chiudi = m => [...m.values()].map(r =>
    ({ ...r, quota: r.previsti ? r.spuntati * 100 / r.previsti : null }))
    .sort((a, b) => b.previsti - a.previsti);
  const slot = chiudi(perSlot), pasti = chiudi(perPasto);
  // "il piu' saltato" ha senso solo se quel pasto e' comparso qualche volta:
  // uno spuntino previsto una volta sola e saltato non e' un'abitudine
  const validi = slot.filter(r => r.previsti >= 3);
  return {
    slot, pasti,
    piuSaltato: validi.length ? validi.reduce((a, b) => a.quota <= b.quota ? a : b) : null,
    piuCostante: validi.length ? validi.reduce((a, b) => a.quota >= b.quota ? a : b) : null
  };
}

/** Cosa entra fuori dal piano, in ordine di quante volte. */
function statExtra(per, quanti = 8) {
  const gg = statGiorni(per);
  const conti = new Map();
  for (const k of gg) for (const e of (S.log[k]?.extra || [])) {
    if (!e.nome) continue;
    const r = conti.get(e.nome) || { nome: e.nome, n: 0, kcal: 0, p: 0, c: 0, g: 0 };
    r.n++; r.kcal += e.kcal || 0; r.p += e.p || 0; r.c += e.c || 0; r.g += e.g || 0;
    conti.set(e.nome, r);
  }
  const tot = [...conti.values()];
  const kcalTot = tot.reduce((a, r) => a + r.kcal, 0);
  return {
    voci: tot.sort((a, b) => b.kcal - a.kcal).slice(0, quanti),
    quante: tot.length,
    kcalTot,
    kcalGiorno: gg.length ? kcalTot / gg.length : 0
  };
}

/** Peso: dove sei partito, dove sei arrivato, a che ritmo. */
function statPeso(per) {
  const gg = statGiorni(per).filter(k => S.log[k]?.peso != null);
  if (gg.length < 2) return { pesate: gg.length };
  const primo = { k: gg[0], v: S.log[gg[0]].peso };
  const ultimo = { k: gg[gg.length - 1], v: S.log[gg[gg.length - 1]].peso };
  const giorni = Math.max(1, Math.round((new Date(ultimo.k) - new Date(primo.k)) / 864e5));
  // la tendenza, non le due pesate: due giornate storte agli estremi
  // farebbero dire qualsiasi cosa
  const t0 = typeof weightMA === 'function' ? weightMA(primo.k) : null;
  const t1 = typeof weightMA === 'function' ? weightMA(ultimo.k) : null;
  const delta = t0 != null && t1 != null ? t1 - t0 : ultimo.v - primo.v;
  return {
    pesate: gg.length, primo, ultimo, giorni,
    tendenzaIn: t0, tendenzaFin: t1, delta,
    kgSettimana: delta / giorni * 7,
    min: Math.min(...gg.map(k => S.log[k].peso)),
    max: Math.max(...gg.map(k => S.log[k].peso))
  };
}

/** Le circonferenze: prima e ultima rilevazione dentro il periodo. */
function statMisure(per) {
  const gg = statGiorni(per);
  const out = [];
  for (const m of (D.misure || [])) {
    const punti = gg.map(k => ({ k, v: S.log[k]?.misure?.[m.id] }))
      .filter(x => x.v != null && !isNaN(x.v));
    if (!punti.length) continue;
    const a = punti[0], b = punti[punti.length - 1];
    out.push({ id: m.id, nome: m.label || m.id, n: punti.length,
      prima: a.v, ultima: b.v, delta: punti.length > 1 ? b.v - a.v : null,
      target: m.target ?? null });
  }
  return out;
}

/** Allenamento: sedute, serie, cardio. Numeri, non giudizi. */
function statAllenamento(per) {
  const gg = statGiorni(per);
  let sedute = 0, serie = 0, tonnellaggio = 0, cardioN = 0, cardioMin = 0, cardioKm = 0;
  // l'interruttore "oggi mi sono allenato" non c'e' piu' — l'app lo deduce —
  // ma nei registri scritti prima c'e', e vale: quel giorno e' un allenamento
  // dichiarato, e toglierlo a posteriori riscriverebbe la storia
  let dichiarati = 0;
  const perEs = new Map();
  for (const k of gg) {
    if (S.log[k]?.allenamento === true) dichiarati++;
    const ss = typeof serieDelGiorno === 'function' ? serieDelGiorno(k) : [];
    if (ss.length) {
      sedute++;
      serie += ss.length;
      for (const x of ss) {
        tonnellaggio += (x.kg || 0) * (x.reps || 0);
        const nome = (typeof esercizio === 'function' && esercizio(x.ex)?.nome) || x.ex;
        perEs.set(nome, (perEs.get(nome) || 0) + 1);
      }
    }
    for (const c of (typeof cardioDi === 'function' ? cardioDi(k) : [])) {
      // il registro tiene metri e secondi: qui servono chilometri e minuti
      cardioN++;
      cardioMin += (c.durata_s || 0) / 60;
      cardioKm += (c.distanza_m || 0) / 1000;
    }
  }
  const totali = Math.max(sedute + cardioN, dichiarati);
  return {
    sedute, serie, tonnellaggio, cardioN, cardioMin, cardioKm, dichiarati, totali,
    seduteSettimana: gg.length ? totali / gg.length * 7 : 0,
    esercizi: [...perEs.entries()].map(([nome, n]) => ({ nome, n }))
      .sort((a, b) => b.n - a.n).slice(0, 6)
  };
}

/** Integratori: quante volte preso su quante volte toccava, nel periodo. */
function statIntegratori(per) {
  const gg = statGiorni(per);
  return (D.integratori || []).map(s => {
    if (s.cadenza === 'settimanale') {
      // a settimane, non a giorni: contare i giorni darebbe 4 su 30 anche a
      // chi non ne ha saltata nemmeno una
      const sett = new Set(gg.map(k => addDays(k, -dayIdx(k))));
      let prese = 0;
      for (const lun of sett)
        if (Array.from({ length: 7 }, (_, i) => addDays(lun, i))
          .some(g => S.log[g]?.integratori?.[s.nome])) prese++;
      return { nome: s.nome, dose: s.dose || '', cadenza: 'settimanale',
        prese, attese: sett.size, quota: sett.size ? prese * 100 / sett.size : null };
    }
    const prese = gg.filter(k => S.log[k]?.integratori?.[s.nome]).length;
    return { nome: s.nome, dose: s.dose || '', cadenza: 'giornaliero',
      prese, attese: gg.length, quota: gg.length ? prese * 100 / gg.length : null };
  });
}

/** Le abitudini che non sono cibo: acqua, sonno, passi, fame, energia. */
function statAbitudini(per) {
  const gg = statGiorni(per);
  const m = id => statMedia(gg.map(k => S.log[k]?.[id]));
  return {
    acqua: m('acqua'), sonno: m('sonno'), passi: m('passi'), coca: m('coca'),
    fame: m('fame'), energia: m('energia'),
    gi: gg.filter(k => S.log[k]?.gi).length,
    giorniGi: gg.length
  };
}
