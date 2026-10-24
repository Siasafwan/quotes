/* Report PDFs (profit & loss, VAT summary, receivables, payables, expense lists). */
(function (global) {
  'use strict';
  const { PDFDocument, StandardFonts, rgb } = global.PDFLib;

  const hex = (h) => { const v = h.replace('#', ''); return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255); };
  const C = { navy: hex('#0F2A4F'), accent: hex('#1A8FE0'), ink: hex('#1B2533'), body: hex('#334155'), muted: hex('#6B7686'), line: hex('#D6DEE8'), soft: hex('#F2F6FB'), zebra: hex('#F8FAFD'), white: rgb(1, 1, 1), warn: hex('#A15C07') };
  const W = 595.28, H = 841.89, M = 40, CW = W - 2 * M, FOOT = 44;

  /*
   * opts = {
   *   title, period, generated,
   *   summary: [[label, value, strong]],
   *   sections: [{ heading, note, columns: [{ label, align, w }], rows: [[...]], total: [...] }],
   *   footnote
   * }
   */
  async function build(opts, settings, logo) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(opts.title);
    const F = { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), ital: await pdf.embedFont(StandardFonts.HelveticaOblique) };
    const co = (settings && settings.company) || {};

    const safe = (t) => { const s = String(t ?? ''); try { F.reg.encodeText(s); return s; } catch (e) { return Array.from(s).map((ch) => { try { F.reg.encodeText(ch); return ch; } catch (x) { return '?'; } }).join(''); } };
    function fit(t, font, size, maxW) {
      let s = safe(t);
      if (font.widthOfTextAtSize(s, size) <= maxW) return s;
      while (s.length > 1 && font.widthOfTextAtSize(s + '...', size) > maxW) s = s.slice(0, -1);
      return s + '...';
    }
    function wrap(t, font, size, maxW) {
      const out = [];
      for (const para of safe(t).split('\n')) {
        let cur = '';
        for (const w of para.split(/ +/)) {
          const test = cur ? cur + ' ' + w : w;
          if (font.widthOfTextAtSize(test, size) <= maxW) cur = test; else { if (cur) out.push(cur); cur = w; }
        }
        out.push(cur);
      }
      return out;
    }

    let page, y; const pages = [];
    const text = (t, x, top, font, size, color, align) => {
      const s = safe(t);
      const dx = align === 'right' ? x - font.widthOfTextAtSize(s, size) : align === 'center' ? x - font.widthOfTextAtSize(s, size) / 2 : x;
      page.drawText(s, { x: dx, y: H - top - size * 0.78, size, font, color: color || C.ink });
    };
    const rect = (x, top, w, h, fill, border) => page.drawRectangle({ x, y: H - top - h, width: w, height: h, color: fill || undefined, borderColor: border || undefined, borderWidth: border ? 0.7 : 0 });
    const hline = (x1, x2, top, color, t = 0.6) => page.drawLine({ start: { x: x1, y: H - top }, end: { x: x2, y: H - top }, thickness: t, color: color || C.line });

    function newPage(first) {
      page = pdf.addPage([W, H]); pages.push(page);
      rect(0, 0, W, 6, C.navy); rect(W * 0.7, 0, W * 0.3, 6, C.accent);
      if (first) { y = 28; return; }
      text(`${opts.title} (continued)`, M, 22, F.bold, 9, C.muted);
      hline(M, W - M, 38); y = 50;
    }
    const room = () => H - FOOT - y;
    const ensure = (h, after) => { if (h > room()) { newPage(false); if (after) after(); return true; } return false; };

    // ---------- header ----------
    newPage(true);
    let lx = M, top = y;
    if (logo) {
      try {
        const img = logo.type === 'png' ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
        const s = Math.min(100 / img.width, 48 / img.height);
        page.drawImage(img, { x: M, y: H - y - img.height * s, width: img.width * s, height: img.height * s });
        lx = M + img.width * s + 14;
        top = y + img.height * s;
      } catch (e) { /* ignore logo errors */ }
    }
    let cy = y + 2;
    if (co.name) { text(co.name, lx, cy, F.bold, 10.5, C.navy); cy += 13; }
    if (co.trn) { text(`TRN: ${co.trn}`, lx, cy, F.reg, 8.3, C.muted); cy += 11; }
    if (co.address) { text(co.address.split('\n')[0], lx, cy, F.reg, 8.3, C.muted); cy += 11; }
    text(opts.title, W - M, y + 2, F.bold, 18, C.navy, 'right');
    if (opts.period) text(opts.period, W - M, y + 26, F.bold, 9.5, C.ink, 'right');
    if (opts.generated) text(opts.generated, W - M, y + 40, F.reg, 8, C.muted, 'right');
    y = Math.max(top, cy, y + 52) + 10;
    hline(M, W - M, y, C.line, 0.8); y += 16;

    // ---------- summary ----------
    if (opts.summary && opts.summary.length) {
      const rowH = 19;
      const boxH = opts.summary.length * rowH + 14;
      ensure(boxH + 10);
      rect(M, y, CW, boxH, C.soft);
      let sy = y + 9;
      for (const [label, value, strong] of opts.summary) {
        if (strong) { hline(M + 12, W - M - 12, sy - 3, C.line, 0.6); }
        text(label, M + 14, sy + 3, strong ? F.bold : F.reg, strong ? 10.5 : 9.5, strong ? C.navy : C.body);
        text(value, W - M - 14, sy + 3, F.bold, strong ? 11 : 9.5, strong ? C.navy : C.ink, 'right');
        sy += rowH;
      }
      y += boxH + 18;
    }

    // ---------- sections ----------
    for (const sec of opts.sections || []) {
      const cols = sec.columns;
      const totalW = cols.reduce((s, c) => s + (c.w || 1), 0);
      let x = M;
      for (const c of cols) { c.px = (CW * (c.w || 1)) / totalW; c.x = x; x += c.px; }
      const cx = (c) => c.align === 'right' ? c.x + c.px - 6 : c.align === 'center' ? c.x + c.px / 2 : c.x + 6;
      const header = () => {
        rect(M, y, CW, 20, C.navy);
        for (const c of cols) text(fit(c.label, F.bold, 8, c.px - 10), cx(c), y + 6.5, F.bold, 8, C.white, c.align);
        y += 20;
      };
      ensure(24 + 20 + 18 * Math.min(3, (sec.rows || []).length || 1));
      rect(M, y + 1, 3, 11, C.accent);
      text(sec.heading, M + 9, y + 2, F.bold, 10.5, C.navy);
      y += 18;
      if (sec.note) { for (const l of wrap(sec.note, F.reg, 8.5, CW)) { text(l, M, y, F.reg, 8.5, C.muted); y += 11; } y += 4; }
      header();
      if (!sec.rows || !sec.rows.length) {
        text(sec.empty || 'Nothing in this period.', M + CW / 2, y + 7, F.ital, 8.8, C.muted, 'center');
        y += 24; hline(M, W - M, y);
      }
      (sec.rows || []).forEach((r, i) => {
        if (ensure(17, header)) { /* header redrawn */ }
        if (i % 2 === 1) rect(M, y, CW, 17, C.zebra);
        cols.forEach((c, k) => text(fit(r[k], F.reg, 8.5, c.px - 10), cx(c), y + 5, F.reg, 8.5, C.ink, c.align));
        y += 17;
      });
      if (sec.total) {
        ensure(22, header);
        hline(M, W - M, y, C.navy, 0.9);
        cols.forEach((c, k) => { if (sec.total[k] !== undefined && sec.total[k] !== '') text(fit(sec.total[k], F.bold, 8.8, c.px - 10), cx(c), y + 6, F.bold, 8.8, C.navy, c.align); });
        y += 22;
      }
      y += 16;
    }

    if (opts.footnote) {
      const ls = wrap(opts.footnote, F.ital, 8, CW);
      ensure(ls.length * 10.5 + 6);
      for (const l of ls) { text(l, M, y, F.ital, 8, C.muted); y += 10.5; }
    }

    pages.forEach((p, i) => {
      page = p;
      hline(M, W - M, H - 32);
      text([co.name, opts.title].filter(Boolean).join('   |   '), M, H - 25, F.reg, 7.5, C.muted);
      text(`Page ${i + 1} of ${pages.length}`, W - M, H - 25, F.reg, 7.5, C.muted, 'right');
    });
    return pdf.save();
  }

  global.ReportPDF = { build };
})(window);
