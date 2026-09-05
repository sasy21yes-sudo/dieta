/* ======================================================= l'assistente
 *
 * La nuvoletta e il foglio che apre. `ai.js` sa **comporre** una domanda e
 * **validare** una risposta; questo file e' l'unico posto da cui quella
 * domanda si fa, e non sa niente di prompt ne' di schemi.
 *
 * Tre cose lo disegnano.
 *
 * **1. Il periodo e' un presupposto, non una domanda.** "Come sta andando"
 * senza dire da quando a quando non e' una domanda: la stessa richiesta fatta
 * oggi e fra un mese direbbe cose diverse senza che si veda perche'. La riga
 * del periodo sta quindi in cima, sempre, e non e' un selettore nuovo — passa
 * da `periodoAndamento()`, cioe' lo stesso periodo della scheda Andamento.
 * Due stati per lo stesso concetto sono l'errore gia' pagato una volta con il
 * PDF del resoconto, e non ne serve un terzo qui.
 *
 * **2. Si tocca, non si scrive.** Le tre domande che uno si fa davvero — il
 * piano regge? come sta andando? cosa non va? — sono tre bottoni che dicono
 * gia' cosa guarderanno. Il campo libero resta, in fondo, per tutto il resto:
 * e' l'ordine di un'assistenza, non di una chat.
 *
 * **3. Non c'e' un trasporto, e non si finge che ci sia.** Al posto della
 * risposta l'assistente consegna **la domanda gia' scritta**, con dentro i
 * numeri del periodo, da copiare e incollare dove si vuole. E' l'unica cosa
 * onesta che puo' fare adesso, ed e' anche utile: il lavoro vero di `ai.js`
 * e' comporre quel testo, non spedirlo.
 */

/** Acceso? E' un modulo come gli altri, e nasce spento: non e' configurato. */
const aiAcceso = () => moduli().ai === true;

/* Lo stato vive quanto il foglio: e' un segnaposto, e conservare una
   conversazione che nessuno ha davvero avuto vorrebbe dire riproporla domani
   come se fosse successo qualcosa. */
let assMsg = [];
let assPan = null, assVel = null;

/* ------------------------------------------------------------- i disegni
 * Due icone sole, ricopiate come tutte le altre (niente CDN: l'app funziona
 * offline). La scintilla e' quella che ovunque vuol dire "modello": una
 * stella a quattro punte grande e una piccola. */
