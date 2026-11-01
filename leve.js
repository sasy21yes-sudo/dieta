/* Aggiusta i macro di un giorno del piano.
 *
 * **La domanda.** L'editor della settimana dice com'e' un giorno — "mancano
 * 5 g di proteine, 9 g di grassi in piu'" — e poi si ferma. La riga dopo e'
 * *e allora cosa tocco?*, e la risposta giusta quasi mai e' una cosa sola:
 * per alzare le proteine senza toccare il resto si allunga il tofu **e** si
 * toglie un po' di pasta **e** si dimezza l'olio, perche' il tofu porta con se'
 * anche grassi e carboidrati.
 *
 * Qui si sceglie **un macro e di quanto**, e l'app cerca le combinazioni che
 * lo spostano tenendo fermi gli altri due (o le calorie, se lo chiedi):
 *
 * - **le porzioni**: fino a tre quantita' cambiate nei pasti del giorno,
 *   anche in pasti diversi. Passano dai codici `ric:`/`ali:`, quindi il
 *   registro delle ricette non si muove di un grammo;
 * - **una ricetta al posto di un'altra, con i pesi rifatti**: la ricetta nuova
 *   non entra com'e' ma con le quantita' che la fanno combaciare col pasto
 *   che sostituisce, piu' lo spostamento chiesto.
 *
 * Il conto e' un piccolo sistema lineare: ogni ingrediente porta un vettore
 * (kcal, P, C, G per grammo), e per ogni gruppo di uno, due o tre ingredienti
 * si cerca la variazione che da' esattamente lo spostamento chiesto e zero
 * sugli altri. Le soluzioni fuori dai limiti della porzione si scartano, le
 * altre si arrotondano a scatti che si pesano in cucina e **si rifanno coi
 * codici veri** (`levTotali()`): il numero che la riga scrive e' quello che il
 * giorno fara', arrotondamento compreso.
 *
 * Il prima e il dopo stanno nelle barre in cima, e le barre sono anche il
 * selettore: si tocca il macro da cambiare. Toccare una proposta la mostra
 * nelle barre; la scrive nel piano solo il bottone.
 */
'use strict';

/* I tre macro che si muovono. Le calorie no: seguono dai tre (4/4/9), e
   "alza le calorie tenendo fermi i macro" non ha soluzione. `passo` e `max`
   sono il cursore, `tol` e' quanto uno spostamento puo' sbagliare restando
   "fermo": sotto quella soglia la bilancia di casa non lo vede. */
const LEV_VOCI = [
  { id: 'p', n: 'Proteine', art: 'le proteine', l: 'P', passo: 5, max: 40, tol: 2, col: 'var(--c1)' },
  { id: 'c', n: 'Carboidrati', art: 'i carboidrati', l: 'C', passo: 10, max: 80, tol: 3, col: 'var(--c2)' },
  { id: 'g', n: 'Grassi', art: 'i grassi', l: 'G', passo: 2, max: 30, tol: 1.5, col: 'var(--c3)' }
];
const LEV_TOL_KCAL = 20;
/* Quanto si puo' allargare o stringere una porzione del giorno. Il fondo e'
   **un quarto**, non zero: togliere un ingrediente e' una modifica alla
   ricetta, e si fa dentro il pasto. Il tetto e' due volte e mezza. */
const LEV_FONDO = 0.25;
const LEV_TETTO = 2.5;
/* Una ricetta che entra al posto di un'altra si ripesa entro meta'-doppio:
   oltre, non e' piu' quella ricetta. */
const LEV_RIC_FONDO = 0.5;
const LEV_RIC_TETTO = 2;

const levVoce = id => LEV_VOCI.find(v => v.id === id) || LEV_VOCI[0];

