package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FieldRulesTest {

    @Test
    fun poleShowsStructuralAndConductorFields() {
        val fields = FieldRules.visibleFields(AssetType.POLE)
        assertTrue(AssetField.POLE_MATERIAL in fields)
        assertTrue(AssetField.POLE_HEIGHT in fields)
        assertTrue(AssetField.CONDUCTOR in fields)
        assertTrue(AssetField.SPAN_LENGTH in fields)
        assertFalse(AssetField.DT_CAPACITY in fields)
    }

    @Test
    fun dtShowsCapacityNotPoleHeight() {
        val fields = FieldRules.visibleFields(AssetType.DT)
        assertTrue(AssetField.DT_CAPACITY in fields)
        assertFalse(AssetField.POLE_HEIGHT in fields)
    }

    @Test
    fun noteOnlyShowsRemarks() {
        val fields = FieldRules.visibleFields(AssetType.NOTE)
        assertTrue(fields == setOf(AssetField.REMARKS))
    }

    @Test
    fun connectableTypes() {
        assertTrue(FieldRules.canConnect(AssetType.POLE))
        assertTrue(FieldRules.canConnect(AssetType.DT))
        assertFalse(FieldRules.canConnect(AssetType.NOTE))
        assertFalse(FieldRules.canConnect(AssetType.STAY))
    }
}
