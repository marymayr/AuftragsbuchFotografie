# Auftragsbuch · Aufträge & Arbeitszeit

Zwei Bücher in einer App, beide nach **Monaten und Jahren** gegliedert:

- **Aufträge** – eigene Aufträge mit Kunde, Auftragsart, Ort, Kontakt, Honorar,
  Anzahlung, Ausgaben, Rechnungsnummer und Auftragsstatus.
- **Martin** – Arbeitszeit der Anstellung mit Stundensatz, Fahrzeit und Fahrtgeld.

Läuft vollständig im Browser: kein Server, kein Konto, keine Cloud. Alle Daten
liegen verschlüsselt auf dem Gerät. Monats-, Jahres- und Gesamtberichte lassen
sich jederzeit als PDF herausziehen.

---

## 1. Aufrufen

### Über GitHub Pages (empfohlen)

Einmalig einrichten:

1. Repository **`marymayr/AuftragsbuchFotografie`** öffnen → **Settings**.
2. Links im Menü **Pages**.
3. *Source*: „Deploy from a branch", *Branch*: der Branch mit diesem Code,
   Ordner **`/ (root)`** → **Save**.
4. Nach ein bis zwei Minuten erscheint die Adresse:
   `https://marymayr.github.io/AuftragsbuchFotografie/`

Auf dem iPhone über *Teilen → Zum Home-Bildschirm* legen. Dann startet sie wie
eine App, mit der kleinen Kamera als Symbol, und funktioniert auch **offline**.

### ⚠️ Ein Speicherort, ein Auftragsbuch

Die Daten liegen im Speicher des Browsers, **gebunden an die Adresse**, über die
du die Seite geöffnet hast. Daraus folgt:

- Immer denselben Weg benutzen. Über GitHub Pages und zusätzlich als lokale
  Datei zu arbeiten ergibt zwei getrennte Auftragsbücher.
- Anderes Gerät oder anderer Browser = anderes Auftragsbuch.
- Zum Umziehen dient die Sicherung (Abschnitt 7).
- Nicht im privaten Modus arbeiten – dort wird beim Schließen alles verworfen.

### Daten aus einer bisherigen Fassung

Läuft die App **an derselben Adresse** wie zuvor, werden vorhandene Einträge
beim ersten Start automatisch übernommen und verschlüsselt. Danach erscheint ein
Hinweis, dass die alte, unverschlüsselte Kopie noch im Speicher liegt – mit
einem Knopf, um sie zu entfernen.

Bei einem **Adresswechsel** geht es über die Sicherung: in der alten App
*Sicherung* öffnen, Text kopieren; in der neuen *Sicherung → Text einfügen*
→ **Übernehmen**. Alte Formate werden erkannt.

---

## 2. Passwort

Beim ersten Start vergibst du ein Passwort (mindestens 8 Zeichen). Daraus wird
per **PBKDF2-SHA-256 mit 250.000 Runden** ein Schlüssel abgeleitet, mit dem alle
Daten **AES-GCM-256-verschlüsselt** im Browser liegen. Der Schlüssel wird
nirgends gespeichert – er existiert nur, solange das Buch entsperrt ist.

> **Es gibt keine Wiederherstellung.** Ohne das Passwort sind die Daten nicht
> mehr lesbar. Notiere es an einem sicheren Ort. Optional lässt sich eine
> Erinnerungshilfe hinterlegen; sie wird unverschlüsselt gespeichert, also einen
> Hinweis wählen, der nur für dich Sinn ergibt.

Nach 20 Minuten ohne Aktivität sperrt sich das Buch selbst, ebenso über
*Sperren* auf der Startseite. Passwort wechseln unter *Sätze & Einstellungen*.

---

## 3. Gliederung nach Monaten und Jahren

In beiden Bereichen sitzt oben eine Umschaltung **Monat / Jahr**, darunter die
Jahreszahlen und – in der Monatsansicht – die zwölf Monate. Die kleine Zahl an
einem Monat sagt, wie viele Einträge darin liegen.

**Monatsansicht** zeigt alle Einträge des Monats, darunter die Summenzeile,
den Abrechnen-Knopf und die letzten sechs Monate als Diagramm.

**Jahresansicht** zeigt die Kennzahlen des Jahres, darunter alle zwölf Monate
mit Betrag und offenem Rest. Ein Tipp auf einen Monat springt hinein. Dazu ein
Säulendiagramm über das Jahr und – bei den Aufträgen – die Verteilung nach
Auftragsart.

