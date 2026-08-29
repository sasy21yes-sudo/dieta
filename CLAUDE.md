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
anim.js         toolkit di animazione (vedi sotto). Caricato PRIMA di charts.js
charts.js       toolkit SVG dei grafici + vista Dati
revisione.js    revisione settimanale: diagnosi, leve, impegno, priorita'
target.js       il target che si ricalibra sul dispendio + rampa fibre
previsioni.js   proiezioni di misure, composizione e forza a 28 giorni
cerca.js        selettore cercabile riusabile + dispensa
peso.js         pesate anomale e ciclo mestruale: cio' che sporca la bilancia
timer.js        timer di recupero fra le serie
carico.js       scarico automatico + dolori e infortuni
cardio.js       corsa e simili, tracciato GPS, cartolina PNG da condividere
salute.js       import di passi e sonno da un Comando iOS
sfide.js        sfide giornaliere, punteggi di costanza, traguardi, menu
giorno.js       porzioni per singolo giorno + scheda di dettaglio della giornata
piano.js        profili multipli + editor del piano (target, alimenti, pasti, settimana)
palestra.js     registro sedute, mappa muscolare, forma-fatica, progressione,
                catalogo esercizi da internet
prodotti.js     prodotti reali, codici a barre, ricerca alimenti su Open Food
                Facts, override degli alimenti
foto.js         foto dei progressi (IndexedDB) + autoscatto + timelapse +
                confronto a cursore
sw.js           cache offline; rete-prima su tutto, cache come riserva
manifest.json   PWA
data/dieta.json IL DOMINIO alimentare — vedi sotto
data/palestra.json catalogo esercizi, gruppi muscolari, modello forma-fatica
data/sfide.json 38 sfide giornaliere + 23 traguardi
data/corpo.json tracciati anatomici della mappa muscolare (MIT, vedi sotto)
icons/          180 (apple-touch), 192, 512, maskable
```

### `data/dieta.json` è un ESEMPIO, non il default

Il file contiene nome, età, peso e misure di una persona reale. **Chi installa
l'app non deve ritrovarsi quei dati addosso.** Al primo avvio un gate in
`route()` porta a `viewBenvenuto` e blocca tutto il resto finché non si sceglie:

- **vuoto** — profilo azzerato, nessun pasto, settimana senza assegnazioni,
  misure senza valori di partenza; i target si calcolano da Mifflin-St Jeor
  appena si inserisce il profilo. Il database dei 44 alimenti resta, perché
  sono valori nutrizionali generici e non dati di nessuno
- **esempio** — carica il piano completo, con l'avviso esplicito che contiene i
  dati di un'altra persona

`S.settings.pianoBase` tiene la scelta, e `fondiPiano()` la rispetta. Si può
cambiare idea dal passo "Piano di partenza".

Conseguenza da non dimenticare: con il piano vuoto `D.pasti[s.codice]` è
`undefined` per ogni slot. Ogni punto che legge un pasto dalla settimana deve
reggerlo — Oggi, la spesa e l'analisi lo fanno.

### I moduli si spengono

Non tutti vogliono la stessa app. C'è chi si costruisce il piano settimanale e
ci si attiene, e c'è chi vuole solo scrivere cosa ha mangiato oggi e vedere se
torna con i target. HYROX allo stesso modo interessa a pochi.

`S.settings.moduli = { piano, hyrox }`, con gli interruttori in `cardModuli()`
— al primo avvio e nel passo "Chi sei". **Spegnere non cancella niente:**
i dati restano dove sono e riaccendendo tornano tutti. Sparisce solo
l'interfaccia, e con essa i conti che ne dipendono.

Con `piano` spento: niente slot dei pasti su Oggi, niente "Da assegnare",
la tab **Spesa si nasconde** (`route()` la toglie: la lista nasce dalla somma
dei pasti assegnati, e senza pasti non c'è niente da sommare), i cinque passi
del piano diventano due, e il `.ics` non genera più i promemoria dei pasti.
Le barre macro reggono da sole perché `dayTarget()` ripiega già su `D.target`
quando il giorno non ha totali, e `consumed()` somma solo gli `extra`.

Con `hyrox` spento: via il riquadro d'ingresso in Gym; la rotta `#/hyrox`
resta raggiungibile da un vecchio segnalibro e mostra come riaccenderla.

**La migrazione dei backup vecchi** sta in `modulliDaStato()`, chiamata da
`normalize()` — quindi vale sia all'avvio sia dopo un import. Un file senza
`moduli` non è ambiguo: `piano: true`, perché è come si comportava l'app prima;
`hyrox` acceso **solo se ci sono dati veri dentro** (gara, record, simulazioni,
sedute, checklist), perché accenderlo a tutti riproporrebbe a tutti una sezione
che quasi nessuno usa. In nessuno dei due casi si perde un dato: al massimo una
voce di menu, che torna con un tocco.

Effetto collaterale utile: senza HYROX nessuno dichiara più quante sedute a
settimana fa, e la revisione settimanale non può più usare quel numero come
metro. `seduteAbituali()` prende la **mediana delle ultime otto settimane** —
confrontarti con un 4 tirato fuori dal nulla direbbe "sotto" a chi si allena
tre volte per scelta, che è un giudizio e non una misura.

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

- **Moduli accendibili** — piano alimentare e Road to HYROX si spengono dal
  passo "Chi sei". Spegnere non cancella: nasconde
- **Revisione settimanale** — diagnosi pesata della settimana chiusa, grafico a
  manubrio contro la precedente, cosa non ha funzionato, come si sistema e la
  sola cosa da cambiare. Si propone da sola la domenica e il lunedi
- **Timer di recupero**, **scarico automatico**, **dolori e infortuni** in Gym
- **Dispensa** — quello che hai in casa si sottrae dalla lista della spesa
- **Cerca un esercizio su internet** — catalogo pubblico di 873 esercizi con
  i gruppi muscolari gia assegnati, scaricato una volta e poi offline
