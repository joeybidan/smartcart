async function runMigration() {
    const button = document.getElementById("migrateProductsButton");
    if (button) button.disabled = true;
    try {
        const totals = await smartCart.migrateLocalProducts();
        const message = `Migrated: ${totals.migrated} · Skipped: ${totals.skipped} · Failed: ${totals.failed}. Failed records remain available for retry.`;
        document.getElementById("migrationResult").textContent = message;
        smartCart.showToast(totals.failed ? "Migration finished with failures" : "Migration finished", totals.failed ? "warning" : "success");
    } catch (error) { document.getElementById("migrationResult").textContent = error.message || "Migration failed."; smartCart.showToast("Migration failed", "error"); }
    finally { if (button) button.disabled = false; }
}

async function importBackupFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
        const backup = JSON.parse(await file.text());
        await smartCart.importLocalBackup(backup);
    } catch (error) { smartCart.showToast(error.message || "Backup is invalid and was not imported", "error"); }
    event.target.value = "";
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("retrySyncButton")?.addEventListener("click", () => { void smartCart.retrySync().then(() => smartCart.showToast("Retry complete", "success")); });
    document.getElementById("migrateProductsButton")?.addEventListener("click", () => { void runMigration(); });
    document.getElementById("exportBackupButton")?.addEventListener("click", () => { void smartCart.exportLocalBackup(); });
    document.getElementById("exportCsvButton")?.addEventListener("click", () => { void smartCart.exportProductsCsv(); });
    document.getElementById("importBackupInput")?.addEventListener("change", (event) => { void importBackupFile(event); });
});
