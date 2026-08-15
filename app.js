/* ============================================================================
   Auftragsbuch Fotografie
   ---------------------------------------------------------------------------
   Reine Browser-Anwendung ohne Server und ohne externe Bibliotheken.
   Alle Daten liegen AES-GCM-verschlüsselt im localStorage dieses Browsers.
   Der Schlüssel wird per PBKDF2 aus dem Passwort abgeleitet und nie gespeichert.
   ========================================================================== */
'use strict';

/* ─────────────────────────  Konstanten  ───────────────────────── */

const LS = { meta: 'abf.meta', data: 'abf.data' };
const PBKDF2_ITER = 250000;
const AUTO_LOCK_MS = 20 * 60 * 1000;      // Sperre nach 20 Minuten Untätigkeit
const SCHEMA = 1;

const ARTEN   = ['Hochzeit', 'Portrait', 'Familie', 'Business', 'Event',
                 'Produkt', 'Immobilien', 'Tiere', 'Sonstiges'];
const STATUS  = ['Anfrage', 'Bestätigt', 'Durchgeführt', 'Abgeschlossen', 'Storniert'];
const ZAHLUNG = ['Offen', 'Teilzahlung', 'Bezahlt'];

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MON_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const STATUS_DOT = {
  'Anfrage': 'dot-muted', 'Bestätigt': 'dot-series', 'Durchgeführt': 'dot-warning',
  'Abgeschlossen': 'dot-good', 'Storniert': 'dot-critical'
};
const ZAHLUNG_DOT = { 'Offen': 'dot-critical', 'Teilzahlung': 'dot-warning', 'Bezahlt': 'dot-good' };

/* ─────────────────────────  Hilfsfunktionen  ───────────────────────── */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const TE = new TextEncoder();
const TD = new TextDecoder();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nfEUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const nfEUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur  = (n) => nfEUR.format(Number(n) || 0);
const eur0 = (n) => nfEUR0.format(Number(n) || 0);
const num  = (n) => new Intl.NumberFormat('de-DE').format(Number(n) || 0);

function fmtDate(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function fmtDateLong(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}. ${MONATE[Number(m) - 1]} ${y}`;
}
function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowStamp() {
  const d = new Date();
  return `${fmtDate(todayISO(d))} um ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;
}
function daysBetween(isoA, isoB) {
  return Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
}
function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ─────────────────────────  Krypto & Speicher  ───────────────────────── */

let cryptoKey = null;   // CryptoKey, nur im Arbeitsspeicher
let db = null;          // entschlüsselte Datenbank

function readMeta() {
  try { return JSON.parse(localStorage.getItem(LS.meta) || 'null'); }
  catch { return null; }
}

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', TE.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptDb(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, TE.encode(JSON.stringify(obj)));
  return JSON.stringify({ iv: b64(iv), ct: b64(ct) });
}

async function decryptDb(raw, key) {
  const { iv, ct } = JSON.parse(raw);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(TD.decode(plain));
}

/** Schreibt den aktuellen Stand verschlüsselt in den localStorage. */
async function persist() {
  db.geaendert = new Date().toISOString();
  try {
    localStorage.setItem(LS.data, await encryptDb(db, cryptoKey));
  } catch (err) {
    alert('Die Daten konnten nicht gespeichert werden: ' + err.message +
          '\n\nBitte lade sofort ein JSON-Backup herunter (Reiter „Backup & Verwaltung“).');
    throw err;
  }
}

function emptyDb() {
  return {
    schema: SCHEMA,
    erstellt: new Date().toISOString(),
    geaendert: new Date().toISOString(),
    letztesBackup: null,
    auftraege: []
  };
}

/** Ergänzt fehlende Felder – macht Importe alter/fremder Backups robust. */
function normalizeJob(j) {
  return {
    id: j.id || uid(),
    datum: j.datum || todayISO(),
    zeitVon: j.zeitVon || '',
    zeitBis: j.zeitBis || '',
    kunde: j.kunde || '',
    telefon: j.telefon || '',
    email: j.email || '',
    art: ARTEN.includes(j.art) ? j.art : 'Sonstiges',
    ort: j.ort || '',
    honorar: Number(j.honorar) || 0,
    anzahlung: Number(j.anzahlung) || 0,
    ausgaben: Number(j.ausgaben) || 0,
    zahlung: ZAHLUNG.includes(j.zahlung) ? j.zahlung : 'Offen',
    status: STATUS.includes(j.status) ? j.status : 'Anfrage',
    rechnung: j.rechnung || '',
    notizen: j.notizen || '',
    geloescht: !!j.geloescht,
    erstellt: j.erstellt || new Date().toISOString(),
    bearbeitet: j.bearbeitet || j.erstellt || new Date().toISOString()
  };
}

function normalizeDb(raw) {
  const d = Object.assign(emptyDb(), raw || {});
  d.schema = SCHEMA;
  d.auftraege = (Array.isArray(raw?.auftraege) ? raw.auftraege : []).map(normalizeJob);
  return d;
}

/* ─────────────────────────  Abgeleitete Werte  ───────────────────────── */

const aktiv    = () => db.auftraege.filter((j) => !j.geloescht);
const imPapier = () => db.auftraege.filter((j) => j.geloescht);

/** Storno zählt nicht zum Umsatz. */
const zaehlt = (j) => j.status !== 'Storniert';

function bezahltBetrag(j) {
  if (j.zahlung === 'Bezahlt') return j.honorar;
  if (j.zahlung === 'Teilzahlung') return Math.min(j.anzahlung, j.honorar);
  return 0;
}
function offenBetrag(j) {
  return zaehlt(j) ? Math.max(0, j.honorar - bezahltBetrag(j)) : 0;
}

function summen(list) {
  const rel = list.filter(zaehlt);
  const honorar  = rel.reduce((s, j) => s + j.honorar, 0);
  const bezahlt  = rel.reduce((s, j) => s + bezahltBetrag(j), 0);
  const ausgaben = rel.reduce((s, j) => s + j.ausgaben, 0);
  return {
    anzahl: list.length,
    anzahlAktiv: rel.length,
    storniert: list.length - rel.length,
    honorar, bezahlt, ausgaben,
    offen: Math.max(0, honorar - bezahlt),
    ergebnis: honorar - ausgaben
  };
}

