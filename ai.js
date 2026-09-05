/* =========================================================== chiamate all'AI
 *
 * **Solo la classe.** Niente configurazione, niente chiavi, niente interfaccia:
 * qui c'e' il modo di *comporre* una domanda e di *validare* una risposta, e
 * nient'altro. Finche' nessuno chiama `configura()` ogni richiesta si ferma
 * con un errore che lo dice, invece di partire verso un indirizzo inventato.
 *
 * Tre vincoli di questo progetto la disegnano, e vengono prima di qualunque
 * comodita':
 *
 * 1. **Non c'e' un server, quindi non c'e' un posto dove nascondere una
 *    chiave.** E' lo stesso motivo per cui ExerciseDB e API Ninjas sono state
 *    scartate: una chiave nel codice della pagina e' una chiave regalata. La
 *    classe percio' non la chiede e non la conserva — `configura()` prende un
 *    **trasporto**, cioe' una funzione che qualcun altro fornira'. Che sia un
 *    Cloudflare Worker, un proxy o un incollaggio a mano non la riguarda.
 * 2. **Niente si applica da solo.** Ogni compito restituisce una
 *    **proposta**: un testo da leggere e un elenco di `azioni` gia' pronte,
 *    che pero' le esegue qualcun altro dopo un tocco. E' la stessa regola del
 *    target ricalibrato — cambiare di nascosto il metro con cui l'app giudica
 *    le giornate vuol dire che un giorno buono diventa storto senza che
 *    l'utente abbia fatto niente di diverso.
 * 3. **Un valore nutrizionale scritto da un modello e' una `stima`.** Mai
 *    `verificato`: quello e' riservato a chi ha letto l'etichetta sulla
 *    confezione. Vale gia' per Open Food Facts, e un modello che genera numeri
 *    plausibili ne ha ancora piu' bisogno.
 *
 * E le regole di prodotto dell'app non sono suggerimenti al modello: sono
 * **filtri in uscita**. `REGOLE` finisce nel prompt, ma `valida()` ricontrolla
 * quello che torna, perche' un modello che ignora un'istruzione e' un caso
 * normale e non un incidente.
 */

/** Cosa non si fa, mai. Va nel prompt e si ricontrolla sulla risposta. */
const AI_REGOLE = [
  'Non dare punteggi al cibo e non dividerlo in buono e cattivo.',
  'Non proporre di saltare pasti, digiunare o compensare uno sgarro: il '
    + 'bilancio e\' settimanale.',
  'Non dare date di arrivo ne\' conti alla rovescia su un obiettivo di peso.',
  'Non presentare come misurato cio\' che e\' stimato, e dire sempre da dove '
    + 'viene un numero.',
  'Non scendere sotto il pavimento calorico dichiarato nel contesto.',
  'Tono descrittivo, mai colpevolizzante.',
  'Rispondi in italiano e **solo** con il JSON richiesto, senza commenti.'
];

/** Le parole che, in una risposta, tradiscono una regola violata. */
const AI_VIETATE = [
  /* "salta **la** cena" sfuggiva a `(il\s+)?`: fra il verbo e il pasto ci puo'
     stare un articolo, un possessivo o niente, e in italiano sono tanti. Si
     lascia passare qualunque cosa corta invece di provare a elencarli — e il
     confine e' la punteggiatura, o "salta questa riga del piano. La cena..."
     verrebbe bloccato per due frasi diverse. */
  /\bsalt(a|are|ando|ate|i)\b[^.!?]{0,16}\b(pasto|pasti|pranzo|cena|colazione|spuntino)\b/i,
  /\bdigiun/i,
  /\bcompensa(re|zione|ndo)\b/i,
  /\bcibo\s+(cattivo|proibito|sporco)/i,
  /\b(junk|schifezz)/i
];