/** I macro di un codice di pasto, zero se quel codice non risolve niente. */
function levM(code) {
  const pa = code ? pasto(code) : null;
  if (!pa) return M0();
  /* gli stessi macro che somma `totaliGiorno()`: due strade diverse per il
     totale di un giorno darebbero due totali diversi nella stessa schermata */
  return pa.macro
    || (typeof macroRicetta === 'function' ? macroRicetta(pa) : null) || M0();
}

/** I totali di un giorno del piano, ricalcolati dai codici che gli passi. */
function levTotali(codici) {
  const t = M0();
  for (const c of codici) addM(t, levM(c));
  for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) t[x] = Math.round(t[x] * 10) / 10;
  return t;
}

/** Le quantita' si muovono a scatti che si possono pesare in cucina. */
function levArrotonda(q) {
  return q < 100 ? Math.round(q / 5) * 5 : Math.round(q / 10) * 10;
}

/** Cosa ogni grammo di un alimento porta: kcal, P, C, G. */
function levPerGrammo(nome) {
  const a = alimento(nome);
  if (!a) return null;
  return { kcal: (a.kcal || 0) / 100, p: (a.p || 0) / 100, c: (a.c || 0) / 100, g: (a.g || 0) / 100 };
}

/* ------------------------------------------------------------ il sistema */

/**
 * Le righe del sistema: lo spostamento chiesto, e zero su quello che resta
 * fermo. Ogni riga e' divisa per la sua tolleranza, cosi' un grammo di grassi
 * pesa quanto un grammo e mezzo di proteine e venti calorie.
 */
function levRighe(id, delta, fermo) {
  const v = levVoce(id);
  const r = [{ k: id, b: delta, tol: v.tol }];
  if (fermo === 'kcal') r.push({ k: 'kcal', b: 0, tol: LEV_TOL_KCAL });
  else for (const o of LEV_VOCI) if (o.id !== id) r.push({ k: o.id, b: 0, tol: o.tol });
  return r;
}

/** Risolve `N x = y` (k <= 3) per eliminazione. `null` se singolare. */
function levSolve(N, y) {
  const k = y.length;
  const A = N.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((r, i) => r[k] / r[i]);
}

/**
 * Per ogni gruppo di uno, due o tre ingredienti, la variazione di quantita'
 * che soddisfa meglio le righe (minimi quadrati pesati; esatta quando gli
 * ingredienti sono tanti quante le righe). Torna i gruppi che restano dentro
 * i limiti, gia' arrotondati, con lo spostamento **previsto** — quello vero
 * lo calcola chi chiama, coi codici.
 */
function levCombina(voci, righe, maxK = 3) {
  const fuori = [];
  const n = voci.length;
  const prova = idx => {
    const M = righe.map(r => idx.map(i => voci[i].v[r.k] / r.tol));
    const rhs = righe.map(r => r.b / r.tol);
    const k = idx.length;
    const N = Array.from({ length: k }, (_, a) =>
      Array.from({ length: k }, (_, b) => M.reduce((s, row) => s + row[a] * row[b], 0)));
    const y = Array.from({ length: k }, (_, a) => M.reduce((s, row, r) => s + row[a] * rhs[r], 0));
    const x = levSolve(N, y);
    if (!x) return;
    const cambi = [];
    for (let j = 0; j < k; j++) {
      const it = voci[idx[j]], q = it.q0 + x[j];
      if (q < it.lo - 0.01 || q > it.hi + 0.01) return;
      const qr = Math.min(Math.max(levArrotonda(q), it.lo), it.hi);
      if (qr !== it.q0) cambi.push({ it, q: qr });
    }
    if (!cambi.length) return;
    const d = { kcal: 0, p: 0, c: 0, g: 0 };
    for (const c of cambi) for (const m in d) d[m] += (c.q - c.it.q0) * c.it.v[m];
    fuori.push({ cambi, d });
  };
  for (let a = 0; a < n; a++) {
    prova([a]);
    if (maxK < 2) continue;
    for (let b = a + 1; b < n; b++) {
      prova([a, b]);
      if (maxK < 3) continue;
      for (let c = b + 1; c < n; c++) prova([a, b, c]);
    }
  }
  return fuori;
}

