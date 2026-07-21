let codeReader = null;
let scannerRunning = false;
let scanLocked = false;
let confirmationTimer = null;
let activeStoreForm = null;
const RESCAN_DELAY_MS = 1100;
const CONFIRMATION_WINDOW_MS = 1500;
const LAST_STORE_KEY = "smartcart.lastStore";
const STORE_PRESETS_KEY = "smartcart.storePresets";
const barcodeConfirmer = window.smartCartScannerCore.createBarcodeConfirmer({ windowMs: CONFIRMATION_WINDOW_MS });

function readStoredJson(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
    } catch (_error) {
        return fallback;
    }
}

function normalizeStore(store) {
    return {
        retailer: String(store?.retailer ?? "").trim() || "KCC",
        branch: String(store?.branch ?? "").trim() || "Main"
    };
}

let currentStore = normalizeStore(readStoredJson(LAST_STORE_KEY, null));

function setScannerMessage(message, type = "info") {
    const result = document.getElementById("scanResult");
    const status = document.getElementById("scannerStatus");
    if (result) result.textContent = message;
    if (status) status.textContent = message;
    if (type === "error") window.smartCart?.showToast(message, "error");
}

function updateDiagnostics(state = barcodeConfirmer.snapshot(), lookupSource) {
    const candidate = document.getElementById("diagnosticCandidate");
    const count = document.getElementById("diagnosticCount");
    const confirmed = document.getElementById("diagnosticConfirmed");
    const source = document.getElementById("diagnosticSource");
    if (candidate) candidate.textContent = state.candidate || "—";
    if (count) count.textContent = String(state.count || 0);
    if (confirmed) confirmed.textContent = state.confirmedBarcode || "—";
    if (source && lookupSource) source.textContent = lookupSource;
}

function resetConfirmation(options = {}) {
    window.clearTimeout(confirmationTimer);
    confirmationTimer = null;
    updateDiagnostics(barcodeConfirmer.reset(options));
}

function scheduleConfirmationTimeout() {
    window.clearTimeout(confirmationTimer);
    confirmationTimer = window.setTimeout(() => {
        const state = barcodeConfirmer.expire(Date.now());
        updateDiagnostics(state);
        if (!scanLocked && !state.candidate) setScannerMessage("Ready for the next barcode.");
    }, CONFIRMATION_WINDOW_MS + 40);
}

function setScannerButtons() {
    const start = document.getElementById("startScannerButton");
    const stop = document.getElementById("stopScannerButton");
    if (start) {
        start.disabled = scannerRunning;
        start.textContent = scannerRunning ? "Scanning…" : "Start scanner";
    }
    if (stop) stop.disabled = !scannerRunning;
}

function supportedFormats() {
    if (!window.ZXing?.BarcodeFormat) return undefined;
    const { BarcodeFormat } = window.ZXing;
    return [BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.EAN_13, BarcodeFormat.EAN_14, BarcodeFormat.ITF].filter(Boolean);
}

async function startScanner() {
    if (scannerRunning) return;
    if (!window.ZXing?.BrowserMultiFormatReader) {
        setScannerMessage("Scanner library unavailable. You can still enter products from the Products page.", "error");
        return;
    }
    const video = document.getElementById("scannerVideo");
    if (!video) return;
    try {
        const hints = new Map();
        const formats = supportedFormats();
        if (formats && window.ZXing.DecodeHintType) hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
        codeReader = new window.ZXing.BrowserMultiFormatReader(hints, 250);
        scannerRunning = true;
        resetConfirmation();
        setScannerButtons();
        setScannerMessage("Point the camera at a barcode.");
        await codeReader.decodeFromVideoDevice(null, video, (result, error) => {
            if (result) processDecodedBarcode(result.getText());
            else if (error && !isNotFoundError(error)) return;
        });
    } catch (error) {
        scannerRunning = false;
        resetConfirmation();
        setScannerButtons();
        const message = error?.name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access or use manual entry."
            : "The camera could not start. Check browser permissions and try again.";
        setScannerMessage(message, "error");
    }
}

function isNotFoundError(error) {
    return error?.name === "NotFoundException" || String(error?.message || "").toLowerCase().includes("not found");
}

function stopScanner() {
    try { codeReader?.reset(); } catch (_error) { /* Camera may already be released. */ }
    codeReader = null;
    scannerRunning = false;
    scanLocked = false;
    resetConfirmation();
    setScannerButtons();
    setScannerMessage("Scanner stopped.");
}

function releaseScannerLock() {
    window.setTimeout(() => { scanLocked = false; }, RESCAN_DELAY_MS);
}

