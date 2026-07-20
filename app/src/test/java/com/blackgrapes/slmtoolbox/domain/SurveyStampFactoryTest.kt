package com.blackgrapes.slmtoolbox.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class SurveyStampFactoryTest {

    @Test
    fun roundsCoordinatesToThreeDecimals() {
        assertEquals(28.614, SurveyStampFactory.roundTo3(28.6139), 0.0001)
        assertEquals(77.209, SurveyStampFactory.roundTo3(77.20901), 0.0001)
    }
}
