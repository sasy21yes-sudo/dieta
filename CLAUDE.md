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
index.html      guscio: topbar, <main>, tab bar (5 voci), sheet modale
style.css       design system (variabili CSS, tema chiaro/scuro automatico)
viz.css         tavolozza dei grafici + componenti di Dati, Prodotti, Foto
app.js          stato, router, viste principali, motori. Caricato PER ULTIMO:
                costruisce ROUTES e chiama init(), quindi le viste degli altri
                file devono gia' esistere
anim.js         toolkit di animazione (vedi sotto). Caricato PRIMA di charts.js
icone.js        le icone prese da Feather/Lucide, ricopiate dentro (vedi sotto)
charts.js       toolkit SVG dei grafici + vista Dati
revisione.js    revisione settimanale: diagnosi, leve, impegno, priorita'
obiettivo.js    l'obiettivo (cut/ricomp/mantenimento/bulk) e il fisico a cui punti
target.js       il target che si ricalibra sul dispendio + rampa fibre
previsioni.js   proiezioni di misure, composizione e forza a 28 giorni
cerca.js        selettore cercabile riusabile
spesa.js        la lista della spesa e la dispensa (vedi sotto)
peso.js         pesate anomale e ciclo mestruale: cio' che sporca la bilancia
timer.js        timer di recupero fra le serie
seduta.js       la seduta guidata, il recupero ad anello, il resoconto di una seduta
carico.js       scarico automatico + dolori e infortuni
cardio.js       corsa e simili, tracciato GPS, cartolina PNG da condividere
salute.js       import di passi e sonno da un Comando iOS
scambio.js      esporta/importa un pezzo solo: la dieta, le schede, o tutti e due
pdf.js          generatore di PDF scritto a mano (font di base, WinAnsi)
statistiche.js  i conti del resoconto: registro, settimana, pasti, fuori piano
confronto.js    due alimenti a confronto: a parita' di peso, calorie, proteine
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
data/fisici.json 11 fisici di riferimento — dichiarazioni di stampa, non misure
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
- **Il periodo si sceglie** — la settimana chiusa resta il default, ma revisione
  e cruscotto accettano due date qualsiasi. Il confronto e' sempre con il
  periodo di **pari lunghezza** subito prima
- **Resoconto in PDF** — la revisione piu' otto sezioni di dati su A4, generato
  sul telefono senza librerie e senza server. Da dare a chi l'app non ce l'ha
- **Controllo della versione** — quale versione stai usando, se ce n'e' una
  nuova, e un bottone per ricaricare. Su iPhone non c'era nessun altro modo
- **Seduta guidata** — un esercizio alla volta, il carico gia' scritto da
  quello che hai appena fatto, le ripetizioni fatte a portata di pollice, e il
  recupero ad anello che prende il posto della carta e diventa rosso se lo
  superi; le superserie si fanno alternate come in sala. Chiudendo per sbaglio
  si riprende da dove si era
- **Resoconto di una seduta** — cosa e' stata quella giornata, con i motori di
  Gym che ci sono gia': volume, dove e' finito il lavoro, massimali mai visti
  prima, recupero vero, e il confronto con le sedute confrontabili
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
- **Oggi** — giorno navigabile, cinque barre consumato/target (kcal, proteine,
  carboidrati, grassi, fibre), pasti spuntabili con i macro di ognuno,
  totale residuo, registrazione pasti fuori piano senza tono colpevolizzante
- **Sostituzioni** — motore che, dato un alimento e una quantità, riscala per far
  combaciare il macro dominante (proteine se danno >20% delle calorie, altrimenti
  calorie) e ordina per distanza sui quattro macro **e per affinità di nome**.
  Si **applicano**, solo per quel giorno, e si può anche scegliere a mano
  qualunque alimento: vedi "La sostituzione si applica"
- **Diario** — acqua a bicchieri e Coca Zero a lattine, passi, sonno, fame,
  energia, aderenza, sintomi gastrointestinali, checklist integratori.
  L'allenamento non si dichiara: si legge da quello che hai registrato
- **Corpo** — il peso del giorno grande al centro, con i due bottoni da 100 g;
  composizione stimata contro il fisico di riferimento; figura SVG
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
  previsione. Un prodotto che non e' collegato a niente compare comunque
  nell'elenco del pasto fuori piano (`mangiabili()`), mentre uno gia' collegato
  no: sarebbe la stessa cosa due volte, una col nome del piano e una col suo
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
- **Passa il piano, non l'archivio** — export/import del solo piano alimentare,
  delle sole schede di palestra, o di tutti e due. Il file si carica **sopra** a
  quello che hai, non al posto: sui nomi che esistono gia' si sceglie. Sta in
  Impostazioni, in Piano e dentro le schede in Gym — nei tre punti in cui viene
  in mente

### Calorie bruciate: il punto in cui quasi tutte le app sbagliano

`kcalAllenamento(k)` stima la spesa di una giornata da palestra e HYROX insieme
(MET dal Compendium, in `data/palestra.json`; la corsa a 1,036 kcal/kg/km).

**Questo numero non va MAI sommato al target né sottratto dall'introito.** Il
dispendio del filtro di Kalman nasce dal bilancio fra quanto si mangia e come
cambia il peso: contiene già tutto il movimento, allenamenti compresi. Sommarlo
di nuovo sarebbe contarlo due volte. Serve a misurare il carico di lavoro nel
tempo, non a mangiare di più — e la UI deve continuare a dirlo.

### "Forma e fatica" non diceva cosa stava misurando

Erano tre curve — forma, fatica, prontezza — in unita' dichiaratamente
arbitrarie, senza soglia e senza unita' di misura. Alla domanda "cosa sta
misurando?" il grafico non rispondeva, e tre linee che non rispondono si
guardano una volta e poi si saltano. Peggio: la curva messa **in evidenza**
era la prontezza, che per costruzione e' sempre positiva per chi si allena
(τ 42 contro 7) — cioe' la sola che non poteva dire di no.

Il numero che decide qualcosa e' uno: **quanta fatica hai addosso rispetto a
quella che porti di solito su quel muscolo**. 100 e' una giornata come le
altre tue. Un asse, un'unita', un riferimento — e il riferimento sei tu.

Sopra il grafico una riga in italiano dice lo stato di adesso, perche' la
risposta non deve costringere a leggere un grafico.

Perche' non una soglia fissa: vedi "Il metro del recupero sei tu" piu' sotto.
E' l'errore che questo file segnalava da sempre e che il codice faceva lo
stesso.

Dettaglio di lingua che vale anche altrove: una riga di riferimento non e'
sempre un "target". Su una soglia da **non** superare chiamarla target direbbe
che ci vuoi arrivare, quindi `tTarget` le da' il nome giusto — qui "pronto
sotto" — nella legenda, sulla piastrina e nella riga di riepilogo.

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

### Le tecniche hanno un numero, non solo un nome

`tecnica` diceva "stripping" e si fermava li': quante ripetizioni per ogni
scarico te le ricordavi tu. Uguale il piramidale — "il carico sale e le
ripetizioni scendono", ma quali? — e il rest-pause, che non diceva quante
ripartenze. Il risultato e' che la scheda descriveva **il genere** di lavoro e
non il lavoro.

Tre campi nuovi sulla riga, tutti facoltativi:

| Campo | Cosa dice |
|---|---|
| `strip: [6, 4]` | gli scarichi di uno stripping, in ripetizioni. "Stripping 3x8-6-4" = `serie 3, reps 8, strip [6,4]` |
| `piram: [12, 10, 8]` | le ripetizioni serie per serie. Quante serie sono lo dice la lunghezza |
| `rpMini: 2` | quante ripartenze in un rest-pause |

### Il recupero si dichiara, e a due livelli

`recupeoConsigliato()` calcolava il recupero da attrezzo e ripetizioni e non
si poteva contraddire: erano valori di uso comune spacciati per decisione.
Ora sono tre livelli, e vince il primo che c'e':

| | |
|---|---|
| `riga.recupero` | quello di **questo** esercizio |
| `sc.recupero` | quello della **scheda**, per non ripeterlo otto volte |
| il calcolo | piu' l'esercizio muove carico e articolazioni, piu' tempo serve; sotto le 6 ripetizioni si lavora sul sistema nervoso |

Il terzo resta un valore di pratica comune, **non una misura**, ed e'
esattamente il motivo per cui i primi due esistono: il recupero giusto lo sa
chi si allena. `recupeoFonte()` dice da quale dei tre viene il numero, cosi'
l'interfaccia puo' scriverlo invece di farlo indovinare.

Si sceglie a **pastiglie** (Auto, 30″, 45″, 1′, 1′30″, 2′, 3′, 4′) e non con
un campo numerico: nessuno scrive "105 secondi", e la tastiera aperta con le
mani sudate e' il modo piu' lento di dire un minuto e mezzo.

E la seduta guidata **lo annuncia prima della serie**, non dopo: quanto
durera' il recupero e' meta' della decisione su come fare la serie che stai
per cominciare.

**Nessuna scheda gia' scritta cambia significato.** Una riga senza `strip`
vale uno scarico senza bersaglio, che e' come si comportava prima; una senza
`piram` usa il range. Le funzioni che leggono questi campi — `serieDiRiga`,
`repsBersaglio`, `bersaglioTesto`, `scarichiDiRiga`, `usaRestPause` — sono
l'unico posto in cui i campi si guardano, quindi una riga vecchia e una nuova
si comportano uguale ovunque.

Il piramidale si porta dietro una scelta di modello: `serie`, `reps` e
`repsMax` **restano sincronizzati** sull'elenco (numero di gradini, minimo e
massimo). Cosi' la doppia progressione, il monitoraggio della scheda e il
volume continuano a leggere i campi di sempre senza sapere che esiste un
piramidale.

**E un range con gli estremi uguali non e' un range:** 3×8, non 3×8–8. Lo dice
`rangeTesto()`, e il campo "Rip a" si puo' lasciare vuoto. Non e' cosmesi —
"da 8 a 8" fa pensare a un errore di compilazione, e chi lo vede prova a
correggerlo.

### La seduta si fa un passo alla volta

`sheetDaScheda` mette tutte le serie della scheda in una schermata sola. Va
benissimo a fine seduta o per correggere, ed e' esattamente la cosa sbagliata
da avere in mano **mentre** ti alleni: fra una serie e l'altra non serve
vedere quaranta caselle, serve sapere cosa fare adesso.

`seduta.js` e' una carta sola: l'esercizio, la serie, il bersaglio, tre numeri
e un bottone. Toccato quello, la serie e' scritta **nel registro** — non in un
buffer — e parte il recupero. Se l'app si chiude a meta' seduta quello che hai
fatto e' gia' salvato: `s.guida` ricorda solo a che punto eri.

Tre cose che il modulo non sapeva fare:

1. **le superserie si fanno alternate.** Il modulo chiedeva tutte le serie di
   A1 e poi tutte quelle di A2, che e' l'ordine in cui si *scrivono*, non
   quello in cui si *fanno*. `passiScheda()` produce A1-1, A2-1, recupero,
   A1-2, A2-2: dentro la coppia il timer non parte, parte sull'ultima del giro
2. **il bersaglio e' quello della serie**, non il range generico: in un
   piramidale 12-10-8 la seconda serie chiede 10, e lo scrive
3. **ogni scarico ha la sua casella**, con le ripetizioni che la scheda si
   aspetta gia' nel segnaposto

**Il carico se lo ricorda.** Il campo kg arriva pieno, e in ordine di quanto
e' vicino alla verita': la **serie di prima di oggi**, poi la stessa serie
dell'ultima volta, poi l'ultima di quella volta, poi il peso di partenza della
scheda. Il primo caso e' quello normale — se hai appena fatto 60 kg, la serie
dopo si fa con 60 finche' non decidi altrimenti — ed era esattamente il lavoro
che l'app faceva fare a mano ogni volta. La riga sotto il titolo dice **da
dove viene** il numero, invece di lasciarlo indovinare.

**Le ripetizioni sono quelle fatte, e sono obbligatorie.** Il campo nasce
vuoto col bersaglio nel segnaposto, e "Serie completata" si rifiuta senza un
numero. Prima il bersaglio faceva da ripiego, il che voleva dire scrivere nel
registro **quello che la scheda chiedeva invece di quello che e' successo** —
proprio il numero da cui escono massimale stimato, doppia progressione e
verdetto sulla scheda. Se la serie non l'hai fatta c'e' "Salta questa serie".

Il kg invece arriva gia' scritto, e non e' un'incoerenza: quello e' il peso
che hai messo sul bilanciere, lo sai prima di cominciare ed e' quasi sempre
lo stesso della volta prima. Le ripetizioni sono l'unica cosa che la serie ti
dice **dopo**.

Accanto al campo ci sono le pastiglie da bersaglio−3 a bersaglio+3: fra una
serie e l'altra un numero fra 5 e 15 si tocca, non si digita.

**Il timer diventa rosso quando lo superi.** Quello lanciato da un bottone
resta un promemoria e dopo venti secondi se ne va; quello di una seduta
guidata (`tieni`) no — li' il tempo oltre il recupero e' un dato, e se fra due
serie sono passati quattro minuti invece di due quella e' un'altra seduta. La
barra resta, conta all'insu' col segno piu' e diventa rossa.

E sale **sopra il foglio**: durante una seduta guidata lo sheet e' sempre
aperto, e la barra vive a `z-index 19`, cioe' sotto. Un timer che nessuno vede
non e' un timer.

Tre difetti trovati provandolo, non leggendolo:

- **`+30` a tempo scaduto non faceva niente.** Sommare trenta secondi a un
  recupero finito da un minuto e mezzo e' aritmeticamente corretto e
  visivamente nullo: il numero non si muoveva, e un bottone che non muove
  niente sembra rotto. Chi lo tocca in quel momento chiede trenta secondi
  **da adesso**, quindi il recupero riparte. E `−30` a tempo scaduto non ha
  niente da accorciare: e' spento, invece di non fare nulla in silenzio
- **la chiusura automatica dei venti secondi uccideva il timer successivo.**
  Il `setTimeout` non sapeva a quale recupero apparteneva: uno partito dieci
  secondi dopo si vedeva chiudere la barra dal promemoria di quello prima.
  Ora il timeout porta il `t0` a cui si riferisce
- **oltre un'ora, due regole diverse per lo stesso stato**: la barra viva
  continuava a contare (`+64:40`) mentre `recRiprendi()` si rifiutava di
  ripristinarla. Ora la soglia e' una sola (`REC_OLTRE_MAX`), e oltre quella
  la barra si chiude da sola: piu' di un'ora non e' un recupero, e' una barra
  dimenticata accesa

E l'ultima serie della seduta **non fa partire niente**: non c'e' una serie
dopo da aspettare, e una barra che conta sulla schermata di fine chiede di
stare fermi per un lavoro che non arrivera'.

"Torna alla serie prima" **toglie l'ultima serie scritta**. Non e' un effetto
collaterale: e' l'unico modo di correggere un numero sbagliato senza uscire
dalla guida, e la riga di riepilogo in fondo — quello che hai gia' messo
dentro — esiste perche' non ci si debba fidare a memoria.

### Il recupero e' la schermata, non una barra sopra

Prima il recupero era una barra che compariva sopra il foglio **mentre la
carta della serie dopo era gia' li'**. Sbagliato per come funziona una seduta:
fra due serie non c'e' niente da fare tranne aspettare, e mettere davanti i
campi della serie successiva significa chiedere di compilarli adesso, cioe'
prima di averla fatta.

Ora il recupero **prende il posto** della carta: un anello che si svuota,
quanto manca al centro, `−30″` e `+30″` sotto, e in fondo l'unica cosa che
serve sapere mentre aspetti — cosa arriva dopo. Scaduto non sparisce: diventa
rosso e conta all'insu'.

Lo stato resta dov'era (`dieta.rec` in localStorage, via `avviaRecupero`),
quindi sopravvive a un ricaricamento e **la barra torna a fare il suo mestiere
appena esci dal foglio**: `recDisegna()` la nasconde finche' l'anello e' sullo
schermo. Due timer dello stesso recupero sono un timer di troppo.

**E il recupero vero si registra.** Uscendo dall'anello, i secondi passati
davvero finiscono su `rec_s` della serie **appena fatta** — non di quella che
arriva: il recupero appartiene alla serie che lo ha reso necessario. Sopra
l'ora non si scrive niente, che non e' un recupero ma il telefono lasciato
aperto sul tavolo. Da li' escono la durata della seduta e il recupero medio
del resoconto.

### Una guida lasciata a meta' riprende da dove era

