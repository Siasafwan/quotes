/* Shared helpers: money maths, formatting, numbering, amount in words. */
(function (global) {
  'use strict';

  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  function lineAmount(item) {
    return round2(num(item.qty) * num(item.price));
  }

  function totals(doc) {
    const items = doc.items || [];
    const subtotal = round2(items.reduce((s, it) => s + lineAmount(it), 0));
    const discount = Math.min(round2(num(doc.discount)), subtotal);
    const taxable = round2(subtotal - discount);
    const vatRate = num(doc.vatRate);
    const vat = round2(taxable * vatRate / 100);
    const total = round2(taxable + vat);
    const paid = doc.type === 'invoice' ? round2(num(doc.amountPaid)) : 0;
    const balance = round2(total - paid);
    return { subtotal, discount, taxable, vatRate, vat, total, paid, balance };
  }

  function money(n) {
    return round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function parseISO(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
  function toISO(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
  function today() { return toISO(new Date()); }
  function addDays(iso, days) {
    const d = parseISO(iso) || new Date();
    d.setDate(d.getDate() + (parseInt(days, 10) || 0));
    return toISO(d);
  }
  function longDate(iso) {
    const d = parseISO(iso);
    if (!d) return '';
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  function shortDate(iso) {
    const d = parseISO(iso);
    if (!d) return '';
    return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  }

  /* Document numbers look like PREFIX-YYYY-0001 (year part optional). */
  function formatNumber(prefix, year, n, cfg) {
    const pad = Math.max(1, parseInt(cfg.pad, 10) || 4);
    const seq = String(n).padStart(pad, '0');
    const parts = [prefix];
    if (cfg.includeYear !== false) parts.push(year);
    parts.push(seq);
    return parts.filter(Boolean).join('-');
  }

  function nextNumber(type, docs, numbering, issueDate) {
    const cfg = numbering || {};
    const prefix = (type === 'quote' ? cfg.quotePrefix : cfg.invoicePrefix) || (type === 'quote' ? 'QTN' : 'INV');
    const start = parseInt(type === 'quote' ? cfg.quoteStart : cfg.invoiceStart, 10) || 1;
    const year = (parseISO(issueDate) || new Date()).getFullYear();
    const stem = formatNumber(prefix, year, 0, cfg).replace(/0+$/, '');
    let max = start - 1;
    for (const d of docs) {
      if (d.type !== type || !d.number || !d.number.startsWith(stem)) continue;
      const tail = d.number.slice(stem.length);
      if (/^\d+$/.test(tail)) max = Math.max(max, parseInt(tail, 10));
    }
    return formatNumber(prefix, year, max + 1, cfg);
  }

  /* Amount in words, e.g. "UAE Dirhams Five Hundred Eighty-Eight and Fifty Fils Only" */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below1000(n) {
    const out = [];
    if (n >= 100) { out.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
    if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
    else if (n > 0) out.push(ONES[n]);
    return out.join(' ');
  }
  function intWords(n) {
    if (n === 0) return 'Zero';
    const scales = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
    const out = [];
    for (const [v, name] of scales) {
      if (n >= v) { out.push(below1000(Math.floor(n / v)) + ' ' + name); n %= v; }
    }
    if (n > 0) out.push(below1000(n));
    return out.join(' ');
  }
  function amountInWords(amount, currency) {
    const a = round2(Math.abs(amount));
    const whole = Math.floor(a);
    const frac = Math.round((a - whole) * 100);
    const cur = (currency || 'AED').toUpperCase();
    const [major, minor] = cur === 'AED' ? ['UAE Dirhams', 'Fils']
      : cur === 'USD' ? ['US Dollars', 'Cents']
      : cur === 'SAR' ? ['Saudi Riyals', 'Halalas']
      : cur === 'EUR' ? ['Euros', 'Cents'] : [cur, 'Cents'];
    let s = `${major} ${intWords(whole)}`;
    if (frac) s += ` and ${intWords(frac)} ${minor}`;
    return s + ' Only';
  }

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  global.Calc = { round2, num, lineAmount, totals, money, today, addDays, longDate, shortDate, parseISO, toISO, nextNumber, amountInWords, uid };
})(window);
