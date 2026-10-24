# Quotes & Invoices — ECTECHZ IT Solutions

A private web app for creating quotations, converting approved quotations into invoices, and downloading professional PDFs. Works on your phone and laptop from one permanent link.

**What it does**

- Create, edit, duplicate and delete quotations, with automatic numbering (`ECT-QTN-2026-0810`, `ECT-INV-2026-0001`).
- Track quotation status: Draft, Sent, Approved, Rejected. Track invoices: Unpaid, Partially Paid, Paid, Cancelled.
- Convert an approved quotation to an invoice in one tap. Client, items, prices, discount, VAT, scope and terms carry over.
- VAT at 5% (editable per document), discount, subtotal, VAT amount, total, amount in words, amount received and balance due.
- A4 PDFs with your logo, company details, TRN, bank details and signature lines. Invoices are titled **Tax Invoice** once your TRN is entered.
- Saved clients, search and filters, a dashboard of open, approved and unpaid amounts.
- Data stored in your own free Supabase database behind a login, synced between devices. JSON backup and restore.
- Installs on your phone's home screen like an app.

**How it is built**

| Part | Service | Cost |
|---|---|---|
| Website files | GitHub repository | Free |
| Hosting and permanent link | GitHub Pages | Free |
| Database and login | Supabase | Free plan |
| PDF creation | pdf-lib (in `lib/`), runs in your browser | Free |

There is no build step. The files in this folder are the website.

---

## Setup guide

Allow about 30 minutes. You only need a web browser.

### Step 1 — Put the code on GitHub