Chiudere il foglio per sbaglio — o perche' e' suonato il telefono — non e' una
decisione: e' un incidente. Passare di nuovo da "come registri?" costringeva a
ritrovare la scheda giusta in un elenco stando sotto un bilanciere.

`sheetSeduta()` guarda `s.guida`: se c'e' una seduta guidata in corso su una
scheda che esiste ancora, ci torna dentro e basta. Il modo di uscirne resta
scritto — "abbandona la guida e registra a mano" — e non cancella niente: le
serie fatte restano, si continua dal modulo.

Ma **"a meta'" vuol dire che qualcosa e' stato fatto.** Aprendo una scheda e
richiudendola subito restava una guida a zero serie, e da li' in poi "registra
pesi" portava dentro quella scheda ogni volta, proponendo di riprendere una
seduta che non era mai cominciata. Una guida senza nemmeno una serie non e' un
lavoro interrotto: e' un tocco, e si cancella invece di trascinarsela dietro.

### Uno stripping vale uguale ovunque

Uno stripping non e' una serie e non e' due: e' una serie piu' N code fatte a
cedimento senza recupero. La convenzione — mezza serie per scarico, e tutti i
chili perche' quelli sono stati sollevati davvero — era **copiata a mano in
cinque posti e mancava in altri tre**: il tonnellaggio per seduta, quello del
resoconto in PDF e il conteggio delle serie delle statistiche ignoravano gli
scarichi. La stessa seduta valeva di piu' o di meno a seconda della schermata
che la guardava.

Ora sono tre funzioni sole — `serieEquivalenti()`, `tonnellaggioSerie()`,
`ripetizioniSerie()` — e le chiamano tutti: mappa muscolare, forma-fatica,
scarico automatico, grafici, statistiche, resoconto. Conseguenza da non
correggere per errore: **il numero di serie puo' avere la mezza** (12,5 serie
e' un numero giusto), e va formattato di conseguenza.

### Il resoconto di una seduta

Lo storico era un elenco di date: guardarlo era aprire un archivio, non capire
com'e' andata. `resocontoSeduta(k)` risponde alla domanda vera, e **non
inventa un numero suo** — chiede a quelli che ci sono gia':

| Motore | Cosa gli chiede |
|---|---|
| `serieEquivalenti` / `tonnellaggioSerie` | quanto vale la seduta, scarichi compresi |
| `volumeMuscoli` | dove e' finito il lavoro |
| `e1rm` / `e1rmPerSeduta` | se qualcosa non era mai stato fatto prima |
| `formaFatica` | su che gambe ci sei arrivato — letta **il giorno prima**, perche' dopo la seduta la fatica e' quella della seduta |
| `rec_s` | quanto hai recuperato davvero, e quindi quanto e' durata |

Tre regole che lo tengono onesto:

1. **Non e' un voto.** Il titolo e' un fatto — "due massimali stimati mai
   visti prima", "piu' leggera del solito", "in linea con le ultime" — e la
   riga sotto dice su cosa si basa. Una seduta piu' leggera non e' un errore:
   una scarica serve, e la carta lo scrive.
2. **Il confronto e' con le sedute confrontabili**: quelle fatte con la stessa
   scheda se ce ne sono almeno due, tutte le altre altrimenti. Mettere una
   giornata di gambe contro la media di tutto direbbe soltanto che le gambe
   pesano piu' delle braccia. E il denominatore e' dichiarato: quante sedute,
   e con che media.
3. **Corto di proposito.** Un titolo, quattro numeri, poche righe. Il
   dettaglio sta gia' in mappa muscolare, volume e progressi, e ripeterlo qui
   vorrebbe dire mantenere due versioni degli stessi conti.

Il metro della prontezza e' lo stesso di `statoMuscoli()` — la fatica di quel
giorno divisa quella che quel muscolo porta di solito — e non e' un caso: due
schermate che usano metri diversi direbbero due cose diverse dello stesso
muscolo lo stesso giorno.

Dallo storico una seduta si apre sul resoconto, e da li' si tocca una serie
per correggerla: chi guarda una seduta di tre settimane fa vuole prima
ricordarsela.

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

**La scala del colore era schiacciata**, e per due motivi che si sommavano.

Il primo: quattro gradini secchi, `ceil(v * 4)`. Il primo gradino teneva un
quarto del mondo — tutto fra il 2% e il 25% usciva **dello stesso identico
colore**, quindi un gruppo con due serie e uno con cinque erano pixel per
pixel uguali. Ed e' proprio li' che sta quasi tutto quello che si vede in una
settimana normale.

Il secondo: il volume si normalizzava su una **costante** (22 serie), mentre
fatica e forma erano gia' relative al massimo della settimana. Se il gruppo
piu' allenato ne fa otto, la mappa usava un terzo della tavolozza e sembrava
spenta.

Ora: `nVolume` si normalizza sul gruppo piu' caricato della settimana, con un
pavimento al minimo consigliato (o una settimana da due serie in tutto si
dipingerebbe come una piena); e `intensita()` produce una scala **continua**,
interpolando in oklab fra il colore della superficie e i quattro toni della
tavolozza sequenziale. Cinque stazioni invece di quattro gradini, e il fondo
che parte da `--wash` — cosi' "quasi niente" torna a somigliare a quasi
niente, invece di uscire verde pieno.

La gamma e' 0,65: la radice quadrata piena allungava troppo e portava anche i
gruppi da due serie a meta' tavolozza. Misurato in luminosita' oklab, sullo
stesso dato: 10% e 13% del massimo passano da ΔL 0,009 a ΔL 0,034, e l'intero
arco da 0,19 a 0,27.

Due dettagli: `color-mix` non c'e' su Safari sotto la 16.2, e li' si ripiega
sull'opacita' su una tinta sola — peggio, ma non rotto; e l'intensita' sta in
`fill-opacity`, non in `opacity`, perche' l'animazione d'ingresso anima
`opacity` e altrimenti si porterebbe via il dato mentre entra.

La legenda disegna **la scala vera** — la stessa rampa a cinque campioni — e
non quattro colori che sulla mappa non esistono piu'. E la nota dice che il
colore e' relativo alla settimana, non una quota assoluta: per i riferimenti
c'e' il volume settimanale sotto.

**La lettura al tocco dice tutti e tre i numeri**, non solo quello del modo
acceso: sono le tre domande che i tre bottoni pongono — quanto lo alleno,
quanto e' stanco, quanto sta crescendo — e toccando un muscolo le si vuole
sapere insieme. Prima usciva una frase generica ("nella norma") senza dire a
cosa si riferisse. Quello del modo acceso e' in tinta, cosi' il numero e il
colore che hai davanti restano legati.

Le tre percentuali seguono la stessa regola del colore: **ognuna e' rispetto
al gruppo che guida quella classifica**, non una quota assoluta. "Stanchezza
100%" vuol dire "il piu' stanco di oggi", non "distrutto" — e la nota lo
scrive, perche' e' esattamente il tipo di numero che si legge come un voto.
Il moltiplicatore accanto (`1,62× il tuo solito`) e' invece un confronto con
se stessi, ed e' l'unico dei quattro che non dipende da come stanno gli altri
muscoli.

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
  velocità diverse — fatica τ≈7 giorni, forma τ≈42. L'impulso NON è il
  tonnellaggio (un leg press e un'alzata laterale non sono confrontabili in
  chili) ma le serie pesate per coinvolgimento del muscolo e per vicinanza al
  cedimento. **Quello che si mostra è il rapporto, non le tre curve** — vedi
  sotto
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

**Lo stesso identico problema c'era sulle etichette delle serie**, e li' era
peggio: erano disegnate tutte all'ultimo punto della propria curva, e due
curve che finiscono vicine — che e' la norma, perche' e' proprio quando si
toccano che si guarda il grafico — stampavano due parole una sopra l'altra.
Su "forma e fatica" ne uscivano tre piu' la riga della media dentro venti
pixel: nero. Su "Misure", sei.

`etichetteSerie()` fa la cosa che si fa sempre in questi casi: parte dalla
posizione voluta, ordina, e spinge via chi si sovrappone tenendo undici pixel
di margine, poi rientra dentro il riquadro se e' sfondato in basso. In piu'
**si scansa le piastrine gia' occupate** dalle righe di riferimento, che sono
disegnate prima — e per farlo `righeRiferimento()` ora restituisce i suoi
rettangoli invece di non restituire niente.

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

### Chi non e' seguito da nessuno non sa da che numero partire

**E' il caso normale, e l'app lo trattava come se non esistesse.** Chi ha un
nutrizionista i suoi numeri ce li ha gia': glieli ha dati una persona che l'ha
visto, e nessuna formula qui dentro ne sa di piu' — la carta glielo dice come
prima cosa e non insiste. Ma chi apre l'app senza nessuno alle spalle si
trovava davanti una casella "Calorie" da riempire, e nient'altro.

Quello che c'era rispondeva a meta' della domanda e sempre troppo tardi:
`targetNeutro()` calcolava Mifflin-St Jeor per il livello di attivita' senza
mai chiedere **per fare cosa**, e `cardTarget()` — che il numero lo corregge
benissimo — si rifiuta di parlare finche' non ci sono due settimane di
registro. Cioe' nell'unico momento in cui la domanda si pone davvero, non
c'era niente.

`obiettivo.js` fa tre passaggi, in quest'ordine:

1. **L'obiettivo** — perdere grasso, ricomporsi, mantenere, crescere. La
   ricomposizione e' una voce a se' e non un sinonimo di mantenimento: le
   calorie sono le stesse, ma le proteine no e il metro con cui si giudica la
   riuscita nemmeno (li' la bilancia non deve muoversi, ed e' il punto).
2. **Il ritmo, in percentuale del peso a settimana.** Non in chili fissi:
   mezzo chilo a 55 kg e mezzo chilo a 100 kg sono due deficit completamente
   diversi, e un elenco di ritmi in kg dice la cosa giusta a una persona sola.
3. **I macro, dall'obiettivo e non solo dalle calorie.** Le proteine salgono in
   deficit — 2,2 g/kg contro 1,8 in mantenimento — perche' e' li' che la massa
   magra e' a rischio.

**Due pavimenti, e vince il piu' alto:** il metabolismo a riposo per 1,1, che
c'era gia', e il **25% sotto il dispendio**, che questo file prescriveva da
tempo senza che nessuno lo applicasse. E un ritmo che il pavimento taglia si
vede **barrato prima di sceglierlo**: un bottone che promette −0,7 kg a
settimana e consegna le calorie di −0,35 e' un bottone che mente.

Come tutto il resto: la proposta si accetta, non si applica da sola. E c'e' un
secondo bottone, **"tieni solo l'obiettivo, non i target"**, per chi i numeri
li ha da qualcun altro: l'app sa cosa stai cercando di fare senza toccare
quello che segui.

### Gli idoli sono dichiarazioni, e vanno riportati sulla tua altezza

`target_fisico` era **una persona sola, uguale per tutti**, scritta in
`data/dieta.json` — e arrivava da `...DBASE` anche a chi cominciava da zero,
cioe' esattamente la cosa che questo file vieta per il nome, l'eta' e le
misure di partenza. Con il piano vuoto adesso non c'e' nessuno finche' non lo
scegli, e la colonna "Manca" resta vuota invece di misurarti contro qualcuno
che non hai scelto.

`data/fisici.json` ne tiene **undici**, sette uomini e quattro donne, e ogni
riga porta le sue avvertenze. Quattro regole li tengono onesti:

1. **Sono dichiarazioni, non misure.** Interviste, schede promozionali,
   articoli: nessuno ha mai messo il metro addosso a Brad Pitt. `fonte` vale
   `dichiarazione` su tutti, e la UI lo scrive dove i numeri si vedono.
2. **Si riportano sulla tua altezza.** E' la parte che rende la cosa una
   proporzione invece di un poster: i centimetri di qualcuno alto 1,90 non
   dicono niente a chi e' alto 1,60. Le circonferenze scalano con l'altezza,
   **la massa magra con il suo quadrato** — che e' la definizione dell'FFMI —
   ed e' anche il motivo per cui il peso finale puo' venire molto diverso da
   quello dichiarato senza che nessuno abbia sbagliato i conti.
3. **L'FFMI dice se e' roba che un corpo costruisce da solo.** Massa magra
   diviso il quadrato dell'altezza, normalizzata a 1,80 m. Sopra 25 (uomini) o
   22 (donne) si esce da quello che si raggiunge senza aiuti: il riferimento
   viene dallo studio di Kouri del 1995 su atleti prima e dopo l'era degli
   steroidi, ed e' **pratica comune, non una legge** — come le costanti di
   Banister. Non blocca niente: dice. Misurato su un profilo di 1,80 m,
   Chris Hemsworth esce a 25,2 ed e' marcato *oltre il limite naturale*,
   Brad Pitt a 18,6 ed e' marcato *raggiungibile*.
4. **Nessuna previsione di quanto ci vuole.** E' la regola di sempre: una data
   qui sarebbe una scadenza da mancare, e su un obiettivo che richiede anni
   sarebbe anche falsa. La scheda lo scrive, e rimanda a "Dove stai andando",
   che sul tempo risponde come intervallo e si rifiuta quando i dati non
   bastano.

E il **numero citato non e' sempre quello operativo**: il 5-6% di grasso che
gira su Fight Club e' condizione da giorno di riprese, non uno stato in cui si
vive. Dove la differenza esiste il file tiene tutti e due (`bf_pct` e
`bf_pct_citato`) e la scheda spiega perche' ne usa uno.

Si puo' anche **non averne nessuno**, ed e' un bottone esplicito: restano i
tuoi numeri e come si muovono, che e' l'unico confronto davvero tuo.

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
2. Confronta contro il target le medie effettive (dai pasti spuntati, non da
   quanto dichiarato) di **tutti e cinque** i valori: calorie, proteine,
   carboidrati, grassi, fibre — vedi "Tutti i macro, non solo due" 
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

**E si legge al tocco**, come tutti gli altri grafici. Il manubrio dice
benissimo la direzione e nasconde il numero: si vede che le proteine sono
salite, non che sono passate da 118 a 131 g. Toccando una riga i numeri esatti
— adesso, prima, differenza, target, percentuale — finiscono nella riga
`.read` sotto, e una fascia dice quale riga stai leggendo. La zona da toccare
e' **tutta la riga e non il pallino**: un cerchio da quattro pixel su un
telefono non lo prende nessuno, mentre la riga e' un bersaglio alto ventidue.
E i rettangoli invisibili vanno aggiunti dopo i disegni, o coprirebbero i
tocchi delle righe gia' fatte.

Il grafico è a **manubrio**, non a pendenza. La pendenza sembrava la forma ovvia
e alla prova non reggeva: otto metriche quasi tutte vicine al target si
accalcavano in una banda alta trenta pixel e le etichette si sovrapponevano per
forza. Il manubrio dà a ogni voce una riga di altezza fissa — collisione
impossibile — e mette il movimento in orizzontale. Un asse solo: la percentuale
del proprio target, l'unico metro che tiene sulla stessa figura i passi e i litri.

### Il metro del recupero sei tu

Questo file scriveva da tempo che *"non si confronta la fatica di Banister con
una soglia assoluta: con tau_forma 42 e tau_fatica 7 la prontezza di chi si
allena e' sempre positiva, per costruzione"*. E poi il codice faceva
esattamente quello: `pronto` era `fatica < forma * 0.55`, e con quelle due
costanti il rapporto di regime sta intorno a 7/42 — cioe' **sempre** sotto
qualunque soglia ragionevole. Misurato sul caso piu' ovvio possibile: il
giorno dopo una seduta pesante di petto l'app scriveva "nessun gruppo e' in
debito di recupero, pronti: petto".

Il confronto giusto e' con se stessi. Ma **non sul rapporto fatica/forma**, ed
e' l'errore in cui si cade subito dopo: quel rapporto ha un transitorio
lunghissimo, perche' la forma ci mette 42 giorni a riempirsi e nelle prime
settimane il rapporto vale 0,9 contro lo 0,2 di regime. Provato: con otto
settimane di storia la mediana usciva 0,302 mentre il ciclo settimanale vero
oscillava fra 0,15 e 0,31, e il giorno dopo una seduta pesante risultava
*sotto* la norma.

`caricoRelativo()` guarda quindi la **fatica** e basta, contro la fatica che
quel muscolo porta di solito:

- tau 7 vuol dire che si assesta in tre settimane invece che in tre mesi;
- ha il senso giusto — "quanto sono pesto rispetto al mio normale";
- resta autocalibrante: chi si allena tanto ha una fatica abituale alta e non
  risulta perennemente distrutto per questo;