/**
 * Un compito e' una domanda con una forma di risposta.
 *
 * `contesto` dice **quali fette** dei dati dell'utente servono, e non e' un
 * dettaglio di implementazione: e' la sola cosa che decide quanto di un
 * diario esce dal telefono. Il default e' il minimo che serve a rispondere.
 */
const AI_COMPITI = {
  valutaPiano: {
    n: 'Valuta il piano alimentare',
    contesto: ['profilo', 'target', 'settimana', 'obiettivo'],
    schema: { verdetto: 'string', osservazioni: ['string'], azioni: [] },
    chiedi: 'Guarda il piano settimanale e di\' se regge: giorno per giorno le '
      + 'calorie e la ripartizione dei macro, la distanza dal target, e la '
      + 'direzione rispetto all\'obiettivo dichiarato. Non riscrivere il piano: '
      + 'dillo e basta.'
  },
  modificaPiano: {
    n: 'Proponi una modifica al piano',
    contesto: ['profilo', 'target', 'settimana', 'ricette', 'obiettivo'],
    schema: { verdetto: 'string', azioni: ['assegnaPasto'] },
    chiedi: 'Proponi le modifiche minime alla settimana per avvicinarla al '
      + 'target, usando **solo** le ricette che esistono gia\'. Ogni modifica '
      + 'e\' un\'azione "assegnaPasto" con giorno, slot e codice ricetta.'
  },
  nuovaRicetta: {
    n: 'Componi una ricetta',
    contesto: ['profilo', 'target', 'alimenti'],
    schema: { verdetto: 'string', azioni: ['creaRicetta'] },
    chiedi: 'Componi una ricetta con gli alimenti dell\'elenco, pesati in '
      + 'grammi. Non inventare alimenti che non ci sono e non scrivere i macro: '
      + 'li calcola l\'app dagli ingredienti.'
  },
  nuovoAlimento: {
    n: 'Aggiungi un alimento',
    contesto: ['alimenti'],
    schema: { verdetto: 'string', azioni: ['creaAlimento'] },
    chiedi: 'Dai i valori per 100 g o 100 ml: kcal, proteine, carboidrati, '
      + 'grassi, fibre. Sono valori di tabella, quindi una stima.'
  },

  /* I tre che si fanno con un tocco. Portano tutti il **periodo**: "come sta
     andando" senza dire da quando a quando non e' una domanda, e la risposta
     cambierebbe di significato ogni giorno senza che si veda perche'. */
  valutaAndamento: {
    n: 'Come sta andando',
    contesto: ['profilo', 'target', 'obiettivo', 'periodo', 'previsioni'],
    schema: { verdetto: 'string', osservazioni: ['string'], azioni: [] },
    chiedi: 'Guarda il periodo: quanto e\' completo il registro, le medie '
      + 'contro i target, come si e\' mosso il peso e quanto ci si e\' '
      + 'allenati. Di\' come sta andando e su cosa ti basi. Il registro viene '
      + 'per primo: una media su pochi giorni vale poco, e va detto.'
  },
  criticita: {
    n: 'Cosa non va',
    contesto: ['profilo', 'target', 'obiettivo', 'periodo', 'settimana'],
    schema: { verdetto: 'string', osservazioni: ['string'], azioni: [] },
    chiedi: 'Elenca le criticita\' in ordine di gravita\', al massimo cinque, '
      + 'e per ognuna scrivi il numero da cui la vedi. Poi indica **una** cosa '
      + 'sola da cambiare: cambiarne cinque insieme rende impossibile capire '
      + 'cosa ha funzionato.'
  },
  domandaLibera: {
    n: 'La tua domanda',
    contesto: ['profilo', 'target', 'obiettivo', 'periodo', 'settimana'],
    schema: { verdetto: 'string', osservazioni: ['string'], azioni: [] },
    chiedi: 'Rispondi alla domanda qui sotto usando i dati del contesto. Se il '
      + 'contesto non basta a rispondere, dillo invece di supporre.'
  }
};

