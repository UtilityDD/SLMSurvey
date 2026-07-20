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
            val voltageColor = colorFor(node.voltage)
            if (node.status == WorkStatus.PROPOSED) {
                // Hollow circle = Proposed pole
                val hollowFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.WHITE
                    style = Paint.Style.FILL
                }
                val hollowStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = voltageColor
                    style = Paint.Style.STROKE
                    strokeWidth = 3f
                }
                canvas.drawCircle(node.x, node.y, 16f, hollowFill)
                canvas.drawCircle(node.x, node.y, 16f, hollowStroke)
                val proposedText = Paint(nodeText).apply { color = voltageColor }
                canvas.drawText(node.structure.label, node.x, node.y + 3.5f, proposedText)
            } else {
                // Filled circle = Existing pole
                fillPaint.color = voltageColor
                canvas.drawCircle(node.x, node.y, 16f, fillPaint)
                canvas.drawCircle(node.x, node.y, 16f, strokePaint)
                canvas.drawText(node.structure.label, node.x, node.y + 3.5f, nodeText)
            }
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
        // Legend sits below the network diagram (full width strip).
        val left = 28f
        val right = 814f
        val top = 412f
        val bottom = 488f

        val box = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(245, 247, 250)
            style = Paint.Style.FILL
        }
        val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(200, 200, 200)
            style = Paint.Style.STROKE
            strokeWidth = 1f
        }
        canvas.drawRoundRect(left, top, right, bottom, 8f, 8f, box)
        canvas.drawRoundRect(left, top, right, bottom, 8f, 8f, border)

        canvas.drawText("Legend", left + 12f, top + 16f, textPaint)

        // Structure symbols in a horizontal row
        var x = left + 70f
        val symbolY = top + 22f
        page.legend.forEach { item ->
            fillPaint.color = Color.rgb(21, 101, 192)
            canvas.drawCircle(x, symbolY, 10f, fillPaint)
            canvas.drawCircle(x, symbolY, 10f, strokePaint)
            val symbolLabelPaint = Paint(nodeText).apply { textSize = 8f }
            canvas.drawText(item.structure.label, x, symbolY + 3f, symbolLabelPaint)
            canvas.drawText(
                "${item.structure.label} × ${item.count}",
                x + 14f,
                symbolY + 3.5f,
                smallPaint
            )
            x += 78f
        }

        // Line key on second row
        var keyX = left + 12f
        val keyY = top + 48f
        canvas.drawText("Line key", keyX, keyY, textPaint)
        keyX += 58f
        val keyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            strokeWidth = 3f
            style = Paint.Style.STROKE
        }
        fun drawKey(label: String, color: Int, dashed: Boolean = false) {
            keyPaint.color = color
            keyPaint.pathEffect = if (dashed) DashPathEffect(floatArrayOf(8f, 6f), 0f) else null
            canvas.drawLine(keyX, keyY - 3f, keyX + 28f, keyY - 3f, keyPaint)
            canvas.drawText(label, keyX + 34f, keyY, smallPaint)
            keyX += 34f + smallPaint.measureText(label) + 18f
            keyPaint.pathEffect = null
        }
        val len33 = page.voltageRouteLengths[VoltageLevel.KV_33] ?: 0.0
        val len11 = page.voltageRouteLengths[VoltageLevel.KV_11] ?: 0.0
        val lenLt = page.voltageRouteLengths[VoltageLevel.LT] ?: 0.0
        drawKey(
            "33kV (${SurveyMetrics.formatDistance(len33, page.displayUnit, page.displayDecimals)})",
            colorFor(VoltageLevel.KV_33)
        )
        drawKey(
            "11kV (${SurveyMetrics.formatDistance(len11, page.displayUnit, page.displayDecimals)})",
            colorFor(VoltageLevel.KV_11)
        )
        drawKey(
            "LT (${SurveyMetrics.formatDistance(lenLt, page.displayUnit, page.displayDecimals)})",
            colorFor(VoltageLevel.LT)
        )
        drawKey("Proposed line", Color.GRAY, dashed = true)

        // Pole status key
        val poleKeyY = keyY + 14f
        var poleX = left + 12f
        canvas.drawText("Pole", poleX, poleKeyY, textPaint)
        poleX += 36f
        fillPaint.color = Color.rgb(21, 101, 192)
        canvas.drawCircle(poleX, poleKeyY - 3f, 6f, fillPaint)
        canvas.drawCircle(poleX, poleKeyY - 3f, 6f, strokePaint)
        canvas.drawText("Existing (filled)", poleX + 10f, poleKeyY, smallPaint)
        poleX += 10f + smallPaint.measureText("Existing (filled)") + 16f
        val hollow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(21, 101, 192)
            style = Paint.Style.STROKE
            strokeWidth = 2.5f
        }
        canvas.drawCircle(poleX, poleKeyY - 3f, 6f, hollow)
        canvas.drawText("Proposed (hollow)", poleX + 10f, poleKeyY, smallPaint)

        // Feeder info on the right side of the legend strip
        if (page.feederEntries.isNotEmpty()) {
            var feederY = top + 14f
            val feederX = 560f
            canvas.drawText("Feeder Info", feederX, feederY, textPaint)
            page.feederEntries.take(2).forEach { entry ->
                feederY += 14f
                canvas.drawText(
                    "${entry.voltage.label}: ${entry.feederName}",
                    feederX,
                    feederY,
                    smallPaint
                )
                feederY += 12f
                canvas.drawText(
                    "Source SS: ${entry.sourceSubstation}",
                    feederX,
                    feederY,
                    smallPaint
                )
            }
        }
    }

    private fun drawFooter(
        canvas: Canvas,
        page: PrintableSldPage,
        textPaint: Paint,
        smallPaint: Paint
    ) {
        val y = 508f
        val totalRouteStr = SurveyMetrics.formatDistance(
            page.totalRouteLengthM, page.displayUnit, page.displayDecimals
        )
        canvas.drawText(
            "Route length (total): $totalRouteStr",
            28f,
            y,
            textPaint
        )
        val pageRouteStr = SurveyMetrics.formatDistance(
            page.pageRouteLengthM, page.displayUnit, page.displayDecimals
        )
        canvas.drawText(
            "This page: $pageRouteStr",
            280f,
            y,
            smallPaint
        )
        canvas.drawText("Surveyed by", 28f, 536f, textPaint)
        val name = page.linemanName.ifBlank { "________________" }
        canvas.drawText(name, 110f, 536f, textPaint)
        if (page.linemanMobile.isNotBlank()) {
            canvas.drawText(page.linemanMobile, 280f, 536f, smallPaint)
        }
        canvas.drawText("Signature", 520f, 536f, textPaint)
        canvas.drawLine(580f, 538f, 800f, 538f, Paint().apply {
            color = Color.DKGRAY
            strokeWidth = 1f
        })
        canvas.drawText(
            "Existing solid · Proposed dashed · Circles show 1P/2P/3P/4P/DTR",
            28f,
            568f,
            smallPaint
        )
    }

    private fun colorFor(voltage: VoltageLevel): Int = when (voltage) {
        VoltageLevel.KV_33 -> Color.rgb(211, 47, 47)
        VoltageLevel.KV_11 -> Color.rgb(249, 168, 37)
        VoltageLevel.LT -> Color.rgb(56, 142, 60)
    }
}