function assIcona(nome) {
  const d = {
    scintilla: ['M12 2.6l1.9 5.1a4 4 0 0 0 2.4 2.4l5.1 1.9-5.1 1.9a4 4 0 0 0-2.4 2.4'
      + 'L12 21.4l-1.9-5.1a4 4 0 0 0-2.4-2.4L2.6 12l5.1-1.9a4 4 0 0 0 2.4-2.4z',
      'M18.6 2.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z'],
    invia: ['M4.5 12h15', 'M13 5.5l6.5 6.5L13 18.5'],
    piano: ['M5 3.6h14v16.8H5z', 'M8.4 8h7.2', 'M8.4 12h7.2', 'M8.4 16h4.2'],
    curva: ['M3.6 17.4L9 11.4l3.6 3 6.8-7.8', 'M15.6 6.6h3.8v3.8'],
    avviso: ['M12 3.4L21 19.4H3z', 'M12 9.6v4.2', 'M12 16.6h.01'],
    scatto: ['M3.2 8.4a2 2 0 0 1 2-2h1.6l1.4-2h7.6l1.4 2h1.6a2 2 0 0 1 2 2v8.4'
      + 'a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2z', 'M12 15.6a3.4 3.4 0 1 0 0-6.8'
      + 'a3.4 3.4 0 0 0 0 6.8z'],
    galleria: ['M3.4 5.6h17.2v12.8H3.4z', 'M3.4 15l4.6-4.4 3.4 3.2 3.8-3.6 5.4 5',
      'M8.6 9.4h.01']
  }[nome] || [];
  const pieno = nome === 'scintilla';
  const s = mk('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true',
    fill: pieno ? 'currentColor' : 'none',
    stroke: pieno ? 'none' : 'currentColor', 'stroke-width': 1.8,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  for (const p of d) s.append(mk('path', { d: p }));
  return s;
}

/* ------------------------------------------------------------ la nuvoletta
 *
 * Si sposta ovunque, e alla fine si **appoggia al lato piu' vicino**: una
 * pastiglia lasciata a meta' schermo copre il contenuto e non si capisce se
 * e' finita li' apposta. La posizione sta in percentuale, non in pixel, o
 * ruotando il telefono finirebbe fuori dallo schermo.
 */
const ASS_MARG = 12;
function assPos() {
  S.settings ||= {};
  S.settings.aiPos ||= { lato: 'destra', y: 0.72 };
  return S.settings.aiPos;
}

function assCollocaFab(f) {
  const p = assPos();
  const alto = 56;
  /* i due estremi verticali sono la topbar e la tab bar: la nuvoletta non
     deve mai finire sopra una voce di menu */
  const su = 64 + ASS_MARG, giu = 66 + ASS_MARG;
  const h = Math.max(120, innerHeight - su - giu - alto);
  f.style.top = Math.round(su + p.y * h) + 'px';
  if (p.lato === 'sinistra') { f.style.left = ASS_MARG + 'px'; f.style.right = 'auto'; }
  else { f.style.right = ASS_MARG + 'px'; f.style.left = 'auto'; }
}

function montaAssistente() {
  const gia = document.getElementById('ai-fab');
  if (!aiAcceso()) { if (gia) gia.remove(); return; }
  if (gia) { assCollocaFab(gia); return; }

  const f = el('button', 'ai-fab');
  f.id = 'ai-fab';
  f.type = 'button';
  f.title = 'Assistente';
  f.setAttribute('aria-label', 'Apri l’assistente');
  f.append(assIcona('scintilla'));
  assCollocaFab(f);
  document.body.append(f);
  if (typeof motionOk !== 'function' || motionOk()) {
    f.classList.add('luce');
    setTimeout(() => f.classList.remove('luce'), 1600);
  }

  /* Pointer events e non il drag-and-drop dell'HTML5, che su iOS col dito non
     parte proprio: e' la stessa scelta gia' fatta per riordinare i pasti. */
  let giu = null;
  f.addEventListener('pointerdown', ev => {
    const r = f.getBoundingClientRect();
    giu = { x: ev.clientX, y: ev.clientY, dx: ev.clientX - r.left,
            dy: ev.clientY - r.top, t: Date.now(), mosso: false };
    f.setPointerCapture(ev.pointerId);
  });
  f.addEventListener('pointermove', ev => {
    if (!giu) return;
    if (!giu.mosso) {
      if (Math.hypot(ev.clientX - giu.x, ev.clientY - giu.y) < 6) return;
      giu.mosso = true;
      f.classList.add('muovo');
    }
    const x = Math.min(Math.max(ev.clientX - giu.dx, ASS_MARG), innerWidth - 56 - ASS_MARG);
    const y = Math.min(Math.max(ev.clientY - giu.dy, 64 + ASS_MARG),
      innerHeight - 56 - 66 - ASS_MARG);
    f.style.left = x + 'px'; f.style.right = 'auto'; f.style.top = y + 'px';
  });
  const su = ev => {
    if (!giu) return;
    const era = giu; giu = null;
    try { f.releasePointerCapture(ev.pointerId); } catch {}
    if (!era.mosso) { assApri(); return; }
    f.classList.remove('muovo');
    // appoggiarsi al lato piu' vicino, e ricordarselo in percentuale
    const r = f.getBoundingClientRect();
    const p = assPos();
    p.lato = (r.left + r.width / 2) < innerWidth / 2 ? 'sinistra' : 'destra';
    const alto = 64 + ASS_MARG, basso = innerHeight - 66 - ASS_MARG - 56;
    p.y = Math.min(Math.max((r.top - alto) / Math.max(1, basso - alto), 0), 1);
    save();
    assCollocaFab(f);
  };
  f.addEventListener('pointerup', su);
  f.addEventListener('pointercancel', su);
  addEventListener('resize', () => { if (!giu) assCollocaFab(f); });
}

/* ---------------------------------------------------------------- il foglio */

function assChiudi() {
  if (assPan) { assPan.classList.remove('on'); const p = assPan; setTimeout(() => p.remove(), 220); }
  if (assVel) { assVel.classList.remove('on'); const v = assVel; setTimeout(() => v.remove(), 220); }
  assPan = assVel = null;
  document.removeEventListener('keydown', assEsc);
}
function assEsc(e) { if (e.key === 'Escape') assChiudi(); }

function assApri() {
  if (assPan) { assChiudi(); return; }
  /* Chiudendo, il pannello resta nel DOM per i 220 ms della dissolvenza. Chi
     riapre subito si ritroverebbe due `.ai-pan`: quello vecchio, che sta
     sparendo, e' il primo che `querySelector` incontra — e da fuori sembra un
     pannello che non si aggiorna. Si buttano i resti prima di cominciare. */
  document.querySelectorAll('.ai-pan,.ai-vel').forEach(x => x.remove());
  assVel = el('div', 'ai-vel');
  assVel.onclick = assChiudi;
  document.body.append(assVel);

  assPan = el('div', 'ai-pan');
  assPan.setAttribute('role', 'dialog');
  assPan.setAttribute('aria-modal', 'true');
  assPan.setAttribute('aria-label', 'Assistente');

  const cap = el('div', 'ai-cap');
  const sp = el('span', 'sp'); sp.append(assIcona('scintilla'));
  cap.append(sp);
  cap.append(el('div', 'tt', '<b>Assistente</b><span>non e’ ancora collegato a nessun modello</span>'));
  const x = el('button', 'ai-x', '✕');
  x.setAttribute('aria-label', 'Chiudi');
  x.onclick = assChiudi;
  cap.append(x);
  assPan.append(cap);

  const barra = el('div', 'ai-perbar');
  assPerApert = false;
  assPeriodo(barra);
  assPan.append(barra);

  const corpo = el('div', 'ai-corpo');
  corpo.id = 'ai-corpo';
  assPan.append(corpo);
  assDisegna(corpo);

  /* La barra di scrittura sta fuori dal corpo che scorre: e' l'unica cosa
     che si vuole avere sempre sotto il pollice. */
  const comp = el('div', 'ai-comp');
  const ta = el('textarea');
  ta.rows = 1;
  ta.placeholder = 'Oppure scrivi la tua domanda…';
  ta.setAttribute('aria-label', 'La tua domanda');
  const inv = el('button', 'ai-inv');
  inv.type = 'button';
  inv.disabled = true;
  inv.setAttribute('aria-label', 'Manda la domanda');
  inv.append(assIcona('invia'));
  ta.oninput = () => {
    inv.disabled = !ta.value.trim();
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
  };
  const manda = () => {
    const t = ta.value.trim();
    if (!t) return;
    ta.value = ''; ta.style.height = 'auto'; inv.disabled = true;
    assChiedi('domandaLibera', t);
  };
  inv.onclick = manda;
  ta.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manda(); }
  };
  comp.append(ta, inv);
  assPan.append(comp);
  assPan.append(el('p', 'ai-nota',
    'Fuori dal telefono non esce niente: qui la domanda si compone e basta. '
    + 'Il contesto contiene profilo, target e numeri gia’ aggregati del '
    + 'periodo — mai il diario giorno per giorno.'));

  document.body.append(assPan);
  requestAnimationFrame(() => { assVel.classList.add('on'); assPan.classList.add('on'); });
  document.addEventListener('keydown', assEsc);
}

