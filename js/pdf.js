/* Builds quotation / invoice PDFs with pdf-lib (vector text, A4). */
(function (global) {
  'use strict';
  const { PDFDocument, StandardFonts, rgb, degrees } = global.PDFLib;
  const { money, longDate, totals, lineAmount, amountInWords, num } = global.Calc;

  const hex = (h) => {
    const v = h.replace('#', '');
    return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255);
  };
  const C = {
    navy: hex('#0F2A4F'),
    accent: hex('#1A8FE0'),
    ink: hex('#1B2533'),
    body: hex('#334155'),
    muted: hex('#6B7686'),
    line: hex('#D6DEE8'),
    soft: hex('#F2F6FB'),
    zebra: hex('#F8FAFD'),
    white: rgb(1, 1, 1),
    paid: hex('#15803D'),
  };

  const W = 595.28, H = 841.89, M = 42;
  const CW = W - 2 * M;
  const FOOT = 44; // reserved at the bottom of each page

  async function build(doc, settings, logo) {
    const pdf = await PDFDocument.create();
    const isQuote = doc.type === 'quote';
    const title = isQuote ? 'QUOTATION' : (settings.company?.trn ? 'TAX INVOICE' : 'INVOICE');
    pdf.setTitle(`${isQuote ? 'Quotation' : 'Invoice'} ${doc.number || ''}`);
    pdf.setAuthor(settings.company?.name || '');
    pdf.setCreator('Quotation & Invoice Studio');

    const F = {
      reg: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      ital: await pdf.embedFont(StandardFonts.HelveticaOblique),
    };

    // ---------- text helpers ----------
    const encCache = new Map();
    function safe(s) {
      s = String(s ?? '').replace(/\r/g, '').replace(/\t/g, '    ');
      try { F.reg.encodeText(s); return s; } catch (e) { /* fall through */ }
      let out = '';
      for (const ch of s) {
        if (!encCache.has(ch)) {
          let ok = true;
          try { F.reg.encodeText(ch); } catch (e) { ok = false; }
          encCache.set(ch, ok);
        }
        out += encCache.get(ch) ? ch : (ch === '\n' ? '\n' : '?');
      }
      return out;
    }
    const width = (t, font, size) => font.widthOfTextAtSize(safe(t), size);
    function wrap(text, font, size, maxW) {
      const lines = [];
      const paras = safe(text).split('\n');
      for (const para of paras) {
        if (!para.trim()) { lines.push(''); continue; }
        const words = para.split(/ +/);
        let cur = '';
        for (const w of words) {
          const test = cur ? cur + ' ' + w : w;
          if (font.widthOfTextAtSize(test, size) <= maxW) { cur = test; continue; }
          if (cur) lines.push(cur);
          // break very long words
          let word = w;
          while (font.widthOfTextAtSize(word, size) > maxW && word.length > 1) {
            let i = word.length - 1;
            while (i > 1 && font.widthOfTextAtSize(word.slice(0, i), size) > maxW) i--;
            lines.push(word.slice(0, i));
            word = word.slice(i);
          }
          cur = word;
        }
        lines.push(cur);
      }
      // trim leading/trailing empty lines
      while (lines.length && !lines[0]) lines.shift();
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      return lines;
    }

    // ---------- page handling ----------
    let page, y;
    const pages = [];
    function text(t, x, top, font, size, color, opts = {}) {
      const s = safe(t);
      let dx = x;
      if (opts.align === 'right') dx = x - font.widthOfTextAtSize(s, size);
      else if (opts.align === 'center') dx = x - font.widthOfTextAtSize(s, size) / 2;
      page.drawText(s, { x: dx, y: H - top - size * 0.78, size, font, color: color || C.ink });
    }
    function rect(x, top, w, h, fill, border) {
      page.drawRectangle({ x, y: H - top - h, width: w, height: h, color: fill || undefined, borderColor: border || undefined, borderWidth: border ? 0.7 : 0 });
    }
    function hline(x1, x2, top, color, thickness = 0.7) {
      page.drawLine({ start: { x: x1, y: H - top }, end: { x: x2, y: H - top }, thickness, color: color || C.line });
    }
    function topBand() {
      rect(0, 0, W, 7, C.navy);
      rect(W * 0.7, 0, W * 0.3, 7, C.accent);
    }
    function newPage(continued) {
      page = pdf.addPage([W, H]);
      pages.push(page);
      topBand();
      if (continued) {
        text(`${isQuote ? 'Quotation' : 'Invoice'} ${doc.number || ''} (continued)`, M, 24, F.bold, 9, C.muted);
        hline(M, W - M, 42);
        y = 54;
      } else {
        y = 30;
      }
    }
    const room = () => H - FOOT - y;
    function ensure(h, onBreak) {
      if (h > room()) { newPage(true); if (onBreak) onBreak(); return true; }
      return false;
    }

    newPage(false);
    const co = settings.company || {};
    const client = doc.client || {};

    // ---------- header ----------
    let leftBottom = y, logoRight = M;
    if (logo) {
      try {
        const img = logo.type === 'png' ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
        const maxW = 130, maxH = 62;
        const s = Math.min(maxW / img.width, maxH / img.height);
        const w = img.width * s, h = img.height * s;
        page.drawImage(img, { x: M, y: H - y - h, width: w, height: h });
        leftBottom = y + h;
        logoRight = M + w + 16;
      } catch (e) { console.warn('Logo could not be embedded', e); }
    }
    // company block, beside the logo (between logo and the title column)
    const coX = logoRight;
    const coW = Math.max(150, (W - M - 215) - coX);
    let ly = y + 2;
    if (co.name) { for (const l of wrap(co.name, F.bold, 10.5, coW)) { text(l, coX, ly, F.bold, 10.5, C.navy); ly += 13.5; } }
    const coLines = [];
    if (co.address) coLines.push(...wrap(co.address, F.reg, 8.3, coW));
    if (co.phone) coLines.push(`Tel: ${co.phone}`);
    if (co.email) coLines.push(co.email);
    if (co.website) coLines.push(co.website);
    if (co.trn) coLines.push(`TRN: ${co.trn}`);
    for (const l of coLines) { text(l, coX, ly, F.reg, 8.3, C.muted); ly += 11; }

    // title + meta (right column)
    const R = W - M;
    text(title, R, y + 4, F.bold, 24, C.navy, { align: 'right' });
    let ry = y + 38;
    const meta = [[isQuote ? 'Quotation No.' : 'Invoice No.', doc.number || '-'], ['Issue date', longDate(doc.issueDate)]];
    if (isQuote) meta.push(['Valid until', longDate(global.Calc.addDays(doc.issueDate, doc.validDays || 0)) + (doc.validDays ? `  (${doc.validDays} days)` : '')]);
    else {
      if (doc.dueDate) meta.push(['Due date', longDate(doc.dueDate)]);
      if (doc.quoteNumber) meta.push(['Quotation ref.', doc.quoteNumber]);
      if (doc.poNumber) meta.push(['Client PO', doc.poNumber]);
    }
    if (isQuote && doc.poNumber) meta.push(['Reference', doc.poNumber]);
    for (const [k, v] of meta) {
      text(v, R, ry, F.bold, 9, C.ink, { align: 'right' });
      const vw = width(v, F.bold, 9);
      text(k, R - Math.max(vw, 110) - 12, ry, F.reg, 9, C.muted, { align: 'right' });
      ry += 14;
    }
    y = Math.max(ly, ry, leftBottom) + 8;
    hline(M, W - M, y, C.line, 0.8);
    y += 14;

    // ---------- parties ----------
    const gap = 14, bw = (CW - gap) / 2, pad = 11;
    const leftLines = [];
    const innerW = bw - 2 * pad;
    if (client.name) leftLines.push(...wrap(client.name, F.bold, 10.5, innerW).map((t) => [t, F.bold, 10.5, C.ink]));
    if (client.company && client.company !== client.name) leftLines.push(...wrap(client.company, F.reg, 9, innerW).map((t) => [t, F.reg, 9, C.body]));
    if (client.address) leftLines.push(...wrap(client.address, F.reg, 8.5, innerW).map((t) => [t, F.reg, 8.5, C.muted]));
    if (client.phone) leftLines.push([`Tel: ${client.phone}`, F.reg, 8.5, C.muted]);
    if (client.email) leftLines.push([client.email, F.reg, 8.5, C.muted]);
    if (client.trn) leftLines.push([`TRN: ${client.trn}`, F.reg, 8.5, C.muted]);
    if (!leftLines.length) leftLines.push(['-', F.reg, 9, C.muted]);

    const details = [];
    if (doc.project) details.push(['Project', doc.project]);
    if (doc.preparedBy) details.push(['Prepared by', doc.preparedBy]);
    if (doc.paymentTerms) details.push(['Payment terms', doc.paymentTerms]);
    if (isQuote && doc.duration) details.push(['Est. duration', doc.duration]);
    details.push(['Currency', doc.currency || 'AED']);
    const kW = 76, vW = innerW - kW;
    const rightRows = details.map(([k, v]) => [k, wrap(v, F.bold, 8.8, vW)]);

    const lh = (s) => s * 1.32;
    const leftH = leftLines.reduce((s, l) => s + lh(l[2]), 0);
    const rightH = rightRows.reduce((s, r) => s + r[1].length * 11.6 + 3, 0);
    const boxH = 26 + Math.max(leftH, rightH) + pad;
    ensure(boxH + 10);
    const boxTop = y;
    rect(M, boxTop, bw, boxH, C.soft);
    rect(M + bw + gap, boxTop, bw, boxH, C.soft);
    rect(M, boxTop, 3, boxH, C.accent);
    rect(M + bw + gap, boxTop, 3, boxH, C.navy);
    text(isQuote ? 'Prepared for' : 'Bill to', M + pad, boxTop + 10, F.bold, 8.5, C.accent);
    text(isQuote ? 'Project details' : 'Invoice details', M + bw + gap + pad, boxTop + 10, F.bold, 8.5, C.navy);
    let py = boxTop + 26;
    for (const [t, f, s, c] of leftLines) { text(t, M + pad, py, f, s, c); py += lh(s); }
    py = boxTop + 26;
    const rx = M + bw + gap + pad;
    for (const [k, vlines] of rightRows) {
      text(k, rx, py, F.reg, 8.5, C.muted);
      vlines.forEach((v, i) => text(v, rx + kW, py + i * 11.6, F.bold, 8.8, C.ink));
      py += vlines.length * 11.6 + 3;
    }
    y = boxTop + boxH + 16;

    // ---------- subject & intro ----------
    if (doc.subject) {
      const sl = wrap(`Subject: ${doc.subject}`, F.bold, 10, CW);
      ensure(sl.length * 13 + 4);
      for (const l of sl) { text(l, M, y, F.bold, 10, C.ink); y += 13; }
      y += 3;
    }
    if (doc.intro) {
      for (const l of wrap(doc.intro, F.reg, 9, CW)) { ensure(12.5); text(l, M, y, F.reg, 9, C.body); y += 12.5; }
    }
    y += 10;

    // ---------- items table ----------
    const cur = doc.currency || 'AED';
    const cols = [
      { key: 'sn', label: '#', w: 26, align: 'center' },
      { key: 'desc', label: 'Description', w: 0, align: 'left' },
      { key: 'qty', label: 'Qty', w: 42, align: 'center' },
      { key: 'price', label: `Unit price (${cur})`, w: 88, align: 'right' },
      { key: 'amount', label: `Amount (${cur})`, w: 92, align: 'right' },
    ];
    cols[1].w = CW - cols.reduce((s, c) => s + c.w, 0);
    let cx = M;
    for (const c of cols) { c.x = cx; cx += c.w; }
    const cellX = (c) => c.align === 'right' ? c.x + c.w - 8 : c.align === 'center' ? c.x + c.w / 2 : c.x + 8;

    function tableHeader() {
      rect(M, y, CW, 22, C.navy);
      for (const c of cols) text(c.label, cellX(c), y + 7.5, F.bold, 8.3, C.white, { align: c.align });
      y += 22;
    }
    ensure(22 + 40);
    tableHeader();

    const items = (doc.items || []).filter((it) => (it.title || it.description || num(it.price)));
    const descW = cols[1].w - 16;
    items.forEach((it, idx) => {
      const tl = it.title ? wrap(it.title, F.bold, 9.3, descW) : [];
      const dl = it.description ? wrap(it.description, F.reg, 8.5, descW) : [];
      const lines = [...tl.map((t) => [t, F.bold, 9.3, C.ink, 12]), ...dl.map((t) => [t, F.reg, 8.5, C.body, 11.2])];
      if (!lines.length) lines.push(['-', F.reg, 9, C.muted, 12]);
      const padY = 8;
      let i = 0, first = true;
      while (i < lines.length) {
        // how many lines fit on this page?
        let h = padY * 2, n = 0;
        while (i + n < lines.length && h + lines[i + n][4] <= room()) { h += lines[i + n][4]; n++; }
        const totalH = lines.slice(i).reduce((s, l) => s + l[4], 0) + padY * 2;
        if (n < lines.length - i && (totalH <= H - FOOT - 54 - 22 || n < 2)) {
          newPage(true); tableHeader(); continue;
        }
        if (n === 0) { newPage(true); tableHeader(); continue; }
        if (idx % 2 === 1) rect(M, y, CW, h, C.zebra);
        let ty = y + padY;
        if (first) {
          const qty = num(it.qty);
          const qtyStr = (Number.isInteger(qty) ? String(qty) : String(qty)) + (it.unit ? ` ${it.unit}` : '');
          text(String(idx + 1), cellX(cols[0]), ty + 0.5, F.reg, 9, C.muted, { align: 'center' });
          text(qtyStr, cellX(cols[2]), ty + 0.5, F.reg, 9, C.ink, { align: 'center' });
          text(money(it.price), cellX(cols[3]), ty + 0.5, F.reg, 9, C.ink, { align: 'right' });
          text(money(lineAmount(it)), cellX(cols[4]), ty + 0.5, F.bold, 9, C.ink, { align: 'right' });
        }
        for (let k = 0; k < n; k++) {
          const [t, f, s, c, adv] = lines[i + k];
          text(t, cols[1].x + 8, ty, f, s, c);
          ty += adv;
        }
        y += h;
        hline(M, W - M, y, C.line, 0.6);
        i += n; first = false;
      }
    });
    if (!items.length) {
      text('No items added', M + CW / 2, y + 10, F.ital, 9, C.muted, { align: 'center' });
      y += 30; hline(M, W - M, y);
    }

    // ---------- totals ----------
    const T = totals(doc);
    const rowsT = [['Subtotal', money(T.subtotal)]];
    if (T.discount) rowsT.push(['Discount', '- ' + money(T.discount)]);
    rowsT.push([`VAT (${T.vatRate}%)`, money(T.vat)]);
    const extra = [];
    if (!isQuote && T.paid) { extra.push(['Amount paid', '- ' + money(T.paid)]); extra.push(['Balance due', money(T.balance)]); }
    const tH = rowsT.length * 18 + 28 + extra.length * 18 + 10;
    y += 12;
    ensure(tH + 10);
    const tw = 236, tx = W - M - tw;
    let ty = y;
    for (const [k, v] of rowsT) {
      text(k, tx + 10, ty + 4, F.reg, 9.2, C.body);
      text(`${v}`, W - M - 8, ty + 4, F.bold, 9.2, C.ink, { align: 'right' });
      ty += 18;
      hline(tx, W - M, ty - 1, C.line, 0.5);
    }
    rect(tx, ty + 2, tw, 26, C.navy);
    text(`Total (${cur})`, tx + 10, ty + 10, F.bold, 10.5, C.white);
    text(money(T.total), W - M - 8, ty + 10, F.bold, 11.5, C.white, { align: 'right' });
    ty += 34;
    for (const [k, v] of extra) {
      const strong = k === 'Balance due';
      text(k, tx + 10, ty + 4, strong ? F.bold : F.reg, 9.2, strong ? C.navy : C.body);
      text(v, W - M - 8, ty + 4, F.bold, 9.2, strong ? C.navy : C.ink, { align: 'right' });
      ty += 18;
    }
    // amount in words (left of totals)
    const wordsW = CW - tw - 24;
    text('Amount in words', M, y + 4, F.bold, 8.5, C.navy);
    const words = wrap(amountInWords(!isQuote && T.paid ? T.balance : T.total, cur), F.ital, 9, wordsW);
    let wy = y + 18;
    for (const l of words) { text(l, M, wy, F.ital, 9, C.body); wy += 12; }
    if (!isQuote && T.paid) { text('(balance due)', M, wy, F.reg, 8, C.muted); wy += 12; }
    y = Math.max(ty, wy) + 14;

    // ---------- bullet sections ----------
    function section(heading, body) {
      const raw = String(body || '').split('\n').map((s) => s.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
      if (!raw.length) return;
      const first = wrap(raw[0], F.reg, 9, CW - 14);
      ensure(22 + Math.min(first.length, 2) * 12);
      rect(M, y + 1, 3, 11, C.accent);
      text(heading, M + 9, y + 2, F.bold, 10, C.navy);
      y += 20;
      for (const item of raw) {
        const ls = wrap(item, F.reg, 9, CW - 14);
        ls.forEach((l, i) => {
          ensure(12.5);
          if (i === 0) rect(M + 2, y + 3.2, 3, 3, C.accent);
          text(l, M + 14, y, F.reg, 9, C.body);
          y += 12.5;
        });
        y += 2.5;
      }
      y += 6;
    }
    section('Scope of work', doc.scope);
    section('Terms & conditions', doc.terms);

    // ---------- bank details ----------
    const bank = settings.bank || {};
    const showBank = !isQuote || doc.showBank;
    const bankRows = [['Bank', bank.bankName], ['Account name', bank.accountName], ['Account no.', bank.accountNo], ['IBAN', bank.iban], ['SWIFT / BIC', bank.swift]].filter((r) => r[1]);
    let sigDone = false;
    if (showBank && bankRows.length) {
      const bh = 26 + bankRows.length * 13 + 8;
      const side = !isQuote && !doc.notes; // invoice: signature sits beside the bank box
      const bw2 = side ? CW * 0.56 : CW;
      ensure(bh + 10);
      rect(M, y, bw2, bh, null, C.line);
      text('Payment details', M + 11, y + 10, F.bold, 9, C.navy);
      let by = y + 26;
      for (const [k, v] of bankRows) {
        text(k, M + 11, by, F.reg, 8.8, C.muted);
        text(v, M + 100, by, F.bold, 8.8, C.ink);
        by += 13;
      }
      if (side) {
        const sx = M + bw2 + 24, sW = W - M - sx;
        const ly2 = y + bh - 30;
        hline(sx, W - M, ly2, C.ink, 0.7);
        text(`For ${co.name || 'the company'}`, sx, ly2 + 6, F.bold, 8.8, C.ink);
        text('Authorized signature & stamp', sx, ly2 + 18, F.reg, 8, C.muted);
        text('Thank you for your business.', sx + sW, y + 10, F.ital, 9, C.muted, { align: 'right' });
        sigDone = true;
      }
      y += bh + 10;
    }

    if (doc.notes) {
      const nl = wrap(doc.notes, F.reg, 9, CW);
      ensure(20 + Math.min(nl.length, 2) * 12);
      rect(M, y + 1, 3, 11, C.accent);
      text('Notes', M + 9, y + 2, F.bold, 10, C.navy);
      y += 20;
      for (const l of nl) { ensure(12.5); text(l, M, y, F.reg, 9, C.body); y += 12.5; }
      y += 10;
    }

    // ---------- signatures ----------
    if (!sigDone) {
    ensure(66);
    const sw = 200;
    const sigY = y + 34;
    hline(M, M + sw, sigY, C.ink, 0.7);
    text(`For ${co.name || 'the company'}`, M, sigY + 6, F.bold, 8.8, C.ink);
    text('Authorized signature & stamp', M, sigY + 18, F.reg, 8, C.muted);
    if (isQuote) {
      hline(W - M - sw, W - M, sigY, C.ink, 0.7);
      text('Client acceptance', W - M - sw, sigY + 6, F.bold, 8.8, C.ink);
      text('Name, signature & date', W - M - sw, sigY + 18, F.reg, 8, C.muted);
    } else {
      text('Thank you for your business.', W - M, sigY + 6, F.ital, 9, C.muted, { align: 'right' });
    }
    y = sigY + 30;
    }

    // ---------- status stamp ----------
    if (!isQuote && doc.status === 'Paid') {
      const p0 = pages[0];
      p0.drawText('PAID', { x: W - M - 150, y: H - 250, size: 46, font: F.bold, color: C.paid, opacity: 0.18, rotate: degrees(14) });
    }

    // ---------- footer on every page ----------
    const footBits = [co.name, co.phone, co.email, co.website].filter(Boolean).join('   |   ');
    pages.forEach((p, i) => {
      page = p;
      hline(M, W - M, H - 34, C.line, 0.6);
      if (footBits) text(footBits, M, H - 27, F.reg, 7.6, C.muted);
      text(`${doc.number || ''}   Page ${i + 1} of ${pages.length}`, W - M, H - 27, F.reg, 7.6, C.muted, { align: 'right' });
    });

    return pdf.save();
  }

  global.PDFGen = { build };
})(window);