1. Sign in at [github.com](https://github.com) (create a free account if you do not have one).
2. Click **+** (top right) → **New repository**.
   - Repository name: `quotes` (this becomes part of your link).
   - Visibility: **Public**. GitHub Pages is free for public repositories. The code is visible, but your data is not: it lives in Supabase behind your login. Nothing secret is stored in these files.
   - Leave "Add a README" unticked. Click **Create repository**.
3. On the new empty repository page, click **uploading an existing file**.
4. Unzip `quote-invoice-app.zip` on your computer. Open the unzipped `quote-invoice-app` folder, select **everything inside it** (`index.html`, `manifest.json`, `README.md`, and the folders `assets`, `css`, `js`, `lib`, `supabase`) and drag it onto the GitHub upload area.
   - Drag the *contents*, not the folder itself, so `index.html` ends up at the top level of the repository.
   - Chrome and Edge keep the sub-folders when you drag. If your browser drops them, upload each folder's files in turn using **Add file → Upload files** and type the folder name (for example `js/`) in front of the file name.
5. Click **Commit changes**. Check that the repository's main page lists `index.html` and the folders.

### Step 2 — Publish with GitHub Pages

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. Wait 1–2 minutes and refresh the page. GitHub shows your link:
   `https://YOUR-GITHUB-USERNAME.github.io/quotes/`
4. Open it. The app works now in "this device only" mode (a yellow note says so). Do not enter real work yet: finish Step 3 so your records sync and are backed up in the cloud.

### Step 3 — Create the database (Supabase)

1. Go to [supabase.com](https://supabase.com) → **Start your project** and sign up (you can use your GitHub account).
2. Click **New project**. Choose a name (`quotes`), set a strong database password (save it in your password manager), pick the nearest region, and create the project. It takes a minute or two.
3. Open **SQL Editor** (left menu) → **New query**. Open `supabase/schema.sql` from this folder, copy everything, paste it into the editor, and click **Run**. You should see "Success. No rows returned". This creates three tables (settings, clients, documents) with row-level security, so only your login can read or change your records.
4. Create your login: **Authentication → Users → Add user → Create new user**. Enter your email and a password, tick **Auto Confirm User**, and create it.
5. Stop strangers from signing up: **Authentication → Sign In / Providers** → turn **off** "Allow new users to sign up" → **Save**.
6. Copy your connection details: click the **Connect** button at the top of the project (or **Project Settings → API Keys**). You need:
   - the **Project URL**, e.g. `https://abcdefghijkl.supabase.co`
   - the **publishable key** (starts with `sb_publishable_`). The older **anon public** key also works.
   - Never use the **secret** or **service_role** key in this app.

### Step 4 — Connect the website to the database

1. On GitHub, open your repository → `js` folder → `config.js` → click the **pencil icon** (Edit).
2. Replace the two placeholders, keeping the quote marks:

   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
     SUPABASE_ANON_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
   };
   ```
3. Click **Commit changes**. GitHub Pages republishes in about a minute.
4. Open your link and refresh (on a laptop, Ctrl+F5 or Cmd+Shift+R). You now see a **Sign in** screen. Sign in with the email and password from Step 3.4.

If you used the app in Step 2 and want to keep what you entered: before Step 4, open **Settings → Download backup** on that device. After signing in, use **Settings → Restore backup**.

### Step 5 — Enter your company details

Open **Settings** and fill in:

- **Company**: name, address, phone, email, website and **TRN**. With a TRN, invoices are titled "Tax Invoice", as UAE VAT rules require for VAT-registered suppliers.
- **Logo**: the ECTECHZ logo from your current quotation is included. Upload a sharper PNG if you have one.
- **Bank details**: printed on invoices (and on quotations if you tick the option).
- **Numbering**: quotations start at 0810 to follow on from ECT-QTN-2026-0809. Change the prefixes or start numbers if needed.
- **Defaults**: prepared by, payment terms, VAT rate, validity, invoice due days, standard scope and terms. Use `{company}`, `{validDays}` and `{paymentTerms}` in the text and they are filled in automatically.

Click **Save settings**.

### Step 6 — Add it to your phone's home screen

- **iPhone (Safari)**: open your link → **Share** → **Add to Home Screen**.
- **Android (Chrome)**: open your link → **⋮** menu → **Add to Home screen** or **Install app**.

Sign in once on each device. You stay signed in.

---

## Everyday use

1. **New quotation** → pick a saved client or type a new one → add items (prices before VAT) → **Save & preview**.
2. **Download PDF** to save it, or **Share** (on a phone) to send it straight to WhatsApp or email.
3. Mark it **Sent**. When the client agrees, mark it **Approved**.
4. Tap **Convert to invoice**. The invoice gets the next invoice number, today's date and a due date, with everything else carried over. Edit it if needed, then download or share.
5. When money arrives, open the invoice → **Edit** → enter **Amount received**. Status changes to Partially Paid or Paid automatically, and the PDF shows the balance due. A paid invoice gets a light "PAID" stamp.

The dashboard shows open quotations, approved quotations not yet invoiced, unpaid balances and payments this month.

## Keeping your data safe

- **Backups**: Settings → **Download backup** saves everything as one `.json` file. Do this monthly and keep it in your email or cloud drive.
- **Free-plan pause**: Supabase pauses free projects after a week with no activity. If the app shows a connection error after a quiet week, open your Supabase dashboard and click **Restore project**, then reload. Using the app at least once a week avoids this; the paid plan never pauses.
- **Privacy**: the database only answers to your signed-in account (row-level security), and sign-ups are disabled. Use a strong password.

## Making changes later

Edit any file on GitHub (pencil icon) and commit. The site updates within a minute or two. If you still see the old version, hard refresh, or on a phone close and reopen the app.

## Optional: your own web address

To use something like `quotes.ectechz.com`: in **Settings → Pages → Custom domain**, enter the address and follow GitHub's instructions to add a `CNAME` record at your domain provider. Tick **Enforce HTTPS** once it is available.

## Troubleshooting

| What you see | What to do |
|---|---|
| Yellow "saved in this browser only" note after Step 4 | `config.js` still has placeholders, or the page is cached. Check the file on GitHub, then hard refresh. |
| "Could not load the Supabase library" | No internet connection, or a network blocking `cdn.jsdelivr.net`. Try another connection. |
| "Email or password is incorrect" | Check Supabase → Authentication → Users. Use **Send password recovery** or delete and re-add the user. |
| Errors mentioning `relation ... does not exist` | `schema.sql` was not run. Repeat Step 3.3. |
| Connection errors after a quiet week | The free project is paused. Restore it in the Supabase dashboard. |
| "That number is already used" | Each quotation and invoice number must be unique. Change the number and save. |
| Page shows a 404 | Make sure `index.html` sits at the top of the repository (not inside a sub-folder) and Pages uses **/ (root)**. |

## Files

```
index.html            App page
manifest.json         Home-screen app settings
css/styles.css        Interface design
js/config.js          Your Supabase URL and key (Step 4)
js/app.js             Screens, editor, status, conversion, backups
js/pdf.js             PDF layout for quotations and invoices
js/calc.js            VAT maths, numbering, amount in words
js/store.js           Saving data (Supabase, or browser storage)
lib/                  pdf-lib (makes PDFs) and pdf.js (previews them), with licences
assets/               Logo and app icons
supabase/schema.sql   Database tables and security rules (Step 3)
```
