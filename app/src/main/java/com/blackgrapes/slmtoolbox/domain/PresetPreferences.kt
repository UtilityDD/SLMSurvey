package com.blackgrapes.slmtoolbox.domain

import android.content.Context
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

/** How new poles are placed when a named preset is active. */
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

/**
 * Effective placement values derived from the selected curated preset
 * (or empty / usual-defaults when presets are off).
 */
data class PresetData(
    val enabled: Boolean,
    val selectedId: String? = null,
    val pattern: PresetPattern = PresetPattern.STANDARD,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val material: PoleMaterial,
    val structure: PoleStructure,
    val conductor: String,
    val feederName: String = "",
    val sourceSubstation: String = "",
    val displayUnit: String = "meter",
    val displayDecimals: Int = 1,
    val def: SurveyPresetDef? = null
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
        return conductor.takeIf { it in lt } ?: "ABC".takeIf { it in lt } ?: lt.first()
    }

    fun isDtrLt(): Boolean = pattern == PresetPattern.DTR_LT
}

object PresetPreferences {
    /**
     * Named survey presets (Pre/Post short combinations) — **disabled for now**.
     * Code + `SurveyPresetCatalog` stay in tree; re-enable later by flipping this flag
     * and showing `btnPresetSettings` again. See `app/README.md`.
     */
    const val FEATURE_ENABLED = false

    private const val PREFS_NAME = "slm_preset_prefs"
    private const val KEY_ENABLED = "preset_enabled"
    private const val KEY_SELECTED_ID = "preset_selected_id"
    private const val KEY_CATEGORY = "preset_category"
    private const val KEY_FEEDER_NAME = "preset_feeder_name"
    private const val KEY_SOURCE_SS = "preset_source_ss"
    private const val KEY_DISPLAY_UNIT = "preset_display_unit"
    private const val KEY_DISPLAY_DECIMALS = "preset_display_decimals"

    // Legacy keys — read once for migration
    private const val KEY_PATTERN = "preset_pattern"
    private const val KEY_VOLTAGE = "preset_voltage"
    private const val KEY_STATUS = "preset_status"
    private const val KEY_MATERIAL = "preset_material"
    private const val KEY_STRUCTURE = "preset_structure"
    private const val KEY_CONDUCTOR = "preset_conductor"