- **Cerca un alimento su internet** — Open Food Facts per nome, con il
  controllo che i macro tornino con le calorie dichiarate
- **Scala il pasto** — moltiplicatore da ×0,5 a ×2 su tutti gli ingredienti
- **Autoscatto** — fotocamera dentro l app con conto alla rovescia: le foto dei
  progressi si fanno da soli, e con <input capture> non si poteva
- **Guide di inquadratura** — griglia, sagoma, e il fantasma dello scatto
  precedente in trasparenza: e quello che rende confrontabili due foto
- **Misure guidate** — una alla volta, con dove passare il metro disegnato sulla
  sagoma e il controllo dei valori fuori scala
- **Come si esegue** — due fotogrammi per esercizio dal catalogo pubblico
- **Confronto foto a cursore** — prima e dopo sovrapposte, con la riga che si
  trascina
- **Passi e sonno da un Comando iOS**, senza scriverli a mano
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
- **Quanto manca in tempo** — un intervallo, non una data, e si rifiuta quando
  il ritmo non e distinguibile da zero
- **Dove stai andando** — proiezioni a 28 giorni con banda su misure, grasso e
  massa magra, forza. Mai una data di arrivo: la forbice e il target dentro o fuori
- **Target ricalibrato** — il dispendio misurato dal filtro diventa una proposta
  di target, con la matrice del piano che la corregge. Mai applicata da sola
- **Giorni che non contano** — vacanza o influenza escono da revisione e costanza
- **Fiamma della striscia** — i giorni di fila disegnati, non scritti
- **Cardio** — corsa, bici, nuoto: a mano o col GPS, con la cartolina PNG da
  condividere. Entra nel conto delle sedute e nella spesa energetica
- **Integrazione dinamica** — l elenco lo componi tu, con l aderenza per voce
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
- **Sfide e traguardi** — una sfida al giorno scelta in modo deterministico
  sulla data (non si ricarica finché non esce quella comoda), con punti e giorni
  di fila; 23 traguardi che si sbloccano da soli sui dati già registrati
- **Costanza** — quattro punteggi su anelli: nutrizione, allenamento, sfide,
  generale. L'allenamento si misura sulle sedute a settimana dichiarate, non su
  tutti i giorni: riposare quando serve non abbassa il punteggio
- **Porzioni per giorno** — `S.log[k].porzioni[codice][alimento]` sovrascrive la
  quantità del piano solo per quel giorno; `mealMGiorno()` la applica
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

Il piano è un **calendario giorno per giorno da oggi alla gara**
(`pianoFinoAllaGara()`): ogni riga è una data con la sua seduta o il riposo,
raggruppata per settimana con la fase. Si sceglie quante sedute a settimana si
reggono (2–6) e i giorni si distribuiscono di conseguenza; l'ultima settimana è
scarico, la vigilia è riposo, l'ultimo giorno è la gara.

HYROX ha **tre sezioni**, non sei: il conto alla rovescia sta sempre in testa,
il piano dice cosa fare, le stazioni dicono a che punto sei e da lì parte la
simulazione. Tutto il resto era navigazione in più.

### Gym è un ingresso, non una colonna

Erano dodici carte una sotto l'altra — mappa, prontezza, volume, forma-fatica,
progressione, tonnellaggio, schede, storico. Tutto utile e tutto sempre in
mezzo: per registrare una serie si scorreva mezzo schermo, per rivedere il
volume l'altro mezzo.

Ora: **cosa fai oggi** in cima, **gli avvisi che non possono aspettare** subito
sotto (scarico consigliato, dolori in corso), e il resto in **riquadri con
icona e stato** — `gymTab`, lo stesso schema dei cinque passi del Piano, che
già funziona. La pagina passa da una colonna lunghissima a ~800 px.

La regola per decidere cosa sta fuori e cosa dentro: **in cima ci va quello che
cambia oggi e chiede un'azione.** Tutto quello che si guarda ogni tanto è una
sezione. Gli avvisi non sono sezioni: sono eccezioni, e spariscono da sole.

Le otto icone sono disegnate in `iconaGym()` — sette tratti l'una, non vale una
libreria. Stesso riquadro 24×24, stesso spessore, stesso arrotondamento: è
quello che le fa sembrare una famiglia invece di otto disegni. La prima
versione della mappa era una sagoma piena e a 23 px diventava una macchia:
pochi tratti netti si leggono, il dettaglio no.

Il contenuto delle sezioni è quello di prima **parola per parola**: è cambiato
dove sta, non cosa dice. Spostare e riscrivere insieme è il modo migliore di
introdurre un bug senza accorgersene.

### La mappa muscolare è anatomica

Prima era la figura parametrica con sopra dodici ellissi. Diceva *dove*, ma
un'ellisse sul petto non è un petto, e non si capiva mai se una zona era accesa
perché l'avevi allenata o perché la macchia era grande.

