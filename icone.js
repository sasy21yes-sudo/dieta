/* Icone.
 *
 * I tracciati vengono da **Feather Icons** di Cole Bemis (licenza MIT), dalla
 * sua continuazione **Lucide** (licenza ISC) e da **Tabler Icons** di Pawel
 * Kuna (licenza MIT) per gli sport, riprodotti qui dentro invece di essere
 * caricati da un CDN. Il motivo e' lo stesso per cui i tracciati del
 * corpo stanno in `data/corpo.json`: quest'app funziona offline e non ha un
 * build step, e una `<link>` a unpkg vorrebbe dire icone che spariscono in
 * palestra dove non prende. Sono quarantotto disegni, non una dipendenza.
 *
 * Copyright (c) 2013-2024 Cole Bemis e i contributori di Lucide.
 * Copyright (c) 2020-2025 Pawel Kuna (Tabler Icons).
 * Feather: MIT. Lucide: ISC. Tabler: MIT. Tutte e tre permettono la copia
 * con questa nota.
 *
 * Tutte condividono la stessa griglia 24×24 e lo stesso tratto da 2, che e'
 * quello che le fa sembrare una famiglia invece di quarantotto disegni presi in giro
 * — la stessa ragione per cui le icone di Gym sono disegnate a mano tutte con
 * sette tratti e lo stesso arrotondamento.
 */
'use strict';

