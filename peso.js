/* Quello che rende il peso una misura utilizzabile.
 *
 * Due cose lo sporcano in modo sistematico, e nessuna delle due e' grasso:
 *
 * 1. LE PESATE ANOMALE. Un sabato di pizza e sale, un dito sulla bilancia
 *    sbagliata, un 76,5 battuto al posto di 67,5. Il peso di tendenza e' una
 *    media di sette pesate: una sola sbagliata di 2 kg la sposta di 0,3 kg, e
 *    quei 0,3 kg attraverso il bilancio energetico diventano 165 kcal al
 *    giorno di dispendio inventato. Il filtro di Kalman ci crede.
 * 2. IL CICLO MESTRUALE. In fase luteale la ritenzione idrica vale
 *    tipicamente da mezzo chilo a due. Su una finestra di quattordici giorni
 *    che parte in follicolare e finisce in luteale, quell'acqua entra nel
 *    conto esattamente come entrerebbe il grasso.
 *
 * La risposta a entrambe non e' cancellare il dato: e' non farlo entrare
 * nella TENDENZA, dirlo all'utente, e lasciargli l'ultima parola.
 */
'use strict';

/* ======================================================= pesate anomale */

const mediana = v => {
  const a = v.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = a.length >> 1;
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
};

/**
 * Scarto assoluto mediano, riportato alla scala di una deviazione standard.
 * Il fattore 1.4826 e' quello che rende MAD e sigma la stessa cosa su dati
 * normali. Si usa la mediana e non la media proprio perche' la media e' il
 * bersaglio del problema: un valore anomalo alza la media E alza lo scarto,
 * e finisce per giustificarsi da solo.
 */
function mad(v) {
  const m = mediana(v);
  if (m == null) return null;
  const s = mediana(v.map(x => Math.abs(x - m)));
  return s == null ? null : s * 1.4826;
}

/** Le pesate attorno a un giorno, dentro una finestra di +/- 5 giorni. */
function pesateVicine(k, raggio = 5) {
  const out = [];
  for (let i = -raggio; i <= raggio; i++) {
    const d = addDays(k, i), w = S.log[d]?.peso;
    if (w != null) out.push({ k: d, w });
  }
  return out;
}

/**
 * Questa pesata e' fuori scala rispetto alle sue vicine?
 *
 * Tre cautele, tutte volute:
 * - servono almeno cinque pesate intorno, altrimenti non c'e' un "solito"
 *   con cui confrontarla e si finirebbe a segnalare la seconda misura in
 *   assoluto;
 * - la soglia non scende mai sotto 1,2 kg, perche' l'oscillazione giornaliera
 *   fra acqua e contenuto intestinale e' reale e non va chiamata errore;
 * - il giudizio si puo' ribaltare a mano. Se l'utente dice che e' giusta, e'
 *   giusta: e' il suo corpo, non il nostro modello.
 */
function pesataAnomala(k) {
  const w = S.log[k]?.peso;
  if (w == null) return null;
  if (S.log[k].pesoOk) return null;               // confermata a mano
  const vicine = pesateVicine(k).filter(x => x.k !== k);
  if (vicine.length < 5) return null;
  const vals = vicine.map(x => x.w);
  const m = mediana(vals), s = mad(vals);
  if (m == null || s == null) return null;
  const soglia = Math.max(1.2, 3 * s);
  const scarto = w - m;
  if (Math.abs(scarto) <= soglia) return null;
  return { k, peso: w, atteso: m, scarto, soglia, sigma: s };
}

/** Tutte le anomalie ancora in piedi, dalla piu' recente. */
function pesateAnomale(entro = 120) {
  const k0 = addDays(today(), -entro);
  return Object.keys(S.log).filter(d => d >= k0 && S.log[d]?.peso != null).sort().reverse()
    .map(pesataAnomala).filter(Boolean);
}

/**
 * Il peso di tendenza, ripulito.
 * Si scartano le pesate anomale e si fa la media delle altre. Se dopo lo
 * scarto ne restano meno di tre si torna a usarle tutte: meglio una tendenza
 * un po' sporca che una tendenza costruita su due numeri.
 */
