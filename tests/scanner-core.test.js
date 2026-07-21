const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createBarcodeConfirmer,
    lookupProductAnywhere,
    normalizeCloudProduct
} = require("../js/scanner-core.js");

test("one transient read does not confirm", () => {
    const confirmer = createBarcodeConfirmer({ windowMs: 1500 });
    const result = confirmer.observe("4801234567890", 1000);
    assert.equal(result.confirmed, false);
    assert.equal(result.count, 1);
});

test("two consecutive matching reads within 1.5 seconds confirm", () => {
    const confirmer = createBarcodeConfirmer({ windowMs: 1500 });
    confirmer.observe("4801234567890", 1000);
    const result = confirmer.observe("4801234567890", 2200);
    assert.equal(result.confirmed, true);
    assert.equal(result.barcode, "4801234567890");
});

test("a conflicting read restarts confirmation", () => {
    const confirmer = createBarcodeConfirmer({ windowMs: 1500 });
    confirmer.observe("4801234567890", 1000);
    const conflict = confirmer.observe("4801234567891", 1200);
    assert.equal(conflict.confirmed, false);
    assert.equal(conflict.candidate, "4801234567891");
    assert.equal(conflict.count, 1);
    assert.equal(confirmer.observe("4801234567891", 1400).confirmed, true);
});

test("an expired candidate cannot confirm", () => {
    const confirmer = createBarcodeConfirmer({ windowMs: 1500 });
    confirmer.observe("12345678", 1000);
    const result = confirmer.observe("12345678", 2601);
    assert.equal(result.confirmed, false);
    assert.equal(result.count, 1);
});

test("local lookup returns immediately without querying cloud", async () => {
    let cloudCalls = 0;
    const local = { barcode: "12345678", name: "Local product" };
    const result = await lookupProductAnywhere("12345678", {
        findLocal: async () => local,
        canUseCloud: () => true,
        findCloud: async () => { cloudCalls += 1; return null; },
        cacheLocal: async () => {}
    });
    assert.equal(result.product, local);
    assert.equal(result.source, "Local");
    assert.equal(cloudCalls, 0);
});

test("cloud fallback normalizes and caches an exact product", async () => {
    let cached = null;
    const cloudRow = {
        barcode: "4801234567890",
        name: "Cloud product",
        brand: "Brand",
        category: "Snacks",
        size: "100",
        unit: "g",
        last_price: "49.50",
        last_retailer: "SM",
        last_branch: "Main",
        last_price_at: "2026-07-21T10:00:00Z",
        created_at: "2026-07-20T10:00:00Z",
        updated_at: "2026-07-21T10:00:00Z"
    };
    const result = await lookupProductAnywhere(cloudRow.barcode, {
        findLocal: async () => null,
        canUseCloud: () => true,
        findCloud: async (barcode) => barcode === cloudRow.barcode ? cloudRow : null,
        cacheLocal: async (product) => { cached = product; }
    });
    assert.equal(result.source, "Cloud");
    assert.deepEqual(result.product, normalizeCloudProduct(cloudRow));
    assert.deepEqual(cached, result.product);
});

test("cloud failure remains a non-destructive new-product result", async () => {
    const result = await lookupProductAnywhere("4801234567890", {
        findLocal: async () => null,
        canUseCloud: () => true,
        findCloud: async () => { throw new Error("offline"); },
        cacheLocal: async () => assert.fail("must not cache")
    });
    assert.equal(result.product, null);
    assert.equal(result.source, "New");
    assert.match(result.error.message, /offline/);
});

test("scanner markup keeps metadata collapsed and add-to-cart explicit", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "pages", "scanner.html"), "utf8");
    const scanner = fs.readFileSync(path.join(__dirname, "..", "js", "scanner.js"), "utf8");
    assert.match(html, /<details[^>]+id="unknownOptionalDetails"/);
    assert.match(html, /Optional product details/);
    assert.match(html, /<details[^>]+id="knownEditDetails"/);
    assert.match(html, /Add to cart after saving/);
    assert.doesNotMatch(html, /id="unknownCategory"[^>]+required/);
    assert.doesNotMatch(scanner, /\b(?:alert|confirm)\s*\(/);
});

test("forward migration fixes category qualification and defaults blanks", () => {
    const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "20260721000200_fix_submit_product_scan_category.sql"), "utf8");
    assert.match(sql, /submit_product_scan\.category/);
    assert.match(sql, /Uncategorized/);
    assert.match(sql, /on conflict \(id\) do nothing/i);
});
