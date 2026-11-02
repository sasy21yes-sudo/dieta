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
function levArrotonda(q, pezzo) {
  if (pezzo > 0) return Math.max(pezzo, Math.round(q / pezzo) * pezzo);
  return q < 100 ? Math.round(q / 5) * 5 : Math.round(q / 10) * 10;
}
const levScatto = (q, pezzo) => pezzo > 0 ? pezzo : q < 100 ? 5 : 10;
/* Un alimento che si compra a pezzi (planted da 150 g, tempeh da 75) si muove
   di pezzi interi: fra uno e il doppio di quelli di partenza, mai a meta'. */
const levPezzo = nome => +alimento(nome)?.pezzo > 0 ? +alimento(nome).pezzo : 0;

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
      const qr = Math.min(Math.max(levArrotonda(q, it.pezzo), it.lo), it.hi);
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
        const pezzo = levPezzo(ing.alimento);
        voci.push({
          si, pi, solo, nome: ing.alimento, q0, v, slot: s.slot, pezzo,
          unita: alimento(ing.alimento)?.unita || 'g',
          lo: pezzo ? pezzo : Math.max(5, levArrotonda(q0 * LEV_FONDO)),
          hi: pezzo ? Math.max(pezzo, Math.ceil(q0 / pezzo) * pezzo * 2) : levArrotonda(q0 * LEV_TETTO)
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
    const pezzo = levPezzo(nome);
    fuori.push({ si, nuovo: true, nome, q0: 0, v, slot: s.slot, cos, pezzo,
      unita: alimento(nome)?.unita || 'g',
      lo: pezzo || Math.max(5, levArrotonda(tip * 0.25)), hi: pezzo || Math.max(5, levArrotonda(tip)) });
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
        const q = c.q + verso * levScatto(c.q, c.it.pezzo);
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
  const escluse = cand.filter(s => s.buona && !s.regole).length;
  const valide = cand.filter(s => s.regole && !levScartata({ tipo: 'porzione', ...s }, regole));
  valide.sort((a, b) => (b.buona - a.buona) || (a.costo - b.costo));

  /* il peso di una voce sullo spostamento, sulle righe chieste */
  const chieste = righe.filter(r => r.chiesto);
  const pesoLeva = c => chieste.reduce((s, r) => s + Math.abs((c.q - c.it.q0) * c.it.v[r.k]) / r.tol, 0);
  /* Quelle che non arrivano entrano solo se non ce n'e' nessuna che arriva,
     e solo se fanno almeno meta' strada su ogni spostamento chiesto. */
  const ammessa = valide.some(s => s.buona) ? s => s.buona
    : s => chieste.every(r => Math.sign(s.d[r.k]) === Math.sign(r.b) && Math.abs(s.d[r.k]) >= Math.abs(r.b) / 2);

  const elenchi = { porzioni: [], nuovi: [], escluse };
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
  const escluse = new Set();
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
        const pezzo = levPezzo(ing.alimento);
        voci.push({ si, nome: ing.alimento, q0: ing.qta, v, pezzo,
          unita: alimento(ing.alimento)?.unita || 'g',
          lo: pezzo || Math.max(5, levArrotonda(ing.qta * LEV_RIC_FONDO)),
          hi: pezzo ? Math.max(pezzo, Math.ceil(ing.qta / pezzo) * pezzo * 2) : levArrotonda(ing.qta * LEV_RIC_TETTO) });
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
        if (levScartata(m, regole)) continue;
        if (!levRispettaProteine(codici, cod2, g, regole)) { if (m.buona) escluse.add(code); continue; }
        migliori.set(code, m);
      }
    }
  });
  const out = [...migliori.values()]
    .filter(x => x.buona)
    .sort((a, b) => a.costo - b.costo)
    .slice(0, quante);
  /* quante ricette sono rimaste fuori **solo** per la regola delle proteine */
  out.escluse = [...escluse].filter(c => !migliori.has(c)).length;
  return out;
}