- la finestra e' di **sei settimane**, cosi' segue i cambi di volume invece di
  confrontarti con quello che facevi a marzo, ed e' la **mediana**, perche' i
  picchi del giorno dopo sono proprio quello che non deve entrare nel metro
  con cui li si misura.

Sotto le tre settimane di storia su quel muscolo non si dice niente — `pronto`
vale `null`, che non e' `false` — e chi legge quel campo deve distinguere i
tre casi. Sullo stesso seme di prova: petto, spalle e tricipiti allenati ieri
escono a 1,62× il loro solito, dorsali e bicipiti a 0,75×, gambe a 1,00×.

Il metro e' uno per tutta la sezione: mappa muscolare, carta "cosa allenare
oggi", grafico del carico, resoconto della seduta e pastiglie delle schede.

### "Ci sta" o "meglio domani": la scheda, oggi

La domanda arriva nel momento in cui si apre **registra pesi** con tre schede
davanti. La mappa muscolare sapeva benissimo che i pettorali erano ancora
carichi, ma quell'informazione stava due schermate piu' in la' e nessuno la
andava a prendere con le mani sulla panca.

`prontezzaScheda()` fa una media pesata, e **il peso conta**: una scheda che
mette dodici serie sui pettorali e due sui polpacci non e' "meta' petto e
meta' polpacci". Ogni gruppo entra per quanto quella scheda lo carica davvero
— serie della riga per coinvolgimento dell'esercizio, cioe' lo stesso peso che
usano gia' la mappa e il volume settimanale.

Quattro casi, e le parole sono scelte: **"sconsigliata" sarebbe un giudizio su
una scheda, e la scheda non ha fatto niente di male.** Quello che e' carico e'
il corpo, e per oggi:

| | |
|---|---|
| sotto 0,9× | ci sta |
| 0,9–1,25× | nella norma |
| 1,25–1,7× | gruppi carichi |
| oltre 1,7× | meglio domani |

Sotto la pastiglia c'e' **il perche'** — quali gruppi, e quanta parte del
lavoro di quella scheda rappresentano — perche' un'etichetta senza il motivo
e' una cosa che si impara a ignorare. E quando ce n'e' una chiaramente piu'
fresca delle altre viene marcata, che e' l'unico consiglio vero: non "non
allenarti", ma "oggi ti conviene questa".

Senza abbastanza storico non compare niente e la nota lo dice, invece di
inventare un verdetto.

### Lo storico non e' un archivio

Era un elenco di date con accanto due numeri: per sapere com'era andata una
settimana bisognava aprire le sedute una per una. Ora ha la lingua della
Sintesi — titolo, sottotitolo, i numeri grossi del periodo, poi le righe — e
ogni riga porta quello che serve a scorrerlo:

- il **blocco del giorno** a sinistra fa da ancora verticale: scorrendo si
  legge la data prima del nome. Le sigle sono di due lettere (`ma`, `me`) e
  non di tre, perche' "mar" sotto un'intestazione "set 2026" qualcuno lo
  legge come marzo;
- una **barra sotto il nome** con il tonnellaggio in scala **fra le sedute
  mostrate**: dice quali sono state grosse rispetto alle altre tue, e la nota
  lo scrive perche' non e' una scala assoluta;
- i mesi separano i gruppi, cosi' i vuoti si vedono senza contarli.

In testa tre numeri sulle ultime otto settimane — sedute, serie, tonnellate —
che sono la risposta alla domanda che si fa aprendo lo storico: *quanto ho
fatto ultimamente*.

### Una serie si corregge, non solo si butta

Nello storico toccare una serie **la cancellava**, dopo una conferma. E' la
stessa regola gia' imparata a caro prezzo sulle righe di scheda — *toccare una
riga la apre* — che qui era rimasta com'era.

Il punto non e' l'ergonomia: e' che nello storico una serie sbagliata quasi
mai e' di troppo. E' **segnata male** — il carico rimasto quello della volta
prima, dieci ripetizioni invece di otto scritte a memoria a fine seduta,
l'esercizio preso dalla riga sopra nell'elenco — e l'unica uscita era buttarla
e riscriverla da capo. Sono numeri che finiscono dentro il massimale stimato,
la doppia progressione, il volume per muscolo e il verdetto sulla scheda:
lasciarli sbagliati sporca tutto quello che ne esce.

`sheetSerie(k, i)` apre la serie: carico, ripetizioni, RIR, gli scarichi uno
per uno, e **l'esercizio**, che si puo' cambiare — e' l'errore piu' frequente
di tutti ed e' l'unico che nessun'altra schermata sa riparare. Si lavora su
una copia, cosi' "Annulla" non lascia niente; "Elimina questa serie" e'
rimasta, dentro, dove uno la cerca dopo aver aperto.

Tre conseguenze che sarebbero passate inosservate:

- **`scordaFatica()`** — la forma-fatica e' memorizzata per muscolo e dopo
  qualunque modifica risponderebbe coi numeri di prima. Era scritto a mano in
  tre punti e mancava nel quarto, cioe' proprio nella cancellazione dalla
  seduta libera. Ora e' una funzione sola;
- **togliendo l'ultima serie la seduta sparisce**, e chi tornava indietro da
  quella cancellazione trovava un oggetto che non esiste piu'. `sheetLibero()`
  in quel caso torna alla schermata di scelta;
- **le sedute vuote non sono sedute.** Aprire la schermata "come registri?"
  creava la giornata anche se poi non ci si scriveva niente, e nello storico
  compariva una riga "Seduta · 0 serie". Quella e' la traccia di un tocco, non
  di un allenamento: lo storico e il conteggio la saltano — e adesso non nasce
  piu' (vedi sotto).

E il bottone in testa non dice piu' "Continua quella di oggi" su una seduta di
tre mesi fa: li' non si continua niente, si apre e si corregge.

### Aprire non registra

`sheetSeduta()` cominciava con `p.sessioni[k] ||= { nome: '', serie: [] }`:
la giornata di palestra **nasceva nel momento in cui si guardava** la
schermata di scelta. Bastava toccare "Registra pesi", cambiare idea e
chiudere per lasciarsi dietro una seduta a zero serie.

Da li' in poi due cose sbagliate insieme, che e' anche il motivo per cui era
difficile da riconoscere:

1. la carta di Gym decideva l'etichetta del bottone sull'**esistenza** della
   seduta, non sulle serie: scriveva **"Continua la seduta"** e sotto
   "Seduta — 0 serie, 0 kg" a chi non aveva ancora fatto niente;
2. e quel bottone **non continuava niente** — non poteva, non c'era nulla da
   continuare: riportava alla schermata di scelta, cioe' esattamente dove si
   era gia'. Da fuori sembrava che non funzionasse, ed era una descrizione
   giusta.

La seduta ora la creano i **due punti in cui una serie viene scritta
davvero**: la guida (che gia' lo faceva) e il salvataggio del modulo da
scheda. La schermata di scelta non tocca il registro, e per simmetria, chi la
apre su una giornata rimasta vuota se la vede cancellare.

Due conseguenze da non correggere per errore:

- **la seduta libera ha bisogno di dire che sta cominciando.** Ci si entra in
  due modi opposti: scegliendola dalla schermata di scelta — e li' la
  giornata nasce — oppure tornandoci dopo aver cancellato una serie, e se era
  l'ultima la seduta e' sparita apposta. Ricrearla in quel caso rimetterebbe
  dentro proprio quello che si e' appena tolto, quindi il primo caso lo
  dichiara (`sheetLibero(k, true)`) e il secondo torna alla scelta.
- **le sedute vuote gia' in giro si buttano all'avvio.** Chi ha usato l'app
  finora se le ritrova nel registro, e non sono innocue: entrano nel
  conteggio delle sedute della revisione. `normalize()` le toglie una volta
  sola — e togliere una seduta senza serie non perde nessun dato, perche' un
  dato dentro non c'e'.

### Una seduta si elimina

Registrata il giorno sbagliato, o due volte la stessa, restava li' per sempre:
si potevano togliere le serie una a una, ma la seduta vuota rimaneva. E non e'
una questione di ordine — una seduta finta entra nel volume settimanale, nella
forma-fatica, nel monitoraggio della scheda e nel conteggio delle sedute della
revisione. Un dato falso che non si puo' togliere sporca tutti i motori che lo
leggono, e le decisioni che ne escono: lo scarico consigliato, il verdetto
sulla scheda, la diagnosi della settimana.

Il bottone sta nel punto d'ingresso della giornata (`sheetSceltaModo`), cioe'
dove ci si accorge dell'errore, e compare **solo se quel giorno ha delle
serie**. Chiede conferma dicendo quante ne sta buttando, e svuota `_ffCache`
perche' la forma-fatica e' memorizzata per muscolo e altrimenti risponderebbe
con i numeri di prima. Tocca solo la palestra: il cardio ha la sua scheda e il
resto del diario non si muove — e la nota lo dice, perche' "elimina la seduta"
letto in fretta sembra piu' largo di quello che e'.

### L'acqua si aggiunge a bicchieri

Era un campo numerico in litri dentro la griglia del diario, e chiedeva la cosa
sbagliata due volte. Primo: nessuno beve "0,25 L", si beve un bicchiere.
Secondo, e piu' importante: l'acqua e' l'unica voce del diario che si registra
**otto volte al giorno** e non una — e ogni volta erano tastiera, cancella 1,2,
scrivi 1,4. A quel prezzo si finisce per stimare la sera, che e' come non
registrarla.

Quattro recipienti, perche' quattro sono quelli che uno ha in casa: bicchiere
200 ml, tazza 250, bottiglietta 500, bottiglia 1,5 L. Sono **capienze
convenzionali, non misure**, e la carta lo scrive — un bicchiere da tavola sta
fra i 200 e i 250 ml, e chi ha una borraccia da 750 usa "scrivi tu", che e'
rimasto e vale come totale.

Il livello sta in `d.acqua` in litri, come prima: tutto quello che gia' legge
l'acqua — analisi, cruscotto, statistiche, PDF — non si e' accorto di niente.
Accanto, `d.sorsi` e' l'elenco dei millilitri aggiunti, e **non e' ridondante**:
serve a togliere l'ultimo esattamente com'era. Senza, "annulla" dovrebbe
chiedere a chi ha toccato per sbaglio quanto valeva il tocco. Scrivendo il
totale a mano l'elenco si azzera, perche' da quel momento il numero l'ha deciso
l'utente e i sorsi di prima non lo compongono piu'.

La bottiglia si riempie fino alla quota del target, ed e' disegnata **prima**
di qualunque animazione: se l'IntersectionObserver non scatta il livello e'
comunque giusto. E' la stessa regola della fiamma della striscia — il dato sta
nel riempimento, il movimento e' solo il modo in cui ci si arriva.

**La Coca Zero e' finita nella stessa carta**, che percio' si chiama "cosa
bevi". Non e' un accorpamento per far posto: e' la stessa cosa dell'acqua —
si conta a lattine, si aggiunge nel momento in cui la si apre, e un campo di
testo chiedeva di ricordarsi a sera quante ne erano passate. Sopra le tre
lattine la carta nomina la caffeina, perche' quello e' il primo posto dove
guardare quando il sonno e' corto, ed e' un collegamento che l'analisi fa gia'.

### Il diario chiede solo quello che sa solo lui

"Ogni giorno" era una carta con cinque voci — peso, acqua, Coca Zero, passi,
sonno — piu' l'interruttore dell'allenamento. Tre non ci appartenevano piu':

| Voce | Dove e' andata, e perche' |
|---|---|
| **Peso** | In Corpo, grande e al centro. E' il numero che si scrive per primo ogni mattina e quello attorno a cui girano tendenza, dispendio, previsione e composizione: viveva in una casella grande come quella delle lattine |
| **Acqua e Coca Zero** | Nella carta "cosa bevi", un tocco alla volta. Sono le due voci che si registrano molte volte al giorno, e un campo numerico le fa stimare a sera |
| **Allenamento** | Non si dichiara: si deduce |

Restano **passi e sonno**, cioe' i due numeri che si scrivono davvero una
volta al giorno e che nessun'altra parte dell'app conosce — e nemmeno loro
hanno piu' un riquadro: due campi dentro una carta con un titolo sopra erano
piu' cornice che contenuto. Stanno in cima a **"Com'e' andata"**, la carta che
gia' chiede com'e' andata la giornata: il sonno di stanotte e' esattamente il
primo pezzo di quella risposta.

`allenatoIl(k)` e' la regola sola: la giornata conta come allenamento se ci
sono serie in palestra, del cardio o una seduta HYROX registrata. Non e' una
funzione nuova — quel conto lo facevano gia' **quattro motori** (costanza,
revisione, statistiche, resoconto), ognuno con la sua copia, e quattro copie di
una regola prima o poi diventano quattro regole. L'interruttore chiedeva una
cosa a cui l'app sapeva gia' rispondere, e le due risposte potevano
contraddirsi: quale valeva, allora?

Il flag `allenamento` dei registri vecchi **continua a valere**. Chi ha spuntato
"sì" senza registrare le serie ha dichiarato un allenamento, e cancellarlo dai
conti a posteriori vorrebbe dire riscrivere la storia di chi ha usato l'app
com'era.

La riga resta in Diario ma **in lettura**: dice cosa c'e' registrato quel
giorno e porta in Gym. Toglierla del tutto avrebbe fatto pensare che
l'allenamento non contasse piu'.

### In avanti si guarda, non si scrive

In Oggi la freccia in avanti non aveva un fondo: si poteva arrivare al 2027 e
spuntare la colazione di un giovedi' che non e' mai esistito. Quel giorno
sarebbe poi arrivato **con le caselle gia' segnate**, e il registro avrebbe
detto una cosa che non e' successa.

La risposta pero' non e' bloccare: *cosa mangio domani* e' una domanda
legittima, e il piano esiste anche per rispondere a quella. Quindi in avanti
si va, ma **in sola lettura** — spunta disattivata, niente sostituzioni,
niente porzioni, niente fuori piano, e una carta in testa che dice che quella
giornata non e' ancora arrivata.

Il limite e' **sette giorni**, e non per prudenza: il piano e' settimanale,
quindi l'ottavo giorno mostra esattamente quello che mostrava il primo. Oltre
si scorrerebbe la stessa settimana all'infinito credendo di vedere altro.

Il Diario resta invece bloccato a oggi, e la differenza non e' un'incoerenza:
il Diario **e'** il registro, e per il futuro non ha niente da far vedere.

### La bioimpedenza batte la formula, ma non per sempre

Il grasso corporeo usciva da una sola strada: la formula della Marina su vita,
collo e altezza, con i suoi tre o quattro punti di errore dichiarati in ogni
schermata. Ma chi passa in farmacia e sale su un impedenziometro **una misura
ce l'ha**, e l'app non aveva un posto dove metterla.

Adesso ce l'ha (`S.log[k].bia`), con tre decisioni:

1. **Vale trenta giorni.** Una BIA e' un punto nel tempo: la vita si rimisura
   ogni settimana e segue il corpo, una bioimpedenza di due mesi fa descrive
   quello di due mesi fa. Dopo `BIA_GG` torna a valere la formula, e la carta
   lo scrive invece di continuare a mostrare un numero vecchio come se fosse
   di oggi.
2. **Si prende la percentuale, non i chili.** Lo strumento stampa anche massa
   magra, muscolo e acqua, e la tentazione era di usare la magra dichiarata —
   e' quello che misura. Ma allora la massa grassa diventa *peso di oggi meno
   magra della farmacia*, cioe' la differenza fra due bilance diverse in due
   momenti diversi: misurato sul caso reale, 21,3% dichiarato con 54,2 kg di
   magra su una pesata di 69,8 dava una grassa di 15,6 kg, che e' il **22,4%**
   — la stessa tabella avrebbe scritto due percentuali diverse. La divisione
   si fa sempre `peso di oggi x percentuale`; gli altri numeri restano nel
   registro, dove servono a confrontare due BIA fra loro.
3. **Il grafico della composizione la usa** nei giorni in cui c'e': sono gli
   unici in cui quella serie ha una misura invece di una stima, e coprirli con
   la formula butterebbe via il dato migliore.

`fonte` vale `'bia'` o `'formula'` e la carta lo dice sempre. Non e' una nota a
pie' di pagina: fra le due la differenza puo' essere piu' grande del
cambiamento che stai guardando.

### La composizione e' come si divide il peso

La carta si chiamava "Composizione" e la prima riga era **Peso** — lo stesso
numero che sta grande in cima alla stessa schermata, due carte sopra. Sotto,
altre due righe che composizione non sono: vita su altezza e torace su vita
sono **proporzioni**, e sono scese nella carta delle misure, sotto le
circonferenze da cui escono.

