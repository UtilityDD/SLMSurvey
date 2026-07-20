package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Per-pole GIS reading row for the accuracy data sheet.
 */
data class GisPointReading(
    val sequence: Int,
    val mapLatitude: Double,
    val mapLongitude: Double,
    val deviceLatitude: Double?,
    val deviceLongitude: Double?,
    val accuracyM: Float?,
    val distanceFromDeviceM: Float?,
    val satsUsed: Int?,
    val satsVisible: Int?,
    val avgSnrDb: Float?,
    val fixTimestamp: Long?,
    val locationVerified: Boolean,
    val isMockLocation: Boolean,
    val voltage: String,
    val structure: String?,
    val poleRole: String,
    val status: String
)

enum class GisAccuracyGrade(val label: String, val description: String) {
    EXCELLENT("Excellent", "Avg accuracy ≤ 5 m, ≥ 90% points verified"),
    GOOD("Good", "Avg accuracy ≤ 10 m, ≥ 75% points verified"),
    FAIR("Fair", "Avg accuracy ≤ 20 m, ≥ 50% points verified"),
    POOR("Poor", "Weak GPS or many unverified points"),
    UNKNOWN("Unknown", "Insufficient GPS evidence on poles")
}

data class GisAccuracySummary(
    val poleCount: Int,
    val verifiedCount: Int,
    val verifiedPercent: Float,
    val avgAccuracyM: Float?,
    val minAccuracyM: Float?,
    val maxAccuracyM: Float?,
    val avgDistanceFromDeviceM: Float?,
    val avgSatsUsed: Float?,
    val avgSnrDb: Float?,
    val mockCount: Int,
    val grade: GisAccuracyGrade
)

data class GisDataSheet(
    val surveyTitle: String,
    val generatedAt: Long,
    val summary: GisAccuracySummary,
    val points: List<GisPointReading>
)

object GisAccuracyReport {

    fun build(survey: Survey): GisDataSheet {
        val points = survey.assets
            .sortedBy { it.sequence }
            .map { it.toReading() }
        return GisDataSheet(
            surveyTitle = survey.title,
            generatedAt = System.currentTimeMillis(),
            summary = summarize(points),
            points = points
        )
    }

    fun summarize(points: List<GisPointReading>): GisAccuracySummary {
        val accuracies = points.mapNotNull { it.accuracyM }
        val distances = points.mapNotNull { it.distanceFromDeviceM }
        val satsUsed = points.mapNotNull { it.satsUsed }
        val snrs = points.mapNotNull { it.avgSnrDb }
        val verified = points.count { it.locationVerified }
        val avgAcc = accuracies.averageOrNull()
        val verifiedPct = if (points.isEmpty()) 0f else verified * 100f / points.size

        return GisAccuracySummary(
            poleCount = points.size,
            verifiedCount = verified,
            verifiedPercent = verifiedPct,
            avgAccuracyM = avgAcc,
            minAccuracyM = accuracies.minOrNull(),
            maxAccuracyM = accuracies.maxOrNull(),
            avgDistanceFromDeviceM = distances.averageOrNull(),
            avgSatsUsed = satsUsed.map { it.toFloat() }.averageOrNull(),
            avgSnrDb = snrs.averageOrNull(),
            mockCount = points.count { it.isMockLocation },
            grade = gradeFor(avgAcc, verifiedPct, points.isNotEmpty() && accuracies.isNotEmpty())
        )
    }

    fun poleLabel(sequence: Int): String =
        "P-${sequence.toString().padStart(2, '0')}"

    fun toCsv(sheet: GisDataSheet): String {
        val dateFmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
        val sb = StringBuilder()
        sb.appendLine("# SLM Survey GPS Points")
        sb.appendLine("# Survey: ${sheet.surveyTitle}")
        sb.appendLine("# Generated: ${dateFmt.format(Date(sheet.generatedAt))}")
        sb.appendLine("# Grade: ${sheet.summary.grade.label}")
        sb.appendLine(
            "# Poles: ${sheet.summary.poleCount} | Verified: ${sheet.summary.verifiedCount}" +
                " (${"%.0f".format(sheet.summary.verifiedPercent)}%)"
        )
        sb.appendLine(
            "PoleNo,Sequence,Latitude,Longitude,DeviceLat,DeviceLng,Accuracy_m,Offset_m," +
                "SatsUsed,SatsVisible,AvgSNR_dBHz,FixTime,Verified,Mock,Voltage,Structure,Role,Status"
        )
        sheet.points.forEach { p ->
            sb.appendLine(
                listOf(
                    poleLabel(p.sequence),
                    p.sequence,
                    fmtCoord(p.mapLatitude),
                    fmtCoord(p.mapLongitude),
                    p.deviceLatitude?.let { fmtCoord(it) }.orEmpty(),
                    p.deviceLongitude?.let { fmtCoord(it) }.orEmpty(),
                    p.accuracyM?.let { "%.1f".format(Locale.US, it) }.orEmpty(),
                    p.distanceFromDeviceM?.let { "%.1f".format(Locale.US, it) }.orEmpty(),
                    p.satsUsed?.toString().orEmpty(),
                    p.satsVisible?.toString().orEmpty(),
                    p.avgSnrDb?.let { "%.1f".format(Locale.US, it) }.orEmpty(),
                    p.fixTimestamp?.let { dateFmt.format(Date(it)) }.orEmpty(),
                    if (p.locationVerified) "YES" else "NO",
                    if (p.isMockLocation) "YES" else "NO",
                    p.voltage,
                    p.structure.orEmpty(),
                    p.poleRole,
                    p.status
                ).joinToString(",")
            )
        }
        return sb.toString()
    }

    private fun SurveyAsset.toReading(): GisPointReading = GisPointReading(
        sequence = sequence,
        mapLatitude = latitude,
        mapLongitude = longitude,
        deviceLatitude = deviceLatitude,
        deviceLongitude = deviceLongitude,
        accuracyM = deviceAccuracyM,
        distanceFromDeviceM = distanceFromDeviceM,
        satsUsed = satsUsedInFix,
        satsVisible = satsVisible,
        avgSnrDb = avgSnrDb,
        fixTimestamp = deviceFixTimestamp,
        locationVerified = locationVerified,
        isMockLocation = isMockLocation,
        voltage = voltage.label,
        structure = structure,
        poleRole = poleRole.label,
        status = status.label
    )

    private fun gradeFor(
        avgAccuracyM: Float?,
        verifiedPercent: Float,
        hasEvidence: Boolean
    ): GisAccuracyGrade {
        if (!hasEvidence || avgAccuracyM == null) return GisAccuracyGrade.UNKNOWN
        return when {
            avgAccuracyM <= 5f && verifiedPercent >= 90f -> GisAccuracyGrade.EXCELLENT
            avgAccuracyM <= 10f && verifiedPercent >= 75f -> GisAccuracyGrade.GOOD
            avgAccuracyM <= 20f && verifiedPercent >= 50f -> GisAccuracyGrade.FAIR
            else -> GisAccuracyGrade.POOR
        }
    }

    private fun List<Float>.averageOrNull(): Float? =
        if (isEmpty()) null else average().toFloat()

    private fun fmtCoord(v: Double): String = "%.6f".format(Locale.US, v)
    private fun fmtM(v: Float?): String = v?.let { "%.1f m".format(Locale.US, it) } ?: "—"
    private fun fmtNum(v: Float?): String = v?.let { "%.1f".format(Locale.US, it) } ?: "—"
}
