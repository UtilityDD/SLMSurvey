package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GisAccuracyReportTest {

    @Test
    fun summarize_gradesExcellentWhenAccurateAndVerified() {
        val points = listOf(
            reading(accuracy = 3f, verified = true, sats = 12, snr = 35f),
            reading(accuracy = 4f, verified = true, sats = 11, snr = 32f)
        )
        val summary = GisAccuracyReport.summarize(points)
        assertEquals(GisAccuracyGrade.EXCELLENT, summary.grade)
        assertEquals(2, summary.poleCount)
        assertEquals(2, summary.verifiedCount)
        assertEquals(3.5f, summary.avgAccuracyM!!, 0.01f)
    }

    @Test
    fun toCsv_includesHeaderAndRows() {
        val survey = Survey(
            id = 1L,
            title = "Test Feeder",
            assets = listOf(
                SurveyAsset(
                    id = 1L,
                    surveyId = 1L,
                    sequence = 1,
                    latitude = 19.1,
                    longitude = 72.8,
                    voltage = VoltageLevel.KV_11,
                    status = WorkStatus.EXISTING,
                    type = AssetType.POLE,
                    poleRole = PoleRole.START,
                    deviceAccuracyM = 5f,
                    satsUsedInFix = 10,
                    satsVisible = 18,
                    avgSnrDb = 30f,
                    locationVerified = true
                )
            )
        )
        val csv = GisAccuracyReport.toCsv(GisAccuracyReport.build(survey))
        assertTrue(csv.contains("SLM Survey GPS Points"))
        assertTrue(csv.contains("PoleNo,Sequence,Latitude"))
        assertTrue(csv.contains("P-01"))
        assertTrue(csv.contains("19.100000"))
        assertTrue(csv.contains("10,18,30.0"))
    }

    private fun reading(
        accuracy: Float,
        verified: Boolean,
        sats: Int,
        snr: Float
    ) = GisPointReading(
        sequence = 1,
        mapLatitude = 0.0,
        mapLongitude = 0.0,
        deviceLatitude = 0.0,
        deviceLongitude = 0.0,
        accuracyM = accuracy,
        distanceFromDeviceM = 1f,
        satsUsed = sats,
        satsVisible = sats + 4,
        avgSnrDb = snr,
        fixTimestamp = 1L,
        locationVerified = verified,
        isMockLocation = false,
        voltage = "11kV",
        structure = "1P",
        poleRole = "Start",
        status = "Existing"
    )
}