/**
 * Quanto costa una soluzione: quanto sbaglia sulle righe, piu' quante cose
 * cambia e di quanto. A parita' di precisione vince quella che tocca meno.
 */
function levCosto(d, righe, cambi) {
  /* il macro chiesto pesa una volta e mezza: chi chiede +5 g e trova +4 se
     ne accorge, chi trova un grammo di grassi in piu' di solito no */
  let e = 0;
  righe.forEach((r, i) => { e += (i ? 1 : 1.5) * Math.abs((d[r.k] || 0) - r.b) / r.tol; });
  const sforzo = cambi.reduce((s, c) => s + Math.abs(c.q - c.it.q0) / c.it.q0, 0);
  return e + 0.5 * cambi.length + 1.2 * sforzo;
}

/** Buona = lo spostamento c'e' e quello che doveva restare fermo e' fermo. */
function levBuona(d, righe) {
  const [t, ...ferme] = righe;
  if (Math.abs((d[t.k] || 0) - t.b) > Math.max(2 * t.tol, Math.abs(t.b) * 0.25)) return false;
  return ferme.every(r => Math.abs(d[r.k] || 0) <= 2 * r.tol);
}

/* ---------------------------------------------------------- le porzioni */

/** Le porzioni del giorno che si possono muovere: una per ingrediente per pasto. */
function levPorzioniGiorno(g) {
  const voci = [];
  (g.pasti || []).forEach((s, si) => {
    partiPasto(s.codice).forEach((cod, pi) => {
      const pa = pasto(cod);
      if (!pa?.ingredienti?.length) return;
      const solo = String(cod).startsWith(PRE_ALI);
      for (const ing of pa.ingredienti) {
        const v = levPerGrammo(ing.alimento);
        const q0 = ing.qta || 0;
        if (!v || !(q0 > 0) || !(v.kcal > 0)) continue;
        voci.push({
          si, pi, solo, nome: ing.alimento, q0, v, slot: s.slot,
          dove: solo ? '' : (pa.nome || ''),
          unita: alimento(ing.alimento)?.unita || 'g',
          lo: Math.max(5, levArrotonda(q0 * LEV_FONDO)),
          hi: levArrotonda(q0 * LEV_TETTO)
        });
      }
    });
  });
  return voci;
}

/** I codici del giorno con le quantita' cambiate. Un pasto, un codice nuovo. */
function levCodici(g, cambi) {
  const codici = (g.pasti || []).map(s => s.codice);
  const perPasto = new Map();
  for (const c of cambi) {
    if (!perPasto.has(c.it.si)) perPasto.set(c.it.si, []);
    perPasto.get(c.it.si).push(c);
  }
  for (const [si, cc] of perPasto) {
    const parti = partiPasto(codici[si]);
    for (const c of cc) {
      const cod = parti[c.it.pi];
      if (c.it.solo) { parti[c.it.pi] = codiceAlimento(c.it.nome, c.q); continue; }
      const base = codiceBaseRic(cod);
      const pesi = { ...(scomponiRicetta(cod)?.pesi || {}) };
      const qRic = (pasto(base)?.ingredienti || []).find(x => x.alimento === c.it.nome)?.qta;
      if (c.q === qRic) delete pesi[c.it.nome]; else pesi[c.it.nome] = c.q;
      parti[c.it.pi] = codiceRicetta(base, pesi);
    }
    codici[si] = codicePasto(parti);
  }
  return codici;
}

const levDiff = (dopo, prima) =>
  ({ kcal: dopo.kcal - prima.kcal, p: dopo.p - prima.p, c: dopo.c - prima.c, g: dopo.g - prima.g });

