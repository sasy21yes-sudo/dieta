# Dieta — PWA per il piano di ricomposizione

App web installabile su iPhone **senza App Store**, tramite "Aggiungi alla schermata Home".
Nessun build step, nessuna dipendenza, nessun backend. Vanilla JS + un service worker.

---

## Come si mette sul telefono

L'app ha bisogno di **HTTPS** (il service worker non parte da `file://` né da HTTP semplice).

1. Crea un repo GitHub e carica questa cartella
2. Settings → Pages → Deploy from branch → `main` / root
3. Sull'iPhone apri l'URL **in Safari** (non Chrome: solo Safari può installare)
4. Condividi → **Aggiungi alla schermata Home**
5. Apri l'app dall'icona, non dal browser

Per lo sviluppo locale: `py -m http.server 8000` e apri `localhost:8000`.
Su Windows l'interprete si chiama `py` (o `python`): `python3` è l'alias del Microsoft
Store e risponde con un invito a installare, non con Python. Su macOS e Linux resta
`python3`. Il service worker parte anche da `localhost`, che è contesto sicuro: per
provare l'offline sul computer non serve HTTPS.
Da un altro dispositivo sulla stessa rete serve HTTPS: usa `ngrok http 8000`.

---

## Vincoli iOS reali (leggere prima di promettere funzionalità)

Questi non sono limiti dell'implementazione: sono limiti di Safari. Vanno progettati intorno, non aggirati.

| Cosa | Stato su iOS |
|---|---|
| Aggiunta alla Home, schermo intero, icona propria | Funziona |
| Funzionamento offline (service worker) | Funziona |
| `localStorage` / IndexedDB persistenti | Funziona, ma vedi sotto |
| **Notifiche locali programmate** | **Non esistono.** La Notification Triggers API non è implementata in Safari |
| Web Push | Solo da iOS 16.4+, **solo** se l'app è stata aggiunta alla Home, e **richiede un server** con chiavi VAPID e uno scheduler |
| Esecuzione in background | Non esiste |

### Conseguenza sulle notifiche

Una PWA **non può svegliarsi da sola** per ricordarti lo spuntino delle 16:30.
La soluzione implementata evita del tutto il problema: l'app **genera un file `.ics`**
con tutti gli eventi ricorrenti (5 pasti, 5 integratori, pesata mattutina,
revisione domenicale), ognuno con il suo `VALARM`. L'utente lo apre una volta,
il Calendario iOS lo importa e da lì in poi le notifiche sono **native, affidabili
e senza server**.