I tracciati ora vengono da
[react-native-body-highlighter](https://github.com/HichamELBSI/react-native-body-highlighter)
di ELABBASSI Hicham, **licenza MIT**, estratti in `data/corpo.json` con la nota
di licenza dentro il file. Quattro viste: maschile e femminile, fronte e retro —
e si sceglie dal profilo, perché mostrare a una donna una silhouette maschile è
il dettaglio che fa sembrare l'app scritta per qualcun altro.

Quello che è **nostro** è la mappatura: i 19 slug della sorgente ricondotti ai
13 muscoli del modello. `adductors`, `tibialis`, collo, mani, piedi e ginocchia
restano **sagoma neutra** — esistono nel disegno ma non fra i gruppi che l'app
conta, e colorarli vorrebbe dire inventarsi un dato. Stessa scelta già fatta
con free-exercise-db.

### Cardio, e perché il GPS ha un asterisco

**Su iPhone una pagina web non può registrare un percorso con lo schermo
spento.** Appena l'app va in secondo piano iOS la sospende e il GPS smette di
arrivare. Non è un limite dell'implementazione: le app che lo fanno sono native
e chiedono un permesso "sempre" che al web non esiste. `cardio.js` tiene acceso
lo schermo con la Wake Lock API e **lo dice prima di partire**, invece di far
scoprire a fine corsa che mancano otto chilometri. Chi non vuole tenere il
telefono in mano registra a mano: i conti vengono identici.

Due filtri sui punti, o la distanza si gonfia: si scartano le letture con
`accuracy > 35 m` e gli spostamenti sotto i 2 m (rumore del ricevitore, non
movimento). Le calorie della corsa usano il costo per chilometro
(`corsa_kcal_per_kg_km`) e non il MET, che sull'andatura sbaglia molto di più.

**La cartolina** è un canvas 1080×1350 generato sul telefono — la posizione non
esce dall'app. Niente mappa di sfondo: i tile OSM *mandano* CORS (verificato, si
potrebbero disegnare senza sporcare il canvas), ma la loro usage policy chiede
di non appoggiarsi al server pubblico per traffico applicativo, e da un browser
non si può nemmeno mandare uno User-Agent che identifichi l'app. Il tracciato si
proietta in equirettangolare **corretta sulla latitudine** — senza il coseno un
percorso a Milano si schiaccerebbe di un terzo — e si scala con lo stesso fattore
sui due assi, altrimenti un fuori-e-torna dritto diventerebbe un cerchio.

### L'integrazione è tua

Era una lista fissa in `data/dieta.json`: cinque voci uguali per chiunque, non
togliibili. Ma l'integrazione è la parte più personale del piano, e una lista
che non si tocca la si smette di guardare.

Ora `S.piano.integratori` è uno strato come `alimenti` e `pasti`: modifiche,
aggiunte, e rimozioni marcate `tolto` invece che cancellate — se cambi idea la
voce di base è ancora lì. Con il piano vuoto non si eredita niente: quelle
cinque voci sono le scelte di un'altra persona, come i pasti.

La checklist mostra **solo quello che tocca oggi** — la B12 settimanale in mezzo
agli altri sei giorni era una riga da ignorare, e a furia di ignorarla si
ignorano anche le altre. **Ma quel filtro va applicato solo ai giornalieri**, ed
è un errore già fatto una volta: applicato anche ai settimanali, la B12 spariva
sei giorni su sette e chi se la dimenticava il lunedì non poteva più segnarla
da nessuna parte. Una B12 presa di martedì è comunque presa.

I settimanali stanno quindi in un blocco **"questa settimana"** con lo stato
della settimana, non del giorno: se è già stata presa la riga dice quando ed è
chiusa, se no resta lì finché non la segni, in qualunque giorno — e si segna sul
giorno in cui l'hai presa davvero, non su quello previsto. Anche l'aderenza dei
settimanali si conta **a settimane**: contare i giorni darebbe 4 su 30 anche a
chi non ne ha saltata nemmeno una.

Ogni voce porta la sua **aderenza a 30 giorni** — serve a vedere quale salti
davvero, che di solito non è quella che credi. Il generatore `.ics` legge `D.integratori`, quindi cambiare
la lista cambia anche i promemoria del calendario.

Il limite, detto nella UI: l'app non misura il sangue e non conosce la tua
storia. Tiene l'elenco che le dai, ricorda quando tocca, e mostra cosa salti.
Cosa prendere si decide altrove.

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

Le due righe di riferimento — target e media — hanno due token loro,
`--rif` e `--media`, e non sono serie: sono annotazioni. Devono restare
distinguibili l una dall altra E dalla serie in tutti e tre gli ambiti (chiaro,
scuro, .hx). Passate dal validatore della skill dataviz a coppie complete.