/**
 * Le domande che si fanno con un tocco, nell'ordine in cui vengono in mente:
 * prima il piano (e' un modello, si guarda quando lo scrivi), poi l'andamento
 * (e' un fatto, si guarda dopo), poi cosa non va.
 */
const AI_RAPIDE = ['valutaPiano', 'valutaAndamento', 'criticita'];

class AI {
  constructor() {
    this.trasporto = null;      // (richiesta) => Promise<string>
    this.modello = null;
  }

  /** Configurata quando qualcuno le ha dato un modo di parlare con il mondo. */
  get pronta() { return typeof this.trasporto === 'function'; }

  /**
   * L'unico punto in cui entra il mondo esterno.
   *
   * Non prende una chiave e non prende un URL: prende una **funzione**. Chi la
   * fornisce decide dove passa la richiesta e con quali credenziali, e la
   * classe non le vede mai. Senza server questa e' l'unica forma onesta:
   * qualunque cosa la classe conservasse starebbe nel codice della pagina.
   */
  configura({ trasporto, modello } = {}) {
    if (trasporto != null && typeof trasporto !== 'function')
      throw new TypeError('AI.configura: `trasporto` deve essere una funzione');
    this.trasporto = trasporto || null;
    this.modello = modello || null;
    return this;
  }

  /** I compiti che sa fare, per chi deve disegnare un menu. */
  static compiti() {
    return Object.entries(AI_COMPITI).map(([id, c]) => ({ id, n: c.n, contesto: c.contesto }));
  }