function processDecodedBarcode(rawBarcode) {
    if (scanLocked) return;
    const state = barcodeConfirmer.observe(rawBarcode, Date.now());
    updateDiagnostics(state);
    if (!state.barcode) return;
    if (!state.confirmed) {
        setScannerMessage("Barcode detected — hold steady to confirm.");
        scheduleConfirmationTimeout();
        return;
    }

    window.clearTimeout(confirmationTimer);
    confirmationTimer = null;
    scanLocked = true;
    if (navigator.vibrate) navigator.vibrate(90);
    setScannerMessage(`Confirmed barcode: ${state.barcode}`);
    void handleBarcode(state.barcode);
}

async function handleBarcode(barcode) {
    try {
        const product = await window.smartCart.findProductAnywhere(barcode);
        const lookupSource = product?.lookupSource || "New";
        updateDiagnostics(barcodeConfirmer.snapshot(), lookupSource);
        if (product) showKnownProductForm(product, barcode);
        else showUnknownProductForm(barcode);
        barcodeConfirmer.reset({ preserveConfirmed: true });
    } catch (error) {
        setScannerMessage(error?.message || "The barcode was detected, but product lookup failed.", "error");
        resetConfirmation();
        releaseScannerLock();
    }
}

function formatStore(store = currentStore) {
    return `${store.retailer} · ${store.branch}`;
}

function applyCurrentStore() {
    ["unknown", "known"].forEach((prefix) => {
        const retailer = document.getElementById(`${prefix}Retailer`);
        const branch = document.getElementById(`${prefix}Branch`);
        const summary = document.getElementById(`${prefix}StoreSummary`);
        if (retailer) retailer.value = currentStore.retailer;
        if (branch) branch.value = currentStore.branch;
        if (summary) summary.textContent = formatStore();
    });
}

function rememberStore(store) {
    currentStore = normalizeStore(store);
    try {
        localStorage.setItem(LAST_STORE_KEY, JSON.stringify(currentStore));
        const presets = readStoredJson(STORE_PRESETS_KEY, [])
            .filter((item) => item?.retailer && item?.branch)
            .map(normalizeStore);
        const unique = [currentStore, ...presets.filter((item) => formatStore(item).toLowerCase() !== formatStore(currentStore).toLowerCase())].slice(0, 8);
        localStorage.setItem(STORE_PRESETS_KEY, JSON.stringify(unique));
    } catch (_error) {
        // The active selection remains usable even if browser storage is unavailable.
    }
    applyCurrentStore();
    renderStorePresets();
}

function renderStorePresets() {
    const container = document.getElementById("storePresets");
    if (!container) return;
    container.replaceChildren();
    const presets = readStoredJson(STORE_PRESETS_KEY, [])
        .filter((item) => item?.retailer && item?.branch)
        .map(normalizeStore);
    if (!presets.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "Saved stores will appear here.";
        container.appendChild(empty);
        return;
    }
    presets.forEach((store) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "store-preset";
        button.textContent = formatStore(store);
        button.addEventListener("click", () => {
            document.getElementById("storeRetailer").value = store.retailer;
            document.getElementById("storeBranch").value = store.branch;
        });
        container.appendChild(button);
    });
}

function openStorePicker(prefix) {
    activeStoreForm = prefix;
    const dialog = document.getElementById("storePickerDialog");
    document.getElementById("storeRetailer").value = currentStore.retailer;
    document.getElementById("storeBranch").value = currentStore.branch;
    renderStorePresets();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    window.setTimeout(() => document.getElementById("storeRetailer")?.focus(), 0);
}

function closeStorePicker() {
    const dialog = document.getElementById("storePickerDialog");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    activeStoreForm = null;
}

function showUnknownProductForm(barcode) {
    hideForm("knownProductCard");
    const card = document.getElementById("unknownProductCard");
    if (!card) return;
    card.hidden = false;
    document.getElementById("unknownBarcode").value = barcode;
    document.getElementById("unknownBarcodeDisplay").textContent = barcode;
    ["unknownName", "unknownBrand", "unknownCategory", "unknownSize", "unknownUnit", "unknownPrice"].forEach((id) => {
        document.getElementById(id).value = "";
    });
    document.getElementById("unknownAddToCart").checked = false;
    document.getElementById("unknownOptionalDetails").open = false;
    applyCurrentStore();
    setScannerMessage(`New barcode ${barcode}. Add its name and price.`);
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.getElementById("unknownName")?.focus(), 250);
}

function setText(id, value, fallback = "—") {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value || fallback);
}