/* d: uno o piu' tracciati. c: cerchi [cx, cy, r]. */
const ICONE = {
  // il sole che sorge: colazione
  sunrise: { d: ['M17 18a5 5 0 0 0-10 0', 'M12 2v7', 'M4.22 10.22l1.42 1.42',
                 'M1 18h2', 'M21 18h2', 'M18.36 11.64l1.42-1.42', 'M23 22H1',
                 'M16 5l-4-3-4 3'] },
  // il sole pieno: pranzo
  sun: { c: [[12, 12, 5]],
         d: ['M12 1v2', 'M12 21v2', 'M4.22 4.22l1.42 1.42', 'M18.36 18.36l1.42 1.42',
             'M1 12h2', 'M21 12h2', 'M4.22 19.78l1.42-1.42', 'M18.36 5.64l1.42-1.42'] },
  // il sole che cala: spuntino del pomeriggio
  sunset: { d: ['M17 18a5 5 0 0 0-10 0', 'M12 9V2', 'M4.22 10.22l1.42 1.42',
                'M1 18h2', 'M21 18h2', 'M18.36 11.64l1.42-1.42', 'M23 22H1',
                'M16 5l-4 4-4-4'] },
  // la luna: cena
  moon: { d: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'] },
  // il letto: prima di dormire
  bed: { d: ['M2 4v16', 'M2 8h18a2 2 0 0 1 2 2v10', 'M2 17h20', 'M6 8v4'] },
  // la tazza: gli spuntini che non sono ne' alba ne' tramonto
  coffee: { d: ['M18 8h1a4 4 0 0 1 0 8h-1', 'M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z',
                'M6 1v3', 'M10 1v3', 'M14 1v3'] },
  // il piatto e le posate: quando il nome dello slot non dice niente
  utensils: { d: ['M3 2v7a3 3 0 0 0 3 3h1a3 3 0 0 0 3-3V2', 'M6.5 2v20',
                  'M17 2a4 4 0 0 0-3 3.87V13h4V2h-1z', 'M18 13v9'] },
  // le tre azioni dentro un pasto
  plus: { d: ['M12 5v14', 'M5 12h14'] },
  trash: { d: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
               'M10 11v6', 'M14 11v6'] },
  repeat: { d: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14',
                'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'] },
  undo: { d: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'] },
  // l'elenco: tre righe e i loro pallini
  list: { d: ['M8 6h13', 'M8 12h13', 'M8 18h13',
              'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
  // la freccia che entra nel vassoio: scaricare un file
  download: { d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
                  'M7 10l5 5 5-5', 'M12 15V3'] },
  // la spunta della spesa e la casa della dispensa
  check: { d: ['M20 6L9 17l-5-5'] },
  home: { d: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'] },

  /* Le cinque della tab bar. Stessa griglia e stesso tratto di tutte le
     altre: e' quello che le fa sembrare una famiglia. Il manubrio non sta
     ne' in Feather ne' in Lucide con questa forma ed e' disegnato qui, con
     lo stesso spessore. */
  book: { d: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'] },
  persona: { c: [[12, 7, 4]], d: ['M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'] },
  manubrio: { d: ['M6.5 6.5v11', 'M3.5 9v6', 'M17.5 6.5v11', 'M20.5 9v6', 'M6.5 12h11'] },
  andamento: { d: ['M3 3v18h18', 'M7 15l4-5 3 3 5-7'] },

  /* Le voci del menu del profilo. `persona` e `list` le hanno gia'; queste
     quattro mancavano. Il cappello da cuoco viene da Lucide, le altre tre da
     Feather. */
  fotocamera: { c: [[12, 13, 4]],
                d: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'] },
  bersaglio: { c: [[12, 12, 10], [12, 12, 6], [12, 12, 2]] },
  calendario: { d: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
                    'M16 2v4', 'M8 2v4', 'M3 10h18'] },
  cappello: { d: ['M17 21a1 1 0 0 0 1-1v-5.35c0-.46.32-.85.73-1.05a4 4 0 0 0-2.13-7.59 5 5 0 0 0-9.2 0 4 4 0 0 0-2.13 7.59c.41.2.73.59.73 1.05V20a1 1 0 0 0 1 1z',
                  'M6 17h12'] },

  /* Le due della barra in fondo alla fotocamera. */
  immagine: { c: [[8.5, 8.5, 1.5]],
              d: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
                  'M21 15l-5-5L5 21'] },
  gira: { d: ['M23 4v6h-6', 'M1 20v-6h6',
              'M3.51 9a9 9 0 0 1 14.85-3.36L23 10',
              'M1 14l4.64 4.36A9 9 0 0 0 20.49 15'] },

  /* Le voci del menu dell'app. `check` (la spesa), `home` (la dispensa),
     `calendario`, `download` e `immagine` le ha gia'. */
  /* le due frecce attorno a un corpo macchina: girare la fotocamera non e'
     "aggiornare", e due significati sullo stesso disegno si vedono */
  giracam: { d: ['M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5',
                 'M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5',
                 'M15 8.5l3 2.5-3 2.5', 'M9 15.5l-3-2.5 3-2.5'] },
  carica: { d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
                'M17 8l-5-5-5 5', 'M12 3v12'] },
  telefono: { d: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z',
                  'M12 18h.01'] },
  pausa: { c: [[12, 12, 10]], d: ['M10 15V9', 'M14 15V9'] },
  condividi: { c: [[18, 5, 3], [6, 12, 3], [18, 19, 3]],
               d: ['M8.6 13.5l6.8 4', 'M15.4 6.5l-6.8 4'] },

  /* le copie automatiche: l'orologio con la freccia che torna indietro
     (Lucide "history"). Non le due frecce circolari, che sono "aggiorna". */
  copie: { d: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5',
               'M12 7v5l4 2'] },
  /* ---- gli sport ----
     Presi da **Tabler Icons** (licenza MIT) e non piu' disegnati a mano:
     stessa griglia 24x24, stesso tratto da 2 e stessi capi arrotondati delle
     altre, quindi restano una famiglia sola. Quelli a mano erano quindici
     silhouette che a venti pixel non si riconoscevano: in un elenco cosi' la
     riga si finisce per leggerla solo dal nome, e allora l'icona e' peso.
     Tre scelte, perche' Tabler non ha tutto:
     - **ellittica** non esiste in nessun catalogo libero. `treadmill` e' la
       macchina cardio della palestra, si distingue benissimo dal corridore
       di `corsa`, e dice il genere giusto di cosa;
     - **vogatore** prende il kayak: il remo e' il segno che si legge;
     - **boxe** prende il pugno chiuso, perche' un guantone non c'e'. */
  corsa: { d: ['M11.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 17l5 1l.75 -1.5',
               'M15 21v-4l-4 -3l1 -6', 'M7 12v-3l5 -1l3 3l3 1'] },
  camminata: { d: ['M12 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M7 21l3 -4',
                   'M16 21l-2 -4l-3 -3l1 -6', 'M6 12l2 -3l4 -1l3 3l3 1'] },
  bici: { d: ['M2 18a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
              'M16 18a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
              'M12 19v-4l-3 -3l5 -4l2 3h3',
              'M13.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'] },
  nuoto: { d: ['M15 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M6 11l4 -2l3.5 3l-1.5 2',
               'M3 16.75a2.4 2.4 0 0 0 1 .25a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 1 -.25'] },
  remo: { d: ['M6.414 6.414a2 2 0 0 0 0 -2.828l-1.414 -1.414l-2.828 2.828l1.414 1.414a2 2 0 0 0 2.828 0',
              'M17.586 17.586a2 2 0 0 0 0 2.828l1.414 1.414l2.828 -2.828l-1.414 -1.414a2 2 0 0 0 -2.828 0',
              'M6.5 6.5l11 11',
              'M22 2.5c-9.983 2.601 -17.627 7.952 -20 19.5c9.983 -2.601 17.627 -7.952 20 -19.5',
              'M6.5 12.5l5 5', 'M12.5 6.5l5 5'] },
  macchina: { d: ['M10 3a1 1 0 1 0 2 0a1 1 0 0 0 -2 0', 'M3 14l4 1l.5 -.5',
                  'M12 18v-3l-3 -2.923l.75 -5.077', 'M6 10v-2l4 -1l2.5 2.5l2.5 .5',
                  'M21 22a1 1 0 0 0 -1 -1h-16a1 1 0 0 0 -1 1', 'M18 21l1 -11l2 -1'] },
  battito: { d: ['M3 12h4.5l1.5 -6l4 12l2 -9l1.5 3h4.5'] },
  bjj: { d: ['M3 9l4.5 1l3 2.5', 'M13 21v-8l3 -5.5', 'M8 4.5l4 2l4 1l4 3.5l-2 3.5',
             'M15.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'] },
  boxe: { d: ['M8 11v-3.5a1.5 1.5 0 0 1 3 0v2.5', 'M11 9.5v-3a1.5 1.5 0 0 1 3 0v3.5',
              'M14 7.5a1.5 1.5 0 0 1 3 0v2.5',
              'M17 9.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7l-.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47'] },
  calcio: { d: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
                'M12 7l4.76 3.45l-1.76 5.55h-6l-1.76 -5.55l4.76 -3.45',
                'M12 7v-4m3 13l2.5 3m-.74 -8.55l3.74 -1.45m-11.44 7.05l-2.56 2.95m.74 -8.55l-3.74 -1.45'] },
  tennis: { d: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M6 5.3a9 9 0 0 1 0 13.4',
                'M18 5.3a9 9 0 0 0 0 13.4'] },
  basket: { d: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M5.65 5.65l12.7 12.7',
                'M5.65 18.35l12.7 -12.7', 'M12 3a9 9 0 0 0 9 9', 'M3 12a9 9 0 0 1 9 9'] },
  montagna: { d: ['M3 20h18l-6.921 -14.612a2.3 2.3 0 0 0 -4.158 0l-6.921 14.612',
                  'M7.5 11l2 2.5l2.5 -2.5l2 3l2.5 -2'] },
  yoga: { d: ['M4 20h4l1.5 -3', 'M17 20l-1 -5h-5l1 -7', 'M4 10l4 -1l4 -1l4 1.5l4 1.5',
              'M10.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'] },
  medaglia: { d: ['M12 4v3m-4 -3v6m8 -6v6',
                  'M12 18.5l-3 1.5l.5 -3.5l-2 -2l3 -.5l1.5 -3l1.5 3l3 .5l-2 2l.5 3.5l-3 -1.5'] },

  /* i tre cursori: le leve dei macro di una giornata del piano
     (Tabler "adjustments-horizontal"). */
  leve: { d: ['M12 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 6l8 0', 'M16 6l4 0',
              'M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 12l2 0', 'M10 12l10 0',
              'M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 18l11 0', 'M19 18l1 0'] },

  /* "fammi vedere": l'occhio della guida, sopra il recupero. */
  occhio: { c: [[12, 12, 3]],
            d: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'] }
};

