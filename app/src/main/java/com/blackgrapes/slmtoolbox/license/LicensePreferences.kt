package com.blackgrapes.slmtoolbox.license

import android.content.Context
import android.provider.Settings
import org.json.JSONObject

data class LicenseSnapshot(
    val activated: Boolean,
    val licenseCode: String,
    val customerName: String,
    val expiresAtEpochMs: Long,
    val lastValidatedAtMs: Long,
    val graceDays: Int,
    val lastError: String?
) {
    val isTrial: Boolean
        get() {
            val code = licenseCode.uppercase()
            val name = customerName.uppercase()
            return code.contains("TRIAL") || name.contains("TRIAL")
        }

    fun daysRemaining(now: Long = System.currentTimeMillis()): Int {
        if (expiresAtEpochMs <= 0L) return 0
        val ms = expiresAtEpochMs - now
        if (ms <= 0L) return 0
        return ((ms + 23L * 60L * 60L * 1000L) / (24L * 60L * 60L * 1000L)).toInt()
    }
}

sealed class LicenseAccess {
    data object DevUnlocked : LicenseAccess()
    data class Allowed(val customerName: String, val expiresAtEpochMs: Long) : LicenseAccess()
    data class Grace(val customerName: String, val expiresAtEpochMs: Long, val graceEndsAtMs: Long) :
        LicenseAccess()

    data class Locked(val reason: String) : LicenseAccess()
}

object LicensePreferences {
    private const val PREFS = "slm_license_prefs"
    private const val KEY_ACTIVATED = "activated"
    private const val KEY_CODE = "license_code"
    private const val KEY_CUSTOMER = "customer_name"
    private const val KEY_EXPIRES = "expires_at_ms"
    private const val KEY_VALIDATED = "last_validated_ms"
    private const val KEY_GRACE = "grace_days"
    private const val KEY_ERROR = "last_error"
    private const val KEY_DEVICE = "device_id"

    fun deviceId(context: Context): String {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_DEVICE, null)
        if (!existing.isNullOrBlank()) return existing
        val androidId = Settings.Secure.getString(
            context.applicationContext.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "unknown"
        val id = "slm-$androidId"
        prefs.edit().putString(KEY_DEVICE, id).apply()
        return id
    }

    fun read(context: Context): LicenseSnapshot {
        val p = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return LicenseSnapshot(
            activated = p.getBoolean(KEY_ACTIVATED, false),
            licenseCode = p.getString(KEY_CODE, "") ?: "",
            customerName = p.getString(KEY_CUSTOMER, "") ?: "",
            expiresAtEpochMs = p.getLong(KEY_EXPIRES, 0L),
            lastValidatedAtMs = p.getLong(KEY_VALIDATED, 0L),
            graceDays = p.getInt(KEY_GRACE, LicenseConfig.GRACE_DAYS_DEFAULT),
            lastError = p.getString(KEY_ERROR, null)
        )
    }

    fun saveSuccess(
        context: Context,
        customerName: String,
        expiresAtEpochMs: Long,
        graceDays: Int,
        licenseCode: String = ""
    ) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val editor = prefs.edit()
            .putBoolean(KEY_ACTIVATED, true)
            .putString(KEY_CUSTOMER, customerName)
            .putLong(KEY_EXPIRES, expiresAtEpochMs)
            .putLong(KEY_VALIDATED, System.currentTimeMillis())
            .putInt(KEY_GRACE, graceDays.coerceIn(1, 30))
            .remove(KEY_ERROR)
        val code = licenseCode.trim().uppercase()
        if (code.isNotEmpty()) {
            editor.putString(KEY_CODE, code)
        }
        editor.apply()
    }

    fun saveError(context: Context, error: String) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_ERROR, error)
            .apply()
    }

    fun clear(context: Context) {
        val device = deviceId(context)
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .putString(KEY_DEVICE, device)
            .apply()
    }

    fun evaluateAccess(context: Context, now: Long = System.currentTimeMillis()): LicenseAccess {
        if (!LicenseConfig.enabled) return LicenseAccess.DevUnlocked
        val snap = read(context)
        if (!snap.activated || snap.expiresAtEpochMs <= 0L) {
            return LicenseAccess.Locked("not_activated")
        }
        if (now <= snap.expiresAtEpochMs) {
            return LicenseAccess.Allowed(snap.customerName, snap.expiresAtEpochMs)
        }
        val graceMs = snap.graceDays * 24L * 60L * 60L * 1000L
        val offlineGraceEnds = maxOf(snap.expiresAtEpochMs, snap.lastValidatedAtMs) + graceMs
        if (now <= offlineGraceEnds && snap.lastValidatedAtMs > 0L) {
            return LicenseAccess.Grace(snap.customerName, snap.expiresAtEpochMs, offlineGraceEnds)
        }
        return LicenseAccess.Locked(snap.lastError ?: "expired")
    }

    fun parseExpiresAt(iso: String): Long {
        val cleaned = iso.trim()
            .replace(' ', 'T')
            .let { s ->
                when {
                    s.endsWith("+00:00") -> s.dropLast(6) + "Z"
                    s.endsWith("+00") -> s.dropLast(3) + "Z"
                    else -> s
                }
            }
            .let { s ->
                val hasZone = s.endsWith("Z") || s.contains('+') ||
                    (s.length > 11 && s.lastIndexOf('-') > 10)
                if (!hasZone) s + "Z" else s
            }
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd"
        )
        for (p in patterns) {
            try {
                val sdf = java.text.SimpleDateFormat(p, java.util.Locale.US)
                sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                val parsed = sdf.parse(cleaned) ?: continue
                return parsed.time
            } catch (_: Exception) {
                // try next
            }
        }
        return try {
            val datePart = cleaned.take(10)
            val sdf = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
            sdf.parse(datePart)?.time ?: 0L
        } catch (_: Exception) {
            0L
        }
    }

    fun applyServerJson(context: Context, obj: JSONObject, fallbackCode: String = ""): Boolean {
        if (!obj.optBoolean("ok", false)) return false
        val expiresIso = obj.optString("expires_at", "")
        val expiresMs = parseExpiresAt(expiresIso)
        if (expiresMs <= 0L) return false
        val codeFromServer = obj.optString("code", "").ifBlank { fallbackCode }
        saveSuccess(
            context = context,
            customerName = obj.optString("customer_name", ""),
            expiresAtEpochMs = expiresMs,
            graceDays = obj.optInt("grace_days", LicenseConfig.GRACE_DAYS_DEFAULT),
            licenseCode = codeFromServer
        )
        return true
    }
}
