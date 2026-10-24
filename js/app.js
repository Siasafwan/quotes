/* Quotes & Invoices — application */
(function () {
  'use strict';
  const { money, totals, lineAmount, today, addDays, shortDate, longDate, nextNumber, amountInWords, uid, num, round2 } = window.Calc;

  // ------------------------------------------------------------------
  // Defaults (taken from the ECTECHZ quotation template)
  // ------------------------------------------------------------------
  const DEFAULT_SETTINGS = {
    company: { name: 'ECTECHZ IT Solutions', address: '', phone: '', email: '', website: '', trn: '' },
    logo: null, // null = bundled assets/logo.png, 'none' = no logo, or a data URL
    bank: { bankName: '', accountName: '', accountNo: '', iban: '', swift: '' },
    numbering: { quotePrefix: 'ECT-QTN', invoicePrefix: 'ECT-INV', quoteStart: 810, invoiceStart: 1, includeYear: true, pad: 4 },
    defaults: {
      preparedBy: 'SAFWAN',
      currency: 'AED',
      vatRate: 5,
      validDays: 15,
      dueDays: 7,
      paymentTerms: '50% advance / 50% on completion',
      quoteIntro: 'Based on the site survey and requirements discussed, {company} is pleased to submit the following quotation for your review.',
      invoiceIntro: 'Please find below the invoice for the services delivered as per our approved quotation.',
      scope: '',
      quoteTerms: 'Quotation validity: {validDays} days.\nAny additional hardware, replacement parts, or extra work will be charged separately.\nPayment terms: {paymentTerms}.',
      invoiceTerms: 'Payment is due by the due date shown on this invoice.\nPlease quote the invoice number when making payment.\nAll bank charges are to be borne by the payer.',
      showBankOnQuote: false,
    },
    books: {
      vatQuarterStart: 1, // 1 = quarters start Jan/Apr/Jul/Oct, 2 = Feb/May/Aug/Nov, 3 = Mar/Jun/Sep/Dec
      billDueDays: 30,
      categories: ['Hardware & equipment', 'Materials & cabling', 'Software & subscriptions', 'Subcontractors', 'Fuel & transport', 'Vehicle costs', 'Rent', 'Utilities & telecom', 'Salaries & wages', 'Marketing', 'Bank charges', 'Government fees & licences', 'Office supplies', 'Professional fees', 'Other'],
    },
  };

  const QUOTE_STATUSES = ['Draft', 'Sent', 'Approved', 'Rejected'];
  const INVOICE_STATUSES = ['Unpaid', 'Partially Paid', 'Paid', 'Cancelled'];

  const state = { settings: null, clients: [], docs: [], payments: [], expenses: [], booksMissing: false, ready: false };
  let dirty = false;
  let ignoreHash = false;
  let lastHash = location.hash;

  // ------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const slug = (s) => String(s || '').toLowerCase().replace(/\s+/g, '-');
  const typeName = (t, plural) => t === 'quote' ? (plural ? 'Quotations' : 'Quotation') : (plural ? 'Invoices' : 'Invoice');

  function deepMerge(base, extra) {
    const out = clone(base);
    if (!extra || typeof extra !== 'object') return out;
    for (const k of Object.keys(extra)) {
      if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && out[k] && typeof out[k] === 'object') out[k] = deepMerge(out[k], extra[k]);
      else out[k] = extra[k];
    }
    return out;
  }

  function fill(template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast' + (isError ? ' error' : ''); }, isError ? 5000 : 2600);
  }

  async function guard(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { console.error(e); toast(e.message || 'Something went wrong.', true); return undefined; }
  }

  const I = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
    invoice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
    clients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3 2.6 3.5 5.2"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    convert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13m0 0-4-4m4 4-4 4"/><path d="M20 5v14"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    books: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/><path d="M9 8h6M9 11.5h4"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1 12.6 20a5 5 0 0 1-7.1-7.1l8.9-8.9a3.3 3.3 0 0 1 4.7 4.7l-8.9 8.9a1.7 1.7 0 0 1-2.4-2.4l8.2-8.2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  };

  // ------------------------------------------------------------------
  // Data helpers
  // ------------------------------------------------------------------
  const S = () => state.settings;
  const docById = (id) => state.docs.find((d) => d.id === id);
  const sortDocs = (arr) => arr.slice().sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || (b.number || '').localeCompare(a.number || ''));

  function templateVars(extra) {
    const s = S();
    return { company: s.company.name || 'our company', validDays: s.defaults.validDays, paymentTerms: s.defaults.paymentTerms, ...extra };
  }

  function newDoc(type) {
    const s = S();
    const d = s.defaults;
    const issueDate = today();
    const vars = templateVars();
    return {
      id: uid(),
      type,
      number: nextNumber(type, state.docs, s.numbering, issueDate),
      status: type === 'quote' ? 'Draft' : 'Unpaid',
      issueDate,
      validDays: d.validDays,
      dueDate: type === 'invoice' ? addDays(issueDate, d.dueDays) : '',
      clientId: null,
      client: { name: '', company: '', address: '', phone: '', email: '', trn: '' },
      project: '',
      subject: '',
      intro: fill(type === 'quote' ? d.quoteIntro : d.invoiceIntro, vars),
      preparedBy: d.preparedBy,
      paymentTerms: d.paymentTerms,
      duration: '',
      currency: d.currency || 'AED',
      poNumber: '',
      items: [{ id: uid(), title: '', description: '', qty: 1, unit: '', price: 0 }],
      vatRate: d.vatRate,
      discount: 0,
      amountPaid: 0,
      scope: d.scope,
      terms: fill(type === 'quote' ? d.quoteTerms : d.invoiceTerms, vars),
      notes: '',
      showBank: type === 'invoice' ? true : !!d.showBankOnQuote,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async function saveDoc(doc) {
    doc.updatedAt = new Date().toISOString();
    await Store.saveDoc(doc);
    const i = state.docs.findIndex((d) => d.id === doc.id);
    if (i >= 0) state.docs[i] = doc; else state.docs.push(doc);
  }

  async function upsertClientFromDoc(doc) {
    const c = doc.client || {};
    if (!c.name || !c.name.trim()) return;
    let rec = doc.clientId && state.clients.find((x) => x.id === doc.clientId);
    if (!rec) rec = state.clients.find((x) => (x.name || '').trim().toLowerCase() === c.name.trim().toLowerCase());
    const data = { name: c.name.trim(), company: c.company || '', address: c.address || '', phone: c.phone || '', email: c.email || '', trn: c.trn || '' };
    if (rec) {
      const changed = Object.keys(data).some((k) => (rec[k] || '') !== data[k]);
      doc.clientId = rec.id;
      if (!changed) return;
      Object.assign(rec, data);
      await Store.saveClient(rec);
    } else {
      rec = { id: uid(), ...data, createdAt: new Date().toISOString() };
      await Store.saveClient(rec);
      state.clients.push(rec);
      doc.clientId = rec.id;
    }
  }

  // Logo bytes for PDF
  let logoCache = { key: null, value: null };
  async function getLogo() {
    const s = S();
    const key = s.logo || 'default';
    if (logoCache.key === key) return logoCache.value;
    let value = null;
    try {
      if (s.logo === 'none') value = null;
      else if (s.logo && s.logo.startsWith('data:')) {
        const [head, b64] = s.logo.split(',');
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        value = { bytes, type: /png/.test(head) ? 'png' : 'jpg' };
      } else {
        const res = await fetch('assets/logo.png');
        if (res.ok) value = { bytes: new Uint8Array(await res.arrayBuffer()), type: 'png' };
      }
    } catch (e) { console.warn('Logo load failed', e); }
    logoCache = { key, value };
    return value;
  }
  const logoSrc = () => { const s = S(); return s.logo === 'none' ? '' : (s.logo || 'assets/logo.png'); };

  async function makePdf(doc) {
    return window.PDFGen.build(doc, S(), await getLogo());
  }
  function pdfName(doc) {
    const who = (doc.client && (doc.client.company || doc.client.name)) || '';
    return `${doc.number}${who ? '_' + who : ''}`.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_') + '.pdf';
  }
  async function downloadPdf(doc) {
    const bytes = await makePdf(doc);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = pdfName(doc);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function sharePdf(doc) {
    const bytes = await makePdf(doc);
    const file = new File([bytes], pdfName(doc), { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `${typeName(doc.type)} ${doc.number}` }); }
      catch (e) { if (e.name !== 'AbortError') throw e; }
    } else {
      await downloadPdf(doc);
      toast('Sharing is not supported in this browser, so the PDF was downloaded instead.');
    }
  }

  // ------------------------------------------------------------------
  // Shell / navigation
  // ------------------------------------------------------------------
  const NAV = [
    { href: '#/', key: 'home', label: 'Overview', icon: I.home },
    { href: '#/quotes', key: 'quotes', label: 'Quotations', icon: I.quote },
    { href: '#/invoices', key: 'invoices', label: 'Invoices', icon: I.invoice },
    { href: '#/books', key: 'books', label: 'Bookkeeping', short: 'Books', icon: I.books },
    { href: '#/clients', key: 'clients', label: 'Clients', icon: I.clients },
    { href: '#/settings', key: 'settings', label: 'Settings', icon: I.settings },
  ];
  function renderShell(active) {
    $('#nav').innerHTML = NAV.map((n) => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${n.icon}<span>${n.label}</span></a>`).join('') +
      `<a href="#/new/quote" class="nav-new">${I.plus}<span>New quotation</span></a>`;
    $('#tabbar').innerHTML = NAV.map((n) => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${n.icon}<span>${n.short || (n.key === 'home' ? 'Home' : n.key === 'quotes' ? 'Quotes' : n.label)}</span></a>`).join('');
    const name = S().company.name || 'Quotes & Invoices';
    $('#brandName').textContent = name;
    $('#topTitle').textContent = name;
    $('#brandMode').textContent = Store.mode === 'cloud' ? 'Synced to cloud' : 'Saved on this device';
  }

  function setView(html) {
    // Replace the node so listeners from the previous screen are dropped.
    const old = $('#view');
    const v = old.cloneNode(false);
    old.replaceWith(v);
    v.innerHTML = html;
    window.scrollTo(0, 0);
  }

  function modeBanner() {
    if (Store.mode === 'cloud') return '';
    return `<div class="banner"><div><strong>Records are saved in this browser only.</strong>
      Connect Supabase (step 3 of the setup guide) to sync between your phone and laptop. Until then, use Settings → Download backup regularly.</div></div>`;
  }

  // ------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------
  function route() {
    const h = location.hash.replace(/^#/, '').split('?')[0] || '/';
    const parts = h.split('/').filter(Boolean);
    lastHash = location.hash;
    document.body.classList.remove('login-mode');
    if (!parts.length) return viewDashboard();
    switch (parts[0]) {
      case 'quotes': return viewList('quote');
      case 'invoices': return viewList('invoice');
      case 'clients': return viewClients();
      case 'books': return window.Books.route(parts.slice(1));
      case 'settings': return viewSettings();
      case 'new': return viewEditor(null, parts[1] === 'invoice' ? 'invoice' : 'quote', parts[2]);
      case 'edit': return viewEditor(parts[1]);
      case 'doc': return viewDoc(parts[1]);
      default: return viewDashboard();
    }
  }
  window.addEventListener('hashchange', () => {
    if (ignoreHash) { ignoreHash = false; return; }
    if (dirty && !confirm('You have unsaved changes. Leave without saving?')) {
      ignoreHash = true;
      location.hash = lastHash;
      return;
    }
    dirty = false;
    if (state.ready) route();
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------------
  // Badges / rows
  // ------------------------------------------------------------------
  const badge = (status) => `<span class="badge s-${slug(status)}">${esc(status)}</span>`;

  function docRow(d) {
    const T = totals(d);
    const c = d.client || {};
    const sub = d.project || d.subject || c.company || '';
    return `<li><a class="doc-row" href="#/doc/${d.id}">
      <span class="no">${esc(d.number)}</span>
      <span class="who"><strong>${esc(c.name || 'No client')}</strong><span>${esc(sub)}</span></span>
      <span class="date">${esc(shortDate(d.issueDate))}</span>
      <span class="st">${badge(d.status)}</span>
      <span class="amt">${esc(d.currency || 'AED')} ${money(T.total)}</span>
    </a></li>`;
  }

  // ------------------------------------------------------------------
  // Dashboard
  // ------------------------------------------------------------------
  function viewDashboard() {
    renderShell('home');
    const quotes = state.docs.filter((d) => d.type === 'quote');
    const invoices = state.docs.filter((d) => d.type === 'invoice');
    const sum = (arr, f) => arr.reduce((s, d) => s + (f ? f(d) : totals(d).total), 0);
    const open = quotes.filter((q) => q.status === 'Draft' || q.status === 'Sent');
    const toInvoice = quotes.filter((q) => q.status === 'Approved' && !q.invoiceId);
    const unpaid = invoices.filter((i) => i.status === 'Unpaid' || i.status === 'Partially Paid');
    const month = today().slice(0, 7);
    const paidMonth = state.payments.filter((p) => (p.date || '').startsWith(month));
    const cur = S().defaults.currency || 'AED';

    const fig = (href, label, value, hint) => `<a class="figure" href="${href}"><div class="label">${label}</div><div class="value"><small>${cur}</small>${money(value)}</div><div class="hint">${hint}</div></a>`;

    const recent = sortDocs(state.docs).slice(0, 8);
    setView(`
      ${modeBanner()}
      <div class="page-head">
        <div><h1>Overview</h1><div class="sub">${esc(longDate(today()))}</div></div>
        <div class="actions">
          <a class="btn btn-primary" href="#/new/quote">${I.plus}New quotation</a>
          <a class="btn" href="#/new/invoice">${I.plus}New invoice</a>
        </div>
      </div>
      <div class="figures">
        ${fig('#/quotes?status=open', 'Open quotations', sum(open), `${open.length} draft or sent`)}
        ${fig('#/quotes?status=Approved', 'Approved, not invoiced', sum(toInvoice), `${toInvoice.length} ready to convert`)}
        ${fig('#/invoices?status=open', 'Awaiting payment', sum(unpaid, (d) => totals(d).balance), `${unpaid.length} unpaid invoice${unpaid.length === 1 ? '' : 's'}`)}
        ${fig('#/books/income', 'Received this month', paidMonth.reduce((s, p) => s + num(p.amount), 0), `${paidMonth.length} payment${paidMonth.length === 1 ? '' : 's'}`)}
      </div>
      <div class="dash-grid">
        <section class="panel">
          <div class="panel-head"><h2>Recent documents</h2><a href="#/quotes" class="small">All quotations</a></div>
          ${recent.length ? `<ul class="doc-list">${recent.map(docRow).join('')}</ul>` :
            `<div class="empty"><h2>No documents yet</h2><p>Create your first quotation. When the client approves it, convert it to an invoice in one tap.</p><a class="btn btn-primary" href="#/new/quote">${I.plus}New quotation</a></div>`}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Ready to invoice</h2></div>
          ${toInvoice.length ? `<ul class="doc-list">${toInvoice.slice(0, 6).map((q) => `<li><a class="doc-row" style="grid-template-columns:minmax(0,1fr) auto" href="#/doc/${q.id}">
              <span class="who"><strong>${esc(q.client?.name || 'No client')}</strong><span>${esc(q.number)}</span></span>
              <span class="amt">${money(totals(q).total)}</span></a></li>`).join('')}</ul>` :
            '<div class="empty small" style="padding:28px 20px">Approved quotations that have not been invoiced yet appear here.</div>'}
        </section>
      </div>`);
  }

  // ------------------------------------------------------------------
  // Lists
  // ------------------------------------------------------------------
  function viewList(type) {
    renderShell(type === 'quote' ? 'quotes' : 'invoices');
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    let filter = params.get('status') || 'all';
    let q = '';
    const statuses = type === 'quote' ? QUOTE_STATUSES : INVOICE_STATUSES;
    const all = sortDocs(state.docs.filter((d) => d.type === type));

    setView(`
      ${modeBanner()}
      <div class="page-head">
        <div><h1>${typeName(type, true)}</h1><div class="sub">${all.length} total</div></div>
        <div class="actions"><a class="btn btn-primary" href="#/new/${type}">${I.plus}New ${typeName(type).toLowerCase()}</a></div>
      </div>
      <div class="toolbar">
        <label class="search">${I.search}<input type="search" id="q" placeholder="Search number, client or project" aria-label="Search"></label>
        <div class="chips" id="chips"></div>
      </div>
      <section class="panel" id="listPanel"></section>`);

    const draw = () => {
      const groups = { all: all.length, open: 0 };
      for (const s of statuses) groups[s] = all.filter((d) => d.status === s).length;
      groups.open = all.filter((d) => (type === 'quote' ? ['Draft', 'Sent'] : ['Unpaid', 'Partially Paid']).includes(d.status)).length;
      const chipList = [['all', 'All'], ['open', type === 'quote' ? 'Open' : 'Outstanding'], ...statuses.map((s) => [s, s])];
      $('#chips').innerHTML = chipList.map(([k, l]) => `<button class="chip ${filter === k ? 'active' : ''}" data-f="${esc(k)}">${esc(l)}<span class="count">${groups[k] || 0}</span></button>`).join('');
      const needle = q.trim().toLowerCase();
      const rows = all.filter((d) => {
        if (filter === 'open') { if (!(type === 'quote' ? ['Draft', 'Sent'] : ['Unpaid', 'Partially Paid']).includes(d.status)) return false; }
        else if (filter !== 'all' && d.status !== filter) return false;
        if (!needle) return true;
        return [d.number, d.client?.name, d.client?.company, d.project, d.subject].some((v) => String(v || '').toLowerCase().includes(needle));
      });
      $('#listPanel').innerHTML = rows.length
        ? `<ul class="doc-list"><li><div class="doc-row list-head"><span>Number</span><span>Client</span><span class="date">Date</span><span>Status</span><span class="amt">Total</span></div></li>${rows.map(docRow).join('')}</ul>`
        : (all.length ? '<div class="empty">Nothing matches this filter.</div>'
          : `<div class="empty"><h2>No ${typeName(type, true).toLowerCase()} yet</h2><p>${type === 'quote' ? 'Start with a quotation for your client.' : 'Convert an approved quotation, or create an invoice directly.'}</p><a class="btn btn-primary" href="#/new/${type}">${I.plus}New ${typeName(type).toLowerCase()}</a></div>`);
    };
    draw();
    $('#chips').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } });
    $('#q').addEventListener('input', (e) => { q = e.target.value; draw(); });
  }

  // ------------------------------------------------------------------
  // Document view (preview + actions)
  // ------------------------------------------------------------------
  let previewToken = 0;
  async function renderPreview(doc) {
    const token = ++previewToken;
    const desk = $('#desk');
    if (!desk) return;
    desk.innerHTML = '<div class="loading">Preparing preview…</div>';
    let bytes;
    try { bytes = await makePdf(doc); }
    catch (e) { console.error(e); desk.innerHTML = `<div class="loading">Could not build the PDF: ${esc(e.message)}</div>`; return; }
    try {
      const pdfjs = await import(new URL('lib/pdfjs.min.js', document.baseURI).href);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('lib/pdfjs.worker.min.js', document.baseURI).href;
      const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      if (token !== previewToken) return;
      desk.innerHTML = '';
      const avail = Math.min(desk.clientWidth - (window.innerWidth < 760 ? 20 : 56), 820);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (avail / base.width) * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        const sheet = document.createElement('div');
        sheet.className = 'sheet';
        sheet.appendChild(canvas);
        if (token !== previewToken) return;
        desk.appendChild(sheet);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
      }
    } catch (e) {
      console.warn('pdf.js preview failed, falling back to iframe', e);
      if (token !== previewToken) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      desk.innerHTML = `<iframe title="PDF preview" src="${url}"></iframe>`;
    }
  }

  function viewDoc(id) {
    const doc = docById(id);
    if (!doc) { setView('<div class="empty"><h2>Document not found</h2><p>It may have been deleted.</p><a class="btn" href="#/">Go to overview</a></div>'); renderShell('home'); return; }
    renderShell(doc.type === 'quote' ? 'quotes' : 'invoices');
    const T = totals(doc);
    const statuses = doc.type === 'quote' ? QUOTE_STATUSES : INVOICE_STATUSES;
    const linkedInvoice = doc.invoiceId && docById(doc.invoiceId);
    const linkedQuote = doc.quoteId && docById(doc.quoteId);
    const cur = doc.currency || 'AED';

    setView(`
      <div class="page-head">
        <div>
          <a href="#/${doc.type === 'quote' ? 'quotes' : 'invoices'}" class="btn btn-ghost btn-sm" style="margin-left:-10px">${I.back}${typeName(doc.type, true)}</a>
          <h1 class="num" style="margin-top:6px">${esc(doc.number)}</h1>
          <div class="sub">${esc(doc.client?.name || 'No client')}${doc.project ? ' — ' + esc(doc.project) : ''}</div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" data-act="download">${I.download}Download PDF</button>
          <button class="btn" data-act="share">${I.share}Share</button>
          <a class="btn" href="#/edit/${doc.id}">${I.edit}Edit</a>
        </div>
      </div>
      <div class="doc-layout">
        <div class="desk" id="desk"></div>
        <aside class="panel doc-side">
          ${doc.type === 'quote' ? `<div class="side-card">
            <h3>Status</h3>
            <div class="status-pick" id="statusPick">
              ${statuses.map((s) => `<button data-status="${esc(s)}" class="${s === doc.status ? 'on badge s-' + slug(s) : ''}">${esc(s)}</button>`).join('')}
            </div>
          </div>` : window.Books.invoicePanel(doc)}
          ${doc.type === 'quote' ? `<div class="side-card">
            ${linkedInvoice ? `<div class="link-note">Invoiced as <a href="#/doc/${linkedInvoice.id}">${esc(linkedInvoice.number)}</a></div>`
              : `<button class="btn btn-accent" style="width:100%" data-act="convert">${I.convert}Convert to invoice</button>
                 <p class="form-note">${doc.status === 'Approved' ? 'Creates an invoice with the same client, items, prices and VAT.' : 'Converting will mark this quotation as Approved.'}</p>`}
          </div>` : (linkedQuote ? `<div class="side-card"><div class="link-note">Created from quotation <a href="#/doc/${linkedQuote.id}">${esc(linkedQuote.number)}</a></div></div>` : '')}
          <div class="side-card">
            <h3>Amounts</h3>
            <dl class="kv">
              <dt>Subtotal</dt><dd>${money(T.subtotal)}</dd>
              ${T.discount ? `<dt>Discount</dt><dd>- ${money(T.discount)}</dd>` : ''}
              <dt>VAT (${T.vatRate}%)</dt><dd>${money(T.vat)}</dd>
              <dt>Total</dt><dd class="total">${cur} ${money(T.total)}</dd>
              ${doc.type === 'invoice' && T.paid ? `<dt>Paid</dt><dd>${money(T.paid)}</dd><dt>Balance due</dt><dd class="total">${cur} ${money(T.balance)}</dd>` : ''}
            </dl>
          </div>
          <div class="side-card">
            <h3>Details</h3>
            <dl class="kv">
              <dt>Issued</dt><dd>${esc(shortDate(doc.issueDate))}</dd>
              ${doc.type === 'quote' ? `<dt>Valid until</dt><dd>${esc(shortDate(addDays(doc.issueDate, doc.validDays)))}</dd>` : (doc.dueDate ? `<dt>Due</dt><dd>${esc(shortDate(doc.dueDate))}</dd>` : '')}
              <dt>Items</dt><dd>${(doc.items || []).length}</dd>
            </dl>
          </div>
          <div class="side-card stack">
            <button class="btn" data-act="duplicate">${I.copy}Duplicate</button>
            <button class="btn btn-danger" data-act="delete">${I.trash}Delete</button>
          </div>
        </aside>
      </div>`);

    renderPreview(doc);

    if (doc.type === 'invoice') window.Books.bindInvoicePanel(doc, () => viewDoc(id));
    if (doc.type === 'quote') $('#statusPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b || b.dataset.status === doc.status) return;
      guard(async () => {
        const updated = { ...doc, status: b.dataset.status };
        if (updated.status === 'Paid' && !updated.paidDate) updated.paidDate = today();
        await saveDoc(updated);
        viewDoc(id);
      }, `Marked as ${b.dataset.status}`);
    });

    $('#view').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'download') { btn.disabled = true; await guard(() => downloadPdf(doc)); btn.disabled = false; }
      if (act === 'share') { btn.disabled = true; await guard(() => sharePdf(doc)); btn.disabled = false; }
      if (act === 'convert') convertToInvoice(doc);
      if (act === 'duplicate') duplicateDoc(doc);
      if (act === 'delete') deleteDocFlow(doc);
    }, { once: false });
  }

  async function convertToInvoice(quote) {
    if (quote.invoiceId && docById(quote.invoiceId)) { location.hash = `#/doc/${quote.invoiceId}`; return; }
    if (quote.status !== 'Approved' && !confirm(`Mark ${quote.number} as Approved and create an invoice?`)) return;
    await guard(async () => {
      const s = S();
      const inv = newDoc('invoice');
      Object.assign(inv, {
        clientId: quote.clientId,
        client: clone(quote.client || {}),
        project: quote.project,
        subject: quote.subject,
        preparedBy: quote.preparedBy,
        paymentTerms: quote.paymentTerms,
        duration: quote.duration,
        currency: quote.currency,
        poNumber: quote.poNumber,
        items: clone(quote.items || []).map((it) => ({ ...it, id: uid() })),
        vatRate: quote.vatRate,
        discount: quote.discount,
        scope: quote.scope,
        notes: quote.notes,
        quoteId: quote.id,
        quoteNumber: quote.number,
      });
      inv.terms = fill(s.defaults.invoiceTerms, templateVars({ paymentTerms: quote.paymentTerms }));
      await saveDoc(inv);
      await saveDoc({ ...quote, status: 'Approved', invoiceId: inv.id });
      toast(`Invoice ${inv.number} created`);
      location.hash = `#/doc/${inv.id}`;
    });
  }

  async function duplicateDoc(doc) {
    await guard(async () => {
      const copy = clone(doc);
      copy.id = uid();
      copy.issueDate = today();
      copy.number = nextNumber(doc.type, state.docs, S().numbering, copy.issueDate);
      copy.status = doc.type === 'quote' ? 'Draft' : 'Unpaid';
      if (doc.type === 'invoice') { copy.dueDate = addDays(copy.issueDate, S().defaults.dueDays); copy.amountPaid = 0; delete copy.paidDate; }
      delete copy.invoiceId; delete copy.quoteId; delete copy.quoteNumber;
      copy.items = (copy.items || []).map((it) => ({ ...it, id: uid() }));
      copy.createdAt = new Date().toISOString();
      await saveDoc(copy);
      toast(`Copied as ${copy.number}`);
      location.hash = `#/edit/${copy.id}`;
    });
  }

  async function deleteDocFlow(doc) {
    const pays = state.payments.filter((p) => p.invoiceId === doc.id);
    if (!confirm(`Delete ${typeName(doc.type).toLowerCase()} ${doc.number}?${pays.length ? ` Its ${pays.length} recorded payment${pays.length === 1 ? '' : 's'} will be deleted too.` : ''} This cannot be undone.`)) return;
    await guard(async () => {
      for (const p of pays) await Store.deleteRow('payments', p.id);
      state.payments = state.payments.filter((p) => p.invoiceId !== doc.id);
      await Store.deleteDoc(doc.id);
      state.docs = state.docs.filter((d) => d.id !== doc.id);
      // unlink
      for (const d of state.docs) {
        if (d.invoiceId === doc.id) { const u = { ...d }; delete u.invoiceId; await saveDoc(u); }
        if (d.quoteId === doc.id) { const u = { ...d }; delete u.quoteId; await saveDoc(u); }
      }
      toast(`${doc.number} deleted`);
      location.hash = doc.type === 'quote' ? '#/quotes' : '#/invoices';
    });
  }

  // ------------------------------------------------------------------
  // Editor
  // ------------------------------------------------------------------
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = val;
  }

  function viewEditor(id, type, fromClientId) {
    let draft;
    if (id) {
      const existing = docById(id);
      if (!existing) { location.hash = '#/'; return; }
      draft = clone(existing);
    } else {
      draft = newDoc(type);
      if (fromClientId) {
        const c = state.clients.find((x) => x.id === fromClientId);
        if (c) { draft.clientId = c.id; draft.client = { name: c.name, company: c.company, address: c.address, phone: c.phone, email: c.email, trn: c.trn }; }
      }
    }
    const isQuote = draft.type === 'quote';
    const isNew = !id;
    let autoNum = draft.number;
    renderShell(isQuote ? 'quotes' : 'invoices');
    dirty = false;

    const f = (path, label, opts = {}) => {
      const v = getPath(draft, path) ?? '';
      const cls = opts.cls ? ` ${opts.cls}` : '';
      const hint = opts.hint ? ` <em>${esc(opts.hint)}</em>` : '';
      if (opts.textarea) return `<label class="field${cls}"><span>${label}${hint}</span><textarea data-f="${path}" rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(v)}</textarea></label>`;
      if (opts.select) return `<label class="field${cls}"><span>${label}${hint}</span><select data-f="${path}">${opts.select.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      return `<label class="field${cls}"><span>${label}${hint}</span><input data-f="${path}" type="${opts.type || 'text'}" value="${esc(v)}" placeholder="${esc(opts.ph || '')}" ${opts.type === 'number' ? 'inputmode="decimal" step="any"' : ''} ${opts.list ? `list="${opts.list}"` : ''} autocomplete="off"></label>`;
    };

    const clientOptions = state.clients.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((c) => `<option value="${esc(c.id)}" ${draft.clientId === c.id ? 'selected' : ''}>${esc(c.name)}${c.company ? ' — ' + esc(c.company) : ''}</option>`).join('');

    setView(`
      <div class="page-head">
        <div>
          <a href="${isNew ? '#/' + (isQuote ? 'quotes' : 'invoices') : '#/doc/' + draft.id}" class="btn btn-ghost btn-sm" style="margin-left:-10px">${I.back}${isNew ? typeName(draft.type, true) : 'Back to preview'}</a>
          <h1 style="margin-top:6px">${isNew ? 'New ' + typeName(draft.type).toLowerCase() : 'Edit ' + esc(draft.number)}</h1>
        </div>
        <div class="actions">
          <button class="btn" data-act="save-stay">Save</button>
          <button class="btn btn-primary" data-act="save-view">Save & preview</button>
        </div>
      </div>
      <form class="editor" id="editor" novalidate onsubmit="return false">
        <div class="editor-main">
          <section class="panel panel-pad">
            <div class="section-title"><div><h2>Client</h2><p>Pick a saved client or type new details. New clients are saved automatically.</p></div></div>
            <div class="grid g2">
              <label class="field span2"><span>Saved clients</span>
                <select id="clientPick"><option value="">${state.clients.length ? 'Choose a saved client…' : 'No saved clients yet'}</option>${clientOptions}</select>
              </label>
              ${f('client.name', 'Client name', { ph: 'e.g. Youssef' })}
              ${f('client.company', 'Company', { hint: 'optional' })}
              ${f('client.phone', 'Phone', { type: 'tel' })}
              ${f('client.email', 'Email', { type: 'email' })}
              ${f('client.address', 'Address', { textarea: true, rows: 2, cls: 'span2' })}
              ${f('client.trn', 'Client TRN', { hint: 'if VAT registered' })}
            </div>
          </section>

          <section class="panel panel-pad">
            <div class="section-title"><h2>${typeName(draft.type)} details</h2></div>
            <div class="grid g3">
              ${f('number', `${typeName(draft.type)} no.`)}
              ${f('issueDate', 'Issue date', { type: 'date' })}
              ${isQuote ? f('validDays', 'Valid for (days)', { type: 'number' }) : f('dueDate', 'Due date', { type: 'date' })}
              ${f('project', 'Project', { cls: 'span2', ph: 'e.g. Wi-Fi Troubleshooting and Reconfiguration' })}
              ${f('preparedBy', 'Prepared by')}
              ${f('subject', 'Subject', { cls: 'span2', ph: 'e.g. Proposal for Wi-Fi Troubleshooting and Reconfiguration' })}
              ${f('poNumber', isQuote ? 'Client reference' : 'Client PO no.', { hint: 'optional' })}
              ${f('paymentTerms', 'Payment terms', { cls: 'span2' })}
              ${isQuote ? f('duration', 'Estimated duration', { ph: 'e.g. 2–4 working days' }) : f('currency', 'Currency')}
              ${isQuote ? f('currency', 'Currency') : ''}
              ${f('intro', 'Introduction', { textarea: true, rows: 2, cls: 'span3' })}
            </div>
          </section>

          <section class="panel panel-pad">
            <div class="section-title"><div><h2>Items</h2><p>Prices are before VAT. VAT is added on the total.</p></div></div>
            <div class="items-head"><span>#</span><span>Description</span><span>Qty</span><span class="r">Unit price</span><span class="r">Amount</span><span></span></div>
            <div class="items" id="items"></div>
            <button type="button" class="btn" style="margin-top:12px" data-act="add-item">${I.plus}Add item</button>
          </section>

          <section class="panel panel-pad">
            <div class="section-title"><div><h2>Scope, terms & notes</h2><p>One point per line. Each line becomes a bullet on the PDF.</p></div></div>
            <div class="grid">
              ${f('scope', 'Scope of work', { textarea: true, rows: 4, ph: 'Troubleshooting and diagnosis of existing Wi-Fi network issues.' })}
              ${f('terms', 'Terms & conditions', { textarea: true, rows: 4 })}
              ${f('notes', 'Notes', { textarea: true, rows: 2, hint: 'optional' })}
              <label class="check"><input type="checkbox" data-f="showBank" ${draft.showBank ? 'checked' : ''}> Show bank details on the PDF</label>
            </div>
          </section>
        </div>

        <aside class="editor-side">
          <section class="panel summary" id="summary"></section>
          ${!isQuote ? `<section class="panel panel-pad" style="margin-top:16px">
            <div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="muted small">Status</span>${badge(draft.status)}</div>
            <p class="form-note">Status updates automatically when you record payments on the invoice page.</p>
            </section>` : `<section class="panel panel-pad" style="margin-top:16px">${f('status', 'Status', { select: QUOTE_STATUSES })}</section>`}
        </aside>
      </form>`);

    const itemsEl = $('#items');
    function drawItems() {
      itemsEl.innerHTML = draft.items.map((it, i) => `
        <div class="item" data-i="${i}">
          <div class="idx">${i + 1}</div>
          <div class="desc">
            <input data-f="items.${i}.title" value="${esc(it.title)}" placeholder="Item or service title" aria-label="Item ${i + 1} title" autocomplete="off">
            <textarea data-f="items.${i}.description" rows="2" placeholder="Description (optional)" aria-label="Item ${i + 1} description">${esc(it.description)}</textarea>
          </div>
          <div class="q"><span class="mini-label">Qty</span><input data-f="items.${i}.qty" type="number" inputmode="decimal" step="any" min="0" value="${esc(it.qty)}" aria-label="Quantity"></div>
          <div class="p"><span class="mini-label">Unit price</span><input data-f="items.${i}.price" type="number" inputmode="decimal" step="any" min="0" value="${esc(it.price)}" aria-label="Unit price"></div>
          <div class="amount"><span class="mini-label">Amount</span><div data-amount="${i}">${money(lineAmount(it))}</div></div>
          <div class="tools">
            <button type="button" class="btn btn-ghost btn-icon" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
            <button type="button" class="btn btn-ghost btn-icon" data-act="down" data-i="${i}" aria-label="Move down" ${i === draft.items.length - 1 ? 'disabled' : ''}>${I.down}</button>
            <button type="button" class="btn btn-ghost btn-icon" data-act="remove" data-i="${i}" aria-label="Remove item">${I.x}</button>
          </div>
        </div>`).join('');
    }
    function drawSummary() {
      const T = totals(draft);
      const cur = draft.currency || 'AED';
      $('#summary').innerHTML = `
        <h2 style="margin-bottom:8px">Summary</h2>
        <div class="row"><span>Subtotal</span><span>${money(T.subtotal)}</span></div>
        <div class="row"><span>Discount</span><span><input data-f="discount" type="number" inputmode="decimal" step="any" min="0" value="${esc(draft.discount || 0)}" style="width:110px;min-height:30px;padding:4px 8px;text-align:right" aria-label="Discount"></span></div>
        <div class="row"><span class="vat-row">VAT <input data-f="vatRate" type="number" inputmode="decimal" step="any" min="0" value="${esc(draft.vatRate)}" aria-label="VAT rate"> %</span><span>${money(T.vat)}</span></div>
        <div class="row total"><span>Total ${esc(cur)}</span><span>${money(T.total)}</span></div>
        ${!isQuote ? `<div class="row" id="balRow" ${T.paid ? '' : 'hidden'}><span>Balance due</span><span>${money(T.balance)}</span></div>` : ''}
        <div class="words">${esc(amountInWords(T.total, cur))}</div>
        <button type="button" class="btn btn-primary" data-act="save-view">Save & preview</button>`;
    }
    function refreshNumbers() {
      draft.items.forEach((it, i) => { const el = $(`[data-amount="${i}"]`); if (el) el.textContent = money(lineAmount(it)); });
      const T = totals(draft);
      const sum = $('#summary');
      const rows = sum.querySelectorAll('.row');
      rows[0].lastElementChild.textContent = money(T.subtotal);
      rows[2].lastElementChild.textContent = money(T.vat);
      rows[3].lastElementChild.textContent = money(T.total);
      const bal = $('#balRow');
      if (bal) { bal.hidden = !T.paid; bal.lastElementChild.textContent = money(T.balance); }
      sum.querySelector('.words').textContent = amountInWords(T.total, draft.currency);
    }
    drawItems();
    drawSummary();

    const form = $('#editor');
    form.addEventListener('input', (e) => {
      const el = e.target.closest('[data-f]');
      if (!el) return;
      const path = el.dataset.f;
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number' && path !== 'validDays') val = el.value === '' ? '' : num(el.value);
      if (path === 'validDays') val = parseInt(el.value, 10) || 0;
      setPath(draft, path, val);
      dirty = true;
      if (/^(items\.\d+\.(qty|price)|discount|vatRate|amountPaid)$/.test(path)) refreshNumbers();
      if (path === 'currency') drawSummary();
      if (path === 'client.name' && draft.clientId) {
        const rec = state.clients.find((c) => c.id === draft.clientId);
        if (rec && rec.name !== val) { draft.clientId = null; $('#clientPick').value = ''; }
      }
      if (path === 'issueDate' && isNew && draft.number === autoNum && val) {
        // keep the automatic number in step with the year of the issue date
        autoNum = nextNumber(draft.type, state.docs, S().numbering, val);
        draft.number = autoNum;
        form.querySelector('[data-f="number"]').value = autoNum;
      }
    });
    form.addEventListener('change', (e) => {
      if (false) {
        const T = totals(draft);
        const sel = form.querySelector('[data-f="status"]');
        if (T.paid > 0 && T.balance <= 0 && draft.status !== 'Paid') { draft.status = 'Paid'; sel.value = 'Paid'; draft.paidDate = draft.paidDate || today(); }
        else if (T.paid > 0 && T.balance > 0 && draft.status === 'Unpaid') { draft.status = 'Partially Paid'; sel.value = 'Partially Paid'; }
      }
    });
    $('#clientPick').addEventListener('change', (e) => {
      const c = state.clients.find((x) => x.id === e.target.value);
      if (!c) return;
      draft.clientId = c.id;
      draft.client = { name: c.name || '', company: c.company || '', address: c.address || '', phone: c.phone || '', email: c.email || '', trn: c.trn || '' };
      for (const k of Object.keys(draft.client)) { const el = form.querySelector(`[data-f="client.${k}"]`); if (el) el.value = draft.client[k]; }
      dirty = true;
    });

    async function save(goView) {
      if (!draft.number || !draft.number.trim()) { toast('Add a document number before saving.', true); return; }
      if (!draft.issueDate) { toast('Add an issue date before saving.', true); return; }
      draft.number = draft.number.trim();
      draft.items = draft.items.filter((it, i) => it.title || it.description || num(it.price) || draft.items.length === 1);
      draft.items.forEach((it) => { it.qty = num(it.qty); it.price = num(it.price); });
      draft.discount = num(draft.discount); draft.vatRate = num(draft.vatRate); draft.amountPaid = num(draft.amountPaid);
      if (!isQuote) window.Books.syncInvoice(draft);
      const ok = await guard(async () => {
        await upsertClientFromDoc(draft);
        await saveDoc(clone(draft));
        return true;
      });
      if (!ok) return;
      dirty = false;
      toast(`${draft.number} saved`);
      if (goView) location.hash = `#/doc/${draft.id}`;
      else if (isNew) { ignoreHash = true; location.hash = `#/edit/${draft.id}`; lastHash = location.hash; viewEditor(draft.id); }
    }

    $('#view').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act, i = parseInt(b.dataset.i, 10);
      if (act === 'add-item') {
        draft.items.push({ id: uid(), title: '', description: '', qty: 1, unit: '', price: 0 });
        drawItems(); refreshNumbers(); dirty = true;
        const last = itemsEl.lastElementChild.querySelector('input'); if (last) last.focus();
      }
      if (act === 'remove') {
        if (draft.items.length === 1) { draft.items[0] = { id: uid(), title: '', description: '', qty: 1, unit: '', price: 0 }; }
        else draft.items.splice(i, 1);
        drawItems(); refreshNumbers(); dirty = true;
      }
      if (act === 'up' && i > 0) { [draft.items[i - 1], draft.items[i]] = [draft.items[i], draft.items[i - 1]]; drawItems(); dirty = true; }
      if (act === 'down' && i < draft.items.length - 1) { [draft.items[i + 1], draft.items[i]] = [draft.items[i], draft.items[i + 1]]; drawItems(); dirty = true; }
      if (act === 'save-view') save(true);
      if (act === 'save-stay') save(false);
    });
  }

  // ------------------------------------------------------------------
  // Clients
  // ------------------------------------------------------------------
  function viewClients() {
    renderShell('clients');
    let q = '';
    setView(`
      ${modeBanner()}
      <div class="page-head">
        <div><h1>Clients</h1><div class="sub">${state.clients.length} saved</div></div>
        <div class="actions"><button class="btn btn-primary" id="addClient">${I.plus}Add client</button></div>
      </div>
      <div class="toolbar"><label class="search">${I.search}<input type="search" id="q" placeholder="Search clients" aria-label="Search clients"></label></div>
      <section class="panel" id="clientList"></section>`);
    const draw = () => {
      const needle = q.toLowerCase();
      const rows = state.clients.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .filter((c) => !needle || [c.name, c.company, c.email, c.phone].some((v) => String(v || '').toLowerCase().includes(needle)));
      $('#clientList').innerHTML = rows.length ? rows.map((c) => {
        const n = state.docs.filter((d) => d.clientId === c.id).length;
        return `<button class="client-row" data-id="${c.id}">
          <span><strong>${esc(c.name)}</strong><span>${esc(c.company || '')}</span></span>
          <span class="hide-m">${esc(c.phone || '')}</span>
          <span class="hide-m">${esc(c.email || '')}</span>
          <span style="text-align:right">${n} doc${n === 1 ? '' : 's'}</span>
        </button>`;
      }).join('') : `<div class="empty">${state.clients.length ? 'No clients match your search.' : '<h2>No clients yet</h2><p>Clients are saved automatically when you save a quotation, or add one here.</p>'}</div>`;
    };
    draw();
    $('#q').addEventListener('input', (e) => { q = e.target.value; draw(); });
    $('#addClient').addEventListener('click', () => clientModal(null, draw));
    $('#clientList').addEventListener('click', (e) => { const r = e.target.closest('[data-id]'); if (r) clientModal(r.dataset.id, draw); });
  }

  function clientModal(id, after) {
    const existing = id && state.clients.find((c) => c.id === id);
    const c = existing ? clone(existing) : { id: uid(), name: '', company: '', address: '', phone: '', email: '', trn: '', createdAt: new Date().toISOString() };
    const docs = sortDocs(state.docs.filter((d) => d.clientId === c.id));
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-back" id="mb"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
      <div class="modal-head"><h2 id="mt">${existing ? 'Edit client' : 'Add client'}</h2><button class="btn btn-ghost btn-icon" data-x aria-label="Close">${I.x}</button></div>
      <div class="modal-body">
        <div class="grid g2">
          <label class="field"><span>Name</span><input name="name" value="${esc(c.name)}" autocomplete="off"></label>
          <label class="field"><span>Company</span><input name="company" value="${esc(c.company)}"></label>
          <label class="field"><span>Phone</span><input name="phone" type="tel" value="${esc(c.phone)}"></label>
          <label class="field"><span>Email</span><input name="email" type="email" value="${esc(c.email)}"></label>
          <label class="field span2"><span>Address</span><textarea name="address" rows="2">${esc(c.address)}</textarea></label>
          <label class="field"><span>TRN</span><input name="trn" value="${esc(c.trn)}"></label>
        </div>
        ${docs.length ? `<h3 style="margin:18px 0 6px">Documents</h3><ul class="doc-list" style="border:1px solid var(--line);border-radius:8px">${docs.slice(0, 6).map(docRow).join('')}</ul>` : ''}
      </div>
      <div class="modal-foot">
        ${existing ? `<button class="btn btn-danger" data-del>${I.trash}Delete</button>` : ''}
        <div class="right">
          ${existing ? `<a class="btn" href="#/new/quote/${c.id}" data-close>${I.plus}Quotation</a>` : ''}
          <button class="btn btn-primary" data-save>Save client</button>
        </div>
      </div></div></div>`;
    const close = () => { root.innerHTML = ''; };
    $('#mb').addEventListener('click', async (e) => {
      if (e.target.id === 'mb' || e.target.closest('[data-x]') || e.target.closest('[data-close]') || e.target.closest('.doc-row')) { close(); return; }
      if (e.target.closest('[data-save]')) {
        for (const inp of $$('[name]', root)) c[inp.name] = inp.value.trim();
        if (!c.name) { toast('Add a client name.', true); return; }
        const ok = await guard(async () => { await Store.saveClient(c); return true; });
        if (!ok) return;
        const i = state.clients.findIndex((x) => x.id === c.id);
        if (i >= 0) state.clients[i] = c; else state.clients.push(c);
        close(); toast('Client saved'); after && after();
      }
      if (e.target.closest('[data-del]')) {
        if (!confirm(`Delete ${c.name}? Their quotations and invoices are kept.`)) return;
        const ok = await guard(async () => { await Store.deleteClient(c.id); return true; });
        if (!ok) return;
        state.clients = state.clients.filter((x) => x.id !== c.id);
        close(); toast('Client deleted'); after && after();
      }
    });
    setTimeout(() => { const first = root.querySelector('input'); if (first && !existing) first.focus(); }, 50);
  }

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------
  async function resizeImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That file is not an image this browser can read. Use PNG or JPG.')); im.src = url; });
      const max = 900;
      const scale = Math.min(1, max / img.width, 450 / img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      const isPng = /png|svg|webp|gif/i.test(file.type);
      if (!isPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
    } finally { URL.revokeObjectURL(url); }
  }

  function viewSettings() {
    renderShell('settings');
    const s = clone(S());
    const f = (path, label, opts = {}) => {
      const v = getPath(s, path) ?? '';
      const hint = opts.hint ? ` <em>${esc(opts.hint)}</em>` : '';
      const cls = opts.cls ? ` ${opts.cls}` : '';
      if (opts.textarea) return `<label class="field${cls}"><span>${label}${hint}</span><textarea data-s="${path}" rows="${opts.rows || 3}">${esc(v)}</textarea></label>`;
      return `<label class="field${cls}"><span>${label}${hint}</span><input data-s="${path}" type="${opts.type || 'text'}" value="${esc(v)}" ${opts.type === 'number' ? 'inputmode="decimal" step="any"' : ''}></label>`;
    };
    const sample = (type) => {
      const n = s.numbering;
      return window.Calc.nextNumber(type, state.docs, n, today());
    };

    setView(`
      <div class="page-head"><div><h1>Settings</h1><div class="sub">These details appear on every quotation and invoice.</div></div></div>
      <form class="panel" id="settingsForm" novalidate onsubmit="return false">
        <div class="settings-grid">
          <header><h2>Company</h2><p>Shown in the PDF header and footer. Add your TRN to issue tax invoices.</p></header>
          <div class="grid g2">
            ${f('company.name', 'Company name', { cls: 'span2' })}
            ${f('company.address', 'Address', { textarea: true, rows: 2, cls: 'span2' })}
            ${f('company.phone', 'Phone')}
            ${f('company.email', 'Email')}
            ${f('company.website', 'Website', { hint: 'optional' })}
            ${f('company.trn', 'TRN', { hint: 'VAT registration no.' })}
          </div>
        </div>
        <div class="settings-grid">
          <header><h2>Logo</h2><p>PNG with a white or transparent background works best.</p></header>
          <div class="logo-box">
            <div class="preview" id="logoPreview">${logoSrc() ? `<img src="${esc(logoSrc())}" alt="Company logo">` : '<span class="muted small">No logo</span>'}</div>
            <div class="actions">
              <label class="btn">Upload logo<input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" hidden></label>
              <button type="button" class="btn btn-ghost" id="logoReset">Use original</button>
              <button type="button" class="btn btn-ghost" id="logoNone">No logo</button>
            </div>
          </div>
        </div>
        <div class="settings-grid">
          <header><h2>Bank details</h2><p>Printed on invoices, and on quotations when you tick the option.</p></header>
          <div class="grid g2">
            ${f('bank.bankName', 'Bank name')}
            ${f('bank.accountName', 'Account name')}
            ${f('bank.accountNo', 'Account number')}
            ${f('bank.iban', 'IBAN')}
            ${f('bank.swift', 'SWIFT / BIC')}
            <label class="check" style="align-self:end"><input type="checkbox" data-s="defaults.showBankOnQuote" ${s.defaults.showBankOnQuote ? 'checked' : ''}> Show on quotations by default</label>
          </div>
        </div>
        <div class="settings-grid">
          <header><h2>Numbering</h2><p>The next number is worked out from your saved documents. Next quotation: <strong class="num" id="nq">${esc(sample('quote'))}</strong>, next invoice: <strong class="num" id="ni">${esc(sample('invoice'))}</strong></p></header>
          <div class="grid g3">
            ${f('numbering.quotePrefix', 'Quotation prefix')}
            ${f('numbering.quoteStart', 'Start quotations at', { type: 'number' })}
            ${f('numbering.pad', 'Digits', { type: 'number' })}
            ${f('numbering.invoicePrefix', 'Invoice prefix')}
            ${f('numbering.invoiceStart', 'Start invoices at', { type: 'number' })}
            <label class="check" style="align-self:end"><input type="checkbox" data-s="numbering.includeYear" ${s.numbering.includeYear !== false ? 'checked' : ''}> Include year</label>
          </div>
        </div>
        <div class="settings-grid">
          <header><h2>Defaults</h2><p>Pre-filled on every new document. In text, {company}, {validDays} and {paymentTerms} are replaced automatically.</p></header>
          <div class="grid g3">
            ${f('defaults.preparedBy', 'Prepared by')}
            ${f('defaults.currency', 'Currency')}
            ${f('defaults.vatRate', 'VAT rate %', { type: 'number' })}
            ${f('defaults.validDays', 'Quotation valid (days)', { type: 'number' })}
            ${f('defaults.dueDays', 'Invoice due in (days)', { type: 'number' })}
            ${f('defaults.paymentTerms', 'Payment terms')}
            ${f('defaults.quoteIntro', 'Quotation introduction', { textarea: true, rows: 2, cls: 'span3' })}
            ${f('defaults.invoiceIntro', 'Invoice introduction', { textarea: true, rows: 2, cls: 'span3' })}
            ${f('defaults.scope', 'Default scope of work', { textarea: true, rows: 3, cls: 'span3', hint: 'one point per line' })}
            ${f('defaults.quoteTerms', 'Quotation terms', { textarea: true, rows: 4, cls: 'span3', hint: 'one point per line' })}
            ${f('defaults.invoiceTerms', 'Invoice terms', { textarea: true, rows: 4, cls: 'span3', hint: 'one point per line' })}
          </div>
        </div>
        <div class="settings-grid">
          <header><h2>Bookkeeping</h2><p>Expense categories (one per line) and your VAT return periods.</p></header>
          <div class="grid g2">
            <label class="field"><span>VAT quarters</span>
              <select data-s="books.vatQuarterStart">
                ${[[1, 'January, April, July, October'], [2, 'February, May, August, November'], [3, 'March, June, September, December']].map(([v, l]) => `<option value="${v}" ${Number(s.books.vatQuarterStart) === v ? 'selected' : ''}>Start in ${l}</option>`).join('')}
              </select></label>
            ${f('books.billDueDays', 'Supplier bills due in (days)', { type: 'number' })}
            <label class="field span2"><span>Expense categories <em>one per line</em></span><textarea data-s="books.categoriesText" rows="6">${esc((s.books.categories || []).join('\n'))}</textarea></label>
          </div>
        </div>
        <div class="settings-grid">
          <header><h2>Data</h2><p>${Store.mode === 'cloud' ? 'Your records are stored in your Supabase database and sync across devices.' : 'Your records are stored in this browser only.'} Download a backup now and then.</p></header>
          <div class="actions">
            <button type="button" class="btn" id="backup">${I.download}Download backup</button>
            <label class="btn">Restore backup<input type="file" id="restore" accept="application/json,.json" hidden></label>
            ${Store.mode === 'cloud' ? `<button type="button" class="btn btn-ghost" id="signout">Sign out<span class="muted small" id="who"></span></button>` : ''}
          </div>
        </div>
        <div class="save-bar"><button type="button" class="btn btn-primary" id="saveSettings">Save settings</button></div>
      </form>`);

    if (Store.mode === 'cloud') Store.session().then((x) => { const w = $('#who'); if (w && x.email) w.textContent = ' (' + x.email + ')'; });

    const form = $('#settingsForm');
    form.addEventListener('change', (e) => { if (e.target.matches('select[data-s]')) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
    form.addEventListener('input', (e) => {
      const el = e.target.closest('[data-s]');
      if (!el) return;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number' || el.dataset.s === 'books.vatQuarterStart') v = num(el.value);
      if (el.dataset.s === 'books.categoriesText') { s.books.categories = String(v).split('\n').map((x) => x.trim()).filter(Boolean); dirty = true; return; }
      setPath(s, el.dataset.s, v);
      dirty = true;
      if (el.dataset.s.startsWith('numbering.')) {
        $('#nq').textContent = window.Calc.nextNumber('quote', state.docs, s.numbering, today());
        $('#ni').textContent = window.Calc.nextNumber('invoice', state.docs, s.numbering, today());
      }
    });
    const showLogo = () => { const src = s.logo === 'none' ? '' : (s.logo || 'assets/logo.png'); $('#logoPreview').innerHTML = src ? `<img src="${esc(src)}" alt="Company logo">` : '<span class="muted small">No logo</span>'; };
    $('#logoFile').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const data = await guard(() => resizeImage(file));
      if (data) { s.logo = data; dirty = true; showLogo(); toast('Logo ready. Save settings to keep it.'); }
      e.target.value = '';
    });
    $('#logoReset').addEventListener('click', () => { s.logo = null; dirty = true; showLogo(); });
    $('#logoNone').addEventListener('click', () => { s.logo = 'none'; dirty = true; showLogo(); });

    $('#saveSettings').addEventListener('click', async () => {
      const ok = await guard(async () => { await Store.saveSettings(s); return true; });
      if (!ok) return;
      state.settings = s; dirty = false; logoCache.key = null;
      renderShell('settings');
      toast('Settings saved');
    });

    $('#backup').addEventListener('click', () => {
      const data = { app: 'quotes-invoices', version: 2, exportedAt: new Date().toISOString(), settings: S(), clients: state.clients, docs: state.docs, payments: state.payments, expenses: state.expenses };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `quotes-invoices-backup-${today()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    });
    $('#restore').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      let data;
      try { data = JSON.parse(await file.text()); } catch (err) { toast('That file is not a valid backup.', true); return; }
      if (!data || !Array.isArray(data.docs)) { toast('That file is not a valid backup.', true); return; }
      if (!confirm(`Restore ${data.docs.length} documents, ${(data.clients || []).length} clients, ${(data.payments || []).length} payments and ${(data.expenses || []).length} expenses from this backup? Records with the same ID are replaced.`)) return;
      await guard(async () => {
        const merged = {
          settings: data.settings ? deepMerge(DEFAULT_SETTINGS, data.settings) : S(),
          clients: mergeById(state.clients, data.clients || []),
          docs: mergeById(state.docs, data.docs),
          payments: mergeById(state.payments, data.payments || []),
          expenses: mergeById(state.expenses, data.expenses || []),
        };
        if (Store.mode === 'cloud') await Store.replaceAll({ settings: merged.settings, clients: data.clients || [], docs: data.docs, payments: state.booksMissing ? [] : (data.payments || []), expenses: state.booksMissing ? [] : (data.expenses || []) });
        else await Store.replaceAll(merged);
        Object.assign(state, merged);
        logoCache.key = null;
        dirty = false;
        viewSettings();
      }, 'Backup restored');
    });
    const so = $('#signout');
    if (so) so.addEventListener('click', async () => { await Store.signOut(); location.hash = '#/'; location.reload(); });
  }
  function mergeById(a, b) {
    const m = new Map(a.map((x) => [x.id, x]));
    for (const x of b) if (x && x.id) m.set(x.id, x);
    return Array.from(m.values());
  }

  // ------------------------------------------------------------------
  // Login (cloud mode)
  // ------------------------------------------------------------------
  function viewLogin() {
    document.body.classList.add('login-mode');
    setView(`<div class="login-wrap"><form class="login" id="loginForm">
      <img src="assets/logo.png" alt="">
      <h1>Sign in</h1>
      <p>Use the email and password you created in Supabase.</p>
      <div class="grid">
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
      </div>
      <p class="error" id="loginErr"></p>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form></div>`);
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button');
      btn.disabled = true; $('#loginErr').textContent = '';
      try {
        await Store.signIn(String(fd.get('email')).trim(), String(fd.get('password')));
        document.body.classList.remove('login-mode');
        await loadData();
      } catch (err) {
        $('#loginErr').textContent = err.message || 'Could not sign in.';
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  async function loadData() {
    const data = await Store.loadAll();
    state.settings = deepMerge(DEFAULT_SETTINGS, data.settings || {});
    state.clients = data.clients || [];
    state.docs = data.docs || [];
    state.payments = data.payments || [];
    state.expenses = data.expenses || [];
    state.booksMissing = !!data.booksMissing;
    try { await window.Books.migrate(); } catch (e) { console.warn('Payment migration skipped', e); }
    if (!data.settings) { try { await Store.saveSettings(state.settings); } catch (e) { console.warn(e); } }
    state.ready = true;
    route();
  }

  let lastSync = Date.now();
  document.addEventListener('visibilitychange', async () => {
    // Pick up changes made on your other device when you come back to the app.
    if (document.visibilityState !== 'visible' || Store.mode !== 'cloud' || !state.ready || dirty) return;
    if (Date.now() - lastSync < 30000) return;
    lastSync = Date.now();
    try {
      const data = await Store.loadAll();
      state.settings = deepMerge(DEFAULT_SETTINGS, data.settings || {});
      state.clients = data.clients; state.docs = data.docs; state.payments = data.payments || []; state.expenses = data.expenses || []; state.booksMissing = !!data.booksMissing;
      const h = location.hash;
      if (!/^#\/(edit|new|settings)/.test(h) && !document.querySelector('.modal-back')) route();
    } catch (e) { console.warn('Refresh failed', e); }
  });

  // Shared helpers for the bookkeeping module (js/books.js)
  window.App = {
    state, I, $, $$, esc, clone, slug, toast, guard, setView, renderShell, modeBanner, badge, saveDoc, docById, sortDocs,
    getLogo, settings: S, INVOICE_STATUSES, route,
    setDirty(v) { dirty = v; },
  };

  async function boot() {
    try {
      const r = await Store.init();
      if (r.needsLogin) { viewLogin(); return; }
      await loadData();
    } catch (e) {
      console.error(e);
      setView(`<div class="empty"><h2>The app could not start</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`);
    }
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
