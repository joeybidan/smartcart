let localProducts = [];

async function loadProducts() {
    try {
        await smartCart.dbReady;
        const request = db.transaction("products", "readonly").objectStore("products").getAll();
        request.onsuccess = () => { localProducts = request.result || []; renderProducts(); };
        request.onerror = () => { localProducts = []; renderProducts(); };
    } catch (error) { console.warn("Products could not load", error); }
}

function renderProducts() {
    const container = document.getElementById("productsList");
    if (!container) return;
    const query = String(document.getElementById("productSearch")?.value || "").trim().toLowerCase();
    const products = localProducts.filter((product) => !query || [product.barcode, product.name, product.brand, product.category].join(" ").toLowerCase().includes(query));
    if (!products.length) { container.className = "empty-state"; container.textContent = "No products match this search yet."; return; }
    container.className = "";
    container.innerHTML = products.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map((product) => `
        <article class="product-card"><div class="section-heading"><div><h3>${smartCart.escapeHtml(product.name || "Unnamed product")}</h3><p>${smartCart.escapeHtml(product.brand || "")}${product.brand ? " · " : ""}${smartCart.escapeHtml(product.category || "Uncategorized")}</p></div><span class="sync-badge">${smartCart.escapeHtml(product.barcode)}</span></div><p>${smartCart.escapeHtml([product.size, product.unit].filter(Boolean).join(" · "))}</p><div class="price">${smartCart.formatPHP(product.lastPrice)}</div><p>${smartCart.escapeHtml(product.lastRetailer || "No retailer")} · ${smartCart.escapeHtml(product.lastBranch || "No branch")}</p><button class="button button-secondary" type="button" data-add-barcode="${smartCart.escapeHtml(product.barcode)}">Add to cart</button></article>`).join("");
}

async function saveProductForm(event) {
    event.preventDefault();
    const values = { barcode: document.getElementById("barcode").value.trim(), name: document.getElementById("productName").value.trim(), brand: document.getElementById("brand").value.trim(), category: document.getElementById("category").value.trim(), size: document.getElementById("size").value.trim(), unit: document.getElementById("unit").value.trim(), price: Number(document.getElementById("price").value), retailer: document.getElementById("retailer").value.trim(), branch: document.getElementById("branch").value.trim(), capturedAt: new Date().toISOString(), source: "manual" };
    const validation = smartCart.validateScan(values);
    if (!validation.valid) { smartCart.showToast(validation.errors.join(" "), "error"); return; }
    try { await smartCart.saveAndSyncScan(values, false); document.getElementById("productForm").reset(); document.getElementById("retailer").value = "KCC"; document.getElementById("branch").value = "Main"; await loadProducts(); } catch (error) { smartCart.showToast(error.message || "Product could not be saved", "error"); }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("productForm")?.addEventListener("submit", (event) => { void saveProductForm(event); });
    document.getElementById("clearProductForm")?.addEventListener("click", () => document.getElementById("productForm")?.reset());
    document.getElementById("productSearch")?.addEventListener("input", renderProducts);
    document.getElementById("productsList")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-add-barcode]");
        if (button) void smartCart.addToCartByBarcode(button.dataset.addBarcode).then(() => smartCart.showToast("Added to cart", "success")).catch((error) => smartCart.showToast(error.message, "error"));
    });
    void loadProducts();
});