  /**
   * Le fette di dati che un compito porta con se'.
   *
   * Va tenuto **piccolo**, e non per il costo: e' roba che esce dal telefono.
   * Il diario non c'e' e non ci deve entrare per sbaglio — se un compito ne
   * avesse bisogno andrebbe aggiunto qui, di proposito e con un nome.
   */
  contesto(quali = [], opz = {}) {
    const c = {};
    const q = new Set(quali);
    /* Il periodo arriva da fuori e non si sceglie qui: e' quello della scheda
       Andamento, l'unico che l'app ha. Due selettori per lo stesso concetto
       sono l'errore gia' pagato una volta con il PDF del resoconto. */
    const per = opz.per
      || (typeof revPeriodoAttivo === 'function' ? revPeriodoAttivo() : null);
    if (q.has('profilo')) c.profilo = {
      eta: D.profilo?.eta ?? null, sesso: D.profilo?.sesso ?? null,
      altezza_cm: D.profilo?.altezza_cm ?? null,
      peso_kg: typeof lastWeight === 'function' ? lastWeight() : null
    };
    if (q.has('target')) {
      c.target = { ...D.target };
      if (typeof pavimentoCalorico === 'function') {
        const p = pavimentoCalorico();
        c.pavimento_kcal = p?.pavimento ?? null;
      }
    }
    if (q.has('obiettivo') && typeof obiettivoAttivo === 'function') {
      const o = obiettivoAttivo();
      c.obiettivo = o ? { id: o.id, nome: o.n, pct_peso_settimana: o.pct } : null;
    }
    if (q.has('settimana')) c.settimana = (D.settimana || []).map(g => ({
      giorno: g.giorno,
      pasti: (g.pasti || []).map(s => {
        const p = typeof pasto === 'function' ? pasto(s.codice) : null;
        return { slot: s.slot, ora: s.ora || null,
                 ricetta: p?.nome || null, codice: s.codice || null,
                 kcal: p?.macro?.kcal ?? null };
      }),
      totali: g.totali
    }));
    if (q.has('ricette')) c.ricette = Object.entries(D.pasti || {}).map(([id, p]) => ({
      codice: id, nome: p.nome,
      ingredienti: (p.ingredienti || []).map(i => `${i.alimento} ${i.qta}`),
      macro: p.macro
    }));
    if (q.has('alimenti')) c.alimenti = Object.entries(D.alimenti || {})
      .map(([nome, a]) => ({ nome, unita: a.unita || 'g', kcal: a.kcal,
                             p: a.p, c: a.c, g: a.g, fibre: a.fibre,
                             fonte: a.fonte }));

    /* Il periodo: **numeri gia' aggregati, non il diario.** La regola di
       questo file e' che il diario non esce dal telefono, e non cambia
       perche' la domanda e' "come sta andando": a rispondere servono le
       medie, il registro e il ritmo, non i singoli giorni. Sono gli stessi
       conti del resoconto in PDF, chiesti alle stesse funzioni — due versioni
       degli stessi numeri prima o poi divergono. */
    if (q.has('periodo') && per) {
      const nn = (v, d2 = 1) => (v == null || isNaN(v)) ? null : +(+v).toFixed(d2);
      const reg = typeof statRegistro === 'function' ? statRegistro(per) : null;
      const mac = typeof statMacro === 'function' ? statMacro(per) : null;
      const pes = typeof statPeso === 'function' ? statPeso(per) : null;
      const all = typeof statAllenamento === 'function' ? statAllenamento(per) : null;
      const pas = typeof statPasti === 'function' ? statPasti(per) : null;
      c.periodo = {
        da: per.da, a: per.a, giorni: per.n,
        registro: reg && { giorni_con_qualcosa: reg.registrati, pesate: reg.pesate,
                           giorni_con_pasti: reg.conPasti, in_pausa: reg.inPausa },
        medie: mac && { kcal: nn(mac.kcal, 0), p: nn(mac.p), c: nn(mac.c),
                        g: nn(mac.g), fibre: nn(mac.fibre),
                        quote_pct: { p: nn(mac.quotaP, 0), c: nn(mac.quotaC, 0),
                                     g: nn(mac.quotaG, 0) },
                        p_per_kg: nn(mac.pPerKg, 2), g_per_kg: nn(mac.gPerKg, 2),
                        su_giorni: mac.giorni },
        peso: pes && pes.primo ? { primo: nn(pes.primo.v), ultimo: nn(pes.ultimo.v),
                                   tendenza_kg_settimana: nn(pes.kgSettimana, 2),
                                   pesate: pes.pesate } : null,
        allenamento: all && { sedute: all.totali, serie: nn(all.serie),
                              tonnellaggio_kg: nn(all.tonnellaggio, 0),
                              sedute_settimana: nn(all.seduteSettimana, 1) },
        pasti: pas && pas.piuSaltato
          ? { piu_saltato: pas.piuSaltato.nome,
              spuntato_su_previsti: pas.piuSaltato.spuntati + '/' + pas.piuSaltato.previsti }
          : null
      };
    }

    /* Le proiezioni: dove porta il ritmo di adesso, con la banda. Mai una
       data di arrivo — sta gia' fra le regole, ma qui il numero proprio non
       esiste. */
    if (q.has('previsioni')) {
      const n1 = (v, d2 = 1) => (v == null || isNaN(v)) ? null : +(+v).toFixed(d2);
      const pr = {};
      /* Il dispendio del filtro di Kalman, che e' misurato sul bilancio e non
         preso da una formula. Va detto: e' il numero da cui nasce mezza app. */
      if (typeof energyModel === 'function') {
        const E = energyModel();
        if (E && E.tdee > 0) pr.dispendio_stimato_kcal =
          { valore: Math.round(E.tdee), su_osservazioni: E.n || 0 };
      }
      if (typeof proiezioneComposizione === 'function') {
        const pc = proiezioneComposizione();
        pr.composizione_fra_28_giorni = pc && pc.ok
          ? { grasso_pct: n1(pc.bf), massa_magra_kg: n1(pc.lbm),
              massa_grassa_kg: n1(pc.fm), delta_grasso_pct: n1(pc.dBf),
              delta_massa_magra_kg: n1(pc.dLbm) }
          : { non_calcolabile: pc?.perche || 'dati insufficienti' };
      }
      /* `piatta` e `r2` viaggiano perche' senza di loro una retta tirata
         dentro una nuvola sembra una previsione, ed e' l'errore che questo
         progetto evita ovunque. */
      if (typeof proiezioneMisura === 'function') pr.misure_fra_28_giorni =
        (D.misure || []).map(m => {
          const x = proiezioneMisura(m.id);
          return x && x.ok
            ? { misura: m.label || m.id, ora: n1(x.ora), fra_28_giorni: n1(x.fra),
                banda: n1(x.banda), cm_settimana: n1(x.cmSettimana, 2),
                r2: n1(x.r2, 2), ferma: !!x.piatta, rilevazioni: x.n }
            : null;
        }).filter(Boolean);
      if (Object.keys(pr).length) c.previsioni = pr;
    }
    return c;
  }

