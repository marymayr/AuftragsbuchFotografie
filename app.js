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
var DEF_SETTINGS={ kmRate:0.20, kmFrei:20, fahrFaktor:0.5, rateSelf:0, saetze:null,
                   firma:null, kuVorjahr:KU_VORJAHR, kuLaufend:KU_LAUFEND, steuerBasis:'zufluss' };

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

/* Laufende Kosten – einmal hinterlegt, je Fälligkeitsmonat selbst gebucht. */
var INTERVALLE=[['monat','monatlich',1],['quartal','vierteljährlich',3],
                ['halb','halbjährlich',6],['jahr','jährlich',12]];

/* Rechnungen */
var RG_STATUS=['Entwurf','Gestellt','Bezahlt','Storniert'];
var RG_DOT={'Entwurf':'dot-muted','Gestellt':'dot-gold','Bezahlt':'dot-good','Storniert':'dot-red'};
/* Der Hinweis, der bei der Kleinunternehmerregelung auf jede Rechnung gehört. */
var UST19_HINWEIS='Gemäß § 19 UStG (Kleinunternehmerregelung) wird keine Umsatzsteuer berechnet.';
/* Absender und Steuerdaten – stehen auf jeder Rechnung. */
var DEF_FIRMA={
  name:'', zusatz:'', strasse:'', plz:'', ort:'',
  telefon:'', email:'', web:'',
  steuernr:'', ustid:'',
  kontoinhaber:'', iban:'', bic:'', bank:'',
  zahlungsziel:14, kleinunternehmer:true,
  anrede:'Sehr geehrte Damen und Herren,',
  anschreiben:'vielen Dank für den Auftrag. Für meine Leistung stelle ich Ihnen wie vereinbart in Rechnung:',
  /* Nur ein Vorschlag – der Schlusstext lässt sich je Rechnung frei schreiben. */
  schluss:'Bitte überweisen Sie den Betrag von {betrag} ohne Abzug bis zum {faellig} auf folgendes Konto:\n'
         +'{kontoinhaber} · IBAN {iban} · {bank}\n\n'
         +'Herzlichen Dank für Ihr Vertrauen.\n\n'
         +'Mit freundlichen Grüßen\n{name}'
};
/* Grenzen der Kleinunternehmerregelung nach § 19 UStG (Stand 2025):
   Vorjahresumsatz höchstens 25.000 €, laufendes Jahr höchstens 100.000 €.
   Beide Werte lassen sich in den Einstellungen nachziehen. */
var KU_VORJAHR=25000, KU_LAUFEND=100000;

var IMPORT_DATEI='daten/martin-arbeitszeit.json';
var APP_VERSION='v14 · 19.09.2026';
/* Kennzeichen des Excel-Stands. Wird nach dem einmaligen Übernehmen in den
   Einstellungen vermerkt, damit es nicht bei jedem Start erneut passiert. */
var XL_STAND='martin-arbeitszeit-bezahlt-bis-2026-07-25';

var entries=[], payments=[], rechnungen=[], abos=[], settings={}, cryptoKey=null, meta=null;

var ui={
  view:'home', area:'martin', month:null, jahr:'', modus:'monat',
  sheet:null, editId:null, settleScope:null,
  sucheAn:false, suche:'', fArt:'', fStatus:'',
  fArea:'martin', fArt2:'fotografisch', fModus:'regulaer', fTime:'range', fBilling:'fix',
  errs:{}, draft:{}, saveErr:false, legacyOffen:false, xlNeu:0, xlAkt:0,
  repBereich:'martin', repUmfang:'monat', repJahr:'', repMonat:'', repOffen:false,
  rgId:null, rgSuche:'', rgJahr:'', aboId:null, stJahr:'', stBasis:'zufluss',
  rgWarn:'', aboNeu:0
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
/* Kompakte Darstellung für Kacheln und Summenzeilen: volle Euro, solange
   dabei nichts verloren geht. Krumme Beträge behalten ihre Cent – sonst
   stünde bei 5,49 € nur „5 €“. */
function eur0(n){
  n=Number(n)||0;
  if(Math.abs(n-Math.round(n))>=0.005) return eur(n);
  return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
}
function dec2(n){return new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);}
function hm(d){var neg=d<0;d=Math.abs(d||0);var h=Math.floor(d+1e-9),m=Math.round((d-h)*60);if(m===60){m=0;h++;}return (neg?'-':'')+h+':'+p2(m);}
function add(a){return a.reduce(function(s,n){return s+(Number(n)||0);},0);}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function v(id){var e=document.getElementById(id);return e?e.value:'';}
/* Zahlen so lesen, wie sie auf einer deutschen Tastatur entstehen:
   „5,49“, „5.49“, „1.234,56“ und „1 234,56“ meinen alle dasselbe. */
function num(x){
  var s=String(x==null?'':x).replace(/[\s\u00A0\u202F€]/g,'');
  if(!s) return 0;
  var k=s.lastIndexOf(','), p=s.lastIndexOf('.');
  if(k>=0&&p>=0){
    /* Das zuletzt stehende Zeichen trennt die Nachkommastellen ab. */
    s = k>p ? s.slice(0,k).replace(/\./g,'')+'.'+s.slice(k+1)
            : s.slice(0,p).replace(/,/g,'')+'.'+s.slice(p+1);
  }else if(k>=0){
    s = s.slice(0,k).replace(/,/g,'')+'.'+s.slice(k+1);
  }else if(p>=0 && s.indexOf('.')!==p){
    /* Mehrere Punkte können nur Tausendertrenner sein. */
    s = s.replace(/\./g,'');
  }
  var n=Number(s);
  return isNaN(n)?0:n;
}
/* Geldbeträge auf volle Cent runden – sonst schleppt das Rechnen
   Reste wie 5,490000000000001 mit. */
function cent(n){ return Math.round((Number(n)||0)*100)/100; }
/* Ein Betrag, wie er ins Eingabefeld gehört. Was gerade getippt wird, ist
   eine Zeichenkette und bleibt unangetastet; gespeicherte Zahlen erscheinen
   mit zwei Nachkommastellen. */
function geldWert(x){
  if(x===''||x==null) return '';
  if(typeof x==='string') return x;
  return isNaN(Number(x))?'':dec2(Number(x));
}
/* Geldfelder sind Textfelder, keine Zahlenfelder: <input type="number">
   erklärt „5,49“ für ungültig und liefert dann einen leeren Wert – genau
   deshalb ließen sich bisher nur volle Euro erfassen. */
function geldFeld(id,val,extra){
  return '<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="'+id+'"'
    +' value="'+esc(geldWert(val))+'" placeholder="0,00"'+(extra||'')+'>';
}
/* Für Mengen, Kilometer und Stundensätze – gleiche Tastatur, gleiche Regeln. */
function zahlFeld(id,val,extra,ph){
  return '<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="'+id+'"'
    +' value="'+esc(typeof val==='string'?val:(val===''||val==null?'':String(val).replace('.',',')))+'"'
    +' placeholder="'+esc(ph||'0')+'"'+(extra||'')+'>';
}
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
  return encryptTo({entries:entries,payments:payments,rechnungen:rechnungen,abos:abos,
                    settings:settings,geaendert:nowISO()},cryptoKey)
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
    e.betrag=cent(Number(o.betrag)||0);
    e.haendler=o.haendler||'';
    e.zahlart=ZAHLARTEN.indexOf(o.zahlart)>=0?o.zahlart:'Bankkarte';
    e.beleg=!!o.beleg;
    /* Zählt dieser Posten für die Steuer? Voreingestellt ja. */
    e.steuer=o.steuer!==false;
    /* Von einer laufenden Kostenstelle erzeugt – daran erkennt die App,
       welche Posten sie selbst gebucht hat. */
    if(o.aboId) e.aboId=o.aboId;
    e.timeMode='duration'; e.durH=0; e.durM=0; e.paid=false; e.payment=null;
  }else{
    e.client=o.client||'';
    e.art=ARTEN.indexOf(o.art)>=0?o.art:'Sonstiges';
    e.status=STATUS.indexOf(o.status)>=0?o.status:(o.paid?'Abgeschlossen':'Bestätigt');
    e.ort=o.ort||''; e.telefon=o.telefon||''; e.email=o.email||'';
    e.billing=o.billing==='hourly'?'hourly':'fix';
    e.amount=cent(Number(o.amount)||0); e.rate=cent(Number(o.rate)||0);
    e.anzahlung=cent(Number(o.anzahlung)||0); e.ausgaben=cent(Number(o.ausgaben)||0);
    e.rechnung=o.rechnung||'';
    e.uebergabe=UEBERGABE.indexOf(o.uebergabe)>=0?o.uebergabe:UEBERGABE[0];
    /* Gefälligkeiten für Freunde bekommen hier das Häkchen weg: der Auftrag
       bleibt mit seinem Wert im Buch, taucht aber in der Steuer nicht auf. */
    e.steuer=o.steuer!==false;
    if(o.fotos) e.fotos=Number(o.fotos)||0;
  }
  return e;
}
/* ---- laufende Kosten ---- */
function normAbo(o){
  o=o||{};
  var keys=INTERVALLE.map(function(x){return x[0];});
  return {
    id:o.id||uid(),
    bez:o.bez||'',
    kat:KATEGORIEN.indexOf(o.kat)>=0?o.kat:'Software & Abos',
    betrag:cent(Number(o.betrag)||0),
    haendler:o.haendler||'',
    zahlart:ZAHLARTEN.indexOf(o.zahlart)>=0?o.zahlart:'Bankkarte',
    beleg:o.beleg!==false,
    notiz:o.notiz||'',
    intervall:keys.indexOf(o.intervall)>=0?o.intervall:'monat',
    /* Nur 1 bis 28 – so gibt es den Tag in jedem Monat wirklich. */
    tag:Math.min(28,Math.max(1,Number(o.tag)||1)),
    ab:o.ab||curMk(),
    bis:o.bis||'',
    aktiv:o.aktiv!==false,
    erstellt:o.erstellt||nowISO(),
    bearbeitet:o.bearbeitet||o.erstellt||nowISO(),
    geloescht:!!o.geloescht
  };
}

