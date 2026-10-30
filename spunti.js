/* Oggi, per il tuo obiettivo.
 *
 * Segnalato cosi': *"l'app non ti da' nessuno spunto per aiutarti a
 * raggiungere i propri obiettivi"*. Gli spunti c'erano, ma sparsi e generici:
 * un consiglio del giorno che ruotava sulla data, una sfida casuale, un elenco
 * di cose che non vanno in Andamento, e il giudizio del mese che parla una
 * volta al mese. Mancava la domanda di tutti i giorni: **cosa faccio oggi per
 * restare sul ritmo?**
 *
 * Qui la risposta e' al massimo tre righe, e ogni riga ha tre proprieta':
 *
 * 1. **nasce dai tuoi numeri di oggi** — quanto manca di proteine contando
 *    anche i pasti che non hai ancora mangiato, quanti minuti mancano ai 150
 *    della settimana, quale scheda tocca oggi. Niente frasi generiche: se non
 *    c'e' niente da dire, la carta lo dice in una riga;
 * 2. **si fa con un tocco** — aggiungere uno dei tre alimenti proposti,
 *    aprire la camminata, cominciare la scheda. Il tocco e' la scelta: niente
 *    si applica da solo;
 * 3. **rispetta le regole di sempre** — mai saltare pasti, mai compensare un
 *    giorno oltre il target, mai un numero inventato.
 *
 * L'ordine e' quello di quanto pesa sull'obiettivo: prima il giudizio del
 * mese se non e' in linea, poi le pesate se mancano (senza, nessun giudizio
 * regge), poi le proteine, la forza di oggi, il movimento, e solo in fondo
 * acqua e sonno.
 */
'use strict';

const SPUNTI_MAX = 3;

/** Quello che i pasti non ancora spuntati di oggi porteranno ancora. */
function previstoRestante(k) {
  const t = M0();
  if (!(typeof usaPiano === 'function' && usaPiano())) return t;
  const d = day(k);
  for (const s of slotsGiorno(k)) {
    const sid = chiaveP(s);
    if (d.pasti[sid] || !pasto(pastoDelGiorno(sid, k))) continue;
    addM(t, mealMGiorno(sid, k));
  }
  return t;
}

/**
 * Tre alimenti che coprono le proteine che mancano, ordinati per proteine
 * ogni 100 kcal: e' la misura che dice quanto un alimento "costa" in calorie
 * per quello che porta. La porzione copre fino a 30 g, arrotondata a 10 g,
 * e non supera i 250: una proposta deve essere una cosa che si mangia.
 */
function propostePerProteine(manca) {
  if (typeof mangiabili !== 'function') return [];
  const cop = Math.min(manca, 30);
  return mangiabili()
    .filter(x => x.unita === 'g' && x.p >= 8 && x.kcal > 0)
    .map(x => {
      const qta = Math.max(20, Math.min(250, Math.round(cop / x.p * 100 / 10) * 10));
      return { ...x, qta, densita: x.p / x.kcal * 100,
               pq: x.p * qta / 100, kq: x.kcal * qta / 100 };
    })
    .sort((a, b) => b.densita - a.densita)
    .slice(0, 3);
}

/** Registra un alimento proposto nel fuori piano: e' il tocco che decide. */
function aggiungiProposta(k, x) {
  const m = macroMangiabile(x.id, x.qta);
  if (!m) return;
  day(k).extra.push({ nome: `${x.nome} ${nf(x.qta)} g`, kcal: Math.round(m.kcal),
    p: m.p, c: m.c, g: m.g, fibre: m.fibre });
  save(); route();
  toast(`${x.nome}: +${nf(m.p, 0)} g di proteine`);
}