  /** La richiesta, pronta da spedire. Non spedisce niente. */
  richiesta(compito, dati = {}) {
    const c = AI_COMPITI[compito];
    if (!c) throw new Error('AI: compito sconosciuto "' + compito + '"');
    const sistema = 'Sei dentro un\'app di alimentazione e allenamento. '
      + 'Regole non negoziabili:\n- ' + AI_REGOLE.join('\n- ')
      + '\n\nRispondi con un oggetto JSON con queste chiavi: '
      + Object.keys(c.schema).join(', ') + '. '
      + '`azioni` e\' un elenco di oggetti `{ tipo, ... }`; se non ne servono, '
      + 'lascialo vuoto.';
    return {
      modello: this.modello,
      compito,
      sistema,
      utente: [c.chiedi, dati.domanda || '',
        'Contesto:', JSON.stringify(this.contesto(c.contesto, dati), null, 1)]
        .filter(Boolean).join('\n\n')
    };
  }

  /**
   * La stessa richiesta, ma da leggere.
   *
   * Finche' non c'e' un trasporto questa non e' una funzione di servizio: e'
   * **quello che l'assistente consegna**. Una domanda gia' scritta, con
   * dentro i propri numeri, da incollare dove si vuole — piu' onesto di una
   * schermata che finge di rispondere, e piu' utile di un messaggio che dice
   * soltanto "non configurato".
   */
  testoRichiesta(r) {
    return '[SISTEMA]\n' + r.sistema + '\n\n[DOMANDA]\n' + r.utente;
  }

  /**
   * Chiede, e restituisce una **proposta** — mai una modifica.
   *
   * Offline non ci prova nemmeno: quest'app funziona senza rete per scelta, e
   * un errore di trasporto dopo dieci secondi e' peggio di un no immediato.
   */
  async chiedi(compito, dati = {}) {
    if (!this.pronta) {
      const e = new Error('L\'assistente non e\' configurato: manca un trasporto.');
      e.codice = 'AI_NON_CONFIGURATA';
      throw e;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const e = new Error('Serve la rete: l\'assistente e\' l\'unica parte '
        + 'dell\'app che non funziona offline.');
      e.codice = 'AI_OFFLINE';
      throw e;
    }
    const grezzo = await this.trasporto(this.richiesta(compito, dati));
    return this.valida(compito, grezzo);
  }