function inMonat(j, y, m) { return j.datum.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`); }
function inJahr(j, y)     { return j.datum.startsWith(String(y)); }

function jahreImBestand() {
  const set = new Set(aktiv().map((j) => j.datum.slice(0, 4)).filter(Boolean));
  set.add(String(new Date().getFullYear()));
  return Array.from(set).sort().reverse();
}

/* ─────────────────────────  Diagramme (SVG)  ───────────────────────── */

const VB_W = 760;

function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

/** Balken mit abgerundetem Datenende, eckig an der Grundlinie. */
function colBarPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} `
       + `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}
function rowBarPath(x, y, w, h, r) {
  r = Math.min(r, h / 2, w);
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} `
       + `L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

function chartEmpty(text) {
  return `<p class="chart-empty">${esc(text || 'Für diesen Zeitraum liegen keine Daten vor.')}</p>`;
}

/**
 * Säulendiagramm, eine Serie.
 * items: [{ label, value, tip }]
 */
function columnChart(items, opts = {}) {
  if (!items.length || items.every((i) => !i.value)) return chartEmpty(opts.emptyText);

  const W = opts.width || VB_W;
  const H = opts.height || 250;
  const padL = 62, padR = 12, padT = 14, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = niceMax(Math.max(...items.map((i) => i.value)));
  const band = plotW / items.length;
  const barW = Math.max(3, Math.min(24, band - 2));   // 2px Luft zwischen Nachbarn
  const y = (v) => padT + plotH - (v / max) * plotH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const grid = ticks.map((t) => `
    <line x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"
          stroke="${t === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>
    <text x="${padL - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end"
          font-size="10.5" fill="var(--text-muted)"
          style="font-variant-numeric:tabular-nums">${esc(opts.tickFmt ? opts.tickFmt(t) : eur0(t))}</text>`).join('');

  // Nur so viele Achsenbeschriftungen setzen, wie nebeneinander Platz haben.
  const labelPx = Math.max(...items.map((i) => String(i.label).length)) * 6 + 6;
  const every = Math.max(1, Math.ceil(labelPx / band));
  const bars = items.map((it, i) => {
    const cx = padL + i * band + band / 2;
    const h = it.value > 0 ? Math.max(2, plotH - (y(it.value) - padT)) : 0;
    const showLabel = i % every === 0;
    return `
      ${h > 0 ? `<path class="bar" d="${colBarPath(cx - barW / 2, y(it.value), barW, h, 4)}" fill="var(--series-1)">
        <title>${esc(it.tip || `${it.label}: ${eur(it.value)}`)}</title></path>` : ''}
      ${showLabel ? `<text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle"
        font-size="10.5" fill="var(--text-muted)">${esc(it.label)}</text>` : ''}`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
     aria-label="${esc(opts.aria || 'Säulendiagramm')}">${grid}${bars}</svg>`;
}

/**
 * Breite der viewBox an den Container koppeln, damit Beschriftungen beim
 * Skalieren ihre echte Größe behalten. Versteckte Container liefern 0 –
 * dann greift der Rückfallwert, und beim Anzeigen wird neu gezeichnet.
 */
function containerWidth(sel, fallback) {
  const w = $(sel)?.clientWidth || 0;
  return w > 120 ? Math.round(w) : fallback;
}

/**
 * Liegende Balken mit direktem Wertlabel – Identität kommt aus dem Text,
 * nicht aus der Farbe, deshalb genügt eine Serienfarbe.
 */
