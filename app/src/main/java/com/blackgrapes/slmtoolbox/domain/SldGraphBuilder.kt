package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

data class SldNode(
    val assetId: Long,
    val label: String,
    val type: AssetType,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val sequence: Int,
    val x: Float,
    val y: Float
)

data class SldEdge(
    val fromAssetId: Long,
    val toAssetId: Long,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val label: String?
)

data class SldPage(
    val pageIndex: Int,
    val nodes: List<SldNode>,
    val edges: List<SldEdge>
)

data class SldGraph(
    val title: String,
    val pages: List<SldPage>
)

object SldGraphBuilder {
    private const val NODES_PER_PAGE = 8
    private const val START_X = 80f
    private const val START_Y = 160f
    private const val STEP_X = 140f
    private const val ROW_Y = 280f

    fun build(survey: Survey): SldGraph {
        val ordered = orderAssets(survey)
        if (ordered.isEmpty()) {
            return SldGraph(survey.title, listOf(SldPage(0, emptyList(), emptyList())))
        }

        val pages = ordered.chunked(NODES_PER_PAGE).mapIndexed { pageIndex, chunk ->
            val nodes = chunk.mapIndexed { index, asset ->
                val col = index % 4
                val row = index / 4
                SldNode(
                    assetId = asset.id,
                    label = "${asset.sequence}. ${asset.type.label}",
                    type = asset.type,
                    voltage = asset.voltage,
                    status = asset.status,
                    sequence = asset.sequence,
                    x = START_X + col * STEP_X,
                    y = START_Y + row * ROW_Y
                )
            }
            val nodeIds = chunk.map { it.id }.toSet()
            val edges = survey.connections
                .filter { it.fromAssetId in nodeIds && it.toAssetId in nodeIds }
                .map { connection ->
                    SldEdge(
                        fromAssetId = connection.fromAssetId,
                        toAssetId = connection.toAssetId,
                        voltage = connection.voltage,
                        status = connection.status,
                        label = connection.spanLengthM?.takeIf { it.isNotBlank() }?.let { "${it}m" }
                    )
                }
            SldPage(pageIndex, nodes, edges)
        }
        return SldGraph(survey.title, pages)
    }

    fun orderAssets(survey: Survey): List<SurveyAsset> {
        if (survey.assets.isEmpty()) return emptyList()
        val byId = survey.assets.associateBy { it.id }
        val adjacency = linkedMapOf<Long, MutableList<SurveyConnection>>()
        survey.connections.forEach { connection ->
            adjacency.getOrPut(connection.fromAssetId) { mutableListOf() }.add(connection)
        }

        val visited = linkedSetOf<Long>()
        val result = mutableListOf<SurveyAsset>()

        fun walk(assetId: Long) {
            if (!visited.add(assetId)) return
            byId[assetId]?.let { result.add(it) }
            adjacency[assetId]
                ?.sortedBy { byId[it.toAssetId]?.sequence ?: Int.MAX_VALUE }
                ?.forEach { walk(it.toAssetId) }
        }

        val starts = survey.assets
            .sortedBy { it.sequence }
            .filter { asset -> survey.connections.none { it.toAssetId == asset.id } }
        (starts.ifEmpty { survey.assets.sortedBy { it.sequence } }).forEach { walk(it.id) }

        survey.assets.sortedBy { it.sequence }.forEach { asset ->
            if (asset.id !in visited) {
                result.add(asset)
                visited.add(asset.id)
            }
        }
        return result
    }
}
