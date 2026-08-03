package com.blackgrapes.slmtoolbox.domain

import android.content.Context
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import androidx.core.content.ContextCompat
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.domain.model.KitArrangement
import com.blackgrapes.slmtoolbox.domain.model.KitExtension
import com.blackgrapes.slmtoolbox.domain.model.KitLocation
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

/** Pre-execution vs post-execution survey mode. */
enum class SurveyPresetCategory {
    PRE_EXECUTION,
    POST_EXECUTION
}

/** Segments of a preset short name — each gets its own colour in the UI. */
enum class PresetPartKind {
    VOLTAGE,
    STRUCTURE,
    CONDUCTOR,
    LOCATION,
    ARRANGEMENT,
    MATERIAL,
    OTHER
}

data class PresetNamePart(
    val text: String,
    val kind: PresetPartKind
)

/**
 * Curated field shortcut: a few common combinations with a short colour-coded name.
 * Not a free-form form — surveyor picks one or surveys with usual defaults.
 */
data class SurveyPresetDef(
    val id: String,
    val category: SurveyPresetCategory,
    val parts: List<PresetNamePart>,
    val voltage: VoltageLevel,
    val status: WorkStatus = WorkStatus.PROPOSED,
    val material: PoleMaterial,
    val structure: PoleStructure,
    val conductor: String,
    val kitLocation: KitLocation = KitLocation.TANGENT,
    val kitArrangement: KitArrangement? = KitArrangement.INLINE,
    val kitExtension: KitExtension = KitExtension.NO_EXT,
    /** Special flow: first pole DTR @ 11kV, continue poles LT. */
    val pattern: PresetPattern = PresetPattern.STANDARD,
    val implemented: Boolean = true,
    /** Links post-exec option ids (e.g. LT conversion ABC). */
    val postExecOptionId: String? = null
) {
    fun plainName(): String = parts.joinToString(" ") { it.text }

    fun arrangementShort(): String = when (kitArrangement) {
        KitArrangement.INLINE -> "In-line"
        KitArrangement.SECTIONAL -> "Section"
        null -> ""
    }
}

object SurveyPresetCatalog {

    private fun parts(
        voltage: String,
        structure: String,
        conductor: String,
        location: String,
        arrangement: String,
        material: String? = null
    ): List<PresetNamePart> = buildList {
        add(PresetNamePart(voltage, PresetPartKind.VOLTAGE))
        add(PresetNamePart(structure, PresetPartKind.STRUCTURE))
        add(PresetNamePart(conductor, PresetPartKind.CONDUCTOR))
        material?.let { add(PresetNamePart(it, PresetPartKind.MATERIAL)) }
        add(PresetNamePart(location, PresetPartKind.LOCATION))
        add(PresetNamePart(arrangement, PresetPartKind.ARRANGEMENT))
    }

    val preExecution: List<SurveyPresetDef> = listOf(
        SurveyPresetDef(
            id = "pre_lt_1p_abc_tan_inline",
            category = SurveyPresetCategory.PRE_EXECUTION,
            parts = parts("LT", "1P", "ABC", "Tangent", "In-line"),
            voltage = VoltageLevel.LT,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P1,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.INLINE
        ),
        SurveyPresetDef(
            id = "pre_lt_1p_abc_tan_section",
            category = SurveyPresetCategory.PRE_EXECUTION,
            parts = parts("LT", "1P", "ABC", "Tangent", "Section"),
            voltage = VoltageLevel.LT,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P1,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.SECTIONAL
        ),
        SurveyPresetDef(
            id = "pre_lt_3p_abc_tan_inline",
            category = SurveyPresetCategory.PRE_EXECUTION,
            parts = parts("LT", "3P", "ABC", "Tangent", "In-line"),
            voltage = VoltageLevel.LT,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P3,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.INLINE
        ),
        SurveyPresetDef(
            id = "pre_lt_3p_abc_tan_section",
            category = SurveyPresetCategory.PRE_EXECUTION,
            parts = parts("LT", "3P", "ABC", "Tangent", "Section"),
            voltage = VoltageLevel.LT,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P3,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.SECTIONAL
        ),
        SurveyPresetDef(
            id = "pre_lt_1p_abc_toff_inline",
            category = SurveyPresetCategory.PRE_EXECUTION,
            parts = parts("LT", "1P", "ABC", "T-Off", "In-line"),
            voltage = VoltageLevel.LT,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P1,
            conductor = "ABC",
            kitLocation = KitLocation.T_OFF,
            kitArrangement = KitArrangement.INLINE
        ),
        SurveyPresetDef(
            id = "pre_11_1p_50_tan_inline",
            category = SurveyPresetCategory.PRE_EXECUTION,
            parts = parts("11kV", "1P", "50", "Tangent", "In-line", "8m"),
            voltage = VoltageLevel.KV_11,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P1,
            conductor = "50",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.INLINE
        ),
        SurveyPresetDef(
            id = "pre_11_3p_50_tan_section",
            category = SurveyPresetCategory.PRE_EXECUTION,
            parts = parts("11kV", "3P", "50", "Tangent", "Section", "8m"),
            voltage = VoltageLevel.KV_11,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P3,
            conductor = "50",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.SECTIONAL
        ),
        SurveyPresetDef(
            id = "pre_dtr_lt",
            category = SurveyPresetCategory.PRE_EXECUTION,
            parts = listOf(
                PresetNamePart("DTR", PresetPartKind.STRUCTURE),
                PresetNamePart("→", PresetPartKind.OTHER),
                PresetNamePart("LT", PresetPartKind.VOLTAGE),
                PresetNamePart("1P", PresetPartKind.STRUCTURE),
                PresetNamePart("ABC", PresetPartKind.CONDUCTOR)
            ),
            voltage = VoltageLevel.KV_11,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.DTR,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.SECTIONAL,
            pattern = PresetPattern.DTR_LT
        )
    )

