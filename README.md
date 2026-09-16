# Auftragsbuch · Aufträge, Arbeitszeit & Ausgaben

Drei Bücher in einer App, alle nach **Monaten und Jahren** gegliedert und auf
der Startseite in zwei Gruppen sortiert:

**Selbstständigkeit**
- **Einnahmen** – eigene Aufträge mit Kunde, Auftragsart, Ort, Kontakt, Honorar,
  Anzahlung, Rechnungsnummer, Auftragsstatus und der Übermittlung der Fotos.
- **Rechnungen** – Rechnungen schreiben, selbst nummerieren und als PDF sichern,
  mit allen Pflichtangaben und dem Hinweis nach § 19 UStG.
- **Betriebsausgaben** – Anschaffungen und Kosten, von der Gewerbeanmeldung bis
  zum Objektiv, dazu die **laufenden Kosten**, die jeden Monat von selbst
  gebucht werden.

**Anstellung**
- **Martin Slováček** – Arbeitszeiten mit Stundensatz, Fahrzeit und Fahrtgeld.

Auf breiten Bildschirmen steht die Selbstständigkeit links und die Anstellung
rechts; auf dem Handy stapeln sich die Gruppen untereinander.

Läuft vollständig im Browser: kein Server, kein Konto, keine Cloud. Alle Daten
liegen verschlüsselt auf dem Gerät. Monats-, Jahres- und Gesamtberichte lassen
sich jederzeit als PDF herausziehen, ebenso die **Steuerübersicht** mit der
Einnahmen-Überschuss-Rechnung für die Einkommensteuer.

**Beträge werden auf den Cent genau erfasst.** In jedes Geldfeld darfst du
`5,49` oder `5.49` schreiben, auch `1.234,56` – die App versteht beides und
rechnet mit vollen Cent.

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

## 4. Einnahmen erfassen

**+ Auftrag** unten.

| Feld | Wofür |
|---|---|
| Kunde / Auftraggeber | Pflichtfeld, mit Vorschlägen aus bisherigen Kunden |
| Auftragsart | Hochzeit, Portrait, Familie, Business, Event, Produkt, Immobilien, Tiere, Sonstiges |
| Auftragsstatus | Anfrage · Bestätigt · Durchgeführt · Abgeschlossen · **Storniert** |
| Datum, Zeit | Zeit nur nötig, wenn nach Stundensatz abgerechnet wird |
| Abrechnung | **Festbetrag** oder **Stundensatz** |
| Anzahlung | Bereits erhaltener Teilbetrag |
| Übermittlung der Fotos | noch nicht übergeben · Dropbox · USB-Stick · Sonstiges |
| Ort, Telefon, E-Mail, Rechnungsnr., Fotos, Notiz | Freitext |

Die Übermittlung steht als Marke direkt in der Auftragszeile. Solange ein
Auftrag auf *„noch nicht übergeben"* steht, siehst du auf einen Blick, wo die
Fotos noch rausmüssen.

**Rechenregeln:**
- Stornierte Aufträge zählen **nirgends** mit – nicht im Honorar, nicht im
  Offen, nicht in den Diagrammen. Sie bleiben sichtbar und durchgestrichen.
- Offen = Honorar − Anzahlung. Ist die Anzahlung so hoch wie das Honorar, gilt
  der Auftrag als bezahlt.
- Ausgaben werden **nicht** mehr je Auftrag erfasst – dafür gibt es den eigenen
  Bereich *Betriebsausgaben*.

Im geöffneten Auftrag steht **„Rechnung zu diesem Auftrag schreiben"**. Kunde,
Leistung, Honorar und Anzahlung sind dann schon eingetragen, und die vergebene
Rechnungsnummer landet anschließend von selbst im Feld *Rechnungsnr.* des
Auftrags. Speichere Änderungen am Auftrag vorher – der Wechsel zur Rechnung
übernimmt den gespeicherten Stand.

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

## 5b. Betriebsausgaben

