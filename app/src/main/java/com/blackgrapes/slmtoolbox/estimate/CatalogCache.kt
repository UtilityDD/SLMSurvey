package com.blackgrapes.slmtoolbox.estimate

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Local-only cache of the published estimate catalog (rate book + kits).
 * Written by [CatalogApi]; survey/map never call Supabase for this data.
 */
object CatalogCache {

    private const val PREFS = "slm_estimate_catalog"
    private const val KEY_VERSION = "version_label"
    private const val KEY_PUBLISHED = "published_at"
    private const val KEY_SYNCED = "synced_at_ms"
    private const val KEY_NOTES = "notes"

    private fun dir(context: Context): File =
        File(context.filesDir, "estimate_catalog").also { it.mkdirs() }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun versionLabel(context: Context): String =
        prefs(context).getString(KEY_VERSION, "").orEmpty()

    fun publishedAt(context: Context): String =
        prefs(context).getString(KEY_PUBLISHED, "").orEmpty()

    fun syncedAtMs(context: Context): Long =
        prefs(context).getLong(KEY_SYNCED, 0L)

    fun hasCatalog(context: Context): Boolean {
        val d = dir(context)
        return File(d, "ratebook.json").isFile && File(d, "kit_matrix.json").isFile
    }

    fun ratebookFile(context: Context): File = File(dir(context), "ratebook.json")
    fun kitMatrixFile(context: Context): File = File(dir(context), "kit_matrix.json")
    fun kitEditsFile(context: Context): File = File(dir(context), "kit_edits.json")

    fun readRatebookJson(context: Context): JSONObject? = readJson(ratebookFile(context))
    fun readKitMatrixJson(context: Context): JSONObject? = readJson(kitMatrixFile(context))
    fun readKitEditsJson(context: Context): JSONObject? = readJson(kitEditsFile(context))

    fun save(
        context: Context,
        versionLabel: String,
        publishedAt: String,
        notes: String,
        ratebook: JSONObject,
        kitMatrix: JSONObject,
        kitEdits: JSONObject
    ) {
        ratebookFile(context).writeText(ratebook.toString())
        kitMatrixFile(context).writeText(kitMatrix.toString())
        kitEditsFile(context).writeText(kitEdits.toString())
        prefs(context).edit()
            .putString(KEY_VERSION, versionLabel)
            .putString(KEY_PUBLISHED, publishedAt)
            .putString(KEY_NOTES, notes)
            .putLong(KEY_SYNCED, System.currentTimeMillis())
            .apply()
    }

    fun touchUnchanged(context: Context) {
        prefs(context).edit()
            .putLong(KEY_SYNCED, System.currentTimeMillis())
            .apply()
    }

    private fun readJson(file: File): JSONObject? {
        if (!file.isFile) return null
        return try {
            JSONObject(file.readText())
        } catch (_: Exception) {
            null
        }
    }
}