/**
 * Tutte le proposte per spostare i macro di `d` ({ p, c, g } in grammi; zero
 * = fermo) tenendo fermo `fermo` ('altri' = i macro a zero, 'kcal' = le
 * calorie). Accetta anche la forma corta `(gi, id, delta, fermo)`.
 */
function leveGiorno(gi, d, fermo = 'altri', x) {
  if (typeof d === 'string') { d = { [d]: fermo }; fermo = x || 'altri'; }
  const g = D.settimana[gi];
  const vuoto = { porzioni: [], nuovi: [], ricette: [], prima: M0(), righe: [], escluse: 0 };
  if (!g || !LEV_VOCI.some(v => d[v.id])) return vuoto;
  const regole = levRegole();
  const prima = levTotali((g.pasti || []).map(s => s.codice));
  const righe = levRighe(d, fermo);
  const por = levPorzioni(g, righe, prima, regole), ric = levRicette(g, righe, prima, regole);
  /* Quante proposte buone la regola delle proteine ha tolto: il foglio lo
     dice. Alla prova, con grassi −10 il mercoledi' restavano solo due ricette
     e nessuna spiegazione — le combinazioni migliori toglievano il burro
     d'arachidi a una colazione gia' sotto i 25 g. */
  return { prima, righe, porzioni: por.porzioni, nuovi: por.nuovi, ricette: ric,
           escluse: por.escluse + (ric.escluse || 0) };
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
  return { d: { p: 0, c: 0, g: 0, [id]: levDeltaVerso(id, tot, t) }, fermo: 'altri' };
}

/* ------------------------------------------------------------- il foglio
 *
 * Il foglio si legge dall'alto in basso come una domanda e la sua risposta:
 *
 * 1. **Quanto cambiare**: una riga per macro, con il suo − / + accanto. Nella
 *    stessa riga il numero di adesso, quello di dopo e la barra col target —
 *    il grafico e il comando sono la stessa cosa, e non c'e' niente da
 *    "selezionare" prima di poterlo regolare. La prima versione aveva le
 *    barre che facevano da selettore e un cursore solo che regolava quella
 *    scelta: alla prova, "confusionario".
 * 2. **Come farlo**: un elenco solo, al massimo cinque, il migliore in cima e
 *    gia' scelto. Che sia una dose, un alimento in piu' o un'altra ricetta lo
 *    dice una pastiglia, non tre titoli. La proposta scelta si apre e porta i
 *    suoi due bottoni: applica, o non propormela piu'.
 * 3. In fondo, chiuse, le regole ("Cosa non toccare") e "Come sceglie".
 */

const levSegno = (q, dec = 0) => {
  const r = Math.round(Math.abs(q) * 10 ** dec) / 10 ** dec;
  return r === 0 ? '0' : (q > 0 ? '+' : '−') + nf(r, dec);
};

/** Una riga per macro: nome, adesso → dopo, target, la barra e il suo − / +. */
function levRigaMacro(v, prima, dopo, t, st, cambia) {
  const a = prima[v.id] || 0, b = dopo[v.id] || 0, tg = t[v.id] || 0;
  const scala = Math.max(tg * 1.3, a * 1.08, b * 1.08, 1);
  const pc = x => (Math.max(0, x) / scala * 100).toFixed(1) + '%';
  const mosso = Math.round(b) !== Math.round(a);
  const dv = st.d[v.id] || 0;
  const stato = dv ? `${levSegno(dv)} g` : st.fermo === 'kcal' ? 'libero' : 'uguale';
  const r = el('div', 'lev-m');
  r.style.setProperty('--col', v.col);
  r.innerHTML = `<div class="lev-m-h">
      <div class="lev-m-l"><span class="lev-m-n">${v.n}</span>
        <span class="lev-m-v">${mosso ? `${nf(a)} → <b>${nf(b)}</b>` : `<b>${nf(a)}</b>`} g${
          tg ? ` <em>· target ${nf(tg)}</em>` : ''}</span></div>
      <output class="lev-m-d${dv ? ' on' : ''}">${stato}</output>
      <span class="lev-step">
        <button type="button" aria-label="${v.n}: meno">−</button><button type="button" aria-label="${v.n}: più">+</button>
      </span>
    </div>
    <div class="lev-t" aria-hidden="true">
      <i class="lev-a" style="width:${pc(Math.min(a, b))}"></i>
      ${b > a ? `<i class="lev-piu" style="left:${pc(a)};width:${pc(b - a)}"></i>` : ''}
      ${b < a ? `<i class="lev-meno" style="left:${pc(b)};width:${pc(a - b)}"></i>` : ''}
      ${tg ? `<b style="left:${pc(tg)}"></b>` : ''}
    </div>`;
  const [meno, piu] = r.querySelectorAll('.lev-step button');
  meno.disabled = dv <= -v.max;
  piu.disabled = dv >= v.max;
  meno.onclick = () => cambia(v.id, dv - v.passo);
  piu.onclick = () => cambia(v.id, dv + v.passo);
  return r;
}

