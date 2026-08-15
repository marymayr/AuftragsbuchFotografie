# Auftragsbuch Fotografie

Ein passwortgeschütztes Auftragsbuch für Fotografie-Aufträge, das komplett im
Browser läuft. Kein Server, kein Konto, keine Cloud – alle Daten bleiben
verschlüsselt auf deinem Gerät. Monats-, Jahres- und Gesamtberichte lassen sich
jederzeit als PDF mit Diagrammen und Tabellen herausziehen.

---

## 1. Website aufrufen

### Variante A – über GitHub Pages (empfohlen, von überall erreichbar)

Einmalig einrichten:

1. Auf GitHub das Repository **`marymayr/AuftragsbuchFotografie`** öffnen.
2. Oben auf **Settings** klicken.
3. Links im Menü auf **Pages**.
4. Bei *Source* **„Deploy from a branch"** wählen.
5. Bei *Branch* den Branch mit diesem Code wählen, Ordner **`/ (root)`**,
   dann **Save**.
6. Nach ein bis zwei Minuten erscheint oben die Adresse:

   ```
   https://marymayr.github.io/AuftragsbuchFotografie/
   ```

Diese Adresse als Lesezeichen speichern – auf dem Handy über *Teilen → Zum
Home-Bildschirm* legen, dann verhält sie sich wie eine App.

### Variante B – lokal, ganz ohne Internet

1. Im Repository auf **Code → Download ZIP**.
2. ZIP entpacken.
3. `index.html` doppelklicken.

Funktioniert offline. Nachteil: Die Daten hängen an genau diesem Ordner auf
genau diesem Rechner.

### ⚠️ Das Wichtigste zum Speicherort

Die Daten liegen im Speicher **des Browsers, unter der Adresse, über die du die
Seite geöffnet hast**. Daraus folgt:

- Immer **denselben Weg** benutzen. Wer heute über GitHub Pages und morgen über
  die lokale Datei arbeitet, sieht zwei verschiedene, leere Auftragsbücher.
- Ein anderer Browser oder ein anderes Gerät = ein anderes Auftragsbuch.
- Über ein JSON-Backup (Abschnitt 5) lassen sich die Daten auf ein anderes
  Gerät übertragen.
- **Nicht** im privaten Modus / Inkognito arbeiten – dort wird beim Schließen
  alles verworfen.

---

## 2. Erster Start: Passwort festlegen

Beim ersten Aufruf fragt die Seite nach einem neuen Passwort (mindestens 8
Zeichen). Daraus wird der Schlüssel abgeleitet, mit dem alle Aufträge
verschlüsselt werden.

Optional lässt sich eine **Erinnerungshilfe** hinterlegen. Sie wird
unverschlüsselt gespeichert und auf dem Sperrbildschirm angezeigt – also einen
Hinweis wählen, der nur für dich Sinn ergibt.

> **Es gibt keine Passwort-Wiederherstellung.** Ohne das Passwort sind die Daten
> nicht mehr lesbar – auch nicht für mich, für GitHub oder für sonst jemanden.
> Notiere es an einem sicheren Ort.

Ab dann fragt jeder Aufruf nur noch nach dem Passwort. Nach 20 Minuten ohne
Aktivität sperrt sich das Buch von selbst, ebenso über den Knopf **Sperren**.

---

## 3. Aufträge erfassen

**+ Neuer Auftrag** oben rechts (oder die Taste `N` drücken).

| Feld | Wofür |
|---|---|
| Kunde / Auftraggeber * | Pflichtfeld |
| Datum * | Pflichtfeld, bestimmt den Berichtsmonat |
| Von / Bis | Uhrzeit des Termins |
| Auftragsart | Hochzeit, Portrait, Familie, Business, Event, Produkt, Immobilien, Tiere, Sonstiges |
| Ort, Telefon, E-Mail | Kontakt- und Ortsangaben |
| Honorar | Vereinbarter Betrag |
| Anzahlung | Bereits erhaltener Teilbetrag |
| Ausgaben | Auslagen für diesen Auftrag (Fahrt, Material, Assistenz …) |
| Zahlungsstatus | Offen · Teilzahlung · Bezahlt |
| Auftragsstatus | Anfrage · Bestätigt · Durchgeführt · Abgeschlossen · Storniert |
| Rechnungsnr., Notizen | Freitext |

Ein Klick auf eine Zeile in der Auftragsliste öffnet den Auftrag zum Bearbeiten.

**Rechenregeln:**
- Stornierte Aufträge zählen nirgends zum Umsatz.
- *Bezahlt* rechnet das volle Honorar als beglichen, *Teilzahlung* die
  Anzahlung, *Offen* nichts.
- *Ergebnis* = Honorar − Ausgaben.

---

## 4. Die vier Reiter

**Übersicht** — Kennzahlen des laufenden Monats und Jahres, Umsatzverlauf über
die zwölf Monate, die nächsten anstehenden Termine und alle offenen Zahlungen.

**Aufträge** — die vollständige Liste. Freitextsuche über Kunde, Ort, Notiz,
Rechnungsnummer und Kontaktdaten; Filter nach Jahr, Monat, Art, Status und
Zahlung; Sortierung per Klick auf eine Spaltenüberschrift. Über der Tabelle
stehen laufend die Summen der gerade angezeigten Auswahl.

**Auswertung** — Kennzahlen und Diagramme für ein einzelnes Jahr oder den
gesamten Bestand: Umsatzverlauf, Umsatz nach Auftragsart, Aufträge nach Status.

**Backup & Verwaltung** — Berichte, Datensicherung, Papierkorb, Passwort,
Löschen.

---

## 5. PDF-Backup mit Diagrammen

Reiter **Backup & Verwaltung → PDF-Bericht erstellen**:

