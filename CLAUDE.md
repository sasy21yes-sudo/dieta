# Dieta — PWA per il piano di ricomposizione

App web installabile su iPhone da Safari ("Aggiungi alla schermata Home"), senza
App Store. **Nessun build step, nessuna dipendenza, nessun backend**: vanilla JS,
un service worker, GitHub Pages da `main`.

Questo file contiene **regole e vincoli**. Il perché di ogni scelta — con il
difetto che l'ha fatta nascere e le misure fatte — sta in
[docs/STORIA.md](docs/STORIA.md), cercabile per titolo di sezione. Prima di
cambiare un comportamento che sembra strano, cercalo lì: quasi sempre è voluto.

L'interfaccia è in italiano e segue le Apple Human Interface Guidelines
(gerarchia chiara, liste raggruppate, anelli come Fitness, niente decorazione
che non porti un dato).

---

## Lavorare qui

- Sviluppo: `py -m http.server 8000` (su Windows `python3` è l'alias dello
  Store). `localhost` è contesto sicuro: il service worker parte senza HTTPS.
- **Test**: apri `/test.html` (anche in produzione: usa una memoria finta, non
  tocca i dati veri). Il titolo dice `OK n/n` o `FALLITI`. Headless:
  `chrome --headless=new --virtual-time-budget=25000 --dump-dom http://localhost:8000/test.html`.
  Quando correggi un difetto in un motore, aggiungi lì il caso che lo prende,
  e controlla che fallisca col codice vecchio.
- **Ogni commit che tocca file serviti alzi `V` in `sw.js`** (`dieta-v120` →
  `dieta-v121`). La versione che l'app mostra è il nome della cache: se `sw.js`
  non cambia, il telefono non si aggiorna. Un commit di sola documentazione
  non ne ha bisogno.
- Un file JS nuovo va in `index.html` (prima di `app.js`) **e** in `ASSETS` di
  `sw.js`. `test.html` legge gli script da `index.html` da solo.
- Prova sempre anche il **piano vuoto** ("comincio da zero"): lì `D.pasti` e
  `D.alimenti` sono vuoti. `esc(null)` stampa "null".
- Headless non scende sotto 500 px di larghezza: per vedere i 375 px di un
  iPhone metti l'app in un iframe largo 375. IndexedDB non risponde sotto
  `--virtual-time-budget`.
- Tutti i file condividono lo scope globale: **mai due `const`/`function` con
  lo stesso nome al livello superiore** — l'app resta bianca senza errori.

## Struttura

```
index.html   guscio: topbar, <main>, tab bar (5 voci), sheet modale
style.css    design system (token CSS, tema chiaro/scuro automatico)
viz.css      tavolozza dei grafici + componenti
app.js       stato, router, viste principali, motori. Caricato PER ULTIMO
mese.js      il giudizio sul mese, gli anelli della settimana
spunti.js    "Oggi, per il tuo obiettivo": cosa fare oggi, con un tocco
anim.js      animazioni (prima di charts.js)    icone.js  icone ricopiate dentro
charts.js    grafici SVG + Andamento            revisione.js  revisione per periodo
obiettivo.js obiettivo e fisico di riferimento  target.js     target ricalibrato
previsioni.js proiezioni a 28 giorni            leve.js       leve dei macro nel piano
giorno.js    strati del diario per giorno       piano.js      profili + editor del piano
palestra.js  registro, mappa, forma-fatica      seduta.js     seduta guidata, resoconto
carico.js    scarico e acciacchi                cardio.js     cardio, sport, GPS
peso.js      pesate anomale, ciclo              spesa.js      spesa e dispensa
prodotti.js  prodotti, codici a barre, OFF      foto.js / camera.js  foto e fotocamera
scambio.js   import/export di pezzi di piano    copie.js      copie del backup in IndexedDB
pdf.js       generatore PDF a mano              statistiche.js conti del resoconto
ai.js        compone e valida le domande all'AI assistente.js la nuvoletta
sfide.js / timer.js / salute.js / cerca.js / confronto.js
data/        dieta.json (dominio), palestra.json, sfide.json, corpo.json, fisici.json
test.html / test.js   controlli fissi
```

## Vincoli iOS (non aggirabili)

- **Niente notifiche locali programmate** né esecuzione in background: i
  promemoria sono un file `.ics` con `VALARM`. Il push vero richiederebbe un
  server (Cloudflare Worker + VAPID): è un'aggiunta, non c'è.
