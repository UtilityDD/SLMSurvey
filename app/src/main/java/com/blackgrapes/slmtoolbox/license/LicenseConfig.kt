package com.blackgrapes.slmtoolbox.license

import com.blackgrapes.slmtoolbox.BuildConfig

object LicenseConfig {
    /** When blank, app skips rental gate (local/dev builds). */
    val enabled: Boolean
        get() = BuildConfig.SUPABASE_URL.isNotBlank() &&
            BuildConfig.SUPABASE_ANON_KEY.isNotBlank()

    val supabaseUrl: String get() = BuildConfig.SUPABASE_URL.trimEnd('/')
    val anonKey: String get() = BuildConfig.SUPABASE_ANON_KEY

    const val GRACE_DAYS_DEFAULT = 7
    /** Re-validate with server at most this often when online. */
    const val REVALIDATE_INTERVAL_MS = 12L * 60L * 60L * 1000L
}
