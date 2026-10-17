# Pieno

Web app per trovare dove conviene fare il pieno: prezzi ufficiali dei carburanti
(open data MIMIT) e ordinamento per **costo reale**, cioè prezzo più il carburante
consumato per arrivare al distributore e tornare.

Pensata per il telefono, funziona anche su tablet e computer. Si installa come
app dal browser (PWA) e potrà essere pubblicata negli store con Capacitor.

## Come funziona

- `scripts/build-data.mjs` scarica ogni giorno i due file del Ministero
  (anagrafica e prezzi, separatore `|` dal 10/02/2026), tiene benzina, gasolio,
  GPL e metano, e li divide in caselle geografiche da 0,5° (`public/data/t/*.json`).
  L'app scarica solo le caselle vicine all'utente.
- `.github/workflows/aggiorna.yml` esegue lo script due volte al giorno e
  pubblica la cartella `public/` su GitHub Pages. Nessun server da pagare.
- `public/index.html` è l'intera app: HTML, CSS e JavaScript senza dipendenze.

## Comandi

```sh
npm test            # test del generatore dati
npm run data:test   # dati di PROVA (inventati) da test/fixtures, per lavorare in locale
npm run data        # dati reali dal Ministero
npm start           # serve public/ su http://localhost:5173
```

## Aggiornamento dei prezzi (fase di sviluppo)

I server GitHub non raggiungono mimit.gov.it (blocca le connessioni dall'estero),
quindi per ora i due file si caricano a mano nella cartella `fonte/`: istruzioni
in [fonte/LEGGIMI.md](fonte/LEGGIMI.md). Più avanti lo farà un piccolo server in Italia.

## Messa online

1. Su GitHub: Settings → Pages → Source: **GitHub Actions**.
2. Actions → "Aggiorna prezzi e pubblica" → Run workflow.

## Pubblicazione negli store (più avanti)

Con [Capacitor](https://capacitorjs.com) la cartella `public/` diventa un'app
iOS/Android. Nell'app impostare in `index.html` il meta `pieno-data` all'indirizzo
completo del sito (es. `https://tuodominio.it/data/`), così i prezzi restano
quelli aggiornati online. Servono un account Apple Developer (99 $/anno) e
Google Play Console (25 $ una tantum).

## Fonte dati

Ministero delle Imprese e del Made in Italy, open data "Carburanti - Prezzi
praticati e anagrafica degli impianti". Verificare la licenza indicata sulla
pagina del dataset e mantenere l'attribuzione nell'app.
