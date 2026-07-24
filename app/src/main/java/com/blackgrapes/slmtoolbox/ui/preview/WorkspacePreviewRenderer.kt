package com.blackgrapes.slmtoolbox.ui.preview

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import androidx.core.content.ContextCompat
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.domain.PresetPreferences
import com.blackgrapes.slmtoolbox.domain.SurveyMetrics
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import com.blackgrapes.slmtoolbox.ui.map.SurveyMapRenderer
import kotlin.math.max
import kotlin.math.min

/**
 * Read-only geographic workspace sketch for the Preview screen.
 * Not an SLD / printable CAD page — poles and spans in map layout only.
 */
object WorkspacePreviewRenderer {

    fun render(context: Context, survey: Survey, widthPx: Int = 1400): Bitmap {
        val heightPx = (widthPx * 1.15f).toInt()
        val bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.parseColor("#F1F5F9"))

        if (survey.assets.isEmpty()) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#64748B")
                textAlign = Paint.Align.CENTER
                textSize = widthPx * 0.045f
            }
            canvas.drawText(
                context.getString(R.string.preview_empty),
                widthPx / 2f,
                heightPx / 2f,
                paint
            )
            return bitmap
        }

        val pad = widthPx * 0.06f
        val mapBottom = heightPx * 0.78f
        val bounds = projectBounds(survey)
        val mapW = widthPx - pad * 2
        val mapH = mapBottom - pad * 2

        fun x(lng: Double): Float {
            val t = if (bounds.maxLng == bounds.minLng) 0.5
            else (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)
            return pad + (t * mapW).toFloat()
        }

        fun y(lat: Double): Float {
            val t = if (bounds.maxLat == bounds.minLat) 0.5
            else (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)
            // Screen Y grows downward; flip so north is up.
            return pad + ((1.0 - t) * mapH).toFloat()
        }

        val byId = survey.assets.associateBy { it.id }
        survey.connections.forEach { connection ->
            val from = byId[connection.fromAssetId] ?: return@forEach
            val to = byId[connection.toAssetId] ?: return@forEach
            val color = SurveyMapRenderer.colorFor(connection.voltage, context)
            val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = color
                style = Paint.Style.STROKE
                strokeWidth = when (connection.voltage) {
                    VoltageLevel.KV_33 -> 8f
                    VoltageLevel.KV_11 -> 6.5f
                    VoltageLevel.LT -> 5f
                }
                strokeCap = Paint.Cap.ROUND
                if (connection.status == WorkStatus.PROPOSED) {
                    pathEffect = DashPathEffect(floatArrayOf(16f, 12f), 0f)
                }
            }
            canvas.drawLine(
                x(from.longitude), y(from.latitude),
                x(to.longitude), y(to.latitude),
                stroke
            )
        }

        survey.assets.forEach { asset ->
            val cx = x(asset.longitude)
            val cy = y(asset.latitude)
            val base = SurveyMapRenderer.colorFor(asset.voltage, context)
            val r = 18f
            val proposed = asset.status == WorkStatus.PROPOSED
            if (proposed) {
                canvas.drawCircle(cx, cy, r, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.WHITE
                    style = Paint.Style.FILL
                })
                canvas.drawCircle(cx, cy, r, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = base
                    style = Paint.Style.STROKE
                    strokeWidth = 5f
                })
            } else {
                canvas.drawCircle(cx, cy, r, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = base
                    style = Paint.Style.FILL
                })
                canvas.drawCircle(cx, cy, r, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.WHITE
                    style = Paint.Style.STROKE
                    strokeWidth = 3f
                })
            }
            val label = (asset.poleStructure ?: PoleStructure.P1).label
            canvas.drawText(
                label,
                cx,
                cy + 6f,
                Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = if (proposed) base else Color.WHITE
                    textAlign = Paint.Align.CENTER
                    textSize = 16f
                    isFakeBoldText = true
                }
            )
        }

        drawFooter(context, canvas, survey, widthPx, mapBottom, heightPx)
        return bitmap
    }

    private data class Bounds(
        val minLat: Double,
        val maxLat: Double,
        val minLng: Double,
        val maxLng: Double
    )

    private fun projectBounds(survey: Survey): Bounds {
        var minLat = Double.POSITIVE_INFINITY
        var maxLat = Double.NEGATIVE_INFINITY
        var minLng = Double.POSITIVE_INFINITY
        var maxLng = Double.NEGATIVE_INFINITY
        survey.assets.forEach {
            minLat = min(minLat, it.latitude)
            maxLat = max(maxLat, it.latitude)
            minLng = min(minLng, it.longitude)
            maxLng = max(maxLng, it.longitude)
        }
        val latPad = max((maxLat - minLat) * 0.12, 0.00025)
        val lngPad = max((maxLng - minLng) * 0.12, 0.00025)
        return Bounds(
            minLat - latPad,
            maxLat + latPad,
            minLng - lngPad,
            maxLng + lngPad
        )
    }

    private fun drawFooter(
        context: Context,
        canvas: Canvas,
        survey: Survey,
        width: Int,
        top: Float,
        height: Int
    ) {
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
        }
        canvas.drawRect(0f, top, width.toFloat(), height.toFloat(), bg)

        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#0F172A")
            textSize = width * 0.028f
            isFakeBoldText = true
        }
        val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#475569")
            textSize = width * 0.022f
        }
        var y = top + width * 0.035f
        val left = width * 0.045f
        canvas.drawText(context.getString(R.string.legend), left, y, titlePaint)
        y += width * 0.032f

        val swatch = width * 0.018f
        listOf(
            VoltageLevel.KV_33 to ContextCompat.getColor(context, R.color.kv33),
            VoltageLevel.KV_11 to ContextCompat.getColor(context, R.color.kv11),
            VoltageLevel.LT to ContextCompat.getColor(context, R.color.lt)
        ).forEach { (voltage, color) ->
            canvas.drawRoundRect(
                RectF(left, y - swatch, left + swatch * 2.2f, y),
                4f,
                4f,
                Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
            )
            canvas.drawText(voltage.label, left + swatch * 2.8f, y - 2f, bodyPaint)
            y += width * 0.028f
        }

        canvas.drawCircle(
            left + swatch,
            y - swatch * 0.35f,
            swatch * 0.7f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = ContextCompat.getColor(context, R.color.kv11)
                style = Paint.Style.FILL
            }
        )
        canvas.drawText(
            context.getString(R.string.legend_existing_pole),
            left + swatch * 2.8f,
            y,
            bodyPaint
        )
        y += width * 0.028f
        canvas.drawCircle(
            left + swatch,
            y - swatch * 0.35f,
            swatch * 0.7f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.FILL
            }
        )
        canvas.drawCircle(
            left + swatch,
            y - swatch * 0.35f,
            swatch * 0.7f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = ContextCompat.getColor(context, R.color.kv11)
                style = Paint.Style.STROKE
                strokeWidth = 3f
            }
        )
        canvas.drawText(
            context.getString(R.string.legend_proposed_pole),
            left + swatch * 2.8f,
            y,
            bodyPaint
        )

        val preset = PresetPreferences.get(context)
        val route = SurveyMetrics.formatDistance(
            SurveyMetrics.routeLengthMetres(survey),
            preset.displayUnit,
            preset.displayDecimals
        )
        val structures = SurveyMetrics.structureCounts(survey)
            .entries
            .joinToString(" · ") { "${it.key.label} ${it.value}" }
            .ifBlank { "—" }

        val summaryLeft = width * 0.42f
        var sy = top + width * 0.035f
        canvas.drawText(context.getString(R.string.network_summary), summaryLeft, sy, titlePaint)
        sy += width * 0.032f
        listOf(
            context.getString(R.string.preview_summary_poles, survey.assets.size),
            context.getString(R.string.preview_summary_spans, survey.connections.size),
            context.getString(R.string.preview_summary_route, route),
            structures
        ).forEach { line ->
            canvas.drawText(line, summaryLeft, sy, bodyPaint)
            sy += width * 0.028f
        }
    }
}
