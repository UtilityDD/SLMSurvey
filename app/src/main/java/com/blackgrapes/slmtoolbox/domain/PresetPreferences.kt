package com.blackgrapes.slmtoolbox.domain

import android.content.Context
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

/** How new poles are placed when presets are enabled. */
enum class PresetPattern(val label: String) {
    /** Same voltage/structure for every pole in the series. */
    STANDARD("Standard"),
    /** First pole is DTR (11kV); all following poles are LT 1P. */
    DTR_LT("DTR→LT");

    companion object {
        fun fromLabel(label: String?): PresetPattern =
            entries.firstOrNull { it.label.equals(label, ignoreCase = true) }
                ?: entries.firstOrNull { it.name.equals(label, ignoreCase = true) }
                ?: STANDARD
    }
}

data class PresetData(
    val enabled: Boolean,
    val pattern: PresetPattern = PresetPattern.STANDARD,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val material: PoleMaterial,
    val structure: PoleStructure,
    val conductor: String,
    val feederName: String,
    val sourceSubstation: String,
    val displayUnit: String = "meter",
    val displayDecimals: Int = 1
) {
    /** Effective values for the first / START pole of a new series. */
    fun startPlacement(): Triple<VoltageLevel, PoleStructure, PoleMaterial> = when (pattern) {
        PresetPattern.DTR_LT -> Triple(
            VoltageLevel.KV_11,
            PoleStructure.DTR,
            material.takeIf { it in NetworkCatalog.materialsFor(VoltageLevel.KV_11) }
                ?: NetworkCatalog.defaultMaterial(VoltageLevel.KV_11)
        )
        PresetPattern.STANDARD -> Triple(voltage, structure, material)
    }

    /** Effective values for CONTINUE poles after a DTR start. */
    fun continueAfterDtr(): Triple<VoltageLevel, PoleStructure, PoleMaterial> =
        Triple(
            VoltageLevel.LT,
            PoleStructure.P1,
            PoleMaterial.PCC_8M
        )

    fun continueAfterDtrConductor(): String {
        val lt = NetworkCatalog.conductorsFor(VoltageLevel.LT)
        return conductor.takeIf { it in lt } ?: lt.first()
    }

    fun isDtrLt(): Boolean = pattern == PresetPattern.DTR_LT
}

object PresetPreferences {
    private const val PREFS_NAME = "slm_preset_prefs"
    private const val KEY_ENABLED = "preset_enabled"
    private const val KEY_PATTERN = "preset_pattern"
    private const val KEY_VOLTAGE = "preset_voltage"
    private const val KEY_STATUS = "preset_status"
    private const val KEY_MATERIAL = "preset_material"
    private const val KEY_STRUCTURE = "preset_structure"
    private const val KEY_CONDUCTOR = "preset_conductor"
    private const val KEY_FEEDER_NAME = "preset_feeder_name"
    private const val KEY_SOURCE_SS = "preset_source_ss"
    private const val KEY_DISPLAY_UNIT = "preset_display_unit"
    private const val KEY_DISPLAY_DECIMALS = "preset_display_decimals"

    fun isEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_ENABLED, false)
    }

    fun isDtrLt(context: Context): Boolean =
        isEnabled(context) && get(context).pattern == PresetPattern.DTR_LT

    fun get(context: Context): PresetData {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        val pattern = PresetPattern.fromLabel(prefs.getString(KEY_PATTERN, PresetPattern.STANDARD.name))

        val voltageLabel = prefs.getString(KEY_VOLTAGE, VoltageLevel.KV_11.label) ?: VoltageLevel.KV_11.label
        val voltage = VoltageLevel.fromLabel(voltageLabel)

        val statusLabel = prefs.getString(KEY_STATUS, WorkStatus.PROPOSED.label) ?: WorkStatus.PROPOSED.label
        val status = WorkStatus.fromLabel(statusLabel)

        val materialLabel = prefs.getString(KEY_MATERIAL, PoleMaterial.PCC_9M.label) ?: PoleMaterial.PCC_9M.label
        val material = PoleMaterial.fromLabel(materialLabel) ?: PoleMaterial.PCC_9M

        val structureLabel = prefs.getString(KEY_STRUCTURE, PoleStructure.P1.label) ?: PoleStructure.P1.label
        val structure = PoleStructure.fromLabel(structureLabel) ?: PoleStructure.P1

        val conductor = prefs.getString(KEY_CONDUCTOR, "50") ?: "50"
        val feederName = prefs.getString(KEY_FEEDER_NAME, "") ?: ""
        val sourceSubstation = prefs.getString(KEY_SOURCE_SS, "") ?: ""
        val displayUnit = prefs.getString(KEY_DISPLAY_UNIT, "meter") ?: "meter"
        val displayDecimals = prefs.getInt(KEY_DISPLAY_DECIMALS, 1)

        return PresetData(
            enabled = prefs.getBoolean(KEY_ENABLED, false),
            pattern = pattern,
            voltage = voltage,
            status = status,
            material = material,
            structure = structure,
            conductor = conductor,
            feederName = feederName,
            sourceSubstation = sourceSubstation,
            displayUnit = displayUnit,
            displayDecimals = displayDecimals
        )
    }

    fun save(context: Context, data: PresetData) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().apply {
            putBoolean(KEY_ENABLED, data.enabled)
            putString(KEY_PATTERN, data.pattern.name)
            putString(KEY_VOLTAGE, data.voltage.label)
            putString(KEY_STATUS, data.status.label)
            putString(KEY_MATERIAL, data.material.label)
            putString(KEY_STRUCTURE, data.structure.label)
            putString(KEY_CONDUCTOR, data.conductor)
            putString(KEY_FEEDER_NAME, data.feederName)
            putString(KEY_SOURCE_SS, data.sourceSubstation)
            putString(KEY_DISPLAY_UNIT, data.displayUnit)
            putInt(KEY_DISPLAY_DECIMALS, data.displayDecimals)
            apply()
        }
    }
}
