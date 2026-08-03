package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.DtrMount
import com.blackgrapes.slmtoolbox.domain.model.KitArrangement
import com.blackgrapes.slmtoolbox.domain.model.KitExtension
import com.blackgrapes.slmtoolbox.domain.model.KitLocation
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import org.json.JSONArray
import org.json.JSONObject

/**
 * A named field shortcut published from the desktop workspace.
 *
 * Every preset carries the capture values the wizard pre-fills AND the canonical
 * match key of the assembly it was bound to, so the desktop can still resolve
 * the pole back to a real structure combination.
 */
data class FieldPreset(
    val id: String,
    val name: String,
    val notes: String,
    val assemblyId: String,
    val matchKey: String,
    val capture: FieldPresetCapture,
    val steps: List<FieldPresetStep>
)

data class FieldPresetCapture(
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val structure: PoleStructure?,
    val conductor: String,
    val kitLocation: KitLocation?,
    val kitArrangement: KitArrangement?,
    val kitExtension: KitExtension?,
    val kitWire: String?,
    val dtrMount: DtrMount?,
    val dtCapacityKva: String?
) {
    /** One-line summary for the presets list. */
    fun summary(): String = buildString {
        append(voltage.label)
        structure?.let { append(" · ").append(it.label) }
        kitLocation?.let { append(" · ").append(it.label) }
        kitArrangement?.let { append(" · ").append(it.label) }
        kitExtension?.let { append(" · ").append(it.label) }
        if (conductor.isNotBlank()) append(" · ").append(conductor)
        dtrMount?.let { append(" · DTR ").append(it.label) }
        if (!dtCapacityKva.isNullOrBlank()) append(" · ").append(dtCapacityKva).append("kVA")
    }
}

enum class FieldPresetStepType {
    CHOICE, NUMBER, TEXT;

    companion object {
        fun from(value: String?): FieldPresetStepType =
            entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: CHOICE
    }
}

data class FieldPresetStep(
    val key: String,
    val label: String,
    val type: FieldPresetStepType,
    val options: List<String>
)

data class FieldPresetPack(
    val version: Int,
    val exportedAt: String,
    val sourceJob: String,
    val presets: List<FieldPreset>
)

/** Thrown with a message safe to show the surveyor. */
class PresetPackException(message: String) : Exception(message)

object FieldPresetPackParser {

    const val FORMAT = "slm.preset.pack"
    const val SUPPORTED_VERSION = 1

    fun parse(json: String): FieldPresetPack {
        val root = try {
            JSONObject(json)
        } catch (e: Exception) {
            throw PresetPackException("Not a valid preset file")
        }

        if (root.optString("format") != FORMAT) {
            throw PresetPackException("This file is not a preset pack")
        }
        val version = root.optInt("version", 0)
        if (version > SUPPORTED_VERSION) {
            throw PresetPackException("Pack needs a newer app version")
        }

        val presets = mutableListOf<FieldPreset>()
        val array = root.optJSONArray("presets") ?: JSONArray()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            parsePreset(obj)?.let { presets.add(it) }
        }
        if (presets.isEmpty()) {
            throw PresetPackException("Pack has no usable presets")
        }