function icona(nome, { size = 20, col = 'currentColor', cls = '' } = {}) {
  const spec = ICONE[nome] || ICONE.utensils;
  const s = mk('svg', {
    viewBox: '0 0 24 24', width: size, height: size,
    class: ('ico ' + cls).trim(), 'aria-hidden': 'true',
    fill: 'none', stroke: col, 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  });
  for (const c of (spec.c || []))
    s.append(mk('circle', { cx: c[0], cy: c[1], r: c[2] }));
  for (const d of (spec.d || [])) s.append(mk('path', { d }));
  return s;
}

/* ---------------------------------------------------- lo slot di un pasto
 *
 * Il nome dello slot lo scrive l'utente: "Colazione", ma anche "Spuntino
 * 16:30" o "Post workout". Quindi si guarda prima il nome, che dice
 * l'intenzione, e solo dopo l'ora, che e' un ripiego ragionevole. Se non
 * dicono niente ne' l'uno ne' l'altra resta il piatto: meglio un'icona
 * neutra di una sbagliata.
 *
 * I colori: alba ambra, mezzogiorno giallo, tramonto arancio, notte
 * blu-viola, letto indaco. Gli altri due — la tazza per gli spuntini e il
 * piatto per l'ignoto — stanno sul verde della casa, che e' il modo di dire
 * "questo e' un pasto" senza inventare un'ora che non si conosce.
 */
