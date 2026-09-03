/* Un generatore di PDF scritto a mano.
 *
 * La regola di questo progetto e' che non si aggiungono librerie: i grafici
 * sono SVG costruito a mano, la cartolina della corsa e' un canvas, il file
 * dei promemoria e' un .ics scritto riga per riga. Un PDF non fa eccezione, e
 * non e' nemmeno difficile: il formato e' testo, gli oggetti sono numerati, e
 * in fondo c'e' una tabella con la posizione in byte di ognuno.
 *
 * L'alternativa era window.print(), e su iOS e' esattamente il punto in cui
 * si rompe: dentro una web app aggiunta alla Home la finestra di stampa a
 * volte non si apre, e quando si apre e' il browser a decidere margini e
 * interruzioni di pagina. Un file vero invece si salva, si manda per mail e
 * si porta dal medico, che e' il motivo per cui serve.
 *
 * Due limiti dichiarati, perche' sono scelte e non dimenticanze:
 *
 * - **Solo i font di base.** Helvetica e Helvetica-Bold sono fra i quattordici
 *   font che ogni lettore PDF ha gia' dentro: non vanno incorporati, e il file
 *   resta di qualche decina di kB invece che di qualche centinaio. Il prezzo
 *   e' che il PDF non ha lo stesso carattere dell'app.
 * - **Solo WinAnsi**, cioe' l'alfabeto latino occidentale. Accenti e
 *   virgolette tipografiche ci stanno tutti; un alfabeto non latino no, e
 *   quello che non entra diventa un punto interrogativo invece di rompere il
 *   file in silenzio.
 */
'use strict';

const PDF_A4 = { W: 595.28, H: 841.89 };

/* Le larghezze dei caratteri servono a mandare a capo: senza, il testo esce
   dal margine o si accavalla. Sono le metriche vere di Helvetica in
   millesimi di em, dallo spazio (32) alla tilde (126). */
const PDF_WID = {
  n: ('278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,'
    + '556,556,556,556,556,556,556,556,556,556,'
    + '278,278,584,584,584,556,1015,'
    + '667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,'
    + '278,278,278,469,556,333,'
    + '556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,'
    + '334,260,334,584').split(',').map(Number),
  b: ('278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,'
    + '556,556,556,556,556,556,556,556,556,556,'
    + '333,333,584,584,584,611,975,'
    + '722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,'
    + '333,278,333,584,556,333,'
    + '556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,'
    + '389,280,389,584').split(',').map(Number)
};

/* I caratteri fuori dall'ASCII: si portano dietro la larghezza della lettera
   senza accento, che sbaglia di pochissimo e non vale una seconda tabella. */
const PDF_BASE = {
  0xC0: 'A', 0xC1: 'A', 0xC2: 'A', 0xC3: 'A', 0xC4: 'A', 0xC5: 'A', 0xC7: 'C',
  0xC8: 'E', 0xC9: 'E', 0xCA: 'E', 0xCB: 'E', 0xCC: 'I', 0xCD: 'I', 0xCE: 'I',
  0xCF: 'I', 0xD1: 'N', 0xD2: 'O', 0xD3: 'O', 0xD4: 'O', 0xD5: 'O', 0xD6: 'O',
  0xD9: 'U', 0xDA: 'U', 0xDB: 'U', 0xDC: 'U',
  0xE0: 'a', 0xE1: 'a', 0xE2: 'a', 0xE3: 'a', 0xE4: 'a', 0xE5: 'a', 0xE7: 'c',
  0xE8: 'e', 0xE9: 'e', 0xEA: 'e', 0xEB: 'e', 0xEC: 'i', 0xED: 'i', 0xEE: 'i',
  0xEF: 'i', 0xF1: 'n', 0xF2: 'o', 0xF3: 'o', 0xF4: 'o', 0xF5: 'o', 0xF6: 'o',
  0xF9: 'u', 0xFA: 'u', 0xFB: 'u', 0xFC: 'u',
  0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"', 0x95: '-', 0x96: '-', 0x97: '-',
  0x85: '.', 0xB0: 'o', 0xB7: '.', 0xA0: ' '
};

