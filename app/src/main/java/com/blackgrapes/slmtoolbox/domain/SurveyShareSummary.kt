package com.blackgrapes.slmtoolbox.domain

import android.content.Context
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * WhatsApp-friendly daily survey summary for quick field sharing.
 * Full CAD / printable output is intended for the Desktop Editor.
 */
object SurveyShareSummary {

    fun poleLabel(sequence: Int): String =
        "P-${sequence.toString().padStart(2, '0')}"

    /** One-line stats for history list cards. */
    fun compactStats(context: Context, survey: Survey): String {
        val preset = PresetPreferences.get(context)
        val routeM = SurveyMetrics.routeLengthMetres(survey)
        val route = SurveyMetrics.formatDistance(routeM, preset.displayUnit, preset.displayDecimals)
        return "${survey.assets.size} poles · ${survey.connections.size} spans · $route"
    }

    fun formatSurveyDate(survey: Survey): String {
        val whenMs = survey.savedAt
            ?: survey.updatedAt.takeIf { it > 0 }
            ?: survey.createdAt
        return SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault()).format(Date(whenMs))
    }

    fun formatSurveyDayKey(survey: Survey): String {
        val whenMs = survey.savedAt
            ?: survey.updatedAt.takeIf { it > 0 }
            ?: survey.createdAt
        return SimpleDateFormat("dd MMM yyyy", Locale.getDefault()).format(Date(whenMs))
    }

    fun build(context: Context, survey: Survey): String {
        val preset = PresetPreferences.get(context)
        val report = GisAccuracyReport.build(survey)
        val summary = report.summary
        val routeM = SurveyMetrics.routeLengthMetres(survey)
        val whenMs = survey.savedAt
            ?: survey.updatedAt.takeIf { it > 0 }
            ?: survey.createdAt
        val dateLine = SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault())
            .format(Date(whenMs))

        val existingPoles = survey.assets.count { it.status == WorkStatus.EXISTING }
        val proposedPoles = survey.assets.size - existingPoles
        val existingSpans = survey.connections.count { it.status == WorkStatus.EXISTING }
        val proposedSpans = survey.connections.size - existingSpans

        return buildString {
            appendLine("📋 SLM Survey Summary")
            appendLine("━━━━━━━━━━━━━━━━━━━━")
            appendLine(survey.title)
            appendLine("Date: $dateLine")
            if (survey.linemanName.isNotBlank()) appendLine("Surveyor: ${survey.linemanName}")
            if (survey.linemanMobile.isNotBlank()) appendLine("Mobile: ${survey.linemanMobile}")
            appendLine()
            appendLine("Network")
            appendLine("• Poles: ${survey.assets.size} (Existing $existingPoles · Proposed $proposedPoles)")
            appendLine("• Spans: ${survey.connections.size} (Existing $existingSpans · Proposed $proposedSpans)")
            appendLine(
                "• Route length: ${
                    SurveyMetrics.formatDistance(routeM, preset.displayUnit, preset.displayDecimals)
                }"
            )
            appendLine()
            appendLine("GPS / GIS")
            appendLine("• Grade: ${summary.grade.label}")
            appendLine("• Verified poles: ${summary.verifiedCount}/${summary.poleCount} (${"%.0f".format(summary.verifiedPercent)}%)")
            summary.avgAccuracyM?.let {
                appendLine("• Avg accuracy: ${"%.1f".format(it)} m")
            }
            summary.avgSatsUsed?.let {
                appendLine("• Avg satellites: ${"%.0f".format(it)}")
            }
            appendLine()
            appendLine("Poles")
            survey.assets.sortedBy { it.sequence }.forEach { asset ->
                val label = poleLabel(asset.sequence)
                val struct = asset.structure?.ifBlank { null }
                    ?: asset.poleStructure?.label
                    ?: "—"
                appendLine(
                    "• $label  ${SurveyMetrics.formatCoordinate(asset.latitude)}, " +
                        SurveyMetrics.formatCoordinate(asset.longitude) +
                        "  [$struct · ${asset.voltage.label} · ${asset.status.label}]"
                )
            }
            appendLine()
            appendLine("Print-quality CAD drawing → SLM Desktop Editor")
        }.trim()
    }
}