/**
 * Il periodo, appeso sotto la testata e **fuori da quello che scorre**.
 *
 * E' il presupposto di ogni domanda qui dentro, e la prima versione lo
 * metteva in cima al corpo: bastava una risposta perche' scorresse via, e da
 * quel momento la conversazione parlava di un tratto che non si vedeva piu'.
 * Chiuso e' una riga sola; si apre solo quando lo si vuole cambiare.
 */
let assPerApert = false;
function assPeriodo(host) {
  host.innerHTML = '';
  const per = revPeriodoAttivo();

  const r = el('div', 'ai-per');
  r.innerHTML = `<span class="et">Periodo</span>`
    + `<b>${esc(revEtichetta(per))}</b>`
    + `<span class="sp2"></span><span class="mono">${per.n} gg</span>`;
  const ap = el('button', null, assPerApert ? 'chiudi' : 'cambia');
  ap.type = 'button';
  ap.setAttribute('aria-expanded', String(assPerApert));
  ap.onclick = () => { assPerApert = !assPerApert; assPeriodo(host); };
  r.append(ap);
  host.append(r);
  if (!assPerApert) return;

  const pre = el('div', 'ai-pre');
  for (const [lab, n] of [['Settimana', null], ['30 giorni', 30], ['90 giorni', 90]]) {
    const b = el('button', null, lab);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(n == null ? !!per.settimana
      : (!per.settimana && per.n === n)));
    b.onclick = () => {
      if (n == null) periodoAndamento(null, null);
      else periodoAndamento(addDays(today(), -(n - 1)), today(), n);
      assPeriodo(host);
    };
    pre.append(b);
  }
  host.append(pre);

  const dd = el('div', 'ai-date');
  const i1 = el('input'), i2 = el('input');
  for (const [i, v, lab] of [[i1, per.da, 'Dal giorno'], [i2, per.a, 'Al giorno']]) {
    i.type = 'date'; i.value = v; i.max = today();
    i.setAttribute('aria-label', lab);
  }
  const cambia = () => {
    if (i1.value && i2.value) { periodoAndamento(i1.value, i2.value); assPeriodo(host); }
  };
  i1.onchange = cambia; i2.onchange = cambia;
  dd.append(i1, i2);
  host.append(dd);
  host.append(el('p', 'ai-nota',
    'E’ lo stesso periodo della scheda Andamento: cambiarlo qui lo cambia '
    + 'anche li’, cosi’ i grafici e la domanda parlano dello stesso tratto.'));
}

/**
 * Cosa manca per rispondere davvero, detto **prima** di chiedere.
 *
 * Segnalato leggendo una risposta: *"non essendo presente un obiettivo
 * dichiarato, non si puo' dire se questa direzione sia verso o lontano
 * dall'obiettivo"*. Era vera, ed era colpa di qui: la domanda partiva senza
 * dire che quel pezzo mancava, e chi la faceva lo scopriva dalla risposta.
 *
 * E' la stessa regola del resto dell'app — il registro va per primo in ogni
 * resoconto, e una media su pochi giorni si dichiara invece di consegnarla
 * come se fosse una misura. Ogni riga porta anche **dove si sistema**: un
 * avviso che non dice come uscirne e' un avviso che si impara a ignorare.
 */
function assMancanze() {
  const out = [];
  const per = revPeriodoAttivo();

  if (typeof obiettivoAttivo === 'function' && !obiettivoAttivo())
    out.push({ t: 'Non hai dichiarato un obiettivo',
      d: 'Senza, la direzione si legge solo rispetto al dispendio: nessuno '
        + 'puo\' dire se stai andando verso o lontano da qualcosa.',
      dove: 'Scegli l\u2019obiettivo', tab: 'target' });

  if (!(D.target?.kcal > 0))
    out.push({ t: 'Manca il target giornaliero',
      d: 'E\u2019 il metro con cui l\u2019app giudica ogni giornata: senza, non '
        + 'c\u2019e\u2019 niente con cui confrontare le medie del periodo.',
      dove: 'Imposta il target', tab: 'target' });

  /* Il registro: la riga che in ogni resoconto viene per prima, perche' tutto
     il resto vale quanto vale lei. */
  if (typeof statRegistro === 'function') {
    const r = statRegistro(per);
    if (r.giorni && r.registrati < Math.max(3, r.giorni / 2))
      out.push({ t: `Registro incompleto: ${r.registrati} `
          + `giorn${r.registrati === 1 ? 'o' : 'i'} su ${r.giorni}`,
        d: 'Le medie del periodo escono da quei giorni, e su cosi\u2019 pochi '
          + 'dicono piu\u2019 di quello che hai avuto voglia di scrivere che di '
          + 'come mangi.' });
    else if (r.giorni && r.pesate < r.giorni / 3)
      out.push({ t: `Poche pesate: ${r.pesate} su ${r.giorni} giorni`,
        d: 'Il ritmo del peso e il dispendio misurato nascono da li\u2019: con '
          + 'poche pesate restano una stima larga.' });
  }
  return out;
}

