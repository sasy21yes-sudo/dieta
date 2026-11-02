/* Aggiusta i macro di un giorno del piano.
 *
 * **La domanda.** L'editor della settimana dice com'e' un giorno — "mancano
 * 5 g di proteine, 9 g di grassi in piu'" — e poi si ferma. La riga dopo e'
 * *e allora cosa tocco?*, e la risposta giusta quasi mai e' una cosa sola:
 * per alzare le proteine senza toccare il resto si allunga il tofu **e** si
 * toglie un po' di pasta **e** si dimezza l'olio, perche' il tofu porta con se'
 * anche grassi e carboidrati.
 *
 * Qui si dice **di quanto deve muoversi ogni macro** — uno solo, due, o tutti
 * e tre col tocco "Porta a target" — e quelli lasciati a zero restano fermi
 * (o restano ferme le calorie, se lo chiedi). L'app cerca tre tipi di mossa:
 *
 * - **le quantita'**: fino a tre porzioni cambiate nei pasti del giorno, anche
 *   in pasti diversi. Passano dai codici `ric:`/`ali:`, quindi il registro
 *   delle ricette non si muove di un grammo;
 * - **un alimento in piu'**: uno che nel pasto non c'e', preso fra quelli che
 *   compaiono nelle ricette di quel momento della giornata o che hai in
 *   dispensa. Entra come parte `ali:` di un `piu:`, cioe' "pranzo + 20 g di
 *   proteine in polvere", senza toccare la ricetta;
 * - **una ricetta al posto di un'altra, ripesata**: la ricetta nuova entra
 *   con le dosi che le fanno fare quello che faceva il pasto vecchio, piu' lo
 *   spostamento chiesto.
 *
 * Il conto e' un piccolo sistema lineare: ogni ingrediente porta un vettore
 * (kcal, P, C, G per grammo), e per ogni gruppo di uno, due o tre ingredienti
 * si cerca la variazione che da' lo spostamento chiesto e zero su quello che
 * resta fermo. Le soluzioni fuori dai limiti della porzione si scartano, le
 * altre si arrotondano a scatti che si pesano in cucina, si **rifinisce**
 * l'arrotondamento uno scatto alla volta, e si rifanno **coi codici veri**
 * (`levTotali()`): il numero che la riga scrive e' quello che il giorno fara'.
 *
 * Le regole stanno in `S.piano.leve` e valgono per tutti i giorni: pasti e
 * ingredienti da non toccare, le proteine dei pasti principali che non
 * scendono sotto la soglia del piano, le proposte scartate.
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
/* Gli alimenti nuovi che si provano per ogni pasto: i tre che vanno di piu'
   nella direzione chiesta. Provarli tutti allungherebbe il conto di dieci
   volte per proporre, in cima, sempre gli stessi. */
const LEV_NUOVI_PER_PASTO = 3;
/* I pasti a cui si applica la soglia di proteine: gli stessi dell'avviso
   "dose proteica bassa in un pasto". */
const LEV_PRINCIPALI = ['Colazione', 'Pranzo', 'Cena'];

const levVoce = id => LEV_VOCI.find(v => v.id === id) || LEV_VOCI[0];

/** Le regole, con i default. Vivono nel piano: valgono per tutti i giorni. */
function levRegole() {
  const p = piano();
  const r = p.leve ||= {};
  r.pasti ||= [];            // momenti della giornata da non toccare
  r.ingredienti ||= [];      // alimenti da non toccare
  r.scartati ||= [];         // firme delle proposte da non riproporre
  if (r.proteinePasto == null) r.proteinePasto = true;
  return r;
}

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
const levScatto = q => q < 100 ? 5 : 10;

/** Cosa ogni grammo di un alimento porta: kcal, P, C, G. */
function levPerGrammo(nome) {
  const a = alimento(nome);
  if (!a) return null;
  return { kcal: (a.kcal || 0) / 100, p: (a.p || 0) / 100, c: (a.c || 0) / 100, g: (a.g || 0) / 100 };
}

const levDiff = (dopo, prima) =>
  ({ kcal: dopo.kcal - prima.kcal, p: dopo.p - prima.p, c: dopo.c - prima.c, g: dopo.g - prima.g });

/* ------------------------------------------------------------ il sistema */

/**
 * Le righe del sistema. Ogni macro con uno spostamento chiesto ne fa una; i
 * macro a zero ne fanno una con zero (restano fermi) oppure, con le calorie
 * ferme, lasciano il posto a una riga sulle calorie. Ogni riga e' divisa per
 * la sua tolleranza, cosi' un grammo di grassi pesa quanto un grammo e mezzo
 * di proteine e venti calorie.
 */
