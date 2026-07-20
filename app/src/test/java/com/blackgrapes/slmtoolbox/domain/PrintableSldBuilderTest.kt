package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrintableSldBuilderTest {

    @Test
    fun paginatesAndKeepsCrossPageContinuity() {
        val assets = (1..12).map { asset(it.toLong(), it) }
        val connections = (1 until 12).map { connection(it.toLong(), (it + 1).toLong()) }
        val survey = Survey(
            id = 1,
            title = "Print",
            assets = assets,
            connections = connections,
            linemanName = "Ravi"
        )
        val document = PrintableSldBuilder.build(survey)
        assertEquals(2, document.pages.size)
        assertEquals(PrintableSldBuilder.PAGE_WIDTH, 842f, 0.01f)
        assertEquals(PrintableSldBuilder.PAGE_HEIGHT, 595f, 0.01f)
        assertTrue(document.pages[0].edges.any { it.continuesToPage != null })
        assertTrue(document.pages[1].edges.any { it.continuesFromPage != null })
        assertEquals("Ravi", document.pages[0].linemanName)
        assertTrue(document.pages[0].legend.isNotEmpty())
        assertTrue(document.pages[0].totalRouteLengthM > 0)
    }

    @Test
    fun unverifiedSurveyFlagPropagates() {
        val assets = listOf(
            asset(1, 1).copy(locationVerified = false, poleRole = PoleRole.START),
            asset(2, 2).copy(locationVerified = true, poleRole = PoleRole.END)
        )
        val survey = Survey(
            id = 1,
            title = "Offline",
            assets = assets,
            connections = listOf(connection(1, 2))
        )
        assertFalse(survey.isLiveAtSite)
        val page = PrintableSldBuilder.build(survey).pages.first()
        assertFalse(page.isLiveAtSite)
    }

    private fun asset(id: Long, sequence: Int) = SurveyAsset(
        id = id,
        surveyId = 1,
        sequence = sequence,
        latitude = 28.0 + sequence * 0.001,
        longitude = 77.0,
        voltage = VoltageLevel.KV_33,
        status = WorkStatus.EXISTING,
        type = AssetType.POLE,
        poleRole = if (sequence == 1) PoleRole.START else PoleRole.CONTINUE,
        structure = "1P",
        seriesId = 7L,
        locationVerified = true
    )

    private fun connection(from: Long, to: Long) = SurveyConnection(
        id = from,
        surveyId = 1,
        fromAssetId = from,
        toAssetId = to,
        voltage = VoltageLevel.KV_33,
        status = WorkStatus.EXISTING,
        spanLengthM = "35"
    )
}
