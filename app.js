/* ============================================================================
   Auftragsbuch – Aufträge & Arbeitszeit
   ---------------------------------------------------------------------------
   Zwei Bereiche in einem Buch:
     • Aufträge  – eigene Aufträge mit Kunde, Honorar, Anzahlung, Status
     • Martin    – Arbeitszeit mit Stundensatz, Fahrzeit und Fahrtgeld
   Beides lässt sich nach Monaten und nach Jahren gliedern.

   Läuft vollständig im Browser. Alle Daten liegen AES-GCM-verschlüsselt im
   localStorage; der Schlüssel wird per PBKDF2 aus dem Passwort abgeleitet und
   nirgends gespeichert.
   ========================================================================== */
(function(){
"use strict";

/* ============ konstanten ============ */

var K_META='ab_meta_v3', K_VAULT='ab_vault_v3';
var L_ENTRIES='ab_entries_v2', L_PAY='ab_payments_v2', L_SET='ab_settings_v2', L_LOCK='ab_lock_v1';
var PBKDF2_ITER=250000, AUTO_LOCK_MS=20*60*1000;

/* Stundensätze mit Gültigkeitsdatum – aus dem Blatt „Stundenlohn“.
   Ein Eintrag wird immer mit dem Satz gerechnet, der an seinem Datum galt. */
var DEF_SAETZE=[
  {ab:'2025-05', foto:17.50, ausschank:17.50},
  {ab:'2025-06', foto:17.50, ausschank:15.50},
  {ab:'2025-10', foto:20.00, ausschank:15.50},
  {ab:'2026-06', foto:23.00, ausschank:15.50}
];
var DEF_SETTINGS={ kmRate:0.20, kmFrei:20, fahrFaktor:0.5, rateSelf:0, saetze:null };

var ARTEN=['Hochzeit','Portrait','Familie','Business','Event','Produkt','Immobilien','Tiere','Sonstiges'];
var STATUS=['Anfrage','Bestätigt','Durchgeführt','Abgeschlossen','Storniert'];
var STATUS_DOT={'Anfrage':'dot-muted','Bestätigt':'dot-accent','Durchgeführt':'dot-gold',
                'Abgeschlossen':'dot-good','Storniert':'dot-red'};

/* Wie die Fotos zum Kunden gekommen sind */
var UEBERGABE=['noch nicht übergeben','Dropbox','USB-Stick','Sonstiges'];
var UEBERGABE_DOT={'noch nicht übergeben':'dot-red','Dropbox':'dot-good','USB-Stick':'dot-good','Sonstiges':'dot-gold'};

/* Betriebsausgaben der Selbstständigkeit */
var KATEGORIEN=['Gewerbe & Behörden','Kamera & Objektive','Blitz & Licht','Speicher & Festplatten',
                'Stativ & Zubehör','Akkus & Strom','Software & Abos','Versicherung',
                'Weiterbildung','Werbung & Web','Büro & Porto','Fahrtkosten','Sonstiges'];
var ZAHLARTEN=['Bankkarte','Bar','Überweisung','PayPal','Rechnung','Sonstiges'];

var IMPORT_DATEI='daten/martin-arbeitszeit.json';
var APP_VERSION='v9 · 15.08.2026';
/* Kennzeichen des Excel-Stands. Wird nach dem einmaligen Übernehmen in den
   Einstellungen vermerkt, damit es nicht bei jedem Start erneut passiert. */
var XL_STAND='martin-arbeitszeit-bezahlt-bis-2026-07';

var entries=[], payments=[], settings={}, cryptoKey=null, meta=null;

var ui={
  view:'home', area:'martin', month:null, jahr:'', modus:'monat',
  sheet:null, editId:null, settleScope:null,
  sucheAn:false, suche:'', fArt:'', fStatus:'',
  fArea:'martin', fArt2:'fotografisch', fModus:'regulaer', fTime:'range', fBilling:'fix',
  errs:{}, draft:{}, saveErr:false, legacyOffen:false, xlNeu:0, xlAkt:0,
  repBereich:'martin', repUmfang:'monat', repJahr:'', repMonat:'', repOffen:false
};

/* ============ kleinkram ============ */

function p2(n){return String(n).padStart(2,'0');}
function today(){var d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());}
function mk(iso){return iso?iso.slice(0,7):'';}
function curMk(){return mk(today());}
function curY(){return String(new Date().getFullYear());}
function mLong(k){var a=k.split('-').map(Number);return new Date(a[0],a[1]-1,1).toLocaleDateString('de-DE',{month:'long',year:'numeric'});}
function mName(i){return new Date(2000,i,1).toLocaleDateString('de-DE',{month:'long'});}
function mShort(k){var a=k.split('-').map(Number);var d=new Date(a[0],a[1]-1,1);return d.toLocaleDateString('de-DE',{month:'short'})+' '+String(a[0]).slice(2);}
function mMini(k){var a=k.split('-').map(Number);return new Date(a[0],a[1]-1,1).toLocaleDateString('de-DE',{month:'short'});}
function dShort(iso){if(!iso)return'';var a=iso.split('-').map(Number);return p2(a[2])+'.'+p2(a[1])+'.'+String(a[0]).slice(2);}
function dLang(iso){if(!iso)return'–';var a=iso.split('-').map(Number);return p2(a[2])+'.'+p2(a[1])+'.'+a[0];}
function eur(n){return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n||0);}
function eur0(n){return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n||0);}
function dec2(n){return new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);}
function hm(d){var neg=d<0;d=Math.abs(d||0);var h=Math.floor(d+1e-9),m=Math.round((d-h)*60);if(m===60){m=0;h++;}return (neg?'-':'')+h+':'+p2(m);}
function add(a){return a.reduce(function(s,n){return s+(Number(n)||0);},0);}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function v(id){var e=document.getElementById(id);return e?e.value:'';}
function num(x){var n=Number(String(x).replace(',','.'));return isNaN(n)?0:n;}
function nowISO(){return new Date().toISOString();}
function tageSeit(iso){return Math.round((Date.now()-Date.parse(iso))/86400000);}
function stamp(){var d=new Date();return dLang(today())+' um '+p2(d.getHours())+':'+p2(d.getMinutes())+' Uhr';}

function download(name,text,mime){
  var b=new Blob([text],{type:mime||'application/octet-stream'}), u=URL.createObjectURL(b);
  var a=document.createElement('a'); a.href=u; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){URL.revokeObjectURL(u);},2000);
}

/* ============ verschlüsselung ============ */

var TE=new TextEncoder(), TD=new TextDecoder();

function b64(buf){
  var by=new Uint8Array(buf), s='';
  for(var i=0;i<by.length;i+=0x8000) s+=String.fromCharCode.apply(null,by.subarray(i,i+0x8000));
  return btoa(s);
}
function unb64(s){return Uint8Array.from(atob(s),function(c){return c.charCodeAt(0);});}

function deriveKey(pw,salt,iter){
  return crypto.subtle.importKey('raw',TE.encode(pw),'PBKDF2',false,['deriveKey'])
    .then(function(base){
      return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:iter,hash:'SHA-256'},
        base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    });
}
function encryptTo(obj,key){
  var iv=crypto.getRandomValues(new Uint8Array(12));
  return crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,TE.encode(JSON.stringify(obj)))
    .then(function(ct){return JSON.stringify({iv:b64(iv),ct:b64(ct)});});
}
function decryptFrom(raw,key){
  var o=JSON.parse(raw);
  return crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(o.iv)},key,unb64(o.ct))
    .then(function(pl){return JSON.parse(TD.decode(pl));});
}
function persist(){
  return encryptTo({entries:entries,payments:payments,settings:settings,geaendert:nowISO()},cryptoKey)
    .then(function(s){ localStorage.setItem(K_VAULT,s); ui.saveErr=false; });
}
function save(){ return persist().catch(function(){ ui.saveErr=true; render(); }); }

/* ============ datenmodell ============
   Der Auftrags-Bereich heißt intern weiterhin 'self', damit ältere
   Sicherungen und Daten aus der Vorfassung unverändert passen.          */

function normEntry(o){
  var e={
    id:o.id||uid(),
    area:(o.area==='self'||o.area==='ausgaben')?o.area:'martin',
    date:o.date||today(),
    timeMode:o.timeMode==='range'?'range':'duration',
    start:o.start||'', end:o.end||'',
    durH:Number(o.durH)||0, durM:Number(o.durM)||0,
    was:o.was||'', notiz:o.notiz||'',
    paid:!!o.paid, payment:o.payment||null,
    geloescht:!!o.geloescht,
    erstellt:o.erstellt||nowISO(),
    bearbeitet:o.bearbeitet||o.erstellt||nowISO()
  };
  if(e.area==='martin'){
    e.art=o.art==='ausschank'?'ausschank':'fotografisch';
    e.modus=(o.modus==='fahrzeit'||o.modus==='kilometer')?o.modus:'regulaer';
    e.km=Number(o.km)||0; e.name=o.name||'';
    if(o.fotos) e.fotos=Number(o.fotos)||0;
  }else if(e.area==='ausgaben'){
    e.bez=o.bez||o.was||'';
    e.kat=KATEGORIEN.indexOf(o.kat)>=0?o.kat:'Sonstiges';
    e.betrag=Number(o.betrag)||0;
    e.haendler=o.haendler||'';
    e.zahlart=ZAHLARTEN.indexOf(o.zahlart)>=0?o.zahlart:'Bankkarte';
    e.beleg=!!o.beleg;
    e.timeMode='duration'; e.durH=0; e.durM=0; e.paid=false; e.payment=null;
  }else{
    e.client=o.client||'';
    e.art=ARTEN.indexOf(o.art)>=0?o.art:'Sonstiges';
    e.status=STATUS.indexOf(o.status)>=0?o.status:(o.paid?'Abgeschlossen':'Bestätigt');
    e.ort=o.ort||''; e.telefon=o.telefon||''; e.email=o.email||'';
    e.billing=o.billing==='hourly'?'hourly':'fix';
    e.amount=Number(o.amount)||0; e.rate=Number(o.rate)||0;
    e.anzahlung=Number(o.anzahlung)||0; e.ausgaben=Number(o.ausgaben)||0;
    e.rechnung=o.rechnung||'';
    e.uebergabe=UEBERGABE.indexOf(o.uebergabe)>=0?o.uebergabe:UEBERGABE[0];
    if(o.fotos) e.fotos=Number(o.fotos)||0;
  }
  return e;
}
function normSettings(s){
  var out=Object.assign({},DEF_SETTINGS,s||{});
  var sz=(out.saetze&&out.saetze.length)?out.saetze:null;
  if(!sz){
    sz=DEF_SAETZE.map(function(x){return Object.assign({},x);});
    // Flache Sätze aus einer älteren Fassung als eigenen Zeitraum sichern.
    if(s&&(s.rateFoto!=null||s.rateAusschank!=null)){
      var letzte=sz[sz.length-1], f=Number(s.rateFoto), a=Number(s.rateAusschank);
      if((f&&f!==letzte.foto)||(a&&a!==letzte.ausschank)){
        sz.push({ab:curMk(), foto:f||letzte.foto, ausschank:a||letzte.ausschank});
      }
    }
  }
  out.saetze=sz.map(function(x){return {ab:x.ab||curMk(),foto:Number(x.foto)||0,ausschank:Number(x.ausschank)||0};})
    .sort(function(a,b){return a.ab.localeCompare(b.ab);});
  delete out.rateFoto; delete out.rateAusschank;
  return out;
}
function adopt(d){
  entries=(d&&Array.isArray(d.entries)?d.entries:[]).map(normEntry);
  payments=(d&&Array.isArray(d.payments)?d.payments:[]);
  settings=normSettings(d&&d.settings);
}

function legacyData(){
  var e=null,p=null,s=null;
  try{e=JSON.parse(localStorage.getItem(L_ENTRIES));}catch(x){}
  try{p=JSON.parse(localStorage.getItem(L_PAY));}catch(x){}
  try{s=JSON.parse(localStorage.getItem(L_SET));}catch(x){}
  if(!e||!e.length) return null;
  return {entries:e,payments:p||[],settings:s||{}};
}
function legacyVorhanden(){return !!localStorage.getItem(L_ENTRIES);}
function legacyEntfernen(){
  if(!confirm('Die alte, unverschlüsselte Kopie der Daten wird aus dem Browser-Speicher entfernt.\n\n'
    +'Die verschlüsselte Fassung im Auftragsbuch bleibt vollständig erhalten. Fortfahren?')) return;
  [L_ENTRIES,L_PAY,L_SET,L_LOCK,'ab_migrated'].forEach(function(k){localStorage.removeItem(k);});
  ui.legacyOffen=false; render();
}

/* ============ berechnung ============ */

function satzFor(date){
  var m=mk(date), list=settings.saetze||[], cur=list[0]||{foto:0,ausschank:0};
  for(var i=0;i<list.length;i++){ if(list[i].ab<=m) cur=list[i]; }
  return cur;
}
function rawHours(e){
  if(e.timeMode==='range'){
    if(!e.start||!e.end) return 0;
    var s=e.start.split(':').map(Number), t=e.end.split(':').map(Number);
    var d=(t[0]*60+t[1])-(s[0]*60+s[1]);
    if(d<0) d+=1440;
    return d/60;
  }
  return (Number(e.durH)||0)+(Number(e.durM)||0)/60;
}
function paidHours(e){
  if(e.modus==='kilometer') return 0;
  var h=rawHours(e);
  return e.modus==='fahrzeit' ? h*(settings.fahrFaktor||0) : h;
}
function rateOf(e){
  if(e.area==='self') return e.billing==='hourly' ? (Number(e.rate)||0) : 0;
  var s=satzFor(e.date);
  return e.art==='ausschank' ? s.ausschank : s.foto;
}
/** Stornierte Aufträge zählen nirgends mit. */
function zaehlt(e){ return !(e.area==='self' && e.status==='Storniert'); }
function amountOf(e){
  if(e.area==='ausgaben') return Number(e.betrag)||0;
  if(e.area==='self') return e.billing==='fix' ? (Number(e.amount)||0) : paidHours(e)*rateOf(e);
  if(e.modus==='kilometer') return Math.max(0,(Number(e.km)||0)-(settings.kmFrei||0))*(settings.kmRate||0);
  return paidHours(e)*rateOf(e);
}
function anzOf(e){ return e.area==='self' ? Math.min(Number(e.anzahlung)||0, amountOf(e)) : 0; }
/* Ausgaben werden im eigenen Bereich „Betriebsausgaben“ geführt, nicht
   mehr je Auftrag. Ein alter Wert bleibt gespeichert, zählt aber nicht mehr. */
function ausgOf(e){ return 0; }
function offenOf(e){
  if(e.area==='ausgaben'||!zaehlt(e)||e.paid) return 0;
  return Math.max(0, amountOf(e)-anzOf(e));
}
function mitBeleg(e){ return e.area==='ausgaben' && e.beleg; }
function kmOf(e){return e.modus==='kilometer'?(Number(e.km)||0):0;}
function fotosPerH(e){var h=paidHours(e);return (e.fotos&&h)?(Number(e.fotos)/h):null;}
function modusLabel(e){return e.modus==='fahrzeit'?'Fahrzeit':e.modus==='kilometer'?'Kilometer':'regulär';}
function artLabel(e){return e.art==='ausschank'?'Ausschank':'Fotografisch';}
/* Voll angezahlt heißt: es steht nichts mehr offen – also „Bezahlt“. */
function vollBezahlt(e){ return e.paid || (amountOf(e)>0 && offenOf(e)<=0.005); }
function zahlStatus(e){ return vollBezahlt(e)?'Bezahlt':(anzOf(e)>0?'Teilzahlung':'Offen'); }
function zahlDot(e){ return vollBezahlt(e)?'dot-good':(anzOf(e)>0?'dot-gold':'dot-red'); }

