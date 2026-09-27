/* Hochzeitsseite – Titel, Begrüßung und das Hochladen von Fotos und Videos
   zu Cloudinary. Alle Einstellungen stehen in config.js. */
(function () {
  'use strict';

  var C = window.HOCHZEIT || {};
  var CLOUD = C.cloudinary || {};
  var DEMO = !CLOUD.cloudName || !CLOUD.uploadPreset;
  var MB = 1024 * 1024;
  var MAX_BILD = (C.maxBildMB || 10) * MB;
  var MAX_VIDEO = (C.maxVideoMB || 100) * MB;
  var CHUNK = 6 * MB;          // Cloudinary verlangt mindestens 5 MB je Teilstück
  var GLEICHZEITIG = 2;        // mehr bringt im Hochzeits-WLAN meist nichts

  var $ = function (id) { return document.getElementById(id); };

  function speicher(key, wert) {
    try {
      if (wert === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, wert);
    } catch (e) { return null; }
  }

  /* ---------------- Titel & Texte ---------------- */

  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];
  var TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var zwei = function (n) { return (n < 10 ? '0' : '') + n; };

  function titel() {
    var n1 = C.name1 || 'Tamara', n2 = C.name2 || 'Christopher';
    $('n1').textContent = n1;
    $('n2').textContent = n2;
    $('f-names').textContent = n1 + ' & ' + n2;

    var p = String(C.datum || '2026-10-24').split('-').map(Number);
    var tag = new Date(p[0], p[1] - 1, p[2]);
    $('datum').textContent = zwei(p[2]) + ' · ' + zwei(p[1]) + ' · ' + p[0];
    $('datum-lang').textContent = TAGE[tag.getDay()] + ', ' + p[2] + '. ' + MONATE[p[1] - 1] + ' ' + p[0];
    $('f-date').textContent = zwei(p[2]) + '.' + zwei(p[1]) + '.' + p[0];
    document.title = n1 + ' & ' + n2 + ' · ' + zwei(p[2]) + '.' + zwei(p[1]) + '.' + p[0];

    var heute = new Date(); heute.setHours(0, 0, 0, 0);
    var rest = Math.round((tag - heute) / 864e5);
    var cd = $('countdown');
    cd.textContent = rest > 1 ? 'Noch ' + rest + ' Tage'
      : rest === 1 ? 'Morgen ist es so weit'
      : rest === 0 ? 'Heute ist der große Tag'
      : 'Danke, dass ihr dabei wart';
    cd.hidden = false;

    if (C.ort) { $('ort').textContent = C.ort; $('ort').hidden = false; }
    if (C.begruessung) $('begruessung').textContent = C.begruessung;
    else $('intro').querySelector('.begruessung').hidden = true;

    if (C.titelbild) {
      var hero = $('hero');
      hero.style.setProperty('--titelbild', 'url("' + encodeURI(C.titelbild) + '")');
      hero.classList.add('mit-bild');
    }

    if (C.fotos && C.fotos.length) {
      var reihe = $('fotoreihe');
      C.fotos.forEach(function (src) {
        var img = document.createElement('img');
        img.src = src; img.alt = ''; img.loading = 'lazy';
        reihe.appendChild(img);
      });
      reihe.hidden = false;
    }

    $('max-bild').textContent = C.maxBildMB || 10;
    $('max-video').textContent = C.maxVideoMB || 100;
  }

  /* ---------------- Gäste-Code ---------------- */

  function norm(s) { return String(s || '').trim().toUpperCase(); }

  function zugang() {
    $('demo-banner').hidden = !DEMO;
    if (!C.gastCode) return frei();

    var ausLink = new URLSearchParams(location.search).get('code');
    if (norm(ausLink) === norm(C.gastCode) || norm(speicher('hz-code')) === norm(C.gastCode)) {
      speicher('hz-code', C.gastCode);
      return frei();
    }
    $('code-form').hidden = false;
    $('code-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (norm($('code').value) === norm(C.gastCode)) {
        speicher('hz-code', C.gastCode);
        $('code-form').hidden = true;
        frei();
      } else {
        $('code-error').hidden = false;
      }
    });
  }

  function frei() {
    $('upload-card').hidden = false;
    var name = speicher('hz-name');
    if (name) $('gastname').value = name;
  }

  /* ---------------- Auswahl ---------------- */

  var liste = [];      // alle Dateien dieser Sitzung
  var laufend = 0;

  function initAuswahl() {
    var input = $('files'), drop = $('drop');
    $('pick').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      hinzufuegen(input.files);
      input.value = '';
    });
    $('gastname').addEventListener('change', function () {
      speicher('hz-name', $('gastname').value.trim());
    });

    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) hinzufuegen(e.dataTransfer.files);
    });

    $('retry').addEventListener('click', function () {
      liste.forEach(function (it) {
        if (it.status === 'fehler' && it.nochmal) { it.status = 'wartet'; zeige(it, 0, 'Wartet …'); }
      });
      weiter();
    });

    window.addEventListener('beforeunload', function (e) {
      if (laufend > 0 || liste.some(function (it) { return it.status === 'wartet'; })) {
        e.preventDefault(); e.returnValue = '';
      }
    });
  }

  function hinzufuegen(files) {
    speicher('hz-name', $('gastname').value.trim());
    Array.prototype.forEach.call(files, function (file) {
      var istVideo = /^video\//.test(file.type);
      var istBild = /^image\//.test(file.type) || /\.(heic|heif)$/i.test(file.name);
      var it = { file: file, video: istVideo, bild: istBild, status: 'wartet', name: $('gastname').value.trim() };
      it.li = zeile(it);
      liste.push(it);

      if (!istVideo && !istBild) return fehler(it, 'Nur Fotos und Videos möglich');
      if (istVideo && file.size > MAX_VIDEO) {
        return fehler(it, 'Video zu groß (' + mb(file.size) + ' MB, höchstens ' + (C.maxVideoMB || 100) + ' MB)');
      }
      zeige(it, 0, 'Wartet …');
    });
    weiter();
  }

  function mb(n) { return (n / MB).toFixed(n < 10 * MB ? 1 : 0).replace('.', ','); }

  function zeile(it) {
    var li = document.createElement('li');
    var th;
    if (it.bild && !/\.(heic|heif)$/i.test(it.file.name)) {
      th = document.createElement('img');
      th.src = URL.createObjectURL(it.file);
      th.onload = function () { URL.revokeObjectURL(th.src); };
      th.alt = '';
    } else {
      th = document.createElement('span');
      th.textContent = it.video ? 'VIDEO' : 'FOTO';
    }
    th.className = 'thumb';
    li.appendChild(th);
    var info = document.createElement('div');
    info.className = 'qinfo';
    info.innerHTML = '<div class="qname"></div><div class="qstatus"></div><div class="bar"><i></i></div>';
    info.querySelector('.qname').textContent = it.file.name;
    li.appendChild(info);
    $('queue').insertBefore(li, $('queue').firstChild);
    return li;
  }

  function zeige(it, anteil, text, klasse) {
    it.li.querySelector('.bar > i').style.width = Math.round(anteil * 100) + '%';
    var st = it.li.querySelector('.qstatus');
    st.textContent = text;
    st.className = 'qstatus' + (klasse ? ' ' + klasse : '');
    it.li.classList.toggle('done', klasse === 'ok');
    zusammenfassung();
  }

  function fehler(it, text) {
    it.status = 'fehler';
    zeige(it, 0, text, 'err');
  }

  function zusammenfassung() {
    var fertig = 0, fehl = 0, gesamt = liste.length;
    liste.forEach(function (it) {
      if (it.status === 'fertig') fertig++;
      if (it.status === 'fehler') fehl++;
    });
    var s = $('summary');
    s.hidden = gesamt === 0;
    var alleDurch = fertig + fehl === gesamt;
    if (alleDurch && fehl === 0) {
      s.textContent = fertig === 1 ? 'Danke! Euer Beitrag ist angekommen.' : 'Danke! Alle ' + fertig + ' Dateien sind angekommen.';
      s.className = 'summary fertig';
    } else {
      s.textContent = fertig + ' von ' + gesamt + ' hochgeladen' + (fehl ? ' · ' + fehl + ' fehlgeschlagen' : '');
      s.className = 'summary';
    }
    var nochmal = liste.some(function (it) {
      return it.status === 'fehler' && it.nochmal;
    });
    $('retry').hidden = !(alleDurch && nochmal);
  }

  /* ---------------- Warteschlange ---------------- */

  function weiter() {
    while (laufend < GLEICHZEITIG) {
      var it = liste.find(function (x) { return x.status === 'wartet'; });
      if (!it) break;
      starte(it);
    }
  }

  function starte(it) {
    it.status = 'laeuft';
    it.nochmal = false;
    laufend++;
    vorbereiten(it)
      .then(function (blob) {
        zeige(it, 0, 'Wird hochgeladen …');
        return DEMO ? vorspielen(it) : hochladen(it, blob);
      })
      .then(function () {
        it.status = 'fertig';
        zeige(it, 1, DEMO ? 'Fertig (Vorschau – nicht gespeichert)' : 'Angekommen ✓', 'ok');
      })
      .catch(function (err) {
        it.nochmal = err && err.nochmal !== false;
        fehler(it, (err && err.message) || 'Hochladen fehlgeschlagen');
      })
      .then(function () {
        laufend--;
        weiter();
      });
  }

  /* Fotos über der Grenze des kostenlosen Tarifs werden im Browser neu als
     JPEG gespeichert – in voller Auflösung, soweit der Browser es zulässt. */
  function vorbereiten(it) {
    if (!it.bild || it.file.size <= MAX_BILD) return Promise.resolve(it.file);
    zeige(it, 0, 'Foto wird verkleinert …');
    var ohneNeu = function () {
      var e = new Error('Foto zu groß (' + mb(it.file.size) + ' MB) und nicht verkleinerbar');
      e.nochmal = false;
      throw e;
    };
    if (!window.createImageBitmap) return Promise.resolve().then(ohneNeu);

    return createImageBitmap(it.file, { imageOrientation: 'from-image' }).then(function (bmp) {
      // iOS erlaubt Leinwände bis etwa 16 Megapixel
      var faktor = Math.min(1, Math.sqrt(16e6 / (bmp.width * bmp.height)));
      var versuche = [[faktor, 0.92], [faktor, 0.85], [faktor * 0.85, 0.85], [faktor * 0.7, 0.85]];
      var i = 0;
      var naechster = function () {
        if (i >= versuche.length) return ohneNeu();
        var v = versuche[i++];
        return jpeg(bmp, v[0], v[1]).then(function (blob) {
          return blob && blob.size <= MAX_BILD ? blob : naechster();
        });
      };
      return naechster();
    }, ohneNeu);
  }

  function jpeg(bmp, faktor, qualitaet) {
    var c = document.createElement('canvas');
    c.width = Math.round(bmp.width * faktor);
    c.height = Math.round(bmp.height * faktor);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', qualitaet); });
  }

  /* ---------------- Cloudinary ---------------- */

  function ordnerName(name) {
    var s = String(name || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return s || 'ohne-namen';
  }

  function kontext(wert) { return String(wert).replace(/([=|\\])/g, '\\$1'); }

  function hochladen(it, blob) {
    var art = it.video ? 'video' : 'image';
    var url = 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(CLOUD.cloudName) + '/' + art + '/upload';
    var basis = (CLOUD.ordner || 'hochzeit').replace(/\/+$/, '');
    var felder = {
      upload_preset: CLOUD.uploadPreset,
      folder: basis + '/' + ordnerName(it.name),
      tags: 'hochzeit',
      context: 'gast=' + kontext(it.name || 'ohne Namen') + '|datei=' + kontext(it.file.name)
    };
    var dateiname = blob === it.file ? it.file.name : it.file.name.replace(/\.[^.]+$/, '') + '.jpg';

    if (blob.size <= CHUNK * 3) {
      return senden(url, felder, blob, dateiname, null, function (p) { zeige(it, p, 'Wird hochgeladen … ' + Math.round(p * 100) + ' %'); });
    }

    // Große Videos in Teilstücken – bricht die Verbindung kurz ab, geht nur ein Stück verloren.
    var id = 'hz-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    var start = 0;
    var stueck = function () {
      var ende = Math.min(start + CHUNK, blob.size);
      var kopf = { 'X-Unique-Upload-Id': id, 'Content-Range': 'bytes ' + start + '-' + (ende - 1) + '/' + blob.size };
      var von = start;
      return wiederholen(function () {
        return senden(url, felder, blob.slice(von, ende), dateiname, kopf, function (p) {
          var gesamt = (von + p * (ende - von)) / blob.size;
          zeige(it, gesamt, 'Wird hochgeladen … ' + Math.round(gesamt * 100) + ' %');
        });
      }, 3).then(function (antwort) {
        start = ende;
        return start < blob.size ? stueck() : antwort;
      });
    };
    return stueck();
  }

  function wiederholen(fn, mal) {
    return fn().catch(function (err) {
      if (mal <= 1 || err.nochmal === false) throw err;
      return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return wiederholen(fn, mal - 1); });
    });
  }

  function senden(url, felder, blob, dateiname, kopf, fortschritt) {
    return new Promise(function (ok, nein) {
      var fd = new FormData();
      Object.keys(felder).forEach(function (k) { fd.append(k, felder[k]); });
      fd.append('file', blob, dateiname);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (kopf) Object.keys(kopf).forEach(function (k) { xhr.setRequestHeader(k, kopf[k]); });
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) fortschritt(e.loaded / e.total); };
      xhr.onload = function () {
        var antwort = null;
        try { antwort = JSON.parse(xhr.responseText); } catch (e) { /* leer */ }
        if (xhr.status >= 200 && xhr.status < 300) return ok(antwort);
        var text = antwort && antwort.error && antwort.error.message;
        var err = new Error(text ? 'Fehler: ' + text : 'Fehler ' + xhr.status + ' beim Hochladen');
        err.nochmal = xhr.status >= 500 || xhr.status === 0 || xhr.status === 429;
        nein(err);
      };
      xhr.onerror = function () { nein(new Error('Keine Verbindung – bitte später nochmal versuchen')); };
      xhr.send(fd);
    });
  }

  /* Vorschau-Modus: tut so, als würde hochgeladen. */
  function vorspielen(it) {
    return new Promise(function (ok) {
      var p = 0;
      var t = setInterval(function () {
        p = Math.min(1, p + 0.08 + Math.random() * 0.1);
        zeige(it, p, 'Wird hochgeladen … ' + Math.round(p * 100) + ' %');
        if (p >= 1) { clearInterval(t); ok(); }
      }, 180);
    });
  }

  titel();
  zugang();
  initAuswahl();
})();