/* Da Unicode a WinAnsiEncoding. Latin-1 passa cosi' com'e'; le virgolette e i
   trattini tipografici stanno nella fascia 0x80-0x9F, che e' l'unica cosa in
   cui WinAnsi si scosta da Latin-1. */
const PDF_MAP = { 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
  0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0x20AC: 0x80,
  0x2122: 0x99, 0x2039: 0x8B, 0x203A: 0x9B, 0x2212: 0x2D, 0x00A0: 0x20 };

function pdfWin(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    const w = PDF_MAP[c] ?? (c < 256 ? c : null);
    out += w == null ? '?' : String.fromCharCode(w);
  }
  return out;
}

/** Quanto e' larga questa stringa a questo corpo, in punti. */
function pdfLarghezza(s, size, bold) {
  const t = PDF_WID[bold ? 'b' : 'n'];
  let w = 0;
  for (const ch of pdfWin(s)) {
    const c = ch.charCodeAt(0);
    const k = c >= 32 && c <= 126 ? c : (PDF_BASE[c] || ' ').charCodeAt(0);
    w += t[k - 32] || 500;
  }
  return w / 1000 * size;
}

/** Via i tag: i testi della diagnosi possono contenere <strong>. */
function pdfTesto(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ');
}

const pdfEsc = s => pdfWin(s).replace(/[\\()]/g, c => '\\' + c);
const pdfN = v => (Math.round(v * 100) / 100).toString();
const pdfCol = c => (Array.isArray(c) ? c : [0, 0, 0]).map(x => pdfN(x / 255)).join(' ');

/**
 * Un documento. Il cursore `y` si misura dall'alto, come in una pagina vera:
 * dentro il PDF l'origine sta in basso a sinistra, e la conversione la fa
 * questo file una volta sola invece di farla sbagliare a chi lo usa.
 */