function rowChart(items, opts = {}) {
  const rows = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (!rows.length) return chartEmpty(opts.emptyText);

  // Schmale Container (z. B. die zweispaltige Berichtsseite) bekommen eine
  // kleinere viewBox, damit die Schrift beim Skalieren lesbar bleibt.
  const W = opts.width || VB_W;
  const rowH = 30, barH = 14, padT = 6;
  const fmt = opts.valueFmt || eur;
  const max = Math.max(...rows.map((r) => r.value));

  // Spaltenbreiten aus den echten Texten ableiten (≈6.6px pro Zeichen bei 12px),
  // damit weder Beschriftung noch Wert am Rand abgeschnitten wird.
  const CH = 6.6;
  const valW = Math.ceil(Math.max(...rows.map((r) => fmt(r.value).length)) * CH) + 12;
  const labelW = Math.min(
    Math.ceil(Math.max(...rows.map((r) => r.label.length)) * CH),
    Math.round(W * 0.3)
  );
  const H = rows.length * rowH + padT * 2;
  const plotX = labelW + 10;
  const plotW = Math.max(30, W - plotX - valW);

  const body = rows.map((r, i) => {
    const y = padT + i * rowH + (rowH - barH) / 2;
    const w = Math.max(2, (r.value / max) * plotW);
    const maxChars = Math.max(8, Math.round(labelW / 6.6));
    const label = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '…' : r.label;
    return `
      <text x="0" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="12"
            fill="var(--text-secondary)">${esc(label)}</text>
      <path class="bar" d="${rowBarPath(plotX, y, w, barH, 4)}" fill="var(--series-1)">
        <title>${esc(`${r.label}: ${fmt(r.value)}${r.tip ? ' · ' + r.tip : ''}`)}</title></path>
      <text x="${(plotX + w + 8).toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="12"
            fill="var(--text-primary)" style="font-variant-numeric:tabular-nums"
            font-weight="500">${esc(fmt(r.value))}</text>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
     aria-label="${esc(opts.aria || 'Balkendiagramm')}">${body}</svg>`;
}

/* ─────────────────────────  Kacheln & Listen  ───────────────────────── */

function tile(label, value, note, noteClass) {
  return `<div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${esc(value)}</div>
    ${note ? `<div class="tile-note ${noteClass || ''}">${esc(note)}</div>` : ''}
  </div>`;
}

function badge(text, dotClass) {
  return `<span class="badge"><span class="dot ${dotClass}"></span>${esc(text)}</span>`;
}

/* ─────────────────────────  Ansicht: Übersicht  ───────────────────────── */

function renderUebersicht() {
  const heute = new Date();
  const y = heute.getFullYear(), m = heute.getMonth();
  const alle = aktiv();

  $('#ov-monthname').textContent = `· ${MONATE[m]} ${y}`;
  $('#ov-yearname').textContent = `· ${y}`;
  $('#ov-chart-year').textContent = `· ${y}`;

  const sM = summen(alle.filter((j) => inMonat(j, y, m)));
  const sJ = summen(alle.filter((j) => inJahr(j, y)));

  $('#ov-tiles-month').innerHTML =
    tile('Aufträge', num(sM.anzahlAktiv), sM.storniert ? `+ ${sM.storniert} storniert` : '') +
    tile('Honorar', eur(sM.honorar)) +
    tile('Davon bezahlt', eur(sM.bezahlt), sM.honorar ? `${Math.round(sM.bezahlt / sM.honorar * 100)} % beglichen` : '') +
    tile('Noch offen', eur(sM.offen), sM.offen > 0 ? 'ausstehend' : 'alles bezahlt', sM.offen > 0 ? 'bad' : 'good');

  $('#ov-tiles-year').innerHTML =
    tile('Aufträge', num(sJ.anzahlAktiv)) +
    tile('Honorar', eur(sJ.honorar)) +
    tile('Ausgaben', eur(sJ.ausgaben)) +
    tile('Ergebnis', eur(sJ.ergebnis), 'Honorar minus Ausgaben', sJ.ergebnis >= 0 ? 'good' : 'bad');

  // Umsatz pro Monat im laufenden Jahr
  const proMonat = MON_KURZ.map((lbl, i) => {
    const v = alle.filter((j) => inMonat(j, y, i) && zaehlt(j)).reduce((s, j) => s + j.honorar, 0);
    return { label: lbl, value: v, tip: `${MONATE[i]} ${y}: ${eur(v)}` };
  });
  $('#ov-chart').innerHTML = columnChart(proMonat, {
    width: containerWidth('#ov-chart', 540), height: 230,
    aria: `Honorar pro Monat im Jahr ${y}`,
    emptyText: `Für ${y} sind noch keine Honorare erfasst.`
  });

  // Nächste Termine
  const heuteISO = todayISO(heute);
  const kommend = alle
    .filter((j) => j.datum >= heuteISO && j.status !== 'Storniert')
    .sort((a, b) => a.datum.localeCompare(b.datum) || a.zeitVon.localeCompare(b.zeitVon))
    .slice(0, 8);
  $('#ov-upcoming').innerHTML = kommend.length
    ? `<div class="minilist">${kommend.map((j) => {
        const d = daysBetween(heuteISO, j.datum);
        const rel = d === 0 ? 'heute' : d === 1 ? 'morgen' : `in ${d} Tagen`;
        return `<div class="minirow" data-open="${j.id}" role="button" tabindex="0">
          <span class="minirow-main">
            <span class="minirow-title">${esc(j.kunde || 'Ohne Namen')}</span>
            <span class="minirow-sub"> · ${esc(j.art)}${j.ort ? ' · ' + esc(j.ort) : ''}</span>
          </span>
          <span class="nowrap">${fmtDate(j.datum)} <span class="minirow-sub">(${rel})</span></span>
        </div>`;
      }).join('')}</div>`
    : '<p class="empty">Keine anstehenden Termine.</p>';

  // Offene Zahlungen
  const offen = alle.filter((j) => offenBetrag(j) > 0)
    .sort((a, b) => a.datum.localeCompare(b.datum));
  const offenSum = offen.reduce((s, j) => s + offenBetrag(j), 0);
  $('#ov-open').innerHTML = offen.length
    ? `<div class="minilist">${offen.slice(0, 12).map((j) => `
        <div class="minirow" data-open="${j.id}" role="button" tabindex="0">
          <span class="minirow-main">
            <span class="minirow-title">${esc(j.kunde || 'Ohne Namen')}</span>
            <span class="minirow-sub"> · ${fmtDate(j.datum)}${j.rechnung ? ' · Rg. ' + esc(j.rechnung) : ''}</span>
          </span>
          <span class="nowrap num strong">${eur(offenBetrag(j))} ${badge(j.zahlung, ZAHLUNG_DOT[j.zahlung])}</span>
        </div>`).join('')}
       </div>
       <p class="hint">Gesamt offen: <strong>${eur(offenSum)}</strong>${offen.length > 12 ? ` · ${offen.length - 12} weitere in der Auftragsliste` : ''}</p>`
    : '<p class="empty">Alles bezahlt – nichts offen.</p>';

  renderBackupReminder();
}

function renderBackupReminder() {
  const el = $('#backup-reminder');
  const last = db.letztesBackup;
  const tage = last ? daysBetween(last.slice(0, 10), todayISO()) : null;
  if (!aktiv().length) { el.innerHTML = ''; return; }
  if (last && tage < 30) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="reminder">
    <span>${last
      ? `Deine letzte Datensicherung ist ${tage} Tage alt.`
      : 'Du hast noch keine Datensicherung heruntergeladen.'}
      Ein JSON-Backup schützt dich, falls dieser Browser einmal Daten verliert.</span>
    <button class="btn" data-goto="backup">Zum Backup</button>
  </div>`;
}

/* ─────────────────────────  Ansicht: Aufträge  ───────────────────────── */

const filter = { suche: '', jahr: '', monat: '', art: '', status: '', zahlung: '' };
let sortKey = 'datum', sortDir = -1;

function fillSelect(sel, values, allLabel) {
  const cur = sel.value;
  sel.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') +
    values.map((v) => `<option value="${esc(v.value ?? v)}">${esc(v.label ?? v)}</option>`).join('');
  if (cur && Array.from(sel.options).some((o) => o.value === cur)) sel.value = cur;
}

function refreshFilterOptions() {
  fillSelect($('#f-jahr'), jahreImBestand(), 'Alle Jahre');
  fillSelect($('#f-monat'), MONATE.map((m, i) => ({ value: String(i), label: m })), 'Alle Monate');
  fillSelect($('#f-art'), ARTEN, 'Alle Arten');
  fillSelect($('#f-status'), STATUS, 'Alle Status');
  fillSelect($('#f-zahlung'), ZAHLUNG, 'Alle Zahlungen');
}

function gefiltert() {
  const q = filter.suche.trim().toLowerCase();
  return aktiv().filter((j) => {
    if (filter.jahr && !j.datum.startsWith(filter.jahr)) return false;
    if (filter.monat !== '' && j.datum.slice(5, 7) !== String(Number(filter.monat) + 1).padStart(2, '0')) return false;
    if (filter.art && j.art !== filter.art) return false;
    if (filter.status && j.status !== filter.status) return false;
    if (filter.zahlung && j.zahlung !== filter.zahlung) return false;
    if (q) {
      const hay = [j.kunde, j.ort, j.notizen, j.rechnung, j.email, j.telefon, j.art, j.status]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderAuftraege() {
  const list = gefiltert().sort((a, b) => {
    let r;
    if (sortKey === 'honorar') r = a.honorar - b.honorar;
    else r = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), 'de');
    return r * sortDir || a.datum.localeCompare(b.datum) * -1;
  });

  const s = summen(list);
  $('#list-meta').innerHTML =
    `<span><strong>${num(list.length)}</strong> Aufträge angezeigt</span>
     <span>Honorar <strong>${eur(s.honorar)}</strong></span>
     <span>Bezahlt <strong>${eur(s.bezahlt)}</strong></span>
     <span>Offen <strong>${eur(s.offen)}</strong></span>
     <span>Ausgaben <strong>${eur(s.ausgaben)}</strong></span>`;

  const th = (key, label, cls) =>
    `<th class="sortable ${cls || ''}" data-sort="${key}">${label}${sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</th>`;

  $('#table-auftraege').innerHTML = `
    <thead><tr>
      ${th('datum', 'Datum')}${th('kunde', 'Kunde')}${th('art', 'Art')}${th('ort', 'Ort')}
      ${th('status', 'Status')}${th('zahlung', 'Zahlung')}${th('honorar', 'Honorar', 'num')}
      <th class="num">Offen</th>
    </tr></thead>
    <tbody>${list.length ? list.map((j) => `
      <tr data-open="${j.id}" tabindex="0">
        <td class="nowrap">${fmtDate(j.datum)}${j.zeitVon ? `<br><span class="minirow-sub">${esc(j.zeitVon)}${j.zeitBis ? '–' + esc(j.zeitBis) : ''}</span>` : ''}</td>
        <td class="strong">${esc(j.kunde || '–')}${j.rechnung ? `<br><span class="minirow-sub">Rg. ${esc(j.rechnung)}</span>` : ''}</td>
        <td>${esc(j.art)}</td>
        <td>${esc(j.ort || '–')}</td>
        <td>${badge(j.status, STATUS_DOT[j.status])}</td>
        <td>${badge(j.zahlung, ZAHLUNG_DOT[j.zahlung])}</td>
        <td class="num">${eur(j.honorar)}</td>
        <td class="num">${offenBetrag(j) > 0 ? eur(offenBetrag(j)) : '–'}</td>
      </tr>`).join('')
      : `<tr><td colspan="8" class="empty">Keine Aufträge gefunden. Passe die Filter an oder lege einen neuen Auftrag an.</td></tr>`}
    </tbody>`;
}

/* ─────────────────────────  Ansicht: Auswertung  ───────────────────────── */

function auswertungScope() {
  const v = $('#a-zeitraum').value;
  if (v === 'alles') return { typ: 'alles' };
  return { typ: 'jahr', jahr: v };
}

function refreshAuswertungOptions() {
  const sel = $('#a-zeitraum');
  const cur = sel.value;
  sel.innerHTML = jahreImBestand().map((y) => `<option value="${y}">Jahr ${y}</option>`).join('')
    + '<option value="alles">Gesamter Bestand</option>';
  if (cur && Array.from(sel.options).some((o) => o.value === cur)) sel.value = cur;
}

function renderAuswertung() {
  const scope = auswertungScope();
  const alle = aktiv();
  const list = scope.typ === 'alles' ? alle : alle.filter((j) => inJahr(j, scope.jahr));
  const s = summen(list);

  $('#aw-tiles').innerHTML =
    tile('Aufträge', num(s.anzahlAktiv), s.storniert ? `+ ${s.storniert} storniert` : '') +
    tile('Honorar', eur(s.honorar)) +
    tile('Bezahlt', eur(s.bezahlt)) +
    tile('Offen', eur(s.offen), s.offen > 0 ? 'ausstehend' : 'alles bezahlt', s.offen > 0 ? 'bad' : 'good') +
    tile('Ausgaben', eur(s.ausgaben)) +
    tile('Ergebnis', eur(s.ergebnis), 'Honorar minus Ausgaben', s.ergebnis >= 0 ? 'good' : 'bad');

  // Zeitverlauf
  let verlauf, sub;
  if (scope.typ === 'jahr') {
    sub = `· Monate ${scope.jahr}`;
    verlauf = MON_KURZ.map((lbl, i) => {
      const v = list.filter((j) => inMonat(j, scope.jahr, i) && zaehlt(j)).reduce((a, j) => a + j.honorar, 0);
      return { label: lbl, value: v, tip: `${MONATE[i]} ${scope.jahr}: ${eur(v)}` };
    });
  } else {
    const jahre = Array.from(new Set(alle.map((j) => j.datum.slice(0, 4)))).sort();
    sub = '· alle Jahre';
    verlauf = jahre.map((y) => {
      const v = list.filter((j) => inJahr(j, y) && zaehlt(j)).reduce((a, j) => a + j.honorar, 0);
      return { label: y, value: v, tip: `${y}: ${eur(v)}` };
    });
  }
  $('#aw-chart1-sub').textContent = sub;
  $('#aw-chart1').innerHTML = columnChart(verlauf, {
    width: containerWidth('#aw-chart1', VB_W), height: 250, aria: 'Honorar im Zeitverlauf'
  });

  // Nach Art
  $('#aw-chart2').innerHTML = rowChart(ARTEN.map((a) => {
    const g = list.filter((j) => j.art === a && zaehlt(j));
    return { label: a, value: g.reduce((s2, j) => s2 + j.honorar, 0), tip: `${g.length} Aufträge` };
  }), { width: containerWidth('#aw-chart2', 520), aria: 'Honorar nach Auftragsart' });

  // Nach Status
  $('#aw-chart3').innerHTML = rowChart(STATUS.map((st) => ({
    label: st, value: list.filter((j) => j.status === st).length
  })), {
    width: containerWidth('#aw-chart3', 520),
    valueFmt: (v) => num(v) + (v === 1 ? ' Auftrag' : ' Aufträge'),
    aria: 'Anzahl Aufträge nach Status'
  });
}

/* ─────────────────────────  Auftrag anlegen / bearbeiten  ───────────────────────── */

let editId = null;

function openJob(id) {
  const dlg = $('#dlg-auftrag');
  const j = id ? db.auftraege.find((x) => x.id === id) : null;
  editId = id || null;

  fillSelect($('#j-art'), ARTEN);
  fillSelect($('#j-status'), STATUS);
  fillSelect($('#j-zahlung'), ZAHLUNG);

  $('#dlg-title').textContent = j ? 'Auftrag bearbeiten' : 'Neuer Auftrag';
  $('#j-kunde').value     = j?.kunde ?? '';
  $('#j-datum').value     = j?.datum ?? todayISO();
  $('#j-art').value       = j?.art ?? 'Hochzeit';
  $('#j-von').value       = j?.zeitVon ?? '';
  $('#j-bis').value       = j?.zeitBis ?? '';
  $('#j-ort').value       = j?.ort ?? '';
  $('#j-telefon').value   = j?.telefon ?? '';
  $('#j-email').value     = j?.email ?? '';
  $('#j-honorar').value   = j ? (j.honorar || '') : '';
  $('#j-anzahlung').value = j ? (j.anzahlung || '') : '';
  $('#j-ausgaben').value  = j ? (j.ausgaben || '') : '';
  $('#j-zahlung').value   = j?.zahlung ?? 'Offen';
  $('#j-status').value    = j?.status ?? 'Anfrage';
  $('#j-rechnung').value  = j?.rechnung ?? '';
  $('#j-notizen').value   = j?.notizen ?? '';

  $('#j-delete').hidden = !j;
  $('#dlg-meta').textContent = j
    ? `Angelegt am ${fmtDateLong(j.erstellt.slice(0, 10))} · zuletzt bearbeitet am ${fmtDateLong(j.bearbeitet.slice(0, 10))}`
    : 'Pflichtfelder sind mit * markiert.';

  dlg.showModal();
  $('#j-kunde').focus();   // synchron – ein verzögerter Fokus würde Tippen abfangen
}

async function saveJob(ev) {
  ev.preventDefault();
  const form = $('#form-auftrag');
  if (!form.reportValidity()) return;

  const data = {
    kunde: $('#j-kunde').value.trim(),
    datum: $('#j-datum').value,
    art: $('#j-art').value,
    zeitVon: $('#j-von').value,
    zeitBis: $('#j-bis').value,
    ort: $('#j-ort').value.trim(),
    telefon: $('#j-telefon').value.trim(),
    email: $('#j-email').value.trim(),
    honorar: Number($('#j-honorar').value) || 0,
    anzahlung: Number($('#j-anzahlung').value) || 0,
    ausgaben: Number($('#j-ausgaben').value) || 0,
    zahlung: $('#j-zahlung').value,
    status: $('#j-status').value,
    rechnung: $('#j-rechnung').value.trim(),
    notizen: $('#j-notizen').value.trim(),
    bearbeitet: new Date().toISOString()
  };

  if (editId) {
    const j = db.auftraege.find((x) => x.id === editId);
    Object.assign(j, data);
  } else {
    db.auftraege.push(normalizeJob(Object.assign({ id: uid(), erstellt: new Date().toISOString() }, data)));
  }

  await persist();
  $('#dlg-auftrag').close();
  renderAll();
  toast(editId ? 'Auftrag gespeichert.' : 'Auftrag angelegt.');
}

async function trashJob() {
  if (!editId) return;
  const j = db.auftraege.find((x) => x.id === editId);
  if (!confirm(`„${j.kunde || 'Auftrag'}“ vom ${fmtDate(j.datum)} in den Papierkorb legen?\n\n`
             + 'Der Auftrag bleibt dort erhalten und kann jederzeit wiederhergestellt werden.')) return;
  j.geloescht = true;
  j.bearbeitet = new Date().toISOString();
  await persist();
  $('#dlg-auftrag').close();
  renderAll();
  toast('In den Papierkorb verschoben.');
}

/* ─────────────────────────  Backup & Verwaltung  ───────────────────────── */

function exportJSON() {
  const payload = {
    format: 'auftragsbuch-fotografie',
    schema: SCHEMA,
    exportiert: new Date().toISOString(),
    anzahl: db.auftraege.length,
    daten: db
  };
  download(`Auftragsbuch-Backup-${todayISO()}.json`,
    JSON.stringify(payload, null, 2), 'application/json');
  db.letztesBackup = new Date().toISOString();
  persist().then(() => { renderBackup(); renderBackupReminder(); });
  toast('JSON-Backup heruntergeladen.');
}

function exportCSV() {
  const cols = ['Datum', 'Von', 'Bis', 'Kunde', 'Telefon', 'E-Mail', 'Art', 'Ort',
                'Honorar', 'Anzahlung', 'Ausgaben', 'Zahlungsstatus', 'Auftragsstatus',
                'Rechnungsnr', 'Notizen'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const dez = (n) => String(Number(n) || 0).replace('.', ',');
  const rows = aktiv().sort((a, b) => a.datum.localeCompare(b.datum)).map((j) => [
    fmtDate(j.datum), j.zeitVon, j.zeitBis, j.kunde, j.telefon, j.email, j.art, j.ort,
    dez(j.honorar), dez(j.anzahlung), dez(j.ausgaben), j.zahlung, j.status,
    j.rechnung, j.notizen.replace(/\s*\n\s*/g, ' ')
  ].map(cell).join(';'));
  download(`Auftragsbuch-${todayISO()}.csv`,
    '﻿' + [cols.join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV-Tabelle heruntergeladen.');
}

async function importJSON(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert('Diese Datei ist kein gültiges JSON-Backup.');
    return;
  }
  const quelle = payload?.daten?.auftraege ? payload.daten : payload;
  if (!Array.isArray(quelle?.auftraege)) {
    alert('In der Datei wurden keine Aufträge gefunden.');
    return;
  }

  const eingehend = quelle.auftraege.map(normalizeJob);
  const vorhanden = new Map(db.auftraege.map((j) => [j.id, j]));
  let neu = 0, aktualisiert = 0;
  for (const j of eingehend) {
    const alt = vorhanden.get(j.id);
    if (!alt) neu++;
    else if (j.bearbeitet > alt.bearbeitet) aktualisiert++;
  }

  const ok = confirm(
    `Backup vom ${payload.exportiert ? fmtDate(payload.exportiert.slice(0, 10)) : 'unbekanntem Datum'}\n` +
    `enthält ${eingehend.length} Aufträge.\n\n` +
    `• ${neu} werden neu hinzugefügt\n` +
    `• ${aktualisiert} werden aktualisiert (neuere Fassung im Backup)\n` +
    `• ${eingehend.length - neu - aktualisiert} bleiben unverändert\n\n` +
    'Es wird nur ergänzt – bestehende Aufträge gehen dabei nicht verloren. Fortfahren?'
  );
  if (!ok) return;

  for (const j of eingehend) {
    const alt = vorhanden.get(j.id);
    if (!alt) db.auftraege.push(j);
    else if (j.bearbeitet > alt.bearbeitet) Object.assign(alt, j);
  }
  await persist();
  renderAll();
  toast(`${neu} neu, ${aktualisiert} aktualisiert.`);
}

function renderBackup() {
  refreshReportOptions();

  const last = db.letztesBackup;
  $('#backup-status').innerHTML = last
    ? `Letztes JSON-Backup: <strong>${esc(fmtDateLong(last.slice(0, 10)))}</strong> (vor ${daysBetween(last.slice(0, 10), todayISO())} Tagen).`
    : 'Es wurde noch kein JSON-Backup heruntergeladen.';

  // Papierkorb
  const trash = imPapier().sort((a, b) => b.bearbeitet.localeCompare(a.bearbeitet));
  $('#trash-list').innerHTML = trash.length
    ? `<div class="minilist">${trash.map((j) => `
        <div class="minirow">
          <span class="minirow-main">
            <span class="minirow-title">${esc(j.kunde || 'Ohne Namen')}</span>
            <span class="minirow-sub"> · ${fmtDate(j.datum)} · ${esc(j.art)} · ${eur(j.honorar)}</span>
          </span>
          <span class="nowrap">
            <button class="btn" data-restore="${j.id}">Wiederherstellen</button>
            <button class="btn btn-quiet" data-purge="${j.id}">Endgültig löschen</button>
          </span>
        </div>`).join('')}</div>`
    : '<p class="empty">Der Papierkorb ist leer.</p>';

  // Speicher-Info
  const bytes = (localStorage.getItem(LS.data) || '').length;
  $('#storage-info').innerHTML = `<div class="minilist">
    <div class="minirow"><span>Aufträge aktiv</span><span class="strong">${num(aktiv().length)}</span></div>
    <div class="minirow"><span>Im Papierkorb</span><span class="strong">${num(trash.length)}</span></div>
    <div class="minirow"><span>Verschlüsselte Datenmenge</span><span class="strong">${num(Math.round(bytes / 1024))} KB</span></div>
    <div class="minirow"><span>Zuletzt geändert</span><span class="strong">${esc(db.geaendert ? fmtDateLong(db.geaendert.slice(0, 10)) : '–')}</span></div>
    <div class="minirow"><span>Buch angelegt am</span><span class="strong">${esc(fmtDateLong(db.erstellt.slice(0, 10)))}</span></div>
    <div class="minirow"><span>Verschlüsselung</span><span class="strong">AES-GCM 256 · PBKDF2 ${num(readMeta()?.iter || PBKDF2_ITER)} Runden</span></div>
  </div>`;
}

async function changePassword(ev) {
  ev.preventDefault();
  const msg = $('#pw-msg');
  const alt = $('#pw-old').value, n1 = $('#pw-new1').value, n2 = $('#pw-new2').value;
  msg.style.color = '';
  if (n1 !== n2)     { msg.textContent = 'Die neuen Passwörter stimmen nicht überein.'; msg.style.color = 'var(--critical)'; return; }
  if (n1.length < 8) { msg.textContent = 'Das neue Passwort braucht mindestens 8 Zeichen.'; msg.style.color = 'var(--critical)'; return; }

  const meta = readMeta();
  try {
    const testKey = await deriveKey(alt, unb64(meta.salt), meta.iter);
    await decryptDb(localStorage.getItem(LS.data), testKey);
  } catch {
    msg.textContent = 'Das aktuelle Passwort ist nicht korrekt.';
    msg.style.color = 'var(--critical)';
    return;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  cryptoKey = await deriveKey(n1, salt, PBKDF2_ITER);
  localStorage.setItem(LS.meta, JSON.stringify({
    v: SCHEMA, salt: b64(salt), iter: PBKDF2_ITER, hint: meta.hint || '', erstellt: meta.erstellt
  }));
  await persist();
  $('#form-pw').reset();
  msg.textContent = 'Passwort geändert. Beim nächsten Entsperren gilt das neue Passwort.';
  msg.style.color = 'var(--success-text)';
}

function openWipe() {
  $('#wipe-count').textContent =
    `Betroffen: ${num(aktiv().length)} aktive Aufträge und ${num(imPapier().length)} im Papierkorb.`;
  $('#wipe-ack').checked = false;
  $('#wipe-word').value = '';
  $('#wipe-go').disabled = true;
  $('#dlg-wipe').showModal();
}

function checkWipe() {
  $('#wipe-go').disabled = !($('#wipe-ack').checked && $('#wipe-word').value.trim() === 'ALLES LÖSCHEN');
}

function doWipe() {
  // Zweite, bewusst getrennte Bestätigung
  if (!confirm('Letzte Sicherheitsfrage:\n\nAlle Daten und das Passwort werden jetzt '
             + 'endgültig von diesem Gerät entfernt. Fortfahren?')) return;
  localStorage.removeItem(LS.data);
  localStorage.removeItem(LS.meta);
  cryptoKey = null;
  db = null;
  location.reload();
}

/* ─────────────────────────  Bericht / PDF  ───────────────────────── */

let reportDefaultsGesetzt = false;

function refreshReportOptions() {
  fillSelect($('#r-jahr'), jahreImBestand());
  fillSelect($('#r-monat'), MONATE.map((m, i) => ({ value: String(i), label: m })));
  if (!reportDefaultsGesetzt) {
    // Beim ersten Öffnen auf den laufenden Monat stellen – danach die Auswahl
    // des Nutzers respektieren (fillSelect stellt sie selbst wieder her).
    const heute = new Date();
    $('#r-monat').value = String(heute.getMonth());
    $('#r-jahr').value = String(heute.getFullYear());
    reportDefaultsGesetzt = true;
  }
  syncReportControls();
}

function syncReportControls() {
  const u = $('#r-umfang').value;
  $('#r-jahr').closest('.f').style.visibility  = u === 'alles' ? 'hidden' : 'visible';
  $('#r-monat').closest('.f').style.visibility = u === 'monat' ? 'visible' : 'hidden';
}

function repTile(label, value, note) {
  return `<div class="rep-tile"><div class="l">${esc(label)}</div>
    <div class="v">${esc(value)}</div>${note ? `<div class="n">${esc(note)}</div>` : ''}</div>`;
}

function buildReport() {
  const umfang = $('#r-umfang').value;
  const jahr = $('#r-jahr').value;
  const monat = Number($('#r-monat').value);
  const alle = aktiv();

  let list, titel, verlauf, verlaufTitel;

  if (umfang === 'monat') {
    list = alle.filter((j) => inMonat(j, jahr, monat));
    titel = `${MONATE[monat]} ${jahr}`;
    const tage = new Date(Number(jahr), monat + 1, 0).getDate();
    verlauf = Array.from({ length: tage }, (_, i) => {
      const iso = `${jahr}-${String(monat + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      const v = list.filter((j) => j.datum === iso && zaehlt(j)).reduce((s, j) => s + j.honorar, 0);
      return { label: String(i + 1), value: v, tip: `${fmtDate(iso)}: ${eur(v)}` };
    });
    verlaufTitel = 'Honorar pro Tag';
  } else if (umfang === 'jahr') {
    list = alle.filter((j) => inJahr(j, jahr));
    titel = `Jahr ${jahr}`;
    verlauf = MON_KURZ.map((lbl, i) => ({
      label: lbl,
      value: list.filter((j) => inMonat(j, jahr, i) && zaehlt(j)).reduce((s, j) => s + j.honorar, 0)
    }));
    verlaufTitel = 'Honorar pro Monat';
  } else {
    list = alle;
    titel = 'Gesamtarchiv';
    const jahre = Array.from(new Set(alle.map((j) => j.datum.slice(0, 4)))).sort();
    verlauf = jahre.map((y) => ({
      label: y,
      value: alle.filter((j) => inJahr(j, y) && zaehlt(j)).reduce((s, j) => s + j.honorar, 0)
    }));
    verlaufTitel = 'Honorar pro Jahr';
  }

  list = list.slice().sort((a, b) => a.datum.localeCompare(b.datum));
  const s = summen(list);

  const nachArt = ARTEN.map((a) => {
    const g = list.filter((j) => j.art === a && zaehlt(j));
    return { label: a, value: g.reduce((x, j) => x + j.honorar, 0), anzahl: g.length };
  }).filter((r) => r.anzahl > 0).sort((a, b) => b.value - a.value);

  const artTabelle = nachArt.length ? `
    <table class="rep-table">
      <thead><tr><th>Auftragsart</th><th class="num">Anzahl</th><th class="num">Honorar</th><th class="num">Anteil</th></tr></thead>
      <tbody>${nachArt.map((r) => `<tr>
        <td>${esc(r.label)}</td>
        <td class="num">${num(r.anzahl)}</td>
        <td class="num">${eur(r.value)}</td>
        <td class="num">${s.honorar ? Math.round(r.value / s.honorar * 100) : 0} %</td>
      </tr>`).join('')}</tbody>
    </table>` : '<p class="rep-note">Keine Umsätze im Zeitraum.</p>';

  const zeilen = list.map((j) => `<tr>
      <td class="nowrap">${fmtDate(j.datum)}</td>
      <td>${esc(j.kunde || '–')}${j.ort ? `<br><span style="color:var(--text-muted)">${esc(j.ort)}</span>` : ''}</td>
      <td>${esc(j.art)}</td>
      <td>${esc(j.status)}</td>
      <td>${esc(j.zahlung)}${j.rechnung ? `<br><span style="color:var(--text-muted)">Rg. ${esc(j.rechnung)}</span>` : ''}</td>
      <td class="num">${eur(j.honorar)}</td>
      <td class="num">${j.ausgaben ? eur(j.ausgaben) : '–'}</td>
      <td class="num">${offenBetrag(j) ? eur(offenBetrag(j)) : '–'}</td>
    </tr>`).join('');

  $('#report').innerHTML = `
    <div class="rep-head">
      <div>
        <h1>Auftragsbuch Fotografie</h1>
        <div class="rep-period">${esc(umfang === 'monat' ? 'Monatsbericht' : umfang === 'jahr' ? 'Jahresbericht' : 'Gesamtbericht')} · ${esc(titel)}</div>
      </div>
      <div class="rep-meta">
        Erstellt am ${esc(nowStamp())}<br>
        ${num(list.length)} Datensätze${s.storniert ? ` · ${num(s.storniert)} storniert` : ''}<br>
        Backup-Dokument
      </div>
    </div>

    <div class="rep-section">
      <h2>Kennzahlen</h2>
      <div class="rep-tiles">
        ${repTile('Aufträge', num(s.anzahlAktiv), s.storniert ? `zzgl. ${num(s.storniert)} storniert` : 'ohne Stornos')}
        ${repTile('Honorar gesamt', eur(s.honorar), 'alle nicht stornierten Aufträge')}
        ${repTile('Davon bezahlt', eur(s.bezahlt), s.honorar ? `${Math.round(s.bezahlt / s.honorar * 100)} % beglichen` : '–')}
        ${repTile('Noch offen', eur(s.offen), 'ausstehende Zahlungen')}
        ${repTile('Ausgaben', eur(s.ausgaben), 'erfasste Auslagen')}
        ${repTile('Ergebnis', eur(s.ergebnis), 'Honorar minus Ausgaben')}
      </div>
    </div>

    <div class="rep-section">
      <h2>${esc(verlaufTitel)}</h2>
      ${columnChart(verlauf, { height: 210, aria: verlaufTitel })}
    </div>

    <div class="rep-section">
      <h2>Verteilung nach Auftragsart</h2>
      <div class="rep-cols">
        <div>${nachArt.length ? rowChart(nachArt, { width: 360, aria: 'Honorar nach Auftragsart' }) : ''}</div>
        <div>${artTabelle}</div>
      </div>
    </div>

    <div class="rep-section">
      <h2>Alle Aufträge im Zeitraum</h2>
      ${list.length ? `<table class="rep-table">
        <thead><tr>
          <th>Datum</th><th>Kunde / Ort</th><th>Art</th><th>Status</th><th>Zahlung</th>
          <th class="num">Honorar</th><th class="num">Ausgaben</th><th class="num">Offen</th>
        </tr></thead>
        <tbody>${zeilen}</tbody>
        <tfoot><tr>
          <td colspan="5">Summe (ohne Stornos)</td>
          <td class="num">${eur(s.honorar)}</td>
          <td class="num">${eur(s.ausgaben)}</td>
          <td class="num">${eur(s.offen)}</td>
        </tr></tfoot>
      </table>` : '<p class="rep-note">In diesem Zeitraum wurden keine Aufträge erfasst.</p>'}
    </div>

    <div class="rep-foot">
      <span>Auftragsbuch Fotografie · ${esc(titel)}</span>
      <span>Erstellt am ${esc(nowStamp())}</span>
    </div>`;

  $('#report-bar-title').textContent = `Vorschau · ${umfang === 'monat' ? 'Monatsbericht' : umfang === 'jahr' ? 'Jahresbericht' : 'Gesamtbericht'} ${titel}`;
  document.body.classList.add('report-open');
  $('#report').hidden = false;
  $('#report-bar').hidden = false;
  window.scrollTo(0, 0);
}

function closeReport() {
  document.body.classList.remove('report-open');
  $('#report').hidden = true;
  $('#report-bar').hidden = true;
}

/* ─────────────────────────  Sperrbildschirm  ───────────────────────── */

function showGate(mode) {
  $('#app').hidden = true;
  $('#gate').hidden = false;
  $('#form-setup').hidden = mode !== 'setup';
  $('#form-unlock').hidden = mode !== 'unlock';
  if (mode === 'unlock') {
    const hint = readMeta()?.hint;
    $('#unlock-hint').hidden = !hint;
    if (hint) $('#unlock-hint').textContent = `Erinnerungshilfe: ${hint}`;
    $('#unlock-pw').focus();
  } else {
    $('#setup-pw1').focus();
  }
}

async function doSetup(ev) {
  ev.preventDefault();
  const msg = $('#setup-msg');
  const p1 = $('#setup-pw1').value, p2 = $('#setup-pw2').value;
  if (p1.length < 8) { msg.textContent = 'Bitte mindestens 8 Zeichen verwenden.'; return; }
  if (p1 !== p2)     { msg.textContent = 'Die Passwörter stimmen nicht überein.'; return; }

  msg.classList.add('ok');
  msg.textContent = 'Schlüssel wird erzeugt …';
  await new Promise((r) => setTimeout(r, 20));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  cryptoKey = await deriveKey(p1, salt, PBKDF2_ITER);
  localStorage.setItem(LS.meta, JSON.stringify({
    v: SCHEMA, salt: b64(salt), iter: PBKDF2_ITER,
    hint: $('#setup-hint').value.trim(), erstellt: new Date().toISOString()
  }));
  db = emptyDb();
  await persist();
  $('#form-setup').reset();
  msg.textContent = '';
  msg.classList.remove('ok');
  enterApp();
  toast('Auftragsbuch angelegt. Viel Erfolg!');
}

async function doUnlock(ev) {
  ev.preventDefault();
  const msg = $('#unlock-msg');
  const meta = readMeta();
  msg.classList.add('ok');
  msg.textContent = 'Wird entschlüsselt …';
  await new Promise((r) => setTimeout(r, 20));
  try {
    const key = await deriveKey($('#unlock-pw').value, unb64(meta.salt), meta.iter);
    db = normalizeDb(await decryptDb(localStorage.getItem(LS.data), key));
    cryptoKey = key;
  } catch {
    msg.classList.remove('ok');
    msg.textContent = 'Falsches Passwort.';
    $('#unlock-pw').select();
    return;
  }
  $('#form-unlock').reset();
  msg.textContent = '';
  msg.classList.remove('ok');
  enterApp();
}

function lock() {
  cryptoKey = null;
  db = null;
  closeReport();
  $$('.dlg').forEach((d) => { if (d.open) d.close(); });
  showGate('unlock');
}

let lockTimer;
function resetLockTimer() {
  clearTimeout(lockTimer);
  if (!cryptoKey) return;
  lockTimer = setTimeout(() => { if (cryptoKey) { lock(); toast('Aus Sicherheitsgründen gesperrt.'); } }, AUTO_LOCK_MS);
}

/* ─────────────────────────  Rahmen / Navigation  ───────────────────────── */

function enterApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  refreshFilterOptions();
  refreshAuswertungOptions();
  renderAll();
  resetLockTimer();
}

function renderAll() {
  refreshFilterOptions();
  refreshAuswertungOptions();
  renderUebersicht();
  renderAuftraege();
  renderAuswertung();
  renderBackup();
}

function showView(name) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  // Erst jetzt kennen die Container ihre echte Breite – Diagramme neu zeichnen.
  if (name === 'uebersicht') renderUebersicht();
  if (name === 'auswertung') renderAuswertung();
  window.scrollTo(0, 0);
}