  /**
   * Quello che torna non e' una risposta finche' non ha passato di qui.
   *
   * Un modello che ignora un'istruzione e' un caso **normale**: le regole
   * stanno nel prompt ma si ricontrollano qui, e i numeri nutrizionali passano
   * dallo stesso `coerenza()` che usa Open Food Facts — sotto il 15% va bene,
   * oltre il 30% qualcuno ha sbagliato a scrivere.
   */
  valida(compito, grezzo) {
    const c = AI_COMPITI[compito];
    let o = grezzo;
    if (typeof o === 'string') {
      const i = o.indexOf('{'), j = o.lastIndexOf('}');
      if (i < 0 || j < i) throw new Error('AI: la risposta non contiene un oggetto JSON.');
      o = JSON.parse(o.slice(i, j + 1));
    }
    if (!o || typeof o !== 'object') throw new Error('AI: risposta vuota.');

    const avvisi = [];
    const testo = String(o.verdetto || '');
    for (const re of AI_VIETATE)
      if (re.test(testo) || (o.osservazioni || []).some(x => re.test(String(x))))
        avvisi.push('La risposta tocca una cosa che questa app non dice: '
          + 'l\'ho tenuta fuori.');

    const azioni = [];
    for (const a of (Array.isArray(o.azioni) ? o.azioni : [])) {
      const v = this._azione(a, avvisi);
      if (v) azioni.push(v);
    }
    return {
      compito, n: c.n,
      verdetto: avvisi.length ? '' : testo,
      osservazioni: avvisi.length ? [] : (o.osservazioni || []).map(String),
      azioni, avvisi, grezzo,
      /* Nessuno di questi campi e' stato scritto da nessuna parte: la proposta
         si applica altrove, dopo un tocco. */
      applicata: false
    };
  }

  /** Una singola azione proposta, ripulita. `null` = si butta. */
  _azione(a, avvisi) {
    if (!a || typeof a !== 'object') return null;
    const push = m => { avvisi.push(m); return null; };
    switch (a.tipo) {
      case 'creaAlimento': {
        const n = String(a.nome || '').trim().toLowerCase();
        if (!n) return push('Un alimento senza nome: scartato.');
        const v = ['kcal', 'p', 'c', 'g', 'fibre']
          .reduce((o2, x) => (o2[x] = +a[x] || 0, o2), {});
        if (!(v.kcal > 0)) return push(`"${n}": niente calorie, scartato.`);
        const co = typeof coerenza === 'function' ? coerenza(v) : { stato: 'ok' };
        if (co.stato === 'incoerente')
          return push(`"${n}": ${co.d} Scartato.`);
        return { tipo: 'creaAlimento', nome: n, valori: v,
                 unita: a.unita === 'ml' ? 'ml' : 'g',
                 categoria: String(a.categoria || '').trim().toLowerCase() || null,
                 /* Mai `verificato`: quello vale per chi ha letto l'etichetta. */
                 fonte: 'stima',
                 dubbio: co.stato === 'dubbio' ? co.d : null };
      }
      case 'creaRicetta': {
        const nome = String(a.nome || '').trim();
        const ing = (Array.isArray(a.ingredienti) ? a.ingredienti : [])
          .map(i => ({ alimento: String(i.alimento || '').trim().toLowerCase(),
                       qta: +i.qta || 0 }))
          .filter(i => i.alimento && i.qta > 0);
        if (!nome || !ing.length) return push('Una ricetta senza nome o senza ingredienti.');
        const fuori = ing.filter(i => !(typeof alimento === 'function' && alimento(i.alimento)));
        if (fuori.length) return push(`"${nome}": ${fuori.map(i => i.alimento).join(', ')} `
          + 'non e\' fra i tuoi alimenti. Scartata.');
        return { tipo: 'creaRicetta', nome, ingredienti: ing,
                 macro: typeof macroDaIngredienti === 'function'
                   ? macroDaIngredienti(ing) : null };
      }
      case 'assegnaPasto': {
        const gi = +a.giorno;
        if (!(gi >= 0 && gi <= 6)) return push('Un giorno fuori dalla settimana.');
        if (a.codice && typeof pasto === 'function' && !pasto(a.codice))
          return push(`La ricetta "${a.codice}" non esiste.`);
        return { tipo: 'assegnaPasto', giorno: gi, slot: String(a.slot || ''),
                 codice: a.codice || null };
      }
      default:
        return push('Azione di tipo sconosciuto: ' + JSON.stringify(a.tipo));
    }
  }
}

/* L'istanza che l'app usera'. Non e' configurata, e finche' non lo e' ogni
   richiesta si ferma dicendolo: e' voluto, la configurazione non fa parte di
   questo passo. */
const ai = new AI();
