package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.DtrMount
import com.blackgrapes.slmtoolbox.domain.model.KitArrangement
import com.blackgrapes.slmtoolbox.domain.model.KitExtension
import com.blackgrapes.slmtoolbox.domain.model.KitLocation
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
    val sourceSubstation: String = "",
    val dtCapacityKva: String? = null,
    val remarks: String? = null,
    val kitLocation: String? = null,
    val kitArrangement: String? = null,
    val kitExtension: String? = null,
    val dtrMount: String? = null,
    val kitWire: String? = null,
    val guarding: Boolean = false
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
        // LT bare conductor: 1-phase / 2-phase / 3-phase line (not pole structure like HT).
        VoltageLevel.LT -> listOf(
            PoleStructure.P1,
            PoleStructure.P2,
            PoleStructure.P3
        )
    }

    /**
     * HT Dead-end = end of network and never a single pole.
     * 33kV: 2P/3P/4P only. 11kV: 2P/3P/4P or DTR. LT phases: all allowed.
     */
    fun allowsDeadEnd(voltage: VoltageLevel, structure: PoleStructure?): Boolean {
        if (structure == null) return true
        return when (voltage) {
            VoltageLevel.LT -> true
            VoltageLevel.KV_33 -> structure in listOf(
                PoleStructure.P2,
                PoleStructure.P3,
                PoleStructure.P4
            )
            VoltageLevel.KV_11 -> structure in listOf(
                PoleStructure.P2,
                PoleStructure.P3,
                PoleStructure.P4,
                PoleStructure.DTR
            )
        }
    }

    /** Structures offered for the current location (filters out HT 1P on Dead-end). */
    fun structuresForLocation(
        voltage: VoltageLevel,
        location: KitLocation?
    ): List<PoleStructure> {
        val base = structuresFor(voltage)
        if (location != KitLocation.DEAD_END) return base
        return base.filter { allowsDeadEnd(voltage, it) }
    }

    fun conductorsFor(voltage: VoltageLevel): List<String> = when (voltage) {
        VoltageLevel.KV_33 -> listOf("100", "150", "200")
        VoltageLevel.KV_11 -> listOf("30", "50", "100", "ABC")
        VoltageLevel.LT -> listOf("30", "50", "ABC", "PVC")
    }

    fun isAbcConductor(conductor: String?): Boolean =
        conductor?.equals("ABC", ignoreCase = true) == true

    fun isPvcConductor(conductor: String?): Boolean =
        conductor?.equals("PVC", ignoreCase = true) == true

    /** LT phase options after conductor: ABC is always 3-phase; PVC allows 1P or 3P; bare allows 1P/2P/3P. */
    fun ltPhasesForConductor(conductor: String?): List<PoleStructure> = when {
        isAbcConductor(conductor) -> listOf(PoleStructure.P3)
        isPvcConductor(conductor) -> listOf(PoleStructure.P1, PoleStructure.P3)
        else -> listOf(PoleStructure.P1, PoleStructure.P2, PoleStructure.P3)
    }

    /** Forced phase/structure when conductor locks the choice (ABC → 3Ph only). */
    fun ltForcedStructure(conductor: String?): PoleStructure? = when {
        isAbcConductor(conductor) -> PoleStructure.P3
        else -> null
    }

    fun defaultMaterial(voltage: VoltageLevel): PoleMaterial = materialsFor(voltage).first()

    fun defaultStructure(voltage: VoltageLevel): PoleStructure = structuresFor(voltage).first()

    fun assetTypeFor(structure: PoleStructure): AssetType =
        if (structure == PoleStructure.DTR) AssetType.DT else AssetType.POLE

    fun kitLocationsFor(voltage: VoltageLevel, structure: PoleStructure?): List<KitLocation> {
        val all = KitLocation.entries.toList()
        // HT 1P cannot be Dead-end (end of network needs 2P+ / DTR on 11kV).
        return if (allowsDeadEnd(voltage, structure)) {
            all
        } else {
            all.filter { it != KitLocation.DEAD_END }
        }
    }

    fun kitArrangements(): List<KitArrangement> = KitArrangement.entries.toList()

    fun kitExtensions(): List<KitExtension> = KitExtension.entries.toList()

    /**
     * HT (33/11kV): With-ext allowed on H-Pole, Rail, and 9m PCC.
     * 8m PCC and LT: No-ext only (field practice).
     */
    fun allowsPoleExtension(voltage: VoltageLevel, material: PoleMaterial?): Boolean {
        if (material == null) return false
        return when (voltage) {
            VoltageLevel.KV_33, VoltageLevel.KV_11 -> material in listOf(
                PoleMaterial.H_POLE,
                PoleMaterial.RAIL,
                PoleMaterial.PCC_9M
            )
            VoltageLevel.LT -> false
        }
    }

    fun kitExtensionsFor(voltage: VoltageLevel, material: PoleMaterial?): List<KitExtension> =
        if (allowsPoleExtension(voltage, material)) {
            KitExtension.entries.toList()
        } else {
            listOf(KitExtension.NO_EXT)
        }

    /**
     * Guarding Yes/No is offered when With-ext, or on Rail / H-Pole even with No-ext.
     */
    fun allowsGuardingWithoutExtension(material: PoleMaterial?): Boolean =
        material == PoleMaterial.H_POLE || material == PoleMaterial.RAIL

    fun allowsGuardingChoice(material: PoleMaterial?, extension: KitExtension?): Boolean {
        if (extension == KitExtension.WITH_EXT) return true
        return extension == KitExtension.NO_EXT && allowsGuardingWithoutExtension(material)
    }

    fun dtrMounts(): List<DtrMount> = DtrMount.entries.toList()

    /** Common field capacities first; full sheet list available via "More". */
    fun dtrCapacitiesCommon(): List<String> =
        listOf("16", "25", "63", "100", "160", "250")

    fun dtrCapacitiesMore(): List<String> =
        listOf("315", "630")

    /**
     * Wire count for kit matching.
     * HT ACSR → 3W; ABC/PVC → null (cable); LT bare from phase chips.
     */
    fun kitWireFor(
        voltage: VoltageLevel,
        conductor: String?,
        structure: PoleStructure?
    ): String? {
        if (isAbcConductor(conductor) || isPvcConductor(conductor)) return null
        return when (voltage) {
            VoltageLevel.KV_33, VoltageLevel.KV_11 -> "3W"
            VoltageLevel.LT -> when (structure) {
                PoleStructure.P2 -> "3W"
                PoleStructure.P3 -> "4W"
                else -> "2W"
            }
        }
    }

    fun kitSummary(
        location: KitLocation?,
        arrangement: KitArrangement?,
        extension: KitExtension?,
        dtrMount: DtrMount? = null,
        dtCapacityKva: String? = null
    ): String = buildString {
        append(location?.label ?: "—")
        if (location != KitLocation.DEAD_END && arrangement != null) {
            append(" · ").append(arrangement.label)
        }
        if (extension != null) append(" · ").append(extension.label)
        if (dtrMount != null) append(" · DTR ").append(dtrMount.label)
        if (!dtCapacityKva.isNullOrBlank()) append(" · ").append(dtCapacityKva).append("kVA")
    }

    /**
     * How many parallel strokes to draw for a span.
     * LT uses a single simple line for all phases/ABC — tags carry the meaning.
     */
    fun lineParallelCount(
        voltage: VoltageLevel,
        conductor: String?,
        structure: PoleStructure?
    ): Int = 1

    fun lineStrokeWidth(
        voltage: VoltageLevel,
        conductor: String?,
        structure: PoleStructure?
    ): Float = when (voltage) {
        VoltageLevel.LT -> 7f
        else -> 8f
    }

    /** In-line tag for LT spans: 1Ph / 2Ph / 3Ph / ABC. */
    fun ltLineTag(voltage: VoltageLevel, conductor: String?, structure: PoleStructure?): String? {
        if (voltage != VoltageLevel.LT) return null
        if (isAbcConductor(conductor)) return "ABC"
        if (isPvcConductor(conductor)) return "PVC"
        return when (structure) {
            PoleStructure.P2 -> "2Ph"
            PoleStructure.P3 -> "3Ph"
            else -> "1Ph"
        }
    }

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

    /**
     * Build locked series config for CONTINUE.
     * Voltage / material / conductor / DTR start come from the series START pole.
     * Status comes from the open tip (previous pole): once Proposed, all continues stay Proposed.
     */
    fun seriesConfigFromSeries(
        assets: List<SurveyAsset>,
        seriesId: Long,
        tipAsset: SurveyAsset? = null
    ): SeriesConfig? {
        val inSeries = assets.filter { it.seriesId == seriesId }
        if (inSeries.isEmpty()) return null
        val start = inSeries.firstOrNull {
            it.poleRole == com.blackgrapes.slmtoolbox.domain.model.PoleRole.START
        } ?: inSeries.minByOrNull { it.sequence } ?: return null
        val tip = tipAsset?.takeIf { it.seriesId == seriesId }
            ?: inSeries
                .filter {
                    com.blackgrapes.slmtoolbox.domain.FieldRules.canConnect(it.type) &&
                        it.poleRole != com.blackgrapes.slmtoolbox.domain.model.PoleRole.END
                }
                .maxByOrNull { it.sequence }
            ?: start
        return seriesConfigFrom(start)?.copy(
            startStructure = start.poleStructure,
            status = tip.status
        )
    }
}