/* ---- Rechnungen ---- */
function normPosten(p){
  p=p||{};
  return {text:p.text||'', menge:Number(p.menge)||0,
          einheit:p.einheit||'', einzel:cent(Number(p.einzel)||0)};
}
function normRechnung(o){
  o=o||{};
  var r={
    id:o.id||uid(),
    nr:String(o.nr||'').trim(),
    datum:o.datum||today(),
    leistungVon:o.leistungVon||'', leistungBis:o.leistungBis||'',
    status:RG_STATUS.indexOf(o.status)>=0?o.status:'Entwurf',
    kunde:Object.assign({name:'',zusatz:'',strasse:'',plz:'',ort:'',email:''},o.kunde||{}),
    posten:(Array.isArray(o.posten)?o.posten:[]).map(normPosten),
    anzahlung:cent(Number(o.anzahlung)||0),
    zahlungsziel:Math.max(0,Number(o.zahlungsziel)||0),
    bezahltAm:o.bezahltAm||'',
    anrede:o.anrede==null?'Sehr geehrte Damen und Herren,':String(o.anrede),
    anschreiben:o.anschreiben==null?'':String(o.anschreiben),
    schluss:o.schluss==null?'':String(o.schluss),
    kleinunternehmer:o.kleinunternehmer!==false,
    auftragId:o.auftragId||'',
    notiz:o.notiz||'',
    erstellt:o.erstellt||nowISO(),
    bearbeitet:o.bearbeitet||o.erstellt||nowISO(),
    geloescht:!!o.geloescht
  };
  if(!r.posten.length) r.posten=[normPosten({})];
  return r;
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
  out.saetze=sz.map(function(x){return {ab:x.ab||curMk(),foto:cent(Number(x.foto)||0),ausschank:cent(Number(x.ausschank)||0)};})
    .sort(function(a,b){return a.ab.localeCompare(b.ab);});
  out.firma=Object.assign({},DEF_FIRMA,out.firma||{});
  out.firma.zahlungsziel=Math.max(0,Number(out.firma.zahlungsziel)||0);
  out.kuVorjahr=Number(out.kuVorjahr)||KU_VORJAHR;
  out.kuLaufend=Number(out.kuLaufend)||KU_LAUFEND;
  out.steuerBasis=out.steuerBasis==='leistung'?'leistung':'zufluss';
  delete out.rateFoto; delete out.rateAusschank;
  return out;
}
function adopt(d){
  entries=(d&&Array.isArray(d.entries)?d.entries:[]).map(normEntry);
  payments=(d&&Array.isArray(d.payments)?d.payments:[]);
  rechnungen=(d&&Array.isArray(d.rechnungen)?d.rechnungen:[]).map(normRechnung);
  abos=(d&&Array.isArray(d.abos)?d.abos:[]).map(normAbo);
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

/* ============ laufende kosten ============ */

function mPlus(m,n){
  var a=m.split('-').map(Number), d=new Date(a[0],a[1]-1+n,1);
  return d.getFullYear()+'-'+p2(d.getMonth()+1);
}
function tageImMonat(m){
  var a=m.split('-').map(Number);
  return new Date(a[0],a[1],0).getDate();
}
function intervallSchritt(k){
  for(var i=0;i<INTERVALLE.length;i++) if(INTERVALLE[i][0]===k) return INTERVALLE[i][2];
  return 1;
}
function intervallName(k){
  for(var i=0;i<INTERVALLE.length;i++) if(INTERVALLE[i][0]===k) return INTERVALLE[i][1];
  return 'monatlich';
}
function lebendeAbos(){ return abos.filter(function(a){return !a.geloescht;}); }
/** Was diese Kostenstelle im Jahr kostet – für die Übersicht. */
function aboJahr(a){ return cent(a.betrag*(12/intervallSchritt(a.intervall))); }

/* Alle Monate, für die diese Kostenstelle schon gebucht gehört. Die Zukunft
   bleibt außen vor: gebucht wird erst, was auch fällig war. */
function aboMonate(a){
  var out=[], m=a.ab, ende=curMk(), schritt=intervallSchritt(a.intervall), schutz=0;
  if(a.bis && a.bis<ende) ende=a.bis;
  while(m<=ende && schutz++<1200){ out.push(m); m=mPlus(m,schritt); }
  return out;
}
function aboEintragId(a,m){ return 'abo-'+a.id+'-'+m; }

/* Fehlende Buchungen nachtragen. Die Kennung eines erzeugten Postens steht
   fest – deshalb entsteht nichts doppelt, auch nicht nach einer Sicherung.
   Ein Posten, den du löschst, liegt im Papierkorb und wird nicht neu gebucht. */
function aboLauf(){
  var vorh={}; entries.forEach(function(e){ vorh[e.id]=1; });
  var neu=0;
  lebendeAbos().filter(function(a){return a.aktiv;}).forEach(function(a){
    if(!a.bez||!a.betrag) return;
    aboMonate(a).forEach(function(m){
      var id=aboEintragId(a,m);
      if(vorh[id]) return;
      entries.push(normEntry({
        id:id, area:'ausgaben', aboId:a.id,
        date:m+'-'+p2(Math.min(a.tag,tageImMonat(m))),
        bez:a.bez, kat:a.kat, betrag:a.betrag, haendler:a.haendler,
        zahlart:a.zahlart, beleg:a.beleg, notiz:a.notiz
      }));
      vorh[id]=1; neu++;
    });
  });
  return neu;
}

/* ============ rechnungen ============ */

function rgAlive(){ return rechnungen.filter(function(r){return !r.geloescht;}); }
function rgFuerAuftrag(id){ return rgAlive().filter(function(r){return r.auftragId===id;})[0]||null; }
function rgPapier(){ return rechnungen.filter(function(r){return r.geloescht;}); }
function postenSumme(p){ return cent((Number(p.menge)||0)*(Number(p.einzel)||0)); }
function rgSumme(r){ return cent(add(r.posten.map(postenSumme))); }
function rgOffen(r){
  if(r.status==='Storniert'||r.status==='Bezahlt') return 0;
  return cent(Math.max(0,rgSumme(r)-(Number(r.anzahlung)||0)));
}
function rgZaehlt(r){ return r.status!=='Storniert'; }
/** Zahlungsziel als Datum – steht so auf der Rechnung. */
function rgFaellig(r){
  if(!r.datum) return '';
  var a=r.datum.split('-').map(Number);
  var d=new Date(a[0],a[1]-1,a[2]+(Number(r.zahlungsziel)||0));
  return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
}
function rgUeberfaellig(r){
  return r.status==='Gestellt' && rgFaellig(r) && rgFaellig(r)<today();
}
function rgJahre(){
  var s={}; rgAlive().forEach(function(r){ s[r.datum.slice(0,4)]=1; });
  s[curY()]=1;
  return Object.keys(s).sort().reverse();
}
/* Vorschlag für die nächste Nummer: die zuletzt angelegte Rechnung um eins
   weiterzählen. Vergeben wird sie trotzdem von Hand – der Vorschlag steht
   nur schon im Feld. */
function naechsteNr(){
  var l=rgAlive().filter(function(r){return r.nr;})
    .sort(function(a,b){return String(a.erstellt).localeCompare(String(b.erstellt));});
  var letzte=l.length?l[l.length-1].nr:'';
  if(!letzte) return curY()+'-001';
  var m=String(letzte).match(/^([\s\S]*?)(\d+)(\D*)$/);
  if(!m) return letzte+'-2';
  var z=String(Number(m[2])+1);
  while(z.length<m[2].length) z='0'+z;
  return m[1]+z+m[3];
}
function nrVergeben(nr,ausser){
  nr=String(nr||'').trim().toLowerCase();
  return rgAlive().some(function(r){
    return r.id!==ausser && String(r.nr).trim().toLowerCase()===nr;
  });
}
/* Pflichtangaben einer Rechnung nach § 14 UStG. Bei der Kleinunternehmer-
   regelung entfallen Steuersatz und Steuerbetrag, der Hinweis nach § 19
   UStG tritt an ihre Stelle. */
function firmaLuecken(){
  var f=settings.firma||{}, fehlt=[];
  if(!f.name) fehlt.push('dein Name');
  if(!f.strasse) fehlt.push('deine Straße');
  if(!f.plz||!f.ort) fehlt.push('deine PLZ und Ort');
  if(!f.steuernr&&!f.ustid) fehlt.push('deine Steuernummer');
  return fehlt;
}
function rgLuecken(r){
  var fehlt=firmaLuecken();
  if(!r.nr) fehlt.push('die Rechnungsnummer');
  if(!r.datum) fehlt.push('das Rechnungsdatum');
  if(!r.kunde.name) fehlt.push('der Name des Kunden');
  if(!r.kunde.strasse||!r.kunde.plz||!r.kunde.ort) fehlt.push('die Anschrift des Kunden');
  if(!r.leistungVon) fehlt.push('der Leistungszeitpunkt');
  if(!r.posten.some(function(p){return p.text&&postenSumme(p);})) fehlt.push('mindestens eine Position mit Betrag');
  return fehlt;
}
function rgLeistungText(r){
  if(!r.leistungVon) return '—';
  if(r.leistungBis&&r.leistungBis!==r.leistungVon) return dLang(r.leistungVon)+' – '+dLang(r.leistungBis);
  return dLang(r.leistungVon);
}
function rgSum(list){
  var rel=list.filter(rgZaehlt);
  return {
    n:list.length, nRel:rel.length,
    brutto:cent(add(rel.map(rgSumme))),
    offen:cent(add(rel.map(rgOffen))),
    bezahlt:cent(add(rel.filter(function(r){return r.status==='Bezahlt';}).map(rgSumme))),
    ueberfaellig:cent(add(rel.filter(rgUeberfaellig).map(rgOffen)))
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

/* ============ steuern ============
   Die Übersicht folgt dem Zuflussprinzip: Einnahmen zählen in dem Jahr und
   Monat, in dem das Geld da war, Ausgaben dann, wenn sie bezahlt wurden.
   Wo kein Zahlungsdatum hinterlegt ist, nimmt die App ersatzweise das Datum
   des Eintrags und weist die Summe gesondert aus.
   Einträge ohne Häkchen „zählt für die Steuer" bleiben durchgehend außen vor.
   ================================================================== */

function steuerZaehlt(e){ return e.steuer!==false; }

function einnahmePosten(e){
  var out=[], ges=amountOf(e);
  if(!zaehlt(e)||ges<=0) return out;
  var anz=anzOf(e);
  if(anz>0) out.push({datum:e.date,betrag:anz,art:'Anzahlung',genau:false});
  if(e.paid){
    var rest=cent(ges-anz);
    if(rest>0) out.push({datum:(e.payment&&e.payment.date)||e.date,betrag:rest,art:'Zahlung',
                         genau:!!(e.payment&&e.payment.date)});
  }
  return out;
}
function zuflussJahr(area,y){
  var summe=0;
  areaEntries(area).forEach(function(e){
    if(!steuerZaehlt(e)) return;
    einnahmePosten(e).forEach(function(z){ if(z.datum.slice(0,4)===y) summe+=z.betrag; });
  });
  return cent(summe);
}
function leistungJahr(area,y){
  return cent(add(yearEntries(area,y).filter(function(e){return zaehlt(e)&&steuerZaehlt(e);}).map(amountOf)));
}

/** Einnahmen und Ausgaben eines Jahres, nach Monaten aufgeteilt. */
function steuerJahr(y,basis){
  basis = basis==='leistung' ? 'leistung' : 'zufluss';
  var monate=[];
  for(var i=0;i<12;i++) monate.push({mk:y+'-'+p2(i+1), ein:0, aus:0});
  var idx=function(d){ return Number(d.slice(5,7))-1; };
  var ausEin=0, ausAus=0, ungenau=0;

  areaEntries('self').forEach(function(e){
    if(!zaehlt(e)) return;
    if(basis==='leistung'){
      if(e.date.slice(0,4)!==y) return;
      if(!steuerZaehlt(e)){ ausEin+=amountOf(e); return; }
      monate[idx(e.date)].ein+=amountOf(e);
    }else{
      einnahmePosten(e).forEach(function(z){
        if(z.datum.slice(0,4)!==y) return;
        if(!steuerZaehlt(e)){ ausEin+=z.betrag; return; }
        monate[idx(z.datum)].ein+=z.betrag;
        if(!z.genau) ungenau+=z.betrag;
      });
    }
  });
  yearEntries('ausgaben',y).forEach(function(e){
    if(!steuerZaehlt(e)){ ausAus+=amountOf(e); return; }
    monate[idx(e.date)].aus+=amountOf(e);
  });

  monate.forEach(function(m){ m.ein=cent(m.ein); m.aus=cent(m.aus); m.saldo=cent(m.ein-m.aus); });
  var ein=cent(add(monate.map(function(m){return m.ein;})));
  var aus=cent(add(monate.map(function(m){return m.aus;})));
  return {
    jahr:y, basis:basis, monate:monate,
    einnahmen:ein, ausgaben:aus, gewinn:cent(ein-aus),
    ausgenommenEin:cent(ausEin), ausgenommenAus:cent(ausAus), ungenau:cent(ungenau),
    lohn: basis==='leistung' ? leistungJahr('martin',y) : zuflussJahr('martin',y),
    umsatz: zuflussJahr('self',y), umsatzVor: zuflussJahr('self',String(Number(y)-1)),
    grenzeVor: Number(settings.kuVorjahr)||KU_VORJAHR,
    grenzeLauf: Number(settings.kuLaufend)||KU_LAUFEND
  };
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
  if(view==='rechnungen') return openRechnungen();
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
function closeSheet(){ui.sheet=null;ui.editId=null;ui.rgId=null;ui.rgDraft=null;ui.aboId=null;ui.errs={};render();}

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
  var st=document.getElementById('f-steuer');
  if(st) ui.draft.steuer=st.checked?'1':'0';
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

/* Steht das Häkchen „zählt für die Steuer"? Ohne Feld gilt: ja. */
function steuerHaken(){
  var el=document.getElementById('f-steuer');
  return el ? !!el.checked : true;
}

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
    /* Ein von den laufenden Kosten gebuchter Posten bleibt auch nach dem
       Bearbeiten als solcher erkennbar. */
    if(old&&old.aboId) e.aboId=old.aboId;
    e.steuer=steuerHaken();
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
    e.steuer=steuerHaken();
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
    +'Er lässt sich danach nicht mehr wiederherstellen.'
    +(e.aboId?'\n\nAchtung: Der Posten stammt aus den laufenden Kosten. Beim nächsten Start '
      +'wird er erneut gebucht. Im Papierkorb bliebe er dagegen draußen.':''))) return;
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
  var got=v('s-amount')===''?soll:cent(num(v('s-amount')));
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
    out.push({ab:ab,foto:cent(num(v('sz-foto-'+i))),ausschank:cent(num(v('sz-aus-'+i)))});
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
  settings.kmRate=cent(num(v('st-kmrate')));
  settings.kmFrei=num(v('st-kmfrei'));
  settings.fahrFaktor=num(v('st-faktor'))/100;
  settings.rateSelf=cent(num(v('st-self')));
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
  return {format:'auftragsbuch',schema:5,exportiert:nowISO(),
          entries:entries,payments:payments,rechnungen:rechnungen,abos:abos,settings:settings};
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

/* Das Rechnungsbuch als Tabelle – Nummer für Nummer. */
function exportRgCSV(){
  var q=function(x){return '"'+String(x==null?'':x).replace(/"/g,'""')+'"';};
  var head=['Rechnungsnummer','Rechnungsdatum','Leistungszeitpunkt','Kunde','Zusatz','Straße','PLZ','Ort',
            'E-Mail','Status','Fällig am','Bezahlt am','Positionen','Betrag','Anzahlung','Offen',
            'Kleinunternehmer § 19','Notiz'];
  var rows=rgAlive().slice().sort(function(a,b){return a.datum.localeCompare(b.datum);}).map(function(r){
    return [r.nr, dLang(r.datum), rgLeistungText(r), r.kunde.name, r.kunde.zusatz, r.kunde.strasse,
      r.kunde.plz, r.kunde.ort, r.kunde.email, r.status, dLang(rgFaellig(r)),
      r.bezahltAm?dLang(r.bezahltAm):'',
      r.posten.filter(function(p){return p.text;}).map(function(p){
        return p.text+' ('+dec2(p.menge)+(p.einheit?' '+p.einheit:'')+' × '+dec2(p.einzel)+')';
      }).join(' | '),
      dec2(rgSumme(r)), dec2(r.anzahlung), dec2(rgOffen(r)),
      r.kleinunternehmer?'ja':'nein', (r.notiz||'').replace(/\s*\n\s*/g,' ')].map(q).join(';');
  });
  download('Auftragsbuch-Rechnungen-'+today()+'.csv','\ufeff'+[head.map(q).join(';')].concat(rows).join('\r\n'),
           'text/csv;charset=utf-8');
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
    /* Rechnungen und laufende Kosten wie Einträge: neu dazu, neuere gewinnen. */
    var rv={}; rechnungen.forEach(function(r){rv[r.id]=r;});
    (d.rechnungen||[]).map(normRechnung).forEach(function(r){
      var a=rv[r.id];
      if(!a) rechnungen.push(r); else if(r.bearbeitet>a.bearbeitet) Object.assign(a,r);
    });
    var av={}; abos.forEach(function(x){av[x.id]=x;});
    (d.abos||[]).map(normAbo).forEach(function(x){
      var a=av[x.id];
      if(!a) abos.push(x); else if(x.bearbeitet>a.bearbeitet) Object.assign(a,x);
    });
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
  cryptoKey=null; entries=[]; payments=[]; rechnungen=[]; abos=[];
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
  if(ui.aboNeu&&ui.sheet!=='abos') h+='<div class="banner banner-ok"><b>'+ui.aboNeu+' '
    +(ui.aboNeu===1?'laufender Posten':'laufende Posten')+' nachgebucht.</b> '
    +'Die fälligen Monate stehen jetzt in den Betriebsausgaben. '
    +'<button class="linkbtn" style="color:inherit" onclick="A.openAbos()">Ansehen</button> '
    +'<button class="linkbtn" style="color:inherit" onclick="A.aboWeg()">Verstanden</button></div>';
  if(ui.xlNeu||ui.xlAkt) h+='<div class="banner banner-ok"><b>'
    +(ui.xlNeu?ui.xlNeu+' Arbeitszeiten übernommen.':'Zahlungsstand aktualisiert.')+'</b> '
    +(ui.xlNeu?'Alle Zeilen für Martin aus der Excel-Liste, Juni 2025 bis August 2026. ':'')
    +(ui.xlAkt?ui.xlAkt+' Zeilen bis zum 25.07.2026 als bezahlt gebucht. ':'')
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
    + homeCard('self') + rechnungCard() + homeCard('ausgaben') + '</div>'
    +'<div class="gruppe"><div class="gruppe-t">Anstellung</div>'
    + homeCard('martin') + '</div>'
    +'</div>';
  h+=noteStream();
  h+='<div class="homelinks">'
    +'<button class="linkbtn" onclick="A.openReport()">Bericht &amp; PDF</button>'
    +'<button class="linkbtn" onclick="A.openSteuer()">Einnahmen &amp; Ausgaben</button>'
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
/* Die Rechnungen bekommen auf der Startseite dieselbe Karte wie ein Bereich. */
function rechnungCard(){
  var m=curMk(), y=curY();
  var zeile=function(k,list){
    var st=rgSum(list);
    return '<div class="area-stats"><div class="area-per">'+esc(k)+'</div>'
      +'<div><div class="stat-k">Rechnungen</div><div class="stat-v num">'+st.nRel+'</div></div>'
      +'<div><div class="stat-k">Betrag</div><div class="stat-v num">'+eur0(st.brutto)+'</div></div>'
      +'<div><div class="stat-k">Offen</div><div class="stat-v num" style="color:'
      +(st.offen?'var(--red)':'var(--ink-3)')+'">'+eur0(st.offen)+'</div></div></div>';
  };
  return '<button class="area-card" style="--c:var(--self)" onclick="A.openRechnungen()">'
    +'<span class="chev">›</span>'
    +'<div class="area-name">Rechnungen</div>'
    +'<div class="area-kind">Schreiben, nummerieren, als PDF sichern</div>'
    +zeile(mMini(m)+' '+String(y).slice(2), rgAlive().filter(function(r){return mk(r.datum)===m;}))
    +zeile('Jahr '+y, rgAlive().filter(function(r){return r.datum.slice(0,4)===y;}))
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

/* ============ rechnungsansicht ============ */

function rgSetJahr(y){ ui.rgJahr=y; render(); }
function rgSuche(el){
  ui.rgSuche=el.value;
  var box=document.getElementById('rgbox');
  if(box) box.innerHTML=rgListeHTML();
}
function rgGefiltert(){
  var q=ui.rgSuche.trim().toLowerCase();
  return rgAlive().filter(function(r){
    if(!q && r.datum.slice(0,4)!==ui.rgJahr) return false;
    if(q){
      var hay=[r.nr,r.kunde.name,r.kunde.ort,r.kunde.zusatz,r.status,r.notiz]
        .concat(r.posten.map(function(p){return p.text;})).filter(Boolean).join(' ').toLowerCase();
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  }).sort(function(a,b){
    return b.datum.localeCompare(a.datum)||String(b.nr).localeCompare(String(a.nr));
  });
}
function rgListeHTML(){
  var l=rgGefiltert(), st=rgSum(l);
  if(!l.length) return '<div class="ledger"><div class="empty">'
    +(ui.rgSuche?'Nichts gefunden.':'Für '+ui.rgJahr+' ist noch keine Rechnung angelegt.')+'</div></div>';
  var h='<div class="ledger"><div class="ledger-head">'
    +'<span class="label">'+(ui.rgSuche?'Treffer':'Rechnungen '+ui.rgJahr)+'</span>'
    +'<span class="label">'+nStk(l.length,'Rechnung','Rechnungen')+'</span></div>'
    +l.map(function(r){
      var ueber=rgUeberfaellig(r);
      return '<div class="row" onclick="A.openRg(\''+r.id+'\')">'
        +'<button class="tick '+(r.status==='Bezahlt'?'on':'')+'" title="'
        +(r.status==='Bezahlt'?'Wieder als gestellt führen':'Als bezahlt buchen')+'" '
        +'onclick="A.rgBezahlt(\''+r.id+'\',event)">'+(r.status==='Bezahlt'?'✓':'')+'</button>'
        +'<div class="row-body">'
        +'<div class="row-l1"><span class="row-what">'
        +'<span class="pill" style="background:var(--self);color:#fff">'+esc(r.nr||'ohne Nr.')+'</span>'
        +esc(r.kunde.name||'—')+'</span>'
        +'<span class="row-amt num">'+eur(rgSumme(r))+'</span></div>'
        +'<div class="row-l2"><span class="row-meta">'
        +esc(r.posten.map(function(p){return p.text;}).filter(Boolean)[0]||'—')+'</span>'
        +'<span class="row-time num">'+dShort(r.datum)+'</span></div>'
        +'<div class="row-l2"><span class="badges">'
        +'<span class="badge"><span class="dot '+RG_DOT[r.status]+'"></span>'+esc(r.status)+'</span>'
        +(rgLuecken(r).length?'<span class="badge"><span class="dot dot-red"></span>Pflichtangabe fehlt</span>':'')
        +(ueber?'<span class="badge"><span class="dot dot-red"></span>überfällig seit '+dShort(rgFaellig(r))+'</span>':'')
        +'</span><span class="row-time num">'+(rgOffen(r)?eur(rgOffen(r))+' offen':'')+'</span></div>'
        +'</div>'
        +'<button class="iconbtn" title="Ansehen und drucken" onclick="event.stopPropagation();A.zeigeRechnung(\''+r.id+'\')">▤</button>'
        +'</div>';
    }).join('');
  h+='<div class="sumbar"><div class="sumgrid">'
    +[['Rechnungen',String(st.nRel)],['Bezahlt',eur0(st.bezahlt)],
      ['Offen',eur0(st.offen),st.offen?'var(--red)':''],
      ['Überfällig',eur0(st.ueberfaellig),st.ueberfaellig?'var(--red)':'']]
      .map(function(z){
        return '<div class="sumcell"><div class="stat-k">'+esc(z[0])+'</div>'
          +'<div class="stat-v num"'+(z[2]?' style="color:'+z[2]+'"':'')+'>'+esc(z[1])+'</div></div>';
      }).join('')
    +'</div><div class="total-row"><span class="label">Rechnungsbetrag</span>'
    +'<span class="total-v num">'+eur(st.brutto)+'</span></div></div></div>';
  return h;
}
function viewRechnungen(){
  var js=rgJahre();
  if(js.indexOf(ui.rgJahr)<0) js=js.concat([ui.rgJahr]).sort().reverse();
  var h='<div class="topbar"><div class="topbar-inner"><div class="topbar-row">'
    +'<button class="back" onclick="A.go(\'home\')">‹</button>'
    +'<span class="topbar-title">Rechnungen</span>'
    +'<button class="iconbtn" title="Meine Rechnungsangaben" onclick="A.openFirma()">⚙</button></div>';
  h+='<div class="searchrow"><input id="rgq" type="search" placeholder="Nummer, Kunde, Leistung …" '
    +'value="'+esc(ui.rgSuche)+'" oninput="A.rgSuche(this)"></div>';
  if(!ui.rgSuche.trim()){
    h+='<div class="chips">'+js.map(function(y){
      return '<button class="chip '+(y===ui.rgJahr?'on':'')+'" onclick="A.rgSetJahr(\''+y+'\')">'+y+'</button>';
    }).join('')+'</div>';
  }else h+='<div style="height:9px"></div>';
  h+='</div></div><div class="wrap">';
  if(firmaLuecken().length){
    h+='<div class="banner banner-warn">Bevor du die erste Rechnung verschickst: Es fehlt noch '
      +esc(firmaLuecken().join(', '))+'. '
      +'<div><button class="btn btn-line btn-sm" onclick="A.openFirma()">Angaben ergänzen</button></div></div>';
  }
  h+='<div id="rgbox">'+rgListeHTML()+'</div>';
  h+='<div class="ctr"><button class="linkbtn" onclick="A.openFirma()">Meine Rechnungsangaben</button></div>';
  h+='</div><button class="fab" onclick="A.openRg()">+ Rechnung</button>';
  return h;
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
    +(a==='ausgaben'?'<button class="iconbtn" title="Laufende Kosten" onclick="A.openAbos()">↻</button>':'')
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

/* Die laufenden Kosten gehören sichtbar in die Betriebsausgaben, nicht ans
   Seitenende: hier steht, was in diesem Monat von selbst gebucht wurde. */
function aboLeiste(m){
  var l=lebendeAbos(), aktiv=l.filter(function(a){return a.aktiv;});
  var imMonat=monthEntries('ausgaben',m).filter(function(e){return e.aboId;});
  var summe=cent(add(imMonat.map(amountOf)));
  return '<button class="abobar" onclick="A.openAbos()">'
    +'<span class="chev">›</span>'
    +'<span class="abobar-t">Laufende Kosten</span>'
    +'<span class="abobar-s">'
    +(l.length
       ? nStk(aktiv.length,'Kostenstelle','Kostenstellen')+' aktiv'
         +(imMonat.length
            ? ' · in '+esc(mLong(m))+' gebucht: '+nStk(imMonat.length,'Posten','Posten')
            : ' · in '+esc(mLong(m))+' noch nichts gebucht')
       : 'Software-Abos, Versicherung und alles, was monatlich abgeht – einmal hinterlegen, dann bucht es sich selbst')
    +'</span>'
    +(summe?'<span class="abobar-v num">'+eur(summe)+'</span>':'')
    +'</button>';
}

function monatHTML(a){
  var m=ui.month, es=monthEntries(a,m), h='';
  if(a==='ausgaben') h+=aboLeiste(m);
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
  h+='<div class="ctr"><button class="linkbtn" onclick="A.openReport()">Monatsbericht als PDF sichern</button>'

    +'</div>';
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
        +(e.steuer===false?'<span class="badge"><span class="dot dot-muted"></span>nicht für die Steuer</span>':'')
        +'</span>'
        +'<span class="row-time num">'+(offenOf(e)?eur(offenOf(e))+' offen':'')+'</span></div>'
      : e.area==='ausgaben'
      ? '<div class="row-l2"><span class="badges">'
        +'<span class="badge"><span class="dot '+(e.beleg?'dot-good':'dot-red')+'"></span>'
        +(e.beleg?'Beleg vorhanden':'Beleg fehlt')+'</span>'
        +(e.aboId?'<span class="badge"><span class="dot dot-accent"></span>laufende Kosten</span>':'')
        +(e.steuer===false?'<span class="badge"><span class="dot dot-muted"></span>nicht für die Steuer</span>':'')
        +'</span><span></span></div>'
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
      +geldFeld('f-betrag',g('betrag','betrag'),' oninput="A.liveCalc()"')
      +(errs.betrag?'<div class="err">'+errs.betrag+'</div>':'')+'</div>'
      +'<div class="f"><label>Zahlungsart</label><select id="f-zahlart">'
      +optionen(ZAHLARTEN,g('zahlart','zahlart','Bankkarte'))+'</select></div></div>';
    b+='<div class="f"><label>Händler / Anbieter</label>'
      +'<input type="text" id="f-haendler" list="hl" value="'+esc(g('haendler','haendler'))+'" placeholder="z. B. Foto Erhardt">'
      +'<datalist id="hl">'+haendler.map(function(x){return '<option value="'+esc(x)+'"></option>';}).join('')+'</datalist></div>';
    var belegAn = ui.draft.beleg!==undefined ? ui.draft.beleg==='1' : (e?!!e.beleg:false);
    b+='<div class="sw-row" onclick="A.toggleBeleg()"><span>Beleg / Rechnung vorhanden</span>'
      +'<span class="sw"><input type="checkbox" id="f-beleg" '+(belegAn?'checked':'')+' onclick="event.stopPropagation();A.toggleBeleg(this)"><i></i></span></div>';
    b+=steuerZeile(e,'Diese Ausgabe in die Steuerübersicht aufnehmen');
    b+='<div class="calc" id="calc"></div>';
    b+='<div class="f"><label>Notiz</label><textarea id="f-notiz" placeholder="Seriennummer, Verwendungszweck, Garantie …">'+esc(g('notiz','notiz'))+'</textarea></div>';
    var actsA='<div class="acts">'
      +'<button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
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
    b+='<div class="f"><label>Gefahrene Kilometer</label>'+zahlFeld('f-km',g('km','km'),' oninput="A.liveCalc()"')
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
      b+=geldFeld('f-amount',g('amount','amount'),' oninput="A.liveCalc()" placeholder="Honorar in €"')
        +(errs.amount?'<div class="err">'+errs.amount+'</div>':'');
    }else{
      b+=geldFeld('f-rate',g('rate','rate',settings.rateSelf||''),' oninput="A.liveCalc()" placeholder="€ pro Stunde"')
        +(errs.rate?'<div class="err">'+errs.rate+'</div>':'');
    }
    b+='</div>';
    b+='<div class="f"><label>Anzahlung (€)</label>'
      +geldFeld('f-anz',g('anz','anzahlung'),' oninput="A.liveCalc()"')+'</div>';
    b+='<div class="f"><label>Was</label><input type="text" id="f-was" value="'+esc(g('was','was'))+'" placeholder="z. B. Fotografische Begleitung"></div>';
    b+='<div class="f"><label>Ort</label><input type="text" id="f-ort" value="'+esc(g('ort','ort'))+'" placeholder="z. B. Schlosshof Aichach"></div>';
    b+='<div class="two"><div class="f"><label>Telefon</label><input type="tel" id="f-tel" value="'+esc(g('tel','telefon'))+'"></div>'
      +'<div class="f"><label>E-Mail</label><input type="email" id="f-mail" value="'+esc(g('mail','email'))+'"></div></div>';
    b+='<div class="two"><div class="f"><label>Rechnungsnr.</label><input type="text" id="f-rech" value="'+esc(g('rech','rechnung'))+'"></div>'
      +'<div class="f"><label>Anzahl Fotos</label><input type="number" inputmode="numeric" min="0" id="f-fotos" value="'+g('fotos','fotos')+'"></div></div>';
    b+='<div class="f"><label>Übermittlung der Fotos</label><select id="f-ueber">'
      +optionen(UEBERGABE,g('ueber','uebergabe',UEBERGABE[0]))+'</select></div>';
    b+=steuerZeile(e,'Diesen Auftrag in die Steuerübersicht aufnehmen');
    /* Aus dem Auftrag direkt zur Rechnung – Kunde und Honorar stehen dann schon. */
    if(ui.editId){
      var rg=rgFuerAuftrag(ui.editId);
      b+='<div class="btnrow" style="margin-bottom:14px">'
        + (rg
            ? '<button class="btn btn-line btn-sm" onclick="A.openRg(\''+rg.id+'\')">Rechnung '+esc(rg.nr)+' öffnen</button>'
              +'<button class="btn btn-line btn-sm" onclick="A.zeigeRechnung(\''+rg.id+'\')">Rechnung ansehen</button>'
            : '<button class="btn btn-line btn-sm" onclick="A.rgAusAuftrag(\''+ui.editId+'\')">Rechnung zu diesem Auftrag schreiben</button>')
        +'</div>'
        +(rg?'':'<div class="hint" style="margin-top:-8px">Kunde, Leistung und Honorar werden übernommen. '
          +'Änderungen an diesem Auftrag bitte vorher speichern.</div>');
    }
  }

  b+='<div class="f"><label>Notiz</label><textarea id="f-notiz" placeholder="Besonderheiten, Absprachen …">'+esc(g('notiz','notiz'))+'</textarea></div>';

  var acts='<div class="acts">'
    +'<button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +(ui.editId?'<button class="btn btn-line" style="color:var(--red)" onclick="A.trashEntry()">Papierkorb</button>':'')
    +'<button class="btn btn-fill" onclick="A.saveForm()">Speichern</button></div>';
  return shell(ui.editId?'Bearbeiten':(ui.fArea==='self'?'Neuer Auftrag':'Neuer Eintrag'),b,acts);
}

function sheetSettle(){
  var t=settleTargets(), soll=add(t.map(offenOf));
  var b='<div class="hint">'+(ui.settleScope?'Einzelner Eintrag':t.length+' offene Einträge in '+mLong(ui.month))+' · Offen <b>'+eur(soll)+'</b></div>';
  b+='<div class="f"><label>Tatsächlich erhalten</label>'+geldFeld('s-amount',soll)+'</div>';
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
      +geldFeld('sz-foto-'+i,s.foto)+'</div>'
      +'<div><div class="satz-lab">Ausschank €/Std</div>'
      +geldFeld('sz-aus-'+i,s.ausschank)+'</div>'
      +'</div></div>';
  }).join('');
  b+='<button class="btn btn-line btn-sm" style="margin-bottom:16px" onclick="A.addSatz()">+ Zeitraum hinzufügen</button>';
  b+='<div class="f"><label>Fahrtgeld (€ pro km)</label>'+geldFeld('st-kmrate',settings.kmRate)+'</div>';
  b+='<div class="f"><label>Erst ab … Kilometer</label>'+zahlFeld('st-kmfrei',settings.kmFrei)+'</div>';
  b+='<div class="f"><label>Fahrzeit wird gezählt zu … %</label>'+zahlFeld('st-faktor',Math.round((settings.fahrFaktor||0)*100))+'</div>';
  b+='<div class="f"><label>Aufträge · Standard-Stundensatz (€)</label>'+geldFeld('st-self',settings.rateSelf||'')+'</div>';
  b+='<div class="homelinks" style="margin-top:6px">'
    +'<button class="linkbtn" onclick="A.openAbos()">Laufende Kosten ('+lebendeAbos().length+')</button>'
    +'<button class="linkbtn" onclick="A.openFirma()">Meine Rechnungsangaben</button>'
    +'<button class="linkbtn" onclick="A.openSteuer()">Einnahmen &amp; Ausgaben (Steuer)</button>'
    +'<button class="linkbtn" onclick="A.openTrash()">Papierkorb ('+(imPapier().length+rgPapier().length)+')</button>'
    +'<button class="linkbtn" onclick="A.openBackup()">Sicherung</button>'
    +'<button class="linkbtn" onclick="A.openPw()">Passwort ändern</button>'
    +'<button class="linkbtn" style="color:var(--red)" onclick="A.openReset()">Alles löschen</button></div>';
  b+='<div class="ctr" style="margin-top:22px"><div class="hint" style="margin-bottom:8px">Fassung '
    +esc(APP_VERSION)+'</div>'
    +'<button class="btn btn-line btn-sm" id="updbtn" onclick="A.aktualisieren()">Auf neue Fassung prüfen</button>'
    +'<div class="hint" style="margin-top:8px">Holt die Programmdateien frisch vom Server. '
    +'Deine Einträge bleiben dabei unangetastet.</div></div>';
  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +'<button class="btn btn-fill" onclick="A.saveSettingsForm()">Speichern</button></div>';
  return shell('Sätze &amp; Einstellungen',b,acts);
}

/* ---- laufende Kosten ---- */

function openAbos(){ ui.sheet='abos'; ui.aboId=null; ui.errs={}; render(); }
function openAbo(id){ ui.aboId=id||null; ui.sheet='abo'; ui.errs={}; render(); }

function saveAbo(){
  var alt=ui.aboId?abos.find(function(x){return x.id===ui.aboId;}):null;
  var a=normAbo({
    id:ui.aboId||uid(),
    bez:v('ab-bez').trim(), kat:v('ab-kat'), betrag:num(v('ab-betrag')),
    haendler:v('ab-haendler').trim(), zahlart:v('ab-zahlart'),
    intervall:v('ab-int'), tag:num(v('ab-tag')),
    ab:v('ab-ab'), bis:v('ab-bis'),
    beleg:!!(document.getElementById('ab-beleg')&&document.getElementById('ab-beleg').checked),
    notiz:v('ab-notiz').trim(),
    aktiv:alt?alt.aktiv:true,
    erstellt:alt?alt.erstellt:nowISO(), bearbeitet:nowISO()
  });
  var errs={};
  if(!a.bez) errs.bez='Bezeichnung fehlt';
  if(!a.betrag) errs.betrag='Betrag fehlt';
  if(!a.ab) errs.ab='Erster Monat fehlt';
  if(a.bis&&a.bis<a.ab) errs.bis='Das Ende liegt vor dem Beginn';
  if(Object.keys(errs).length){ ui.errs=errs; render(); return; }

  if(alt) abos=abos.map(function(x){return x.id===a.id?a:x;});
  else abos.push(a);
  var neu=aboLauf();
  ui.aboNeu=neu; ui.sheet='abos'; ui.aboId=null; ui.errs={};
  render(); save();
}
function toggleAbo(id){
  var a=abos.find(function(x){return x.id===id;});
  if(!a) return;
  a.aktiv=!a.aktiv; a.bearbeitet=nowISO();
  if(a.aktiv) ui.aboNeu=aboLauf();
  render(); save();
}
function delAbo(id){
  var a=abos.find(function(x){return x.id===id;});
  if(!a) return;
  var gebucht=entries.filter(function(e){return e.aboId===id&&!e.geloescht;}).length;
  if(!confirm('„'+a.bez+'“ aus den laufenden Kosten entfernen?\n\n'
    +'Es wird nichts mehr gebucht. Die bereits gebuchten '+gebucht+' Posten bleiben '
    +'erhalten – sie sind ja tatsächlich angefallen.')) return;
  a.geloescht=true; a.aktiv=false; a.bearbeitet=nowISO();
  render(); save();
}
function aboWeg(){ ui.aboNeu=0; render(); }

function sheetAbos(){
  var l=lebendeAbos().sort(function(a,b){
    return (b.aktiv?1:0)-(a.aktiv?1:0) || a.bez.localeCompare(b.bez);
  });
  var jahrSumme=cent(add(l.filter(function(a){return a.aktiv;}).map(aboJahr)));
  var b='<div class="hint">Was jeden Monat von selbst abgeht – Software-Abos, Versicherung, '
    +'Cloud-Speicher. Einmal hinterlegt, bucht das Auftragsbuch den Posten in jedem '
    +'fälligen Monat selbst in die Betriebsausgaben.</div>';
  if(ui.aboNeu) b+='<div class="banner banner-ok">'+ui.aboNeu+' '
    +(ui.aboNeu===1?'Posten wurde':'Posten wurden')+' nachgebucht. '
    +'<button class="linkbtn" style="color:inherit" onclick="A.aboWeg()">Verstanden</button></div>';
  b+= l.length ? l.map(function(a){
      var monate=a.aktiv?aboMonate(a):[];
      var naechst=a.aktiv?mPlus(monate.length?monate[monate.length-1]:a.ab,intervallSchritt(a.intervall)):'';
      return '<div class="lrow"><div style="min-width:0">'
        +'<div class="lrow-t">'+esc(a.bez)+(a.aktiv?'':' <span style="color:var(--ink-3);font-weight:400">· pausiert</span>')+'</div>'
        +'<div class="lrow-s">'+eur(a.betrag)+' '+esc(intervallName(a.intervall))
        +' · '+eur(aboJahr(a))+' im Jahr</div>'
        +'<div class="lrow-s">'+esc(a.kat)+' · seit '+esc(mLong(a.ab))
        +(a.bis?' bis '+esc(mLong(a.bis)):'')
        +(a.aktiv&&naechst?' · nächste Buchung '+esc(mLong(naechst)):'')+'</div></div>'
        +'<div class="lrow-a"><button class="btn btn-line btn-sm" onclick="A.openAbo(\''+a.id+'\')">Ändern</button>'
        +'<button class="btn btn-line btn-sm" onclick="A.toggleAbo(\''+a.id+'\')">'+(a.aktiv?'Pause':'Weiter')+'</button>'
        +'<button class="btn btn-line btn-sm" style="color:var(--red)" onclick="A.delAbo(\''+a.id+'\')">Ende</button></div></div>';
    }).join('')
    : '<div class="empty">Noch keine laufenden Kosten hinterlegt.</div>';
  if(jahrSumme) b+='<div class="total-row" style="margin-top:14px"><span class="label">Laufend im Jahr</span>'
    +'<span class="total-v num">'+eur(jahrSumme)+'</span></div>';
  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Schließen</button>'
    +'<button class="btn btn-fill" onclick="A.openAbo()">+ Kostenstelle</button></div>';
  return shell('Laufende Kosten',b,acts);
}

function sheetAbo(){
  var a=ui.aboId?abos.find(function(x){return x.id===ui.aboId;}):null;
  var e=ui.errs;
  var haendler=Array.from(new Set(areaEntries('ausgaben').map(function(x){return x.haendler;}).filter(Boolean)));
  var b='<div class="hint">Beispiel: <b>Adobe Lightroom, 5,49 €, monatlich, ab Januar 2026</b>. '
    +'Gebucht wird immer nur bis zum laufenden Monat – die Zukunft bleibt offen.</div>';
  b+='<div class="f"><label>Wofür</label>'
    +'<input type="text" id="ab-bez" value="'+esc(a?a.bez:'')+'" placeholder="z. B. Adobe Lightroom">'
    +(e.bez?'<div class="err">'+e.bez+'</div>':'')+'</div>';
  b+='<div class="two"><div class="f"><label>Betrag (€)</label>'
    +geldFeld('ab-betrag',a?a.betrag:'',' oninput="A.aboCalc()"')
    +(e.betrag?'<div class="err">'+e.betrag+'</div>':'')+'</div>'
    +'<div class="f"><label>Rhythmus</label><select id="ab-int" onchange="A.aboCalc()">'
    +INTERVALLE.map(function(x){
      return '<option value="'+x[0]+'"'+((a?a.intervall:'monat')===x[0]?' selected':'')+'>'+x[1]+'</option>';
    }).join('')+'</select></div></div>';
  b+='<div class="calc" id="abocalc"></div>';
  b+='<div class="two"><div class="f"><label>Kategorie</label><select id="ab-kat">'
    +optionen(KATEGORIEN,a?a.kat:'Software & Abos')+'</select></div>'
    +'<div class="f"><label>Zahlungsart</label><select id="ab-zahlart">'
    +optionen(ZAHLARTEN,a?a.zahlart:'Bankkarte')+'</select></div></div>';
  b+='<div class="two"><div class="f"><label>Erster Monat</label>'
    +'<input type="month" id="ab-ab" value="'+esc(a?a.ab:curMk())+'" onchange="A.aboCalc()">'
    +(e.ab?'<div class="err">'+e.ab+'</div>':'')+'</div>'
    +'<div class="f"><label>Letzter Monat (optional)</label>'
    +'<input type="month" id="ab-bis" value="'+esc(a?a.bis:'')+'" onchange="A.aboCalc()">'
    +(e.bis?'<div class="err">'+e.bis+'</div>':'')+'</div></div>';
  b+='<div class="f"><label>Am wievielten des Monats</label>'
    +zahlFeld('ab-tag',a?a.tag:1,' onchange="A.aboCalc()"','1')
    +'<div class="hint" style="margin:5px 0 0">Nur 1 bis 28 – diesen Tag gibt es in jedem Monat.</div></div>';
  b+='<div class="f"><label>Anbieter</label>'
    +'<input type="text" id="ab-haendler" list="abhl" value="'+esc(a?a.haendler:'')+'" placeholder="z. B. Adobe">'
    +'<datalist id="abhl">'+haendler.map(function(x){return '<option value="'+esc(x)+'"></option>';}).join('')+'</datalist></div>';
  b+='<label class="check"><input type="checkbox" id="ab-beleg" '+((a?a.beleg:true)?'checked':'')+'> '
    +'Beleg liegt vor (z. B. monatliche Rechnung per E-Mail)</label>';
  b+='<div class="f"><label>Notiz</label><textarea id="ab-notiz" placeholder="Vertragsnummer, Kündigungsfrist …">'
    +esc(a?a.notiz:'')+'</textarea></div>';
  var acts='<div class="acts">'
    +'<button class="btn btn-line" onclick="A.openAbos()">Zurück</button>'
    +'<button class="btn btn-fill" onclick="A.saveAbo()">Speichern</button></div>';
  return shell(a?'Laufende Kosten ändern':'Neue laufende Kosten',b,acts);
}

/* Vorschau im Abo-Formular: was das kostet und wie viele Posten entstehen. */
function aboCalc(){
  var el=document.getElementById('abocalc'); if(!el) return;
  var a=normAbo({betrag:num(v('ab-betrag')),intervall:v('ab-int'),
                 ab:v('ab-ab')||curMk(),bis:v('ab-bis'),tag:num(v('ab-tag'))});
  if(!a.betrag){ el.innerHTML='Betrag eintragen – dann steht hier, was im Jahr zusammenkommt.'; return; }
  var mon=aboMonate(a), fehlt=0;
  if(ui.aboId) mon.forEach(function(m){
    if(!entries.some(function(x){return x.id==='abo-'+ui.aboId+'-'+m;})) fehlt++;
  }); else fehlt=mon.length;
  el.innerHTML='<b>'+eur(a.betrag)+'</b> '+esc(intervallName(a.intervall))
    +' &middot; <b>'+eur(aboJahr(a))+'</b> im Jahr'
    +(mon.length?' &middot; '+nStk(mon.length,'fälliger Monat','fällige Monate')+' seit '+esc(mLong(a.ab)):'')
    +(fehlt?' &middot; '+nStk(fehlt,'Posten wird','Posten werden')+' nachgebucht':'');
}

/* ---- Rechnungen: anlegen und bearbeiten ---- */

function openRechnungen(){ ui.view='rechnungen'; ui.rgJahr=ui.rgJahr||curY(); ui.rgSuche=''; render(); }

function leereRechnung(){
  var f=settings.firma||{};
  return normRechnung({
    nr:naechsteNr(), datum:today(), leistungVon:today(),
    zahlungsziel:f.zahlungsziel, anrede:f.anrede,
    anschreiben:f.anschreiben, schluss:f.schluss,
    kleinunternehmer:f.kleinunternehmer!==false
  });
}
function openRg(id){
  var r=id?rechnungen.find(function(x){return x.id===id;}):null;
  ui.rgDraft = r ? normRechnung(JSON.parse(JSON.stringify(r))) : leereRechnung();
  ui.rgId = r?r.id:null;
  ui.sheet='rg'; ui.errs={}; render();
}
/* Aus einem Auftrag heraus – Kunde, Leistung und Betrag stehen dann schon da. */
function rgAusAuftrag(id){
  var e=entries.find(function(x){return x.id===id;});
  if(!e) return;
  var r=leereRechnung();
  r.kunde.name=e.client||'';
  r.kunde.ort=e.ort||'';
  r.kunde.email=e.email||'';
  r.leistungVon=e.date; r.leistungBis=e.date;
  r.auftragId=e.id;
  r.anzahlung=anzOf(e);
  r.posten=[normPosten({text:e.was||('Fotoauftrag · '+e.art), menge:1, einheit:'Pauschale', einzel:amountOf(e)})];
  if(e.billing==='hourly'&&paidHours(e)>0)
    r.posten=[normPosten({text:e.was||('Fotoauftrag · '+e.art), menge:Math.round(paidHours(e)*100)/100,
                          einheit:'Std', einzel:rateOf(e)})];
  ui.rgDraft=r; ui.rgId=null; ui.sheet='rg'; ui.errs={}; render();
}

/* Alles aus dem Formular in den Entwurf zurückschreiben – vor jedem
   Neuzeichnen, damit Getipptes nicht verloren geht. */
function rgLese(){
  var r=ui.rgDraft; if(!r) return;
  r.nr=v('rg-nr').trim(); r.datum=v('rg-datum');
  r.leistungVon=v('rg-lvon'); r.leistungBis=v('rg-lbis');
  r.status=v('rg-status')||'Entwurf';
  r.zahlungsziel=Math.max(0,num(v('rg-ziel')));
  r.anzahlung=cent(num(v('rg-anz')));
  r.bezahltAm=v('rg-bezahlt');
  r.kunde={name:v('rg-kname').trim(), zusatz:v('rg-kzusatz').trim(),
           strasse:v('rg-kstr').trim(), plz:v('rg-kplz').trim(),
           ort:v('rg-kort').trim(), email:v('rg-kmail').trim()};
  r.anrede=v('rg-anrede'); r.anschreiben=v('rg-anschreiben'); r.schluss=v('rg-schluss');
  r.notiz=v('rg-notiz').trim();
  var kl=document.getElementById('rg-kl');
  if(kl) r.kleinunternehmer=kl.checked;
  r.posten=r.posten.map(function(p,i){
    return normPosten({text:v('rg-t-'+i).trim(), menge:num(v('rg-m-'+i)),
                       einheit:v('rg-e-'+i).trim(), einzel:num(v('rg-p-'+i))});
  });
}
function rgPosAdd(){ rgLese(); ui.rgDraft.posten.push(normPosten({menge:1})); render(); }
function rgPosDel(i){
  rgLese();
  if(ui.rgDraft.posten.length<=1) return;
  ui.rgDraft.posten.splice(i,1); render();
}
function saveRg(){
  rgLese();
  var r=ui.rgDraft, errs={};
  if(!r.nr) errs.nr='Rechnungsnummer fehlt';
  else if(nrVergeben(r.nr,ui.rgId)) errs.nr='Diese Rechnungsnummer ist schon vergeben';
  if(!r.datum) errs.datum='Rechnungsdatum fehlt';
  if(!r.kunde.name) errs.kname='Name des Kunden fehlt';
  if(!r.posten.some(function(p){return p.text&&postenSumme(p);})) errs.posten='Mindestens eine Position mit Betrag';
  if(Object.keys(errs).length){ ui.errs=errs; render(); return; }

  r.bearbeitet=nowISO();
  if(ui.rgId) rechnungen=rechnungen.map(function(x){return x.id===ui.rgId?r:x;});
  else rechnungen.push(r);
  /* Die Nummer beim Auftrag vermerken, damit beides zusammenfindet. */
  if(r.auftragId){
    var e=entries.find(function(x){return x.id===r.auftragId;});
    if(e&&e.rechnung!==r.nr){ e.rechnung=r.nr; e.bearbeitet=nowISO(); }
  }
  ui.rgId=null; ui.rgDraft=null; ui.editId=null; ui.sheet=null; ui.view='rechnungen';
  ui.rgJahr=r.datum.slice(0,4);
  render(); save();
}
function trashRg(){
  if(!ui.rgId) return;
  var r=rechnungen.find(function(x){return x.id===ui.rgId;});
  if(!r) return;
  if(!confirm('Rechnung '+r.nr+' in den Papierkorb legen?\n\n'
    +'Eine gestellte Rechnung sollte nicht verschwinden – storniere sie lieber, '
    +'dann bleibt die Nummernfolge lückenlos.')) return;
  r.geloescht=true; r.bearbeitet=nowISO();
  ui.rgId=null; ui.rgDraft=null; ui.sheet=null; render(); save();
}
function rgZurueck(id){
  var r=rechnungen.find(function(x){return x.id===id;});
  if(!r) return;
  r.geloescht=false; r.bearbeitet=nowISO(); render(); save();
}
/* Aus der Liste heraus schnell auf „Bezahlt“ setzen. */
function rgBezahlt(id,ev){
  if(ev) ev.stopPropagation();
  var r=rechnungen.find(function(x){return x.id===id;});
  if(!r) return;
  if(r.status==='Bezahlt'){ r.status='Gestellt'; r.bezahltAm=''; }
  else { r.status='Bezahlt'; r.bezahltAm=today(); }
  r.bearbeitet=nowISO(); render(); save();
}

function rgCalc(){
  var r=ui.rgDraft; if(!r) return;
  r.posten.forEach(function(p,i){
    var el=document.getElementById('rg-s-'+i);
    if(el) el.textContent=eur(cent(num(v('rg-m-'+i))*num(v('rg-p-'+i))));
  });
  var sum=cent(add(r.posten.map(function(p,i){return cent(num(v('rg-m-'+i))*num(v('rg-p-'+i)));})));
  var anz=cent(num(v('rg-anz')));
  var el=document.getElementById('rgcalc');
  if(el) el.innerHTML='Rechnungsbetrag <b>'+eur(sum)+'</b>'
    +(anz?' &middot; abzüglich Anzahlung '+eur(anz)+' &middot; zu zahlen <b>'+eur(cent(sum-anz))+'</b>':'')
    +' &middot; ohne Umsatzsteuer nach § 19 UStG';
  var lb=document.getElementById('rgluecken');
  if(lb){
    rgLese();
    var f=rgLuecken(ui.rgDraft);
    lb.innerHTML = f.length
      ? '<div class="banner banner-warn">Für eine vollständige Rechnung fehlt noch: '+esc(f.join(', '))+'.</div>'
      : '<div class="banner banner-ok">Alle Pflichtangaben sind vorhanden.</div>';
  }
}

function sheetRg(){
  var r=ui.rgDraft; if(!r) return '';
  var e=ui.errs;
  var kunden=Array.from(new Set(areaEntries('self').map(function(x){return x.client;}).filter(Boolean)
    .concat(rgAlive().map(function(x){return x.kunde.name;}).filter(Boolean))));
  var b='';

  if(firmaLuecken().length){
    b+='<div class="banner banner-warn">Deine eigenen Angaben sind noch unvollständig – es fehlt '
      +esc(firmaLuecken().join(', '))+'. Ohne sie ist die Rechnung nicht vorschriftsmäßig. '
      +'<div><button class="btn btn-line btn-sm" onclick="A.openFirma()">Jetzt eintragen</button></div></div>';
  }

  b+='<div class="two" style="margin-top:14px"><div class="f"><label>Rechnungsnummer</label>'
    +'<input type="text" id="rg-nr" value="'+esc(r.nr)+'" autocomplete="off" spellcheck="false">'
    +(e.nr?'<div class="err">'+e.nr+'</div>':'')
    +'<div class="hint" style="margin:5px 0 0">Vorschlag – du vergibst sie selbst. Fortlaufend und nur einmal.</div></div>'
    +'<div class="f"><label>Rechnungsdatum</label>'
    +'<input type="date" id="rg-datum" value="'+esc(r.datum)+'" onchange="A.rgCalc()">'
    +(e.datum?'<div class="err">'+e.datum+'</div>':'')+'</div></div>';

  b+='<div class="label" style="margin:18px 0 7px">Rechnung an</div>';
  b+='<div class="f"><label>Name</label>'
    +'<input type="text" id="rg-kname" list="rgkl" value="'+esc(r.kunde.name)+'" placeholder="Vorname Nachname oder Firma" oninput="A.rgCalc()">'
    +'<datalist id="rgkl">'+kunden.map(function(c){return '<option value="'+esc(c)+'"></option>';}).join('')+'</datalist>'
    +(e.kname?'<div class="err">'+e.kname+'</div>':'')+'</div>';
  b+='<div class="f"><label>Zusatz (optional)</label>'
    +'<input type="text" id="rg-kzusatz" value="'+esc(r.kunde.zusatz)+'" placeholder="z. B. z. Hd. Frau Meier"></div>';
  b+='<div class="f"><label>Straße und Hausnummer</label>'
    +'<input type="text" id="rg-kstr" value="'+esc(r.kunde.strasse)+'" oninput="A.rgCalc()"></div>';
  b+='<div class="two"><div class="f"><label>PLZ</label>'
    +'<input type="text" id="rg-kplz" inputmode="numeric" value="'+esc(r.kunde.plz)+'" oninput="A.rgCalc()"></div>'
    +'<div class="f"><label>Ort</label>'
    +'<input type="text" id="rg-kort" value="'+esc(r.kunde.ort)+'" oninput="A.rgCalc()"></div></div>';
  b+='<div class="f"><label>E-Mail (optional)</label>'
    +'<input type="email" id="rg-kmail" value="'+esc(r.kunde.email)+'"></div>';

  b+='<div class="label" style="margin:18px 0 7px">Leistung</div>';
  b+='<div class="two"><div class="f"><label>Leistung erbracht am</label>'
    +'<input type="date" id="rg-lvon" value="'+esc(r.leistungVon)+'" onchange="A.rgCalc()"></div>'
    +'<div class="f"><label>bis (bei Zeitraum)</label>'
    +'<input type="date" id="rg-lbis" value="'+esc(r.leistungBis)+'" onchange="A.rgCalc()"></div></div>';

  b+=r.posten.map(function(p,i){ return rgPosHTML(p,i,r.posten.length); }).join('');
  b+=(e.posten?'<div class="err" style="margin-bottom:8px">'+e.posten+'</div>':'');
  b+='<button class="btn btn-line btn-sm" style="margin-bottom:16px" onclick="A.rgPosAdd()">+ Position</button>';

  b+='<div class="two"><div class="f"><label>Bereits gezahlte Anzahlung (€)</label>'
    +geldFeld('rg-anz',r.anzahlung,' oninput="A.rgCalc()"')+'</div>'
    +'<div class="f"><label>Zahlungsziel (Tage)</label>'
    +zahlFeld('rg-ziel',r.zahlungsziel,'','14')+'</div></div>';
  b+='<div class="calc" id="rgcalc"></div>';
  b+='<div id="rgluecken"></div>';

  b+='<label class="check" style="margin-top:14px"><input type="checkbox" id="rg-kl" '
    +(r.kleinunternehmer?'checked':'')+'> Hinweis nach § 19 UStG aufdrucken '
    +'(keine Umsatzsteuer, Kleinunternehmerregelung)</label>';

  b+='<div class="two"><div class="f"><label>Status</label><select id="rg-status">'
    +optionen(RG_STATUS,r.status)+'</select></div>'
    +'<div class="f"><label>Bezahlt am (optional)</label>'
    +'<input type="date" id="rg-bezahlt" value="'+esc(r.bezahltAm)+'"></div></div>';

  b+='<div class="label" style="margin:18px 0 7px">Text auf der Rechnung</div>';
  b+='<div class="f"><label>Anrede</label>'
    +'<input type="text" id="rg-anrede" value="'+esc(r.anrede)+'"></div>';
  b+='<div class="f"><label>Einleitung</label><textarea id="rg-anschreiben">'+esc(r.anschreiben)+'</textarea></div>';
  b+='<div class="f"><label>Schlusstext – frei schreibbar</label>'
    +'<textarea id="rg-schluss" style="min-height:150px">'+esc(r.schluss)+'</textarea>'
    +platzhalterHilfe()+'</div>';
  b+='<div class="f"><label>Interne Notiz (steht nicht auf der Rechnung)</label>'
    +'<textarea id="rg-notiz">'+esc(r.notiz)+'</textarea></div>';

  var acts='<div class="acts">'
    +'<button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +(ui.rgId?'<button class="btn btn-line" style="color:var(--red)" onclick="A.trashRg()">Papierkorb</button>':'')
    +'<button class="btn btn-line" onclick="A.vorschauRg()">Vorschau</button>'
    +'<button class="btn btn-fill" onclick="A.saveRg()">Speichern</button></div>';
  return shell(ui.rgId?'Rechnung '+esc(r.nr):'Neue Rechnung',b,acts);
}

/* Das Häkchen, mit dem ein Eintrag aus der Steuerübersicht bleibt. */
function steuerZeile(e,text){
  var an = ui.draft.steuer!==undefined ? ui.draft.steuer==='1' : (e?e.steuer!==false:true);
  return '<label class="check" style="margin-bottom:6px"><input type="checkbox" id="f-steuer" '
    +(an?'checked':'')+'> '+esc(text)+'</label>'
    +'<div class="hint" style="margin-top:-6px">Häkchen weg für Gefälligkeiten: der Eintrag bleibt mit '
    +'seinem Wert im Buch, taucht in der Steuerübersicht aber nicht auf.</div>';
}

/* Unter dem Schlusstext: was die App an Platzhaltern einsetzt. Alles andere
   am Text bestimmst du – es gibt keine fest eingebaute Grußformel mehr. */
function platzhalterHilfe(){
  return '<div class="hint platzhalter">Alles hier ist frei – auch die Grußformel. '
    +'Zeilenumbrüche bleiben, wie du sie schreibst. Diese Kürzel füllt die App beim Drucken aus:'
    +'<span class="platzliste">'
    + RG_PLATZ.map(function(x){
        return '<span><code>'+esc(x[0])+'</code> '+esc(x[1])+'</span>';
      }).join('')
    +'</span></div>';
}

function rgPosHTML(p,i,n){
  return '<div class="satzrow"><div class="satz-top">'
    +'<div style="flex:1"><div class="satz-lab">Position '+(i+1)+' · Art und Umfang der Leistung</div>'
    +'<input type="text" id="rg-t-'+i+'" value="'+esc(p.text)+'" placeholder="z. B. Fotografische Begleitung der Trauung"></div>'
    +(n>1?'<button class="xbtn" title="Position entfernen" onclick="A.rgPosDel('+i+')">✕</button>':'')
    +'</div><div class="three" style="margin-top:8px">'
    +'<div><div class="satz-lab">Menge</div>'+zahlFeld('rg-m-'+i,p.menge,' oninput="A.rgCalc()"','1')+'</div>'
    +'<div><div class="satz-lab">Einheit</div>'
    +'<input type="text" id="rg-e-'+i+'" value="'+esc(p.einheit)+'" placeholder="Std / Stk"></div>'
    +'<div><div class="satz-lab">Einzelpreis €</div>'+geldFeld('rg-p-'+i,p.einzel,' oninput="A.rgCalc()"')+'</div>'
    +'<div style="text-align:right;min-width:78px"><div class="satz-lab">Summe</div>'
    +'<div class="num" id="rg-s-'+i+'" style="font-weight:600;padding-top:8px">'+eur(postenSumme(p))+'</div></div>'
    +'</div></div>';
}

/* ---- eigene Angaben: Absender, Steuernummer, Bankverbindung ---- */

function openFirma(){ ui.sheet='firma'; ui.errs={}; render(); }
function saveFirma(){
  var f=Object.assign({},settings.firma||DEF_FIRMA);
  f.name=v('fi-name').trim(); f.zusatz=v('fi-zusatz').trim();
  f.strasse=v('fi-strasse').trim(); f.plz=v('fi-plz').trim(); f.ort=v('fi-ort').trim();
  f.telefon=v('fi-tel').trim(); f.email=v('fi-mail').trim(); f.web=v('fi-web').trim();
  f.steuernr=v('fi-stnr').trim(); f.ustid=v('fi-ustid').trim();
  f.kontoinhaber=v('fi-inhaber').trim(); f.iban=v('fi-iban').trim().toUpperCase();
  f.bic=v('fi-bic').trim().toUpperCase(); f.bank=v('fi-bank').trim();
  f.zahlungsziel=Math.max(0,num(v('fi-ziel')));
  f.anrede=v('fi-anrede'); f.anschreiben=v('fi-anschreiben'); f.schluss=v('fi-schluss');
  var kl=document.getElementById('fi-kl');
  f.kleinunternehmer=kl?kl.checked:true;
  settings.firma=f;
  settings.kuVorjahr=num(v('fi-kuvor'))||KU_VORJAHR;
  settings.kuLaufend=num(v('fi-kulauf'))||KU_LAUFEND;
  ui.sheet=null; render(); save();
}
function sheetFirma(){
  var f=Object.assign({},DEF_FIRMA,settings.firma||{});
  var b='<div class="hint">Diese Angaben stehen auf jeder Rechnung. Nach § 14 UStG gehören '
    +'dein vollständiger Name, deine Anschrift und deine Steuernummer dazu.</div>';
  b+='<div class="f"><label>Name (wie im Gewerbe angemeldet)</label>'
    +'<input type="text" id="fi-name" value="'+esc(f.name)+'" placeholder="Vorname Nachname"></div>';
  b+='<div class="f"><label>Zusatz (optional)</label>'
    +'<input type="text" id="fi-zusatz" value="'+esc(f.zusatz)+'" placeholder="z. B. Fotografie"></div>';
  b+='<div class="f"><label>Straße und Hausnummer</label>'
    +'<input type="text" id="fi-strasse" value="'+esc(f.strasse)+'"></div>';
  b+='<div class="two"><div class="f"><label>PLZ</label>'
    +'<input type="text" id="fi-plz" inputmode="numeric" value="'+esc(f.plz)+'"></div>'
    +'<div class="f"><label>Ort</label><input type="text" id="fi-ort" value="'+esc(f.ort)+'"></div></div>';
  b+='<div class="two"><div class="f"><label>Telefon</label>'
    +'<input type="tel" id="fi-tel" value="'+esc(f.telefon)+'"></div>'
    +'<div class="f"><label>E-Mail</label><input type="email" id="fi-mail" value="'+esc(f.email)+'"></div></div>';
  b+='<div class="f"><label>Webseite (optional)</label>'
    +'<input type="text" id="fi-web" value="'+esc(f.web)+'"></div>';

  b+='<div class="label" style="margin:18px 0 7px">Steuer</div>';
  b+='<div class="two"><div class="f"><label>Steuernummer</label>'
    +'<input type="text" id="fi-stnr" value="'+esc(f.steuernr)+'" placeholder="z. B. 123/456/78901"></div>'
    +'<div class="f"><label>USt-IdNr. (falls vorhanden)</label>'
    +'<input type="text" id="fi-ustid" value="'+esc(f.ustid)+'"></div></div>';
  b+='<label class="check"><input type="checkbox" id="fi-kl" '+(f.kleinunternehmer?'checked':'')+'> '
    +'Kleinunternehmer nach § 19 UStG – keine Umsatzsteuer ausweisen</label>';
  b+='<div class="hint" style="margin-top:-4px">Neue Rechnungen tragen dann von selbst den Hinweis: '
    +'<i>'+esc(UST19_HINWEIS)+'</i></div>';
  b+='<div class="two"><div class="f"><label>Grenze Vorjahresumsatz (€)</label>'
    +geldFeld('fi-kuvor',Number(settings.kuVorjahr)||KU_VORJAHR)+'</div>'
    +'<div class="f"><label>Grenze laufendes Jahr (€)</label>'
    +geldFeld('fi-kulauf',Number(settings.kuLaufend)||KU_LAUFEND)+'</div></div>';
  b+='<div class="hint" style="margin-top:-4px">Stand 2025: 25.000 € im Vorjahr, 100.000 € im laufenden Jahr. '
    +'Ändert der Gesetzgeber die Beträge, trägst du sie hier nach.</div>';

  b+='<div class="label" style="margin:18px 0 7px">Bankverbindung</div>';
  b+='<div class="f"><label>Kontoinhaber</label>'
    +'<input type="text" id="fi-inhaber" value="'+esc(f.kontoinhaber)+'"></div>';
  b+='<div class="f"><label>IBAN</label>'
    +'<input type="text" id="fi-iban" value="'+esc(f.iban)+'" spellcheck="false" autocapitalize="characters"></div>';
  b+='<div class="two"><div class="f"><label>BIC</label>'
    +'<input type="text" id="fi-bic" value="'+esc(f.bic)+'" spellcheck="false" autocapitalize="characters"></div>'
    +'<div class="f"><label>Bank</label><input type="text" id="fi-bank" value="'+esc(f.bank)+'"></div></div>';

  b+='<div class="label" style="margin:18px 0 7px">Vorgaben für neue Rechnungen</div>';
  b+='<div class="f"><label>Zahlungsziel (Tage)</label>'+zahlFeld('fi-ziel',f.zahlungsziel,'','14')+'</div>';
  b+='<div class="f"><label>Anrede</label><input type="text" id="fi-anrede" value="'+esc(f.anrede)+'"></div>';
  b+='<div class="f"><label>Einleitung</label><textarea id="fi-anschreiben">'+esc(f.anschreiben)+'</textarea></div>';
  b+='<div class="f"><label>Schlusstext – frei schreibbar</label>'
    +'<textarea id="fi-schluss" style="min-height:150px">'+esc(f.schluss)+'</textarea>'
    +platzhalterHilfe()+'</div>';

  var acts='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
    +'<button class="btn btn-fill" onclick="A.saveFirma()">Speichern</button></div>';
  return shell('Meine Rechnungsangaben',b,acts);
}

function sheetTrash(){
  var t=imPapier().sort(function(a,b){return String(b.bearbeitet).localeCompare(String(a.bearbeitet));});
  var b='<div class="hint">Gelöschte Einträge bleiben hier vollständig erhalten. '
    +'Nichts verschwindet von selbst – nur du entfernst hier endgültig.</div>';
  var tr=rgPapier();
  b+= (t.length||tr.length) ? '' : '<div class="empty">Der Papierkorb ist leer.</div>';
  b+= t.map(function(e){
      return '<div class="lrow"><div><div class="lrow-t">'+esc(e.client||e.bez||e.was||areaKurz(e.area))+'</div>'
        +'<div class="lrow-s">'+dLang(e.date)+' · '+areaKurz(e.area)+' · '+eur(amountOf(e))+'</div></div>'
        +'<div class="lrow-a"><button class="btn btn-line btn-sm" onclick="A.restoreEntry(\''+e.id+'\')">Zurück</button>'
        +'<button class="btn btn-line btn-sm" style="color:var(--red)" onclick="A.purgeEntry(\''+e.id+'\')">Endgültig</button></div></div>';
    }).join('');
  b+= tr.map(function(r){
      return '<div class="lrow"><div><div class="lrow-t">Rechnung '+esc(r.nr||'ohne Nr.')+'</div>'
        +'<div class="lrow-s">'+dLang(r.datum)+' · '+esc(r.kunde.name||'—')+' · '+eur(rgSumme(r))+'</div></div>'
        +'<div class="lrow-a"><button class="btn btn-line btn-sm" onclick="A.rgZurueck(\''+r.id+'\')">Zurück</button></div></div>';
    }).join('');
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
    +'<button class="btn btn-line btn-sm" onclick="A.exportRgCSV()">Rechnungen als CSV</button>'
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
  var steuer=ui.repBereich==='steuer';
  var js=jahre(BEREICHE.indexOf(ui.repBereich)>=0?ui.repBereich:'self');
  if(!ui.repJahr||js.indexOf(ui.repJahr)<0) ui.repJahr=js[0];
  if(ui.repMonat==='') ui.repMonat=String(new Date().getMonth());
  var b='<div class="hint">'
    +(steuer
      ? 'Eine Seite mit Einnahmen und Ausgaben je Monat – für die Steuerberatung. '
        +'Einträge ohne Häkchen <i>„zählt für die Steuer“</i> bleiben außen vor.'
      : 'Bericht mit Kennzahlen, Diagrammen und der vollständigen Tabelle.')
    +' In der Vorschau auf <b>Drucken</b> und im Druckdialog „Als PDF sichern“ wählen.</div>';
  b+='<div class="f"><label>Bereich</label><select id="rp-bereich" onchange="A.repChange()">'
    +['self','martin','ausgaben','beide','steuer'].map(function(x){
      return '<option value="'+x+'"'+(ui.repBereich===x?' selected':'')+'>'
        +(x==='beide'?'Alle Bereiche':x==='steuer'?'Einnahmen und Ausgaben je Monat (Steuer)':areaKurz(x))+'</option>';}).join('')
    +'</select></div>';
  if(steuer){
    b+='<div class="f"><label>Jahr</label><select id="rp-jahr" onchange="A.repChange()">'
      +js.map(function(y){return '<option'+(ui.repJahr===y?' selected':'')+'>'+y+'</option>';}).join('')
      +'</select></div>';
    b+='<div class="f"><label>Einnahmen zählen</label><select id="rp-basis" onchange="A.repChange()">'
      +'<option value="zufluss"'+(ui.stBasis!=='leistung'?' selected':'')+'>nach Zufluss – wann das Geld kam (empfohlen)</option>'
      +'<option value="leistung"'+(ui.stBasis==='leistung'?' selected':'')+'>nach Leistungsdatum – wann gearbeitet wurde</option>'
      +'</select></div>';
    b+='<div class="btnrow"><button class="btn btn-line btn-sm" onclick="A.exportSteuerCSV()">Als CSV laden</button></div>';
    var acts0='<div class="acts"><button class="btn btn-line" onclick="A.closeSheet()">Abbrechen</button>'
      +'<button class="btn btn-fill" onclick="A.zeigeSteuer()">Übersicht anzeigen</button></div>';
    return shell('Einnahmen und Ausgaben',b,acts0);
  }
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
  var vorher=ui.repBereich;
  ui.repBereich=v('rp-bereich')||ui.repBereich;
  if(document.getElementById('rp-basis')) ui.stBasis=v('rp-basis');
  if(ui.repBereich==='steuer'){
    ui.repUmfang='jahr';
    if(document.getElementById('rp-jahr')) ui.repJahr=v('rp-jahr');
    if(vorher!=='steuer') render();
    return;
  }
  if(vorher==='steuer') ui.repUmfang='jahr';
  ui.repUmfang=v('rp-umfang')||ui.repUmfang;
  if(document.getElementById('rp-jahr')) ui.repJahr=v('rp-jahr');
  if(document.getElementById('rp-monat')) ui.repMonat=v('rp-monat');
  render();
}
function openReport(){
  ui.repBereich=ui.view==='area'?ui.area:(ui.repBereich==='steuer'?'self':ui.repBereich);
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

/* ============ steuerübersicht ============
   Kurz und knapp: Einnahmen und Ausgaben je Monat, sonst nichts. Genau das,
   was die Steuerberatung braucht, um damit weiterzuarbeiten.
   ================================================================== */

function openSteuer(){
  ui.repBereich='steuer'; ui.repUmfang='jahr';
  ui.repJahr=ui.repJahr||curY();
  ui.sheet='report'; render();
}

function steuerReportHTML(y,basis){
  var st=steuerJahr(y,basis);
  var zufluss=basis!=='leistung';

  var h='<div class="rep-head"><div><h1>Auftragsbuch</h1>'
    +'<div class="rep-sub">Einnahmen und Ausgaben '+esc(y)+' · Selbstständigkeit</div></div>'
    +'<div class="rep-meta">'+esc(settings.firma&&settings.firma.name?settings.firma.name:'')
    +(settings.firma&&settings.firma.steuernr?'<br>Steuernummer '+esc(settings.firma.steuernr):'')
    +'<br>Erstellt am '+esc(stamp())+'</div></div>';

  h+='<div class="rep-sec"><table class="rep-table st-table"><thead><tr>'
    +'<th>Monat</th><th class="rep-r">Einnahmen</th><th class="rep-r">Ausgaben</th>'
    +'<th class="rep-r">Differenz</th></tr></thead><tbody>'
    +st.monate.map(function(m,i){
      var leer=!m.ein&&!m.aus;
      return '<tr'+(leer?' class="st-leer"':'')+'><td>'+mName(i)+' '+esc(y)+'</td>'
        +'<td class="rep-r">'+(m.ein?eur(m.ein):'—')+'</td>'
        +'<td class="rep-r">'+(m.aus?eur(m.aus):'—')+'</td>'
        +'<td class="rep-r">'+(leer?'—':eur(m.saldo))+'</td></tr>';
    }).join('')
    +'</tbody><tfoot>'
    +'<tr><td>Summe '+esc(y)+'</td><td class="rep-r">'+eur(st.einnahmen)+'</td>'
    +'<td class="rep-r">'+eur(st.ausgaben)+'</td>'
    +'<td class="rep-r">'+eur(st.gewinn)+'</td></tr>'
    +'</tfoot></table></div>';

  var notizen=[];
  notizen.push('Einnahmen gezählt '+(zufluss
    ? 'nach dem Zuflussprinzip – in dem Monat, in dem das Geld eingegangen ist.'
    : 'nach dem Leistungsdatum – in dem Monat, in dem gearbeitet wurde.'));
  notizen.push('Umsatzsteuerfrei nach § 19 UStG (Kleinunternehmerregelung). '
    +'Vereinnahmter Umsatz '+esc(y)+': '+eur(st.umsatz)+' · Vorjahr: '+eur(st.umsatzVor)+'.');
  if(st.lohn) notizen.push('Daneben Bruttoarbeitslohn aus der Anstellung: '+eur(st.lohn)
    +' – gehört in die Anlage N, maßgeblich ist die Lohnsteuerbescheinigung.');
  if(st.ausgenommenEin||st.ausgenommenAus){
    notizen.push('Nicht enthalten, weil im Auftragsbuch nicht als steuerlich relevant angehakt: '
      +(st.ausgenommenEin?eur(st.ausgenommenEin)+' an Einnahmen':'')
      +(st.ausgenommenEin&&st.ausgenommenAus?' und ':'')
      +(st.ausgenommenAus?eur(st.ausgenommenAus)+' an Ausgaben':'')+'.');
  }
  if(zufluss&&st.ungenau) notizen.push('Bei '+eur(st.ungenau)+' ist kein Zahlungsdatum hinterlegt; '
    +'dort steht ersatzweise das Datum des Auftrags.');
  notizen.push('Zusammenstellung aus dem geführten Auftragsbuch, keine Steuerberatung.');

  h+='<div class="rep-sec"><ul class="rep-liste">'
    +notizen.map(function(n){return '<li>'+n+'</li>';}).join('')+'</ul></div>';

  h+='<div class="rep-foot"><span>Auftragsbuch · Einnahmen und Ausgaben '+esc(y)+'</span>'
    +'<span>Erstellt am '+esc(stamp())+'</span></div>';
  return h;
}

/* Dieselben Zahlen als Tabelle, dahinter die einzelnen Zeilen – damit die
   Steuerberatung bei Bedarf nachsehen kann, woraus ein Monat besteht. */
function exportSteuerCSV(){
  var y=ui.repJahr||curY(), st=steuerJahr(y,ui.stBasis);
  var q=function(x){return '"'+String(x==null?'':x).replace(/"/g,'""')+'"';};
  var z=[];
  z.push(['Monat','Einnahmen','Ausgaben','Differenz'].map(q).join(';'));
  st.monate.forEach(function(m,i){
    z.push([mName(i)+' '+y, dec2(m.ein), dec2(m.aus), dec2(m.saldo)].map(q).join(';'));
  });
  z.push(['Summe '+y, dec2(st.einnahmen), dec2(st.ausgaben), dec2(st.gewinn)].map(q).join(';'));
  z.push('');
  z.push(['Einnahmen im Einzelnen','Datum','Kunde','Leistung','Art','Zahlungsdatum belegt','Betrag'].map(q).join(';'));
  areaEntries('self').forEach(function(e){
    if(!zaehlt(e)||!steuerZaehlt(e)) return;
    einnahmePosten(e).forEach(function(p){
      if(p.datum.slice(0,4)!==y) return;
      z.push(['',dLang(p.datum),e.client||'',e.was||e.art||'',p.art,p.genau?'ja':'nein',dec2(p.betrag)]
        .map(q).join(';'));
    });
  });
  z.push('');
  z.push(['Ausgaben im Einzelnen','Datum','Bezeichnung','Kategorie','Anbieter','Zahlungsart','Beleg','Betrag'].map(q).join(';'));
  yearEntries('ausgaben',y).forEach(function(e){
    if(!steuerZaehlt(e)) return;
    z.push(['',dLang(e.date),e.bez||'',e.kat,e.haendler||'',e.zahlart||'',e.beleg?'ja':'nein',dec2(amountOf(e))]
      .map(q).join(';'));
  });
  download('Auftragsbuch-Einnahmen-Ausgaben-'+y+'.csv','﻿'+z.join('\r\n'),'text/csv;charset=utf-8');
}

function zeigeSteuer(){
  repChange();
  var y=ui.repJahr||curY();
  if(settings.steuerBasis!==ui.stBasis){ settings.steuerBasis=ui.stBasis; save(); }
  document.getElementById('report').innerHTML=steuerReportHTML(y,ui.stBasis);
  document.getElementById('report').classList.remove('rechnung');
  seitenFormat('quer');
  document.getElementById('reportbar-t').textContent='Vorschau · Einnahmen und Ausgaben '+y;
  ui.sheet=null; ui.repOffen=true;
  document.body.classList.add('report-open');
  document.getElementById('report').hidden=false;
  document.getElementById('reportbar').hidden=false;
  render();
  window.scrollTo(0,0);
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
  document.getElementById('report').classList.remove('rechnung');
  seitenFormat('quer');
  document.getElementById('reportbar-t').textContent='Vorschau · '+kurz+' '+titel;
  ui.sheet=null; ui.repOffen=true;
  document.body.classList.add('report-open');
  document.getElementById('report').hidden=false;
  document.getElementById('reportbar').hidden=false;
  render();
  window.scrollTo(0,0);
}
/* ============ rechnung als PDF ============
   Berichte werden quer gedruckt, eine Rechnung hochkant. Die Seitengröße
   steht in einem eigenen Stil-Element, das die Vorgabe aus app.css
   überschreibt – so gilt für jede Ansicht das passende Format.
   ================================================================== */

function seitenFormat(f){
  var el=document.getElementById('pageformat');
  if(!el){ el=document.createElement('style'); el.id='pageformat'; document.head.appendChild(el); }
  /* Hochkant setzt die App die Seiten selbst, deshalb Rand 0: der Browser
     hat dann keinen Platz mehr für seine eigene Kopf- und Fußzeile mit der
     Web-Adresse. Die Seitenzahl steht im Dokument. */
  el.textContent = f==='hoch'
    ? '@media print{@page{size:A4 portrait;margin:0;}}'
    : '@media print{@page{size:A4 landscape;margin:11mm;}}';
}

function zeile(x){ return x?esc(x)+'<br>':''; }

/* Platzhalter im Schlusstext. Der Text selbst gehört dir – die App setzt
   nur ein, was sie ohnehin weiß. */
var RG_PLATZ=[
  ['{betrag}','zu zahlen'], ['{summe}','Summe'], ['{anzahlung}','Anzahlung'],
  ['{faellig}','Fälligkeit'], ['{nummer}','Nummer'], ['{datum}','Datum'],
  ['{kunde}','Kunde'], ['{name}','dein Name'],
  ['{kontoinhaber}','Inhaber'], ['{iban}','IBAN'], ['{bic}','BIC'], ['{bank}','Bank']
];
function rgWerte(r){
  var f=Object.assign({},DEF_FIRMA,settings.firma||{});
  var sum=rgSumme(r), anz=cent(Number(r.anzahlung)||0);
  return {
    '{betrag}':eur(cent(sum-anz)), '{summe}':eur(sum), '{anzahlung}':eur(anz),
    '{faellig}':dLang(rgFaellig(r)), '{nummer}':r.nr||'', '{datum}':dLang(r.datum),
    '{kunde}':r.kunde.name||'', '{name}':f.name||'',
    '{kontoinhaber}':f.kontoinhaber||'', '{iban}':f.iban||'', '{bic}':f.bic||'', '{bank}':f.bank||''
  };
}
function rgText(t,r){
  var w=rgWerte(r);
  return String(t||'').replace(/\{[a-zäöüß]+\}/g,function(m){ return w[m]!==undefined?w[m]:m; });
}

/* Die einzelnen Bausteine der Rechnung. Die Positionstabelle darf über
   Seiten laufen, alles andere bleibt zusammen. */
function rechnungBloecke(r){
  var f=Object.assign({},DEF_FIRMA,settings.firma||{});
  var sum=rgSumme(r), anz=cent(Number(r.anzahlung)||0), zahlbar=cent(sum-anz);
  /* Telefon und E-Mail stehen jetzt oben in der Absenderzeile – unten
     auf der Rechnung steht nichts mehr außer der Seitenzahl. */
  var absender=[f.name,f.zusatz,f.strasse,(f.plz+' '+f.ort).trim(),f.telefon,f.email]
    .filter(Boolean).join(' · ');

  var kopf='<div class="rg-abs">'+esc(absender||'— eigene Angaben fehlen —')+'</div>'
    +'<div class="rg-kopf"><div class="rg-adr">'
    + zeile(r.kunde.name) + zeile(r.kunde.zusatz) + zeile(r.kunde.strasse)
    + zeile((r.kunde.plz+' '+r.kunde.ort).trim())
    +'</div><table class="rg-daten"><tbody>'
    +'<tr><td>Rechnungsnummer</td><td>'+esc(r.nr||'—')+'</td></tr>'
    +'<tr><td>Rechnungsdatum</td><td>'+dLang(r.datum)+'</td></tr>'
    +'<tr><td>Leistungszeitpunkt</td><td>'+esc(rgLeistungText(r))+'</td></tr>'
    +(f.steuernr?'<tr><td>Steuernummer</td><td>'+esc(f.steuernr)+'</td></tr>':'')
    +(f.ustid?'<tr><td>USt-IdNr.</td><td>'+esc(f.ustid)+'</td></tr>':'')
    +'</tbody></table></div>'
    +'<h1 class="rg-titel">Rechnung'+(r.nr?' Nr. '+esc(r.nr):'')+'</h1>'
    +(r.status==='Storniert'?'<p class="rg-storno">Diese Rechnung wurde storniert.</p>':'')
    +(r.anrede?'<p class="rg-p">'+esc(rgText(r.anrede,r))+'</p>':'')
    +(r.anschreiben?'<p class="rg-p">'+esc(rgText(r.anschreiben,r))+'</p>':'');

  var zeilen=r.posten.filter(function(p){return p.text||postenSumme(p);}).map(function(p,i){
    return '<tr><td>'+(i+1)+'</td><td>'+esc(p.text||'—')+'</td>'
      +'<td class="rep-r">'+dec2(p.menge)+(p.einheit?' '+esc(p.einheit):'')+'</td>'
      +'<td class="rep-r">'+eur(p.einzel)+'</td>'
      +'<td class="rep-r">'+eur(postenSumme(p))+'</td></tr>';
  });

  var schluss='<table class="rg-summen"><tbody>'
    +(anz?'<tr><td>Summe der Leistungen</td><td class="rep-r">'+eur(sum)+'</td></tr>'
         +'<tr><td>abzüglich bereits gezahlter Anzahlung</td><td class="rep-r">− '+eur(anz)+'</td></tr>':'')
    +'<tr class="rg-gesamt"><td>'+(anz?'Noch zu zahlen':'Rechnungsbetrag')+'</td>'
    +'<td class="rep-r">'+eur(anz?zahlbar:sum)+'</td></tr>'
    +'</tbody></table>'
    +(r.kleinunternehmer?'<p class="rg-19">'+esc(UST19_HINWEIS)+'</p>':'')
    +(r.schluss?'<div class="rg-schluss">'+esc(rgText(r.schluss,r))+'</div>':'');

  return [
    {html:kopf},
    {auf:'<table class="rg-pos"><thead><tr><th>Pos.</th><th>Art und Umfang der Leistung</th>'
        +'<th class="rep-r">Menge</th><th class="rep-r">Einzelpreis</th><th class="rep-r">Betrag</th>'
        +'</tr></thead><tbody>',
     zu:'</tbody></table>', rows:zeilen},
    {html:schluss}
  ];
}

/* Die Rechnung auf DIN-A4-Seiten verteilen. Der Browser kann von sich aus
   keine Seitenzahlen in ein Dokument schreiben – CSS Paged Media beherrscht
   er nicht. Also setzt die App die Seiten selbst und nummeriert sie. Dadurch
   darf der Seitenrand im Druck auf 0 stehen, und der Browser druckt weder
   die Web-Adresse noch sonst etwas an den Rand. */
function rgSeiten(bloecke){
  var buehne=document.createElement('div');
  buehne.className='report rechnung rg-buehne';
  buehne.innerHTML='<div class="rg-seite"><div class="rg-body"></div>'
    +'<div class="rg-seitenzahl">Seite 1 von 1</div></div>';
  document.body.appendChild(buehne);
  var body=buehne.querySelector('.rg-body');
  var maxH=body.clientHeight;
  var seiten=[], akt=[];
  var passt=function(zusatz){
    body.innerHTML=akt.join('')+zusatz;
    return body.scrollHeight<=maxH;
  };
  var umbruch=function(){ if(akt.length){ seiten.push(akt.join('')); akt=[]; } };

  bloecke.forEach(function(bl){
    if(bl.rows){
      var teil=[];
      bl.rows.forEach(function(zl){
        if(passt(bl.auf+teil.concat([zl]).join('')+bl.zu)){ teil.push(zl); return; }
        if(teil.length) akt.push(bl.auf+teil.join('')+bl.zu);
        umbruch();
        teil=[zl];
      });
      if(teil.length) akt.push(bl.auf+teil.join('')+bl.zu);
    }else{
      if(akt.length && !passt(bl.html)) umbruch();
      akt.push(bl.html);
    }
  });
  umbruch();
  buehne.remove();
  return seiten.length?seiten:[''];
}

function rechnungHTML(r){
  var luecken=rgLuecken(r);
  var seiten=rgSeiten(rechnungBloecke(r));
  var h='';
  if(luecken.length){
    h+='<div class="rg-warn">Diese Rechnung ist noch nicht vollständig. Es fehlt: '
      +esc(luecken.join(', '))+'. Der Hinweis erscheint nur am Bildschirm, nicht im Druck.</div>';
  }
  h+=seiten.map(function(inhalt,i){
    return '<div class="rg-seite'+(i===seiten.length-1?' letzte':'')+'">'
      +'<div class="rg-body">'+inhalt+'</div>'
      +'<div class="rg-seitenzahl">Seite '+(i+1)+' von '+seiten.length+'</div></div>';
  }).join('');
  return h;
}

function zeigeRgObjekt(r){
  var rep=document.getElementById('report');
  rep.innerHTML=rechnungHTML(r);
  rep.classList.add('rechnung');
  seitenFormat('hoch');
  document.getElementById('reportbar-t').textContent='Rechnung '+(r.nr||'ohne Nummer')
    +' · '+(r.kunde.name||'ohne Kunde');
  ui.repOffen=true;
  document.body.classList.add('report-open');
  rep.hidden=false;
  document.getElementById('reportbar').hidden=false;
  window.scrollTo(0,0);
}
function zeigeRechnung(id){
  var r=rechnungen.find(function(x){return x.id===id;});
  if(r) zeigeRgObjekt(normRechnung(r));
}
/* Vorschau aus dem offenen Formular – noch ohne zu speichern. */
function vorschauRg(){
  rgLese();
  if(ui.rgDraft) zeigeRgObjekt(ui.rgDraft);
}

function closeReport(){
  ui.repOffen=false;
  document.body.classList.remove('report-open');
  document.getElementById('report').classList.remove('rechnung');
  seitenFormat('quer');
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
  cryptoKey=null; entries=[]; payments=[]; rechnungen=[]; abos=[];
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

/* Wie hoch ein Blatt höchstens werden darf. Auf dem Handy ist 100vh größer
   als das, was man sieht – die Adressleiste und die eingeblendete Tastatur
   zählen dort nicht mit. visualViewport kennt den wahren sichtbaren Bereich;
   ohne diese Schnittstelle greifen die Rückfälle aus app.css. */
function sheetHoehe(){
  var vv=window.visualViewport;
  if(!vv) return;
  document.documentElement.style.setProperty('--sheetmax', Math.round(vv.height*0.88)+'px');
}

/* Den ausgewählten Monat bzw. das Jahr in den Blick rücken – sonst steht der
   laufende Monat auf dem Handy außerhalb der Leiste. */
function chipsZeigen(){
  document.querySelectorAll('.chips').forEach(function(c){
    var on=c.querySelector('.chip.on');
    if(!on || c.scrollWidth<=c.clientWidth) return;
    c.scrollLeft=Math.max(0, on.offsetLeft-(c.clientWidth-on.offsetWidth)/2);
  });
}

/* Nach Anlegen und nach jedem Entsperren auf der Startseite beginnen. */
function boot(){
  ui.view='home'; ui.month=curMk(); ui.jahr=curY(); ui.modus='monat';
  ui.rgJahr=curY(); ui.stBasis=settings.steuerBasis||'zufluss';
  /* Was seit dem letzten Start fällig wurde, wird jetzt gebucht. */
  var neu=aboLauf();
  ui.aboNeu=neu;
  render(); resetLock(); autoImport();
  if(neu) save();
}

function render(){
  if(!cryptoKey) return;
  document.documentElement.style.setProperty('--accent', areaFarbe(ui.area));
  document.documentElement.style.setProperty('--accent-soft',
    ui.area==='self'?'var(--self-soft)':ui.area==='ausgaben'?'var(--gold-soft)':'var(--martin-soft)');
  var h = ui.view==='home' ? viewHome() : ui.view==='rechnungen' ? viewRechnungen() : viewArea();
  h += ui.sheet==='form'? sheetForm() : ui.sheet==='settle'? sheetSettle() : ui.sheet==='settings'? sheetSettings()
     : ui.sheet==='backup'? sheetBackup() : ui.sheet==='restore'? sheetRestore() : ui.sheet==='reset'? sheetReset()
     : ui.sheet==='trash'? sheetTrash() : ui.sheet==='pw'? sheetPw() : ui.sheet==='report'? sheetReport()
     : ui.sheet==='abos'? sheetAbos() : ui.sheet==='abo'? sheetAbo()
     : ui.sheet==='rg'? sheetRg() : ui.sheet==='firma'? sheetFirma() : '';
  document.getElementById('app').innerHTML=h;
  if(ui.sheet==='form') liveCalc();
  if(ui.sheet==='abo') aboCalc();
  if(ui.sheet==='rg') rgCalc();
  chipsZeigen();
  sheetHoehe();
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
  openReport:openReport,repChange:repChange,showReport:showReport,closeReport:closeReport,
  openAbos:openAbos,openAbo:openAbo,saveAbo:saveAbo,toggleAbo:toggleAbo,delAbo:delAbo,
  aboCalc:aboCalc,aboWeg:aboWeg,
  openRechnungen:openRechnungen,openRg:openRg,saveRg:saveRg,trashRg:trashRg,rgZurueck:rgZurueck,
  rgPosAdd:rgPosAdd,rgPosDel:rgPosDel,rgCalc:rgCalc,rgBezahlt:rgBezahlt,rgAusAuftrag:rgAusAuftrag,
  rgSetJahr:rgSetJahr,rgSuche:rgSuche,zeigeRechnung:zeigeRechnung,vorschauRg:vorschauRg,
  exportRgCSV:exportRgCSV,
  openFirma:openFirma,saveFirma:saveFirma,
  openSteuer:openSteuer,zeigeSteuer:zeigeSteuer,exportSteuerCSV:exportSteuerCSV
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
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    if(ui.repOffen) closeReport();
    else if(ui.sheet) closeSheet();
  });
  /* Blattgröße nachführen, wenn die Adressleiste ein- oder ausfährt oder die
     Tastatur aufgeht. */
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',sheetHoehe);
    window.visualViewport.addEventListener('scroll',sheetHoehe);
  }
  window.addEventListener('orientationchange',function(){ setTimeout(sheetHoehe,250); });
  sheetHoehe();
  document.getElementById('reportprint').addEventListener('click',function(){window.print();});
  document.getElementById('reportback').addEventListener('click',closeReport);

  try{ meta=JSON.parse(localStorage.getItem(K_META)); }catch(x){ meta=null; }
  if(meta&&localStorage.getItem(K_VAULT)) gate('enter',null,meta.hint);
  else gate('set');
}

document.addEventListener('DOMContentLoaded',start);
})();