Passandolo e saltato fuori un problema che c era gia: al buio il grigio del
target (#6E7B87) contro la serie (#4FA88F) dava **ΔE 13,0 a vista normale**,
sotto la soglia di 15 — due righe che si confondono anche a chi vede tutti i
colori. #B9C4CC porta la coppia peggiore a 17,0 normale e 12,5 in protanopia.
Nessuno lo aveva notato a occhio in mesi: e il motivo per cui il colore si
calcola invece di sceglierlo.

Le etichette delle due righe stavano sempre a destra, e a destra c e l ultimo
dato: sui grafici a barre finivano regolarmente sopra le barre. Ora si guarda
da che parte i dati sono piu lontani da quella riga e l etichetta va li, dove
c e aria; sotto ci resta comunque una piastrina del colore del fondo, perche
dove i dati riempiono tutto il riquadro un lato libero non esiste.

E quando target e media quasi coincidono — proprio il caso in cui fa piacere
vederlo — le due etichette finivano una sopra l altra: con target 2482 e media
2488 usciva "tmegaea". Ora la piu bassa va sotto la sua riga.

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
- **La media e anche una riga sul grafico**, accanto a quella del target:
  blu (`--media`) contro il grigio (`--rif`), e due tratteggi diversi — corto e
  lungo — perche l identita non deve mai stare solo nel colore. I due token
  sono passati dal validatore della skill dataviz a coppie complete, nei tre
  ambiti (chiaro, scuro, .hx)
- **Sotto ogni grafico la stessa riga**: ultimo valore, media del periodo,
  target, scarto. La media si ferma a IERI — la giornata in corso non e finita
  e la tira giu ogni mattina. La funzione e una sola (`riepilogo()`): quando
  ognuno se la costruiva, chi diceva il target e chi no e nessuno la media
- **Legenda su tutti**, anche con una serie sola: senza, il verde pieno e il
  tratteggio grigio sono due cose che il lettore deve indovinare
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

### Il target che si ricalibra

Per molto tempo l'app ha avuto **due metà che non si parlavano**. Da una parte un
filtro di Kalman che dopo qualche settimana sa quanto consumi meglio di
qualsiasi formula; dall'altra `D.target.kcal`, un numero messo a mano una volta
e mai più toccato. Quella conoscenza finiva in un grafico e moriva lì.

`target.js` chiude l'anello, con tre regole:

1. **Non si applica da sola.** Cambiare di nascosto il metro con cui l'app
   giudica le giornate significa che un giorno "buono" diventa "storto" senza
   che tu abbia fatto niente di diverso. La proposta si accetta, e la conferma
   mostra il confronto macro per macro.
2. **La correzione viene dalla matrice**, non da un'opinione nuova.
   `regole_calorie` è già la decisione del piano su peso × vita × carichi e
   l'analisi la applica già: qui si aggiunge solo il bottone che la esegue.
3. **Niente deficit da fame.** Pavimento a BMR × 1,1, e la UI dice qual è.

Le proteine **non scalano** con le calorie: restano ancorate al peso corporeo
(`p_per_kg`), perché sono la variabile che protegge la massa magra. Grassi al
25%, carboidrati a residuo.

E come tutto il resto: si sceglie un **ritmo**, non una scadenza.

**Rampa fibre** (stessa file): il piano ne prevede 38 g e chi arriva da
un'alimentazione normale sta a 15–20. Il salto in un colpo non è pericoloso ma
produce una settimana di gonfiore che fa mollare un piano che funzionava. Cinque
grammi a settimana, e la carta nomina anche l'acqua — le fibre senza acqua
peggiorano le cose invece di migliorarle.

### La revisione chiude il cerchio

`data/dieta.json` conteneva `leve` — quattro mosse concrete da ±150 kcal scritte
a mano da chi ha costruito il piano — e **non le leggeva nessuno** dalla prima
versione. Erano esattamente la risposta alla domanda che la revisione lasciava
aperta. Ora `levaPerPriorita()` le propone, scegliendo per segno, e **solo** sulle
priorità caloriche: infilare una leva da 150 kcal sotto "dormi troppo poco"
sarebbe un consiglio a caso.

Poi l'**impegno**: la priorità della settimana si può prendere come impegno, e
domenica prossima `esitoImpegno()` guarda se quella voce è ancora fra gli errori.
Non chiede "ce l'hai fatta?" — a quella domanda si può rispondere di sì senza che
sia vero. Guarda i numeri, e distingue tre casi: sparito, ancora primo (la mossa
era troppo grande), ancora presente ma meno grave.

### Giorni che non contano

Vacanza, influenza, trasferta. Una settimana d'ospedale giudicata col metro di
una normale non misura niente: dice che è andata male, cosa che sapevi.
`S.settings.pause` **non cancella niente** — i dati restano e si vedono ovunque —
ma `costanze()` e `metricheSettimana()` saltano quei giorni, e il denominatore
scende con loro (dividere per 28 invece che per 21 misurerebbe che ti sei
ammalato, non la tua costanza).

Con una cautela: se una settimana è interamente in pausa non si filtra a zero,
si lascia com'è. Altrimenti la revisione direbbe "nessun dato" quando i dati ci
sono, sono solo da non giudicare.

### Quanto manca, in tempo

Per molto tempo qui non c'è stato niente del genere, e la regola era netta:
niente date di arrivo. La ragione non era filosofica, era **aritmetica** — il
tempo è distanza ÷ ritmo, e quando il ritmo si avvicina a zero l'errore
relativo esplode.

Fatto il conto propagando la banda che il motore già calcola (su 9 cm di vita
da togliere, orizzonte 28 giorni, banda ±0,3):

| Ritmo su 28 gg | Punto | Intervallo vero al 95% |
|---|---|---|
| −1,4 | 80 giorni | 66–102 giorni — **usabile** |
| −0,6 | 6 mesi | 4 mesi – 1 anno |
| −0,25 | 15 mesi | 7 mesi – **mai** |
| quasi fermo | 3 anni | 9 mesi – **mai** |

Quindi non un contatore, ma `tempoAlTarget()`, che sa in quale dei cinque casi
si trova: **ci sei** (la differenza è già dentro la forbice), **stretto**,
**largo** (con l'avvertenza che il numero da tenere è quello alto),
**incerto** — l'intervallo del ritmo contiene lo zero, quindi "non ci arrivi" è
dentro le possibilità e non si scrive nessun numero — e **lontano**, quando ti
stai muovendo dall'altra parte.

Tre cose lo distinguono da un conto alla rovescia, e sono quelle che lo rendono
onesto: è un **intervallo**, si **ricalcola** ogni volta sul ritmo di adesso —
verificato: rallentando da −1,4 a −0,8 il numero *sale* da 148–229 a 229–504
giorni — e **si rifiuta** invece di inventare.

Sta sotto il grafico della misura scelta in *Dove stai andando*. Non c'è sul
peso, perché il peso in quest'app **non ha un target**: quello è ancora un
obiettivo a scadenza, e resta fuori.

### Le altre proiezioni

`previsioni.js` estende alle misure, alla composizione e alla forza la regola
che governa già il peso: **si proietta la tendenza a un orizzonte fisso con una
banda, mai una data di arrivo.** "Il target lo raggiungi il 14 marzo" è un conto
alla rovescia travestito da previsione — presuppone che il ritmo di oggi valga
per mesi, cosa che non succede mai. Quello che si può dire è: fra 28 giorni sarai
in questo intervallo, e il target ci sta dentro **oppure no**.

Qui non c'è un filtro di Kalman ma una **retta ai minimi quadrati**, per lo
stesso motivo per cui la proiezione della forza in palestra la usa: le
osservazioni sono poche e distanti, e il segnale è più grande del rumore. R² è
sempre mostrato — una retta si tira anche dentro una nuvola che non dice niente.

Due dettagli imparati alla prova, entrambi contro la **falsa precisione**:

- la banda ha un **pavimento** — 0,5 cm sulle misure (la risoluzione vera di un
  metro da sarto), 2,5 kg sulla forza (il disco più piccolo). Qualche punto
  quasi allineato fa collassare i residui a zero, e un "±0,0 cm" sarebbe una
  precisione che nessuno possiede;
- una serie **piatta** (stesso valore ogni volta) dà R² = 0 per costruzione,
  perché non c'è varianza da spiegare. Mostrarlo come "la retta non spiega
  niente" direbbe il contrario di quello che è successo: si scrive "ferma", e si
  fa notare che capita anche riscrivendo il valore della volta prima invece di
  rimisurare.

La composizione proiettata è una stima costruita su **altre due stime** — peso
previsto e vita prevista — dentro una formula che già sbaglia di 3–4 punti. Non
è un motivo per non mostrarla, è un motivo per ripetere ogni volta che serve a
vedere la direzione (grasso giù, massa magra che tiene) e non il numero.

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

### Le animazioni

`anim.js` sta su tre regole, in quest'ordine:

1. **`prefers-reduced-motion` prima di tutto.** Circa una persona su tre naviga
   con le animazioni ridotte. Quando è attivo non si anima: si salta allo stato
   finale, che deve essere sempre leggibile da solo. Nel CSS la durata si azzera
   a `.01ms` e non a `0`, altrimenti certi browser non emettono più gli eventi
   di fine transizione
2. **Si anima solo ciò che entra in vista, e una volta sola** (`osserva()`, con
   `unobserve` immediato). Animare venti grafici al caricamento fa scattare il
   telefono e non fa vedere niente
3. **Solo `opacity`, `transform` e `stroke-dashoffset`**: sono le proprietà che
   il browser compone sulla GPU. Animare `width` o `top` ricalcola il layout a
   ogni fotogramma

**La fiamma della striscia** è l'unica animazione infinita di tutta l'app, e ci
sta perché non è decorazione: il riempimento interno viene dal numero di giorni
(sei stadi, non un continuo — a occhio la differenza fra 14 e 15 giorni non si
vede comunque). Lo sfarfallio muove solo `transform` e con `reduced-motion`
sparisce: la fiamma resta piena allo stesso modo, perché è il **riempimento** a
portare il dato, non il moto.

Le altre piccolezze seguono la stessa regola — animare solo dove il movimento
*dice* qualcosa: la spunta della sfida che si disegna (l'hai fatta tu, non era
già così), le barre macro che crescono da sinistra con `scaleX` e non con
`width`, il rimbalzo sul tick del pasto che conferma il tocco prima che la
pagina si ridisegni, i coriandoli su una sfida completata e su un impegno
mantenuto.

Il pezzo forte è `disegnaPath()`: si misura la lunghezza vera del tracciato,
la si usa come trattino e si fa scorrere l'offset — la tecnica classica, l'unica
che funziona senza librerie. L'offset **non** si scrive inline: la keyframe parte
da `len` con `fill: 'backwards'`, così a riposo la linea è intera.

### La revisione settimanale

La settimana è l'unità giusta: il giorno è rumore, il mese arriva tardi per
correggere. `revisione.js` confronta i sette giorni chiusi con i sette prima e
risponde a tre domande in quest'ordine: **cosa non ha funzionato**, **come si
sistema**, **quale una cosa cambiare**.

`diagnosiSettimana()` non elenca: **pesa**. Registro 100, proteine 92, sonno 88,
sedute 80, calorie 76/70, acqua 58, fibre 52, passi 44. Ordinare per gravità e
non per evidenza è tutta la differenza fra un elenco e un consiglio. La priorità
è **una sola** — cambiarne cinque insieme rende impossibile capire cosa ha
funzionato.

Il grafico è a **manubrio**, non a pendenza. La pendenza sembrava la forma ovvia
e alla prova non reggeva: otto metriche quasi tutte vicine al target si
accalcavano in una banda alta trenta pixel e le etichette si sovrapponevano per
forza. Il manubrio dà a ogni voce una riga di altezza fissa — collisione
impossibile — e mette il movimento in orizzontale. Un asse solo: la percentuale
del proprio target, l'unico metro che tiene sulla stessa figura i passi e i litri.

### Timer, scarico, acciacchi

- **Timer di recupero** (`timer.js`) — sopravvive ai cambi di schermata perché
  sta in `localStorage`, e calcola il residuo da un timestamp invece di contare
  i tick. Il bip suona solo con l'app in primo piano, e la UI lo dice
- **Scarico** (`carico.js`) — tre segnali indipendenti e ne servono due: carico
  acuto contro cronico sopra 1,35, forza ferma o in calo su ≥2 esercizi,
  ≥6 settimane di fila senza una più leggera. `traiettoriaFatica()` fa in una
  passata quello che `formaFatica()` rifarebbe da capo quaranta volte per muscolo
- **Acciacchi** — li dichiara l'utente. Livello 2 toglie gli esercizi dove il
  muscolo è primario, livello 3 anche quelli dove è secondario. L'avviso compare
  dentro la scheda, dove stai per farli

### Il peso, ripulito

`peso.js` toglie dalla **tendenza** (non dal diario) due cose che non sono grasso:

- **Pesate anomale**, riconosciute con mediana e MAD. Misurato: un 76,4 battuto
  in mezzo a sessanta giorni intorno ai 69 spostava la tendenza di un chilo, che
  dentro il bilancio energetico diventava **566 kcal al giorno** di dispendio
  inventato. Soglia minima 1,2 kg — l'oscillazione giornaliera è reale — e
  l'ultima parola resta all'utente
- **Ciclo mestruale**, solo sui profili femminili. In luteale la ritenzione vale
  fino a due chili. Non si prova a sottrarla — quanta sia non lo sappiamo — si
  allarga l'incertezza dell'osservazione sulle finestre che cambiano fase: su
  ventotto giorni ne tocca quattro e lascia stare le altre ventiquattro

### Cercare un alimento su internet

Il bottone sta in **Piano → Cosa mangi → Aggiungi un alimento**, e interroga
Open Food Facts. Tutto il dialogo con quell'archivio — codice a barre e ricerca
per nome — sta in `prodotti.js`: è l'unico punto da cui esce una richiesta di rete.

**L'endpoint non è intercambiabile**, e la scelta va rispettata:

| Endpoint | Verdetto |
|---|---|
| `/api/v2/search` | accetta `search_terms` ma non ordina davvero: cercando "fagioli borlotti" torna un formaggio marocchino su 4,7 milioni di risultati |
| `search.openfoodfacts.org` | il motore nuovo, cerca benissimo, ma **non manda `Access-Control-Allow-Origin`**: dal browser la risposta è inagibile |
| `/cgi/search.pl` | cerca bene, manda `ACAO: *`, e il preflight con `X-User-Agent` passa e resta in cache venti giorni. **L'unico dei tre utilizzabile** |

`X-User-Agent` perché il `User-Agent` vero il browser non lo lascia impostare, e
Open Food Facts chiede alle app di identificarsi. La ricerca parte solo su
richiesta esplicita, mai a ogni tasto: l'archivio chiede di stare sotto le dieci
ricerche al minuto e un autocomplete le brucerebbe in cinque secondi.

**`coerenza()` è la parte che conta.** I valori li inseriscono le persone e
sbagliano: nei test un petto di pollo dichiarava 30 kcal con 20 g di proteine.
Si ricalcolano le calorie dai macro (4/4/9, più 2 per le fibre, che in etichetta
UE stanno fuori dai carboidrati) e si confronta: sotto il 15% è normale, sopra
il 30% qualcuno ha sbagliato a digitare. Quelli incoerenti restano visibili ma
con l'etichetta "non torna" e ordinati in fondo — non si nascondono, si segnalano.

Un alimento importato da lì nasce `fonte: "stima"`, non `verificato`: un archivio
collaborativo non è l'etichetta sulla confezione. Diventa `verificato` solo se
l'utente tocca "li ho controllati sulla confezione".

### Cercare un esercizio su internet

Il bottone sta in **Gym → I tuoi esercizi**. La fonte è
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense,
pubblico dominio), un JSON statico su jsDelivr. Il client sta in `palestra.js`,
accanto all'editor che riempie, come quello di Open Food Facts sta in `prodotti.js`.

**Perché un file statico e non una API.** Provate tutte e tre prima di scegliere:

| Fonte | Verdetto |
|---|---|
| wger.de | API REST vera, muscoli strutturati, pure l'italiano. Ma `/exercise/search/` oggi risponde 404 (l'hanno tolto) e `?search=` viene ignorato: torna comunque tutti e 862. Senza ricerca lato server resta scaricare l'intero catalogo, che con descrizioni, immagini e traduzioni pesa **5,5 MB** |
| ExerciseDB, API Ninjas | Vogliono una chiave. Qui non c'è un server dove nasconderla, e una chiave nel codice della pagina è una chiave regalata |
| free-exercise-db | 873 esercizi, `ACAO: *`, **168 KB compressi**. Nessuna API da farsi deprecare sotto i piedi |

