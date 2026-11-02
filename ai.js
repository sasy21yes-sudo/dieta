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

/**
 * Il nome vero di un alimento, a partire da come l'ha scritto un modello.
 *
 * I nomi delle risposte si mettono in minuscolo, e i tuoi alimenti no: "olio
 * EVO" scritto "olio evo" non lo trovava nessuno, e la ricetta veniva
 * scartata per un alimento che hai. Si cerca esatto, poi senza maiuscole ne'
 * accenti; `extra` sono quelli creati nella stessa risposta.
 */
const aiNorm = x => String(x || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').trim();
function aiNomeAlimento(n, extra) {
  if (!n) return null;
  if (extra?.has(n) || D.alimenti?.[n]) return n;
  const k = aiNorm(n);
  for (const x of [...(extra ? extra.keys() : []), ...Object.keys(D.alimenti || {})])
    if (aiNorm(x) === k) return x;
  return null;
}

/**
 * Toglie i campi vuoti. Un `"fame_1_5": null` non dice niente a chi legge, e
 * la regola di questo file e' che un dato che manca **si dichiara** con una
 * nota, non si lascia nudo: le fette che lo usano aggiungono la loro.
 */
function aiSenzaNull(o) {
  if (Array.isArray(o)) return o.map(aiSenzaNull);
  if (!o || typeof o !== 'object') return o;
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v != null) r[k] = aiSenzaNull(v);
  return r;
}

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
  /*
   * Un piatto da una foto.
   *
   * E' l'unico compito che porta con se' **un'immagine**, e per questo e'
   * anche l'unico che non si puo' consegnare come testo da incollare: la
   * foto va allegata a mano. `contesto` resta minimo — quanto e' rimasto
   * della giornata, che e' cio' che rende la stima utile invece che
   * generica — e non ci va il diario.
   */
  stimaPasto: {
    n: 'Stima un piatto da una foto',
    contesto: ['profilo', 'target', 'giorno'],
    immagine: true,
    schema: { verdetto: 'string', osservazioni: ['string'], azioni: ['pastoDaFoto'] },
    chiedi: 'Guarda la foto e riconosci **gli alimenti che vedi, uno per uno**, '
      + 'non il piatto come blocco unico: per ognuno il nome in italiano, la '
      + 'quantita\' in grammi (o ml se e\' un liquido) e i valori **per 100 g**, '
      + 'cioe\' kcal, proteine, carboidrati, grassi e fibre. Restituisci una sola '
      + 'azione "pastoDaFoto" con `nome` (come chiameresti il piatto) e '
      + '`alimenti`. La quantita\' e\' quella che si vede nella foto: se non '
      + 'riesci a stimarla, dillo in `osservazioni` e metti la porzione piu\' '
      + 'comune per quell\'alimento. In `verdetto` scrivi in una riga cosa hai '
      + 'riconosciuto e quanto sei sicuro.'
  },
  /*
   * Una settimana intera, da capo.
   *
   * E' il compito che porta **piu' contesto** di tutti, e di proposito: un
   * piano scritto senza sapere come mangi davvero, quanto ti alleni e cosa
   * non ti piace e' un piano generico, cioe' uno che non si segue. Esce
   * tutto **gia' aggregato** — medie, conteggi, le ricette piu' spuntate —
   * mai il diario giorno per giorno.
   *
   * La risposta e' tre tipi di azione che l'app conosce gia' (alimenti,
   * ricette, assegnazioni) e passa da `validaSettimana()`, che le guarda
   * **insieme**: una ricetta puo' usare un alimento creato due righe sopra,
   * e un giorno si giudica solo quando ha tutti i suoi pasti.
   */
  generaSettimana: {
    n: 'Genera un piano settimanale',
    contesto: ['profilo', 'target', 'obiettivo', 'struttura', 'settimana', 'ricette',
               'alimenti', 'abitudini', 'attivita', 'corpo', 'preferenze'],
    schema: { verdetto: 'string', osservazioni: ['string'],
              azioni: ['creaAlimento', 'creaRicetta', 'assegnaPasto'] },
    chiedi: d => {
      const modo = {
        salvati: 'Usa **solo** gli alimenti di `alimenti` e le ricette di `ricette`. '
          + 'Puoi comporre ricette nuove, ma soltanto con quegli alimenti: non creare alimenti.',
        misto: 'Parti dagli alimenti e dalle ricette che ho gia\' (`alimenti`, `ricette`); '
          + 'aggiungi alimenti e ricette nuovi solo dove servono per varieta\', gusti o target.',
        nuovi: 'Pensa ricette nuove. Se un alimento che ti serve e\' gia\' in `alimenti`, '
          + 'usa quel nome esatto; se no crealo. Le ricette di `ricette` puoi non usarle.'
      }[d.modo || 'misto'];
      return 'Componi il piano alimentare di una settimana intera: per ognuno dei 7 giorni '
        + 'di `struttura`, una ricetta per **ogni** pasto, con gli stessi pasti e orari.\n\n'
        + 'Da dove partire: ' + modo + '\n\n'
        + 'I numeri: ogni giorno entro il 5% di `target.kcal`, proteine almeno `target.p`, '
        + 'mai sotto `pavimento_kcal`; almeno `target.min_p_per_pasto` g di proteine a '
        + 'colazione, pranzo e cena; fibre vicino a `target.fibre`. Se c\'e\' '
        + '`obiettivo.proposta_app`, e\' la ripartizione che l\'app stessa propone per '
        + 'quell\'obiettivo. Nei giorni con un allenamento in `struttura.attivita` puoi '
        + 'spostare un po\' di carboidrati verso il pasto prima o dopo.\n\n'
        + 'Adatta il piano alla persona: `abitudini` dice come mangia davvero (cosa spunta, '
        + 'cosa salta, cosa mangia fuori piano), `attivita` quanto si allena, `corpo` '
        + 'come si muove il peso. Un piano che somiglia a come si mangia gia\' e\' un piano '
        + 'che si segue: tieni i pasti che spunta sempre, cambia quelli che salta.\n\n'
        + 'I gusti: usa spesso `preferenze.di_piu`, al massimo due volte a settimana '
        + '`preferenze.di_meno`, **mai** `preferenze.mai`. Rispetta `preferenze.note`. '
        + 'La stessa ricetta al massimo tre volte a settimana, salvo un pasto che le '
        + 'abitudini mostrano sempre uguale.\n\n'
        + 'Le azioni, in quest\'ordine:\n'
        + '- `{"tipo":"creaAlimento","nome":"tempeh","unita":"g","categoria":"legumi",'
        + '"kcal":192,"p":20.3,"c":7.6,"g":10.8,"fibre":5}` per ogni alimento nuovo, '
        + 'valori per 100 g (o 100 ml) da tabella;\n'
        + '- `{"tipo":"creaRicetta","codice":"ai-bowl-tempeh","nome":"Bowl di tempeh e riso",'
        + '"ingredienti":[{"alimento":"tempeh","qta":120},{"alimento":"riso basmati","qta":80}]}` '
        + 'per ogni ricetta nuova: grammi (o ml), nessun macro (li calcola l\'app), un '
        + '`codice` nuovo che comincia con "ai-";\n'
        + '- `{"tipo":"assegnaPasto","giorno":0,"slot":"Colazione","codice":"C1"}` per '
        + 'ogni pasto di ogni giorno: `giorno` e\' l\'indice in `struttura` (0 = il primo), '
        + '`slot` il nome del pasto com\'e\' scritto li\', `codice` una ricetta di '
        + '`ricette` o una creata qui.\n\n'
        + 'In `verdetto` l\'idea del piano in due righe; in `osservazioni` come hai usato '
        + 'abitudini, allenamento e gusti, e i compromessi che hai fatto.';
    }
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
      /* il peso di tendenza, non la pesata del giorno: e' quello con cui
         l'app fa i suoi conti (`pesoConti()`) */
      peso_kg: typeof pesoConti === 'function' ? +pesoConti().toFixed(1)
        : typeof lastWeight === 'function' ? lastWeight() : null
    };
    if (q.has('target')) {
      c.target = { ...D.target };
      /* Il dispendio va **sempre** insieme al target, ed e' il pezzo che
         mancava: la direzione in quest'app si misura sul dispendio e non sul
         target — che puo' essere vecchio o messo a mano — ed e' cosi' che la
         misura `controlloPiano()`. Senza, chi legge il contesto puo' solo
         confrontare con un numero scelto dall'utente. */
      if (typeof pavimentoCalorico === 'function') {
        const p = pavimentoCalorico();
        c.pavimento_kcal = p?.pavimento ?? null;
        /* `misurato` non e' un dettaglio: dice se quel numero viene dal
           filtro di Kalman sul bilancio vero o da Mifflin per il livello di
           attivita'. E' la stessa regola di tutta l'app — un numero si
           consegna con la sua provenienza. */
        if (p?.tdee > 0) c.dispendio_stimato_kcal =
          { valore: Math.round(p.tdee),
            da: p.misurato ? 'misurato sul bilancio (filtro di Kalman)'
                           : 'stimato con Mifflin-St Jeor, non ancora misurato' };
      }
    }
    /*
     * L'obiettivo, e **cosa si puo' dire lo stesso quando non c'e'.**
     *
     * Prima usciva un `"obiettivo": null` nudo, e chi legge il contesto
     * poteva solo rispondere "non essendo presente un obiettivo dichiarato
     * non si puo' dire se la direzione sia verso o lontano dall'obiettivo" —
     * che e' vero, ed era anche piu' povero di quello che l'app sa. Perche'
     * un obiettivo, in quest'app, **e' una posizione rispetto al dispendio**:
     * senza il nome resta comunque il numero, e la direzione si legge.
     */
    if (q.has('obiettivo')) {
      const o = typeof obiettivoAttivo === 'function' ? obiettivoAttivo() : null;
      c.obiettivo = o
        ? { scelto: true, id: o.id, nome: o.n, pct_peso_settimana: o.pct,
            /* quello che l'app stessa propone per quell'obiettivo: chi scrive un
               piano deve sapere da che numeri parte l'app, o i due si
               contraddicono */
            ...(typeof pianoCalorico === 'function' && q.has('struttura')
              ? { proposta_app: (({ kcal, p, c: cc, g, fibre }) => ({ kcal, p, c: cc, g, fibre }))(
                  pianoCalorico(o.id, o.pct).macro) } : {}) }
        : { scelto: false,
            nota: 'Nessun obiettivo dichiarato. La direzione si legge lo '
              + 'stesso: un obiettivo qui e\' una posizione rispetto al '
              + 'dispendio stimato, quindi di\' dove si trova la persona '
              + 'rispetto a quello invece di dire che non si puo\' dire.' };
      /* Dove sta il piano rispetto al dispendio: e' il numero che rende la
         frase sopra una cosa che si puo' fare, e non un invito. */
      if (typeof controlloPiano === 'function') {
        const cp = controlloPiano();
        if (cp && cp.pieni && cp.pav?.tdee > 0) c.piano_vs_dispendio = {
          media_kcal_piano: Math.round(cp.media),
          dispendio_kcal: Math.round(cp.pav.tdee),
          scarto_pct: +(((cp.media - cp.pav.tdee) / cp.pav.tdee) * 100).toFixed(1)
        };
      }
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

    /* La struttura della settimana: giorni, pasti e orari, e cosa si fa quel
       giorno. E' lo stampo da riempire. */
    if (q.has('struttura')) c.struttura = (D.settimana || []).map((g, i) => ({
      giorno: i, nome: g.giorno, attivita: g.attivita || null,
      pasti: (g.pasti || []).map(s => ({ slot: s.slot, ora: s.ora || null }))
    }));

    /* Le ultime quattro settimane, chiuse a ieri. Non il periodo di
       Andamento: per scrivere un piano serve come mangi **di solito**, non il
       tratto che stai guardando nei grafici. */
    const per28 = (q.has('abitudini') || q.has('attivita'))
      && typeof revPeriodoDate === 'function'
      ? revPeriodoDate(addDays(today(), -28), addDays(today(), -1)) : null;
    const n1 = (v, d2 = 1) => (v == null || isNaN(v)) ? null : +(+v).toFixed(d2);

    /* Come mangi davvero: **conteggi e medie**, non i giorni. Le ricette piu'
       spuntate e quelle saltate dicono cosa tenere e cosa cambiare meglio di
       qualunque descrizione. */
    if (q.has('abitudini') && per28) {
      const reg = typeof statRegistro === 'function' ? statRegistro(per28) : null;
      const mac = typeof statMacro === 'function' ? statMacro(per28) : null;
      const pas = typeof statPasti === 'function' ? statPasti(per28) : null;
      const ext = typeof statExtra === 'function' ? statExtra(per28, 8) : null;
      const abi = typeof statAbitudini === 'function' ? statAbitudini(per28) : null;
      const ri = typeof realIntake === 'function' ? realIntake() : null;
      c.abitudini = {
        finestra: '28 giorni fino a ieri',
        registro: reg && { giorni_con_qualcosa: reg.registrati, giorni_con_pasti: reg.conPasti,
                           pesate: reg.pesate, su_giorni: reg.giorni },
        introito_medio: mac && mac.giorni ? { kcal: n1(mac.kcal, 0), p: n1(mac.p), c: n1(mac.c),
          g: n1(mac.g), fibre: n1(mac.fibre), su_giorni: mac.giorni } : null,
        introito_dal_bilancio_kcal: ri != null ? Math.round(ri) : null,
        ricette_spuntate: pas ? pas.pasti.filter(r => r.previsti >= 2)
          .sort((a, b) => b.spuntati - a.spuntati).slice(0, 10)
          .map(r => ({ ricetta: r.nome, spuntata: r.spuntati, prevista: r.previsti })) : null,
        pasti_per_momento: pas ? pas.slot.map(r => ({ pasto: r.nome,
          spuntato_pct: r.quota == null ? null : Math.round(r.quota) })) : null,
        fuori_piano: ext && ext.voci.length ? {
          kcal_al_giorno: n1(ext.kcalGiorno, 0),
          voci: ext.voci.map(v => ({ nome: v.nome, volte: v.n, kcal_media: Math.round(v.kcal / v.n) }))
        } : null,
        acqua_l: n1(abi?.acqua), sonno_ore: n1(abi?.sonno), passi: n1(abi?.passi, 0),
        fame_1_5: n1(abi?.fame), energia_1_5: n1(abi?.energia)
      };
      if (!reg?.conPasti) c.abitudini.nota = 'Nessun pasto registrato nelle ultime quattro '
        + 'settimane: come mangia questa persona non si sa, e non va supposto.';
      c.abitudini = aiSenzaNull(c.abitudini);
    }

    /* Quanto ti alleni: le sedute, i minuti, la forza, e il livello di
       attivita' con cui l'app stima il dispendio finche' non l'ha misurato. */
    if (q.has('attivita')) {
      const gg = lastDays(addDays(today(), -1), 28);
      const A = typeof attivitaGiorni === 'function' ? attivitaGiorni(gg) : null;
      const st = per28 && typeof statAllenamento === 'function' ? statAllenamento(per28) : null;
      const L = typeof lafAttivo === 'function' ? lafAttivo() : null;
      c.attivita = {
        finestra: '28 giorni fino a ieri',
        livello: L ? { nome: L.livello?.n || null, fattore: L.laf,
          da: { scelto: 'scelto da chi usa l\'app', dati: 'dedotto da allenamenti e passi',
                modello: 'fattore di partenza del modello' }[L.fonte] } : null,
        sedute_settimana: st ? n1(st.seduteSettimana) : null,
        minuti_attivita_settimana: A ? n1(A.eq / 4, 0) : null,
        giorni_forza_settimana: A ? n1(A.forza / 4) : null,
        esercizi_piu_fatti: st?.esercizi?.length ? st.esercizi.map(e => e.nome) : null,
        cardio: st && st.cardioN ? { sedute: st.cardioN, minuti: n1(st.cardioMin, 0),
                                     km: n1(st.cardioKm) } : null,
        riferimenti: 'OMS: 150 minuti a settimana (uno intenso vale due) e 2 giorni di forza. '
          + 'Sono linee guida, non misure su questa persona.'
      };
      if (!st?.totali && !A?.sedute) c.attivita.nota = 'Nessun allenamento registrato nelle '
        + 'ultime quattro settimane: non vuol dire che non si alleni, vuol dire che non si sa.';
      c.attivita = aiSenzaNull(c.attivita);
    }

    /* Il corpo: la tendenza del peso, la composizione se c'e' una misura, e
       il fisico a cui punta. */
    if (q.has('corpo')) {
      const R = typeof ritmoPeso === 'function' ? ritmoPeso() : null;
      const co = typeof composizioneAl === 'function' ? composizioneAl(today()) : null;
      const tf = D.target_fisico;
      c.corpo = {
        peso_tendenza_kg: typeof trendW === 'function' ? n1(trendW(today())) : null,
        ritmo_kg_settimana: R?.ok ? { valore: n1(R.kgSett, 2), incertezza: n1(1.96 * R.se, 2),
                                       su_pesate: R.n } : { non_calcolabile: R?.perche || 'poche pesate' },
        composizione: co?.bf != null ? { grasso_pct: n1(co.bf), massa_magra_kg: n1(co.lbm),
          da: String(co.quando || '').startsWith('bia') ? 'bioimpedenza' : 'formula della Marina (circonferenze)' } : null,
        fisico_di_riferimento: tf?.nome ? { nome: tf.nome, peso_kg: tf.peso_kg ?? null,
                                            grasso_pct: tf.bf_pct ?? null } : null
      };
      if (c.corpo.peso_tendenza_kg == null) c.corpo.nota = 'Nessuna pesata: il peso non si conosce.';
      c.corpo = aiSenzaNull(c.corpo);
    }

    /* I gusti, come li ha scritti chi usa l'app. */
    if (q.has('preferenze')) {
      const pr = opz.preferenze || {};
      c.preferenze = aiSenzaNull({ di_piu: pr.di_piu || [], di_meno: pr.di_meno || [],
                                   mai: pr.mai || [], note: pr.note || null });
    }

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

    /* Il giorno, e **solo quanto ne resta**: e' il numero che rende una
       stima utile invece che generica ("stai a 1800 su 2482") senza portare
       fuori niente di piu' del totale del giorno. */
    if (q.has('giorno')) {
      const kk = opz.giorno || today();
      const cons = typeof consumed === 'function' ? consumed(kk) : null;
      const tg = typeof dayTarget === 'function' ? dayTarget(kk) : D.target;
      const r1 = (v) => v == null ? null : Math.round(v);
      c.giorno = { data: kk,
        gia_registrato: cons ? { kcal: r1(cons.kcal), p: r1(cons.p),
                                 c: r1(cons.c), g: r1(cons.g) } : null,
        target: tg ? { kcal: r1(tg.kcal), p: r1(tg.p), c: r1(tg.c), g: r1(tg.g) } : null,
        restano_kcal: cons && tg ? r1(tg.kcal - cons.kcal) : null };
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
      utente: [typeof c.chiedi === 'function' ? c.chiedi(dati) : c.chiedi, dati.domanda || '',
        'Contesto:', JSON.stringify(this.contesto(c.contesto, dati), null, 1)]
        .filter(Boolean).join('\n\n'),
      /* L'immagine viaggia a parte e non dentro il testo: ogni trasporto la
         infila nel suo formato — `image_url`, `inline_data`, un allegato — e
         quale sia non riguarda questa classe. `immagine` e' un data URL. */
      ...(c.immagine && dati.immagine ? { immagine: dati.immagine } : {})
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
    return this.valida(compito, grezzo, dati);
  }

  /**
   * Quello che torna non e' una risposta finche' non ha passato di qui.
   *
   * Un modello che ignora un'istruzione e' un caso **normale**: le regole
   * stanno nel prompt ma si ricontrollano qui, e i numeri nutrizionali passano
   * dallo stesso `coerenza()` che usa Open Food Facts — sotto il 15% va bene,
   * oltre il 30% qualcuno ha sbagliato a scrivere.
   */
  valida(compito, grezzo, dati = {}) {
    const c = AI_COMPITI[compito];
    let o = grezzo;
    if (typeof o === 'string') {
      const i = o.indexOf('{'), j = o.lastIndexOf('}');
      if (i < 0 || j < i) throw new Error('AI: la risposta non contiene un oggetto JSON.');
      o = JSON.parse(o.slice(i, j + 1));
    }
    if (!o || typeof o !== 'object') throw new Error('AI: risposta vuota.');

    /*
     * Due cose diverse, e per un po' erano lo stesso elenco.
     *
     * `vietato` e' una **regola rotta** — un pasto saltato, un cibo chiamato
     * cattivo — e li' il verdetto non si stampa affatto. `avvisi` sono le
     * cose scartate strada facendo: un ingrediente senza quantita', un
     * alimento con i macro che non tornano. Tenerli insieme voleva dire che
     * **un ingrediente buttato zittiva tutta la risposta**: misurato su una
     * foto con cinque alimenti di cui due illeggibili, il verdetto usciva
     * vuoto e chi guardava non capiva perche'.
     */
    const avvisi = [];
    let vietato = false;
    const testo = String(o.verdetto || '');
    for (const re of AI_VIETATE)
      if (re.test(testo) || (o.osservazioni || []).some(x => re.test(String(x)))) {
        vietato = true;
        avvisi.push('La risposta tocca una cosa che questa app non dice: '
          + 'l\'ho tenuta fuori.');
      }

    const azioni = [];
    let piano = null;
    if (compito === 'generaSettimana')
      piano = this.validaSettimana(Array.isArray(o.azioni) ? o.azioni : [], avvisi, dati);
    else for (const a of (Array.isArray(o.azioni) ? o.azioni : [])) {
      const v = this._azione(a, avvisi);
      if (v) azioni.push(v);
    }
    return {
      compito, n: c.n, piano,
      verdetto: vietato ? '' : testo,
      osservazioni: vietato ? [] : (o.osservazioni || []).map(String),
      azioni, avvisi, vietato, grezzo,
      /* Nessuno di questi campi e' stato scritto da nessuna parte: la proposta
         si applica altrove, dopo un tocco. */
      applicata: false
    };
  }

  /**
   * Una settimana generata, guardata **tutta insieme**.
   *
   * Le azioni da sole non bastano: una ricetta puo' usare un alimento creato
   * due righe sopra, che `alimento()` non conosce ancora, e un giorno si
   * giudica solo quando ha tutti i suoi pasti. Quindi tre giri, nell'ordine
   * in cui le cose dipendono l'una dall'altra:
   *
   * 1. gli **alimenti** nuovi, con lo stesso `coerenza()` di Open Food Facts,
   *    sempre `stima`. Uno che esiste gia' non si ricrea: vale il tuo;
   * 2. le **ricette** nuove, con gli ingredienti che esistono (tuoi o appena
   *    creati) e i macro rifatti dall'app, mai presi dal modello;
   * 3. le **assegnazioni**, sui pasti della struttura.
   *
   * E i gusti sono un filtro, non un consiglio: un ingrediente in "mai" butta
   * la ricetta, e se il pasto resta vuoto lo si dice. "Di meno" piu' di due
   * volte a settimana e' un avviso.
   */
  validaSettimana(lista, avvisi, dati = {}) {
    const norm = aiNorm;
    const pref = dati.preferenze || {};
    const tocca = (nome, voci) => {
      const n = norm(nome);
      return (voci || []).map(norm).filter(t => t.length >= 3)
        .find(t => n.includes(t) || t.includes(n)) || null;
    };
    const salvati = dati.modo === 'salvati';

    /* 1. gli alimenti */
    const nuovi = new Map();
    for (const a of lista.filter(x => x?.tipo === 'creaAlimento')) {
      if (salvati) { avvisi.push(`"${a.nome}": avevi chiesto solo i tuoi alimenti, scartato.`); continue; }
      const v = this._azione(a, avvisi);
      if (!v) continue;
      if (aiNomeAlimento(v.nome)) continue;   // c'e' gia': vale il tuo
      const no = tocca(v.nome, pref.mai);
      if (no) { avvisi.push(`"${v.nome}": e' fra quelli che non mangi mai (${no}), scartato.`); continue; }
      nuovi.set(v.nome, v);
    }
    const per100 = nome => nuovi.get(nome)?.valori
      || (typeof alimento === 'function' && D.alimenti?.[nome] ? alimento(nome) : null);
    const macroDi = ing => {
      const t = { kcal: 0, p: 0, c: 0, g: 0, fibre: 0 };
      for (const i of ing) {
        const a = per100(i.alimento);
        for (const x in t) t[x] += (a?.[x] || 0) * i.qta / 100;
      }
      for (const x in t) t[x] = Math.round(t[x] * 10) / 10;
      return t;
    };

    /* 2. le ricette. Una scartata si ricorda: i pasti che la usavano
       restano vuoti e finiscono nel conto dei vuoti, invece di dare un
       avviso ciascuno per la stessa ricetta. */
    const ricette = new Map();
    const scartate = new Set();
    for (const a of lista.filter(x => x?.tipo === 'creaRicetta')) {
      const nome = String(a.nome || '').trim();
      if (a.codice) scartate.add(String(a.codice));
      const ing = (Array.isArray(a.ingredienti) ? a.ingredienti : [])
        .map(i => {
          const n = String(i?.alimento || '').trim();
          return { alimento: aiNomeAlimento(n, nuovi) || n.toLowerCase(), qta: +i?.qta || 0 };
        })
        .filter(i => i.alimento && i.qta > 0);
      if (!nome || !ing.length) { avvisi.push('Una ricetta senza nome o senza ingredienti: scartata.'); continue; }
      const fuori = ing.filter(i => !per100(i.alimento));
      if (fuori.length) {
        avvisi.push(`"${nome}": ${fuori.map(i => i.alimento).join(', ')} non c'e' fra gli alimenti. Scartata.`);
        continue;
      }
      const no = ing.map(i => tocca(i.alimento, pref.mai)).find(Boolean);
      if (no) { avvisi.push(`"${nome}": contiene ${no}, che non mangi mai. Scartata.`); continue; }
      /* il codice: quello proposto se e' nuovo, se no uno libero. Mai sopra
         una ricetta che hai gia'. */
      let cod = 'ai-' + norm(a.codice || nome).replace(/^ai-/, '').replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '').slice(0, 32);
      if (cod === 'ai-') cod = 'ai-ricetta';
      let k2 = cod, i2 = 2;
      while ((D.pasti && D.pasti[k2]) || [...ricette.values()].some(r => r.codice === k2)) k2 = cod + '-' + i2++;
      ricette.set(String(a.codice || nome), { codice: k2, nome, ingredienti: ing, macro: macroDi(ing) });
      scartate.delete(String(a.codice));
    }

    /* 3. la settimana */
    const giorni = (D.settimana || []).map((g, gi) => ({
      giorno: gi, nome: g.giorno, attivita: g.attivita || '',
      pasti: (g.pasti || []).map(s => ({ slot: s.slot, ora: s.ora || null, codice: null }))
    }));
    for (const a of lista.filter(x => x?.tipo === 'assegnaPasto')) {
      const g = giorni[+a.giorno];
      if (!g) { avvisi.push('Un giorno fuori dalla settimana: scartato.'); continue; }
      /* Un giorno puo' avere tre "Spuntino" (il sabato dell'esempio): si
         riempie il primo **ancora libero** con quel nome, nell'ordine in cui
         arrivano. Prima si prendeva sempre il primo, e tre spuntini finivano
         uno sopra l'altro lasciando vuoti gli altri due. */
      const omonimi = g.pasti.filter(s => norm(s.slot) === norm(a.slot));
      const sl = omonimi.find(s => !s.preso) || omonimi[0];
      if (sl) sl.preso = true;
      if (!sl) { avvisi.push(`${capIniziale(g.nome)}: il pasto "${a.slot}" non c'e' nella struttura.`); continue; }
      const nuova = ricette.get(String(a.codice));
      const esist = !nuova && a.codice && typeof pasto === 'function' ? pasto(a.codice) : null;
      if (!nuova && !esist && scartate.has(String(a.codice))) continue;
      if (!nuova && !esist) { avvisi.push(`${capIniziale(g.nome)}, ${sl.slot}: la ricetta "${a.codice}" non esiste.`); continue; }
      if (esist) {
        const no = (esist.ingredienti || []).map(i => tocca(i.alimento, pref.mai)).find(Boolean);
        if (no) { avvisi.push(`${capIniziale(g.nome)}, ${sl.slot}: "${esist.nome}" contiene ${no}, che non mangi mai. Lasciato vuoto.`); continue; }
      }
      sl.codice = nuova ? nuova.codice : a.codice;
      sl.nome = nuova ? nuova.nome : esist.nome;
      sl.nuova = !!nuova;
      sl.macro = nuova ? nuova.macro
        : (typeof macroRicetta === 'function' ? macroRicetta(esist) : esist.macro) || { kcal: 0, p: 0, c: 0, g: 0, fibre: 0 };
      sl.ingredienti = (nuova || esist).ingredienti || [];
    }

    /* i totali, e come sta ogni giorno contro il target e il pavimento */
    const tk = D.target?.kcal || 0;
    const pav = typeof pavimentoCalorico === 'function' ? pavimentoCalorico().pavimento : 0;
    const usiMeno = new Map();
    for (const g of giorni) {
      g.totali = { kcal: 0, p: 0, c: 0, g: 0, fibre: 0 };
      for (const s of g.pasti) if (s.macro) for (const x in g.totali) g.totali[x] += s.macro[x] || 0;
      for (const x in g.totali) g.totali[x] = Math.round(g.totali[x] * 10) / 10;
      g.vuoti = g.pasti.filter(s => !s.codice).length;
      const sc = tk ? (g.totali.kcal - tk) / tk : null;
      g.stato = g.vuoti === g.pasti.length ? 'vuoto' : g.totali.kcal < pav ? 'basso'
        : sc != null && sc < -0.1 ? 'sotto' : sc != null && sc > 0.1 ? 'sopra' : 'ok';
      for (const s of g.pasti) for (const i of (s.ingredienti || [])) {
        const t = tocca(i.alimento, pref.di_meno);
        if (t) usiMeno.set(t, (usiMeno.get(t) || 0) + 1);
      }
    }
    for (const g of giorni.filter(x => x.stato === 'basso'))
      avvisi.push(`${capIniziale(g.nome)}: ${Math.round(g.totali.kcal)} kcal, sotto il pavimento di ${pav}.`);
    for (const [t, n] of usiMeno) if (n > 2)
      avvisi.push(`"${t}" compare ${n} volte, e lo volevi di meno.`);
    const vuoti = giorni.reduce((a, g) => a + g.vuoti, 0);
    if (vuoti) avvisi.push(`${vuoti === 1 ? 'Un pasto e\' rimasto' : vuoti + ' pasti sono rimasti'} senza ricetta.`);

    /* le ricette nuove che nessun giorno usa non entrano */
    const usate = new Set(giorni.flatMap(g => g.pasti.map(s => s.codice)));
    const ric = [...ricette.values()].filter(r => usate.has(r.codice));
    const ingUsati = new Set(ric.flatMap(r => r.ingredienti.map(i => i.alimento)));
    const ali = [...nuovi.values()].filter(a => ingUsati.has(a.nome));
    return { alimenti: ali, ricette: ric, giorni, pavimento: pav, target: tk };
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
        for (const i of ing) i.alimento = aiNomeAlimento(i.alimento) || i.alimento;
        const fuori = ing.filter(i => !(typeof alimento === 'function' && alimento(i.alimento)));
        if (fuori.length) return push(`"${nome}": ${fuori.map(i => i.alimento).join(', ')} `
          + 'non e\' fra i tuoi alimenti. Scartata.');
        return { tipo: 'creaRicetta', nome, ingredienti: ing,
                 macro: typeof macroDaIngredienti === 'function'
                   ? macroDaIngredienti(ing) : null };
      }
      /*
       * Un piatto riconosciuto in una foto: **un elenco di alimenti**, non
       * una riga sola.
       *
       * E' scomposto perche' e' cosi' che l'app tiene il cibo: un alimento
       * con i suoi valori per 100 g piu' una quantita'. Cosi' la voce entra
       * in un pasto come qualunque altro ingrediente, i grammi si correggono
       * uno per uno, e se domani colleghi un prodotto reale a quel nome i
       * conti si aggiornano da soli — cose che una riga "piatto: 640 kcal"
       * non puo' fare.
       *
       * Ogni alimento passa da `coerenza()`, la stessa di Open Food Facts:
       * su numeri **guardati in una fotografia** serve piu' che altrove.
       */
      case 'pastoDaFoto': {
        const nome = String(a.nome || '').trim();
        const gr = [];
        for (const x of (Array.isArray(a.alimenti) ? a.alimenti : [])) {
          const n = String(x?.nome || '').trim().toLowerCase();
          const qta = +x?.qta || 0;
          if (!n || !(qta > 0)) { avvisi.push('Un alimento senza nome o senza quantita\': scartato.'); continue; }
          const per100 = ['kcal', 'p', 'c', 'g', 'fibre']
            .reduce((o2, kk) => (o2[kk] = +(x[kk] ?? x.per100?.[kk]) || 0, o2), {});
          if (!(per100.kcal > 0)) { avvisi.push(`"${n}": niente calorie, scartato.`); continue; }
          const co = typeof coerenza === 'function' ? coerenza(per100) : { stato: 'ok' };
          if (co.stato === 'incoerente') { avvisi.push(`"${n}": ${co.d} Scartato.`); continue; }
          gr.push({ nome: n, qta, unita: x.unita === 'ml' ? 'ml' : 'g', per100,
                    dubbio: co.stato === 'dubbio' ? co.d : null });
        }
        if (!gr.length) return push('Nella foto non e\' stato riconosciuto niente di usabile.');
        return { tipo: 'pastoDaFoto', nome: nome || 'Piatto dalla foto', alimenti: gr };
      }
      case 'creaExtra': {
        const nome = String(a.nome || '').trim();
        if (!nome) return push('Una voce senza nome: scartata.');
        const v = ['kcal', 'p', 'c', 'g', 'fibre']
          .reduce((o2, x) => (o2[x] = +a[x] || 0, o2), {});
        if (!(v.kcal > 0)) return push(`"${nome}": niente calorie, scartata.`);
        /* Lo stesso `coerenza()` di Open Food Facts: i macro devono tornare
           con le calorie. Su una stima da una fotografia serve piu' che
           altrove — li' i numeri li ha inventati qualcuno guardando. */
        const co = typeof coerenza === 'function' ? coerenza(v) : { stato: 'ok' };
        if (co.stato === 'incoerente') return push(`"${nome}": ${co.d} Scartata.`);
        return { tipo: 'creaExtra', nome, valori: v,
                 dubbio: co.stato === 'dubbio' ? co.d : null };
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
