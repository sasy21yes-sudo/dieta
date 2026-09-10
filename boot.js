// Semina un archivio d'esempio e porta l'app dove serve guardarla.
(function () {
  const oggi = new Date();
  const key = d => d.toISOString().slice(0, 10);
  const log = {};
  for (let i = 0; i < 40; i++) {
    const d = new Date(oggi); d.setDate(d.getDate() - i);
    const k = key(d);
    log[k] = {
      peso: 69.4 + Math.sin(i / 3) * .5 + i * .02,
      acqua: i === 0 ? 1.45 : 2 + (i % 3) * .3,
      sorsi: i === 0 ? [250, 500, 200, 500] : undefined,
      coca: i % 4 === 0 ? 1 : 0,
      passi: 7000 + (i % 5) * 900,
      sonno: 6.5 + (i % 4) * .4,
      allenato: i % 2 === 0,
      fame: 3, energia: 4, aderenza: 4,
      pasti: {}, extra: []
    };
    if (log[k].sorsi === undefined) delete log[k].sorsi;
  }
  localStorage.setItem('dieta.profili', JSON.stringify(
    { attivo: 'p1', lista: [{ id: 'p1', nome: 'Prova' }] }));
  localStorage.setItem('dieta.v1:p1', JSON.stringify({
    log,
    settings: { pianoBase: 'esempio', moduli: { piano: true, hyrox: false } },
    piano: {}, palestra: {}, model: {}
  }));
})();
