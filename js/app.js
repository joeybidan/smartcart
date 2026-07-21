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
    if (!String(scan.category ?? "").trim()) errors.push("Category is required.");
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
        category: String(input.category).trim(),
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
        row.cloudObservatÛ½6¶‰žËkºwµçQÕÉ¸É•…‘±° ‰…ÉÐˆ¤ìô)…Íå¹Œ™Õ¹Ñ¥½¸ÕÁ‘…Ñ•…ÉÑ	…‘” ¤ì(€€€¥˜€ …‘ˆ¤É•ÑÕÉ¸ì(€€€½¹ÍÐ¥Ñ•µÌ€ô…Ý…¥Ð•Ñ…ÉÑ%Ñ•µÌ ¤ì(€€€½¹ÍÐ½Õ¹Ð€ô¥Ñ•µÌ¹É•‘Õ” ¡Ñ½Ñ…°°¥Ñ•´¤€ôøÑ½Ñ…°€¬9Õµ‰•È¡¥Ñ•´¹ÅÕ…¹Ñ¥Ñäñð€À¤°€À¤ì(€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ…ÉÑ	…‘”°m‘…Ñ„µ…ÉÐµ‰…‘•tˆ¤¹™½É…  ¡•±•µ•¹Ð¤€ôøì•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ôƒÂ~nH…ÉÐ€ ‘í½Õ¹Ñô¥€ìô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÕÁ‘…Ñ•!½µ•…Í¡‰½…É ¤ì(€€€¥˜€ …‘ˆ¤É•ÑÕÉ¸ì(€€€½¹ÍÐ¥Ñ•µÌ€ô…Ý…¥Ð•Ñ…ÉÑ%Ñ•µÌ ¤ì(€€€½¹ÍÐ½Õ¹Ð€ô¥Ñ•µÌ¹É•‘Õ” ¡Ñ½Ñ…°°¥Ñ•´¤€ôøÑ½Ñ…°€¬9Õµ‰•È¡¥Ñ•´¹ÅÕ…¹Ñ¥Ñäñð€À¤°€À¤ì(€€€½¹ÍÐÑ½Ñ…°€ô¥Ñ•µÌ¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬€¡9Õµ‰•È¡¥Ñ•´¹ÁÉ¥”¤ñð€À¤€¨€¡9Õµ‰•È¡¥Ñ•´¹ÅÕ…¹Ñ¥Ñä¤ñð€À¤°€À¤ì(€€€½¹ÍÐ½Õ¹Ñ±•µ•¹Ð€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰‘…Í¡‰½…É‘%Ñ•µÌˆ¤ì(€€€½¹ÍÐÑ½Ñ…±±•µ•¹Ð€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰‘…Í¡‰½…É‘Q½Ñ…°ˆ¤ì(€€€¥˜€¡½Õ¹Ñ±•µ•¹Ð¤½Õ¹Ñ±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ôMÑÉ¥¹œ¡½Õ¹Ð¤ì(€€€¥˜€¡Ñ½Ñ…±±•µ•¹Ð¤Ñ½Ñ…±±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô™½Éµ…ÑA!@¡Ñ½Ñ…°¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘•±•Ñ•…ÉÑ%Ñ•´¡¥¤ì(€€€…Ý…¥Ð‘‰I•…‘äì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸ ‰…ÉÐˆ°€‰É•…‘ÝÉ¥Ñ”ˆ¤ì(€€€ÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰…ÉÐˆ¤¹‘•±•Ñ”¡9Õµ‰•È¡¥¤¤ì(€€€…Ý…¥ÐÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ì(€€€‰É½…‘…ÍÐ ‰…ÉÐµÕÁ‘…Ñ•ˆ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹É•…Í•…ÉÑEÕ…¹Ñ¥Ñä¡¥¤ì(€€€…Ý…¥Ð¡…¹•…ÉÑEÕ…¹Ñ¥Ñä¡¥°€Ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘•É•…Í•…ÉÑEÕ…¹Ñ¥Ñä¡¥¤ì(€€€…Ý…¥Ð¡…¹•…ÉÑEÕ…¹Ñ¥Ñä¡¥°€´Ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡…¹•…ÉÑEÕ…¹Ñ¥Ñä¡¥°‘•±Ñ„¤ì(€€€…Ý…¥Ð‘‰I•…‘äì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸ ‰…ÉÐˆ°€‰É•…‘ÝÉ¥Ñ”ˆ¤ì(€€€½¹ÍÐÍÑ½É”€ôÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰…ÉÐˆ¤ì(€€€½¹ÍÐ¥Ñ•´€ô…Ý…¥ÐÉ•ÅÕ•ÍÑAÉ½µ¥Í”¡ÍÑ½É”¹•Ð¡9Õµ‰•È¡¥¤¤¤ì(€€€¥˜€¡¥Ñ•´¤ì(€€€€€€€¥Ñ•´¹ÅÕ…¹Ñ¥Ñä€ô9Õµ‰•È¡¥Ñ•´¹ÅÕ…¹Ñ¥Ñäñð€À¤€¬‘•±Ñ„ì(€€€€€€€¥˜€¡¥Ñ•´¹ÅÕ…¹Ñ¥Ñä€ðô€À¤ÍÑ½É”¹‘•±•Ñ”¡9Õµ‰•È¡¥¤¤ì•±Í”ÍÑ½É”¹ÁÕÐ¡¥Ñ•´¤ì(€€€ô(€€€…Ý…¥ÐÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ì(€€€‰É½…‘…ÍÐ ‰…ÉÐµÕÁ‘…Ñ•ˆ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±•…É…ÉÐ ¤ì(€€€…Ý…¥Ð‘‰I•…‘äì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸ ‰…ÉÐˆ°€‰É•…‘ÝÉ¥Ñ”ˆ¤ì(€€€ÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰…ÉÐˆ¤¹±•…È ¤ì(€€€…Ý…¥ÐÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ì(€€€‰É½…‘…ÍÐ ‰…ÉÐµÕÁ‘…Ñ•ˆ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•­½ÕÑ…ÉÐ ¤ì(€€€½¹ÍÐ¥Ñ•µÌ€ô…Ý…¥Ð•Ñ…ÉÑ%Ñ•µÌ ¤ì(€€€¥˜€ …¥Ñ•µÌ¹±•¹Ñ ¤ìÍ¡½ÝQ½…ÍÐ ‰e½ÕÈ…ÉÐ¥Ì•µÁÑäˆ°€‰Ý…É¹¥¹œˆ¤ìÉ•ÑÕÉ¸ìô(€€€½¹ÍÐÑ½Ñ…°€ô¥Ñ•µÌ¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬€¡9Õµ‰•È¡¥Ñ•´¹ÁÉ¥”¤ñð€À¤€¨€¡9Õµ‰•È¡¥Ñ•´¹ÅÕ…¹Ñ¥Ñä¤ñð€À¤°€À¤ì(€€€½¹ÍÐÑÉ¥Á%€ôÑÉ¥À´‘í…Ñ”¹¹½Ü ¥õ€ì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡l‰ÑÉ¥ÁÌˆ°€‰ÑÉ¥Á%Ñ•µÌ‰t°€‰É•…‘ÝÉ¥Ñ”ˆ¤ì(€€€ÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰ÑÉ¥ÁÌˆ¤¹…‘¡ìÑÉ¥Á%°‘…Ñ”è¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°Ñ½Ñ…°ô¤ì(€€€½¹ÍÐ¥Ñ•µÍMÑ½É”€ôÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰ÑÉ¥Á%Ñ•µÌˆ¤ì(€€€¥Ñ•µÌ¹™½É…  ¡¥Ñ•´¤€ôø¥Ñ•µÍMÑ½É”¹…‘¡ìÑÉ¥Á%°‰…É½‘”è¥Ñ•´¹‰…É½‘”°¹…µ”è¥Ñ•´¹¹…µ”°ÅÕ…¹Ñ¥Ñäè¥Ñ•´¹ÅÕ…¹Ñ¥Ñä°Õ¹¥ÑAÉ¥”è¥Ñ•´¹ÁÉ¥”°Ñ½Ñ…°è¥Ñ•´¹ÁÉ¥”€¨¥Ñ•´¹ÅÕ…¹Ñ¥Ñäô¤¤ì(€€€…Ý…¥ÐÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ì(€€€…Ý…¥Ð±•…É…ÉÐ ¤ì(€€€Í¡½ÝQ½…ÍÐ¡QÉ¥ÀÍ…Ù•ƒŠP€‘í™½Éµ…ÑA!@¡Ñ½Ñ…°¥õ€°€‰ÍÕ•ÍÌˆ¤ì(€€€…Ý…¥ÐÕÁ‘…Ñ•…ÉÑ	…‘” ¤ì(€€€…Ý…¥ÐÕÁ‘…Ñ•!½µ•…Í¡‰½…É ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•ÑQÉ¥Á%Ñ•µÌ¡ÑÉ¥Á%¤ì(€€€½¹ÍÐ¥Ñ•µÌ€ô…Ý…¥ÐÉ•…‘±° ‰ÑÉ¥Á%Ñ•µÌˆ¤ì(€€€É•ÑÕÉ¸¥Ñ•µÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÑÉ¥Á%€ôôôÑÉ¥Á%¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…Ù•QÉ¥À¡ÑÉ¥À¤ì(€€€…Ý…¥Ð‘‰I•…‘äì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸ ‰ÑÉ¥ÁÌˆ°€‰É•…‘ÝÉ¥Ñ”ˆ¤ì(€€€ÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰ÑÉ¥ÁÌˆ¤¹ÁÕÐ¡ÑÉ¥À¤ì(€€€É•ÑÕÉ¸ÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…Ù•AÉ¥•!¥ÍÑ½Éä¡‘…Ñ„¤ì(€€€…Ý…¥Ð‘‰I•…‘äì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸ ‰ÁÉ¥•!¥ÍÑ½Éäˆ°€‰É•…‘ÝÉ¥Ñ”ˆ¤ì(€€€ÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰ÁÉ¥•!¥ÍÑ½Éäˆ¤¹…‘¡‘…Ñ„¤ì(€€€É•ÑÕÉ¸ÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•ÑAÉ¥•!¥ÍÑ½Éä ¤ìÉ•ÑÕÉ¸É•…‘±° ‰ÁÉ¥•!¥ÍÑ½Éäˆ¤ìô()…Íå¹Œ™Õ¹Ñ¥½¸•Ñ5½¹Ñ¡±åMÁ•¹‘¥¹œ ¤ì(€€€½¹ÍÐÑÉ¥ÁÌ€ô…Ý…¥ÐÉ•…‘±° ‰ÑÉ¥ÁÌˆ¤ì(€€€É•ÑÕÉ¸ÑÉ¥ÁÌ¹É•‘Õ” ¡É•ÍÕ±Ð°ÑÉ¥À¤€ôøì(€€€€€€€½¹ÍÐµ½¹Ñ €ôMÑÉ¥¹œ¡ÑÉ¥À¹‘…Ñ”ñð€ˆˆ¤¹Í±¥” À°€Ü¤ñð€‰U¹­¹½Ý¸ˆì(€€€€€€€É•ÍÕ±Ñmµ½¹Ñ¡t€ô€¡É•ÍÕ±Ñmµ½¹Ñ¡tñð€À¤€¬€¡9Õµ‰•È¡ÑÉ¥À¹Ñ½Ñ…°¤ñð€À¤ì(€€€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€€€ô°íô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•Ñ…Ñ•½ÉåMÁ•¹‘¥¹œ ¤ì(€€€½¹ÍÐ¥Ñ•µÌ€ô…Ý…¥ÐÉ•…‘±° ‰ÑÉ¥Á%Ñ•µÌˆ¤ì(€€€½¹ÍÐÁÉ½‘ÕÑÌ€ô…Ý…¥ÐÉ•…‘±° ‰ÁÉ½‘ÕÑÌˆ¤ì(€€€½¹ÍÐ‰å	…É½‘”€ô¹•Ü5…À¡ÁÉ½‘ÕÑÌ¹µ…À ¡ÁÉ½‘ÕÐ¤€ôømÁÉ½‘ÕÐ¹‰…É½‘”°ÁÉ½‘ÕÐ¹…Ñ•½Éäñð€‰U¹…Ñ•½É¥é•‰t¤¤ì(€€€É•ÑÕÉ¸¥Ñ•µÌ¹É•‘Õ” ¡É•ÍÕ±Ð°¥Ñ•´¤€ôøì(€€€€€€€½¹ÍÐ…Ñ•½Éä€ô‰å	…É½‘”¹•Ð¡¥Ñ•´¹‰…É½‘”¤ñð€‰U¹…Ñ•½É¥é•ˆì(€€€€€€€É•ÍÕ±Ñm…Ñ•½Éåt€ô€¡É•ÍÕ±Ñm…Ñ•½Éåtñð€À¤€¬€¡9Õµ‰•È¡¥Ñ•´¹Ñ½Ñ…°¤ñð€À¤ì(€€€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€€€ô°íô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•Ñ%¹™±…Ñ¥½¹MÑ…ÑÌ ¤ì(€€€½¹ÍÐ¡¥ÍÑ½Éä€ô…Ý…¥Ð•ÑAÉ¥•!¥ÍÑ½Éä ¤ì(€€€½¹ÍÐ¡…¹•Ì€ô¡¥ÍÑ½Éä¹™¥±Ñ•È ¡¥Ñ•´¤€ôø9Õµ‰•È¹¥Í¥¹¥Ñ”¡9Õµ‰•È¡¥Ñ•´¹¡…¹”¤¤€˜˜¥Ñ•´¹½±‘AÉ¥”€ø€À¤ì(€€€½¹ÍÐÍ½ÉÑ•€ôl¸¸¹¡…¹•Ít¹Í½ÉÐ ¡„°ˆ¤€ôø9Õµ‰•È¡ˆ¹¡…¹”¤€´9Õµ‰•È¡„¹¡…¹”¤¤ì(€€€É•ÑÕÉ¸ì½Ù•É…±°è¡…¹•Ì¹±•¹Ñ €ü¡…¹•Ì¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬9Õµ‰•È¡¥Ñ•´¹¡…¹”¤°€À¤€¼¡…¹•Ì¹±•¹Ñ €è€À°¡¥¡•ÍÑ%¹É•…Í”èÍ½ÉÑ•‘lÁtñð¹Õ±°°¡¥¡•ÍÑ•É•…Í”èÍ½ÉÑ•‘mÍ½ÉÑ•¹±•¹Ñ €´€Åtñð¹Õ±°°Ñ½Ñ…±¡…¹•Ìè¡…¹•Ì¹±•¹Ñ ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•ÑAÉ¥•%¹Í¥¡ÑÌ ¤ì(€€€½¹ÍÐÍÑ…ÑÌ€ô…Ý…¥Ð•Ñ%¹™±…Ñ¥½¹MÑ…ÑÌ ¤ì(€€€É•ÑÕÉ¸ì‰¥•ÍÑ%¹É•…Í”èÍÑ…ÑÌ¹¡¥¡•ÍÑ%¹É•…Í”ñðì¹…µ”è€‰8½ˆ°¡…¹”è€Àô°‰¥•ÍÑ•É•…Í”èÍÑ…ÑÌ¹¡¥¡•ÍÑ•É•…Í”ñðì¹…µ”è€‰8½ˆ°¡…¹”è€Àô°Ñ½Ñ…±¡…¹•ÌèÍÑ…ÑÌ¹Ñ½Ñ…±¡…¹•Ìôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•ÑAÉ¥•±•ÉÑÌ ¤ìÉ•ÑÕÉ¸mtìô)…Íå¹Œ™Õ¹Ñ¥½¸•ÑI•½µµ•¹‘…Ñ¥½¹Ì ¤ìÉ•ÑÕÉ¸mtìô)…Íå¹Œ™Õ¹Ñ¥½¸•Ñ%¹™±…Ñ¥½¹1•…‘•É‰½…É ¤ì½¹ÍÐ¡¥ÍÑ½Éä€ô…Ý…¥Ð•ÑAÉ¥•!¥ÍÑ½Éä ¤ìÉ•ÑÕÉ¸¡¥ÍÑ½Éä¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹½±‘AÉ¥”€ø€À¤¹Í½ÉÐ ¡„°ˆ¤€ôø5…Ñ ¹…‰Ì¡ˆ¹¡…¹”¤€´5…Ñ ¹…‰Ì¡„¹¡…¹”¤¤¹Í±¥” À°€ÄÀ¤ìô()…Íå¹Œ™Õ¹Ñ¥½¸•Ñ	Õ‘•Ð ¤ì½¹ÍÐÉ½ÝÌ€ô…Ý…¥ÐÉ•…‘±° ‰‰Õ‘•Ðˆ¤ìÉ•ÑÕÉ¸É½ÝÍlÁtñð¹Õ±°ìô)…Íå¹Œ™Õ¹Ñ¥½¸Í•Ñ	Õ‘•Ð¡…µ½Õ¹Ð¤ì½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸ ‰‰Õ‘•Ðˆ°€‰É•…‘ÝÉ¥Ñ”ˆ¤ìÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰‰Õ‘•Ðˆ¤¹ÁÕÐ¡ì¥è€‰ÕÉÉ•¹Ðˆ°…µ½Õ¹Ðè9Õµ‰•È¡…µ½Õ¹Ð¤ô¤ìÉ•ÑÕÉ¸ÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ìô)…Íå¹Œ™Õ¹Ñ¥½¸‘•±•Ñ•	Õ‘•Ð ¤ì½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸ ‰‰Õ‘•Ðˆ°€‰É•…‘ÝÉ¥Ñ”ˆ¤ìÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰‰Õ‘•Ðˆ¤¹‘•±•Ñ” ‰ÕÉÉ•¹Ðˆ¤ìÉ•ÑÕÉ¸ÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ìô()™Õ¹Ñ¥½¸Ù…±¥‘1½…±AÉ½‘ÕÐ¡ÁÉ½‘ÕÐ¤ì(€€€½¹ÍÐ¡•¬€ôÙ…±¥‘…Ñ•M…¸¡ì€¸¸¹ÁÉ½‘ÕÐ°ÁÉ¥”èÁÉ½‘ÕÐ¹±…ÍÑAÉ¥”€üüÁÉ½‘ÕÐ¹ÁÉ¥”°É•Ñ…¥±•ÈèÁÉ½‘ÕÐ¹±…ÍÑI•Ñ…¥±•Èñð€‰-ˆ°‰É…¹ èÁÉ½‘ÕÐ¹±…ÍÑ	É…¹ ñð€‰5…¥¸ˆô¤ì(€€€É•ÑÕÉ¸¡•¬¹Ù…±¥ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í•ÑAÉ½‘ÕÑ5¥É…Ñ¥½¹MÑ…ÑÕÌ¡‰…É½‘”°Á…Ñ ¤ì(€€€½¹ÍÐÁÉ½‘ÕÐ€ô…Ý…¥Ð™¥¹‘AÉ½‘ÕÐ¡‰…É½‘”¤ì(€€€¥˜€ …ÁÉ½‘ÕÐ¤É•ÑÕÉ¸ì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸ ‰ÁÉ½‘ÕÑÌˆ°€‰É•…‘ÝÉ¥Ñ”ˆ¤ì(€€€ÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É” ‰ÁÉ½‘ÕÑÌˆ¤¹ÁÕÐ¡ì€¸¸¹ÁÉ½‘ÕÐ°€¸¸¹Á…Ñ °ÕÁ‘…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ô¤ì(€€€…Ý…¥ÐÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ¥É…Ñ•1½…±AÉ½‘ÕÑÌ ¤ì(€€€½¹ÍÐÁÉ½‘ÕÑÌ€ô…Ý…¥ÐÉ•…‘±° ‰ÁÉ½‘ÕÑÌˆ¤ì(€€€½¹ÍÐÍ••¸€ô¹•ÜM•Ð ¤ì(€€€½¹ÍÐÑ½Ñ…±Ì€ôìµ¥É…Ñ•è€À°Í­¥ÁÁ•è€À°™…¥±•è€Àôì(€€€™½È€¡½¹ÍÐÍ½ÕÉ•AÉ½‘ÕÐ½˜ÁÉ½‘ÕÑÌ¤ì(€€€€€€€½¹ÍÐÁÉ½‘ÕÐ€ô¹½Éµ…±¥é•AÉ½‘ÕÐ¡Í½ÕÉ•AÉ½‘ÕÐ¤ì(€€€€€€€¥˜€¡5=}	I=L¹¡…Ì¡ÁÉ½‘ÕÐ¹‰…É½‘”¤ñðÍ••¸¹¡…Ì¡ÁÉ½‘ÕÐ¹‰…É½‘”¤¤ìÑ½Ñ…±Ì¹Í­¥ÁÁ•€¬ô€Äì½¹Ñ¥¹Õ”ìô(€€€€€€€Í••¸¹…‘¡ÁÉ½‘ÕÐ¹‰…É½‘”¤ì(€€€€€€€¥˜€ …Ù…±¥‘1½…±AÉ½‘ÕÐ¡ÁÉ½‘ÕÐ¤¤ìÑ½Ñ…±Ì¹™…¥±•€¬ô€Äì½¹Ñ¥¹Õ”ìô(€€€€€€€±•ÐÁ•¹‘¥¹œ€ôÁÉ½‘ÕÐ¹µ¥É…Ñ¥½¹1½…±%€ü…Ý…¥Ð•ÑA•¹‘¥¹M…¸¡ÁÉ½‘ÕÐ¹µ¥É…Ñ¥½¹1½…±%¤€è¹Õ±°ì(€€€€€€€¥˜€¡Á•¹‘¥¹œü¹Íå¹MÑ…ÑÕÌ€ôôô€‰Íå¹•ˆñðÁÉ½‘ÕÐ¹µ¥É…Ñ¥½¹MÑ…ÑÕÌ€ôôô€‰Íå¹•ˆ¤ìÑ½Ñ…±Ì¹Í­¥ÁÁ•€¬ô€Äì½¹Ñ¥¹Õ”ìô(€€€€€€€ÑÉäì(€€€€€€€€€€€¥˜€ …Á•¹‘¥¹œ¤ì(€€€€€€€€€€€€€€€½¹ÍÐ±½…±%€ôÁÉ½‘ÕÐ¹µ¥É…Ñ¥½¹1½…±%ñðµ¥É…Ñ¥½¸´‘íÁÉ½‘ÕÐ¹‰…É½‘•õ€ì(€€€€€€€€€€€€€€€…Ý…¥ÐÍ•ÑAÉ½‘ÕÑ5¥É…Ñ¥½¹MÑ…ÑÕÌ¡ÁÉ½‘ÕÐ¹‰…É½‘”°ìµ¥É…Ñ¥½¹1½…±%è±½…±%°µ¥É…Ñ¥½¹MÑ…ÑÕÌè€‰Á•¹‘¥¹œˆô¤ì(€€€€€€€€€€€€€€€…Ý…¥ÐÍ…Ù•1½…±M…¸¡ì(€€€€€€€€€€€€€€€€€€€±½…±%°(€€€€€€€€€€€€€€€€€€€‰…É½‘”èÁÉ½‘ÕÐ¹‰…É½‘”°(€€€€€€€€€€€€€€€€€€€¹…µ”èÁÉ½‘ÕÐ¹¹…µ”°(€€€€€€€€€€€€€€€€€€€‰É…¹èÁÉ½‘ÕÐ¹‰É…¹°(€€€€€€€€€€€€€€€€€€€…Ñ•½ÉäèÁÉ½‘ÕÐ¹…Ñ•½Éä°(€€€€€€€€€€€€€€€€€€€Í¥é”èÁÉ½‘ÕÐ¹Í¥é”°(€€€€€€€€€€€€€€€€€€€Õ¹¥ÐèÁÉ½‘ÕÐ¹Õ¹¥Ð°(€€€€€€€€€€€€€€€€€€€ÁÉ¥”èÁÉ½‘ÕÐ¹±…ÍÑAÉ¥”°(€€€€€€€€€€€€€€€€€€€É•Ñ…¥±•ÈèÁÉ½‘ÕÐ¹±…ÍÑI•Ñ…¥±•Èñð€‰-ˆ°(€€€€€€€€€€€€€€€€€€€‰É…¹ èÁÉ½‘ÕÐ¹±…ÍÑ	É…¹ ñð€‰5…¥¸ˆ°(€€€€€€€€€€€€€€€€€€€…ÁÑÕÉ•‘ÐèÁÉ½‘ÕÐ¹±…ÍÑAÉ¥•Ð°(€€€€€€€€€€€€€€€€€€€Í½ÕÉ”è€‰±½…°µµ¥É…Ñ¥½¸ˆ(€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€Á•¹‘¥¹œ€ô…Ý…¥Ð•ÑA•¹‘¥¹M…¸¡±½…±%¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€…Ý…¥ÐÍå¹A•¹‘¥¹M…¹Ì¡ì½¹±å1½…±%èÁ•¹‘¥¹œ¹±½…±%ô¤ì(€€€€€€€€€€€Á•¹‘¥¹œ€ô…Ý…¥Ð•ÑA•¹‘¥¹M…¸¡Á•¹‘¥¹œ¹±½…±%¤ì(€€€€€€€€€€€¥˜€¡Á•¹‘¥¹œü¹Íå¹MÑ…ÑÕÌ€ôôô€‰Íå¹•ˆ¤ì(€€€€€€€€€€€€€€€…Ý…¥ÐÍ•ÑAÉ½‘ÕÑ5¥É…Ñ¥½¹MÑ…ÑÕÌ¡ÁÉ½‘ÕÐ¹‰…É½‘”°ìµ¥É…Ñ¥½¹MÑ…ÑÕÌè€‰Íå¹•ˆ°µ¥É…Ñ¥½¹=‰Í•ÉÙ…Ñ¥½¹%èÁ•¹‘¥¹œ¹±½Õ‘=‰Í•ÉÙ…Ñ¥½¹%ô¤ì(€€€€€€€€€€€€€€€Ñ½Ñ…±Ì¹µ¥É…Ñ•€¬ô€Äì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€€€Ñ½Ñ…±Ì¹™…¥±•€¬ô€Äì(€€€€€€€€€€€ô(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€½¹Í½±”¹Ý…É¸ ‰1½…°ÁÉ½‘ÕÐµ¥É…Ñ¥½¸™…¥±•ˆ°ÁÉ½‘ÕÐ¹‰…É½‘”°•ÉÉ½È¤ì(€€€€€€€€€€€Ñ½Ñ…±Ì¹™…¥±•€¬ô€Äì(€€€€€€€ô(€€€ô(€€€…Ý…¥ÐÉ•™É•Í¡Må¹MÕµµ…Éä ¤ì(€€€É•ÑÕÉ¸Ñ½Ñ…±Ìì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•áÁ½ÉÑ1½…±	…­ÕÀ ¤ì(€€€½¹ÍÐ‰…­ÕÀ€ôì(€€€€€€€Ù•ÉÍ¥½¸è€Ä°(€€€€€€€•áÁ½ÉÑ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€€€ÁÉ½‘ÕÑÌè…Ý…¥ÐÉ•…‘±° ‰ÁÉ½‘ÕÑÌˆ¤°(€€€€€€€ÁÉ¥•!¥ÍÑ½Éäè…Ý…¥ÐÉ•…‘±° ‰ÁÉ¥•!¥ÍÑ½Éäˆ¤°(€€€€€€€Á•¹‘¥¹M…¹Ìè…Ý…¥ÐÉ•…‘±° ‰Á•¹‘¥¹M…¹Ìˆ¤°(€€€€€€€ÑÉ¥ÁÌè…Ý…¥ÐÉ•…‘±° ‰ÑÉ¥ÁÌˆ¤°(€€€€€€€ÑÉ¥Á%Ñ•µÌè…Ý…¥ÐÉ•…‘±° ‰ÑÉ¥Á%Ñ•µÌˆ¤(€€€ôì(€€€½¹ÍÐ‰±½ˆ€ô¹•Ü	±½ˆ¡m)M=8¹ÍÑÉ¥¹¥™ä¡‰…­ÕÀ°¹Õ±°°€È¥t°ìÑåÁ”è€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆô¤ì(€€€½¹ÍÐÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡‰±½ˆ¤ì(€€€½¹ÍÐ±¥¹¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰„ˆ¤ì(€€€±¥¹¬¹¡É•˜€ôÕÉ°ì(€€€±¥¹¬¹‘½Ý¹±½…€ôÍµ…ÉÑ…ÉÐµ‰…­ÕÀ´‘í¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¥ô¹©Í½¹€ì(€€€±¥¹¬¹±¥¬ ¤ì(€€€UI0¹É•Ù½­•=‰©•ÑUI0¡ÕÉ°¤ì(€€€Í¡½ÝQ½…ÍÐ ‰1½…°‰…­ÕÀ•áÁ½ÉÑ•ˆ°€‰ÍÕ•ÍÌˆ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•áÁ½ÉÑAÉ½‘ÕÑÍÍØ ¤ì(€€€½¹ÍÐÁÉ½‘ÕÑÌ€ô…Ý…¥ÐÉ•…‘±° ‰ÁÉ½‘ÕÑÌˆ¤ì(€€€½¹ÍÐ™¥•±‘Ì€ôl‰‰…É½‘”ˆ°€‰¹…µ”ˆ°€‰‰É…¹ˆ°€‰…Ñ•½Éäˆ°€‰Í¥é”ˆ°€‰Õ¹¥Ðˆ°€‰±…ÍÑAÉ¥”ˆ°€‰±…ÍÑI•Ñ…¥±•Èˆ°€‰±…ÍÑ	É…¹ ˆ°€‰±…ÍÑAÉ¥•Ð‰tì(€€€½¹ÍÐÍØ€ôm™¥•±‘Ì¹©½¥¸ ˆ°ˆ¤°€¸¸¹ÁÉ½‘ÕÑÌ¹µ…À ¡ÁÉ½‘ÕÐ¤€ôø™¥•±‘Ì¹µ…À ¡™¥•±¤€ôø€ˆ‘íMÑÉ¥¹œ¡ÁÉ½‘ÕÑm™¥•±‘t€üü€ˆˆ¤¹É•Á±…•±° œˆœ°€œˆˆœ¥ô‰€¤¹©½¥¸ ˆ°ˆ¤¥t¹©½¥¸ ‰q¸ˆ¤ì(€€€½¹ÍÐÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡¹•Ü	±½ˆ¡mÍÙt°ìÑåÁ”è€‰Ñ•áÐ½ÍØˆô¤¤ì(€€€½¹ÍÐ±¥¹¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰„ˆ¤ì(€€€±¥¹¬¹¡É•˜€ôÕÉ°ì(€€€±¥¹¬¹‘½Ý¹±½…€ôÍµ…ÉÑ…ÉÐµÁÉ½‘ÕÑÌ´‘í¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¥ô¹ÍÙ€ì(€€€±¥¹¬¹±¥¬ ¤ì(€€€UI0¹É•Ù½­•=‰©•ÑUI0¡ÕÉ°¤ì(€€€Í¡½ÝQ½…ÍÐ ‰AÉ½‘ÕÑÌMX•áÁ½ÉÑ•ˆ°€‰ÍÕ•ÍÌˆ¤ì)ô()™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•	…­ÕÀ¡‰…­ÕÀ¤ì(€€€½¹ÍÐ½±±•Ñ¥½¹Ì€ôl‰ÁÉ½‘ÕÑÌˆ°€‰ÁÉ¥•!¥ÍÑ½Éäˆ°€‰Á•¹‘¥¹M…¹Ìˆ°€‰ÑÉ¥ÁÌˆ°€‰ÑÉ¥Á%Ñ•µÌ‰tì(€€€¥˜€ …‰…­ÕÀñðÑåÁ•½˜‰…­ÕÀ€„ôô€‰½‰©•Ðˆñð½±±•Ñ¥½¹Ì¹Í½µ” ¡¹…µ”¤€ôø€…ÉÉ…ä¹¥ÍÉÉ…ä¡‰…­ÕÁm¹…µ•t¤¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰	…­ÕÀµÕÍÐ½¹Ñ…¥¸ÁÉ½‘ÕÑÌ°ÁÉ¥•!¥ÍÑ½Éä°Á•¹‘¥¹M…¹Ì°ÑÉ¥ÁÌ°…¹ÑÉ¥Á%Ñ•µÌ…ÉÉ…åÌ¸ˆ¤ì(€€€½¹ÍÐ‰…É½‘•Ì€ô¹•ÜM•Ð ¤ì(€€€‰…­ÕÀ¹ÁÉ½‘ÕÑÌ¹™½É…  ¡ÁÉ½‘ÕÐ¤€ôøì(€€€€€€€½¹ÍÐ‰…É½‘”€ôÙ…±¥‘…Ñ•	…É½‘”¡ÁÉ½‘ÕÐ¹‰…É½‘”¤ì(€€€€€€€¥˜€ …‰…É½‘”ñð€…MÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹¹…µ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ñð€…MÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹…Ñ•½Éäñð€ˆˆ¤¹ÑÉ¥´ ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰	…­ÕÀ½¹Ñ…¥¹Ì…¸¥¹Ù…±¥ÁÉ½‘ÕÐ¸ˆ¤ì(€€€€€€€¥˜€¡‰…É½‘•Ì¹¡…Ì¡‰…É½‘”¤¤Ñ¡É½Ü¹•ÜÉÉ½È¡	…­ÕÀ½¹Ñ…¥¹Ì‘ÕÁ±¥…Ñ”‰…É½‘”€‘í‰…É½‘•ô¹€¤ì(€€€€€€€‰…É½‘•Ì¹…‘¡‰…É½‘”¤ì(€€€€€€€¥˜€¡ÁÉ½‘ÕÐ¹±…ÍÑAÉ¥”€„ô¹Õ±°€˜˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡9Õµ‰•È¡ÁÉ½‘ÕÐ¹±…ÍÑAÉ¥”¤¤ñð9Õµ‰•È¡ÁÉ½‘ÕÐ¹±…ÍÑAÉ¥”¤€ðô€À¤¤Ñ¡É½Ü¹•ÜÉÉ½È¡	…­ÕÀ½¹Ñ…¥¹Ì…¸¥¹Ù…±¥ÁÉ¥”™½È€‘í‰…É½‘•ô¹€¤ì(€€€ô¤ì(€€€‰…­ÕÀ¹Á•¹‘¥¹M…¹Ì¹™½É…  ¡Í…¸¤€ôøì(€€€€€€€¥˜€ …Í…¸¹±½…±%ñð€…Ù…±¥‘…Ñ•	…É½‘”¡Í…¸¹‰…É½‘”¤ñð€…l‰Á•¹‘¥¹œˆ°€‰Íå¹¥¹œˆ°€‰Íå¹•ˆ°€‰™…¥±•‰t¹¥¹±Õ‘•Ì¡Í…¸¹Íå¹MÑ…ÑÕÌ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰	…­ÕÀ½¹Ñ…¥¹Ì…¸¥¹Ù…±¥Á•¹‘¥¹œÍ…¸¸ˆ¤ì(€€€ô¤ì(€€€‰…­ÕÀ¹ÑÉ¥ÁÌ¹™½É…  ¡ÑÉ¥À¤€ôøì¥˜€ …ÑÉ¥À¹ÑÉ¥Á%¤Ñ¡É½Ü¹•ÜÉÉ½È ‰	…­ÕÀ½¹Ñ…¥¹Ì…¸¥¹Ù…±¥ÑÉ¥À¸ˆ¤ìô¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥µÁ½ÉÑ1½…±	…­ÕÀ¡‰…­ÕÀ¤ì(€€€Ù…±¥‘…Ñ•	…­ÕÀ¡‰…­ÕÀ¤ì(€€€½¹ÍÐÑÉ…¹Í…Ñ¥½¸€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡l‰ÁÉ½‘ÕÑÌˆ°€‰ÁÉ¥•!¥ÍÑ½Éäˆ°€‰Á•¹‘¥¹M…¹Ìˆ°€‰ÑÉ¥ÁÌˆ°€‰ÑÉ¥Á%Ñ•µÌ‰t°€‰É•…‘ÝÉ¥Ñ”ˆ¤ì(€€€½¹ÍÐÍÑ½É•Ì€ô=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡l‰ÁÉ½‘ÕÑÌˆ°€‰ÁÉ¥•!¥ÍÑ½Éäˆ°€‰Á•¹‘¥¹M…¹Ìˆ°€‰ÑÉ¥ÁÌˆ°€‰ÑÉ¥Á%Ñ•µÌ‰t¹µ…À ¡¹…µ”¤€ôøm¹…µ”°ÑÉ…¹Í…Ñ¥½¸¹½‰©•ÑMÑ½É”¡¹…µ”¥t¤¤ì(€€€‰…­ÕÀ¹ÁÉ½‘ÕÑÌ¹™½É…  ¡¥Ñ•´¤€ôøÍÑ½É•Ì¹ÁÉ½‘ÕÑÌ¹ÁÕÐ¡¹½Éµ…±¥é•AÉ½‘ÕÐ¡¥Ñ•´¤¤¤ì(€€€‰…­ÕÀ¹ÁÉ¥•!¥ÍÑ½Éä¹™½É…  ¡¥Ñ•´¤€ôøÍÑ½É•Ì¹ÁÉ¥•!¥ÍÑ½Éä¹ÁÕÐ¡¥Ñ•´¤¤ì(€€€‰…­ÕÀ¹Á•¹‘¥¹M…¹Ì¹™½É…  ¡¥Ñ•´¤€ôøÍÑ½É•Ì¹Á•¹‘¥¹M…¹Ì¹ÁÕÐ¡¥Ñ•´¤¤ì(€€€‰…­ÕÀ¹ÑÉ¥ÁÌ¹™½É…  ¡¥Ñ•´¤€ôøÍÑ½É•Ì¹ÑÉ¥ÁÌ¹ÁÕÐ¡¥Ñ•´¤¤ì(€€€‰…­ÕÀ¹ÑÉ¥Á%Ñ•µÌ¹™½É…  ¡¥Ñ•´¤€ôøÍÑ½É•Ì¹ÑÉ¥Á%Ñ•µÌ¹ÁÕÐ¡¥Ñ•´¤¤ì(€€€…Ý…¥ÐÑÉ…¹Í…Ñ¥½¹AÉ½µ¥Í”¡ÑÉ…¹Í…Ñ¥½¸¤ì(€€€…Ý…¥ÐÉ•™É•Í¡Må¹MÕµµ…Éä ¤ì(€€€Í¡½ÝQ½…ÍÐ ‰	…­ÕÀ¥µÁ½ÉÑ•±½…±±äˆ°€‰ÍÕ•ÍÌˆ¤ì)ô()™Õ¹Ñ¥½¸Í•ÑÑ¥Ù•9…Ù¥…Ñ¥½¸ ¤ì(€€€½¹ÍÐÁ…”€ô±½…Ñ¥½¸¹Á…Ñ¡¹…µ”¹ÍÁ±¥Ð ˆ¼ˆ¤¹Á½À ¤ñð€‰¥¹‘•à¹¡Ñµ°ˆì(€€€½¹ÍÐµ½É•A…•Ì€ô¹•ÜM•Ð¡l‰Íå¹Œ¹¡Ñµ°ˆ°€‰…ÕÑ ¹¡Ñµ°ˆ°€‰…¹…±åÑ¥Ì¹¡Ñµ°ˆ°€‰ÑÉ¥Àµ¡¥ÍÑ½Éä¹¡Ñµ°ˆ°€‰ÑÉ¥Àµ‘•Ñ…¥±Ì¹¡Ñµ°‰t¤ì(€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰m‘…Ñ„µ¹…ØµÁ…•tˆ¤¹™½É…  ¡±¥¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥ÍÑ¥Ù”€ô±¥¹¬¹‘…Ñ…Í•Ð¹¹…ÙA…”€ôôôÁ…”ñð€¡Á…”€ôôô€‰¥¹‘•à¹¡Ñµ°ˆ€˜˜±¥¹¬¹‘…Ñ…Í•Ð¹¹…ÙA…”€ôôô€‰¡½µ”ˆ¤ñð€¡µ½É•A…•Ì¹¡…Ì¡Á…”¤€˜˜±¥¹¬¹‘…Ñ…Í•Ð¹¹…ÙA…”€ôôô€‰Íå¹Œˆ¤ì(€€€€€€€±¥¹¬¹±…ÍÍ1¥ÍÐ¹Ñ½±” ‰…Ñ¥Ù”ˆ°¥ÍÑ¥Ù”¤ì(€€€ô¤ì)ô()¥˜€¡…ÉÑ¡…¹¹•°¤…ÉÑ¡…¹¹•°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰µ•ÍÍ…”ˆ°€ ¤€ôøìÙ½¥ÕÁ‘…Ñ•…ÉÑ	…‘” ¤ìÙ½¥ÕÁ‘…Ñ•!½µ•…Í¡‰½…É ¤ìô¤ì)Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰½¹±¥¹”ˆ°€ ¤€ôøìÙ½¥Íå¹A•¹‘¥¹M…¹Ì ¤ìÙ½¥É•™É•Í¡Må¹MÕµµ…Éä ¤ìÍ¡½ÝQ½…ÍÐ ‰½¹¹•Ñ¥½¸É•ÍÑ½É•ƒŠPÍå¹¥¹œÁ•¹‘¥¹œÍ…¹Ìˆ°€‰¥¹™¼ˆ¤ìô¤ì)Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰½™™±¥¹”ˆ°€ ¤€ôøìÙ½¥É•™É•Í¡Må¹MÕµµ…Éä ¤ìÍ¡½ÝQ½…ÍÐ ‰=™™±¥¹”µ½‘”ƒŠPÍ…¹ÌÝ¥±°ÍÑ…ä½¸Ñ¡¥Ì‘•Ù¥”ˆ°€‰Ý…É¹¥¹œˆ¤ìô¤ì)Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Õ¹¡…¹‘±•‘É•©•Ñ¥½¸ˆ°€¡•Ù•¹Ð¤€ôøì•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì½¹Í½±”¹Ý…É¸ ‰!…¹‘±•Mµ…ÉÑ…ÉÐÁÉ½µ¥Í”É•©•Ñ¥½¸ˆ°•Ù•¹Ð¹É•…Í½¸¤ìÍ¡½ÝQ½…ÍÐ ‰Mµ…ÉÑ…ÉÐ½Õ±¹½Ð½µÁ±•Ñ”Ñ¡…Ð…Ñ¥½¸¸ˆ°€‰•ÉÉ½Èˆ¤ìô¤ì)Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰•ÉÉ½Èˆ°€¡•Ù•¹Ð¤€ôøì¥˜€¡•Ù•¹Ð¹•ÉÉ½È¤½¹Í½±”¹Ý…É¸ ‰!…¹‘±•Mµ…ÉÑ…ÉÐ•ÉÉ½Èˆ°•Ù•¹Ð¹•ÉÉ½È¤ìô¤ì)‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰=5½¹Ñ•¹Ñ1½…‘•ˆ°€ ¤€ôøìÍ•ÑÑ¥Ù•9…Ù¥…Ñ¥½¸ ¤ìÙ½¥É•™É•Í¡Må¹MÕµµ…Éä ¤ìô¤ì()Ý¥¹‘½Ü¹Íµ…ÉÑ…ÉÐ€ôì(€€€‘‰I•…‘ä°(€€€…‘‘AÉ½‘ÕÐ°(€€€™¥¹‘AÉ½‘ÕÐ°(€€€Í…Ù•1½…±M…¸°(€€€Í…Ù•¹‘Må¹M…¸°(€€€Íå¹A•¹‘¥¹M…¹Ì°(€€€É•ÑÉåMå¹Œ°(€€€µ¥É…Ñ•1½…±AÉ½‘ÕÑÌ°(€€€•áÁ½ÉÑ1½…±	…­ÕÀ°(€€€•áÁ½ÉÑAÉ½‘ÕÑÍÍØ°(€€€¥µÁ½ÉÑ1½…±	…­ÕÀ°(€€€ÕÁ‘…Ñ•AÉ½‘ÕÑAÉ¥”°(€€€…‘‘Q½…ÉÐè…‘‘Q½…ÉÑ	å	…É½‘”°(€€€…‘‘Q½…ÉÑ	å	…É½‘”°(€€€•Ñ…ÉÑ%Ñ•µÌ°(€€€ÕÁ‘…Ñ•…ÉÑ	…‘”°(€€€ÕÁ‘…Ñ•!½µ•…Í¡‰½…É°(€€€¥¹É•…Í•…ÉÑEÕ…¹Ñ¥Ñäè¥¹É•…Í•…ÉÑEÕ…¹Ñ¥Ñä°(€€€‘•É•…Í•…ÉÑEÕ…¹Ñ¥Ñäè‘•É•…Í•…ÉÑEÕ…¹Ñ¥Ñä°(€€€‘•±•Ñ•…ÉÑ%Ñ•´°(€€€±•…É…ÉÐ°(€€€¡•­½ÕÑ…ÉÐ°(€€€•ÑQÉ¥Á%Ñ•µÌ°(€€€Í…Ù•QÉ¥À°(€€€Í…Ù•AÉ¥•!¥ÍÑ½Éä°(€€€•ÑAÉ¥•!¥ÍÑ½Éä°(€€€•Ñ%¹™±…Ñ¥½¹MÑ…ÑÌ°(€€€•ÑAÉ¥•%¹Í¥¡ÑÌ°(€€€•Ñ5½¹Ñ¡±åMÁ•¹‘¥¹œ°(€€€•Ñ…Ñ•½ÉåMÁ•¹‘¥¹œ°(€€€•ÑAÉ¥•±•ÉÑÌ°(€€€•ÑI•½µµ•¹‘…Ñ¥½¹Ì°(€€€•Ñ%¹™±…Ñ¥½¹1•…‘•É‰½…É°(€€€•Ñ	Õ‘•Ð°(€€€Í•Ñ	Õ‘•Ð°(€€€‘•±•Ñ•	Õ‘•Ð°(€€€™½Éµ…ÑA!@°(€€€•Í…Á•!Ñµ°°(€€€Ù…±¥‘…Ñ•	…É½‘”°(€€€Ù…±¥‘…Ñ•M…¸°(€€€½¹™¥ÉµÑ¥½¸°(€€€Í¡½ÝQ½…ÍÐ°(€€€•ÑM•ÍÍ¥½¸è•ÑMÕÁ…‰…Í•M•ÍÍ¥½¸°(€€€•Ð…ÕÑ¡M•ÍÍ¥½¸ ¤ìÉ•ÑÕÉ¸…ÕÑ¡M•ÍÍ¥½¸ìô)ôì()½Á•¹…Ñ…‰…Í” ¤ì(