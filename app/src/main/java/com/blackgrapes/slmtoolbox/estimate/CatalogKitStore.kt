package com.blackgrapes.slmtoolbox.estimate

import org.json.JSONArray
import org.json.JSONObject

/** Merged kit row (matrix + publish edits), ready for matching. */
data class CatalogKit(
    val id: String,
    val family: String,
    val voltage: String,
    val structure: String?,
    val structureLabel: String?,
    val location: String?,
    val arrangement: String?,
    val arrangementLabel: String?,
    val extension: String?,
    val extensionLabel: String?,
    val conductorId: String?,
    val conductorShort: String?,
    val conductorName: String?,
    val conductorFamily: String?,
    val conductorSizeAgnostic: Boolean,
    val wireCount: String?,
    val wireLabel: String?,
    val isDtr: Boolean,
    val dtrMount: String?,
    val dtrCapacity: String?,
    val qtyBasis: String?,
    val enabled: Boolean,
    val complete: Boolean,
    val lineCount: Int = 0,
    val notes: String
) {
    fun displayTitle(): String {
        if (family == "conductor") {
            val wire = wireLabel?.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
            return "$voltage · ${conductorShort ?: conductorName ?: conductorId}$wire"
        }
        val loc = location?.let { " · $it" }.orEmpty()
        val arr = arrangementLabel?.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
        val cond = when {
            conductorSizeAgnostic ->
                " · ${conductorFamily ?: "ANY"}${wireLabel?.let { " · $it" }.orEmpty()}"
            !conductorShort.isNullOrBlank() -> " · $conductorShort"
            else -> ""
        }
        val ext = extensionLabel?.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
        val dtr = dtrCapacity?.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
        return "$voltage · ${structureLabel ?: structure}$loc$arr$cond$ext$dtr"
    }
}

object CatalogKitStore {

    fun loadMerged(matrix: JSONObject, edits: JSONObject?): List<CatalogKit> {
        val editRoot = edits ?: JSONObject()
        val out = ArrayList<CatalogKit>()
        appendFamily(matrix.optJSONArray("structureKits"), "structure", editRoot, out)
        appendFamily(matrix.optJSONArray("conductorKits"), "conductor", editRoot, out)
        appendFamily(matrix.optJSONArray("addonKits"), "addon", editRoot, out)
        return out
    }

    private fun appendFamily(
        arr: JSONArray?,
        defaultFamily: String,
        edits: JSONObject,
        out: MutableList<CatalogKit>
    ) {
        if (arr == null) return
        for (i in 0 until arr.length()) {
            val base = arr.optJSONObject(i) ?: continue
            val id = base.optString("id", "")
            if (id.isBlank()) continue
            val e = edits.optJSONObject(id) ?: JSONObject()
            val enabled =
                if (e.has("enabled")) e.optBoolean("enabled") else base.optBoolean("enabled", true)
            val complete =
                if (e.has("complete")) e.optBoolean("complete") else base.optBoolean("complete", false)
            val lines = when {
                e.opt("lines") is JSONArray -> e.getJSONArray("lines")
                base.opt("lines") is JSONArray -> base.getJSONArray("lines")
                else -> JSONArray()
            }
            val notes = if (e.has("notes")) e.optString("notes") else base.optString("notes", "")
            out.add(
                CatalogKit(
                    id = id,
                    family = base.optString("family", defaultFamily),
                    voltage = base.optString("voltage", ""),
                    structure = base.optBlankAsNull("structure"),
                    structureLabel = base.optBlankAsNull("structureLabel"),
                    location = base.optBlankAsNull("location"),
                    arrangement = base.optBlankAsNull("arrangement"),
                    arrangementLabel = base.optBlankAsNull("arrangementLabel"),
                    extension = base.optBlankAsNull("extension"),
                    extensionLabel = base.optBlankAsNull("extensionLabel"),
                    conductorId = base.optBlankAsNull("conductorId"),
                    conductorShort = base.optBlankAsNull("conductorShort"),
                    conductorName = base.optBlankAsNull("conductorName"),
                    conductorFamily = base.optBlankAsNull("conductorFamily"),
                    conductorSizeAgnostic = base.optBoolean("conductorSizeAgnostic", false),
                    wireCount = base.optBlankAsNull("wireCount"),
                    wireLabel = base.optBlankAsNull("wireLabel"),
                    isDtr = base.optBoolean("isDtr", false),
                    dtrMount = base.optBlankAsNull("dtrMount"),
                    dtrCapacity = base.optBlankAsNull("dtrCapacity"),
                    qtyBasis = base.optBlankAsNull("qtyBasis"),
                    enabled = enabled,
                    complete = complete,
                    lineCount = lines.length(),
                    notes = notes
                )
            )
        }
    }
}

private fun JSONObject.optBlankAsNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotBlank() }
}
