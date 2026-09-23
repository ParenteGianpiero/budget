'use strict';
/* ===================== Hilfsfunktionen ===================== */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const r2 = x => Math.round(x * 100) / 100;
function chf(x, dec = 0) {
  const neg = x < 0; x = Math.abs(x);
  let s = x.toFixed(dec), [i, f] = s.split('.');
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return (neg ? '−' : '') + i + (f ? '.' + f : '');
}
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseISO = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
const MON = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const MONL = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const WD = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const fmtD = s => { const d = parseISO(s); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getFullYear()).slice(2)}`; };
const dayDiff = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 864e5);
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role','status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

/* ===================== Speicher (IndexedDB, nur auf diesem Gerät) ===================== */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('budget-app', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  get(k) { return new Promise((res, rej) => { const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  set(k, v) { return new Promise((res, rej) => { const t = this.db.transaction('kv','readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  clear() { return new Promise((res, rej) => { const t = this.db.transaction('kv','readwrite'); t.objectStore('kv').clear(); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
};

/* ===================== Verschlüsselung (Web Crypto) ===================== */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function pbkdf2(pin, salt, iter, usage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits','deriveKey']);
  if (usage === 'bits') return crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'}, base, 256);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function hashPin(pin, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(pin, salt, 150000, 'bits');
  return { salt: b64(salt), hash: b64(bits) };
}
async function encryptJSON(obj, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pbkdf2(pin, salt, 200000);
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(JSON.stringify(obj)));
  return { typ:'budget-backup', version:1, salt:b64(salt), iv:b64(iv), daten:b64(ct) };
}
async function decryptJSON(pack, pin) {
  const key = await pbkdf2(pin, unb64(pack.salt), 200000);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(pack.iv)}, key, unb64(pack.daten));
  return JSON.parse(dec.decode(pt));
}

/* ===================== Kategorien und Budget-Zuordnung ===================== */
// topf: w_* = Wochenposten, 'tabak' = Tabak-Topf, 'fix' = Fixkosten, 'ein' = Einnahme, 'none' = zählt nicht
const CATS = {
  'Lebensmittel':            {topf:'w_leb',   col:'#7b5cff'},
  'Mobilität':               {topf:'w_auto',  col:'#5f8bff'},
  'Bäckerei & Snacks':       {topf:'w_back',  col:'#f7b58c'},
  'Restaurant & Take-away':  {topf:'w_rest',  col:'#f2934f'},
  'Freizeit & Sport':        {topf:'w_frei',  col:'#4fc2d9'},
  'Shopping':                {topf:'w_shop',  col:'#b37bff'},
  'Kurse & Coaching':        {topf:'w_shop',  col:'#d67bff'},
  'Gesundheit':              {topf:'w_shop',  col:'#6fd3b0'},
  'Bargeld':                 {topf:'w_shop',  col:'#a8a6d6'},
  'Sonstiges':               {topf:'w_shop',  col:'#8584b3'},
  'Personen & Unterstützung':{topf:'w_res',   col:'#ff9fb3'},
  'Tabak':                   {topf:'tabak',   col:'#ff6f5b'},
  'Wohnen':                  {topf:'fix',     col:'#9a82ff'},
  'Krankenkasse':            {topf:'fix',     col:'#5ed3a3'},
  'Versicherungen':          {topf:'fix',     col:'#48b8a0'},
  'Steuern & Abgaben':       {topf:'fix',     col:'#c4c2e8'},
  'Abos & Digital':          {topf:'fix',     col:'#6aa2ff'},
  'Kind':                    {topf:'fix',     col:'#ffcf7a'},
  'Sparen & Vorsorge':       {topf:'fix',     col:'#8ee07a'},
  'Schulden & Kredite':      {topf:'fix',     col:'#ff8a6a'},
  'Einkommen':               {topf:'ein',     col:'#5ed3a3'},
  'Nebeneinkommen':          {topf:'ein',     col:'#5ed3a3'},
  'Einnahmen Familie':       {topf:'ein',     col:'#5ed3a3'},
  'Rückerstattungen':        {topf:'ein',     col:'#5ed3a3'},
  'Sonstige Einnahmen':      {topf:'ein',     col:'#5ed3a3'},
  'Intern':                  {topf:'none',    col:'#555'}
};
const POST_CAT = { w_leb:'Lebensmittel', w_auto:'Mobilität', w_back:'Bäckerei & Snacks', w_rest:'Restaurant & Take-away', w_frei:'Freizeit & Sport', w_shop:'Shopping', w_res:'Personen & Unterstützung', tabak:'Tabak' };
const catCol = c => (CATS[c] || CATS['Sonstiges']).col;

// Eingebaute Regeln: erste passende gewinnt. Geprüft wird Händler + Buchungstext in Grossbuchstaben.
const RULES_OUT = [
  ['Intern','Umbuchung eigene Konten',/SALDOVORTRAG|GIANPIERO PARENTE|CSX SPARKONTO|SPARKONTO BONVIVA|KONTOÜBERTRAG|KONTOUEBERTRAG/],
  ['Intern','Migrolcard-Rechnung',/MIGROL AG/, s => s.migrolAktiv],
  ['Schulden & Kredite','Kreditkarte Rückzahlung',/XXXX XXXX XXXX|ZAHLUNG AN KARTE|UBS CARD|UBS SWITZERLAND AG C\/O/],
  ['Wohnen','Miete',/GEMPERLE|WEIBEL|MIETE|MIETZINS/],
  ['Wohnen','Strom & Nebenkosten',/ELEKTROGENOSSENSCHAFT|WWZ|WASSER|ÖKIHOF/],
  ['Krankenkasse','Prämien & Kosten',/SWICA/],
  ['Kind','Kinderbetreuung',/DE PAOLA.*(DAUERAUFTRAG|VERGÜTUNGSAUFTRAG)|(DAUERAUFTRAG|VERGÜTUNGSAUFTRAG).*DE PAOLA/],
  ['Personen & Unterstützung','Gegenseitige Unterstützung',/KATHARINA|DE PAOLA/],
  ['Kind','Giulia',/GIULIA|SMYTHS|FAMILIE PLUS|FRANZ CARL WEBER|SPIELWAREN|SPIELGRUPPE|MUSIKSCHULE|TOYS|BABYWALZ/],
  ['Gesundheit','Arzt & Apotheke',/KANTONSSPITAL|ZAHNÄRZTE|ÄRZTEKASSE|AERZTEKASSE|FIELMANN|APOTHEK|FARMACIA|PRAXIS|ZAHNARZT|PHYSIO|DROGERIE|AMAVITA|SUN STORE|KLINIK|HIRSLANDEN/],
  ['Versicherungen','Versicherungen',/HELVETIA|ZURICH VERSICHERUNG|ZÜRICH VERSICHERUNG|RECHTSSCHUTZ|\bCAP\b|\bAXA\b|GENERALI|MOBILIAR|ALLIANZ|BALOISE|SMILE/],
  ['Steuern & Abgaben','Steuern & Ämter',/STEUERVERWALTUNG|FINANZVERWALTUNG|FINANZDEPARTEMENT|KANTON ZUG|GEMEINDE H|BUERGERGEMEINDE|STRASSENVERKEHRSAMT|SERAFE|BETREIBUNG|STAATSSEKRETARIAT/],
  ['Sparen & Vorsorge','Säule 3a',/PRIVILEGIA|3\. ?SÄULE|VORSORGE|3A/],
  ['Schulden & Kredite','Kreditkarten & Raten',/SWISSCARD|PAYRED|POWERPAY|PAYCARD|KLARNA|CEMBRA|BANK-NOW|BYJUNO|ACCARDA/],
  ['Schulden & Kredite','Zinsen & Bankgebühren',/ZINSABSCHLUSS|ZINSBELASTUNG|ABSCHLUSSBUCHUNG|SOLLZINS|DIENSTLEISTUNGSPREIS|GEBÜHRENABRECHNUNG|PREIS CS/],
  ['Tabak','Tabak & Kiosk',/TABAC|TABAK|K KIOSK|KKIOSK|K-KIOSK|\bAVEC\b|PRESS & BOOKS|VALORA|SMOKE|ZIGAR|TAB 20/],
  ['Mobilität','Treibstoff & Auto',/MIGROL|SHELL|AVIA|BP TANK|\bBP\b|\bENI\b|AGROLA|TAMOIL|ESSO|SOCAR|COOP PRONTO|CAR ?WASH|PNEU|BESTDRIVE|GARAGE|\bTCS\b|PARKING|PARKHAUS|PARKDEPOT|PARKPLATZ|VIGNETTE|\bSBB\b|\bZVB\b|TAXI|UBER|MOBILITY|FLIXBUS|TRENITALIA|AUTOGRILL|ASPIT|MISER|STAZI|DISTR/],
  ['Lebensmittel','Supermarkt',/ALDI|LIDL|COOP|DENNER|MIGROS M(?!R)|MIGROS-|MIGROLINO|VOLG|\bSPAR\b|OTTO'?S|CONAD|CARREFOUR|EUROSPIN|AUCHAN|SUPERMERCATO|MMM|OUTLET MIGROS|METZG|FARMY/],
  ['Bäckerei & Snacks','Bäckerei & Café',/BÄCKEREI|BACKEREI|BAECKEREI|CONFISEU|STARBUCKS|\bCAFE|CAFFE|KONDITOREI|SELECTA/],
  ['Restaurant & Take-away','Restaurant & Take-away',/RESTAURANT|RISTORANTE|PIZZ|MCDONALD|BURGER|KEBAB|SUSHI|TIMEOUT|TAKE|ASIAN|RICCARDO|RIBALDI|OSTERIA|TRATTORIA|\bBAR\b|GELAT|GROTTO|WARTSTEIN|\bKFC\b|SUBWAY|DÖNER|DONER|THAI|IMBISS|BISTRO|GASTHAUS|GASTHOF|WIRTSCHAFT|\bREST\b|GASTRO|LOUNGE|TAVERNA|PALLADINO/],
  ['Freizeit & Sport','Golf',/GOLF/],
  ['Freizeit & Sport','Sport & Freizeit',/FITNESS|PLAYTOMIC|DECATHLON|SPORTX|SPORT|SWISSLOS|KINO|PATHE|BADI|STRANDBAD|HALLENBAD|ZOO|YOGA|WHOOP|PADEL|TENNIS|BERGBAHN|SEILBAHN|TICKETCORNER|EVENTFROG|CASIN/],
  ['Kurse & Coaching','Online-Kurse & Coaching',/HUMAN ?DESIGN|DIGISTORE|IHR EINKAU|COACH|SEMINAR|ACADEMY|MASTERCLASS|COPECART|ABLEFY|ELOPAGE|UDEMY/],
  ['Abos & Digital','Handy, Internet & Abos',/SUNRISE|YALLO|\bSALT\b|SWISSCOM|GALAXUS MOBILE|GALAXUS ABOS|DIGITEC CONNECT|HOSTPOINT|ANTHROPIC|CLAUDE|OPENAI|APPLE\.COM|ITUNES|GOOGLE|SPOTIFY|NETFLIX|DISNEY|YOUTUBE|MICROSOFT|ADOBE|DAZN|AUDIBLE|UNITY/],
  ['Shopping','Online & Einkauf',/GALAXUS|DIGITEC|AMAZON|AMZN|TEMU|ZALANDO|EX LIBRIS|IKEA|HORNBACH|JUMBO|BAUHAUS|MEDIA ?MARKT|INTERDISCOUNT|MANOR|H&M|ZARA|C&A|DOSENBACH|OFFICE WORLD|BRACK|MOMOX|SHEIN|ALIEXPRESS|TCHIBO|PRIMARK|NIKE|ADIDAS|THALIA|ORELL|LANDI|QUALIPET|FRESSNAPF|PFISTER|CONFORAMA|MICASA|JYSK|COTTON|SUMUP|PAYPAL/],
  ['Bargeld','Bargeldbezug',/BARGELD|BANCOMAT|BEZUG|GELDAUTOMAT|ATM/]
];
const RULES_IN = [
  ['Einkommen','Lohn',/LOHN|GEHALT|SALAER|SALÄR/],
  ['Intern','Umbuchung eigene Konten',/SALDOVORTRAG|GIANPIERO PARENTE|UEBERTRAG|KONTOÜBERTRAG|ZINSGUTSCHR|BANKVERGUETUNG|QR-ZAHLUNG/],
  ['Einnahmen Familie','Gegenseitige Unterstützung',/KATHARINA|DE PAOLA/],
  ['Einnahmen Familie','Familie',/PARENTE|TOSCANO/],
  ['Nebeneinkommen','Golf-Trainings',/GOLF/],
  ['Rückerstattungen','Rückerstattung',/SWICA|HELVETIA|GENERALI|RECHTSSCHUTZ|AXA|VERSICHER|STEUER|RUECKERST|RÜCKERST/]
];

function categorize(tx) {
  const blob = (tx.p + ' ' + tx.t).toUpperCase();
  for (const r of S.rules) if (r.m && blob.includes(r.m)) return [r.c, r.s || r.c];
  const list = tx.a < 0 ? RULES_OUT : RULES_IN;
  for (const [c, s, rx, cond] of list) if (rx.test(blob) && (!cond || cond(S.settings))) return [c, s];
  return tx.a < 0 ? ['Sonstiges','Sonstiges'] : ['Sonstige Einnahmen','Sonstige Einnahmen'];
}

/* ===================== Zustand ===================== */
const DEFAULT_SETTINGS = () => ({
  lohn: 6280, lohntag: 25, tabak: 500, migrolAktiv: true,
  budgetStart: iso(monday(today())),
  posts: [
    {id:'w_leb',  name:'Lebensmittel',            betrag:115},
    {id:'w_auto', name:'Auto & Treibstoff',       betrag:50},
    {id:'w_back', name:'Bäckerei & Snacks',       betrag:30},
    {id:'w_rest', name:'Restaurant & Take-away',  betrag:25},
    {id:'w_frei', name:'Freizeit & Sport',        betrag:30},
    {id:'w_shop', name:'Shopping & Diverses',     betrag:25},
    {id:'w_res',  name:'Reserve & Unterstützung', betrag:23}
  ],
  fix: [
    {name:'Miete', betrag:2555, tag:27, c:'Wohnen'},
    {name:'Krankenkasse SWICA', betrag:435, tag:1, c:'Krankenkasse'},
    {name:'Rate Kreditkarte', betrag:300, tag:27, c:'Schulden & Kredite'},
    {name:'Rate PayRed', betrag:200, tag:26, c:'Schulden & Kredite'},
    {name:'Giulia', betrag:100, tag:28, c:'Kind'},
    {name:'Säule 3a', betrag:110, tag:28, c:'Sparen & Vorsorge'},
    {name:'Handy & Internet', betrag:55, tag:26, c:'Abos & Digital'},
    {name:'Claude-Abo', betrag:180, tag:28, c:'Abos & Digital'},
    {name:'Versicherungen (Rücklage)', betrag:255, tag:null, c:'Versicherungen'},
    {name:'Steuern & Verkehrsamt (Rücklage)', betrag:210, tag:null, c:'Steuern & Abgaben'},
    {name:'Strom (Rücklage)', betrag:90, tag:null, c:'Wohnen'}
  ],
  lastBackup: null, pinType: 'num6'
});
const DEFAULT_DEBTS = () => ([
  {id:'kk', name:'Kreditkarte UBS', saldo:5700, rate:300, zins:12},
  {id:'pr', name:'PayRed (Media Markt)', saldo:1850, rate:200, zins:null}
]);
const S = { tx: [], settings: null, rules: [], debts: [], topf: [], view: 'home', pin: null, ana: {per:'12m'}, list: {q:'', c:'', n:150} };

async function load() {
  S.tx = (await DB.get('tx')) || [];
  S.settings = Object.assign(DEFAULT_SETTINGS(), (await DB.get('settings')) || {});
  S.rules = (await DB.get('rules')) || [];
  S.debts = (await DB.get('debts')) || DEFAULT_DEBTS();
  S.topf = (await DB.get('topf')) || [];
}
const save = {
  tx: () => DB.set('tx', S.tx), settings: () => DB.set('settings', S.settings),
  rules: () => DB.set('rules', S.rules), debts: () => DB.set('debts', S.debts), topf: () => DB.set('topf', S.topf)
};

/* ===================== CSV-Import ===================== */
function decodeFile(buf) {
  try { return new TextDecoder('utf-8', {fatal:true}).decode(buf).replace(/^\uFEFF/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}
function parseCSV(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let start = 0; if (/^sep=/i.test(lines[0])) start = 1;
  const sample = lines.slice(start, start + 15).join('\n');
  const sep = [';', ',', '\t'].map(s => [s, sample.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  const src = lines.slice(start).join('\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
function num(s) {
  if (s == null) return NaN; s = String(s).trim().replace(/['’\s]/g, '').replace(/CHF/i, '');
  if (!s) return NaN;
  let neg = false; if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.'); else s = s.replace(/,/g, '');
  const v = parseFloat(s); return neg ? -v : v;
}
function dateCH(s) {
  s = String(s || '').trim(); let m;
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/))) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function detectAndParse(text, fname) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const j = JSON.parse(trimmed);
    if (j.typ === 'budget-startdaten') return { kind:'start', label:'Startdaten (Analyse)', tx: j.buchungen };
    if (j.typ === 'budget-backup') return { kind:'backup', pack:j };
    throw new Error('Unbekannte JSON-Datei');
  }
  const rows = parseCSV(text);
  const hi = rows.findIndex(r => r.some(c => /datum/i.test(c)) && r.some(c => /(belastung|betrag|gutschrift|total)/i.test(c)));
  if (hi < 0) throw new Error('Kein Buchungsformat erkannt');
  const H = rows[hi].map(h => clean(h).toLowerCase());
  const col = (...names) => { for (const n of names) { const i = H.findIndex(h => h === n || h.startsWith(n)); if (i >= 0) return i; } return -1; };
  const data = rows.slice(hi + 1);
  const out = [];
  // Kreditkarte (UBS/CS Kartentransaktionen)
  if (H.includes('kartennummer') || H.includes('buchungstext') && H.includes('branche')) {
    const iD = col('einkaufsdatum'), iT = col('buchungstext'), iB = col('branche'), iA = col('betrag'), iW = col('originalwährung','originalwahrung'),
          iBel = col('belastung'), iGut = col('gutschrift'), iBu = col('buchung');
    for (const r of data) {
      const d = dateCH(r[iD]); if (!d) continue;
      const t = clean(r[iT]), br = clean(r[iB]); let a, pend = 0;
      if (!isNaN(num(r[iBel]))) a = -num(r[iBel]);
      else if (!isNaN(num(r[iGut]))) a = num(r[iGut]);
      else { const v = num(r[iA]); if (isNaN(v)) continue; a = -(clean(r[iW]) === 'CHF' ? v : r2(v * 0.95)); pend = 1; }
      if (iBu >= 0 && !clean(r[iBu])) pend = 1;
      const tx = { d, a: r2(a), p: t.replace(/\s{2,}.*$/, '').slice(0, 48) || t, t: `${t} ${br}`.slice(0, 120), q:'C' };
      if (pend) tx.pend = 1;
      const U = t.toUpperCase();
      if (/ZINSBELASTUNG/.test(U)) [tx.c, tx.s] = ['Schulden & Kredite','Zinsen & Bankgebühren'];
      else if (/BANKVERGUETUNG|QR-ZAHLUNG|UEBERTRAG|ZINSGUTSCHR/.test(U)) [tx.c, tx.s] = ['Intern','Kreditkarte Rückzahlung'];
      out.push(tx);
    }
    return { kind:'csv', label:'Kreditkarte', q:'C', tx: out };
  }
  // Migrolcard
  if (H.some(h => h.startsWith('belegdatum')) && H.includes('produkte name')) {
    const iD = col('belegdatum'), iP = col('produkte name'), iS = col('tankstelle'), iTot = col('total inkl');
    const MP = {'Tabak':['Tabak','Tabak & Kiosk'],'Food':['Bäckerei & Snacks','Tankstellenshop'],'Getränke o. Alkohol':['Bäckerei & Snacks','Tankstellenshop'],'Take-away':['Bäckerei & Snacks','Tankstellenshop'],'Non Food':['Shopping','Online & Einkauf'],'Schnittblumen':['Shopping','Online & Einkauf']};
    for (const r of data) {
      const d = dateCH(r[iD]), v = num(r[iTot]); if (!d || isNaN(v)) continue;
      const pr = clean(r[iP]); const [c, s] = MP[pr] || ['Mobilität','Treibstoff & Auto'];
      out.push({ d, a: -r2(v), p: clean(r[iS]) || 'Migrol', t: pr, q:'M', c, s });
    }
    return { kind:'csv', label:'Migrolcard', q:'M', tx: out };
  }
  // Bankkonto (UBS und ähnliche): flexibel über Spaltennamen
  const iD = col('buchungsdatum','abschlussdatum','datum','valutadatum','valuta');
  const iBel = col('belastung'), iGut = col('gutschrift'), iAmt = col('einzelbetrag','betrag');
  const descCols = H.map((h, i) => /beschreibung|buchungstext|^text|mitteilung|zahlungsgrund|details|empfänger|auftraggeber/.test(h) ? i : -1).filter(i => i >= 0);
  for (const r of data) {
    const d = dateCH(r[iD]); if (!d) continue;
    let a = NaN;
    const bel = num(r[iBel]), gut = num(r[iGut]);
    if (iBel >= 0 && !isNaN(bel) && bel !== 0) a = -Math.abs(bel);
    else if (iGut >= 0 && !isNaN(gut) && gut !== 0) a = Math.abs(gut);
    else if (iAmt >= 0) a = num(r[iAmt]);
    if (isNaN(a) || a === 0) continue;
    const parts = descCols.map(i => clean(r[i])).filter(Boolean);
    const generic = /^(zahlung|belastung|gutschrift|lastschrift|e-banking|dauerauftrag|twint|debitkarte|zahlung debitkarte|salaereingang|\d)/i;
    const p = (parts.find(x => !generic.test(x)) || parts[0] || 'Buchung').split(/;|,\s*\d{4}\s/)[0].slice(0, 48);
    out.push({ d, a: r2(a), p, t: parts.join(' | ').slice(0, 160), q:'K' });
  }
  if (!out.length) throw new Error('Keine Buchungen in der Datei gefunden');
  return { kind:'csv', label:'Bankkonto', q:'K', tx: out };
}

// Führt neue Buchungen zusammen: erkennt Doppelte (gleiche Quelle, gleicher Betrag, Datum ±2 Tage)
// und ersetzt manuell erfasste Ausgaben durch die echte Buchung (Kategorie der manuellen Erfassung bleibt).
function mergeTx(incoming, q) {
  let added = 0, dup = 0, matched = 0;
  if (q === 'C') S.tx = S.tx.filter(t => !(t.q === 'C' && t.pend));
  const pool = new Map();
  for (const t of S.tx) if (!t.m) { const k = t.q + '|' + t.a.toFixed(2); (pool.get(k) || pool.set(k, []).get(k)).push(t.d); }
  for (const t of incoming) {
    const k = t.q + '|' + t.a.toFixed(2), arr = pool.get(k);
    if (arr) { const i = arr.findIndex(d => Math.abs(dayDiff(d, t.d)) <= 2); if (i >= 0) { arr.splice(i, 1); dup++; continue; } }
    if (!t.c) [t.c, t.s] = categorize(t);
    if (t.a < 0 && t.c !== 'Intern') {
      const mi = S.tx.findIndex(m => m.m && !m.done && Math.abs(m.a - t.a) <= 0.05 && Math.abs(dayDiff(m.d, t.d)) <= 3);
      if (mi >= 0) { const m = S.tx[mi]; t.c = m.c; t.s = m.s; S.tx.splice(mi, 1); matched++; }
    }
    t.id = t.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    S.tx.push(t); added++;
  }
  S.tx.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  return { added, dup, matched };
}
/* ===================== Berechnungen ===================== */
const isExpense = t => t.a < 0 && t.c !== 'Intern' && !t.x && !t.done;
const isIncome  = t => t.a > 0 && t.c !== 'Intern';
const topfOf = t => (CATS[t.c] || CATS['Sonstiges']).topf;
const weekTotal = () => S.settings.posts.reduce((s, p) => s + (+p.betrag || 0), 0);
const fixTotal = () => S.settings.fix.reduce((s, f) => s + (+f.betrag || 0), 0);
const availableWeekly = () => (S.settings.lohn - fixTotal() - S.settings.tabak) * 12 / 52;

// Ausgaben pro Wochenposten in einem Zeitraum [von, bis] (ISO, inklusive)
function spendByPost(von, bis) {
  const out = {}; for (const p of S.settings.posts) out[p.id] = 0;
  for (const t of S.tx) {
    if (t.d < von || t.d > bis || !isExpense(t)) continue;
    const tp = topfOf(t); if (tp.startsWith('w_') && tp in out) out[tp] += -t.a;
  }
  return out;
}

// Wochen ab Budgetstart durchrechnen: Überzug wird von der Folgewoche abgezogen,
// Rest fliesst in den Schuldenfrei-Topf.
function weekChain() {
  const base = weekTotal(), start = parseISO(S.settings.budgetStart), now = monday(today());
  const weeks = []; let carry = 0;
  for (let w = monday(start); w <= now; w = addDays(w, 7)) {
    const von = iso(w), bis = iso(addDays(w, 6));
    const sp = spendByPost(von, bis), spent = Object.values(sp).reduce((a, b) => a + b, 0);
    const budget = base - carry, rest = budget - spent;
    const current = +w === +now;
    weeks.push({ von, bis, sp, spent, budget, carryIn: carry, rest, current, topfAdd: !current && rest > 0 ? rest : 0 });
    if (!current) carry = rest < 0 ? -rest : 0;
  }
  return weeks;
}
function potState() {
  const weeks = weekChain();
  const earned = weeks.reduce((s, w) => s + w.topfAdd, 0);
  const paid = S.topf.reduce((s, t) => s + t.betrag, 0);
  return { weeks, earned, paid, balance: Math.max(0, earned - paid) };
}
function tabakMonth(ref = today()) {
  const von = iso(new Date(ref.getFullYear(), ref.getMonth(), 1)), bis = iso(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  let s = 0; for (const t of S.tx) if (t.d >= von && t.d <= bis && isExpense(t) && t.c === 'Tabak') s += -t.a;
  return s;
}
function nextFix(n = 5) {
  const t = today(), items = [];
  for (const f of S.settings.fix) {
    if (!f.tag) continue;
    const dim = (y, m) => new Date(y, m + 1, 0).getDate();
    let d = new Date(t.getFullYear(), t.getMonth(), Math.min(f.tag, dim(t.getFullYear(), t.getMonth())));
    if (d < t) { const y = t.getFullYear(), m = t.getMonth() + 1; d = new Date(y, m, Math.min(f.tag, dim(y, m))); }
    items.push({ ...f, date: d });
  }
  return items.sort((a, b) => a.date - b.date).slice(0, n);
}

// Schuldenprognose: Monat für Monat, frei werdende Raten gehen auf die nächste Schuld (höchster Zins zuerst)
function debtPlan(extraMonthly = 0) {
  const ds = S.debts.filter(d => d.saldo > 0).map(d => ({ ...d, z: d.zins ?? 12, end: null, interest: 0 }));
  if (!ds.length) return { months: 0, interest: 0, list: [] };
  const order = [...ds].sort((a, b) => (b.z - a.z) || (a.saldo - b.saldo));
  let m = 0, totalRate = ds.reduce((s, d) => s + d.rate, 0) + extraMonthly;
  while (ds.some(d => d.saldo > 0.005) && m < 600) {
    m++;
    for (const d of ds) if (d.saldo > 0) { const i = d.saldo * d.z / 1200; d.saldo += i; d.interest += i; }
    let budget = totalRate;
    for (const d of ds) if (d.saldo > 0) { const p = Math.min(d.rate, d.saldo, budget); d.saldo -= p; budget -= p; }
    for (const d of order) if (d.saldo > 0 && budget > 0) { const p = Math.min(budget, d.saldo); d.saldo -= p; budget -= p; }
    for (const d of ds) if (d.saldo <= 0.005 && !d.end) { d.saldo = 0; d.end = m; }
  }
  const t = today();
  const when = k => new Date(t.getFullYear(), t.getMonth() + k, 1);
  return { months: m, date: when(m), interest: ds.reduce((s, d) => s + d.interest, 0), list: ds.map(d => ({ name: d.name, end: when(d.end || m), interest: d.interest })) };
}

/* ===================== Analyse ===================== */
function periodRange(per) {
  const t = today();
  if (per === '12m') return [iso(new Date(t.getFullYear() - 1, t.getMonth() + 1, 1)), iso(t)];
  if (per === 'alle') return ['1900-01-01', '2999-12-31'];
  return [`${per}-01-01`, `${per}-12-31`];
}
function analyse(von, bis) {
  const cat = {}, sub = {}, merch = {}, months = {};
  let ein = 0, aus = 0;
  for (const t of S.tx) {
    if (t.d < von || t.d > bis) continue;
    const mk = t.d.slice(0, 7);
    months[mk] = months[mk] || { ein: 0, aus: 0 };
    if (isIncome(t)) { ein += t.a; months[mk].ein += t.a; }
    else if (isExpense(t)) {
      aus += -t.a; months[mk].aus += -t.a;
      cat[t.c] = (cat[t.c] || 0) - t.a;
      const sk = t.c + '|' + (t.s || t.c); sub[sk] = (sub[sk] || 0) - t.a;
      const mkey = merchKey(t.p); if (!merch[mkey]) merch[mkey] = { name: t.p, sum: 0, n: 0, c: t.c }; merch[mkey].sum -= t.a; merch[mkey].n++;
    }
  }
  const nMonths = Math.max(1, Object.keys(months).length);
  return { ein, aus, cat, sub, merch, months, nMonths };
}
const merchKey = p => String(p || '').toUpperCase().replace(/[^A-ZÄÖÜ ]/g, ' ').replace(/\b(AG|GMBH|SA|SRL|FIL|CHE|CH|ITA|DEU)\b/g, '').split(/\s+/).filter(Boolean).slice(0, 2).join(' ') || '?';

// Wiederkehrende Zahlungen: gleicher Empfänger in mind. 3 der letzten 6 Monate, ähnlicher Betrag
function recurring() {
  const t = today(), von = iso(new Date(t.getFullYear(), t.getMonth() - 6, 1));
  const g = {};
  for (const x of S.tx) {
    if (x.d < von || !isExpense(x) || x.c === 'Wohnen') continue;
    const k = merchKey(x.p); (g[k] = g[k] || { name: x.p, c: x.c, m: {}, amts: [] });
    g[k].m[x.d.slice(0, 7)] = (g[k].m[x.d.slice(0, 7)] || 0) - x.a; g[k].amts.push(-x.a);
  }
  return Object.values(g).filter(v => {
    const ms = Object.values(v.m); if (ms.length < 3) return false;
    const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
    return v.amts.length <= ms.length * 2 && ms.every(x => Math.abs(x - avg) / avg < 0.35) && avg >= 8;
  }).map(v => ({ name: v.name, c: v.c, avg: Object.values(v.m).reduce((a, b) => a + b, 0) / Object.keys(v.m).length, n: Object.keys(v.m).length }))
    .sort((a, b) => b.avg - a.avg);
}
/* ===================== Sperrbildschirm ===================== */
const lockEl = $('#lock');
let pinBuf = '', setupFirst = null;
function showApp(on) {
  lockEl.classList.toggle('hidden', on);
  $('#top').classList.toggle('hidden', !on); $('#main').classList.toggle('hidden', !on);
}
async function renderLock(err = '') {
  showApp(false);
  const auth = await DB.get('auth');
  const setup = !auth;
  const type = setup ? (S.pinTypeChoice || 'num6') : auth.type;
  const title = setup ? (setupFirst === null ? 'Code festlegen' : 'Code wiederholen') : 'Budget entsperren';
  const hint = setup ? (setupFirst === null ? 'Der Code schützt die App und verschlüsselt deine Sicherungen. Vergisst du ihn, lassen sich Sicherungen nicht mehr öffnen.' : 'Zur Bestätigung noch einmal eingeben.') : '';
  let body;
  if (type === 'num6') {
    body = `<div class="dots" aria-label="${pinBuf.length} von 6 Ziffern">${Array.from({length:6}, (_, i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="keypad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-pin="${n}">${n}</button>`).join('')}<span></span><button data-pin="0">0</button><button data-pin="del" aria-label="Löschen">⌫</button></div>`;
  } else {
    body = `<div style="width:min(340px,86vw);display:flex;flex-direction:column;gap:12px"><input type="password" id="pinText" autocomplete="off" autocapitalize="off" aria-label="Code"><button class="btn primary" data-action="pin-submit">${setup ? 'Weiter' : 'Entsperren'}</button></div>`;
  }
  lockEl.innerHTML = `<img src="icons/icon-192.png" alt=""><h2>${title}</h2>
    ${hint ? `<p class="muted" style="max-width:420px;text-align:center;margin:0">${hint}</p>` : ''}
    ${setup && setupFirst === null ? `<div class="chips" role="group" aria-label="Art des Codes"><button class="chip" data-pintype="num6" aria-pressed="${type==='num6'}">6 Ziffern</button><button class="chip" data-pintype="alnum" aria-pressed="${type==='alnum'}">Buchstaben und Ziffern</button></div>` : ''}
    ${body}<div class="err">${esc(err)}</div>`;
  const inp = $('#pinText'); if (inp) { inp.focus(); inp.addEventListener('keydown', e => { if (e.key === 'Enter') pinSubmit(inp.value); }); }
}
async function pinSubmit(pin) {
  const auth = await DB.get('auth');
  if (!auth) {
    if ((S.pinTypeChoice || 'num6') === 'alnum' && pin.length < 6) { pinBuf = ''; return renderLock('Mindestens 6 Zeichen verwenden.'); }
    if (setupFirst === null) { setupFirst = pin; pinBuf = ''; return renderLock(); }
    if (pin !== setupFirst) { setupFirst = null; pinBuf = ''; return renderLock('Die Codes stimmen nicht überein. Bitte neu festlegen.'); }
    const h = await hashPin(pin); await DB.set('auth', { ...h, type: S.pinTypeChoice || 'num6' });
    setupFirst = null; return unlock(pin);
  }
  const h = await hashPin(pin, auth.salt);
  if (h.hash === auth.hash) return unlock(pin);
  pinBuf = ''; await renderLock('Falscher Code.'); lockEl.querySelector('.dots,input')?.classList.add('shake');
}
function unlock(pin) { S.pin = pin; pinBuf = ''; showApp(true); render(); }
function lockNow() { S.pin = null; pinBuf = ''; $('#sheet-root').innerHTML = ''; renderLock(); }

/* ===================== Grafik-Bausteine ===================== */
function ring(frac, over) {
  const C = 2 * Math.PI * 44, f = Math.max(0, Math.min(1, frac));
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="9"/>
    <circle cx="50" cy="50" r="44" fill="none" stroke="${over ? '#ffb199' : '#fff'}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${over ? C : C * f} ${C}"/></svg>`;
}
const barHTML = (used, budget) => {
  const f = budget > 0 ? used / budget : (used > 0 ? 2 : 0);
  return `<div class="bar"><i class="${f > 1 ? 'over' : f > .8 ? 'warn' : ''}" style="width:${Math.min(100, f * 100)}%"></i></div>`;
};

/* ===================== Übersicht ===================== */
function renderHome() {
  const m = $('#main'), st = S.settings;
  if (!S.tx.length) {
    m.innerHTML = `<div class="tile empty"><h2>Noch keine Daten</h2><p class="muted">Importiere zuerst die Datei „startdaten.json“ mit deiner Auswertung. Danach kommen die CSVs aus dem E-Banking dazu.</p><button class="btn primary" data-view="import">Zum Import</button></div>`;
    return;
  }
  const pot = potState(), w = pot.weeks[pot.weeks.length - 1] || { budget: weekTotal(), spent: 0, carryIn: 0, sp: {}, von: iso(monday(today())) };
  const base = weekTotal(), rest = w.budget - w.spent, over = rest < 0;
  const wd = (today().getDay() + 6) % 7, daysLeft = 7 - wd;
  const scale = base > 0 ? w.budget / base : 1;
  const tab = tabakMonth(), tabRest = st.tabak - tab;
  const debtSum = S.debts.reduce((s, d) => s + (+d.saldo || 0), 0), plan = debtPlan();
  const fx = nextFix(5);
  const banners = [];
  const bdays = st.lastBackup ? dayDiff(iso(today()), st.lastBackup) : 999;
  if (today().getDay() === 0) banners.push(`<div class="banner"><div class="t"><b>Sonntag: Wochenabschluss.</b> <span class="muted">Lade die CSVs aus dem E-Banking und von der Kreditkarte, damit die Woche vollständig ist.</span></div><button class="btn small orange" data-view="import">Importieren</button></div>`);
  if (bdays > 30) banners.push(`<div class="banner"><div class="t"><b>Sicherung fällig.</b> <span class="muted">${st.lastBackup ? `Letzte Sicherung vor ${bdays} Tagen.` : 'Es gibt noch keine Sicherung.'}</span></div><button class="btn small orange" data-action="backup">Jetzt sichern</button></div>`);
  const lastDate = S.tx.filter(t => !t.m).reduce((mx, t) => t.d > mx ? t.d : mx, '');
  const wLabel = `${fmtD(w.von).slice(0,5)}. bis ${fmtD(iso(addDays(parseISO(w.von), 6))).slice(0,5)}.`;
  m.innerHTML = `${banners.join('')}
  <section class="bento">
    <div class="tile a-debt">
      <div class="label">Schulden</div>
      <div class="big warm" style="margin-top:12px">${chf(debtSum)}<small>CHF</small></div>
      <div class="note">${debtSum > 0 ? `Schuldenfrei ca. ${MONL[plan.date.getMonth()]} ${plan.date.getFullYear()}` : 'Schuldenfrei'}</div>
    </div>
    <div class="tile hero a-hero">
      <div class="label">Diese Woche noch verfügbar</div>
      <div class="ringwrap">${ring(w.budget > 0 ? rest / w.budget : 0, over)}
        <div class="ringcenter"><div class="big num">${chf(Math.abs(rest))}</div><div class="sub">${over ? 'CHF überzogen' : `von ${chf(w.budget)} CHF`}</div></div></div>
      <div class="hero-foot">
        <span class="pill">${daysLeft === 1 ? 'Letzter Tag' : `noch ${daysLeft} Tage`}</span>
        <span class="pill">${wLabel}</span>
        ${w.carryIn > 0 ? `<span class="pill warn">−${chf(w.carryIn)} aus der Vorwoche</span>` : ''}
      </div>
    </div>
    <div class="tile a-pot">
      <div class="orbdot" aria-hidden="true"></div>
      <div class="label">Schuldenfrei-Topf</div>
      <div class="big cool" style="margin-top:12px">${chf(pot.balance)}<small>CHF</small></div>
      <div class="note">${pot.balance > 0 ? 'Übrig aus abgeschlossenen Wochen.' : 'Was in einer Woche übrig bleibt, landet hier.'}</div>
      ${pot.balance >= 1 ? `<button class="btn small primary" style="margin-top:12px" data-action="pot-pay">Als Extrazahlung erfassen</button>` : ''}
    </div>
    <div class="tile a-tabak">
      <div class="label">Tabak im ${MONL[today().getMonth()]}</div>
      <div class="big ${tabRest < 0 ? 'warm' : ''}" style="margin-top:12px">${chf(Math.abs(tabRest))}<small>CHF</small></div>
      ${barHTML(tab, st.tabak)}
      <div class="note">${tabRest < 0 ? 'über dem Topf' : 'übrig'}, ${chf(tab)} von ${chf(st.tabak)} CHF gebraucht</div>
    </div>
    <div class="tile a-fix">
      <div class="label">Nächste Fixkosten</div>
      <div class="fixlist">${fx.map(f => `<div class="fixitem"><div class="day">${f.date.getDate()}<small>${MON[f.date.getMonth()]}</small></div><div class="n"><div>${esc(f.name)}</div></div><b>${chf(f.betrag)}</b></div>`).join('') || '<p class="muted">Keine Fixkosten mit Datum erfasst.</p>'}</div>
      <div class="note" style="margin-top:14px">Lohn erwartet am ${st.lohntag}. Daten bis ${lastDate ? fmtD(lastDate) : '–'}.</div>
    </div>
    <div class="tile a-add"><button class="addbtn" data-action="add"><span class="plus" aria-hidden="true">+</span>Ausgabe erfassen</button></div>
    <div class="tile a-posts">
      <div class="label">Wochenposten</div>
      <div class="posts">${st.posts.map(p => { const b = p.betrag * scale, u = w.sp[p.id] || 0; return `<div class="post"><div class="row"><span>${esc(p.name)}</span><b>${chf(u)} / ${chf(b)}</b></div>${barHTML(u, b)}</div>`; }).join('')}</div>
    </div>
  </section>`;
}

/* ===================== Ausgabe erfassen ===================== */
let addState = null;
function openAdd() {
  addState = { amt: '', post: 'w_leb', day: 0, note: '' };
  drawAdd();
}
function drawAdd() {
  const a = addState, posts = [...S.settings.posts, { id: 'tabak', name: 'Tabak' }];
  $('#sheet-root').innerHTML = `<div class="scrim" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Ausgabe erfassen">
    <div class="sheet-head"><h2>Ausgabe erfassen</h2><button class="iconbtn" data-action="close" aria-label="Schliessen">✕</button></div>
    <div class="amount num">${a.amt || '0'}<small> CHF</small></div>
    <div class="chips" role="group" aria-label="Posten">${posts.map(p => `<button class="chip" data-addpost="${p.id}" aria-pressed="${a.post === p.id}">${esc(p.name)}</button>`).join('')}</div>
    <div class="chips" style="margin-top:12px" role="group" aria-label="Tag">${['Heute','Gestern','Vorgestern'].map((l, i) => `<button class="chip" data-addday="${i}" aria-pressed="${a.day === i}">${l}</button>`).join('')}</div>
    <input type="text" id="addNote" placeholder="Notiz, z. B. Coop" value="${esc(a.note)}" style="margin-top:12px" aria-label="Notiz">
    <div class="keypad">${['1','2','3','4','5','6','7','8','9','.','0','del'].map(k => `<button data-addkey="${k}" ${k==='del'?'aria-label="Löschen"':''}>${k === 'del' ? '⌫' : k}</button>`).join('')}</div>
    <button class="btn primary" style="width:100%;margin-top:14px;padding:16px" data-action="add-save">Ausgabe speichern</button>
  </div></div>`;
  $('#addNote').addEventListener('input', e => addState.note = e.target.value);
}
async function saveAdd() {
  const v = parseFloat(addState.amt); if (!(v > 0)) return toast('Bitte einen Betrag eingeben.');
  const c = POST_CAT[addState.post], post = [...S.settings.posts, { id: 'tabak', name: 'Tabak' }].find(p => p.id === addState.post);
  S.tx.push({ id: 'm' + Date.now().toString(36), d: iso(addDays(today(), -addState.day)), a: -r2(v), c, s: post.name, p: addState.note.trim() || post.name, t: 'Manuell erfasst', q: 'H', m: 1 });
  S.tx.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  await save.tx(); closeSheet(); render(); toast(`${chf(v, 2)} CHF bei ${post.name} erfasst.`);
}
function closeSheet() { $('#sheet-root').innerHTML = ''; }

/* ===================== Topf-Extrazahlung ===================== */
function openPotPay() {
  const pot = potState();
  $('#sheet-root').innerHTML = `<div class="scrim" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Extrazahlung">
    <div class="sheet-head"><h2>Extrazahlung erfassen</h2><button class="iconbtn" data-action="close" aria-label="Schliessen">✕</button></div>
    <p class="muted">Überweise den Betrag im E-Banking auf die Schuld. Hier trägst du ihn ein, damit Topf und Restschuld stimmen.</p>
    <div class="stack" style="gap:12px">
      <label class="f">Betrag in CHF<input type="number" id="ppAmt" inputmode="decimal" value="${Math.floor(pot.balance)}"></label>
      <label class="f">Auf welche Schuld<select id="ppDebt">${S.debts.map(d => `<option value="${d.id}">${esc(d.name)} (${chf(d.saldo)} CHF)</option>`).join('')}</select></label>
      <button class="btn primary" data-action="pot-save">Extrazahlung speichern</button>
    </div></div></div>`;
}
async function savePotPay() {
  const v = +$('#ppAmt').value, id = $('#ppDebt').value; if (!(v > 0)) return;
  S.topf.push({ d: iso(today()), betrag: v, debt: id });
  const d = S.debts.find(x => x.id === id); if (d) d.saldo = Math.max(0, r2(d.saldo - v));
  await save.topf(); await save.debts(); closeSheet(); render(); toast('Extrazahlung gespeichert. Das Schuldenfrei-Datum ist aktualisiert.');
}
/* ===================== Analyse ===================== */
function renderAnalyse() {
  const m = $('#main');
  const years = [...new Set(S.tx.map(t => t.d.slice(0, 4)))].sort().reverse();
  const pers = [['12m','12 Monate'], ...years.map(y => [y, y]), ['alle','Alles']];
  const [von, bis] = periodRange(S.ana.per), A = analyse(von, bis);
  const cats = Object.entries(A.cat).sort((a, b) => b[1] - a[1]), max = cats[0]?.[1] || 1;
  const merch = Object.values(A.merch).sort((a, b) => b.sum - a.sum).slice(0, 12);
  const rec = recurring().slice(0, 12);
  const mk = Object.keys(A.months).sort().slice(-24);
  const mMax = Math.max(1, ...mk.map(k => Math.max(A.months[k].ein, A.months[k].aus)));
  const W = 1000, H = 220, bw = W / Math.max(mk.length, 1);
  const cols = mk.map((k, i) => { const e = A.months[k].ein / mMax * (H - 30), a = A.months[k].aus / mMax * (H - 30), x = i * bw;
    return `<rect x="${x + bw*.14}" y="${H - 22 - e}" width="${bw*.34}" height="${e}" rx="4" fill="#5ed3a3" opacity=".85"><title>${k}: Einnahmen ${chf(A.months[k].ein)}</title></rect>
      <rect x="${x + bw*.52}" y="${H - 22 - a}" width="${bw*.34}" height="${a}" rx="4" fill="${A.months[k].aus > A.months[k].ein ? '#f2934f' : '#7b5cff'}"><title>${k}: Ausgaben ${chf(A.months[k].aus)}</title></rect>
      ${i % Math.ceil(mk.length / 12) === 0 ? `<text x="${x + bw/2}" y="${H - 4}" fill="#9d9bc7" font-size="13" text-anchor="middle">${MON[+k.slice(5) - 1]} ${k.slice(2, 4)}</text>` : ''}`; }).join('');
  // Entwicklung pro Jahr für die grössten Kategorien
  const yrs = [...new Set(S.tx.map(t => t.d.slice(0, 4)))].sort();
  const byYear = {}; for (const t of S.tx) if (isExpense(t)) { const y = t.d.slice(0, 4); (byYear[t.c] = byYear[t.c] || {})[y] = (byYear[t.c][y] || 0) - t.a; }
  const topCats = Object.entries(byYear).map(([c, v]) => [c, Object.values(v).reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x[0]);
  m.innerHTML = `<div class="section-head"><h2>Analyse</h2><div class="chips" role="group" aria-label="Zeitraum">${pers.map(([k, l]) => `<button class="chip" data-per="${k}" aria-pressed="${S.ana.per === k}">${l}</button>`).join('')}</div></div>
  <div class="grid3">
    <div class="tile kpi"><div class="label">Einnahmen</div><div class="big pos" style="margin-top:8px">${chf(A.ein)}</div><div class="note">Ø ${chf(A.ein / A.nMonths)} CHF pro Monat</div></div>
    <div class="tile kpi"><div class="label">Ausgaben</div><div class="big" style="margin-top:8px">${chf(A.aus)}</div><div class="note">Ø ${chf(A.aus / A.nMonths)} CHF pro Monat</div></div>
    <div class="tile kpi"><div class="label">Differenz</div><div class="big ${A.ein - A.aus < 0 ? 'warm' : 'pos'}" style="margin-top:8px">${chf(A.ein - A.aus)}</div><div class="note">Ø ${chf((A.ein - A.aus) / A.nMonths)} CHF pro Monat</div></div>
  </div>
  <div class="stack" style="margin-top:18px">
    <div class="tile"><h3>Ausgaben nach Kategorie</h3><p class="note" style="margin-top:4px">Antippen zeigt Details. Kreditkarten-Rückzahlungen zählen nicht doppelt, die Einkäufe sind schon enthalten.</p>
      <div class="hbars">${cats.map(([c, v]) => `<button class="hbar" data-cat="${esc(c)}"><span class="nm">${esc(c)}</span><span class="track"><i style="width:${v / max * 100}%;background:${catCol(c)}"></i></span><span class="val">${chf(v / A.nMonths)}<small>pro Monat</small></span></button>`).join('')}</div></div>
    <div class="tile"><h3>Einnahmen und Ausgaben pro Monat</h3>
      <svg class="cols-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Monatsvergleich">${cols}</svg>
      <div class="legend"><span><i style="background:#5ed3a3"></i>Einnahmen</span><span><i style="background:#7b5cff"></i>Ausgaben</span><span><i style="background:#f2934f"></i>Ausgaben höher als Einnahmen</span></div></div>
    <div class="grid2">
      <div class="tile"><h3>Wohin am meisten Geld geht</h3><div class="list" style="margin-top:8px">${merch.map(x => `<div class="txrow" style="grid-template-columns:1fr auto"><div><div class="p">${esc(x.name)}</div><div class="c">${esc(x.c)}, ${x.n} Buchungen</div></div><div class="a">${chf(x.sum)}</div></div>`).join('')}</div></div>
      <div class="tile"><h3>Wiederkehrende Zahlungen</h3><p class="note">Regelmässig in den letzten sechs Monaten, ohne Miete.</p><div class="list">${rec.map(x => `<div class="txrow" style="grid-template-columns:1fr auto"><div><div class="p">${esc(x.name)}</div><div class="c">${esc(x.c)}, in ${x.n} Monaten</div></div><div class="a">${chf(x.avg)}<span class="faint" style="font-size:12px"> /Mt.</span></div></div>`).join('') || '<p class="muted">Keine gefunden.</p>'}</div></div>
    </div>
    <div class="tile" style="overflow-x:auto"><h3>Entwicklung pro Jahr</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-variant-numeric:tabular-nums;min-width:560px">
        <tr><th style="text-align:left;padding:8px 6px;color:var(--muted);font-weight:600">Kategorie</th>${yrs.map(y => `<th style="text-align:right;padding:8px 6px;color:var(--muted);font-weight:600">${y}</th>`).join('')}</tr>
        ${topCats.map(c => `<tr style="border-top:1px solid var(--line)"><td style="padding:9px 6px">${esc(c)}</td>${yrs.map(y => `<td style="text-align:right;padding:9px 6px;font-family:var(--round)">${chf(byYear[c][y] || 0)}</td>`).join('')}</tr>`).join('')}
      </table><p class="note">Das laufende Jahr ist noch nicht vollständig.</p></div>
  </div>`;
}
function openCat(c) {
  const [von, bis] = periodRange(S.ana.per), A = analyse(von, bis);
  const subs = Object.entries(A.sub).filter(([k]) => k.startsWith(c + '|')).map(([k, v]) => [k.split('|')[1], v]).sort((a, b) => b[1] - a[1]);
  const txs = S.tx.filter(t => t.c === c && t.d >= von && t.d <= bis && isExpense(t));
  const merch = {}; for (const t of txs) { const k = merchKey(t.p); (merch[k] = merch[k] || { n: t.p, s: 0, k: 0 }); merch[k].s -= t.a; merch[k].k++; }
  const top = Object.values(merch).sort((a, b) => b.s - a.s).slice(0, 10);
  $('#sheet-root').innerHTML = `<div class="scrim" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(c)}">
    <div class="sheet-head"><h2>${esc(c)}</h2><button class="iconbtn" data-action="close" aria-label="Schliessen">✕</button></div>
    <div class="big">${chf(A.cat[c] || 0)}<small>CHF im Zeitraum</small></div>
    <div class="note">Ø ${chf((A.cat[c] || 0) / A.nMonths)} CHF pro Monat, ${txs.length} Buchungen</div>
    ${subs.length > 1 ? `<h3 style="margin-top:18px">Aufteilung</h3><div class="list">${subs.map(([s, v]) => `<div class="txrow" style="grid-template-columns:1fr auto"><div class="p">${esc(s)}</div><div class="a">${chf(v)}</div></div>`).join('')}</div>` : ''}
    <h3 style="margin-top:18px">Grösste Empfänger</h3><div class="list">${top.map(x => `<div class="txrow" style="grid-template-columns:1fr auto"><div><div class="p">${esc(x.n)}</div><div class="c">${x.k} Buchungen</div></div><div class="a">${chf(x.s)}</div></div>`).join('')}</div>
    <button class="btn primary" style="width:100%;margin-top:18px" data-listcat="${esc(c)}">Alle Buchungen dieser Kategorie</button>
  </div></div>`;
}

/* ===================== Buchungen ===================== */
function renderBuchungen() {
  const m = $('#main'), L = S.list, q = L.q.trim().toUpperCase();
  const all = S.tx.filter(t => (!L.c || t.c === L.c) && (!q || (t.p + ' ' + t.t + ' ' + t.s).toUpperCase().includes(q))).reverse();
  const cats = Object.keys(CATS);
  m.innerHTML = `<div class="section-head"><h2>Buchungen</h2><span class="muted">${all.length} Einträge</span></div>
  <div class="tile">
    <div class="grid2" style="gap:12px"><input type="search" id="q" placeholder="Suchen, z. B. Coop oder Swica" value="${esc(L.q)}" aria-label="Suchen">
      <select id="fc" aria-label="Kategorie filtern"><option value="">Alle Kategorien</option>${cats.map(c => `<option ${L.c === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="list" style="margin-top:10px">${all.slice(0, L.n).map(t => `<button class="txrow" data-tx="${t.id}">
      <span class="d">${fmtD(t.d)}</span>
      <span style="min-width:0"><span class="p">${esc(t.p)}${t.m ? '<span class="tag">manuell</span>' : ''}${t.pend ? '<span class="tag o">vorgemerkt</span>' : ''}${t.x ? '<span class="tag">Tilgung</span>' : ''}</span><span class="c" style="display:block">${esc(t.c)}${t.s && t.s !== t.c ? ', ' + esc(t.s) : ''}</span></span>
      <span class="a ${t.a > 0 ? 'pos' : ''}">${t.a > 0 ? '+' : ''}${chf(t.a, 2)}</span></button>`).join('')}</div>
    ${all.length > L.n ? `<button class="btn" style="width:100%;margin-top:14px" data-action="more">Weitere laden</button>` : ''}
  </div>`;
  const qi = $('#q'); qi.addEventListener('input', e => { S.list.q = e.target.value; S.list.n = 150; const pos = e.target.selectionStart; renderBuchungen(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  $('#fc').addEventListener('change', e => { S.list.c = e.target.value; S.list.n = 150; renderBuchungen(); });
}
function openTx(id) {
  const t = S.tx.find(x => x.id === id); if (!t) return;
  const opts = Object.keys(CATS).map(c => `<option ${c === t.c ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const src = { K: 'Bankkonto', C: 'Kreditkarte', M: 'Migrolcard', H: 'Manuell' }[t.q] || t.q;
  $('#sheet-root').innerHTML = `<div class="scrim" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Buchung">
    <div class="sheet-head"><h2>${esc(t.p)}</h2><button class="iconbtn" data-action="close" aria-label="Schliessen">✕</button></div>
    <div class="big ${t.a > 0 ? 'pos' : ''}">${chf(t.a, 2)}<small>CHF</small></div>
    <p class="muted" style="margin:6px 0 16px">${fmtD(t.d)}, ${src}<br>${esc(t.t)}</p>
    <div class="stack" style="gap:12px">
      <label class="f">Kategorie<select id="txc">${opts}</select></label>
      <label class="f">Unterkategorie<input type="text" id="txs" value="${esc(t.s || '')}"></label>
      <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="txrule" style="width:22px;height:22px"> Alle Buchungen von „${esc(t.p.slice(0, 30))}“ so einordnen</label>
      <button class="btn primary" data-action="tx-save" data-id="${t.id}">Änderung speichern</button>
      ${t.m ? `<button class="btn" data-action="tx-del" data-id="${t.id}">Manuellen Eintrag löschen</button>` : ''}
    </div></div></div>`;
}
async function saveTx(id) {
  const t = S.tx.find(x => x.id === id); const c = $('#txc').value, s = $('#txs').value.trim() || c;
  t.c = c; t.s = s;
  if ($('#txrule').checked) {
    const key = t.p.toUpperCase().slice(0, 24).trim();
    S.rules = S.rules.filter(r => r.m !== key); S.rules.unshift({ m: key, c, s });
    let n = 0; for (const x of S.tx) if (!x.m && (x.p + ' ' + x.t).toUpperCase().includes(key) && Math.sign(x.a) === Math.sign(t.a)) { x.c = c; x.s = s; n++; }
    await save.rules(); toast(`${n} Buchungen angepasst und Regel gemerkt.`);
  } else toast('Gespeichert.');
  await save.tx(); closeSheet(); render();
}

/* ===================== Schulden ===================== */
function renderSchulden() {
  const m = $('#main'), plan = debtPlan(), p100 = debtPlan(100), total = S.debts.reduce((s, d) => s + (+d.saldo || 0), 0);
  const gain = plan.months - p100.months;
  m.innerHTML = `<div class="section-head"><h2>Schulden</h2></div>
  <div class="grid3">
    <div class="tile kpi"><div class="label">Total offen</div><div class="big warm" style="margin-top:8px">${chf(total)}</div><div class="note">Summe aller Restbeträge</div></div>
    <div class="tile kpi"><div class="label">Schuldenfrei</div><div class="big" style="margin-top:8px">${total > 0 ? `${MON[plan.date.getMonth()]} ${plan.date.getFullYear()}` : 'Jetzt'}</div><div class="note">in ${plan.months} Monaten mit den heutigen Raten</div></div>
    <div class="tile kpi"><div class="label">Zinsen bis dahin</div><div class="big" style="margin-top:8px">${chf(plan.interest)}</div><div class="note">${gain > 0 ? `Mit 100 CHF mehr pro Monat: ${gain} Monate früher, ${chf(plan.interest - p100.interest)} CHF weniger Zins` : 'Schätzung'}</div></div>
  </div>
  <div class="tile" style="margin-top:18px"><h3>Deine Schulden</h3>
    <p class="note">Restbetrag nach jeder Rechnung hier nachführen. Frei werdende Raten gehen automatisch auf die nächste Schuld, zuerst auf die mit dem höchsten Zins.</p>
    <div class="formrow faint" style="font-size:13px;font-weight:600"><span>Name</span><span>Restbetrag</span><span>Rate</span><span></span></div>
    ${S.debts.map((d, i) => `<div class="formrow"><input type="text" value="${esc(d.name)}" data-debt="${i}" data-f="name" aria-label="Name">
      <input type="number" inputmode="decimal" value="${d.saldo}" data-debt="${i}" data-f="saldo" aria-label="Restbetrag">
      <input type="number" inputmode="decimal" value="${d.rate}" data-debt="${i}" data-f="rate" aria-label="Monatsrate">
      <button class="iconbtn" data-action="debt-del" data-i="${i}" aria-label="Schuld entfernen">✕</button></div>
      <div style="display:flex;gap:10px;align-items:center;padding:0 0 12px;flex-wrap:wrap"><label class="f" style="flex-direction:row;align-items:center;gap:8px">Zins % pro Jahr <input type="number" inputmode="decimal" style="width:90px" value="${d.zins ?? ''}" placeholder="?" data-debt="${i}" data-f="zins"></label>
      <span class="note" style="margin:0">${d.zins == null ? 'Zins unbekannt, gerechnet wird mit 12 %. Er steht auf der Rechnung.' : ''} ${plan.list.find(x => x.name === d.name) && d.saldo > 0 ? `Abbezahlt ca. ${MON[plan.list.find(x => x.name === d.name).end.getMonth()]} ${plan.list.find(x => x.name === d.name).end.getFullYear()}` : ''}</span></div>`).join('')}
    <button class="btn" data-action="debt-add">Schuld hinzufügen</button>
  </div>
  <div class="tile" style="margin-top:18px"><h3>Extrazahlungen aus dem Schuldenfrei-Topf</h3>
    <div class="list">${S.topf.slice().reverse().map(t => `<div class="txrow" style="grid-template-columns:86px 1fr auto"><span class="d">${fmtD(t.d)}</span><span class="p">${esc(S.debts.find(d => d.id === t.debt)?.name || '–')}</span><span class="a">${chf(t.betrag)}</span></div>`).join('') || '<p class="muted">Noch keine. Sobald eine Woche mit Rest endet, füllt sich der Topf.</p>'}</div>
  </div>`;
}

/* ===================== Import ===================== */
function renderImport() {
  const log = (S.settings.importLog || []).slice(-6).reverse();
  $('#main').innerHTML = `<div class="section-head"><h2>Import</h2></div>
  <div class="grid2">
    <div class="tile drop"><h3>Dateien importieren</h3><p class="muted">Mehrere Dateien auf einmal sind möglich. Doppelte Buchungen werden erkannt und übersprungen.</p>
      <button class="btn primary" data-action="pick" style="margin-top:8px;padding:14px 26px">Dateien auswählen</button>
      <p class="note">Die Dateien werden nur auf diesem iPad gelesen und nirgends hochgeladen.</p></div>
    <div class="tile"><h3>Sonntagsritual</h3>
      <ol style="padding-left:20px;margin:10px 0 0;display:flex;flex-direction:column;gap:8px">
        <li>Im UBS E-Banking die Kontobewegungen der letzten Tage als CSV exportieren.</li>
        <li>Die Kreditkarten-Transaktionen als CSV exportieren.</li>
        <li>Bis zur Kündigung auch die Migrolcard-Transaktionen.</li>
        <li>Hier alle Dateien auswählen. Manuell erfasste Ausgaben werden automatisch durch die echten Buchungen ersetzt.</li>
      </ol></div>
  </div>
  <div class="tile" style="margin-top:18px"><h3>Letzte Importe</h3><div class="list">${log.map(l => `<div class="txrow" style="grid-template-columns:86px 1fr auto"><span class="d">${fmtD(l.d)}</span><span class="p">${esc(l.label)}</span><span class="c">${l.added} neu, ${l.dup} doppelt${l.matched ? `, ${l.matched} zugeordnet` : ''}</span></div>`).join('') || '<p class="muted">Noch keine Importe.</p>'}</div></div>`;
}
async function handleFiles(files) {
  const results = [];
  for (const f of files) {
    try {
      const r = detectAndParse(decodeFile(await f.arrayBuffer()), f.name);
      if (r.kind === 'backup') { await restoreBackup(r.pack); return; }
      const res = mergeTx(r.tx.map(t => ({ ...t })), r.q);
      (S.settings.importLog = S.settings.importLog || []).push({ d: iso(today()), label: `${r.label} (${f.name.slice(0, 40)})`, ...res });
      results.push(`${r.label}: ${res.added} neu`);
    } catch (e) { results.push(`${f.name}: ${e.message}`); }
  }
  await save.tx(); await save.settings(); render(); toast(results.join(', '));
}

/* ===================== Sicherung ===================== */
async function doBackup() {
  const pack = await encryptJSON({ tx: S.tx, settings: S.settings, rules: S.rules, debts: S.debts, topf: S.topf }, S.pin);
  const name = `budget-sicherung-${iso(today())}.budget`;
  const file = new File([JSON.stringify(pack)], name, { type: 'application/octet-stream' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: name });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    S.settings.lastBackup = iso(today()); await save.settings(); render(); toast('Sicherung erstellt. Speichere sie in „Dateien“ oder iCloud Drive.');
  } catch (e) { if (e.name !== 'AbortError') toast('Sicherung fehlgeschlagen: ' + e.message); }
}
async function restoreBackup(pack) {
  let data = null;
  try { data = await decryptJSON(pack, S.pin); } catch {}
  if (!data) {
    const pin = prompt('Diese Sicherung wurde mit einem anderen Code erstellt. Code der Sicherung eingeben:');
    if (!pin) return; try { data = await decryptJSON(pack, pin); } catch { return toast('Code falsch, Sicherung nicht geöffnet.'); }
  }
  if (!confirm(`Sicherung mit ${data.tx.length} Buchungen wiederherstellen? Die aktuellen Daten werden ersetzt.`)) return;
  Object.assign(S, { tx: data.tx, settings: Object.assign(DEFAULT_SETTINGS(), data.settings), rules: data.rules || [], debts: data.debts || [], topf: data.topf || [] });
  await Promise.all(Object.values(save).map(f => f())); render(); toast('Sicherung wiederhergestellt.');
}

/* ===================== Einstellungen ===================== */
function renderSettings() {
  const st = S.settings, avail = availableWeekly(), wt = weekTotal(), diff = avail - wt;
  $('#main').innerHTML = `<div class="section-head"><h2>Einstellungen</h2></div>
  <div class="stack">
    <div class="tile"><h3>Einnahmen und Tabak-Topf</h3>
      <div class="grid3" style="margin-top:12px;gap:12px">
        <label class="f">Nettolohn pro Monat<input type="number" inputmode="decimal" value="${st.lohn}" data-set="lohn"></label>
        <label class="f">Lohn kommt am<input type="number" inputmode="numeric" value="${st.lohntag}" data-set="lohntag"></label>
        <label class="f">Tabak-Topf pro Monat<input type="number" inputmode="decimal" value="${st.tabak}" data-set="tabak"></label>
      </div></div>
    <div class="tile"><h3>Wochenposten</h3>
      <p class="note">Verfügbar pro Woche nach Fixkosten und Tabak: <b>${chf(avail)} CHF</b>. Verteilt: <b>${chf(wt)} CHF</b>. ${diff < -1 ? `<span class="warm" style="font-weight:700">${chf(-diff)} CHF zu viel verteilt.</span>` : diff > 1 ? `Noch ${chf(diff)} CHF frei.` : 'Genau aufgeteilt.'}</p>
      ${st.posts.map((p, i) => `<div class="formrow" style="grid-template-columns:1fr 130px"><input type="text" value="${esc(p.name)}" data-post="${i}" data-f="name" aria-label="Name"><input type="number" inputmode="decimal" value="${p.betrag}" data-post="${i}" data-f="betrag" aria-label="Betrag pro Woche"></div>`).join('')}
      <label class="f" style="margin-top:12px;max-width:260px">Budget gilt ab<input type="date" value="${st.budgetStart}" data-set="budgetStart"></label></div>
    <div class="tile"><h3>Fixkosten</h3><p class="note">Total ${chf(fixTotal())} CHF pro Monat. Ohne Tag bedeutet: Rücklage für Jahresrechnungen.</p>
      <div class="formrow faint" style="font-size:13px;font-weight:600"><span>Name</span><span>CHF/Monat</span><span>Tag</span><span></span></div>
      ${st.fix.map((f, i) => `<div class="formrow"><input type="text" value="${esc(f.name)}" data-fix="${i}" data-f="name" aria-label="Name"><input type="number" inputmode="decimal" value="${f.betrag}" data-fix="${i}" data-f="betrag" aria-label="Betrag"><input type="number" inputmode="numeric" value="${f.tag ?? ''}" data-fix="${i}" data-f="tag" aria-label="Tag"><button class="iconbtn" data-action="fix-del" data-i="${i}" aria-label="Entfernen">✕</button></div>`).join('')}
      <button class="btn" data-action="fix-add" style="margin-top:8px">Fixkosten hinzufügen</button></div>
    <div class="tile"><h3>Zuordnung</h3>
      <label style="display:flex;gap:10px;align-items:center;margin-top:10px"><input type="checkbox" data-set="migrolAktiv" ${st.migrolAktiv ? 'checked' : ''} style="width:22px;height:22px"> Migrolcard aktiv (Rechnungen von Migrol AG zählen nicht doppelt)</label>
      <p class="note">Nach der Kündigung ausschalten. Dann zählen Käufe an Tankstellen direkt vom Konto.</p>
      <h3 style="margin-top:16px">Gemerkte Regeln</h3><div class="list">${S.rules.map((r, i) => `<div class="txrow" style="grid-template-columns:1fr auto 40px"><span class="p">${esc(r.m)}</span><span class="c">${esc(r.c)}</span><button class="iconbtn" data-action="rule-del" data-i="${i}" aria-label="Regel löschen">✕</button></div>`).join('') || '<p class="muted">Noch keine. Regeln entstehen, wenn du eine Buchung umkategorisierst.</p>'}</div></div>
    <div class="tile"><h3>Sicherheit und Sicherung</h3>
      <p class="note">Letzte Sicherung: ${st.lastBackup ? fmtD(st.lastBackup) : 'noch keine'}. Wiederherstellen: Sicherungsdatei unter „Import“ auswählen.</p>
      <div class="chips" style="margin-top:12px"><button class="btn primary" data-action="backup">Jetzt sichern</button><button class="btn" data-action="pin-change">Code ändern</button><button class="btn" data-action="wipe" style="color:var(--coral)">Alle Daten löschen</button></div>
      <p class="note">Nach einer Code-Änderung lassen sich ältere Sicherungen nur mit dem alten Code öffnen.</p></div>
  </div>`;
}

/* ===================== Steuerung ===================== */
function render() {
  document.querySelectorAll('#nav button').forEach(b => b.dataset.view === S.view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  ({ home: renderHome, analyse: renderAnalyse, buchungen: renderBuchungen, schulden: renderSchulden, import: renderImport, settings: renderSettings })[S.view]();
}
function go(v) { S.view = v; closeSheet(); render(); window.scrollTo(0, 0); }

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action],[data-view],[data-pin],[data-pintype],[data-per],[data-cat],[data-tx],[data-addkey],[data-addpost],[data-addday],[data-listcat]');
  if (!el) return;
  const d = el.dataset;
  if (d.action === 'close-sheet' && e.target !== el) return;
  if (d.view) return go(d.view);
  if (d.pintype) { S.pinTypeChoice = d.pintype; pinBuf = ''; return renderLock(); }
  if (d.pin) {
    if (d.pin === 'del') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 6) pinBuf += d.pin;
    await renderLock(); if (pinBuf.length === 6) pinSubmit(pinBuf); return;
  }
  if (d.per) { S.ana.per = d.per; return render(); }
  if (d.cat) return openCat(d.cat);
  if (d.listcat) { S.list = { q: '', c: d.listcat, n: 150 }; return go('buchungen'); }
  if (d.tx) return openTx(d.tx);
  if (d.addkey) { let a = addState.amt; if (d.addkey === 'del') a = a.slice(0, -1); else if (d.addkey === '.') { if (!a.includes('.')) a = (a || '0') + '.'; } else if (!/\.\d\d$/.test(a) && a.length < 7) a = (a === '0' ? '' : a) + d.addkey; addState.amt = a; $('.amount').innerHTML = `${a || '0'}<small> CHF</small>`; return; }
  if (d.addpost) { addState.post = d.addpost; return drawAdd(); }
  if (d.addday) { addState.day = +d.addday; return drawAdd(); }
  switch (d.action) {
    case 'lock': return lockNow();
    case 'pin-submit': return pinSubmit($('#pinText').value);
    case 'add': return openAdd();
    case 'add-save': return saveAdd();
    case 'close': case 'close-sheet': return closeSheet();
    case 'pot-pay': return openPotPay();
    case 'pot-save': return savePotPay();
    case 'tx-save': return saveTx(d.id);
    case 'tx-del': S.tx = S.tx.filter(t => t.id !== d.id); await save.tx(); closeSheet(); return render();
    case 'more': S.list.n += 300; return render();
    case 'pick': return $('#file').click();
    case 'backup': return doBackup();
    case 'debt-add': S.debts.push({ id: 'd' + Date.now().toString(36), name: 'Neue Schuld', saldo: 0, rate: 0, zins: null }); await save.debts(); return render();
    case 'debt-del': if (confirm('Diese Schuld entfernen?')) { S.debts.splice(+d.i, 1); await save.debts(); render(); } return;
    case 'fix-add': S.settings.fix.push({ name: 'Neu', betrag: 0, tag: null, c: 'Wohnen' }); await save.settings(); return render();
    case 'fix-del': S.settings.fix.splice(+d.i, 1); await save.settings(); return render();
    case 'rule-del': S.rules.splice(+d.i, 1); await save.rules(); return render();
    case 'pin-change': if (confirm('Code ändern? Danach die App mit dem neuen Code sichern.')) { await DB.set('auth', null); S.pin = null; setupFirst = null; pinBuf = ''; renderLock(); } return;
    case 'wipe': if (confirm('Wirklich alle Daten auf diesem iPad löschen?') && confirm('Endgültig löschen? Das lässt sich nur mit einer Sicherung rückgängig machen.')) { await DB.clear(); location.reload(); } return;
  }
});
document.addEventListener('change', async e => {
  const t = e.target, d = t.dataset; const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? null : +t.value) : t.value;
  if (d.set) { S.settings[d.set] = v; await save.settings(); return render(); }
  if (d.post != null) { S.settings.posts[+d.post][d.f] = d.f === 'betrag' ? (+v || 0) : v; await save.settings(); return render(); }
  if (d.fix != null) { S.settings.fix[+d.fix][d.f] = d.f === 'betrag' ? (+v || 0) : v; await save.settings(); return render(); }
  if (d.debt != null) { const x = S.debts[+d.debt]; x[d.f] = d.f === 'name' ? v : (d.f === 'zins' ? v : (+v || 0)); await save.debts(); return render(); }
});
$('#file').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) handleFiles(f); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// Automatische Sperre, wenn die App länger als eine Minute im Hintergrund war
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S.pin && Date.now() - hiddenAt > 60000) lockNow();
});

(async function init() {
  await DB.open(); await load();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  renderLock();
})();
