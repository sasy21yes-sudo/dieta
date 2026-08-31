/* Confrontare due alimenti.
 *
 * "Quale dei due conviene" e' una domanda che sembra semplice e non lo e', per
 * un motivo solo: dipende da cosa tieni fermo. A parita' di peso il piu' denso
 * vince sempre in calorie; a parita' di calorie vince chi ne mette dentro piu'
 * proteine; a parita' di proteine vince chi costa meno calorie. Sono tre
 * risposte diverse alla stessa domanda, e sono tutte e tre vere.
 *
 * Questa schermata non sceglie per te: mette i tre confronti uno sotto l'altro
 * e dice quale ancora sta tenendo fermo. Nessun punteggio, nessun "meglio" —
 * questa app non da' voti al cibo, e un alimento non e' migliore di un altro
 * fuori dal contesto in cui lo mangi.
 */
'use strict';

/** I dati di una voce confrontabile, presi da mangiabili(). */
function confVoce(id) {
  const x = typeof mangiabile === 'function' ? mangiabile(id) : null;
  if (!x) return null;
  return {
    id, nome: x.nome, unita: x.unita || 'g', marca: x.marca || '',
    stima: !!x.stima, prodotto: x.fonte === 'prodotto',
    per100: { kcal: x.kcal || 0, p: x.p || 0, c: x.c || 0, g: x.g || 0, fibre: x.fibre || 0 }
  };
}

/** I macro di una voce a una certa quantita'. */
function confA(v, qta) {
  const f = (qta || 0) / 100;
  const m = {};
  for (const k of ['kcal', 'p', 'c', 'g', 'fibre']) m[k] = v.per100[k] * f;
  return m;
}

/**
 * I numeri derivati, quelli che dicono di piu' dei grammi.
 *
 * La densita' calorica e' quanto pesa una caloria: e' la variabile che decide
 * se un pasto sazia o no molto piu' del macro dominante. Le proteine per 100
 * kcal sono il modo di confrontare due fonti proteiche senza farsi ingannare
 * dal condimento che si portano dietro.
 */
function confDerivati(v) {
  const m = v.per100;
  const q = x => m.kcal ? x * 100 / m.kcal : null;
  return {
    quotaP: q(m.p * 4), quotaC: q(m.c * 4), quotaG: q(m.g * 9),
    densita: m.kcal / 100,                       // kcal per grammo
    pPer100kcal: m.kcal ? m.p * 100 / m.kcal : null,
    fibrePer100kcal: m.kcal ? m.fibre * 100 / m.kcal : null,
    // il conto delle calorie dai macro: se non torna, i valori sono sbagliati
    kcalTeoriche: 4 * m.p + 4 * m.c + 9 * m.g + 2 * m.fibre
  };
}

/**
 * Quanto ce ne vuole del secondo per pareggiare il primo su un vincolo.
 *
 * Torna `null` quando il vincolo non esiste — chiedere quanti grammi di olio
 * pareggiano venti grammi di proteine non ha risposta, e inventarne una
 * (dividere per zero, o mostrare un numero enorme) sarebbe peggio del silenzio.
 */
function confEquivalente(a, b, qtaA, vincolo) {
  const target = confA(a, qtaA)[vincolo];
  const per100 = b.per100[vincolo];
  if (!(target > 0) || !(per100 > 0)) return null;
  const q = target / per100 * 100;
  // oltre certi limiti non e' piu' una porzione: un chilo di insalata per
  // pareggiare le proteine di cento grammi di tofu e' un conto giusto e una
  // risposta inutile
  return { qta: q, fuoriScala: q > 1500 || q < 1, macro: confA(b, q) };
}

const CONF_VINCOLI = [
  ['peso', 'A parita’ di peso', 'Stessi grammi sul piatto.'],
  ['kcal', 'A parita’ di calorie', 'Quanto ne serve per portare le stesse calorie.'],
  ['p', 'A parita’ di proteine', 'Quanto ne serve per portare le stesse proteine.']
];

/* ==================================================================== vista */