object SiteVerification {
    /** Accuracy required for locationVerified / live-at-site. */
    const val MAX_ACCURACY_M = 15f
    /** Still usable for placing, but shown as weak. */
    const val WARN_ACCURACY_M = 30f
    const val MAX_FIX_AGE_MS = 30_000L
    const val MAX_DISTANCE_M = 50f
    const val MIN_SATS_USED = 4

    fun isVerified(
        deviceLatitude: Double?,
        deviceLongitude: Double?,
        deviceAccuracyM: Float?,
        deviceFixTimestamp: Long?,
        distanceFromDeviceM: Float?,
        isMockLocation: Boolean,
        satsUsedInFix: Int? = null,
        now: Long = System.currentTimeMillis()
    ): Boolean {
        if (deviceLatitude == null || deviceLongitude == null) return false
        if (deviceAccuracyM == null || deviceAccuracyM > MAX_ACCURACY_M) return false
        if (deviceFixTimestamp == null || now - deviceFixTimestamp > MAX_FIX_AGE_MS) return false
        if (distanceFromDeviceM == null || distanceFromDeviceM > MAX_DISTANCE_M) return false
        if (isMockLocation) return false
        if (satsUsedInFix != null && satsUsedInFix < MIN_SATS_USED) return false
        return true
    }

