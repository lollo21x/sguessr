# Song Guesser

Sito web **statico** (HTML + CSS + JS): **non serve npm**.

## Come aprirlo

```bash
cd /Users/lorenzo/Documents/songguesser
python3 -m http.server 8080
```

Poi apri: **http://localhost:8080**

(Le API musicali funzionano meglio con un server locale, non con `file://`.)

## Icone

Generate da `Icon-iOS-Dark-1024@1x.png`:

| File | Uso |
|------|-----|
| `favicon-32.png` / `favicon-48.png` | Tab del browser |
| `apple-touch-icon.png` | Home iOS |
| `pwa-192.png` / `pwa-512.png` | Install PWA + logo in-app |
| `icon-1024.png` | Icona ad alta risoluzione |

## Gioco

1. Parti da **2 secondi** di audio
2. **Skip** (doppia freccia) sblocca piu secondi: 2 > 5 > 10 > 15 > 20 > 30
3. Autocomplete solo sul catalogo
4. Check = indovina; freccia next = brano successivo
5. Clic sul trofeo/punteggio = ricomincia (dialog integrato)
6. Intro solo alla prima visita (`localStorage`)

Colore principale: **rgb(0, 127, 234)**. Preview gratis da iTunes / Deezer.