Quello che resta e' quello che la parola promette: come si divide il peso.
Quattro righe — peso, grasso, magra, grassa — e sopra **due barre sulla stessa
scala**, ora e target. La cosa che conta di una ricomposizione e' che il totale
puo' restare fermo mentre le due parti si scambiano, e quattro numeri
incolonnati non lo fanno vedere.

**Il peso e' tornato**, ed e' giusto cosi': non e' un doppione della carta in
cima ma **il totale di cui le altre due righe sono le parti**, e una divisione
senza il totale costringe a sommarla a mente. Il doppione vero — quello che se
n'e' andato — erano i rapporti fra circonferenze, che composizione non sono.

### Le colonne di una tabella non si allineano da sole

Sotto ORA, TARGET e MANCA i numeri cadevano ognuno per conto suo, e non era
un caso isolato: e' la stessa classe `.cmp` usata da **dodici tabelle** —
Corpo, misure, previsioni, obiettivo, bioimpedenza, cruscotto, target,
giorno.

La causa: `grid-template-columns: 1fr auto auto auto`. `auto` vuol dire "larga
quanto il suo contenuto", e l'intestazione e ogni riga sono **griglie
separate**: ognuna si dimensionava sui propri caratteri. "69,8" finiva sotto
la parola ORA solo per coincidenza, e una riga con "-11,3 %" spingeva la sua
colonna piu' in la' di tutte le altre. Il `min-width: 54px` che c'era metteva
un pavimento, non un allineamento — e per giunta solo sulle righe e non
sull'intestazione, che restava percio' piu' stretta di tutto il resto.

Con tracce esplicite (`1fr 58px 58px 64px`) le quattro colonne cadono nello
stesso punto in ogni tabella dell'app. Verificato misurando il bordo destro di
ogni cella contro quello della sua intestazione: **zero righe disallineate**
su tutte e dodici.

### Un grafico del peso senza asse dice solo "sale"

Il grafico del peso era l'unico dell'app disegnato a mano fuori dal toolkit, e
si portava dietro la conseguenza: **nessuna griglia e nessun numero sull'asse**.
Una curva senza scala dice la direzione e nasconde l'ampiezza — e siccome la
scala si adatta ai dati, mezzo chilo e tre chili disegnano esattamente la
stessa curva.

Adesso ha la sua spalla a sinistra, quattro righe di griglia e i chili, con la
stessa `niceTicks()` di tutti gli altri: valori tondi, o l'intervallo diviso in
parti uguali stampa due volte "69" per due numeri diversi. E sotto, una riga
dice da dove a dove arriva l'asse, perche' una scala che si adatta va letta
prima della pendenza.

### I contatori contavano un'altra cosa

Sopra "La settimana in un colpo d'occhio" c'erano due numeri grossi: **cose a
posto** e **da sistemare**. Contavano i messaggi di `analyse()` — che compaiono
in fondo alla pagina — mentre la carta che intestavano ne mostra otto altre, le
medie contro i target. Usciva "1 cose a posto / 2 da sistemare" sopra otto
barre: tre numeri che non tornavano con niente di visibile, e per giunta
"1 cose".

Adesso contano **le otto voci di quella carta**, in tre stati: in linea, fuori
target, senza dato. Il terzo non e' un riempitivo — e' la ragione per cui la
somma non fa otto, ed e' anche la prima cosa da sistemare, perche' una media
che non esiste non e' una media buona.

