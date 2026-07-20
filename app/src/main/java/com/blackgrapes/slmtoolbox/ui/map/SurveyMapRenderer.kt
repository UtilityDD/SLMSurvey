package com.blackgrapes.slmtoolbox.ui.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.location.Location
import androidx.core.content.ContextCompat
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.domain.SurveyMetrics
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import org.maplibre.android.annotations.IconFactory
import org.maplibre.android.annotations.Marker
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.annotations.PolylineOptions
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap

object SurveyMapRenderer {

    /**
     * Renders the survey onto the map. 
     * Returns a map of Asset ID to Marker for targeted updates.
     */
    fun render(
        context: Context,
        map: MapLibreMap,
        survey: Survey,
        readOnly: Boolean = false,
        selectedAssetId: Long? = null,
        snappedAssetId: Long? = null
    ): Map<Long, Marker> {
        map.clear()
        val assetById = survey.assets.associateBy { it.id }
        val iconFactory = IconFactory.getInstance(context)
        val assetMarkers = mutableMapOf<Long, Marker>()

        survey.connections.forEach { connection ->
            val from = assetById[connection.fromAssetId] ?: return@forEach
            val to = assetById[connection.toAssetId] ?: return@forEach
            val measuredMetres = Location("").run {
                latitude = from.latitude
                longitude = from.longitude
                distanceTo(
                    Location("").apply {
                        latitude = to.latitude
                        longitude = to.longitude
                    }
                )
            }
            if (connection.status == WorkStatus.PROPOSED) {
                addDottedLine(
                    map = map,
                    from = LatLng(from.latitude, from.longitude),
                    to = LatLng(to.latitude, to.longitude),
                    distanceMetres = measuredMetres.toDouble(),
                    color = colorFor(connection.voltage, context)
                )
            } else {
                map.addPolyline(
                    PolylineOptions()
                        .add(
                            LatLng(from.latitude, from.longitude),
                            LatLng(to.latitude, to.longitude)
                        )
                        .color(colorFor(connection.voltage, context))
                        .width(8f)
                )
            }
            val spanMetres = connection.spanLengthM
                ?.toDoubleOrNull()
                ?.takeIf { it > 0.0 }
                ?: measuredMetres.toDouble()
            val midpoint = LatLng(
                (from.latitude + to.latitude) / 2.0,
                (from.longitude + to.longitude) / 2.0
            )
            map.addMarker(
                MarkerOptions()
                    .position(midpoint)
                    .title("${spanMetres.toInt()} m")
                    .snippet("Pole ${from.sequence} → ${to.sequence}")
                    .icon(iconFactory.fromBitmap(createSpanLabelBitmap(spanMetres)))
            )
        }

        survey.assets.forEach { asset ->
            val selected = selectedAssetId != null && asset.id == selectedAssetId
            val snapped = snappedAssetId != null && asset.id == snappedAssetId
            val icon = createMarkerBitmap(context, asset, selected, false, isSnapped = snapped)
            val marker = map.addMarker(
                MarkerOptions()
                    .position(LatLng(asset.latitude, asset.longitude))
                    .title("#${asset.sequence} ${asset.poleStructure?.label ?: "1P"}")
                    .snippet(
                        buildString {
                            append("${asset.voltage.label} · ${asset.status.label} · ${asset.poleRole.label}")
                            if (selected) append(" · Tapping selected")
                        }
                    )
                    .icon(iconFactory.fromBitmap(icon))
            )
            assetMarkers[asset.id] = marker

            if (SurveyMetrics.shouldShowCoordinates(asset, survey)) {
                map.addMarker(
                    MarkerOptions()
                        .position(LatLng(asset.latitude, asset.longitude))
                        .title("coords")
                        .icon(
                            iconFactory.fromBitmap(
                                createCoordLabelBitmap(asset.latitude, asset.longitude)
                            )
                        )
                )
            }
        }

        if (readOnly && survey.assets.isNotEmpty()) {
            val bounds = LatLngBounds.Builder().apply {
                survey.assets.forEach { include(LatLng(it.latitude, it.longitude)) }
            }.build()
            map.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds, 80))
        }
        
        return assetMarkers
    }

    private fun addDottedLine(
        map: MapLibreMap,
        from: LatLng,
        to: LatLng,
        distanceMetres: Double,
        color: Int
    ) {
        // Optimized dotted line: larger dash gap and smaller segment count to prevent UI lag
        // 4.0m dash gap provides a good balance between "dots" and performance.
        val dashGap = 4.0 
        val segmentCount = (distanceMetres / dashGap).toInt().coerceIn(2, 60)
        for (index in 0 until segmentCount) {
            val startFraction = index.toDouble() / segmentCount
            val endFraction = (startFraction + 0.4 / segmentCount).coerceAtMost(1.0)
            map.addPolyline(
                PolylineOptions()
                    .add(
                        interpolate(from, to, startFraction),
                        interpolate(from, to, endFraction)
                    )
                    .color(color)
                    .width(8f)
            )
        }
    }

    private fun interpolate(from: LatLng, to: LatLng, fraction: Double): LatLng =
        LatLng(
            from.latitude + (to.latitude - from.latitude) * fraction,
            from.longitude + (to.longitude - from.longitude) * fraction
        )

    fun colorFor(voltage: VoltageLevel, context: Context): Int = when (voltage) {
        VoltageLevel.KV_33 -> ContextCompat.getColor(context, R.color.kv33)
        VoltageLevel.KV_11 -> ContextCompat.getColor(context, R.color.kv11)
        VoltageLevel.LT -> ContextCompat.getColor(context, R.color.lt)
    }

    fun createMarkerBitmap(
        context: Context,
        asset: SurveyAsset,
        selected: Boolean = false,
        isBlinking: Boolean = false,
        isSnapped: Boolean = false
    ): Bitmap {
        // Fixed size to prevent layout jumps during blinking
        val size = 104
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        
        // Blink colors: use a pulsing border instead of a whole color change for less "odd" look
        val baseColor = colorFor(asset.voltage, context)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = baseColor
            style = Paint.Style.FILL
        }
        
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (isBlinking) {
                Color.YELLOW
            } else if (!asset.locationVerified) {
                Color.RED
            } else {
                Color.WHITE
            }
            style = Paint.Style.STROKE
            strokeWidth = 5f
            if (!asset.locationVerified && !isBlinking && !selected) {
                pathEffect = android.graphics.DashPathEffect(floatArrayOf(8f, 6f), 0f)
            }
        }
        
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = if ((asset.poleStructure ?: PoleStructure.P1) == PoleStructure.DTR) 22f else 26f
            isFakeBoldText = true
        }
        
        val cx = size / 2f
        val cy = size / 2f
        
        if (selected || isBlinking || isSnapped) {
            val ringColor = when {
                isSnapped && isBlinking -> Color.parseColor("#00E676")
                isSnapped -> Color.parseColor("#388E3C")
                isBlinking -> Color.YELLOW
                else -> ContextCompat.getColor(context, R.color.selection_ring)
            }
            val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = ringColor
                style = Paint.Style.STROKE
                strokeWidth = if (isBlinking || isSnapped) 10f else 7f
                alpha = if (isBlinking) 200 else 255
            }
            canvas.drawCircle(cx, cy, 48f, ring)
        }
        
        val radius = 34f
        canvas.drawCircle(cx, cy, radius, fill)
        canvas.drawCircle(cx, cy, radius, stroke)
        
        val label = asset.poleStructure?.label ?: "1P"
        canvas.drawText(label, cx, cy + 9f, textPaint)
        
        if (asset.status == WorkStatus.PROPOSED && !selected && !isBlinking) {
            val dash = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = ContextCompat.getColor(context, R.color.proposed_dash)
                style = Paint.Style.STROKE
                strokeWidth = 4f
            }
            canvas.drawCircle(cx, cy, 44f, dash)
        }
        return bitmap
    }

    private fun createCoordLabelBitmap(lat: Double, lng: Double): Bitmap {
        val label = "${SurveyMetrics.formatCoordinate(lat)}, ${SurveyMetrics.formatCoordinate(lng)}"
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(33, 33, 33)
            textSize = 20f
            textAlign = Paint.Align.CENTER
        }
        val width = (textPaint.measureText(label) + 20f).toInt().coerceAtLeast(120)
        val height = 36
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(210, 255, 255, 255)
            style = Paint.Style.FILL
        }
        canvas.drawRoundRect(1f, 1f, width - 1f, height - 1f, 8f, 8f, background)
        canvas.drawText(label, width / 2f, 24f, textPaint)
        return bitmap
    }

    private fun createSpanLabelBitmap(spanMetres: Double): Bitmap {
        val label = "${spanMetres.toInt()} m"
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 28f
            textAlign = Paint.Align.CENTER
            isFakeBoldText = true
        }
        val width = (textPaint.measureText(label) + 28f).toInt().coerceAtLeast(84)
        val height = 48
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(235, 255, 255, 255)
            style = Paint.Style.FILL
        }
        val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.DKGRAY
            style = Paint.Style.STROKE
            strokeWidth = 2f
        }
        canvas.drawRoundRect(1f, 1f, width - 1f, height - 1f, 10f, 10f, background)
        canvas.drawRoundRect(1f, 1f, width - 1f, height - 1f, 10f, 10f, border)
        canvas.drawText(label, width / 2f, 34f, textPaint)
        return bitmap
    }

    fun createMyLocationMarkerBitmap(context: Context, isBlinking: Boolean): Bitmap {
        val size = 64
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ContextCompat.getColor(context, R.color.primary)
            style = Paint.Style.FILL
            alpha = if (isBlinking) 255 else 100
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        val cx = size / 2f
        val cy = size / 2f
        canvas.drawCircle(cx, cy, 18f, paint)
        canvas.drawCircle(cx, cy, 18f, stroke)
        return bitmap
    }
}