/**
 * Lo spostamento di una proposta in una riga. Si scrivono i macro chiesti,
 * e degli altri solo quelli che si muovono di almeno un grammo: "0 G" ripetuto
 * sotto ogni proposta era rumore da leggere per scoprire che non diceva niente.
 */
function levEffetto(m, righe) {
  const per = new Map(righe.map(r => [r.k, r]));
  const ordine = [...LEV_VOCI].sort((a, b) => (per.get(b.id)?.chiesto || 0) - (per.get(a.id)?.chiesto || 0));
  const out = [];
  for (const v of ordine) {
    const d = m.d[v.id] || 0, r = per.get(v.id);
    if (r?.chiesto) {
      const corto = Math.abs(d - r.b) > Math.max(2 * r.tol, Math.abs(r.b) * 0.25);
      out.push(`<span class="lev-fatto${corto ? ' fuori' : ''}">${levSegno(d)} ${v.l}</span>`);
    } else if (Math.abs(d) >= 1) {
      out.push(`<span class="${r && Math.abs(d) > 2 * r.tol ? 'fuori' : ''}">${levSegno(d)} ${v.l}</span>`);
    }
  }
  const dk = m.d.kcal || 0, rk = per.get('kcal');
  out.push(`<span class="${rk && Math.abs(dk) > 2 * rk.tol ? 'fuori' : ''}">${levSegno(dk)} kcal</span>`);
  return out.join('');
}

/** Cosa cambia, raggruppato per pasto: tre righe di colazione sono una colazione. */
function levCosa(m, g) {
  if (m.tipo === 'ricetta') {
    const pesi = m.cambi.map(c => `${esc(c.it.nome)} ${nf(c.it.q0)} → ${nf(c.q)} ${esc(c.it.unita)}`);
    return `<div class="lev-c"><span class="mt">${esc(m.slot || '')}</span>${esc(m.da)} → <b>${esc(m.a)}</b>${
      m.altrove ? ` <span class="pill">di solito a ${esc(String(m.altrove).toLowerCase())}</span>` : ''}${
      pesi.length ? `<span class="lev-pesi">con ${pesi.join(' · ')}</span>` : ''}</div>`;
  }
  const perPasto = new Map();
  for (const c of m.cambi.slice().sort((a, b) => a.it.si - b.it.si || (a.it.nuovo ? 1 : 0) - (b.it.nuovo ? 1 : 0))) {
    if (!perPasto.has(c.it.si)) perPasto.set(c.it.si, []);
    perPasto.get(c.it.si).push(c.it.nuovo
      ? `<span class="lev-add">+</span> ${esc(c.it.nome)} <b>${nf(c.q)} ${esc(c.it.unita)}</b>`
      : `${esc(c.it.nome)} ${nf(c.it.q0)} → <b>${nf(c.q)} ${esc(c.it.unita)}</b>`);
  }
  return [...perPasto].map(([si, righe]) =>
    `<div class="lev-c"><span class="mt">${esc(g.pasti[si]?.slot || '')}</span>${righe.join('<br>')}</div>`).join('');
}