- **GPS solo a schermo acceso** (Wake Lock), e lo si dice prima di partire.
- **Nessuna API web legge HealthKit**: passi e sonno arrivano da un Comando iOS
  che apre `#/importa?passi=…`.
- I dati possono sparire (svuotare Safari, reinstallare, memoria piena): il
  backup JSON è parte del contratto, e `copie.js` ne tiene copie in IndexedDB.
  Le foto sono in IndexedDB e hanno un export a parte.
- `window.print()` non è affidabile in una PWA: il PDF si genera (`pdf.js`).
- `touch-action: manipulation`, mai `user-scalable=no`.

## Il modello dei dati

- `data/dieta.json` è **un esempio con i dati di una persona reale**, non il
  default. Il primo avvio chiede "vuoto" o "esempio" (`S.settings.pianoBase`).
  Non va mai modificato dal codice: lo strato dell'utente sta in `S.piano`, e
  `fondiPiano()` produce `D`. Va richiamata dopo ogni modifica al piano.
- I valori nutrizionali stanno nel file di dominio, mai nel codice. `fonte`:
  `verificato` (etichetta), `tabella`, `stima` — e la UI dice "stimato".
  Open Food Facts, codici a barre via OFF e alimenti generati da un modello
  nascono `stima`.
- Un profilo = una chiave `dieta.v1:<id>`; cambiare profilo ricarica la pagina.
- **Moduli** (`S.settings.moduli`: piano, hyrox, ai): spegnere nasconde, non
  cancella. I backup vecchi passano da `modulliDaStato()`.
- **Il piano è un modello, il diario è un fatto.** Di una giornata passata si
  congelano tre cose: la ricetta alla spunta (`fatti`), il target (`target`) e
  la struttura dei pasti (`slots`) quando il giorno smette di essere oggi.
  Oggi non si congela. Campi che non sono contenuto vanno in `GIORNO_META`.
- **La chiave del diario è il pasto** (`chiaveP()`), non la ricetta: due pasti
  con la stessa ricetta sono due pasti.
- Strati del giorno: porzioni, `swap` (indicizzato sull'ingrediente del
  piano), `aggiunti` (con id stabile), `pastoSwap`. Il fuori piano è `extra`.
- Codici sintetici risolti da `pasto()`: `ali:<qta>:<nome>`, `ric:<id>:<pesi>`,
  `piu:<a>+<b>`. Mai leggere `D.pasti[code]` per uno slot. Macro di una
  ricetta da `macroRicetta()` (`macro: null` vuol dire "ricalcola").
- Una spunta tolta si **cancella**, non diventa `false`. I pasti spuntati si
  contano sui valori, i giorni registrati con `giornoPieno()`/`loggedDays()`.
- Navigazione solo con `apri(hash)`. `#/dati`, `#/analisi`, `#/revisione`,
  `#/mese` restano indirizzi validi verso le viste di Andamento.

## I motori, e quello che non devono fare

- **La pagella delle previsioni** (`ledgerRecord()`) registra la previsione che
  la carta mostra (ritmo misurato o introito reale), non quella del piano; il
  suo grafico e' `chartErrori()`, divergente attorno allo zero — `chartBars`
  parte da zero e non regge valori negativi.
- **Il peso** si legge sulla tendenza (`trendW`, pesate anomale escluse con
  mediana e MAD), mai sulla pesata del giorno. Il dispendio è un filtro di
  Kalman sul bilancio introito/peso.
- **Prima quello che succede, poi quello che succederebbe**: titoli e
  proiezioni partono dal ritmo misurato (`ritmoPeso()`, retta sulle pesate di
  28 giorni) o dall'introito reale; il piano è il confronto, non il titolo.
- **Gli spunti** (`spuntiOggi()`): al massimo tre, nati dai numeri di oggi,
  ognuno con un'azione da un tocco. Le proteine mancanti si contano al netto
  dei pasti che restano (`previstoRestante()`). Niente frasi generiche: se non
  c'e' niente da dire, una riga lo dice.
- **Il mese** (`giudizioMese()`): ritmo vero contro ritmo dell'obiettivo, con
  fasce larghe; se l'incertezza è più grande della fascia dice "non ancora
  chiaro". Una cosa sola da fare, in quest'ordine: dati, piano seguito, piano
  da cambiare. Mai applicata da sola.