**+ Ausgabe** im dritten Bereich. Für alles, was die Selbstständigkeit kostet:

| Feld | Wofür |
|---|---|
| Was wurde gekauft / bezahlt | Pflichtfeld, z. B. „Sigma 35 mm f/1.4" |
| Kategorie | Gewerbe & Behörden · Kamera & Objektive · Blitz & Licht · Speicher & Festplatten · Stativ & Zubehör · Akkus & Strom · Software & Abos · Versicherung · Weiterbildung · Werbung & Web · Büro & Porto · Fahrtkosten · Sonstiges |
| Betrag | Pflichtfeld |
| Zahlungsart | Bankkarte · Bar · Überweisung · PayPal · Rechnung · Sonstiges |
| Händler / Anbieter | mit Vorschlägen aus bisherigen Einkäufen |
| Beleg / Rechnung vorhanden | Schalter |
| Notiz | Seriennummer, Verwendungszweck, Garantie … |

Die Jahresansicht zeigt Summe, Durchschnitt, größten Posten und – wichtig für
die Steuer – wie viel noch **ohne Beleg** dasteht. Der Bericht hat dafür einen
eigenen Abschnitt *„Belege nachreichen"*.

Betriebsausgaben werden nicht abgerechnet; statt des Häkchens steht dort ein €-Zeichen.

---

## 5c. Laufende Kosten

Für alles, was jeden Monat von selbst abgeht: Software-Abos, Cloud-Speicher,
Versicherung. Einmal hinterlegt, bucht die App den Posten in **jedem fälligen
Monat** selbst in die Betriebsausgaben.

Zu erreichen über *Startseite → Laufende Kosten*, über *Sätze & Einstellungen*
oder unten in der Ausgabenansicht.

| Feld | Wofür |
|---|---|
| Wofür | Pflichtfeld, z. B. „Adobe Lightroom" |
| Betrag | Pflichtfeld, z. B. `5,49` |
| Rhythmus | monatlich · vierteljährlich · halbjährlich · jährlich |
| Erster Monat | ab wann gebucht wird |
| Letzter Monat | optional, z. B. nach der Kündigung |
| Am wievielten | 1 bis 28 – diesen Tag gibt es in jedem Monat |
| Kategorie, Zahlungsart, Anbieter, Beleg, Notiz | wie bei einer einzelnen Ausgabe |

**Beispiel:** Lightroom, 5,49 €, monatlich, ab Januar 2026 → im September 2026
stehen neun Posten in den Betriebsausgaben, zusammen 49,41 €, und in der
Übersicht 65,88 € im Jahr.

**So verhält es sich:**

- Gebucht wird nur **bis zum laufenden Monat**. Die Zukunft bleibt offen –
  es steht nie eine Ausgabe im Buch, die noch gar nicht angefallen ist.
- Fehlende Monate werden bei jedem Start nachgetragen; die Startseite meldet,
  wie viele es waren.
- Jeder erzeugte Posten hat eine **feste Kennung**. Deshalb entsteht nichts
  doppelt – auch nicht nach dem Einspielen einer Sicherung. In der Liste tragen
  diese Posten die Marke *„laufende Kosten"*.
- Ein gebuchter Posten ist ein ganz normaler Eintrag: Du kannst ihn öffnen,
  den Betrag ändern oder ihn in den Papierkorb legen. Aus dem Papierkorb wird
  er **nicht** erneut gebucht.
- Änderst du den Betrag der Kostenstelle, gilt der neue Preis für die **nächsten**
  Buchungen. Bereits gebuchte Monate bleiben, wie sie waren – sie sind ja
  tatsächlich so abgegangen.
- **Pause** hält die Buchungen an, **Ende** entfernt die Kostenstelle. Beides
  lässt die bereits gebuchten Posten unangetastet.

---

## 6. Abrechnen

