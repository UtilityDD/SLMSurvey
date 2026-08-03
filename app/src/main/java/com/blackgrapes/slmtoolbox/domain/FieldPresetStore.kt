package com.blackgrapes.slmtoolbox.domain

import android.content.Context

/**
 * Imported desktop preset packs. Stored as the raw pack JSON so a re-import is a
 * plain overwrite and nothing needs a database migration.
 *
 * Parsed pack is cached in memory — wizard steps must not re-parse SharedPreferences
 * JSON on every access (GC/jank on weak field devices).
 */
object FieldPresetStore {

    private const val PREFS_NAME = "slm_field_presets"
    private const val KEY_PACK_JSON = "pack_json"
    private const val KEY_IMPORTED_AT = "imported_at"
    private const val KEY_SOURCE_NAME = "source_name"
    private const val KEY_ACTIVE_ID = "active_preset_id"

    @Volatile
    private var cachedPack: FieldPresetPack? = null

    @Volatile
    private var cacheLoaded = false

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun ensureCache(context: Context) {
        if (cacheLoaded) return
        synchronized(this) {
            if (cacheLoaded) return
            val json = prefs(context).getString(KEY_PACK_JSON, null)
            cachedPack = if (json.isNullOrBlank()) {
                null
            } else {
                try {
                    FieldPresetPackParser.parse(json)
                } catch (_: Exception) {
                    null
                }
            }
            cacheLoaded = true
        }
    }

    private fun invalidateCache() {
        synchronized(this) {
            cachedPack = null
            cacheLoaded = false
        }
    }

    /** @return the parsed pack, or null when nothing valid is stored. */
    fun getPack(context: Context): FieldPresetPack? {
        ensureCache(context)
        return cachedPack
    }

    fun list(context: Context): List<FieldPreset> = getPack(context)?.presets ?: emptyList()

    fun count(context: Context): Int = list(context).size

    fun find(context: Context, id: String?): FieldPreset? {
        if (id.isNullOrBlank()) return null
        return list(context).firstOrNull { it.id == id }
    }

    fun importedAt(context: Context): Long = prefs(context).getLong(KEY_IMPORTED_AT, 0L)

    fun sourceName(context: Context): String =
        prefs(context).getString(KEY_SOURCE_NAME, "").orEmpty()

    /**
     * Validate then store. Throws [PresetPackException] with a surveyor-safe message.
     * @return the accepted pack
     */
    fun importFromJson(context: Context, json: String, fileName: String?): FieldPresetPack {
        val pack = FieldPresetPackParser.parse(json)
        prefs(context).edit()
            .putString(KEY_PACK_JSON, json)
            .putLong(KEY_IMPORTED_AT, System.currentTimeMillis())
            .putString(
                KEY_SOURCE_NAME,
                pack.sourceJob.ifBlank { fileName.orEmpty() }
            )
            .remove(KEY_ACTIVE_ID)
            .apply()
        synchronized(this) {
            cachedPack = pack
            cacheLoaded = true
        }
        return pack
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
        invalidateCache()
    }

    /** Preset the wizard should pre-fill from, if the surveyor picked one. */
    fun getActive(context: Context): FieldPreset? =
        find(context, prefs(context).getString(KEY_ACTIVE_ID, null))

    fun setActive(context: Context, id: String?) {
        val editor = prefs(context).edit()
        if (id.isNullOrBlank()) editor.remove(KEY_ACTIVE_ID) else editor.putString(KEY_ACTIVE_ID, id)
        editor.apply()
    }
}
