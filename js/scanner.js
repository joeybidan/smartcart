let codeReader = null;
let scannerRunning = false;
let scanLocked = false;
let lastBarcode = "";
let lastScanAt = 0;
const RESCAN_DELAY_MS = 1100;

function setScannerMessage(message, type = "info") {
    const result = document.getElementById("scanResult");
    const status = document.getElementById("scannerStatus");
    if (result) result.textContent = message;
    if (status) status.textContent = message;
    if (type === "error") window.smartCart?.showToast(message, "error");
}

function setScannerButtons() {
    const start = document.getElementById("startScannerButton");
    const stop = document.getElementById("stopScannerButton");
    if (start) { start.disabled = scannerRunning; start.textContent = scannerRunning ? "Scanning…" : "Start scanner"; }
    if (stop) stop.disabled = !scannerRunning;
}

function supportedFormats() {
    if (!window.ZXing?.BarcodeFormat) return undefined;
    const { BarcodeFormat } = window.ZXing;
    return [BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.EAN_13, BarcodeFormat.EAN_14, BarcodeFormat.ITF].filter(Boolean);
}

async function startScanner() {
    if (scannerRunning) return;
    if (!window.ZXing?.BrowserMultiFormatReader) { setScannerMessage("Scanner library unavailable. You can still enter products from the Products page.", "error"); return; }
    const video = document.getElementById("scannerVideo");
    if (!video) return;
    try {
        const hints = new Map();
        const formats = supportedFormats();
        if (formats && window.ZXing.DecodeHintType) hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
        codeReader = new window.ZXing.BrowserMultiFormatReader(hints, 250);
        scannerRunning = true;
        setScannerButtons();
        setScannerMessage("Point the camera at a barcode.");
        await codeReader.decodeFromVideoDevice(null, video, (result, error) => {
            if (result) void handleBarcode(result.getText());
            else if (error && !isNotFoundError(error)) return;
        });
    } catch (error) {
        scannerRunning = false;
        setScannerButtons();
        const message = error?.name === "NotAllowedError" ? "Camera permission denied. Allow camera access or use manual entry." : "The camera could not start. Check browser permissions and try again.";
        setScannerMessage(message, "error");
    }
}

function isNotFoundError(error) {
    return error?.name === "NotFoundException" || String(error?.message || "").toLowerCase().includes("not found");
}

function stopScanner() {
    try { codeReader?.reset(); } catch (error) { console.warn("Scanner reset skipped", error); }
    codeReader = null;
    scannerRunning = false;
    scanLocked = false;
    setScannerButtons();
    setScannerMessage("Scanner stopped.");
}

function releaseScannerLock() {
    window.setTimeout(() => { scanLocked = false; }, RESCAN_DELAY_MS);
}

async function handleBarcode(rawBarcode) {
    const barcode = window.smartCart?.validateBarcode(rawBarcode);
    if (!barcode) { setScannerMessage("Invalid or incomplete barcode. Supported lengths are 8, 12, 13, and 14 digits.", "error"); releaseScannerLock(); return; }
    if (scanLocked || (barcode === lastBarcode && Date.now() - lastScanAt < RESCAN_DELAY_MS)) return;
    scanLocked = true;
    lastBarcode = barcode;
    lastScanAt = Date.now();
    if (navigator.vibrate) navigator.vibrate(90);
    setScannerMessage(`Barcode detected: ${barcode}`);
    try {
        const product = await window.smartCart.findProduct(barcode);
        if (product) showKnownProductForm(product, barcode);
        else showUnknownProductForm(barcode);
    } catch (error) {
        console.warn("Local barcode lookup failed", error);
        setScannerMessage("The barcode was detected, but local lookup failed.", "error");
        releaseScannerLock();
    }
}