/** Gli spunti di oggi, gia' ordinati. Ognuno: { id, ic, t, d, azione?, proposte? }. */
function spuntiOggi(k = today()) {
  const out = [];
  const ob = typeof obiettivoAttivo === 'function' ? obiettivoAttivo() : null;
  const ora = new Date().getHours();
  const d = day(k);

  /* 1. il mese, se non e' in linea: e' l'unico spunto che dice se il resto
        sta funzionando. In linea non si ripete niente — sarebbe rumore. */
  const g = typeof giudizioMese === 'function' ? giudizioMese(k) : null;
  if (g && ['lento', 'veloce', 'opposto', 'giu', 'su'].includes(g.stato)) out.push({
    id: 'mese', ic: 'andamento', t: `Questo mese: ${MESE_STATI[g.stato].t.toLowerCase()}`,
    d: g.azione.t, azione: { t: 'Apri il mese', go: () => { andTab = 'mese'; apri('#/andamento'); } } });

  /* 2. le pesate: senza abbastanza pesate nessun giudizio regge, e la pesata
        si fa al mattino — dopo pranzo direbbe un'altra cosa. */
  if (S.log[k]?.peso == null && ora < 13) out.push({
    id: 'peso', ic: 'persona', t: 'Pesati stamattina',
    d: g && !g.R.ok
      ? `Nell'ultimo mese ci sono ${g.R.n} pesate utili: ne servono otto per sapere se stai andando nella direzione giusta.`
      : 'Prima di bere o mangiare. Conta la media della settimana, non il numero di oggi.',
    azione: { t: 'Scrivi il peso', go: () => apri('#/corpo') } });

  /* 3. le proteine, contando anche i pasti che restano: alle 9 del mattino
        "ne mancano 100" e' vero e inutile se pranzo e cena le coprono. */
  const cons = consumed(k), tgt = dayTarget(k), resto = previstoRestante(k);
  const mancaP = (tgt.p || 0) - cons.p - resto.p;
  if (tgt.p > 0 && mancaP >= 15) {
    const prop = propostePerProteine(mancaP);
    out.push({
      id: 'proteine', ic: 'utensils',
      t: `Mancano ${nf(mancaP)} g di proteine`,
      d: resto.p > 1
        ? `Anche contando i pasti che restano oggi. Una di queste le avvicina:`
        : 'Una di queste le avvicina:',
      proposte: prop });
  }

  /* 4. la forza di oggi: la scheda in programma, con lo stato dei gruppi che
        allena. Se oggi non c'e' niente in programma ma la settimana e' corta
        di forza, lo si dice. */
  const settimana = typeof settimanaInCorso === 'function' ? settimanaInCorso(k) : [k];
  const A = typeof attivitaGiorni === 'function' ? attivitaGiorni(settimana) : { eq: 0, forza: 0 };
  const restanti = 6 - dayIdx(k);              // giorni dopo oggi in questa settimana
  const id = typeof schedaDelGiorno === 'function' ? schedaDelGiorno(k) : null;
  const sc = id && typeof scheda === 'function' ? scheda(id) : null;
  const pesiOggi = typeof serieDelGiorno === 'function' && serieDelGiorno(k).length;
  if (sc && !pesiOggi) {
    const p = typeof prontezzaScheda === 'function' ? prontezzaScheda(sc, k) : null;
    out.push({ id: 'forza', ic: 'manubrio', t: `Oggi tocca ${sc.nome}`,
      d: p?.dati ? `${p.eti}: ${p.perche}` : `${sc.esercizi.length} esercizi in programma.`,
      azione: { t: 'Comincia', go: () => sheetSeduta(k) } });
  } else if (!pesiOggi && A.forza < OMS_FORZA && OMS_FORZA - A.forza > restanti) out.push({
    id: 'forza', ic: 'manubrio', t: `Forza: ${A.forza} giorn${A.forza === 1 ? 'o' : 'i'} su ${OMS_FORZA} questa settimana`,
    d: 'Se oggi non ti alleni, la settimana resta corta: con due sedute quello che perdi e\' piu\' grasso e meno muscolo.',
    azione: { t: 'Registra pesi', go: () => sheetSeduta(k) } });

  /* 5. il movimento: quanto manca ai 150 minuti, diviso i giorni che restano,
        detto come una cosa da fare oggi. Non se oggi hai gia' fatto cardio. */
  const cardioOggi = typeof cardioDi === 'function' && cardioDi(k).length;
  const mancaMin = OMS_MIN - A.eq;
  if (mancaMin > 0 && !cardioOggi) {
    const oggiMin = Math.min(60, Math.max(20, Math.ceil(mancaMin / (restanti + 1) / 5) * 5));
    out.push({ id: 'movimento', ic: 'camminata',
      t: `${nf(oggiMin)} minuti di camminata veloce`,
      d: `Ti mancano ${nf(mancaMin)} minuti per i ${OMS_MIN} della settimana`
        + (restanti ? `, con ${restanti + 1} giorni per farli.` : ', ed e\' l\'ultimo giorno.'),
      azione: { t: 'Registra', go: () => sheetCardioManuale(k, 'camminata') } });
  }

  /* 6. acqua e sonno, solo quando sono davvero indietro */
  const tA = D.target?.acqua_l || 2.5;
  if (ora >= 15 && (d.acqua || 0) < tA * 0.5) out.push({
    id: 'acqua', ic: 'coffee', t: `Acqua: ${nf(d.acqua || 0, 1)} L su ${nf(tA, 1)}`,
    d: 'Un bicchiere adesso e uno a ogni pasto. Con le fibre alte l\'acqua non e\' opzionale.',
    azione: { t: 'Apri il diario', go: () => apri('#/diario') } });
  if (d.sonno != null && d.sonno < 6.5) out.push({
    id: 'sonno', ic: 'bed', t: `Stanotte ${nf(d.sonno, 1)} ore di sonno`,
    d: 'Con meno di sette ore la fame sale e il recupero scende. Stasera, mezz\'ora prima.' });

  return { ob, lista: out.slice(0, SPUNTI_MAX), tutti: out.length };
}