Se in futuro servisse il push vero (es. messaggi dinamici tipo "ti mancano 40 g di
proteine"), serve un backend: Cloudflare Worker + Cron Trigger + `web-push` con VAPID.
È un'aggiunta, non una riscrittura: l'app resta funzionante senza.

### Conseguenza sulla persistenza

Le web app aggiunte alla Home non subiscono il limite dei 7 giorni di ITP, ma i dati
**possono comunque sparire** se l'utente svuota i dati di Safari o reinstalla.
Per questo l'esportazione del backup JSON non è un extra: è parte del contratto.
Ricordarlo all'utente ogni ~20 giorni di log.

---

## Struttura

```
index.html      guscio: topbar, <main>, tab bar, sheet modale
style.css       design system (variabili CSS, tema chiaro/scuro automatico)
viz.css         tavolozza dei grafici + componenti di Dati, Prodotti, Foto
app.js          stato, router, viste principali, motori. Caricato PER ULTIMO:
                costruisce ROUTES e chiama init(), quindi le viste degli altri
                file devono gia' esistere
charts.js       toolkit SVG dei grafici + vista Dati
piano.js        profili multipli + editor del piano (target, alimenti, pasti, settimana)
palestra.js     registro sedute, mappa muscolare, forma-fatica, progressione
prodotti.js     prodotti reali, codici a barre, override degli alimenti
foto.js         foto dei progressi (IndexedDB) + timelapse
sw.js           cache offline; rete-prima su tutto, cache come riserva
manifest.json   PWA
data/dieta.json IL DOMINIO alimentare — vedi sotto
data/palestra.json catalogo esercizi, gruppi muscolari, modello forma-fatica
icons/          180 (apple-touch), 192, 512, maskable
```

### Profili e piano personalizzato

`data/dieta.json` è la fonte di verità **di base**, e non va mai modificata dal
codice. Quello che l'utente crea si sovrappone come strato in `S.piano`:
alimenti aggiunti o corretti, pasti composti, target propri, settimana
riorganizzata. `fondiPiano()` produce `D` = base + strato, e va richiamata dopo
ogni modifica al piano.

Ogni profilo ha la sua chiave di `localStorage` (`dieta.v1:<id>`), quindi diario,
piano, prodotti, palestra e foto restano separati. L'indice dei profili sta in
`dieta.profili`. Cambiare profilo ricarica la pagina: stato e piano devono
cambiare insieme.

**Attenzione:** il target giornaliero (`D.target`) e le barre della scheda Oggi
sono due cose diverse. Le barre vengono dalla somma dei pasti assegnati alla
settimana; `D.target` alimenta analisi, cruscotto, consigli e previsione. La
scheda Target avvisa quando i due divergono di oltre l'8%.

### `data/dieta.json` è la fonte di verità

**Non ricalcolare i valori nutrizionali nel codice e non inventarli.**
Sono stati costruiti e verificati a monte. Il file contiene:

| Chiave | Contenuto |
|---|---|
| `target` | Medie giornaliere da centrare: 2482 kcal, 135 g P, 287 C, 82 G, 38 fibre |
| `alimenti` | 44 voci per 100 g/ml + `categoria` + `fonte` |
| `pasti` | 24 pasti con ingredienti pesati e macro precalcolati |
| `settimana` | 7 giorni × slot × codice pasto × ora |
| `sostituzioni_consigliate` | Swap curati a mano |
| `leve` | Come muovere ±150 kcal |
| `integratori` | B12, creatina, D3, omega-3, selenio con dose e cadenza |
| `misure` | Punti corporei, con `base` di partenza e `target` |
| `regole_calorie` | Matrice decisionale peso × vita × carichi → azione |
| `modello` | Costanti del motore di previsione: 7700 kcal/kg, LAF, rumore, derive |
| `target_fisico` | Il fisico di riferimento — misure, % grasso, massa magra, rapporti |

Il campo **`fonte`** vale `verificato` (letto in etichetta), `stima` (media di categoria,
da sostituire con i dati del prodotto reale) o `tabella`. La UI deve mostrare
"valore stimato" dove `fonte === 'stima'`: è una questione di onestà verso l'utente,
non un dettaglio.

---

## Funzionalità già implementate

- **Oggi** — giorno navigabile, barre macro consumato/target, pasti spuntabili,
  totale residuo, registrazione pasti fuori piano senza tono colpevolizzante
- **Sostituzioni** — motore che, dato un alimento e una quantità, cerca nella stessa
  categoria e riscala per far combaciare il macro dominante (proteine se danno >20%
  delle calorie, altrimenti calorie), poi ordina per distanza sui quattro macro
- **Diario** — peso, acqua, Coca Zero, passi, sonno, allenamento, fame, energia,
  aderenza, sintomi gastrointestinali, checklist integratori
- **Corpo** — target fisico e composizione stimata a confronto; figura SVG
  **parametrica** (le larghezze vengono dalle circonferenze registrate, la sagoma
  target si sovrappone tratteggiata); tabelle ora/target/manca; grafico peso con
  media mobile a 7 giorni e previsione tratteggiata
- **Previsione** — motore adattivo del dispendio (vedi sotto)
- **Dati** — cruscotto: 4 riquadri statistici, calendario della costanza e 14
  grafici (peso, calorie, proteine, ripartizione dei macro, fibre, passi, sonno,
  acqua, Coca Zero, fame/energia, misure, composizione, dispendio stimato,
  errore delle previsioni), con selettore di periodo 7/30/90/180 giorni
- **Prodotti** — registro dei prodotti reali con i valori letti in etichetta;
  lettura del codice a barre dove il browser la supporta, con ricerca opzionale
  su Open Food Facts. Collegando un prodotto a un alimento del piano, i suoi
  valori **sostituiscono la stima ovunque**: pasti, sostituzioni, analisi,
  previsione
- **Foto** — uno scatto al giorno per posa (fronte/lato/schiena), confronto
  primo/ultimo e timelapse sfogliabile. Stanno in IndexedDB, compresse a 1280 px
- **Palestra** (scheda "Gym") — registro delle sedute, mappa muscolare fronte e
  schiena su tre modi (volume, stanchi, in crescita), modello forma-fatica di
  Banister per muscolo, massimale stimato con Epley corretto col RIR, proiezione
  della forza per regressione lineare, doppia progressione, volume settimanale a
  barre orizzontali
- **Piano** — percorso guidato in cinque passi (chi sei, quanto mangiare, cosa,
  come lo combini, quando), ognuno con stato e spiegazione del perché; profili
  multipli e editor: dati personali, target giornalieri,
  alimenti, composizione dei pasti con macro calcolati dagli ingredienti,
  assegnazione dei pasti alla settimana
- **Consiglio del giorno** — su Oggi. Preferisce sempre un consiglio che nasce
  dai dati dell'utente a uno generico; ruota in modo deterministico sulla data
- **Analisi** — motore a regole "cosa sto sbagliando" (vedi sotto)
- **Spesa** — fabbisogno settimanale aggregato per categoria, con spunta
- **Impostazioni** — generatore `.ics`, export/import backup JSON

### Calorie bruciate: il punto in cui quasi tutte le app sbagliano

`kcalAllenamento(k)` stima la spesa di una giornata da palestra e HYROX insieme
(MET dal Compendium, in `data/palestra.json`; la corsa a 1,036 kcal/kg/km).

**Questo numero non va MAI sommato al target né sottratto dall'introito.** Il
dispendio del filtro di Kalman nasce dal bilancio fra quanto si mangia e come
cambia il peso: contiene già tutto il movimento, allenamenti compresi. Sommarlo
di nuovo sarebbe contarlo due volte. Serve a misurare il carico di lavoro nel
tempo, non a mangiare di più — e la UI deve continuare a dirlo.

### I carichi non si dichiarano più

`caricoTrend()` li calcola dalle schede invece di chiederli. Il massimale
stimato (Epley col RIR) è già la variabile che mette d'accordo "meno ripetizioni
ma più peso" e "stesso peso ma più ripetizioni". Si prende la pendenza per ogni
esercizio con ≥3 sedute in 8 settimane, la si normalizza sul valore corrente
(+2,5 kg su 60 non è come su 200) e si usa la **mediana** fra esercizi, che un
singolo record fortunato non sposta. Il selettore manuale resta solo come
ripiego quando i dati non bastano.

### Schede e tecniche

Una scheda fissa **esercizi, serie e range di ripetizioni**; il carico si
aggiorna a ogni uso. Supporta superserie (`superserie: true` = attaccato al
precedente, etichette A1/A2) e tecniche: stripping, rest-pause, piramidale.
Gli scarichi di uno stripping si scrivono come `50x6, 40x5` e contano **mezza
serie ciascuno** nel volume e nello stimolo — sono lavoro vero ma più corto.

Due regole di interfaccia imparate a caro prezzo:
- toccare una riga la **apre**, non la cancella
- l'editor di una riga torna alla scheda, non chiude tutto: `closeSheet()` lì
  faceva sparire il lavoro in corso
- il punto d'ingresso mostra **sempre** la scelta scheda/libera, anche se ci
  sono già serie registrate quel giorno

### Il piano HYROX è tarato sull'atleta

`capacitaFisica()` legge forza gambe e forza di tirata dai massimali stimati
della palestra (rapporto sul peso corporeo), il motore aerobico dai minuti di
corsa registrati, e la tendenza dei carichi. Il generatore del programma
aggiunge forza dove le gambe sono deboli, corsa dove il motore non regge, e
sceglie solo fra gli allenamenti che l'attrezzatura dichiarata permette. La
sezione dice sempre **perché** ha scelto così.

Le soglie sono rapporti di uso comune, non misure: dicono "molto sotto / in
linea / sopra", non danno un voto — e la UI deve continuare a dirlo.

HYROX ha **tre sezioni**, non sei: il conto alla rovescia sta sempre in testa,
il piano dice cosa fare, le stazioni dicono a che punto sei e da lì parte la
simulazione. Tutto il resto era navigazione in più.

### Il motore della palestra

- **Massimale stimato**: Epley su (ripetizioni + RIR). Sommare il RIR è ciò che
  rende confrontabili serie fatte con sforzo diverso. Sopra le 12 ripetizioni
  Epley sovrastima, e la UI lo dice
- **Forma–fatica (Banister)**: ogni seduta lascia due tracce che decadono a
  velocità diverse — fatica τ≈7 giorni, forma τ≈42. La prontezza è la
  differenza pesata. L'impulso NON è il tonnellaggio (un leg press e un'alzata
  laterale non sono confrontabili in chili) ma le serie pesate per
  coinvolgimento del muscolo e per vicinanza al cedimento
