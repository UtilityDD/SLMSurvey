package com.blackgrapes.slmtoolbox.license

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class AdminLicenseRow(
    val id: String,
    val code: String,
    val customerName: String,
    val customerPhone: String,
    val status: String,
    val expiresAtIso: String,
    val maxDevices: Int,
    val activationCount: Int,
    val canSuggest: Boolean,
    val canApprove: Boolean,
    val notes: String
)

sealed class LicenseAdminResult<out T> {
    data class Ok<T>(val value: T) : LicenseAdminResult<T>()
    data class Err(val code: String, val detail: String = "") : LicenseAdminResult<Nothing>()
}

/**
 * Thin client for [license-admin] Edge Function.
 * Server re-checks can_approve; never trusts the local flag alone.
 */
object LicenseAdminApi {

    suspend fun list(context: Context): LicenseAdminResult<List<AdminLicenseRow>> =
        withContext(Dispatchers.IO) {
            when (val raw = post(context, JSONObject().put("action", "list"))) {
                is LicenseAdminResult.Err -> raw
                is LicenseAdminResult.Ok -> {
                    val arr = raw.value.optJSONArray("licenses") ?: JSONArray()
                    val rows = buildList {
                        for (i in 0 until arr.length()) {
                            val o = arr.optJSONObject(i) ?: continue
                            add(parseRow(o))
                        }
                    }
                    LicenseAdminResult.Ok(rows)
                }
            }
        }

    suspend fun create(
        context: Context,
        code: String,
        customerName: String,
        customerPhone: String,
        days: Int,
        maxDevices: Int,
        canSuggest: Boolean,
        canApprove: Boolean,
        notes: String
    ): LicenseAdminResult<AdminLicenseRow> =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("action", "create")
                .put("code", code.trim())
                .put("customer_name", customerName.trim())
                .put("customer_phone", customerPhone.trim())
                .put("days", days.coerceIn(1, 730))
                .put("max_devices", maxDevices.coerceIn(1, 5))
                .put("can_suggest", canSuggest)
                .put("can_approve", canApprove)
                .put("notes", notes.trim())
            when (val raw = post(context, body)) {
                is LicenseAdminResult.Err -> raw
                is LicenseAdminResult.Ok -> {
                    val lic = raw.value.optJSONObject("license")
                        ?: return@withContext LicenseAdminResult.Err("bad_response")
                    LicenseAdminResult.Ok(parseRow(lic))
                }
            }
        }

    suspend fun update(
        context: Context,
        id: String,
        customerName: String? = null,
        customerPhone: String? = null,
        notes: String? = null,
        maxDevices: Int? = null,
        canSuggest: Boolean? = null,
        canApprove: Boolean? = null,
        status: String? = null,
        extendDays: Int? = null,
        setDays: Int? = null
    ): LicenseAdminResult<AdminLicenseRow> =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("action", "update")
                .put("id", id)
            if (customerName != null) body.put("customer_name", customerName)
            if (customerPhone != null) body.put("customer_phone", customerPhone)
            if (notes != null) body.put("notes", notes)
            if (maxDevices != null) body.put("max_devices", maxDevices.coerceIn(1, 5))
            if (canSuggest != null) body.put("can_suggest", canSuggest)
            if (canApprove != null) body.put("can_approve", canApprove)
            if (status != null) body.put("status", status)
            if (extendDays != null && extendDays > 0) body.put("extend_days", extendDays)
            if (setDays != null && setDays > 0) body.put("set_days", setDays)
            when (val raw = post(context, body)) {
                is LicenseAdminResult.Err -> raw
                is LicenseAdminResult.Ok -> {
                    val lic = raw.value.optJSONObject("license")
                        ?: return@withContext LicenseAdminResult.Err("bad_response")
                    LicenseAdminResult.Ok(parseRow(lic))
                }
            }
        }

    private fun parseRow(o: JSONObject): AdminLicenseRow = AdminLicenseRow(
        id = o.optString("id", ""),
        code = o.optString("code", ""),
        customerName = o.optString("customer_name", ""),
        customerPhone = o.optString("customer_phone", ""),
        status = o.optString("status", ""),
        expiresAtIso = o.optString("expires_at", ""),
        maxDevices = o.optInt("max_devices", 1),
        activationCount = o.optInt("activation_count", 0),
        canSuggest = o.optBoolean("can_suggest", false),
        canApprove = o.optBoolean("can_approve", false),
        notes = o.optString("notes", "")
    )

    private fun post(context: Context, body: JSONObject): LicenseAdminResult<JSONObject> {
        if (!LicenseConfig.enabled) {
            return LicenseAdminResult.Err("licensing_disabled")
        }
        body.put("device_id", LicensePreferences.deviceId(context))
        val url = URL(LicenseConfig.supabaseUrl + "/functions/v1/license-admin")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 30_000
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
            if (json.optBoolean("ok", false)) {
                return LicenseAdminResult.Ok(json)
            }
            val err = when {
                code == 404 || json.optString("code") == "NOT_FOUND" -> "functions_missing"
                else -> json.optString("error", "").ifBlank { "http_$code" }
            }
            return LicenseAdminResult.Err(err, json.optString("detail", ""))
        } catch (_: Exception) {
            return LicenseAdminResult.Err("network")
        } finally {
            conn.disconnect()
        }
    }
}
