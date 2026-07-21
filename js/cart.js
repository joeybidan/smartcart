async function loadCart() {
    try {
        await smartCart.dbReady;
        const items = await smartCart.getCartItems();
        const container = document.getElementById("cartItems");
        const totalElement = document.getElementById("cartTotal");
        const summary = document.getElementById("cartSummary");
        const total = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
        if (summary) summary.textContent = `${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} item(s)`;
        if (totalElement) totalElement.textContent = smartCart.formatPHP(total);
        if (!items.length) { container.className = "empty-state"; container.textContent = "Your cart is empty. Scan or add a local product to begin."; return; }
        container.className = "";
        container.innerHTML = items.map((item) => `<article class="cart-item"><div><div class="cart-name">${smartCart.escapeHtml(item.name)}</div><div class="cart-meta">Unit: ${smartCart.formatPHP(item.price)} · Subtotal: ${smartCart.formatPHP((Number(item.price) || 0) * (Number(item.quantity) || 0))}</div><div class="cart-controls"><button class="qty-btn" data-action="decrease" data-id="${item.id}" type="button" aria-label="Decrease quantity">−</button><span class="qty-number">${item.quantity}</span><button class="qty-btn" data-action="increase" data-id="${item.id}" type="button" aria-label="Increase quantity">+</button></div></div><button class="remove-btn" data-action="remove" data-id="${item.id}" type="button">Remove</button></article>`).join("");
    } catch (error) { console.warn("Cart could not load", error); }
}

async function handleCartAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    try {
        if (button.dataset.action === "remove") await smartCart.deleteCartItem(button.dataset.id);
        if (button.dataset.action === "increase") await smartCart.increaseCartQuantity(button.dataset.id);
        if (button.dataset.action === "decrease") await smartCart.decreaseCartQuantity(button.dataset.id);
        await loadCart(); await smartCart.updateCartBadge(); await smartCart.updateHomeDashboard();
    } catch (error) { smartCart.showToast(error.message || "Cart update failed", "error"); }
}

async function emptyCart() {
    if (!await smartCart.confirmAction("Remove all items from the current cart?", "Empty cart")) return;
    await smartCart.clearCart(); await loadCart(); await smartCart.updateCartBadge(); await smartCart.updateHomeDashboard(); smartCart.showToast("Cart emptied", "success");
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("cartItems")?.addEventListener("click", (event) => { void handleCartAction(event); });
    document.getElementById("checkoutButton")?.addEventListener("click", () => { void smartCart.checkoutCart().then(loadCart); });
    document.getElementById("emptyCartButton")?.addEventListener("click", () => { void emptyCart(); });
    void loadCart();
});
