# SmartCart

SmartCart is a vanilla HTML/CSS/JavaScript mobile field collector for grocery barcodes and prices. It is intentionally not a React, Next.js, Vue, or Android application.

## Architecture

- IndexedDB (`SmartCartDB`, version 4) remains the offline cache for products, price history, cart, trips, trip items, budget, and the `pendingScans` synchronization queue.
- Supabase is the permanent cloud source of truth for `profiles`, `products`, and `price_observations`.
- A single RPC, `submit_product_scan`, performs an authenticated product upsert plus a new price observation in one database transaction.
- Supabase Auth persists the owner/contributor session in the browser. Cloud writes are unavailable to signed-out users; local scanning remains available.
- BroadcastChannel keeps cart and dashboard updates synchronized between tabs.
- ZXing remains the continuous camera scanner for EAN-8, UPC-A, EAN-13, and GTIN-14-compatible numeric barcodes.

## Supabase project setup

1. Create or select the SmartCart Supabase project. This PR does not apply SQL to any live project or modify production data.
2. Run the migration in `supabase/migrations/20260721000100_smartcart_collector.sql` using the Supabase CLI or SQL editor.
3. Confirm that the Data API exposes the three public tables and RPC, with RLS enabled as included in the migration.
4. Enable email/password authentication in Supabase Auth. Email confirmation may remain enabled for contributor sign-up.
5. Configure the site with only these public browser variables:

   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`

Never put `service_role`, secret keys, database passwords, or Postgres connection strings in this repository, Netlify, or browser code.

## Schema and RLS

The migration creates:

- `profiles`: one row per Auth user, with `role` constrained to `admin` or `contributor`.
- `products`: the shared barcode catalogue and cached latest price fields. Barcodes are limited to 8, 12, 13, or 14 digits and prices must be greater than zero.
- `price_observations`: append-only price history records with retailer, branch, capture time, creator, and source.

RLS is enabled on every public table. Authenticated users can read the catalogue and observations. The RPC is the approved product-creation workflow, while contributors cannot update catalogue rows or delete products. Contributors can manage only their own observation rows; admins can correct products, profiles, and observations. Profile roles are never assigned by browser code. The migration uses a safe `is_admin()` helper and a tightly scoped `SECURITY DEFINER` RPC with an explicit `search_path`, an authentication check, fixed table references, and no dynamic SQL.

### First-admin setup

1. Create the owner account in the SmartCart Authentication screen or Supabase Auth dashboard.
2. Sign in once so the `profiles` trigger creates the contributor profile.
3. In the Supabase SQL editor, run the following with the owner email replaced:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where email = 'joey@example.com');
   ```

4. Sign out and sign back in to refresh the session and confirm the account is ready for collection.

## Netlify and local runtime configuration

`netlify.toml` runs `npm run build` and publishes the repository root. The build script generates the ignored file `js/runtime-config.js` from `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.

For Netlify, set both variables in the `gosmartcart` site environment settings for production and deploy-preview contexts. Do not commit the generated runtime file.

For local development:

```powershell
npm.cmd install
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = "sb_publishable_REPLACE_ME"
npm.cmd run build
python -m http.server 8000
```

Open `http://localhost:8000/pages/index.html`. If the runtime variables are blank, SmartCart intentionally runs in local-only mode. `js/runtime-config.example.js` documents the expected shape.

## Offline scanning and synchronization

Every scan is validated and written to IndexedDB before a Supabase request is attempted. The UI first reports `Saved locally`. The pending row includes a stable `localId`, attempts, status, last error, timestamps, and the cloud observation ID.

- `pending`: waiting for sign-in, connectivity, or retry.
- `syncing`: request in flight.
- `synced`: RPC succeeded and the observation ID is retained locally.
- `failed`: the record is retained with its error for `Retry Sync`.

Pending scans retry after login, page load, the browser `online` event, or the manual Retry Sync button. The local ID becomes a deterministic observation UUID inside the RPC, so a retry cannot create a duplicate observation. Save & Continue leaves the cart unchanged. Save & Add to Cart updates local cart, badge, dashboard, and BroadcastChannel listeners.

Known products show an editable price form; every successful price save creates a new observation and never silently overwrites history.

## Uploading existing local products

`Upload Existing Local Products` is controlled and never runs automatically. It validates local products, deduplicates barcodes, skips demo barcodes `111111`, `222222`, `333333`, and `999999`, skips sample trips `trip001`, `trip002`, and `trip003`, creates one initial migration observation per valid product price, preserves local records, and retains failures for retry. A deterministic `migration-<barcode>` local ID prevents duplicate uploads across retries.

The v4 IndexedDB upgrade removes only those known legacy demo records; it does not delete legitimate user products, prices, trips, or cart records.

## Backup and restore

The Synchronization screen provides:

- Export Local Backup JSON: `products`, `priceHistory`, `pendingScans`, `trips`, and `tripItems`.
- Export Products CSV: local catalogue fields and latest price metadata.
- Import Local Backup JSON: validates every collection, barcode, price, key, status, and duplicate before changing IndexedDB.

Keep backups on a separate device or drive. A local backup protects against browser storage deletion; Supabase protects synchronized records against device loss.

## Field collection workflow

1. Sign in from Authentication before leaving for KCC or SM.
2. Start the camera scanner and hold a supported barcode steady.
3. Complete the unknown-product form, or review the known-product price form.
4. Choose Save & Continue Scanning or Save & Add to Cart.
5. Check the Synchronization screen for pending/failed counts and retry when connected.
6. Export a local backup after each collection session.

Camera permission, unavailable ZXing, invalid barcodes, incomplete fields, invalid prices, authentication requirements, offline saves, duplicate products, and database failures are reported in-page through accessible messages and toasts.

## Deployment verification checklist

- Set the two Netlify environment variables and confirm `npm run build` succeeds.
- Apply the Supabase migration and run the first-admin setup.
- Verify a signed-out browser can scan locally but cannot call the cloud RPC.
- Verify an authenticated owner scan creates one `products` row and one `price_observations` row.
- Turn off connectivity, save a scan, reload, reconnect, and use Retry Sync.
- Confirm repeated retry does not increase observation count twice.
- Confirm Save & Continue does not change the cart and Save & Add does.
- Verify a second browser sees synchronized products after login.
- Verify the export contains pending and synced local rows.
- Test camera permissions and mobile navigation at narrow width.

## Rollback

Rollback the Netlify deploy or revert the PR commit. Do not delete Supabase tables or records as a rollback step. If the migration must be removed, first export the cloud catalogue and observations, then coordinate a reviewed reverse migration in Supabase. Existing v3 local stores are preserved by the v4 upgrade; the app can be rolled back to the previous static bundle without deleting IndexedDB data, but the new pending queue will remain unused until the collector bundle is restored.

## Known limitations

- Supabase project setup and first-admin assignment require the owner because this PR does not have a confirmed SmartCart Supabase project reference and must not modify production data.
- Cart, trips, budget, and analytics remain local by design in this PR.
- Browser camera hardware and Auth email delivery must be tested on the collector phone and Supabase project.
- Anonymous contributor authentication is prepared by the RLS/auth boundary but is intentionally not enabled as the only owner login method.
