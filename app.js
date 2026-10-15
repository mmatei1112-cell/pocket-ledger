(function () {
  'use strict';

  // ---------- Basics ----------
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 864e5;
  const KEY2 = 'pocketLedger.v2';
  const KEY1 = 'pocketLedger.v1';

  const PALETTE = ['#F59E0B', '#22A06B', '#3B82F6', '#EC4899', '#8B5CF6', '#0EA5E9', '#EF4444', '#14B8A6', '#F97316', '#84CC16', '#A855F7', '#64748B'];
  const DEFAULT_CATS = [
    { id: 'food', name: 'Food & drinks', emoji: '🍔', color: '#F59E0B', kind: 'expense' },
    { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#22A06B', kind: 'expense' },
    { id: 'transport', name: 'Transport', emoji: '🚌', color: '#3B82F6', kind: 'expense' },
    { id: 'shopping', name: 'Shopping', emoji: '🛍️', color: '#EC4899', kind: 'expense' },
    { id: 'bills', name: 'Bills', emoji: '🧾', color: '#8B5CF6', kind: 'expense' },
    { id: 'subs', name: 'Subscriptions', emoji: '📱', color: '#0EA5E9', kind: 'expense' },
    { id: 'fun', name: 'Fun', emoji: '🎮', color: '#EF4444', kind: 'expense' },
    { id: 'health', name: 'Health', emoji: '💊', color: '#14B8A6', kind: 'expense' },
    { id: 'other', name: 'Other', emoji: '📦', color: '#64748B', kind: 'expense' },
    { id: 'pay', name: 'Salary', emoji: '💼', color: '#22A06B', kind: 'income' },
    { id: 'gift', name: 'Gift', emoji: '🎁', color: '#EC4899', kind: 'income' },
    { id: 'sold', name: 'Sold something', emoji: '🏷️', color: '#F59E0B', kind: 'income' },
    { id: 'other_in', name: 'Other income', emoji: '💰', color: '#84CC16', kind: 'income' }
  ];
  const FALLBACK = { expense: 'other', income: 'other_in' };
  const EMOJIS = ['🍔', '🍕', '☕', '🥤', '🍦', '🛒', '🚌', '🚕', '⛽', '🚲', '🛍️', '👕', '👟', '💄', '🧾', '💡', '📱', '💻', '🎮', '🎬', '🎵', '⚽', '📚', '✏️', '💊', '💇', '🐶', '🎁', '✈️', '🏠', '💼', '💰'];
  const CURS = {
    RON: { label: 'Lei (RON)', loc: 'ro-RO', sym: 'lei', pre: false },
    EUR: { label: 'Euro (€)', loc: 'ro-RO', sym: '€', pre: false },
    USD: { label: 'US dollar ($)', loc: 'en-US', sym: '$', pre: true },
    GBP: { label: 'British pound (£)', loc: 'en-GB', sym: '£', pre: true }
  };

  // ---------- Storage ----------
  let storageOk = true;
  let migrated = false;

  function defaults() {
    return {
      v: 2,
      entries: {},
      cats: DEFAULT_CATS.map(c => Object.assign({}, c)),
      rules: [],
      settings: {
        name: '', currency: 'RON', weekStart: 1, theme: 'auto', budget: null, lastMethod: 'card', period: 'day', statsPeriod: 'month', hideInstall: false,
        applePay: { url: '', since: 0, seen: [], lastCheck: 0, lastError: '' }
      }
    };
  }

  function normalize(d) {
    const b = defaults();
    const out = {
      v: 2,
      entries: d && d.entries && typeof d.entries === 'object' && !Array.isArray(d.entries) ? d.entries : {},
      cats: d && Array.isArray(d.cats) && d.cats.length ? d.cats.filter(c => c && c.id && c.name && (c.kind === 'expense' || c.kind === 'income')) : b.cats,
      rules: d && Array.isArray(d.rules) ? d.rules.filter(r => r && r.id && typeof r.next === 'number' && typeof r.amount === 'number') : [],
      settings: Object.assign(b.settings, (d && d.settings) || {})
    };
    ['other', 'other_in'].forEach(id => {
      if (!out.cats.some(c => c.id === id)) out.cats.push(Object.assign({}, DEFAULT_CATS.find(c => c.id === id)));
    });
    const s = out.settings;
    if (!CURS[s.currency]) s.currency = 'RON';
    if (!['day', 'week', 'month'].includes(s.period)) s.period = 'day';
    if (!['week', 'month', 'year'].includes(s.statsPeriod)) s.statsPeriod = 'month';
    if (!['auto', 'light', 'dark'].includes(s.theme)) s.theme = 'auto';
    s.weekStart = Number(s.weekStart) === 0 ? 0 : 1;
    if (!(typeof s.budget === 'number' && s.budget > 0)) s.budget = null;
    const ap = s.applePay && typeof s.applePay === 'object' ? s.applePay : {};
    s.applePay = {
      url: typeof ap.url === 'string' ? ap.url : '',
      since: Number(ap.since) || 0,
      seen: Array.isArray(ap.seen) ? ap.seen.slice(-500) : [],
      lastCheck: Number(ap.lastCheck) || 0,
      lastError: typeof ap.lastError === 'string' ? ap.lastError : ''
    };
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY2);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.v === 2) return normalize(d);
      }
    } catch (e) { storageOk = false; }
    const base = defaults();
    // Bring over data from the first version of the app (kept untouched as a safety copy).
    try {
      const raw1 = localStorage.getItem(KEY1);
      if (raw1) {
        const o = JSON.parse(raw1) || {};
        const months = o.months || {};
        Object.keys(months).forEach(k => {
          const m = months[k] || {};
          Object.keys(m).forEach(id => {
            const e = m[id];
            if (!e || typeof e.amount !== 'number' || typeof e.at !== 'number') return;
            const eid = e.id || id;
            base.entries[eid] = {
              id: eid, type: 'expense', amount: e.amount, item: String(e.item || 'Expense'),
              method: e.method === 'cash' ? 'cash' : 'card',
              cat: base.cats.some(c => c.id === e.cat) ? e.cat : 'other',
              note: '', at: e.at, updated: e.updated || Date.now()
            };
          });
        });
        if (typeof o.budget === 'number' && o.budget > 0) base.settings.budget = o.budget;
        if (o.lastMethod === 'cash') base.settings.lastMethod = 'cash';
        if (['day', 'week', 'month'].includes(o.period)) base.settings.period = o.period;
        if (o.hideInstall) base.settings.hideInstall = true;
        migrated = Object.keys(base.entries).length > 0 || !!base.settings.budget;
      }
    } catch (e) { /* ignore a damaged old copy */ }
    return base;
  }

  // If the phone mixed an old page with this newer script, reload once to get matching files.
  const APP_VERSION = '4';
  const pageVersion = (document.querySelector('meta[name="app-version"]') || {}).content;
  if (pageVersion !== APP_VERSION) {
    let tried = false;
    try { tried = sessionStorage.getItem('pl-reload') === APP_VERSION; sessionStorage.setItem('pl-reload', APP_VERSION); } catch (e) { tried = true; }
    if (!tried) { location.reload(); return; }
  }

  let D = load();

  function persist() {
    try {
      localStorage.setItem(KEY2, JSON.stringify(D));
      storageOk = true;
      return true;
    } catch (e) {
      toast("Couldn't save on this phone. Free up some storage and try again.", { ms: 5000 });
      return false;
    }
  }

  let askedPersist = false;
  function askPersist() {
    if (askedPersist) return;
    askedPersist = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
  }

  // ---------- Money formatting ----------
  let NF, NF0;
  const cur = () => CURS[D.settings.currency] || CURS.RON;
  function setFormatter() {
    const c = cur();
    NF = new Intl.NumberFormat(c.loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    NF0 = new Intl.NumberFormat(c.loc, { maximumFractionDigits: 0 });
  }
  const num = b => NF.format((b || 0) / 100);
  function money(b) {
    if (b < 0) return '−' + money(-b);
    const c = cur();
    return c.pre ? c.sym + num(b) : num(b) + ' ' + c.sym;
  }
  const short = b => NF0.format(Math.round((b || 0) / 100));
  const decSep = () => (cur().loc === 'ro-RO' ? ',' : '.');
  const toInput = b => (b / 100).toFixed(2).replace('.', decSep());
  function bigHTML(b) {
    const c = cur();
    return c.pre
      ? '<span class="u">' + esc(c.sym) + '</span><span class="n">' + esc(num(b)) + '</span>'
      : '<span class="n">' + esc(num(b)) + '</span><span class="u">' + esc(c.sym) + '</span>';
  }
  function setUnits(preId, sufId, inputId) {
    const c = cur();
    $(preId).hidden = !c.pre;
    $(preId).textContent = c.pre ? c.sym : '';
    $(sufId).hidden = c.pre;
    $(sufId).textContent = c.pre ? '' : c.sym;
    $(inputId).placeholder = '0' + decSep() + '00';
  }
  function parseAmount(raw) {
    let s = String(raw || '').replace(/\s|lei|ron|eur|usd|gbp|€|\$|£/gi, '');
    if (!s) return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) {
      const dec = lc > ld ? ',' : '.';
      s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
    } else if (lc >= 0) {
      s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (ld >= 0 && s.split('.').length > 2) {
      s = s.replace(/\./g, '');
    }
    if (!/^\d*\.?\d*$/.test(s) || s === '.') return NaN;
    const v = Math.round(parseFloat(s) * 100);
    return v > 0 && v < 1e11 ? v : NaN;
  }

  // ---------- Dates ----------
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const toLocalInput = ms => { const d = new Date(ms); return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtShort = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const dayName = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  const timeOf = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const monthLong = ms => new Date(ms).toLocaleDateString('en-GB', { month: 'long' });
  const newId = p => (p || 'e') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function weekStartOf(d) {
    const dow = (d.getDay() - D.settings.weekStart + 7) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  }
  function rangeFor(period, offset) {
    const n = new Date();
    let s, e;
    if (period === 'day') {
      s = new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
      e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
    } else if (period === 'week') {
      const w = weekStartOf(n);
      s = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7 * offset);
      e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
    } else if (period === 'month') {
      s = new Date(n.getFullYear(), n.getMonth() + offset, 1);
      e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
    } else {
      s = new Date(n.getFullYear() + offset, 0, 1);
      e = new Date(s.getFullYear() + 1, 0, 1);
    }
    return [s, e];
  }
  function periodLabels(period, offset, s, e) {
    const last = new Date(e.getTime() - 1);
    if (period === 'day') return [offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : s.toLocaleDateString('en-GB', { weekday: 'long' }), dayName(s)];
    if (period === 'week') return [offset === 0 ? 'This week' : offset === -1 ? 'Last week' : 'Week of ' + fmtShort(s), fmtShort(s) + ' – ' + fmtShort(last)];
    if (period === 'month') return [s.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), offset === 0 ? 'This month' : offset === -1 ? 'Last month' : fmtShort(s) + ' – ' + fmtShort(last)];
    return [String(s.getFullYear()), offset === 0 ? 'This year' : offset === -1 ? 'Last year' : 'Jan – Dec'];
  }

  // ---------- Data helpers ----------
  const valid = e => e && typeof e.amount === 'number' && typeof e.at === 'number';
  const all = () => Object.values(D.entries).filter(valid);
  const isExp = e => e.type !== 'income';
  const inRange = (arr, s, e) => arr.filter(x => x.at >= s.getTime() && x.at < e.getTime());
  const sum = arr => arr.reduce((t, x) => t + x.amount, 0);
  const catsOf = kind => D.cats.filter(c => c.kind === kind);
  // New categories go just before "Other" / "Other income" so those stay last.
  function addCat(cat) {
    const i = D.cats.findIndex(c => c.id === FALLBACK[cat.kind]);
    if (i >= 0) D.cats.splice(i, 0, cat); else D.cats.push(cat);
  }
  function catById(id, type) {
    return D.cats.find(c => c.id === id) || D.cats.find(c => c.id === FALLBACK[type === 'income' ? 'income' : 'expense']) || DEFAULT_CATS[8];
  }
  function monthSpentAt(ms) {
    const d = new Date(ms);
    const s = new Date(d.getFullYear(), d.getMonth(), 1), e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return sum(inRange(all().filter(isExp), s, e));
  }
  function frequent(type, filter, max) {
    const since = Date.now() - 120 * DAY;
    const map = new Map();
    all().filter(x => (type === 'income' ? x.type === 'income' : isExp(x))).sort((a, b) => b.at - a.at).forEach(x => {
      const k = (x.item || '').trim().toLowerCase();
      if (!k) return;
      let g = map.get(k);
      if (!g) { g = { last: x, n: 0, recent: 0 }; map.set(k, g); }
      g.n++;
      if (x.at >= since) g.recent++;
    });
    let arr = Array.from(map.values());
    const f = (filter || '').trim().toLowerCase();
    if (f) arr = arr.filter(g => { const n = g.last.item.toLowerCase(); return n.includes(f) && n !== f; });
    arr.sort((a, b) => (b.recent - a.recent) || (b.n - a.n) || (b.last.at - a.last.at));
    return arr.slice(0, max).map(g => g.last);
  }

  // ---------- Repeating payments ----------
  function advance(ms, freq, day) {
    const d = new Date(ms);
    if (freq === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, d.getHours(), d.getMinutes()).getTime();
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const dim = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day || d.getDate(), dim), d.getHours(), d.getMinutes()).getTime();
  }
  function runRules() {
    let added = 0;
    const now = Date.now();
    D.rules.forEach(r => {
      if (r.active === false) return;
      let guard = 0;
      while (r.next <= now && guard < 400) {
        const id = newId('e');
        D.entries[id] = { id, type: r.type === 'income' ? 'income' : 'expense', amount: r.amount, item: r.item, method: r.method === 'cash' ? 'cash' : 'card', cat: r.cat, note: r.note || '', at: r.next, rid: r.id, updated: now };
        r.next = advance(r.next, r.freq, r.day);
        guard++;
        added++;
      }
    });
    return added;
  }

  // ---------- Theme ----------
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    const t = D.settings.theme, root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    const dark = t === 'dark' || (t !== 'light' && mq && mq.matches);
    $('themeColor').setAttribute('content', dark ? '#11132A' : '#F2F3F9');
  }
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', applyTheme);
    else if (mq.addListener) mq.addListener(applyTheme);
  }

  // ---------- Toast ----------
  let toastT, toastFn = null;
  function toast(msg, o) {
    o = o || {};
    $('toastMsg').textContent = msg;
    const a = $('toastAct');
    toastFn = o.onAction || null;
    a.hidden = !o.action;
    a.textContent = o.action || '';
    const t = $('toast');
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.classList.remove('show'); toastFn = null; }, o.ms || 2800);
  }
  $('toastAct').addEventListener('click', () => {
    const f = toastFn;
    toastFn = null;
    $('toast').classList.remove('show');
    if (f) f();
  });

  // ---------- Sheets ----------
  let openSheetEl = null;
  function showSheet(id) {
    if (openSheetEl) openSheetEl.hidden = true;
    openSheetEl = $(id);
    openSheetEl.hidden = false;
    const p = openSheetEl.querySelector('.panel');
    if (p) p.scrollTop = 0;
    document.body.classList.add('locked');
  }
  function hideSheet() {
    if (openSheetEl) { openSheetEl.hidden = true; openSheetEl = null; }
    document.body.classList.remove('locked');
  }
  // Closing the category sheet that was opened from the expense form goes back to that form.
  function closeByUser() {
    if (openSheetEl && openSheetEl.id === 'catSheet' && pendingEntry) {
      const p = pendingEntry;
      pendingEntry = null;
      hideSheet();
      restoreEntry(p, null);
      return;
    }
    hideSheet();
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeByUser(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openSheetEl) closeByUser(); });

  function armed(btn, label) {
    if (btn.classList.contains('armed')) return true;
    btn.classList.add('armed');
    btn.textContent = label;
    return false;
  }
  function disarm(btn, label) { btn.classList.remove('armed'); btn.textContent = label; }
  function setPressed(container, attr, value) {
    container.querySelectorAll('button[data-' + attr + ']').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }

  // ---------- Shared HTML pieces ----------
  function rowHTML(x) {
    const c = catById(x.cat, x.type), inc = x.type === 'income';
    const subs = ['<span>' + timeOf(x.at) + '</span>', '<span class="tag ' + (x.method === 'cash' ? 'cash' : 'card') + '">' + (x.method === 'cash' ? 'Cash' : 'Card') + '</span>'];
    if (x.src === 'applepay') subs.push('<span class="rep ap">Apple Pay</span>');
    if (x.rid) subs.push('<span class="rep">Repeats</span>');
    if (x.note) subs.push('<span class="nt">' + esc(x.note) + '</span>');
    return '<button type="button" class="row" data-id="' + esc(x.id) + '">' +
      '<span class="ico" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</span>' +
      '<span class="r-main"><span class="r-item">' + esc(x.item) + '</span><span class="r-sub">' + subs.join('') + '</span></span>' +
      '<span class="r-amt' + (inc ? ' in' : '') + '">' + (inc ? '+' : '') + esc(money(x.amount)) + '</span></button>';
  }

  function daysHTML(items, withMonths) {
    const groups = [];
    items.forEach(x => {
      const d = new Date(x.at), k = d.toDateString();
      let g = groups[groups.length - 1];
      if (!g || g.k !== k) { g = { k, d, items: [], out: 0, inn: 0 }; groups.push(g); }
      g.items.push(x);
      if (x.type === 'income') g.inn += x.amount; else g.out += x.amount;
    });
    const today = new Date().toDateString(), yest = new Date(Date.now() - DAY).toDateString();
    let html = '', lastM = null;
    groups.forEach(g => {
      if (withMonths) {
        const mk = g.d.getFullYear() * 12 + g.d.getMonth();
        if (mk !== lastM) { lastM = mk; html += '<div class="mh">' + esc(g.d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })) + '</div>'; }
      }
      const name = g.k === today ? 'Today' : g.k === yest ? 'Yesterday' : dayName(g.d);
      const tot = g.out ? money(g.out) : (g.inn ? '+' + money(g.inn) : '');
      html += '<div class="day"><div class="day-h"><strong>' + esc(name) + '</strong><span>' + esc(tot) + '</span></div><div class="rows">' + g.items.map(rowHTML).join('') + '</div></div>';
    });
    return html;
  }

  function catRows(ex, total) {
    const by = {};
    ex.forEach(x => {
      const c = catById(x.cat, x.type);
      const g = by[c.id] || (by[c.id] = { c, v: 0, n: 0 });
      g.v += x.amount;
      g.n++;
    });
    const rows = Object.values(by).sort((a, b) => b.v - a.v);
    const top = rows.length ? rows[0].v : 1;
    const html = rows.map(g =>
      '<div class="crow" style="--c:' + esc(g.c.color) + '"><span class="ico">' + esc(g.c.emoji) + '</span>' +
      '<span class="nm">' + esc(g.c.name) + '<small>' + g.n + (g.n === 1 ? ' purchase' : ' purchases') + ' · ' + Math.round(g.v / total * 100) + '%</small></span>' +
      '<span class="am">' + esc(money(g.v)) + '</span><span class="mt"><span style="width:' + (g.v / top * 100) + '%"></span></span></div>'
    ).join('');
    return { rows, html };
  }

  function emptyHTML(art, title, text) {
    return '<div class="empty"><span class="art" aria-hidden="true">' + art + '</span><strong>' + esc(title) + '</strong><span>' + text + '</span></div>';
  }

  // ---------- Home ----------
  const HOME = { offset: 0, sel: null };
  const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  function renderHome() {
    const now = new Date(), hr = now.getHours();
    const hi = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    $('greet').textContent = hi + (D.settings.name ? ', ' + D.settings.name : '') + '!';
    $('dateLine').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    const exAll = all().filter(isExp);
    const [ts, te] = rangeFor('day', 0);
    const todaySpent = sum(inRange(exAll, ts, te));
    let mood = todaySpent ? "You've spent " + money(todaySpent) + ' today.' : 'Nothing spent yet today.';
    if (D.settings.budget) {
      const left = D.settings.budget - monthSpentAt(now.getTime());
      mood += left >= 0 ? ' ' + money(left) + ' left for ' + monthLong(now) + '.' : ' ' + money(-left) + ' over budget this month.';
    }
    $('mood').textContent = mood;

    const P = D.settings.period;
    document.querySelectorAll('#homeSeg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === P)));
    const [s, e] = rangeFor(P, HOME.offset);
    const items = inRange(all(), s, e).sort((a, b) => b.at - a.at);
    const ex = items.filter(isExp), inc = items.filter(x => !isExp(x));
    const total = sum(ex), card = sum(ex.filter(x => x.method !== 'cash')), cash = total - card, inTotal = sum(inc);

    const [l1, l2] = periodLabels(P, HOME.offset, s, e);
    $('plabel').textContent = l1;
    $('psub').textContent = [l2, ex.length ? ex.length + (ex.length === 1 ? ' purchase' : ' purchases') : ''].filter(Boolean).join(' · ');
    $('next').disabled = HOME.offset >= 0;
    $('bigTotal').innerHTML = bigHTML(total);
    $('cardAmt').textContent = money(card);
    $('cashAmt').textContent = money(cash);
    $('sCard').style.width = total ? (card / total * 100) + '%' : '0';
    $('sCash').style.width = total ? (cash / total * 100) + '%' : '0';
    $('inRow').hidden = !inTotal;
    if (inTotal) {
      const bal = inTotal - total;
      $('inAmt').textContent = '+' + money(inTotal);
      $('balAmt').textContent = (bal > 0 ? '+' : '') + money(bal);
    }

    renderBudget(s);
    renderDayChart(P, s, e, ex);
    renderQuick();
    const cc = $('catsCard');
    cc.hidden = !ex.length;
    if (ex.length) $('cats').innerHTML = catRows(ex, total).html;

    $('listH').textContent = P === 'day' && HOME.offset === 0 ? "Today's list" : 'Everything logged';
    if (!items.length) {
      const when = P === 'day' ? (HOME.offset === 0 ? 'today' : 'on this day') : P === 'week' ? 'this week' : 'this month';
      $('list').innerHTML = emptyHTML('👛', all().length ? 'Nothing logged ' + when : 'Your purchases will show up here',
        'Tap the yellow <b>+</b> button and add what you bought, how much it was, and whether you paid by card or cash.');
    } else {
      $('list').innerHTML = daysHTML(items, false);
    }
    $('install').hidden = standalone || D.settings.hideInstall;
  }

  function renderBudget(s) {
    const B = D.settings.budget, box = $('budget');
    if (!B) {
      box.dataset.state = 'none';
      $('bLabel').textContent = 'Monthly budget';
      $('bPill').hidden = true;
      $('bMeterWrap').hidden = true;
      $('bText').textContent = 'Set a limit for the month and see how much you can still spend each day.';
      $('bEdit').textContent = 'Set a budget';
      return;
    }
    const spent = monthSpentAt(s.getTime()), pct = spent / B;
    const st = pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
    box.dataset.state = st;
    $('bLabel').textContent = monthLong(s) + ' budget';
    $('bPill').hidden = false;
    $('bPill').textContent = st === 'over' ? 'Over budget' : st === 'warn' ? 'Nearly used up' : 'On track';
    $('bMeterWrap').hidden = false;
    $('bMeter').style.width = Math.min(pct, 1) * 100 + '%';
    let html;
    if (pct >= 1) {
      html = '<strong>' + esc(money(spent - B)) + ' over</strong> your ' + esc(money(B)) + ' budget.';
    } else {
      html = esc(money(spent)) + ' of ' + esc(money(B)) + ' spent · <strong>' + esc(money(B - spent)) + ' left</strong>';
      const now = new Date();
      if (s.getFullYear() === now.getFullYear() && s.getMonth() === now.getMonth()) {
        const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysLeft = dim - now.getDate() + 1;
        html += '<span class="daily">That’s about ' + esc(money(Math.floor((B - spent) / daysLeft))) + ' a day for the ' +
          (daysLeft === 1 ? 'rest of today' : daysLeft + ' days left') + '.</span>';
      }
    }
    $('bText').innerHTML = html;
    $('bEdit').textContent = 'Change budget';
  }

  function budgetWarning(at, before, after) {
    const B = D.settings.budget;
    if (!B) return null;
    const m = monthLong(at);
    if (before < B && after >= B) return "You've gone over your " + m + ' budget by ' + money(after - B) + '.';
    if (before < 0.8 * B && after >= 0.8 * B) return 'Heads up: ' + Math.floor(after / B * 100) + '% of your ' + m + ' budget is used. ' + money(B - after) + ' left.';
    return null;
  }

  function renderDayChart(P, s, e, ex) {
    const card = $('chartCard');
    if (P === 'day') { card.hidden = true; return; }
    card.hidden = false;
    const days = [];
    for (let d = new Date(s); d < e; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
    const by = {};
    ex.forEach(x => {
      const k = new Date(x.at).toDateString();
      const b = by[k] || (by[k] = { card: 0, cash: 0 });
      if (x.method === 'cash') b.cash += x.amount; else b.card += x.amount;
    });
    let max = 0;
    days.forEach(d => { const b = by[d.toDateString()]; if (b) max = Math.max(max, b.card + b.cash); });
    const isW = P === 'week', gap = isW ? '8px' : '3px', todayK = new Date().toDateString();
    const sel = HOME.sel != null && HOME.sel < days.length ? HOME.sel : null;
    const bars = days.map((d, i) => {
      const b = by[d.toDateString()] || { card: 0, cash: 0 };
      return '<button type="button" class="bar' + (i === sel ? ' sel' : '') + '" data-i="' + i + '" aria-label="' + esc(dayName(d) + ': ' + money(b.card + b.cash)) + '">' +
        '<span class="bk" style="height:' + (max ? b.cash / max * 100 : 0) + '%"></span><span class="bc" style="height:' + (max ? b.card / max * 100 : 0) + '%"></span></button>';
    }).join('');
    const ticks = days.map(d => {
      const lab = isW ? d.toLocaleDateString('en-GB', { weekday: 'narrow' }) : ([1, 8, 15, 22, 29].includes(d.getDate()) ? d.getDate() : '');
      return '<span' + (d.toDateString() === todayK ? ' class="today"' : '') + '>' + lab + '</span>';
    }).join('');
    $('chart').innerHTML = '<div class="bars" style="--n:' + days.length + ';--gap:' + gap + '">' + bars + '</div>' +
      '<div class="ticks" style="--n:' + days.length + ';--gap:' + gap + '">' + ticks + '</div>';
    let cap;
    if (sel != null) {
      const d = days[sel], b = by[d.toDateString()] || { card: 0, cash: 0 };
      cap = esc(dayName(d)) + ': <b>' + esc(money(b.card + b.cash)) + '</b>';
    } else {
      cap = max ? 'Highest day <b>' + esc(money(max)) + '</b>' : 'Nothing spent yet';
    }
    $('chartCap').innerHTML = cap;
  }

  function renderQuick() {
    const q = frequent('expense', '', 8);
    $('quickWrap').hidden = !q.length;
    $('quick').innerHTML = q.map(x => {
      const c = catById(x.cat, x.type);
      return '<button type="button" class="qchip" data-id="' + esc(x.id) + '"><span class="ico sm" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</span>' +
        '<span><span class="qn">' + esc(x.item) + '</span><small>' + esc(money(x.amount)) + ' · ' + (x.method === 'cash' ? 'Cash' : 'Card') + '</small></span></button>';
    }).join('');
  }

  // ---------- History ----------
  const HS = { q: '', t: 'all', cat: 'all', limit: 150 };
  function historyItems() {
    let arr = all();
    if (HS.t === 'income') arr = arr.filter(x => x.type === 'income');
    else if (HS.t === 'card' || HS.t === 'cash') arr = arr.filter(x => isExp(x) && (HS.t === 'cash' ? x.method === 'cash' : x.method !== 'cash'));
    if (HS.cat !== 'all') arr = arr.filter(x => catById(x.cat, x.type).id === HS.cat);
    const toks = HS.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (toks.length) {
      arr = arr.filter(x => {
        const c = catById(x.cat, x.type), d = new Date(x.at);
        const hay = [x.item, x.note, c.name, num(x.amount), (x.amount / 100).toFixed(2), dayName(d), d.toLocaleDateString('en-GB', { month: 'long' }), x.method].join(' ').toLowerCase();
        return toks.every(t => hay.includes(t));
      });
    }
    return arr.sort((a, b) => b.at - a.at);
  }
  function renderHistory() {
    setPressed($('hType'), 't', HS.t);
    if (HS.cat !== 'all' && !D.cats.some(c => c.id === HS.cat)) HS.cat = 'all';
    const opt = c => '<option value="' + esc(c.id) + '">' + esc(c.emoji + '  ' + c.name) + '</option>';
    $('hCat').innerHTML = '<option value="all">All categories</option><optgroup label="Expenses">' + catsOf('expense').map(opt).join('') +
      '</optgroup><optgroup label="Money in">' + catsOf('income').map(opt).join('') + '</optgroup>';
    $('hCat').value = HS.cat;
    const arr = historyItems();
    const out = sum(arr.filter(isExp)), inn = sum(arr.filter(x => !isExp(x)));
    $('hSum').textContent = arr.length ? arr.length + (arr.length === 1 ? ' entry' : ' entries') + (out ? ' · spent ' + money(out) : '') + (inn ? ' · in +' + money(inn) : '') : '';
    $('hExport').hidden = !arr.length;
    if (!arr.length) {
      const any = all().length > 0;
      $('hList').innerHTML = emptyHTML('🔍', any ? 'No matches' : 'Nothing here yet', any ? 'Try a different word or filter.' : 'Everything you add will be listed here.');
      $('hMore').hidden = true;
      return;
    }
    $('hList').innerHTML = daysHTML(arr.slice(0, HS.limit), true);
    $('hMore').hidden = arr.length <= HS.limit;
    $('hMore').textContent = 'Show more (' + (arr.length - HS.limit) + ' left)';
  }

  // ---------- Stats ----------
  const SS = { offset: 0 };
  function donutSVG(rows, total) {
    const r = 46, C = 2 * Math.PI * r;
    const gap = rows.length > 1 ? 1.4 : 0;
    let acc = 0;
    const segs = rows.map(g => {
      const len = g.v / total * C;
      const seg = '<circle r="' + r + '" cx="60" cy="60" fill="none" style="stroke:' + esc(g.c.color) + '" stroke-width="16" stroke-dasharray="' +
        Math.max(len - gap, 0.001).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"/>';
      acc += len;
      return seg;
    }).join('');
    return '<svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(-90 60 60)"><circle r="' + r + '" cx="60" cy="60" fill="none" style="stroke:var(--track)" stroke-width="16"/>' + segs + '</g></svg>';
  }

  function renderStats() {
    const P = D.settings.statsPeriod;
    document.querySelectorAll('#statsSeg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === P)));
    const [s, e] = rangeFor(P, SS.offset);
    const [l1, l2] = periodLabels(P, SS.offset, s, e);
    $('sLabel').textContent = l1;
    $('sSub').textContent = l2;
    $('sNext').disabled = SS.offset >= 0;
    const inPeriod = inRange(all(), s, e);
    const ex = inPeriod.filter(isExp), inc = inPeriod.filter(x => !isExp(x));
    const total = sum(ex), inTotal = sum(inc);
    let html = '';
    if (!ex.length) {
      html = emptyHTML('📊', 'No spending in this period', 'Your stats appear here once you add some expenses.');
    } else {
      const cr = catRows(ex, total);
      const bal = inTotal - total;
      html += '<div class="card"><div class="donut" role="img" aria-label="' + esc('Spending by category, total ' + money(total)) + '">' + donutSVG(cr.rows, total) +
        '<div class="ctr"><b>' + esc(money(total)) + '</b><span>spent</span></div></div><div class="crows">' + cr.html + '</div>' +
        (inTotal ? '<div class="inline-in"><span>Money in <b>+' + esc(money(inTotal)) + '</b></span><span>Balance <b>' + esc((bal > 0 ? '+' : '') + money(bal)) + '</b></span></div>' : '') + '</div>';

      const nowMs = Date.now();
      const days = Math.max(1, Math.ceil((Math.min(nowMs, e.getTime()) - s.getTime()) / DAY));
      const [ps, pe] = rangeFor(P, SS.offset - 1);
      let cmpEnd = pe.getTime();
      let cmpLabel = P === 'week' ? 'the week before' : P === 'month' ? 'the month before' : 'the year before';
      if (SS.offset === 0) {
        cmpEnd = Math.min(pe.getTime(), ps.getTime() + (nowMs - s.getTime()));
        cmpLabel = 'same time last ' + P;
      }
      const prev = sum(all().filter(isExp).filter(x => x.at >= ps.getTime() && x.at < cmpEnd));
      let cmpB, cmpCls = '', cmpSub;
      if (!prev) {
        cmpB = '—';
        cmpSub = SS.offset === 0 ? 'Nothing spent by this time last ' + P : 'Nothing spent in ' + cmpLabel;
      } else {
        const pct = Math.round((total - prev) / prev * 100);
        cmpB = pct === 0 ? 'Same' : (pct > 0 ? '+' : '−') + Math.abs(pct) + '%';
        cmpCls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
        cmpSub = 'vs ' + cmpLabel + ' (' + money(prev) + ')';
      }
      const big = ex.reduce((m, x) => (x.amount > m.amount ? x : m), ex[0]);
      const counts = new Map();
      ex.forEach(x => {
        const k = x.item.trim().toLowerCase();
        const g = counts.get(k) || { name: x.item, n: 0, v: 0 };
        g.n++; g.v += x.amount;
        counts.set(k, g);
      });
      const most = Array.from(counts.values()).sort((a, b) => (b.n - a.n) || (b.v - a.v))[0];
      const cardPct = Math.round(sum(ex.filter(x => x.method !== 'cash')) / total * 100);
      const tile = (lab, b, sub, cls) => '<div class="tile"><span>' + esc(lab) + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(b) + '</b><small>' + esc(sub) + '</small></div>';
      html += '<div class="tiles">' +
        tile('Daily average', money(Math.round(total / days)), 'over ' + days + (days === 1 ? ' day' : ' days')) +
        tile('Compared', cmpB, cmpSub, cmpCls) +
        tile('Biggest', money(big.amount), big.item + ' · ' + fmtShort(new Date(big.at))) +
        tile('Most bought', most.name, most.n + (most.n === 1 ? ' time' : ' times') + ' · ' + money(most.v)) +
        tile('Purchases', String(ex.length), 'about ' + money(Math.round(total / ex.length)) + ' each') +
        tile('Paid by card', cardPct + '%', 'Cash ' + (100 - cardPct) + '%') +
        '</div>';
    }
    $('statsBody').innerHTML = html;
    renderMonths();
  }

  function renderMonths() {
    const n = new Date(), ex = all().filter(isExp), ms = [];
    for (let i = 5; i >= 0; i--) {
      const s = new Date(n.getFullYear(), n.getMonth() - i, 1), e = new Date(n.getFullYear(), n.getMonth() - i + 1, 1);
      ms.push({ s, v: sum(inRange(ex, s, e)), cur: i === 0 });
    }
    const B = D.settings.budget || 0;
    const max = Math.max(B, ...ms.map(m => m.v)) || 1;
    const H = 108;
    const cols = ms.map(m => '<div class="mcol' + (m.cur ? ' cur' : '') + '"><small>' + (m.v ? esc(short(m.v)) : '') + '</small><i style="height:' +
      Math.max(m.v ? 4 : 2, Math.round(m.v / max * H)) + 'px"></i></div>').join('');
    const line = B ? '<div class="blimit" style="bottom:' + Math.round(B / max * H) + 'px"><span>Budget</span></div>' : '';
    const labels = ms.map(m => '<span' + (m.cur ? ' class="today"' : '') + '>' + esc(m.s.toLocaleDateString('en-GB', { month: 'short' })) + '</span>').join('');
    $('months').innerHTML = '<div class="mbars">' + cols + line + '</div><div class="mlabels">' + labels + '</div>';
    const withData = ms.filter(m => m.v);
    $('mCap').innerHTML = withData.length ? 'Average <b>' + esc(money(Math.round(withData.reduce((t, m) => t + m.v, 0) / withData.length))) + '</b>' : '';
  }

  // ---------- Settings ----------
  function renderSettings() {
    const nameEl = $('setName');
    if (document.activeElement !== nameEl) nameEl.value = D.settings.name || '';
    $('setCur').innerHTML = Object.keys(CURS).map(k => '<option value="' + k + '">' + esc(CURS[k].label) + '</option>').join('');
    $('setCur').value = D.settings.currency;
    $('setBudgetSub').textContent = D.settings.budget ? money(D.settings.budget) + ' a month' : 'Not set';
    $('setWeek').value = String(D.settings.weekStart);
    setPressed($('setTheme'), 'v', D.settings.theme);

    const counts = {};
    all().forEach(x => { const id = catById(x.cat, x.type).id; counts[id] = (counts[id] || 0) + 1; });
    const catLi = c => {
      const n = counts[c.id] || 0;
      return '<button type="button" class="li" data-cat="' + esc(c.id) + '"><span class="ico" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</span>' +
        '<span class="grow">' + esc(c.name) + '<small>' + n + (n === 1 ? ' entry' : ' entries') + '</small></span><span class="chev">›</span></button>';
    };
    $('setCats').innerHTML = '<div class="li-h">For expenses</div>' + catsOf('expense').map(catLi).join('') +
      '<div class="li-h">For money in</div>' + catsOf('income').map(catLi).join('') +
      '<button type="button" class="li" data-add="cat"><span class="ico plus">+</span><span class="grow">Add a category</span></button>';

    const ruleLi = r => {
      const c = catById(r.cat, r.type), inc = r.type === 'income';
      const when = r.active === false ? 'Paused' : (r.freq === 'week' ? 'Every week' : 'Every month') + ' · next ' + fmtShort(new Date(r.next));
      return '<button type="button" class="li" data-rule="' + esc(r.id) + '"><span class="ico" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</span>' +
        '<span class="grow">' + esc(r.item) + '<small>' + esc(when) + '</small></span><span class="val' + (inc ? ' in' : '') + '">' + (inc ? '+' : '') + esc(money(r.amount)) + '</span></button>';
    };
    $('setRules').innerHTML = D.rules.map(ruleLi).join('') +
      '<button type="button" class="li" data-add="rule"><span class="ico plus">+</span><span class="grow">Add a repeating payment</span></button>';
    const n = all().length;
    $('countLine').textContent = n + (n === 1 ? ' entry' : ' entries') + ' saved on this phone';
    renderApSettings();
  }

  // ---------- Tabs ----------
  let TAB = 'home';
  function showTab(t) {
    TAB = t;
    ['home', 'history', 'stats', 'settings'].forEach(n => { $('scr-' + n).hidden = n !== t; });
    document.querySelectorAll('.tab[data-tab]').forEach(b => {
      if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('scroller').scrollTop = 0;
    render();
  }
  function render() {
    if (TAB === 'home') renderHome();
    else if (TAB === 'history') renderHistory();
    else if (TAB === 'stats') renderStats();
    else renderSettings();
  }

  // ---------- Entry sheet ----------
  const ES = { id: null, type: 'expense', method: 'card', cat: null, rid: null };

  function openEntry(entry, pre) {
    const src = entry || pre || {};
    ES.id = entry ? entry.id : null;
    ES.rid = entry ? entry.rid || null : null;
    ES.type = src.type === 'income' ? 'income' : 'expense';
    ES.method = src.method === 'cash' || src.method === 'card' ? src.method : D.settings.lastMethod;
    ES.cat = src.cat || null;
    setUnits('eUnitPre', 'eUnit', 'eAmt');
    $('eAmt').value = typeof src.amount === 'number' ? toInput(src.amount) : '';
    $('eItem').value = src.item || '';
    $('eNote').value = entry ? entry.note || '' : '';
    let at = entry ? entry.at : Date.now();
    if (!entry && TAB === 'home' && D.settings.period === 'day' && HOME.offset !== 0) {
      const [s] = rangeFor('day', HOME.offset), n = new Date();
      at = new Date(s.getFullYear(), s.getMonth(), s.getDate(), n.getHours(), n.getMinutes()).getTime();
    }
    $('eWhen').value = toLocalInput(at);
    $('eRepeat').value = 'none';
    $('eRepeatWrap').hidden = !!entry;
    const rule = ES.rid ? D.rules.find(r => r.id === ES.rid) : null;
    $('eRidNote').hidden = !ES.rid;
    $('eRidNote').textContent = ES.rid ? 'Added by the repeating payment' + (rule ? ' “' + rule.item + '”' : '') + '. Changes here only affect this one.' : '';
    const del = $('eDel');
    del.hidden = !entry;
    disarm(del, 'Delete');
    $('eAmtErr').hidden = true;
    $('eItemErr').hidden = true;
    syncEntryType();
    showSheet('entrySheet');
    if (!entry && typeof src.amount !== 'number') $('eAmt').focus();
  }

  function syncEntryType() {
    const inc = ES.type === 'income';
    setPressed($('eType'), 't', ES.type);
    $('eTitle').textContent = ES.id ? (inc ? 'Edit money in' : 'Edit expense') : (inc ? 'Money in' : 'New expense');
    $('eItemLab').textContent = inc ? 'Where is it from?' : 'What did you buy?';
    $('eItem').placeholder = inc ? 'e.g. Salary, birthday money' : 'e.g. Coffee and a croissant';
    $('ePayLab').textContent = inc ? 'Received as' : 'Paid with';
    if (ES.cat && !catsOf(ES.type).some(c => c.id === ES.cat)) ES.cat = null;
    syncEntryPay();
    renderEntryCats();
    renderSugs();
  }
  function syncEntryPay() {
    $('eCard').setAttribute('aria-pressed', String(ES.method === 'card'));
    $('eCash').setAttribute('aria-pressed', String(ES.method === 'cash'));
  }
  function renderEntryCats() {
    $('eCats').innerHTML = catsOf(ES.type).map(c =>
      '<button type="button" class="ctile" data-c="' + esc(c.id) + '" style="--c:' + esc(c.color) + '" aria-pressed="' + (c.id === ES.cat) + '"><span class="e">' + esc(c.emoji) + '</span><span class="t">' + esc(c.name) + '</span></button>'
    ).join('') + '<button type="button" class="ctile add" data-c="__new" style="--c:var(--muted)"><span class="e">＋</span><span class="t">New</span></button>';
  }
  function renderSugs() {
    const box = $('eSugs');
    if (ES.id) { box.hidden = true; box.innerHTML = ''; return; }
    const list = frequent(ES.type, $('eItem').value, 6);
    box.hidden = !list.length;
    box.innerHTML = list.map(x => {
      const c = catById(x.cat, x.type);
      return '<button type="button" class="sug" data-id="' + esc(x.id) + '"><span aria-hidden="true">' + esc(c.emoji) + '</span><span class="sn">' + esc(x.item) + '</span><small>' + esc(money(x.amount)) + '</small></button>';
    }).join('');
  }

  $('eType').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    ES.type = b.dataset.t;
    syncEntryType();
  });
  $('eCard').addEventListener('click', () => { ES.method = 'card'; syncEntryPay(); });
  $('eCash').addEventListener('click', () => { ES.method = 'cash'; syncEntryPay(); });
  $('eCats').addEventListener('click', e => {
    const b = e.target.closest('.ctile');
    if (!b) return;
    if (b.dataset.c === '__new') { pendingEntry = snapshotEntry(); openCat(null, ES.type); return; }
    ES.cat = ES.cat === b.dataset.c ? null : b.dataset.c;
    renderEntryCats();
  });
  $('eItem').addEventListener('input', renderSugs);
  $('eSugs').addEventListener('click', e => {
    const b = e.target.closest('.sug');
    if (!b) return;
    const x = D.entries[b.dataset.id];
    if (!x) return;
    $('eItem').value = x.item;
    if (isNaN(parseAmount($('eAmt').value))) $('eAmt').value = toInput(x.amount);
    ES.method = x.method === 'cash' ? 'cash' : 'card';
    ES.cat = x.cat;
    syncEntryPay();
    renderEntryCats();
    renderSugs();
  });

  // Coming back to the entry sheet after creating a category from it.
  let pendingEntry = null;
  function snapshotEntry() {
    return { id: ES.id, rid: ES.rid, type: ES.type, method: ES.method, cat: ES.cat, amt: $('eAmt').value, item: $('eItem').value, when: $('eWhen').value, note: $('eNote').value, repeat: $('eRepeat').value };
  }
  function restoreEntry(p, newCat) {
    const entry = p.id ? D.entries[p.id] : null;
    openEntry(entry, entry ? null : { type: p.type });
    ES.type = p.type; ES.method = p.method; ES.cat = newCat || p.cat; ES.rid = p.rid;
    $('eAmt').value = p.amt; $('eItem').value = p.item; $('eWhen').value = p.when; $('eNote').value = p.note; $('eRepeat').value = p.repeat;
    syncEntryType();
  }

  $('entryForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseAmount($('eAmt').value);
    const item = $('eItem').value.trim();
    $('eAmtErr').hidden = !isNaN(amount);
    $('eItemErr').hidden = !!item;
    if (isNaN(amount)) { $('eAmt').focus(); return; }
    if (!item) { $('eItem').focus(); return; }
    let at = $('eWhen').value ? new Date($('eWhen').value).getTime() : Date.now();
    if (isNaN(at)) at = Date.now();
    const editing = !!ES.id;
    const entry = {
      id: ES.id || newId('e'), type: ES.type, amount, item, method: ES.method,
      cat: ES.cat || FALLBACK[ES.type], note: $('eNote').value.trim(), at, updated: Date.now()
    };
    if (ES.rid) entry.rid = ES.rid;
    const before = monthSpentAt(at);
    D.entries[entry.id] = entry;
    const rep = $('eRepeat').value;
    let extra = 0, ruleMade = false;
    if (!editing && rep !== 'none') {
      const day = new Date(at).getDate();
      const r = { id: newId('r'), type: entry.type, amount, item, method: entry.method, cat: entry.cat, note: entry.note, freq: rep, day, next: advance(at, rep, day), active: true };
      D.rules.push(r);
      entry.rid = r.id;
      ruleMade = true;
      extra = runRules();
    }
    const after = monthSpentAt(at);
    D.settings.lastMethod = ES.method;
    hideSheet();
    if (!persist()) return;
    askPersist();
    render();
    const warn = entry.type === 'expense' ? budgetWarning(at, before, after) : null;
    if (warn) { toast(warn, { ms: 5000 }); return; }
    let msg = (editing ? 'Updated ' : 'Saved ') + (entry.type === 'income' ? '+' : '') + money(amount);
    if (ruleMade) msg += ' · repeats every ' + rep;
    if (extra) msg += ' · ' + extra + ' earlier ' + (extra === 1 ? 'one' : 'ones') + ' added';
    toast(msg);
  });

  $('eDel').addEventListener('click', () => {
    if (!armed($('eDel'), 'Tap again to delete')) return;
    const gone = D.entries[ES.id];
    if (!gone) { hideSheet(); return; }
    delete D.entries[ES.id];
    hideSheet();
    persist();
    render();
    toast('Deleted “' + gone.item + '”', {
      action: 'Undo', ms: 5000,
      onAction: () => { D.entries[gone.id] = gone; persist(); render(); toast('Brought it back'); }
    });
  });

  // ---------- Category sheet ----------
  const CS = { id: null, kind: 'expense', emoji: '🏷️', color: PALETTE[0] };
  function openCat(cat, kind) {
    CS.id = cat ? cat.id : null;
    CS.kind = cat ? cat.kind : (kind || 'expense');
    CS.emoji = cat ? cat.emoji : '🏷️';
    CS.color = cat ? cat.color : PALETTE[D.cats.length % PALETTE.length];
    $('cTitle').textContent = cat ? 'Edit category' : 'New category';
    $('cName').value = cat ? cat.name : '';
    $('cEmoji').value = '';
    $('cKind').hidden = !!cat;
    const del = $('cDel');
    del.hidden = !cat || cat.id === 'other' || cat.id === 'other_in';
    disarm(del, 'Delete');
    $('cErr').hidden = true;
    syncCat();
    showSheet('catSheet');
  }
  function syncCat() {
    $('cPrev').textContent = CS.emoji;
    $('cPrev').style.setProperty('--c', CS.color);
    setPressed($('cKind'), 'k', CS.kind);
    $('cEmojis').innerHTML = EMOJIS.map(em => '<button type="button" data-e="' + em + '" aria-pressed="' + (em === CS.emoji) + '" aria-label="' + em + '">' + em + '</button>').join('');
    $('cColors').innerHTML = PALETTE.map(c => '<button type="button" data-c="' + c + '" style="--sw:' + c + '" aria-pressed="' + (c === CS.color) + '" aria-label="Colour ' + c + '"></button>').join('');
  }
  $('cKind').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) { CS.kind = b.dataset.k; syncCat(); } });
  $('cEmojis').addEventListener('click', e => { const b = e.target.closest('button[data-e]'); if (b) { CS.emoji = b.dataset.e; $('cEmoji').value = ''; syncCat(); } });
  $('cEmoji').addEventListener('input', e => {
    const v = e.target.value.trim();
    if (v) { CS.emoji = Array.from(v).slice(0, 2).join(''); $('cPrev').textContent = CS.emoji; setPressed($('cEmojis'), 'e', CS.emoji); }
  });
  $('cColors').addEventListener('click', e => { const b = e.target.closest('button[data-c]'); if (b) { CS.color = b.dataset.c; syncCat(); } });
  $('catForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('cName').value.trim();
    $('cErr').hidden = !!name;
    if (!name) { $('cName').focus(); return; }
    let id = CS.id;
    if (id) {
      const c = D.cats.find(x => x.id === id);
      if (c) Object.assign(c, { name, emoji: CS.emoji, color: CS.color });
    } else {
      id = newId('c');
      addCat({ id, name, emoji: CS.emoji, color: CS.color, kind: CS.kind });
    }
    persist();
    hideSheet();
    if (pendingEntry) {
      const p = pendingEntry;
      pendingEntry = null;
      restoreEntry(p, !CS.id && CS.kind === p.type ? id : null);
      return;
    }
    render();
    toast('Category saved');
  });
  $('cDel').addEventListener('click', () => {
    if (!armed($('cDel'), 'Tap again to delete')) return;
    const c = D.cats.find(x => x.id === CS.id);
    if (!c) { hideSheet(); return; }
    const fb = FALLBACK[c.kind];
    Object.values(D.entries).forEach(x => { if (x.cat === c.id) x.cat = fb; });
    D.rules.forEach(r => { if (r.cat === c.id) r.cat = fb; });
    D.cats = D.cats.filter(x => x.id !== c.id);
    persist();
    hideSheet();
    pendingEntry = null;
    render();
    toast('Deleted “' + c.name + '”. Its entries moved to ' + catById(fb, c.kind).name + '.', { ms: 4000 });
  });

  // ---------- Repeating payment sheet ----------
  const RS = { id: null, type: 'expense', method: 'card' };
  function openRule(rule) {
    RS.id = rule ? rule.id : null;
    RS.type = rule ? (rule.type === 'income' ? 'income' : 'expense') : 'expense';
    RS.method = rule ? (rule.method === 'cash' ? 'cash' : 'card') : D.settings.lastMethod;
    $('rTitle').textContent = rule ? 'Edit repeating payment' : 'New repeating payment';
    setUnits('rUnitPre', 'rUnit', 'rAmt');
    $('rAmt').value = rule ? toInput(rule.amount) : '';
    $('rItem').value = rule ? rule.item : '';
    $('rFreq').value = rule ? rule.freq : 'month';
    $('rNext').value = ymd(rule ? new Date(rule.next) : new Date());
    $('rActiveWrap').hidden = !rule;
    $('rActive').checked = rule ? rule.active !== false : true;
    const del = $('rDel');
    del.hidden = !rule;
    disarm(del, 'Delete');
    ['rAmtErr', 'rItemErr', 'rNextErr'].forEach(id => { $(id).hidden = true; });
    syncRule(rule ? rule.cat : null);
    showSheet('ruleSheet');
  }
  function syncRule(catId) {
    setPressed($('rType'), 't', RS.type);
    $('rCard').setAttribute('aria-pressed', String(RS.method === 'card'));
    $('rCash').setAttribute('aria-pressed', String(RS.method === 'cash'));
    $('rPayLab').textContent = RS.type === 'income' ? 'Received as' : 'Paid with';
    const sel = $('rCat'), keep = catId || sel.value, cats = catsOf(RS.type);
    sel.innerHTML = cats.map(c => '<option value="' + esc(c.id) + '">' + esc(c.emoji + '  ' + c.name) + '</option>').join('');
    if (cats.some(c => c.id === keep)) sel.value = keep;
    else if (RS.type === 'expense' && cats.some(c => c.id === 'subs')) sel.value = 'subs';
  }
  $('rType').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b) { RS.type = b.dataset.t; syncRule(null); } });
  $('rCard').addEventListener('click', () => { RS.method = 'card'; syncRule($('rCat').value); });
  $('rCash').addEventListener('click', () => { RS.method = 'cash'; syncRule($('rCat').value); });
  $('ruleForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseAmount($('rAmt').value), item = $('rItem').value.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec($('rNext').value);
    $('rAmtErr').hidden = !isNaN(amount);
    $('rItemErr').hidden = !!item;
    $('rNextErr').hidden = !!m;
    if (isNaN(amount)) { $('rAmt').focus(); return; }
    if (!item) { $('rItem').focus(); return; }
    if (!m) return;
    const old = RS.id ? D.rules.find(r => r.id === RS.id) : null;
    const t = old ? new Date(old.next) : null;
    const next = new Date(+m[1], +m[2] - 1, +m[3], t ? t.getHours() : 9, t ? t.getMinutes() : 0).getTime();
    const r = old || { id: newId('r'), note: '' };
    Object.assign(r, {
      type: RS.type, amount, item, method: RS.method, cat: $('rCat').value || FALLBACK[RS.type],
      freq: $('rFreq').value === 'week' ? 'week' : 'month', day: +m[3], next, active: old ? $('rActive').checked : true
    });
    if (!old) D.rules.push(r);
    const n = runRules();
    persist();
    hideSheet();
    render();
    toast((old ? 'Updated' : 'Saved') + ' “' + item + '”' + (n ? ' · ' + n + (n === 1 ? ' payment' : ' payments') + ' added' : ''));
  });
  $('rDel').addEventListener('click', () => {
    if (!armed($('rDel'), 'Tap again to delete')) return;
    const r = D.rules.find(x => x.id === RS.id);
    D.rules = D.rules.filter(x => x.id !== RS.id);
    persist();
    hideSheet();
    render();
    toast('Stopped “' + (r ? r.item : 'payment') + '”. Past payments are kept.', { ms: 4000 });
  });

  // ---------- Budget sheet ----------
  function openBudget() {
    setUnits('bUnitPre', 'bUnit', 'bAmt');
    $('bAmt').value = D.settings.budget ? toInput(D.settings.budget) : '';
    const r = $('bRemove');
    r.hidden = !D.settings.budget;
    disarm(r, 'Remove');
    $('bErr').hidden = true;
    showSheet('budgetSheet');
    $('bAmt').focus();
  }
  $('bForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = parseAmount($('bAmt').value);
    $('bErr').hidden = !isNaN(v);
    if (isNaN(v)) { $('bAmt').focus(); return; }
    D.settings.budget = v;
    persist();
    hideSheet();
    render();
    toast('Monthly budget set to ' + money(v));
  });
  $('bRemove').addEventListener('click', () => {
    if (!armed($('bRemove'), 'Tap again to remove')) return;
    D.settings.budget = null;
    persist();
    hideSheet();
    render();
    toast('Budget removed');
  });

  // ---------- Confirm sheet ----------
  let confirmFn = null;
  function openConfirm(title, text, ok, fn) {
    $('kTitle').textContent = title;
    $('kText').textContent = text;
    $('kOk').textContent = ok;
    confirmFn = fn;
    showSheet('confirmSheet');
  }
  $('kOk').addEventListener('click', () => { const f = confirmFn; confirmFn = null; hideSheet(); if (f) f(); });

  // ---------- Files: export, backup, import ----------
  async function saveFile(name, text, mime) {
    try {
      const file = new File([text], name, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
    }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    } catch (e) {
      toast("Couldn't save the file. Try again.");
      return false;
    }
  }

  const HEAD = ['Date', 'Time', 'Type', 'What', 'Category', 'Paid with', 'Amount', 'Currency', 'Note'];
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv(items) {
    const rows = [HEAD];
    items.slice().sort((a, b) => a.at - b.at).forEach(x => {
      const d = new Date(x.at);
      rows.push([ymd(d), pad(d.getHours()) + ':' + pad(d.getMinutes()), x.type === 'income' ? 'Money in' : 'Expense', x.item,
        catById(x.cat, x.type).name, x.method === 'cash' ? 'Cash' : 'Card', (x.amount / 100).toFixed(2), D.settings.currency, x.note || '']);
    });
    return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  async function exportCsv(items, name) {
    if (!items.length) { toast('Nothing to export yet.'); return; }
    if (await saveFile(name, buildCsv(items), 'text/csv')) toast('Exported ' + items.length + (items.length === 1 ? ' entry' : ' entries'));
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
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
    if (!rows.length) return null;
    const head = rows[0].map(h => h.trim().toLowerCase());
    const find = names => head.findIndex(h => names.some(n => h === n || h.startsWith(n)));
    const iD = find(['date']), iT = find(['time']), iTy = find(['type']), iW = find(['what', 'item']);
    const iC = find(['category']), iP = find(['paid']), iA = find(['amount']), iN = find(['note']);
    if (iD < 0 || iW < 0 || iA < 0) return null;
    const sig = x => [Math.floor(x.at / 60000), x.amount, (x.item || '').trim().toLowerCase(), x.type === 'income' ? 'i' : 'e'].join('|');
    const have = new Set(all().map(sig));
    let added = 0, skipped = 0, bad = 0;
    rows.slice(1).forEach(r => {
      const cell = i => (i >= 0 ? String(r[i] || '').trim().replace(/^'(?=[=+\-@])/, '') : '');
      const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cell(iD));
      const tm = /^(\d{1,2}):(\d{2})/.exec(cell(iT));
      const item = cell(iW).slice(0, 80);
      const amount = parseAmount(cell(iA));
      if (!dm || !item || isNaN(amount)) { bad++; return; }
      const type = /money in|income|venit/i.test(cell(iTy)) ? 'income' : 'expense';
      const at = new Date(+dm[1], +dm[2] - 1, +dm[3], tm ? +tm[1] : 12, tm ? +tm[2] : 0).getTime();
      const cname = cell(iC);
      let cat = FALLBACK[type];
      if (cname) {
        const found = D.cats.find(c => c.kind === type && c.name.toLowerCase() === cname.toLowerCase());
        if (found) cat = found.id;
        else {
          cat = newId('c');
          addCat({ id: cat, name: cname.slice(0, 24), emoji: '🏷️', color: PALETTE[D.cats.length % PALETTE.length], kind: type });
        }
      }
      const x = { id: newId('e'), type, amount, item, method: /cash|numerar/i.test(cell(iP)) ? 'cash' : 'card', cat, note: cell(iN).slice(0, 140), at, updated: Date.now() };
      const s = sig(x);
      if (have.has(s)) { skipped++; return; }
      have.add(s);
      D.entries[x.id] = x;
      added++;
    });
    return { added, skipped, bad };
  }
  function handleJson(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { toast("That file couldn't be read. Choose a Pocket Ledger backup or CSV.", { ms: 5000 }); return; }
    if (!o || o.app !== 'pocket-ledger' || !o.entries || typeof o.entries !== 'object') { toast("That isn't a Pocket Ledger backup.", { ms: 5000 }); return; }
    const n = Object.keys(o.entries).length;
    const when = o.exported ? new Date(o.exported).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    openConfirm('Restore this backup?',
      'This replaces everything on this phone with the backup' + (when ? ' from ' + when : '') + ' (' + n + (n === 1 ? ' entry' : ' entries') + '). Anything added since then will be lost.',
      'Restore backup',
      () => { D = normalize(o); setFormatter(); applyTheme(); runRules(); persist(); render(); toast('Backup restored'); });
  }

  // ---------- Events ----------
  document.querySelector('.tabbar').addEventListener('click', e => {
    const b = e.target.closest('.tab[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  $('fab').addEventListener('click', () => openEntry(null, { type: 'expense' }));

  $('homeSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    D.settings.period = b.dataset.p;
    HOME.offset = 0;
    HOME.sel = null;
    persist();
    renderHome();
  });
  $('prev').addEventListener('click', () => { HOME.offset--; HOME.sel = null; renderHome(); });
  $('next').addEventListener('click', () => { if (HOME.offset < 0) { HOME.offset++; HOME.sel = null; renderHome(); } });
  $('chart').addEventListener('click', e => {
    const b = e.target.closest('.bar');
    if (!b) return;
    const i = +b.dataset.i;
    HOME.sel = HOME.sel === i ? null : i;
    renderHome();
  });
  $('quick').addEventListener('click', e => {
    const b = e.target.closest('.qchip');
    const x = b && D.entries[b.dataset.id];
    if (x) openEntry(null, { type: x.type, amount: x.amount, item: x.item, method: x.method, cat: x.cat });
  });
  ['list', 'hList'].forEach(id => $(id).addEventListener('click', e => {
    const r = e.target.closest('.row');
    const x = r && D.entries[r.dataset.id];
    if (x) openEntry(x);
  }));
  $('bEdit').addEventListener('click', openBudget);
  $('installHide').addEventListener('click', () => { D.settings.hideInstall = true; persist(); $('install').hidden = true; });

  let qT;
  $('hq').addEventListener('input', e => {
    clearTimeout(qT);
    const v = e.target.value;
    qT = setTimeout(() => { HS.q = v; HS.limit = 150; renderHistory(); }, 150);
  });
  $('hType').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    HS.t = b.dataset.t;
    HS.limit = 150;
    renderHistory();
  });
  $('hCat').addEventListener('change', e => { HS.cat = e.target.value; HS.limit = 150; renderHistory(); });
  $('hMore').addEventListener('click', () => { HS.limit += 150; renderHistory(); });
  $('hExport').addEventListener('click', () => {
    const filtered = HS.q.trim() || HS.t !== 'all' || HS.cat !== 'all';
    exportCsv(historyItems(), 'pocket-ledger-' + (filtered ? 'filtered-' : 'all-') + ymd(new Date()) + '.csv');
  });

  $('statsSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    D.settings.statsPeriod = b.dataset.p;
    SS.offset = 0;
    persist();
    renderStats();
  });
  $('sPrev').addEventListener('click', () => { SS.offset--; renderStats(); });
  $('sNext').addEventListener('click', () => { if (SS.offset < 0) { SS.offset++; renderStats(); } });

  let nameT;
  $('setName').addEventListener('input', e => {
    clearTimeout(nameT);
    const v = e.target.value.trim().slice(0, 24);
    nameT = setTimeout(() => { D.settings.name = v; persist(); }, 300);
  });
  $('setCur').addEventListener('change', e => {
    D.settings.currency = CURS[e.target.value] ? e.target.value : 'RON';
    setFormatter();
    persist();
    renderSettings();
    toast('Amounts now show in ' + CURS[D.settings.currency].label);
  });
  $('setBudget').addEventListener('click', openBudget);
  $('setWeek').addEventListener('change', e => { D.settings.weekStart = e.target.value === '0' ? 0 : 1; persist(); renderSettings(); toast('Weeks now start on ' + (D.settings.weekStart ? 'Monday' : 'Sunday')); });
  $('setTheme').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    D.settings.theme = b.dataset.v;
    applyTheme();
    persist();
    renderSettings();
  });
  $('setCats').addEventListener('click', e => {
    const b = e.target.closest('.li');
    if (!b) return;
    if (b.dataset.add === 'cat') { pendingEntry = null; openCat(null, 'expense'); return; }
    const c = D.cats.find(x => x.id === b.dataset.cat);
    if (c) { pendingEntry = null; openCat(c); }
  });
  $('setRules').addEventListener('click', e => {
    const b = e.target.closest('.li');
    if (!b) return;
    if (b.dataset.add === 'rule') { openRule(null); return; }
    const r = D.rules.find(x => x.id === b.dataset.rule);
    if (r) openRule(r);
  });
  $('bkJson').addEventListener('click', async () => {
    const data = Object.assign({ app: 'pocket-ledger', exported: new Date().toISOString() }, D);
    if (await saveFile('pocket-ledger-backup-' + ymd(new Date()) + '.json', JSON.stringify(data, null, 1), 'application/json')) toast('Backup ready');
  });
  $('bkCsv').addEventListener('click', () => exportCsv(all(), 'pocket-ledger-all-' + ymd(new Date()) + '.csv'));
  $('bkImport').addEventListener('click', () => $('impFile').click());
  $('impFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      if (/\.json$/i.test(f.name) || /^\s*\{/.test(text)) { handleJson(text); return; }
      const res = importCsv(text);
      if (!res) { toast("That file isn't a Pocket Ledger CSV. Choose one exported from Pocket Ledger.", { ms: 5000 }); return; }
      if (res.added && !persist()) return;
      render();
      const parts = [res.added + (res.added === 1 ? ' entry added' : ' entries added')];
      if (res.skipped) parts.push(res.skipped + ' already here');
      if (res.bad) parts.push(res.bad + ' rows unreadable');
      toast(parts.join(' · '), { ms: 5000 });
    };
    reader.onerror = () => toast("Couldn't read that file. Try again.");
    reader.readAsText(f);
  });
  $('wipe').addEventListener('click', () => {
    const n = all().length;
    openConfirm('Delete all expenses?',
      'This removes all ' + n + (n === 1 ? ' entry' : ' entries') + ' and repeating payments from this phone. Your categories and settings stay. Save a backup first if you might want them back.',
      'Delete everything',
      () => { D.entries = {}; D.rules = []; persist(); render(); toast('All expenses deleted'); });
  });

  // ---------- Apple Pay auto-log ----------
  // A Shortcut on the iPhone sends each Apple Pay payment to the person's own Google Sheet
  // (a small Apps Script web app). Pocket Ledger fetches new rows from it and logs them.
  const AP_SCRIPT = [
    '// Pocket Ledger: Apple Pay inbox',
    '// Your iPhone Shortcut sends each Apple Pay payment here,',
    '// and Pocket Ledger picks them up when you open it.',
    "const SHEET_NAME = 'Payments';",
    '',
    'function getSheet_() {',
    '  const ss = SpreadsheetApp.getActiveSpreadsheet();',
    '  let sh = ss.getSheetByName(SHEET_NAME);',
    '  if (!sh) sh = ss.insertSheet(SHEET_NAME);',
    "  if (sh.getLastRow() === 0) sh.appendRow(['id', 'received', 'amount', 'merchant', 'card']);",
    '  return sh;',
    '}',
    '',
    'function reply_(obj) {',
    '  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);',
    '}',
    '',
    '// The Shortcut calls this after every Apple Pay payment.',
    'function doPost(e) {',
    '  let p = {};',
    "  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }",
    '  catch (err) { p = (e && e.parameter) || {}; }',
    "  const text = v => \"'\" + String(v == null ? '' : v).slice(0, 120);",
    '  const lock = LockService.getScriptLock();',
    '  lock.waitLock(10000);',
    '  try {',
    '    const id = Utilities.getUuid();',
    '    getSheet_().appendRow([id, Date.now(), text(p.amount), text(p.merchant), text(p.card)]);',
    '    return reply_({ ok: true, id: id });',
    '  } finally {',
    '    lock.releaseLock();',
    '  }',
    '}',
    '',
    '// Pocket Ledger calls this to collect new payments.',
    'function doGet(e) {',
    '  const since = Number((e && e.parameter && e.parameter.since) || 0);',
    '  const rows = getSheet_().getDataRange().getValues().slice(1);',
    '  const payments = rows',
    '    .filter(r => r[0] && Number(r[1]) > since)',
    '    .map(r => ({ id: String(r[0]), time: Number(r[1]), amount: String(r[2]), merchant: String(r[3]), card: String(r[4]) }));',
    '  return reply_({ ok: true, payments: payments });',
    '}',
    ''
  ].join('\n');

  const KEYWORDS = [
    ['groceries', /lidl|kaufland|carrefour|mega ?image|auchan|profi|penny|cora|selgros|metro cash|la doi pa|supermarket|market|freshful|bringo/i],
    ['food', /mcdonald|kfc|starbucks|burger|pizza|caf[eé]|coffee|cafea|restaurant|bistro|tazz|glovo|wolt|5 ?to ?go|ted'?s|salad ?box|subway|shaorma|paul |luca|gregory|bakery|patiser|brutar|kebab|sushi|bar /i],
    ['transport', /uber|bolt|stb|metrorex|cfr|omv|petrom|mol |rompetrol|lukoil|socar|parking|parcare|taxi|wizz|tarom|ryanair|benzin|fuel|ratb|tpl|ctp /i],
    ['subs', /netflix|spotify|apple\.com|itunes|google|youtube|disney|hbo|max\.com|playstation|xbox|chatgpt|openai|anthropic|claude|icloud|voyo/i],
    ['bills', /digi|orange|vodafone|telekom|enel|engie|e\.?on|electrica|apa nova|utilit/i],
    ['health', /farmac|pharma|catena|dona|help ?net|sensiblu|dr\.? ?max|regina maria|medlife|sanador|dent|clinic|optic/i],
    ['shopping', /emag|zara|h&m|h ?& ?m|decathlon|ikea|pepco|sinsay|reserved|waikiki|dedeman|altex|flanco|sephora|douglas|notino|about ?you|answear|fashion|mall|shop/i],
    ['fun', /cinema|bowling|eventim|iabilet|steam|epic games|nintendo|escape|concert|museum|muzeu|bilet/i]
  ];
  function guessCat(merchant) {
    const k = merchant.trim().toLowerCase();
    const past = all().filter(x => isExp(x) && x.item.trim().toLowerCase() === k).sort((a, b) => b.at - a.at)[0];
    if (past && D.cats.some(c => c.id === past.cat)) return past.cat;
    for (const [id, re] of KEYWORDS) if (re.test(merchant) && D.cats.some(c => c.id === id)) return id;
    return 'other';
  }
  function apAmount(raw) {
    const s = String(raw || '');
    if (/-|−/.test(s)) return NaN; // refunds are skipped
    return parseAmount(s.replace(/[^\d.,]/g, ''));
  }
  const apUrlOk = u => /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[^/]+\/exec(\?.*)?$/.test(u);
  // A purchase already typed in by hand (same amount, within 20 minutes) is not added twice.
  const alreadyLogged = (amount, at) => all().some(x => isExp(x) && x.src !== 'applepay' && x.amount === amount && Math.abs(x.at - at) <= 20 * 60000);

  let apBusy = false;
  async function syncApplePay(manual) {
    const ap = D.settings.applePay;
    if (!ap.url || apBusy) return null;
    if (!navigator.onLine) { if (manual) toast("You're offline. New Apple Pay payments will be added when you're back online."); return null; }
    apBusy = true;
    let result = null;
    try {
      const res = await fetch(ap.url + (ap.url.includes('?') ? '&' : '?') + 'since=' + encodeURIComponent(ap.since || 0), { cache: 'no-store', redirect: 'follow' });
      const data = await res.json();
      if (!data || data.ok !== true || !Array.isArray(data.payments)) throw new Error('format');
      const seen = new Set(ap.seen);
      let added = 0, dup = 0;
      data.payments.forEach(p => {
        if (!p || !p.id || seen.has(p.id)) return;
        seen.add(p.id);
        const at = Number(p.time) || Date.now();
        ap.since = Math.max(ap.since || 0, at);
        const amount = apAmount(p.amount);
        if (isNaN(amount)) return;
        if (alreadyLogged(amount, at)) { dup++; return; }
        const merchant = String(p.merchant || '').replace(/^'/, '').trim().slice(0, 80) || 'Apple Pay payment';
        const card = String(p.card || '').replace(/^'/, '').trim().slice(0, 60);
        const id = newId('e');
        D.entries[id] = { id, type: 'expense', amount, item: merchant, method: 'card', cat: guessCat(merchant), note: card, at, src: 'applepay', updated: Date.now() };
        added++;
      });
      ap.seen = Array.from(seen).slice(-500);
      ap.lastCheck = Date.now();
      ap.lastError = '';
      persist();
      result = { added, dup };
      if (added) {
        render();
        toast(added + ' Apple Pay ' + (added === 1 ? 'payment' : 'payments') + ' added', { action: 'Review', ms: 6000, onAction: reviewApplePay });
      } else if (manual) {
        toast(dup ? 'Connected. ' + dup + ' already logged by hand.' : 'Connected. No new payments yet.');
      }
    } catch (e) {
      ap.lastError = 'Couldn’t reach your sheet';
      persist();
      if (manual) toast("Couldn't read your sheet. Check the link ends in /exec and that “Who has access” is set to Anyone.", { ms: 6000 });
    } finally {
      apBusy = false;
      if (TAB === 'settings') renderSettings();
      if (openSheetEl && openSheetEl.id === 'apSheet') renderApSheet();
    }
    return result;
  }
  function reviewApplePay() {
    HS.q = 'apple pay'; HS.t = 'all'; HS.cat = 'all'; HS.limit = 150;
    $('hq').value = 'Apple Pay';
    showTab('history');
  }
  const agoText = ms => {
    if (!ms) return 'not checked yet';
    const d = new Date(ms);
    return 'last checked ' + (d.toDateString() === new Date().toDateString() ? 'today at ' + timeOf(ms) : dayName(d) + ' at ' + timeOf(ms));
  };
  function renderApSettings() {
    const ap = D.settings.applePay;
    const on = !!ap.url;
    $('apTitle').textContent = on ? 'Apple Pay auto-log is on' : 'Set up Apple Pay auto-log';
    $('apSub').textContent = on ? (ap.lastError ? ap.lastError + ' · tap to fix' : 'Tap to see the setup steps again') : 'About 10 minutes, once';
    $('apCheck').hidden = !on;
    const n = all().filter(x => x.src === 'applepay').length;
    $('apLast').textContent = agoText(ap.lastCheck) + ' · ' + n + (n === 1 ? ' payment' : ' payments') + ' logged so far';
  }
  function renderApSheet() {
    const ap = D.settings.applePay;
    $('apOff').hidden = !ap.url;
    disarm($('apOff'), 'Turn off');
    const st = $('apStatus');
    if (!ap.url) st.textContent = 'Not connected yet.';
    else if (ap.lastError) st.textContent = ap.lastError + '. Check the link and try again.';
    else st.textContent = 'Connected · ' + agoText(ap.lastCheck) + '.';
  }
  function openApSheet() {
    $('apUrl').value = D.settings.applePay.url || '';
    $('apErr').hidden = true;
    $('apScriptBox').hidden = true;
    renderApSheet();
    showSheet('apSheet');
  }
  $('apOpen').addEventListener('click', openApSheet);
  $('apCheck').addEventListener('click', () => syncApplePay(true));
  $('apCopy').addEventListener('click', () => {
    const box = $('apScriptBox');
    const fallback = () => { box.hidden = false; box.value = AP_SCRIPT; box.focus(); box.select(); toast('Select all the text in the box and copy it.'); };
    try {
      navigator.clipboard.writeText(AP_SCRIPT).then(() => toast('Script copied'), fallback);
    } catch (e) { fallback(); }
  });
  $('apForm').addEventListener('submit', async e => {
    e.preventDefault();
    const u = $('apUrl').value.trim();
    const err = $('apErr');
    if (!apUrlOk(u)) {
      err.hidden = false;
      err.textContent = /\/dev(\?|$)/.test(u)
        ? 'That is the test link. Use the Web app link from Deploy → New deployment, which ends in /exec.'
        : 'Paste the Web app link from Google. It starts with https://script.google.com/macros/s/ and ends in /exec.';
      $('apUrl').focus();
      return;
    }
    err.hidden = true;
    const ap = D.settings.applePay;
    if (ap.url !== u) { ap.url = u; ap.lastCheck = 0; ap.lastError = ''; }
    persist();
    $('apStatus').textContent = 'Checking…';
    await syncApplePay(true);
  });
  $('apOff').addEventListener('click', () => {
    if (!armed($('apOff'), 'Tap again to turn off')) return;
    Object.assign(D.settings.applePay, { url: '', lastError: '', lastCheck: 0 });
    persist();
    hideSheet();
    render();
    toast('Apple Pay auto-log is off. Payments already logged stay.');
  });

  // iOS can leave the page shifted after the keyboard closes, which puts buttons out of reach. Put it back.
  const isField = el => !!el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  function resetShift() {
    if (isField(document.activeElement)) return;
    if (window.scrollY || window.scrollX || document.documentElement.scrollTop || document.body.scrollTop) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }
  document.addEventListener('focusout', () => setTimeout(resetShift, 80));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(resetShift, 80));
  window.addEventListener('scroll', () => { if (!isField(document.activeElement)) resetShift(); }, { passive: true });

  let lastDay = new Date().toDateString();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const n = runRules();
    if (n) persist();
    if (n || new Date().toDateString() !== lastDay) { lastDay = new Date().toDateString(); render(); }
    syncApplePay(false);
  });
  window.addEventListener('online', () => syncApplePay(false));

  // ---------- Start ----------
  setFormatter();
  applyTheme();
  const added = runRules();
  if (migrated || added) persist();
  showTab('home');
  if (!storageOk) toast('This browser is blocking storage, so nothing will be kept. Open Pocket Ledger from its home screen icon.', { ms: 6000 });
  else if (migrated) toast('Pocket Ledger got an update. All your expenses are still here.', { ms: 4500 });
  else if (added) toast(added + ' repeating ' + (added === 1 ? 'payment' : 'payments') + ' added');
  syncApplePay(false);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