/** Il corpo: le domande finche' non se ne fa una, poi la conversazione. */
function assDisegna(corpo) {
  corpo.innerHTML = '';

  /* --- cosa manca, prima di chiedere --- */
  for (const m of assMancanze()) {
    const w = el('div', 'ai-manca');
    w.append(el('b', null, esc(m.t)));
    w.append(el('span', null, esc(m.d)));
    if (m.dove) {
      const b = el('button', null, m.dove + ' \u203a');
      b.type = 'button';
      b.onclick = () => {
        assChiudi();
        if (typeof pianoTab !== 'undefined') pianoTab = m.tab;
        apri('#/piano');
      };
      w.append(b);
    }
    corpo.append(w);
  }

  /* --- le domande --- */
  const q = [
    ['valutaPiano', 'piano', 'Valuta il piano alimentare', 'Il piano',
     'Le calorie e i macro dei sette giorni, la distanza dal target e la direzione rispetto all’obiettivo.'],
    ['valutaAndamento', 'curva', 'Come sta andando', 'Come va',
     'Il registro, le medie del periodo, il ritmo del peso, gli allenamenti e dove portano le proiezioni.'],
    ['criticita', 'avviso', 'Cosa non va', 'Cosa non va',
     'Le criticita’ in ordine di gravita’, con il numero da cui si vedono, e una sola cosa da cambiare.']
  ];
  const dom = q.filter(([id]) =>
    !(id === 'valutaPiano' && typeof usaPiano === 'function' && !usaPiano()));

  /* Prima della prima domanda sono tre carte che dicono cosa guarderanno:
     e' il momento in cui uno non sa ancora cosa puo' chiedere. Dopo
     diventano tre pastiglie in fila, perche' da li' in poi la cosa da
     leggere e' la risposta, e tre carte alte settanta pixel la
     spingerebbero sotto il bordo. */
  if (!assMsg.length) {
    /* Prima delle domande, perche' non e' una domanda: e' l'unica cosa qui
       dentro che **scrive** nel diario, e si fa nel momento in cui il piatto
       ce l'hai davanti. Le tre valutazioni si fanno dopo, con calma. */
    corpo.append(el('div', 'ai-tit', 'Registra un pasto'));
    const fp = el('button', 'ai-q ai-foto');
    fp.type = 'button';
    const bx = el('span', 'ic'); bx.append(assIcona('scatto'));
    fp.append(bx);
    fp.append(el('span', 'gr', '<b>Da una foto</b><span>Scatta il piatto: '
      + 'la foto resta attaccata alla voce, e i valori li stimi con un modello '
      + 'o li scrivi tu.</span>'));
    fp.append(el('span', 'ch', '\u203a'));
    fp.onclick = () => sheetPastoFoto();
    corpo.append(fp);

    corpo.append(el('div', 'ai-tit', 'Cosa vuoi chiedere'));
    for (const [id, ic, tit, , det] of dom) {
      const b = el('button', 'ai-q');
      b.type = 'button';
      const box = el('span', 'ic'); box.append(assIcona(ic));
      b.append(box);
      b.append(el('span', 'gr', `<b>${esc(tit)}</b><span>${esc(det)}</span>`));
      b.append(el('span', 'ch', '›'));
      b.onclick = () => assChiedi(id);
      corpo.append(b);
    }
    return;
  }

  for (const m of assMsg) corpo.append(assBolla(m));
  const fila = el('div', 'ai-chip');
  for (const [id, ic, , corto] of dom) {
    const b = el('button', null);
    b.type = 'button';
    b.append(assIcona(ic));
    b.append(document.createTextNode(corto));
    b.onclick = () => assChiedi(id);
    fila.append(b);
  }
  corpo.append(fila);
}

function assBolla(m) {
  const w = el('div', 'ai-msg ' + (m.io ? 'io' : 'lui'));
  const b = el('div', 'b');
  if (m.io) { b.textContent = m.testo; w.append(b); return w; }

  b.append(el('p', null, m.testo));
  if (m.prompt) {
    const pre = el('pre', 'ai-prompt');
    pre.textContent = m.prompt;
    b.append(pre);
    const az = el('div', 'ai-az');
    const c = el('button', 'pri', 'Copia la domanda');
    c.type = 'button';
    c.onclick = async () => {
      try {
        await navigator.clipboard.writeText(m.prompt);
        toast('Copiata');
      } catch {
        /* Safari nega la clipboard fuori da un gesto "fidato", e capita.
           Selezionare il testo e' la strada che resta, e va detta invece di
           lasciare un bottone che non fa niente. */
        const s = getSelection(), rg = document.createRange();
        rg.selectNodeContents(pre); s.removeAllRanges(); s.addRange(rg);
        toast('Selezionata: tieni premuto e copia');
      }
    };
    az.append(c);
    b.append(az);
  }
  if (m.nota) b.append(el('p', null, m.nota));
  w.append(b);
  return w;
}

/**
 * La domanda si compone, si mostra, e si ferma li'.
 *
 * Quando un trasporto ci sara', l'unica riga che cambia e' questa: al posto
 * di stampare `testoRichiesta()` si chiamera' `ai.chiedi()`, che passa gia'
 * dal filtro in uscita. Il resto — periodo, contesto, bottoni — e' lo stesso.
 */
