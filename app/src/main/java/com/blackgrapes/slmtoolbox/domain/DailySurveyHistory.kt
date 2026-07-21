package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TreeMap

data class DailyHistoryEntry(
    /** Sort key yyyy-MM-dd */
    val dayKey: String,
    val displayDate: String,
    val surveys: List<Survey>,
    /** Category → pole count (voltage · line type) */
    val polesByType: List<Pair<String, Int>>,
    /** Category → route length metres */
    val routeByTypeM: List<Pair<String, Double>>,
    val totalPoles: Int,
    val totalRouteM: Double
) {
    val workspaceIds: List<Long> get() = surveys.map { it.id }
}

object DailySurveyHistory {

    private val dayKeyFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val displayFmt = SimpleDateFormat("dd MMM yyyy", Locale.US)

    fun build(surveys: List<Survey>): List<DailyHistoryEntry> {
        val byDay = linkedMapOf<String, MutableList<Survey>>()
        surveys.forEach { survey ->
            val key = dayKeyOf(survey)
            byDay.getOrPut(key) { mutableListOf() }.add(survey)
        }
        return byDay.entries
            .sortedByDescending { it.key }
            .map { (key, daySurveys) -> aggregate(key, daySurveys) }
    }

    fun dayKeyOf(survey: Survey): String {
        val whenMs = survey.savedAt
            ?: survey.updatedAt.takeIf { it > 0 }
            ?: survey.createdAt
        return dayKeyFmt.format(Date(whenMs))
    }

    fun categoryForPole(asset: SurveyAsset): String {
        return when (asset.voltage) {
            VoltageLevel.LT -> {
                val tag = NetworkCatalog.ltLineTag(
                    asset.voltage,
                    asset.conductor,
                    asset.poleStructure
                ) ?: "1Ph"
                "LT · $tag"
            }
            else -> {
                val struct = asset.poleStructure?.label ?: "1P"
                "${asset.voltage.label} · $struct"
            }
        }
    }

    fun formatCopyText(
        entry: DailyHistoryEntry,
        displayUnit: String,
        displayDecimals: Int
    ): String = buildString {
        appendLine("SLM Daily Survey Summary")
        appendLine(entry.displayDate)
        appendLine("————————————")
        appendLine("Poles surveyed: ${entry.totalPoles}")
        entry.polesByType.forEach { (cat, count) ->
            appendLine("  $cat: $count")
        }
        appendLine()
        appendLine(
            "R/L: ${SurveyMetrics.formatDistance(entry.totalRouteM, displayUnit, displayDecimals)}"
        )
        entry.routeByTypeM.forEach { (cat, metres) ->
            appendLine(
                "  $cat: ${SurveyMetrics.formatDistance(metres, displayUnit, displayDecimals)}"
            )
        }
        if (entry.surveys.size > 1) {
            appendLine()
            appendLine("Workspaces: ${entry.surveys.size}")
            entry.surveys.forEach { appendLine("  · ${it.title}") }
        }
    }.trim()

    private fun aggregate(dayKey: String, surveys: List<Survey>): DailyHistoryEntry {
        val poleCounts = TreeMap<String, Int>()
        val routeM = TreeMap<String, Double>()
        var totalPoles = 0
        var totalRoute = 0.0

        surveys.forEach { survey ->
            val byId = survey.assets.associateBy { it.id }
            survey.assets.forEach { asset ->
                val cat = categoryForPole(asset)
                poleCounts[cat] = (poleCounts[cat] ?: 0) + 1
                totalPoles++
            }
            survey.connections.forEach { connection ->
                val to = byId[connection.toAssetId] ?: return@forEach
                val cat = categoryForPole(to)
                val span = SurveyMetrics.spanMetres(connection, byId)
                routeM[cat] = (routeM[cat] ?: 0.0) + span
                totalRoute += span
            }
        }

        val display = try {
            displayFmt.format(dayKeyFmt.parse(dayKey)!!)
        } catch (_: Exception) {
            dayKey
        }

        return DailyHistoryEntry(
            dayKey = dayKey,
            displayDate = display,
            surveys = surveys.sortedByDescending {
                it.savedAt ?: it.updatedAt.takeIf { t -> t > 0 } ?: it.createdAt
            },
            polesByType = poleCounts.entries.map { it.key to it.value },
            routeByTypeM = routeM.entries.map { it.key to it.value },
            totalPoles = totalPoles,
            totalRouteM = totalRoute
        )
    }
}