function summe(l){
  var rel=l.filter(zaehlt);
  var betrag=add(rel.map(amountOf)), ausgaben=add(rel.map(ausgOf));
  return {
    n:l.length, nRel:rel.length, storno:l.length-rel.length,
    zeit:add(rel.map(rawHours)), bez:add(rel.map(paidHours)), km:add(rel.map(kmOf)),
    betrag:betrag, anzahlung:add(rel.map(anzOf)), ausgaben:ausgaben,
    offen:add(rel.map(offenOf)), ergebnis:betrag-ausgaben,
    belegt:add(rel.map(function(e){return mitBeleg(e)?amountOf(e):0;})),
    ohneBeleg:add(rel.map(function(e){return e.area==='ausgaben'&&!e.beleg?amountOf(e):0;}))
  };
}

/* ============ selektoren ============ */

function alive(){return entries.filter(function(e){return !e.geloescht;});}
function imPapier(){return entries.filter(function(e){return e.geloescht;});}
function areaEntries(a){return alive().filter(function(e){return e.area===a;});}
function sortEntries(l){return l.slice().sort(function(x,y){
  return x.date.localeCompare(y.date)||String(x.start||'').localeCompare(String(y.start||''));});}
function monthEntries(a,m){return sortEntries(areaEntries(a).filter(function(e){return mk(e.date)===m;}));}
function yearEntries(a,y){return sortEntries(areaEntries(a).filter(function(e){return e.date.slice(0,4)===y;}));}
function jahre(a){
  var s={}; areaEntries(a).forEach(function(e){s[e.date.slice(0,4)]=1;});
  s[curY()]=1;
  return Object.keys(s).sort().reverse();
}
function payFor(a,m){return payments.filter(function(p){return p.area===a&&p.month===m;});}
var BEREICHE=['self','ausgaben','martin'];
/* Überschrift in der Bereichsansicht */
function areaName(a){
  return a==='martin' ? 'Anstellung – Martin Slováček'
       : a==='ausgaben' ? 'Betriebsausgaben' : 'Einnahmen';
}
/* Kurzform für Auswahllisten */
function areaKurz(a){ return a==='martin'?'Anstellung':a==='ausgaben'?'Betriebsausgaben':'Einnahmen'; }
/* Volle Bezeichnung mit Oberpunkt – für Berichte */
function areaLang(a){
  return a==='martin' ? 'Anstellung · Martin Slováček'
       : a==='ausgaben' ? 'Selbstständigkeit · Betriebsausgaben'
       : 'Selbstständigkeit · Einnahmen';
}
/* Titel auf der Startseite; der Oberpunkt steht dort schon als Überschrift */
function areaKarte(a){ return a==='martin'?'Martin Slováček':areaName(a); }
function areaKind(a){
  return a==='martin' ? 'Arbeitszeiten & Einnahmen'
       : a==='ausgaben' ? 'Anschaffungen & Kosten' : 'Aufträge & Honorare';
}
function areaFarbe(a){ return a==='martin'?'var(--martin)':a==='ausgaben'?'var(--gold)':'var(--self)'; }
/* Für Berichte, die außerhalb der Bereichsansicht gezeichnet werden. */
function areaHex(a){ return a==='martin'?'#3F5D52':a==='ausgaben'?'#8A6E42':'#8C5F3F'; }
/* Betriebsausgaben werden nicht abgerechnet – dort gibt es kein Häkchen. */
function hatAbrechnung(a){ return a!=='ausgaben'; }

function sucheAktiv(){ return !!(ui.suche.trim()||ui.fArt||ui.fStatus); }
function treffer(a){
  var q=ui.suche.trim().toLowerCase();
  return sortEntries(areaEntries(a).filter(function(e){
    if(ui.fArt && (e.area==='ausgaben' ? e.kat!==ui.fArt : e.art!==ui.fArt)) return false;
    if(ui.fStatus && e.status!==ui.fStatus) return false;
    if(q){
      var hay=[e.client,e.name,e.was,e.ort,e.notiz,e.rechnung,e.telefon,e.email,e.art,e.status,
               e.bez,e.kat,e.haendler,e.zahlart,e.uebergabe].filter(Boolean).join(' ').toLowerCase();
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  })).reverse();
}

/* ============ diagramme ============ */

function niceMax(x){
  if(!(x>0)) return 1;
  var ex=Math.pow(10,Math.floor(Math.log10(x))), f=x/ex;
  return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*ex;
}
function colPath(x,y,w,h,r){
  r=Math.min(r,w/2,h);
  return 'M'+x+','+(y+h)+' L'+x+','+(y+r)+' Q'+x+','+y+' '+(x+r)+','+y+
         ' L'+(x+w-r)+','+y+' Q'+(x+w)+','+y+' '+(x+w)+','+(y+r)+' L'+(x+w)+','+(y+h)+' Z';
}
function rowPath(x,y,w,h,r){
  r=Math.min(r,h/2,w);
  return 'M'+x+','+y+' L'+(x+w-r)+','+y+' Q'+(x+w)+','+y+' '+(x+w)+','+(y+r)+
         ' L'+(x+w)+','+(y+h-r)+' Q'+(x+w)+','+(y+h)+' '+(x+w-r)+','+(y+h)+' L'+x+','+(y+h)+' Z';
}
function leer(t){return '<p class="chart-empty">'+esc(t||'Für diesen Zeitraum liegen keine Werte vor.')+'</p>';}

/* Diagrammbreite an den Container koppeln, damit die Beschriftung beim
   Skalieren ihre echte Größe behält. .wrap ist höchstens 560 breit,
   davon je 20 px Rand und 15 px Innenabstand der Karte. */
function chartW(){
  return Math.max(280, Math.min(560, window.innerWidth||560) - 70);
}
function nStk(n,ein,mehr){ return n+' '+(n===1?ein:mehr); }

function columnChart(items,o){
  o=o||{};
  if(!items.length||!items.some(function(i){return i.value;})) return leer(o.empty);
  var W=o.width||700, H=o.height||190, pl=58, pr=10, pt=12, pb=26;
  var pw=W-pl-pr, ph=H-pt-pb;
  var max=niceMax(Math.max.apply(null,items.map(function(i){return i.value;})));
  var band=pw/items.length, bw=Math.max(3,Math.min(22,band-2));
  var y=function(x){return pt+ph-(x/max)*ph;};
  var g=[0,.25,.5,.75,1].map(function(t){
    var yy=y(t*max).toFixed(1);
    return '<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+yy+'" y2="'+yy+'" stroke="'+(t?'#EAE5DC':'#DFD9CF')+'" stroke-width="1"/>'
      +'<text x="'+(pl-7)+'" y="'+(y(t*max)+3.4).toFixed(1)+'" text-anchor="end" font-size="9.5" fill="#9A938A" style="font-variant-numeric:tabular-nums">'
      +esc(o.tick?o.tick(t*max):eur0(t*max))+'</text>';
  }).join('');
  var lw=Math.max.apply(null,items.map(function(i){return String(i.label).length;}))*5.6+6;
  var step=Math.max(1,Math.ceil(lw/band));
  var b=items.map(function(it,i){
    var cx=pl+i*band+band/2, h=it.value>0?Math.max(2,ph-(y(it.value)-pt)):0;
    return (h>0?'<path d="'+colPath(cx-bw/2,y(it.value),bw,h,3)+'" fill="'+(o.color||'var(--accent)')+'"'
        +(it.dim?' opacity=".42"':'')+'><title>'+esc(it.tip||(it.label+': '+eur(it.value)))+'</title></path>':'')
      +(i%step===0?'<text x="'+cx.toFixed(1)+'" y="'+(H-9)+'" text-anchor="middle" font-size="9.5" fill="#9A938A">'+esc(it.label)+'</text>':'');
  }).join('');
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(o.aria||'Säulendiagramm')+'">'+g+b+'</svg>';
}

function rowChart(items,o){
  o=o||{};
  var rows=items.filter(function(i){return i.value>0;}).sort(function(a,b){return b.value-a.value;});
  if(!rows.length) return leer(o.empty);
  var W=o.width||480, rh=26, bh=12, pt=5, CH=6.2;
  var fmt=o.fmt||eur;
  var vw=Math.ceil(Math.max.apply(null,rows.map(function(r){return fmt(r.value).length;}))*CH)+10;
  var lw=Math.min(Math.ceil(Math.max.apply(null,rows.map(function(r){return r.label.length;}))*CH),Math.round(W*0.34));
  var px=lw+9, pw=Math.max(24,W-px-vw), H=rows.length*rh+pt*2;
  var max=Math.max.apply(null,rows.map(function(r){return r.value;}));
  var maxCh=Math.max(7,Math.round(lw/CH));
  var body=rows.map(function(r,i){
    var y=pt+i*rh+(rh-bh)/2, w=Math.max(2,(r.value/max)*pw);
    var lab=r.label.length>maxCh?r.label.slice(0,maxCh-1)+'…':r.label;
    return '<text x="0" y="'+(y+bh/2+3.8).toFixed(1)+'" font-size="11" fill="#6E6862">'+esc(lab)+'</text>'
      +'<path d="'+rowPath(px,y,w,bh,3)+'" fill="'+(o.color||'var(--accent)')+'"><title>'
      +esc(r.label+': '+fmt(r.value)+(r.tip?' · '+r.tip:''))+'</title></path>'
      +'<text x="'+(px+w+7).toFixed(1)+'" y="'+(y+bh/2+3.8).toFixed(1)+'" font-size="11" fill="#23201C" font-weight="500" style="font-variant-numeric:tabular-nums">'
      +esc(fmt(r.value))+'</text>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(o.aria||'Balkendiagramm')+'">'+body+'</svg>';
}

/* ============ navigation ============ */

function go(view,a){
  ui.view=view;
  if(a){ ui.area=a; ui.month=curMk(); ui.jahr=curY(); ui.modus='monat'; ui.suche=''; ui.fArt=''; ui.fStatus=''; ui.sucheAn=false; }
  render();
}
function setMonth(m){ ui.month=m; ui.jahr=m.slice(0,4); ui.modus='monat'; render(); }
function setJahr(y){ ui.jahr=y; ui.month=y+'-'+ui.month.slice(5); render(); }
function setModus(m){ ui.modus=m; render(); }
function zuMonat(m){ ui.month=m; ui.jahr=m.slice(0,4); ui.modus='monat'; render(); }
function toggleSuche(){
  ui.sucheAn=!ui.sucheAn;
  if(!ui.sucheAn){ ui.suche=''; ui.fArt=''; ui.fStatus=''; }
  render();
  if(ui.sucheAn){ var el=document.getElementById('q'); if(el) el.focus(); }
}
/* Nur die Liste neu zeichnen – so bleibt der Cursor im Suchfeld stehen. */
function onSuche(el){
  ui.suche=el.value;
  var box=document.getElementById('ledgerbox');
  if(box) box.innerHTML=ledgerHTML();
}
function onFilter(){
  ui.fArt=v('fq-art'); ui.fStatus=document.getElementById('fq-status')?v('fq-status'):'';
  var box=document.getElementById('ledgerbox');
  if(box) box.innerHTML=ledgerHTML();
}
function closeSheet(){ui.sheet=null;ui.editId=null;ui.errs={};render();}

/* ============ eintrag anlegen / bearbeiten ============ */

var editId=null;
function openForm(id){
  ui.editId=id||null;ui.errs={};
  if(id){
    var e=entries.find(function(x){return x.id===id;});
    if(!e)return;
    ui.fArea=e.area;ui.fArt2=e.area==='martin'?(e.art||'fotografisch'):'fotografisch';
    ui.fModus=e.modus||'regulaer';
    ui.fTime=e.timeMode||'duration';ui.fBilling=e.billing||'fix';
    ui.draft={};
  }else{
    ui.fArea=ui.area;ui.fArt2='fotografisch';ui.fModus='regulaer';
    ui.fTime=ui.area==='self'?'duration':'range';ui.fBilling='fix';
    ui.draft={date: ui.month===curMk()? today() : ui.month+'-01'};
  }
  ui.sheet='form';render();
}
function keepDraft(){
  ['f-date','f-start','f-end','f-dh','f-dm','f-km','f-was','f-name','f-fotos','f-notiz',
   'f-client','f-amount','f-rate','f-ort','f-tel','f-mail','f-anz','f-ausg','f-rech','f-status','f-kunstart',
   'f-ueber','f-bez','f-kat','f-betrag','f-haendler','f-zahlart']
    .forEach(function(id){var el=document.getElementById(id);if(el)ui.draft[id.slice(2)]=el.value;});
}
function setArea(x){
  keepDraft(); ui.fArea=x;
  if(x==='self') ui.fTime='duration';
  render();
}
function toggleBeleg(el){
  var box=document.getElementById('f-beleg');
  if(!box) return;
  if(!el) box.checked=!box.checked;
  ui.draft.beleg=box.checked?'1':'0';
}
function setArt(x){keepDraft();ui.fArt2=x;render();}
function setModus2(x){keepDraft();ui.fModus=x;render();}
function setTimeMode(x){keepDraft();ui.fTime=x;render();}
function setBilling(x){keepDraft();ui.fBilling=x;render();}

function saveForm(){
  var errs={}, old=ui.editId?entries.find(function(x){return x.id===ui.editId;}):null;
  var e={id:ui.editId||uid(), area:ui.fArea, date:v('f-date'), notiz:v('f-notiz').trim(),
         erstellt:old?old.erstellt:nowISO(), bearbeitet:nowISO(),
         paid:old?!!old.paid:false, payment:old?old.payment:null, geloescht:false};
  if(!e.date) errs.date='Datum fehlt';

  e.timeMode=ui.fTime;
  if(ui.fTime==='range'){e.start=v('f-start');e.end=v('f-end');}
  else {e.durH=num(v('f-dh'));e.durM=num(v('f-dm'));}
  var hatZeit = ui.fTime==='range' ? !!(v('f-start')&&v('f-end')) : !!(num(v('f-dh'))||num(v('f-dm')));

  if(ui.fArea==='martin'){
    e.art=ui.fArt2; e.modus=ui.fModus;
    e.was=v('f-was').trim(); e.name=v('f-name').trim();
    if(ui.fModus==='kilometer'){
      e.km=num(v('f-km'));
      if(!e.km) errs.km='Kilometer fehlen';
      e.timeMode='duration';e.durH=0;e.durM=0;
    }else{
      if(!hatZeit) errs.time=ui.fTime==='range'?'Beginn und Ende angeben':'Dauer fehlt';
      if(v('f-fotos')) e.fotos=num(v('f-fotos'));
    }
  }else if(ui.fArea==='ausgaben'){
    e.bez=v('f-bez').trim();
    e.kat=v('f-kat')||'Sonstiges';
    e.betrag=num(v('f-betrag'));
    e.haendler=v('f-haendler').trim();
    e.zahlart=v('f-zahlart')||'Bankkarte';
    e.beleg=!!(document.getElementById('f-beleg')&&document.getElementById('f-beleg').checked);
    e.timeMode='duration'; e.durH=0; e.durM=0;
    if(!e.bez) errs.bez='Bezeichnung fehlt';
    if(!e.betrag) errs.betrag='Betrag fehlt';
  }else{
    e.client=v('f-client').trim();
    e.art=v('f-kunstart')||'Sonstiges';
    e.status=v('f-status')||'Bestätigt';
    e.ort=v('f-ort').trim(); e.telefon=v('f-tel').trim(); e.email=v('f-mail').trim();
    e.was=v('f-was').trim(); e.rechnung=v('f-rech').trim();
    e.uebergabe=v('f-ueber')||UEBERGABE[0];
    e.anzahlung=num(v('f-anz'));
    e.billing=ui.fBilling;
    if(!e.client) errs.client='Kunde fehlt';
    if(ui.fBilling==='fix'){
      e.amount=num(v('f-amount'));
      if(!e.amount) errs.amount='Honorar fehlt';
    }else{
      e.rate=num(v('f-rate'))||settings.rateSelf;
      if(!e.rate) errs.rate='Stundensatz fehlt';
      // Zeit nur nötig, wenn nach Stunden abgerechnet wird
      if(!hatZeit) errs.time=ui.fTime==='range'?'Beginn und Ende angeben':'Dauer fehlt';
    }
    if(v('f-fotos')) e.fotos=num(v('f-fotos'));
  }

  if(Object.keys(errs).length){ui.errs=errs;keepDraft();render();return;}
  e=normEntry(e);
  if(ui.editId) entries=entries.map(function(x){return x.id===ui.editId?e:x;});
  else entries.push(e);
  ui.area=e.area; ui.month=mk(e.date); ui.jahr=e.date.slice(0,4); ui.modus='monat';
  ui.sheet=null;ui.editId=null;ui.errs={};render();save();
}

function trashEntry(){
  if(!ui.editId)return;
  var e=entries.find(function(x){return x.id===ui.editId;});
  if(!e)return;
  e.geloescht=true; e.bearbeitet=nowISO();
  ui.sheet=null;ui.editId=null;render();save();
}
function restoreEntry(id){
  var e=entries.find(function(x){return x.id===id;});
  if(!e)return;
  e.geloescht=false; e.bearbeitet=nowISO(); render(); save();
}
function purgeEntry(id){
  var e=entries.find(function(x){return x.id===id;});
  if(!e)return;
  if(!confirm('Diesen einen Eintrag vom '+dLang(e.date)+' endgültig löschen?\n\n'
    +'Er lässt sich danach nicht mehr wiederherstellen.')) return;
  entries=entries.filter(function(x){return x.id!==id;});
  render(); save();
}

/* ============ abrechnen ============ */

function openSettle(scopeId){ui.settleScope=scopeId||null;ui.sheet='settle';ui.errs={};render();}
function settleTargets(){
  if(ui.settleScope){
    var e=entries.find(function(x){return x.id===ui.settleScope;});
    return e?[e]:[];
  }
  return monthEntries(ui.area,ui.month).filter(function(e){return !e.paid&&zaehlt(e);});
}
function doSettle(){
  var t=settleTargets(); if(!t.length){closeSheet();return;}
  var soll=add(t.map(offenOf));
  var got=v('s-amount')===''?soll:num(v('s-amount'));
  var rec={id:uid(),area:ui.area,month:ui.month,date:v('s-date')||today(),
           soll:soll,got:got,method:v('s-method'),note:v('s-note').trim(),
           count:t.length,single:!!ui.settleScope};
  var ids={}; t.forEach(function(e){ids[e.id]=1;});
  entries=entries.map(function(e){
    return ids[e.id]?Object.assign({},e,{paid:true,bearbeitet:nowISO(),
      payment:{amount:got,method:rec.method,date:rec.date,note:rec.note,batch:rec.id}}):e;
  });
  payments.push(rec);
  ui.sheet=null;ui.settleScope=null;render();save();
}
function unpay(id,ev){
  if(ev)ev.stopPropagation();
  var e=entries.find(function(x){return x.id===id;});
  if(!e)return;
  if(e.paid){ e.paid=false; e.payment=null; e.bearbeitet=nowISO(); render(); save(); }
  else openSettle(id);
}

/* ============ sätze & einstellungen ============ */

function openSettings(){ui.sheet='settings';render();}
function readSaetze(){
  var out=[], list=settings.saetze||[];
  for(var i=0;i<list.length;i++){
    var ab=v('sz-ab-'+i);
    if(!ab) continue;
    out.push({ab:ab,foto:num(v('sz-foto-'+i)),ausschank:num(v('sz-aus-'+i))});
  }
  return out.sort(function(a,b){return a.ab.localeCompare(b.ab);});
}
function addSatz(){
  var l=readSaetze(), letzte=l[l.length-1]||{foto:0,ausschank:0};
  l.push({ab:curMk(),foto:letzte.foto,ausschank:letzte.ausschank});
  settings.saetze=l; render();
}
function delSatz(i){
  var l=readSaetze();
  if(l.length<=1){alert('Mindestens ein Zeitraum muss bestehen bleiben.');return;}
  if(!confirm('Zeitraum ab '+(l[i]?mLong(l[i].ab):'')+' entfernen?\n\n'
    +'Einträge aus dieser Zeit werden danach mit dem davor gültigen Satz gerechnet.')) return;
  l.splice(i,1); settings.saetze=l; render();
}
function saveSettingsForm(){
  settings.saetze=readSaetze();
  settings.kmRate=num(v('st-kmrate'));
  settings.kmFrei=num(v('st-kmfrei'));
  settings.fahrFaktor=num(v('st-faktor'))/100;
  settings.rateSelf=num(v('st-self'));
  ui.sheet=null;render();save();
}

/* ============ sicherung ============ */

function openBackup(){ui.sheet='backup';render();}
function openRestore(){ui.sheet='restore';render();}
function openTrash(){ui.sheet='trash';render();}

/* Offline-Zwischenspeicher leeren und neu laden. Die Einträge liegen im
   localStorage und bleiben davon unberührt – nur die Programmdateien
   werden frisch geholt. */
function aktualisieren(){
  var b=document.getElementById('updbtn');
  if(b){ b.textContent='Wird geholt …'; b.disabled=true; }
  var neuLaden=function(){ location.reload(); };
  if(!('caches' in window)) return neuLaden();
  caches.keys()
    .then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); })
    .then(function(){
      return ('serviceWorker' in navigator)
        ? navigator.serviceWorker.getRegistrations().then(function(rs){
            return Promise.all(rs.map(function(r){ return r.unregister(); }));
          })
        : null;
    })
    .then(neuLaden).catch(neuLaden);
}
function pickFile(){var i=document.getElementById('fileimp');if(i)i.click();}