function pdfNuovo(o = {}) {
  const W = o.W || PDF_A4.W, H = o.H || PDF_A4.H, M = o.margine ?? 46;
  const pagine = [];
  let cur = null;

  const doc = {
    W, H, M, y: 0, larghezza: W - M * 2,
    get pagine() { return pagine.length; }
  };

  const op = s => { if (!cur) doc.nuovaPagina(); cur.push(s); };

  doc.nuovaPagina = () => { cur = []; pagine.push(cur); doc.y = M; return doc; };

  /** C'e' posto per n punti di altezza, o si cambia pagina? */
  doc.serve = n => {
    if (!cur) { doc.nuovaPagina(); return true; }
    if (doc.y + n > H - M - 22) { doc.nuovaPagina(); return true; }
    return false;
  };
  doc.spazio = n => { doc.y += n; return doc; };

  doc.testo = (s, x, y, opt = {}) => {
    const size = opt.size || 10, bold = !!opt.bold;
    const t = pdfTesto(s);
    let px = x;
    if (opt.align === 'right') px = x - pdfLarghezza(t, size, bold);
    else if (opt.align === 'center') px = x - pdfLarghezza(t, size, bold) / 2;
    op(`${pdfCol(opt.col || [21, 26, 31])} rg BT /${bold ? 'F2' : 'F1'} ${
      pdfN(size)} Tf 1 0 0 1 ${pdfN(px)} ${pdfN(H - y)} Tm (${pdfEsc(t)}) Tj ET`);
    return doc;
  };

  /** Spezza sulle parole e scrive; fa avanzare il cursore. */
  doc.paragrafo = (s, opt = {}) => {
    const size = opt.size || 10, bold = !!opt.bold;
    const w = opt.w || doc.larghezza, x = opt.x ?? M;
    const ih = opt.interlinea || size * 1.38;
    const righe = pdfRighe(pdfTesto(s), w, size, bold);
    for (const r of righe) {
      doc.serve(ih);
      doc.y += size * 0.82;                 // la linea di base sta sotto il corpo
      doc.testo(r, x, doc.y, { size, bold, col: opt.col, align: opt.align });
      doc.y += ih - size * 0.82;
    }
    return righe.length;
  };

  doc.linea = (x1, y1, x2, y2, opt = {}) => {
    op(`${pdfCol(opt.col || [221, 227, 232])} RG ${pdfN(opt.w ?? .7)} w ${
      opt.tratto ? `[${opt.tratto}] 0 d ` : '[] 0 d '
    }${pdfN(x1)} ${pdfN(H - y1)} m ${pdfN(x2)} ${pdfN(H - y2)} l S`);
    return doc;
  };

  doc.rett = (x, y, w, h, opt = {}) => {
    const dis = opt.fill && opt.stroke ? 'B' : opt.stroke ? 'S' : 'f';
    op(`${opt.fill ? pdfCol(opt.fill) + ' rg ' : ''}${
      opt.stroke ? pdfCol(opt.stroke) + ' RG ' + pdfN(opt.w ?? .7) + ' w ' : ''
    }[] 0 d ${pdfN(x)} ${pdfN(H - y - h)} ${pdfN(w)} ${pdfN(h)} re ${dis}`);
    return doc;
  };

  /* Un'ellisse in PDF sono quattro curve di Bezier: 0,5523 e' il rapporto che
     le fa passare per i quattro punti cardinali senza scarto visibile. */
  doc.ellisse = (cx, cy, rx, ry, opt = {}) => {
    const y = H - cy, kx = rx * 0.5523, ky = ry * 0.5523;
    const dis = opt.fill && opt.stroke ? 'B' : opt.stroke ? 'S' : 'f';
    op(`${opt.fill ? pdfCol(opt.fill) + ' rg ' : ''}${
      opt.stroke ? pdfCol(opt.stroke) + ' RG ' + pdfN(opt.w ?? .8) + ' w ' : ''
    }[] 0 d ${pdfN(cx - rx)} ${pdfN(y)} m `
      + `${pdfN(cx - rx)} ${pdfN(y + ky)} ${pdfN(cx - kx)} ${pdfN(y + ry)} ${pdfN(cx)} ${pdfN(y + ry)} c `
      + `${pdfN(cx + kx)} ${pdfN(y + ry)} ${pdfN(cx + rx)} ${pdfN(y + ky)} ${pdfN(cx + rx)} ${pdfN(y)} c `
      + `${pdfN(cx + rx)} ${pdfN(y - ky)} ${pdfN(cx + kx)} ${pdfN(y - ry)} ${pdfN(cx)} ${pdfN(y - ry)} c `
      + `${pdfN(cx - kx)} ${pdfN(y - ry)} ${pdfN(cx - rx)} ${pdfN(y - ky)} ${pdfN(cx - rx)} ${pdfN(y)} c ${dis}`);
    return doc;
  };
  /* Un cerchio e' un'ellisse coi due raggi uguali: due copie della stessa
     costruzione, prima o poi, diventano due costruzioni diverse. */
  doc.cerchio = (cx, cy, r, opt = {}) => doc.ellisse(cx, cy, r, r, opt);

  /**
   * Un percorso preso da un `d` di SVG, ma **solo `M`, `C` e `Z`**.
   *
   * Non e' un parser di SVG e non prova a esserlo. `smooth()` — la funzione
   * che disegna la sagoma del corpo — emette esattamente quei tre comandi,
   * perche' una Catmull-Rom diventa cubiche e basta, e le cubiche il PDF le
   * ha native. Un `A` o un `Q` ignorati in silenzio darebbero una figura con
   * un pezzo mancante, che e' il tipo di difetto che non si vede finche' non
   * lo si cerca: quindi quello che non e' M/C/Z fa lanciare.
   *
   * `sx`, `sy`, `ox`, `oy` portano le unita' del disegno dentro il riquadro
   * sulla pagina; la `y` si ribalta qui, come in tutto il resto del file.
   */
  doc.percorso = (d, opt = {}) => {
    const sx = opt.sx ?? 1, sy = opt.sy ?? sx, ox = opt.ox ?? 0, oy = opt.oy ?? 0;
    const PX = v => pdfN(ox + v * sx), PY = v => pdfN(H - (oy + v * sy));
    const t = String(d || '').trim().split(/[\s,]+/).filter(Boolean);
    let path = '';
    for (let i = 0; i < t.length;) {
      const c = t[i++];
      if (c === 'M') path += `${PX(+t[i++])} ${PY(+t[i++])} m `;
      else if (c === 'C') path += `${PX(+t[i++])} ${PY(+t[i++])} `
        + `${PX(+t[i++])} ${PY(+t[i++])} ${PX(+t[i++])} ${PY(+t[i++])} c `;
      else if (c === 'Z' || c === 'z') path += 'h ';
      else throw new Error('pdf.percorso: comando "' + c + '" non gestito');
    }
    if (!path) return doc;
    const dis = opt.fill && opt.stroke ? 'B' : opt.stroke ? 'S' : 'f';
    op(`${opt.fill ? pdfCol(opt.fill) + ' rg ' : ''}${
      opt.stroke ? pdfCol(opt.stroke) + ' RG ' + pdfN(opt.w ?? .8) + ' w 1 j 1 J ' : ''
    }${opt.tratto ? `[${opt.tratto}] 0 d ` : '[] 0 d '}${path}${dis}`);
    return doc;
  };

  /** Il pie' di pagina si scrive alla fine, quando si sa quante sono. */
  doc.chiudi = pie => {
    if (typeof pie === 'function')
      pagine.forEach((p, i) => { cur = p; pie(doc, i + 1, pagine.length); });
    return doc;
  };

  doc.bytes = () => pdfAssembla(pagine, W, H);
  return doc;
}

