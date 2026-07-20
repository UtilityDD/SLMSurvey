package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.data.entity.SeriesMetaEntity
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

data class PrintNode(
    val assetId: Long,
    val sequence: Int,
    val structure: PoleStructure,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val role: PoleRole,
    val latitude: Double,
    val longitude: Double,
    val showCoordinates: Boolean,
    val x: Float,
    val y: Float
)

data class PrintEdge(
    val fromAssetId: Long,
    val toAssetId: Long,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val spanLabel: String?,
    val continuesFromPage: Int? = null,
    val continuesToPage: Int? = null
)

data class PrintLegendItem(
    val structure: PoleStructure,
    val count: Int
)

data class FeederEntry(
    val voltage: VoltageLevel,
    val feederName: String,
    val sourceSubstation: String
)

data class PrintableSldPage(
    val pageIndex: Int,
    val pageCount: Int,
    val title: String,
    val nodes: List<PrintNode>,
    val edges: List<PrintEdge>,
    val legend: List<PrintLegendItem>,
    val feederEntries: List<FeederEntry> = emptyList(),
    val voltageRouteLengths: Map<VoltageLevel, Double> = emptyMap(),
    val displayUnit: String = "meter",
    val displayDecimals: Int = 1,
    val totalRouteLengthM: Double,
    val pageRouteLengthM: Double,
    val linemanName: String,
    val linemanMobile: String,
    val isLiveAtSite: Boolean,
    val continuedFromPage: Int?,
    val continuedToPage: Int?
)

data class PrintableSldDocument(
    val pages: List<PrintableSldPage>
)

object PrintableSldBuilder {
    const val PAGE_WIDTH = 842f
    const val PAGE_HEIGHT = 595f
    private const val NODES_PER_PAGE = 10
    private const val CONTENT_LEFT = 40f
    private const val CONTENT_TOP = 110f
    /** Full page width — legend sits below the network, not beside it. */
    private const val CONTENT_RIGHT = 802f
    private const val CONTENT_BOTTOM = 400f

    fun build(
        survey: Survey,
        seriesMeta: List<SeriesMetaEntity> = emptyList(),
        displayUnit: String = "meter",
        displayDecimals: Int = 1
    ): PrintableSldDocument {
        val ordered = SldGraphBuilder.orderAssets(survey)
        if (ordered.isEmpty()) {
            return PrintableSldDocument(listOf(emptyPage(survey, 0, 1, displayUnit, displayDecimals)))
        }
        val chunks = ordered.chunked(NODES_PER_PAGE)
        val pageCount = chunks.size
        val byId = survey.assets.associateBy { it.id }
        val totalRoute = SurveyMetrics.routeLengthMetres(survey)
        val legend = SurveyMetrics.structureCounts(survey)
            .map { PrintLegendItem(it.key, it.value) }

        // Calculate total route lengths per voltage level
        val voltageRouteLengths = survey.connections
            .groupBy { it.voltage }
            .mapValues { (_, connections) ->
                connections.sumOf { connection ->
                    SurveyMetrics.spanMetres(connection, byId)
                }
            }

        // Build feeder entries from series metadata
        val metaBySeriesId = seriesMeta.associateBy { it.seriesId }
        val feederEntries = survey.assets
            .filter { it.seriesId != null && it.poleRole == PoleRole.START }
            .mapNotNull { asset ->
                metaBySeriesId[asset.seriesId]?.let { meta ->
                    if (meta.feederName.isNotBlank() || meta.sourceSubstation.isNotBlank()) {
                        FeederEntry(
                            voltage = asset.voltage,
                            feederName = meta.feederName,
                            sourceSubstation = meta.sourceSubstation
                        )
                    } else null
                }
            }

        val pages = chunks.mapIndexed { pageIndex, chunk ->
            val positions = layoutNodes(chunk, survey).toMutableList()
            val nodeIds = chunk.map { it.id }.toSet()
            val pageEdges = mutableListOf<PrintEdge>()
            var pageLength = 0.0

            survey.connections.forEach { connection ->
                val fromOn = connection.fromAssetId in nodeIds
                val toOn = connection.toAssetId in nodeIds
                val span = SurveyMetrics.spanMetres(connection, byId)
                val formattedSpan = SurveyMetrics.formatDistance(span, displayUnit, displayDecimals)
                when {
                    fromOn && toOn -> {
                        pageLength += span
                        pageEdges += PrintEdge(
                            fromAssetId = connection.fromAssetId,
                            toAssetId = connection.toAssetId,
                            voltage = connection.voltage,
                            status = connection.status,
                            spanLabel = formattedSpan
                        )
                    }
                    fromOn && !toOn -> {
                        val targetPage = pageIndexOf(connection.toAssetId, chunks)
                        pageEdges += PrintEdge(
                            fromAssetId = connection.fromAssetId,
                            toAssetId = connection.toAssetId,
                            voltage = connection.voltage,
                            status = connection.status,
                            spanLabel = formattedSpan,
                            continuesToPage = targetPage
                        )
                        byId[connection.toAssetId]?.let { asset ->
                            if (positions.none { it.assetId == asset.id }) {
                                positions += continuityNode(
                                    asset,
                                    survey,
                                    CONTENT_RIGHT - 20f,
                                    CONTENT_TOP + 60f + pageEdges.size * 8f
                                )
                            }
                        }
                    }
                    !fromOn && toOn -> {
                        val sourcePage = pageIndexOf(connection.fromAssetId, chunks)
                        pageEdges += PrintEdge(
                            fromAssetId = connection.fromAssetId,
                            toAssetId = connection.toAssetId,
                            voltage = connection.voltage,
                            status = connection.status,
                            spanLabel = formattedSpan,
                            continuesFromPage = sourcePage
                        )
                        byId[connection.fromAssetId]?.let { asset ->
                            if (positions.none { it.assetId == asset.id }) {
                                positions += continuityNode(
                                    asset,
                                    survey,
                                    CONTENT_LEFT + 20f,
                                    CONTENT_TOP + 60f + pageEdges.size * 8f
                                )
                            }
                        }
                    }
                }
            }

            PrintableSldPage(
                pageIndex = pageIndex,
                pageCount = pageCount,
                title = survey.title,
                nodes = positions,
                edges = pageEdges,
                legend = legend,
                feederEntries = feederEntries,
                voltageRouteLengths = voltageRouteLengths,
                displayUnit = displayUnit,
                displayDecimals = displayDecimals,
                totalRouteLengthM = totalRoute,
                pageRouteLengthM = pageLength,
                linemanName = survey.linemanName,
                linemanMobile = survey.linemanMobile,
                isLiveAtSite = survey.isLiveAtSite,
                continuedFromPage = if (pageIndex > 0) pageIndex else null,
                continuedToPage = if (pageIndex < pageCount - 1) pageIndex + 2 else null
            )
        }
        return PrintableSldDocument(pages)
    }

