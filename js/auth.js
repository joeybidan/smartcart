function authMessage(message, type = "info") {
    const element = document.getElementById("authMessage");
    if (element) element.textContent = message;
    if (type !== "info") smartCart.showToast(message, type);
}

async function signIn(event) {
    event.preventDefault();
    const supabase = window.smartCartSupabase?.client;
    if (!supabase) { authMessage("Supabase is not configured. Local-only scanning is still available.", "warning"); return; }
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    if (!email || password.length < 6) { authMessage("Enter a valid email and a password with at least 6 characters.", "error"); return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { authMessage(error.message || "Sign-in failed.", "error"); return; }
    authMessage("Signed in. Pending scans will retry automatically.", "success");
}

async function signUp() {
    const supabase = window.smartCartSupabase?.client;
    if (!supabase) { authMessage("Supabase is not configured. Add the two public runtime variables first.", "warning"); return; }
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    if (!email || password.length < 6) { authMessage("Enter a valid email and a password with at least 6 characters.", "error"); return; }
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: email.split("@")[0] } } });
    if (error) { authMessage(error.message || "Account creation failed.", "error"); return; }
    authMessage("Account created. Check your email if confirmation is enabled, then sign in. New accounts are contributors until an admin assigns a role.", "success");
}

async function signOut() {
    const supabase = window.smartCartSupabase?.client;
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) smartCart.showToast(error.message || "Sign-out failed", "error");
    else smartCart.showToast("Signed out. Local scans remain on this device.", "success");
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("authForm")?.addEventListener("submit", (event) => { void signIn(event); });
    document.getElementById("signUpButton")?.addEventListener("click", () => { void signUp(); });
    document.getElementById("signOutButton")?.addEventListener("click", () => { void signOut(); });
});
