/* Passa ogni rotta in ogni configurazione e cerca i buchi:
   la parola "null"/"undefined"/"NaN"/"Infinity" stampata a schermo, o
   un'eccezione durante il disegno. */
const ROTTE = ['oggi', 'diario', 'corpo', 'palestra', 'andamento', 'spesa', 'dispensa',
  'piano', 'prodotti', 'foto', 'impostazioni', 'hyrox', 'sostituzioni',
  'benvenuto', 'cardio', 'sfide'];

function configura(cfg) {
  const oggi = new Date();
  const key = d => d.toISOString().slice(0, 10);
  const log = {};
  if (cfg.dati) {
    for (let i = 0; i < 40; i++) {
      const d = new Date(oggi); d.setDate(d.getDate() - i);
      log[key(d)] = {
        peso: 69.4 + Math.sin(i / 3) * .5, acqua: 2 + (i % 3) * .3,
        sorsi: i % 2 ? [500, 500, 250] : undefined,
        coca: i % 4 === 0 ? 1 : 0, passi: 7000 + (i % 5) * 900,
        sonno: 6.5 + (i % 4) * .4, allenato: i % 2 === 0,
        fame: 3, energia: 4, aderenza: 4, pasti: {}, extra: []
      };
      if (!log[key(d)].sorsi) delete log[key(d)].sorsi;
    }
  }
  localStorage.setItem('dieta.profili', JSON.stringify(
    { attivo: 'p1', lista: [{ id: 'p1', nome: 'Prova' }] }));
  localStorage.setItem('dieta.v1:p1', JSON.stringify({
    log,
    settings: { pianoBase: cfg.base, moduli: { piano: cfg.piano, hyrox: cfg.hyrox } },
    piano: {}, palestra: {}, model: {}
  }));
}

const CFG = [
  { n: 'esempio+dati', base: 'esempio', piano: true, hyrox: true, dati: true },
  { n: 'esempio+dati+no-piano', base: 'esempio', piano: false, hyrox: true, dati: true },
  { n: 'esempio+dati+no-hyrox', base: 'esempio', piano: true, hyrox: false, dati: true },
  { n: 'esempio SENZA DATI', base: 'esempio', piano: true, hyrox: true, dati: false },
  { n: 'vuoto+dati', base: 'vuoto', piano: true, hyrox: true, dati: true },
  { n: 'vuoto+dati+no-piano', base: 'vuoto', piano: false, hyrox: true, dati: true },
  { n: 'vuoto+dati+no-hyrox', base: 'vuoto', piano: true, hyrox: false, dati: true },
  { n: 'vuoto SENZA DATI', base: 'vuoto', piano: true, hyrox: true, dati: false },
  { n: 'vuoto solo piano', base: 'vuoto', piano: true, hyrox: false, dati: false },
  { n: 'esempio nudo', base: 'esempio', piano: false, hyrox: false, dati: false }
];

const SOSPETTE = /\b(null|undefined|NaN|Infinity|\[object Object\])\b/;

addEventListener('load', () => setTimeout(async () => {
  const righe = [];
  const errori = [];
  addEventListener('error', e => errori.push(e.message));
  for (const cfg of CFG) {
    configura(cfg);
    // ricarica lo stato senza ricaricare la pagina
    try { load(); moduli().ai = true; save();
          if (typeof fondiPiano === 'function') fondiPiano(); }
    catch (e) { righe.push(cfg.n + ' :: load ' + e.message); continue; }
    /* i due PDF e il passo della settimana, in ogni configurazione: il piano
       vuoto e' il percorso consigliato a chi installa, e li' D.pasti e
       D.settimana[].codice sono vuoti */
    try {
      pianoTab = 'settimana';
      location.hash = '#/piano'; route();
      const b = [...document.querySelectorAll('#view button')]
        .find(x => /Scarica il piano/.test(x.title || ''));
      righe.push('· ' + cfg.n + ' :: bottone ' + (b ? 'c e' : 'ASSENTE'));
      const by = pdfPiano();
      righe.push('· ' + cfg.n + ' :: pdfPiano ' + (by.length / 1024).toFixed(1) + ' kB');
      const t2 = new TextDecoder('latin1').decode(by);
      const sosp = t2.match(/\((?:[^()]*)(undefined|NaN|Infinity)(?:[^()]*)\) Tj/);
      if (sosp) righe.push('!! ' + cfg.n + ' :: pdfPiano contiene ' + sosp[1] + ': ' + sosp[0]);
      const br = pdfResoconto(revPeriodoSettimana());
      righe.push('· ' + cfg.n + ' :: pdfResoconto ' + (br.length / 1024).toFixed(1) + ' kB');
      const t3 = new TextDecoder('latin1').decode(br);
      const sos2 = t3.match(/\((?:[^()]*)(undefined|NaN|Infinity)(?:[^()]*)\) Tj/);
      if (sos2) righe.push('!! ' + cfg.n + ' :: pdfResoconto contiene ' + sos2[1] + ': ' + sos2[0]);
    } catch (e) { righe.push('!! ' + cfg.n + ' :: PDF ' + e.message); }
    pianoTab = null;

    for (const r of ROTTE) {
      location.hash = '#/' + r;
      try { route(); } catch (e) { righe.push(cfg.n + ' / ' + r + ' :: ' + e.message); continue; }
      await new Promise(res => setTimeout(res, 8));
      const fab = document.getElementById('ai-fab');
      if (!fab) righe.push(cfg.n + ' / ' + r + ' :: NUVOLETTA ASSENTE');
      else { const b = fab.getBoundingClientRect();
        if (b.bottom > innerHeight - 60 || b.top < 60)
          righe.push(cfg.n + ' / ' + r + ' :: nuvoletta sopra una barra: ' + Math.round(b.top)); }
      const t = (document.querySelector('#view') || document.body).innerText || '';
      const m = t.match(SOSPETTE);
      if (m) {
        const i = t.indexOf(m[0]);
        righe.push(cfg.n + ' / ' + r + ' :: "' + m[0] + '" in ...'
          + t.slice(Math.max(0, i - 45), i + 30).replace(/\s+/g, ' ') + '...');
      }
    }
  }
  document.body.innerHTML = '<pre style="font:11px monospace;padding:8px;'
    + 'white-space:pre-wrap;color:#0f0;background:#000">'
    + (righe.length ? righe.join('\n') : 'MATRICE PULITA: '
        + CFG.length + ' configurazioni x ' + ROTTE.length + ' rotte')
    + (errori.length ? '\n\nECCEZIONI:\n' + errori.join('\n') : '')
    + '</pre>';
  document.documentElement.style.background = '#000';
}, 2000));