function levRighe(d, fermo) {
  const r = [];
  for (const v of LEV_VOCI) {
    const b = d[v.id] || 0;
    if (b || fermo !== 'kcal') r.push({ k: v.id, b, tol: v.tol, chiesto: !!b });
  }
  if (fermo === 'kcal' && r.length < LEV_VOCI.length)
    r.push({ k: 'kcal', b: 0, tol: LEV_TOL_KCAL, chiesto: false });
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
 * Per ogni gruppo di al massimo `maxK` voci — e al massimo **un** alimento
 * nuovo — la variazione di quantita' che soddisfa meglio le righe (minimi
 * quadrati pesati; esatta quando le voci sono tante quante le righe). Torna i
 * gruppi che restano dentro i limiti, gia' arrotondati, con lo spostamento
 * **previsto**: quello vero lo calcola chi chiama, coi codici.
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
  const nuove = idx => idx.reduce((s, i) => s + (voci[i].nuovo ? 1 : 0), 0);
  const giro = (da, idx) => {
    if (idx.length) prova(idx);
    if (idx.length >= maxK) return;
    for (let i = da; i < n; i++) {
      const prossimo = [...idx, i];
      if (nuove(prossimo) > 1) continue;
      giro(i + 1, prossimo);
    }
  };
  giro(0, []);
  return fuori;
}

/**
 * Quanto costa una soluzione: quanto sbaglia sulle righe, piu' quante cose
 * cambia e di quanto. A parita' di precisione vince quella che tocca meno, e
 * aggiungere un alimento costa piu' che cambiare una dose: e' una cosa in
 * piu' da comprare e da mangiare.
 */
function levCosto(d, righe, cambi) {
  /* uno spostamento chiesto pesa una volta e mezza: chi chiede +5 g e trova
     +4 se ne accorge, chi trova un grammo di grassi in piu' di solito no */
  let e = 0;
  for (const r of righe) e += (r.chiesto ? 1.5 : 1) * Math.abs((d[r.k] || 0) - r.b) / r.tol;
  let sforzo = 0;
  for (const c of cambi)
    sforzo += c.it.nuovo ? 1 + 0.3 * c.q / c.it.hi : Math.abs(c.q - c.it.q0) / c.it.q0;
  return e + 0.5 * cambi.length + 1.2 * sforzo;
}

/** Buona = ogni spostamento chiesto c'e', e quello che doveva restare fermo e' fermo. */
function levBuona(d, righe) {
  return righe.every(r => r.chiesto
    ? Math.abs((d[r.k] || 0) - r.b) <= Math.max(2 * r.tol, Math.abs(r.b) * 0.25)
    : Math.abs(d[r.k] || 0) <= 2 * r.tol);
}

/* ---------------------------------------------------------- le regole */

/**
 * La firma di una proposta: cosa tocca e in che verso. Scartarne una vuol
 * dire non vedere piu' nessuna proposta che contenga tutta quella firma —
 * la stessa idea con un contorno diverso compresa.
 */
function levFirma(m) {
  if (m.tipo === 'ricetta') return [`ric|${m.slot}|${codiceBaseRic(m.codice)}`];
  return m.cambi.map(c => c.it.nuovo
    ? `+|${c.it.slot}|${c.it.nome}`
    : `${c.q > c.it.q0 ? '↑' : '↓'}|${c.it.slot}|${c.it.nome}`).sort();
}
function levScartata(m, regole) {
  const f = new Set(levFirma(m));
  return regole.scartati.some(s => s.length && s.every(x => f.has(x)));
}

/**
 * La soglia di proteine nei pasti principali: una proposta non porta sotto
 * la soglia un pasto che ci stava, e non toglie proteine a uno che e' gia'
 * sotto. Non obbliga a riparare quelli sotto: e' una regola, non un motore.
 */
function levRispettaProteine(codPrima, codDopo, g, regole) {
  const min = D.target?.min_p_per_pasto;
  if (!regole.proteinePasto || !(min > 0)) return true;
  return (g.pasti || []).every((s, si) => {
    if (codPrima[si] === codDopo[si] || !LEV_PRINCIPALI.includes(s.slot)) return true;
    const a = levM(codPrima[si]).p, b = levM(codDopo[si]).p;
    return b >= min || b >= a - 0.5;
  });
}

/* ---------------------------------------------------------- le porzioni */

/** Le porzioni del giorno che si possono muovere: una per ingrediente per pasto. */
function levPorzioniGiorno(g, regole) {
  const voci = [];
  (g.pasti || []).forEach((s, si) => {
    if (regole.pasti.includes(s.slot)) return;
    partiPasto(s.codice).forEach((cod, pi) => {
      const pa = pasto(cod);
      if (!pa?.ingredienti?.length) return;
      const solo = String(cod).startsWith(PRE_ALI);
      for (const ing of pa.ingredienti) {
        if (regole.ingredienti.includes(ing.alimento)) continue;
        const v = levPerGrammo(ing.alimento);
        const q0 = ing.qta || 0;
        if (!v || !(q0 > 0) || !(v.kcal > 0)) continue;
        voci.push({
          si, pi, solo, nome: ing.alimento, q0, v, slot: s.slot,
          unita: alimento(ing.alimento)?.unita || 'g',
          lo: Math.max(5, levArrotonda(q0 * LEV_FONDO)),
          hi: levArrotonda(q0 * LEV_TETTO)
        });
      }
    });
  });
  return voci;
}

