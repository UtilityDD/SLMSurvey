package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SldGraphBuilderTest {

    @Test
    fun ordersAssetsByConnectionChain() {
        val assets = listOf(
            asset(1, 1),
            asset(2, 2),
            asset(3, 3)
        )
        val connections = listOf(
            connection(1, 2),
            connection(2, 3)
        )
        val survey = Survey(id = 1, title = "Test", assets = assets, connections = connections)
        val ordered = SldGraphBuilder.orderAssets(survey).map { it.id }
        assertEquals(listOf(1L, 2L, 3L), ordered)
    }

    @Test
    fun buildsPagesForLongRoutes() {
        val assets = (1..10).map { asset(it.toLong(), it) }
        val connections = (1 until 10).map { connection(it.toLong(), (it + 1).toLong()) }
        val survey = Survey(id = 1, title = "Long", assets = assets, connections = connections)
        val graph = SldGraphBuilder.build(survey)
        assertEquals(2, graph.pages.size)
        assertEquals(8, graph.pages[0].nodes.size)
        assertEquals(2, graph.pages[1].nodes.size)
        assertTrue(graph.pages[0].edges.isNotEmpty())
    }

    private fun asset(id: Long, sequence: Int) = SurveyAsset(
        id = id,
        surveyId = 1,
        sequence = sequence,
        latitude = 28.0 + sequence * 0.001,
        longitude = 77.0,
        voltage = VoltageLevel.KV_11,
        status = WorkStatus.EXISTING,
        type = AssetType.POLE
    )

    private fun connection(from: Long, to: Long) = SurveyConnection(
        id = from,
        surveyId = 1,
        fromAssetId = from,
        toAssetId = to,
        voltage = VoltageLevel.KV_11,
        status = WorkStatus.EXISTING,
        spanLengthM = "40"
    )
}