/* ================================================================ la carta */
function cardSpunti(k = today()) {
  const S0 = spuntiOggi(k);
  const c = el('div', 'card spunti');
  const sotto = S0.ob
    ? `${S0.ob.n}${S0.ob.pct ? ` · ${S0.ob.pct > 0 ? '+' : '−'}${nf(Math.abs(S0.ob.pct * 100), 2)}% a settimana` : ''}`
    : 'Nessun obiettivo scelto';
  c.append(el('div', 'spu-h', `<b>Oggi, per il tuo obiettivo</b><span>${esc(sotto)}</span>`));

  if (!S0.lista.length) {
    c.append(el('p', 'spu-ok', 'Oggi sei in linea su tutto quello che l\'app sa misurare.'));
    return c;
  }
  for (const s of S0.lista) {
    const r = el('div', 'spu-r');
    const ic = el('span', 'ic');
    if (typeof icona === 'function') ic.append(icona(s.ic, { size: 18 }));
    r.append(ic);
    const body = el('div', 'body', `<b>${esc(s.t)}</b><span>${esc(s.d)}</span>`);
    if (s.proposte?.length) {
      const ch = el('div', 'spu-chips');
      for (const x of s.proposte) {
        const b = el('button', 'chip');
        b.innerHTML = `<span class="n">${esc(x.nome)} ${nf(x.qta)} g</span>`
          + `<span class="k">+${nf(x.pq, 0)} P · ${nf(x.kq)} kcal</span>`;
        b.onclick = () => aggiungiProposta(k, x);
        ch.append(b);
      }
      body.append(ch);
    }
    r.append(body);
    if (s.azione) {
      const b = el('button', 'spu-go', esc(s.azione.t));
      b.onclick = s.azione.go;
      r.append(b);
    }
    c.append(r);
  }
  if (S0.tutti > S0.lista.length) c.append(el('p', 'note',
    'Ce n\'e\' qualcun altro, meno importante: tre alla volta, o diventano un elenco.'));
  return c;
}