function trendWRobusto(k = today(), n = 7) {
  const vals = [], scartate = [];
  for (let i = 0; i < n * 2 && vals.length < n; i++) {
    const d = addDays(k, -i), w = S.log[d]?.peso;
    if (w == null) continue;
    if (pesataAnomala(d)) { scartate.push(d); continue; }
    vals.push(w);
  }
  if (vals.length >= 3) return { peso: avg(vals), n: vals.length, scartate };
  // ripiego: la finestra grezza, come faceva prima
  const grezzi = [];
  for (let i = 0; i < n * 2 && grezzi.length < n; i++) {
    const w = S.log[addDays(k, -i)]?.peso;
    if (w != null) grezzi.push(w);
  }
  return { peso: grezzi.length ? avg(grezzi) : null, n: grezzi.length, scartate: [] };
}

/** La carta che chiede conferma. Non accusa: chiede. */
function cardPesataAnomala(k = today()) {
  const a = pesataAnomala(k);
  if (!a) return null;
  const su = a.scarto > 0;
  const c = el('div', 'card anomala');
  c.append(el('div', 'eyebrow', 'Pesata fuori scala'));
  c.append(el('div', 'muted',
    `Oggi ${nf(a.peso, 1)} kg, contro i ${nf(a.atteso, 1)} kg attorno a cui ti muovevi: `
    + `${su ? '+' : ''}${nf(a.scarto, 1)} kg in un colpo. `
    + (su
      ? 'Un chilo e mezzo di grasso in un giorno non esiste — sono 11.500 kcal. '
        + 'Di solito e\' sale, carboidrati o l\'intestino.'
      : 'Un calo cosi\' rapido e\' quasi sempre acqua, non grasso.')));
  c.append(el('div', 'hint',
    'L\'ho lasciata nel diario ma tenuta fuori dalla tendenza, perche\' altrimenti '
    + 'sposterebbe anche la stima del dispendio. Se e\' giusta, dimmelo e la rimetto dentro.'));
  const r = el('div', 'row');
  r.style.cssText = 'gap:8px;margin-top:10px';
  const ok = el('button', 'btn', 'E\' giusta, tienila');
  ok.onclick = () => {
    S.log[k].pesoOk = true; S.model.rev = (S.model.rev || 0) + 1;
    save(); route(); toast('Rimessa nella tendenza');
  };
  const fix = el('button', 'btn', 'Correggila');
  fix.onclick = () => { location.hash = '#/diario'; };
  r.append(ok, fix);
  c.append(r);
  return c;
}

/* ======================================================= ciclo mestruale */

const FASI = [
  { id: 'mestruale', n: 'Mestruale', da: 1, a: 5,
    d: 'Il peso di solito scende: l\'acqua trattenuta nei giorni prima se ne va.' },
  { id: 'follicolare', n: 'Follicolare', da: 6, a: 13,
    d: 'La settimana in cui il peso e\' piu\' pulito. E\' il momento buono per leggere la tendenza.' },
  { id: 'ovulatoria', n: 'Ovulatoria', da: 14, a: 16,
    d: 'Possibile un piccolo rialzo di acqua a meta\' ciclo.' },
  { id: 'luteale', n: 'Luteale', da: 17, a: 99,
    d: 'Ritenzione idrica tipica fra mezzo chilo e due. Non e\' grasso e se ne va da sola.' }
];

const cicloAttivo = () => !!S.settings?.ciclo?.attivo && !!S.settings.ciclo.ultimoInizio;

/** A che giorno del ciclo siamo, e in che fase. */
function faseCiclo(k = today()) {
  const c = S.settings?.ciclo;
  if (!cicloAttivo()) return null;
  const dur = Math.max(21, Math.min(40, +c.durata || 28));
  const d = Math.round((new Date(k) - new Date(c.ultimoInizio)) / 864e5);
  if (d < 0) return null;
  const giorno = (d % dur) + 1;
  const f = FASI.find(x => giorno >= x.da && giorno <= x.a) || FASI[FASI.length - 1];
  return { giorno, dur, fase: f.id, nome: f.n, d: f.d, ciclo: Math.floor(d / dur) + 1 };
}

/**
 * Di quanto va allargata l'incertezza di una finestra del filtro.
 *
 * Se la finestra comincia e finisce nella stessa fase, l'acqua del ciclo si
 * elide e non c'e' niente da correggere. Se invece attraversa il confine fra
 * follicolare e luteale, dentro c'e' fino a un chilo e mezzo di acqua che il
 * bilancio energetico leggerebbe come grasso: su quattordici giorni fa oltre
 * ottocento kcal al giorno di errore. Non si prova a sottrarla — quanta sia
 * non lo sappiamo — si dice al filtro di fidarsi molto meno di quella
 * osservazione, che e' esattamente cio' per cui un filtro di Kalman esiste.
 */