    val postExecution: List<SurveyPresetDef> = listOf(
        SurveyPresetDef(
            id = "post_lt_conv_abc",
            category = SurveyPresetCategory.POST_EXECUTION,
            parts = listOf(
                PresetNamePart("LT", PresetPartKind.VOLTAGE),
                PresetNamePart("conv", PresetPartKind.OTHER),
                PresetNamePart("ABC", PresetPartKind.CONDUCTOR)
            ),
            voltage = VoltageLevel.LT,
            status = WorkStatus.EXISTING,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P1,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.INLINE,
            postExecOptionId = PostExecPreferences.OPTION_LT_CONVERSION_ABC
        ),
        SurveyPresetDef(
            id = "post_lt_1p_abc_tan_inline",
            category = SurveyPresetCategory.POST_EXECUTION,
            parts = parts("LT", "1P", "ABC", "Tangent", "In-line"),
            voltage = VoltageLevel.LT,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P1,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.INLINE
        ),
        SurveyPresetDef(
            id = "post_lt_1p_abc_tan_section",
            category = SurveyPresetCategory.POST_EXECUTION,
            parts = parts("LT", "1P", "ABC", "Tangent", "Section"),
            voltage = VoltageLevel.LT,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P1,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.SECTIONAL
        ),
        SurveyPresetDef(
            id = "post_lt_3p_abc_tan_inline",
            category = SurveyPresetCategory.POST_EXECUTION,
            parts = parts("LT", "3P", "ABC", "Tangent", "In-line"),
            voltage = VoltageLevel.LT,
            material = PoleMaterial.PCC_8M,
            structure = PoleStructure.P3,
            conductor = "ABC",
            kitLocation = KitLocation.TANGENT,
            kitArrangement = KitArrangement.INLINE
        )
    )

    fun all(): List<SurveyPresetDef> = preExecution + postExecution

    fun byId(id: String?): SurveyPresetDef? =
        id?.let { all().firstOrNull { p -> p.id == it } }

    fun forCategory(category: SurveyPresetCategory): List<SurveyPresetDef> = when (category) {
        SurveyPresetCategory.PRE_EXECUTION -> preExecution
        SurveyPresetCategory.POST_EXECUTION -> postExecution
    }

    fun colourFor(ctx: Context, kind: PresetPartKind, voltageHint: VoltageLevel? = null): Int {
        val res = when (kind) {
            PresetPartKind.VOLTAGE -> when (voltageHint) {
                VoltageLevel.KV_33 -> R.color.kv33
                VoltageLevel.KV_11 -> R.color.kv11
                VoltageLevel.LT -> R.color.lt
                null -> R.color.preset_part_voltage
            }
            PresetPartKind.STRUCTURE -> R.color.preset_part_structure
            PresetPartKind.CONDUCTOR -> R.color.preset_part_conductor
            PresetPartKind.LOCATION -> R.color.preset_part_location
            PresetPartKind.ARRANGEMENT -> R.color.preset_part_arrangement
            PresetPartKind.MATERIAL -> R.color.preset_part_material
            PresetPartKind.OTHER -> R.color.text_secondary
        }
        return ContextCompat.getColor(ctx, res)
    }

    fun colouredName(ctx: Context, preset: SurveyPresetDef): CharSequence {
        val sb = SpannableStringBuilder()
        preset.parts.forEachIndexed { index, part ->
            if (index > 0) {
                val sepStart = sb.length
                sb.append(" ")
                sb.setSpan(
                    ForegroundColorSpan(ContextCompat.getColor(ctx, R.color.text_secondary)),
                    sepStart,
                    sb.length,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
            val start = sb.length
            sb.append(part.text)
            val colour = when (part.kind) {
                PresetPartKind.VOLTAGE -> colourFor(ctx, part.kind, preset.voltage)
                else -> colourFor(ctx, part.kind)
            }
            sb.setSpan(
                ForegroundColorSpan(colour),
                start,
                sb.length,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
            if (part.kind == PresetPartKind.VOLTAGE || part.kind == PresetPartKind.ARRANGEMENT) {
                sb.setSpan(
                    StyleSpan(Typeface.BOLD),
                    start,
                    sb.length,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
        }
        return sb
    }
}