/** "Cosa non toccare": pasti, ingredienti, la soglia di proteine, le scartate. */
function levSezRegole(g, st, ridisegna) {
  const regole = levRegole();
  const nBloc = regole.pasti.length + regole.ingredienti.length;
  const det = el('details', 'fc-det lev-reg');
  det.open = !!st.regoleAperte;
  det.ontoggle = () => { st.regoleAperte = det.open; };
  det.append(el('summary', null, `<span>Cosa non toccare</span><span>${
    nBloc ? (nBloc === 1 ? '1 blocco' : nBloc + ' blocchi') : 'niente'}</span>`));

  const cambia = fai => { fai(); save(); st.regoleAperte = true; ridisegna(); };
  const chip = (lab, on, fai) => {
    const b = el('button', null, esc(lab));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.onclick = () => cambia(fai);
    return b;
  };
  const alterna = (arr, x) => { const i = arr.indexOf(x); if (i < 0) arr.push(x); else arr.splice(i, 1); };

  det.append(el('div', 'lev-reg-t', 'Pasti'));
  const sp = el('div', 'seg chips');
  for (const s of (g.pasti || []).filter(x => pasto(x.codice)))
    sp.append(chip(s.slot, regole.pasti.includes(s.slot), () => alterna(regole.pasti, s.slot)));
  det.append(sp);

  det.append(el('div', 'lev-reg-t', 'Ingredienti'));
  const nomi = new Set(regole.ingredienti);
  for (const s of (g.pasti || [])) for (const i of (pasto(s.codice)?.ingredienti || [])) nomi.add(i.alimento);
  const si = el('div', 'seg chips');
  for (const n of [...nomi].sort())
    si.append(chip(n, regole.ingredienti.includes(n), () => alterna(regole.ingredienti, n)));
  det.append(si);

  const min = D.target?.min_p_per_pasto;
  if (min > 0) det.append(levInterruttore(`Almeno ${nf(min)} g di proteine a colazione, pranzo e cena`,
    'Un pasto che ci arriva non scende sotto; uno che non ci arriva non perde proteine.',
    regole.proteinePasto, () => cambia(() => { regole.proteinePasto = !regole.proteinePasto; })));

  if (regole.scartati.length) {
    const r = el('div', 'lev-reg-sc',
      `<span>${regole.scartati.length === 1 ? 'Una proposta scartata' : regole.scartati.length + ' proposte scartate'}</span>`);
    const b = el('button', 'lev-link', 'Ripristina');
    b.type = 'button';
    b.onclick = () => cambia(() => { regole.scartati = []; });
    r.append(b);
    det.append(r);
  }
  det.append(el('p', 'note', 'Valgono per tutti i giorni del piano.'));
  return det;
}

/** Un interruttore di iOS in una riga: titolo, una riga sotto, il bottone a destra. */
function levInterruttore(tit, sotto, on, fai) {
  const b = el('button', 'lev-tg' + (on ? ' on' : ''));
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  b.innerHTML = `<span class="body"><span class="t">${esc(tit)}</span><span class="d">${esc(sotto)}</span></span>
    <span class="mod-sw" aria-hidden="true"><i></i></span>`;
  b.onclick = fai;
  return b;
}

/**
 * `sheetLeve(gi, st)` — quanto cambiare, e come.
 *
 * `st` e' lo stato del foglio: `{ d: { p, c, g }, fermo }`. Senza, parte dal
 * macro piu' fuori del giorno con la prima proposta gia' scelta: aprire il
 * foglio e trovarlo vuoto vorrebbe dire far scegliere prima di aver detto
 * cosa c'e' da scegliere. Accetta anche `(gi, id, delta, fermo)`.
 */
