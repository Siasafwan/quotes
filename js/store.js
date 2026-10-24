/* Data storage.
 * Cloud mode  : Supabase (when js/config.js has a URL + anon key) — data syncs
 *               between your phone and laptop and is protected by your login.
 * Local mode  : browser storage on this device only (used when Supabase is not
 *               configured yet). Use Settings → Backup to move data.
 */
(function (global) {
  'use strict';
  const cfg = global.APP_CONFIG || {};
  const LS_KEY = 'qis-data-v1';

  // ---------------- Local (this device only) ----------------
  const LocalStore = {
    mode: 'local',
    _read() {
      try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
    },
    _write(data) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(data)); }
      catch (e) { throw new Error('This browser could not save the data (storage full or private mode).'); }
    },
    async init() { return { ok: true }; },
    async session() { return { email: null }; },
    async loadAll() {
      const d = this._read();
      return { settings: d.settings || null, clients: d.clients || [], docs: d.docs || [], payments: d.payments || [], expenses: d.expenses || [], booksMissing: false };
    },
    async saveRow(kind, row) { const d = this._read(); d[kind] = upsertArr(d[kind], row); this._write(d); },
    async deleteRow(kind, id) { const d = this._read(); d[kind] = (d[kind] || []).filter((x) => x.id !== id); this._write(d); },
    async uploadReceipt(id, blob, mime) {
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(blob); });
      return { kind: 'data', url, mime };
    },
    async receiptUrl(ref) { return ref && ref.url; },
    async deleteReceipt() {},
    async saveSettings(s) { const d = this._read(); d.settings = s; this._write(d); },
    async saveClient(c) { const d = this._read(); d.clients = upsertArr(d.clients, c); this._write(d); },
    async deleteClient(id) { const d = this._read(); d.clients = (d.clients || []).filter((x) => x.id !== id); this._write(d); },
    async saveDoc(doc) {
      const d = this._read();
      const dup = (d.docs || []).find((x) => x.id !== doc.id && x.type === doc.type && x.number === doc.number);
      if (dup) throw new Error(`Number ${doc.number} is already used by another ${doc.type === 'quote' ? 'quotation' : 'invoice'}.`);
      d.docs = upsertArr(d.docs, doc); this._write(d);
    },
    async deleteDoc(id) { const d = this._read(); d.docs = (d.docs || []).filter((x) => x.id !== id); this._write(d); },
    async replaceAll(data) { this._write({ settings: data.settings || null, clients: data.clients || [], docs: data.docs || [], payments: data.payments || [], expenses: data.expenses || [] }); },
    async signOut() {},
  };
  function upsertArr(arr, item) {
    arr = arr || [];
    const i = arr.findIndex((x) => x.id === item.id);
    if (i >= 0) arr[i] = item; else arr.push(item);
    return arr;
  }

  // ---------------- Supabase (cloud, synced) ----------------
  const CloudStore = {
    mode: 'cloud',
    client: null,
    user: null,
    async init() {
      if (!global.supabase || !global.supabase.createClient) {
        throw new Error('Could not load the Supabase library. Check your internet connection and reload.');
      }
      this.client = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      const { data } = await this.client.auth.getSession();
      this.user = data.session ? data.session.user : null;
      return { ok: true, needsLogin: !this.user };
    },
    async session() { return { email: this.user ? this.user.email : null }; },
    async signIn(email, password) {
      const { data, error } = await this.client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
      this.user = data.user;
    },
    async signOut() { await this.client.auth.signOut(); this.user = null; },
    _check(res) {
      if (res.error) {
        const msg = res.error.message || String(res.error);
        if (/duplicate key|unique/i.test(msg)) throw new Error('That number is already used by another document. Change the number and save again.');
        if (/JWT|token/i.test(msg)) throw new Error('Your session expired. Sign in again.');
        throw new Error(msg);
      }
      return res.data;
    },
    async loadAll() {
      const [s, c, d] = await Promise.all([
        this.client.from('settings').select('data').maybeSingle(),
        this.client.from('clients').select('id,data'),
        this.client.from('documents').select('id,data'),
      ]);
      const sd = this._check(s);
      // Bookkeeping tables are optional until bookkeeping.sql has been run.
      let payments = [], expenses = [], booksMissing = false;
      const [p, e] = await Promise.all([
        this.client.from('payments').select('id,data'),
        this.client.from('expenses').select('id,data'),
      ]);
      if (p.error || e.error) {
        console.warn('Bookkeeping tables not available', p.error || e.error);
        booksMissing = true;
      } else {
        payments = p.data.map((r) => ({ ...r.data, id: r.id }));
        expenses = e.data.map((r) => ({ ...r.data, id: r.id }));
      }
      return {
        settings: sd ? sd.data : null,
        clients: (this._check(c) || []).map((r) => ({ ...r.data, id: r.id })),
        docs: (this._check(d) || []).map((r) => ({ ...r.data, id: r.id })),
        payments, expenses, booksMissing,
      };
    },
    _rowFor(kind, row) {
      const base = { id: row.id, user_id: this.user.id, data: row, updated_at: new Date().toISOString() };
      if (kind === 'payments') return { ...base, invoice_id: row.invoiceId || null, pay_date: row.date || null, amount: Number(row.amount) || 0 };
      if (kind === 'expenses') return { ...base, exp_date: row.date || null, category: row.category || '', supplier: row.supplier || '', total: Number(row.total) || 0, vat: Number(row.vat) || 0, due_date: row.dueDate || null, status: row.status || 'Paid' };
      throw new Error('Unknown record type ' + kind);
    },
    async saveRow(kind, row) { this._check(await this.client.from(kind).upsert(this._rowFor(kind, row))); },
    async deleteRow(kind, id) { this._check(await this.client.from(kind).delete().eq('id', id)); },
    async uploadReceipt(id, blob, mime) {
      const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
      const path = `${this.user.id}/${id}-${Date.now()}.${ext}`;
      const { error } = await this.client.storage.from('receipts').upload(path, blob, { contentType: mime, upsert: true });
      if (error) {
        if (/bucket not found/i.test(error.message)) throw new Error('Receipt storage is not set up yet. Run bookkeeping.sql in Supabase.');
        throw new Error('Receipt upload failed: ' + error.message);
      }
      return { kind: 'storage', path, mime };
    },
    async receiptUrl(ref) {
      if (!ref) return null;
      if (ref.kind === 'data') return ref.url;
      const { data, error } = await this.client.storage.from('receipts').createSignedUrl(ref.path, 600);
      if (error) throw new Error('Could not open the receipt: ' + error.message);
      return data.signedUrl;
    },
    async deleteReceipt(ref) {
      if (!ref || ref.kind !== 'storage') return;
      await this.client.storage.from('receipts').remove([ref.path]);
    },
    async saveSettings(s) {
      this._check(await this.client.from('settings').upsert({ user_id: this.user.id, data: s, updated_at: new Date().toISOString() }));
    },
    async saveClient(c) {
      this._check(await this.client.from('clients').upsert({ id: c.id, user_id: this.user.id, name: c.name || '', data: c, updated_at: new Date().toISOString() }));
    },
    async deleteClient(id) { this._check(await this.client.from('clients').delete().eq('id', id)); },
    async saveDoc(doc) {
      const T = global.Calc.totals(doc);
      this._check(await this.client.from('documents').upsert({
        id: doc.id,
        user_id: this.user.id,
        doc_type: doc.type,
        number: doc.number,
        status: doc.status,
        client_name: (doc.client && doc.client.name) || '',
        issue_date: doc.issueDate || null,
        total: T.total,
        data: doc,
        updated_at: new Date().toISOString(),
      }));
    },
    async deleteDoc(id) { this._check(await this.client.from('documents').delete().eq('id', id)); },
    async replaceAll(data) {
      // Used by "Restore backup": upload everything (existing rows with the same id are overwritten).
      if (data.settings) await this.saveSettings(data.settings);
      for (const c of data.clients || []) await this.saveClient(c);
      for (const d of data.docs || []) await this.saveDoc(d);
      for (const r of data.payments || []) await this.saveRow('payments', r);
      for (const r of data.expenses || []) await this.saveRow('expenses', r);
    },
  };

  const cloudConfigured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !/YOUR_/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY));

  global.Store = cloudConfigured ? CloudStore : LocalStore;
})(window);
