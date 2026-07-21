async function loadHome() {
    try {
        await smartCart.dbReady;
        const trips = await new Promise((resolve) => {
            const request = db.transaction("trips", "readonly").objectStore("trips").getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });
        const container = document.getElementById("recentTrips");
        if (!container || !trips.length) return;
        container.className = "";
        container.innerHTML = trips.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3).map((trip) => `
            <div class="list-item"><span>${new Date(trip.date).toLocaleDateString()}</span><strong>${smartCart.formatPHP(trip.total)}</strong></div>`).join("");
    } catch (error) { console.warn("Home dashboard could not load trips", error); }
}
document.addEventListener("DOMContentLoaded", () => { void loadHome(); });