- **Proiezione della forza**: regressione lineare, non Kalman. Qui le
  osservazioni sono poche e distanti e il segnale è molto più grande del
  rumore: una retta con banda e R² dice quanto serve senza fingere precisione
- **Doppia progressione**: si sale di carico solo quando TUTTE le serie toccano
  il tetto del range con RIR ≤ 2

Le costanti stanno in `data/palestra.json` e sono valori tipici di letteratura,
**non calibrati sull'utente**: la UI deve continuare a dirlo.

### I grafici

La tavolozza in `viz.css` **non e' stata scelta a occhio**: e' passata dal
validatore della skill dataviz su tutti i controlli, in entrambi i temi —
banda di luminosita', soglia di croma, separazione per daltonismo su tutte le
coppie, soglia a vista normale, contrasto sulla superficie. Se la si cambia, va
rivalidata.

Regole che il toolkit applica e che non vanno violate:

- **Un asse solo.** Mai due scale y sullo stesso grafico: l'allineamento fra le
  due e' arbitrario e inventa correlazioni che nei dati non ci sono
- **Tre categorici al massimo**, e solo dove le serie SONO il soggetto (macro,
  composizione). Tutto il resto e' a serie singola e usa `--pine`
- **Piu' serie con una sola che conta** -> evidenza (una in accento, le altre
  grigie) piu' etichetta diritta, non tre colori
