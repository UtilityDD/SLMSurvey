package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import kotlin.math.roundToInt

object SurveyMetrics {

    fun routeLengthMetres(survey: Survey): Double {
        val byId = survey.assets.associateBy { it.id }
        return survey.connections.sumOf { connection ->
            spanMetres(connection, byId)
        }
    }

    fun spanMetres(
        connection: SurveyConnection,
        byId: Map<Long, SurveyAsset>
    ): Double {
        val entered = connection.spanLengthM?.toDoubleOrNull()?.takeIf { it > 0 }
        if (entered != null) return entered
        val from = byId[connection.fromAssetId] ?: return 0.0
        val to = byId[connection.toAssetId] ?: return 0.0
        return GeometryHitTest.haversineM(
            from.latitude,
            from.longitude,
            to.latitude,
            to.longitude
        )
    }

    fun structureCounts(survey: Survey): Map<PoleStructure, Int> {
        val counts = linkedMapOf<PoleStructure, Int>()
        PoleStructure.entries.forEach { counts[it] = 0 }
        survey.assets.forEach { asset ->
            val structure = asset.poleStructure ?: PoleStructure.P1
            counts[structure] = (counts[structure] ?: 0) + 1
        }
        return counts.filterValues { it > 0 }
    }

    fun shouldShowCoordinates(
        asset: SurveyAsset,
        survey: Survey,
        interval: Int = 5
    ): Boolean {
        if (asset.poleRole == PoleRole.START || asset.poleRole == PoleRole.END) return true
        val structure = asset.poleStructure
        if (structure == PoleStructure.P4 || structure == PoleStructure.DTR) return true
        val branchPoint = survey.connections.count { it.fromAssetId == asset.id } > 1 ||
            survey.connections.count { it.toAssetId == asset.id } > 1
        if (branchPoint) return true
        return asset.sequence > 0 && asset.sequence % interval == 0
    }

    fun formatCoordinate(value: Double): String = "%.5f".format(value)

    fun formatRouteLength(metres: Double): String = metres.roundToInt().toString()

    fun formatDistance(metres: Double, unit: String, decimals: Int): String {
        val converted = when (unit.lowercase()) {
            "foot", "feet", "ft" -> metres * 3.28084
            "km", "kilometer", "kilometers" -> metres / 1000.0
            else -> metres
        }
        val unitSuffix = when (unit.lowercase()) {
            "foot", "feet", "ft" -> "ft"
            "km", "kilometer", "kilometers" -> "km"
            else -> "m"
        }
        val formatStr = "%.${decimals}f"
        return "${formatStr.format(converted)} $unitSuffix"
    }
}
