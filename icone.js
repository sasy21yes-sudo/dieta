/* Icone.
 *
 * I tracciati vengono da **Feather Icons** di Cole Bemis (licenza MIT) e dalla
 * sua continuazione **Lucide** (licenza ISC), riprodotti qui dentro invece di
 * essere caricati da un CDN. Il motivo e' lo stesso per cui i tracciati del
 * corpo stanno in `data/corpo.json`: quest'app funziona offline e non ha un
 * build step, e una `<link>` a unpkg vorrebbe dire icone che spariscono in
 * palestra dove non prende. Sono dodici disegni, non una dipendenza.
 *
 * Copyright (c) 2013-2024 Cole Bemis e i contributori di Lucide.
 * Feather: MIT. Lucide: ISC. Entrambe permettono la copia con questa nota.
 *
 * Tutte condividono la stessa griglia 24×24 e lo stesso tratto da 2, che e'
 * quello che le fa sembrare una famiglia invece di dodici disegni presi in giro
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
  // la spunta della spesa e la casa della dispensa
  check: { d: ['M20 6L9 17l-5-5'] },
  home: { d: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'] }
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
const SLOT_TINTE = {
  sunrise: '#E0913A', sun: '#E8B62C', sunset: '#DD6E37',
  moon: '#6A6DD4', bed: '#4C57A0', coffee: '#9C6B3C', utensils: 'var(--pine)'
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
    id = h == null ? 'coffee' : h >= 15 ? 'sunset' : h >= 11 ? 'sun' : 'coffee';
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