- **Calorie bruciate: mai sommate al target** né sottratte dall'introito (sono
  già nel dispendio). Si mostrano con scritto che non si sommano.
- **Attività**: minuti equivalenti contro i 150 dell'OMS, un minuto intenso
  (MET ≥ 6) vale due; la forza conta a parte, in giorni (≥ 2).
- **Niente date di arrivo né conti alla rovescia.** Un intervallo che si
  ricalcola (`tempoAlTarget()`) sì, e si rifiuta quando il ritmo non è
  distinguibile da zero. Sotto 0,05 kg/settimana "il peso sta fermo".
- **Non giudicare solo in relativo al target**, che decide l'utente: il
  pavimento calorico è `max(BMR × 1,1, dispendio × 0,75)`, giorno per giorno,
  e chi ha un medico lo trasforma in nota, non lo zittisce. Senza target non si
  giudica niente.
- Proteine ancorate al peso, mai scalate con le calorie. Ritmi in % del peso.
- **Palestra**: e1RM con Epley + RIR; Banister per muscolo, mostrato come
  fatica **rispetto al proprio solito** (mai soglie fisse, mai la prontezza in
  evidenza); finestra `settimanaGym()` (arriva a oggi), non `windowDays()`.
  Stripping: `serieEquivalenti()`/`tonnellaggioSerie()`/`ripetizioniSerie()`,
  mai ricopiare il conto. Scarico: **tre segnali indipendenti, ne servono due**.
- `allenatoIl(k)` è l'unica regola per "mi sono allenato"; `cardioDi()` è
  l'unico registro di cardio e sport.
- Le costanti di letteratura (Banister, OMS, pavimento dei grassi 0,6 g/kg,
  soglie FFMI, fasce NICE/ACE, MET) **non sono misure sull'utente**, e la UI lo
  dice.
- Composizione: formula della Marina (femminile con i fianchi) o bioimpedenza
  recente (≤ 30 giorni, se ne prende la percentuale). Collo fuori 32–48 cm: non
  si calcola. Un cambio di composizione esiste solo con una misura **nuova**.
- Medie: arrivano a oggi nei grafici; i periodi "chiusi" (revisione, analisi)
  si fermano a ieri; nel mese gli ingressi si fermano a ieri, il peso no.
- Periodo di Andamento scritto solo da `periodoAndamento()`.

## Interfaccia

**Il design segue le Human Interface Guidelines di Apple**, lette dalla fonte
(`developer.apple.com/tutorials/data/design/human-interface-guidelines/<pagina>.json`,
lo stesso JSON che usa il sito: le pagine HTML si caricano in JavaScript).
Le regole che ne escono, e che valgono per ogni carta nuova:

- **Un font solo, quello di sistema** (SF Pro su iPhone): `--sans`, `--serif`
  e `--mono` puntano tutti a lui, e le cifre sono tabulari ovunque. La
  gerarchia si fa con dimensione e peso, non con un'altra famiglia. Testo
  normale 15–17 px, minimo 11.
- **Superfici di iOS**: la pagina e' `--bg` (systemGroupedBackground, grigio;
  nero al buio), le carte sono `--paper` senza bordo, dentro una carta i
  riempimenti sono `--wash`. Dentro un foglio le carte prendono `--wash`.
- **Comandi di iOS**: bottone secondario = riempimento grigio col testo nel
  colore dell'app, primario = pieno; segmented control = binario grigio con la
  voce scelta in bianco (da sei voci in su diventa pastiglie che vanno a capo);
  campi senza bordo; barre traslucide con lo sfocato.
- **Le sezioni sono liste raggruppate** (come Impostazioni): icona nel
  quadratino colorato a sinistra, titolo, stato, freccia, separatore rientrato.
- **Colore con parsimonia**, e mai lo stesso colore per due significati.

**Segnali di design generato da non usare** (catalogo di impeccable.style e
simili): strisce colorate sul lato delle carte, etichette sopra il titolo,
icona sopra il titolo in riquadri a griglia, titoli serif con numeri
monospazio, maiuscoletto spaziato, bordo sottile insieme all'ombra, carte
dentro carte, gradienti viola, testo che spiega la scelta di progetto al
lettore. Lo stato si dice con un'icona, una parola o un punto colorato.