/**
 * Le combinazioni di porzioni, le migliori e diverse fra loro.
 *
 * Diverse vuol dire con una **leva principale** diversa — l'ingrediente che
 * porta la parte piu' grande dello spostamento. Senza, l'elenco era la stessa
 * idea ("allunga il tofu") con quattro contorni diversi.
 */
function levPorzioni(g, righe, prima, quante = 4) {
  const voci = levPorzioniGiorno(g);
  const cand = levCombina(voci, righe, righe.length)
    .map(s => ({ ...s, stima: levCosto(s.d, righe, s.cambi) }))
    .sort((a, b) => a.stima - b.stima)
    .slice(0, 60);
  const t = righe[0].k;
  const fuori = [], viste = new Set();
  for (const s of cand) {
    const codici = levCodici(g, s.cambi);
    const dopo = levTotali(codici);
    const d = levDiff(dopo, prima);
    s.codici = codici; s.dopo = dopo; s.d = d;
    s.costo = levCosto(d, righe, s.cambi);
    s.buona = levBuona(d, righe);
  }
  cand.sort((a, b) => (b.buona - a.buona) || (a.costo - b.costo));
  /* Quelle che non tengono fermo il resto entrano solo se non ce n'e' nessuna
     che lo fa, e solo se arrivano almeno a meta' strada: "mandarini 80 -> 75"
     in fondo a un elenco per togliere grassi e' rumore, non un'alternativa. */
  const ammessa = cand.some(s => s.buona)
    ? s => s.buona
    : s => Math.sign(s.d[t]) === Math.sign(righe[0].b) && Math.abs(s.d[t]) >= Math.abs(righe[0].b) / 2;
  for (const s of cand) {
    if (!ammessa(s)) continue;
    const leva = s.cambi.reduce((m, c) =>
      Math.abs((c.q - c.it.q0) * c.it.v[t]) > Math.abs((m.q - m.it.q0) * m.it.v[t]) ? c : m);
    const chiave = leva.it.si + '|' + leva.it.nome;
    if (viste.has(chiave)) continue;
    viste.add(chiave);
    fuori.push({ tipo: 'porzione', ...s });
    if (fuori.length >= quante) break;
  }
  return fuori;
}

/* ----------------------------------------------------------- le ricette */

/**
 * Una ricetta al posto di quella di un pasto, ripesata.
 *
 * Le righe qui non sono "zero sugli altri" ma **la differenza fra il pasto di
 * adesso e la ricetta nuova**, piu' lo spostamento chiesto: la ricetta nuova
 * deve fare quello che faceva il pasto vecchio, e in piu' quello che chiedi.
 * Solo sui pasti di una ricetta sola: su un `piu:` sostituire il blocco
 * butterebbe via anche la parte che andava bene.
 */
