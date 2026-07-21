/* SmartCart shared runtime: IndexedDB cache, offline queue, auth and local features. */
const DB_NAME = "SmartCartDB";
const DB_VERSION = 4;
const DEMO_BARCODES = new Set(["111111", "222222", "333333", "999999"]);
const DEMO_TRIPS = new Set(["trip001", "trip002", "trip003"]);
const pesoFormatter = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

let db = null;
let authSession = null;
let syncInFlight = null;
let syncSubscription = null;
let lastCloudLookupNoticeAt = 0;
let resolveDbReady;
const dbReady = new Promise((resolve) => { resolveDbReady = resolve; });
const cartChannel = "BroadcastChannel" in window ? new BroadcastChannel("smartcart") : null;

function formatPHP(value) {
    const numeric = Number(value);
    return pesoFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showToast(message, type = "info") {
    let toast = document.querySelector("[data-toast]");
    if (!toast) {
        toast = document.createElement("div");
        toast.dataset.toast = "";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function confirmAction(message, title = "Please confirm") {
    return new Promise((resolve) => {
        const dialog = document.createElement("div");
        dialog.className = "confirm-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.innerHTML = `
            <div class="confirm-dialog__body">
                <h2>${escapeHtml(title)}</h2>
                <p>${escapeHtml(message)}</p>
                <div class="button-row">
                    <button data-confirm="cancel" class="button button-secondary" type="button">Cancel</button>
                    <button data-confirm="confirm" class="button button-danger" type="button">Continue</button>
                </div>
            </div>`;
        document.body.appendChild(dialog);
        const finish = (accepted) => {
            resolve(accepted);
            dialog.remove();
        };
        dialog.querySelector('[data-confirm="cancel"]').addEventListener("click", () => finish(false), { once: true });
        dialog.querySelector('[data-confirm="confirm"]').addEventListener("click", () => finish(true), { once: true });
    });
}

function validateBarcode(value) {
    const barcode = String(value ?? "").trim();
    return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(barcode) ? barcode : null;
}

function validateScan(scan) {
    const barcode = validateBarcode(scan.barcode);
    const price = Number(scan.price);
    const errors = [];
    if (!barcode) errors.push("Barcode must contain exactly 8, 12, 13, or 14 digits.");
    if (!String(scan.name ?? "").trim()) errors.push("Product name is required.");
    if (!Number.isFinite(price) || price <= 0) errors.push("Price must be greater than zero.");
    if (!String(scan.retailer ?? "").trim()) errors.push("Retailer is required.");
    if (!String(scan.branch ?? "").trim()) errors.push("Branch is required.");
    return { valid: errors.length === 0, errors, barcode, price };
}

function newLocalId(prefix = "scan") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requestPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
}

function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
}

function readAll(storeName) {
    return dbReady.then(() => requestPromise(db.transaction(storeName, "readonly").objectStore(storeName).getAll()));
}

function normalizeProduct(product) {
    return {
        ...product,
        barcode: String(product.barcode ?? "").trim(),
        name: String(product.name ?? "").trim(),
        brand: String(product.brand ?? "").trim(),
        category: String(product.category ?? "").trim(),
        size: String(product.size ?? "").trim(),
        unit: String(product.unit ?? "").trim(),
        lastPrice: Number(product.lastPrice ?? product.price),
        lastRetailer: String(product.lastRetailer ?? product.retailer ?? "").trim(),
        lastBranch: String(product.lastBranch ?? product.branch ?? "").trim(),
        lastPriceAt: product.lastPriceAt ?? product.updatedAt ?? new Date().toISOString(),
        createdAt: product.createdAt ?? new Date().toISOString(),
        updatedAt: product.updatedAt ?? new Date().toISOString()
    };
}

function broadcast(type = "data-updated") {
    cartChannel?.postMessage({ type, time: Date.now() });
}

async function removeLegacyDemoData() {
    const products = await readAll("products");
    const trips = await readAll("trips");
    const demoProductBarcodes = products.filter((product) => DEMO_BARCODES.has(String(product.barcode))).map((product) => product.barcode);
    const demoTripIds = trips.filter((trip) => DEMO_TRIPS.has(String(trip.tripId))).map((trip) => trip.tripId);
    if (!demoProductBarcodes.length && !demoTripIds.length) return;
    const stores = [];
    if (demoProductBarcodes.length) stores.push("products", "priceHistory", "pendingScans");
    if (demoTripIds.length) stores.push("trips", "tripItems");
    const transaction = db.transaction([...new Set(stores)], "readwrite");
    if (demoProductBarcodes.length) {
        const productStore = transaction.objectStore("products");
        const historyStore = transaction.objectStore("priceHistory");
        const pendingStore = transaction.objectStore("pendingScans");
        const [history, pending] = await Promise.all([
            requestPromise(historyStore.getAll()),
            requestPromise(pendingStore.getAll())
        ]);
        demoProductBarcodes.forEach((barcode) => productStore.delete(barcode));
        history.filter((row) => demoProductBarcodes.includes(row.barcode)).forEach((row) => historyStore.delete(row.id));
        pending.filter((row) => demoProductBarcodes.includes(row.barcode)).forEach((row) => pendingStore.delete(row.localId));
    }
    if (demoTripIds.length) {
        const tripStore = transaction.objectStore("trips");
        const itemStore = transaction.objectStore("tripItems");
        const items = await requestPromise(itemStore.getAll());
        demoTripIds.forEach((tripId) => tripStore.delete(tripId));
        items.filter((item) => demoTripIds.includes(item.tripId)).forEach((item) => itemStore.delete(item.id));
    }
    await transactionPromise(transaction);
}

function openDatabase() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains("products")) {
            const products = database.createObjectStore("products", { keyPath: "barcode" });
            products.createIndex("name", "name", { unique: false });
        }
        if (!database.objectStoreNames.contains("trips")) database.createObjectStore("trips", { keyPath: "tripId" });
        if (!database.objectStoreNames.contains("tripItems")) database.createObjectStore("tripItems", { keyPath: "id", autoIncrement: true });
        if (!database.objectStoreNames.contains("budget")) database.createObjectStore("budget", { keyPath: "id" });
        if (!database.objectStoreNames.contains("priceHistory")) database.createObjectStore("priceHistory", { keyPath: "id", autoIncrement: true });
        if (!database.objectStoreNames.contains("cart")) database.createObjectStore("cart", { keyPath: "id", autoIncrement: true });
        if (!database.objectStoreNames.contains("pendingScans")) {
            const pending = database.createObjectStore("pendingScans", { keyPath: "localId" });
            pending.createIndex("syncStatus", "syncStatus", { unique: false });
            pending.createIndex("barcode", "barcode", { unique: false });
            pending.createIndex("updatedAt", "updatedAt", { unique: false });
        }
    };
    request.onerror = () => {
        showToast("Local storage is unavailable. Scans cannot be protected offline.", "error");
        resolveDbReady();
    };
    request.onsuccess = async () => {
        db = request.result;
        window.db = db;
        db.onversionchange = () => db.close();
        resolveDbReady();
        try { await removeLegacyDemoData(); } catch (error) { console.warn("Legacy demo cleanup skipped", error); }
        void initializeAuth().catch((error) => console.warn("Auth initialization skipped", error));
        void refreshSyncSummary();
        void updateCartBadge();
        void updateHomeDashboard();
    };
}

async function getSupabaseSession() {
    const supabase = window.smartCartSupabase?.client;
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
}

function setAccountUi() {
    const statusElements = document.querySelectorAll("[data-account-status]");
    const userLabel = authSession?.user?.email || "Not signed in";
    statusElements.forEach((element) => { element.textContent = userLabel; });
    document.querySelectorAll("[data-auth-required]").forEach((element) => {
        element.hidden = Boolean(authSession);
    });
    document.querySelectorAll("[data-signed-in-only]").forEach((element) => {
        element.hidden = !authSession;
    });
}

async function initializeAuth() {
    const supabase = window.smartCartSupabase?.client;
    setAccountUi();
    if (!supabase) {
        document.querySelectorAll("[data-connection-state]").forEach((element) => { element.textContent = "Local-only mode"; });
        return;
    }
    const { data } = await supabase.auth.getSession();
    authSession = data.session;
    setAccountUi();
    syncSubscription?.unsubscribe();
    syncSubscription = supabase.auth.onAuthStateChange((_event, session) => {
        authSession = session;
        setAccountUi();
        window.setTimeout(() => {
            void refreshSyncSummary();
            if (session) void syncPendingScans();
        }, 0);
    }).data.subscription;
    if (authSession) void syncPendingScans();
    void refreshSyncSummary();
}

async function saveLocalScan(input) {
    await dbReady;
    if (!db) throw new Error("Local database unavailable");
    const result = validateScan(input);
    if (!result.valid) throw new Error(result.errors.join(" "));
    const now = new Date().toISOString();
    const localId = input.localId || newLocalId();
    const capturedAt = input.capturedAt || now;
    const scan = {
        localId,
        barcode: result.barcode,
        name: String(input.name).trim(),
        brand: String(input.brand ?? "").trim(),
        category: String(input.category ?? "").trim() || "Uncategorized",
        size: String(input.size ?? "").trim(),
        unit: String(input.unit ?? "").trim(),
        price: result.price,
        retailer: String(input.retailer).trim(),
        branch: String(input.branch).trim(),
        capturedAt,
        source: String(input.source || "scanner"),
        syncStatus: "pending",
        syncAttempts: Number(input.syncAttempts || 0),
        lastSyncError: null,
        cloudObservationId: input.cloudObservationId || null,
        createdAt: input.createdAt || now,
        updatedAt: now
    };
    const transaction = db.transaction(["products", "priceHistory", "pendingScans"], "readwrite");
    const productsStore = transaction.objectStore("products");
    const historyStore = transaction.objectStore("priceHistory");
    const pendingStore = transaction.objectStore("pendingScans");
    const existing = await requestPromise(productsStore.get(scan.barcode));
    const existingProduct = existing ? normalizeProduct(existing) : null;
    const product = {
        ...(existingProduct || {}),
        barcode: scan.barcode,
        name: existingProduct?.name || scan.name,
        brand: existingProduct?.brand || scan.brand,
        category: existingProduct?.category || scan.category,
        size: existingProduct?.size || scan.size,
        unit: existingProduct?.unit || scan.unit,
        lastPrice: scan.price,
        lastRetailer: scan.retailer,
        lastBranch: scan.branch,
        lastPriceAt: scan.capturedAt,
        createdAt: existingProduct?.createdAt || now,
        updatedAt: now
    };
    productsStore.put(product);
    historyStore.add({
        localId,
        barcode: scan.barcode,
        name: product.name,
        oldPrice: existingProduct?.lastPrice,
        newPrice: scan.price,
        change: Number.isFinite(existingProduct?.lastPrice) && existingProduct.lastPrice > 0
            ? ((scan.price - existingProduct.lastPrice) / existingProduct.lastPrice) * 100
            : 0,
        price: scan.price,
        retailer: scan.retailer,
        branch: scan.branch,
        capturedAt: scan.capturedAt,
        createdAt: now
    });
    pendingStore.put(scan);
    await transactionPromise(transaction);
    broadcast("data-updated");
    return scan;
}

async function getPendingScan(localId) {
    await dbReady;
    return requestPromise(db.transaction("pendingScans", "readonly").objectStore("pendingScans").get(localId));
}

async function updatePendingScan(localId, updates) {
    await dbReady;
    const transaction = db.transaction("pendingScans", "readwrite");
    const store = transaction.objectStore("pendingScans");
    const current = await requestPromise(store.get(localId));
    if (!current) return null;
    const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
    store.put(next);
    await transactionPromise(transaction);
    return next;
}

async function markHistorySynced(localId, observationId) {
    await dbReady;
    const transaction = db.transaction("priceHistory", "readwrite");
    const store = transaction.objectStore("priceHistory");
    const history = await requestPromise(store.getAll());
    history.filter((row) => row.localId === localId).forEach((row) => {
        row.cloudObservationId = observationId;
        store.put(row);
    });
    await transactionPromise(transaction);
}

async function syncOneScan(scan) {
    const supabase = window.smartCartSupabase?.client;
    if (!supabase || !authSession) return { status: "pending", error: "Authentication required" };
    if (!navigator.onLine) return { status: "pending", error: "Offline" };
    await updatePendingScan(scan.localId, { syncStatus: "syncing", syncAttempts: Number(scan.syncAttempts || 0) + 1, lastSyncError: null });
    const { data, error } = await supabase.rpc("submit_product_scan", {
        barcode: scan.barcode,
        name: scan.name,
        brand: scan.brand || null,
        category: scan.category || "Uncategorized",
        size: scan.size || null,
        unit: scan.unit || null,
        price: scan.price,
        retailer: scan.retailer,
        branch: scan.branch,
        captured_at: scan.capturedAt,
        source: scan.source || "scanner",
        local_id: scan.localId
    });
    if (error) {
        await updatePendingScan(scan.localId, { syncStatus: "failed", lastSyncError: error.message || "Database synchronization failed" });
        return { status: "failed", error: error.message || "Database synchronization failed" };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const observationId = row?.price_observation_id || null;
    await updatePendingScan(scan.localId, { syncStatus: "synced", lastSyncError: null, cloudObservationId: observationId });
    await markHistorySynced(scan.localId, observationId);
    localStorage.setItem("smartcart.lastSuccessfulSyncAt", new Date().toISOString());
    return { status: "synced", observationId };
}

async function syncPendingScans(options = {}) {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
        try {
            const supabase = window.smartCartSupabase?.client;
            if (!supabase || !authSession || !navigator.onLine) return [];
            const pending = await readAll("pendingScans");
            const candidates = pending.filter((scan) =>
                (options.onlyLocalId ? scan.localId === options.onlyLocalId : scan.syncStatus === "pending")
                && scan.syncStatus !== "synced"
            );
            const results = [];
            for (const scan of candidates) results.push(await syncOneScan(scan));
            await refreshSyncSummary();
            return results;
        } catch (error) {
            console.warn("Synchronization failed", error);
            return [];
        } finally {
            syncInFlight = null;
        }
    })();
    return syncInFlight;
}

async function retrySync() {
    await dbReady;
    const transaction = db.transaction("pendingScans", "readwrite");
    const store = transaction.objectStore("pendingScans");
    const scans = await requestPromise(store.getAll());
    scans.filter((scan) => scan.syncStatus === "failed").forEach((scan) => {
        scan.syncStatus = "pending";
        scan.lastSyncError = null;
        scan.updatedAt = new Date().toISOString();
        store.put(scan);
    });
    await transactionPromise(transaction);
    const results = await syncPendingScans();
    await refreshSyncSummary();
    return results;
}

async function saveAndSyncScan(scan, addToCart = false) {
    const saved = await saveLocalScan(scan);
    showToast("Saved locally", "success");
    if (addToCart) await addToCartByBarcode(saved.barcode);
    const results = await syncPendingScans({ onlyLocalId: saved.localId });
    const current = await getPendingScan(saved.localId);
    const result = results[0];
    if (current?.syncStatus === "synced" || result?.status === "synced") showToast("Saved to cloud", "success");
    else if (current?.syncStatus === "failed" || result?.status === "failed") showToast("Synchronization failed — record retained locally", "error");
    else showToast("Saved offline — synchronization pending", "warning");
    return { ...saved, syncStatus: current?.syncStatus || "pending" };
}

async function getCloudProductCount() {
    const supabase = window.smartCartSupabase?.client;
    if (!supabase || !authSession || !navigator.onLine) return null;
    const { count, error } = await supabase.from("products").select("barcode", { count: "exact", head: true });
    if (error) return null;
    return count ?? 0;
}

async function refreshSyncSummary() {
    if (!db) return;
    const products = await readAll("products");
    const pending = await readAll("pendingScans");
    const cloudCount = await getCloudProductCount();
    const state = window.smartCartSupabase?.configured
        ? (authSession ? (navigator.onLine ? "Connected" : "Offline") : "Sign in required")
        : "Local-only mode";
    document.querySelectorAll("[data-connection-state]").forEach((element) => { element.textContent = state; });
    document.querySelectorAll("[data-local-product-count]").forEach((element) => { element.textContent = String(products.length); });
    document.querySelectorAll("[data-cloud-product-count]").forEach((element) => { element.textContent = cloudCount === null ? "—" : String(cloudCount); });
    document.querySelectorAll("[data-pending-count]").forEach((element) => { element.textContent = String(pending.filter((row) => row.syncStatus === "pending" || row.syncStatus === "syncing").length); });
    document.querySelectorAll("[data-failed-count]").forEach((element) => { element.textContent = String(pending.filter((row) => row.syncStatus === "failed").length); });
    const lastSync = localStorage.getItem("smartcart.lastSuccessfulSyncAt");
    document.querySelectorAll("[data-last-sync]").forEach((element) => { element.textContent = lastSync ? new Date(lastSync).toLocaleString() : "Not yet"; });
    setAccountUi();
}

async function saveProduct(product) {
    return saveLocalScan({
        barcode: product.barcode,
        name: product.name,
        brand: product.brand,
        category: product.category,
        size: product.size,
        unit: product.unit,
        price: product.lastPrice ?? product.price,
        retailer: product.lastRetailer || product.retailer || "KCC",
        branch: product.lastBranch || product.branch || "Main",
        source: product.source || "manual"
    });
}

async function addProduct(product) {
    return saveProduct(product);
}

async function findProduct(barcode) {
    await dbReady;
    if (!db) return null;
    const product = await requestPromise(db.transaction("products", "readonly").objectStore("products").get(String(barcode).trim()));
    return product ? normalizeProduct(product) : null;
}

async function cacheProduct(product) {
    await dbReady;
    if (!db) throw new Error("Local database unavailable");
    const transaction = db.transaction("products", "readwrite");
    const store = transaction.objectStore("products");
    const existing = await requestPromise(store.get(product.barcode));
    const cached = normalizeProduct({ ...(existing || {}), ...product });
    store.put(cached);
    await transactionPromise(transaction);
    broadcast("data-updated");
    return cached;
}

async function findProductAnywhere(barcode) {
    const lookup = window.smartCartScannerCore?.lookupProductAnywhere;
    if (!lookup) {
        const local = await findProduct(barcode);
        return local ? { ...local, lookupSource: "Local" } : null;
    }

    const supabase = window.smartCartSupabase?.client;
    const result = await lookup(barcode, {
        findLocal: findProduct,
        canUseCloud: () => Boolean(window.smartCartSupabase?.configured && supabase && navigator.onLine && authSession),
        findCloud: async (exactBarcode) => {
            const { data, error } = await supabase
                .from("products")
                .select("barcode,name,brand,category,size,unit,last_price,last_retailer,last_branch,last_price_at,created_at,updated_at")
                .eq("barcode", exactBarcode)
                .maybeSingle();
            if (error) throw error;
            return data;
        },
        cacheLocal: cacheProduct
    });

    if (result.error && Date.now() - lastCloudLookupNoticeAt > 30000) {
        lastCloudLookupNoticeAt = Date.now();
        showToast("Cloud lookup unavailable — continuing with local scanning", "warning");
    }
    return result.product ? { ...result.product, lookupSource: result.source } : null;
}

async function updateProductPrice(barcode, price, details = {}) {
    const product = await findProduct(barcode);
    if (!product) throw new Error("Product not found");
    return saveAndSyncScan({
        barcode,
        name: details.name || product.name,
        brand: details.brand || product.brand,
        category: details.category || product.category,
        size: details.size || product.size,
        unit: details.unit || product.unit,
        price,
        retailer: details.retailer || product.lastRetailer || "KCC",
        branch: details.branch || product.lastBranch || "Main",
        source: "scanner"
    });
}

async function addToCartByBarcode(barcode) {
    const product = await findProduct(barcode);
    if (!product) throw new Error("Product not found in local catalog");
    await dbReady;
    const transaction = db.transaction("cart", "readwrite");
    const store = transaction.objectStore("cart");
    const items = await requestPromise(store.getAll());
    const existing = items.find((item) => item.barcode === product.barcode);
    if (existing) {
        existing.quantity = Number(existing.quantity || 0) + 1;
        store.put(existing);
    } else {
        store.add({ barcode: product.barcode, name: product.name, price: Number(product.lastPrice) || 0, quantity: 1 });
    }
    await transactionPromise(transaction);
    broadcast("cart-updated");
    await updateCartBadge();
    await updateHomeDashboard();
}

async function getCartItems() { return readAll("cart"); }
async function updateCartBadge() {
    if (!db) return;
    const items = await getCartItems();
    const count = items.reduce((total, item) => total + Number(item.quantity || 0), 0);
    document.querySelectorAll("#cartBadge, [data-cart-badge]").forEach((element) => { element.textContent = `🛒 Cart (${count})`; });
}

async function updateHomeDashboard() {
    if (!db) return;
    const items = await getCartItems();
    const count = items.reduce((total, item) => total + Number(item.quantity || 0), 0);
    const total = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
    const countElement = document.getElementById("dashboardItems");
    const totalElement = document.getElementById("dashboardTotal");
    if (countElement) countElement.textContent = String(count);
    if (totalElement) totalElement.textContent = formatPHP(total);
}

async function deleteCartItem(id) {
    await dbReady;
    const transaction = db.transaction("cart", "readwrite");
    transaction.objectStore("cart").delete(Number(id));
    await transactionPromise(transaction);
    broadcast("cart-updated");
}

async function increaseCartQuantity(id) {
    await changeCartQuantity(id, 1);
}

async function decreaseCartQuantity(id) {
    await changeCartQuantity(id, -1);
}

async function changeCartQuantity(id, delta) {
    await dbReady;
    const transaction = db.transaction("cart", "readwrite");
    const store = transaction.objectStore("cart");
    const item = await requestPromise(store.get(Number(id)));
    if (item) {
        item.quantity = Number(item.quantity || 0) + delta;
        if (item.quantity <= 0) store.delete(Number(id)); else store.put(item);
    }
    await transactionPromise(transaction);
    broadcast("cart-updated");
}

async function clearCart() {
    await dbReady;
    const transaction = db.transaction("cart", "readwrite");
    transaction.objectStore("cart").clear();
    await transactionPromise(transaction);
    broadcast("cart-updated");
}

async function checkoutCart() {
    const items = await getCartItems();
    if (!items.length) { showToast("Your cart is empty", "warning"); return; }
    const total = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
    const tripId = `trip-${Date.now()}`;
    const transaction = db.transaction(["trips", "tripItems"], "readwrite");
    transaction.objectStore("trips").add({ tripId, date: new Date().toISOString(), total });
    const itemsStore = transaction.objectStore("tripItems");
    items.forEach((item) => itemsStore.add({ tripId, barcode: item.barcode, name: item.name, quantity: item.quantity, unitPrice: item.price, total: item.price * item.quantity }));
    await transactionPromise(transaction);
    await clearCart();
    showToast(`Trip saved — ${formatPHP(total)}`, "success");
    await updateCartBadge();
    await updateHomeDashboard();
}

async function getTripItems(tripId) {
    const items = await readAll("tripItems");
    return items.filter((item) => item.tripId === tripId);
}

async function saveTrip(trip) {
    await dbReady;
    const transaction = db.transaction("trips", "readwrite");
    transaction.objectStore("trips").put(trip);
    return transactionPromise(transaction);
}

async function savePriceHistory(data) {
    await dbReady;
    const transaction = db.transaction("priceHistory", "readwrite");
    transaction.objectStore("priceHistory").add(data);
    return transactionPromise(transaction);
}

async function getPriceHistory() { return readAll("priceHistory"); }

async function getMonthlySpending() {
    const trips = await readAll("trips");
    return trips.reduce((result, trip) => {
        const month = String(trip.date || "").slice(0, 7) || "Unknown";
        result[month] = (result[month] || 0) + (Number(trip.total) || 0);
        return result;
    }, {});
}

async function getCategorySpending() {
    const items = await readAll("tripItems");
    const products = await readAll("products");
    const byBarcode = new Map(products.map((product) => [product.barcode, product.category || "Uncategorized"]));
    return items.reduce((result, item) => {
        const category = byBarcode.get(item.barcode) || "Uncategorized";
        result[category] = (result[category] || 0) + (Number(item.total) || 0);
        return result;
    }, {});
}

async function getInflationStats() {
    const history = await getPriceHistory();
    const changes = history.filter((item) => Number.isFinite(Number(item.change)) && item.oldPrice > 0);
    const sorted = [...changes].sort((a, b) => Number(b.change) - Number(a.change));
    return { overall: changes.length ? changes.reduce((sum, item) => sum + Number(item.change), 0) / changes.length : 0, highestIncrease: sorted[0] || null, highestDecrease: sorted[sorted.length - 1] || null, totalChanges: changes.length };
}

async function getPriceInsights() {
    const stats = await getInflationStats();
    return { biggestIncrease: stats.highestIncrease || { name: "N/A", change: 0 }, biggestDecrease: stats.highestDecrease || { name: "N/A", change: 0 }, totalChanges: stats.totalChanges };
}

async function getPriceAlerts() { return []; }
async function getRecommendations() { return []; }
async function getInflationLeaderboard() { const history = await getPriceHistory(); return history.filter((item) => item.oldPrice > 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10); }

async function getBudget() { const rows = await readAll("budget"); return rows[0] || null; }
async function setBudget(amount) { const transaction = db.transaction("budget", "readwrite"); transaction.objectStore("budget").put({ id: "current", amount: Number(amount) }); return transactionPromise(transaction); }
async function deleteBudget() { const transaction = db.transaction("budget", "readwrite"); transaction.objectStore("budget").delete("current"); return transactionPromise(transaction); }

function validLocalProduct(product) {
    const check = validateScan({ ...product, price: product.lastPrice ?? product.price, retailer: product.lastRetailer || "KCC", branch: product.lastBranch || "Main" });
    return check.valid;
}

async function setProductMigrationStatus(barcode, patch) {
    const product = await findProduct(barcode);
    if (!product) return;
    const transaction = db.transaction("products", "readwrite");
    transaction.objectStore("products").put({ ...product, ...patch, updatedAt: new Date().toISOString() });
    await transactionPromise(transaction);
}

async function migrateLocalProducts() {
    const products = await readAll("products");
    const seen = new Set();
    const totals = { migrated: 0, skipped: 0, failed: 0 };
    for (const sourceProduct of products) {
        const product = normalizeProduct(sourceProduct);
        if (DEMO_BARCODES.has(product.barcode) || seen.has(product.barcode)) { totals.skipped += 1; continue; }
        seen.add(product.barcode);
        if (!validLocalProduct(product)) { totals.failed += 1; continue; }
        let pending = product.migrationLocalId ? await getPendingScan(product.migrationLocalId) : null;
        if (pending?.syncStatus === "synced" || product.migrationStatus === "synced") { totals.skipped += 1; continue; }
        try {
            if (!pending) {
                const localId = product.migrationLocalId || `migration-${product.barcode}`;
                await setProductMigrationStatus(product.barcode, { migrationLocalId: localId, migrationStatus: "pending" });
                await saveLocalScan({
                    localId,
                    barcode: product.barcode,
                    name: product.name,
                    brand: product.brand,
                    category: product.category,
                    size: product.size,
                    unit: product.unit,
                    price: product.lastPrice,
                    retailer: product.lastRetailer || "KCC",
                    branch: product.lastBranch || "Main",
                    capturedAt: product.lastPriceAt,
                    source: "local-migration"
                });
                pending = await getPendingScan(localId);
            }
            await syncPendingScans({ onlyLocalId: pending.localId });
            pending = await getPendingScan(pending.localId);
            if (pending?.syncStatus === "synced") {
                await setProductMigrationStatus(product.barcode, { migrationStatus: "synced", migrationObservationId: pending.cloudObservationId });
                totals.migrated += 1;
            } else {
                totals.failed += 1;
            }
        } catch (error) {
            console.warn("Local product migration failed", product.barcode, error);
            totals.failed += 1;
        }
    }
    await refreshSyncSummary();
    return totals;
}

async function exportLocalBackup() {
    const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        products: await readAll("products"),
        priceHistory: await readAll("priceHistory"),
        pendingScans: await readAll("pendingScans"),
        trips: await readAll("trips"),
        tripItems: await readAll("tripItems")
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `smartcart-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Local backup exported", "success");
}

async function exportProductsCsv() {
    const products = await readAll("products");
    const fields = ["barcode", "name", "brand", "category", "size", "unit", "lastPrice", "lastRetailer", "lastBranch", "lastPriceAt"];
    const csv = [fields.join(","), ...products.map((product) => fields.map((field) => `"${String(product[field] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `smartcart-products-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Products CSV exported", "success");
}

function validateBackup(backup) {
    const collections = ["products", "priceHistory", "pendingScans", "trips", "tripItems"];
    if (!backup || typeof backup !== "object" || collections.some((name) => !Array.isArray(backup[name]))) throw new Error("Backup must contain products, priceHistory, pendingScans, trips, and tripItems arrays.");
    const barcodes = new Set();
    backup.products.forEach((product) => {
        const barcode = validateBarcode(product.barcode);
        if (!barcode || !String(product.name || "").trim() || !String(product.category || "").trim()) throw new Error("Backup contains an invalid product.");
        if (barcodes.has(barcode)) throw new Error(`Backup contains duplicate barcode ${barcode}.`);
        barcodes.add(barcode);
        if (product.lastPrice != null && (!Number.isFinite(Number(product.lastPrice)) || Number(product.lastPrice) <= 0)) throw new Error(`Backup contains an invalid price for ${barcode}.`);
    });
    backup.pendingScans.forEach((scan) => {
        if (!scan.localId || !validateBarcode(scan.barcode) || !["pending", "syncing", "synced", "failed"].includes(scan.syncStatus)) throw new Error("Backup contains an invalid pending scan.");
    });
    backup.trips.forEach((trip) => { if (!trip.tripId) throw new Error("Backup contains an invalid trip."); });
    return true;
}

async function importLocalBackup(backup) {
    validateBackup(backup);
    const transaction = db.transaction(["products", "priceHistory", "pendingScans", "trips", "tripItems"], "readwrite");
    const stores = Object.fromEntries(["products", "priceHistory", "pendingScans", "trips", "tripItems"].map((name) => [name, transaction.objectStore(name)]));
    backup.products.forEach((item) => stores.products.put(normalizeProduct(item)));
    backup.priceHistory.forEach((item) => stores.priceHistory.put(item));
    backup.pendingScans.forEach((item) => stores.pendingScans.put(item));
    backup.trips.forEach((item) => stores.trips.put(item));
    backup.tripItems.forEach((item) => stores.tripItems.put(item));
    await transactionPromise(transaction);
    await refreshSyncSummary();
    showToast("Backup imported locally", "success");
}

function setActiveNavigation() {
    const page = location.pathname.split("/").pop() || "index.html";
    const morePages = new Set(["sync.html", "auth.html", "analytics.html", "trip-history.html", "trip-details.html"]);
    document.querySelectorAll("[data-nav-page]").forEach((link) => {
        const isActive = link.dataset.navPage === page || (page === "index.html" && link.dataset.navPage === "home") || (morePages.has(page) && link.dataset.navPage === "sync");
        link.classList.toggle("active", isActive);
    });
}

if (cartChannel) cartChannel.addEventListener("message", () => { void updateCartBadge(); void updateHomeDashboard(); });
window.addEventListener("online", () => { void syncPendingScans(); void refreshSyncSummary(); showToast("Connection restored — syncing pending scans", "info"); });
window.addEventListener("offline", () => { void refreshSyncSummary(); showToast("Offline mode — scans will stay on this device", "warning"); });
window.addEventListener("unhandledrejection", (event) => { event.preventDefault(); console.warn("Handled SmartCart promise rejection", event.reason); showToast("SmartCart could not complete that action.", "error"); });
window.addEventListener("error", (event) => { if (event.error) console.warn("Handled SmartCart error", event.error); });
document.addEventListener("DOMContentLoaded", () => { setActiveNavigation(); void refreshSyncSummary(); });

window.smartCart = {
    dbReady,
    addProduct,
    findProduct,
    findProductAnywhere,
    saveLocalScan,
    saveAndSyncScan,
    syncPendingScans,
    retrySync,
    migrateLocalProducts,
    exportLocalBackup,
    exportProductsCsv,
    importLocalBackup,
    updateProductPrice,
    addToCart: addToCartByBarcode,
    addToCartByBarcode,
    getCartItems,
    updateCartBadge,
    updateHomeDashboard,
    increaseCartQuantity: increaseCartQuantity,
    decreaseCartQuantity: decreaseCartQuantity,
    deleteCartItem,
    clearCart,
    checkoutCart,
    getTripItems,
    saveTrip,
    savePriceHistory,
    getPriceHistory,
    getInflationStats,
    getPriceInsights,
    getMonthlySpending,
    getCategorySpending,
    getPriceAlerts,
    getRecommendations,
    getInflationLeaderboard,
    getBudget,
    setBudget,
    deleteBudget,
    formatPHP,
    escapeHtml,
    validateBarcode,
    validateScan,
    confirmAction,
    showToast,
    getSession: getSupabaseSession,
    get authSession() { return authSession; }
};

openDatabase();