function showKnownProductForm(product, barcode) {
    hideForm("unknownProductCard");
    const card = document.getElementById("knownProductCard");
    if (!card) return;
    card.hidden = false;
    document.getElementById("knownBarcode").value = barcode;
    document.getElementById("knownName").value = product.name || "";
    document.getElementById("knownBrand").value = product.brand || "";
    document.getElementById("knownCategory").value = product.category || "Uncategorized";
    document.getElementById("knownSize").value = product.size || "";
    document.getElementById("knownUnit").value = product.unit || "";
    document.getElementById("knownPrice").value = Number.isFinite(product.lastPrice) ? product.lastPrice : "";
    document.getElementById("knownAddToCart").checked = false;
    document.getElementById("knownEditDetails").open = false;
    setText("knownSummaryName", product.name);
    setText("knownSummaryBrand", product.brand);
    setText("knownSummaryCategory", product.category || "Uncategorized");
    setText("knownSummarySize", [product.size, product.unit].filter(Boolean).join(" "));
    setText("knownSummaryBarcode", barcode);
    applyCurrentStore();
    setScannerMessage(`${product.name} found in ${product.lookupSource || "Local"}. Record the current price.`);
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.getElementById("knownPrice")?.select(), 250);
}

function hideForm(id) {
    const card = document.getElementById(id);
    if (card) card.hidden = true;
}

function resetScannerForms() {
    hideForm("unknownProductCard");
    hideForm("knownProductCard");
}

function formValues(prefix) {
    return {
        barcode: document.getElementById(`${prefix}Barcode`).value.trim(),
        name: document.getElementById(`${prefix}Name`).value.trim(),
        brand: document.getElementById(`${prefix}Brand`).value.trim(),
        category: document.getElementById(`${prefix}Category`).value.trim() || "Uncategorized",
        size: document.getElementById(`${prefix}Size`).value.trim(),
        unit: document.getElementById(`${prefix}Unit`).value.trim(),
        price: Number(document.getElementById(`${prefix}Price`).value),
        retailer: document.getElementById(`${prefix}Retailer`).value.trim(),
        branch: document.getElementById(`${prefix}Branch`).value.trim(),
        capturedAt: new Date().toISOString(),
        source: "scanner"
    };
}

async function saveScannerForm(prefix) {
    const values = formValues(prefix);
    const check = window.smartCart.validateScan(values);
    if (!check.valid) {
        setScannerMessage(check.errors.join(" "), "error");
        return;
    }
    try {
        const addToCart = document.getElementById(`${prefix}AddToCart`).checked;
        rememberStore({ retailer: values.retailer, branch: values.branch });
        const saved = await window.smartCart.saveAndSyncScan(values, addToCart);
        setScannerMessage(saved.syncStatus === "synced"
            ? "Saved to cloud. Ready for the next barcode."
            : "Saved locally. Synchronization is pending; ready for the next barcode.");
        resetScannerForms();
        resetConfirmation();
        releaseScannerLock();
    } catch (error) {
        setScannerMessage(error.message || "Record could not be saved locally.", "error");
    }
}

function cancelScannerForm() {
    resetScannerForms();
    resetConfirmation();
    setScannerMessage("Cancelled. Ready for the next barcode.");
    releaseScannerLock();
}

document.addEventListener("DOMContentLoaded", () => {
    applyCurrentStore();
    renderStorePresets();
    updateDiagnostics();
    document.getElementById("startScannerButton")?.addEventListener("click", () => { void startScanner(); });
    document.getElementById("stopScannerButton")?.addEventListener("click", stopScanner);
    document.getElementById("unknownProductForm")?.addEventListener("submit", (event) => { event.preventDefault(); void saveScannerForm("unknown"); });
    document.getElementById("knownProductForm")?.addEventListener("submit", (event) => { event.preventDefault(); void saveScannerForm("known"); });
    document.getElementById("unknownCancelButton")?.addEventListener("click", cancelScannerForm);
    document.getElementById("knownCancelButton")?.addEventListener("click", cancelScannerForm);
    document.querySelectorAll("[data-change-store]").forEach((button) => {
        button.addEventListener("click", () => openStorePicker(button.dataset.changeStore));
    });
    document.getElementById("storePickerCancel")?.addEventListener("click", closeStorePicker);
    document.getElementById("storePickerForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const retailer = document.getElementById("storeRetailer").value.trim();
        const branch = document.getElementById("storeBranch").value.trim();
        if (!retailer || !branch) return;
        const formPrefix = activeStoreForm;
        rememberStore({ retailer, branch });
        closeStorePicker();
        document.getElementById(`${formPrefix || "unknown"}Price`)?.focus();
    });
});

window.addEventListener("beforeunload", stopScanner);
