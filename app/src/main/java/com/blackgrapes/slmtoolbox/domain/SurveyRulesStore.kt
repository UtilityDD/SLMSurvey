package com.blackgrapes.slmtoolbox.domain

import android.content.Context
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import org.json.JSONObject
import java.io.File

/**
 * Shared survey combination rules (from PC publish / bundled asset).
 * Drives phone wizard options; kits/estimate stay on desktop.
 */
object SurveyRulesStore {

    @Volatile
    private var root: JSONObject? = null

    @Volatile
    private var versionLabel: String = ""

    fun versionLabel(): String = versionLabel

    fun hasRules(): Boolean = root != null

    fun ensureLoaded(context: Context) {
        if (root != null) return
        // Prefer last downloaded rules, else APK asset.
        val cached = File(context.filesDir, "survey_rules/survey-rules.json")
        if (cached.isFile) {
            try {
                apply(JSONObject(cached.readText()), prefsVersion(context))
                return
            } catch (_: Exception) {
                /* fall through */
            }
        }
        try {
            context.assets.open("survey-rules.json").bufferedReader().use { reader ->
                apply(JSONObject(reader.readText()), "bundled")
            }
        } catch (_: Exception) {
            root = null
        }
    }

    fun saveDownloaded(context: Context, rules: JSONObject, version: String) {
        val dir = File(context.filesDir, "survey_rules").also { it.mkdirs() }
        File(dir, "survey-rules.json").writeText(rules.toString())
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_VERSION, version)
            .putLong(KEY_SYNCED, System.currentTimeMillis())
            .apply()
        apply(rules, version)
    }

    fun syncedAtMs(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_SYNCED, 0L)

    private fun prefsVersion(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_VERSION, "")
            .orEmpty()

    private fun apply(json: JSONObject, version: String) {
        root = json
        versionLabel = version.ifBlank {
            json.optString("label", json.optString("version", ""))
        }
    }

    private fun voltageKey(v: VoltageLevel): String = when (v) {
        VoltageLevel.KV_33 -> "33kV"
        VoltageLevel.KV_11 -> "11kV"
        VoltageLevel.LT -> "LT"
    }

    private fun byVoltage(v: VoltageLevel): JSONObject? {
        val r = root ?: return null
        return r.optJSONObject("byVoltage")?.optJSONObject(voltageKey(v))
    }

    /** Phone-visible materials only (skips desktop-only steel lengths). */
    fun materialsForPhone(voltage: VoltageLevel): List<PoleMaterial>? {
        val block = byVoltage(voltage) ?: return null
        val arr = block.optJSONArray("materials") ?: return null
        val out = mutableListOf<PoleMaterial>()
        for (i in 0 until arr.length()) {
            val item = arr.opt(i)
            val id: String
            val phone: Boolean
            when (item) {
                is JSONObject -> {
                    id = item.optString("id", item.optString("label"))
                    phone = item.optBoolean("phone", true)
                }
                else -> {
                    id = item?.toString().orEmpty()
                    phone = true
                }
            }
            if (!phone || id.isBlank()) continue
            PoleMaterial.fromLabel(id)?.let { out.add(it) }
        }
        return out.takeIf { it.isNotEmpty() }
    }

    fun structuresFor(voltage: VoltageLevel): List<PoleStructure>? {
        val block = byVoltage(voltage) ?: return null
        // Phone survey: prefer structuresPhone (excludes kit-only extras like LT DTR).
        val arr = block.optJSONArray("structuresPhone")
            ?: block.optJSONArray("structures")
            ?: return null
        val out = mutableListOf<PoleStructure>()
        for (i in 0 until arr.length()) {
            PoleStructure.fromLabel(arr.optString(i))?.let { out.add(it) }
        }
        return out.takeIf { it.isNotEmpty() }
    }

    fun conductorsFor(voltage: VoltageLevel): List<String>? {
        val block = byVoltage(voltage) ?: return null
        val arr = block.optJSONArray("conductors") ?: return null
        val out = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            val s = arr.optString(i)
            if (s.isNotBlank()) out.add(s)
        }
        return out.takeIf { it.isNotEmpty() }
    }

    fun deadEndStructures(voltage: VoltageLevel): List<PoleStructure>? {
        val block = byVoltage(voltage) ?: return null
        val arr = block.optJSONArray("deadEndStructures") ?: return null
        val out = mutableListOf<PoleStructure>()
        for (i in 0 until arr.length()) {
            PoleStructure.fromLabel(arr.optString(i))?.let { out.add(it) }
        }
        return out.takeIf { it.isNotEmpty() }
    }

    fun extensionAllowed(voltage: VoltageLevel, material: PoleMaterial?): Boolean? {
        val r = root ?: return null
        val map = r.optJSONObject("rules")?.optJSONObject("extensionAllowedMaterials") ?: return null
        val arr = map.optJSONArray(voltageKey(voltage)) ?: return false
        if (material == null) return arr.length() > 0
        val label = material.label
        for (i in 0 until arr.length()) {
            if (arr.optString(i).equals(label, ignoreCase = true)) return true
        }
        return false
    }

    private const val PREFS = "slm_survey_rules"
    private const val KEY_VERSION = "version_label"
    private const val KEY_SYNCED = "synced_at_ms"
}