**Un numero alla volta.** Il passo "Quanto mangiare" mostra il target com'e'
(`cardIlTuoTarget()`), una riga che lo confronta con l'obiettivo e una sola
proposta (`pianoCalorico()`, che parte dal dispendio misurato); i campi stanno
in un foglio. Non aggiungere un secondo motore di proposte accanto: la carta
ricalibrata dalla matrice e' stata tolta perche' contraddiceva l'obiettivo.

**Le animazioni muovono il dato, non la cornice.** La bottiglia: si sposta
l'acqua dentro la sagoma ferma, e dopo un bicchiere parte dal livello di prima
(`_acquaPrima`). Scalare un gruppo che porta un `clip-path` scala anche il
ritaglio.

**Niente doppioni.** Prima di aggiungere una carta, cerca se la stessa cosa e'
gia' detta altrove: il ritmo del peso sta in un posto (la previsione in
Corpo), il giudizio in un altro (Il mese), e una carta che riassume quello che
c'e' gia' due dita sotto si toglie.

- Prima la risposta in italiano, poi i numeri che la reggono, poi "come fa a
  saperlo" chiuso in fondo. Una riga che dice cosa fa, non perché esiste.
- Avvisi in una riga con l'azione come bottone di testo, cursori per le scale,
  date scritte per esteso (`dataEstesa()`), giorni con la sola iniziale
  maiuscola (`capIniziale()`).
- Oggi: il conto del giorno subito sotto il giorno, poi gli avvisi e gli
  spunti; la sfida in fondo. Andamento ha tre viste: Il mese (con sotto "Da
  tenere d'occhio" e la costanza), Grafici, Revisione. La Sintesi non c'e'
  piu', e `#/analisi` porta al mese.
- Prima di dare un nome a una classe cercalo: `.cal` era della costanza,
  `.sp-` e' della spesa (gli spunti usano `spu-`).
- **Una sola unità per tabella.** Composizione in kg (la % una volta, come
  titolo); misure con "Mese" e "Al rif." e la freccia del verso.
- Colori: verde = in linea, **ambra = fuori target**, oro = allenamento extra,
  grigio = nessun dato (mai "sotto target"), viola = l'assistente AI. Nuove
  tinte passano dal validatore della skill dataviz.
- Grafici: SVG a mano, un asse solo, ≤ 3 categorici, legenda sempre, lettura
  al tocco, `niceTicks()`, etichette che non si sovrappongono
  (`etichetteSerie()`). Un grafico senza dati lo dice.
- Animazioni: rispettano `prefers-reduced-motion`, solo opacity/transform/
  stroke-dashoffset, una volta all'ingresso. **Lo stato finale è già disegnato
  prima dell'animazione.** L'unica animazione perpetua è la fiamma.
- Tabelle `.cmp`: colonne fisse `1fr 58px 58px 64px`, intestazioni corte.
- Un `<button>` mai dentro un altro `<button>`; un elemento diventato bottone
  ha bisogno del reset di stile. Campi ora: `type="time"` con `oraValida()`.
- Un filtro che scrive non passa da `route()` (chiude la tastiera). Lo scroll
  non si tocca mentre l'utente scrive.
- Icone ricopiate da Feather/Lucide/Tabler (stessa griglia 24×24), mai da CDN.
- Toccare una riga la **apre**, non la cancella. L'editor di una riga torna al
  foglio da cui si è arrivati.
- Niente punteggi "cibo buono/cattivo", mai suggerire di saltare pasti o
  compensare: il bilancio è settimanale e il tono è descrittivo.

## AI

`ai.js` non tiene chiavi né URL: prende un **trasporto** (una funzione). Le
regole dell'app si ricontrollano in uscita (`valida()`), le proposte non si
applicano da sole, il diario giorno per giorno non esce dal telefono, e un
`null` nel contesto si dichiara (`{ scelto: false, nota }`).

## Roadmap

1. Rampa fibre (avviso se il salto settimanale supera 5 g)
2. Push reale via Cloudflare Worker, solo se il calendario non basta
3. Ricambio automatico dell'esercizio negli acciacchi
4. Migrazione degli `aggiunti` scritti sotto il codice della ricetta (vedi
   STORIA.md, "Una ricetta intera nella giornata")
5. Un giro per togliere testo dalle carte fuori da Oggi, Diario, Piano, Corpo
   e Andamento, e uniformare i titoli delle carte (h3 contro h2.sec)
6. Il mese e la Revisione si sovrappongono ancora in parte: valutare se la
   revisione debba partire dal mese invece di ripeterne il verdetto
