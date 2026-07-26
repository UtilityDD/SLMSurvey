package com.blackgrapes.slmtoolbox.estimate

import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EstimateMatcherTest {

    @Test
    fun matchesFinalStructureAndConductor() {
        val kits = listOf(
            CatalogKit(
                id = "STR|11kV|1P|Tangent|InlineArr|ACSR|Weasel|30|3W|NoExt",
                family = "structure",
                voltage = "11kV",
                structure = "1P",
                structureLabel = "1P",
                location = "Tangent",
                arrangement = "InlineArr",
                arrangementLabel = "In-line",
                extension = "NoExt",
                extensionLabel = "No ext",
                conductorId = "ACSR|Weasel|30",
                conductorShort = "Weasel 30",
                conductorName = "Weasel 30",
                conductorFamily = "ACSR",
                conductorSizeAgnostic = false,
                wireCount = "3W",
                wireLabel = "3 wire",
                isDtr = false,
                dtrMount = null,
                dtrCapacity = null,
                qtyBasis = "per_structure",
                enabled = true,
                complete = true,
                lineCount = 0,
                notes = ""
            ),
            CatalogKit(
                id = "CON|11kV|ACSR|Weasel|30|3W",
                family = "conductor",
                voltage = "11kV",
                structure = null,
                structureLabel = null,
                location = null,
                arrangement = null,
                arrangementLabel = null,
                extension = null,
                extensionLabel = null,
                conductorId = "ACSR|Weasel|30",
                conductorShort = "Weasel 30",
                conductorName = "Weasel 30",
                conductorFamily = "ACSR",
                conductorSizeAgnostic = false,
                wireCount = "3W",
                wireLabel = "3 wire",
                isDtr = false,
                dtrMount = null,
                dtrCapacity = null,
                qtyBasis = "per_km",
                enabled = true,
                complete = true,
                lineCount = 0,
                notes = ""
            )
        )

        val poleA = pole(
            id = 1,
            sequence = 1,
            role = PoleRole.START,
            kitLocation = "Tangent",
            kitArrangement = "In-line",
            kitExtension = "No ext",
            kitWire = "3W"
        )
        val poleB = pole(
            id = 2,
            sequence = 2,
            role = PoleRole.END,
            kitLocation = "Dead-end",
            kitArrangement = null,
            kitExtension = "No ext",
            kitWire = "3W"
        )
        val survey = Survey(
            id = 1,
            title = "t",
            assets = listOf(poleA, poleB),
            connections = listOf(
                SurveyConnection(
                    id = 1,
                    surveyId = 1,
                    fromAssetId = 1,
                    toAssetId = 2,
                    voltage = VoltageLevel.KV_11,
                    status = WorkStatus.PROPOSED,
                    spanLengthM = "500"
                )
            )
        )

        val report = EstimateMatcher.build(survey, kits, "v-test")
        assertEquals(2, report.proposedPoles)
        assertEquals(1, report.matchedStructures)
        assertEquals(1, report.lines.count { it.kind == EstimateLineKind.STRUCTURE })
        assertEquals(1, report.lines.count { it.kind == EstimateLineKind.CONDUCTOR })
        assertEquals(0.5, report.matchedConductorKm, 0.001)
        assertTrue(report.gaps.any { it.title.contains("Pole #2") })
    }

    @Test
    fun reportsMissingCatalog() {
        val survey = Survey(id = 1, title = "t")
        val report = EstimateMatcher.build(survey, null, null, "")
        assertTrue(report.gaps.isNotEmpty())
        assertTrue(!report.hasCatalog)
    }

    private fun pole(
        id: Long,
        sequence: Int,
        role: PoleRole,
        kitLocation: String?,
        kitArrangement: String?,
        kitExtension: String?,
        kitWire: String?
    ) = SurveyAsset(
        id = id,
        surveyId = 1,
        sequence = sequence,
        latitude = 0.0,
        longitude = 0.0,
        voltage = VoltageLevel.KV_11,
        status = WorkStatus.PROPOSED,
        type = AssetType.POLE,
        poleRole = role,
        poleMaterial = "8m PCC",
        conductor = "30",
        structure = "1P",
        seriesId = 99L,
        kitLocation = kitLocation,
        kitArrangement = kitArrangement,
        kitExtension = kitExtension,
        kitWire = kitWire
    )
}
