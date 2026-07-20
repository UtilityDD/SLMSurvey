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
    fun kv11CatalogIncludesDtr() {
        assertTrue(PoleStructure.DTR in NetworkCatalog.structuresFor(VoltageLevel.KV_11))
        assertEquals(
            listOf("30", "50", "100", "ABC"),
            NetworkCatalog.conductorsFor(VoltageLevel.KV_11)
        )
    }

    @Test
    fun ltDefaults() {
        assertEquals(listOf(PoleMaterial.PCC_8M), NetworkCatalog.materialsFor(VoltageLevel.LT))
        assertEquals(listOf(PoleStructure.P1), NetworkCatalog.structuresFor(VoltageLevel.LT))
        assertEquals(PoleMaterial.PCC_8M, NetworkCatalog.defaultMaterial(VoltageLevel.LT))
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