function assChiedi(compito, domanda) {
  const per = revPeriodoAttivo();
  const nome = (AI_COMPITI[compito] || {}).n || 'Domanda';
  assMsg.push({ io: true, testo: domanda || nome });

  let r;
  try {
    r = ai.richiesta(compito, { per, domanda });
  } catch (e) {
    assMsg.push({ io: false, testo: 'Non sono riuscito a comporre la domanda: ' + e.message });
    assAggiorna();
    return;
  }
  assMsg.push({
    io: false,
    testo: 'Non sono collegato a nessun modello, quindi non ti do una risposta '
      + 'inventata. Ti do la domanda gia’ scritta, con dentro i tuoi numeri '
      + 'del periodo: copiala e incollala dove vuoi.',
    prompt: ai.testoRichiesta(r),
    nota: 'Quando ci sara’ un modello collegato, questo stesso testo partira’ '
      + 'da solo e la risposta passera’ dai controlli dell’app prima di '
      + 'comparire qui.'
  });
  assAggiorna();
}

function assAggiorna() {
  const c = document.getElementById('ai-corpo');
  if (!c) return;
  assDisegna(c);
  /* dopo il layout, non dentro un rAF: al primo fotogramma `scrollHeight` e'
     ancora quello di prima e la risposta appena scritta resta sotto il bordo */
  setTimeout(() => c.scrollTo({ top: c.scrollHeight,
    behavior: (typeof motionOk === 'function' && !motionOk()) ? 'auto' : 'smooth' }), 0);
}

/* ============================================ un piatto da una foto
 *
 * Tre passi, e sono tre schermate della stessa: **la foto**, **cosa c'e'
 * dentro**, **dove va**. Non c'e' niente da copiare e niente da incollare: la
 * domanda parte, la risposta torna, e quello che si vede e' gia' una
 * proposta da correggere.
 *
 * **La foto si scompone, non si riassume.** Il modello non restituisce "un
 * piatto da 640 kcal" ma **gli alimenti che vede**, ognuno con i grammi e i
 * valori per 100 g. E' cosi' che quest'app tiene il cibo da sempre, e da li'
 * discende tutto il resto: i grammi si correggono uno per uno prima di
 * salvare, la roba entra in un pasto come qualunque altro ingrediente, e se
 * un giorno colleghi un prodotto reale a uno di quei nomi i conti si
 * aggiornano da soli. Una riga sola non saprebbe fare niente di tutto questo.
 *
 * **Niente si applica da solo**, come per ogni altra proposta dell'AI: la
 * lista si guarda, si corregge e si conferma. Gli alimenti che non hai
 * nascono `fonte: 'stima'` — mai `verificato`, che resta di chi ha letto
 * l'etichetta sulla confezione.
 *
 * Finche' non c'e' un trasporto la chiamata si ferma e **lo dice**, con la
 * strada che resta aperta: scrivere i valori a mano. Non un messaggio di
 * errore in un vicolo cieco.
 */
let pfS = null;

const PF_PASSI = ['foto', 'analisi', 'dove'];

function pfNuovo(k) {
  return { k, passo: 'foto', foto: null, url: null, b64: null,
           stato: null, err: null, prop: null, dest: null };
}