    fun accuracyGrade(accuracyM: Float?): AccuracyGrade {
        if (accuracyM == null) return AccuracyGrade.UNKNOWN
        return when {
            accuracyM <= 8f -> AccuracyGrade.EXCELLENT
            accuracyM <= MAX_ACCURACY_M -> AccuracyGrade.GOOD
            accuracyM <= WARN_ACCURACY_M -> AccuracyGrade.WEAK
            else -> AccuracyGrade.POOR
        }
    }
}

enum class AccuracyGrade {
    EXCELLENT, GOOD, WEAK, POOR, UNKNOWN
}

/**
 * Recommended max span (m) when continuing from the tip pole.
 * Over this → red “too far” alert in the map status card.
 *
 * - LT ABC: 40 m
 * - 11kV / 33kV · 9m PCC: 70 m
 * - 11kV / 33kV · Rail: 80 m
 */
object ContinueSpanGuidance {
    const val LT_ABC_MAX_M = 40f
    const val HT_9M_MAX_M = 70f
    const val HT_RAIL_MAX_M = 80f

    fun maxSpanM(
        voltage: VoltageLevel?,
        material: PoleMaterial?,
        conductor: String?
    ): Float? {
        if (voltage == null) return null
        return when (voltage) {
            VoltageLevel.LT ->
                if (NetworkCatalog.isAbcConductor(conductor)) LT_ABC_MAX_M else null
            VoltageLevel.KV_11, VoltageLevel.KV_33 -> when (material) {
                PoleMaterial.PCC_9M -> HT_9M_MAX_M
                PoleMaterial.RAIL -> HT_RAIL_MAX_M
                else -> null
            }
        }
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