function levRicette(g, righe, prima, quante = 3) {
  const codici = (g.pasti || []).map(s => s.codice);
  const gia = new Set(codici.map(c => codiceBaseRic(partiPasto(c)[0])));
  const migliori = new Map();
  (g.pasti || []).forEach((s, si) => {
    const parti = partiPasto(s.codice);
    if (parti.length !== 1) return;
    const attuale = pasto(parti[0]);
    if (!attuale) return;
    const mOra = levM(parti[0]);
    for (const code of Object.keys(D.pasti || {})) {
      if (gia.has(code)) continue;
      const alt = pasto(code);
      if (!alt?.ingredienti?.length) continue;
      const mAlt = levM(code);
      const voci = [];
      for (const ing of alt.ingredienti) {
        const v = levPerGrammo(ing.alimento);
        if (!v || !(ing.qta > 0)) continue;
        voci.push({ si, nome: ing.alimento, q0: ing.qta, v,
          unita: alimento(ing.alimento)?.unita || 'g',
          lo: Math.max(5, levArrotonda(ing.qta * LEV_RIC_FONDO)),
          hi: levArrotonda(ing.qta * LEV_RIC_TETTO) });
      }
      const loc = righe.map(r => ({ ...r, b: r.b + (mOra[r.k] || 0) - (mAlt[r.k] || 0) }));
      const sol = [{ cambi: [] }, ...levCombina(voci, loc, loc.length)];
      /* Il momento della giornata non esclude niente — mangiare a colazione
         quello che di solito sta a cena e' una scelta — ma costa un po' e la
         riga lo dice. E' la stessa regola di `pastiEquivalenti()`. */
      const ab = typeof slotAbituale === 'function' ? slotAbituale(code) : '';
      const altrove = ab && ab !== s.slot ? ab : '';
      for (const x of sol) {
        const pesi = {};
        for (const c of x.cambi) pesi[c.it.nome] = c.q;
        const nuovo = codiceRicetta(code, pesi);
        /* il resto del giorno non cambia: si rifa' solo il pasto toccato */
        const dopo = M0();
        addM(addM(addM(dopo, prima), mOra, -1), levM(nuovo));
        for (const k of ['kcal', 'p', 'c', 'g', 'fibre']) dopo[k] = Math.round(dopo[k] * 10) / 10;
        const d = levDiff(dopo, prima);
        const costo = levCosto(d, righe, x.cambi) + 1.5 + (altrove ? 1 : 0);
        const prec = migliori.get(code);
        if (prec && prec.costo <= costo) continue;
        migliori.set(code, {
          tipo: 'ricetta', si, slot: s.slot, codice: nuovo,
          codici: codici.map((c, i) => i === si ? nuovo : c),
          da: attuale.nome || parti[0], a: alt.nome || code, altrove,
          cambi: x.cambi, dopo, d, costo, buona: levBuona(d, righe)
        });
      }
    }
  });
  return [...migliori.values()]
    .filter(x => x.buona)
    .sort((a, b) => a.costo - b.costo)
    .slice(0, quante);
}

/**
 * Tutte le proposte per spostare `id` di `delta` tenendo fermo `fermo`
 * ('altri' = gli altri due macro, 'kcal' = le calorie).
 */
function leveGiorno(gi, id, delta, fermo = 'altri') {
  const g = D.settimana[gi];
  if (!g || !delta) return { porzioni: [], ricette: [], prima: M0() };
  const prima = levTotali((g.pasti || []).map(s => s.codice));
  const righe = levRighe(id, delta, fermo);
  return { prima, righe, porzioni: levPorzioni(g, righe, prima), ricette: levRicette(g, righe, prima) };
}

/** Scrive la proposta nel piano. La prima modifica clona la settimana di base. */
function levApplica(gi, m) {
  const p = piano();
  p.settimana ||= JSON.parse(JSON.stringify(
    S.settings.pianoBase === 'esempio' ? DBASE.settimana : settimanaVuota()));
  const pasti = p.settimana[gi].pasti;
  m.codici.forEach((c, si) => { if (pasti[si] && pasti[si].codice !== c) pasti[si].codice = c; });
  save(); fondiPiano();
}

/**
 * Da dove parte il foglio: il macro piu' lontano dal suo target, e lo
 * spostamento che lo riporta li' (arrotondato al passo del cursore). Se e'
 * tutto in linea, un passo in su delle proteine.
 */
function levPartenza(tot, t) {
  let peggio = null;
  for (const v of LEV_VOCI) {
    if (!(t[v.id] > 0)) continue;
    const d = ((tot[v.id] || 0) - t[v.id]) / t[v.id];
    if (!peggio || Math.abs(d) > Math.abs(peggio.d)) peggio = { v, d };
  }
  const id = peggio ? peggio.v.id : 'p';
  return { id, delta: levDeltaVerso(id, tot, t) };
}

function levDeltaVerso(id, tot, t) {
  const v = levVoce(id);
  const gap = t[id] > 0 ? t[id] - (tot[id] || 0) : 0;
  let d = Math.round(gap / v.passo) * v.passo;
  if (!d) d = gap < 0 ? -v.passo : v.passo;
  return Math.max(-v.max, Math.min(v.max, d));
}