let confA1 = null, confB1 = null, confQta = 100;

function sheetConfronta(idA, idB) {
  confA1 = idA ?? confA1;
  confB1 = idB ?? confB1;
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Due alimenti a confronto'));
  w.append(el('h2', 'sec', 'Quale conviene, e per cosa'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Dipende da cosa tieni fermo: a parita’ di peso vince sempre il piu’ '
    + 'denso, a parita’ di calorie chi ha piu’ proteine, a parita’ di '
    + 'proteine chi costa meno calorie. Sono tre risposte diverse e sono tutte '
    + 'e tre vere, quindi ci sono tutte e tre.'));

  const opz = (typeof mangiabili === 'function' ? mangiabili() : []).map(x => ({
    v: x.id, lab: x.nome,
    sub: `${x.fonte === 'prodotto' ? (x.marca ? x.marca + ' · ' : 'tuo prodotto · ') : ''}`
      + `${nf(x.kcal)} kcal · ${nf(x.p, 1)} P per 100 ${x.unita}`
  }));

  const scelta = (lab, val, onC) => {
    const f = el('div', 'field', `<label>${lab}</label>`);
    f.append(selettoreCercabile(opz, val, onC, 'cerca…'));
    return f;
  };
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:1fr;gap:0';
  g.append(scelta('Il primo', confA1, v => { confA1 = v; sheetConfronta(); }));
  g.append(scelta('Il secondo', confB1, v => { confB1 = v; sheetConfronta(); }));
  w.append(g);

  const a = confVoce(confA1), b = confVoce(confB1);
  if (!a || !b) {
    w.append(el('p', 'hint', 'Scegline due e sotto compare il confronto.'));
    const ch = el('button', 'btn wide', 'Chiudi');
    ch.style.marginTop = '12px';
    ch.onclick = closeSheet;
    w.append(ch);
    sheet(w);
    return;
  }
  if (a.id === b.id) {
    w.append(el('p', 'hint', 'Sono lo stesso alimento: scegline un altro.'));
  } else {
    w.append(confCorpo(a, b));
  }

  const inv = el('button', 'btn wide');
  inv.style.marginTop = '12px';
  inv.textContent = 'Inverti i due';
  inv.onclick = () => { const t = confA1; confA1 = confB1; confB1 = t; sheetConfronta(); };
  w.append(inv);
  const ch = el('button', 'btn wide pri', 'Chiudi');
  ch.style.marginTop = '8px';
  ch.onclick = closeSheet;
  w.append(ch);
  sheet(w);
}