E soprattutto ha i due campi che servono a *questa* app: i muscoli primari e
secondari, che alimentano mappa muscolare, volume, forma-fatica e il filtro
degli acciacchi; e `mechanic` (compound/isolation), da cui esce il `tipo` e
quindi il recupero consigliato. **wger il secondo non ce l'ha.**

Si scarica una volta, si buttano istruzioni e immagini (il 90% del peso:
da 1 MB a 89 KB) e si tiene in `localStorage` sotto `dieta.exdb`. Da lì in poi
la ricerca è locale — filtra mentre scrivi, e funziona offline.

**I due gruppi senza casa.** La fonte ha 17 muscoli, il modello di questa app
ne ha 13: `adductors` e `neck` non hanno corrispondenza. Non vanno infilati a
forza dentro glutei o trapezi — sporcherebbero la mappa e il conteggio del
volume, che sono la ragione per cui i muscoli esistono qui dentro. Si segnala
e si fa scegliere; il salvataggio pretende già almeno un primario, quindi non
si può salvare un esercizio che non colora niente.

Serie e incrementi **non sono nella fonte**: escono da attrezzo e `mechanic`
(multi 6–10, isolamento 10–15; bilanciere +2,5, manubri +2, macchina +5),
in linea con i valori già in `data/palestra.json`. Sono valori di partenza,
e la UI lo dice.

