/* Il giorno nel dettaglio: porzioni cambiate solo per oggi, e la scheda che
   raccoglie tutto quello che di quel giorno l'app sa. */
'use strict';

/**
 * Macro di un pasto in un giorno PRECISO.
 * Il piano dice 50 g di salsa; se quel giorno ne hai usati 100, il conto deve
 * seguire te e non il piano. Le porzioni cambiate stanno nel log del giorno,
 * quindi non toccano il pasto per tutti gli altri giorni.
 */
/**
 * Gli ingredienti di un pasto COME SONO STATI QUEL GIORNO.
 *
 * Due strati sopra il piano, tutti e due nel log del giorno e nessuno dei due
 * nel pasto: le quantita' cambiate (`porzioni`) e gli alimenti sostituiti
 * (`swap`). Sono chiavi diverse ma la stessa idea — il piano dice cosa era
 * previsto, il diario dice cos'e' successo, e il secondo non riscrive il primo.
 *
 * Tutti e due sono indicizzati sul nome dell'ingrediente DEL PIANO, anche
 * quando quell'ingrediente e' stato sostituito: quello e' il posto nella
 * ricetta, e non cambia perche' ci hai messo dentro un'altra cosa.
 */
function ingredientiGiorno(code, k) {
  const p = D.pasti[code];
  if (!p?.ingredienti) return [];
  const sw = S.log[k]?.swap?.[code] || {};
  const por = S.log[k]?.porzioni?.[code] || {};
  return p.ingredienti.map(i => {
    const s = sw[i.alimento];
    return {
      slot: i.alimento,                       // il posto nella ricetta
      alimento: s ? s.a : i.alimento,         // quello che c'e' finito davvero
      qta: por[i.alimento] ?? (s ? s.qta : i.qta),
      qtaPiano: i.qta,
      alPostoDi: s ? i.alimento : null
    };
  });
}

function mealMGiorno(code, k) {
  const sw = S.log[k]?.swap?.[code];
  const por = S.log[k]?.porzioni?.[code];
  const p = D.pasti[code];
  const cambiato = (por && Object.keys(por).length) || (sw && Object.keys(sw).length);
  if (!cambiato || !p?.ingredienti) return mealM(code);
  const m = M0();
  for (const i of ingredientiGiorno(code, k)) addM(m, foodM(i.alimento, i.qta));
  for (const x of ['kcal', 'p', 'c', 'g', 'fibre']) m[x] = Math.round(m[x] * 10) / 10;
  return m;
}

/** Quante cose sono state cambiate in quel pasto, quel giorno. */
function porzioniCambiate(code, k) {
  return ingredientiGiorno(code, k)
    .filter(i => i.alPostoDi || i.qta !== i.qtaPiano).length;
}

/** La sostituzione attiva su quell'ingrediente, quel giorno. */
function swapDelGiorno(code, k, slot) { return S.log[k]?.swap?.[code]?.[slot] || null; }

/**
 * Mette (o toglie) una sostituzione, solo per quel giorno.
 *
 * Togliendola sparisce anche la quantita' cambiata di quel posto: erano
 * grammi dell'alimento sostituito, e riportarli sull'originale vorrebbe dire
 * inventarsi una porzione che nessuno ha scelto.
 */
function metteSwap(code, k, slot, nuovo, qta) {
  const d = day(k);
  d.swap ||= {}; d.swap[code] ||= {};
  if (!nuovo) {
    delete d.swap[code][slot];
    if (d.porzioni?.[code]) delete d.porzioni[code][slot];
  } else {
    d.swap[code][slot] = { a: nuovo, qta };
    if (d.porzioni?.[code]) delete d.porzioni[code][slot];
  }
  if (!Object.keys(d.swap[code]).length) delete d.swap[code];
  if (d.porzioni?.[code] && !Object.keys(d.porzioni[code]).length) delete d.porzioni[code];
  save();
}