function backupObjekt(){
  return {format:'auftragsbuch',schema:4,exportiert:nowISO(),
          entries:entries,payments:payments,settings:settings};
}
function exportJSON(){
  download('Auftragsbuch-Sicherung-'+today()+'.json',JSON.stringify(backupObjekt(),null,1),'application/json');
  settings.letztesBackup=nowISO();
  render(); save();
}
function copyBackup(){
  var ta=document.getElementById('bk'); if(!ta)return;
  ta.select();
  try{
    navigator.clipboard.writeText(ta.value);
    var b=document.getElementById('bkbtn'); if(b) b.textContent='Kopiert ✓';
    settings.letztesBackup=nowISO(); save();
  }catch(x){}
}
function exportCSV(){
  var head=['Bereich','Datum','Kunde / Name','Art / Kategorie','Ort / Händler','Was','Fahrzeit / regulär',
            'Beginn','Ende','Zeit','gefahrene KM','bezahlte Zeit','Satz','Betrag',
            'Anzahlung','Offen','Status','Zahlung','Fotoübergabe','Rechnungsnr',
            'Beleg','Kommentar'];
  var q=function(x){return '"'+String(x==null?'':x).replace(/"/g,'""')+'"';};
  var rows=sortEntries(alive()).map(function(e){
    var self=e.area==='self', aus=e.area==='ausgaben';
    return [areaKurz(e.area), dLang(e.date),
      self?e.client:aus?'':(e.name||''),
      self?e.art:aus?e.kat:artLabel(e),
      self?e.ort:aus?(e.haendler||''):'',
      aus?(e.bez||''):(e.was||''),
      (self||aus)?'':modusLabel(e),
      e.start||'', e.end||'', aus?'':hm(rawHours(e)), kmOf(e)||'', aus?'':dec2(paidHours(e)),
      rateOf(e)?dec2(rateOf(e)):'', dec2(amountOf(e)), self?dec2(anzOf(e)):'',
      aus?'':dec2(offenOf(e)), self?e.status:'',
      aus?(e.zahlart||''):zahlStatus(e), self?(e.uebergabe||''):'',
      self?(e.rechnung||''):'', aus?(e.beleg?'ja':'nein'):'',
      (e.notiz||'').replace(/\s*\n\s*/g,' ')].map(q).join(';');
  });
  download('Auftragsbuch-'+today()+'.csv','﻿'+[head.join(';')].concat(rows).join('\r\n'),'text/csv;charset=utf-8');
}

function mergeDaten(d,quelle){
  var ein=(Array.isArray(d)?d:(d.entries||[])).map(normEntry);
  var vorh={}; entries.forEach(function(e){vorh[e.id]=e;});
  var neu=0, akt=0;
  ein.forEach(function(e){
    var a=vorh[e.id];
    if(!a) neu++; else if(e.bearbeitet>a.bearbeitet) akt++;
  });
  if(!confirm('Sicherung'+(quelle?' aus '+quelle:'')+' mit '+ein.length+' Einträgen.\n\n'
    +'• '+neu+' kommen neu hinzu\n• '+akt+' werden aktualisiert\n• '+(ein.length-neu-akt)+' bleiben unverändert\n\n'
    +'Es wird nur ergänzt – bestehende Einträge gehen nicht verloren. Fortfahren?')) return false;
  ein.forEach(function(e){
    var a=vorh[e.id];
    if(!a) entries.push(e); else if(e.bearbeitet>a.bearbeitet) Object.assign(a,e);
  });
  if(!Array.isArray(d)){
    var pv={}; payments.forEach(function(p){pv[p.id]=1;});
    (d.payments||[]).forEach(function(p){if(p&&p.id&&!pv[p.id]) payments.push(p);});
    if(d.settings&&(d.settings.saetze||d.settings.rateFoto!=null)&&!(settings.saetze||[]).length){
      settings=normSettings(d.settings);
    }
  }
  return true;
}
function applyRestore(){
  var ta=document.getElementById('rs'); if(!ta)return;
  var er=document.getElementById('rserr'), d;
  try{ d=JSON.parse(ta.value); }
  catch(x){ if(er) er.textContent='Das ist kein gültiges Sicherungsformat.'; return; }
  if(!mergeDaten(d,'der Zwischenablage')) return;
  ui.sheet=null; render(); save();
}
/* Beim ersten Start die Arbeitszeiten aus der Excel-Liste selbst übernehmen.
   Es wird ausschließlich ergänzt – vorhandene oder in den Papierkorb gelegte
   Einträge bleiben unangetastet. Danach merkt sich die App den Stand. */
/* Abrechnungen einer früheren Übernahme wegräumen, damit sie sich nicht
   mit den neuen doppeln. Eigene Abrechnungen bleiben unangetastet. */
function xlAltEntfernen(){
  payments=payments.filter(function(p){ return String(p.id).indexOf('xlp')!==0; });
}

function autoImport(){
  if(settings.xlStand===XL_STAND) return;
  fetch(IMPORT_DATEI,{cache:'no-store'})
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(function(d){
      xlAltEntfernen();
      var vorh={}; entries.forEach(function(e){ vorh[e.id]=e; });
      var neu=0, akt=0;
      (d.entries||[]).map(normEntry).forEach(function(e){
        var a=vorh[e.id];
        if(!a){ entries.push(e); neu++; return; }
        if(a.geloescht) return;                 // im Papierkorb bleibt im Papierkorb
        if(a.paid!==e.paid){ akt++; }
        a.paid=e.paid; a.payment=e.payment;     // nur den Zahlungsstand nachziehen
      });
      (d.payments||[]).forEach(function(p){ if(p&&p.id) payments.push(p); });
      settings.xlStand=XL_STAND;
      ui.xlNeu=neu; ui.xlAkt=akt;
      render();
      save();
    })
    .catch(function(){ /* ohne Verbindung oder lokal geöffnet: der Knopf bleibt */ });
}
function xlWeg(){ ui.xlNeu=0; ui.xlAkt=0; render(); }

/* Die aus Martin_Arbeitszeit.xlsx erzeugte Sicherung liegt neben der App. */
function importExcel(){
  var btn=document.getElementById('xlbtn');
  if(btn){ btn.textContent='Wird geladen …'; btn.disabled=true; }
  fetch(IMPORT_DATEI,{cache:'no-store'})
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(function(d){
      if(d&&d.stand) xlAltEntfernen();
      if(mergeDaten(d,'der Excel-Liste „Martin Arbeitszeit“')){
        settings.xlStand=XL_STAND; ui.sheet=null; render(); save();
      }
      else render();
    })
    .catch(function(x){
      render();
      alert('Die Excel-Daten konnten nicht geladen werden (' + x.message + ').\n\n'
        +'Das funktioniert nur, wenn du die Seite über eine Web-Adresse geöffnet hast '
        +'(z. B. über GitHub Pages), nicht als lokale Datei.');
    });
}

function importDatei(input){
  var f=input.files&&input.files[0]; input.value='';
  if(!f)return;
  f.text().then(function(t){
    var d;
    try{ d=JSON.parse(t); }catch(x){ alert('Diese Datei ist kein gültiges JSON-Backup.'); return; }
    if(!mergeDaten(d,'der Datei „'+f.name+'“')) return;
    ui.sheet=null; render(); save();
  });
}

/* ============ alles löschen ============ */

function openReset(){ui.sheet='reset';render();}
function checkWipe(){
  var b=document.getElementById('wipego');
  if(b) b.disabled=!(document.getElementById('wipeack').checked && v('wipeword').trim()==='ALLES LÖSCHEN');
}
function doWipe(){
  if(!confirm('Letzte Sicherheitsfrage:\n\nAlle Einträge, Abrechnungen, der Papierkorb und das '
    +'Passwort werden jetzt endgültig von diesem Gerät entfernt. Fortfahren?')) return;
  [K_VAULT,K_META,L_ENTRIES,L_PAY,L_SET,L_LOCK,'ab_migrated'].forEach(function(k){localStorage.removeItem(k);});
  cryptoKey=null; entries=[]; payments=[];
  location.reload();
}

/* ============ live-vorschau ============ */

function liveCalc(){
  var el=document.getElementById('calc'); if(!el)return;
  var e={area:ui.fArea,art:ui.fArea==='martin'?ui.fArt2:v('f-kunstart'),modus:ui.fModus,
         timeMode:ui.fTime,billing:ui.fBilling,date:v('f-date')||today(),
         start:v('f-start'),end:v('f-end'),durH:num(v('f-dh')),durM:num(v('f-dm')),
         km:num(v('f-km')),amount:num(v('f-amount')),rate:num(v('f-rate'))||settings.rateSelf,
         anzahlung:num(v('f-anz')),ausgaben:num(v('f-ausg')),status:v('f-status'),
         fotos:num(v('f-fotos'))};
  var parts=[];
  if(ui.fArea==='ausgaben'){
    var b=num(v('f-betrag'));
    var jahr=(v('f-date')||today()).slice(0,4);
    var bisher=add(yearEntries('ausgaben',jahr).filter(function(x){return x.id!==ui.editId;}).map(amountOf));
    el.innerHTML='<b>'+eur(b)+'</b> &middot; Betriebsausgaben '+jahr+' danach '+eur(bisher+b);
    return;
  }
  if(ui.fArea==='martin'&&ui.fModus==='kilometer'){
    var frei=settings.kmFrei||0;
    parts.push('<b>'+eur(amountOf(e))+'</b>');
    parts.push(Math.max(0,e.km-frei)+' km abrechenbar (ab '+frei+' km)');
  }else if(ui.fArea==='self'){
    parts.push('Honorar <b>'+eur(amountOf(e))+'</b>'
      +(ui.fBilling==='hourly'?' · '+hm(paidHours(e))+' Std × '+eur(rateOf(e)):''));
    if(e.anzahlung) parts.push('Anzahlung '+eur(anzOf(e))+' · offen '+eur(offenOf(e)));
    if(e.status==='Storniert') parts.push('storniert – zählt nicht mit');
  }else{
    parts.push('Zeit '+hm(rawHours(e))+' · bezahlt '+hm(paidHours(e))+' Std');
    var r=rateOf(e);
    parts.push('<b>'+eur(amountOf(e))+'</b>'+(r?' bei '+eur(r)+'/Std':''));
    if(r) parts.push('Satz gültig ab '+mLong(satzFor(e.date).ab));
    var fp=fotosPerH(e); if(fp) parts.push(Math.round(fp)+' Fotos pro Stunde');
  }
  el.innerHTML=parts.join(' &middot; ');
}

/* ============ symbol ============ */

function cameraSVG(){
  return '<svg viewBox="0 0 32 26" aria-hidden="true">'
  +'<path d="M2 8.5a2 2 0 012-2h4l2.2-3.2A1.6 1.6 0 0111.5 2.6h9a1.6 1.6 0 011.3.7L24 6.5h4a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2z" '
  +'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
  +'<path d="M16 19.6c0 0-5.9-3.9-5.9-7.4 0-1.8 1.4-3.1 3-3.1 1.2 0 2.3.7 2.9 1.8.6-1.1 1.7-1.8 2.9-1.8 1.6 0 3 1.3 3 3.1 0 3.5-5.9 7.4-5.9 7.4z" '
  +'fill="currentColor"/>'
  +'<circle cx="26" cy="11" r="1" fill="currentColor" opacity=".55"/></svg>';
}

/* ============ startseite ============ */

function banners(){
  var h='';
  if(ui.xlNeu||ui.xlAkt) h+='<div class="banner banner-ok"><b>'
    +(ui.xlNeu?ui.xlNeu+' Arbeitszeiten übernommen.':'Zahlungsstand aktualisiert.')+'</b> '
    +(ui.xlNeu?'Alle Zeilen für Martin aus der Excel-Liste, Juni 2025 bis August 2026. ':'')
    +(ui.xlAkt?ui.xlAkt+' Zeilen bis Juli 2026 als bezahlt gebucht. ':'')
    +'<button class="linkbtn" style="color:inherit" onclick="A.xlWeg()">Verstanden</button></div>';
  if(ui.saveErr) h+='<div class="banner">Speichern fehlgeschlagen. Bitte lade sofort eine Sicherung herunter.</div>';
  if(ui.legacyOffen) h+='<div class="banner banner-warn">Deine bisherigen Daten wurden übernommen und verschlüsselt. '
    +'Die alte, <b>unverschlüsselte</b> Kopie liegt noch im Browser-Speicher.'
    +'<div><button class="btn btn-line btn-sm" onclick="A.legacyEntfernen()">Alte Kopie entfernen</button>'
    +'<button class="btn btn-line btn-sm" onclick="A.openBackup()">Erst sichern</button></div></div>';
  var lb=settings.letztesBackup;
  if(alive().length&&(!lb||tageSeit(lb)>=30)){
    h+='<div class="banner banner-warn">'+(lb?'Deine letzte Sicherung ist '+tageSeit(lb)+' Tage alt.':'Du hast noch keine Sicherung heruntergeladen.')
      +' <button class="linkbtn" style="color:inherit" onclick="A.openBackup()">Jetzt sichern</button></div>';
  }
  return h;
}

function viewHome(){
  var h='<div class="wrap wrap-home"><div class="masthead">'
    +'<div class="mark">'+cameraSVG()+'<span class="mark-title">Auftragsbuch</span></div>'
    +'<div class="mark-rule"></div><div class="mark-sub">Aufträge · Arbeitszeit · Ausgaben</div></div>';
  h+=banners();
  h+='<div class="gruppen">'
    +'<div class="gruppe"><div class="gruppe-t">Selbstständigkeit</div>'
    + homeCard('self') + homeCard('ausgaben') + '</div>'
    +'<div class="gruppe"><div class="gruppe-t">Anstellung</div>'
    + homeCard('martin') + '</div>'
    +'</div>';
  h+=noteStream();
  h+='<div class="homelinks">'
    +'<button class="linkbtn" onclick="A.openReport()">Bericht &amp; PDF</button>'
    +'<button class="linkbtn" onclick="A.openSettings()">Sätze &amp; Einstellungen</button>'
    +'<button class="linkbtn" onclick="A.openBackup()">Sicherung</button>'
    +'<button class="linkbtn" onclick="A.lock()">Sperren</button></div>';
  h+='</div>';
  return h;
}
function homeCard(a){
  /* Immer der laufende Monat und das laufende Jahr – richtet sich nach dem Datum des Geräts. */
  var m=curMk(), y=curY();
  var sM=summe(monthEntries(a,m)), sJ=summe(yearEntries(a,y));
  var zeile=function(k,s){
    var mitte = a==='martin'
      ? '<div><div class="stat-k">Stunden</div><div class="stat-v num">'+hm(s.bez)+'</div></div>'
        +'<div><div class="stat-k">Betrag</div><div class="stat-v num">'+eur0(s.betrag)+'</div></div>'
      : a==='ausgaben'
      ? '<div><div class="stat-k">Posten</div><div class="stat-v num">'+s.n+'</div></div>'
        +'<div><div class="stat-k">Ausgaben</div><div class="stat-v num">'+eur0(s.betrag)+'</div></div>'
      : '<div><div class="stat-k">Aufträge</div><div class="stat-v num">'+s.nRel+'</div></div>'
        +'<div><div class="stat-k">Honorar</div><div class="stat-v num">'+eur0(s.betrag)+'</div></div>';
    var rechts = a==='ausgaben'
      ? '<div><div class="stat-k">Ohne Beleg</div><div class="stat-v num" style="color:'+(s.ohneBeleg?'var(--red)':'var(--ink-3)')+'">'+eur0(s.ohneBeleg)+'</div></div>'
      : '<div><div class="stat-k">Offen</div><div class="stat-v num" style="color:'+(s.offen?'var(--red)':'var(--ink-3)')+'">'+eur0(s.offen)+'</div></div>';
    return '<div class="area-stats"><div class="area-per">'+esc(k)+'</div>'+mitte+rechts+'</div>';
  };
  return '<button class="area-card" style="--c:'+areaFarbe(a)+'" onclick="A.go(\'area\',\''+a+'\')">'
    +'<span class="chev">›</span>'
    +'<div class="area-name">'+esc(areaKarte(a))+'</div><div class="area-kind">'+esc(areaKind(a))+'</div>'
    +zeile(mMini(m)+' '+String(y).slice(2), sM)
    +zeile('Jahr '+y, sJ)
    +'</button>';
}
function noteStream(){
  var ns=alive().filter(function(e){return e.notiz;})
    .sort(function(a,b){return b.date.localeCompare(a.date);}).slice(0,5);
  if(!ns.length) return '';
  return '<div class="sec"><div class="sec-head"><span class="label">Notizen</span></div>'
    + ns.map(function(e){
        return '<div class="note" onclick="A.go(\'area\',\''+e.area+'\');A.setMonth(\''+mk(e.date)+'\')">'
          +'<div class="note-top"><span class="note-src" style="color:'+areaFarbe(e.area)+'">'
          +esc(e.area==='martin'?(e.name||'Anstellung'):e.area==='ausgaben'?(e.bez||'Ausgabe'):(e.client||'Auftrag'))+'</span>'
          +'<span class="note-date num">'+dShort(e.date)+'</span></div>'
          +'<div class="note-body">'+esc(e.notiz)+'</div></div>';
      }).join('') + '</div>';
}

/* ============ bereichsansicht ============ */

function viewArea(){
  var a=ui.area;
  if(!ui.jahr) ui.jahr=ui.month.slice(0,4);
  var js=jahre(a);
  if(js.indexOf(ui.jahr)<0) js=js.concat([ui.jahr]).sort().reverse();

  var h='<div class="topbar"><div class="topbar-inner"><div class="topbar-row">'
    +'<button class="back" onclick="A.go(\'home\')">‹</button>'
    +'<span class="topbar-title'+(a==='martin'?' lang':'')+'">'+esc(areaName(a))+'</span>'
    +'<button class="iconbtn'+(ui.sucheAn?' on':'')+'" title="Suchen" onclick="A.toggleSuche()">⌕</button>'
    +'<button class="iconbtn" title="Bericht" onclick="A.openReport()">▤</button>'
    +'<button class="iconbtn" title="Einstellungen" onclick="A.openSettings()">⚙</button></div>';

  if(ui.sucheAn){
    h+='<div class="searchrow"><input id="q" type="search" placeholder="Kunde, Ort, Notiz, Rechnungsnr. …" '
      +'value="'+esc(ui.suche)+'" oninput="A.onSuche(this)">';
    if(a==='self'){
      h+='<div class="two" style="margin-top:8px">'
        +'<select id="fq-art" onchange="A.onFilter()"><option value="">Alle Arten</option>'
        +ARTEN.map(function(x){return '<option'+(ui.fArt===x?' selected':'')+'>'+x+'</option>';}).join('')+'</select>'
        +'<select id="fq-status" onchange="A.onFilter()"><option value="">Alle Status</option>'
        +STATUS.map(function(x){return '<option'+(ui.fStatus===x?' selected':'')+'>'+x+'</option>';}).join('')+'</select></div>';
    }else if(a==='ausgaben'){
      h+='<div style="margin-top:8px">'
        +'<select id="fq-art" onchange="A.onFilter()"><option value="">Alle Kategorien</option>'
        +KATEGORIEN.map(function(x){return '<option'+(ui.fArt===x?' selected':'')+'>'+x+'</option>';}).join('')+'</select></div>';
    }
    h+='</div>';
  }

  if(!sucheAktiv()){
    h+='<div class="seg seg-sm">'
      +'<button class="'+(ui.modus==='monat'?'on':'')+'" onclick="A.setModus(\'monat\')">Monat</button>'
      +'<button class="'+(ui.modus==='jahr'?'on':'')+'" onclick="A.setModus(\'jahr\')">Jahr</button></div>';
    h+='<div class="chips">'+js.map(function(y){
        return '<button class="chip '+(y===ui.jahr?'on':'')+'" onclick="A.setJahr(\''+y+'\')">'+y+'</button>';
      }).join('')+'</div>';
    if(ui.modus==='monat'){
      h+='<div class="chips">'+[0,1,2,3,4,5,6,7,8,9,10,11].map(function(i){
          var key=ui.jahr+'-'+p2(i+1), n=monthEntries(a,key).length;
          return '<button class="chip mini '+(key===ui.month?'on':'')+(n?' has':'')+'" onclick="A.zuMonat(\''+key+'\')">'
            +mMini(key)+(n?'<i>'+n+'</i>':'')+'</button>';
        }).join('')+'</div>';
    }
  }
  h+='</div></div><div class="wrap">';
  h+=banners();
  h+='<div id="ledgerbox">'+ledgerHTML()+'</div>';
  h+='</div><button class="fab" onclick="A.openForm()">+ '
    +(a==='self'?'Auftrag':a==='ausgaben'?'Ausgabe':'Eintrag')+'</button>';
  return h;
}
function wortFuer(a){
  return a==='self'?['Auftrag','Aufträge']:a==='ausgaben'?['Posten','Posten']:['Eintrag','Einträge'];
}

/* Alles unterhalb der Kopfzeile – wird beim Tippen einzeln neu gezeichnet. */
function ledgerHTML(){
  var a=ui.area;
  if(sucheAktiv()) return trefferHTML(a);
  return ui.modus==='jahr' ? jahrHTML(a) : monatHTML(a);
}

function trefferHTML(a){
  var l=treffer(a), s=summe(l);
  if(!l.length) return '<div class="ledger"><div class="empty">Nichts gefunden.</div></div>';
  return '<div class="ledger"><div class="ledger-head"><span class="label">Treffer</span>'
    +'<span class="label">'+l.length+' · '+eur(s.betrag)+'</span></div>'
    +l.map(rowHTML).join('')+'</div>'
    +'<p class="hint" style="margin-top:10px">Die Suche geht über alle Monate und Jahre dieses Bereichs.</p>';
}

function monatHTML(a){
  var m=ui.month, es=monthEntries(a,m), h='';
  if(!es.length){
    h+='<div class="ledger"><div class="empty">Keine Einträge in '+mLong(m)+'.</div></div>';
  }else{
    h+='<div class="ledger"><div class="ledger-head"><span class="label">'+mLong(m)+'</span>'
      +'<span class="label">'+nStk(es.length,wortFuer(a)[0],wortFuer(a)[1])+'</span></div>'
      +es.map(rowHTML).join('')+sumbar(a,es)+'</div>';
  }
  var offen=hatAbrechnung(a)?es.filter(function(e){return !e.paid&&zaehlt(e);}):[];
  if(offen.length) h+='<button class="settle-btn" onclick="A.openSettle()">Monat abrechnen · '+eur(add(offen.map(offenOf)))+'</button>';
  payFor(a,m).filter(function(p){return !p.single;}).forEach(function(p){
    h+='<div class="settled"><div class="settled-t">Abgerechnet am '+dShort(p.date)+' · '+eur(p.got)+'</div>'
      +'<div class="settled-s">'+esc(p.method||'—')+' · '+p.count+' Einträge'
      +(Math.abs(p.got-p.soll)>0.005?' · Abweichung '+eur(p.got-p.soll)+' zu '+eur(p.soll):'')
      +(p.note?' · '+esc(p.note):'')+'</div></div>';
  });
  h+=monatChart(a);
  h+='<div class="ctr"><button class="linkbtn" onclick="A.openReport()">Monatsbericht als PDF sichern</button></div>';
  return h;
}

function jahrHTML(a){
  var y=ui.jahr, es=yearEntries(a,y), s=summe(es);
  var kacheln = a==='martin'
    ? [['Einträge',String(s.n)],['Zeit',hm(s.zeit)+' Std'],['Bezahlte Zeit',hm(s.bez)+' Std'],
       ['Gefahrene km',String(s.km)],['Betrag',eur(s.betrag)],['Offen',eur(s.offen)]]
    : a==='ausgaben'
    ? [['Posten',String(s.n)],['Ausgaben',eur(s.betrag)],['Mit Beleg',eur(s.belegt)],
       ['Ohne Beleg',eur(s.ohneBeleg)],['Ø je Posten',eur(s.n?s.betrag/s.n:0)],
       ['Größter Posten',eur(Math.max.apply(null,[0].concat(es.map(amountOf))))]]
    : [['Aufträge',String(s.nRel)+(s.storno?' +'+s.storno+' storno':'')],['Honorar',eur(s.betrag)],
       ['Anzahlungen',eur(s.anzahlung)],['Bereits bezahlt',eur(s.betrag-s.offen)],['Offen',eur(s.offen)],
       ['Ø je Auftrag',eur(s.nRel?s.betrag/s.nRel:0)]];

  var h='<div class="ledger"><div class="ledger-head"><span class="label">Jahr '+y+'</span>'
    +'<span class="label">'+nStk(s.n,wortFuer(a)[0],wortFuer(a)[1])+'</span></div>'
    +'<div class="ytiles">'+kacheln.map(function(k){
      return '<div class="ytile"><div class="stat-k">'+esc(k[0])+'</div><div class="stat-v num">'+esc(k[1])+'</div></div>';
    }).join('')+'</div>';

  h+='<div class="ylist">'+[0,1,2,3,4,5,6,7,8,9,10,11].map(function(i){
      var key=y+'-'+p2(i+1), le=monthEntries(a,key), sm=summe(le);
      var sub = !le.length ? '—'
        : a==='martin'   ? nStk(le.length,'Eintrag','Einträge')+' · '+hm(sm.bez)+' Std'
        : a==='ausgaben' ? nStk(le.length,'Posten','Posten')+(sm.ohneBeleg?' · '+eur0(sm.ohneBeleg)+' ohne Beleg':'')
        :                  nStk(sm.nRel,'Auftrag','Aufträge')+(sm.storno?' +'+sm.storno+' storno':'');
      return '<div class="yrow'+(le.length?'':' leer')+'" onclick="A.zuMonat(\''+key+'\')">'
        +'<span class="yrow-m">'+mName(i)+'</span>'
        +'<span class="yrow-s">'+esc(sub)+'</span>'
        +'<span class="yrow-a num">'+(le.length?eur(sm.betrag):'')+'</span>'
        +'<span class="yrow-o num">'+(sm.offen?eur0(sm.offen)+' offen':'')+'</span></div>';
    }).join('')+'</div></div>';

  h+='<div class="panel"><div class="sec-head"><span class="label">'
    +(a==='martin'?'Betrag pro Monat':a==='ausgaben'?'Ausgaben pro Monat':'Honorar pro Monat')+' · '+y+'</span></div>'
    +columnChart([0,1,2,3,4,5,6,7,8,9,10,11].map(function(i){
        // Im Jahresüberblick zählen alle Monate gleich – kein Hervorheben.
        var key=y+'-'+p2(i+1), sm=summe(monthEntries(a,key));
        return {label:mMini(key),value:sm.betrag,tip:mLong(key)+': '+eur(sm.betrag)};
      }),{width:chartW(),height:180,aria:'Betrag pro Monat'})+'</div>';

  if(a==='self'){
    var nachArt=ARTEN.map(function(x){
      var g=es.filter(function(e){return e.art===x&&zaehlt(e);});
      return {label:x,value:add(g.map(amountOf)),tip:nStk(g.length,'Auftrag','Aufträge')};
    });
    h+='<div class="panel"><div class="sec-head"><span class="label">Honorar nach Auftragsart · '+y+'</span></div>'
      +rowChart(nachArt,{width:chartW(),aria:'Honorar nach Auftragsart'})+'</div>';
  }
  if(a==='ausgaben'){
    var nachKat=KATEGORIEN.map(function(x){
      var g=es.filter(function(e){return e.kat===x;});
      return {label:x,value:add(g.map(amountOf)),tip:nStk(g.length,'Posten','Posten')};
    });
    h+='<div class="panel"><div class="sec-head"><span class="label">Ausgaben nach Kategorie · '+y+'</span></div>'
      +rowChart(nachKat,{width:chartW(),aria:'Ausgaben nach Kategorie'})+'</div>';
  }
  h+='<div class="ctr"><button class="linkbtn" onclick="A.openReport()">Jahresbericht als PDF sichern</button></div>';
  return h;
}

function monatChart(a){
  var data=[],now=new Date(ui.month+'-01T00:00:00');
  for(var i=5;i>=0;i--){
    var d=new Date(now.getFullYear(),now.getMonth()-i,1);
    var k=d.getFullYear()+'-'+p2(d.getMonth()+1);
    data.push({label:mMini(k),value:summe(monthEntries(a,k)).betrag,dim:k!==ui.month,
               tip:mLong(k)+': '+eur(summe(monthEntries(a,k)).betrag)});
  }
  if(!data.some(function(d){return d.value;})) return '';
  return '<div class="panel"><div class="sec-head"><span class="label">Sechs Monate bis '+mShort(ui.month)+'</span></div>'
    +columnChart(data,{width:chartW(),height:170,aria:'Betrag der letzten sechs Monate'})+'</div>';
}

function rowHTML(e){
  var amt=amountOf(e), ph=paidHours(e), pillTxt, pillC, what, meta, rechts;
  if(e.area==='martin'){
    pillTxt = e.modus==='fahrzeit'?'Fahrzeit':e.modus==='kilometer'?'KM':(e.art==='ausschank'?'Ausschank':'Foto');
    pillC = (e.modus==='kilometer'||e.modus==='fahrzeit') ? 'var(--gold)' : (e.art==='ausschank'?'var(--self)':'var(--martin)');
    what = e.was || artLabel(e);
    meta = e.name||'';
    if(e.modus==='kilometer') meta=(meta?meta+' · ':'')+(e.km||0)+' km';
    if(e.fotos) meta=(meta?meta+' · ':'')+e.fotos+' Fotos';
    rechts = dShort(e.date)+' · '+(e.modus==='kilometer' ? '—'
      : (e.timeMode==='range'&&e.start&&e.end ? e.start+'–'+e.end+' · '+hm(ph) : hm(ph)+' Std'));
  }else if(e.area==='ausgaben'){
    pillTxt=e.kat; pillC='var(--gold)';
    what=e.bez||'—';
    meta=[e.haendler,e.zahlart].filter(Boolean).join(' · ')||'—';
    rechts = dShort(e.date);
  }else{
    pillTxt=e.art; pillC='var(--self)';
    what=e.client||'—';
    meta=[e.was,e.ort].filter(Boolean).join(' · ')||'—';
    rechts = dShort(e.date)+(e.rechnung?' · Rg. '+e.rechnung:'');
  }
  var storno = e.area==='self'&&e.status==='Storniert';
  return '<div class="row'+(storno?' storno':'')+'" onclick="A.openForm(\''+e.id+'\')">'
    +(hatAbrechnung(e.area)
      ? '<button class="tick '+(e.paid?'on':'')+'" title="'+(e.paid?'Als offen markieren':'Abrechnen')+'" onclick="A.unpay(\''+e.id+'\',event)">'+(e.paid?'✓':'')+'</button>'
      : '<span class="tick tick-still" aria-hidden="true">€</span>')
    +'<div class="row-body">'
    +'<div class="row-l1"><span class="row-what"><span class="pill" style="background:'+pillC+';color:#fff">'+esc(pillTxt)+'</span>'+esc(what)+'</span>'
    +'<span class="row-amt num">'+eur(amt)+'</span></div>'
    +'<div class="row-l2"><span class="row-meta">'+esc(meta)+'</span>'
    +'<span class="row-time num">'+esc(rechts)+'</span></div>'
    +(e.area==='self'
      ? '<div class="row-l2"><span class="badges">'
        +'<span class="badge"><span class="dot '+STATUS_DOT[e.status]+'"></span>'+esc(e.status)+'</span>'
        +(storno?'':'<span class="badge"><span class="dot '+zahlDot(e)+'"></span>'+zahlStatus(e)+'</span>')
        +'<span class="badge"><span class="dot '+UEBERGABE_DOT[e.uebergabe]+'"></span>'+esc(e.uebergabe)+'</span>'
        +'</span>'
        +'<span class="row-time num">'+(offenOf(e)?eur(offenOf(e))+' offen':'')+'</span></div>'
      : e.area==='ausgaben'
      ? '<div class="row-l2"><span class="badges">'
        +'<span class="badge"><span class="dot '+(e.beleg?'dot-good':'dot-red')+'"></span>'
        +(e.beleg?'Beleg vorhanden':'Beleg fehlt')+'</span></span><span></span></div>'
      : '')
    +(e.notiz?'<div class="row-note">'+esc(e.notiz)+'</div>':'')
    +'</div></div>';
}

function sumbar(a,es){
  var s=summe(es);
  var zellen = a==='martin'
    ? [['Zeit',hm(s.zeit)],['Bezahlt',hm(s.bez)],['KM',String(s.km)],['Offen',eur(s.offen),s.offen?'var(--red)':'']]
    : a==='ausgaben'
    ? [['Posten',String(s.n)],['Mit Beleg',eur0(s.belegt)],['Ohne Beleg',eur0(s.ohneBeleg),s.ohneBeleg?'var(--red)':''],
       ['Ø Posten',eur0(s.n?s.betrag/s.n:0)]]
    : [['Aufträge',String(s.nRel)],['Anzahlung',eur0(s.anzahlung)],
       ['Bezahlt',eur0(s.betrag-s.offen)],['Offen',eur0(s.offen),s.offen?'var(--red)':'']];
  return '<div class="sumbar"><div class="sumgrid">'
    +zellen.map(function(z){
      return '<div class="sumcell"><div class="stat-k">'+esc(z[0])+'</div>'
        +'<div class="stat-v num"'+(z[2]?' style="color:'+z[2]+'"':'')+'>'+esc(z[1])+'</div></div>';
    }).join('')
    +'</div><div class="total-row"><span class="label">'
    +(a==='self'?'Honorar':a==='ausgaben'?'Ausgaben':'Summe')+'</span>'
    +'<span class="total-v num">'+eur(s.betrag)+'</span></div>'
    +'</div>';
}

/* ============ blätter ============ */

function shell(title,body,actions){
  return '<div class="veil" onclick="A.closeSheet()"></div><div class="sheet"><div class="sheet-in">'
    +'<div class="sheet-bar"><span class="sheet-t">'+title+'</span>'
    +'<button class="iconbtn" onclick="A.closeSheet()">✕</button></div>'
    +body+(actions||'')+'</div></div>';
}
function optionen(list,cur){
  return list.map(function(x){return '<option'+(cur===x?' selected':'')+'>'+esc(x)+'</option>';}).join('');
}

function sheetForm(){
  var e=ui.editId?entries.find(function(x){return x.id===ui.editId;}):null;
  var g=function(k,ek,fb){ return ui.draft[k]!==undefined?ui.draft[k]:(e&&e[ek]!=null?e[ek]:(fb||'')); };
  var errs=ui.errs, b='';

  if(!ui.editId){
    b+='<div class="seg">'
      +'<button class="'+(ui.fArea==='self'?'on':'')+'" onclick="A.setArea(\'self\')">Auftrag</button>'
      +'<button class="'+(ui.fArea==='martin'?'on':'')+'" onclick="A.setArea(\'martin\')">Anstellung</button>'
      +'<button class="'+(ui.fArea==='ausgaben'?'on':'')+'" onclick="A.setArea(\'ausgaben\')">Ausgabe</button></div>';
  }

  if(ui.fArea==='ausgaben'){
    var haendler=Array.from(new Set(areaEntries('ausgaben').map(function(x){return x.haendler;}).filter(Boolean)));
    b+='<div class="f"><label>Was wurde gekauft / bezahlt</label>'
      +'<input type="text" id="f-bez" value="'+esc(g('bez','bez'))+'" placeholder="z. B. Objektiv Sigma 35 mm">'
      +(errs.bez?'<div class="err">'+errs.bez+'</div>':'')+'</div>';
    b+='<div class="two"><div class="f"><label>Kategorie</label><select id="f-kat">'
      +optionen(KATEGORIEN,g('kat','kat','Kamera & Objektive'))+'</select></div>'
      +'<div class="f"><label>Datum</label><input type="date" id="f-date" value="'+g('date','date',today())+'"></div></div>'
      +(errs.date?'<div class="err">'+errs.date+'</div>':'');
    b+='<div class="two"><div class="f"><label>Betrag (€)</label>'
      +'<input type="number" inputmode="decimal" step="0.01" min="0" id="f-betrag" value="'+g('betrag','betrag')+'" oninput="A.liveCalc()">'
      +(errs.betrag?'<div class="err">'+errs.betrag+'</div>':'')+'</div>'
      +'<div class="f"><label>Zahlungsart</label><select id="f-zahlart">'
      +optionen(ZAHLARTEN,g('zahlart','zahlart','Bankkarte'))+'</select></div></div>';
    b+='<div class="f"><label>Händler / Anbieter</label>'
      +'<input type="text" id="f-haendler" list="hl" value="'+esc(g('haendler','haendler'))+'" placeholder="z. B. Foto Erhardt">'
      +'<datalist id="hl">'+haendler.map(function(x){return '<option value="'+esc(x)+'"></option>';}).join('')+'</datalist></div>';
    var belegAn = ui.draft.beleg!==undefined ? ui.draft.beleg==='1' : (e?!!e.beleg:false);
    b+='<div class="sw-row" onclick="A.toggleBeleg()"><span>Beleg / Rechnung vorhanden</span>'
      +'<span class="sw"><input type="checkbox" id="f-beleg" '+(belegAn?'checked':'')+' onclick="event.stopPropagation();A.toggleBeleg(this)"><i></i></span></div>';
    b+='<div class="calc" id="calc"></div>';
    b+='<div class="f"><label>Notiz</label><textarea id="f-notiz" placeholder="Seriennummer, Verwendungszweck, Garantie …">'+esc(g('notiz','notiz'))+'</textarea></div>';
    var actsA='<div class="acts">'
      +(ui.editId?'<button class="btn btn-line" style="color:var(--red)" onclick="A.trashEntry()">Papierkorb</button>':'')
      +'<button class="btn btn-fill" onclick="A.saveForm()">Speichern</button></div>';
    return shell(ui.editId?'Ausgabe bearbeiten':'Neue Betriebsausgabe',b,actsA);
  }

  if(ui.fArea==='self'){
    var kunden=Array.from(new Set(areaEntries('self').map(function(x){return x.client;}).filter(Boolean)));
    b+='<div class="f"><label>Kunde / Auftraggeber</label><input type="text" id="f-client" list="cl" value="'+esc(g('client','client'))+'" placeholder="Name">'
      +'<datalist id="cl">'+kunden.map(function(c){return '<option value="'+esc(c)+'"></option>';}).join('')+'</datalist>'
      +(errs.client?'<div class="err">'+errs.client+'</div>':'')+'</div>';
    b+='<div class="two"><div class="f"><label>Auftragsart</label><select id="f-kunstart" onchange="A.liveCalc()">'
      +optionen(ARTEN,g('kunstart','art','Hochzeit'))+'</select></div>'
      +'<div class="f"><label>Auftragsstatus</label><select id="f-status" onchange="A.liveCalc()">'
      +optionen(STATUS,g('status','status','Bestätigt'))+'</select></div></div>';
  }

  b+='<div class="f"><label>Datum</label><input type="date" id="f-date" value="'+g('date','date',today())+'" oninput="A.liveCalc()">'
    +(errs.date?'<div class="err">'+errs.date+'</div>':'')+'</div>';

  if(ui.fArea==='martin'){
    b+='<div class="f"><label>Art</label><div class="seg" style="margin-bottom:0">'
      +'<button class="'+(ui.fArt2==='fotografisch'?'on':'')+'" onclick="A.setArt(\'fotografisch\')">Fotografisch</button>'
      +'<button class="'+(ui.fArt2==='ausschank'?'on':'')+'" onclick="A.setArt(\'ausschank\')">Ausschank</button></div></div>';
    b+='<div class="f"><label>Zeile</label><div class="seg" style="margin-bottom:0">'
      +'<button class="'+(ui.fModus==='regulaer'?'on':'')+'" onclick="A.setModus2(\'regulaer\')">Regulär</button>'
      +'<button class="'+(ui.fModus==='fahrzeit'?'on':'')+'" onclick="A.setModus2(\'fahrzeit\')">Fahrzeit</button>'
      +'<button class="'+(ui.fModus==='kilometer'?'on':'')+'" onclick="A.setModus2(\'kilometer\')">Kilometer</button></div></div>';
  }

  if(ui.fArea==='martin'&&ui.fModus==='kilometer'){
    b+='<div class="f"><label>Gefahrene Kilometer</label><input type="number" inputmode="numeric" min="0" id="f-km" value="'+g('km','km')+'" oninput="A.liveCalc()" placeholder="0">'
      +(errs.km?'<div class="err">'+errs.km+'</div>':'')+'</div>';
  }else{
    b+='<div class="f"><label>Zeit'+(ui.fArea==='self'&&ui.fBilling==='fix'?' (optional)':'')+'</label>'
      +'<div class="seg" style="margin-bottom:9px">'
      +'<button class="'+(ui.fTime==='range'?'on':'')+'" onclick="A.setTimeMode(\'range\')">Beginn / Ende</button>'
      +'<button class="'+(ui.fTime==='duration'?'on':'')+'" onclick="A.setTimeMode(\'duration\')">Dauer</button></div>';
    if(ui.fTime==='range'){
      b+='<div class="two"><input type="time" id="f-start" value="'+g('start','start')+'" oninput="A.liveCalc()">'
        +'<input type="time" id="f-end" value="'+g('end','end')+'" oninput="A.liveCalc()"></div>';
    }else{
      b+='<div class="two"><input type="number" inputmode="numeric" min="0" id="f-dh" value="'+g('dh','durH')+'" oninput="A.liveCalc()" placeholder="Std">'
        +'<input type="number" inputmode="numeric" min="0" max="59" id="f-dm" value="'+g('dm','durM')+'" oninput="A.liveCalc()" placeholder="Min"></div>';
    }
    b+=(errs.time?'<div class="err">'+errs.time+'</div>':'')+'</div>';
  }

  b+='<div class="calc" id="calc"></div>';

  if(ui.fArea==='martin'){
    b+='<div class="f"><label>Was</label><input type="text" id="f-was" list="wasl" value="'+esc(g('was','was'))+'" placeholder="z. B. Hochzeitsbegleitung">'
      +'<datalist id="wasl"><option value="Hochzeitsbegleitung"></option><option value="Hochzeitsgalerie aussortiert"></option><option value="Ausschank"></option></datalist></div>';
    var namen=Array.from(new Set(areaEntries('martin').map(function(x){return x.name;}).filter(Boolean)));
    b+='<div class="f"><label>Name / Hochzeitspaar</label><input type="text" id="f-name" list="naml" value="'+esc(g('name','name'))+'" placeholder="z. B. Julia und Florian">'
      +'<datalist id="naml">'+namen.map(function(n){return '<option value="'+esc(n)+'"></option>';}).join('')+'</datalist></div>';
    if(ui.fModus!=='kilometer'){
      b+='<div class="f"><label>Anzahl Fotos (optional)</label><input type="number" inputmode="numeric" min="0" id="f-fotos" value="'+g('fotos','fotos')+'" oninput="A.liveCalc()" placeholder="z. B. 3100"></div>';
    }
  }else{
    b+='<div class="f"><label>Abrechnung</label><div class="seg" style="margin-bottom:9px">'
      +'<button class="'+(ui.fBilling==='fix'?'on':'')+'" onclick="A.setBilling(\'fix\')">Festbetrag</button>'
      +'<button class="'+(ui.fBilling==='hourly'?'on':'')+'" onclick="A.setBilling(\'hourly\')">Stundensatz</button></div>';
    if(ui.fBilling==='fix'){
      b+='<input type="number" inputmode="decimal" step="0.01" min="0" id="f-amount" value="'+g('amount','amount')+'" oninput="A.liveCalc()" placeholder="Honorar in €">'
        +(errs.amount?'<div class="err">'+errs.amount+'</div>':'');
    }else{
      b+='<input type="number" inputmode="decimal" step="0.01" min="0" id="f-rate" value="'+g('rate','rate',settings.rateSelf||'')+'" oninput="A.liveCalc()" placeholder="€ pro Stunde">'
        +(errs.rate?'<div class="err">'+errs.rate+'</div>':'');
    }
    b+='</div>';
    b+='<div class="f"><label>Anzahlung (€)</label>'
      +'<input type="number" inputmode="decimal" step="0.01" min="0" id="f-anz" value="'+g('anz','anzahlung')+'" oninput="A.liveCalc()"></div>';
    b+='<div class="f"><label>Was</label><input type="text" id="f-was" value="'+esc(g('was','was'))+'" placeholder="z. B. Fotografische Begleitung"></div>';
    b+='<div class="f"><label>Ort</label><input type="text" id="f-ort" value="'+esc(g('ort','ort'))+'" placeholder="z. B. Schlosshof Aichach"></div>';
    b+='<div class="two"><div class="f"><label>Telefon</label><input type="tel" id="f-tel" value="'+esc(g('tel','telefon'))+'"></div>'
      +'<div class="f"><label>E-Mail</label><input type="email" id="f-mail" value="'+esc(g('mail','email'))+'"></div></div>';
    b+='<div class="two"><div class="f"><label>Rechnungsnr.</label><input type="text" id="f-rech" value="'+esc(g('rech','rechnung'))+'"></div>'
      +'<div class="f"><label>Anzahl Fotos</label><input type="number" inputmode="numeric" min="0" id="f-fotos" value="'+g('fotos','fotos')+'"></div></div>';
    b+='<div class="f"><label>Übermittlung der Fotos</label><select id="f-ueber">'
      +optionen(UEBERGABE,g('ueber','uebergabe',UEBERGABE[0]))+'</select></div>';
  }

  b+='<div class="f"><label>Notiz</label><textarea id="f-notiz" placeholder="Besonderheiten, Absprachen …">'+esc(g('notiz','notiz'))+'</textarea></div>';

  var acts='<div class="acts">'
    +(ui.editId?'<button class="btn btn-line" style="color:var(--red)" onclick="A.trashEntry()">Papierkorb</button>':'')
    +'<button class="btn btn-fill" onclick="A.saveForm()">Speichern</button></div>';
  return shell(ui.editId?'Bearbeiten':(ui.fArea==='self'?'Neuer Auftrag':'Neuer Eintrag'),b,acts);
}

function sheetSettle(){
  var t=settleTargets(), soll=add(t.map(offenOf));
  var b='<div class="hint">'+(ui.settleScope?'Einzelner Eintrag':t.length+' offene Einträge in '+mLong(ui.month))+' · Offen <b>'+eur(soll)+'</b></div>';
  b+='<div class="f"><label>Tatsächlich erhalten</label><input type="number" inputmode="decimal" step="0.01" id="s-amount" value="'+soll.toFixed(2)+'"></div>';
  b+='<div class="f"><label>Zahlungsart</label><select id="s-method">'
    +'<option>Banküberweisung</option><option>Bar</option><option>PayPal</option><option>Sonstiges</option></select></div>';
  b+='<div class="f"><label>Zahlungsdatum</label><input type="date" id="s-date" value="'+today()+'"></div>';
  b+='<div class="f"><label>Notiz zur Zahlung</label><textarea id="s-note" placeholder="z. B. 75 € Rest aus Juli mit verrechnet"></textarea></div>';
  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +'<button class="btn btn-fill" onclick="A.doSettle()">Als bezahlt buchen</button></div>';
  return shell('Abrechnen',b,acts);
}

function sheetSettings(){
  var b='<div class="hint">Jeder Eintrag wird mit dem Satz gerechnet, der <b>an seinem Datum</b> galt. '
    +'Ein neuer Zeitraum ändert deshalb keine alten Einträge rückwirkend.</div>';
  b+='<div class="label" style="margin-bottom:7px">Stundensätze Martin</div>';
  b+=(settings.saetze||[]).map(function(s,i){
    return '<div class="satzrow">'
      +'<div class="satz-top">'
      +'<div style="flex:1"><div class="satz-lab">gültig ab</div>'
      +'<input type="month" id="sz-ab-'+i+'" value="'+esc(s.ab)+'"></div>'
      +'<button class="xbtn" title="Zeitraum entfernen" onclick="A.delSatz('+i+')">✕</button></div>'
      +'<div class="two" style="margin-top:8px">'
      +'<div><div class="satz-lab">Fotografisch €/Std</div>'
      +'<input type="number" step="0.01" inputmode="decimal" id="sz-foto-'+i+'" value="'+s.foto+'"></div>'
      +'<div><div class="satz-lab">Ausschank €/Std</div>'
      +'<input type="number" step="0.01" inputmode="decimal" id="sz-aus-'+i+'" value="'+s.ausschank+'"></div>'
      +'</div></div>';
  }).join('');
  b+='<button class="btn btn-line btn-sm" style="margin-bottom:16px" onclick="A.addSatz()">+ Zeitraum hinzufügen</button>';
  b+='<div class="f"><label>Fahrtgeld (€ pro km)</label><input type="number" step="0.01" id="st-kmrate" value="'+settings.kmRate+'"></div>';
  b+='<div class="f"><label>Erst ab … Kilometer</label><input type="number" step="1" id="st-kmfrei" value="'+settings.kmFrei+'"></div>';
  b+='<div class="f"><label>Fahrzeit wird gezählt zu … %</label><input type="number" step="1" id="st-faktor" value="'+Math.round((settings.fahrFaktor||0)*100)+'"></div>';
  b+='<div class="f"><label>Aufträge · Standard-Stundensatz (€)</label><input type="number" step="0.01" id="st-self" value="'+(settings.rateSelf||'')+'"></div>';
  b+='<div class="homelinks" style="margin-top:6px">'
    +'<button class="linkbtn" onclick="A.openTrash()">Papierkorb ('+imPapier().length+')</button>'
    +'<button class="linkbtn" onclick="A.openBackup()">Sicherung</button>'
    +'<button class="linkbtn" onclick="A.openPw()">Passwort ändern</button>'
    +'<button class="linkbtn" style="color:var(--red)" onclick="A.openReset()">Alles löschen</button></div>';
  b+='<div class="ctr" style="margin-top:22px"><div class="hint" style="margin-bottom:8px">Fassung '
    +esc(APP_VERSION)+'</div>'
    +'<button class="btn btn-line btn-sm" id="updbtn" onclick="A.aktualisieren()">Auf neue Fassung prüfen</button>'
    +'<div class="hint" style="margin-top:8px">Holt die Programmdateien frisch vom Server. '
    +'Deine Einträge bleiben dabei unangetastet.</div></div>';
  var acts='<div class="acts"><button class="btn btn-fill" onclick="A.saveSettingsForm()">Speichern</button></div>';
  return shell('Sätze &amp; Einstellungen',b,acts);
}

function sheetTrash(){
  var t=imPapier().sort(function(a,b){return String(b.bearbeitet).localeCompare(String(a.bearbeitet));});
  var b='<div class="hint">Gelöschte Einträge bleiben hier vollständig erhalten. '
    +'Nichts verschwindet von selbst – nur du entfernst hier endgültig.</div>';
  b+= t.length ? t.map(function(e){
      return '<div class="lrow"><div><div class="lrow-t">'+esc(e.client||e.bez||e.was||areaKurz(e.area))+'</div>'
        +'<div class="lrow-s">'+dLang(e.date)+' · '+areaKurz(e.area)+' · '+eur(amountOf(e))+'</div></div>'
        +'<div class="lrow-a"><button class="btn btn-line btn-sm" onclick="A.restoreEntry(\''+e.id+'\')">Zurück</button>'
        +'<button class="btn btn-line btn-sm" style="color:var(--red)" onclick="A.purgeEntry(\''+e.id+'\')">Endgültig</button></div></div>';
    }).join('') : '<div class="empty">Der Papierkorb ist leer.</div>';
  return shell('Papierkorb',b,'<div class="acts"><button class="btn btn-fill" onclick="A.closeSheet()">Schließen</button></div>');
}

function sheetBackup(){
  var json=JSON.stringify(backupObjekt(),null,1);
  var lb=settings.letztesBackup;
  var b='<div class="hint">Ein PDF ist zum Ansehen und Archivieren. Zum <b>Wiederherstellen</b> brauchst du '
    +'eine dieser Datensicherungen.'+(lb?' Letzte Sicherung: <b>'+dLang(lb.slice(0,10))+'</b>.':' Noch keine Sicherung erstellt.')+'</div>';
  b+='<div class="btnrow">'
    +'<button class="btn btn-line btn-sm" onclick="A.exportJSON()">Als Datei laden</button>'
    +'<button class="btn btn-line btn-sm" onclick="A.exportCSV()">CSV-Tabelle</button>'
    +'<button class="btn btn-line btn-sm" onclick="A.pickFile()">Sicherung einspielen</button>'
    +'<button class="btn btn-line btn-sm" onclick="A.openRestore()">Text einfügen</button></div>';
  b+='<div class="hint" style="margin-top:16px"><b>Arbeitszeiten aus der Excel-Liste</b><br>'
    +'Alle Zeilen für Martin seit Juni 2025 aus <i>Martin_Arbeitszeit.xlsx</i> – samt Zahlungsvermerken. '
    +'Der Knopf ergänzt nur; mehrfaches Drücken legt nichts doppelt an.</div>'
    +'<button class="btn btn-line btn-sm" id="xlbtn" onclick="A.importExcel()">Excel-Zeiten einspielen</button>';
  b+='<div class="hint" style="margin-top:16px">Oder den Text kopieren und z. B. in den Notizen ablegen:</div>'
    +'<textarea class="ta" id="bk" readonly onclick="this.select()">'+esc(json)+'</textarea>';
  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Schließen</button>'
    +'<button class="btn btn-fill" id="bkbtn" onclick="A.copyBackup()">Kopieren</button></div>';
  return shell('Sicherung',b,acts);
}
function sheetRestore(){
  var b='<div class="hint">Gesicherten Text einfügen. Die Daten werden <b>ergänzt</b> – vorhandene '
    +'Einträge bleiben erhalten. Auch eine Sicherung aus der alten Fassung passt hier hinein.</div>'
    +'<textarea class="ta" id="rs" placeholder="{ … }"></textarea><div class="err" id="rserr"></div>';
  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +'<button class="btn btn-fill" onclick="A.applyRestore()">Übernehmen</button></div>';
  return shell('Wiederherstellen',b,acts);
}
function sheetReset(){
  var b='<div class="banner">Alle Einträge, Abrechnungen, der Papierkorb <b>und das Passwort</b> werden '
    +'von diesem Gerät entfernt. Ohne vorher geladene Sicherung sind die Daten dann weg.</div>'
    +'<div class="hint" style="margin-top:12px">Betroffen: '+alive().length+' Einträge und '+imPapier().length+' im Papierkorb.</div>'
    +'<label class="check"><input type="checkbox" id="wipeack" onchange="A.checkWipe()"> '
    +'Ich habe eine aktuelle Sicherung (oder brauche keine).</label>'
    +'<div class="f"><label>Zum Bestätigen ALLES LÖSCHEN eintippen</label>'
    +'<input id="wipeword" autocomplete="off" spellcheck="false" oninput="A.checkWipe()"></div>';
  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +'<button class="btn btn-red" id="wipego" disabled onclick="A.doWipe()">Endgültig löschen</button></div>';
  return shell('Alles löschen',b,acts);
}
function sheetPw(){
  var b='<div class="hint">Das neue Passwort gilt ab dem nächsten Entsperren. Die Daten werden damit neu verschlüsselt.</div>'
    +'<div class="f"><label>Aktuelles Passwort</label><input type="password" id="pw-old"></div>'
    +'<div class="f"><label>Neues Passwort (mind. 8 Zeichen)</label><input type="password" id="pw-n1"></div>'
    +'<div class="f"><label>Wiederholen</label><input type="password" id="pw-n2"></div>'
    +'<div class="err" id="pwerr"></div>';
  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +'<button class="btn btn-fill" onclick="A.changePw()">Ändern</button></div>';
  return shell('Passwort ändern',b,acts);
}
function sheetReport(){
  var js=jahre(BEREICHE.indexOf(ui.repBereich)>=0?ui.repBereich:'martin');
  if(!ui.repJahr||js.indexOf(ui.repJahr)<0) ui.repJahr=js[0];
  if(ui.repMonat==='') ui.repMonat=String(new Date().getMonth());
  var b='<div class="hint">Bericht mit Kennzahlen, Diagrammen und der vollständigen Tabelle. '
    +'In der Vorschau auf <b>Drucken</b> und im Druckdialog „Als PDF sichern“ wählen.</div>';
  b+='<div class="f"><label>Bereich</label><select id="rp-bereich" onchange="A.repChange()">'
    +['self','martin','ausgaben','beide'].map(function(x){
      return '<option value="'+x+'"'+(ui.repBereich===x?' selected':'')+'>'
        +(x==='beide'?'Alle Bereiche':areaKurz(x))+'</option>';}).join('')
    +'</select></div>';
  b+='<div class="f"><label>Umfang</label><select id="rp-umfang" onchange="A.repChange()">'
    +[['monat','Einzelner Monat'],['jahr','Ganzes Jahr'],['alles','Alles (Gesamtarchiv)']].map(function(x){
      return '<option value="'+x[0]+'"'+(ui.repUmfang===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')
    +'</select></div>';
  if(ui.repUmfang!=='alles'){
    b+='<div class="two"><div class="f"><label>Jahr</label><select id="rp-jahr" onchange="A.repChange()">'
      +js.map(function(y){return '<option'+(ui.repJahr===y?' selected':'')+'>'+y+'</option>';}).join('')+'</select></div>';
    if(ui.repUmfang==='monat'){
      b+='<div class="f"><label>Monat</label><select id="rp-monat" onchange="A.repChange()">'
        +[0,1,2,3,4,5,6,7,8,9,10,11].map(function(i){
          return '<option value="'+i+'"'+(String(i)===String(ui.repMonat)?' selected':'')+'>'+mName(i)+'</option>';}).join('')+'</select></div>';
    }else b+='<div></div>';
    b+='</div>';
  }
  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +'<button class="btn btn-fill" onclick="A.showReport()">Bericht anzeigen</button></div>';
  return shell('Bericht &amp; PDF',b,acts);
}
function repChange(){
  ui.repBereich=v('rp-bereich')||ui.repBereich;
  ui.repUmfang=v('rp-umfang')||ui.repUmfang;
  if(document.getElementById('rp-jahr')) ui.repJahr=v('rp-jahr');
  if(document.getElementById('rp-monat')) ui.repMonat=v('rp-monat');
  render();
}
function openReport(){
  ui.repBereich=ui.view==='area'?ui.area:ui.repBereich;
  ui.repUmfang=ui.view==='area'&&ui.modus==='jahr'?'jahr':'monat';
  ui.repJahr=ui.jahr||curY();
  ui.repMonat=String(Number((ui.month||curMk()).slice(5,7))-1);
  ui.sheet='report';render();
}

/* ============ bericht ============ */

function repTile(l,val,n){
  return '<div class="rep-tile"><div class="l">'+esc(l)+'</div><div class="v">'+esc(val)+'</div>'
    +(n?'<div class="n">'+esc(n)+'</div>':'')+'</div>';
}

function reportBlock(area,list,titel){
  var s=summe(list);
  var acc=areaHex(area);
  var kacheln = area==='martin'
    ? [['Einträge',String(s.n),titel],['Zeit gesamt',hm(s.zeit)+' Std','tatsächlich gearbeitet'],
       ['Bezahlte Zeit',hm(s.bez)+' Std','Fahrzeit zu '+Math.round((settings.fahrFaktor||0)*100)+' %'],
       ['Gefahrene km',String(s.km)+' km','ab '+(settings.kmFrei||0)+' km vergütet'],
       ['Betrag',eur(s.betrag),'Summe im Zeitraum'],
       ['Davon offen',eur(s.offen),s.offen?'noch nicht abgerechnet':'alles abgerechnet']]
    : area==='ausgaben'
    ? [['Posten',String(s.n),titel],['Ausgaben',eur(s.betrag),'Summe im Zeitraum'],
       ['Mit Beleg',eur(s.belegt),'belegt und ablegbar'],
       ['Ohne Beleg',eur(s.ohneBeleg),s.ohneBeleg?'Beleg nachreichen':'alles belegt'],
       ['Ø je Posten',eur(s.n?s.betrag/s.n:0),'Durchschnitt'],
       ['Größter Posten',eur(Math.max.apply(null,[0].concat(list.map(amountOf)))),'teuerste Anschaffung']]
    : [['Aufträge',String(s.nRel),s.storno?s.storno+' storniert (zählen nicht)':titel],
       ['Honorar',eur(s.betrag),'ohne Stornos'],
       ['Anzahlungen',eur(s.anzahlung),'bereits erhalten'],
       ['Bereits bezahlt',eur(s.betrag-s.offen),'eingegangen'],
       ['Noch offen',eur(s.offen),s.offen?'ausstehend':'alles bezahlt'],
       ['Ø je Auftrag',eur(s.nRel?s.betrag/s.nRel:0),'Durchschnitt']];

  var h='<div class="rep-sec"><h2>'+esc(areaLang(area))+' · Kennzahlen</h2><div class="rep-tiles">'
    +kacheln.map(function(k){return repTile(k[0],k[1],k[2]);}).join('')+'</div></div>';

  if(area==='martin'){
    var nachArt=[
      {label:'Fotografisch',f:function(e){return e.modus==='regulaer'&&e.art==='fotografisch';}},
      {label:'Ausschank',   f:function(e){return e.modus==='regulaer'&&e.art==='ausschank';}},
      {label:'Fahrzeit',    f:function(e){return e.modus==='fahrzeit';}},
      {label:'Fahrtgeld',   f:function(e){return e.modus==='kilometer';}}
    ].map(function(g){
      var sub=list.filter(g.f);
      return {label:g.label,value:add(sub.map(amountOf)),tip:nStk(sub.length,'Zeile','Zeilen')};
    });
    h+='<div class="rep-sec"><h2>Betrag nach Art</h2>'+rowChart(nachArt,{width:1000,color:acc,aria:'Betrag nach Art'})+'</div>';
  }else if(area==='ausgaben'){
    h+='<div class="rep-sec"><h2>Ausgaben nach Kategorie</h2>'
      +rowChart(KATEGORIEN.map(function(x){
        var g=list.filter(function(e){return e.kat===x;});
        return {label:x,value:add(g.map(amountOf)),tip:nStk(g.length,'Posten','Posten')};
      }),{width:1000,color:acc,aria:'Ausgaben nach Kategorie'})+'</div>';
  }else{
    h+='<div class="rep-sec"><h2>Honorar nach Auftragsart</h2>'
      +rowChart(ARTEN.map(function(x){
        var g=list.filter(function(e){return e.art===x&&zaehlt(e);});
        return {label:x,value:add(g.map(amountOf)),tip:nStk(g.length,'Auftrag','Aufträge')};
      }),{width:1000,color:acc,aria:'Honorar nach Auftragsart'})+'</div>';
  }

  h+='<div class="rep-sec"><h2>'+(area==='self'?'Alle Aufträge im Zeitraum'
      :area==='ausgaben'?'Alle Ausgaben im Zeitraum':'Alle Zeilen im Zeitraum')+'</h2>';
  if(!list.length) return h+'<p class="rep-note">In diesem Zeitraum wurde nichts erfasst.</p></div>';

  if(area==='ausgaben'){
    h+='<table class="rep-table"><thead><tr>'
      +'<th>Datum</th><th>Bezeichnung</th><th>Kategorie</th><th>Händler / Anbieter</th>'
      +'<th>Zahlungsart</th><th>Beleg</th><th class="rep-r">Betrag</th><th>Notiz</th></tr></thead><tbody>'
      +list.map(function(e){
        return '<tr><td>'+dShort(e.date)+'</td><td>'+esc(e.bez||'')+'</td><td>'+esc(e.kat)+'</td>'
          +'<td>'+esc(e.haendler||'')+'</td><td>'+esc(e.zahlart||'')+'</td>'
          +'<td>'+(e.beleg?'✓':'fehlt')+'</td>'
          +'<td class="rep-r">'+eur(amountOf(e))+'</td><td>'+esc(e.notiz||'')+'</td></tr>';
      }).join('')
      +'</tbody><tfoot><tr><td colspan="6">SUMME</td>'
      +'<td class="rep-r">'+eur(s.betrag)+'</td><td></td></tr></tfoot></table></div>';
    if(s.ohneBeleg){
      h+='<div class="rep-sec"><h2>Belege nachreichen</h2><table class="rep-table"><tbody>'
        +list.filter(function(e){return !e.beleg;}).map(function(e){
          return '<tr><td>'+dShort(e.date)+'</td><td>'+esc(e.bez||'')+'</td><td>'+esc(e.haendler||'')+'</td>'
            +'<td class="rep-r">'+eur(amountOf(e))+'</td></tr>';}).join('')
        +'</tbody><tfoot><tr><td colspan="3">Summe ohne Beleg</td>'
        +'<td class="rep-r">'+eur(s.ohneBeleg)+'</td></tr></tfoot></table></div>';
    }
    return h;
  }
  if(area==='martin'){
    h+='<table class="rep-table"><thead><tr>'
      +'<th>Art</th><th>Fahrzeit / regulär</th><th>Datum</th><th>Beginn</th><th>Ende</th>'
      +'<th class="rep-r">Zeit</th><th class="rep-r">gefahrene KM</th><th class="rep-r">bezahlte Zeit</th>'
      +'<th class="rep-r">Satz</th><th class="rep-r">Betrag</th>'
      +'<th>Was</th><th>Name Hochzeitspaar</th><th>Kommentar</th><th>Bez.</th></tr></thead><tbody>'
      +list.map(function(e){
        return '<tr><td>'+esc(artLabel(e))+'</td><td>'+esc(modusLabel(e))+'</td><td>'+dShort(e.date)+'</td>'
          +'<td>'+esc(e.start||'')+'</td><td>'+esc(e.end||'')+'</td>'
          +'<td class="rep-r">'+hm(rawHours(e))+'</td>'
          +'<td class="rep-r">'+(kmOf(e)?dec2(kmOf(e))+' km':'')+'</td>'
          +'<td class="rep-r">'+dec2(paidHours(e))+'</td>'
          +'<td class="rep-r">'+(rateOf(e)&&e.modus!=='kilometer'?eur(rateOf(e)):'—')+'</td>'
          +'<td class="rep-r">'+eur(amountOf(e))+'</td>'
          +'<td>'+esc(e.was||'')+'</td><td>'+esc(e.name||'')+'</td>'
          +'<td>'+esc(e.notiz||(e.fotos?e.fotos+' Fotos':''))+'</td>'
          +'<td>'+(e.paid?'✓':'offen')+'</td></tr>';
      }).join('')
      +'</tbody><tfoot><tr><td colspan="5">SUMME</td>'
      +'<td class="rep-r">'+hm(s.zeit)+'</td><td class="rep-r">'+dec2(s.km)+' km</td>'
      +'<td class="rep-r">'+dec2(s.bez)+'</td><td></td><td class="rep-r">'+eur(s.betrag)+'</td>'
      +'<td colspan="4"></td></tr></tfoot></table>';
  }else{
    h+='<table class="rep-table"><thead><tr>'
      +'<th>Datum</th><th>Kunde</th><th>Auftragsart</th><th>Ort</th><th>Was</th>'
      +'<th class="rep-r">Zeit</th><th>Abrechnung</th><th class="rep-r">Honorar</th>'
      +'<th class="rep-r">Anzahlung</th><th class="rep-r">Offen</th>'
      +'<th>Status</th><th>Fotoübergabe</th><th>Rechnungsnr</th><th>Kommentar</th></tr></thead><tbody>'
      +list.map(function(e){
        var st=e.status==='Storniert';
        return '<tr'+(st?' style="color:#9A938A"':'')+'><td>'+dShort(e.date)+'</td><td>'+esc(e.client||'')+'</td>'
          +'<td>'+esc(e.art)+'</td><td>'+esc(e.ort||'')+'</td><td>'+esc(e.was||'')+'</td>'
          +'<td class="rep-r">'+(rawHours(e)?hm(rawHours(e)):'')+'</td>'
          +'<td>'+(e.billing==='hourly'?eur(rateOf(e))+'/Std':'Festbetrag')+'</td>'
          +'<td class="rep-r">'+eur(amountOf(e))+'</td>'
          +'<td class="rep-r">'+(anzOf(e)?eur(anzOf(e)):'')+'</td>'
          +'<td class="rep-r">'+(offenOf(e)?eur(offenOf(e)):'—')+'</td>'
          +'<td>'+esc(e.status)+'</td><td>'+esc(e.uebergabe||'')+'</td><td>'+esc(e.rechnung||'')+'</td>'
          +'<td>'+esc(e.notiz||'')+'</td></tr>';
      }).join('')
      +'</tbody><tfoot><tr><td colspan="7">SUMME (ohne Stornos)</td>'
      +'<td class="rep-r">'+eur(s.betrag)+'</td><td class="rep-r">'+eur(s.anzahlung)+'</td>'
      +'<td class="rep-r">'+eur(s.offen)+'</td>'
      +'<td colspan="4"></td></tr></tfoot></table>';
  }
  h+='</div>';

  var offen=list.filter(function(e){return !e.paid&&zaehlt(e);});
  var wort=area==='self'?['Der einzige Auftrag','Aufträge']:['Die einzige Zeile','Zeilen'];
  if(area==='ausgaben') wort=['Der einzige Posten','Posten'];
  if(offen.length===list.filter(zaehlt).length&&offen.length){
    h+='<div class="rep-sec"><h2>Noch offen</h2><p class="rep-note">'
      +(offen.length===1 ? wort[0]+' dieses Zeitraums ist noch offen: '
                         : 'Alle '+offen.length+' '+wort[1]+' dieses Zeitraums sind noch offen: ')
      +'<b>'+eur(s.offen)+'</b>.</p></div>';
  }else if(offen.length){
    h+='<div class="rep-sec"><h2>Noch offen</h2><table class="rep-table"><tbody>'
      +offen.map(function(e){
        return '<tr><td>'+dShort(e.date)+'</td><td>'+esc(e.client||e.was||'')+'</td>'
          +'<td class="rep-r">'+eur(offenOf(e))+'</td></tr>';}).join('')
      +'</tbody><tfoot><tr><td colspan="2">Summe offen</td><td class="rep-r">'+eur(s.offen)+'</td></tr></tfoot></table></div>';
  }
  return h;
}

function showReport(){
  repChange();
  var bereiche = ui.repBereich==='beide' ? BEREICHE : [ui.repBereich];
  var umfang=ui.repUmfang, jahr=ui.repJahr, monat=Number(ui.repMonat);
  var titel, kurz;

  function listFor(a){
    if(umfang==='monat') return monthEntries(a,jahr+'-'+p2(monat+1));
    if(umfang==='jahr')  return yearEntries(a,jahr);
    return sortEntries(areaEntries(a));
  }
  if(umfang==='monat'){ titel=mLong(jahr+'-'+p2(monat+1)); kurz='Monatsbericht'; }
  else if(umfang==='jahr'){ titel='Jahr '+jahr; kurz='Jahresbericht'; }
  else { titel='Gesamtarchiv'; kurz='Gesamtbericht'; }

  var alleZeilen=[]; bereiche.forEach(function(a){alleZeilen=alleZeilen.concat(listFor(a));});
  var g=summe(alleZeilen);

  var verlauf, vTitel;
  if(umfang==='monat'){
    var tage=new Date(Number(jahr),monat+1,0).getDate();
    verlauf=[];
    for(var i=1;i<=tage;i++){
      var iso=jahr+'-'+p2(monat+1)+'-'+p2(i);
      var w=add(alleZeilen.filter(function(e){return e.date===iso&&zaehlt(e);}).map(amountOf));
      verlauf.push({label:String(i),value:w,tip:dLang(iso)+': '+eur(w)});
    }
    vTitel='Betrag pro Tag';
  }else if(umfang==='jahr'){
    verlauf=[];
    for(var m2=0;m2<12;m2++){
      var key=jahr+'-'+p2(m2+1);
      var w2=add(alleZeilen.filter(function(e){return mk(e.date)===key&&zaehlt(e);}).map(amountOf));
      verlauf.push({label:mMini(key),value:w2,tip:mLong(key)+': '+eur(w2)});
    }
    vTitel='Betrag pro Monat';
  }else{
    var ys={}; alleZeilen.forEach(function(e){ys[e.date.slice(0,4)]=1;});
    verlauf=Object.keys(ys).sort().map(function(y){
      var w3=add(alleZeilen.filter(function(e){return e.date.slice(0,4)===y&&zaehlt(e);}).map(amountOf));
      return {label:y,value:w3,tip:y+': '+eur(w3)};
    });
    vTitel='Betrag pro Jahr';
  }

  var saetzeText=(settings.saetze||[]).map(function(s){
    return mShort(s.ab)+': '+eur0(s.foto)+' / '+eur0(s.ausschank);
  }).join(' · ');

  var h='<div class="rep-head"><div><h1>Auftragsbuch</h1>'
    +'<div class="rep-sub">'+esc(kurz)+' · '+esc(titel)+' · '
    +esc(ui.repBereich==='beide'?'Alle Bereiche':areaLang(ui.repBereich))+'</div></div>'
    +'<div class="rep-meta">Erstellt am '+esc(stamp())+'<br>'+g.n+' Zeilen · '+eur(g.betrag)+'<br>Sicherungsdokument</div></div>';

  h+='<div class="rep-sec"><h2>'+esc(vTitel)+'</h2>'
    +columnChart(verlauf,{width:1000,height:180,aria:vTitel,
        color:bereiche.length===1?areaHex(bereiche[0]):'#3F5D52'})+'</div>';

  bereiche.forEach(function(a){ h+=reportBlock(a,listFor(a),titel); });

  var zahl=payments.filter(function(p){
    if(bereiche.indexOf(p.area)<0) return false;
    if(umfang==='monat') return p.month===jahr+'-'+p2(monat+1);
    if(umfang==='jahr')  return p.month.slice(0,4)===jahr;
    return true;
  });
  if(zahl.length){
    h+='<div class="rep-sec"><h2>Abrechnungen im Zeitraum</h2><table class="rep-table"><thead><tr>'
      +'<th>Datum</th><th>Bereich</th><th>Monat</th><th>Art</th><th class="rep-r">Soll</th>'
      +'<th class="rep-r">Erhalten</th><th class="rep-r">Abweichung</th><th>Notiz</th></tr></thead><tbody>'
      +zahl.map(function(p){
        return '<tr><td>'+dShort(p.date)+'</td><td>'+esc(areaName(p.area))+'</td><td>'+esc(mLong(p.month))+'</td>'
          +'<td>'+esc(p.method||'—')+'</td><td class="rep-r">'+eur(p.soll)+'</td>'
          +'<td class="rep-r">'+eur(p.got)+'</td>'
          +'<td class="rep-r">'+(Math.abs(p.got-p.soll)>0.005?eur(p.got-p.soll):'—')+'</td>'
          +'<td>'+esc(p.note||'')+'</td></tr>';}).join('')
      +'</tbody></table></div>';
  }

  if(bereiche.indexOf('martin')>=0){
    h+='<div class="rep-sec"><h2>Angewandte Sätze</h2><p class="rep-note">'
      +'Fotografisch / Ausschank je Zeitraum — '+esc(saetzeText||'keine hinterlegt')+'. '
      +'Fahrtgeld '+esc(dec2(settings.kmRate))+' € pro km ab '+(settings.kmFrei||0)+' km. '
      +'Fahrzeit zählt zu '+Math.round((settings.fahrFaktor||0)*100)+' %. '
      +'Jede Zeile ist mit dem Satz gerechnet, der an ihrem Datum galt.</p></div>';
  }

  h+='<div class="rep-foot"><span>Auftragsbuch · '+esc(titel)+'</span><span>Erstellt am '+esc(stamp())+'</span></div>';

  document.getElementById('report').innerHTML=h;
  document.getElementById('reportbar-t').textContent='Vorschau · '+kurz+' '+titel;
  ui.sheet=null; ui.repOffen=true;
  document.body.classList.add('report-open');
  document.getElementById('report').hidden=false;
  document.getElementById('reportbar').hidden=false;
  render();
  window.scrollTo(0,0);
}
function closeReport(){
  ui.repOffen=false;
  document.body.classList.remove('report-open');
  document.getElementById('report').hidden=true;
  document.getElementById('reportbar').hidden=true;
}

/* ============ sperre ============ */

function gate(mode,err,hint){
  var set=mode==='set';
  var legacy=set&&legacyVorhanden();
  var fields=set
    ? '<div class="f"><label>Neues Passwort (mind. 8 Zeichen)</label><input type="password" id="pw1"></div>'
      +'<div class="f"><label>Wiederholen</label><input type="password" id="pw2"></div>'
      +'<div class="f"><label>Erinnerungshilfe (optional, unverschlüsselt)</label><input type="text" id="pwhint" maxlength="80"></div>'
    : '<div class="f"><label>Passwort</label><input type="password" id="pw"></div>';
  document.getElementById('app').innerHTML=
    '<div class="wrap" style="min-height:100vh;display:flex;align-items:center"><div style="width:100%">'
    +'<div class="masthead" style="padding-top:0"><div class="mark">'+cameraSVG()+'<span class="mark-title">Auftragsbuch</span></div>'
    +'<div class="mark-rule"></div><div class="mark-sub">'+(set?'Passwort festlegen':'Gesperrt')+'</div></div>'
    +(legacy?'<div class="banner banner-warn">Es liegen bereits Einträge aus der bisherigen Fassung vor. '
       +'Sie werden übernommen und mit diesem Passwort verschlüsselt.</div>':'')
    +(set?'<div class="banner banner-warn" style="margin-bottom:14px"><b>Wichtig:</b> Ohne dieses Passwort '
       +'sind die Daten nicht mehr lesbar. Es gibt keine Wiederherstellung – notiere es sicher.</div>':'')
    +fields
    +(hint?'<div class="hint" style="text-align:center">Erinnerungshilfe: '+esc(hint)+'</div>':'')
    +(err?'<div class="err" style="text-align:center">'+esc(err)+'</div>':'')
    +'<div class="acts"><button class="btn btn-fill" onclick="A.'+(set?'setPw':'checkPw')+'()">'+(set?'Auftragsbuch anlegen':'Entsperren')+'</button></div>'
    +'</div></div>';
  var f=document.getElementById(set?'pw1':'pw');
  if(f){ f.focus();
    f.addEventListener('keydown',function(ev){ if(ev.key==='Enter'){ set?setPw():checkPw(); } }); }
}

function setPw(){
  var a=v('pw1'), b=v('pw2'), hint=v('pwhint').trim();
  if(!a||a.length<8) return gate('set','Bitte mindestens 8 Zeichen verwenden.');
  if(a!==b) return gate('set','Die Passwörter stimmen nicht überein.');
  var salt=crypto.getRandomValues(new Uint8Array(16));
  deriveKey(a,salt,PBKDF2_ITER).then(function(k){
    cryptoKey=k;
    meta={v:3,salt:b64(salt),iter:PBKDF2_ITER,hint:hint,erstellt:nowISO()};
    localStorage.setItem(K_META,JSON.stringify(meta));
    var alt=legacyData();
    if(alt){ adopt(alt); ui.legacyOffen=true; } else { adopt(null); }
    return persist();
  }).then(boot).catch(function(x){ gate('set','Fehler beim Anlegen: '+x.message); });
}
function checkPw(){
  var pw=v('pw');
  try{ meta=JSON.parse(localStorage.getItem(K_META)); }catch(x){ meta=null; }
  if(!meta) return gate('set');
  deriveKey(pw,unb64(meta.salt),meta.iter)
    .then(function(k){ return decryptFrom(localStorage.getItem(K_VAULT),k).then(function(d){ cryptoKey=k; adopt(d); }); })
    .then(boot)
    .catch(function(){ gate('enter','Falsches Passwort.',meta&&meta.hint); });
}
function openPw(){ui.sheet='pw';render();}
function changePw(){
  var er=document.getElementById('pwerr');
  var alt=v('pw-old'), n1=v('pw-n1'), n2=v('pw-n2');
  if(n1!==n2){ er.textContent='Die neuen Passwörter stimmen nicht überein.'; return; }
  if(n1.length<8){ er.textContent='Das neue Passwort braucht mindestens 8 Zeichen.'; return; }
  deriveKey(alt,unb64(meta.salt),meta.iter)
    .then(function(k){ return decryptFrom(localStorage.getItem(K_VAULT),k); })
    .then(function(){
      var salt=crypto.getRandomValues(new Uint8Array(16));
      return deriveKey(n1,salt,PBKDF2_ITER).then(function(k2){
        cryptoKey=k2;
        meta={v:3,salt:b64(salt),iter:PBKDF2_ITER,hint:meta.hint||'',erstellt:meta.erstellt};
        localStorage.setItem(K_META,JSON.stringify(meta));
        return persist();
      });
    })
    .then(function(){ ui.sheet=null; render(); })
    .catch(function(){ er.textContent='Das aktuelle Passwort ist nicht korrekt.'; });
}
function lock(){
  cryptoKey=null; entries=[]; payments=[];
  closeReport(); ui.sheet=null;
  gate('enter',null,meta&&meta.hint);
}
var lockTimer;
function resetLock(){
  clearTimeout(lockTimer);
  if(!cryptoKey) return;
  lockTimer=setTimeout(function(){ if(cryptoKey) lock(); },AUTO_LOCK_MS);
}

/* ============ rahmen ============ */

/* Nach Anlegen und nach jedem Entsperren auf der Startseite beginnen. */
function boot(){
  ui.view='home'; ui.month=curMk(); ui.jahr=curY(); ui.modus='monat';
  render(); resetLock(); autoImport();
}

function render(){
  if(!cryptoKey) return;
  document.documentElement.style.setProperty('--accent', areaFarbe(ui.area));
  document.documentElement.style.setProperty('--accent-soft',
    ui.area==='self'?'var(--self-soft)':ui.area==='ausgaben'?'var(--gold-soft)':'var(--martin-soft)');
  var h = ui.view==='home' ? viewHome() : viewArea();
  h += ui.sheet==='form'? sheetForm() : ui.sheet==='settle'? sheetSettle() : ui.sheet==='settings'? sheetSettings()
     : ui.sheet==='backup'? sheetBackup() : ui.sheet==='restore'? sheetRestore() : ui.sheet==='reset'? sheetReset()
     : ui.sheet==='trash'? sheetTrash() : ui.sheet==='pw'? sheetPw() : ui.sheet==='report'? sheetReport() : '';
  document.getElementById('app').innerHTML=h;
  if(ui.sheet==='form') liveCalc();
  resetLock();
}

window.A={
  go:go,setMonth:setMonth,setJahr:setJahr,setModus:setModus,zuMonat:zuMonat,
  toggleSuche:toggleSuche,onSuche:onSuche,onFilter:onFilter,closeSheet:closeSheet,lock:lock,
  openForm:openForm,saveForm:saveForm,trashEntry:trashEntry,restoreEntry:restoreEntry,purgeEntry:purgeEntry,
  setArea:setArea,setArt:setArt,setModus2:setModus2,setTimeMode:setTimeMode,setBilling:setBilling,liveCalc:liveCalc,
  openSettle:openSettle,doSettle:doSettle,unpay:unpay,
  openSettings:openSettings,saveSettingsForm:saveSettingsForm,addSatz:addSatz,delSatz:delSatz,
  openBackup:openBackup,copyBackup:copyBackup,exportJSON:exportJSON,exportCSV:exportCSV,
  openRestore:openRestore,applyRestore:applyRestore,importDatei:importDatei,pickFile:pickFile,
  importExcel:importExcel,toggleBeleg:toggleBeleg,
  openTrash:openTrash,legacyEntfernen:legacyEntfernen,aktualisieren:aktualisieren,xlWeg:xlWeg,
  openReset:openReset,checkWipe:checkWipe,doWipe:doWipe,
  openPw:openPw,changePw:changePw,setPw:setPw,checkPw:checkPw,
  openReport:openReport,repChange:repChange,showReport:showReport,closeReport:closeReport
};

function start(){
  if(!window.crypto||!window.crypto.subtle){
    document.getElementById('app').innerHTML='<div class="wrap"><div class="masthead"><div class="mark-title">Auftragsbuch</div></div>'
      +'<div class="banner">Dieser Browser stellt die Verschlüsselung nur über <b>https://</b>, '
      +'<b>localhost</b> oder als lokale Datei bereit. Bitte rufe die Seite über eine dieser Adressen auf.</div></div>';
    return;
  }
  try{ localStorage.setItem('ab_t','1'); localStorage.removeItem('ab_t'); }
  catch(x){
    document.getElementById('app').innerHTML='<div class="wrap"><div class="masthead"><div class="mark-title">Auftragsbuch</div></div>'
      +'<div class="banner">Der Browser erlaubt dieser Seite keinen lokalen Speicher. Im privaten Modus '
      +'kann das Auftragsbuch nichts sichern.</div></div>';
    return;
  }
  ['click','keydown','pointerdown'].forEach(function(ev){
    document.addEventListener(ev,resetLock,{passive:true});
  });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&ui.repOffen) closeReport(); });
  document.getElementById('reportprint').addEventListener('click',function(){window.print();});
  document.getElementById('reportback').addEventListener('click',closeReport);

  try{ meta=JSON.parse(localStorage.getItem(K_META)); }catch(x){ meta=null; }
  if(meta&&localStorage.getItem(K_VAULT)) gate('enter',null,meta.hint);
  else gate('set');
}

document.addEventListener('DOMContentLoaded',start);
})();