Auf der Startseite steht je Bereich eine **Monats- und eine Jahreszeile**.

### Suche

Das ⌕ oben rechts durchsucht **alle Monate und Jahre** des Bereichs nach Kunde,
Name, Ort, Notiz, Rechnungsnummer und Kontaktdaten. Bei den Aufträgen kommen
Filter nach Auftragsart und Status dazu.

---

## 4. Aufträge erfassen

**+ Auftrag** unten.

| Feld | Wofür |
|---|---|
| Kunde / Auftraggeber | Pflichtfeld, mit Vorschlägen aus bisherigen Kunden |
| Auftragsart | Hochzeit, Portrait, Familie, Business, Event, Produkt, Immobilien, Tiere, Sonstiges |
| Auftragsstatus | Anfrage · Bestätigt · Durchgeführt · Abgeschlossen · **Storniert** |
| Datum, Zeit | Zeit nur nötig, wenn nach Stundensatz abgerechnet wird |
| Abrechnung | **Festbetrag** oder **Stundensatz** |
| Anzahlung | Bereits erhaltener Teilbetrag |
| Ausgaben | Auslagen für diesen Auftrag |
| Ort, Telefon, E-Mail, Rechnungsnr., Fotos, Notiz | Freitext |

**Rechenregeln:**
- Stornierte Aufträge zählen **nirgends** mit – nicht im Honorar, nicht im
  Offen, nicht in den Diagrammen. Sie bleiben sichtbar und durchgestrichen.
- Offen = Honorar − Anzahlung. Ist die Anzahlung so hoch wie das Honorar, gilt
  der Auftrag als bezahlt.
- Ergebnis = Honorar − Ausgaben.

---

## 5. Arbeitszeit für Martin

**+ Eintrag** unten. Drei Zeilenarten:

| Zeile | Bedeutung |
|---|---|
| **Regulär** | Normale Arbeitszeit, voll bezahlt |
| **Fahrzeit** | Zählt nur anteilig (Vorgabe 50 %) |
| **Kilometer** | Fahrtgeld statt Zeit: 0,20 € je km ab 20 km |

Dazu Art (*Fotografisch* / *Ausschank*), Datum, Beginn und Ende oder Dauer,
*Was*, *Name / Hochzeitspaar*, Anzahl Fotos und Notiz. Während der Eingabe zeigt
ein Feld laufend Zeit, bezahlte Zeit, Betrag, den angewandten Satz und die Fotos
pro Stunde.

### Stundensätze mit Gültigkeitsdatum

Sätze gelten **ab einem Monat**, und jeder Eintrag wird mit dem Satz gerechnet,
der **an seinem Datum** galt. Ein neuer Satz ändert alte Einträge also nicht
rückwirkend. Voreingestellt sind die Zeiträume aus dem Blatt „Stundenlohn":

| gültig ab | Fotografisch | Ausschank |
|---|---|---|
| Mai 2025 | 17,50 € | 17,50 € |
| Juni 2025 | 17,50 € | 15,50 € |
| Oktober 2025 | 20,00 € | 15,50 € |
| Juni 2026 | 23,00 € | 15,50 € |

**Bitte einmal prüfen** – die Werte stammen aus dem Screenshot des Blattes.
Unter *Sätze & Einstellungen* lassen sie sich ändern, Zeiträume ergänzen oder
entfernen. Ebenso dort: Fahrtgeld pro km, Freigrenze, der Prozentsatz für
Fahrzeit und der Standard-Stundensatz für eigene Aufträge.

---

## 6. Abrechnen