    fun isEnabled(context: Context): Boolean {
        if (!FEATURE_ENABLED) return false
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_ENABLED, false) && selectedDef(context) != null
    }

    fun isDtrLt(context: Context): Boolean =
        FEATURE_ENABLED && isEnabled(context) && get(context).pattern == PresetPattern.DTR_LT

    fun selectedDef(context: Context): SurveyPresetDef? {
        if (!FEATURE_ENABLED) return null
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_ENABLED, false)) return null
        val id = prefs.getString(KEY_SELECTED_ID, null)
        SurveyPresetCatalog.byId(id)?.let { return it }
        return migrateLegacySelection(context)
    }

    fun getCategory(context: Context): SurveyPresetCategory {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return when (prefs.getString(KEY_CATEGORY, SurveyPresetCategory.PRE_EXECUTION.name)) {
            SurveyPresetCategory.POST_EXECUTION.name -> SurveyPresetCategory.POST_EXECUTION
            else -> SurveyPresetCategory.PRE_EXECUTION
        }
    }

    fun get(context: Context): PresetData {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val def = selectedDef(context)
        val displayUnit = prefs.getString(KEY_DISPLAY_UNIT, "meter") ?: "meter"
        val displayDecimals = prefs.getInt(KEY_DISPLAY_DECIMALS, 1)
        val feederName = prefs.getString(KEY_FEEDER_NAME, "") ?: ""
        val sourceSubstation = prefs.getString(KEY_SOURCE_SS, "") ?: ""

        if (def != null) {
            return PresetData(
                enabled = true,
                selectedId = def.id,
                pattern = def.pattern,
                voltage = def.voltage,
                status = def.status,
                material = def.material,
                structure = def.structure,
                conductor = def.conductor,
                feederName = feederName,
                sourceSubstation = sourceSubstation,
                displayUnit = displayUnit,
                displayDecimals = displayDecimals,
                def = def
            )
        }

        // Usual defaults (presets off) — wizard uses its normal chip flow.
        return PresetData(
            enabled = false,
            selectedId = null,
            pattern = PresetPattern.STANDARD,
            voltage = VoltageLevel.KV_11,
            status = WorkStatus.PROPOSED,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P1,
            conductor = "50",
            feederName = feederName,
            sourceSubstation = sourceSubstation,
            displayUnit = displayUnit,
            displayDecimals = displayDecimals,
            def = null
        )
    }

    /**
     * @param enabled when false, survey uses usual defaults (no named preset).
     * @param selectedId curated preset id; required when [enabled] is true.
     */
    fun save(
        context: Context,
        enabled: Boolean,
        selectedId: String?,
        category: SurveyPresetCategory,
        feederName: String = "",
        sourceSubstation: String = "",
        displayUnit: String = "meter",
        displayDecimals: Int = 1
    ) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val id = selectedId?.takeIf { enabled && SurveyPresetCatalog.byId(it) != null }
        prefs.edit().apply {
            putBoolean(KEY_ENABLED, enabled && id != null)
            putString(KEY_SELECTED_ID, id)
            putString(KEY_CATEGORY, category.name)
            putString(KEY_FEEDER_NAME, feederName)
            putString(KEY_SOURCE_SS, sourceSubstation)
            putString(KEY_DISPLAY_UNIT, displayUnit)
            putInt(KEY_DISPLAY_DECIMALS, displayDecimals)
            apply()
        }

        // Keep post-exec LT-conversion flag in sync when that named preset is chosen.
        val def = SurveyPresetCatalog.byId(id)
        if (category == SurveyPresetCategory.POST_EXECUTION) {
            val opt = def?.postExecOptionId.orEmpty()
            PostExecPreferences.saveSelected(
                context,
                PostExecGroup.DTR_LT,
                if (opt == PostExecPreferences.OPTION_LT_CONVERSION_ABC) opt
                else PostExecPreferences.OPTION_NONE
            )
        }
    }

    /** Backward-compatible save used by older call sites. */
    fun save(context: Context, data: PresetData) {
        save(
            context = context,
            enabled = data.enabled,
            selectedId = data.selectedId ?: data.def?.id,
            category = data.def?.category ?: getCategory(context),
            feederName = data.feederName,
            sourceSubstation = data.sourceSubstation,
            displayUnit = data.displayUnit,
            displayDecimals = data.displayDecimals
        )
    }

    private fun migrateLegacySelection(context: Context): SurveyPresetDef? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_ENABLED, false)) return null
        if (!prefs.contains(KEY_VOLTAGE) && !prefs.contains(KEY_PATTERN)) return null

        val pattern = PresetPattern.fromLabel(prefs.getString(KEY_PATTERN, PresetPattern.STANDARD.name))
        if (pattern == PresetPattern.DTR_LT) {
            val dtr = SurveyPresetCatalog.byId("pre_dtr_lt")
            if (dtr != null) {
                prefs.edit().putString(KEY_SELECTED_ID, dtr.id).apply()
                return dtr
            }
        }

        val voltage = VoltageLevel.fromLabel(
            prefs.getString(KEY_VOLTAGE, VoltageLevel.LT.label) ?: VoltageLevel.LT.label
        )
        val structure = PoleStructure.fromLabel(
            prefs.getString(KEY_STRUCTURE, PoleStructure.P1.label)
        ) ?: PoleStructure.P1
        val conductor = prefs.getString(KEY_CONDUCTOR, "ABC") ?: "ABC"

        val match = SurveyPresetCatalog.preExecution.firstOrNull {
            it.voltage == voltage &&
                it.structure == structure &&
                it.conductor.equals(conductor, ignoreCase = true) &&
                it.pattern == PresetPattern.STANDARD
        } ?: SurveyPresetCatalog.preExecution.firstOrNull {
            it.voltage == VoltageLevel.LT && it.structure == PoleStructure.P1 && it.conductor == "ABC"
        }

        if (match != null) {
            prefs.edit().putString(KEY_SELECTED_ID, match.id).apply()
        }
        return match
    }
}
