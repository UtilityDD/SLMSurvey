package com.blackgrapes.slmtoolbox.estimate

import com.blackgrapes.slmtoolbox.domain.NetworkCatalog
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel

/**
 * Maps survey conductor chips (30 / 50 / 100 / … / ABC) to kit matrix conductorIds.
 */
object ConductorTagMap {

    /** Exact ACSR conductorIds for sized (non-agnostic) structure / conductor kits. */
    fun sizedConductorIds(voltage: VoltageLevel, tag: String?): List<String> {
        if (tag.isNullOrBlank()) return emptyList()
        val t = tag.trim()
        if (NetworkCatalog.isAbcConductor(t) || NetworkCatalog.isPvcConductor(t)) {
            return emptyList()
        }
        return when (voltage) {
            VoltageLevel.KV_33 -> when (t) {
                "100" -> listOf("ACSR|Dog|100")
                "150" -> listOf("ACSR|Wolf|150")
                "200" -> listOf("ACSR|Panther|200")
                else -> emptyList()
            }
            VoltageLevel.KV_11 -> when (t) {
                "30" -> listOf("ACSR|Weasel|30")
                "50" -> listOf("ACSR|Rabbit|50")
                "100" -> listOf("ACSR|Dog|100")
                else -> emptyList()
            }
            VoltageLevel.LT -> when (t) {
                "20" -> listOf("ACSR|Squirrel|20")
                "30" -> listOf("ACSR|Weasel|30")
                "50" -> listOf("ACSR|Rabbit|50")
                else -> emptyList()
            }
        }
    }

    /** Size-agnostic structure conductorIds (LT all; some 11kV). */
    fun agnosticConductorIds(voltage: VoltageLevel, tag: String?): List<String> {
        if (tag.isNullOrBlank()) return emptyList()
        if (NetworkCatalog.isPvcConductor(tag)) return emptyList()
        return when (voltage) {
            VoltageLevel.LT -> if (NetworkCatalog.isAbcConductor(tag)) {
                listOf("LT|ANY|ABC")
            } else {
                listOf("LT|ANY|ACSR")
            }
            VoltageLevel.KV_11 -> if (NetworkCatalog.isAbcConductor(tag)) {
                listOf("11kV|ANY|ABC", "ABC|HT|3x95")
            } else {
                listOf("11kV|ANY|ACSR")
            }
            VoltageLevel.KV_33 -> emptyList()
        }
    }

    fun conductorFamily(tag: String?): String? {
        if (tag.isNullOrBlank()) return null
        if (NetworkCatalog.isPvcConductor(tag)) return null
        if (NetworkCatalog.isAbcConductor(tag)) return "ABC"
        return "ACSR"
    }

    fun isCableTag(tag: String?): Boolean =
        NetworkCatalog.isAbcConductor(tag) || NetworkCatalog.isPvcConductor(tag)
}