Ein Tipp auf das **Kästchen links** rechnet eine einzelne Zeile ab, **Monat
abrechnen** den ganzen Monat. Erfasst werden Sollbetrag, tatsächlich erhaltener
Betrag, Zahlungsart, Datum und eine Notiz (etwa *„75 € Rest aus Juli mit
verrechnet"*). Weicht der Betrag ab, wird die Differenz in der Monatsansicht und
im Bericht ausgewiesen.

---

## 7. PDF-Bericht und Sicherung

### PDF

*Bericht & PDF* (Startseite oder das ▤ in der Bereichsansicht):

1. **Bereich**: Aufträge, Martin oder beide.
2. **Umfang**: einzelner Monat, ganzes Jahr oder alles.
3. **Bericht anzeigen** → Vorschau.
4. **Drucken / als PDF sichern** → im Druckdialog „Als PDF sichern".

Der Bericht kommt im Querformat A4 mit Kopfzeile, sechs Kennzahlen je Bereich,
einem Säulendiagramm (Betrag pro Tag / Monat / Jahr), einem Balkendiagramm der
Verteilung, der vollständigen Tabelle mit Summenzeile, den Abrechnungen des
Zeitraums und den angewandten Sätzen. Bei „beide Bereiche" bekommt jeder Bereich
seinen eigenen Block.

Die Martin-Tabelle hat die Spalten des bisherigen Blattes: *Art, Fahrzeit /
regulär, Datum, Beginn, Ende, Zeit, gefahrene KM, bezahlte Zeit, Satz, Betrag,
Was, Name Hochzeitspaar, Kommentar.*

Empfehlung: am Monatsende einmal den Monatsbericht sichern. So wächst ein
lückenloses PDF-Archiv, unabhängig von der App.

### Datensicherung

| Format | Zweck | Zurückspielbar |
|---|---|---|
| **PDF** | Ansehen, archivieren, ausdrucken | nein |
| **JSON** (Datei oder Text) | vollständige Sicherung inkl. Papierkorb | **ja** |
| **CSV** | Weiterrechnen in Excel / Numbers | nein |

**Ein PDF ist kein Datenbackup.** Zieh daneben regelmäßig die JSON-Sicherung.
Liegt die letzte mehr als 30 Tage zurück, erinnert die Startseite daran.

Beim Einspielen wird **nur ergänzt**: neue Einträge kommen hinzu, neuere
Fassungen vorhandener werden aktualisiert – bestehende gehen nie verloren. Vor
dem Übernehmen zeigt eine Rückfrage, was genau passiert.

---

## 8. Löschen – nichts verschwindet von selbst

Es gibt keine automatische Bereinigung und kein Ablaufdatum.

**Einzelner Eintrag** → öffnen → *Papierkorb*. Er verschwindet aus Listen,
Summen und Berichten, bleibt aber vollständig erhalten. Unter *Sätze &
Einstellungen → Papierkorb* lässt er sich **wiederherstellen** oder gezielt
**endgültig löschen** (mit Rückfrage).

**Alles löschen** → *Sätze & Einstellungen*, roter Punkt. Dreifach gesichert:

1. Häkchen setzen, dass eine Sicherung vorliegt.
2. Wörtlich `ALLES LÖSCHEN` eintippen – erst dann wird der Knopf aktiv.
3. Eine **zweite, separate Sicherheitsabfrage** bestätigen.

Bricht man die zweite Abfrage ab, bleibt alles unangetastet.

---

## 9. Wie sicher ist das?

Alle Daten liegen AES-GCM-256-verschlüsselt im Browser-Speicher; ohne Passwort
steht dort nur Zeichensalat. Die App stellt keine einzige Netzwerkanfrage, lädt
keine externen Schriften oder Bibliotheken und enthält kein Tracking.

Nicht geschützt ist damit gegen Schadsoftware auf dem Gerät selbst; eine
Festplattenverschlüsselung ersetzt es nicht. Und: **die JSON-Sicherung ist
unverschlüsselt** – gut lesbar zum Wiederherstellen, aber sorgsam abzulegen.

---

## 10. Technisches

```
index.html   Gerüst der Seite
app.css      Gestaltung inkl. Druck-Layout (A4 quer) für die Berichte
app.js       Logik, Verschlüsselung, Berechnung, Diagramme, Berichte
manifest.json / sw.js / icon-*.png   für Installation und Offline-Betrieb
```

Keine Abhängigkeiten, kein Build-Schritt. Die Diagramme sind handgeschriebenes
SVG und deshalb im PDF gestochen scharf.

**Rechenregeln Martin** (geprüft gegen das Blatt „Arbeitszeiten – Martin",
Juli 2026 – alle zehn Zeilen ergeben auf den Cent dieselben Beträge):

```
Regulär     bezahlte Zeit = Zeit                    Betrag = bezahlte Zeit × Satz
Fahrzeit    bezahlte Zeit = Zeit × 50 %             Betrag = bezahlte Zeit × Satz
Kilometer   bezahlte Zeit = 0                       Betrag = (km − 20) × 0,20 €
```

Gerechnet wird immer mit der exakten Zeit, nicht mit der auf zwei Stellen
gerundeten Anzeige.

Der Auftrags-Bereich heißt intern weiterhin `self`, damit ältere Sicherungen
unverändert passen.

Nach einer Änderung an den Dateien die Version in `sw.js` (`CACHE`) hochzählen,
damit installierte Geräte die neue Fassung laden.
