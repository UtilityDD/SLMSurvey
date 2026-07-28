package com.blackgrapes.slmtoolbox.estimate

import com.blackgrapes.slmtoolbox.domain.model.KitArrangement
import com.blackgrapes.slmtoolbox.domain.model.KitLocation
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import org.json.JSONObject

enum class EstimateLineKind { STRUCTURE, CONDUCTOR, GAP }

data class EstimateLine(
    val kind: EstimateLineKind,
    val title: String,
    val qty: Double,
    val unit: String,
    val kitId: String? = null,
    val detail: String? = null
)

data class EstimateReport(
    val catalogVersion: String,
    val hasCatalog: Boolean,
    val proposedPoles: Int,
    val readyPoles: Int,
    val matchedStructures: Int,
    val matchedConductorKm: Double,
    val lines: List<EstimateLine>,
    val gaps: List<EstimateLine>
) {
    val allRows: List<EstimateLine> get() = lines + gaps

    fun asShareText(): String = buildString {
        appendLine("SLM Auto-estimate")
        if (catalogVersion.isNotBlank()) appendLine("Catalog: $catalogVersion")
        appendLine("Proposed poles: $proposedPoles · ready: $readyPoles · matched: $matchedStructures")
        if (matchedConductorKm > 0) {
            appendLine("Conductor km matched: ${"%.3f".format(matchedConductorKm)}")
        }
        appendLine()
        if (lines.isNotEmpty()) {
            appendLine("BOQ")
            lines.forEach { row ->
                append("• ${row.title}: ${formatQty(row.qty)} ${row.unit}")
                if (!row.detail.isNullOrBlank()) append(" (${row.detail})")
                appendLine()
            }
            appendLine()
        }
        if (gaps.isNotEmpty()) {
            appendLine("Gaps (fix / desktop)")
            gaps.forEach { row ->
                appendLine("• ${row.title}")
                if (!row.detail.isNullOrBlank()) appendLine("  ${row.detail}")
            }
        }
    }

    private fun formatQty(q: Double): String =
        if (q == q.toLong().toDouble()) q.toLong().toString() else "%.3f".format(q)
}

/**
 * Matches Proposed survey poles/spans to enabled kits from the published catalog.
 * Prefers Final (complete); Draft kits are allowed for field-check estimates.
 */
object EstimateMatcher {

    private fun emptyCatalogReport(survey: Survey, catalogVersion: String) = EstimateReport(
        catalogVersion = catalogVersion,
        hasCatalog = false,
        proposedPoles = survey.assets.count { it.status == WorkStatus.PROPOSED },
        readyPoles = 0,
        matchedStructures = 0,
        matchedConductorKm = 0.0,
        lines = emptyList(),
        gaps = listOf(
            EstimateLine(
                kind = EstimateLineKind.GAP,
                title = "No estimate catalog on this phone",
                qty = 0.0,
                unit = "",
                detail = "Activate license and sync catalog, then Publish kits from desktop."
            )
        )
    )

    fun build(
        survey: Survey,
        matrix: JSONObject?,
        edits: JSONObject?,
        catalogVersion: String
    ): EstimateReport {
        if (matrix == null) {
            return emptyCatalogReport(survey, catalogVersion)
        }
        return build(survey, CatalogKitStore.loadMerged(matrix, edits), catalogVersion, hasCatalog = true)
    }

