package com.blackgrapes.slmtoolbox.ui.export

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Typeface
import com.blackgrapes.slmtoolbox.domain.PrintableSldBuilder
import com.blackgrapes.slmtoolbox.domain.PrintableSldPage
import com.blackgrapes.slmtoolbox.domain.SurveyMetrics
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

object PrintableSldRenderer {

    fun renderPage(page: PrintableSldPage, scale: Float = 2f): Bitmap {
        val width = (PrintableSldBuilder.PAGE_WIDTH * scale).toInt()
        val height = (PrintableSldBuilder.PAGE_HEIGHT * scale).toInt()
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.scale(scale, scale)
        draw(canvas, page)
        return bitmap
    }

    fun draw(canvas: Canvas, page: PrintableSldPage) {
        canvas.drawColor(Color.WHITE)
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(21, 101, 192)
            textSize = 22f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(33, 37, 41)
            textSize = 11f
        }
        val smallPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(80, 80, 80)
            textSize = 9f
        }
        val warnPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(211, 47, 47)
            textSize = 11f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            strokeWidth = 2.5f
            style = Paint.Style.STROKE
        }
        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 1.5f
            color = Color.WHITE
        }
        val nodeText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = 10f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }

        canvas.drawText(page.title, 28f, 28f, titlePaint)
        canvas.drawText(
            "Single Line Diagram  ·  Page ${page.pageIndex + 1} of ${page.pageCount}",
            28f,
            48f,
            textPaint
        )
        if (!page.isLiveAtSite) {
            canvas.drawText("SLD not verified as created live at site", 28f, 66f, warnPaint)
        }
        page.continuedFromPage?.let {
            canvas.drawText("Continued from page $it", 28f, 84f, smallPaint)
        }
        page.continuedToPage?.let {
            canvas.drawText("Continued to page $it", 280f, 84f, smallPaint)
        }

        val nodesById = page.nodes.associateBy { it.assetId }
        page.edges.forEach { edge ->
            val from = nodesById[edge.fromAssetId] ?: return@forEach
            val to = nodesById[edge.toAssetId] ?: return@forEach
            linePaint.color = colorFor(edge.voltage)
            linePaint.pathEffect = if (edge.status == WorkStatus.PROPOSED) {
                DashPathEffect(floatArrayOf(10f, 7f), 0f)
            } else {
                null
            }
            canvas.drawLine(from.x, from.y, to.x, to.y, linePaint)
            edge.spanLabel?.let {
                canvas.drawText(
                    it,
                    (from.x + to.x) / 2f,
                    (from.y + to.y) / 2f - 4f,
                    smallPaint
                )
            }
            edge.continuesToPage?.let {
                canvas.drawText("→ p$it", to.x + 14f, to.y - 14f, smallPaint)
            }
            edge.continuesFromPage?.let {
                canvas.drawText("p$it →", from.x - 28f, from.y - 14f, smallPaint)
            }
        }

        page.nodes.forEach { node ->
            fillPaint.color = colorFor(node.voltage)
            canvas.drawCircle(node.x, node.y, 16f, fillPaint)
            canvas.drawCircle(node.x, node.y, 16f, strokePaint)
            if (node.status == WorkStatus.PROPOSED) {
                val dash = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.DKGRAY
                    style = Paint.Style.STROKE
                    strokeWidth = 1.5f
                    pathEffect = DashPathEffect(floatArrayOf(4f, 3f), 0f)
                }
                canvas.drawCircle(node.x, node.y, 20f, dash)
            }
            canvas.drawText(node.structure.label, node.x, node.y + 3.5f, nodeText)
            canvas.drawText("#${node.sequence}", node.x - 10f, node.y + 28f, smallPaint)
            if (node.showCoordinates) {
                canvas.drawText(
                    "${SurveyMetrics.formatCoordinate(node.latitude)}, ${SurveyMetrics.formatCoordinate(node.longitude)}",
                    node.x - 36f,
                    node.y + 40f,
                    smallPaint
                )
            }
        }

        drawLegend(canvas, page, textPaint, smallPaint, fillPaint, strokePaint, nodeText)
        drawFooter(canvas, page, textPaint, smallPaint)
    }

    private fun drawLegend(
        canvas: Canvas,
        page: PrintableSldPage,
        textPaint: Paint,
        smallPaint: Paint,
        fillPaint: Paint,
        strokePaint: Paint,
        nodeText: Paint
    ) {
        val left = 635f
        val top = 110f

        // Calculate dynamic height based on content
        val legendItemCount = page.legend.size
        val feederCount = page.feederEntries.size
        val baseHeight = 60f + legendItemCount * 26f + 8f + 22f + 16f * 4 + 10f
        val feederHeight = if (feederCount > 0) 18f + feederCount * 32f else 0f
        val totalHeight = baseHeight + feederHeight + 16f

        val box = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(245, 247, 250)
            style = Paint.Style.FILL
        }
        val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(200, 200, 200)
            style = Paint.Style.STROKE
            strokeWidth = 1f
        }
        canvas.drawRoundRect(left, top, 820f, top + totalHeight, 8f, 8f, box)
        canvas.drawRoundRect(left, top, 820f, top + totalHeight, 8f, 8f, border)
        canvas.drawText("Legend", left + 12f, top + 22f, textPaint)
        canvas.drawText("Symbol / Count", left + 12f, top + 40f, smallPaint)

        var y = top + 60f
        page.legend.forEach { item ->
            fillPaint.color = Color.rgb(21, 101, 192)
            canvas.drawCircle(left + 24f, y, 12f, fillPaint)
            canvas.drawCircle(left + 24f, y, 12f, strokePaint)
            canvas.drawText(item.structure.label, left + 24f, y + 3.5f, nodeText)
            canvas.drawText("${item.structure.label}  × ${item.count}", left + 46f, y + 4f, smallPaint)
            y += 26f
        }
        y += 8f
        canvas.drawText("Line key", left + 12f, y, textPaint)
        y += 18f
        val keyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            strokeWidth = 3f
            style = Paint.Style.STROKE
        }
        val len33 = page.voltageRouteLengths[VoltageLevel.KV_33] ?: 0.0
        val len33Str = com.blackgrapes.slmtoolbox.domain.SurveyMetrics.formatDistance(len33, page.displayUnit, page.displayDecimals)
        keyPaint.color = colorFor(VoltageLevel.KV_33)
        canvas.drawLine(left + 12f, y, left + 40f, y, keyPaint)
        canvas.drawText("33kV (R/L: $len33Str)", left + 48f, y + 3f, smallPaint)
        y += 16f

        val len11 = page.voltageRouteLengths[VoltageLevel.KV_11] ?: 0.0
        val len11Str = com.blackgrapes.slmtoolbox.domain.SurveyMetrics.formatDistance(len11, page.displayUnit, page.displayDecimals)
        keyPaint.color = colorFor(VoltageLevel.KV_11)
        canvas.drawLine(left + 12f, y, left + 40f, y, keyPaint)
        canvas.drawText("11kV (R/L: $len11Str)", left + 48f, y + 3f, smallPaint)
        y += 16f

        val lenLt = page.voltageRouteLengths[VoltageLevel.LT] ?: 0.0
        val lenLtStr = com.blackgrapes.slmtoolbox.domain.SurveyMetrics.formatDistance(lenLt, page.displayUnit, page.displayDecimals)
        keyPaint.color = colorFor(VoltageLevel.LT)
        canvas.drawLine(left + 12f, y, left + 40f, y, keyPaint)
        canvas.drawText("LT (R/L: $lenLtStr)", left + 48f, y + 3f, smallPaint)
        y += 16f
        keyPaint.color = Color.GRAY
        keyPaint.pathEffect = DashPathEffect(floatArrayOf(8f, 6f), 0f)
        canvas.drawLine(left + 12f, y, left + 40f, y, keyPaint)
        canvas.drawText("Proposed", left + 48f, y + 3f, smallPaint)
        keyPaint.pathEffect = null

        // Draw feeder metadata
        if (page.feederEntries.isNotEmpty()) {
            y += 14f
            val dividerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.rgb(200, 200, 200)
                strokeWidth = 0.5f
            }
            canvas.drawLine(left + 8f, y, 816f, y, dividerPaint)
            y += 14f
            canvas.drawText("Feeder Info", left + 12f, y, textPaint)
            y += 4f
            page.feederEntries.forEach { entry ->
                y += 16f
                val voltageLbl = entry.voltage.label
                canvas.drawText("$voltageLbl: ${entry.feederName}", left + 12f, y, smallPaint)
                y += 12f
                canvas.drawText("Source SS: ${entry.sourceSubstation}", left + 12f, y, smallPaint)
            }
        }
    }

    private fun drawFooter(
        canvas: Canvas,
        page: PrintableSldPage,
        textPaint: Paint,
        smallPaint: Paint
    ) {
        val y = 500f
        val totalRouteStr = com.blackgrapes.slmtoolbox.domain.SurveyMetrics.formatDistance(
            page.totalRouteLengthM, page.displayUnit, page.displayDecimals
        )
        canvas.drawText(
            "Route length (total): $totalRouteStr",
            28f,
            y,
            textPaint
        )
        val pageRouteStr = com.blackgrapes.slmtoolbox.domain.SurveyMetrics.formatDistance(
            page.pageRouteLengthM, page.displayUnit, page.displayDecimals
        )
        canvas.drawText(
            "This page: $pageRouteStr",
            280f,
            y,
            smallPaint
        )
        canvas.drawText("Surveyed by", 28f, 530f, textPaint)
        val name = page.linemanName.ifBlank { "________________" }
        canvas.drawText(name, 110f, 530f, textPaint)
        if (page.linemanMobile.isNotBlank()) {
            canvas.drawText(page.linemanMobile, 280f, 530f, smallPaint)
        }
        canvas.drawText("Signature", 520f, 530f, textPaint)
        canvas.drawLine(580f, 532f, 800f, 532f, Paint().apply {
            color = Color.DKGRAY
            strokeWidth = 1f
        })
        canvas.drawText(
            "Existing solid · Proposed dashed · Circles show 1P/2P/3P/4P/DTR",
            28f,
            560f,
            smallPaint
        )
    }

    private fun colorFor(voltage: VoltageLevel): Int = when (voltage) {
        VoltageLevel.KV_33 -> Color.rgb(211, 47, 47)
        VoltageLevel.KV_11 -> Color.rgb(249, 168, 37)
        VoltageLevel.LT -> Color.rgb(56, 142, 60)
    }
}