Ein Tipp auf das **Kästchen links** rechnet eine einzelne Zeile ab, **Monat
abrechnen** den ganzen Monat. Erfasst werden Sollbetrag, tatsächlich erhaltener
Betrag, Zahlungsart, Datum und eine Notiz (etwa *„75 € Rest aus Juli mit
verrechnet"*). Weicht der Betrag ab, wird die Differenz in der Monatsansicht und
im Bericht ausgewiesen.

---

## 6b. Rechnungen schreiben

Über die Karte **Rechnungen** auf der Startseite oder aus einem Auftrag heraus.

### Einmalig: die eigenen Angaben

Zahnrad in der Rechnungsansicht → **Meine Rechnungsangaben**. Hier stehen Name,
Anschrift, Steuernummer, Kontakt und Bankverbindung; sie erscheinen auf jeder
Rechnung. Fehlt etwas davon, warnt die App in der Liste und im Formular –
ohne diese Angaben ist eine Rechnung nicht vorschriftsmäßig.

Dort stehen auch die Vorgaben für neue Rechnungen: Zahlungsziel, Anrede,
Einleitung und Schlusssatz. Jede einzelne Rechnung darf davon abweichen.

### Die Rechnungsnummer

Du vergibst sie **selbst**. Das Feld ist beim Anlegen mit einem Vorschlag
gefüllt – die zuletzt angelegte Nummer um eins weitergezählt, beim ersten Mal
`2026-001`. Du kannst sie beliebig überschreiben; eine bereits vergebene Nummer
weist die App ab. Gespeichert wird sie mit der Rechnung, ohne weiteres Zutun.

### Pflichtangaben

Unter dem Formular steht laufend, was zu einer vollständigen Rechnung nach
§ 14 UStG noch fehlt:

| Pflichtangabe | Woher |
|---|---|
| Vollständiger Name und Anschrift des Ausstellers | *Meine Rechnungsangaben* |
| Name und Anschrift des Empfängers | Abschnitt *Rechnung an* |
| Steuernummer oder USt-IdNr. | *Meine Rechnungsangaben* |
| Ausstellungsdatum | Rechnungsdatum |
| Fortlaufende, einmalige Rechnungsnummer | Rechnungsnummer |
| Menge und Art der Leistung | Positionen |
| Zeitpunkt der Leistung | *Leistung erbracht am* (bei einem Zeitraum auch *bis*) |
| Entgelt | Summe der Positionen |
| Grund der Steuerbefreiung | Hinweis nach § 19 UStG |

Bei der Kleinunternehmerregelung entfallen Steuersatz und Steuerbetrag. An ihre
Stelle tritt der Satz, der bei angehaktem Schalter auf jede Rechnung gedruckt
wird:

> Gemäß § 19 UStG (Kleinunternehmerregelung) wird keine Umsatzsteuer berechnet.

### Positionen

Jede Position hat Beschreibung, Menge, Einheit (Std, Stk, Pauschale …) und
Einzelpreis. Menge und Preis dürfen Nachkommastellen haben – `6,5 Std × 45,50 €`
ergibt 295,75 €. Eine bereits gezahlte **Anzahlung** wird unten abgezogen, auf
der Rechnung steht dann *„Noch zu zahlen"*.

### Status und PDF

**Entwurf · Gestellt · Bezahlt · Storniert.** Das Kästchen links in der Liste
setzt eine Rechnung auf *Bezahlt* und zurück. Eine gestellte Rechnung, die nicht
mehr gilt, wird **storniert statt gelöscht** – so bleibt die Nummernfolge
lückenlos. Ist das Zahlungsziel überschritten, steht *überfällig* an der Zeile.

Das **▤** rechts in der Zeile (oder *Vorschau* im Formular) öffnet den fertigen
Bogen. Von dort *Drucken / als PDF sichern* – die Rechnung wird **A4 hoch**
gedruckt, die Berichte weiterhin quer.

---

## 6c. Steuerübersicht für die Einkommensteuer

*Startseite → Steuern & EÜR* oder *Bericht & PDF → Steuerübersicht für ein Jahr*.

Ein Jahresbogen, der zusammenstellt, was für die Steuererklärung gebraucht wird:

- **Einnahmen-Überschuss-Rechnung**: Betriebseinnahmen, Betriebsausgaben, Gewinn.
- **Wohin die Zahlen gehören**: Anlage EÜR, Anlage S bzw. G, Anlage N. Genannt
  wird der Abschnitt, nicht die Zeilennummer – die ändert sich jedes Jahr.
- **Kleinunternehmerregelung**: der vereinnahmte Umsatz des Vorjahres und des
  laufenden Jahres gegen die Grenzen nach § 19 UStG, mit Urteil im Klartext.
  Die Grenzen (Stand 2025: 25.000 € / 100.000 €) stehen in *Meine
  Rechnungsangaben* und lassen sich nachziehen, wenn der Gesetzgeber sie ändert.
- **Betriebsausgaben nach Kategorie**, als Tabelle mit Anteilen und als Diagramm.
- **Jeder einzelne Zufluss** und **jede einzelne Ausgabe** des Jahres, zum
  Abgleich mit dem Kontoauszug. Bei den Ausgaben steht dabei, ob sie einzeln
  erfasst oder aus den laufenden Kosten gebucht wurden.
- **Rechnungen des Jahres** mit Status und offenen Beträgen.
- **Was noch zu tun ist**: fehlende Belege, offene Forderungen, überfällige
  Rechnungen, fehlende Zahlungsdaten.

### Zufluss oder Leistung

Für die Einnahmen-Überschuss-Rechnung gilt das **Zuflussprinzip**: eine Einnahme
zählt in dem Jahr, in dem das Geld da war. Genau so rechnet die Übersicht in der
Voreinstellung.

- Eine **Anzahlung** zählt zum Datum des Auftrags – ein eigenes Datum wird dafür
  nicht erfasst.
- Ein **abgerechneter Auftrag** zählt zum Zahlungsdatum aus der Abrechnung.
  Fehlt es, nimmt die App ersatzweise das Auftragsdatum und **weist die Summe
  gesondert aus**. Wenn es auf den Monat ankommt, trage das Zahlungsdatum beim
  Abrechnen nach.
- **Ausgaben** sind ohnehin mit ihrem Zahlungsdatum erfasst.

Zum Vergleich lässt sich auf *nach Leistungsdatum* umstellen; die jeweils andere
Summe steht immer als Hinweis daneben.

Die Zahlen gibt es zusätzlich als **CSV** – zum Weiterreichen an die
Steuerberatung.

**Das ist keine Steuerberatung.** Die Übersicht fasst zusammen, was in diesem
Auftragsbuch steht. Ob ein Posten abziehbar ist und in welchem Jahr er zählt,
entscheidet der Einzelfall.

---

## 7. PDF-Bericht und Sicherung

### PDF

*Bericht & PDF* (Startseite oder das ▤ in der Bereichsansicht):

1. **Bereich**: Selbstständigkeit, Anstellung, Betriebsausgaben, alle – oder
   die **Steuerübersicht für ein Jahr** (Abschnitt 6c).
2. **Umfang**: einzelner Monat, ganzes Jahr oder alles.
3. **Bericht anzeigen** → Vorschau.
4. **Drucken / als PDF sichern** → im Druckdialog „Als PDF sichern".

Rechnungen laufen über den eigenen Bereich *Rechnungen* (Abschnitt 6b) und
drucken **hochkant**; alles andere quer.

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

### Arbeitszeiten aus der Excel-Liste

Die **69 Zeilen für Martin seit Juni 2025** übernimmt die App beim ersten
Öffnen **von selbst** aus `daten/martin-arbeitszeit.json` – das ist die aus
`Martin_Arbeitszeit.xlsx` erzeugte Sicherung, samt der neun Zahlungsvermerke
der einzelnen Blätter. Ein grüner Hinweis meldet, wie viele Zeilen dazukamen.

Das passiert genau einmal: Der Stand wird in den Einstellungen vermerkt
(`xlStand`). Danach wird nur noch ergänzt, was noch fehlt – bereits vorhandene
und in den Papierkorb gelegte Zeilen bleiben unangetastet.

Unter *Sicherung* gibt es zusätzlich den Knopf **„Excel-Zeiten einspielen"**,
falls man es von Hand anstoßen will. Beides funktioniert nur, wenn die Seite
über eine Web-Adresse geöffnet ist (GitHub Pages), nicht als lokale Datei.

Was beim Einlesen auffiel, steht in Abschnitt 11.

### Datensicherung

| Format | Zweck | Zurückspielbar |
|---|---|---|
| **PDF** | Ansehen, archivieren, ausdrucken | nein |
| **JSON** (Datei oder Text) | vollständige Sicherung inkl. Papierkorb, Rechnungen und laufender Kosten | **ja** |
| **CSV** | Weiterrechnen in Excel / Numbers | nein |
| **CSV Rechnungen** | das Rechnungsbuch als Tabelle | nein |
| **CSV Steuer** | die Zahlen der Steuerübersicht | nein |

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
**endgültig löschen** (mit Rückfrage). Rechnungen liegen im selben Papierkorb
und lassen sich von dort zurückholen.

Zwei Sonderfälle nennt die App beim Löschen selbst:

- Ein Posten aus den **laufenden Kosten** wird nach dem *endgültigen* Löschen
  beim nächsten Start erneut gebucht – im Papierkorb bliebe er dagegen draußen.
- Eine bereits gestellte **Rechnung** gehört storniert, nicht gelöscht; sonst
  reißt die Nummernfolge.

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
Seit den Rechnungen stehen darin auch **Namen und Anschriften deiner Kunden**.
Leg die Sicherungen entsprechend ab und schick sie nicht ungeschützt herum.

---

## 10. Technisches

```
index.html   Gerüst der Seite
app.css      Gestaltung inkl. Druck-Layout: Berichte A4 quer, Rechnungen A4 hoch
app.js       Logik, Verschlüsselung, Berechnung, Diagramme, Berichte, Rechnungen
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

**Beträge und Eingabe.** Geldfelder sind Textfelder mit Dezimal-Tastatur, keine
`<input type="number">`. Ein Zahlenfeld erklärt `5,49` nämlich für ungültig und
liefert dann einen **leeren** Wert – genau daran scheiterten bisher die Cent.
Gelesen werden `5,49`, `5.49`, `1.234,56` und `1 234,56`; entscheidend ist das
zuletzt stehende Trennzeichen. Jeder eingegebene Betrag wird auf volle Cent
gerundet, damit sich keine Reste wie `5,490000000000001` durchs Rechnen ziehen.

**Gespeichert wird** (Sicherungsformat `schema: 5`):

```
entries      Einträge aller drei Bereiche
payments     Abrechnungen
rechnungen   Rechnungen mit Positionen und Kundenanschrift
abos         laufende Kosten
settings     Sätze, Firmenangaben, Grenzen nach § 19 UStG
```

Ältere Sicherungen (`schema: 4` und davor) passen unverändert hinein; die neuen
Listen sind dort schlicht leer. Beim Einspielen werden auch Rechnungen und
laufende Kosten nur **ergänzt**, neuere Fassungen gewinnen.

Ein von den laufenden Kosten gebuchter Posten trägt die Kennung
`abo-<Kostenstelle>-<Monat>`. Weil sie sich aus Kostenstelle und Monat ergibt,
kann derselbe Monat nie zweimal entstehen.

Der Bereich „Selbstständigkeit" heißt intern weiterhin `self`, damit ältere
Sicherungen unverändert passen.

Der laufende Monat und das laufende Jahr richten sich immer nach dem Datum des
Geräts – im Juli steht Juli, im August August. Nichts davon ist fest hinterlegt.

---

## 11. Was beim Einlesen der Excel-Liste aufgefallen ist

Die App rechnet jede Zeile mit dem Satz, der an ihrem Datum galt. Dabei sind
**12 von 69 Zeilen** aufgefallen, die im Blatt anders gerechnet waren –
zusammen **+94,67 €** zu deinen Gunsten:

| Ursache | Zeilen | Summe |
|---|---|---|
| Juni 2026 mit 17,50 € bzw. 20 € statt 23 € gerechnet | 9 | **+118,29 €** |
| September 2025 mit 20 € statt 17,50 € gerechnet | 2 | −8,13 € |
| Ausschank Oberdolling 25.07.2025: 17:00–00:40 ergibt 7:40, das Blatt rechnet 8:40 | 1 | −15,50 € |

Beim letzten Punkt ist vermutlich die Endzeit vertippt (01:40 statt 00:40) –
das lässt sich im Eintrag mit zwei Tipps korrigieren.

Außerdem korrigiert: im Blatt „Mai Juni 2026" stand bei einer Zeile das Datum
**2025**-05-26 zwischen lauter 2026er Zeilen; sie wurde als **2026**-05-26
übernommen.

**Zahlungen:** Alles **vor dem 25.07.2026 gilt als beglichen** – je Monat eine
Abrechnung über den vollen Betrag. Maßgeblich ist der Summenbetrag, nicht die
im Blatt notierten Teilzahlungen; deren Wortlaut steht als Notiz an der
jeweiligen Abrechnung.

**Offen sind die 10 Zeilen ab dem 25.07.2026** – zusammen **469,57 €**, also
genau der Summenbetrag des Blattes „August 2026":

| Datum | Zeilen | Betrag |
|---|---:|---:|
| 25.07.2026 | 3 | 92,25 € |
| 26.07.2026 | 1 | 49,83 € |
| 31.07.2026 | 4 | 260,40 € |
| 06.08.2026 | 1 | 42,17 € |
| 11.08.2026 | 1 | 24,92 € |

Damit gilt auch die oben genannte Juni-2026-Differenz von 118,29 € als bezahlt.
Wer sie gegenüber Martin geltend machen will, nimmt bei den betroffenen Zeilen
das Häkchen wieder heraus – dann erscheinen sie erneut als offen.

### Aktualisierungen

Der Service Worker holt Programmdateien **zuerst aus dem Netz** und nutzt den
Zwischenspeicher nur als Rückfall, wenn gerade keine Verbindung besteht. Eine
neue Fassung ist damit schon beim nächsten Öffnen da. (Umgekehrt – erst Cache,
dann Netz – bekäme man nach jeder Änderung noch einmal die alte Fassung zu
sehen.) Symbole kommen weiterhin aus dem Zwischenspeicher, die ändern sich nicht.

Unter *Sätze & Einstellungen* stehen ganz unten die laufende **Fassung** und der
Knopf **„Auf neue Fassung prüfen"**. Er leert den Offline-Zwischenspeicher und
lädt neu; die Einträge im verschlüsselten Speicher bleiben unangetastet.

**Nach jeder Änderung drei Stellen hochzählen:**

1. `?v=` an `app.css` und `app.js` in `index.html`
2. dieselben `?v=`-Adressen in der `ASSETS`-Liste von `sw.js`, dazu `CACHE`
3. `APP_VERSION` in `app.js`

Der Versionsstempel in der Adresse ist der entscheidende Teil: `app.js?v=12` ist
für jeden Zwischenspeicher eine **neue Adresse** und kann nicht mit einer alten
Fassung beantwortet werden – auch nicht von einem noch installierten älteren
Service Worker. Ohne ihn genügt „netzwerk-zuerst“ nicht, weil `fetch()` sonst
aus dem HTTP-Zwischenspeicher des Browsers bedient werden darf; GitHub Pages
setzt darauf zehn Minuten Gültigkeit.
