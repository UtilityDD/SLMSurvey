package com.blackgrapes.slmtoolbox.ui.export

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.blackgrapes.slmtoolbox.domain.GisAccuracyGrade
import com.blackgrapes.slmtoolbox.domain.GisDataSheet
import com.blackgrapes.slmtoolbox.domain.GisPointReading
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Renders GIS accuracy data-sheet pages as bitmaps (A4 portrait).
 */
object GisDataSheetRenderer {

    const val PAGE_WIDTH = 595f
    const val PAGE_HEIGHT = 842f

    private const val MARGIN = 28f
    private const val ROWS_PER_PAGE = 28

    fun renderPages(sheet: GisDataSheet, scale: Float = 2f): List<Bitmap> {
        val chunks = sheet.points.chunked(ROWS_PER_PAGE).ifEmpty { listOf(emptyList()) }
        return chunks.mapIndexed { index, rows ->
            renderPage(sheet, rows, index + 1, chunks.size, scale)
        }
    }

    private fun renderPage(
        sheet: GisDataSheet,
        rows: List<GisPointReading>,
        pageNum: Int,
        pageCount: Int,
        scale: Float
    ): Bitmap {
        val w = (PAGE_WIDTH * scale).toInt()
        val h = (PAGE_HEIGHT * scale).toInt()
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.scale(scale, scale)
        canvas.drawColor(Color.WHITE)

        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 16f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val subtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.DKGRAY
            textSize = 9f
        }
        val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 8f
        }
        val headerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = 7.5f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val cellPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 7f
        }
        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.LTGRAY
            strokeWidth = 0.6f
            style = Paint.Style.STROKE
        }
        val fillHeader = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#1565C0")
            style = Paint.Style.FILL
        }
        val fillAlt = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#F5F7FA")
            style = Paint.Style.FILL
        }
        val gradePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 11f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            color = gradeColor(sheet.summary.grade)
        }

        var y = MARGIN
        val dateFmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)

        canvas.drawText("GIS Accuracy Data Sheet", MARGIN, y + 14f, titlePaint)
        y += 22f
        canvas.drawText(
            "Survey: ${sheet.surveyTitle}  ·  Generated: ${dateFmt.format(Date(sheet.generatedAt))}",
            MARGIN,
            y,
            subtitlePaint
        )
        y += 14f

        if (pageNum == 1) {
            val s = sheet.summary
            canvas.drawText(
                "Drawing accuracy grade: ${s.grade.label}",
                MARGIN,
                y,
                gradePaint
            )
            y += 13f
            canvas.drawText(s.grade.description, MARGIN, y, subtitlePaint)
            y += 14f

            val summaryLines = listOf(
                "Poles: ${s.poleCount}   |   Verified: ${s.verifiedCount} (${"%.0f".format(s.verifiedPercent)}%)   |   Mock: ${s.mockCount}",
                "GPS accuracy (m): avg ${fmt(s.avgAccuracyM)}  ·  min ${fmt(s.minAccuracyM)}  ·  max ${fmt(s.maxAccuracyM)}",
                "Map↔device offset (m): avg ${fmt(s.avgDistanceFromDeviceM)}",
                "Satellites at capture: avg used ${fmt(s.avgSatsUsed)}  ·  avg SNR ${fmt(s.avgSnrDb)} dB-Hz"
            )
            summaryLines.forEach { line ->
                canvas.drawText(line, MARGIN, y, bodyPaint)
                y += 11f
            }
            y += 8f
            canvas.drawText(
                "Per-point readings (map placement + GPS evidence at capture)",
                MARGIN,
                y,
                bodyPaint
            )
            y += 12f
        } else {
            canvas.drawText("Per-point readings (continued)", MARGIN, y, bodyPaint)
            y += 12f
        }

        val tableLeft = MARGIN
        val tableRight = PAGE_WIDTH - MARGIN
        val colXs = floatArrayOf(
            tableLeft,           // #
            tableLeft + 22f,     // Map Lat
            tableLeft + 78f,     // Map Lng
            tableLeft + 134f,    // Acc
            tableLeft + 168f,    // Offset
            tableLeft + 206f,    // Sats
            tableLeft + 248f,    // SNR
            tableLeft + 286f,    // Verified
            tableLeft + 328f,    // Fix time
            tableLeft + 430f     // Voltage / struct
        )
        val rowH = 14f
        val headers = listOf(
            "#", "Map Lat", "Map Lng", "Acc m", "Off m", "Sats", "SNR", "OK", "Fix time", "V / Struct"
        )

        canvas.drawRect(tableLeft, y, tableRight, y + rowH, fillHeader)
        headers.forEachIndexed { i, h ->
            canvas.drawText(h, colXs[i] + 2f, y + 10f, headerPaint)
        }
        y += rowH

        rows.forEachIndexed { idx, p ->
            if (idx % 2 == 1) {
                canvas.drawRect(tableLeft, y, tableRight, y + rowH, fillAlt)
            }
            canvas.drawRect(tableLeft, y, tableRight, y + rowH, linePaint)
            val cells = listOf(
                p.sequence.toString(),
                "%.6f".format(Locale.US, p.mapLatitude),
                "%.6f".format(Locale.US, p.mapLongitude),
                p.accuracyM?.let { "%.1f".format(Locale.US, it) } ?: "—",
                p.distanceFromDeviceM?.let { "%.1f".format(Locale.US, it) } ?: "—",
                formatSats(p.satsUsed, p.satsVisible),
                p.avgSnrDb?.let { "%.0f".format(Locale.US, it) } ?: "—",
                if (p.locationVerified) "Y" else "N",
                p.fixTimestamp?.let { dateFmt.format(Date(it)).takeLast(8) } ?: "—",
                "${p.voltage} ${p.structure.orEmpty()}".trim()
            )
            cells.forEachIndexed { i, text ->
                canvas.drawText(text, colXs[i] + 2f, y + 10f, cellPaint)
            }
            y += rowH
        }

        val footerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.GRAY
            textSize = 8f
        }
        canvas.drawText(
            "Page $pageNum of $pageCount  ·  Acc = GPS horizontal accuracy  ·  Off = map point vs device GPS  ·  Sats = used/visible",
            MARGIN,
            PAGE_HEIGHT - 16f,
            footerPaint
        )

        return bitmap
    }

    private fun formatSats(used: Int?, visible: Int?): String = when {
        used != null && visible != null -> "$used/$visible"
        used != null -> "$used/—"
        visible != null -> "—/$visible"
        else -> "—"
    }

    private fun fmt(v: Float?): String = v?.let { "%.1f".format(Locale.US, it) } ?: "—"

    private fun gradeColor(grade: GisAccuracyGrade): Int = when (grade) {
        GisAccuracyGrade.EXCELLENT -> Color.parseColor("#2E7D32")
        GisAccuracyGrade.GOOD -> Color.parseColor("#558B2F")
        GisAccuracyGrade.FAIR -> Color.parseColor("#F9A825")
        GisAccuracyGrade.POOR -> Color.parseColor("#C62828")
        GisAccuracyGrade.UNKNOWN -> Color.GRAY
    }
}