    fun build(
        survey: Survey,
        kits: List<CatalogKit>,
        catalogVersion: String,
        hasCatalog: Boolean = true
    ): EstimateReport {
        if (!hasCatalog) {
            return emptyCatalogReport(survey, catalogVersion)
        }

        val structures = kits.filter { it.family == "structure" && it.enabled }
        val conductors = kits.filter { it.family == "conductor" && it.enabled }

        val proposed = survey.assets.filter { it.status == WorkStatus.PROPOSED }
        val gaps = mutableListOf<EstimateLine>()
        val structureHits = mutableListOf<Pair<CatalogKit, SurveyAsset>>()

        for (pole in proposed.sortedBy { it.sequence }) {
            if (!pole.isEstimateReady()) {
                gaps += EstimateLine(
                    kind = EstimateLineKind.GAP,
                    title = "Pole #${pole.sequence}: needs kit details",
                    qty = 1.0,
                    unit = "pole",
                    detail = "${pole.voltage.label} · ${pole.structure ?: "?"} · ${pole.conductor ?: "?"}"
                )
                continue
            }
            val hit = findStructureKit(pole, structures, finalOnly = false)
            if (hit != null) {
                structureHits += hit to pole
                continue
            }
            gaps += EstimateLine(
                kind = EstimateLineKind.GAP,
                title = "Pole #${pole.sequence}: no matching kit",
                qty = 1.0,
                unit = "pole",
                detail = describePole(pole)
            )
        }

        // Aggregate structure kits by id
        val structureQty = linkedMapOf<String, Pair<CatalogKit, Int>>()
        for ((kit, _) in structureHits) {
            val prev = structureQty[kit.id]
            structureQty[kit.id] = kit to ((prev?.second ?: 0) + 1)
        }
        val structureLines = structureQty.values.map { (kit, n) ->
            EstimateLine(
                kind = EstimateLineKind.STRUCTURE,
                title = kit.displayTitle(),
                qty = n.toDouble(),
                unit = "nos",
                kitId = kit.id,
                detail = if (kit.complete) null else "Draft kit"
            )
        }

        // Conductor km from Proposed spans
        val assetsById = survey.assets.associateBy { it.id }
        val spanGroups = linkedMapOf<String, MutableList<SurveyConnection>>()
        for (conn in survey.connections) {
            if (conn.status != WorkStatus.PROPOSED) continue
            val to = assetsById[conn.toAssetId] ?: continue
            if (to.status != WorkStatus.PROPOSED) continue
            val key = "${to.voltage.label}|${to.conductor}|${to.kitWire ?: "cable"}"
            spanGroups.getOrPut(key) { mutableListOf() }.add(conn)
        }

        val conductorLines = mutableListOf<EstimateLine>()
        var matchedKm = 0.0
        for ((key, conns) in spanGroups) {
            val sample = assetsById[conns.first().toAssetId] ?: continue
            val metres = conns.sumOf { it.spanLengthM?.toDoubleOrNull() ?: 0.0 }
            if (metres <= 0.0) {
                gaps += EstimateLine(
                    kind = EstimateLineKind.GAP,
                    title = "Span length missing for ${sample.voltage.label} ${sample.conductor}",
                    qty = conns.size.toDouble(),
                    unit = "spans",
                    detail = key
                )
                continue
            }
            val km = metres / 1000.0
            val hit = findConductorKit(sample, conductors, finalOnly = false)
            if (hit != null) {
                matchedKm += km
                conductorLines += EstimateLine(
                    kind = EstimateLineKind.CONDUCTOR,
                    title = hit.displayTitle(),
                    qty = km,
                    unit = "km",
                    kitId = hit.id,
                    detail = "${"%.0f".format(metres)} m · ${conns.size} span(s)" +
                        if (hit.complete) "" else " · Draft kit"
                )
                continue
            }
            gaps += EstimateLine(
                kind = EstimateLineKind.GAP,
                title = "Conductor ${sample.voltage.label} ${sample.conductor}: no matching kit",
                qty = km,
                unit = "km",
                detail = key
            )
        }

        // Merge conductor lines with same kit id
        val condAgg = linkedMapOf<String, EstimateLine>()
        for (line in conductorLines) {
            val id = line.kitId ?: continue
            val prev = condAgg[id]
            condAgg[id] = if (prev == null) {
                line
            } else {
                prev.copy(
                    qty = prev.qty + line.qty,
                    detail = listOfNotNull(prev.detail, line.detail).joinToString(" · ")
                )
            }
        }

        return EstimateReport(
            catalogVersion = catalogVersion,
            hasCatalog = true,
            proposedPoles = proposed.size,
            readyPoles = proposed.count { it.isEstimateReady() },
            matchedStructures = structureHits.size,
            matchedConductorKm = matchedKm,
            lines = structureLines + condAgg.values.toList(),
            gaps = gaps
        )
    }

    private fun describePole(pole: SurveyAsset): String =
        listOfNotNull(
            pole.voltage.label,
            pole.structure,
            pole.kitLocation,
            pole.kitArrangement,
            pole.kitExtension,
            pole.conductor,
            pole.kitWire,
            pole.dtrMount?.let { "DTR $it" },
            pole.dtCapacityKva?.let { "${it}kVA" }
        ).joinToString(" · ")

    private fun findStructureKit(
        pole: SurveyAsset,
        kits: List<CatalogKit>,
        finalOnly: Boolean
    ): CatalogKit? {
        val voltage = pole.voltage.label
        val structureKey = structureKeyFor(pole) ?: return null
        val location = pole.kitLocationEnum?.label ?: return null
        val extension = pole.kitExtensionEnum?.id ?: return null
        val arrangementId = if (pole.kitLocationEnum == KitLocation.DEAD_END) {
            null
        } else {
            pole.kitArrangementEnum?.id
        }
        val candidates = kits.asSequence()
            .filter { it.voltage == voltage }
            .filter { !finalOnly || it.complete }
            .filter { structureMatches(it, structureKey, pole) }
            .filter { it.location == location }
            .filter { extensionMatches(it.extension, extension) }
            .filter { arrangementMatches(it.arrangement, arrangementId, pole.kitLocationEnum) }
            .filter { wireMatches(it, pole) }
            .filter { conductorMatchesStructure(it, pole) }
            .filter { dtrCapacityMatches(it, pole) }
            .toList()
        return candidates.firstOrNull { it.complete } ?: candidates.firstOrNull()
    }

