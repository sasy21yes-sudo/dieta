/* Passi, sonno e peso dal telefono, senza scriverli a mano.
 *
 * PREMESSA ONESTA, perche' e' la domanda che si fa chiunque: non esiste
 * nessuna API web che legga HealthKit. Non su iOS, non su Android. Una
 * pagina web — anche installata sulla schermata Home — non puo' chiedere il
 * conteggio passi al sistema: il permesso non esiste proprio. Chi dice il
 * contrario o ha un'app nativa, o ha un server con OAuth su Fitbit o Garmin.
 *
 * Quello che invece si puo' fare, e che qui e' implementato: un Comando
 * (Shortcuts) legge il dato da Salute e APRE l'app con il valore nell'URL.
 * Il Comando ha i permessi che il browser non ha, e l'automazione lo fa
 * partire da sola a un'ora fissa. Da li' in poi non si tocca niente.
 *
 * Il limite vero: aprire l'URL porta l'app in primo piano. E' il prezzo, e
 * la UI lo dice prima, invece di far scoprire la cosa all'utente.
 */
'use strict';

/** I campi che si possono importare, con il loro nome in Salute. */
const CAMPI_SALUTE = [
  { id: 'passi', lab: 'Passi', sal: 'Passi', dec: 0,
    n: 'Somma dei passi del giorno.' },
  { id: 'sonno', lab: 'Sonno', sal: 'Analisi del sonno', dec: 1, unita: 'ore',
    n: 'Ore dormite. In Salute e\' in minuti: nel Comando dividi per 60.' },
  { id: 'peso', lab: 'Peso', sal: 'Peso corporeo', dec: 1, unita: 'kg',
    n: 'Solo se hai una bilancia che scrive in Salute.' }
];

function paramsHash() {
  const q = location.hash.split('?')[1] || '';
  return new URLSearchParams(q);
}

/**
 * La vista che riceve i dati. Non chiede conferma: il Comando lo hai scritto
 * tu, e una schermata di conferma da toccare ogni sera vanificherebbe tutto
 * il senso dell'automazione. Mostra cosa ha scritto, e si puo' annullare.
 */
function viewImporta(v) {
  const q = paramsHash();
  const k = q.get('data') || today();
  const scritti = [], saltati = [];
  const prima = { ...(S.log[k] || {}) };

  if (k > today()) {
    v.append(el('div', 'card', '<p class="muted">La data e\' nel futuro: non importo niente.</p>'));
    return;
  }

  const d = day(k);
  for (const c of CAMPI_SALUTE) {
    const raw = q.get(c.id);
    if (raw == null || raw === '') continue;
    const n = parseNum(raw.replace(',', '.'));
    if (n == null || !isFinite(n) || n < 0) { saltati.push(c.lab); continue; }
    // un valore assurdo e' quasi sempre un Comando scritto male, non una
    // giornata eccezionale: meglio non scriverlo che sporcare il registro
    const max = { passi: 100000, sonno: 24, peso: 400 }[c.id];
    if (n > max) { saltati.push(`${c.lab} (${nf(n, c.dec)} fuori scala)`); continue; }
    d[c.id] = c.dec ? Math.round(n * 10) / 10 : Math.round(n);
    scritti.push(`${c.lab}: ${nf(d[c.id], c.dec)}${c.unita ? ' ' + c.unita : ''}`);
  }
  if (scritti.length) { S.model.rev = (S.model.rev || 0) + 1; save(); }

  const c = el('div', 'card');
  c.append(el('div', 'eyebrow', 'Importato da Salute · ' + k));
  if (!scritti.length && !saltati.length) {
    c.append(el('div', 'muted',
      'Nell\'indirizzo non c\'era nessun valore. Controlla il Comando: gli servono '
      + 'parametri come <code>?passi=8432</code>.'));
  } else {
    for (const s of scritti) c.append(el('div', 'muted', esc(s)));
    if (saltati.length) c.append(el('div', 'hint', 'Non importati: ' + esc(saltati.join(', '))));
  }
  v.append(c);
  if (typeof osserva === 'function' && scritti.length)
    osserva(c, () => { entrata([...c.children], { passo: 70 }); pulsa(c); });

  const b = el('button', 'btn wide pri', 'Vai a oggi');
  b.onclick = () => { apri('#/oggi'); };
  v.append(b);

  if (scritti.length) {
    const u = el('button', 'btn wide', 'Annulla questo import');
    u.style.marginTop = '8px';
    u.onclick = () => {
      for (const cc of CAMPI_SALUTE)
        if (prima[cc.id] == null) delete S.log[k][cc.id]; else S.log[k][cc.id] = prima[cc.id];
      S.model.rev = (S.model.rev || 0) + 1;
      save(); apri('#/oggi'); toast('Annullato');
    };
    v.append(u);
  }
  v.append(el('p', 'note',
    'Se questa schermata compare da sola tutte le sere, il Comando sta funzionando. '
    + 'Chiudila pure: il dato e\' gia' + '’ salvato.'));
}