/** Quanto se ne usa di solito: la mediana delle ricette che lo contengono. */
function levDoseTipica(nome) {
  const q = [];
  for (const r of Object.values(D.pasti || {}))
    for (const i of (r.ingredienti || [])) if (i.alimento === nome && i.qta > 0) q.push(i.qta);
  if (q.length) { q.sort((a, b) => a - b); return q[q.length >> 1]; }
  /* mai usato in una ricetta (e' in dispensa): la quantita' che fa cento
     calorie, dentro limiti da cucina */
  const kc = alimento(nome)?.kcal || 0;
  return Math.min(150, Math.max(10, kc > 0 ? levArrotonda(10000 / kc) : 30));
}

/**
 * Gli alimenti che un pasto potrebbe prendere in piu'.
 *
 * Non tutto il catalogo: quelli che compaiono nelle ricette che il piano
 * mette **in quel momento della giornata** (le proteine in polvere stanno
 * allo spuntino, l'olio a pranzo), piu' quelli che hai in dispensa. Di
 * questi, i tre che vanno di piu' nella direzione chiesta — il coseno fra
 * quello che porta un grammo e quello che chiedi, sulle righe pesate.
 */
function levNuoviPasto(g, si, righe, regole) {
  const s = g.pasti[si];
  if (!s || regole.pasti.includes(s.slot)) return [];
  const gia = new Set((pasto(s.codice)?.ingredienti || []).map(i => i.alimento));
  const pool = new Set();
  for (const [code, r] of Object.entries(D.pasti || {})) {
    if (typeof slotAbituale === 'function' && slotAbituale(code) !== s.slot) continue;
    for (const i of (r.ingredienti || [])) pool.add(i.alimento);
  }
  const disp = typeof dispensa === 'function' ? dispensa() : {};
  for (const [n, q] of Object.entries(disp)) if (+q > 0 && D.alimenti?.[n]) pool.add(n);

  const u = righe.map(r => r.b / r.tol);
  const nu = Math.hypot(...u);
  if (!nu) return [];
  const fuori = [];
  for (const nome of pool) {
    if (gia.has(nome) || regole.ingredienti.includes(nome)) continue;
    const v = levPerGrammo(nome);
    if (!v || !(v.kcal > 0)) continue;
    const w = righe.map(r => v[r.k] / r.tol);
    const cos = w.reduce((x, wi, i) => x + wi * u[i], 0) / (Math.hypot(...w) * nu || 1);
    if (cos < 0.3) continue;
    const tip = levDoseTipica(nome);
    fuori.push({ si, nuovo: true, nome, q0: 0, v, slot: s.slot, cos,
      unita: alimento(nome)?.unita || 'g',
      lo: Math.max(5, levArrotonda(tip * 0.25)), hi: Math.max(5, levArrotonda(tip)) });
  }
  return fuori.sort((a, b) => b.cos - a.cos).slice(0, LEV_NUOVI_PER_PASTO);
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
    const aggiunte = [];
    for (const c of cc) {
      if (c.it.nuovo) { aggiunte.push(codiceAlimento(c.it.nome, c.q)); continue; }
      const cod = parti[c.it.pi];
      if (c.it.solo) { parti[c.it.pi] = codiceAlimento(c.it.nome, c.q); continue; }
      const base = codiceBaseRic(cod);
      const pesi = { ...(scomponiRicetta(cod)?.pesi || {}) };
      const qRic = (pasto(base)?.ingredienti || []).find(x => x.alimento === c.it.nome)?.qta;
      if (c.q === qRic) delete pesi[c.it.nome]; else pesi[c.it.nome] = c.q;
      parti[c.it.pi] = codiceRicetta(base, pesi);
    }
    codici[si] = codicePasto([...parti, ...aggiunte]);
  }
  return codici;
}

/** Rifa' una soluzione coi codici veri: totali, spostamento, costo, regole. */
function levValuta(s, g, righe, prima, codPrima, regole) {
  s.codici = levCodici(g, s.cambi);
  s.dopo = levTotali(s.codici);
  s.d = levDiff(s.dopo, prima);
  s.costo = levCosto(s.d, righe, s.cambi);
  s.buona = levBuona(s.d, righe);
  s.regole = levRispettaProteine(codPrima, s.codici, g, regole);
  return s;
}