/* Cinque momenti, cinque tinte che non si confondono: ambra all'alba, giallo
   a mezzogiorno, arancio al tramonto, blu-viola di notte, indaco a letto. La
   tazza dello spuntino di mattina prende un caramello caldo — vicino
   all'ambra dell'alba, perche' e' la stessa parte della giornata, ma piu'
   scuro e con una forma completamente diversa. */
const SLOT_TINTE = {
  sunrise: '#E0913A', sun: '#E8B62C', sunset: '#DD6E37',
  moon: '#6A6DD4', bed: '#4C57A0', coffee: '#B06A34', utensils: 'var(--pine)'
};

function slotIcona(slot, ora) {
  const n = String(slot || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const h = /^(\d{1,2})[:.]/.test(String(ora || '')) ? +String(ora).split(/[:.]/)[0] : null;

  let id = null;
  if (/pre.?nanna|prima di dormire|before bed|notte/.test(n)) id = 'bed';
  else if (/cena|dinner/.test(n)) id = 'moon';
  else if (/colazione|breakfast/.test(n)) id = 'sunrise';
  else if (/pranzo|lunch/.test(n)) id = 'sun';
  else if (/spuntino|merenda|snack/.test(n))
    /* Lo spuntino della mattina aveva **la stessa icona del pranzo** — il sole
       pieno, perche' la soglia stava alle 11 — e in un elenco di cinque righe
       due quadrati identici sono due righe che si assomigliano nel punto in
       cui dovrebbero distinguersi. Adesso e' la tazza, che e' anche quello che
       uno ha davvero in mano a meta' mattina, e in un caramello caldo che non
       somiglia a nessuno degli altri quattro.
       La soglia del sole pieno sale a mezzogiorno: prima delle dodici uno
       spuntino e' di mattina, e il nome lo dice anche quando l'ora manca. */
    id = /mattin|mattut|brunch/.test(n) ? 'coffee'
      : h == null ? 'coffee' : h >= 15 ? 'sunset' : h >= 12 ? 'sun' : 'coffee';
  else if (h != null)
    id = h < 10 ? 'sunrise' : h < 15 ? 'sun' : h < 18 ? 'sunset' : h < 22 ? 'moon' : 'bed';

  return { id: id || 'utensils', col: SLOT_TINTE[id || 'utensils'] };
}

/** L'icona colorata dello slot, pronta da appendere. */
function slotBadge(slot, ora, size = 22) {
  const { id, col } = slotIcona(slot, ora);
  const b = el('span', 'slot-b');
  b.style.setProperty('--tinta', col);
  b.append(icona(id, { size, col: 'var(--tinta)' }));
  return b;
}