function sheetPastoFoto(k = today()) {
  if (!pfS || pfS.k !== k) pfS = pfNuovo(k);
  const w = el('div', 'pf');

  /* --- la testata: il passo, e il giorno --- */
  w.append(el('div', 'eyebrow', 'Un piatto da una foto'));
  w.append(el('h2', 'sec', { foto: 'Fotografa il piatto',
    analisi: 'Cosa c’e’ nel piatto', dove: 'Dove lo metto' }[pfS.passo]));
  w.lastChild.style.marginTop = '0';

  const gd = el('div', 'pf-passi');
  for (const [i, p2] of PF_PASSI.entries()) {
    const t = el('span', 'p' + (p2 === pfS.passo ? ' ora'
      : (PF_PASSI.indexOf(pfS.passo) > i ? ' fatto' : '')));
    t.textContent = ['La foto', 'Cosa c’e’', 'Dove va'][i];
    gd.append(t);
  }
  w.append(gd);

  const inp = el('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
  inp.onchange = () => { const f = inp.files[0]; if (f) pfPrendi(f); };
  w.append(inp);

  ({ foto: pfPassoFoto, analisi: pfPassoAnalisi, dove: pfPassoDove }[pfS.passo])(w, inp);
  sheet(w);
}

/* ------------------------------------------------------------ 1. la foto */
function pfPassoFoto(w, inp) {
  const gg = el('div', 'pf-g');
  const et = pfS.k === today() ? 'oggi'
    : (pfS.k === addDays(today(), -1) ? 'ieri' : '');
  gg.innerHTML = '<span class="et">Giorno</span>'
    + '<b>' + esc(typeof dataLunga === 'function' ? dataLunga(pfS.k) : pfS.k) + '</b>'
    + (et ? '<span class="og">' + et + '</span>' : '');
  const cd = el('input');
  cd.type = 'date'; cd.value = pfS.k; cd.max = today();
  cd.setAttribute('aria-label', 'Il giorno del pasto');
  cd.onchange = () => { if (cd.value) { pfS = pfNuovo(cd.value); sheetPastoFoto(cd.value); } };
  gg.append(cd);
  w.append(gg);

  const box = el('div', 'pf-vuoto');
  const ic = el('div', 'ic'); ic.append(assIcona('scatto'));
  box.append(ic);
  box.append(el('p', null, 'Inquadra il piatto dall’alto, con tutto dentro. '
    + 'Se accanto c’e’ una posata o una mano, la porzione si stima meglio.'));
  w.append(box);

  const sc = el('button', 'btn wide pri', 'Scatta adesso');
  sc.onclick = () => { inp.setAttribute('capture', 'environment'); inp.click(); };
  w.append(sc);
  const gal = el('button', 'btn wide', 'Scegli dalla galleria');
  gal.style.marginTop = '8px';
  gal.onclick = () => { inp.removeAttribute('capture'); inp.click(); };
  w.append(gal);
  w.append(el('p', 'note',
    'La foto viene rimpicciolita a 900 px e resta sul telefono. Per farla '
    + 'leggere parte solo verso il modello che hai collegato tu, e solo quando '
    + 'tocchi "analizza".'));
}

/** La foto scelta: si comprime, si tiene anche in base64 per la domanda. */
async function pfPrendi(file) {
  toast('Elaboro…');
  try {
    const r = await comprimi(file, 900, 0.72);
    if (pfS.url) URL.revokeObjectURL(pfS.url);
    pfS.foto = r.blob;
    pfS.url = URL.createObjectURL(r.blob);
    pfS.b64 = await bloB64(r.blob);
    pfS.passo = 'analisi';
    pfS.err = null; pfS.prop = null;
    /* `pfAnalizza()` mette lo stato su "chiedo" **e poi** disegna: disegnare
       prima vorrebbe dire un passo "analisi" senza attesa, senza errore e
       senza proposta — cioe' una schermata che non esiste. */
    pfAnalizza();
  } catch (e) {
    toast('Immagine non leggibile: ' + (e.message || 'errore'));
  }
}

/* ------------------------------------------------------- 2. cosa c'e' dentro */
function pfPassoAnalisi(w, inp) {
  const fig = el('div', 'pf-img');
  const img = el('img');
  img.src = pfS.url; img.alt = 'Il piatto fotografato';
  fig.append(img);
  const rif = el('button', 'pf-rif', 'Cambia');
  rif.type = 'button';
  rif.onclick = () => { inp.removeAttribute('capture'); inp.click(); };
  fig.append(rif);
  w.append(fig);

  if (pfS.stato === 'chiedo' || (!pfS.err && !pfS.prop)) {
    const at = el('div', 'pf-att');
    at.innerHTML = '<span class="sp"></span>'
      + '<b>Sto guardando la foto…</b>'
      + '<span>Riconosco gli alimenti e stimo i grammi.</span>';
    w.append(at);
    return;
  }

  if (pfS.err) {
    const e = el('div', 'pf-err');
    e.append(el('b', null, pfS.err.titolo));
    e.append(el('span', null, pfS.err.testo));
    w.append(e);
    if (pfS.err.riprova) {
      const r = el('button', 'btn wide', 'Riprova');
      r.onclick = () => { pfS.err = null; sheetPastoFoto(pfS.k); pfAnalizza(); };
      w.append(r);
    }
    const m = el('button', 'btn wide' + (pfS.err.riprova ? '' : ' pri'),
      'Scrivi tu cosa c’era');
    m.style.marginTop = '8px';
    m.onclick = () => {
      pfS.prop = { nome: '', alimenti: [], mano: true };
      pfS.err = null;
      pfAggiungiRiga();
      sheetPastoFoto(pfS.k);
    };
    w.append(m);
    return;
  }

  const P = pfS.prop;
  if (P.verdetto) w.append(el('p', 'pf-verd', esc(P.verdetto)));
  for (const a of (P.avvisi || [])) w.append(el('p', 'pf-av', esc(a)));

  w.append(el('div', 'ai-tit', 'Gli alimenti'));
  const lista = el('div', 'pf-lista');
  for (const [i, a] of P.alimenti.entries()) lista.append(pfRiga(a, i));
  w.append(lista);

  const piu = el('button', 'pf-piu', '+ aggiungi un alimento');
  piu.type = 'button';
  piu.onclick = () => { pfAggiungiRiga(); sheetPastoFoto(pfS.k); };
  w.append(piu);

  const t = pfTotale();
  const tot = el('div', 'pf-tot');
  tot.innerHTML = '<span class="e">In tutto</span>'
    + '<b>' + nf(t.kcal) + ' kcal</b>'
    + '<span class="m">' + macroRiga(t) + '</span>';
  w.append(tot);

  const ok = el('button', 'btn wide pri', 'Continua');
  ok.style.marginTop = '12px';
  ok.disabled = !P.alimenti.length;
  ok.onclick = () => { pfS.passo = 'dove'; sheetPastoFoto(pfS.k); };
  w.append(ok);
  w.append(el('p', 'note',
    P.mano ? 'I valori sono per 100 g, come per ogni alimento dell’app: la '
      + 'quantita’ e’ quella del piatto.'
      : 'Sono stime lette in una fotografia, non valori di un’etichetta: i '
      + 'grammi si correggono qui, prima di salvare. Gli alimenti che non hai '
      + 'ancora nascono come <strong>stima</strong>.'));
}

/** Una riga: nome, quantita', e i valori per 100 g dietro un tocco. */
function pfRiga(a, i) {
  const r = el('div', 'pf-r' + (a.aperto ? ' ap' : ''));
  const testa = el('button', 'pf-rt');
  testa.type = 'button';
  const m = pfMacroDi(a);
  testa.innerHTML = '<span class="grow"><span class="n">' + esc(a.nome) + '</span>'
    + '<span class="mm">' + macroRiga(m) + '</span></span>'
    + '<span class="q">' + nf(a.qta) + '<em>' + esc(a.unita || 'g') + '</em></span>'
    + '<span class="k">' + nf(m.kcal) + '<em>kcal</em></span>';
  testa.onclick = () => { a.aperto = !a.aperto; sheetPastoFoto(pfS.k); };
  r.append(testa);
  if (!a.aperto) return r;

  const c = el('div', 'pf-rc');
  const campo = (id, lab, val, unita, su) => {
    const f = el('div', 'pf-c');
    f.innerHTML = '<label>' + esc(lab) + '</label>'
      + '<span><input type="text" inputmode="decimal" value="' + (val ?? '') + '">'
      + '<i>' + esc(unita) + '</i></span>';
    f.querySelector('input').oninput = e2 => {
      su(parseNum(e2.target.value) ?? 0);
    };
    return f;
  };
  const nome = el('div', 'field');
  nome.innerHTML = '<label>Alimento</label><input type="text" value="'
    + esc(a.nome) + '">';
  nome.querySelector('input').oninput = e2 => {
    a.nome = e2.target.value.trim().toLowerCase();
  };
  c.append(nome);
  const gr = el('div', 'pf-gr');
  gr.append(campo('q', 'Quantita’', a.qta, a.unita || 'g',
    v => { a.qta = v; pfRinfresca(); }));
  gr.append(campo('kcal', 'Per 100: kcal', a.per100.kcal, 'kcal',
    v => { a.per100.kcal = v; pfRinfresca(); }));
  gr.append(campo('p', 'Proteine', a.per100.p, 'g', v => { a.per100.p = v; pfRinfresca(); }));
  gr.append(campo('c', 'Carboidrati', a.per100.c, 'g', v => { a.per100.c = v; pfRinfresca(); }));
  gr.append(campo('g', 'Grassi', a.per100.g, 'g', v => { a.per100.g = v; pfRinfresca(); }));
  gr.append(campo('f', 'Fibre', a.per100.fibre, 'g', v => { a.per100.fibre = v; pfRinfresca(); }));
  c.append(gr);
  if (a.dubbio) c.append(el('p', 'pf-av', esc(a.dubbio)));
  const via = el('button', 'pf-via', 'Togli questo alimento');
  via.type = 'button';
  via.onclick = () => { pfS.prop.alimenti.splice(i, 1); sheetPastoFoto(pfS.k); };
  c.append(via);
  r.append(c);
  return r;
}

/** I macro della quantita' vista, dai valori per 100. */
function pfMacroDi(a) {
  const q = (a.qta || 0) / 100;
  const p = a.per100 || {};
  return { kcal: (p.kcal || 0) * q, p: (p.p || 0) * q, c: (p.c || 0) * q,
           g: (p.g || 0) * q, fibre: (p.fibre || 0) * q };
}
function pfTotale() {
  const t = { kcal: 0, p: 0, c: 0, g: 0, fibre: 0 };
  for (const a of (pfS.prop?.alimenti || [])) {
    const m = pfMacroDi(a);
    for (const x of Object.keys(t)) t[x] += m[x];
  }
  return t;
}
function pfAggiungiRiga() {
  pfS.prop.alimenti.push({ nome: '', qta: 100, unita: 'g', aperto: true,
    per100: { kcal: 0, p: 0, c: 0, g: 0, fibre: 0 } });
}
/* I totali cambiano mentre si scrive, ma **il foglio non si ridisegna**:
   ridisegnarlo a ogni tasto farebbe perdere il fuoco al campo, e sul telefono
   quello chiude la tastiera. E' la stessa regola dei filtri che cercano. */
function pfRinfresca() {
  const t = pfTotale();
  const box = document.querySelector('.pf-tot');
  if (box) box.innerHTML = '<span class="e">In tutto</span>'
    + '<b>' + nf(t.kcal) + ' kcal</b>'
    + '<span class="m">' + macroRiga(t) + '</span>';
}

/** La chiamata vera. Senza trasporto si ferma e lo dice. */
async function pfAnalizza() {
  pfS.stato = 'chiedo'; pfS.err = null;
  sheetPastoFoto(pfS.k);
  try {
    const r = await ai.chiedi('stimaPasto', { giorno: pfS.k, immagine: pfS.b64 });
    const az = (r.azioni || []).find(x => x.tipo === 'pastoDaFoto');
    if (!az) throw Object.assign(new Error(
      'La risposta non conteneva nessun alimento riconosciuto.'), { codice: 'AI_VUOTA' });
    pfS.prop = { nome: az.nome, alimenti: az.alimenti.map(x => ({ ...x, aperto: false })),
                 verdetto: r.verdetto, avvisi: r.avvisi };
    pfS.stato = 'ok';
  } catch (e) {
    pfS.stato = 'errore';
    pfS.err = {
      AI_NON_CONFIGURATA: { titolo: 'L’assistente non e’ ancora collegato',
        testo: 'Manca il collegamento a un modello che sappia guardare le '
          + 'immagini: la foto e’ pronta e la domanda anche, ma non c’e’ '
          + 'nessuno a cui mandarla. Intanto puoi scrivere tu cosa c’era.',
        riprova: false },
      AI_OFFLINE: { titolo: 'Serve la rete', riprova: true,
        testo: 'L’assistente e’ l’unica parte dell’app che non funziona '
          + 'offline: tutto il resto continua a funzionare.' }
    }[e.codice] || { titolo: 'Non ho capito la risposta', riprova: true,
      testo: e.message || 'Il modello ha risposto qualcosa che non so leggere.' };
  }
  sheetPastoFoto(pfS.k);
}

/* --------------------------------------------------------- 3. dove va */
function pfPassoDove(w) {
  const t = pfTotale();
  const cap = el('div', 'pf-cap');
  cap.innerHTML = '<b>' + esc(pfS.prop.nome || 'Il piatto') + '</b>'
    + '<span>' + pfS.prop.alimenti.length + ' alimenti · ' + nf(t.kcal) + ' kcal · '
    + macroRiga(t) + '</span>';
  w.append(cap);

  w.append(el('div', 'ai-tit', 'In quale pasto'));
  const slots = (typeof slotsGiorno === 'function' ? slotsGiorno(pfS.k) : [])
    .filter(s => pasto(s.codice));
  const lista = el('div', 'pf-dest');
  for (const s of slots) {
    const sid = chiaveP(s);
    const b = el('button', 'pf-d' + (pfS.dest === sid ? ' on' : ''));
    b.type = 'button';
    const p2 = pasto(s.codice);
    b.innerHTML = '<span class="grow"><span class="n">' + esc(s.slot) + '</span>'
      + '<span class="d">' + esc(p2?.nome || '') + '</span></span>'
      + '<span class="o">' + esc(s.ora || '') + '</span>';
    b.onclick = () => { pfS.dest = sid; sheetPastoFoto(pfS.k); };
    lista.append(b);
  }
  const fp = el('button', 'pf-d fp' + (pfS.dest === '*extra' ? ' on' : ''));
  fp.type = 'button';
  fp.innerHTML = '<span class="grow"><span class="n">Fuori piano</span>'
    + '<span class="d">Una voce a se’, fuori dai pasti del piano</span></span>';
  fp.onclick = () => { pfS.dest = '*extra'; sheetPastoFoto(pfS.k); };
  lista.append(fp);
  w.append(lista);
  if (!slots.length) w.append(el('p', 'hint',
    'Quel giorno non ha nessun pasto assegnato: va nel fuori piano.'));

  const indietro = el('button', 'btn wide', '‹ Torna agli alimenti');
  indietro.onclick = () => { pfS.passo = 'analisi'; sheetPastoFoto(pfS.k); };

  const ok = el('button', 'btn wide pri', 'Aggiungi alla giornata');
  ok.style.marginTop = '12px';
  ok.disabled = !pfS.dest;
  ok.onclick = () => pfSalva();
  w.append(ok);
  w.append(indietro);
  indietro.style.marginTop = '8px';
  w.append(el('p', 'note',
    'Dentro un pasto gli alimenti si sommano alla ricetta come quelli che '
    + 'aggiungi a mano, e valgono <strong>solo per quel giorno</strong>. Quelli '
    + 'che non hai ancora entrano nella lista ingredienti come '
    + '<strong>stima</strong>: i valori li ha guardati un modello, non letti su '
    + 'un’etichetta.'));
}

/**
 * Si applica.
 *
 * Prima gli alimenti che mancano — nello strato del piano, `fonte: 'stima'` —
 * e solo dopo le righe nel giorno: una riga che nomina un alimento che non
 * esiste vale zero calorie, ed e' l'ordine giusto anche quando fallisce a
 * meta'.
 */
async function pfSalva() {
  const A = pfS.prop.alimenti.filter(a => a.nome && a.qta > 0 && a.per100.kcal > 0);
  if (!A.length) { toast('Non c’e’ niente da aggiungere'); return; }
  const p = piano();
  p.alimenti ||= {};
  let nuovi = 0;
  for (const a of A) {
    if (typeof alimento === 'function' && alimento(a.nome)) continue;
    p.alimenti[a.nome] = { kcal: a.per100.kcal, p: a.per100.p, c: a.per100.c,
      g: a.per100.g, fibre: a.per100.fibre, unita: a.unita || 'g',
      categoria: '', fonte: 'stima' };
    nuovi++;
  }
  if (nuovi) { save(); fondiPiano(); }

  const d = day(pfS.k);
  if (pfS.dest === '*extra') {
    const t = pfTotale();
    d.extra.push({ nome: pfS.prop.nome || 'Piatto dalla foto', kcal: t.kcal,
      p: t.p, c: t.c, g: t.g, fibre: t.fibre, stimato: true });
  } else {
    for (const a of A) aggiungiAlPasto(pfS.dest, pfS.k, a.nome, a.qta);
    /* **E il pasto si spunta.** Senza, le calorie non entrano in `consumed()`
       — che conta solo i pasti spuntati — e chi ha appena fotografato il
       proprio pranzo vedrebbe le barre di Oggi ferme: l'app direbbe che non
       ha mangiato niente. Una foto del piatto e' la dichiarazione piu' netta
       che esista di averlo mangiato. Se era gia' spuntato non si tocca
       niente: gli aggiunti si sommano sopra la ricetta congelata. */
    if (!day(pfS.k).pasti[pfS.dest]) {
      if (typeof congelaPasto === 'function') congelaPasto(pfS.dest, pfS.k);
      day(pfS.k).pasti[pfS.dest] = true;
    }
  }

  /* La foto resta attaccata alla giornata: riaprendola si vede cosa c'era nel
     piatto, non solo un nome e un numero. */
  try {
    const f = await fotoPasto(pfS.foto, pfS.k, pfS.prop.nome || null);
    d.fotoPasti ||= {};
    (d.fotoPasti[pfS.dest] ||= []).push(f.id);
    if (pfS.dest === '*extra') d.extra[d.extra.length - 1].foto = f.id;
  } catch { /* senza la foto la voce vale lo stesso: e' il numero che conta */ }

  save();
  if (pfS.url) URL.revokeObjectURL(pfS.url);
  pfS = null;
  closeSheet(); assChiudi(); route();
  toast(nuovi ? A.length + ' alimenti aggiunti, ' + nuovi + ' nuovi'
              : A.length + ' alimenti aggiunti');
}