/** L'indirizzo da incollare nel Comando, con i segnaposto. */
function urlImport() {
  const base = location.origin + location.pathname;
  return base + '#/importa?data=DATA&passi=PASSI&sonno=SONNO';
}

/** La sezione nelle impostazioni: come si costruisce il Comando. */
function cardSalute() {
  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'Passi e sonno dal telefono'));
  c.lastChild.style.marginTop = '0';
  c.append(el('p', 'muted',
    'Nessuna pagina web puo\' leggere Salute: il permesso non esiste, ne\' su iPhone '
    + 'ne\' su Android. Un <strong>Comando</strong> pero\' quei permessi ce li ha, e puo\' '
    + 'aprire l\'app passandole il numero. Si scrive una volta e poi lavora da solo.'));

  const passi = [
    ['Comandi → nuovo comando', 'Chiamalo come vuoi, per esempio "Passi nella dieta".'],
    ['Trova dati sulla salute', 'Tipo: <strong>Passi</strong>. Filtro: <strong>data e\' oggi</strong>. Ordina per data.'],
    ['Calcola statistiche', 'Operazione: <strong>Somma</strong>. Ripeti la coppia per il sonno se lo vuoi.'],
    ['Testo', 'Incolla l\'indirizzo qui sotto e sostituisci le PAROLE MAIUSCOLE con le variabili del passo prima.'],
    ['Apri URL', 'Usa il testo del passo precedente.'],
    ['Automazione → Ora del giorno', 'Le 23:00 vanno bene. Metti <strong>Esegui immediatamente</strong>, altrimenti ti chiede conferma ogni sera.']
  ];
  const ol = el('div', 'sc-come');
  for (const [i, [t, d]] of passi.entries()) {
    const r = el('div', 'sc-p');
    r.innerHTML = `<span class="n">${i + 1}</span><span class="c"><strong>${t}</strong><br>${d}</span>`;
    ol.append(r);
  }
  c.append(ol);

  const url = urlImport();
  const box = el('div', 'field');
  box.innerHTML = `<label>Indirizzo da incollare</label>
    <input type="text" id="imp-url" readonly value="${esc(url)}">`;
  c.append(box);
  const cp = el('button', 'btn wide', 'Copia l\'indirizzo');
  cp.onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Copiato'); }
    catch { $('#imp-url').select(); toast('Selezionato: copia a mano'); }
  };
  c.append(cp);

  const pr = el('button', 'btn wide');
  pr.style.marginTop = '8px';
  pr.textContent = 'Provalo adesso con 8.432 passi';
  pr.onclick = () => { location.hash = '#/importa?passi=8432'; };
  c.append(pr);

  c.append(el('p', 'note',
    'Il prezzo da pagare: aprire l\'indirizzo porta l\'app in primo piano per un attimo. '
    + 'Non c\'e\' modo di evitarlo senza un server, e un server per contare i passi '
    + 'sarebbe sproporzionato. In cambio non li scrivi piu' + '’.'));
  return c;
}

/** La schermata dedicata: la procedura, e cosa e' arrivato finora. */
function viewSalute(v) {
  v.append(cardSalute());

  const c = el('div', 'card');
  c.append(el('h2', 'sec', 'Ultimi giorni'));
  c.lastChild.style.marginTop = '0';
  c.append(el('div', 'sub', 'Serve a vedere a colpo d\'occhio se il Comando sta scrivendo davvero.'));
  const days = lastDays(today(), 10);
  for (const k of days) {
    const d = S.log[k];
    const r = el('div', 'cmp-r');
    r.innerHTML = `<span class="mono">${k.slice(5)}</span>
      <span class="mono${d?.passi ? '' : ' muted'}">${d?.passi ? nf(d.passi) + ' passi' : 'passi —'}</span>
      <span class="mono${d?.sonno ? '' : ' muted'}">${d?.sonno ? nf(d.sonno, 1) + ' h' : 'sonno —'}</span>`;
    c.append(r);
  }
  v.append(c);
}
