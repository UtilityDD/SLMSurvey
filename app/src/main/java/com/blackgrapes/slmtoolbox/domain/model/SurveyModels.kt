package com.blackgrapes.slmtoolbox.domain.model

enum class VoltageLevel(val label: String) {
    KV_33("33kV"),
    KV_11("11kV"),
    LT("LT");

    companion object {
        fun fromLabel(value: String): VoltageLevel =
            entries.firstOrNull { it.label.equals(value, ignoreCase = true) || it.name == value }
                ?: LT
    }
}

enum class WorkStatus(val label: String) {
    EXISTING("Existing"),
    PROPOSED("Proposed");

    companion object {
        fun fromLabel(value: String): WorkStatus =
            entries.firstOrNull { it.label.equals(value, ignoreCase = true) || it.name == value }
                ?: EXISTING
    }
}

enum class AssetType(val label: String) {
    POLE("Pole"),
    DT("DT"),
    STAY("Stay"),
    EARTHING("Earthing"),
    JUNCTION("Junction"),
    NOTE("Note");

    companion object {
        fun fromLabel(value: String): AssetType =
            entries.firstOrNull { it.label.equals(value, ignoreCase = true) || it.name == value }
                ?: POLE
    }
}

enum class PoleRole(val label: String) {
    START("Start"),
    CONTINUE("Continue"),
    END("End");

    companion object {
        fun fromLabel(value: String): PoleRole {
            if (value.equals("TAPPING", ignoreCase = true) ||
                value.equals("Tapping", ignoreCase = true)
            ) {
                return CONTINUE
            }
            return entries.firstOrNull {
                it.label.equals(value, ignoreCase = true) || it.name == value
            } ?: CONTINUE
        }
    }
}

enum class PoleMaterial(val label: String) {
    H_POLE("H-Pole"),
    RAIL("Rail"),
    PCC_8M("8m PCC"),
    PCC_9M("9m PCC");

    companion object {
        fun fromLabel(value: String?): PoleMaterial? {
            if (value.isNullOrBlank()) return null
            return entries.firstOrNull {
                it.label.equals(value, ignoreCase = true) || it.name == value
            }
        }
    }
}

enum class PoleStructure(val label: String) {
    P1("1P"),
    P2("2P"),
    P3("3P"),
    P4("4P"),
    DTR("DTR"),
    /** Extra / newly added LT pole in post-exec LT conversion (separate legend count). */
    P1N("1NP");

    companion object {
        fun fromLabel(value: String?): PoleStructure? {
            if (value.isNullOrBlank()) return null
            return entries.firstOrNull {
                it.label.equals(value, ignoreCase = true) || it.name == value
            }
        }
    }
}

data class SurveyAsset(
    val id: Long = 0L,
    val surveyId: Long,
    val sequence: Int,
    val latitude: Double,
    val longitude: Double,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val type: AssetType,
    val poleRole: PoleRole = PoleRole.CONTINUE,
    val poleMaterial: String? = null,
    val poleHeightM: String? = null,
    val conductor: String? = null,
    val circuit: String? = null,
    val spanLengthM: String? = null,
    val dtCapacityKva: String? = null,
    val stayType: String? = null,
    val earthingType: String? = null,
    val remarks: String? = null,
    val structure: String? = null,
    val seriesId: Long? = null,
    val deviceLatitude: Double? = null,
    val deviceLongitude: Double? = null,
    val deviceAccuracyM: Float? = null,
    val deviceFixTimestamp: Long? = null,
    val distanceFromDeviceM: Float? = null,
    val isMockLocation: Boolean = false,
    val locationVerified: Boolean = false,
    /** Satellites used in the GNSS fix when the pole was placed. */
    val satsUsedInFix: Int? = null,
    /** Total satellites visible when the pole was placed. */
    val satsVisible: Int? = null,
    /** Average CN0 (dB-Hz) of satellites used in the fix. */
    val avgSnrDb: Float? = null
) {
    val poleStructure: PoleStructure?
        get() = PoleStructure.fromLabel(structure)

    val material: PoleMaterial?
        get() = PoleMaterial.fromLabel(poleMaterial)
}

data class SurveyConnection(
    val id: Long = 0L,
    val surveyId: Long,
    val fromAssetId: Long,
    val toAssetId: Long,
    val voltage: VoltageLevel,
    val status: WorkStatus,
    val spanLengthM: String? = null
)

data class Survey(
    val id: Long = 0L,
    val title: String,
    val linemanName: String = "",
    val linemanMobile: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val isSavedWorkspace: Boolean = false,
    val savedAt: Long? = null,
    val assets: List<SurveyAsset> = emptyList(),
    val connections: List<SurveyConnection> = emptyList()
) {
    val isLiveAtSite: Boolean
        get() = assets.isNotEmpty() && assets.all { it.locationVerified }
}

data class SurveyStamp(
    val timestamp: Long,
    val coarseLatitude: Double?,
    val coarseLongitude: Double?,
    val installationId: String,
    val deviceModel: String,
    val linemanName: String,
    val linemanMobile: String,
    val carrierName: String?
) {
    fun asReadableLines(): List<String> = buildList {
        add("Survey stamp")
        add(
            "Time: ${
                java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US)
                    .format(java.util.Date(timestamp))
            }"
        )
        if (coarseLatitude != null && coarseLongitude != null) {
            add("Location: ${"%.3f".format(coarseLatitude)}, ${"%.3f".format(coarseLongitude)}")
        }
        add("Device: $deviceModel")
        add("Install ID: $installationId")
        if (linemanName.isNotBlank()) add("Lineman: $linemanName")
        if (linemanMobile.isNotBlank()) add("Mobile: $linemanMobile")
        if (!carrierName.isNullOrBlank()) add("Carrier: $carrierName")
    }
}
