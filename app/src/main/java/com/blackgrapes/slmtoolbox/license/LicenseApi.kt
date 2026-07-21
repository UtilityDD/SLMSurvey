package com.blackgrapes.slmtoolbox.license

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

sealed class LicenseResult {
    data class Success(
        val customerName: String,
        val expiresAtEpochMs: Long
    ) : LicenseResult()

    data class Failure(val code: String) : LicenseResult()
}

/**
 * Lightweight HTTPS client for Supabase Edge Functions only.
 * Does not touch map/GPS/survey paths.
 */
object LicenseApi {

    suspend fun activate(context: Context, code: String): LicenseResult =
        withContext(Dispatchers.IO) {
            post(
                context = context,
                path = "/functions/v1/license-activate",
                body = JSONObject()
                    .put("code", code.trim())
                    .put("device_id", LicensePreferences.deviceId(context))
                    .put("device_label", "${Build.MANUFACTURER} ${Build.MODEL}"),
                fallbackLicenseCode = code.trim()
            )
        }

    suspend fun validate(context: Context): LicenseResult =
        withContext(Dispatchers.IO) {
            post(
                context = context,
                path = "/functions/v1/license-validate",
                body = JSONObject()
                    .put("device_id", LicensePreferences.deviceId(context)),
                fallbackLicenseCode = LicensePreferences.read(context).licenseCode
            )
        }

    /**
     * Re-check with server if licensing is on and cache is stale.
     * Failures while previously allowed → keep grace; do not block map mid-session hard
     * unless evaluateAccess already says locked.
     */
    suspend fun refreshIfNeeded(context: Context): LicenseAccess {
        if (!LicenseConfig.enabled) return LicenseAccess.DevUnlocked
        val snap = LicensePreferences.read(context)
        val now = System.currentTimeMillis()
        val needsNetwork = snap.activated &&
            (now - snap.lastValidatedAtMs >= LicenseConfig.REVALIDATE_INTERVAL_MS ||
                now > snap.expiresAtEpochMs)

        if (needsNetwork) {
            when (val result = validate(context)) {
                is LicenseResult.Success -> { /* cache updated inside post */ }
                is LicenseResult.Failure -> {
                    LicensePreferences.saveError(context, result.code)
                }
            }
        }
        return LicensePreferences.evaluateAccess(context)
    }

    private fun post(
        context: Context,
        path: String,
        body: JSONObject,
        fallbackLicenseCode: String = ""
    ): LicenseResult {
        if (!LicenseConfig.enabled) {
            return LicenseResult.Failure("licensing_disabled")
        }
        val url = URL(LicenseConfig.supabaseUrl + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 12_000
            readTimeout = 12_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer ${LicenseConfig.anonKey}")
            setRequestProperty("apikey", LicenseConfig.anonKey)
        }
        try {
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            val json = try {
                JSONObject(text.ifBlank { "{}" })
            } catch (_: Exception) {
                JSONObject().put("ok", false).put("error", "bad_response")
            }
            if (json.optBoolean("ok", false) &&
                LicensePreferences.applyServerJson(context, json, fallbackLicenseCode)
            ) {
                val snap = LicensePreferences.read(context)
                return LicenseResult.Success(snap.customerName, snap.expiresAtEpochMs)
            }
            // Hosted gateway when Edge Function was never deployed:
            // {"code":"NOT_FOUND","message":"Requested function was not found"}
            val err = when {
                code == 404 || json.optString("code") == "NOT_FOUND" -> "functions_missing"
                else -> json.optString("error", "").ifBlank { "http_$code" }
            }
            LicensePreferences.saveError(context, err)
            return LicenseResult.Failure(err)
        } catch (_: Exception) {
            LicensePreferences.saveError(context, "network")
            return LicenseResult.Failure("network")
        } finally {
            conn.disconnect()
        }
    }
}
