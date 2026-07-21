let codeReader = null;
let scannerRunning = false;
let scanLocked = false;
let lastBarcode = "";
let lastScanTime = 0;

const RESCAN_DELAY_MS = 2200;

/**
 * Starts the camera once and continuously searches for barcodes.
 */
async function startScanner() {
    if (scannerRunning) {
        updateScanResult("Scanner is already running. Point the camera at a barcode.");
        return;
    }

    const videoElement = document.getElementById("scannerVideo");

    if (!videoElement) {
        console.error("scannerVideo element was not found.");
        return;
    }

    if (typeof ZXing === "undefined") {
        updateScanResult("Scanner library failed to load. Check your internet connection.");
        console.error("ZXing is not available.");
        return;
    }

    codeReader = new ZXing.BrowserMultiFormatReader();
    scannerRunning = true;
    scanLocked = false;

    setScannerButtonState(true);
    updateScanResult("Scanning… Keep the barcode clear, flat, and inside the camera view.");

    try {
        await codeReader.decodeFromVideoDevice(
            null,
            "scannerVideo",
            async (result, error) => {
                if (result && result.text) {
                    const barcode = String(result.text).trim();
                    const now = Date.now();

                    // Prevent the same barcode from firing repeatedly
                    // while it remains in front of the camera.
                    if (
                        scanLocked ||
                        (barcode === lastBarcode &&
                            now - lastScanTime < RESCAN_DELAY_MS)
                    ) {
                        return;
                    }

                    scanLocked = true;
                    lastBarcode = barcode;
                    lastScanTime = now;

                    await barcodeFound(barcode);
                    return;
                }

                /*
                 * ZXing reports NotFoundException repeatedly while checking
                 * frames that do not contain a readable barcode.
                 * That is normal and should not be displayed as an app error.
                 */
                if (
                    error &&
                    !(error instanceof ZXing.NotFoundException)
                ) {
                    console.warn("Scanner frame warning:", error);
                }
            }
        );
    } catch (error) {
        console.error("Unable to start scanner:", error);

        scannerRunning = false;
        scanLocked = false;
        setScannerButtonState(false);

        updateScanResult(
            "Camera could not start. Allow camera permission, then press Start Scanner again."
        );
    }
}

/**
 * Handles a successfully decoded barcode.
 */
async function barcodeFound(barcode) {

        barcode = String(barcode).trim();

    const validGroceryBarcode =
        /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(barcode);

    if (!validGroceryBarcode) {
        updateScanResult(
            `Incomplete barcode detected: ${barcode}. Hold the full barcode steady and try again.`
        );

        releaseScannerLock();
        return;
    }
    
    updateScanResult(`Barcode detected: ${barcode}`);

    giveScanFeedback();

    try {
        const product = await findProduct(barcode);

        if (product) {
            await handleKnownProduct(product, barcode);
            return;
        }

        showUnknownProductForm(barcode);
    } catch (error) {
        console.error("Barcode lookup failed:", error);

        updateScanResult(
            "The barcode was detected, but SmartCart could not check the product database."
        );

        releaseScannerLock();
    }
}

/**
 * Handles a barcode already found in the product database.
 */
async function handleKnownProduct(product, barcode) {
    const price = Number(product.lastPrice);

    if (!Number.isFinite(price)) {
        updateScanResult(
            `${product.name || "Product"} has an invalid stored price. Edit the product before adding it.`
        );

        releaseScannerLock();
        return;
    }

    const shouldAdd = window.confirm(
        [
            "Product Found",
            "",
            `Name: ${product.name}`,
            `Category: ${product.category || "Uncategorized"}`,
            `Price: $${price.toFixed(2)}`,
            "",
            "Add this product to the cart?"
        ].join("\n")
    );

    if (!shouldAdd) {
        updateScanResult(
            `${product.name} was recognized but was not added. Continue scanning.`
        );

        releaseScannerLock();
        return;
    }

    try {
        await addToCart(barcode);

        if (typeof updateCartBadge === "function") {
            await updateCartBadge();
        }

        if (typeof updateHomeDashboard === "function") {
            await updateHomeDashboard();
        }

        updateScanResult(
            `✅ ${product.name} added to cart — $${price.toFixed(2)}`
        );

        showScannerToast(
            `🛒 ${product.name} added to cart`
        );
    } catch (error) {
        console.error("Could not add scanned product:", error);

        updateScanResult(
            `${product.name} was found, but it could not be added to the cart.`
        );
    }

    releaseScannerLock();
}

/**
 * Shows the form for a barcode that does not exist yet.
 */
