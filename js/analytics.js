function renderMetric(label, value) { return `<div class="sync-stat"><strong>${value}</strong><span>${label}</span></div>`; }

async function loadBudget() {
    const budget = await smartCart.getBudget();
    const spending = await smartCart.getMonthlySpending();
    const currentMonth = Object.keys(spending).sort().pop();
    const spent = currentMonth ? spending[currentMonth] : 0;
    const container = document.getElementById("budgetDashboard");
    if (!container) return;
    container.innerHTML = budget ? `${renderMetric("Budget", smartCart.formatPHP(budget.amount))}${renderMetric("Spent", smartCart.formatPHP(spent))}${renderMetric("Remaining", smartCart.formatPHP(Number(budget.amount) - spent))}${renderMetric("Used", `${budget.amount > 0 ? ((spent / budget.amount) * 100).toFixed(1) : "0.0"}%`)}` : `<div class="empty-state">No budget set.</div>`;
}

async function renderSpending() {
    const monthly = Object.entries(await smartCart.getMonthlySpending()).sort((a, b) => a[0].localeCompare(b[0]));
    const monthlyContainer = document.getElementById("monthlySpending");
    monthlyContainer.className = monthly.length ? "" : "empty-state";
    monthlyContainer.innerHTML = monthly.length ? monthly.map(([month, total]) => `<div class="list-item"><span>${month}</span><strong>${smartCart.formatPHP(total)}</strong></div>`).join("") : "No trips recorded yet.";
    const categories = Object.entries(await smartCart.getCategorySpending()).sort((a, b) => b[1] - a[1]);
    const categoryContainer = document.getElementById("categorySpending");
    categoryContainer.className = categories.length ? "" : "empty-state";
    categoryContainer.innerHTML = categories.length ? categories.map(([category, total]) => `<div class="list-item"><span>${smartCart.escapeHtml(category)}</span><strong>${smartCart.formatPHP(total)}</strong></div>`).join("") : "No category spending yet.";
}

async function renderInflation() {
    const stats = await smartCart.getInflationStats();
    document.getElementById("inflationDashboard").innerHTML = `${renderMetric("Average change", `${Number(stats.overall).toFixed(1)}%`)}${renderMetric("Changes tracked", stats.totalChanges)}${renderMetric("Largest increase", stats.highestIncrease ? `${smartCart.escapeHtml(stats.highestIncrease.name)} ${Number(stats.highestIncrease.change).toFixed(1)}%` : "None")}${renderMetric("Largest decrease", stats.highestDecrease ? `${smartCart.escapeHtml(stats.highestDecrease.name)} ${Number(stats.highestDecrease.change).toFixed(1)}%` : "None")}`;
    const history = await smartCart.getPriceHistory();
    const container = document.getElementById("historyList");
    container.innerHTML = history.length ? history.slice().reverse().slice(0, 20).map((item) => `<div class="product-card"><strong>${smartCart.escapeHtml(item.name)}</strong><p>${smartCart.formatPHP(item.oldPrice)} → ${smartCart.formatPHP(item.newPrice)} · ${Number(item.change || 0).toFixed(1)}%</p><p>${smartCart.escapeHtml(item.retailer || "")} · ${new Date(item.capturedAt || item.createdAt).toLocaleString()}</p></div>`).join("") : `<div class="empty-state">No price observations yet.</div>`;
}

async function initializeAnalytics() {
    try { await smartCart.dbReady; await loadBudget(); await renderSpending(); await renderInflation(); } catch (error) { console.warn("Analytics could not load", error); smartCart.showToast("Analytics could not load", "error"); }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("saveBudgetBtn")?.addEventListener("click", async () => { const amount = Number(document.getElementById("budgetInput").value); if (!Number.isFinite(amount) || amount <= 0) { smartCart.showToast("Enter a valid budget greater than zero", "error"); return; } await smartCart.setBudget(amount); await loadBudget(); smartCart.showToast("Budget saved", "success"); });
    document.getElementById("deleteBudgetBtn")?.addEventListener("click", async () => { await smartCart.deleteBudget(); await loadBudget(); smartCart.showToast("Budget deleted", "success"); });
    void initializeAnalytics();
});
