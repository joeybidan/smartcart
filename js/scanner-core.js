(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.smartCartScannerCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const BARCODE_PATTERN = /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/;

    function normalizeBarcode(value) {
        const barcode = String(value ?? "").trim();
        return BARCODE_PATTERN.test(barcode) ? barcode : null;
    }

    function createBarcodeConfirmer(options = {}) {
        const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 1500;
        let candidate = "";
        let count = 0;
        let lastDetectedAt = 0;
        let confirmedBarcode = "";

        function snapshot(confirmed = false, barcode = null) {
            return { candidate, count, confirmedBarcode, confirmed, barcode };
        }

        function reset({ preserveConfirmed = false } = {}) {
            candidate = "";
            count = 0;
            lastDetectedAt = 0;
            if (!preserveConfirmed) confirmedBarcode = "";
            return snapshot();
        }

        function expire(at = Date.now()) {
            if (candidate && at - lastDetectedAt > windowMs) reset({ preserveConfirmed: true });
            return snapshot();
        }

        function observe(value, at = Date.now()) {
            const barcode = normalizeBarcode(value);
            if (!barcode) {
                reset({ preserveConfirmed: true });
                return snapshot(false, null);
            }

            if (!candidate || barcode !== candidate || at - lastDetectedAt > windowMs) {
                candidate = barcode;
                count = 1;
                lastDetectedAt = at;
                return snapshot(false, barcode);
            }

            count += 1;
            lastDetectedAt = at;
            if (count < 2) return snapshot(false, barcode);

            confirmedBarcode = barcode;
            candidate = "";
            count = 0;
            lastDetectedAt = 0;
            return snapshot(true, barcode);
        }

        return { observe, expire, reset, snapshot: () => snapshot() };
    }

    function normalizeCloudProduct(product) {
        const numericPrice = Number(product?.last_price);
        return {
            barcode: String(product?.barcode ?? "").trim(),
            name: String(product?.name ?? "").trim(),
            brand: String(product?.brand ?? "").trim(),
            category: String(product?.category ?? "").trim() || "Uncategorized",
            size: String(product?.size ?? "").trim(),
            unit: String(product?.unit ?? "").trim(),
            lastPrice: Number.isFinite(numericPrice) ? numericPrice : null,
            lastRetailer: String(product?.last_retailer ?? "").trim(),
            lastBranch: String(product?.last_branch ?? "").trim(),
            lastPriceAt: product?.last_price_at ?? null,
            createdAt: product?.created_at ?? new Date().toISOString(),
            updatedAt: product?.updated_at ?? new Date().toISOString()
        };
    }

    async function lookupProductAnywhere(barcode, adapters) {
        const normalizedBarcode = normalizeBarcode(barcode);
        if (!normalizedBarcode) return { product: null, source: "New", error: null };

        const localProduct = await adapters.findLocal(normalizedBarcode);
        if (localProduct) return { product: localProduct, source: "Local", error: null };
        if (!adapters.canUseCloud()) return { product: null, source: "New", error: null };

        try {
            const cloudProduct = await adapters.findCloud(normalizedBarcode);
            if (!cloudProduct) return { product: null, source: "New", error: null };
            const product = normalizeCloudProduct(cloudProduct);
            await adapters.cacheLocal(product);
            return { product, source: "Cloud", error: null };
        } catch (error) {
            return { product: null, source: "New", error };
        }
    }

    return { normalizeBarcode, createBarcodeConfirmer, normalizeCloudProduct, lookupProductAnywhere };
});