    private fun findConductorKit(
        sample: SurveyAsset,
        kits: List<CatalogKit>,
        finalOnly: Boolean
    ): CatalogKit? {
        val voltage = sample.voltage.label
        val tag = sample.conductor
        if (ConductorTagMap.isCableTag(tag)) {
            val wantFam = ConductorTagMap.conductorFamily(tag) // ABC or PVC
            val familyKits = kits.filter {
                it.voltage == voltage &&
                    (!finalOnly || it.complete) &&
                    (
                        it.conductorFamily == wantFam ||
                            (wantFam != null && it.conductorId?.contains(wantFam) == true)
                    )
            }
            val finals = familyKits.filter { it.complete }
            if (finals.isNotEmpty()) return finals.first()
            if (finalOnly) return null
            return familyKits.firstOrNull()
        }
        val sized = ConductorTagMap.sizedConductorIds(sample.voltage, tag)
        if (sized.isEmpty()) return null
        val wire = sample.kitWire
        val candidates = kits.filter { kit ->
            kit.voltage == voltage &&
                (!finalOnly || kit.complete) &&
                kit.conductorId in sized &&
                wireMatchesConductor(kit, wire)
        }
        return candidates.firstOrNull { it.complete } ?: candidates.firstOrNull()
    }

    private fun structureKeyFor(pole: SurveyAsset): String? {
        val st = pole.poleStructure ?: return null
        if (st == PoleStructure.DTR) {
            val mount = pole.dtrMountEnum?.id ?: return null
            return "DTR$mount"
        }
        // LT phase chips map to wire, not HT structure — kits use 1P
        if (pole.voltage == VoltageLevel.LT) {
            return if (st == PoleStructure.P1N) "1P" else "1P"
        }
        return st.label
    }

    private fun structureMatches(kit: CatalogKit, structureKey: String, pole: SurveyAsset): Boolean {
        if (kit.structure == structureKey) return true
        if (pole.poleStructure == PoleStructure.DTR && kit.isDtr) {
            return kit.dtrMount == pole.dtrMountEnum?.id
        }
        return false
    }

    private fun extensionMatches(kitExt: String?, want: String): Boolean =
        kitExt.equals(want, ignoreCase = true)

    private fun arrangementMatches(
        kitArr: String?,
        wantId: String?,
        location: KitLocation?
    ): Boolean {
        if (location == KitLocation.DEAD_END) {
            return kitArr.isNullOrBlank()
        }
        if (wantId == null) return false
        return kitArr.equals(wantId, ignoreCase = true) ||
            KitArrangement.fromLabel(kitArr)?.id == wantId
    }

    private fun wireMatches(kit: CatalogKit, pole: SurveyAsset): Boolean {
        val want = pole.kitWire
        val cable = ConductorTagMap.isCableTag(pole.conductor)
        if (cable) {
            return kit.wireCount.isNullOrBlank() ||
                kit.wireLabel.equals("cable", ignoreCase = true) ||
                kit.conductorFamily == "ABC" ||
                kit.conductorFamily == "PVC"
        }
        if (want.isNullOrBlank()) return kit.wireCount.isNullOrBlank()
        return kit.wireCount.equals(want, ignoreCase = true)
    }

    private fun wireMatchesConductor(kit: CatalogKit, want: String?): Boolean {
        if (want.isNullOrBlank()) {
            return kit.wireCount.isNullOrBlank() ||
                kit.wireLabel.equals("cable", ignoreCase = true)
        }
        return kit.wireCount.equals(want, ignoreCase = true)
    }

    private fun conductorMatchesStructure(kit: CatalogKit, pole: SurveyAsset): Boolean {
        val tag = pole.conductor
        if (kit.conductorSizeAgnostic) {
            val family = ConductorTagMap.conductorFamily(tag) ?: return false
            return kit.conductorFamily.equals(family, ignoreCase = true) ||
                kit.conductorId?.contains("|$family") == true ||
                ConductorTagMap.agnosticConductorIds(pole.voltage, tag).any { it == kit.conductorId }
        }
        val sized = ConductorTagMap.sizedConductorIds(pole.voltage, tag)
        val agnostic = ConductorTagMap.agnosticConductorIds(pole.voltage, tag)
        return kit.conductorId in sized || kit.conductorId in agnostic
    }

    private fun dtrCapacityMatches(kit: CatalogKit, pole: SurveyAsset): Boolean {
        if (pole.poleStructure != PoleStructure.DTR) return true
        if (!kit.isDtr) return true
        // LT DTR T-Off kits have no capacity dimension
        if (kit.dtrCapacity.isNullOrBlank()) return true
        val want = normalizeKva(pole.dtCapacityKva) ?: return false
        return normalizeKva(kit.dtrCapacity) == want
    }

    private fun normalizeKva(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val digits = raw.filter { it.isDigit() }
        return digits.takeIf { it.isNotBlank() }
    }
}