Nel farlo è saltato fuori un bug vecchio: gli esercizi tuoi nascevano con
`tipo: 'mio'`, che nessuna parte del codice sa leggere — `recupeoConsigliato()`
li trattava perciò **sempre da isolamento**, 75 secondi anche su uno stacco.
Ora l'editor ha il selettore multi/isolamento e il tipo si salva davvero.

### L'autoscatto, e perché serviva

Le foto dei progressi si fanno **da soli**, in casa. Con `<input capture>` si
finisce nella fotocamera di sistema: il timer c'è, ma va trovato, e a ogni
scatto si ripassa da lì. Quindi la fotocamera è nostra — `getUserMedia` per
l'anteprima, conto alla rovescia, fotogramma su canvas, poi la stessa
`comprimi()` di prima. Il file picker resta per la galleria e come riserva.

Tre dettagli che su iPhone non sono facoltativi:

- **`playsinline`** (attributo *e* proprietà), o Safari apre il video a schermo
  intero e l'anteprima sparisce dietro il player
- le tracce vanno **fermate a mano** alla chiusura, o la spia della fotocamera
  resta accesa
- l'anteprima frontale si specchia in CSS perché è così che ci si aspetta di
  vedersi, ma **lo scatto si salva non specchiato**: due foto a mesi di distanza
  devono essere confrontabili, e un ribaltamento in mezzo rovinerebbe il
  confronto a cursore