1. **Umfang** wählen: *Einzelner Monat*, *Ganzes Jahr* oder *Alles
   (Gesamtarchiv)*.
2. Jahr und ggf. Monat einstellen.
3. **Bericht anzeigen** – die fertige Seite erscheint als Vorschau.
4. **Drucken / als PDF sichern** anklicken.
5. Im Druckdialog als Drucker **„Als PDF sichern"** bzw. *Microsoft Print to
   PDF* wählen und speichern.

Der Bericht enthält:

- Kopfzeile mit Zeitraum, Erstellungsdatum und Anzahl der Datensätze
- sechs Kennzahlen: Aufträge, Honorar, davon bezahlt, offen, Ausgaben, Ergebnis
- ein Säulendiagramm (Honorar pro Tag / pro Monat / pro Jahr, je nach Umfang)
- ein Balkendiagramm plus Tabelle mit der Verteilung nach Auftragsart inkl.
  Prozentanteilen
- die vollständige Auftragstabelle des Zeitraums mit Summenzeile

Empfehlung: am Monatsende einmal den Monatsbericht sichern. So wächst ein
lückenloses PDF-Archiv, unabhängig von der Anwendung.

### Die drei Sicherungsarten

| Format | Zweck | Zurückspielbar |
|---|---|---|
| **PDF** | Ansehen, archivieren, ausdrucken, weitergeben | nein |
| **JSON** | Vollständige Datensicherung inkl. Papierkorb | **ja** |
| **CSV** | Weiterrechnen in Excel / Numbers / LibreOffice | nein |

**Ein PDF allein ist kein Datenbackup.** Für den Ernstfall zusätzlich
regelmäßig das **JSON-Backup** herunterladen. Erscheint auf der Übersicht ein
gelber Hinweis, liegt die letzte Sicherung mehr als 30 Tage zurück.

**Backup einspielen …** liest eine JSON-Datei wieder ein. Dabei wird
ausschließlich **ergänzt**: neue Aufträge kommen hinzu, neuere Fassungen
vorhandener Aufträge werden aktualisiert – bestehende Einträge gehen nie
verloren. Vor dem Übernehmen zeigt eine Rückfrage, was genau passieren wird.
So lässt sich das Auftragsbuch auch auf ein zweites Gerät umziehen.

---

## 6. Löschen – nichts verschwindet von selbst

Es gibt keine automatische Bereinigung, kein Ablaufdatum, keine Obergrenze.
Gelöscht wird ausschließlich, wenn du es ausdrücklich anstößt:

**Einzelner Auftrag** → Auftrag öffnen → *In den Papierkorb*. Er verschwindet
aus Listen und Auswertungen, bleibt aber vollständig erhalten. Unter
**Backup & Verwaltung → Papierkorb** lässt er sich jederzeit
**wiederherstellen** oder gezielt **endgültig löschen** (mit Rückfrage).

**Alles löschen** → Reiter **Backup & Verwaltung**, roter Bereich ganz unten.
Dieser Weg ist bewusst dreifach gesichert:

1. Häkchen setzen, dass ein Backup vorliegt.
2. Wörtlich `ALLES LÖSCHEN` eintippen – erst dann wird der Knopf aktiv.
3. Eine **zweite, separate Sicherheitsabfrage** bestätigen.

Erst danach werden Aufträge, Papierkorb und Passwort vom Gerät entfernt. Bricht
man die zweite Abfrage ab, bleibt alles unangetastet.

---

## 7. Wie sicher ist das?

**Was das Passwort leistet:** Alle Daten liegen mit **AES-GCM (256 Bit)**
verschlüsselt im Browser-Speicher. Der Schlüssel wird per **PBKDF2-SHA-256 mit
250.000 Runden** aus dem Passwort abgeleitet und nirgends gespeichert – er
existiert nur, solange das Buch entsperrt ist. Wer den Rechner in die Hand
bekommt oder den Browser-Speicher ausliest, sieht ohne Passwort nur
Zeichensalat.

**Was es nicht leistet:** Es schützt nicht gegen Schadsoftware auf dem Gerät
selbst und ersetzt keine Festplattenverschlüsselung. Und: **Ein
JSON-Backup ist unverschlüsselt** – gut lesbar zum Wiederherstellen, aber
entsprechend sorgsam abzulegen (verschlüsselter Ordner, Passwort-Manager,
verschlüsselter USB-Stick).

Nichts wird übertragen: Die Anwendung stellt keine einzige Netzwerkanfrage,
lädt keine externen Schriften oder Bibliotheken und enthält keinerlei Tracking.

---

## 8. Technisches

Drei Dateien, keine Abhängigkeiten, kein Build-Schritt:

```
index.html   Aufbau der Seite
app.css      Gestaltung inkl. Druck-Layout (A4) für die Berichte
app.js       Logik, Verschlüsselung, Diagramme, Berichte
```

Die Diagramme sind handgeschriebenes SVG – deshalb sind sie im PDF gestochen
scharf und funktionieren ohne jede Bibliothek. Die Farbgebung folgt einer auf
Farbfehlsichtigkeit geprüften Palette: Diagramme verwenden durchgängig **eine**
Serienfarbe, Statusfarben stehen nie allein, sondern immer neben ihrer
Beschriftung.

Voraussetzung ist ein aktueller Browser (Chrome, Edge, Firefox oder Safari) mit
aktiviertem lokalem Speicher.

### Tastaturkürzel

Wirksam, solange der Fokus nicht in einem Eingabefeld steht:

| Kürzel | Wirkung |
|---|---|
| `N` | Neuer Auftrag |
| `/` | Zur Auftragsliste springen und in die Suche schreiben |
| `Esc` | Dialog schließen bzw. Berichtsvorschau verlassen |
