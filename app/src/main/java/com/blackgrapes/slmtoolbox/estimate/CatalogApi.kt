package com.blackgrapes.slmtoolbox.estimate

import android.content.Context
import android.util.Log
import com.blackgrapes.slmtoolbox.license.LicenseConfig
import com.blackgrapes.slmtoolbox.license.LicensePreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

sealed class CatalogSyncResult {
    data class Updated(val versionLabel: String) : CatalogSyncResult()
    data class Unchanged(val versionLabel: String) : CatalogSyncResult()
    data class Failure(val code: String) : CatalogSyncResult()
    data object Skipped : CatalogSyncResult()
}

/**
 * Fetches the current estimate catalog from Supabase Edge Function.
 * Gated by device activation (same rental license as the app).
 */
object CatalogApi {

    private const val TAG = "CatalogApi"
    /** Re-check catalog at most this often when online (version match short-circuits payload). */
    const val RESYNC_INTERVAL_MS = 6L * 60L * 60L * 1000L

    suspend fun syncIfNeeded(context: Context, force: Boolean = false): CatalogSyncResult =
        withContext(Dispatchers.IO) {
            if (!LicenseConfig.enabled) return@withContext CatalogSyncResult.Skipped
            val snap = LicensePreferences.read(context)
            if (!snap.activated) return@withContext CatalogSyncResult.Failure("not_activated")

            val now = System.currentTimeMillis()
            if (!force &&
                CatalogCache.hasCatalog(context) &&
                now - CatalogCache.syncedAtMs(context) < RESYNC_INTERVAL_MS
            ) {
                return@withContext CatalogSyncResult.Unchanged(CatalogCache.versionLabel(context))
            }

            fetchAndStore(context)
        }

    /** Best-effort after license activate/validate — never throws into UI. */
    suspend fun syncBestEffort(context: Context) {
        try {
            when (val r = syncIfNeeded(context, force = false)) {
                is CatalogSyncResult.Updated ->
                    Log.i(TAG, "catalog updated ${r.versionLabel}")
                is CatalogSyncResult.Unchanged ->
                    Log.d(TAG, "catalog unchanged ${r.versionLabel}")
                is CatalogSyncResult.Failure ->
                    Log.w(TAG, "catalog sync failed: ${r.code}")
                CatalogSyncResult.Skipped -> Unit
            }
        } catch (e: Exception) {
            Log.w(TAG, "catalog sync error", e)
        }
    }

    private fun fetchAndStore(context: Context): CatalogSyncResult {
        val url = URL(LicenseConfig.supabaseUrl + "/functions/v1/catalog-current")
        val body = JSONObject()
            .put("device_id", LicensePreferences.deviceId(context))
            .put("version_label", CatalogCache.versionLabel(context))

        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            // Catalog payload can be several MB.
            readTimeout = 90_000
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
                return CatalogSyncResult.Failure("bad_response")
            }

            if (!json.optBoolean("ok", false)) {
                val err = when {
                    code == 404 || json.optString("code") == "NOT_FOUND" -> "functions_missing"
                    else -> json.optString("error", "").ifBlank { "http_$code" }
                }
                return CatalogSyncResult.Failure(err)
            }

            val version = json.optString("version_label", "")
            if (json.optBoolean("unchanged", false)) {
                CatalogCache.touchUnchanged(context)
                return CatalogSyncResult.Unchanged(version)
            }

            val ratebook = json.optJSONObject("ratebook")
                ?: return CatalogSyncResult.Failure("missing_ratebook")
            val kitMatrix = json.optJSONObject("kit_matrix")
                ?: return CatalogSyncResult.Failure("missing_kit_matrix")
            val kitEdits = json.optJSONObject("kit_edits") ?: JSONObject()

            CatalogCache.save(
                context = context,
                versionLabel = version,
                publishedAt = json.optString("published_at", ""),
                notes = json.optString("notes", ""),
                ratebook = ratebook,
                kitMatrix = kitMatrix,
                kitEdits = kitEdits
            )
            return CatalogSyncResult.Updated(version)
        } catch (_: Exception) {
            return CatalogSyncResult.Failure("network")
        } finally {
            conn.disconnect()
        }
    }
}