- **Valori di scala tondi** via `niceTicks()`: dividere l'intervallo in parti
  uguali produce due etichette "2" per numeri diversi
- **La lettura e' al tocco**, non al passaggio del mouse: su un telefono non
  esiste. La riga `.read` sotto il grafico e' il tooltip
- Un grafico senza dati **dice che mancano i dati**, non disegna una scatola vuota

### Il motore di previsione

Un filtro di Kalman a una dimensione sul dispendio energetico. Non è un accessorio
del grafico: è ciò che rende le previsioni sempre più precise mentre l'utente logga.

1. **A priori** — Mifflin-St Jeor dal profilo × `modello.laf`. È la stima peggiore,
   quella con cui si parte quando non c'è ancora storia
2. **Osservazione** — su ogni finestra di 14 giorni con copertura ≥60%:
   `TDEE = introito medio − (Δ peso di tendenza × 7700) / giorni`
3. **Aggiornamento** — il guadagno di Kalman pesa osservazione e stima corrente in
   base alla loro incertezza. L'errore dell'osservazione scende con la lunghezza
   della finestra (`σ·√(2/7)/span`), quindi finestre lunghe spostano di più
4. **Adattamento** — se le ultime tre innovazioni hanno tutte lo stesso segno il
   modello è rimasto indietro rispetto alla realtà, e il rumore di processo viene
   quadruplicato perché recuperi in fretta. È letteralmente il "se l'obiettivo non
   viene raggiunto cambia l'indice di calcolo"
5. **Registro** — ogni giorno deposita una previsione a 7 e 14 giorni in `S.model.prev`.
   Quando la data arriva la confronta col peso reale e ne ricava errore medio,
   copertura della banda e deriva sistematica. È la pagella del motore, mostrata in app

Il **rumore giornaliero** (σ dei residui attorno alla media mobile) è stimato sui dati
dell'utente, non preso da una costante: serve sia per la banda di confidenza sia per
dire quanto è larga la forbice della pesata di domani.

