async function loadTrips() {
    try {
        await smartCart.dbReady;
        const trips = await new Promise((resolve) => { const request = db.transaction("trips", "readonly").objectStore("trips").getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => resolve([]); });
        const container = document.getElementById("tripList");
        if (!trips.length) { container.className = "empty-state"; container.textContent = "No trips yet."; return; }
        container.className = "";
        container.innerHTML = trips.sort((a, b) => String(b.date).localeCompare(String(a.date))).map((trip) => `<article class="product-card"><div class="section-heading"><div><h3>${smartCart.escapeHtml(trip.tripId)}</h3><p>${new Date(trip.date).toLocaleString()}</p></div><strong>${smartCart.formatPHP(trip.total)}</strong></div><button class="button button-secondary" type="button" data-trip-id="${smartCart.escapeHtml(trip.tripId)}">View items</button></article>`).join("");
    } catch (error) { console.warn("Trips could not load", error); }
}

document.addEventListener("DOMContentLoaded", () => { document.getElementById("tripList")?.addEventListener("click", (event) => { const button = event.target.closest("[data-trip-id]"); if (!button) return; localStorage.setItem("selectedTrip", button.dataset.tripId); location.href = "trip-details.html"; }); void loadTrips(); });
