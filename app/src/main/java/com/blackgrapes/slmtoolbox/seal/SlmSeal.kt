package com.blackgrapes.slmtoolbox.seal

import android.content.Context
import android.util.Base64
import com.blackgrapes.slmtoolbox.license.LicensePreferences
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * App-specific sealed packages (.slmmap / .slmpreset).
 * Same AES-256-GCM secret as desktop `seal.js` — not organization-specific.
 * Surveyor license stamp is embedded inside the ciphertext.
 */
object SlmSeal {

    const val KIND_MAP = "map"
    const val KIND_PRESET = "preset"
    const val EXT_MAP = ".slmmap"
    const val EXT_PRESET = ".slmpreset"

    private const val FORMAT_LINE = "#SLM/SEAL/1"
    private const val APP_SECRET =
        "SLM-ToolBox-Seal-v1|BlackGrapes|field-survey-transfer|do-not-edit-files"
    private const val GCM_TAG_BITS = 128

    data class Opened(
        val kind: String,
        val license: JSONObject?,
        val payload: JSONObject,
        val sealed: Boolean
    )

    fun isAdmin(context: Context): Boolean = LicensePreferences.read(context).canApprove

    fun looksSealed(text: String): Boolean = text.trimStart().startsWith("#SLM/SEAL/")

    fun licenseStamp(context: Context): JSONObject {
        val snap = LicensePreferences.read(context)
        return JSONObject()
            .put("customerName", snap.customerName)
            .put("licenseCode", snap.licenseCode)
            .put("deviceId", LicensePreferences.deviceId(context))
            .put("platform", "android")
            .put("canApprove", snap.canApprove)
            .put("exportedAt", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                timeZone = java.util.TimeZone.getTimeZone("UTC")
            }.format(java.util.Date()))
    }

    fun seal(context: Context, kind: String, payload: JSONObject): String {
        require(kind == KIND_MAP || kind == KIND_PRESET) { "Unknown seal kind" }
        val inner = JSONObject()
            .put("kind", kind)
            .put("license", licenseStamp(context))
            .put("payload", payload)
        val key = secretKey()
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        val ct = cipher.doFinal(inner.toString().toByteArray(Charsets.UTF_8))
        return buildString {
            append(FORMAT_LINE).append('\n')
            append("kind:").append(kind).append('\n')
            append("iv:").append(Base64.encodeToString(iv, Base64.NO_WRAP)).append('\n')
            append("data:").append(Base64.encodeToString(ct, Base64.NO_WRAP)).append('\n')
        }
    }

    fun unseal(text: String, expectedKind: String? = null): Opened {
        val env = parseEnvelope(text)
        if (expectedKind != null && env.kind != expectedKind) {
            throw IllegalArgumentException(
                "Wrong file type (got ${if (env.kind == KIND_PRESET) EXT_PRESET else EXT_MAP})"
            )
        }
        val key = secretKey()
        val iv = Base64.decode(env.iv, Base64.DEFAULT)
        val ct = Base64.decode(env.data, Base64.DEFAULT)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        try {
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            val plain = cipher.doFinal(ct)
            val inner = JSONObject(String(plain, Charsets.UTF_8))
            val payload = inner.optJSONObject("payload")
                ?: throw IllegalArgumentException("Sealed payload missing")
            return Opened(
                kind = inner.optString("kind", env.kind),
                license = inner.optJSONObject("license"),
                payload = payload,
                sealed = true
            )
        } catch (e: IllegalArgumentException) {
            throw e
        } catch (e: Exception) {
            throw IllegalArgumentException("File is corrupt or was tampered with", e)
        }
    }

    /**
     * Sealed files always open. Plain JSON only when [isAdmin].
     */
    fun openTransferText(context: Context, text: String, expectedKind: String): Opened {
        val raw = text.trim()
        if (looksSealed(raw)) return unseal(raw, expectedKind)
        if (!isAdmin(context)) {
            val ext = if (expectedKind == KIND_PRESET) EXT_PRESET else EXT_MAP
            throw IllegalArgumentException("Plain JSON is admin-only. Use a sealed $ext file.")
        }
        return Opened(
            kind = expectedKind,
            license = null,
            payload = JSONObject(raw),
            sealed = false
        )
    }

    private data class Envelope(val kind: String, val iv: String, val data: String)

    private fun parseEnvelope(text: String): Envelope {
        val lines = text.replace("\uFEFF", "").lines()
        if (lines.isEmpty() || lines[0].trim() != FORMAT_LINE) {
            throw IllegalArgumentException("Not an SLM sealed file")
        }
        var kind = ""
        var iv = ""
        var data = ""
        for (i in 1 until lines.size) {
            val line = lines[i]
            if (line.isBlank() || line.startsWith("#")) continue
            val colon = line.indexOf(':')
            if (colon < 0) continue
            val key = line.substring(0, colon).trim()
            val val_ = line.substring(colon + 1).trim()
            when (key) {
                "kind" -> kind = val_
                "iv" -> iv = val_
                "data" -> data = val_
            }
        }
        if (kind.isEmpty() || iv.isEmpty() || data.isEmpty()) {
            throw IllegalArgumentException("Sealed file is incomplete")
        }
        return Envelope(kind, iv, data)
    }

    private fun secretKey(): SecretKeySpec {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(APP_SECRET.toByteArray(Charsets.UTF_8))
        return SecretKeySpec(digest, "AES")
    }
}