function inflazioneCiclo(k, span) {
  if (!cicloAttivo()) return 1;
  const a = faseCiclo(addDays(k, -span)), b = faseCiclo(k);
  if (!a || !b) return 1;
  const acquosa = f => f === 'luteale' || f === 'mestruale';
  if (acquosa(a.fase) === acquosa(b.fase)) return 1;
  return 2.5;
}

/** Riga informativa per Diario e Corpo. */
function cardCiclo(k = today()) {
  const f = faseCiclo(k);
  const c = el('div', 'card ciclo');
  c.append(el('div', 'row between',
    `<strong>Ciclo</strong><span class="mono muted" style="font-size:11px">${
      f ? 'giorno ' + f.giorno + ' di ' + f.dur : 'non impostato'}</span>`));
  if (f) {
    const barra = el('div', 'cic-barra');
    for (const x of FASI) {
      const w = (Math.min(x.a, f.dur) - x.da + 1) / f.dur * 100;
      const seg = el('div', 'cic-s' + (x.id === f.fase ? ' on' : ''));
      seg.style.width = w + '%';
      seg.title = x.n;
      barra.append(seg);
    }
    const cur = el('div', 'cic-cur');
    cur.style.left = ((f.giorno - .5) / f.dur * 100) + '%';
    barra.append(cur);
    c.append(barra);
    c.append(el('div', 'muted', `<strong>${esc(f.nome)}</strong> — ${esc(f.d)}`));
    if (f.fase === 'luteale' || f.fase === 'mestruale')
      c.append(el('div', 'hint',
        'In questi giorni la bilancia parla di acqua piu\' che di grasso. Il motore lo '
        + 'sa: sulle finestre che attraversano il cambio di fase si fida meno di quello '
        + 'che legge, invece di fingere che il chilo in piu\' sia arrivato mangiando.'));
  } else {
    c.append(el('div', 'muted',
      'Se lo imposti, l\'app smette di leggere come grasso l\'acqua della fase luteale — '
      + 'che sul peso vale fino a due chili e che il bilancio energetico, da solo, '
      + 'non sa distinguere.'));
  }
  const b = el('button', 'btn wide', f ? 'Aggiorna' : 'Imposta il ciclo');
  b.style.marginTop = '10px';
  b.onclick = sheetCiclo;
  c.append(b);
  return c;
}

function sheetCiclo() {
  const c = S.settings.ciclo || { attivo: false, ultimoInizio: today(), durata: 28 };
  const w = el('div');
  w.append(el('div', 'eyebrow', 'Solo su questo telefono'));
  w.append(el('h2', 'sec', 'Ciclo mestruale'));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Serve a una cosa sola: non far scambiare al motore di previsione l\'acqua '
    + 'della fase luteale per grasso messo su. Il dato resta in questo telefono, '
    + 'come tutto il resto — non c\'e\' nessun server a cui mandarlo.'));
  w.append(el('div', 'field',
    `<label>Primo giorno dell'ultimo ciclo</label>
     <input type="date" id="ci-dal" value="${esc(c.ultimoInizio || today())}">`));
  w.append(el('div', 'field',
    `<label>Durata media in giorni</label>
     <input type="text" inputmode="numeric" id="ci-dur" value="${c.durata || 28}">`));
  w.append(el('p', 'hint',
    'Se la durata varia, metti la media: il calcolo serve a capire in che fase sei, '
    + 'non a prevedere una data.'));

  const salva = el('button', 'btn wide pri', 'Salva');
  salva.onclick = () => {
    S.settings.ciclo = { attivo: true, ultimoInizio: $('#ci-dal').value || today(),
                         durata: Math.max(21, Math.min(40, parseNum($('#ci-dur').value) || 28)) };
    S.model.rev = (S.model.rev || 0) + 1;      // le finestre vanno ricalcolate
    save(); closeSheet(); route(); toast('Salvato');
  };
  w.append(salva);

  if (cicloAttivo()) {
    const off = el('button', 'btn wide', 'Disattiva e dimentica');
    off.style.marginTop = '8px';
    off.onclick = () => {
      delete S.settings.ciclo;
      S.model.rev = (S.model.rev || 0) + 1;
      save(); closeSheet(); route();
    };
    w.append(off);
  }
  sheet(w);
}