Nello stesso giro i colori delle barre: erano tre — verde dentro, ambra sopra,
**grigio sotto**. Ma il grigio in quest'app e' il colore di "non c'e' dato"
(`--ink-3` e' anche il testo spento), quindi una media dell'acqua mezzo litro
sotto il target si leggeva come una riga disattivata invece che come uno
scarto. Il commento sopra la funzione diceva gia' la regola giusta — *il colore
dice soltanto se sei dentro o fuori* — e il codice ne usava tre: adesso sono
due, e da che parte sei lo dice la riga di testo che c'era gia'.

### Il peso e' in Corpo, grande

Stava terzo in una griglia di campi di testo. Ora e' la prima carta di Corpo,
al posto della testata del target: numero grande al centro, `−` e `+` ai lati.

Il passo e' **100 g**, che e' la risoluzione vera di una bilancia da casa:
sotto quella cifra non c'e' informazione, c'e' il bicchiere d'acqua bevuto
prima. Su una giornata ancora senza pesata il primo tocco **non incrementa
niente**: appoggia il numero sulla tendenza a 7 giorni, che e' il valore piu'
vicino al vero che l'app conosce, e da li' si aggiusta — inventare un
incremento su un numero che non c'e' vorrebbe dire registrare una pesata che
nessuno ha fatto.

Toccando il numero si scrive per esteso, e li' **si sceglie anche il giorno**:
il diario ha la sua navigazione, Corpo no, e una pesata segnata sulla data
sbagliata resta dentro la tendenza per due settimane. Un dato che non si puo'
correggere e' un dato falso permanente. Nel campo non ci va `nf()` (formatta
69,4 col separatore e rileggerlo da' un altro numero) ma nemmeno il valore
grezzo: una pesata importata puo' arrivare con dodici decimali, e un campo che
dice `69,58359734839807` chiede di correggere una precisione che non esiste.

La carta del target che stava in cima non e' stata sostituita da niente: i suoi
numeri erano gia' tutti nella sagoma tratteggiata e nella colonna "Target"
della tabella. La nota sulla loro provenienza — **stimati, non rilevati** — e'
scesa sotto la figura, che e' dove la sagoma di riferimento si vede.

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

### Una lista della spesa non si legge, si cammina

Era un elenco per categoria del file di dominio — legumi, cereali, verdura —
con una spunta e un peso: l'ordine con cui i dati stanno **scritti**, non
l'ordine in cui uno attraversa il negozio. E la dispensa era un foglio con
dentro tutti i quarantaquattro alimenti del piano e un campo numerico per
ciascuno: un modulo, e infatti restava vuoto.

Guardando cosa fanno le app che questo mestiere lo fanno da anni — AnyList,
Bring!, Apple Promemoria, Out of Milk — quattro cose ricorrono e valgono la
pena di essere prese:

| Da dove | Cosa |
|---|---|
| **AnyList** | l'ordine delle corsie si sistema **una volta** e la lista diventa il percorso |
| **Apple Promemoria** (dalla iOS 13) | quello che prendi **scende in fondo**: davanti resta solo quello che manca |
| chiunque | una **barra di completamento**, l'unica cosa che su una lista lunga dice "ci siamo quasi" |
| **Bring!** | un **colore per corsia**, cosi' scorrendo si riconosce la sezione prima di leggerla |

Due cose invece le facciamo meglio, e sono quelle che nessuna di quelle app
puo' fare perche' non sa cosa mangi:

1. **le quantita' non le scrivi tu.** Escono dalla somma delle ricette
   assegnate ai sette giorni — che e' il motivo per cui la pagina esiste;
2. **la dispensa chiude il cerchio.** "Ne ho gia'" sta sulla riga della spesa,
   dove la domanda nasce — davanti allo scaffale, o davanti alla lista prima
   di uscire — e non dentro un modulo da compilare a freddo. E a fine spesa
   quello che hai preso **entra in dispensa con un tocco**, cosi' la lista
   della settimana dopo lo sottrae.

Su quest'ultima il file di progetto e' sempre stato netto — *"un inventario
che non torna e' peggio di nessun inventario"* — e resta valido: la dispensa
**non** si scala da sola mentre spunti le ricette. Ma "ho comprato queste
cose" e' un fatto che dichiari tu, non una deduzione, e quella meta' del
cerchio si poteva chiudere senza tradire la regola.

Dettagli che non sono cosmetici:

- l'ordine delle corsie sta in `S.settings.corsie` e **regge i cambi di
  piano**: le categorie nuove finiscono in fondo, quelle sparite si ignorano
  invece di lasciare buchi;
- il colore di una corsia **si calcola dal nome** invece di stare in una
  tabella: una categoria nuova nel piano ha subito la sua tinta, e nessuno
  deve ricordarsi di aggiungerla da qualche parte;
- l'app conosce **un negozio solo**, e la nota lo dichiara invece di far
  scoprire il limite a chi ne frequenta due;
- la dispensa dice **per quanto ti basta** — "copre 2,4 settimane", "copre 4
  giorni su 7" — che e' un conto che nessuna app di inventario fa, perche'
  per farlo bisogna sapere cosa mangi.

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

### Le medie arrivano a oggi

Per un periodo le medie si sono fermate a ieri, per una ragione vera: la
giornata in corso e' a meta' e infilarla nella media la tira giu' ogni mattina.

Il prezzo era pero' piu' alto del problema. La media non corrispondeva ai dati
disegnati sul grafico sopra di lei, e su sette giorni escluderne uno cambia il
numero di un settimo senza che si veda perche'. Una media bassa al mattino e'
un fastidio; una media che non si puo' verificare contando le barre e' un
numero di cui non ci si fida.

Vale per `mediaPeriodo()` (che alimenta sia la riga di riepilogo sia la linea
disegnata), per il riquadro delle calorie medie e per `costanze()`. Se si
cambia idea vanno cambiati **tutti e tre**: una pagina che conta fino a ieri e
una che conta fino a oggi danno due numeri diversi per lo stesso periodo, e non
si capisce perche'.

Restano fermi i concetti che si chiamano per nome "chiusi" — la settimana
chiusa della revisione, le medie degli ultimi sette giorni chiusi in Analisi —
perche' li' il fatto che il periodo sia finito e' il punto.

### Il periodo di riferimento

La settimana resta l'unita' su cui la revisione e' costruita, e resta il
default: il giorno da solo e' rumore, il mese arriva tardi per correggere. Ma
il ritmo settimanale non copre tutto — le due settimane di ferie, il mese fra
due visite, i dieci giorni di uno scarico sono periodi veri, e tagliarli a
fette di sette li spezza a meta'.

`revPeriodoAttivo()` restituisce sempre un oggetto con la stessa forma —
`giorni`, `prima`, `da`, `a`, `n` — e tutto il motore lavora su quello:
`revMetriche(per)`, `revDiagnosi(per)`, `revVerdetto(diag)`. Le funzioni non
prendono piu' una data e non sanno se stanno guardando una settimana.

Tre conseguenze che non sono dettagli:

1. **Il confronto e' con il periodo di pari lunghezza subito prima.** Mettere
   venti giorni contro i sette precedenti direbbe che hai camminato tre volte
   tanto: vero, e senza alcun significato.
2. **Le soglie che erano su sette si scalano.** L'obiettivo di sedute e' per
   settimana e si moltiplica per `n/7`; la soglia del registro e' meta' dei
   giorni, non tre. Lasciarle fisse avrebbe detto "sotto" a ogni periodo corto
   e "sopra" a ogni periodo lungo.
3. **L'impegno resta settimanale** e sparisce sui periodi scelti a mano: e' un
   patto che si chiude di domenica, e su "dal 3 al 19" non c'e' niente a cui
   agganciarlo. Stessa cosa per `revisioneLetta`, che continua a valere solo
   per la settimana — chiudere un periodo scelto a mano non deve zittire la
   revisione di domenica.

Nel cruscotto la stessa scelta e' `datiFine` accanto a `datiRange`: sposta la
**fine** del periodo, e con lei si spostano anche i riquadri di testa —
tendenza del peso, composizione, costanza. Muovere i grafici e lasciare i
riquadri su "adesso" darebbe una pagina che parla di due momenti diversi.

Dettaglio di lingua, non di codice: le preposizioni articolate stanno nel
periodo (`confronto`, `su`, `primaNome`). "Rispetto a la settimana prima" e'
il genere di sbavatura che fa sembrare l'app tradotta da un'altra.

### Tutti i macro, non solo due

Per molto tempo l'app contava bene le calorie e le proteine, teneva d'occhio le
fibre, e di carboidrati e grassi diceva solo la fetta nella torta della
ripartizione. Il pasto su Oggi mostrava "635 kcal / 23 P" e basta; la revisione
li ignorava; l'analisi non aveva una sola regola su di loro.

Il caso che lo rende evidente si vede a colpo d'occhio nel cruscotto: calorie
2500 su un target di 2482, proteine 132 su 135, fibre 35 su 38 — tutto in
linea — e sotto **carboidrati a −77 g e grassi a +34 g**. Il totale tornava
perche' i due errori si compensavano, e nessuna schermata lo diceva.

Quindi ora carboidrati e grassi sono voci di prima classe: barre su Oggi,
grafico a barre proprio nel cruscotto (accanto alla ripartizione, che dice come
sono divise le calorie ma non quanti grammi sono — due giorni con la stessa
torta possono essere uno a 180 g di carboidrati e l'altro a 320), righe nella
tabella e nel manubrio del resoconto, regole nell'analisi e nella diagnosi
settimanale.

Due dettagli che non sono cosmetici:

- **`verso: 'target'`, non `'su'`.** Per le proteine "di piu'" e' quasi sempre
  meglio; per carboidrati e grassi no, e conta lo scarto in tutte e due le
  direzioni. Nove calorie al grammo di grasso comprimono i carboidrati senza
  che il totale si muova.
- **Il pavimento dei grassi** (`pavimentoGrassi()`): 0,6 g per kg di peso, il
  bordo basso dell'intervallo prudenziale di letteratura. Sotto quella quota il
  grasso smette di essere una voce del bilancio — e' il substrato degli ormoni
  steroidei e il veicolo delle vitamine liposolubili — e infatti nella diagnosi
  pesa 84, piu' delle calorie. Sopra il pavimento torna una voce come le altre
  e scende a 54. Come tutte le costanti di letteratura di quest'app **non e'
  una misura sull'utente, e la UI lo dice**.

`macroRiga()` scrive i quattro numeri in un posto solo. E' nata perche' la
stessa riga stava per comparire in cinque punti diversi, e cinque copie
diventano prima o poi cinque ordini diversi degli stessi valori. E' compatta di
proposito — `23P 81C 22G 9,4fib` sta in novanta pixel, la stessa riga con i
puntini in mezzo ne prendeva centocinquanta, cioe' meta' della larghezza di un
telefono per quattro numeri.

Con dieci voci in lista il manubrio della revisione non poteva piu' fermarsi al
135%: 116 g di grassi su un target di 82 fanno 141%, e chi stava oltre il bordo
ci si appoggiava, indistinguibile da chi stava esattamente li'. Ora l'asse
cresce coi dati fino al 220%, oltre quello taglia **e lo scrive**.

### Il profilo ha una porta

In cima a ogni schermata c'era l'icona della **fotocamera**, che portava dritta
alle foto dei progressi: un pezzo solo dell'app promosso al posto piu' visibile
che esista, mentre "chi sono, quale profilo sto usando, come mi vedo cambiare"
non aveva nessuna porta. Ora quel posto e' del profilo, e le foto stanno dentro
— dove uno le cerca quando pensa a se stesso, non in cima a ogni pagina.

E il primo passo del piano ha cambiato ordine, che non e' gusto:

1. **Le tue foto**, ma solo a profilo gia' compilato: e' l'unica parte della
   schermata che parla di te e non dei tuoi dati. Al primo avvio sarebbe una
   scatola vuota davanti a un modulo da riempire, quindi non c'e'.
2. **I tuoi dati** — nome, eta', altezza, peso, sesso.
3. **Cosa ti serve**, gli interruttori dei moduli, **per ultimi**.

Prima i moduli venivano per primi: si apriva il primo passo del piano e la
prima domanda era quali parti dell'app spegnere, cioe' una scelta che si puo'
fare solo dopo aver capito cosa fanno.

La carta delle foto non e' un doppione della scheda Foto: li' si scatta e si
confronta, qui si vede se il filo c'e' ancora. Il numero che conta non e' quante
foto hai ma **da quanto non ne fai una**, ed e' quello che mostra.

### La scheda si segue, e a un certo punto si cambia

Una scheda non e' un elenco di esercizi: e' un esperimento con una durata. La
domanda a cui l'app non sapeva rispondere non era "cosa faccio oggi" — a quella
rispondeva gia' — ma **"questa roba sta ancora funzionando, e quando la
cambio"**.

Una scheda si marca come **seguita** (`S.palestra.schedaAttiva`, una sola per
volta) e da li' in poi `monitoraggioScheda()` guarda **solo le sedute fatte con
quella** — l'aggancio c'era gia', ogni seduta salva `s.scheda`.

Per ogni esercizio si confrontano **le prime due sedute con le ultime due**, non
la prima con l'ultima: una giornata storta — dormito male, allenato di corsa —
sposterebbe il verdetto da sola. Sotto le tre sedute non si dice niente, che e'
la stessa regola delle proiezioni: con due punti la retta passa esatta e non
significa nulla. "Fermo" e' entro l'1,5%, sotto quella soglia e' rumore di
arrotondamento del RIR.

**Se ne seguono piu' di una, ed e' il caso normale.** All'inizio la scheda
seguita era una sola, e la frase "se ne segui un'altra, questa smette"
descriveva un programma fatto di una seduta. Ma quasi nessuno si allena cosi':
una scheda per giorno — Giorno 1 spinta, Giorno 2 tirata — e' il modo in cui le
schede si scrivono davvero, e con una sola seguita l'app monitorava meta' del
lavoro e chiamava "il programma" quella meta'.

`S.palestra.schedeAttive` e' quindi un elenco (`schedaAttiva` dei backup vecchi
ci entra da sola: un programma di una scheda non e' ambiguo). E il livello a cui
si guarda una cosa non e' lo stesso per tutte:

- **la progressione di un esercizio si legge dentro la sua scheda.** La panca
  del Giorno 1 e quella del Giorno 2 sono due serie di dati diverse — carichi
  diversi, giorni diversi, stato di freschezza diverso — e mescolarle in un
  elenco solo fa sembrare doppioni due righe che non lo sono;
- **il verdetto "quando lo cambio" si calcola sull'unione**, perche' un
  programma si cambia intero. Una giornata sola che si e' fermata si sistema
  dentro, senza buttare le altre.

Le barre restano in scala **fra tutte le schede**, cosi' le giornate si
confrontano fra loro: e' l'unico modo di vedere che il Giorno 2 non sale
mentre il Giorno 1 tira.

E `pochiDati` diventa "nessuna delle schede seguite ha tre sedute": un Giorno 2
fatto una volta sola non deve tenere in ostaggio il verdetto su tutto il resto.

**Quando cambiarla** sono tre segnali indipendenti e ne servono due — stessa
regola dello scarico automatico, e per lo stesso motivo: uno solo si accende
anche per caso.

| Segnale | Quando si accende |
|---|---|
| Il tempo | oltre 8 settimane sullo stesso programma |
| La progressione | meta' o piu' degli esercizi con dati sufficienti non e' salito |
| Il tetto | la maggioranza degli esercizi chiede solo di caricare: la doppia progressione e' arrivata in fondo |

Le otto settimane sono **un intervallo di pratica comune, non una misura**, e la
UI lo dice — come le costanti di Banister e le soglie di HYROX. E c'e' una
ragione per cambiare scheda che l'app non conosce e non prova a indovinare: che
sia diventata noiosa. Anche quello e' scritto.

### Cinque tab, e tre porte diventate una

Le tab erano sette e il menu dieci voci, ma il numero non era il problema: il
problema era che alla domanda **"come sta andando"** rispondevano tre schermate
diverse, e bisognava sceglierne una prima di sapere cosa ci fosse dentro.

Si sovrapponevano davvero, non per impressione:

- la **costanza** era calcolata e mostrata due volte — un anello in Analisi e
  una carta intera in Dati, lo stesso numero a due dita di distanza;
- le **otto metriche contro il target** erano barre in Analisi e riga di
  riepilogo sotto ogni grafico in Dati;
- **due motori a regole** (`analyse()` e `revDiagnosi()`) giravano sugli stessi
  dati producendo elenchi simili.

Ora c'e' **Andamento**, una tab con tre viste in ordine di quanto sono
impegnative: **Sintesi** (cosa non torna adesso), **Grafici** (i numeri giorno
per giorno), **Revisione** (il giudizio su un periodo, e la sola cosa da
cambiare). I due motori restano due, e la differenza e' il tempo: la sintesi
guarda gli ultimi sette giorni chiusi e basta, la revisione un periodo scelto,
con il confronto.

`#/dati`, `#/analisi` e `#/revisione` **restano indirizzi validi** e aprono
Andamento sulla vista giusta: ci puntano parecchi link dentro l'app, e
riscriverli tutti per un cambio di navigazione e' il modo piu' sicuro di
romperne uno.

Intorno, la stessa regola applicata alle altre superfici:

| Prima | Dopo |
|---|---|
| 7 tab | **5**: Oggi, Diario, Corpo, Gym, Andamento |
| Spesa in tab bar | nel menu, prima voce, solo col piano acceso: e' una lista che si guarda una volta a settimana |
| tendina del ⋯ con 3 voci | via: il ⋯ apre le impostazioni e basta |
| ⋯ con Foto, Piano, Alimenti | via: stanno nel profilo, che e' dove uno le cerca |

Le due superfici superstiti hanno una divisione netta: **l'icona della persona
e' "tu"** (foto, chi sei, il piano, quello che mangi, i profili), **il ⋯ e'
"l'app e i dati"** (spesa, promemoria, backup, versione).

Quello che **non** e' stato unito: Diario e Oggi. Sembrano vicine — sono la
stessa giornata — ma Oggi e' "cosa mangio adesso" e Diario e' "cosa registro
sulla giornata": trecento righe di campi che dentro Oggi diventerebbero una
pagina senza fondo.

### La topbar ha un centro, e due lati con un mestiere

Il titolo stava a sinistra e le due icone tutte e due a destra, appiccicate:
un lato pieno e uno vuoto, e due bottoni che fanno cose lontanissime
— "tu" e "l'app" — a tre millimetri l'uno dall'altro, cioe' alla distanza a
cui il pollice sbaglia.

Adesso: **tre puntini a sinistra, titolo al centro, profilo a destra.** Il
titolo dice dove sei e sta dove si guarda per saperlo; le due porte stanno
agli angoli opposti, che e' anche il modo di dire che non sono la stessa cosa.

Non e' un flex con `space-between`: con quello il titolo si mette al centro
**dello spazio che avanza**, che non e' il centro dello schermo, e basta un
bottone piu' largo dell'altro per vederlo storto. Sono tre colonne di griglia
con le due laterali larghe uguali — misurato, lo scarto fra il centro del
titolo e il centro della barra e' di 0,0 px — e il titolo lungo taglia con i
puntini invece di spingere via le icone.

### Una voce deve arrivare dove dice

`location.hash = '#/piano'` scritto quando sei **gia'** su `#/piano` non emette
`hashchange`: il router non ridisegna, il foglio si chiude, e sullo schermo
resta esattamente quello che c'era. Da fuori e' un bottone rotto.

Succedeva a meta' delle voci: "Il piano" dal piano, "Lista della spesa" dalla
spesa, "Corpo" da Corpo. Alcune chiamate se lo cavavano chiamando `route()`
subito dopo, altre no, e quale delle due dipendeva da chi aveva scritto la
riga.

`apri(hash)` e' l'unico modo di cambiare pagina: se l'indirizzo e' diverso lo
scrive, se e' lo stesso chiede il disegno. **Ventisette navigazioni** in dodici
file passano da li'. Restano fuori due casi, e per un motivo: l'avvio (`if
(!location.hash)`, dove il router parte comunque dopo) e l'indirizzo con la
query dell'import da Salute, che rieseguito rifarebbe l'importazione.

### Il profilo nomina cinque schermate

Le voci erano quattro e due erano etichette, non destinazioni: **"Il piano"**
apriva l'elenco dei passi — da cui sceglierne ancora uno — e **"Quello che
mangi"** poteva voler dire gli alimenti, le ricette, o cosa c'e' su Oggi.

Ora sono cinque, nell'ordine in cui un piano si costruisce e in cui ci si
torna: **Chi sei**, **Foto dei progressi**, **Piano settimanale**, **Ricette**,
**Lista ingredienti**. Ognuna nomina una schermata sola e ci arriva in un
tocco, invece di lasciare a meta' strada.

Le tre che dipendono dal piano alimentare spariscono quando il modulo e'
spento: portare a un passo che in quella configurazione non esiste vuol dire
consegnare una pagina con la navigazione avanti e indietro fuori posto.

### Confrontare due alimenti

"Quale dei due conviene" sembra una domanda semplice e non lo e', per un motivo
solo: **dipende da cosa tieni fermo**. A parita' di peso vince sempre il piu'
denso; a parita' di calorie chi ci mette dentro piu' proteine; a parita' di
proteine chi costa meno calorie. Sono tre risposte diverse alla stessa domanda
e sono tutte e tre vere, quindi la schermata le mette tutte e tre, dicendo ogni
volta quale vincolo sta tenendo fermo.

Nessun punteggio e nessun "meglio": questa app non da' voti al cibo, e fuori
dal contesto in cui lo mangi un alimento non e' migliore di un altro.

Sotto ai tre confronti stanno i rapporti che **non dipendono dalla porzione** —
densita' calorica, proteine per 100 kcal, fibre per 100 kcal, quota di calorie
per macro — che sono quelli che dicono di che tipo di alimento si tratta. E in
fondo, sempre, **da dove vengono i numeri**: fra una stima e un'etichetta la
differenza puo' essere piu' grande di quella che stai confrontando. Se i macro
non tornano con le calorie dichiarate (oltre il 30%, la stessa soglia di
`coerenza()`) il confronto lo scrive.

Due dettagli del motore:

- `confEquivalente()` torna **null** quando il vincolo non esiste: quanti
  grammi di olio pareggiano le proteine del tofu non ha risposta, e dividere
  per zero per produrne una sarebbe peggio del silenzio;
- oltre i 1500 g il pareggio si segna come **fuori scala**: un chilo di
  insalata per pareggiare le proteine di cento grammi di tofu e' un conto
  giusto e una risposta inutile.

### Un elenco solo: gli alimenti

C'erano due schermate per la stessa domanda, e non si capiva quale fosse quale.

- **"Cosa mangi"**, nel piano: gli alimenti, cioe' i nomi che le ricette usano.
- **"I tuoi prodotti"**, dal menu: i prodotti reali col codice a barre, da
  collegare a un alimento per sostituirne i valori stimati.

Due bottoni "aggiungi", due ricerche su Open Food Facts, due lettori di codici
a barre. La differenza fra un "alimento" e un "prodotto" era chiara solo a chi
aveva scritto il codice.

Sotto restano due cose diverse, e devono restarlo: **un alimento e' un nome
dentro una ricetta, un prodotto e' una scatola con un'etichetta**, ed e' proprio
questa distinzione che permette a un prodotto di correggere i valori di un
alimento in tutti i conti. Ma per chi usa l'app la domanda e' una sola — *le
cose che mangio, e quanto fanno* — e adesso la risposta e' una schermata sola,
`elencoAlimenti()`, renderizzata sia dal passo del piano sia dalla voce di menu.
Non due che si somigliano: la stessa.

Il passo si chiama **"Lista ingredienti"** — prima "Cosa mangi", che era una
domanda e non il nome di un elenco, e per giunta rispondeva alla stessa
domanda della scheda Oggi.

Quello che ogni riga dice non e' a quale registro interno appartiene, ma **da
dove viene il suo numero**: `etichetta` se e' stato letto sulla confezione,
`stima` se e' una media di categoria, `tuo` se l'hai aggiunto, `fuori piano` se
e' un prodotto che nessuna ricetta sa ancora usare. Con i filtri sopra, perche'
"quali sono ancora stimati" e' la domanda che porta a migliorare i dati.

Tre dettagli che non sono cosmetici:

- l'elenco mostra i valori **effettivi** (`alimento(nome)`, non
  `D.alimenti[nome]`): se un prodotto sostituisce quell'alimento la riga deve
  mostrare i numeri che l'app usa davvero, o direbbe "etichetta" scrivendo
  accanto la stima;
- un prodotto **collegato non compare due volte**: i suoi valori arrivano gia'
  dalla riga dell'alimento;
- aprendo un alimento sostituito da un prodotto, la scheda lo **dice** — senza,
  quei numeri sembrano usciti dal nulla, e chi prova a correggerli a mano non
  capisce perche' tornano quelli di prima.

### Il nome conta quanto i macro

Il motore ordinava solo per distanza sui macro, dentro la stessa categoria. Su
un caso frequentissimo sbagliava sempre: chi ha in dispensa **"latte di soia" e
"latte di soia proteico"** vuole spessissimo il secondo — ed era esattamente
quello che veniva scartato, perché i macro sono diversi *apposta* e la distanza
lo mandava in fondo, o fuori del tutto se stava in un'altra categoria.

`affinitaNome()` aggiunge il secondo criterio: **un nome contenuto nell'altro
vale 1** (è la stessa cosa in un'altra versione), altrimenti si contano le
parole in comune sul totale, tolte quelle che non distinguono niente ("di",
"al", "con"). Poi due effetti:

- l'affinità **accorcia la distanza fino a metà** — non l'annulla, perché una
  variante con macro molto diversi resta una scelta e non un'equivalenza, e
  infatti la riga continua a mostrare lo scarto sui quattro macro;
- **fuori categoria si entra solo da parenti stretti** (metà delle parole in
  comune), o l'elenco diventa un catalogo e smette di essere un consiglio.
  Misurato: "latte soia cioccolato" e "latte di soia proteico" condividono due
  parole su quattro ed entrano; "latte di mandorla" si ferma a un terzo e resta
  fuori.

E soprattutto: **"Oppure scegli tu"**. Il motore ordina per somiglianza, ma
"somigliante" non è "voluto" — chi usa il latte proteico oggi e quello normale
domani sta scegliendo, non cercando un'equivalenza. Il campo cercabile prende
qualunque cosa si possa mangiare, propone la quantità che pareggia il macro
dominante e la lascia modificabile, con i quattro scarti che si aggiornano
mentre scrivi.

**Prodotti compresi**, ed è stata una correzione: erano esclusi perché una
ricetta ragiona per nomi di alimenti e un prodotto col codice a barre dentro il
piano un nome non ce l'ha. Ma quello era un problema del modello, non
dell'utente: se lo hai registrato e stasera lo mangi, il diario deve saperlo
scrivere. Ora la sostituzione si porta dietro l'id del prodotto
(`swap[slot] = { a, qta, prod }`), e `macroIngrediente()` / `unitaIngrediente()`
risolvono una riga senza che chi la legge debba sapere di quale dei due si
tratta.

Nella composizione di un pasto invece un nome serve davvero, e allora scegliendo
un prodotto lo si **promuove**: `prodottoInAlimento()` crea l'alimento con i
valori dell'etichetta e ci collega il prodotto. La categoria nasce vuota
apposta e la UI lo dice — serve al motore delle sostituzioni, e sceglierla per
conto dell'utente vorrebbe dire inventarsi in che famiglia sta una cosa che non
abbiamo mai visto.

### Il pasto si apre, e dentro si modifica

Su Oggi ogni pasto srotolava i suoi ingredienti: cinque righe per pasto, per
cinque pasti, facevano della schermata piu' consultata dell'app un elenco
della spesa lungo due schermate — e quasi sempre non si stava cercando niente
li' dentro. Adesso la riga dice il nome, i macro e **cosa e' cambiato**, e gli
ingredienti stanno dietro un tocco, nello stesso posto in cui si modificano.

Dentro la scheda del pasto ci sono le quattro cose che si vogliono fare a un
pasto, tutte con la stessa regola di sempre — **valgono solo per quel giorno**:

| | |
|---|---|
| **quantita'** | il contatore che c'era gia', piu' il moltiplicatore per scalare tutto |
| **sostituisci** | apre il motore di sempre, ma **ci torna dentro**: prima riportava a Oggi, e chi stava lavorando su un pasto perdeva il posto |
| **togli** | un ingrediente del piano si porta a **zero**, non si cancella: il piano e' la ricetta e vale anche domani. Il cestino diventa un "rimettilo", o l'unica strada indietro sarebbe riscrivere a mano la quantita' |
| **aggiungi** | il quarto strato del giorno |

**`S.log[k].aggiunti[code]`** e' quel quarto strato, e non poteva essere
`extra`: quello e' il fuori piano, che sta *fuori* dai pasti e si conta a
parte. Mettendolo li' il totale del pasto avrebbe continuato a dire il numero
della ricetta mentre tu ci avevi messo dentro altro. Lo slot e' `agg:<id>` con
un id stabile — non l'indice, o togliendo il primo si sposterebbero le
quantita' di tutti gli altri — cosi' porzioni e sostituzioni sanno
indirizzarlo come qualunque altra riga.

Difetto trovato provandolo: `mealMGiorno()` decideva se ricalcolare guardando
solo tre strati, quindi **aggiungendo un alimento e basta il pasto continuava
a dichiarare le calorie del piano**. Un pasto che mente sulle calorie e'
peggio di un pasto che non si puo' modificare.

**E la differenza si vede.** In fondo alla scheda, sotto il totale, c'e' lo
scarto rispetto al piano su tutti e cinque i valori — non solo le calorie:
sostituendo un alimento le calorie tornano quasi sempre, perche' il motore
riscala apposta, e quello che si sposta sono le proteine o i grassi. Dire solo
"+12 kcal" nasconderebbe esattamente la parte che cambia. Su Oggi la stessa
cosa in forma corta: `modificato +242 kcal` accanto al nome.

### Si chiamano ricette

Per tutta la vita dell'app il piatto composto — quello che si costruisce
pesando gli ingredienti, si assegna a uno slot e si puo' sostituire — si e'
chiamato "pasto". Ma "pasto" nell'app vuol dire **due cose**, e la seconda e'
il momento in cui si mangia: "il pasto che salti piu' spesso", "pasto fuori
piano", "pasti spuntati". Chiamarle con la stessa parola costringeva ogni
frase a chiarire di quale delle due stesse parlando.

Adesso il piatto composto e' una **ricetta**, e il pasto resta il momento. La
linea passa esattamente li':

| Ricetta | Pasto |
|---|---|
| "Componi una ricetta", "Nuova ricetta", "Salva la ricetta" | "Aggiungi pasto fuori piano" |
| "Assegna le ricette agli slot dei sette giorni" | "il pasto che salti piu' spesso" |
| "Cambia la ricetta", "Scala tutta la ricetta" | "pasti spuntati", "giorni senza pasti" |
| il passo del piano, che ora si chiama **"Le tue ricette"** | i promemoria del calendario |

**Nessun sed alla cieca**, e per due ragioni concrete trovate strada facendo:
"pastigl**ia**" contiene "pasti", e "pasto fuori piano" sarebbe diventato
"ricetta fuori piano", che e' sbagliato. Cinquantotto stringhe riviste una a
una, con l'elenco esplicito e un'asserzione per ciascuna.

E **i dati non si toccano**: `D.pasti`, `d.pasti`, `pastoDelGiorno`,
`pastoSwap`, `pianoTab = 'pasti'`, il prefisso `pasto-` degli id restano
com'erano. Rinominare le chiavi vorrebbe dire rompere ogni backup gia'
esportato per un cambio di etichetta.

### Registrare qualcosa, in fondo a Oggi

L'azione piu' frequente dell'app — "ho mangiato una cosa, la scrivo" — aveva
due strade, tutte e due lunghe: scorrere fino in fondo a Oggi, dove sta il
fuori piano, oppure aprire la ricetta giusta e cercare dentro.

Il primo tentativo e' stato una carta "aggiungi in fretta" **in cima**, ed
erano due errori insieme. Il primo: due carte che chiedono la stessa cosa —
quella sopra e il fuori piano sotto — sono un doppione, e in questo file c'e'
scritto da tempo che due elenchi che si somigliano sono peggio di uno lungo.
Il secondo: un bottone verde pieno largo quanto lo schermo, in mezzo alla
pagina, si prende un'attenzione che non merita — Oggi serve a **leggere** come
sta andando, non a gridare "aggiungi".

Adesso e' una carta sola, in coda, con la forma delle altre liste dell'app:
icona a sinistra, testo, chevron a destra, come i prodotti e le schede. La
gerarchia e' quella vera — prima quello che hai gia' registrato, poi le due
strade per aggiungerne dell'altro, e in fondo le pastiglie:

1. **"Aggiungi un alimento"**: cosa, quanto e **dove**, cioe' dentro una
   ricetta del giorno oppure nel fuori piano. La destinazione parte gia'
   scelta sulla ricetta piu' vicina all'ora di adesso, perche' chi registra
   qualcosa quasi sempre lo sta mangiando;
2. **"Scrivi i valori a mano"**, per quando l'alimento non c'e';
3. **le pastiglie di quello che registri sempre** — un tocco, niente domande.
   `extraFrequenti()` esisteva gia' e lo usava soltanto il foglio del fuori
   piano, cioe' l'ultimo posto in cui si arriva. Qui basta un tocco.

C'e' anche una terza riga, **"Lista ingredienti"**, e non registra niente: e'
l'unica che porta altrove. Sta qui perche' e' qui che serve — chi cerca un
alimento e non lo trova sta guardando proprio questa carta, e finora l'unica
strada era il menu del profilo, cioe' due tocchi in un posto che con la
giornata non c'entra. Il suo quadratino e' grigio e non verde: le due sopra
aggiungono qualcosa a oggi, questa no.

Il codice a barre **non** e' in questa carta, ed e' una rinuncia meditata:
`leggiCodice()` puo' tornare col solo codice — quando l'utente sceglie di
inserire i valori a mano — e i suoi macro sono per 100 g. Registrare "un
prodotto, forse cento grammi, forse zero calorie" vorrebbe dire inventare due
numeri per risparmiare un tocco. Resta dov'e' accolto da un modulo: in
"aggiungi un alimento" dentro il piano.

### Le icone del momento della giornata

Una lista di cinque pasti sono cinque righe uguali, e il primo modo in cui si
riconosce un pasto non e' il nome ma **quando lo si mangia**. Da qui
un'icona colorata per slot: alba, sole pieno, tramonto, luna, letto — piu' una
tazza per gli spuntini fuori orario e un piatto per quando non si capisce.

I tracciati vengono da **Feather Icons** (MIT) e **Lucide** (ISC), ricopiati
dentro `icone.js` invece di essere caricati da un CDN: e' la stessa scelta di
`data/corpo.json`, e per la stessa ragione — quest'app funziona offline, e una
`<link>` a unpkg vorrebbe dire icone che spariscono in palestra dove non
prende. Sono otto disegni, non una dipendenza, e la nota di licenza sta nel
file.

`slotIcona()` guarda **prima il nome e poi l'ora**: il nome dice l'intenzione
("Pre-nanna" e' pre-nanna anche alle 21), l'ora e' un ripiego ragionevole per
gli slot chiamati "Post workout". Se non dicono niente ne' l'uno ne' l'altra
resta il piatto — meglio un'icona neutra di una sbagliata.

### La sostituzione si applica

Per molto tempo il foglio delle sostituzioni era una tabella: diceva "al posto
di 100 g di riso vanno 120 g di patate" e poi lasciava li'. Chi la sostituzione
la faceva davvero doveva andare in "porzioni", azzerare l'ingrediente originale
e aggiungere l'altro come pasto fuori piano — tre schermate per una cosa che
l'app aveva gia' calcolato.

Ora si applica, e **vale solo per quel giorno**. E' la stessa regola delle
porzioni ed e' quella giusta: il pasto nel piano e' la ricetta, il diario dice
cos'e' successo quel giorno. Sostituire il riso per sempre si fa nell'editor
del pasto, che e' un'altra cosa e un altro posto.

Il modello e' `S.log[k].swap[codice][ingredienteDelPiano] = { a, qta }`, e la
chiave e' importante: **l'indice e' il nome dell'ingrediente del piano**, anche
dopo la sostituzione. Quello e' il posto nella ricetta, e non cambia perche' ci
hai messo dentro un'altra cosa — se l'indice diventasse il nome nuovo, togliere
la sostituzione non saprebbe piu' a cosa tornare.

`ingredientiGiorno(code, k)` fonde gli strati e restituisce cosa c'era davvero
in quel pasto quel giorno; `mealMGiorno()`, la lista su Oggi e il foglio delle
porzioni passano tutti da li'. Togliendo una sostituzione sparisce anche la
quantita' cambiata di quel posto: erano grammi dell'alimento sostituito, e
riportarli sull'originale vorrebbe dire inventarsi una porzione che nessuno ha
scelto.

**E si puo' cambiare il pasto intero.** La sostituzione per alimento risolve
"il tofu oggi non ce l'ho"; questa risolve "oggi quel pasto non lo mangio", che
prima costringeva a spuntare niente e riscrivere la giornata come fuori piano —
cioe' a buttare via il piano per un pasto.

`pastiEquivalenti()` e' il motore delle sostituzioni un piano sopra: riscala il
candidato per far combaciare le calorie e poi ordina per distanza sui quattro
macro. La scala si ferma **fra ×0,6 e ×1,6**, perche' oltre quei limiti mezza
porzione di un pasto non e' piu' quel pasto. Il momento della giornata non
esclude niente — mangiare a cena quello che il piano metteva a colazione e' una
scelta — ma la riga lo dice, invece di nasconderlo.

Due dettagli del modello: il terzo strato e' `S.log[k].pastoSwap[codiceSlot]`, e
**la chiave resta il codice dello slot**, cosi' la spunta e tutto il resto
continuano a parlare della stessa riga. Cambiare il pasto **azzera** porzioni e
sostituzioni di ingrediente di quello slot: erano grammi e alimenti di un'altra
ricetta, e tenerli vorrebbe dire applicare a un pasto le correzioni fatte su un
altro. La scala si scrive come porzioni del pasto nuovo, che e' lo stesso strato
gia' usato dal moltiplicatore: non serviva inventarne un altro.

### I pasti del giorno vanno in ordine di orario

Un giorno si legge dall'alto in basso come lo si vive. Aggiungere uno spuntino
delle 16:30 e vederlo comparire sotto la cena e' il genere di cosa che fa
riscrivere la settimana da capo.

Ma non tutti i pasti hanno un'ora, e per quelli non esiste un ordine giusto da
calcolare: l'unico che lo sa e' chi mangia. Da cui la regola di
`ordinaSlotOrari()`: **si ordinano solo le voci con l'ora**, e finiscono nelle
posizioni che le voci con l'ora occupavano gia'. Le altre restano inchiodate al
loro indice, e si spostano trascinandole.

Il trascinamento e' a pointer events e non HTML5 drag-and-drop, che su iOS non
esiste: col dito non parte proprio. La maniglia e' un elemento a se' e non
tutta la riga — toccando la riga si apre il pasto, e se il trascinamento
partisse da ovunque non si potrebbe piu' scorrere la pagina con il dito sopra
l'elenco. Le altre righe si spostano davvero mentre trascini: senza, non si
capisce dove andra' a finire quella che si ha in mano.

**E l'ordinamento sta in `fondiPiano()`, non nell'inserimento.** All'inizio si
riordinava quando si aggiungeva un pasto, e bastava: chi componeva la settimana
vedeva le righe al posto giusto. Ma un piano si scrive anche da un file di
scambio, da un backup, o a mano nell'editor della settimana, e per tutte quelle
strade nessuno passava di li' — la stessa giornata usciva ordinata dall'editor
e disordinata su Oggi. Ordinando in lettura la domanda "chi l'ha scritta" non
si pone piu': `ordinaSlotOrari()` e' idempotente e non tocca le voci senza ora,
quindi rifonderlo mille volte da' sempre la stessa giornata, con i trascinamenti
a mano ancora dove li avevi lasciati.

### Esercizi: una pagina, non un foglio

"Esercizi" apriva un foglio con dentro solo i propri, e i 59 del catalogo non
si vedevano da nessuna parte: per sapere se una cosa c'era gia' bisognava
aprire una scheda e scorrere la tendina. Ora e' una sezione di Gym con tutto
dentro, la ricerca sopra (nome, attrezzo e gruppo muscolare) e un **+** che
apre le due strade — il catalogo online o la scrittura a mano.

Il filtro non passa da `route()`: ridisegnare la vista a ogni lettera fa perdere
il fuoco al campo, e su un telefono la tastiera si chiude.

Accanto alla ricerca ci sono i **gruppi muscolari come pastiglie**, e non sono
un doppione del campo di testo: la domanda vera non e' "come si chiama" ma
"cosa ho per i femorali", e a quella si risponde toccando. Col filtro acceso
ogni riga dice se quel gruppo e' primario o **secondario** — e' la differenza
fra "allena i femorali" e "li usa un po'". Un gruppo senza esercizi non compare
(sarebbe un bottone verso una lista vuota) e ritoccare quello scelto lo toglie,
che e' piu' rapido di cercare un "azzera".

Nello stesso giro e' sparita l'ultima tendina rimasta, quella della riga di
scheda: con 59 voci un `<select>` non e' piu' un selettore, e' un elenco da
scorrere col pollice — e su iPhone la tendina di sistema copre mezzo schermo.
Al suo posto lo stesso `selettoreCercabile()` degli alimenti.

### Il codice a barre sta dove hai in mano la confezione

Il lettore c'era da tempo e non lo trovava nessuno: viveva dentro la pagina
Prodotti, che si raggiunge dal menu in alto a destra — cioe' nel punto piu'
lontano possibile da chi ha la scatola in mano e vuole registrarla.

`leggiCodice(onValori)` lo rende richiamabile da ovunque: sceglie da solo fra
fotocamera e digitazione, e **restituisce i valori** invece di finire per forza
nel registro dei prodotti. Da li' il bottone e' entrato in **Piano → Cosa mangi
→ Aggiungi un alimento**, accanto a "Cerca su internet".

Tre cose che cambiano a seconda di dove arrivano i numeri, e non sono dettagli:

- **prodotto gia' registrato** — i valori li ha scritti l'utente leggendo
  l'etichetta, quindi niente `origine` e l'alimento nasce `verificato`;
- **Open Food Facts** — `origine: 'openfoodfacts'`, quindi `stima` finche' non
  si tocca "li ho controllati sulla confezione", e ci passa sopra `coerenza()`
  come per la ricerca per nome: quei numeri li inseriscono le persone, e un
  prodotto che dichiara 30 kcal con 20 g di proteine e' un errore di battitura;
- **solo il codice** — l'utente scrive i valori qui, dall'etichetta: `verificato`.

E quello che si era gia' scritto nel modulo non si perde ne' andando al lettore
ne' tornando indietro: `compilato()` esisteva gia' per la ricerca online e vale
anche qui.

### Il catalogo esercizi

59 voci in `data/palestra.json`. Le 25 aggiunte per ultime vengono da schede
reali (varianti al multipower, ai cavi, con la trap bar, la panca Scott, i dips
fra due panche). Restano fuori i doppioni di quello che c'e' gia': **un secondo
id per lo stesso esercizio spezzerebbe in due lo storico dei carichi e il
conteggio del volume**.

Le varianti invece sono voci distinte, e non e' pignoleria: su "lat machine" e
"lat con triangolo" i carichi sono diversi, e la progressione si legge per
esercizio. Ogni voce dichiara primari e secondari fra i 13 gruppi del modello —
uno che non colora niente non conta da nessuna parte.

### Il resoconto e' un documento clinico, non uno screenshot

La prima versione conteneva quello che c'era sullo schermo: verdetto, numeri a
confronto, cosa non ha funzionato. Utile per chi lo scrive, magro per chi lo
riceve. Un nutrizionista o un medico che quei numeri non li ha mai visti non
chiede "come e' andata": chiede **dove** si concentra il problema, **quale**
pasto salta, **cosa** entra oltre al piano, e soprattutto **quanto e' completo
il registro** da cui esce tutto il resto.

Da qui `statistiche.js` e otto sezioni in piu':

| Sezione | Perche' un professionista la chiede |
|---|---|
| Il registro | Va per prima, e non e' burocrazia: una media di calorie su nove giorni registrati su trenta non e' un'alimentazione, e' quello che si e' avuto voglia di scrivere. Tutto il resto del foglio vale quanto vale questa riga |
| La ripartizione | Non solo i grammi: la quota di calorie per macro e i **g per kg di peso**, che e' il modo in cui proteine e grassi si leggono in clinica — "135 g" non dice niente senza il peso della persona |
| Come si distribuisce nella settimana | Non quanto si mangia, ma QUANDO le cose si spostano. Il sabato e il mercoledi sono quasi sempre due diete diverse, e la media dei sette giorni li nasconde tutti e due |
| I pasti, uno per uno | Quante volte quel pasto era previsto e quante risulta consumato, per slot e per pasto. Il denominatore e' il numero di volte in cui compare nel piano, non i giorni: uno spuntino puo' esserci tre volte a settimana |
| Fuori dal piano | Le voci ricorrenti con quante volte e quante kcal. E' il dato che di solito manca del tutto |
| Peso e misure | Prima e ultima rilevazione dentro il periodo, con il ritmo settimanale calcolato sulla **tendenza** e non sulle due pesate agli estremi |
| Allenamento | Sedute, serie, tonnellaggio, cardio, ritmo settimanale |
| Integrazione e abitudini | Aderenza per voce, e acqua/sonno/passi/fame/energia contro i target |

Due regole che valgono per tutte: **producono numeri, non giudizi** — "il pasto
che salti piu' spesso" e' un fatto utile, farne una colpa non aggiungerebbe
niente e romperebbe la regola sul tono — e **dichiarano il denominatore**, che
e' l'unico modo di rendere verificabile una percentuale.

Una sola voce assomiglia a un giudizio, l'"aderenza" per giorno della settimana,
ed e' definita per esteso nel file: **la distanza delle calorie dal target**.
Non e' un voto sul cibo, che questa app non da'.

### Il resoconto in PDF

Serve a una cosa che sullo schermo non si puo' fare: portarselo via. Il medico
o l'allenatore non installano la PWA per guardare i tuoi numeri, e uno
screenshot di sei schermate non e' un documento.

`window.print()` era la strada corta ed e' proprio dove iOS si rompe: dentro
una web app aggiunta alla Home la finestra di stampa a volte non si apre, e
quando si apre e' il browser a decidere margini e interruzioni. Quindi il PDF
si scrive: `pdf.js` e' un generatore vero — testo, righe, rettangoli, cerchi
(quattro Bezier con kappa 0,5523), ritorno a capo, numerazione delle pagine e
tabella `xref` con gli offset in byte.

Tre scelte dichiarate:

| Scelta | Perche' |
|---|---|
| Solo Helvetica e Helvetica-Bold | Sono fra i quattordici font che ogni lettore ha gia': non vanno incorporati, e il file resta di 10-20 kB invece che di qualche centinaio |
| Solo WinAnsi | Accenti e virgolette tipografiche ci stanno tutti (`’` sta a 0x92, `—` a 0x97); quello che non entra diventa `?` invece di rompere il file in silenzio |
| Tavolozza fissa del tema chiaro | Un PDF si stampa su carta bianca. Generarlo scuro perche' il telefono e' in modalita' notturna vorrebbe dire consegnare una pagina nera |

Le larghezze dei caratteri (`PDF_WID`) sono le metriche vere di Helvetica in
millesimi di em: senza, il ritorno a capo e' a occhio e il testo esce dal
margine. E' l'unica tabella di dati dentro il codice di questo progetto, e ci
sta perche' non e' dominio: e' il font.

Il contenuto e' quello della schermata, **nello stesso ordine e con le stesse
parole**. Riscriverlo per la carta avrebbe voluto dire mantenere due testi che
dicono la stessa cosa, e prima o poi due testi che dicono cose diverse.

Come si verifica, visto che qui non c'e' un lettore PDF: si riproduce il flusso
di comandi su un canvas e si guarda, e in piu' si controlla a calcolo che
nessuna riga superi il margine destro — `x + pdfLarghezza(testo)`, con le
stesse metriche del ritorno a capo. Controllare solo la `x` di partenza non
serve: una riga che sfora comincia dentro il margine.

### Passare un pezzo di piano

Il backup completo c'era gia' e risponde a un'altra domanda: *come non perdo
quello che ho*. Prende tutto, e quando lo rimetti **sostituisce** l'archivio —
che e' esattamente cio' che deve fare un backup.

La domanda che restava scoperta e' un'altra: voglio dare la mia dieta a
qualcuno, o portarmi le schede sul secondo profilo. Con il backup completo si
puo' solo consegnare anche sessanta giorni di pesate, che non c'entrano niente
e non sono neanche sue. Da qui `scambio.js`, con quattro decisioni:

1. **L'import aggiunge, non sostituisce.** Un backup si ripristina; una dieta
   che ti passa qualcuno si affianca alla tua. Sui nomi che esistono gia' si
   chiede — "tieni i miei" e' il default — e non si decide di nascosto.
2. **`raccogli()` legge da `D`, non da `S.piano`.** Lo strato dell'utente e'
   quasi vuoto per chi sta sul piano di esempio: esportarlo consegnerebbe un
   file che **non contiene la dieta che mangi**. L'unica eccezione sono gli
   alimenti: i 44 di base ce li ha gia' chiunque installi l'app, e rispedirli
   sarebbe solo peso e quarantaquattro finti conflitti.
3. **Settimana e target non arrivano di default**, sono due interruttori. I
   target sono tarati su altezza, peso ed eta' di chi ha fatto quel piano; la
   settimana riscrive l'assegnazione di sette giorni. Prendere i pasti senza
   prendere quei due e' il caso normale, non l'eccezione.
4. **Le schede si portano dietro i loro esercizi** (quelli personalizzati, presi
   da `S.palestra.esercizi` per gli `ex` che citano), altrimenti dall'altra
   parte arriva una scheda con le righe che puntano al nulla. E ogni scheda
   importata prende un **id nuovo**: due schede con lo stesso id e la seconda
   non si apre piu', perche' `scheda(id)` trova sempre la prima.

Il diario non viene toccato in nessun caso, e la UI lo dice due volte.

Un backup completo caricato qui per sbaglio non e' un errore dell'utente: e' un
file giusto nella porta sbagliata. E la cortesia deve valere **nelle due
direzioni**: per un po' non e' stato cosi'. Il carica-scambio riconosceva un
backup e lo rimandava indietro, mentre l'importa-backup davanti a un file di
scambio diceva "formato non riconosciuto" — un vicolo cieco, e per giunta
falso, perche' quel formato l'app lo conosce benissimo. Segnalato da chi ci e'
finito dentro esportando le schede su un secondo dispositivo.

Adesso nessuna delle due rimanda a cercare un altro bottone: **apre quella
giusta**. Chi ha scelto un file lo vuole importare, e sapere quale dei due
pulsanti l'app si aspettava non e' un problema suo.

**Le righe che puntano al nulla si dicono prima.** Gli esercizi del catalogo
di base non viaggiano nel file — ce li ha gia' chiunque abbia l'app, e
spedirne cinquantanove sarebbe solo peso — ma "chiunque" vale finche' i due
dispositivi hanno lo stesso `data/palestra.json`. Uno fermo a una versione
vecchia e la riga arriva senza il suo esercizio. `orfani()` li conta e
l'anteprima li nomina: non e' un motivo per rifiutare il file, e' un motivo
per dire perche' quella scheda si aprira' con delle righe vuote — e che di
solito si risolve aggiornando l'app.

Nota di robustezza trovata nello stesso giro: `riassuntoBackup()` dava per
scontato `o.profili.lista`, e un backup troncato faceva morire l'anteprima a
meta' foglio invece di dire che il file non conteneva niente.

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
- Non disegnare le etichette delle serie all'ultimo punto e basta: due curve
  che finiscono vicine stampano due parole una sopra l'altra, ed e' proprio
  quando si toccano che si guarda il grafico. Passano da `etichetteSerie()`,
  che le distanzia e scansa le piastrine gia' occupate
- Non mettere in evidenza la prontezza di Banister: e' sempre positiva per chi
  si allena, quindi e' la curva che non puo' dire di no. Quello che decide e'
  la fatica contro la fatica che porti di solito
- Non confrontare fatica o prontezza con una soglia fissa, nemmeno con una
  scelta bene: il confronto e' con il proprio regime, e il regime si misura
  sulla **fatica** e non sul rapporto fatica/forma — quel rapporto ha un
  transitorio di mesi, perche' la forma ci mette 42 giorni a riempirsi
- Non calcolare il regime su tutta la storia disponibile: le prime settimane
  di allenamento hanno una forma ancora piccola e valori fuori scala, e
  finiscono nella mediana con cui si giudicano tutti gli altri giorni
- Non chiamare "target" una riga di riferimento che e' una soglia da non
  superare: dice che ci vuoi arrivare. C'e' `tTarget`
- Non scrivere in un sottotitolo una scala che il diario non usa: fame ed
  energia si dichiarano da 1 a 10, e il grafico diceva "da 1 a 5"
- Non far vedere due serie su un grafico senza legenda: i punti grezzi lontani
  dalla media mobile sembrano un errore di allineamento, e non lo sono
- Non passare a `nf()` un numero che puo' non esserci aspettandosi un errore:
  adesso scrive "—" invece di lanciare. Lanciava, e siccome `nf` sta in
  qualche centinaio di punti bastava un dato mancante in uno solo per lasciare
  mezza schermata non disegnata, con l'eccezione in console dove non la legge
  nessuno
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
- Non dare per scontato che chi usa l'app abbia un professionista che gli ha
  detto quante calorie mangiare: e' il caso raro. Ma chi ce l'ha deve poter
  ignorare il motore in un colpo solo, e la carta glielo dice per prima cosa
- Non esprimere un ritmo in chili fissi: mezzo chilo a 55 kg e mezzo chilo a
  100 kg sono due deficit diversi. La percentuale del peso e' la stessa cosa
  per tutti
- Non mostrare un ritmo che il pavimento calorico taglia senza dirlo prima:
  promettere −0,7 kg a settimana e consegnare le calorie di −0,35 e' un
  bottone che mente
- Non scalare le proteine con le calorie nemmeno qui: dipendono dall'obiettivo
  e dal peso, e in deficit salgono invece di scendere
- Non dare a tutti lo stesso fisico di riferimento: `target_fisico` arrivava da
  `...DBASE` anche a chi cominciava da zero, che e' la stessa cosa vietata per
  il nome e le misure di partenza. Si sceglie, o non c'e'
- Non presentare le misure di un personaggio pubblico come rilevate: sono
  dichiarazioni di stampa, e vanno riportate sull'altezza di chi le guarda —
  le circonferenze in proporzione, la massa magra col quadrato
- Non offrire un fisico di riferimento senza dire quanta massa magra chiede:
  l'FFMI e' l'unica informazione che distingue "impegnativo" da "non succede",
  e non averla e' il motivo per cui si insegue per anni una cosa che non
  arriva. Ma resta una soglia di pratica comune, non un divieto
- Non promettere quanto ci vuole ad arrivare a un fisico: dipende da quanti
  anni ti alleni, e una data sarebbe una scadenza da mancare
- Non presentare come misurato ciò che è stimato. Il grasso corporeo esce da una
  formula su vita, collo e altezza e sbaglia di ±3–4 punti; le misure di Brad Pitt
  sono dichiarazioni di stampa (`fonte: "stima"`). Servono a dare una direzione,
  non un verdetto, e la UI deve dirlo
- Non usare la massa magra dichiarata da una bioimpedenza insieme alla pesata
  di oggi: la grassa diventa la differenza fra due bilance diverse, e la
  stessa tabella finisce per scrivere due percentuali diverse. Dalla BIA si
  prende la percentuale
- Non far valere una bioimpedenza per sempre: e' un punto nel tempo, e dopo
  un mese descrive il corpo di un mese fa. La formula si rimisura, lei no
- Non togliere il peso dalla tabella della composizione: li' non e' un
  doppione della carta in cima, e' il totale di cui grasso e magra sono le
  parti, e senza si somma a mente. Il doppione erano i rapporti fra
  circonferenze, che sono proporzioni e stanno con le circonferenze
- Non dimensionare con `auto` le colonne di una tabella la cui intestazione e
  le cui righe sono griglie separate: ognuna si misura sul proprio contenuto,
  e i numeri finiscono sotto la loro etichetta solo per coincidenza. Tracce
  esplicite, uguali per l'intestazione e per le righe
- Non lasciare un grafico senza griglia e senza numeri sull'asse quando la
  scala si adatta ai dati: mezzo chilo e tre chili disegnano la stessa curva
- Non far contare a un'intestazione una cosa diversa da quella che sta
  intestando: due numeri sopra otto barre devono contare quelle otto barre
- Non usare il grigio per dire "sotto il target": in quest'app il grigio vuol
  dire "non c'e' dato", e una riga sotto target sembra disattivata. Il colore
  dice dentro o fuori, la direzione la dice il testo
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
- Non far dire alla mappa una frase generica al posto dei numeri: i tre modi
  fanno tre domande, e la lettura le risponde tutte e tre
- Non presentare come assolute le percentuali della mappa: sono rispetto al
  gruppo che guida quella classifica, e "stanchezza 100%" e' "il piu' stanco
  di oggi", non "distrutto"
- Non colorare una mappa a gradini larghi: con quattro livelli il primo tiene
  un quarto della scala, e due valori diversi escono identici. La scala e'
  continua, e parte dal colore della superficie
- Non normalizzare il volume della mappa su una costante mentre fatica e forma
  sono relative alla settimana: la stessa mappa userebbe un terzo della
  tavolozza e sembrerebbe spenta. Ma serve un pavimento, o una settimana quasi
  vuota si dipinge come una piena
- Non mettere l'intensita' del colore in `opacity`: l'animazione d'ingresso
  anima quella, e si porterebbe via il dato. Va in `fill-opacity`
- Non usare `color-mix` senza ripiego: sotto Safari 16.2 non esiste, e un
  valore non valido in un attributo di presentazione non lascia il colore di
  prima — lo azzera
- Non mappare `adductors` e `neck` di free-exercise-db dentro glutei o trapezi
  per far quadrare i conti: la mappa muscolare, il volume e la forma-fatica si
  reggono su quei gruppi. Un muscolo senza corrispondenza va dichiarato, non
  indovinato
- Non trattare carboidrati e grassi come contorno di calorie e proteine: due
  errori di segno opposto si compensano nel totale, e una giornata "in linea"
  puo' essere 77 g sotto di carboidrati e 34 sopra di grassi
- Non dare a carboidrati e grassi `verso: 'su'`: non sono le proteine, conta lo
  scarto in tutte e due le direzioni
- Non presentare il pavimento dei grassi come una misura: e' 0,6 g/kg preso
  dalla letteratura, come le costanti di Banister. La UI deve continuare a dirlo
- Non lasciare un grafico senza modo di leggere il numero esatto: il manubrio
  mostra la direzione e nasconde il valore. La lettura e' al tocco, e la zona
  toccabile e' la riga intera, non il pallino
- Non fermare l'asse del manubrio a una costante: con dieci voci qualcuno
  finisce oltre il 135%, e un punto appoggiato al bordo dice una cosa falsa
- Non lasciare che una carta con i testi in bianco fisso prenda
  `background:var(--ink)`: al buio quel token diventa chiaro, la carta si
  ribalta e i testi spariscono. Se una superficie deve restare scura in tutti e
  due i temi le serve un token suo (`--evid`)
- Non stilare come `div` un elemento che e' diventato `button`: senza il reset
  prende il fondo chiaro di sistema, e al buio e' un rettangolo bianco in mezzo
  alla lista
- Non centrare un titolo con `justify-content:space-between`: si mette al
  centro dello spazio che avanza, e basta un bottone piu' largo dell'altro
  per vederlo storto. Tre colonne, le due laterali uguali
- Non scrivere `location.hash` per cambiare pagina: se e' l'indirizzo che hai
  gia', `hashchange` non scatta e il bottone sembra rotto. Si passa da
  `apri()`, che quando l'indirizzo non cambia chiede il disegno
- Non dare a una voce di menu un nome a cui rispondono tre schermate: "Il
  piano" e "Quello che mangi" erano domande, non destinazioni
- Non lasciare in un menu una voce che porta a un passo spento: con il piano
  alimentare tolto, ricette e settimana non esistono
- Non leggere un campo dentro un `setTimeout` senza controllare che ci sia
  ancora: fra il tick e l'esecuzione la pagina puo' essere stata sostituita, e
  quello che resta e' un'eccezione in console che nasconde quelle vere
- Non aggiungere una terza superficie di navigazione: la persona e' "tu", il
  ⋯ e' "l'app e i dati", e una tendina in mezzo che porta dove portano gia'
  quelle due non aggiunge una destinazione
- Non rompere `#/dati`, `#/analisi` e `#/revisione`: sono diventati viste di
  Andamento ma restano indirizzi validi, e ci puntano parecchi link interni
- Non ordinare la lista della spesa come stanno scritti i dati: una lista si
  cammina, e l'ordine delle corsie lo conosce solo chi entra in quel negozio
- Non chiedere di compilare un modulo di quarantaquattro righe per la
  dispensa: la domanda "quanto ne ho" nasce sulla riga della spesa, ed e' li'
  che va fatta
- Non far scalare la dispensa da sola mentre si spuntano le ricette: resta
  vero che un inventario che non torna e' peggio di nessun inventario. Ma "ho
  comprato queste cose" e' dichiarato, non dedotto, e quella meta' si chiude
- Non mettere i colori delle corsie in una tabella: si calcolano dal nome, o
  una categoria nuova resta grigia finche' qualcuno non se ne ricorda
- Non chiedere di scrivere a mano una categoria che esiste gia': il motore
  delle sostituzioni confronta stringhe, e "legumi" contro "Legumi" sono due
  famiglie separate senza che nessuno se ne accorga. Si sceglie fra quelle in
  uso, e scriverne una nuova e' la seconda strada
- Non dare un verdetto su quale di due alimenti sia "meglio": dipende da cosa
  tieni fermo, e le tre risposte vanno mostrate tutte e tre
- Non inventare un equivalente dove il vincolo non esiste (proteine di un olio):
  `null` e una riga che lo dice valgono piu' di un numero enorme
- Non aprire una seconda schermata per gli alimenti: "Cosa mangi" e la voce di
  menu sono la stessa `elencoAlimenti()`. Due elenchi che si somigliano sono
  peggio di uno lungo
- Non mostrare in elenco `D.alimenti[nome]` dove un prodotto lo sostituisce:
  vanno mostrati i valori che l'app usa davvero, o la riga dice "etichetta" e
  scrive accanto la stima
- Non escludere i prodotti col codice a barre dalle ricerche: se uno lo ha
  registrato è perché lo mangia. Dove serve un nome — le ricette — si promuove
  a alimento; dove basta un valore — il diario — si tiene l'id
- Non ordinare le sostituzioni solo sui macro: "latte di soia proteico" ha
  macro diversi da "latte di soia" *per costruzione*, ed è proprio la
  sostituzione che si cerca più spesso. Il nome è un criterio, non un dettaglio
- Non far entrare tutto fuori categoria per far salire le varianti: senza il
  recinto l'elenco diventa un catalogo. Metà delle parole in comune è la soglia
- Non riscalare un pasto oltre ×0,6–×1,6 per far combaciare i macro: mezza
  porzione di un pasto non e' piu' quel pasto
- Non tenere porzioni e sostituzioni di ingrediente quando si cambia il pasto
  intero: erano di un'altra ricetta
- Non giudicare una scheda sulla prima seduta contro l'ultima, e non sotto le
  tre sedute: una giornata storta sposterebbe il verdetto da sola
- Non presentare le otto settimane come una soglia misurata: e' pratica comune,
  come le costanti di Banister
- Non rinominare "pasto" in "ricetta" con una sostituzione globale:
  "pastiglia" contiene "pasti", e "pasto fuori piano" non e' una ricetta. E
  non toccare le chiavi dei dati per un cambio di etichetta: `D.pasti`,
  `pastoDelGiorno`, `pastoSwap` e il prefisso `pasto-` reggono i backup gia'
  esportati
- Non mettere due carte che chiedono la stessa cosa in due punti della stessa
  schermata: la registrazione di un alimento e il fuori piano sono la stessa
  intenzione, e stanno in una carta sola
- Non usare un bottone pieno a tutta larghezza per un'azione che non e' la
  ragione per cui si e' aperta la pagina: Oggi si apre per leggere come sta
  andando
- Non srotolare gli ingredienti di ogni pasto su Oggi: cinque righe per cinque
  pasti fanno un elenco della spesa lungo due schermate, e quasi mai si sta
  cercando qualcosa li' dentro. Si aprono dove si modificano
- Non aggiungere un alimento a un pasto dentro `extra`: quello e' il fuori
  piano e si conta a parte, e il totale del pasto continuerebbe a dire il
  numero della ricetta
- Non indicizzare gli alimenti aggiunti sull'indice dell'array: togliendo il
  primo si spostano le quantita' di tutti gli altri. Serve un id stabile
- Non decidere se ricalcolare un pasto guardando solo tre dei quattro strati:
  e' cosi' che un pasto arriva a mentire sulle proprie calorie
- Non cancellare un ingrediente del piano dal diario: si porta a zero, perche'
  il piano e' la ricetta e domani vale ancora. E il cestino deve diventare un
  "rimettilo", o non c'e' strada indietro
- Non far tornare a Oggi una sostituzione aperta dalla scheda del pasto: si
  stava lavorando li', ed e' li' che si vuole vedere il risultato
- Non caricare le icone da un CDN: l'app funziona offline. Si ricopiano
  dentro, con la licenza, come i tracciati del corpo
- Non indicizzare una sostituzione sul nome dell'alimento NUOVO: la chiave e'
  il posto nella ricetta, cioe' l'ingrediente del piano. Altrimenti togliere la
  sostituzione non sa piu' a cosa tornare
- Non far cambiare al foglio delle sostituzioni il pasto nel piano: quello e'
  la ricetta e vale per tutti i giorni. Una sostituzione vale per il giorno in
  cui la fai, come le porzioni
- Non ordinare i pasti solo quando si inseriscono: un piano arriva anche da un
  backup, da un file di scambio e dall'editor della settimana, e per quelle
  strade nessuno passa dall'inserimento. Si ordina in lettura, in
  `fondiPiano()`, dove l'ordinamento e' idempotente
- Non far scegliere una scheda al buio quando l'app sa gia' come stanno i
  gruppi che allena: l'informazione c'era, stava due schermate piu' in la'
- Non pesare i gruppi di una scheda tutti uguali: dodici serie di petto e due
  di polpacci non sono meta' e meta'
- Non scrivere "sconsigliata" su una scheda: la scheda non ha fatto niente di
  male, e quello che e' carico e' il corpo, per oggi
- Non mostrare una pastiglia senza il perche': un'etichetta senza motivo si
  impara a ignorare
- Non far cancellare una serie al tocco: nello storico una serie sbagliata
  quasi mai e' di troppo, e' segnata male. Toccare apre, e dentro c'e' anche
  l'esercizio — cambiarlo e' l'errore che nessun'altra schermata ripara
- Non dimenticare `scordaFatica()` dopo aver toccato le serie: la forma-fatica
  e' memorizzata per muscolo e continuerebbe a rispondere coi numeri di prima
- Non far tornare `sheetLibero()` su una seduta che non esiste piu': togliendo
  l'ultima serie la giornata sparisce dal registro
- Non far nascere una seduta dall'aver **guardato** la schermata di scelta:
  la giornata la creano i punti in cui una serie viene scritta davvero. Una
  seduta a zero serie faceva scrivere "Continua la seduta" a chi non aveva
  cominciato, e quel bottone non poteva continuare niente
- Non decidere l'etichetta di un bottone sull'esistenza di un oggetto quando
  quello che conta e' se dentro c'e' qualcosa: `serie.length`, non
  `sessioni[k]`
- Non far ricreare la seduta a `sheetLibero()` quando ci si torna dopo aver
  cancellato l'ultima serie: rimetterebbe dentro quello che si e' appena
  tolto. L'ingresso vero lo dichiara, il ritorno no
- Non elencare nello storico le sedute senza serie: la traccia di un tocco non
  e' un allenamento
- Non far riprendere una guida che non ha registrato niente: aprire una
  scheda e richiuderla lascia uno stato a zero serie, e riproporlo ogni volta
  e' una domanda su un lavoro mai iniziato
- Non abbreviare i giorni della settimana a tre lettere sotto un'intestazione
  di mese: "mar" si legge marzo
- Non lasciare senza uscita una seduta registrata per sbaglio: entra nel
  volume, nella forma-fatica, nel monitoraggio della scheda e nel conteggio
  della revisione. E chi la elimina va avvisato che tocca solo la palestra
- Non far dimenticare a `_ffCache` una seduta cancellata: la forma-fatica e'
  memorizzata per muscolo e continuerebbe a rispondere coi numeri di prima
- Non lasciare spuntare un pasto in un giorno che non e' arrivato: quel
  giorno comincerebbe con le caselle gia' segnate. Ma nemmeno bloccare la
  navigazione in avanti: "cosa mangio domani" e' una domanda legittima, e il
  piano e' li' per rispondere. In avanti si legge, non si scrive
- Non far scorrere Oggi oltre i sette giorni: il piano e' settimanale, e
  l'ottavo giorno e' identico al primo
- Non leggere `riga.strip`, `riga.piram` o `riga.rpMini` direttamente: passano
  tutti da `serieDiRiga`, `bersaglioTesto`, `scarichiDiRiga` e `usaRestPause`,
  che sono il posto in cui una scheda vecchia e una nuova si comportano uguale
- Non lasciare `serie`, `reps` e `repsMax` sfasati rispetto a un `piram`: la
  doppia progressione, il monitoraggio e il volume leggono quei tre campi e
  non sanno che esiste un piramidale
- Non scrivere "8–8": un range con gli estremi uguali non e' un range, e letto
  su una scheda sembra un errore di compilazione
- Non far riscrivere il carico a ogni serie: se hai appena fatto 60 kg, la
  serie dopo parte da 60. E dire da dove viene il numero, invece di lasciarlo
  indovinare
- Non mettere il timer del recupero SOPRA la carta della serie successiva:
  chiede di compilare una serie prima di averla fatta. Il recupero e' la
  schermata, e quando l'anello e' li' la barra in basso sparisce
- Non attribuire il recupero alla serie che arriva: appartiene a quella che lo
  ha reso necessario, cioe' a quella appena fatta
- Non far ripassare da "come registri?" chi ha chiuso il foglio per sbaglio a
  meta' seduta: se c'e' una guida in corso si riprende da li'
- Non ricopiare a mano "mezza serie per scarico": sono `serieEquivalenti()`,
  `tonnellaggioSerie()` e `ripetizioniSerie()`, e le chiamano tutti. Copiarle
  significa che la stessa seduta vale di piu' o di meno a seconda di chi la
  guarda
- Non arrotondare a intero il numero di serie: con gli scarichi 12,5 e' un
  numero giusto
- Non dare un voto a una seduta: il resoconto e' un fatto con accanto il
  metro con cui e' stato misurato, e una seduta leggera non e' un errore
- Non confrontare una seduta con la media di tutte quando c'e' una scheda: una
  giornata di gambe contro la media di tutto dice solo che le gambe pesano
- Non leggere la forma-fatica del giorno stesso per dire come ci sei arrivato:
  dopo la seduta la fatica e' quella della seduta
- Non registrare il bersaglio al posto delle ripetizioni fatte quando il campo
  e' vuoto: il registro direbbe quello che la scheda chiedeva, e da quel numero
  escono massimale stimato, progressione e verdetto sulla scheda
- Non trattare `+30` a tempo scaduto come "allunga di trenta": non muove
  niente sullo schermo. A recupero finito quel bottone vuol dire "altri trenta
  da adesso"
- Non chiudere una barra senza guardare a quale recupero appartiene: il
  `setTimeout` dei venti secondi deve portarsi dietro il `t0`, o uccide il
  timer partito dopo
- Non tenere due soglie diverse per lo stesso stato: la barra viva e
  `recRiprendi()` devono decidere allo stesso modo quando un recupero e'
  scaduto da troppo
- Non far partire il recupero dopo l'ultima serie della seduta: non c'e'
  niente da recuperare
- Non presentare il recupero calcolato come una misura: e' pratica comune, ed
  e' il motivo per cui `sc.recupero` e `riga.recupero` esistono
- Non far partire il recupero in mezzo a una superserie: le due righe si fanno
  attaccate, e il timer va sull'ultima del giro
- Non far sparire dopo venti secondi il timer di una seduta guidata: li' il
  tempo oltre il recupero e' un dato. E ricordarsi che sotto un foglio aperto
  la barra non la vede nessuno — durante la guida deve stare sopra
- Non tenere quattro copie della stessa regola: "mi sono allenato quel giorno"
  la calcolavano costanza, revisione, statistiche e resoconto, ognuna per conto
  suo. Ora e' `allenatoIl(k)`, e le quattro chiamano quella
- Non chiedere all'utente un dato che l'app ha gia': l'interruttore
  dell'allenamento poteva contraddire le serie registrate, e non c'era modo di
  sapere quale delle due risposte valeva. Ma il flag dei registri vecchi va
  continuato a leggere, o si riscrive la storia di chi l'ha usato
- Non togliere il peso dal diario senza dare un altro posto dove **correggere
  una giornata passata**: Corpo non ha la navigazione dei giorni, quindi il
  foglio del peso porta la sua data dentro. Una pesata sbagliata resta nella
  tendenza per due settimane
- Non far incrementare al bottone del peso un numero che non esiste: su una
  giornata senza pesata il primo tocco appoggia sulla tendenza, e non registra
  una pesata che nessuno ha fatto
- Non monitorare una scheda sola quando il programma ne ha due: Giorno 1 e
  Giorno 2 sono un programma solo, e giudicarne meta' chiamandola "il
  programma" e' un errore di soggetto, non di calcolo
- Non mettere in un elenco solo la progressione di schede diverse: la panca del
  Giorno 1 e quella del Giorno 2 sono due serie di dati, e affiancarle fa
  sembrare doppioni due righe che non lo sono
- Non presentare le capienze dei bicchieri come misure: 200/250/500/1500 ml
  sono convenzioni, e per la borraccia da 750 deve restare il campo libero
- Non tenere solo il totale dell'acqua: senza l'elenco dei sorsi "annulla"
  dovrebbe chiedere a chi ha sbagliato tocco quanto valeva quel tocco
- Non ordinare da soli i pasti senza orario: per quelli non esiste un ordine
  giusto da calcolare, e vanno lasciati dove sono con una maniglia per
  spostarli
- Non usare l'HTML5 drag-and-drop: su iOS col dito non parte. Pointer events, e
  la maniglia deve essere un elemento a se' o la pagina non si scorre piu'
- Non lasciare il lettore di codici a barre dentro una sola schermata: chi ha
  la confezione in mano sta aggiungendo un alimento, non navigando il registro
  dei prodotti. `leggiCodice()` si chiama da dove serve
- Non marcare `verificato` un alimento arrivato da un codice a barre passando
  per Open Food Facts: quei valori li inseriscono le persone. Da un prodotto
  gia' nel proprio registro si', perche' li ha scritti l'utente dall'etichetta
- Non dare un id nuovo a un esercizio che esiste gia' con un altro nome: lo
  storico dei carichi e il volume settimanale si spezzano in due
- Non scrivere una sola delle due date del cruscotto: `datiIntervallo()` le
  prende tutte e due e ricalcola la lunghezza. Toccando solo la fine il periodo
  scivolava intero e anche la data di inizio si muoveva da sola — dall'esterno
  sembrava che il filtro non funzionasse, ed era esattamente quello che
  succedeva
- Non far contare a una pagina fino a ieri e a un'altra fino a oggi: sono due
  numeri diversi per lo stesso periodo, e chi legge non puo' saperlo
- Non mettere il nome di una persona reale in cima alla scheda del corpo di
  qualcun altro: un paragone non e' un dato. Le misure di riferimento restano
  nel file di dominio, il racconto no
- Non lasciare fisse le soglie della revisione quando il periodo non e' di
  sette giorni: l'obiettivo di sedute e' settimanale e va scalato, la soglia
  del registro e' meta' dei giorni. Altrimenti ogni periodo corto risulta
  "sotto" e ogni periodo lungo "sopra", che e' un artefatto e non una misura
- Non confrontare un periodo con una finestra di lunghezza diversa: venti
  giorni contro sette dicono che hai camminato tre volte tanto
- Non agganciare l'impegno o `revisioneLetta` a un periodo scelto a mano: sono
  due cose settimanali, e chiudere "dal 3 al 19" non deve zittire la revisione
  di domenica
- Non usare `window.print()` per fare un PDF su iOS: dentro una PWA aggiunta
  alla Home la finestra di stampa a volte non si apre, e i margini li decide il
  browser. Il file si genera, e cosi' si sa cosa contiene
- Non incorporare font nel PDF ne' inventare le larghezze dei caratteri: con i
  quattordici font di base il file resta di venti kB, e senza le metriche vere
  il ritorno a capo va a occhio e il testo esce dal foglio
- Non generare il PDF con i colori del tema scuro: si stampa su carta bianca
- Non rispondere "formato non riconosciuto" a un formato che l'app conosce: se
  il file e' dell'altra porta, si apre l'altra porta. Vale nelle due direzioni
- Non dare per scontato che il catalogo esercizi sia lo stesso sui due
  dispositivi: gli id di base non viaggiano nel file, e uno fermo a una
  versione vecchia riceve righe che puntano al nulla. Si contano e si dicono
- Non far sostituire l'archivio a un file di scambio: quello e' il mestiere del
  backup. Un piano che arriva da fuori si **aggiunge**, e sui doppioni si chiede
- Non esportare lo strato `S.piano` come se fosse il piano: chi sta sul piano di
  esempio ce l'ha quasi vuoto, e il file consegnato non conterrebbe la dieta che
  mangia davvero. Si esporta `D`, meno i 44 alimenti di base che ha gia' chiunque
- Non riusare l'id di una scheda importata: `scheda(id)` restituisce la prima che
  trova, e la seconda diventa impossibile da aprire
- Non usare media e deviazione standard per riconoscere una pesata sbagliata:
  il valore anomalo alza sia la media sia lo scarto e finisce per giustificarsi
  da solo. Servono mediana e MAD