function confCorpo(a, b) {
  const box = el('div');
  const dA = confDerivati(a), dB = confDerivati(b);

  /* --- la quantita' di partenza: tutto il resto si muove con lei --- */
  const fq = el('div', 'field',
    `<label>Quanto ne mangi di <strong>${esc(a.nome)}</strong></label>
     <input type="text" inputmode="decimal" id="cf-q" value="${nf(confQta)}">`);
  box.append(fq);
  fq.querySelector('input').oninput = e => {
    const n = parseNum(e.target.value);
    if (n != null && n > 0 && n <= 5000) { confQta = n; aggiorna(); }
  };

  const corpo = el('div');
  box.append(corpo);

  const riga = (lab, va, vb, dec, unit, nota) => {
    const r = el('div', 'cf-r');
    const d = (vb ?? 0) - (va ?? 0);
    const forte = Math.abs(d) > Math.max(Math.abs(va || 0), 1) * 0.05;
    r.innerHTML = `<span class="l">${lab}${nota ? `<em>${nota}</em>` : ''}</span>
      <span class="a">${va == null ? '—' : nf(va, dec)}${unit ? ' ' + unit : ''}</span>
      <span class="b">${vb == null ? '—' : nf(vb, dec)}${unit ? ' ' + unit : ''}</span>
      <span class="d ${!forte ? '' : d > 0 ? 'su' : 'giu'}">${
        va == null || vb == null ? '' : (d >= 0 ? '+' : '−') + nf(Math.abs(d), dec)}</span>`;
    return r;
  };
  const intest = () => {
    const h = el('div', 'cf-r cf-h');
    h.innerHTML = `<span class="l"></span><span class="a">${esc(a.nome)}</span>
      <span class="b">${esc(b.nome)}</span><span class="d">diff.</span>`;
    return h;
  };

  const aggiorna = () => {
    corpo.innerHTML = '';
    const q = confQta;

    /* --- 1. a parita' di peso --- */
    const c1 = el('div', 'cw');
    c1.append(el('h3', null, `A parita’ di peso · ${nf(q)} ${a.unita}`));
    c1.append(el('div', 'sub',
      'Stessa quantita’ sul piatto. E’ il confronto piu’ immediato e anche '
      + 'il piu’ ingannevole: chi e’ piu’ denso vince sempre, ma nessuno '
      + 'mangia a peso.'));
    const mA = confA(a, q), mB = confA(b, q);
    c1.append(intest());
    for (const [k, lab, dec, u] of [['kcal', 'Calorie', 0, 'kcal'], ['p', 'Proteine', 1, 'g'],
                                    ['c', 'Carboidrati', 1, 'g'], ['g', 'Grassi', 1, 'g'],
                                    ['fibre', 'Fibre', 1, 'g']])
      c1.append(riga(lab, mA[k], mB[k], dec, u));
    c1.append(confBarre(a, b, mA, mB));
    corpo.append(c1);

    /* --- 2. a parita' di calorie e di proteine --- */
    for (const [vinc, tit, sub, unita] of [
      ['kcal', 'A parita’ di calorie', 'Quanti ' + b.unita + ' del secondo portano '
        + 'le stesse calorie del primo.', 'kcal'],
      ['p', 'A parita’ di proteine', 'Quanti ' + b.unita + ' del secondo portano '
        + 'le stesse proteine del primo.', 'g']
    ]) {
      const eq = confEquivalente(a, b, q, vinc);
      const c = el('div', 'cw');
      c.append(el('h3', null, tit));
      c.append(el('div', 'sub', sub));
      if (!eq) {
        c.append(el('p', 'hint', vinc === 'p'
          ? 'Uno dei due non ha proteine: non c’e’ una quantita’ che le pareggi.'
          : 'Uno dei due non ha calorie: il conto non esiste.'));
      } else {
        c.append(el('div', 'read',
          `<span><b>${nf(q)} ${esc(a.unita)}</b> di ${esc(a.nome)}</span>`
          + `<span>=</span>`
          + `<span><b>${nf(eq.qta, eq.qta < 20 ? 1 : 0)} ${esc(b.unita)}</b> di ${esc(b.nome)}</span>`));
        c.append(intest());
        for (const [k, lab, dec, u] of [['kcal', 'Calorie', 0, 'kcal'], ['p', 'Proteine', 1, 'g'],
                                        ['c', 'Carboidrati', 1, 'g'], ['g', 'Grassi', 1, 'g'],
                                        ['fibre', 'Fibre', 1, 'g']])
          c.append(riga(lab, mA[k], eq.macro[k], dec, u));
        if (eq.fuoriScala) c.append(el('div', 'hint acciacco',
          `${nf(eq.qta)} ${b.unita} e’ un conto giusto e una porzione che nessuno `
          + 'mangia: il pareggio esiste sulla carta, non nel piatto.'));
      }
      c.append(el('p', 'note', unita === 'kcal'
        ? 'A parita’ di calorie il confronto che conta e’ sulle proteine: sono '
          + 'la variabile che protegge la massa magra mentre il resto si muove.'
        : 'A parita’ di proteine il confronto che conta e’ sulle calorie: e’ '
          + 'il prezzo che paghi per quei grammi.'));
      corpo.append(c);
    }

    /* --- 3. le proprieta' che non dipendono dalla quantita' --- */
    const c3 = el('div', 'cw');
    c3.append(el('h3', null, 'Com’e’ fatto, indipendentemente da quanto ne mangi'));
    c3.append(el('div', 'sub',
      'Rapporti per 100 ' + a.unita + ': non cambiano con la porzione, e sono quelli '
      + 'che dicono che tipo di alimento e’.'));
    c3.append(intest());
    c3.append(riga('Densita’ calorica', dA.densita, dB.densita, 2, 'kcal/' + a.unita,
      'quanto pesa una caloria'));
    c3.append(riga('Proteine per 100 kcal', dA.pPer100kcal, dB.pPer100kcal, 1, 'g',
      'quanto costa una proteina'));
    c3.append(riga('Fibre per 100 kcal', dA.fibrePer100kcal, dB.fibrePer100kcal, 1, 'g'));
    c3.append(riga('Quota proteine', dA.quotaP, dB.quotaP, 0, '%',
      'delle calorie'));
    c3.append(riga('Quota carboidrati', dA.quotaC, dB.quotaC, 0, '%'));
    c3.append(riga('Quota grassi', dA.quotaG, dB.quotaG, 0, '%'));
    corpo.append(c3);

    /* --- 4. da dove vengono questi numeri --- */
    const c4 = el('div', 'card flat');
    c4.append(el('div', 'eyebrow', 'Da dove vengono i numeri'));
    const prov = v => {
      const d = confDerivati(v);
      const scarto = v.per100.kcal
        ? Math.abs(d.kcalTeoriche - v.per100.kcal) / v.per100.kcal : 0;
      return `<strong>${esc(v.nome)}</strong>: ${
        v.stima ? 'valore stimato, media di categoria'
        : v.prodotto ? 'etichetta di un prodotto registrato'
        : 'valore verificato'}`
        + (scarto > 0.3
          ? ` — <span class="mono">attenzione: i macro darebbero ${nf(d.kcalTeoriche)} kcal `
            + `invece di ${nf(v.per100.kcal)}, qualcuno ha sbagliato a inserirli</span>`
          : '');
    };
    c4.append(el('div', 'muted', prov(a) + '<br>' + prov(b)));
    c4.append(el('p', 'note',
      'Un confronto vale quanto valgono i due numeri che confronta: fra una stima '
      + 'e un’etichetta la differenza puo’ essere piu’ grande di quella '
      + 'che stai guardando.'));
    corpo.append(c4);
  };

  aggiorna();
  return box;
}