function sheetLeve(gi, st, delta, fermo) {
  const g = D.settimana[gi];
  if (!g) return;
  const t = D.target || {};
  const tot = levTotali((g.pasti || []).map(s => s.codice));
  if (typeof st === 'string')
    st = { d: { p: 0, c: 0, g: 0, [st]: delta || levDeltaVerso(st, tot, t) }, fermo: fermo || 'altri' };
  st ||= levPartenza(tot, t);

  const w = el('div');
  w.append(el('h2', 'sec', 'Aggiusta i macro'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted lev-sub', `${esc(capIniziale(g.giorno || ''))} · ${nf(tot.kcal)} kcal`));

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

  const cPiano = typeof controlloPiano === 'function' ? controlloPiano() : null;
  const statoDi = kc => cPiano && typeof statoGiorno === 'function' ? statoGiorno(kc, assegnati, cPiano) : null;
  const statoOra = statoDi(tot.kcal || 0);

  const corpo = el('div');
  w.append(corpo);
  w.append(levSezRegole(g, st, () => sheetLeve(gi, st)));
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

  /* Il conto si rifa' solo quando cambia la domanda; scegliere una proposta
     ridisegna e basta. */
  let ris = null, proposte = [], scelta = null;
  const chiesto = () => LEV_VOCI.some(v => st.d[v.id]);
  const modo = () => LEV_VOCI.every(v => st.d[v.id]) ? 'altri' : st.fermo;
  const calcola = () => {
    ris = chiesto() ? leveGiorno(gi, st.d, modo()) : null;
    /* due per tipo, poi tutte insieme per costo: cosi' una dose, un alimento
       e una ricetta si vedono anche quando uno dei tre vince sempre */
    proposte = ris ? [...ris.porzioni.slice(0, 2), ...ris.nuovi.slice(0, 2), ...ris.ricette.slice(0, 2)]
      .sort((a, b) => (b.buona - a.buona) || (a.costo - b.costo)).slice(0, 5) : [];
    scelta = proposte.find(m => m.buona) || proposte[0] || null;
  };
  const cambia = (id, dv) => { st.d[id] = dv; calcola(); disegna(); };

  const disegna = () => {
    corpo.innerHTML = '';

    /* --- quanto cambiare --- */
    const h = el('div', 'lev-hh');
    h.append(el('h3', 'lev-h', 'Quanto cambiare'));
    const lk = el('span', 'lev-links');
    const aT = el('button', 'lev-link', 'Porta a target');
    aT.type = 'button';
    aT.onclick = () => {
      for (const v of LEV_VOCI) st.d[v.id] = levDeltaVerso(v.id, tot, t, false);
      if (!chiesto()) { toast('Il giorno e\' gia\' a target'); return; }
      calcola(); disegna();
    };
    lk.append(aT);
    if (chiesto()) {
      const aZ = el('button', 'lev-link', 'Azzera');
      aZ.type = 'button';
      aZ.onclick = () => { st.d = { p: 0, c: 0, g: 0 }; calcola(); disegna(); };
      lk.append(aZ);
    }
    h.append(lk);
    corpo.append(h);

    const grp = el('div', 'lev-grp');
    const dopo = scelta ? scelta.dopo : tot;
    for (const v of LEV_VOCI) grp.append(levRigaMacro(v, tot, dopo, t, { ...st, fermo: modo() }, cambia));
    const dk = (dopo.kcal || 0) - (tot.kcal || 0);
    grp.append(el('div', 'lev-kcal',
      `<span>Calorie</span><span>${Math.abs(dk) >= 1
        ? `${nf(tot.kcal)} → <b>${nf(dopo.kcal)}</b>` : `<b>${nf(tot.kcal)}</b>`} kcal${
        t.kcal ? ` <em>· target ${nf(t.kcal)}</em>` : ''}</span>`));
    corpo.append(grp);
    corpo.append(el('div', 'leg lev-leg',
      '<span><i class="lev-sw"></i>adesso</span><span><i class="lev-sw piu"></i>in più</span>'
      + '<span><i class="lev-sw meno"></i>in meno</span><span><i class="lev-sw tacca"></i>target</span>'));

    /* "Calorie ferme" ha senso solo se qualcosa e' su "uguale" e qualcosa no */
    if (chiesto() && modo() === st.fermo && LEV_VOCI.some(v => !st.d[v.id])) {
      const tg = el('div', 'lev-grp lev-grp-tg');
      tg.append(levInterruttore('Calorie ferme',
        st.fermo === 'kcal' ? 'I macro liberi si spostano per tenere le calorie dove sono.'
          : 'Accesa, i macro su "uguale" possono muoversi per tenere ferme le calorie.',
        st.fermo === 'kcal', () => { st.fermo = st.fermo === 'kcal' ? 'altri' : 'kcal'; calcola(); disegna(); }));
      corpo.append(tg);
    }

    /* --- come farlo --- */
    corpo.append(el('h3', 'lev-h', 'Come farlo'));
    if (!chiesto()) {
      corpo.append(el('p', 'muted lev-vuoto', 'Usa − e + accanto a un macro, oppure "Porta a target".'));
      return;
    }
    /* la regola delle proteine ha tolto delle proposte: si dice, e si puo'
       spegnere da qui senza andare a cercarla */
    if (ris.escluse && levRegole().proteinePasto) {
      /* senza numero: le escluse sono varianti della stessa idea, e "10
         proposte escluse" prometteva dieci alternative che non ci sono */
      const r = el('div', 'lev-escl', `<span>Ce ne sono altre, escluse perché toglierebbero proteine
        a un pasto principale sotto i ${nf(D.target.min_p_per_pasto)} g.</span>`);
      const b = el('button', 'lev-link', 'Mostrale');
      b.type = 'button';
      b.onclick = () => { levRegole().proteinePasto = false; save(); toast('Regola delle proteine spenta'); sheetLeve(gi, st); };
      r.append(b);
      corpo.append(r);
    }
    if (!proposte.length) {
      corpo.append(el('p', 'muted lev-vuoto',
        'Con le ricette e le regole di questo giorno non c\'è un modo di farlo. '
        + 'Prova uno spostamento più piccolo, le calorie ferme, o meno blocchi.'));
      return;
    }
    if (!proposte.some(m => m.buona))
      corpo.append(el('p', 'muted lev-vuoto', 'Tenendo fermo il resto non ci si arriva: queste sono le più vicine.'));
    corpo.append(el('p', 'note lev-dove', `Cambia il piano di tutti i ${
      esc(String(g.giorno || 'giorni').toLowerCase())}. Per un giorno solo ci sono le porzioni in Oggi.`));

    const lista = el('div', 'lev-grp');
    for (const m of proposte) {
      const on = m === scelta;
      const card = el('div', 'lev-p' + (on ? ' on' : ''));
      const b = el('button', 'lev-pb');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      const tag = m.tipo === 'nuovo' ? '<span class="pill">alimento in più</span>'
        : m.tipo === 'ricetta' ? '<span class="pill">altra ricetta</span>' : '';
      const sg = statoDi(m.dopo.kcal || 0);
      const verdetto = sg && statoOra && sg.stato !== statoOra.stato
        ? `<span class="pill ${sg.cls}">${esc(sg.eti)}</span>` : '';
      b.innerHTML = `<div class="grow">${levCosa(m, g)}
          <div class="lev-e">${levEffetto(m, ris.righe)}${tag}${verdetto}</div></div>
        <span class="lev-ck" aria-hidden="true"></span>`;
      b.onclick = () => { if (!on) { scelta = m; disegna(); } };
      card.append(b);
      if (on) {
        const az = el('div', 'lev-pa');
        const ok = el('button', 'btn pri sm', 'Applica al piano');
        ok.type = 'button';
        ok.onclick = () => {
          levApplica(gi, m);
          closeSheet(); route();
          toast(`${capIniziale(g.giorno || 'Giorno')}: ${LEV_VOCI.filter(v => st.d[v.id])
            .map(v => `${levSegno(m.d[v.id])} g di ${v.n.toLowerCase()}`).join(', ')}`);
        };
        const no = el('button', 'lev-link', 'Non propormela più');
        no.type = 'button';
        no.onclick = () => {
          levRegole().scartati.push(levFirma(m));
          save();
          toast('Scartata · si ripristina da "Cosa non toccare"');
          calcola(); disegna();
        };
        az.append(ok, no);
        card.append(az);
      }
      lista.append(card);
    }
    corpo.append(lista);
  };

  calcola();
  disegna();
  sheet(w);
}