/* ------------------------------------------------------------- il foglio */

const levSegno = (q, dec = 0) => {
  const r = Math.round(Math.abs(q) * 10 ** dec) / 10 ** dec;
  return r === 0 ? '0' : (q > 0 ? '+' : '−') + nf(r, dec);
};

/**
 * Le barre: una per macro, il prima pieno, il dopo chiaro, la tacca del
 * target. Ogni barra e' un bottone — scegliere il macro e vederlo sono la
 * stessa cosa. Sotto, le calorie in una riga: seguono dai tre.
 */
function levBarre(prima, dopo, t, id, scegli) {
  const w = el('div', 'lev-barre');
  for (const v of LEV_VOCI) {
    const a = prima[v.id] || 0, b = dopo[v.id] || 0, tg = t[v.id] || 0;
    const scala = Math.max(tg * 1.3, a * 1.08, b * 1.08, 1);
    const pc = x => (Math.max(0, x) / scala * 100).toFixed(1) + '%';
    const mosso = Math.round(b) !== Math.round(a);
    const r = el('button', 'lev-r');
    r.type = 'button';
    r.setAttribute('aria-pressed', String(v.id === id));
    r.style.setProperty('--col', v.col);
    r.innerHTML = `<span class="lev-n">${v.n}</span>
      <span class="lev-t">
        <i class="lev-a" style="width:${pc(Math.min(a, b))}"></i>
        ${b > a ? `<i class="lev-piu" style="left:${pc(a)};width:${pc(b - a)}"></i>` : ''}
        ${b < a ? `<i class="lev-meno" style="left:${pc(b)};width:${pc(a - b)}"></i>` : ''}
        ${tg ? `<b style="left:${pc(tg)}"></b>` : ''}
      </span>
      <span class="lev-v">${mosso ? `<s>${nf(a)}</s> ${nf(b)}` : nf(a)}<em>g</em></span>`;
    r.onclick = () => scegli(v.id);
    w.append(r);
  }
  const dk = (dopo.kcal || 0) - (prima.kcal || 0);
  w.append(el('div', 'lev-kcal',
    `<span>Calorie</span><span>${Math.abs(dk) >= 1
      ? `${nf(prima.kcal)} → <b>${nf(dopo.kcal)}</b> (${levSegno(dk)})` : `<b>${nf(prima.kcal)}</b>`} kcal${
      t.kcal ? ` <em>· target ${nf(t.kcal)}</em>` : ''}</span>`));
  w.append(el('div', 'leg',
    '<span><i class="lev-sw"></i>adesso</span><span><i class="lev-sw piu"></i>dopo</span>'
    + '<span><i class="lev-sw meno"></i>tolto</span><span><i class="lev-sw tacca"></i>target</span>'));
  return w;
}

/** Lo spostamento di una proposta in una riga: il macro chiesto per primo. */
function levEffetto(m, righe) {
  const [t] = righe;
  const ferme = new Map(righe.slice(1).map(r => [r.k, r]));
  const out = [];
  for (const v of [levVoce(t.k), ...LEV_VOCI.filter(x => x.id !== t.k)]) {
    const d = m.d[v.id] || 0;
    const r = ferme.get(v.id);
    const corto = v.id === t.k && Math.abs(d - t.b) > Math.max(2 * t.tol, Math.abs(t.b) * 0.25);
    const cls = v.id === t.k ? (corto ? 'lev-fatto fuori' : 'lev-fatto')
      : r && Math.abs(d) > 2 * r.tol ? 'fuori' : '';
    out.push(`<span class="${cls}">${levSegno(d)} ${v.l}</span>`);
  }
  const dk = m.d.kcal || 0;
  const rk = ferme.get('kcal');
  out.push(`<span class="${rk && Math.abs(dk) > 2 * rk.tol ? 'fuori' : ''}">${levSegno(dk)} kcal</span>`);
  return out.join('');
}