/* ─────────────────────────  Start  ───────────────────────── */

function bind() {
  // Gate
  $('#form-setup').addEventListener('submit', doSetup);
  $('#form-unlock').addEventListener('submit', doUnlock);
  $('#btn-lock').addEventListener('click', lock);

  // Navigation
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) showView(goto.dataset.goto);
  });

  // Auftrag
  $('#btn-new').addEventListener('click', () => openJob(null));
  $('#form-auftrag').addEventListener('submit', saveJob);
  $('#j-cancel').addEventListener('click', () => $('#dlg-auftrag').close());
  $('#dlg-close').addEventListener('click', () => $('#dlg-auftrag').close());
  $('#j-delete').addEventListener('click', trashJob);

  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-open]');
    if (row && !e.target.closest('button')) openJob(row.dataset.open);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const row = e.target.closest?.('[data-open]');
    if (row) { e.preventDefault(); openJob(row.dataset.open); }
  });

  // Filter
  const bindFilter = (id, key, fn) => $(id).addEventListener(fn || 'change', (e) => {
    filter[key] = e.target.value;
    renderAuftraege();
  });
  bindFilter('#f-suche', 'suche', 'input');
  bindFilter('#f-jahr', 'jahr');
  bindFilter('#f-monat', 'monat');
  bindFilter('#f-art', 'art');
  bindFilter('#f-status', 'status');
  bindFilter('#f-zahlung', 'zahlung');
  $('#f-clear').addEventListener('click', () => {
    Object.keys(filter).forEach((k) => filter[k] = '');
    ['#f-suche', '#f-jahr', '#f-monat', '#f-art', '#f-status', '#f-zahlung'].forEach((s) => $(s).value = '');
    renderAuftraege();
  });
  $('#table-auftraege').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    if (sortKey === th.dataset.sort) sortDir *= -1;
    else { sortKey = th.dataset.sort; sortDir = sortKey === 'datum' ? -1 : 1; }
    renderAuftraege();
  });

  // Auswertung
  $('#a-zeitraum').addEventListener('change', renderAuswertung);

  // Bericht
  $('#r-umfang').addEventListener('change', syncReportControls);
  $('#btn-report').addEventListener('click', buildReport);
  $('#report-back').addEventListener('click', closeReport);
  $('#report-print').addEventListener('click', () => window.print());

  // Backup
  $('#btn-export-json').addEventListener('click', exportJSON);
  $('#btn-export-csv').addEventListener('click', exportCSV);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) importJSON(f);
    e.target.value = '';
  });

  // Papierkorb
  $('#trash-list').addEventListener('click', async (e) => {
    const rest = e.target.closest('[data-restore]');
    const purge = e.target.closest('[data-purge]');
    if (rest) {
      const j = db.auftraege.find((x) => x.id === rest.dataset.restore);
      j.geloescht = false;
      j.bearbeitet = new Date().toISOString();
      await persist();
      renderAll();
      toast('Auftrag wiederhergestellt.');
    }
    if (purge) {
      const j = db.auftraege.find((x) => x.id === purge.dataset.purge);
      if (!confirm(`„${j.kunde || 'Auftrag'}“ vom ${fmtDate(j.datum)} endgültig löschen?\n\n`
                 + 'Dieser eine Auftrag wird unwiderruflich entfernt.')) return;
      db.auftraege = db.auftraege.filter((x) => x.id !== j.id);
      await persist();
      renderAll();
      toast('Endgültig gelöscht.');
    }
  });

  // Passwort & Löschen
  $('#form-pw').addEventListener('submit', changePassword);
  $('#btn-wipe').addEventListener('click', openWipe);
  $('#wipe-cancel').addEventListener('click', () => $('#dlg-wipe').close());
  $('#wipe-ack').addEventListener('change', checkWipe);
  $('#wipe-word').addEventListener('input', checkWipe);
  $('#wipe-go').addEventListener('click', () => { $('#dlg-wipe').close(); doWipe(); });

  // Automatische Sperre
  ['click', 'keydown', 'pointerdown'].forEach((ev) =>
    document.addEventListener(ev, resetLockTimer, { passive: true }));

  // Diagramme an neue Fensterbreiten anpassen
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!db) return;
      if ($('#view-uebersicht').classList.contains('is-active')) renderUebersicht();
      if ($('#view-auswertung').classList.contains('is-active')) renderAuswertung();
    }, 180);
  });

  // Tastaturkürzel. Strg/Cmd+N ist vom Browser belegt und nicht abfangbar,
  // deshalb einzelne Buchstaben – aber nur außerhalb von Eingabefeldern.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('report-open')) { closeReport(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ($('#app').hidden || $$('.dlg').some((d) => d.open)) return;
    if (e.target.closest('input, select, textarea')) return;

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openJob(null);
    }
    if (e.key === '/') {
      e.preventDefault();
      showView('auftraege');
      $('#f-suche').focus();
    }
  });
}

function start() {
  if (!window.crypto?.subtle) {
    $('#gate').hidden = false;
    $('#gate-error').hidden = false;
    $('#gate-error').innerHTML = '<strong>Verschlüsselung nicht verfügbar.</strong> Dieser Browser '
      + 'stellt die Web-Crypto-API nur über <code>https://</code>, <code>localhost</code> oder als '
      + 'lokale Datei bereit. Bitte rufe die Seite über eine dieser Adressen auf.';
    return;
  }
  try {
    localStorage.setItem('abf.test', '1');
    localStorage.removeItem('abf.test');
  } catch {
    $('#gate').hidden = false;
    $('#gate-error').hidden = false;
    $('#gate-error').innerHTML = '<strong>Kein Speicher verfügbar.</strong> Der Browser erlaubt dieser '
      + 'Seite keinen lokalen Speicher. Im privaten Modus oder bei blockierten Website-Daten kann das '
      + 'Auftragsbuch nichts sichern.';
    return;
  }

  bind();
  showGate(readMeta() && localStorage.getItem(LS.data) ? 'unlock' : 'setup');
}

document.addEventListener('DOMContentLoaded', start);
