async function loadTripDetails() {
    const tripId = localStorage.getItem("selectedTrip");
    if (!tripId) { smartCart.showToast("No trip selected", "warning"); window.setTimeout(() => { location.href = "trip-history.html"; }, 700); return; }
    try {
        await smartCart.dbReady;
        const trip = await new Promise((resolve) => { const request = db.transaction("trips", "readonly").objectStore("trips").get(tripId); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null); });
        const summary = document.getElementById("tripSummary");
        if (!trip) { summary.textContent = "Trip not found."; return; }
        summary.className = "";
        summary.innerHTML = `<div class="status-line"><span class="status-label">Trip</span><strong>${smartCart.escapeHtml(trip.tripId)}</strong></div><div class="status-line"><span class="status-label">Date</span><strong>${new Date(trip.date).toLocaleString()}</strong></div><div class="status-line"><span class="status-label">Total</span><strong>${smartCart.formatPHP(trip.total)}</strong></div>`;
        const items = await smartCart.getTripItems(tripId);
        const container = document.getElementById("tripItems");
        if (!items.length) { container.className = "empty-state"; container.textContent = "No items recorded."; return; }
        container.className = "";
        container.innerHTML = items.map((item) => `<div class="list-item"><span>${smartCart.escapeHtml(item.name)} × ${item.quantity}<small class="cart-meta">${smartCart.formatPHP(item.unitPrice)} each</small></span><strong>${smartCart.formatPHP(item.total)}</strong></div>`).join("");
    } catch (error) { console.warn("Trip details could not load", error); }
}
document.addEventListener("DOMContentLoaded", () => { void loadTripDetails(); });