Il conto alla rovescia riusa `recBip()` di `timer.js`, e come quello suona solo
con l'app in primo piano — la UI lo dice.

### Le guide di inquadratura

Il problema delle foto dei progressi non è la qualità dello scatto: è che fra
una e l'altra cambia la distanza, l'altezza del telefono e l'angolo. Il
confronto a cursore lo rende impietoso — se l'inquadratura balla sembra
cambiato il corpo quando è cambiato il fotografo.

Tre guide sopra l'anteprima, in ordine di quanto servono:

1. **Fantasma** — l'ultimo scatto di quella posa in trasparenza. È quello che
   conta: ti allinei alla foto di prima e l'inquadratura torna identica senza
   ricordare niente. È quello che fanno le app dedicate all'allineamento, ed è
   il default
2. **Sagoma** — la silhouette di `data/corpo.json`, per il primo scatto quando
   un fantasma non c'è ancora. Sulla posa **di lato** la nota avvisa che quella
   figura è di fronte: una sagoma laterale non esiste nella sorgente, e far
   combaciare una posa di profilo con una figura frontale sarebbe peggio che
   niente
3. **Griglia** — i terzi, più due tacche dove far cadere testa e piedi: la
   distanza dal telefono è ciò che cambia di più

L'opacità è regolabile perché su una foto scura il fantasma sparisce e su una
chiara copre l'anteprima.

### Prendere le misure

Il problema delle circonferenze non è scrivere il numero: è prenderlo **sempre
nello stesso punto**. Due centimetri di scarto fra una volta e l'altra sono più
grandi di qualunque cambiamento reale in un mese, e il grafico diventa rumore.

Perciò `sheetMisura()` mette prima **come** si misura e **dove**, e solo dopo il
campo. Le istruzioni stanno in `data/dieta.json` (`come`, `min`, `max` su ogni
voce di `misure`): sono contenuto di dominio come i 44 alimenti, non copy della
UI. `figuraPunto()` disegna una sagoma neutra con il metro tratteggiato alla
quota giusta — le coordinate `x`/`y` erano già nel file e non le usava nessuno.

`seq` fa il giro completo di tutte e sei senza tornare al menu ogni volta, con
±0,5 cm a portata di pollice. Un valore fuori dall'intervallo plausibile non
viene rifiutato — magari è vero — ma viene detto, perché una misura sbagliata
resta nei grafici per mesi e sposta anche la stima del grasso.

### "Il video dell'esecuzione" — cosa esiste davvero

**Non esiste una fonte di video usabile.** Verificato prima di rinunciarci:
wger ha 78 video su 862 esercizi (il 9%), e sono `.MOV` da 34–60 MB l'uno.
Sessanta megabyte per guardare come si fa uno stacco, su rete dati, non è una
funzionalità. Le librerie a pagamento vogliono una chiave, e non c'è un server
dove nasconderla.

Quello che c'è, e per **tutti e 873** gli esercizi, sono due fotogrammi —
partenza e arrivo, ~70 KB l'uno — dallo stesso `free-exercise-db` del catalogo.
Alternati ogni 900 ms fanno vedere il movimento. Non è un video, e la UI **non
lo chiama così**: lo dice, e offre un link a YouTube che apre fuori dall'app.

Il collegamento esercizio → fotogrammi sta in `S.palestra.esec` e si fa una
volta. Gli esercizi del catalogo di base hanno nomi italiani: indovinare
l'accoppiamento a tentativi produrrebbe l'esecuzione **sbagliata**, che è peggio
di nessuna esecuzione. Chi importa dal catalogo online se lo porta dietro da
solo (`exdbId`).

### Passi e sonno senza scriverli

Nessuna API web legge HealthKit. Un **Comando iOS** però ha i permessi che il
browser non ha: legge il dato e apre `#/importa?passi=8432&sonno=7.4&data=…`,
che `salute.js` valida e scrive. Un'automazione a ora fissa lo fa partire da
sola. Il prezzo è che l'app va in primo piano per un attimo, e la schermata
lo dice prima.

## Roadmap suggerita

I punti 1, 2 e 4 della vecchia roadmap sono fatti (revisione settimanale,
doppia progressione, moltiplicatore sulle porzioni). Restano:

1. **Rampa fibre** — l'utente parte da ~15-20 g e il piano ne prevede 38. Avvisare se
   il salto settimanale supera i 5 g
2. **Push reale** via Cloudflare Worker, solo se i promemoria da Calendario non bastano
3. **Sostituzione automatica negli acciacchi** — oggi l'app dice "questo esercizio
   ci va sopra"; potrebbe proporre il ricambio piu' vicino per gruppo muscolare
4. **Dispensa che si scala da sola** mentre spunti i pasti. Attenzione: un
   inventario che non torna e' peggio di nessun inventario, per questo oggi
   la dispensa la aggiorni tu quando fai la spesa

## Cose da non fare

- Non promettere il tracciamento GPS in background: su iOS una PWA viene
  sospesa appena esce dal primo piano e il GPS smette. Si tiene acceso lo
  schermo con la Wake Lock e lo si dice PRIMA, non a corsa finita
- Non dichiarare due volte lo stesso nome al livello superiore di due file:
  sono tutti nello stesso scope globale, e un `const` duplicato uccide l'intera
  app all'avvio senza dire niente. E' successo con PRIORITA fra hyrox.js e
  piano.js: la pagina restava bianca e nessun `node --check` lo vedeva
- Non provare solo il piano di esempio: il percorso consigliato a chi installa
  e "comincio da zero", e li D.pasti e D.alimenti sono VUOTI. Un elenco vuoto
  va detto, e esc(null) stampa la parola "null"
- Non aggiungere un framework né una libreria di grafici: i grafici sono SVG
  costruito a mano proprio per non introdurre un build step. L'app è divisa in
  più file per restare modificabile dal telefono, non per essere impacchettata
