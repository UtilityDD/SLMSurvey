package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyMetricsTest {

    @Test
    fun routeLengthUsesEnteredSpans() {
        val survey = sampleSurvey()
        assertEquals(90.0, SurveyMetrics.routeLengthMetres(survey), 0.01)
    }

    @Test
    fun structureCountsIncludeLabels() {
        val survey = sampleSurvey()
        val counts = SurveyMetrics.structureCounts(survey)
        assertEquals(2, counts[PoleStructure.P1])
        assertEquals(1, counts[PoleStructure.P4])
    }

    @Test
    fun coordinatesOnCriticalPoles() {
        val survey = sampleSurvey()
        val start = survey.assets.first { it.poleRole == PoleRole.START }
        val mid = survey.assets.first { it.sequence == 2 }
        val fourP = survey.assets.first { it.structure == "4P" }
        assertTrue(SurveyMetrics.shouldShowCoordinates(start, survey))
        assertTrue(SurveyMetrics.shouldShowCoordinates(fourP, survey))
        assertFalse(SurveyMetrics.shouldShowCoordinates(mid, survey))
    }

    private fun sampleSurvey(): Survey {
        val assets = listOf(
            asset(1, 1, PoleRole.START, "1P"),
            asset(2, 2, PoleRole.CONTINUE, "1P"),
            asset(3, 3, PoleRole.END, "4P")
        )
        val connections = listOf(
            connection(1, 2, "40"),
            connection(2, 3, "50")
        )
        return Survey(id = 1, title = "Metrics", assets = assets, connections = connections)
    }

    private fun asset(
        id: Long,
        sequence: Int,
        role: PoleRole,
        structure: String
    ) = SurveyAsset(
        id = id,
        surveyId = 1,
        sequence = sequence,
        latitude = 28.0 + sequence * 0.001,
        longitude = 77.0,
        voltage = VoltageLevel.KV_11,
        status = WorkStatus.EXISTING,
        type = AssetType.POLE,
        poleRole = role,
        structure = structure,
        seriesId = 99L
    )

    private fun connection(from: Long, to: Long, span: String) = SurveyConnection(
        id = from,
        surveyId = 1,
        fromAssetId = from,
        toAssetId = to,
        voltage = VoltageLevel.KV_11,
        status = WorkStatus.EXISTING,
        spanLengthM = span
    )
}
