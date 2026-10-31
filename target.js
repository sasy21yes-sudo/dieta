/* La rampa delle fibre.
 *
 * Questo file conteneva anche "il target che si ricalibra sul dispendio": una
 * seconda proposta di calorie (dalla matrice `regole_calorie`) e un secondo
 * elenco di ritmi. Nel passo "Quanto mangiare" stavano accanto alla proposta
 * dell'obiettivo — che parte gia' dal dispendio misurato — e le due si
 * contraddicevano: una diceva di scendere a 2050, l'altra di salire a 2682.
 * Segnalato come "dal profilo non si capisce mai il target, stanno 300 dati
 * diversi". La proposta adesso e' una sola, quella dell'obiettivo
 * (`pianoCalorico()`), e quando il ritmo vero non e' quello scelto lo dice Il
 * mese, che porta qui.
 */
'use strict';

/**
 * Le fibre non si triplicano in una settimana.
 *
 * Il piano ne prevede 38 g e chi arriva da un'alimentazione normale sta fra i
 * 15 e i 20. Passare dagli uni agli altri di colpo non e' pericoloso, ma
 * produce una settimana di gonfiore e crampi che fa mollare un piano che per
 * il resto funzionava. Cinque grammi a settimana e' il passo che viene
 * comunemente consigliato, insieme all'acqua: le fibre senza acqua peggiorano
 * le cose invece di migliorarle, ed e' il motivo per cui la carta le nomina
 * tutte e due.
 */
function rampaFibre(k = today()) {
  const gg = windowDays(k, 14);
  const cons = gg.map(x => S.log[x] ? consumed(x) : null)
    .filter(m => m && m.kcal > 400);
  if (cons.length < 4) return null;
  const ora = avg(cons.map(m => m.fibre));
  const tgt = D.target.fibre;
  if (!(tgt > 0) || ora == null) return null;
  const salto = tgt - ora;
  if (salto <= 5) return null;                 // niente rampa da consigliare
  const passi = Math.ceil(salto / 5);
  const acqua = D.target.acqua_l;
  const acquaOra = avg(gg.map(x => S.log[x]?.acqua));
  return {
    ora, tgt, salto, passi, prossimo: Math.round(ora + 5),
    acqua, acquaOra, acquaBassa: acquaOra != null && acquaOra < acqua * 0.8
  };
}

/** La carta della rampa fibre: compare solo quando il salto e' vero. */
function cardRampaFibre(k = today()) {
  const r = rampaFibre(k);
  if (!r) return null;
  const c = el('div', 'card');
  c.append(el('div', 'eyebrow', 'Fibre: sali per gradini'));
  c.append(el('div', 'muted',
    `Ne mangi <strong>${nf(r.ora, 1)} g</strong> al giorno e il target ne chiede `
    + `<strong>${nf(r.tgt)}</strong>: sono ${nf(r.salto, 1)} g di salto. Farlo in un colpo `
    + 'non e\' pericoloso, ma produce una settimana di gonfiore e crampi che fa mollare '
    + 'un piano che per il resto funzionava.'));
  c.append(el('div', 'hint',
    `Punta a <strong>${r.prossimo} g</strong> questa settimana, poi altri cinque la `
    + `prossima. Da dove sei ci arrivi in circa ${r.passi} settimane.`));
  if (r.acquaBassa) c.append(el('div', 'hint acciacco',
    `<strong>E bevi.</strong> Sei a ${nf(r.acquaOra, 1)} L contro ${nf(r.acqua, 1)}: `
    + 'le fibre senza acqua peggiorano le cose invece di migliorarle.'));
  return c;
}