/**
 * La rifinitura: l'arrotondamento a cinque grammi sposta il risultato, e a
 * volte uno scatto in piu' o in meno su una delle voci lo rimette a posto.
 * Si prova uno scatto per voce, si tiene quello che abbassa il costo, due
 * giri. E' una ricerca locale, non un ottimo: ma costa poco ed e' sul conto
 * vero, non su quello previsto.
 */
function levRifinisci(s, g, righe, prima, codPrima, regole) {
  for (let giro = 0; giro < 2; giro++) {
    let meglio = null;
    s.cambi.forEach((c, i) => {
      for (const verso of [-1, 1]) {
        const q = c.q + verso * levScatto(c.q);
        if (q < c.it.lo || q > c.it.hi || q === c.it.q0) continue;
        const prova = { cambi: s.cambi.map((x, j) => j === i ? { ...x, q } : x) };
        levValuta(prova, g, righe, prima, codPrima, regole);
        if (prova.regole && prova.costo < (meglio || s).costo - 0.01) meglio = prova;
      }
    });
    if (!meglio) break;
    Object.assign(s, meglio);
  }
  return s;
}

/**
 * Le combinazioni di porzioni, le migliori e diverse fra loro, in due elenchi:
 * solo dosi cambiate, e con un alimento in piu'.
 *
 * Diverse vuol dire con una **leva principale** diversa — la voce che porta
 * la parte piu' grande dello spostamento. Senza, l'elenco era la stessa idea
 * ("allunga il tofu") con quattro contorni diversi.
 */
function levPorzioni(g, righe, prima, regole, quante = 3) {
  const codPrima = (g.pasti || []).map(s => s.codice);
  const voci = levPorzioniGiorno(g, regole);
  (g.pasti || []).forEach((_, si) => voci.push(...levNuoviPasto(g, si, righe, regole)));
  const cand = levCombina(voci, righe, righe.length)
    .map(s => ({ ...s, stima: levCosto(s.d, righe, s.cambi) }))
    .sort((a, b) => a.stima - b.stima)
    .slice(0, 80);
  for (const s of cand) levValuta(s, g, righe, prima, codPrima, regole);
  const valide = cand.filter(s => s.regole && !levScartata({ tipo: 'porzione', ...s }, regole));
  valide.sort((a, b) => (b.buona - a.buona) || (a.costo - b.costo));

  /* il peso di una voce sullo spostamento, sulle righe chieste */
  const chieste = righe.filter(r => r.chiesto);
  const pesoLeva = c => chieste.reduce((s, r) => s + Math.abs((c.q - c.it.q0) * c.it.v[r.k]) / r.tol, 0);
  /* Quelle che non arrivano entrano solo se non ce n'e' nessuna che arriva,
     e solo se fanno almeno meta' strada su ogni spostamento chiesto. */
  const ammessa = valide.some(s => s.buona) ? s => s.buona
    : s => chieste.every(r => Math.sign(s.d[r.k]) === Math.sign(r.b) && Math.abs(s.d[r.k]) >= Math.abs(r.b) / 2);

  const elenchi = { porzioni: [], nuovi: [] };
  const viste = new Set();
  for (const s of valide) {
    if (!ammessa(s)) continue;
    const dove = s.cambi.some(c => c.it.nuovo) ? 'nuovi' : 'porzioni';
    if (elenchi[dove].length >= quante) continue;
    const leva = s.cambi.reduce((m, c) => pesoLeva(c) > pesoLeva(m) ? c : m);
    const chiave = dove + '|' + leva.it.si + '|' + leva.it.nome;
    if (viste.has(chiave)) continue;
    viste.add(chiave);
    levRifinisci(s, g, righe, prima, codPrima, regole);
    elenchi[dove].push({ tipo: dove === 'nuovi' ? 'nuovo' : 'porzione', ...s });
  }
  return elenchi;
}

/* ----------------------------------------------------------- le ricette */

/**
 * Una ricetta al posto di quella di un pasto, ripesata.
 *
 * Le righe qui non sono "zero sugli altri" ma **la differenza fra il pasto di
 * adesso e la ricetta nuova**, piu' lo spostamento chiesto. Solo sui pasti di
 * una ricetta sola, non bloccati, e senza ingredienti bloccati: cambiare
 * ricetta li toglierebbe.
 */
