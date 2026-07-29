package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkCatalogTest {

    @Test
    fun kv33Catalog() {
        assertEquals(
            listOf(PoleMaterial.H_POLE, PoleMaterial.RAIL, PoleMaterial.PCC_9M),
            NetworkCatalog.materialsFor(VoltageLevel.KV_33)
        )
        assertEquals(
            listOf(PoleStructure.P1, PoleStructure.P2, PoleStructure.P3, PoleStructure.P4),
            NetworkCatalog.structuresFor(VoltageLevel.KV_33)
        )
        assertEquals(listOf("100", "150", "200"), NetworkCatalog.conductorsFor(VoltageLevel.KV_33))
    }

    @Test
    fun kv11CatalogIncludesDtrAndRail() {
        assertTrue(PoleStructure.DTR in NetworkCatalog.structuresFor(VoltageLevel.KV_11))
        assertTrue(PoleMaterial.RAIL in NetworkCatalog.materialsFor(VoltageLevel.KV_11))
        assertEquals(
            listOf("30", "50", "100", "ABC"),
            NetworkCatalog.conductorsFor(VoltageLevel.KV_11)
        )
    }

    @Test
    fun kv33AllowsTOffOn1P() {
        assertTrue(
            com.blackgrapes.slmtoolbox.domain.model.KitLocation.T_OFF in
                NetworkCatalog.kitLocationsFor(VoltageLevel.KV_33, PoleStructure.P1)
        )
    }

    @Test
    fun htDeadEndNever1P() {
        val dead = com.blackgrapes.slmtoolbox.domain.model.KitLocation.DEAD_END
        assertFalse(NetworkCatalog.allowsDeadEnd(VoltageLevel.KV_33, PoleStructure.P1))
        assertFalse(NetworkCatalog.allowsDeadEnd(VoltageLevel.KV_11, PoleStructure.P1))
        assertTrue(NetworkCatalog.allowsDeadEnd(VoltageLevel.KV_33, PoleStructure.P2))
        assertTrue(NetworkCatalog.allowsDeadEnd(VoltageLevel.KV_11, PoleStructure.DTR))
        assertTrue(NetworkCatalog.allowsDeadEnd(VoltageLevel.LT, PoleStructure.P1))
        assertFalse(
            dead in NetworkCatalog.kitLocationsFor(VoltageLevel.KV_33, PoleStructure.P1)
        )
        assertFalse(
            dead in NetworkCatalog.kitLocationsFor(VoltageLevel.KV_11, PoleStructure.P1)
        )
        assertTrue(
            dead in NetworkCatalog.kitLocationsFor(VoltageLevel.KV_11, PoleStructure.DTR)
        )
        assertEquals(
            listOf(PoleStructure.P2, PoleStructure.P3, PoleStructure.P4),
            NetworkCatalog.structuresForLocation(VoltageLevel.KV_33, dead)
        )
        assertTrue(
            PoleStructure.DTR in
                NetworkCatalog.structuresForLocation(VoltageLevel.KV_11, dead)
        )
        assertFalse(
            PoleStructure.P1 in
                NetworkCatalog.structuresForLocation(VoltageLevel.KV_11, dead)
        )
    }

    @Test
    fun ltAbcForces3Phase() {
        assertEquals(listOf(PoleStructure.P3), NetworkCatalog.ltPhasesForConductor("ABC"))
        assertEquals(PoleStructure.P3, NetworkCatalog.ltForcedStructure("ABC"))
        assertEquals(PoleStructure.P1, NetworkCatalog.ltForcedStructure("PVC"))
        assertEquals(null, NetworkCatalog.ltForcedStructure("50"))
    }

    @Test
    fun htExtensionAndGuardingRules() {
        assertTrue(NetworkCatalog.allowsPoleExtension(VoltageLevel.KV_33, PoleMaterial.H_POLE))
        assertTrue(NetworkCatalog.allowsPoleExtension(VoltageLevel.KV_11, PoleMaterial.RAIL))
        assertTrue(NetworkCatalog.allowsPoleExtension(VoltageLevel.KV_11, PoleMaterial.PCC_9M))
        assertFalse(NetworkCatalog.allowsPoleExtension(VoltageLevel.KV_11, PoleMaterial.PCC_8M))
        assertFalse(NetworkCatalog.allowsPoleExtension(VoltageLevel.LT, PoleMaterial.PCC_8M))
        assertEquals(
            listOf(
                com.blackgrapes.slmtoolbox.domain.model.KitExtension.NO_EXT,
                com.blackgrapes.slmtoolbox.domain.model.KitExtension.WITH_EXT
            ),
            NetworkCatalog.kitExtensionsFor(VoltageLevel.KV_33, PoleMaterial.PCC_9M)
        )
        assertEquals(
            listOf(com.blackgrapes.slmtoolbox.domain.model.KitExtension.NO_EXT),
            NetworkCatalog.kitExtensionsFor(VoltageLevel.KV_11, PoleMaterial.PCC_8M)
        )
        assertTrue(NetworkCatalog.allowsGuardingWithoutExtension(PoleMaterial.H_POLE))
        assertTrue(NetworkCatalog.allowsGuardingWithoutExtension(PoleMaterial.RAIL))
        assertFalse(NetworkCatalog.allowsGuardingWithoutExtension(PoleMaterial.PCC_9M))
        assertTrue(
            NetworkCatalog.allowsGuardingChoice(
                PoleMaterial.RAIL,
                com.blackgrapes.slmtoolbox.domain.model.KitExtension.NO_EXT
            )
        )
        assertFalse(
            NetworkCatalog.allowsGuardingChoice(
                PoleMaterial.PCC_9M,
                com.blackgrapes.slmtoolbox.domain.model.KitExtension.NO_EXT
            )
        )
        assertTrue(
            NetworkCatalog.allowsGuardingChoice(
                PoleMaterial.PCC_9M,
                com.blackgrapes.slmtoolbox.domain.model.KitExtension.WITH_EXT
            )
        )
    }

    @Test
    fun ltPvcForces1PPhase() {
        assertEquals(listOf(PoleStructure.P1), NetworkCatalog.ltPhasesForConductor("PVC"))
        assertTrue(NetworkCatalog.isPvcConductor("PVC"))
    }

    @Test
    fun continueSpanGuidanceLimits() {
        assertEquals(
            40f,
            ContinueSpanGuidance.maxSpanM(VoltageLevel.LT, PoleMaterial.PCC_8M, "ABC")
        )
        assertEquals(
            null,
            ContinueSpanGuidance.maxSpanM(VoltageLevel.LT, PoleMaterial.PCC_8M, "50")
        )
        assertEquals(
            70f,
            ContinueSpanGuidance.maxSpanM(VoltageLevel.KV_11, PoleMaterial.PCC_9M, "100")
        )
        assertEquals(
            80f,
            ContinueSpanGuidance.maxSpanM(VoltageLevel.KV_11, PoleMaterial.RAIL, "100")
        )
        assertEquals(
            70f,
            ContinueSpanGuidance.maxSpanM(VoltageLevel.KV_33, PoleMaterial.PCC_9M, "150")
        )
        assertEquals(
            80f,
            ContinueSpanGuidance.maxSpanM(VoltageLevel.KV_33, PoleMaterial.RAIL, "200")
        )
        assertEquals(
            null,
            ContinueSpanGuidance.maxSpanM(VoltageLevel.KV_11, PoleMaterial.PCC_8M, "50")
        )
    }

    @Test
    fun ltDefaults() {
        assertEquals(listOf(PoleMaterial.PCC_8M), NetworkCatalog.materialsFor(VoltageLevel.LT))
        assertEquals(
            listOf(PoleStructure.P1, PoleStructure.P2, PoleStructure.P3),
            NetworkCatalog.structuresFor(VoltageLevel.LT)
        )
        assertEquals(PoleMaterial.PCC_8M, NetworkCatalog.defaultMaterial(VoltageLevel.LT))
        assertEquals(listOf("30", "50", "ABC", "PVC"), NetworkCatalog.conductorsFor(VoltageLevel.LT))
        assertTrue(NetworkCatalog.isAbcConductor("ABC"))
        assertFalse(NetworkCatalog.isAbcConductor("30"))
        assertEquals(
            listOf(PoleStructure.P1, PoleStructure.P2, PoleStructure.P3),
            NetworkCatalog.ltPhasesForConductor("50")
        )
        assertEquals(listOf(PoleStructure.P3), NetworkCatalog.ltPhasesForConductor("ABC"))
        assertEquals(1, NetworkCatalog.lineParallelCount(VoltageLevel.LT, "ABC", PoleStructure.P3))
        assertEquals(1, NetworkCatalog.lineParallelCount(VoltageLevel.LT, "30", PoleStructure.P3))
        assertEquals(1, NetworkCatalog.lineParallelCount(VoltageLevel.LT, "50", PoleStructure.P2))
        assertEquals("ABC", NetworkCatalog.ltLineTag(VoltageLevel.LT, "ABC", PoleStructure.P3))
        assertEquals("3Ph", NetworkCatalog.ltLineTag(VoltageLevel.LT, "30", PoleStructure.P3))
        assertEquals("2Ph", NetworkCatalog.ltLineTag(VoltageLevel.LT, "50", PoleStructure.P2))
        assertEquals("1Ph", NetworkCatalog.ltLineTag(VoltageLevel.LT, "30", PoleStructure.P1))
    }

    @Test
    fun dtrMapsToDtAssetType() {
        assertEquals(AssetType.DT, NetworkCatalog.assetTypeFor(PoleStructure.DTR))
        assertEquals(AssetType.POLE, NetworkCatalog.assetTypeFor(PoleStructure.P2))
    }

    @Test
    fun siteVerificationRules() {
        val now = 1_000_000L
        assertTrue(
            SiteVerification.isVerified(
                deviceLatitude = 28.0,
                deviceLongitude = 77.0,
                deviceAccuracyM = 10f,
                deviceFixTimestamp = now - 10_000L,
                distanceFromDeviceM = 20f,
                isMockLocation = false,
                now = now
            )
        )
        assertFalse(
            SiteVerification.isVerified(
                deviceLatitude = 28.0,
                deviceLongitude = 77.0,
                deviceAccuracyM = 10f,
                deviceFixTimestamp = now - 10_000L,
                distanceFromDeviceM = 20f,
                isMockLocation = true,
                now = now
            )
        )
        assertFalse(
            SiteVerification.isVerified(
                deviceLatitude = null,
                deviceLongitude = null,
                deviceAccuracyM = 10f,
                deviceFixTimestamp = now,
                distanceFromDeviceM = 5f,
                isMockLocation = false,
                now = now
            )
        )
    }
}
