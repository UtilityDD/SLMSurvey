package com.blackgrapes.slmtoolbox.domain

import org.junit.Assert.assertTrue
import org.junit.Test

class GeometryHitTestTest {

    @Test
    fun pointOnSegmentIsNear() {
        val distance = GeometryHitTest.distanceToSegmentM(
            lat = 28.001,
            lng = 77.0,
            aLat = 28.0,
            aLng = 77.0,
            bLat = 28.002,
            bLng = 77.0
        )
        assertTrue(distance < 5f)
    }

    @Test
    fun pointAwayFromSegmentIsFar() {
        val distance = GeometryHitTest.distanceToSegmentM(
            lat = 28.001,
            lng = 77.01,
            aLat = 28.0,
            aLng = 77.0,
            bLat = 28.002,
            bLng = 77.0
        )
        assertTrue(distance > 50f)
    }
}