/** Le righe di cosa cambia, una per quantita'. */
function levCosa(m, g) {
  if (m.tipo === 'ricetta') {
    const pesi = m.cambi.map(c => `${esc(c.it.nome)} ${nf(c.it.q0)} → ${nf(c.q)} ${esc(c.it.unita)}`);
    return `<div class="lev-c"><span class="mt">${esc(m.slot || '')}</span>${esc(m.da)} → <b>${esc(m.a)}</b>${
      m.altrove ? ` <span class="pill">di solito a ${esc(String(m.altrove).toLowerCase())}</span>` : ''}</div>`
      + (pesi.length ? `<div class="lev-c lev-pesi">${pesi.join(' · ')}</div>` : '');
  }
  return m.cambi
    .slice().sort((a, b) => a.it.si - b.it.si)
    .map(c => `<div class="lev-c"><span class="mt">${esc(g.pasti[c.it.si]?.slot || '')}</span>${
      esc(c.it.nome)} ${nf(c.it.q0)} → <b>${nf(c.q)}</b> ${esc(c.it.unita)}</div>`).join('');
}

/**
 * `sheetLeve(gi, id, delta, fermo)` — quale macro, di quanto, e come.
 *
 * Il macro e lo spostamento partono **gia' scelti** su quello che in quel
 * giorno e' piu' fuori, con la prima proposta gia' mostrata nelle barre:
 * aprire il foglio e trovarlo vuoto vorrebbe dire far scegliere prima di aver
 * detto cosa c'e' da scegliere.
 */