**Perché non c'è una data di arrivo.** La richiesta iniziale era "domani mi aspetto di
aver perso 1 kg". Un kg di grasso è 7700 kcal: in un giorno non esiste, e la
fluttuazione giornaliera (±1 kg di acqua e contenuto intestinale) è cinque volte più
grande di qualsiasi segnale reale. Il motore quindi prevede la **linea di tendenza**
su orizzonti di 7 e 28 giorni con banda al 95%, e mostra separatamente la forbice della
bilancia di domani per far vedere perché il numero del mattino non va letto. Nessuna
proiezione a data fissa: sarebbe un conto alla rovescia, che questo file vieta.

### Il motore di analisi

Non è un elenco di consigli generici: applica la matrice decisionale del piano.

1. Se ci sono <3 giorni loggati su 7, **dice che non ci sono dati** e si ferma.
   Non produce conclusioni dal rumore
2. Confronta calorie e proteine medie effettive (dai pasti spuntati, non da quanto
   dichiarato) contro il target
3. Calcola la media mobile del peso a 7 giorni e la confronta con quella di 7 giorni
   prima, incrocia con il trend della vita e con i carichi dichiarati, e cerca la
   riga corrispondente in `regole_calorie`
4. Richiede almeno 8 pesate su 14 giorni prima di dire qualcosa sul peso
5. Controlla idratazione, sonno, Coca Zero (caffeina → sonno), passi, aderenza
6. Se ci sono ≥2 giorni con sintomi gastrointestinali su 7, segnala il glutine di
   frumento negli straccetti e nelle fette veg
7. Verifica che la B12 sia stata presa
8. Verifica che i pasti principali superino i 25 g di proteine

**Regola di prodotto da non violare:** l'app non deve mai suggerire di saltare pasti,
digiunare o compensare uno sgarro. Il bilancio è settimanale. Il tono resta descrittivo,
mai moralizzante — è un requisito esplicito dell'utente.

---

## Roadmap suggerita

In ordine di rapporto valore/sforzo.

1. **Revisione settimanale** — schermata domenicale con tutte le medie a
   confronto con la settimana precedente
2. **Log allenamento con doppia progressione** — esercizio, serie, reps, carico, RIR.
   Quando tutte le serie toccano il tetto del range a RIR ≤2, proporre +2,5 kg (parte
   alta) o +5 kg (parte bassa). Alimenterebbe automaticamente il campo "carichi"
   dell'analisi, oggi manuale
3. **Rampa fibre** — l'utente parte da ~15-20 g e il piano ne prevede 38. Avvisare se
   il salto settimanale supera i 5 g
4. **Modifica porzioni** — scalare un pasto con un moltiplicatore e ricalcolare
5. **Push reale** via Cloudflare Worker, solo se i promemoria da Calendario non bastano

## Cose da non fare

- Non aggiungere un framework né una libreria di grafici: i grafici sono SVG
  costruito a mano proprio per non introdurre un build step. L'app è divisa in
  più file per restare modificabile dal telefono, non per essere impacchettata
- Non far leggere a `bodyFat()` la formula maschile su un profilo femminile:
  sono due equazioni diverse e quella femminile richiede anche i fianchi
- Non sommare le calorie bruciate al target: sono già dentro il dispendio stimato
- Nei grafici a barre le etichette dell'asse x devono usare `g.xb` (centro della
  barra), non `g.x` (scala delle linee): lo scarto è mezza barra, invisibile su
  novanta giorni ed evidente su sette
- Non usare `nf()` per riempire il valore di un `<input>`: formatta 2482 come
  "2.482" e rileggerlo dà 2,482
- Non mettere le foto nel backup JSON: sono in IndexedDB perché in localStorage
  non ci starebbero. Vanno salvate a parte, e l'app deve dirlo
- Non spostare i dati nutrizionali dentro il codice
- Non introdurre un punteggio "cibo buono / cibo cattivo"
- Non aggiungere obiettivi di peso a scadenza né conti alla rovescia
- Non presentare come misurato ciò che è stimato. Il grasso corporeo esce da una
  formula su vita, collo e altezza e sbaglia di ±3–4 punti; le misure di Brad Pitt
  sono dichiarazioni di stampa (`fonte: "stima"`). Servono a dare una direzione,
  non un verdetto, e la UI deve dirlo
- Non far calcolare la composizione con un collo fuori scala (32–48 cm): la formula
  si regge sulla differenza vita−collo, 7 cm di errore lì valgono 5 punti di grasso.
  Meglio rifiutare il calcolo che dare un numero falso