function levRicette(g, righe, prima, regole, quante = 3) {
  const codici = (g.pasti || []).map(s => s.codice);
  const gia = new Set(codici.map(c => codiceBaseRic(partiPasto(c)[0])));
  const migliori = new Map();
  (g.pasti || []).forEach((s, si) => {
    if (regole.pasti.includes(s.slot)) return;
    const parti = partiPasto(s.codice);
    if (parti.length !== 1) return;
    const attuale = pasto(parti[0]);
    if (!attuale) return;
    if ((attuale.ingredienti || []).some(i => regole.ingredienti.includes(i.alimento))) return;
    const mOra = levM(parti[0]);
    for (const code of Object.keys(D.pasti || {})) {
      if (gia.has(code)) continue;
      const alt = pasto(code);
      if (!alt?.ingredienti?.length) continue;
      const mAlt = levM(code);
      const voci = [];
      for (const ing of alt.ingredienti) {
        const v = levPerGrammo(ing.alimento);
        if (!v || !(ing.qta > 0) || regole.ingredienti.includes(ing.alimento)) continue;
        voci.push({ si, nome: ing.alimento, q0: ing.qta, v,
          unita: alimento(ing.alimento)?.unita || 'g',
          lo: Math.max(5, levArrotonda(ing.qta * LEV_RIC_FONDO)),
          hi: levArrotonda(ing.qta * LEV_RIC_TETTO) });
      }
      const loc = righe.map(r => ({ ...r, b: r.b + (mOra[r.k] || 0) - (mAlt[r.k] || 0) }));
      const sol = [{ cambi: [] }, ...levCombina(voci, loc, loc.length)];
      /* Il momento della giornata non esclude niente — mangiare a colazione
         quello che di solito sta a cena e' una scelta — ma costa abbastanza
         da passare dopo ogni ricetta di quel momento che funzioni, e la riga
         lo dice. Alla prova, con un costo piccolo, in cima c'era "tofu e
         patate a colazione" davanti al toast salato. */
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
        const costo = levCosto(d, righe, x.cambi) + 1.5 + (altrove ? 4 : 0);
        const prec = migliori.get(code);
        if (prec && prec.costo <= costo) continue;
        const cod2 = codici.map((c, i) => i === si ? nuovo : c);
        const m = {
          tipo: 'ricetta', si, slot: s.slot, codice: nuovo, codici: cod2,
          da: attuale.nome || parti[0], a: alt.nome || code, altrove,
          cambi: x.cambi, dopo, d, costo, buona: levBuona(d, righe)
        };
        if (!levRispettaProteine(codici, cod2, g, regole) || levScartata(m, regole)) continue;
        migliori.set(code, m);
      }
    }
  });
  return [...migliori.values()]
    .filter(x => x.buona)
    .sort((a, b) => a.costo - b.costo)
    .slice(0, quante);
}

/**
 * Tutte le proposte per spostare i macro di `d` ({ p, c, g } in grammi; zero
 * = fermo) tenendo fermo `fermo` ('altri' = i macro a zero, 'kcal' = le
 * calorie). Accetta anche la forma corta `(gi, id, delta, fermo)`.
 */