function showUnknownProductForm(barcode) {
    hideForm("knownProductCard");
    const card = document.getElementById("unknownProductCard");
    if (!card) return;
    card.hidden = false;
    document.getElementById("unknownBarcode").value = barcode;
    ["unknownName", "unknownBrand", "unknownCategory", "unknownSize", "unknownUnit", "unknownPrice"].forEach((id) => { document.getElementById(id).value = ""; });
    document.getElementById("unknownRetailer").value = "KCC";
    document.getElementById("unknownBranch").value = "Main";
    setScannerMessage(`Unknown product ${barcode}. Complete the details before saving.`);
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.getElementById("unknownName")?.focus(), 250);
}

function showKnownProductForm(product, barcode) {
    hideForm("unknownProductCard");
    const card = document.getElementById("knownProductCard");
    if (!card) return;
    card.hidden = false;
    document.getElementById("knownBarcode").value = barcode;
    document.getElementById("knownName").value = product.name || "";
    document.getElementById("knownBrand").value = product.brand || "";
    document.getElementById("knownCategory").value = product.category || "";
    document.getElementById("knownSize").value = product.size || "";
    document.getElementById("knownUnit").value = product.unit || "";
    document.getElementById("knownPrice").value = Number.isFinite(product.lastPrice) ? product.lastPrice : "";
    document.getElementById("knownRetailer").value = product.lastRetailer || "KCC";
    document.getElementById("knownBranch").value = product.lastBranch || "Main";
    setScannerMessage(`${product.name} is known. Save a new price observation or cancel.`);
    card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideForm(id) { const card = document.getElementById(id); if (card) card.hidden = true; }
function resetScannerForms() { hideForm("unknownProductCard"); hideForm("knownProductCard"); }

function formValues(prefix) {
    return {
        barcode: document.getElementById(`${prefix}Barcode`).value.trim(),
        name: document.getElementById(`${prefix}Name`).value.trim(),
        brand: document.getElementById(`${prefix}Brand`).value.trim(),
        category: document.getElementById(`${prefix}Category`).value.trim(),
        size: document.getElementById(`${prefix}Size`).value.trim(),
        unit: document.getElementById(`${prefix}Unit`).value.trim(),
        price: Number(document.getElementById(`${prefix}Price`).value),
        retailer: document.getElementById(`${prefix}Retailer`).value.trim(),
        branch: document.getElementById(`${prefix}Branch`).value.trim(),
        capturedAt: new Date().toISOString(),
        source: "scanner"
    };
}

async function saveScannerForm(prefix, addToCart) {
    const values = formValues(prefix);
    const check = window.smartCart.validateScan(values);
    if (!check.valid) { setScannerMessage(check.errors.join(" "), "error"); return; }
    try {
        const saved = await window.smartCart.saveAndSyncScan(values, addToCart);
        setScannerMessage(saved.syncStatus === "synced" ? "Saved to cloud. Ready for the next barcode." : "Saved locally. Synchronization is pending; ready for the next barcode.");
        resetScannerForms();
        releaseScannerLock();
    } catch (error) {
        setScannerMessage(error.message || "Record could not be saved locally.", "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("startScannerButton")?.addEventListener("click", () => { void startScanner(); });
    document.getElementById("stopScannerButton")?.addEventListener("click", stopScanner);
    document.getElementById("unknownProductForm")?.addEventListener("submit", (event) => { event.preventDefault(); void saveScannerForm("unknown", false); });
    document.getElementById("unknownAddCartButton")?.addEventListener("click", () => { void saveScannerForm("unknown", true); });
    document.getElementById("unknownCancelButton")?.addEventListener("click", () => { resetScannerForms(); setScannerMessage("Cancelled. Ready for the next barcode."); releaseScannerLock(); });
    document.getElementById("knownProductForm")?.addEventListener("submit", (event) => { event.preventDefault(); void saveScannerForm("known", false); });
    document.getElementById("knownAddCartButton")?.addEventListener("click", () => { void saveScannerForm("known", true); });
    document.getElementById("knownCancelButton")?.addEventListener("click", () => { resetScannerForms(); setScannerMessage("Cancelled. Ready for the next barcode."); releaseScannerLock(); });
});

window.addEventListener("beforeunload", stopScanner);
