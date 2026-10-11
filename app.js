(function () {
  'use strict';

  const CATS = [
    ['food', 'Food & drinks'], ['groceries', 'Groceries'], ['transport', 'Transport'],
    ['shopping', 'Shopping'], ['bills', 'Bills'], ['fun', 'Fun'], ['other', 'Other']
  ];
  const CAT = Object.fromEntries(CATS);
  const CAT_BY_LABEL = Object.fromEntries(CATS.map(([k, v]) => [v.toLowerCase(), k]));
  const nf = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = b => nf.format((b || 0) / 100);
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ----- Storage (on this phone) -----
  const KEY = 'pocketLedger.v1';
  let storageOk = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const d = raw ? JSON.parse(raw) : null;
      if (d && typeof d === 'object') return d;
    } catch (e) { storageOk = false; }
    return {};
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ months: S.months, budget: S.budget, lastMethod: S.lastMethod, period: S.period, hideInstall: S.hideInstall }));
      return true;
    } catch (e) {
      toast("Couldn't save on this phone. Free up some storage and try again.", 5000);
      return false;
    }
  }

  const saved = load();
  const S = {
    months: saved.months && typeof saved.months === 'object' ? saved.months : {},
    budget: typeof saved.budget === 'number' && saved.budget > 0 ? saved.budget : null,
    lastMethod: saved.lastMethod === 'cash' ? 'cash' : 'card',
    period: ['day', 'week', 'month'].includes(saved.period) ? saved.period : 'day',
    hideInstall: !!saved.hideInstall,
    offset: 0, editId: null, editKey: null, method: 'card', cat: null
  };

  // Ask the browser not to clear this app's data when the phone is low on space.
  let askedPersist = false;
  function askPersist() {
    if (askedPersist) return; askedPersist = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  }

  const monthKey = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const newId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fmtShort = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const dayName = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeOf = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const toLocalInput = ms => { const d = new Date(ms); return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  function parseAmount(raw) {
    let s = String(raw || '').replace(/\s|lei|ron/gi, '');
    if (!s) return NaN;
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    if (!/^\d*\.?\d*$/.test(s)) return NaN;
    const v = Math.round(parseFloat(s) * 100);
    return v > 0 ? v : NaN;
  }

  function allEntries() {
    const out = [];
    for (const k in S.months) {
      const m = S.months[k] || {};
      for (const id in m) { const e = m[id]; if (e && typeof e.amount === 'number' && typeof e.at === 'number') out.push(e); }
    }
    return out;
  }
  function putEntry(entry, oldKey) {
    const k = monthKey(entry.at);
    if (oldKey && oldKey !== k && S.months[oldKey]) delete S.months[oldKey][entry.id];
    (S.months[k] = S.months[k] || {})[entry.id] = entry;
  }
  function removeEntry(id, k) { if (S.months[k]) delete S.months[k][id]; }
  function monthSpent(key) {
    let sum = 0;
    allEntries().forEach(x => { if (monthKey(x.at) === key) sum += x.amount; });
    return sum;
  }
  const monthName = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long' }); };

  // ----- Periods -----
  function range() {
    const n = new Date();
    let s, e;
    if (S.period === 'day') {
      s = new Date(n.getFullYear(), n.getMonth(), n.getDate() + S.offset);
      e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
    } else if (S.period === 'week') {
      const dow = (n.getDay() + 6) % 7; // weeks start on Monday
      s = new Date(n.getFullYear(), n.getMonth(), n.getDate() - dow + 7 * S.offset);
      e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
    } else {
      s = new Date(n.getFullYear(), n.getMonth() + S.offset, 1);
      e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
    }
    return [s, e];
  }
  function labels(s, e) {
    const o = S.offset;
    const last = new Date(e.getTime() - 1);
    if (S.period === 'day') return [o === 0 ? 'Today' : o === -1 ? 'Yesterday' : s.toLocaleDateString('en-GB', { weekday: 'long' }), dayName(s)];
    if (S.period === 'week') return [o === 0 ? 'This week' : o === -1 ? 'Last week' : 'Week of ' + fmtShort(s), fmtShort(s) + ' – ' + fmtShort(last)];
    return [s.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), o === 0 ? 'This month' : o === -1 ? 'Last month' : ''];
  }

  // ----- Rendering -----
  function render() {
    const [s, e] = range();
    const t0 = s.getTime(), t1 = e.getTime();
    const items = allEntries().filter(x => x.at >= t0 && x.at < t1).sort((a, b) => b.at - a.at);
    let total = 0, card = 0, cash = 0;
    items.forEach(x => { total += x.amount; if (x.method === 'cash') cash += x.amount; else card += x.amount; });

    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === S.period)));
    const [l1, l2] = labels(s, e);
    $('plabel').textContent = l1;
    const count = items.length ? items.length + (items.length === 1 ? ' purchase' : ' purchases') : '';
    $('psub').textContent = [l2, count].filter(Boolean).join(' · ');
    $('next').disabled = S.offset >= 0;
    $('total').textContent = money(total);
    $('cardAmt').textContent = money(card) + ' lei';
    $('cashAmt').textContent = money(cash) + ' lei';
    $('sCard').style.width = total ? (card / total * 100) + '%' : '0';
    $('sCash').style.width = total ? (cash / total * 100) + '%' : '0';

    renderBudget(s);
    renderChart(s, e, items);
    renderCats(items, total);
    renderList(items);
    renderPast();
  }

  function renderBudget(s) {
    const box = $('budget');
    const key = monthKey(s.getTime());
    const B = S.budget;
    if (!B) {
      box.dataset.state = 'none';
      $('bLabel').textContent = 'Monthly budget';
      $('bEdit').textContent = 'Set budget';
      $('bMeterWrap').hidden = true;
      $('bText').textContent = 'Set a monthly limit to see how much you have left.';
      return;
    }
    const spent = monthSpent(key);
    const pct = spent / B;
    box.dataset.state = pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
    $('bLabel').textContent = monthName(key) + ' budget';
    $('bEdit').textContent = 'Change';
    $('bMeterWrap').hidden = false;
    $('bMeter').style.width = Math.min(pct, 1) * 100 + '%';
    let html;
    if (pct >= 1) {
      html = '<strong>' + money(spent - B) + ' lei over</strong> your ' + money(B) + ' lei budget';
    } else {
      html = money(spent) + ' of ' + money(B) + ' lei spent · <strong>' + money(B - spent) + ' lei left</strong>';
      const now = new Date();
      if (key === monthKey(now.getTime())) {
        const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysLeft = dim - now.getDate() + 1;
        html += '<span class="daily">About ' + money(Math.floor((B - spent) / daysLeft)) + ' lei a day for the ' +
          (daysLeft === 1 ? 'rest of today' : daysLeft + ' days left this month') + '</span>';
      }
    }
    $('bText').innerHTML = html;
  }

  function budgetWarning(key, before, after) {
    const B = S.budget;
    if (!B) return null;
    const m = monthName(key);
    if (before < B && after >= B) return "You've gone over your " + m + ' budget by ' + money(after - B) + ' lei.';
    if (before < 0.8 * B && after >= 0.8 * B) return 'Heads up: ' + Math.floor(after / B * 100) + '% of your ' + m + ' budget is used. ' + money(B - after) + ' lei left.';
    return null;
  }

  function renderChart(s, e, items) {
    const el = $('chart');
    if (S.period === 'day') { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const days = [];
    for (let d = new Date(s); d < e; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
    const byDay = {};
    items.forEach(x => {
      const k = new Date(x.at).toDateString();
      const b = byDay[k] || (byDay[k] = { card: 0, cash: 0 });
      if (x.method === 'cash') b.cash += x.amount; else b.card += x.amount;
    });
    let max = 0;
    days.forEach(d => { const b = byDay[d.toDateString()]; if (b) max = Math.max(max, b.card + b.cash); });
    const todayKey = new Date().toDateString();
    const isWeek = S.period === 'week';
    const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const gap = isWeek ? '6px' : '2px';
    const bars = days.map(d => {
      const b = byDay[d.toDateString()] || { card: 0, cash: 0 };
      const hCash = max ? b.cash / max * 100 : 0, hCard = max ? b.card / max * 100 : 0;
      return '<div class="bar" title="' + esc(dayName(d) + ': ' + money(b.card + b.cash) + ' lei') + '"><span class="b-cash" style="height:' + hCash + '%"></span><span class="b-card" style="height:' + hCard + '%"></span></div>';
    }).join('');
    const ticks = days.map((d, i) => {
      const lab = isWeek ? letters[i] : ([1, 8, 15, 22, 29].includes(d.getDate()) ? d.getDate() : '');
      return '<span class="' + (d.toDateString() === todayKey ? 'today' : '') + '">' + lab + '</span>';
    }).join('');
    el.innerHTML = '<div class="chart-cap"><span>Spending per day</span><span>' + (max ? 'Highest day <b>' + money(max) + ' lei</b>' : 'No spending yet') + '</span></div>' +
      '<div class="bars" style="--n:' + days.length + ';--gap:' + gap + '">' + bars + '</div>' +
      '<div class="ticks" style="--n:' + days.length + ';--gap:' + gap + '">' + ticks + '</div>';
  }

  function renderCats(items, total) {
    const wrap = $('catsWrap');
    if (!items.length) { wrap.hidden = true; return; }
    const sums = {};
    items.forEach(x => { const c = CAT[x.cat] ? x.cat : 'other'; sums[c] = (sums[c] || 0) + x.amount; });
    const rows = Object.entries(sums).sort((a, b) => b[1] - a[1]);
    const top = rows[0][1];
    $('cats').innerHTML = rows.map(([c, v]) =>
      '<div class="cat-row"><span class="name">' + esc(CAT[c]) + '</span><span class="amt">' + money(v) + ' lei · ' + Math.round(v / total * 100) + '%</span>' +
      '<div class="meter"><span style="width:' + (v / top * 100) + '%"></span></div></div>'
    ).join('');
    wrap.hidden = false;
  }

  function renderList(items) {
    const el = $('list');
    if (!items.length) {
      const ever = allEntries().length > 0;
      const when = S.period === 'day' ? (S.offset === 0 ? 'today' : 'on this day') : S.period === 'week' ? 'this week' : 'this month';
      el.innerHTML = '<div class="empty"><strong>' + (ever ? 'Nothing logged ' + when : 'Your purchases will show up here') +
        '</strong>Tap <b>Add expense</b> and enter the amount, what you bought, and whether you paid by card or cash.</div>';
      return;
    }
    const groups = [];
    let cur = null;
    items.forEach(x => {
      const k = new Date(x.at).toDateString();
      if (!cur || cur.k !== k) { cur = { k, d: new Date(x.at), items: [], sum: 0 }; groups.push(cur); }
      cur.items.push(x); cur.sum += x.amount;
    });
    const today = new Date().toDateString();
    const yest = new Date(Date.now() - 864e5).toDateString();
    el.innerHTML = groups.map(g => {
      const name = g.k === today ? 'Today' : g.k === yest ? 'Yesterday' : dayName(g.d);
      return '<div class="day"><div class="day-h"><strong>' + name + '</strong><span>' + money(g.sum) + ' lei</span></div>' +
        g.items.map(x =>
          '<button type="button" class="row" data-id="' + esc(x.id) + '">' +
          '<span class="r-main"><span class="r-item">' + esc(x.item) + '</span><span class="r-sub">' + timeOf(x.at) + ' · ' + esc(CAT[x.cat] || 'Other') + '</span></span>' +
          '<span class="pay ' + (x.method === 'cash' ? 'cash' : 'card') + '">' + (x.method === 'cash' ? 'Cash' : 'Card') + '</span>' +
          '<span class="r-amt">' + money(x.amount) + '</span></button>'
        ).join('') + '</div>';
    }).join('');
  }

  function renderPast() {
    const seen = new Set(); const names = [];
    allEntries().sort((a, b) => b.at - a.at).forEach(x => {
      const k = (x.item || '').toLowerCase();
      if (k && !seen.has(k) && names.length < 40) { seen.add(k); names.push(x.item); }
    });
    $('pastItems').innerHTML = names.map(n => '<option value="' + esc(n) + '"></option>').join('');
  }

  // ----- Expense sheet -----
  $('chips').innerHTML = CATS.map(([k, v]) => '<button type="button" class="chip" id="cat-' + k + '" data-c="' + k + '" aria-pressed="false">' + esc(v) + '</button>').join('');

  function setMethod(m) {
    S.method = m === 'cash' ? 'cash' : 'card';
    $('mCard').setAttribute('aria-pressed', String(S.method === 'card'));
    $('mCash').setAttribute('aria-pressed', String(S.method === 'cash'));
  }
  function setCat(c) {
    S.cat = CAT[c] ? c : null;
    document.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === S.cat)));
  }
  function lock(on) { document.body.classList.toggle('locked', on); }

  function openSheet(entry) {
    S.editId = entry ? entry.id : null;
    S.editKey = entry ? monthKey(entry.at) : null;
    $('formTitle').textContent = entry ? 'Edit expense' : 'New expense';
    $('amt').value = entry ? money(entry.amount).replace(/\./g, '') : '';
    $('item').value = entry ? entry.item : '';
    setMethod(entry ? entry.method : S.lastMethod);
    setCat(entry ? entry.cat : null);
    let at = Date.now();
    if (!entry && S.period === 'day' && S.offset !== 0) {
      const [s] = range(); const n = new Date();
      at = new Date(s.getFullYear(), s.getMonth(), s.getDate(), n.getHours(), n.getMinutes()).getTime();
    }
    $('when').value = toLocalInput(entry ? entry.at : at);
    const del = $('delBtn'); del.hidden = !entry; del.classList.remove('armed'); del.textContent = 'Delete';
    $('amtErr').hidden = true; $('itemErr').hidden = true;
    $('sheet').hidden = false; lock(true);
    if (!entry) $('amt').focus();
  }
  function closeSheet() { $('sheet').hidden = true; lock(false); }

  function openBudget() {
    $('bAmt').value = S.budget ? money(S.budget).replace(/\./g, '') : '';
    const r = $('bRemove'); r.hidden = !S.budget; r.classList.remove('armed'); r.textContent = 'Remove';
    $('bErr').hidden = true;
    $('bSheet').hidden = false; lock(true);
    $('bAmt').focus();
  }
  function closeBudget() { $('bSheet').hidden = true; lock(false); }

  let toastT;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  // ----- Export -----
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const HEADER = ['Date', 'Time', 'What you bought', 'Category', 'Paid with', 'Amount (lei)'];
  function buildCsv(items) {
    const rows = [HEADER];
    items.slice().sort((a, b) => a.at - b.at).forEach(x => {
      const d = new Date(x.at);
      rows.push([ymd(d), pad(d.getHours()) + ':' + pad(d.getMinutes()), x.item, CAT[x.cat] || 'Other',
        x.method === 'cash' ? 'Cash' : 'Card', (x.amount / 100).toFixed(2)]);
    });
    return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  async function doExport(all) {
    let items, name;
    if (all) {
      items = allEntries();
      name = 'pocket-ledger-all-' + ymd(new Date()) + '.csv';
    } else {
      const [s, e] = range();
      items = allEntries().filter(x => x.at >= s.getTime() && x.at < e.getTime());
      name = S.period === 'month' ? 'pocket-ledger-' + monthKey(s.getTime()) + '.csv'
        : 'pocket-ledger-' + (S.period === 'week' ? 'week-of-' : '') + ymd(s) + '.csv';
    }
    if (!items.length) { toast(all ? 'There are no expenses to export yet.' : 'Nothing logged in this period to export.'); return; }
    const csv = buildCsv(items);
    // On iPhone, the share sheet lets you save to Files or send the file anywhere.
    try {
      const file = new File([csv], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Exported ' + items.length + (items.length === 1 ? ' expense' : ' expenses'));
    } catch (e) {
      toast("Couldn't export the file. Try again.");
    }
  }

  // ----- Import -----
  function parseCsv(text) {
    const rows = []; let row = [], field = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(v => v.trim() !== '')) rows.push(row);
    return rows;
  }
  function importCsv(text) {
    const rows = parseCsv(text);
    if (!rows.length) return { added: 0, skipped: 0, bad: 0 };
    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = name => head.indexOf(name.toLowerCase());
    const iD = col('Date'), iT = col('Time'), iI = col('What you bought'), iC = col('Category'), iP = col('Paid with'), iA = col('Amount (lei)');
    if (iD < 0 || iI < 0 || iA < 0) return null;
    const sig = x => [Math.floor(x.at / 60000), x.amount, (x.item || '').trim().toLowerCase(), x.method].join('|');
    const have = new Set(allEntries().map(sig));
    let added = 0, skipped = 0, bad = 0;
    rows.slice(1).forEach(r => {
      const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec((r[iD] || '').trim());
      const tm = /^(\d{1,2}):(\d{2})/.exec(iT >= 0 ? (r[iT] || '').trim() : '');
      let item = (r[iI] || '').trim().replace(/^'(?=[=+\-@])/, '');
      const amount = Math.round(parseFloat(String(r[iA] || '').replace(',', '.')) * 100);
      if (!dm || !item || !(amount > 0)) { bad++; return; }
      const at = new Date(+dm[1], +dm[2] - 1, +dm[3], tm ? +tm[1] : 12, tm ? +tm[2] : 0).getTime();
      const method = iP >= 0 && /cash|numerar/i.test(r[iP] || '') ? 'cash' : 'card';
      const cat = iC >= 0 ? (CAT_BY_LABEL[(r[iC] || '').trim().toLowerCase()] || 'other') : 'other';
      const entry = { id: newId(), amount, item: item.slice(0, 80), method, cat, at, updated: Date.now() };
      const s = sig(entry);
      if (have.has(s)) { skipped++; return; }
      have.add(s);
      putEntry(entry, null);
      added++;
    });
    return { added, skipped, bad };
  }

  // ----- Events -----
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    S.period = b.dataset.p; S.offset = 0; persist(); render();
  });
  $('prev').addEventListener('click', () => { S.offset--; render(); });
  $('next').addEventListener('click', () => { if (S.offset < 0) { S.offset++; render(); } });
  $('addBtn').addEventListener('click', () => openSheet(null));
  $('closeBtn').addEventListener('click', closeSheet);
  $('scrim').addEventListener('click', closeSheet);
  $('mCard').addEventListener('click', () => setMethod('card'));
  $('mCash').addEventListener('click', () => setMethod('cash'));
  $('chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    setCat(S.cat === b.dataset.c ? null : b.dataset.c);
  });
  $('list').addEventListener('click', e => {
    const r = e.target.closest('.row'); if (!r) return;
    const entry = allEntries().find(x => x.id === r.dataset.id);
    if (entry) openSheet(entry);
  });
  $('delBtn').addEventListener('click', () => {
    const b = $('delBtn');
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Tap again to delete'; return; }
    removeEntry(S.editId, S.editKey);
    persist(); closeSheet(); render(); toast('Expense deleted');
  });
  $('form').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseAmount($('amt').value);
    const item = $('item').value.trim();
    $('amtErr').hidden = !isNaN(amount);
    $('itemErr').hidden = !!item;
    if (isNaN(amount)) { $('amt').focus(); return; }
    if (!item) { $('item').focus(); return; }
    let at = $('when').value ? new Date($('when').value).getTime() : Date.now();
    if (isNaN(at)) at = Date.now();
    const editing = !!S.editId;
    const entry = { id: S.editId || newId(), amount, item, method: S.method, cat: S.cat || 'other', at, updated: Date.now() };
    const key = monthKey(at);
    const before = monthSpent(key);
    putEntry(entry, S.editKey);
    const after = monthSpent(key);
    S.lastMethod = S.method;
    closeSheet();
    if (!persist()) return;
    askPersist();
    render();
    const warning = budgetWarning(key, before, after);
    if (warning) { toast(warning, 5000); return; }
    const [s, en] = range();
    const outside = at < s.getTime() || at >= en.getTime();
    toast((editing ? 'Updated ' : 'Saved ') + money(amount) + ' lei · ' + (entry.method === 'cash' ? 'Cash' : 'Card') + (outside ? ' · ' + dayName(new Date(at)) : ''));
  });

  $('bEdit').addEventListener('click', openBudget);
  $('bClose').addEventListener('click', closeBudget);
  $('bScrim').addEventListener('click', closeBudget);
  $('bForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = parseAmount($('bAmt').value);
    $('bErr').hidden = !isNaN(v);
    if (isNaN(v)) { $('bAmt').focus(); return; }
    S.budget = v; persist(); closeBudget(); render();
    toast('Monthly budget set to ' + money(v) + ' lei');
  });
  $('bRemove').addEventListener('click', () => {
    const b = $('bRemove');
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Tap again to remove'; return; }
    S.budget = null; persist(); closeBudget(); render();
    toast('Budget removed');
  });

  $('expPeriod').addEventListener('click', () => doExport(false));
  $('expAll').addEventListener('click', () => doExport(true));
  $('impBtn').addEventListener('click', () => $('impFile').click());
  $('impFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importCsv(String(reader.result || ''));
      if (!res) { toast("That file isn't a Pocket Ledger export. Choose a CSV exported from Pocket Ledger.", 5000); return; }
      if (res.added && !persist()) return;
      render();
      const parts = [res.added + (res.added === 1 ? ' expense added' : ' expenses added')];
      if (res.skipped) parts.push(res.skipped + ' already here');
      if (res.bad) parts.push(res.bad + ' rows unreadable');
      toast(parts.join(' · '), 5000);
    };
    reader.onerror = () => toast("Couldn't read that file. Try again.");
    reader.readAsText(f);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('sheet').hidden) closeSheet();
    if (!$('bSheet').hidden) closeBudget();
  });

  // Refresh "today" when the app comes back to the front on a new day.
  let lastDay = new Date().toDateString();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && new Date().toDateString() !== lastDay) { lastDay = new Date().toDateString(); render(); }
  });

  // Home-screen hint: only in the browser, never inside the installed app.
  const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  $('install').hidden = standalone || S.hideInstall;
  $('installHide').addEventListener('click', () => { S.hideInstall = true; persist(); $('install').hidden = true; });

  if (!storageOk) {
    $('syncNote').textContent = "Can't save here";
    toast('This browser is blocking storage, so expenses will not be kept. Open the page in Safari, not a private tab.', 6000);
  }

  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