/* ------------------------------------------------- porzioni di un pasto */
function sheetPorzioni(k, code) {
  const p = D.pasti[code];
  if (!p) return;
  const d = day(k);
  d.porzioni ||= {};
  const stato = { ...(d.porzioni[code] || {}) };

  const w = el('div');
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k));
  w.append(el('h2', 'sec', esc(p.nome || code)));
  w.lastChild.style.marginTop = '0';
  w.append(el('p', 'muted',
    'Cambia le quantita\' solo per questo giorno. Il pasto nel piano resta com\'e\': domani torna alle sue.'));

  /* Scalare tutto insieme e' il caso piu' frequente — "oggi ho mangiato
     mezza porzione" — e farlo ingrediente per ingrediente e' cinque tocchi
     invece di uno. Il moltiplicatore parte sempre dalle quantita' del PIANO,
     non da quelle gia' modificate: altrimenti due tocchi su ×0,5 darebbero
     un quarto, che nessuno si aspetta. */
  const scale = el('div', 'seg');
  scale.style.marginBottom = '10px';
  for (const f of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const b = el('button', null, f === 1 ? 'piano' : '×' + nf(f, f % 1 ? 2 : 0));
    b.onclick = () => {
      for (const i of ingOggi()) {
        const base = i.alPostoDi ? i.qta : i.qtaPiano;
        const n = Math.max(0, Math.round(base * f * 10) / 10);
        if (n === base) delete stato[i.slot]; else stato[i.slot] = n;
      }
      disegna();
      if (typeof pulsa === 'function') pulsa(tot);
    };
    scale.append(b);
  }

  const tot = el('div', 'read');
  const lista = el('div');
  // gli ingredienti di oggi, non quelli del piano: se uno e' stato sostituito
  // le quantita' si contano sull'alimento che c'e' davvero
  const ingOggi = () => ingredientiGiorno(code, k);
  const macroOra = () => {
    const m = M0();
    for (const i of ingOggi()) addM(m, foodM(i.alimento, stato[i.slot] ?? i.qta));
    return m;
  };
  const aggiorna = () => {
    const m = macroOra(), base = p.macro || M0();
    const dk = m.kcal - base.kcal;
    tot.innerHTML = `<span><b>${nf(m.kcal)} kcal</b></span><span>${nf(m.p, 1)} P</span>`
      + `<span>${nf(m.c, 1)} C</span><span>${nf(m.g, 1)} G</span>`
      + `<span>${nf(m.fibre, 1)} fibre</span>`
      + (Math.abs(dk) >= 1 ? `<span>${dk > 0 ? '+' : ''}${nf(dk)} sul piano</span>` : '');
  };
  const disegna = () => {
    lista.innerHTML = '';
    for (const i of ingOggi()) {
      const a = D.alimenti[i.alimento];
      const rif = i.alPostoDi ? i.qta : i.qtaPiano;
      const q = stato[i.slot] ?? i.qta;
      const cambiato = q !== rif;
      const riga = el('div', 'porz' + (cambiato ? ' mod' : ''));
      riga.innerHTML = `<span class="nm">${esc(i.alimento)}
          ${i.alPostoDi ? `<em>al posto di ${esc(i.alPostoDi)}</em>` : ''}
          ${cambiato ? `<em>piano: ${nf(rif)} ${esc(a?.unita || 'g')}</em>` : ''}</span>
        <button class="btn sm" data-d="-10">−</button>
        <input type="text" inputmode="decimal" value="${q}">
        <button class="btn sm" data-d="10">+</button>
        <span class="u">${esc(a?.unita || 'g')}</span>`;
      const inp = riga.querySelector('input');
      const setta = n => {
        n = Math.max(0, Math.round(n * 10) / 10);
        if (n === rif) delete stato[i.slot]; else stato[i.slot] = n;
        inp.value = n;
        riga.classList.toggle('mod', n !== rif);
        const em = riga.querySelector('em.qta');
        if (n !== rif && !em) riga.querySelector('.nm').insertAdjacentHTML('beforeend',
          `<em class="qta">piano: ${nf(rif)} ${esc(a?.unita || 'g')}</em>`);
        if (n === rif && em) em.remove();
        aggiorna();
      };
      riga.querySelectorAll('[data-d]').forEach(b => b.onclick = () =>
        setta((parseNum(inp.value) || 0) + (+b.dataset.d)));
      inp.oninput = () => { const n = parseNum(inp.value); if (n != null && n >= 0) setta(n); };
      lista.append(riga);
    }
    aggiorna();
  };
  disegna();
  w.append(el('div', 'eyebrow', 'Scala tutto il pasto'));
  w.append(scale);
  w.append(lista);
  w.append(tot);

  const salva = el('button', 'btn wide pri', 'Salva per oggi');
  salva.style.marginTop = '12px';
  salva.onclick = () => {
    if (Object.keys(stato).length) d.porzioni[code] = stato;
    else delete d.porzioni[code];
    save(); closeSheet(); route(); toast('Porzioni aggiornate');
  };
  w.append(salva);

  if (Object.keys(d.porzioni[code] || {}).length) {
    const r = el('button', 'btn wide', 'Torna alle quantita del piano');
    r.style.marginTop = '8px';
    r.onclick = () => { delete d.porzioni[code]; save(); closeSheet(); route(); toast('Ripristinate'); };
    w.append(r);
  }
  sheet(w);
}

