package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

data class SeriesConfig(
    val seriesId: Long,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val material: PoleMaterial,
    val conductor: String,
    val feederName: String = "",
    val sourceSubstation: String = "",
    /** Structure of the series START pole (used for DTR→LT continue). */
    val startStructure: PoleStructure? = null
)

data class PlacementDraft(
    val latitude: Double,
    val longitude: Double,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val material: PoleMaterial,
    val structure: PoleStructure,
    val conductor: String,
    val poleRole: com.blackgrapes.slmtoolbox.domain.model.PoleRole,
    val seriesId: Long?,
    val sourceAssetId: Long? = null,
    val splitConnectionId: Long? = null,
    val feederName: String = "",
    val sourceSubstation: String = ""
)

object NetworkCatalog {
    fun materialsFor(voltage: VoltageLevel): List<PoleMaterial> = when (voltage) {
        VoltageLevel.KV_33 -> listOf(
            PoleMaterial.H_POLE,
            PoleMaterial.RAIL,
            PoleMaterial.PCC_9M
        )
        VoltageLevel.KV_11 -> listOf(
            PoleMaterial.PCC_8M,
            PoleMaterial.PCC_9M,
            PoleMaterial.H_POLE,
            PoleMaterial.RAIL
        )
        VoltageLevel.LT -> listOf(PoleMaterial.PCC_8M)
    }

    fun structuresFor(voltage: VoltageLevel): List<PoleStructure> = when (voltage) {
        VoltageLevel.KV_33 -> listOf(
            PoleStructure.P1,
            PoleStructure.P2,
            PoleStructure.P3,
            PoleStructure.P4
        )
        VoltageLevel.KV_11 -> listOf(
            PoleStructure.P1,
            PoleStructure.P2,
            PoleStructure.P3,
            PoleStructure.P4,
            PoleStructure.DTR
        )
        VoltageLevel.LT -> listOf(PoleStructure.P1)
    }

    fun conductorsFor(voltage: VoltageLevel): List<String> = when (voltage) {
        VoltageLevel.KV_33 -> listOf("100", "150", "200")
        VoltageLevel.KV_11 -> listOf("30", "50", "100", "ABC")
        VoltageLevel.LT -> listOf("30", "50", "ABC")
    }

    fun defaultMaterial(voltage: VoltageLevel): PoleMaterial = materialsFor(voltage).first()

    fun defaultStructure(voltage: VoltageLevel): PoleStructure = structuresFor(voltage).first()

    fun assetTypeFor(structure: PoleStructure): AssetType =
        if (structure == PoleStructure.DTR) AssetType.DT else AssetType.POLE

    fun seriesConfigFrom(asset: SurveyAsset): SeriesConfig? {
        val material = asset.material ?: return null
        val conductor = asset.conductor?.takeIf { it.isNotBlank() } ?: return null
        val seriesId = asset.seriesId ?: return null
        return SeriesConfig(
            seriesId = seriesId,
            voltage = asset.voltage,
            status = asset.status,
            material = material,
            conductor = conductor,
            startStructure = asset.poleStructure
        )
    }

    /** Prefer series START asset so DTR→LT pattern is detected correctly. */
    fun seriesConfigFromSeries(assets: List<SurveyAsset>, seriesId: Long): SeriesConfig? {
        val inSeries = assets.filter { it.seriesId == seriesId }
        if (inSeries.isEmpty()) return null
        val start = inSeries.firstOrNull {
            it.poleRole == com.blackgrapes.slmtoolbox.domain.model.PoleRole.START
        } ?: inSeries.minByOrNull { it.sequence } ?: return null
        return seriesConfigFrom(start)?.copy(
            startStructure = start.poleStructure
        )
    }
}

object SiteVerification {
    const val MAX_ACCURACY_M = 30f
    const val MAX_FIX_AGE_MS = 2 * 60 * 1000L
    const val MAX_DISTANCE_M = 50f

    fun isVerified(
        deviceLatitude: Double?,
        deviceLongitude: Double?,
        deviceAccuracyM: Float?,
        deviceFixTimestamp: Long?,
        distanceFromDeviceM: Float?,
        isMockLocation: Boolean,
        now: Long = System.currentTimeMillis()
    ): Boolean {
        if (deviceLatitude == null || deviceLongitude == null) return false
        if (deviceAccuracyM == null || deviceAccuracyM > MAX_ACCURACY_M) return false
        if (deviceFixTimestamp == null || now - deviceFixTimestamp > MAX_FIX_AGE_MS) return false
        if (distanceFromDeviceM == null || distanceFromDeviceM > MAX_DISTANCE_M) return false
        if (isMockLocation) return false
        return true
    }
}

object GeometryHitTest {
    private const val EARTH_RADIUS_M = 6_371_000.0

    fun distanceToSegmentM(
        lat: Double,
        lng: Double,
        aLat: Double,
        aLng: Double,
        bLat: Double,
        bLng: Double
    ): Float {
        val ab = haversineM(aLat, aLng, bLat, bLng)
        if (ab < 0.5) {
            return haversineM(lat, lng, aLat, aLng).toFloat()
        }
        val ax = 0.0
        val ay = 0.0
        val bx = eastingM(aLat, aLng, bLat, bLng)
        val by = northingM(aLat, aLng, bLat, bLng)
        val px = eastingM(aLat, aLng, lat, lng)
        val py = northingM(aLat, aLng, lat, lng)
        val abLen2 = bx * bx + by * by
        if (abLen2 <= 1e-6) {
            return min(haversineM(lat, lng, aLat, aLng), haversineM(lat, lng, bLat, bLng)).toFloat()
        }
        var t = ((px - ax) * bx + (py - ay) * by) / abLen2
        t = t.coerceIn(0.0, 1.0)
        val cx = ax + t * bx
        val cy = ay + t * by
        val dx = px - cx
        val dy = py - cy
        return sqrt(dx * dx + dy * dy).toFloat()
    }

    fun projectPointToSegment(
        lat: Double,
        lng: Double,
        aLat: Double,
        aLng: Double,
        bLat: Double,
        bLng: Double
    ): Pair<Double, Double> {
        val ab = haversineM(aLat, aLng, bLat, bLng)
        if (ab < 0.5) {
            return Pair(aLat, aLng)
        }
        val ax = 0.0
        val ay = 0.0
        val bx = eastingM(aLat, aLng, bLat, bLng)
        val by = northingM(aLat, aLng, bLat, bLng)
        val px = eastingM(aLat, aLng, lat, lng)
        val py = northingM(aLat, aLng, lat, lng)
        val abLen2 = bx * bx + by * by
        if (abLen2 <= 1e-6) {
            return Pair(aLat, aLng)
        }
        var t = ((px - ax) * bx + (py - ay) * by) / abLen2
        t = t.coerceIn(0.0, 1.0)
        return Pair(
            aLat + t * (bLat - aLat),
            aLng + t * (bLng - aLng)
        )
    }

    fun haversineM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2).pow(2.0) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2.0)
        return 2 * EARTH_RADIUS_M * asin(sqrt(a))
    }

    private fun eastingM(originLat: Double, originLng: Double, lat: Double, lng: Double): Double {
        val meanLat = Math.toRadians((originLat + lat) / 2.0)
        return Math.toRadians(lng - originLng) * EARTH_RADIUS_M * cos(meanLat)
    }

    private fun northingM(originLat: Double, originLng: Double, lat: Double, lng: Double): Double {
        return Math.toRadians(lat - originLat) * EARTH_RADIUS_M
    }
}
