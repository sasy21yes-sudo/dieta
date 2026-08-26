# Dieta

App web installabile su iPhone senza App Store.

## Metterla sul telefono (5 minuti)

1. Carica questa cartella in un repo GitHub
2. **Settings → Pages → Deploy from branch → `main` / root**
3. Sull'iPhone apri l'URL **in Safari** (non Chrome: solo Safari può installare)
4. Tasto Condividi → **Aggiungi alla schermata Home**
5. Apri dall'icona, non dal browser

Dalla seconda apertura funziona anche senza rete.

## Prima di pubblicare: cosa diventa pubblico

Con GitHub Pages su un repo pubblico, **chiunque abbia l'URL può leggere
`data/dieta.json`**, che contiene nome, età, altezza, peso di partenza, misure
corporee di riferimento e il piano alimentare.

Quello che **non** esce mai dal telefono è il diario quotidiano — pesate, misure,
integratori, allenamenti: sta in `localStorage` e non viene mai inviato da nessuna
parte, perché non c'è nessun server a cui inviarlo.

Se la cosa dà fastidio, le alternative sono un repo privato con GitHub Pages
(serve un piano a pagamento) oppure Cloudflare Pages / Netlify, che pubblicano
da un repo privato gratis. In tutti i casi il sito resta raggiungibile da chi ha
l'URL: non è una password, è solo un indirizzo poco indovinabile.

## Provarla in locale

```bash
py -m http.server 8000        # Windows
python3 -m http.server 8000   # macOS e Linux
# poi apri http://localhost:8000
```

`localhost` è contesto sicuro, quindi il service worker parte e si può provare
anche l'offline senza HTTPS.

## Notifiche

iOS non permette a una web app di programmare notifiche locali.
Apri l'app → **⋯** → *Scarica i promemoria (.ics)* → apri il file con Calendario.
Pasti, integratori, pesata e revisione domenicale diventano notifiche native.

## Backup

**⋯ → Esporta backup.** I dati vivono solo sul telefono: se svuoti i dati di Safari,
togli l'app dalla schermata Home o cambi dispositivo, senza backup lo storico è perso.
L'app lo ricorda da sola ogni 20 giorni registrati.

Dettagli tecnici e roadmap: `CLAUDE.md`.
