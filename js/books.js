/* Bookkeeping: expenses & supplier bills (payables), payments received,
 * profit & loss, VAT summary, receivables and payables ageing. */
(function () {
  'use strict';
  const A = () => window.App;
  const { money, num, round2, today, addDays, shortDate, longDate, parseISO, toISO, uid, totals } = window.Calc;
  const METHODS = ['Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const esc = (s) => A().esc(s);
  const st = () => A().state;
  const cfg = () => A().settings();
  const cur = () => cfg().defaults.currency || 'AED';
  const sum = (arr, f) => round2(arr.reduce((s, x) => s + num(f(x)), 0));
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

  // ------------------------------------------------------------------
  // Periods
  // ------------------------------------------------------------------
  const PRESETS = [
    ['thisMonth', 'This month'], ['lastMonth', 'Last month'],
    ['thisQuarter', 'This quarter'], ['lastQuarter', 'Last quarter'],
    ['thisYear', 'This year'], ['lastYear', 'Last year'],
    ['all', 'All time'], ['custom', 'Custom dates'],
  ];
  const periods = { summary: 'thisYear', expenses: 'thisMonth', income: 'thisMonth', vat: 'thisQuarter' };
  const customs = {};

  function monthEnd(y, m) { return toISO(new Date(y, m + 1, 0)); }
  function quarterStartFor(date) {
    const s = (Number(cfg().books.vatQuarterStart) || 1) - 1; // 0-based month
    const m = date.getMonth();
    const off = (((m - s) % 3) + 3) % 3;
    return new Date(date.getFullYear(), m - off, 1);
  }
  function rangeFor(key) {
    const preset = periods[key];
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const fmt = (from, to) => `${longDate(from)} to ${longDate(to)}`;
    let from, to, label;
    switch (preset) {
      case 'thisMonth': from = toISO(new Date(y, m, 1)); to = monthEnd(y, m); label = `${MON[m]} ${y}`; break;
      case 'lastMonth': { const d = new Date(y, m - 1, 1); from = toISO(d); to = monthEnd(d.getFullYear(), d.getMonth()); label = `${MON[d.getMonth()]} ${d.getFullYear()}`; break; }
      case 'thisQuarter': case 'lastQuarter': {
        let qs = quarterStartFor(now);
        if (preset === 'lastQuarter') qs = new Date(qs.getFullYear(), qs.getMonth() - 3, 1);
        from = toISO(qs); to = monthEnd(qs.getFullYear(), qs.getMonth() + 2);
        const qe = parseISO(to);
        label = `${MON[qs.getMonth()]} ${qs.getFullYear()} to ${MON[qe.getMonth()]} ${qe.getFullYear()}`; break;
      }
      case 'thisYear': from = `${y}-01-01`; to = `${y}-12-31`; label = `Year ${y}`; break;
      case 'lastYear': from = `${y - 1}-01-01`; to = `${y - 1}-12-31`; label = `Year ${y - 1}`; break;
      case 'custom': {
        const c = customs[key] || (customs[key] = { from: toISO(new Date(y, m, 1)), to: today() });
        from = c.from; to = c.to; label = from && to ? fmt(from, to) : 'Custom dates'; break;
      }
      default: from = ''; to = ''; label = 'All time';
    }
    return { from, to, label };
  }
  const inRange = (iso, r) => !!iso && (!r.from || iso >= r.from) && (!r.to || iso <= r.to);

  function periodPicker(key) {
    const p = periods[key];
    const c = customs[key] || {};
    return `<div class="period" data-period="${key}">
      <select data-pp="preset" aria-label="Period">${PRESETS.map(([v, l]) => `<option value="${v}" ${v === p ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${p === 'custom' ? `<input type="date" data-pp="from" value="${esc(c.from || '')}" aria-label="From"><input type="date" data-pp="to" value="${esc(c.to || '')}" aria-label="To">` : ''}
    </div>`;
  }
  function bindPeriod(key, redraw) {
    const el = document.querySelector(`[data-period="${key}"]`);
    if (!el) return;
    el.addEventListener('change', (e) => {
      const t = e.target.dataset.pp;
      if (t === 'preset') periods[key] = e.target.value;
      else { customs[key] = customs[key] || {}; customs[key][t] = e.target.value; }
      redraw();
    });
  }

  // ------------------------------------------------------------------
  // Invoices & payments received
  // ------------------------------------------------------------------
  const invoices = () => st().docs.filter((d) => d.type === 'invoice');
  const activeInvoices = () => invoices().filter((d) => d.status !== 'Cancelled');
  const paysFor = (invId) => st().payments.filter((p) => p.invoiceId === invId).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  function syncInvoice(inv) {
    if (st().booksMissing) return inv;
    const pays = paysFor(inv.id);
    const paid = sum(pays, (p) => p.amount);
    inv.amountPaid = paid;
    if (inv.status !== 'Cancelled') {
      const T = totals(inv);
      inv.status = paid <= 0.004 ? 'Unpaid' : paid >= T.total - 0.004 ? 'Paid' : 'Partially Paid';
    }
    if (inv.status === 'Paid' && pays.length) inv.paidDate = pays[pays.length - 1].date;
    else delete inv.paidDate;
    return inv;
  }
  function invoiceOverdue(inv) {
    const T = totals(inv);
    return inv.status !== 'Cancelled' && T.balance > 0.004 && inv.dueDate && inv.dueDate < today();
  }
  const invBadge = (inv) => invoiceOverdue(inv) ? `${A().badge(inv.status)} <span class="badge s-overdue">Overdue</span>` : A().badge(inv.status);

  // One-time move from the old single "amount received" field to payment records.
  async function migrate() {
    if (st().booksMissing) return;
    for (const inv of invoices()) {
      const pays = paysFor(inv.id);
      if (!pays.length) {
        let amount = num(inv.amountPaid);
        if (!amount && inv.status === 'Paid') amount = totals(inv).total;
        if (amount > 0) {
          const p = { id: uid(), invoiceId: inv.id, invoiceNumber: inv.number, clientName: inv.client?.name || '', date: inv.paidDate || inv.issueDate || today(), amount: round2(amount), method: 'Other', reference: '', note: 'Recorded before payment history was added', createdAt: new Date().toISOString() };
          await Store.saveRow('payments', p);
          st().payments.push(p);
        }
      }
      const before = JSON.stringify([inv.amountPaid || 0, inv.status, inv.paidDate || '']);
      const copy = syncInvoice({ ...inv });
      if (JSON.stringify([copy.amountPaid || 0, copy.status, copy.paidDate || '']) !== before) await A().saveDoc(copy);
    }
  }

  function invoicePanel(doc) {
    const T = totals(doc);
    const pays = paysFor(doc.id);
    const c = doc.currency || 'AED';
    if (st().booksMissing) {
      return `<div class="side-card"><h3>Payment</h3><div>${A().badge(doc.status)}</div>
        <p class="form-note">To record payments, run <strong>bookkeeping.sql</strong> in Supabase (see the setup guide), then reload.</p></div>`;
    }
    return `<div class="side-card" id="payPanel">
      <div class="pay-head"><h3>Payment</h3><div>${invBadge(doc)}</div></div>
      <dl class="kv" style="margin-top:4px">
        <dt>Received</dt><dd>${money(T.paid)}</dd>
        <dt>Balance due</dt><dd class="total">${c} ${money(T.balance)}</dd>
      </dl>
      ${pays.length ? `<ul class="pay-list">${pays.map((p) => `<li>
          <div><strong class="num">${money(p.amount)}</strong><span>${esc(shortDate(p.date))} · ${esc(p.method)}${p.reference ? ' · ' + esc(p.reference) : ''}</span></div>
          <div class="pay-tools"><button class="btn btn-ghost btn-icon btn-sm" data-pay-edit="${p.id}" aria-label="Edit payment">${A().I.edit}</button><button class="btn btn-ghost btn-icon btn-sm" data-pay-del="${p.id}" aria-label="Delete payment">${A().I.trash}</button></div>
        </li>`).join('')}</ul>` : ''}
      ${doc.status !== 'Cancelled' ? `${T.balance > 0.004 ? `<button class="btn btn-accent" style="width:100%;margin-top:12px" data-pay-add>${A().I.plus}Record payment</button>` : ''}
        <button class="btn btn-ghost btn-sm" style="margin-top:8px" data-inv-cancel>Cancel invoice</button>`
        : `<p class="form-note">This invoice is cancelled and is left out of your reports.</p><button class="btn btn-sm" style="margin-top:8px" data-inv-reinstate>Reinstate invoice</button>`}
    </div>`;
  }

  function bindInvoicePanel(doc, rerender) {
    const panel = document.getElementById('payPanel');
    if (!panel) return;
    panel.addEventListener('click', async (e) => {
      if (e.target.closest('[data-pay-add]')) paymentModal({ invoice: doc, onDone: rerender });
      const ed = e.target.closest('[data-pay-edit]');
      if (ed) paymentModal({ invoice: doc, payment: st().payments.find((p) => p.id === ed.dataset.payEdit), onDone: rerender });
      const del = e.target.closest('[data-pay-del]');
      if (del) {
        const p = st().payments.find((x) => x.id === del.dataset.payDel);
        if (!p || !confirm(`Delete the payment of ${money(p.amount)} received on ${shortDate(p.date)}?`)) return;
        await A().guard(async () => {
          await Store.deleteRow('payments', p.id);
          st().payments = st().payments.filter((x) => x.id !== p.id);
          await A().saveDoc(syncInvoice({ ...doc }));
          rerender();
        }, 'Payment deleted');
      }
      if (e.target.closest('[data-inv-cancel]')) {
        if (!confirm(`Cancel invoice ${doc.number}? It stays on file but is left out of revenue, VAT and receivables.`)) return;
        await A().guard(async () => { await A().saveDoc({ ...doc, status: 'Cancelled' }); rerender(); }, 'Invoice cancelled');
      }
      if (e.target.closest('[data-inv-reinstate]')) {
        await A().guard(async () => { const u = { ...doc, status: 'Unpaid' }; syncInvoice(u); await A().saveDoc(u); rerender(); }, 'Invoice reinstated');
      }
    });
  }

  // ------------------------------------------------------------------
  // Modals
  // ------------------------------------------------------------------
  function openModal(html, { wide } = {}) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `<div class="modal-back" id="mb"><div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    const back = root.querySelector('#mb');
    const close = () => { root.innerHTML = ''; };
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-x]')) close(); });
    const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    return { root: back, close };
  }
  const head = (title) => `<div class="modal-head"><h2>${esc(title)}</h2><button class="btn btn-ghost btn-icon" data-x aria-label="Close">${A().I.x}</button></div>`;

  function paymentModal({ invoice, payment, onDone }) {
    const editing = !!payment;
    const outstanding = activeInvoices().filter((d) => totals(d).balance > 0.004 || (invoice && d.id === invoice.id));
    if (!invoice && !outstanding.length) { A().toast('There are no unpaid invoices to record a payment against.'); return; }
    let inv = invoice || outstanding[0];
    const balanceOf = (d) => round2(totals(d).balance + (editing && payment.invoiceId === d.id ? num(payment.amount) : 0));
    const p = payment ? { ...payment } : { id: uid(), date: today(), amount: balanceOf(inv), method: 'Bank transfer', reference: '', note: '' };
    const { root, close } = openModal(`${head(editing ? 'Edit payment' : 'Record payment')}
      <div class="modal-body"><div class="grid g2">
        ${invoice ? `<div class="field span2"><span>Invoice</span><div class="static">${esc(inv.number)} · ${esc(inv.client?.name || '')} · balance ${esc(inv.currency || 'AED')} <strong data-bal>${money(balanceOf(inv))}</strong></div></div>`
          : `<label class="field span2"><span>Invoice</span><select name="invoice">${outstanding.map((d) => `<option value="${d.id}">${esc(d.number)} · ${esc(d.client?.name || 'No client')} · balance ${money(totals(d).balance)}</option>`).join('')}</select></label>`}
        <label class="field"><span>Date received</span><input type="date" name="date" value="${esc(p.date)}"></label>
        <label class="field"><span>Amount</span><input type="number" inputmode="decimal" step="any" min="0" name="amount" value="${esc(p.amount)}"></label>
        <label class="field"><span>Method</span><select name="method">${METHODS.map((m) => `<option ${m === p.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="field"><span>Reference <em>cheque or transfer no.</em></span><input name="reference" value="${esc(p.reference)}"></label>
        <label class="field span2"><span>Note <em>optional</em></span><input name="note" value="${esc(p.note)}"></label>
      </div></div>
      <div class="modal-foot"><div class="right"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-save>${editing ? 'Save payment' : 'Record payment'}</button></div></div>`);
    const sel = root.querySelector('[name="invoice"]');
    if (sel) sel.addEventListener('change', () => { inv = outstanding.find((d) => d.id === sel.value); root.querySelector('[name="amount"]').value = balanceOf(inv); });
    root.querySelector('[data-save]').addEventListener('click', async () => {
      const f = (n) => root.querySelector(`[name="${n}"]`).value;
      const amount = round2(num(f('amount')));
      if (!f('date')) { A().toast('Add the date the payment was received.', true); return; }
      if (amount <= 0) { A().toast('Enter an amount greater than zero.', true); return; }
      const bal = balanceOf(inv);
      if (amount > bal + 0.004 && !confirm(`${money(amount)} is more than the balance due (${money(bal)}). Record it anyway?`)) return;
      Object.assign(p, { invoiceId: inv.id, invoiceNumber: inv.number, clientName: inv.client?.name || '', date: f('date'), amount, method: f('method'), reference: f('reference').trim(), note: f('note').trim(), updatedAt: new Date().toISOString() });
      if (!p.createdAt) p.createdAt = p.updatedAt;
      const ok = await A().guard(async () => {
        await Store.saveRow('payments', p);
        const i = st().payments.findIndex((x) => x.id === p.id);
        if (i >= 0) st().payments[i] = p; else st().payments.push(p);
        const fresh = A().docById(inv.id) || inv;
        await A().saveDoc(syncInvoice({ ...fresh }));
        return true;
      });
      if (!ok) return;
      close();
      A().toast(editing ? 'Payment saved' : `Payment of ${money(amount)} recorded`);
      onDone && onDone();
    });
  }

  // ------------------------------------------------------------------
  // Expenses & supplier bills
  // ------------------------------------------------------------------
  const expPaid = (e) => sum(e.payments || [], (p) => p.amount);
  const expBalance = (e) => round2(num(e.total) - expPaid(e));
  function expStatus(e) {
    const paid = expPaid(e);
    return paid <= 0.004 ? 'Unpaid' : paid >= num(e.total) - 0.004 ? 'Paid' : 'Partially Paid';
  }
  const expOverdue = (e) => e.status !== 'Paid' && e.dueDate && e.dueDate < today();
  const expBadge = (e) => expOverdue(e) ? `<span class="badge s-overdue">Overdue</span>` : A().badge(e.status || 'Paid');
  function vatFor(total, mode, custom) {
    const rate = num(cfg().defaults.vatRate) || 5;
    if (mode === 'none') return 0;
    if (mode === 'custom') return round2(Math.min(num(custom), num(total)));
    return round2(num(total) * rate / (100 + rate));
  }

  async function prepareReceipt(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      if (file.size > 10 * 1024 * 1024) throw new Error('That PDF is larger than 10 MB. Use a smaller file or a photo.');
      return { blob: file, mime: 'application/pdf', preview: null };
    }
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error('Use a photo (JPG or PNG) or a PDF for the receipt.');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('This browser could not read that photo. Try a JPG or PNG.')); im.src = url; });
      const s = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
      return { blob, mime: 'image/jpeg', preview: c.toDataURL('image/jpeg', 0.6) };
    } finally { URL.revokeObjectURL(url); }
  }

  async function viewReceipt(ref) {
    let url = await A().guard(() => Store.receiptUrl(ref));
    if (!url) return;
    if (url.startsWith('data:')) { const b = await (await fetch(url)).blob(); url = URL.createObjectURL(b); }
    const ov = document.createElement('div');
    ov.className = 'modal-back viewer';
    ov.innerHTML = `<div class="modal modal-wide" role="dialog" aria-modal="true">${head('Receipt')}
      <div class="modal-body">${ref.mime === 'application/pdf'
        ? `<p>This receipt is a PDF.</p><a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">Open PDF</a>`
        : `<img src="${url}" alt="Receipt" style="width:100%;border-radius:6px;border:1px solid var(--line)">`}
        <p class="form-note"><a href="${url}" target="_blank" rel="noopener" download>Download receipt</a></p></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) ov.remove(); });
  }

  function suppliers() {
    const m = new Map();
    for (const e of st().expenses.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))) if (e.supplier) m.set(e.supplier.trim(), e.supplierTrn || '');
    return m;
  }

  function expenseModal(existing, onDone, opts = {}) {
    const e = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: uid(), date: today(), supplier: '', supplierTrn: '', category: cfg().books.categories[0] || 'Other', description: '',
      total: '', vatMode: 'incl', vat: 0, payMode: opts.bill ? 'bill' : 'paid', paidMethod: 'Card', paidDate: today(),
      dueDate: addDays(today(), cfg().books.billDueDays || 30), billNo: '', notes: '', receipt: null, payments: [],
    };
    const isNew = !existing;
    let pending = null, removeReceipt = false;
    const cats = cfg().books.categories.slice();
    if (e.category && !cats.includes(e.category)) cats.push(e.category);
    const sup = suppliers();
    const hasBillPays = e.payMode === 'bill' && (e.payments || []).length > 0;

    const { root, close } = openModal(`${head(isNew ? (e.payMode === 'bill' ? 'Add supplier bill' : 'Add expense') : (e.payMode === 'bill' ? 'Supplier bill' : 'Edit expense'))}
      <div class="modal-body"><div class="grid g2">
        <label class="field"><span>Date</span><input type="date" name="date" value="${esc(e.date)}"></label>
        <label class="field"><span>Supplier</span><input name="supplier" list="supList" value="${esc(e.supplier)}" autocomplete="off" placeholder="e.g. Sharaf DG">
          <datalist id="supList">${[...sup.keys()].map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label class="field"><span>Category</span><select name="category">${cats.map((c) => `<option ${c === e.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span>Supplier TRN <em>needed to claim VAT</em></span><input name="supplierTrn" value="${esc(e.supplierTrn)}" inputmode="numeric"></label>
        <label class="field span2"><span>Description</span><input name="description" value="${esc(e.description)}" placeholder="e.g. 2 × Ubiquiti access points"></label>
        <label class="field"><span>Total amount (${esc(cur())})</span><input type="number" inputmode="decimal" step="any" min="0" name="total" value="${esc(e.total)}"></label>
        <label class="field"><span>VAT</span><select name="vatMode">
          <option value="incl" ${e.vatMode === 'incl' ? 'selected' : ''}>${num(cfg().defaults.vatRate) || 5}% VAT included</option>
          <option value="none" ${e.vatMode === 'none' ? 'selected' : ''}>No VAT</option>
          <option value="custom" ${e.vatMode === 'custom' ? 'selected' : ''}>Enter VAT amount</option></select></label>
        <label class="field"><span>VAT amount</span><input type="number" inputmode="decimal" step="any" min="0" name="vat" value="${esc(e.vat)}"></label>
        <div class="field"><span>Amount before VAT</span><div class="static num" data-net>0.00</div></div>
        <label class="field"><span>Payment</span><select name="payMode" ${hasBillPays ? 'disabled' : ''}>
          <option value="paid" ${e.payMode === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="bill" ${e.payMode === 'bill' ? 'selected' : ''}>Not paid yet (supplier bill)</option></select></label>
        <div data-paid-fields class="grid g2 span2-inner">
          <label class="field"><span>Paid on</span><input type="date" name="paidDate" value="${esc(e.paidDate || e.date)}"></label>
          <label class="field"><span>Paid by</span><select name="paidMethod">${METHODS.map((m) => `<option ${m === e.paidMethod ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        </div>
        <div data-bill-fields class="grid g2 span2-inner">
          <label class="field"><span>Due date</span><input type="date" name="dueDate" value="${esc(e.dueDate || '')}"></label>
          <div class="field"><span>Status</span><div class="static">${isNew ? A().badge('Unpaid') : expBadge(e)} ${!isNew && e.payMode === 'bill' ? `<span class="muted small">balance ${money(expBalance(e))}</span>` : ''}</div></div>
        </div>
        <label class="field"><span>Bill / receipt no.</span><input name="billNo" value="${esc(e.billNo)}"></label>
        <label class="field"><span>Notes <em>optional</em></span><input name="notes" value="${esc(e.notes)}"></label>
        <div class="field span2"><span>Receipt or bill</span>
          <div class="receipt-box" data-receipt></div>
        </div>
        ${!isNew && e.payMode === 'bill' ? `<div class="field span2"><span>Payments made</span>
          ${(e.payments || []).length ? `<ul class="pay-list">${e.payments.map((p) => `<li><div><strong class="num">${money(p.amount)}</strong><span>${esc(shortDate(p.date))} · ${esc(p.method)}${p.reference ? ' · ' + esc(p.reference) : ''}</span></div>
            <div class="pay-tools"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-bp-del="${p.id}" aria-label="Delete payment">${A().I.trash}</button></div></li>`).join('')}</ul>` : '<p class="form-note" style="margin:0">No payments yet.</p>'}
          ${expBalance(e) > 0.004 ? `<button type="button" class="btn" style="margin-top:8px;align-self:flex-start" data-bp-add>${A().I.plus}Record payment to supplier</button>` : ''}
        </div>` : ''}
      </div></div>
      <div class="modal-foot">
        ${!isNew ? `<button class="btn btn-danger" data-del>${A().I.trash}Delete</button>` : ''}
        <div class="right"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-save>${isNew ? 'Save' : 'Save changes'}</button></div>
      </div>`, { wide: true });

    const q = (n) => root.querySelector(`[name="${n}"]`);
    function refresh() {
      const total = num(q('total').value);
      const mode = q('vatMode').value;
      const vatEl = q('vat');
      vatEl.readOnly = mode !== 'custom';
      if (mode !== 'custom') vatEl.value = vatFor(total, mode).toFixed(2);
      const vat = vatFor(total, mode, vatEl.value);
      root.querySelector('[data-net]').textContent = money(total - vat);
      const bill = q('payMode').value === 'bill';
      root.querySelector('[data-paid-fields]').hidden = bill;
      root.querySelector('[data-bill-fields]').hidden = !bill;
    }
    function drawReceipt() {
      const box = root.querySelector('[data-receipt]');
      const hasOld = e.receipt && !removeReceipt;
      box.innerHTML = `
        ${pending ? `<span class="receipt-chip">${pending.preview ? `<img src="${pending.preview}" alt="">` : A().I.receipt}<span>New ${pending.mime === 'application/pdf' ? 'PDF' : 'photo'} ready to save</span></span>`
          : hasOld ? `<button type="button" class="receipt-chip" data-view>${A().I.receipt}<span>View receipt</span></button>` : '<span class="muted small">No receipt attached</span>'}
        <label class="btn btn-sm">${pending || hasOld ? 'Replace' : 'Add photo or PDF'}<input type="file" accept="image/*,application/pdf" data-file hidden></label>
        ${pending || hasOld ? `<button type="button" class="btn btn-ghost btn-sm" data-rm>Remove</button>` : ''}`;
    }
    refresh(); drawReceipt();

    root.addEventListener('input', (ev) => {
      if (['total', 'vatMode', 'vat', 'payMode'].includes(ev.target.name)) refresh();
      if (ev.target.name === 'supplier') { const t = sup.get(ev.target.value.trim()); if (t && !q('supplierTrn').value) q('supplierTrn').value = t; }
      if (ev.target.name === 'date' && isNew) { q('paidDate').value = ev.target.value; q('dueDate').value = addDays(ev.target.value, cfg().books.billDueDays || 30); }
    });
    root.addEventListener('change', async (ev) => {
      if (ev.target.name === 'vatMode' || ev.target.name === 'payMode') refresh();
      if (ev.target.matches('[data-file]')) {
        const file = ev.target.files[0]; if (!file) return;
        const r = await A().guard(() => prepareReceipt(file));
        if (r) { pending = r; removeReceipt = false; drawReceipt(); }
      }
    });
    root.addEventListener('click', async (ev) => {
      if (ev.target.closest('[data-view]')) viewReceipt(e.receipt);
      if (ev.target.closest('[data-rm]')) { if (pending) pending = null; else removeReceipt = true; drawReceipt(); }
      if (ev.target.closest('[data-bp-add]')) { close(); billPaymentModal(existing, onDone); }
      const bd = ev.target.closest('[data-bp-del]');
      if (bd) {
        if (!confirm('Delete this payment to the supplier?')) return;
        const u = JSON.parse(JSON.stringify(existing));
        u.payments = (u.payments || []).filter((p) => p.id !== bd.dataset.bpDel);
        u.status = expStatus(u);
        const ok = await A().guard(async () => { await saveExpense(u); return true; });
        if (ok) { close(); A().toast('Payment deleted'); onDone && onDone(); expenseModal(u, onDone); }
      }
      if (ev.target.closest('[data-del]')) {
        if (!confirm(`Delete this ${e.payMode === 'bill' ? 'bill' : 'expense'}${e.supplier ? ' from ' + e.supplier : ''}? This cannot be undone.`)) return;
        const ok = await A().guard(async () => {
          await Store.deleteRow('expenses', e.id);
          if (e.receipt) { try { await Store.deleteReceipt(e.receipt); } catch (x) { console.warn(x); } }
          st().expenses = st().expenses.filter((x) => x.id !== e.id);
          return true;
        });
        if (ok) { close(); A().toast('Deleted'); onDone && onDone(); }
      }
      if (ev.target.closest('[data-save]')) {
        const v = (n) => q(n).value;
        const total = round2(num(v('total')));
        if (!v('date')) { A().toast('Add the date of the expense.', true); return; }
        if (total <= 0) { A().toast('Enter the total amount.', true); return; }
        if (!v('supplier').trim() && !v('description').trim()) { A().toast('Add a supplier or a description.', true); return; }
        const vat = vatFor(total, v('vatMode'), v('vat'));
        Object.assign(e, {
          date: v('date'), supplier: v('supplier').trim(), supplierTrn: v('supplierTrn').trim(), category: v('category'), description: v('description').trim(),
          total, vatMode: v('vatMode'), vat, net: round2(total - vat), billNo: v('billNo').trim(), notes: v('notes').trim(),
          payMode: hasBillPays ? 'bill' : v('payMode'), updatedAt: new Date().toISOString(),
        });
        if (!e.createdAt) e.createdAt = e.updatedAt;
        if (e.payMode === 'paid') {
          e.paidDate = v('paidDate') || e.date; e.paidMethod = v('paidMethod'); e.dueDate = '';
          e.payments = [{ id: (e.payments && e.payments[0] && e.payments[0].id) || uid(), date: e.paidDate, amount: total, method: e.paidMethod, reference: '' }];
        } else {
          e.dueDate = v('dueDate') || '';
          e.payments = e.payments || [];
        }
        e.status = expStatus(e);
        const btn = ev.target.closest('[data-save]'); btn.disabled = true;
        const ok = await A().guard(async () => {
          const old = existing && existing.receipt;
          if (pending) {
            e.receipt = await Store.uploadReceipt(e.id, pending.blob, pending.mime);
            if (old) { try { await Store.deleteReceipt(old); } catch (x) { console.warn(x); } }
          } else if (removeReceipt && old) {
            try { await Store.deleteReceipt(old); } catch (x) { console.warn(x); }
            e.receipt = null;
          }
          await saveExpense(e);
          return true;
        });
        btn.disabled = false;
        if (!ok) return;
        close();
        A().toast(isNew ? (e.payMode === 'bill' ? 'Bill saved' : 'Expense saved') : 'Changes saved');
        onDone && onDone();
      }
    });
  }

  async function saveExpense(e) {
    await Store.saveRow('expenses', e);
    const i = st().expenses.findIndex((x) => x.id === e.id);
    if (i >= 0) st().expenses[i] = e; else st().expenses.push(e);
  }

  function billPaymentModal(exp, onDone) {
    const bal = expBalance(exp);
    const { root, close } = openModal(`${head('Pay supplier bill')}
      <div class="modal-body"><div class="grid g2">
        <div class="field span2"><span>Bill</span><div class="static">${esc(exp.supplier || exp.description)}${exp.billNo ? ' · ' + esc(exp.billNo) : ''} · balance ${esc(cur())} <strong>${money(bal)}</strong></div></div>
        <label class="field"><span>Date paid</span><input type="date" name="date" value="${today()}"></label>
        <label class="field"><span>Amount</span><input type="number" inputmode="decimal" step="any" min="0" name="amount" value="${bal}"></label>
        <label class="field"><span>Paid by</span><select name="method">${METHODS.map((m) => `<option>${m}</option>`).join('')}</select></label>
        <label class="field"><span>Reference <em>optional</em></span><input name="reference"></label>
      </div></div>
      <div class="modal-foot"><div class="right"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-save>Record payment</button></div></div>`);
    root.querySelector('[data-save]').addEventListener('click', async () => {
      const f = (n) => root.querySelector(`[name="${n}"]`).value;
      const amount = round2(num(f('amount')));
      if (!f('date') || amount <= 0) { A().toast('Enter the date and an amount greater than zero.', true); return; }
      if (amount > bal + 0.004 && !confirm(`${money(amount)} is more than the balance (${money(bal)}). Record it anyway?`)) return;
      const u = JSON.parse(JSON.stringify(exp));
      u.payments = (u.payments || []).concat([{ id: uid(), date: f('date'), amount, method: f('method'), reference: f('reference').trim() }]);
      u.status = expStatus(u);
      const ok = await A().guard(async () => { await saveExpense(u); return true; });
      if (!ok) return;
      close(); A().toast(u.status === 'Paid' ? 'Bill paid in full' : `Payment of ${money(amount)} recorded`);
      onDone && onDone();
    });
  }

  // ------------------------------------------------------------------
  // Downloads
  // ------------------------------------------------------------------
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }
  function downloadCSV(name, header, rows) {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    downloadBlob(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), name);
  }
  async function downloadReport(opts, name) {
    opts.generated = `Prepared ${longDate(today())}`;
    const bytes = await window.ReportPDF.build(opts, cfg(), await A().getLogo());
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name);
  }
  const fileStamp = (r) => (r.from && r.to ? `${r.from}_to_${r.to}` : today());
  const m2 = (n) => money(n);

  // ------------------------------------------------------------------
  // Figures
  // ------------------------------------------------------------------
  function figuresFor(r) {
    const inv = activeInvoices().filter((d) => inRange(d.issueDate, r));
    const exps = st().expenses.filter((e) => inRange(e.date, r));
    const revenue = sum(inv, (d) => totals(d).taxable);
    const outVat = sum(inv, (d) => totals(d).vat);
    const expNet = sum(exps, (e) => e.net ?? (num(e.total) - num(e.vat)));
    const inVat = sum(exps, (e) => e.vat);
    const cashIn = sum(st().payments.filter((p) => inRange(p.date, r)), (p) => p.amount);
    const cashOut = round2(st().expenses.reduce((s, e) => s + sum((e.payments || []).filter((p) => inRange(p.date, r)), (p) => p.amount), 0));
    return { inv, exps, revenue, outVat, expNet, inVat, profit: round2(revenue - expNet), vatDue: round2(outVat - inVat), cashIn, cashOut };
  }
  const receivablesList = () => activeInvoices().filter((d) => totals(d).balance > 0.004);
  const payablesList = () => st().expenses.filter((e) => expBalance(e) > 0.004);

  function monthsIn(r) {
    let from = r.from, to = r.to || today();
    if (!from) {
      const dates = [...st().docs.filter((d) => d.type === 'invoice').map((d) => d.issueDate), ...st().expenses.map((e) => e.date)].filter(Boolean).sort();
      from = dates[0] || today();
    }
    const out = [];
    let d = parseISO(from); d = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = parseISO(to);
    while (d <= end && out.length < 60) { out.push([d.getFullYear(), d.getMonth()]); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
    return out.slice(-24);
  }

  // ------------------------------------------------------------------
  // Shell
  // ------------------------------------------------------------------
  const TABS = [
    ['summary', 'Summary'], ['expenses', 'Expenses'], ['payables', 'Payables'],
    ['income', 'Money in'], ['receivables', 'Receivables'], ['vat', 'VAT'],
  ];
  function shell(tab, title, actions, body) {
    A().renderShell('books');
    A().setView(`
      ${A().modeBanner()}
      <div class="page-head">
        <div><h1>${esc(title)}</h1></div>
        <div class="actions">${actions || ''}</div>
      </div>
      <nav class="subtabs" aria-label="Bookkeeping sections">${TABS.map(([k, l]) => `<a href="#/books${k === 'summary' ? '' : '/' + k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
      ${st().booksMissing ? `<div class="banner"><div><strong>Bookkeeping needs a one-time database update.</strong>
        Open Supabase → SQL Editor, run <strong>bookkeeping.sql</strong> from the supabase folder in your repository, then reload this page.</div></div>` : body}`);
  }
  const fig = (label, value, hint, cls) => `<div class="figure ${cls || ''}"><div class="label">${label}</div><div class="value"><small>${esc(cur())}</small>${money(value)}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const btnIcon = (icon, label, attr, cls) => `<button class="btn ${cls || ''}" ${attr}>${icon}${label}</button>`;

  function route(parts) {
    const tab = parts[0] || 'summary';
    ({ summary: viewSummary, expenses: viewExpenses, payables: viewPayables, income: viewIncome, receivables: viewReceivables, vat: viewVat }[tab] || viewSummary)();
  }

  // ------------------------------------------------------------------
  // Summary (profit & loss)
  // ------------------------------------------------------------------
  function viewSummary() {
    const r = rangeFor('summary');
    const F = figuresFor(r);
    const recv = receivablesList(), pay = payablesList();
    const months = monthsIn(r).map(([y, m]) => {
      const mr = { from: toISO(new Date(y, m, 1)), to: monthEnd(y, m) };
      const mf = figuresFor(mr);
      return { label: `${MON[m]} ${y}`, revenue: mf.revenue, exp: mf.expNet, profit: mf.profit };
    });
    const byCat = {};
    for (const e of F.exps) { const c = e.category || 'Other'; byCat[c] = byCat[c] || { net: 0, vat: 0, total: 0 }; byCat[c].net += num(e.net ?? (e.total - e.vat)); byCat[c].vat += num(e.vat); byCat[c].total += num(e.total); }
    const cats = Object.entries(byCat).sort((a, b) => b[1].net - a[1].net);
    const maxCat = Math.max(1, ...cats.map(([, v]) => v.net));
    const maxMonth = Math.max(1, ...months.map((m) => Math.max(m.revenue, m.exp)));

    shell('summary', 'Bookkeeping', `
      ${btnIcon(A().I.plus, 'Add expense', 'data-add-exp', 'btn-primary')}
      ${btnIcon(A().I.download, 'P&L PDF', 'data-pdf')}
      ${btnIcon(A().I.download, 'CSV', 'data-csv')}`, `
      <div class="toolbar">${periodPicker('summary')}<span class="muted small">${esc(r.label)}</span></div>
      <div class="figures">
        ${fig('Revenue', F.revenue, `${F.inv.length} invoice${F.inv.length === 1 ? '' : 's'}, before VAT`)}
        ${fig('Expenses', F.expNet, `${F.exps.length} record${F.exps.length === 1 ? '' : 's'}, before VAT`)}
        ${fig('Net profit', F.profit, F.revenue ? `${Math.round((F.profit / F.revenue) * 100)}% margin` : '&nbsp;', F.profit < 0 ? 'neg' : '')}
        ${fig(F.vatDue >= 0 ? 'VAT payable' : 'VAT refundable', Math.abs(F.vatDue), `${money(F.outVat)} charged − ${money(F.inVat)} paid`)}
      </div>
      <div class="dash-grid">
        <section class="panel">
          <div class="panel-head"><h2>Month by month</h2><span class="legend"><i class="sw-rev"></i>Revenue <i class="sw-exp"></i>Expenses</span></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Month</th><th class="r">Revenue</th><th class="r">Expenses</th><th class="r">Profit</th><th class="hide-m" style="width:30%"></th></tr></thead>
            <tbody>${months.map((m) => `<tr><td>${m.label}</td><td class="r">${m2(m.revenue)}</td><td class="r">${m2(m.exp)}</td><td class="r ${m.profit < 0 ? 'neg' : ''}">${m2(m.profit)}</td>
              <td class="hide-m"><div class="bars">${m.revenue > 0 ? `<span class="bar rev" style="width:${(m.revenue / maxMonth) * 100}%"></span>` : ''}${m.exp > 0 ? `<span class="bar exp" style="width:${(m.exp / maxMonth) * 100}%"></span>` : ''}</div></td></tr>`).join('')}</tbody>
            <tfoot><tr><td>Total</td><td class="r">${m2(F.revenue)}</td><td class="r">${m2(F.expNet)}</td><td class="r">${m2(F.profit)}</td><td class="hide-m"></td></tr></tfoot>
          </table></div>
        </section>
        <div>
          <section class="panel">
            <div class="panel-head"><h2>Cash in this period</h2></div>
            <div class="side-card"><dl class="kv">
              <dt>Received from clients</dt><dd>${m2(F.cashIn)}</dd>
              <dt>Paid out</dt><dd>${m2(F.cashOut)}</dd>
              <dt>Net cash</dt><dd class="total ${F.cashIn - F.cashOut < 0 ? 'neg' : ''}">${esc(cur())} ${m2(F.cashIn - F.cashOut)}</dd>
            </dl><p class="form-note">Amounts include VAT.</p></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Right now</h2></div>
            <div class="side-card"><dl class="kv">
              <dt><a href="#/books/receivables">Clients owe you</a></dt><dd class="total">${m2(sum(recv, (d) => totals(d).balance))}</dd>
              <dt><a href="#/books/payables">You owe suppliers</a></dt><dd class="total">${m2(sum(pay, expBalance))}</dd>
            </dl></div>
          </section>
        </div>
      </div>
      <section class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>Expenses by category</h2></div>
        ${cats.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Category</th><th class="r">Before VAT</th><th class="r hide-m">VAT</th><th class="r">Total</th><th class="hide-m" style="width:30%"></th></tr></thead>
          <tbody>${cats.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="r">${m2(v.net)}</td><td class="r hide-m">${m2(v.vat)}</td><td class="r">${m2(v.total)}</td><td class="hide-m"><div class="bars"><span class="bar exp" style="width:${(v.net / maxCat) * 100}%"></span></div></td></tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty small" style="padding:28px">No expenses in this period. <button class="btn btn-sm" data-add-exp style="margin-left:8px">${A().I.plus}Add expense</button></div>`}
      </section>
      <p class="form-note">Revenue is counted by invoice date and excludes cancelled invoices. Expenses are counted by expense date.</p>`);

    bindPeriod('summary', viewSummary);
    const v = document.getElementById('view');
    v.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-exp]')) expenseModal(null, viewSummary);
      if (e.target.closest('[data-csv]')) downloadCSV(`profit-and-loss_${fileStamp(r)}.csv`, ['Month', 'Revenue (before VAT)', 'Expenses (before VAT)', 'Profit'], [...months.map((m) => [m.label, m.revenue.toFixed(2), m.exp.toFixed(2), m.profit.toFixed(2)]), ['Total', F.revenue.toFixed(2), F.expNet.toFixed(2), F.profit.toFixed(2)]]);
      if (e.target.closest('[data-pdf]')) A().guard(() => downloadReport({
        title: 'Profit & Loss', period: r.label,
        summary: [['Revenue (before VAT)', m2(F.revenue)], ['Expenses (before VAT)', '- ' + m2(F.expNet)], ['Net profit (' + cur() + ')', m2(F.profit), true]],
        sections: [
          { heading: 'Month by month', columns: [{ label: 'Month', w: 2 }, { label: 'Revenue', align: 'right', w: 1.4 }, { label: 'Expenses', align: 'right', w: 1.4 }, { label: 'Profit', align: 'right', w: 1.4 }], rows: months.map((m) => [m.label, m2(m.revenue), m2(m.exp), m2(m.profit)]), total: ['Total', m2(F.revenue), m2(F.expNet), m2(F.profit)] },
          { heading: 'Expenses by category', columns: [{ label: 'Category', w: 2.4 }, { label: 'Before VAT', align: 'right', w: 1.2 }, { label: 'VAT', align: 'right', w: 1 }, { label: 'Total', align: 'right', w: 1.2 }], rows: cats.map(([c, x]) => [c, m2(x.net), m2(x.vat), m2(x.total)]), total: ['Total', m2(F.expNet), m2(F.inVat), m2(sum(F.exps, (x) => x.total))], empty: 'No expenses in this period.' },
          { heading: 'Cash movement', columns: [{ label: 'Item', w: 3 }, { label: `Amount (${cur()})`, align: 'right', w: 1.4 }], rows: [['Received from clients (incl. VAT)', m2(F.cashIn)], ['Paid to suppliers (incl. VAT)', m2(F.cashOut)]], total: ['Net cash', m2(F.cashIn - F.cashOut)] },
        ],
        footnote: 'Revenue is counted by invoice date and excludes cancelled invoices. Expenses are counted by expense date. Figures are prepared from the records in this app and should be reviewed by your accountant.',
      }, `profit-and-loss_${fileStamp(r)}.pdf`));
    });
  }

  // ------------------------------------------------------------------
  // Expenses list
  // ------------------------------------------------------------------
  const filt = { q: '', cat: '', status: '' };
  function viewExpenses() {
    const r = rangeFor('expenses');
    const cats = [...new Set([...cfg().books.categories, ...st().expenses.map((e) => e.category).filter(Boolean)])];
    shell('expenses', 'Expenses', `
      ${btnIcon(A().I.plus, 'Add expense', 'data-add-exp', 'btn-primary')}
      ${btnIcon(A().I.plus, 'Add bill', 'data-add-bill')}
      ${btnIcon(A().I.download, 'PDF', 'data-pdf')}
      ${btnIcon(A().I.download, 'CSV', 'data-csv')}`, `
      <div class="toolbar">
        ${periodPicker('expenses')}
        <label class="search">${A().I.search}<input type="search" id="eq" placeholder="Search supplier or description" value="${esc(filt.q)}" aria-label="Search expenses"></label>
        <select id="ecat" aria-label="Category" class="sel-auto"><option value="">All categories</option>${cats.map((c) => `<option ${c === filt.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="est" aria-label="Status" class="sel-auto"><option value="">Paid and unpaid</option><option value="Paid" ${filt.status === 'Paid' ? 'selected' : ''}>Paid</option><option value="open" ${filt.status === 'open' ? 'selected' : ''}>Unpaid bills</option></select>
      </div>
      <section class="panel" id="expList"></section>`);
    let rows = [];
    const draw = () => {
      const n = filt.q.trim().toLowerCase();
      rows = st().expenses.filter((e) => inRange(e.date, r) && (!filt.cat || e.category === filt.cat)
        && (!filt.status || (filt.status === 'Paid' ? e.status === 'Paid' : e.status !== 'Paid'))
        && (!n || [e.supplier, e.description, e.billNo, e.notes].some((x) => String(x || '').toLowerCase().includes(n))))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const T = { net: sum(rows, (e) => e.net), vat: sum(rows, (e) => e.vat), total: sum(rows, (e) => e.total) };
      document.getElementById('expList').innerHTML = rows.length ? `
        <ul class="row-list">
          <li class="lrow lhead"><span class="c-date">Date</span><span class="c-main">Supplier</span><span class="c-cat">Category</span><span class="c-st">Status</span><span class="c-amt">Total</span></li>
          ${rows.map((e) => `<li><button class="lrow" data-exp="${e.id}">
            <span class="c-date">${esc(shortDate(e.date))}</span>
            <span class="c-main"><strong>${esc(e.supplier || e.description || 'Expense')}${e.receipt ? ` <i class="clip" title="Receipt attached">${A().I.receipt}</i>` : ''}</strong><span>${esc(e.supplier ? e.description : '')}</span></span>
            <span class="c-cat">${esc(e.category || '')}</span>
            <span class="c-st">${expBadge(e)}</span>
            <span class="c-amt">${m2(e.total)}<small>VAT ${m2(e.vat)}</small></span>
          </button></li>`).join('')}
        </ul>
        <div class="list-foot"><span>${rows.length} record${rows.length === 1 ? '' : 's'}</span><span>Before VAT <strong>${m2(T.net)}</strong></span><span>VAT <strong>${m2(T.vat)}</strong></span><span>Total <strong>${esc(cur())} ${m2(T.total)}</strong></span></div>`
        : `<div class="empty"><h2>No expenses here</h2><p>Record what you spend, with a photo of the receipt, so your profit and VAT figures are complete.</p><button class="btn btn-primary" data-add-exp>${A().I.plus}Add expense</button></div>`;
    };
    draw();
    bindPeriod('expenses', viewExpenses);
    document.getElementById('eq').addEventListener('input', (e) => { filt.q = e.target.value; draw(); });
    document.getElementById('ecat').addEventListener('change', (e) => { filt.cat = e.target.value; draw(); });
    document.getElementById('est').addEventListener('change', (e) => { filt.status = e.target.value; draw(); });
    document.getElementById('view').addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-exp]');
      if (row) expenseModal(st().expenses.find((x) => x.id === row.dataset.exp), viewExpenses);
      if (ev.target.closest('[data-add-exp]')) expenseModal(null, viewExpenses);
      if (ev.target.closest('[data-add-bill]')) expenseModal(null, viewExpenses, { bill: true });
      if (ev.target.closest('[data-csv]')) downloadCSV(`expenses_${fileStamp(r)}.csv`,
        ['Date', 'Supplier', 'Supplier TRN', 'Category', 'Description', 'Bill no.', 'Before VAT', 'VAT', 'Total', 'Status', 'Paid', 'Due date', 'Receipt'],
        rows.map((e) => [e.date, e.supplier, e.supplierTrn, e.category, e.description, e.billNo, num(e.net).toFixed(2), num(e.vat).toFixed(2), num(e.total).toFixed(2), e.status, expPaid(e).toFixed(2), e.dueDate || '', e.receipt ? 'Yes' : 'No']));
      if (ev.target.closest('[data-pdf]')) A().guard(() => downloadReport({
        title: 'Expenses', period: r.label + (filt.cat ? ` · ${filt.cat}` : ''),
        summary: [['Before VAT', m2(sum(rows, (e) => e.net))], ['VAT', m2(sum(rows, (e) => e.vat))], [`Total (${cur()})`, m2(sum(rows, (e) => e.total)), true]],
        sections: [{ heading: `${rows.length} record${rows.length === 1 ? '' : 's'}`, columns: [{ label: 'Date', w: 1.1 }, { label: 'Supplier', w: 2 }, { label: 'Category', w: 1.7 }, { label: 'Before VAT', align: 'right', w: 1.1 }, { label: 'VAT', align: 'right', w: 0.9 }, { label: 'Total', align: 'right', w: 1.1 }],
          rows: rows.map((e) => [shortDate(e.date), e.supplier || e.description, e.category, m2(e.net), m2(e.vat), m2(e.total)]), total: ['Total', '', '', m2(sum(rows, (e) => e.net)), m2(sum(rows, (e) => e.vat)), m2(sum(rows, (e) => e.total))] }],
      }, `expenses_${fileStamp(r)}.pdf`));
    });
  }

  // ------------------------------------------------------------------
  // Ageing helpers (receivables & payables)
  // ------------------------------------------------------------------
  const BUCKETS = [['current', 'Not yet due'], ['b30', '1–30 days overdue'], ['b60', '31–60 days'], ['b90', '61–90 days'], ['b90p', 'Over 90 days']];
  function bucketOf(due) {
    if (!due || due >= today()) return 'current';
    const d = daysBetween(due, today());
    return d <= 30 ? 'b30' : d <= 60 ? 'b60' : d <= 90 ? 'b90' : 'b90p';
  }
  function ageingFigures(items, dueOf, balOf) {
    const b = Object.fromEntries(BUCKETS.map(([k]) => [k, 0]));
    for (const it of items) b[bucketOf(dueOf(it))] += balOf(it);
    return `<div class="figures figures-5">${BUCKETS.map(([k, l]) => `<div class="figure ${k !== 'current' && b[k] > 0 ? 'warn' : ''}"><div class="label">${l}</div><div class="value"><small>${esc(cur())}</small>${money(b[k])}</div></div>`).join('')}</div>`;
  }
  const overdueText = (due) => { if (!due) return 'No due date'; if (due >= today()) { const d = daysBetween(today(), due); return d === 0 ? 'Due today' : `Due in ${d} day${d === 1 ? '' : 's'}`; } const d = daysBetween(due, today()); return `${d} day${d === 1 ? '' : 's'} overdue`; };

  // ------------------------------------------------------------------
  // Receivables
  // ------------------------------------------------------------------
  function viewReceivables() {
    const items = receivablesList().sort((a, b) => (a.dueDate || a.issueDate || '').localeCompare(b.dueDate || b.issueDate || ''));
    const total = sum(items, (d) => totals(d).balance);
    const byClient = {};
    for (const d of items) { const c = d.client?.name || 'No client'; byClient[c] = (byClient[c] || 0) + totals(d).balance; }
    shell('receivables', 'Receivables', `
      ${btnIcon(A().I.plus, 'Record payment', 'data-pay', 'btn-primary')}
      ${btnIcon(A().I.download, 'PDF', 'data-pdf')}
      ${btnIcon(A().I.download, 'CSV', 'data-csv')}`, `
      <p class="sub muted" style="margin:-6px 0 14px">Money your clients owe you: <strong class="num">${esc(cur())} ${m2(total)}</strong> across ${items.length} invoice${items.length === 1 ? '' : 's'}.</p>
      ${ageingFigures(items, (d) => d.dueDate, (d) => totals(d).balance)}
      <div class="stack-grid">
        <section class="panel">${items.length ? `<ul class="row-list">
          <li class="lrow lhead"><span class="c-date">Due</span><span class="c-main">Client</span><span class="c-cat">Invoice</span><span class="c-st">Status</span><span class="c-amt">Balance</span></li>
          ${items.map((d) => `<li><a class="lrow" href="#/doc/${d.id}">
            <span class="c-date">${esc(shortDate(d.dueDate || d.issueDate))}</span>
            <span class="c-main"><strong>${esc(d.client?.name || 'No client')}</strong><span>${esc(overdueText(d.dueDate))}</span></span>
            <span class="c-cat">${esc(d.number)}</span>
            <span class="c-st">${invBadge(d)}</span>
            <span class="c-amt">${m2(totals(d).balance)}<small>of ${m2(totals(d).total)}</small></span></a></li>`).join('')}
        </ul>` : '<div class="empty"><h2>Nothing outstanding</h2><p>All your invoices are paid.</p></div>'}</section>
        <section class="panel"><div class="panel-head"><h2>By client</h2></div>
          <div class="side-card"><dl class="kv">${Object.entries(byClient).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<dt>${esc(c)}</dt><dd>${m2(v)}</dd>`).join('') || '<dt class="muted">None</dt><dd></dd>'}</dl></div>
        </section>
      </div>`);
    document.getElementById('view').addEventListener('click', (ev) => {
      if (ev.target.closest('[data-pay]')) paymentModal({ onDone: viewReceivables });
      const rows = items.map((d) => [d.number, d.client?.name || '', d.issueDate, d.dueDate || '', overdueText(d.dueDate), totals(d).total, totals(d).paid, totals(d).balance]);
      if (ev.target.closest('[data-csv]')) downloadCSV(`receivables_${today()}.csv`, ['Invoice', 'Client', 'Issue date', 'Due date', 'Status', 'Total', 'Received', 'Balance'], rows.map((r) => r.map((x) => typeof x === 'number' ? x.toFixed(2) : x)));
      if (ev.target.closest('[data-pdf]')) A().guard(() => downloadReport({
        title: 'Receivables', period: `As at ${longDate(today())}`,
        summary: [...BUCKETS.map(([k, l]) => [l, m2(sum(items.filter((d) => bucketOf(d.dueDate) === k), (d) => totals(d).balance))]), [`Total owed to you (${cur()})`, m2(total), true]],
        sections: [{ heading: 'Unpaid invoices', columns: [{ label: 'Invoice', w: 1.6 }, { label: 'Client', w: 1.8 }, { label: 'Due', w: 1.1 }, { label: 'Status', w: 1.4 }, { label: 'Total', align: 'right', w: 1 }, { label: 'Balance', align: 'right', w: 1 }],
          rows: items.map((d) => [d.number, d.client?.name || '', shortDate(d.dueDate || d.issueDate), overdueText(d.dueDate), m2(totals(d).total), m2(totals(d).balance)]), total: ['Total', '', '', '', '', m2(total)], empty: 'No unpaid invoices.' }],
      }, `receivables_${today()}.pdf`));
    });
  }

  // ------------------------------------------------------------------
  // Payables
  // ------------------------------------------------------------------
  function viewPayables() {
    const items = payablesList().sort((a, b) => (a.dueDate || a.date || '').localeCompare(b.dueDate || b.date || ''));
    const total = sum(items, expBalance);
    const bySup = {};
    for (const e of items) { const s = e.supplier || 'No supplier'; bySup[s] = (bySup[s] || 0) + expBalance(e); }
    shell('payables', 'Payables', `
      ${btnIcon(A().I.plus, 'Add bill', 'data-add-bill', 'btn-primary')}
      ${btnIcon(A().I.download, 'PDF', 'data-pdf')}
      ${btnIcon(A().I.download, 'CSV', 'data-csv')}`, `
      <p class="sub muted" style="margin:-6px 0 14px">Money you owe suppliers: <strong class="num">${esc(cur())} ${m2(total)}</strong> across ${items.length} bill${items.length === 1 ? '' : 's'}.</p>
      ${ageingFigures(items, (e) => e.dueDate, expBalance)}
      <div class="stack-grid">
        <section class="panel">${items.length ? `<ul class="row-list">
          <li class="lrow lhead"><span class="c-date">Due</span><span class="c-main">Supplier</span><span class="c-cat">Bill no.</span><span class="c-st">Status</span><span class="c-amt">Balance</span></li>
          ${items.map((e) => `<li><div class="lrow lrow-act" data-exp="${e.id}" role="button" tabindex="0">
            <span class="c-date">${esc(shortDate(e.dueDate || e.date))}</span>
            <span class="c-main"><strong>${esc(e.supplier || e.description || 'Bill')}</strong><span>${esc(overdueText(e.dueDate))}</span></span>
            <span class="c-cat">${esc(e.billNo || e.category || '')}</span>
            <span class="c-st">${expBadge(e)} <button class="btn btn-sm" data-paybill="${e.id}">Pay</button></span>
            <span class="c-amt">${m2(expBalance(e))}<small>of ${m2(e.total)}</small></span></div></li>`).join('')}
        </ul>` : `<div class="empty"><h2>No unpaid bills</h2><p>When a supplier gives you a bill to pay later, add it here to track what you owe and when it is due.</p><button class="btn btn-primary" data-add-bill>${A().I.plus}Add bill</button></div>`}</section>
        <section class="panel"><div class="panel-head"><h2>By supplier</h2></div>
          <div class="side-card"><dl class="kv">${Object.entries(bySup).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<dt>${esc(c)}</dt><dd>${m2(v)}</dd>`).join('') || '<dt class="muted">None</dt><dd></dd>'}</dl></div>
        </section>
      </div>`);
    const v = document.getElementById('view');
    v.addEventListener('click', (ev) => {
      const pb = ev.target.closest('[data-paybill]');
      if (pb) { billPaymentModal(st().expenses.find((x) => x.id === pb.dataset.paybill), viewPayables); return; }
      const row = ev.target.closest('[data-exp]');
      if (row) expenseModal(st().expenses.find((x) => x.id === row.dataset.exp), viewPayables);
      if (ev.target.closest('[data-add-bill]')) expenseModal(null, viewPayables, { bill: true });
      if (ev.target.closest('[data-csv]')) downloadCSV(`payables_${today()}.csv`, ['Supplier', 'Bill no.', 'Bill date', 'Due date', 'Status', 'Total', 'Paid', 'Balance'],
        items.map((e) => [e.supplier, e.billNo, e.date, e.dueDate || '', overdueText(e.dueDate), num(e.total).toFixed(2), expPaid(e).toFixed(2), expBalance(e).toFixed(2)]));
      if (ev.target.closest('[data-pdf]')) A().guard(() => downloadReport({
        title: 'Payables', period: `As at ${longDate(today())}`,
        summary: [...BUCKETS.map(([k, l]) => [l, m2(sum(items.filter((e) => bucketOf(e.dueDate) === k), expBalance))]), [`Total you owe (${cur()})`, m2(total), true]],
        sections: [{ heading: 'Unpaid supplier bills', columns: [{ label: 'Supplier', w: 2 }, { label: 'Bill no.', w: 1.2 }, { label: 'Due', w: 1.1 }, { label: 'Status', w: 1.4 }, { label: 'Total', align: 'right', w: 1 }, { label: 'Balance', align: 'right', w: 1 }],
          rows: items.map((e) => [e.supplier || e.description, e.billNo || '', shortDate(e.dueDate || e.date), overdueText(e.dueDate), m2(e.total), m2(expBalance(e))]), total: ['Total', '', '', '', '', m2(total)], empty: 'No unpaid bills.' }],
      }, `payables_${today()}.pdf`));
    });
    v.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('[data-exp]')) ev.target.click(); });
  }

  // ------------------------------------------------------------------
  // Money in (payments received)
  // ------------------------------------------------------------------
  function viewIncome() {
    const r = rangeFor('income');
    const rows = st().payments.filter((p) => inRange(p.date, r)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const total = sum(rows, (p) => p.amount);
    const byMethod = {};
    for (const p of rows) byMethod[p.method || 'Other'] = (byMethod[p.method || 'Other'] || 0) + num(p.amount);
    shell('income', 'Money in', `
      ${btnIcon(A().I.plus, 'Record payment', 'data-pay', 'btn-primary')}
      ${btnIcon(A().I.download, 'PDF', 'data-pdf')}
      ${btnIcon(A().I.download, 'CSV', 'data-csv')}`, `
      <div class="toolbar">${periodPicker('income')}<span class="muted small">${esc(r.label)}</span></div>
      <div class="stack-grid">
        <section class="panel">${rows.length ? `<ul class="row-list">
          <li class="lrow lhead"><span class="c-date">Date</span><span class="c-main">Client</span><span class="c-cat">Invoice</span><span class="c-st">Method</span><span class="c-amt">Amount</span></li>
          ${rows.map((p) => { const inv = A().docById(p.invoiceId); return `<li><a class="lrow" href="${inv ? '#/doc/' + inv.id : '#/books/income'}">
            <span class="c-date">${esc(shortDate(p.date))}</span>
            <span class="c-main"><strong>${esc((inv && inv.client?.name) || p.clientName || '')}</strong><span>${esc(p.reference || p.note || '')}</span></span>
            <span class="c-cat">${esc((inv && inv.number) || p.invoiceNumber || '')}</span>
            <span class="c-st"><span class="muted small">${esc(p.method)}</span></span>
            <span class="c-amt">${m2(p.amount)}</span></a></li>`; }).join('')}
        </ul><div class="list-foot"><span>${rows.length} payment${rows.length === 1 ? '' : 's'}</span><span>Total <strong>${esc(cur())} ${m2(total)}</strong></span></div>`
        : `<div class="empty"><h2>No payments in this period</h2><p>Record payments from an invoice page, or with the button above.</p></div>`}</section>
        <section class="panel"><div class="panel-head"><h2>By method</h2></div>
          <div class="side-card"><dl class="kv">${Object.entries(byMethod).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${m2(v)}</dd>`).join('')}<dt>Total</dt><dd class="total">${m2(total)}</dd></dl></div></section>
      </div>`);
    bindPeriod('income', viewIncome);
    document.getElementById('view').addEventListener('click', (ev) => {
      if (ev.target.closest('[data-pay]')) paymentModal({ onDone: viewIncome });
      if (ev.target.closest('[data-csv]')) downloadCSV(`payments-received_${fileStamp(r)}.csv`, ['Date', 'Invoice', 'Client', 'Method', 'Reference', 'Note', 'Amount'],
        rows.map((p) => [p.date, p.invoiceNumber, p.clientName, p.method, p.reference, p.note, num(p.amount).toFixed(2)]));
      if (ev.target.closest('[data-pdf]')) A().guard(() => downloadReport({
        title: 'Payments Received', period: r.label,
        summary: [...Object.entries(byMethod).map(([k, v]) => [k, m2(v)]), [`Total received (${cur()})`, m2(total), true]],
        sections: [{ heading: `${rows.length} payment${rows.length === 1 ? '' : 's'}`, columns: [{ label: 'Date', w: 1.1 }, { label: 'Invoice', w: 1.6 }, { label: 'Client', w: 1.8 }, { label: 'Method', w: 1.2 }, { label: 'Amount', align: 'right', w: 1.1 }],
          rows: rows.map((p) => [shortDate(p.date), p.invoiceNumber, p.clientName, p.method, m2(p.amount)]), total: ['Total', '', '', '', m2(total)] }],
      }, `payments-received_${fileStamp(r)}.pdf`));
    });
  }

  // ------------------------------------------------------------------
  // VAT summary
  // ------------------------------------------------------------------
  function viewVat() {
    const r = rangeFor('vat');
    const F = figuresFor(r);
    const sales = F.inv.slice().sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || ''));
    const purchases = F.exps.filter((e) => num(e.vat) > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const noVat = F.exps.filter((e) => !(num(e.vat) > 0));
    const noTrn = purchases.filter((e) => !e.supplierTrn);
    const salesNet = sum(sales, (d) => totals(d).taxable);
    const purNet = sum(purchases, (e) => e.net);
    shell('vat', 'VAT summary', `
      ${btnIcon(A().I.download, 'VAT report PDF', 'data-pdf', 'btn-primary')}
      ${btnIcon(A().I.download, 'CSV', 'data-csv')}`, `
      <div class="toolbar">${periodPicker('vat')}<span class="muted small">${esc(r.label)}</span></div>
      <div class="figures">
        ${fig('VAT on sales', F.outVat, `on ${money(salesNet)} of sales`)}
        ${fig('VAT on expenses', F.inVat, `on ${money(purNet)} of purchases`)}
        ${fig(F.vatDue >= 0 ? 'Net VAT payable' : 'Net VAT refundable', Math.abs(F.vatDue), 'sales VAT − expense VAT', F.vatDue >= 0 ? 'strong' : '')}
        ${fig('Expenses without VAT', sum(noVat, (e) => e.total), `${noVat.length} record${noVat.length === 1 ? '' : 's'}`)}
      </div>
      ${noTrn.length ? `<div class="banner"><div><strong>${noTrn.length} expense${noTrn.length === 1 ? '' : 's'} with VAT ${noTrn.length === 1 ? 'has' : 'have'} no supplier TRN.</strong> You normally need a valid tax invoice showing the supplier's TRN to claim that VAT back. Add the TRN to ${noTrn.length === 1 ? 'it' : 'them'} from the list below.</div></div>` : ''}
      <section class="panel">
        <div class="panel-head"><h2>Sales (VAT charged)</h2><span class="muted small">${sales.length} invoice${sales.length === 1 ? '' : 's'}</span></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Date</th><th>Invoice</th><th class="hide-m">Client</th><th class="r">Before VAT</th><th class="r">VAT</th></tr></thead>
          <tbody>${sales.map((d) => `<tr data-href="#/doc/${d.id}"><td>${esc(shortDate(d.issueDate))}</td><td>${esc(d.number)}</td><td class="hide-m">${esc(d.client?.name || '')}</td><td class="r">${m2(totals(d).taxable)}</td><td class="r">${m2(totals(d).vat)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No invoices in this period.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="hide-m"></td><td class="r">${m2(salesNet)}</td><td class="r">${m2(F.outVat)}</td></tr></tfoot>
        </table></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Expenses (VAT paid)</h2><span class="muted small">${purchases.length} record${purchases.length === 1 ? '' : 's'}</span></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Date</th><th>Supplier</th><th class="hide-m">Supplier TRN</th><th class="r">Before VAT</th><th class="r">VAT</th></tr></thead>
          <tbody>${purchases.map((e) => `<tr data-exp="${e.id}"><td>${esc(shortDate(e.date))}</td><td>${esc(e.supplier || e.description)}</td><td class="hide-m">${e.supplierTrn ? esc(e.supplierTrn) : '<span class="badge s-overdue">Missing</span>'}</td><td class="r">${m2(e.net)}</td><td class="r">${m2(e.vat)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No expenses with VAT in this period.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="hide-m"></td><td class="r">${m2(purNet)}</td><td class="r">${m2(F.inVat)}</td></tr></tfoot>
        </table></div>
      </section>
      <p class="form-note">Sales are counted by invoice date and exclude cancelled invoices. Use these figures as a guide for your VAT return and check them with your accountant before filing. VAT periods follow the quarter setting in Settings → Bookkeeping.</p>`);
    bindPeriod('vat', viewVat);
    document.getElementById('view').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-href]');
      if (tr) location.hash = tr.dataset.href;
      const er = ev.target.closest('tr[data-exp]');
      if (er) expenseModal(st().expenses.find((x) => x.id === er.dataset.exp), viewVat);
      if (ev.target.closest('[data-csv]')) downloadCSV(`vat-summary_${fileStamp(r)}.csv`, ['Type', 'Date', 'Number / supplier', 'Client / supplier TRN', 'Before VAT', 'VAT'], [
        ...sales.map((d) => ['Sale', d.issueDate, d.number, d.client?.name || '', totals(d).taxable.toFixed(2), totals(d).vat.toFixed(2)]),
        ...purchases.map((e) => ['Expense', e.date, e.supplier || e.description, e.supplierTrn || '', num(e.net).toFixed(2), num(e.vat).toFixed(2)]),
        ['Total VAT on sales', '', '', '', salesNet.toFixed(2), F.outVat.toFixed(2)],
        ['Total VAT on expenses', '', '', '', purNet.toFixed(2), F.inVat.toFixed(2)],
        ['Net VAT payable (negative = refundable)', '', '', '', '', F.vatDue.toFixed(2)],
      ]);
      if (ev.target.closest('[data-pdf]')) A().guard(() => downloadReport({
        title: 'VAT Summary', period: r.label,
        summary: [['Sales before VAT', m2(salesNet)], ['VAT on sales', m2(F.outVat)], ['Expenses before VAT (with VAT)', m2(purNet)], ['VAT on expenses', m2(F.inVat)], [F.vatDue >= 0 ? `Net VAT payable (${cur()})` : `Net VAT refundable (${cur()})`, m2(Math.abs(F.vatDue)), true]],
        sections: [
          { heading: 'Sales (VAT charged)', columns: [{ label: 'Date', w: 1.1 }, { label: 'Invoice', w: 1.7 }, { label: 'Client', w: 2 }, { label: 'Before VAT', align: 'right', w: 1.1 }, { label: 'VAT', align: 'right', w: 1 }],
            rows: sales.map((d) => [shortDate(d.issueDate), d.number, d.client?.name || '', m2(totals(d).taxable), m2(totals(d).vat)]), total: ['Total', '', '', m2(salesNet), m2(F.outVat)], empty: 'No invoices in this period.' },
          { heading: 'Expenses (VAT paid)', columns: [{ label: 'Date', w: 1.1 }, { label: 'Supplier', w: 2 }, { label: 'Supplier TRN', w: 1.7 }, { label: 'Before VAT', align: 'right', w: 1.1 }, { label: 'VAT', align: 'right', w: 1 }],
            rows: purchases.map((e) => [shortDate(e.date), e.supplier || e.description, e.supplierTrn || 'MISSING', m2(e.net), m2(e.vat)]), total: ['Total', '', '', m2(purNet), m2(F.inVat)], empty: 'No expenses with VAT in this period.' },
        ],
        footnote: 'Sales are counted by invoice date and exclude cancelled invoices. These figures are prepared from the records in this app as a guide for the VAT return; review them with your accountant before filing.',
      }, `vat-summary_${fileStamp(r)}.pdf`));
    });
  }

  window.Books = { route, invoicePanel, bindInvoicePanel, syncInvoice, migrate, expenseModal, paymentModal };
})();
