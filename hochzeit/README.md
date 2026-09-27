# Hochzeitsseite · Tamara & Christopher · 24.10.2026

Eine eigene kleine Webseite im Ordner `hochzeit/`. Sie hat nichts mit dem
Auftragsbuch zu tun, liegt nur im selben Repository.

- **Titelseite** mit den Namen in Schreibschrift, dem Datum und einem Countdown
- **Begrüßung** und auf Wunsch eine kleine Reihe eigener Fotos
- **Hochladen** von Fotos und kurzen Videos durch die Gäste – direkt vom Handy
  in einen kostenlosen Cloud-Speicher (Cloudinary). Gäste sehen nur ihre
  eigenen Uploads, nicht die der anderen. Herunterladen kann nur, wer das
  Cloudinary-Konto hat – also später das Brautpaar.

Aufruf über GitHub Pages:
`https://marymayr.github.io/AuftragsbuchFotografie/hochzeit/`

---

## 1. Cloud-Speicher einrichten (einmalig, ca. 10 Minuten)

Warum Cloudinary: Die Gäste laden **direkt aus dem Browser** hoch, es braucht
keinen eigenen Server, und der kostenlose Tarif reicht für eine Hochzeit gut
aus (Stand 2026: 25 „Credits“ im Monat, 1 Credit ≈ 1 GB Speicher; Fotos bis
10 MB, Videos bis 100 MB je Datei). Eine Kreditkarte ist nicht nötig.

1. Auf **cloudinary.com** ein kostenloses Konto anlegen. Am besten gleich mit
   einer E-Mail-Adresse, die später dem Brautpaar gehören soll (oder ihr ändert
   die Adresse nach der Hochzeit und gebt das Passwort weiter).
2. Im Dashboard steht oben der **Cloud name** (z. B. `dxyz12abc`). Notieren.
3. Links **Settings** (Zahnrad) → **Upload** → **Upload presets** →
   **Add upload preset**:
   - *Signing mode*: **Unsigned**
   - *Preset name*: z. B. `hochzeit-gaeste` – notieren
   - *Folder*: leer lassen (die Seite legt die Ordner selbst an)
   - *Overwrite*: aus · *Unique filename*: an
   - Speichern.
4. Unter **Settings → Security** prüfen, dass **„Resource list“** unter
   *Restricted media types* angehakt ist (Standard). So kann niemand von außen
   eine Liste aller Bilder abrufen.

## 2. Eintragen

In `hochzeit/config.js`:

```js
cloudinary: {
  cloudName: 'dxyz12abc',
  uploadPreset: 'hochzeit-gaeste',
  ordner: 'hochzeit-tamara-christopher'
},
```

Solange die beiden Felder leer sind, läuft die Seite im **Vorschau-Modus**:
Man kann alles ausprobieren, aber es wird nichts gespeichert (ein gelber
Hinweis sagt das auch).

## 3. Selbst gestalten

Alles in `hochzeit/config.js`:

| Feld | Wirkung |
|---|---|
| `name1`, `name2`, `datum` | Namen und Datum auf der Titelseite |
| `ort` | Ort unter dem Datum (leer = ausgeblendet) |
| `begruessung` | Satz unter dem Titel |
| `titelbild` | großes Foto hinter den Namen, z. B. `'bilder/titel.jpg'` |
| `fotos` | kleine Bildreihe, z. B. `['bilder/1.jpg', 'bilder/2.jpg']` |
| `gastCode` | optionaler Code, ohne den man nicht hochladen kann |

Fotos einfach in `hochzeit/bilder/` legen. Für das Titelbild reicht eine Breite
von etwa 2000 Pixeln (Querformat, Gesichter eher in der Mitte), sonst lädt die
Seite auf dem Handy unnötig lange. Farben und Schriften stehen oben in
`style.css`.

Nach einer Änderung an `style.css`, `app.js` oder `config.js` in `index.html`
die Zahl hinter `?v=` hochzählen, damit Handys die neue Fassung laden.

## 4. QR-Code für die Tische

Einen QR-Code auf die Adresse der Seite erstellen (jeder kostenlose
QR-Generator geht). Mit Gäste-Code die Adresse so eintragen, dann müssen die
Gäste nichts eintippen:

`https://marymayr.github.io/AuftragsbuchFotografie/hochzeit/?code=DEINCODE`

## 5. Nach der Hochzeit: Fotos an das Brautpaar

- Jeder Gast landet in einem eigenen Ordner:
  `hochzeit-tamara-christopher/anna-lukas/…`, ohne Namen unter `ohne-namen/`.
  Zusätzlich steht der Name bei jedem Bild unter *Metadata → gast*.
- In Cloudinary: **Media Library** → Ordner `hochzeit-tamara-christopher`
  öffnen → alles auswählen → **Download** (kommt als ZIP).
- Übergabe: Login an das Brautpaar weitergeben (E-Mail und Passwort ändern
  lassen) oder unter *Settings → Users* das Brautpaar als Nutzer einladen.
- Nach dem Download kann `uploadPreset` in `config.js` wieder geleert werden –
  dann sind keine weiteren Uploads mehr möglich.

## Hinweise

- **Sicherheit:** Wer die Adresse kennt, kann hochladen, aber nichts ansehen
  oder löschen. Der Gäste-Code ist eine Hürde gegen Zufallsbesucher, kein
  echter Schutz – er steht im Quelltext der Seite.
- **Zu große Fotos** (über 10 MB, z. B. 48-MP-Aufnahmen) verkleinert die Seite
  vor dem Hochladen selbst auf ein JPEG, das in die Grenze passt.
- **Videos über 100 MB** werden abgelehnt – die Seite sagt das beim Auswählen.
  Größere Videos werden in Teilstücken übertragen, damit ein kurzer
  WLAN-Aussetzer nicht alles abbricht.
- Die Seite sagt Suchmaschinen, dass sie nicht aufgenommen werden soll.