/** Manda a capo sulle parole; una parola piu' lunga della riga la spezza. */
function pdfRighe(s, w, size, bold) {
  const out = [];
  for (const par of String(s).split('\n')) {
    let riga = '';
    for (const parola of par.split(/\s+/)) {
      if (!parola) continue;
      const prova = riga ? riga + ' ' + parola : parola;
      if (pdfLarghezza(prova, size, bold) <= w) { riga = prova; continue; }
      if (riga) out.push(riga);
      if (pdfLarghezza(parola, size, bold) <= w) { riga = parola; continue; }
      let pezzo = '';
      for (const ch of parola) {
        if (pdfLarghezza(pezzo + ch, size, bold) > w) { out.push(pezzo); pezzo = ''; }
        pezzo += ch;
      }
      riga = pezzo;
    }
    out.push(riga);
  }
  return out;
}

/**
 * Da pagine a file. Gli oggetti sono numerati da 1, e la tabella xref in
 * fondo dice a che byte comincia ognuno: e' l'unico punto in cui sbagliare di
 * un byte rende il file illeggibile, quindi le posizioni si contano sulla
 * stringa gia' costruita invece di stimarle.
 */
function pdfAssembla(pagine, W, H) {
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };

  const nPag = Math.max(1, pagine.length);
  const idPagine = 2;
  const idF1 = 3, idF2 = 4;
  // 1 catalogo, 2 albero delle pagine, 3-4 font, poi due oggetti per pagina
  const idPag = i => 5 + i * 2, idCont = i => 6 + i * 2;

  add(`<< /Type /Catalog /Pages ${idPagine} 0 R >>`);
  add(`<< /Type /Pages /Count ${nPag} /Kids [${
    Array.from({ length: nPag }, (_, i) => `${idPag(i)} 0 R`).join(' ')}] >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  for (let i = 0; i < nPag; i++) {
    const cont = (pagine[i] || []).join('\n');
    add(`<< /Type /Page /Parent ${idPagine} 0 R /MediaBox [0 0 ${pdfN(W)} ${pdfN(H)}] `
      + `/Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R >> >> `
      + `/Contents ${idCont(i)} 0 R >>`);
    add(`<< /Length ${cont.length} >>\nstream\n${cont}\nendstream`);
  }

  let file = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const off = [];
  objs.forEach((o, i) => {
    off.push(file.length);
    file += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of off) file += String(o).padStart(10, '0') + ' 00000 n \n';
  file += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const b = new Uint8Array(file.length);
  for (let i = 0; i < file.length; i++) b[i] = file.charCodeAt(i) & 0xFF;
  return b;
}

/** Come download(), ma per byte veri invece che per testo. */
function scaricaPdf(nome, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = el('a'); a.href = url; a.download = nome;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