function sheetLeve(gi, id, delta, fermo = 'altri') {
  const g = D.settimana[gi];
  if (!g) return;
  const t = D.target || {};
  const tot = levTotali((g.pasti || []).map(s => s.codice));
  if (!id || delta == null) ({ id, delta } = levPartenza(tot, t));
  const voce = levVoce(id);

  const w = el('div');
  w.append(el('h2', 'sec', 'Aggiusta i macro'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted lev-sub', `${esc(capIniziale(g.giorno || ''))} · tocca il macro da cambiare`));

  const assegnati = (g.pasti || []).filter(x => pasto(x.codice)).length;
  if (!assegnati) {
    w.lastChild.textContent = capIniziale(g.giorno || '');
    w.append(el('p', 'muted',
      'Questo giorno non ha ancora nessuna ricetta: non c\'e\' niente da spostare.'));
    const x0 = el('button', 'btn wide', 'Chiudi');
    x0.style.marginTop = '12px';
    x0.onclick = closeSheet;
    w.append(x0);
    sheet(w);
    return;
  }

  const barre = el('div');
  w.append(barre);

  /* --- di quanto --- */
  const cur = el('div', 'field cursore lev-cur');
  cur.innerHTML = `<label><span>${voce.n}</span><b></b></label>
    <input type="range" min="${-voce.max}" max="${voce.max}" step="${voce.passo}" value="${delta}"
      aria-label="Di quanto spostare ${voce.art}, in grammi">
    <div class="estremi"><span>−${voce.max} g</span><span>+${voce.max} g</span></div>`;
  w.append(cur);
  const rng = cur.querySelector('input');
  const lab = cur.querySelector('b');

  /* --- cosa resta fermo --- */
  const seg = el('div', 'seg lev-seg');
  for (const [f, n] of [['altri', 'Altri macro fermi'], ['kcal', 'Calorie ferme']]) {
    const b = el('button', null, n);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(f === fermo));
    b.onclick = () => sheetLeve(gi, id, +rng.value, f);
    seg.append(b);
  }
  w.append(seg);

  const lista = el('div', 'lev-lista');
  w.append(lista);

  const ok = el('button', 'btn pri wide', 'Applica al piano');
  ok.style.marginTop = '14px';
  w.append(ok);
  w.append(el('p', 'note', `Cambia il piano: vale per tutti i ${
    esc(String(g.giorno || 'giorni').toLowerCase())}. Per un giorno solo ci sono le porzioni in Oggi.`));

  const det = el('details', 'fc-det');
  det.append(el('summary', null, '<span>Come sceglie</span>'));
  det.append(el('p', 'note',
    'Ogni ingrediente porta calorie, proteine, carboidrati e grassi per grammo. Per ogni gruppo di '
    + 'uno, due o tre ingredienti del giorno si calcola la variazione che sposta il macro scelto e '
    + 'lascia fermo il resto; si scartano le porzioni sotto un quarto o sopra due volte e mezza, si '
    + 'arrotonda a scatti di 5 g (10 g sopra i 100) e si rifà il conto. In cima quelle che sbagliano '
    + 'meno e toccano meno. Una ricetta nuova entra ripesata tra la metà e il doppio delle sue dosi, '
    + 'per fare quello che faceva il pasto che sostituisce più lo spostamento chiesto.'));
  w.append(det);

  const x = el('button', 'btn wide', 'Chiudi');
  x.style.marginTop = '10px';
  x.onclick = closeSheet;
  w.append(x);

  let scelta = null;
  const scegliMacro = nid => {
    if (nid === id) return;
    sheetLeve(gi, nid, levDeltaVerso(nid, tot, t), fermo);
  };
  const mostra = m => {
    scelta = m;
    barre.innerHTML = '';
    barre.append(levBarre(tot, m ? m.dopo : tot, t, id, scegliMacro));
    ok.disabled = !m;
    lista.querySelectorAll('.lev-p').forEach(b =>
      b.setAttribute('aria-pressed', String(b._m === m)));
  };

  /* Il cursore ridisegna solo l'elenco e le barre: rifare il foglio intero a
     ogni scatto gli toglierebbe il dito di sotto. */
  const calcola = () => {
    const dv = +rng.value;
    lab.textContent = dv ? `${levSegno(dv)} g` : '0 g';
    lista.innerHTML = '';
    if (!dv) {
      lista.append(el('p', 'muted lev-vuoto', 'Sposta il cursore per dire di quanto.'));
      mostra(null);
      return;
    }
    const r = leveGiorno(gi, id, dv, fermo);
    const gruppi = [['Cambiando le quantità', r.porzioni], ['Cambiando una ricetta', r.ricette]];
    const buone = [...r.porzioni, ...r.ricette].filter(m => m.buona);
    if (!buone.length) {
      lista.append(el('p', 'muted lev-vuoto', r.porzioni.length
        ? `Tenendo fermo il resto non ci si arriva: queste sono le più vicine.`
        : `Con le ricette di questo giorno non c'è un modo di spostare ${voce.art} di ${levSegno(dv)} g. `
          + 'Prova uno spostamento più piccolo, o tieni ferme le calorie.'));
    }
    for (const [tit, arr] of gruppi) {
      if (!arr.length) continue;
      lista.append(el('h3', 'lev-h', tit));
      const grp = el('div', 'lev-grp');
      for (const m of arr) {
        const b = el('button', 'lev-p');
        b.type = 'button';
        b._m = m;
        b.innerHTML = `<div class="grow">${levCosa(m, g)}<div class="lev-e">${levEffetto(m, r.righe)}</div></div>
          <span class="lev-ck" aria-hidden="true"></span>`;
        b.onclick = () => mostra(m);
        grp.append(b);
      }
      lista.append(grp);
    }
    mostra(buone[0] || r.porzioni[0] || null);
  };
  rng.oninput = calcola;

  ok.onclick = () => {
    if (!scelta) return;
    levApplica(gi, scelta);
    closeSheet(); route();
    toast(`${capIniziale(g.giorno || 'Giorno')}: ${voce.art} ${levSegno(scelta.d[id])} g`);
  };

  calcola();
  sheet(w);
}
