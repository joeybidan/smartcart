/* Centralized browser client. Only publishable configuration is accepted here. */
(function initializeSupabaseClient() {
    const config = window.SMARTCART_RUNTIME_CONFIG || {};
    const url = String(config.SUPABASE_URL || "").trim();
    const publishableKey = String(config.SUPABASE_PUBLISHABLE_KEY || "").trim();
    const factory = window.supabase && window.supabase.createClient;

    if (!factory || !url || !publishableKey || publishableKey.includes("REPLACE_ME")) {
        window.smartCartSupabase = {
            client: null,
            configured: false,
            reason: !factory ? "Supabase client library unavailable" : "Supabase is not configured"
        };
        return;
    }

    window.smartCartSupabase = {
        client: factory(url, publishableKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: "pkce"
            }
        }),
        configured: true,
        reason: ""
    };
}());