- Non far leggere a `bodyFat()` la formula maschile su un profilo femminile:
  sono due equazioni diverse e quella femminile richiede anche i fianchi
- Non sommare le calorie bruciate al target: sono già dentro il dispendio stimato
- Nei grafici a barre le etichette dell'asse x devono usare `g.xb` (centro della
  barra), non `g.x` (scala delle linee): lo scarto è mezza barra, invisibile su
  novanta giorni ed evidente su sette
- Non far vedere due serie su un grafico senza legenda: i punti grezzi lontani
  dalla media mobile sembrano un errore di allineamento, e non lo sono
- Non usare `nf()` per riempire il valore di un `<input>`: formatta 2482 come
  "2.482" e rileggerlo dà 2,482
- Non mettere le foto nel backup JSON: sono in IndexedDB perché in localStorage
  non ci starebbero. Vanno salvate a parte, e l'app deve dirlo
- Non spostare i dati nutrizionali dentro il codice
- Non introdurre un punteggio "cibo buono / cibo cattivo"
- Non aggiungere obiettivi di peso a scadenza né conti alla rovescia
  (vedi però "Quanto manca, in tempo": un intervallo non è un conto alla rovescia)
- Non far applicare da sola una modifica al target: cambia il metro con cui
  l app giudica ogni giornata registrata, e un giorno buono diventerebbe storto
  senza che l utente abbia fatto niente di diverso
- Non scalare le proteine insieme alle calorie quando si ricalibra il target:
  restano ancorate al peso corporeo, sono la variabile che protegge la massa magra
- Non usare una pausa per nascondere le settimane storte: quelle servono, ed e
  da quelle che la revisione impara. La pausa e per i giorni in cui il piano
  non era nemmeno in gioco
- Non far collassare a zero la banda di una proiezione: va messo un pavimento
  alla risoluzione dello strumento (0,5 cm sul metro, 2,5 kg sui dischi).
  Una forbice di ±0,0 è precisione che nessuno possiede
- Non dire mai una **data** di arrivo, e non far scendere un contatore giorno
  dopo giorno: quello diventa una scadenza da mancare. Un **intervallo** che si
  ricalcola sul ritmo di adesso — e che quindi può anche allungarsi — è un'altra
  cosa, ed è quello che fa `tempoAlTarget()`. Con una regola sopra tutte: quando
  l'intervallo del ritmo contiene lo zero, non si scrive un numero
- Non presentare come misurato ciò che è stimato. Il grasso corporeo esce da una
  formula su vita, collo e altezza e sbaglia di ±3–4 punti; le misure di Brad Pitt
  sono dichiarazioni di stampa (`fonte: "stima"`). Servono a dare una direzione,
  non un verdetto, e la UI deve dirlo
- Non far calcolare la composizione con un collo fuori scala (32–48 cm): la formula
  si regge sulla differenza vita−collo, 7 cm di errore lì valgono 5 punti di grasso.
  Meglio rifiutare il calcolo che dare un numero falso
- **Non far produrre a un'animazione l'unico contenuto della pagina.** Il numero
  va scritto prima, l'anello va già riempito, la linea ha `stroke-dashoffset` zero
  di suo. L'animazione riparte da capo e ci riarriva. Se l'IntersectionObserver
  non scatta — scheda in secondo piano, elemento fuori vista, browser senza
  l'API — la pagina deve essere comunque giusta. Questo errore è già stato fatto
  due volte: i riquadri della revisione uscivano vuoti e le linee invisibili
- Non promettere la lettura dei passi da HealthKit: **non esiste nessuna API web
  che la faccia**, né su iOS né su Android. L'unica strada senza server è un
  Comando che apre l'app con il valore nell'URL, ed è quella implementata
- Non contare i tick per misurare il tempo: iOS strozza `setInterval` in secondo
  piano. Si salva l'istante di partenza e si sottrae
- Non confrontare la fatica di Banister con una soglia assoluta: con tau_forma 42
  e tau_fatica 7 la prontezza di chi si allena è **sempre** positiva, per
  costruzione. Il numero che dice qualcosa è il rapporto fatica/forma diviso il
  suo valore di regime
- Non sostituire `/cgi/search.pl` con `search.openfoodfacts.org` perché è più
  moderno: quel dominio non manda `Access-Control-Allow-Origin` e dal browser la
  richiesta viene bloccata. È stato verificato con i header alla mano, non supposto
- Non marcare `verificato` un alimento che arriva da Open Food Facts: quei valori
  li inseriscono gli utenti dell'archivio. Nasce `stima` e lo diventa solo se
  qualcuno conferma di averlo letto sulla confezione
- Non chiamare "video" i due fotogrammi dell'esecuzione, e non indovinare a
  quale esercizio del catalogo pubblico corrisponde un esercizio italiano:
  mostrare l'esecuzione sbagliata è peggio che non mostrarne nessuna
- Non salvare specchiato lo scatto della fotocamera frontale: l'anteprima sì
  (è come ci si aspetta di vedersi), il file no, o il confronto a cursore fra
  due foto a mesi di distanza si ribalta a metà
- Non far cancellare dati a un interruttore di modulo: spegnere nasconde, non
  distrugge. E non dare per scontato che `S.settings.moduli` esista — un backup
  scritto prima non ce l'ha, e `modulliDaStato()` lo deduce
- Non mappare `adductors` e `neck` di free-exercise-db dentro glutei o trapezi
  per far quadrare i conti: la mappa muscolare, il volume e la forma-fatica si
  reggono su quei gruppi. Un muscolo senza corrispondenza va dichiarato, non
  indovinato
- Non usare media e deviazione standard per riconoscere una pesata sbagliata:
  il valore anomalo alza sia la media sia lo scarto e finisce per giustificarsi
  da solo. Servono mediana e MAD