    private fun pageIndexOf(assetId: Long, chunks: List<List<SurveyAsset>>): Int {
        chunks.forEachIndexed { index, chunk ->
            if (chunk.any { it.id == assetId }) return index + 1
        }
        return 1
    }

    private fun layoutNodes(chunk: List<SurveyAsset>, survey: Survey): List<PrintNode> {
        val width = CONTENT_RIGHT - CONTENT_LEFT
        val height = CONTENT_BOTTOM - CONTENT_TOP
        val cols = 5
        val rows = 2
        return chunk.mapIndexed { index, asset ->
            val col = index % cols
            val row = index / cols
            val x = CONTENT_LEFT + 40f + col * (width / cols)
            val y = CONTENT_TOP + 50f + row * (height / rows)
            PrintNode(
                assetId = asset.id,
                sequence = asset.sequence,
                structure = asset.poleStructure ?: PoleStructure.P1,
                voltage = asset.voltage,
                status = asset.status,
                role = asset.poleRole,
                latitude = asset.latitude,
                longitude = asset.longitude,
                showCoordinates = SurveyMetrics.shouldShowCoordinates(asset, survey),
                x = x,
                y = y
            )
        }
    }

    private fun continuityNode(asset: SurveyAsset, survey: Survey, x: Float, y: Float): PrintNode =
        PrintNode(
            assetId = asset.id,
            sequence = asset.sequence,
            structure = asset.poleStructure ?: PoleStructure.P1,
            voltage = asset.voltage,
            status = asset.status,
            role = asset.poleRole,
            latitude = asset.latitude,
            longitude = asset.longitude,
            showCoordinates = SurveyMetrics.shouldShowCoordinates(asset, survey),
            x = x,
            y = y
        )

    private fun emptyPage(
        survey: Survey,
        pageIndex: Int,
        pageCount: Int,
        displayUnit: String = "meter",
        displayDecimals: Int = 1
    ): PrintableSldPage =
        PrintableSldPage(
            pageIndex = pageIndex,
            pageCount = pageCount,
            title = survey.title,
            nodes = emptyList(),
            edges = emptyList(),
            legend = emptyList(),
            voltageRouteLengths = emptyMap(),
            displayUnit = displayUnit,
            displayDecimals = displayDecimals,
            totalRouteLengthM = 0.0,
            pageRouteLengthM = 0.0,
            linemanName = survey.linemanName,
            linemanMobile = survey.linemanMobile,
            isLiveAtSite = survey.isLiveAtSite,
            continuedFromPage = null,
            continuedToPage = null
        )
}