        return FieldPresetPack(
            version = version,
            exportedAt = root.optString("exportedAt"),
            sourceJob = root.optJSONObject("source")?.optString("job").orEmpty(),
            presets = presets
        )
    }

    private fun parsePreset(obj: JSONObject): FieldPreset? {
        val name = obj.optString("name").trim()
        val matchKey = obj.optString("matchKey").trim()
        if (name.isEmpty() || matchKey.isEmpty()) return null
        val captureObj = obj.optJSONObject("capture") ?: return null

        val voltage = VoltageLevel.fromLabel(captureObj.optString("voltage"))
        val structure = PoleStructure.fromLabel(captureObj.optStringOrNull("structure"))
        // A preset that cannot say what to place is useless in the field.
        if (structure == null) return null

        val capture = FieldPresetCapture(
            voltage = voltage,
            status = WorkStatus.fromLabel(captureObj.optString("status", WorkStatus.PROPOSED.label)),
            structure = structure,
            conductor = normaliseConductor(voltage, captureObj.optString("conductor")),
            kitLocation = KitLocation.fromLabel(captureObj.optStringOrNull("kitLocation")),
            kitArrangement = KitArrangement.fromLabel(captureObj.optStringOrNull("kitArrangement")),
            kitExtension = KitExtension.fromLabel(captureObj.optStringOrNull("kitExtension")),
            kitWire = captureObj.optStringOrNull("kitWire"),
            dtrMount = DtrMount.fromLabel(captureObj.optStringOrNull("dtrMount")),
            dtCapacityKva = captureObj.optStringOrNull("dtCapacityKva")
        )

        val steps = mutableListOf<FieldPresetStep>()
        val stepArray = obj.optJSONArray("steps") ?: JSONArray()
        for (i in 0 until stepArray.length()) {
            val s = stepArray.optJSONObject(i) ?: continue
            val label = s.optString("label").trim()
            if (label.isEmpty()) continue
            val options = mutableListOf<String>()
            val optArray = s.optJSONArray("options") ?: JSONArray()
            for (j in 0 until optArray.length()) {
                optArray.optString(j).trim().takeIf { it.isNotEmpty() }?.let { options.add(it) }
            }
            steps.add(
                FieldPresetStep(
                    key = s.optString("key").ifBlank { "step${i + 1}" },
                    label = label,
                    type = FieldPresetStepType.from(s.optString("type")),
                    options = options
                )
            )
        }

        return FieldPreset(
            id = obj.optString("id").ifBlank { "pre_${name.hashCode()}" },
            name = name,
            notes = obj.optString("notes"),
            assemblyId = obj.optString("assemblyId"),
            matchKey = matchKey,
            capture = capture,
            steps = steps
        )
    }

    /** Keep the conductor inside what this voltage actually offers on the phone. */
    private fun normaliseConductor(voltage: VoltageLevel, raw: String?): String {
        val allowed = NetworkCatalog.conductorsFor(voltage)
        val value = raw?.trim().orEmpty()
        return allowed.firstOrNull { it.equals(value, ignoreCase = true) } ?: value
    }

    fun toJson(pack: FieldPresetPack): String {
        val presets = JSONArray()
        pack.presets.forEach { p ->
            val steps = JSONArray()
            p.steps.forEach { s ->
                steps.put(
                    JSONObject()
                        .put("key", s.key)
                        .put("label", s.label)
                        .put("type", s.type.name.lowercase())
                        .put("options", JSONArray(s.options))
                )
            }
            presets.put(
                JSONObject()
                    .put("id", p.id)
                    .put("name", p.name)
                    .put("notes", p.notes)
                    .put("assemblyId", p.assemblyId)
                    .put("matchKey", p.matchKey)
                    .put(
                        "capture",
                        JSONObject()
                            .put("voltage", p.capture.voltage.label)
                            .put("status", p.capture.status.label)
                            .put("structure", p.capture.structure?.label.orEmpty())
                            .put("conductor", p.capture.conductor)
                            .put("kitLocation", p.capture.kitLocation?.label.orEmpty())
                            .put("kitArrangement", p.capture.kitArrangement?.id.orEmpty())
                            .put("kitExtension", p.capture.kitExtension?.id.orEmpty())
                            .put("kitWire", p.capture.kitWire.orEmpty())
                            .put("dtrMount", p.capture.dtrMount?.id.orEmpty())
                            .put("dtCapacityKva", p.capture.dtCapacityKva.orEmpty())
                    )
                    .put("steps", steps)
            )
        }
        return JSONObject()
            .put("format", FORMAT)
            .put("version", SUPPORTED_VERSION)
            .put("exportedAt", pack.exportedAt)
            .put("source", JSONObject().put("app", "slm-android").put("job", pack.sourceJob))
            .put("presets", presets)
            .toString(2)
    }
}

private fun JSONObject.optStringOrNull(key: String): String? =
    optString(key).trim().takeIf { it.isNotEmpty() }