/**
 * Le due barre affiancate sui quattro macro.
 *
 * Una serie sola per macro, in scala fra i due alimenti: non e' un grafico
 * temporale e non ha un asse y — e' il modo piu' rapido di vedere quale dei
 * due e' spostato dove. La legenda c'e' anche con due sole serie: senza, due
 * colori sono due cose che il lettore deve indovinare.
 */
function confBarre(a, b, mA, mB) {
  const box = el('div');
  const voci = [['kcal', 'kcal'], ['p', 'prot'], ['c', 'carb'], ['g', 'gras'], ['fibre', 'fibre']];
  const g = el('div', 'cf-bars');
  for (const [k, lab] of voci) {
    const max = Math.max(mA[k] || 0, mB[k] || 0, 0.001);
    const r = el('div', 'cf-b');
    r.innerHTML = `<span class="l">${lab}</span>
      <span class="s"><i class="a" style="width:${((mA[k] || 0) / max * 100).toFixed(1)}%"></i></span>
      <span class="s"><i class="b" style="width:${((mB[k] || 0) / max * 100).toFixed(1)}%"></i></span>`;
    g.append(r);
  }
  box.append(g);
  const leg = el('div', 'legend');
  leg.innerHTML = `<span><i class="dt" style="background:var(--pine)"></i>${esc(a.nome)}</span>
    <span><i class="dt" style="background:var(--media)"></i>${esc(b.nome)}</span>`;
  box.append(leg);
  box.append(el('p', 'note',
    'Ogni riga e’ in scala su se stessa: la barra piena e’ il piu’ alto '
    + 'dei due, non un massimo assoluto. Serve a vedere dove sta la differenza, '
    + 'non quanto e’ grande in assoluto — quello lo dicono i numeri sopra.'));
  return box;
}