function showUnknownProductForm(barcode) {
    const card = document.getElementById("unknownProductCard");
    const barcodeInput = document.getElementById("unknownBarcode");
    const nameInput = document.getElementById("unknownName");
    const categoryInput = document.getElementById("unknownCategory");
    const priceInput = document.getElementById("unknownPrice");

    if (!card || !barcodeInput) {
        console.error("Unknown Product form is missing from scanner.html.");

        updateScanResult(
            `Unknown barcode detected: ${barcode}. The product form could not be opened.`
        );

        releaseScannerLock();
        return;
    }

    barcodeInput.value = barcode;

    if (nameInput) nameInput.value = "";
    if (categoryInput) categoryInput.value = "";
    if (priceInput) priceInput.value = "";

    card.style.display = "block";

    updateScanResult(
        `Unknown barcode: ${barcode}. Complete the product information below.`
    );

    card.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    setTimeout(() => {
        nameInput?.focus();
    }, 350);

    /*
     * Keep scanLocked = true while the form is open.
     * This prevents another barcode from interrupting data entry.
     */
}

/**
 * Saves an unknown product and adds it to the cart.
 * This function is called by scanner.html.
 */
async function saveUnknownProduct() {
    const barcodeInput = document.getElementById("unknownBarcode");
    const nameInput = document.getElementById("unknownName");
    const categoryInput = document.getElementById("unknownCategory");
    const priceInput = document.getElementById("unknownPrice");
    const card = document.getElementById("unknownProductCard");

    const barcode = barcodeInput?.value.trim() || "";
    const name = nameInput?.value.trim() || "";
    const category = categoryInput?.value.trim() || "";
    const price = Number.parseFloat(priceInput?.value || "");

    if (!barcode || !name || !category || !Number.isFinite(price) || price <= 0) {
        updateScanResult(
            "Please enter a product name, category, and a valid price greater than zero."
        );

        showScannerToast("⚠️ Complete all product fields");
        return;
    }

    try {
        const existingProduct = await findProduct(barcode);

        if (existingProduct) {
            updateScanResult(
                `${existingProduct.name} already uses barcode ${barcode}.`
            );

            showScannerToast("⚠️ Barcode already exists");
            return;
        }

        await addProduct({
            barcode,
            name,
            category,
            lastPrice: price
        });

        await addToCart(barcode);

        if (typeof updateCartBadge === "function") {
            await updateCartBadge();
        }

        if (typeof updateHomeDashboard === "function") {
            await updateHomeDashboard();
        }

        if (card) {
            card.style.display = "none";
        }

        updateScanResult(
            `✅ ${name} saved and added to cart — $${price.toFixed(2)}`
        );

        showScannerToast(
            `✅ ${name} saved and added`
        );

        lastBarcode = barcode;
        lastScanTime = Date.now();

        releaseScannerLock();
    } catch (error) {
        console.error("Unable to save unknown product:", error);

        updateScanResult(
            "SmartCart could not save this product. Check the console for details."
        );
    }
}

/**
 * Unlocks the scanner after a short delay so the same barcode
 * is not immediately read several times.
 */
function releaseScannerLock() {
    window.setTimeout(() => {
        scanLocked = false;

        if (scannerRunning) {
            updateScanResult(
                "Ready for the next barcode."
            );
        }
    }, RESCAN_DELAY_MS);
}

/**
 * Stops the scanner and releases the camera.
 */
function stopScanner() {
    if (codeReader) {
        codeReader.reset();
        codeReader = null;
    }

    scannerRunning = false;
    scanLocked = false;

    setScannerButtonState(false);
    updateScanResult("Scanner stopped.");
}

/**
 * Updates the Last Scan area.
 */
function updateScanResult(message) {
    const resultElement = document.getElementById("scanResult");

    if (resultElement) {
        resultElement.textContent = message;
    }
}

/**
 * Disables the Start button while the scanner is running.
 */
function setScannerButtonState(isRunning) {
    const button = document.querySelector(
        'button[onclick="startScanner()"]'
    );

    if (!button) return;

    button.disabled = isRunning;
    button.textContent = isRunning
        ? "Scanning…"
        : "Start Scanner";
}

/**
 * Provides phone feedback after a successful decode.
 */
function giveScanFeedback() {
    if ("vibrate" in navigator) {
        navigator.vibrate(120);
    }
}

/**
 * Uses the existing toast if scanner.html has one.
 * Otherwise it temporarily displays the message in Last Scan.
 */
function showScannerToast(message) {
    const toast = document.getElementById("toast");

    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    window.setTimeout(() => {
        toast.classList.remove("show");
    }, 2200);
}

/**
 * Release the camera when leaving the scanner page.
 */
window.addEventListener("beforeunload", stopScanner);