function leveGiorno(gi, d, fermo = 'altri', x) {
  if (typeof d === 'string') { d = { [d]: fermo }; fermo = x || 'altri'; }
  const g = D.settimana[gi];
  const vuoto = { porzioni: [], nuovi: [], ricette: [], prima: M0(), righe: [] };
  if (!g || !LEV_VOCI.some(v => d[v.id])) return vuoto;
  const regole = levRegole();
  const prima = levTotali((g.pasti || []).map(s => s.codice));
  const righe = levRighe(d, fermo);
  return { prima, righe, ...levPorzioni(g, righe, prima, regole), ricette: levRicette(g, righe, prima, regole) };
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

/** Lo spostamento che porta un macro al target, arrotondato al passo del cursore. */
function levDeltaVerso(id, tot, t, minimo = true) {
  const v = levVoce(id);
  const gap = t[id] > 0 ? t[id] - (tot[id] || 0) : 0;
  let d = Math.round(gap / v.passo) * v.passo;
  if (!d && minimo) d = gap < 0 ? -v.passo : v.passo;
  return Math.max(-v.max, Math.min(v.max, d));
}

/**
 * Da dove parte il foglio: il macro piu' lontano dal suo target, con lo
 * spostamento che lo riporta li', e gli altri fermi. Se e' tutto in linea,
 * un passo in su delle proteine.
 */
function levPartenza(tot, t) {
  let peggio = null;
  for (const v of LEV_VOCI) {
    if (!(t[v.id] > 0)) continue;
    const d = ((tot[v.id] || 0) - t[v.id]) / t[v.id];
    if (!peggio || Math.abs(d) > Math.abs(peggio.d)) peggio = { v, d };
  }
  const id = peggio ? peggio.v.id : 'p';
  return { sel: id, d: { p: 0, c: 0, g: 0, [id]: levDeltaVerso(id, tot, t) }, fermo: 'altri' };
}

/* ------------------------------------------------------------- il foglio */

const levSegno = (q, dec = 0) => {
  const r = Math.round(Math.abs(q) * 10 ** dec) / 10 ** dec;
  return r === 0 ? '0' : (q > 0 ? '+' : '−') + nf(r, dec);
};

/**
 * Le barre: una per macro, il prima pieno, il dopo chiaro, la tacca del
 * target, e sotto il nome lo spostamento chiesto. Ogni barra e' un bottone:
 * scegliere il macro da regolare e vederlo sono la stessa cosa. Sotto, le
 * calorie in una riga: seguono dai tre.
 */
function levBarre(prima, dopo, t, st, scegli) {
  const w = el('div', 'lev-barre');
  for (const v of LEV_VOCI) {
    const a = prima[v.id] || 0, b = dopo[v.id] || 0, tg = t[v.id] || 0;
    const scala = Math.max(tg * 1.3, a * 1.08, b * 1.08, 1);
    const pc = x => (Math.max(0, x) / scala * 100).toFixed(1) + '%';
    const mosso = Math.round(b) !== Math.round(a);
    const dv = st.d[v.id] || 0;
    const stato = dv ? `${levSegno(dv)} g` : st.fermo === 'kcal' ? 'libero' : 'fermo';
    const r = el('button', 'lev-r');
    r.type = 'button';
    r.setAttribute('aria-pressed', String(v.id === st.sel));
    r.style.setProperty('--col', v.col);
    r.innerHTML = `<span class="lev-n">${v.n}<small class="${dv ? 'chiesto' : ''}">${stato}</small></span>
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

/** Lo spostamento di una proposta in una riga: prima i macro chiesti. */
function levEffetto(m, righe) {
  const per = new Map(righe.map(r => [r.k, r]));
  const ordine = [...LEV_VOCI].sort((a, b) => (per.get(b.id)?.chiesto || 0) - (per.get(a.id)?.chiesto || 0));
  const out = [];
  for (const v of ordine) {
    const d = m.d[v.id] || 0, r = per.get(v.id);
    let cls = '';
    if (r?.chiesto) cls = Math.abs(d - r.b) > Math.max(2 * r.tol, Math.abs(r.b) * 0.25) ? 'lev-fatto fuori' : 'lev-fatto';
    else if (r && Math.abs(d) > 2 * r.tol) cls = 'fuori';
    out.push(`<span class="${cls}">${levSegno(d)} ${v.l}</span>`);
  }
  const dk = m.d.kcal || 0, rk = per.get('kcal');
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
  /* raggruppate per pasto: tre righe di colazione sono una colazione */
  const perPasto = new Map();
  for (const c of m.cambi.slice().sort((a, b) => a.it.si - b.it.si || (a.it.nuovo ? 1 : 0) - (b.it.nuovo ? 1 : 0))) {
    if (!perPasto.has(c.it.si)) perPasto.set(c.it.si, []);
    perPasto.get(c.it.si).push(c.it.nuovo
      ? `<span class="lev-add">aggiungi</span> ${esc(c.it.nome)} <b>${nf(c.q)}</b> ${esc(c.it.unita)}`
      : `${esc(c.it.nome)} ${nf(c.it.q0)} → <b>${nf(c.q)}</b> ${esc(c.it.unita)}`);
  }
  return [...perPasto].map(([si, righe]) =>
    `<div class="lev-c"><span class="mt">${esc(g.pasti[si]?.slot || '')}</span>${righe.join('<br>')}</div>`).join('');
}

/** Le regole nel foglio: cosa non toccare, la soglia di proteine, le scartate. */
function levSezRegole(g, st, ridisegna) {
  const regole = levRegole();
  const nBloc = regole.pasti.length + regole.ingredienti.length;
  const det = el('details', 'fc-det lev-reg');
  det.open = !!st.regoleAperte;
  det.ontoggle = () => { st.regoleAperte = det.open; };
  det.append(el('summary', null, `<span>Regole</span><span>${
    nBloc ? `${nBloc} da non toccare` : 'nessun blocco'}</span>`));

  const chip = (lab, on, fai) => {
    const b = el('button', null, esc(lab));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.onclick = () => { fai(); save(); st.regoleAperte = true; ridisegna(); };
    return b;
  };
  const alterna = (arr, x) => { const i = arr.indexOf(x); if (i < 0) arr.push(x); else arr.splice(i, 1); };

  det.append(el('div', 'lev-reg-t', 'Pasti da non toccare'));
  const sp = el('div', 'seg chips');
  for (const s of (g.pasti || []).filter(x => pasto(x.codice)))
    sp.append(chip(s.slot, regole.pasti.includes(s.slot), () => alterna(regole.pasti, s.slot)));
  det.append(sp);

  det.append(el('div', 'lev-reg-t', 'Ingredienti da non toccare'));
  const nomi = new Set(regole.ingredienti);
  for (const s of (g.pasti || [])) for (const i of (pasto(s.codice)?.ingredienti || [])) nomi.add(i.alimento);
  const si = el('div', 'seg chips');
  for (const n of [...nomi].sort())
    si.append(chip(n, regole.ingredienti.includes(n), () => alterna(regole.ingredienti, n)));
  det.append(si);

  const min = D.target?.min_p_per_pasto;
  if (min > 0) {
    det.append(el('div', 'lev-reg-t', 'Proteine'));
    const sr = el('div', 'seg chips');
    sr.append(chip(`Colazione, pranzo e cena non scendono sotto ${nf(min)} g`, regole.proteinePasto,
      () => { regole.proteinePasto = !regole.proteinePasto; }));
    det.append(sr);
  }
  if (regole.scartati.length) {
    const r = el('div', 'lev-reg-sc',
      `<span>${regole.scartati.length === 1 ? 'Una proposta scartata' : regole.scartati.length + ' proposte scartate'}</span>`);
    const b = el('button', 'btn sm', 'Ripristina');
    b.type = 'button';
    b.onclick = () => { regole.scartati = []; save(); st.regoleAperte = true; ridisegna(); };
    r.append(b);
    det.append(r);
  }
  det.append(el('p', 'note', 'Valgono per tutti i giorni del piano.'));
  return det;
}

/**
 * `sheetLeve(gi, st)` — di quanto, e come.
 *
 * `st` e' lo stato del foglio: `{ sel, d: { p, c, g }, fermo }`. Senza, parte
 * dal macro piu' fuori del giorno con la prima proposta gia' nelle barre:
 * aprire il foglio e trovarlo vuoto vorrebbe dire far scegliere prima di aver
 * detto cosa c'e' da scegliere. Accetta anche `(gi, id, delta, fermo)`.
 */
function sheetLeve(gi, st, delta, fermo) {
  const g = D.settimana[gi];
  if (!g) return;
  const t = D.target || {};
  const tot = levTotali((g.pasti || []).map(s => s.codice));
  if (typeof st === 'string')
    st = { sel: st, d: { p: 0, c: 0, g: 0, [st]: delta || levDeltaVerso(st, tot, t) }, fermo: fermo || 'altri' };
  st ||= levPartenza(tot, t);
  const ridisegna = () => sheetLeve(gi, st);

  const w = el('div');
  w.append(el('h2', 'sec', 'Aggiusta i macro'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted lev-sub', `${esc(capIniziale(g.giorno || ''))} · tocca un macro per regolarlo`));

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

  /* --- di quanto, per il macro scelto --- */
  const voce = levVoce(st.sel);
  const cur = el('div', 'field cursore lev-cur');
  cur.innerHTML = `<label><span>${voce.n}</span><b></b></label>
    <input type="range" min="${-voce.max}" max="${voce.max}" step="${voce.passo}" value="${st.d[voce.id] || 0}"
      aria-label="Di quanto spostare ${voce.art}, in grammi">
    <div class="estremi"><span>−${voce.max} g</span><span>fermo</span><span>+${voce.max} g</span></div>`;
  w.append(cur);
  const rng = cur.querySelector('input');
  const lab = cur.querySelector('b');

  /* --- scorciatoie --- */
  const az = el('div', 'lev-az');
  const aTarget = el('button', 'btn sm', 'Porta a target');
  aTarget.type = 'button';
  aTarget.onclick = () => {
    for (const v of LEV_VOCI) st.d[v.id] = levDeltaVerso(v.id, tot, t, false);
    if (!LEV_VOCI.some(v => st.d[v.id])) { toast('Il giorno e\' gia\' a target'); return; }
    st.fermo = 'altri';
    ridisegna();
  };
  const aZero = el('button', 'btn sm', 'Tutti fermi');
  aZero.type = 'button';
  aZero.onclick = () => { st.d = { p: 0, c: 0, g: 0 }; ridisegna(); };
  az.append(aTarget, aZero);
  w.append(az);

  /* --- cosa resta fermo: ha senso solo se qualcosa e' a zero --- */
  const seg = el('div', 'seg lev-seg');
  for (const [f, n] of [['altri', 'Gli altri fermi'], ['kcal', 'Calorie ferme']]) {
    const b = el('button', null, n);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(f === st.fermo));
    b.onclick = () => { st.fermo = f; ridisegna(); };
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

  w.append(levSezRegole(g, st, ridisegna));

  const det = el('details', 'fc-det');
  det.append(el('summary', null, '<span>Come sceglie</span>'));
  det.append(el('p', 'note',
    'Ogni ingrediente porta calorie, proteine, carboidrati e grassi per grammo. Per ogni gruppo di '
    + 'uno, due o tre voci del giorno (al massimo un alimento nuovo) si calcola la variazione che dà '
    + 'gli spostamenti chiesti e lascia fermo il resto; si scartano le porzioni sotto un quarto o sopra '
    + 'due volte e mezza, si arrotonda a scatti di 5 g (10 g sopra i 100), si prova uno scatto in più o '
    + 'in meno per recuperare l\'arrotondamento e si rifà il conto. In cima quelle che sbagliano meno e '
    + 'toccano meno. Gli alimenti nuovi vengono dalle ricette dello stesso momento della giornata e '
    + 'dalla dispensa; una ricetta nuova entra ripesata tra la metà e il doppio delle sue dosi.'));
  w.append(det);

  const x = el('button', 'btn wide', 'Chiudi');
  x.style.marginTop = '10px';
  x.onclick = closeSheet;
  w.append(x);

  const cPiano = typeof controlloPiano === 'function' ? controlloPiano() : null;
  const statoDi = kc => cPiano && typeof statoGiorno === 'function' ? statoGiorno(kc, assegnati, cPiano) : null;
  const statoOra = statoDi(tot.kcal || 0);

  let scelta = null;
  const scegliMacro = id => { if (id !== st.sel) { st.sel = id; ridisegna(); } };
  const mostra = m => {
    scelta = m;
    barre.innerHTML = '';
    barre.append(levBarre(tot, m ? m.dopo : tot, t, st, scegliMacro));
    ok.disabled = !m;
    lista.querySelectorAll('.lev-p').forEach(b =>
      b.firstChild.setAttribute('aria-pressed', String(b._m === m)));
  };

  /* Il cursore ridisegna solo l'elenco e le barre: rifare il foglio intero a
     ogni scatto gli toglierebbe il dito di sotto. */
  const calcola = () => {
    st.d[voce.id] = +rng.value;
    const dv = st.d[voce.id];
    lab.textContent = dv ? `${levSegno(dv)} g` : 'fermo';
    const tutti = LEV_VOCI.every(v => st.d[v.id]);
    seg.hidden = tutti;
    const fermo = tutti ? 'altri' : st.fermo;
    lista.innerHTML = '';
    if (!LEV_VOCI.some(v => st.d[v.id])) {
      lista.append(el('p', 'muted lev-vuoto', 'Sposta il cursore, o tocca "Porta a target".'));
      mostra(null);
      return;
    }
    const r = leveGiorno(gi, st.d, fermo);
    const gruppi = [['Cambiando le quantità', r.porzioni], ['Aggiungendo un alimento', r.nuovi],
                    ['Cambiando una ricetta', r.ricette]];
    const tutte = [...r.porzioni, ...r.nuovi, ...r.ricette];
    const buone = tutte.filter(m => m.buona);
    if (!buone.length) {
      lista.append(el('p', 'muted lev-vuoto', tutte.length
        ? 'Tenendo fermo il resto non ci si arriva: queste sono le più vicine.'
        : 'Con le ricette e le regole di questo giorno non c\'è un modo di farlo. '
          + 'Prova uno spostamento più piccolo, le calorie ferme, o meno blocchi.'));
    }
    for (const [tit, arr] of gruppi) {
      if (!arr.length) continue;
      lista.append(el('h3', 'lev-h', tit));
      const grp = el('div', 'lev-grp');
      for (const m of arr) {
        const riga = el('div', 'lev-p');
        riga._m = m;
        const b = el('button', 'lev-pb');
        b.type = 'button';
        const sg = statoDi(m.dopo.kcal || 0);
        const verdetto = sg && statoOra && sg.stato !== statoOra.stato
          ? ` <span class="pill ${sg.cls}">${esc(sg.eti)}</span>` : '';
        b.innerHTML = `<div class="grow">${levCosa(m, g)}<div class="lev-e">${levEffetto(m, r.righe)}${verdetto}</div></div>
          <span class="lev-ck" aria-hidden="true"></span>`;
        b.onclick = () => mostra(m);
        const no = el('button', 'lev-x', '×');
        no.type = 'button';
        no.title = 'Non propormela più';
        no.setAttribute('aria-label', 'Non propormela più');
        no.onclick = () => {
          levRegole().scartati.push(levFirma(m));
          save();
          toast('Non la propongo più · si ripristina dalle regole');
          calcola();
        };
        riga.append(b, no);
        grp.append(riga);
      }
      lista.append(grp);
    }
    mostra(buone[0] || tutte[0] || null);
  };
  rng.oninput = calcola;

  ok.onclick = () => {
    if (!scelta) return;
    levApplica(gi, scelta);
    closeSheet(); route();
    toast(`${capIniziale(g.giorno || 'Giorno')}: ${LEV_VOCI.filter(v => st.d[v.id])
      .map(v => `${levSegno(scelta.d[v.id])} g di ${v.n.toLowerCase()}`).join(', ')}`);
  };

  calcola();
  sheet(w);
}
