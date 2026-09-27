/* ------------------------------------------------------------------
   Einstellungen für die Hochzeitsseite.
   Nur diese Datei muss angepasst werden – alles andere liest von hier.
   ------------------------------------------------------------------ */
window.HOCHZEIT = {

  /* Das Brautpaar und der Tag */
  name1: 'Tamara',
  name2: 'Christopher',
  datum: '2026-10-24',          // Jahr-Monat-Tag
  ort: '',                      // z. B. 'Gut Sonnenhof, Salzburg' – leer = wird nicht angezeigt

  /* Begrüßung unter den Namen (leer = keine) */
  begruessung: 'Schön, dass ihr diesen Tag mit uns feiert.',

  /* Eigene Fotos: Dateien in den Ordner „bilder“ legen und hier eintragen.
     titelbild = großes Bild hinter den Namen (leer = heller Hintergrund)
     fotos     = kleine Bildreihe unter der Begrüßung (leer = keine)      */
  titelbild: '',                // z. B. 'bilder/titel.jpg'
  fotos: [],                    // z. B. ['bilder/1.jpg', 'bilder/2.jpg', 'bilder/3.jpg']

  /* Cloud-Speicher (Cloudinary). Solange die beiden Felder leer sind,
     läuft die Seite im Vorschau-Modus: Hochladen wird nur vorgespielt. */
  cloudinary: {
    cloudName: '',              // steht im Cloudinary-Dashboard oben links
    uploadPreset: '',           // Name des „unsigned“ Upload-Presets
    ordner: 'hochzeit-tamara-christopher'
  },

  /* Optionaler Gäste-Code. Leer = jeder mit dem Link darf hochladen.
     Mit Code: der QR-Code auf den Tischkarten enthält ihn schon,
     Gäste müssen dann nichts eintippen.                              */
  gastCode: '',

  /* Grenzen des kostenlosen Cloudinary-Tarifs (in MB) */
  maxBildMB: 10,
  maxVideoMB: 100
};