/* ------------------------------------------------ la giornata in dettaglio */
/** Tutto quello che l'app sa di un giorno, in una scheda sola. */
function sheetGiorno(k) {
  const d = S.log[k], plan = D.settimana[dayIdx(k)];
  const w = el('div');
  const nomi = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
  w.append(el('div', 'eyebrow', k === today() ? 'Oggi' : k === addDays(today(), -1) ? 'Ieri' : k));
  w.append(el('h2', 'sec', nomi[dayIdx(k)][0].toUpperCase() + nomi[dayIdx(k)].slice(1)));
  w.lastChild.style.marginTop = '0';

  if (!d) {
    w.append(el('p', 'muted', 'Di questo giorno non e\' stato registrato niente.'));
    sheet(w); return;
  }

  /* macro */
  const c = consumed(k), t = dayTarget(k);
  const g = el('div', 'cmp');
  g.append(el('div', 'cmp-h', '<span></span><span>Preso</span><span>Target</span><span>Δ</span>'));
  for (const [id, lab, dec] of [['kcal', 'Calorie', 0], ['p', 'Proteine', 0],
                                ['c', 'Carboidrati', 0], ['g', 'Grassi', 0], ['fibre', 'Fibre', 0]]) {
    if (!t[id]) continue;
    const diff = c[id] - t[id];
    g.append(el('div', 'cmp-r',
      `<span>${lab}</span><span class="mono">${nf(c[id], dec)}</span>
       <span class="mono muted">${nf(t[id], dec)}</span>
       <span class="mono ${Math.abs(diff) <= t[id] * 0.08 ? 'good' : ''}">${diff >= 0 ? '+' : ''}${nf(diff, dec)}</span>`));
  }
  w.append(g);

  /* pasti */
  const fatti = (plan.pasti || []).filter(s => d.pasti?.[s.codice]);
  if (fatti.length || (d.extra || []).length) {
    w.append(el('div', 'eyebrow', 'Cosa hai mangiato'));
    w.lastChild.style.marginTop = '14px';
    for (const s of fatti) {
      const p = D.pasti[s.codice]; if (!p) continue;
      const m = mealMGiorno(s.codice, k);
      const nMod = porzioniCambiate(s.codice, k);
      w.append(el('div', 'cmp-r',
        `<span>${esc(p.nome || s.codice)}${nMod ? ` <em class="mod-tag">${nMod} porzion${nMod === 1 ? 'e' : 'i'} cambiat${nMod === 1 ? 'a' : 'e'}</em>` : ''}</span>
         <span class="mono">${nf(m.kcal)}</span><span class="mono muted">${nf(m.p, 0)}P</span><span></span>`));
    }
    for (const e of (d.extra || []))
      w.append(el('div', 'cmp-r',
        `<span>${esc(e.nome)} <em class="mod-tag">fuori piano</em></span>
         <span class="mono">${nf(e.kcal)}</span><span class="mono muted">${nf(e.p, 0)}P</span><span></span>`));
  }

  /* abitudini */
  const ab = [['peso', 'Peso', 'kg', 2], ['acqua', 'Acqua', 'L', 1],
              ['passi', 'Passi', '', 0], ['sonno', 'Sonno', 'h', 1],
              ['coca', 'Coca Zero', 'lattine', 0], ['fame', 'Fame', '/10', 0],
              ['energia', 'Energia', '/10', 0]].filter(x => d[x[0]] != null);
  if (ab.length) {
    w.append(el('div', 'eyebrow', 'Come e andata'));
    w.lastChild.style.marginTop = '14px';
    const q = el('div', 'hx-quote');
    q.style.gridTemplateColumns = 'repeat(3,1fr)';
    q.innerHTML = ab.map(([id, lab, u, dec]) =>
      `<div><span>${lab}</span><b>${nf(d[id], dec)}</b><em>${u}</em></div>`).join('');
    w.append(q);
  }

  /* allenamento */
  const ser = typeof serieDelGiorno === 'function' ? serieDelGiorno(k) : [];
  const hs = S.hyrox?.sessioni?.[k];
  const brucia = typeof kcalAllenamento === 'function' ? kcalAllenamento(k) : { tot: 0, righe: [] };
  if (ser.length || hs?.fatto) {
    w.append(el('div', 'eyebrow', 'Allenamento'));
    w.lastChild.style.marginTop = '14px';
    if (ser.length) {
      const per = {};
      for (const s of ser) (per[s.ex] ||= []).push(s);
      for (const [ex, l] of Object.entries(per))
        w.append(el('div', 'cmp-r',
          `<span>${esc(esercizio(ex)?.nome || ex)}</span>
           <span class="mono">${l.length} serie</span>
           <span class="mono muted">${l.map(x => `${nf(x.kg, 0)}×${x.reps}`).join(' ')}</span><span></span>`));
    }
    if (hs?.fatto) {
      const a = HX?.allenamenti.find(x => x.id === hs.id);
      w.append(el('div', 'cmp-r',
        `<span>${esc(a?.nome || hs.id)}</span><span class="mono">HYROX</span>
         <span class="mono muted">${hs.durata || a?.durata || ''}'</span><span></span>`));
    }
    if (brucia.tot > 0)
      w.append(el('p', 'hint',
        `Spesa stimata ${nf(brucia.tot)} kcal. Non va sommata al target: il dispendio del motore contiene gia' gli allenamenti.`));
  }

  /* sfida e integratori */
  const sf = S.sfide?.log?.[k];
  if (sf) {
    const s = SF?.sfide.find(x => x.id === sf.id);
    w.append(el('div', 'cmp-r',
      `<span>Sfida: ${esc(s?.t || sf.id)}</span>
       <span class="mono ${sf.fatta ? 'good' : ''}">${sf.fatta ? '✓ fatta' : 'saltata'}</span><span></span><span></span>`));
  }
  const integ = Object.keys(d.integratori || {}).filter(x => d.integratori[x]);
  if (integ.length) w.append(el('p', 'hint', 'Integratori: ' + integ.map(esc).join(', ') + '.'));
  const mis = Object.entries(d.misure || {});
  if (mis.length) w.append(el('p', 'hint',
    'Misure: ' + mis.map(([id, v]) => `${esc(id)} ${nf(v, 1)} cm`).join(' · ') + '.'));

  const vai = el('button', 'btn wide pri', 'Apri questo giorno');
  vai.style.marginTop = '14px';
  vai.onclick = () => { viewDate = k; closeSheet(); location.hash = '#/oggi'; route(); };
  w.append(vai);
  sheet(w);
}
