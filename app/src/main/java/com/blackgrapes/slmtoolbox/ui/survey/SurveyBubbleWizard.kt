package com.blackgrapes.slmtoolbox.ui.survey

import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import androidx.core.os.bundleOf
import androidx.core.view.isVisible
import androidx.fragment.app.DialogFragment
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.databinding.DialogSurveyBubbleBinding
import com.blackgrapes.slmtoolbox.domain.NetworkCatalog
import com.blackgrapes.slmtoolbox.domain.PlacementDraft
import com.blackgrapes.slmtoolbox.domain.SeriesConfig
import com.blackgrapes.slmtoolbox.domain.PresetPreferences
import com.blackgrapes.slmtoolbox.domain.PostExecPreferences
import com.blackgrapes.slmtoolbox.domain.model.DtrMount
import com.blackgrapes.slmtoolbox.domain.model.KitArrangement
import com.blackgrapes.slmtoolbox.domain.model.KitExtension
import com.blackgrapes.slmtoolbox.domain.model.KitLocation
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import com.google.android.material.chip.Chip

class SurveyBubbleWizard : DialogFragment() {

    private var _binding: DialogSurveyBubbleBinding? = null
    private val binding get() = _binding!!

    private var latitude = 0.0
    private var longitude = 0.0
    private var mode: Mode = Mode.NEW_NETWORK
    private var lockedSeries: SeriesConfig? = null
    private var sourceAssetId: Long? = null
    private var splitConnectionId: Long? = null
    private var editing: SurveyAsset? = null
    private var candidatePoles: List<SurveyAsset> = emptyList()

    private var stepStack = ArrayDeque<Step>()
    private var voltage: VoltageLevel? = null
    private var status: WorkStatus? = null
    private var material: PoleMaterial? = null
    private var structure: PoleStructure? = null
    private var conductor: String? = null
    private var wantTapping: Boolean? = null
    private var feederName: String? = null
    private var sourceSubstation: String? = null
    private var dtCapacityKva: String? = null
    private var remarks: String? = null
    private var kitLocation: KitLocation? = null
    private var kitArrangement: KitArrangement? = null
    private var kitExtension: KitExtension? = null
    private var dtrMount: DtrMount? = null
    /** null = not asked yet; only meaningful when With-ext. */
    private var guarding: Boolean? = null
    private var tipKitLocation: KitLocation? = null
    private var tipKitArrangement: KitArrangement? = null
    private var tipKitExtension: KitExtension? = null
    private var tipDtrMount: DtrMount? = null
    /** Preferred material when inserting on a line (from adjacent poles). */
    private var preferredMaterial: PoleMaterial? = null
    /** True when tapping from a DTR — allow 11kV or LT. */
    private var sourceIsDtr: Boolean = false
    /** When true, kit steps save edit and dismiss (no place role). */
    private var editingKitOnly: Boolean = false
    private var showAllDtrCapacities: Boolean = false
    /** Set when Place was already chosen (e.g. preset) — finish after kit confirm. */
    private var pendingPlaceRole: PoleRole? = null
    /** Tip pole structure when continuing (detect first span after DTR). */
    private var tipStructure: PoleStructure? = null
    /** When branching from an existing network, voltage is a line property and cannot change. */
    private var voltageLocked: Boolean = false
    /** Line voltage/status for mid-span insert (NEAR_LINE). */
    private var lineVoltage: VoltageLevel? = null
    private var lineStatus: WorkStatus? = null
    /** Status of the pole we are tapping from (locks continue status when Proposed). */
    private var sourcePoleStatus: WorkStatus? = null
    /** Skip the redundant "Action near line" menu and go straight to insert steps. */
    private var directInsert: Boolean = false

    var onPlace: ((PlacementDraft) -> Unit)? = null
    var onEdit: ((SurveyAsset) -> Unit)? = null
    var onDelete: ((SurveyAsset) -> Unit)? = null
    var onSelectSource: ((SurveyAsset) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setStyle(STYLE_NO_FRAME, theme)
        latitude = requireArguments().getDouble(ARG_LAT)
        longitude = requireArguments().getDouble(ARG_LNG)
        mode = Mode.valueOf(requireArguments().getString(ARG_MODE) ?: Mode.NEW_NETWORK.name)
        editing = requireArguments().getParcelableCompat(ARG_ASSET)
        sourceAssetId = requireArguments().getLong(ARG_SOURCE_ID, -1L).takeIf { it > 0 }
        splitConnectionId = requireArguments().getLong(ARG_SPLIT_ID, -1L).takeIf { it > 0 }
        voltageLocked = requireArguments().getBoolean(ARG_VOLTAGE_LOCKED, false)
        feederName = requireArguments().getString(ARG_FEEDER_NAME)?.takeIf { it.isNotBlank() }
        sourceSubstation = requireArguments().getString(ARG_SOURCE_SS)?.takeIf { it.isNotBlank() }
        requireArguments().getString(ARG_LINE_VOLTAGE)?.let { lineVoltage = VoltageLevel.fromLabel(it) }
        requireArguments().getString(ARG_LINE_STATUS)?.let { lineStatus = WorkStatus.fromLabel(it) }
        requireArguments().getString(ARG_SOURCE_STATUS)?.let { sourcePoleStatus = WorkStatus.fromLabel(it) }
        directInsert = requireArguments().getBoolean(ARG_DIRECT_INSERT, false)
        tipKitLocation = KitLocation.fromLabel(requireArguments().getString(ARG_TIP_KIT_LOCATION))
        tipKitArrangement = KitArrangement.fromLabel(requireArguments().getString(ARG_TIP_KIT_ARRANGEMENT))
        tipKitExtension = KitExtension.fromLabel(requireArguments().getString(ARG_TIP_KIT_EXTENSION))
        tipDtrMount = DtrMount.fromLabel(requireArguments().getString(ARG_TIP_DTR_MOUNT))
        preferredMaterial = PoleMaterial.fromLabel(
            requireArguments().getString(ARG_PREFERRED_MATERIAL)
        )
        sourceIsDtr = requireArguments().getBoolean(ARG_SOURCE_IS_DTR, false)
        val lockedVoltage = requireArguments().getString(ARG_LOCKED_VOLTAGE)
        val lockedStatus = requireArguments().getString(ARG_LOCKED_STATUS)
        val lockedMaterial = requireArguments().getString(ARG_LOCKED_MATERIAL)
        val lockedConductor = requireArguments().getString(ARG_LOCKED_CONDUCTOR)
        val lockedSeriesId = requireArguments().getLong(ARG_LOCKED_SERIES, -1L)
        val lockedStartStructure = requireArguments().getString(ARG_LOCKED_START_STRUCTURE)
            ?.let { PoleStructure.fromLabel(it) }
        if (
            lockedVoltage != null &&
            lockedStatus != null &&
            lockedMaterial != null &&
            lockedConductor != null &&
            lockedSeriesId > 0
        ) {
            lockedSeries = SeriesConfig(
                seriesId = lockedSeriesId,
                voltage = VoltageLevel.fromLabel(lockedVoltage),
                status = WorkStatus.fromLabel(lockedStatus),
                material = PoleMaterial.fromLabel(lockedMaterial)!!,
                conductor = lockedConductor,
                startStructure = lockedStartStructure
            )
        }
        candidatePoles = requireArguments().getParcelableArrayListCompat(ARG_CANDIDATES).orEmpty()
        tipStructure = requireArguments().getString(ARG_TIP_STRUCTURE)
            ?.let { PoleStructure.fromLabel(it) }
        // Prefill locked voltage for tapping-from-existing (passed as ARG_LOCKED_VOLTAGE alone).
        if (mode == Mode.TAPPING_BRANCH && lockedVoltage != null && lockedSeries == null) {
            voltage = VoltageLevel.fromLabel(lockedVoltage)
            voltageLocked = true
        }
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val dialog = super.onCreateDialog(savedInstanceState)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        return dialog
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.setLayout(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT
        )
        updateModalHeight()
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogSurveyBubbleBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.btnCloseBubble.setOnClickListener { dismiss() }
        binding.btnBubbleBack.setOnClickListener { goBack() }
        binding.root.setOnClickListener { dismiss() }
        binding.bubbleCard.setOnClickListener { /* consume */ }
        startFlow()
    }

    private fun startFlow() {
        stepStack.clear()
        when {
            editing != null -> {
                voltage = editing!!.voltage
                status = editing!!.status
                material = editing!!.material
                structure = editing!!.poleStructure
                conductor = editing!!.conductor
                kitLocation = editing!!.kitLocationEnum
                kitArrangement = editing!!.kitArrangementEnum
                kitExtension = editing!!.kitExtensionEnum
                dtrMount = editing!!.dtrMountEnum
                dtCapacityKva = editing!!.dtCapacityKva
                guarding = editing!!.guarding
                push(Step.EDIT_MENU)
            }
            mode == Mode.NEAR_LINE && directInsert -> {
                // Chosen "Insert on line" already — skip second menu; ask Existing/Proposed next.
                voltage = lineVoltage
                    ?: candidatePoles.firstOrNull()?.voltage
                    ?: VoltageLevel.KV_11
                voltageLocked = true
                push(Step.STATUS)
            }
            mode == Mode.NEAR_LINE -> push(Step.LINE_ACTION_CHOICE)
            lockedSeries != null -> {
                val series = lockedSeries!!
                val ltConv = PostExecPreferences.isLtConversionAbc(requireContext())
                val afterDtr = series.startStructure == PoleStructure.DTR &&
                    (tipStructure == PoleStructure.DTR || tipStructure == null && series.startStructure == PoleStructure.DTR)
                val dtrLtContinue = series.startStructure == PoleStructure.DTR &&
                    (ltConv || PresetPreferences.isDtrLt(requireContext()))
                if (ltConv && dtrLtContinue) {
                    voltage = VoltageLevel.LT
                    status = if (mode == Mode.TAPPING_BRANCH) {
                        WorkStatus.EXISTING
                    } else {
                        series.status
                    }
                    material = PoleMaterial.PCC_8M
                    if (tipStructure == PoleStructure.DTR) {
                        push(Step.LT_CONV_FIRST_SPAN)
                    } else {
                        conductor = "ABC"
                        push(Step.LT_CONV_POLE_KIND)
                    }
                } else if (dtrLtContinue) {
                    val preset = PresetPreferences.get(requireContext())
                    val (v, _, m) = preset.continueAfterDtr()
                    voltage = v
                    status = series.status
                    material = m
                    conductor = preset.continueAfterDtrConductor()
                    if (NetworkCatalog.isAbcConductor(conductor)) {
                        structure = PoleStructure.P3
                        advanceToKitOrPlace()
                    } else {
                        structure = null
                        push(Step.STRUCTURE)
                    }
                } else {
                    voltage = series.voltage
                    status = series.status
                    material = series.material
                    conductor = series.conductor
                    if (series.voltage == VoltageLevel.LT) {
                        if (NetworkCatalog.isAbcConductor(series.conductor)) {
                            structure = PoleStructure.P3
                            advanceToKitOrPlace()
                        } else {
                            // LT phase chosen on pole review
                            structure = tipStructure?.takeIf {
                                it in NetworkCatalog.ltPhasesForConductor(series.conductor)
                            }
                            advanceToKitOrPlace()
                        }
                    } else {
                        structure = tipStructure?.takeIf {
                            it in NetworkCatalog.structuresFor(series.voltage)
                        } ?: NetworkCatalog.defaultStructure(series.voltage)
                        advanceToKitOrPlace()
                    }
                }
            }
            mode == Mode.TAPPING_BRANCH -> {
                voltage = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
                // Non-DTR taps lock voltage; DTR taps choose 11kV or LT after status.
                voltageLocked = !sourceIsDtr
                if (PostExecPreferences.isLtConversionAbc(requireContext())) {
                    status = WorkStatus.EXISTING
                    voltage = VoltageLevel.LT
                    material = PoleMaterial.PCC_8M
                    conductor = "ABC"
                    push(Step.LT_CONV_POLE_KIND)
                } else if (sourcePoleStatus == WorkStatus.PROPOSED) {
                    status = WorkStatus.PROPOSED
                    if (sourceIsDtr) {
                        push(Step.DTR_BRANCH_VOLTAGE)
                    } else {
                        advanceAfterStatusChoice()
                    }
                } else {
                    push(Step.STATUS)
                }
            }
            PostExecPreferences.isLtConversionAbc(requireContext()) &&
                editing == null &&
                mode == Mode.NEW_NETWORK -> {
                push(Step.LT_CONV_START_DTR)
            }
            PresetPreferences.isEnabled(requireContext()) && editing == null && mode == Mode.NEW_NETWORK -> {
                applyPresetForNewNetwork()
                push(Step.PRESET_SUMMARY)
            }
            else -> push(Step.VOLTAGE)
        }
        render()
    }

    private fun push(step: Step) {
        stepStack.addLast(step)
    }

    private fun goBack() {
        if (stepStack.size <= 1) {
            dismiss()
            return
        }
        stepStack.removeLast()
        render()
    }

    private fun render() {
        val step = stepStack.lastOrNull() ?: return
        clearProceedError()
        binding.btnBubbleBack.isVisible = stepStack.size > 1
        binding.bubbleChoices.removeAllViews()
        binding.poleReviewRows.removeAllViews()
        showPoleReview(false)
        showFeederInputs(step == Step.FEEDER_INFO)
        when (step) {
            Step.LINE_ACTION_CHOICE -> {
                binding.bubbleTitle.text = getString(R.string.bubble_near_line_title)
                binding.bubbleSubtitle.text = getString(R.string.bubble_near_line_hint)

                // Option 1: Insert joint into line — voltage locked; always ask Existing/Proposed
                addChoice(getString(R.string.choice_split_line)) {
                    voltage = lineVoltage
                        ?: candidatePoles.firstOrNull()?.voltage
                        ?: VoltageLevel.KV_11
                    status = null
                    voltageLocked = true
                    push(Step.STATUS)
                    render()
                }

                // Option 2: Branch from an endpoint pole (voltage locked; always ask Existing/Proposed)
                candidatePoles.forEach { pole ->
                    addChoice(getString(R.string.choice_tap_from, pole.sequence)) {
                        beginBranchFrom(pole)
                        render()
                    }
                }

                // Option 3: New network
                addChoice(getString(R.string.choice_new_network)) {
                    mode = Mode.NEW_NETWORK
                    splitConnectionId = null
                    sourceAssetId = null
                    voltageLocked = false
                    if (PresetPreferences.isEnabled(requireContext())) {
                        applyPresetForNewNetwork()
                        push(Step.PRESET_SUMMARY)
                    } else {
                        push(Step.VOLTAGE)
                    }
                    render()
                }
            }
            Step.VOLTAGE -> {
                binding.bubbleTitle.text = getString(R.string.bubble_voltage)
                binding.bubbleSubtitle.text = getString(R.string.bubble_hint_new)
                VoltageLevel.entries.forEach { option ->
                    addChoice(option.label) {
                        voltage = option
                        push(Step.STATUS)
                        render()
                    }
                }
            }
            Step.STATUS -> {
                // Continue series must never re-ask status — inherit from previous pole.
                if (mode == Mode.CONTINUE_SERIES || lockedSeries != null) {
                    status = lockedSeries?.status ?: status ?: WorkStatus.PROPOSED
                    advanceAfterStatusChoice()
                    render()
                    return
                }
                binding.bubbleTitle.text = getString(R.string.bubble_status, voltage!!.label)
                binding.bubbleSubtitle.text = when {
                    splitConnectionId != null ->
                        getString(R.string.bubble_status_insert_hint)
                    voltageLocked || mode == Mode.TAPPING_BRANCH ->
                        getString(R.string.bubble_status_branch_hint)
                    else ->
                        getString(R.string.bubble_status_hint)
                }
                WorkStatus.entries.forEach { option ->
                    addChoice(option.label) {
                        status = option
                        if (mode == Mode.TAPPING_BRANCH && sourceIsDtr) {
                            push(Step.DTR_BRANCH_VOLTAGE)
                        } else {
                            advanceAfterStatusChoice()
                        }
                        render()
                    }
                }
            }
            Step.DTR_BRANCH_VOLTAGE -> {
                binding.bubbleTitle.text = getString(R.string.bubble_dtr_branch_voltage)
                binding.bubbleSubtitle.text = getString(R.string.bubble_dtr_branch_voltage_hint)
                listOf(VoltageLevel.KV_11, VoltageLevel.LT).forEach { option ->
                    addChoice(option.label, highlighted = voltage == option) {
                        voltage = option
                        voltageLocked = true
                        material = null
                        structure = null
                        conductor = null
                        advanceAfterStatusChoice()
                        render()
                    }
                }
            }
            Step.MATERIAL -> {
                // Legacy step — always fold into the compact review modal.
                material = material ?: preferredMaterial ?: NetworkCatalog.defaultMaterial(
                    voltage ?: VoltageLevel.KV_11
                )
                advanceToKitOrPlace()
                render()
            }
            Step.STRUCTURE -> {
                // If we somehow land here during place flow, fold into review.
                if (editing == null && status == WorkStatus.PROPOSED) {
                    advanceToKitOrPlace()
                    render()
                    return
                }
                val v = voltage ?: lockedSeries!!.voltage
                val isLtPhase = v == VoltageLevel.LT
                binding.bubbleTitle.text = if (isLtPhase) {
                    getString(R.string.bubble_lt_phase)
                } else {
                    getString(R.string.bubble_structure)
                }
                binding.bubbleSubtitle.text = if (isLtPhase) {
                    getString(R.string.bubble_lt_phase_hint, conductor ?: "")
                } else {
                    buildString {
                        append(voltage?.label ?: lockedSeries?.voltage?.label)
                        append(" · ")
                        append(status?.label ?: lockedSeries?.status?.label)
                    }
                }
                structureOptionsForCurrent().forEach { option ->
                    addChoice(structureLabel(option), highlighted = option == structure) {
                        structure = option
                        if (stepStack.contains(Step.POLE_REVIEW)) {
                            returnToPoleReview()
                        } else if (editing != null) {
                            // Edit structure only — keep old path short
                            advanceToKitOrPlace()
                            render()
                        } else {
                            advanceToKitOrPlace()
                            render()
                        }
                    }
                }
            }
            Step.CONDUCTOR -> {
                // Legacy step — fold into compact review.
                if (conductor.isNullOrBlank()) {
                    val v = voltage ?: VoltageLevel.KV_11
                    conductor = NetworkCatalog.conductorsFor(v).first()
                }
                advanceToKitOrPlace()
                render()
            }
            Step.FEEDER_INFO -> {
                // Fold feeder into the same review card (no separate one-by-one screen).
                advanceToKitOrPlace()
                render()
            }
            Step.POLE_REVIEW -> {
                showPoleReview(true)
                bindPoleReviewHeader()
                bindPoleReviewFeeder()
                buildPoleReviewRows()
                binding.btnUsePoleReview.setOnClickListener { onUsePoleReview() }
            }
            Step.KIT_LOCATION -> {
                binding.bubbleTitle.text = getString(R.string.bubble_field_location)
                binding.bubbleSubtitle.text = getString(R.string.bubble_pick_hint)
                locationOptionsForCurrent().forEach { option ->
                    addChoice(option.label, highlighted = option == kitLocation) {
                        kitLocation = option
                        if (option == KitLocation.DEAD_END) {
                            kitArrangement = null
                            val v = voltage ?: lockedSeries?.voltage
                            if (v != null &&
                                structure != null &&
                                !NetworkCatalog.allowsDeadEnd(v, structure)
                            ) {
                                structure = null
                            }
                        } else if (kitArrangement == null) {
                            kitArrangement = KitArrangement.INLINE
                        }
                        returnToPoleReview()
                    }
                }
            }
            Step.KIT_ARRANGEMENT -> {
                binding.bubbleTitle.text = getString(R.string.bubble_field_arrangement)
                binding.bubbleSubtitle.text = kitLocation?.label ?: getString(R.string.bubble_pick_hint)
                NetworkCatalog.kitArrangements().forEach { option ->
                    addChoice(option.label, highlighted = option == kitArrangement) {
                        kitArrangement = option
                        returnToPoleReview()
                    }
                }
            }
            Step.KIT_EXTENSION -> {
                binding.bubbleTitle.text = getString(R.string.bubble_field_extension)
                binding.bubbleSubtitle.text = getString(R.string.bubble_kit_extension_hint)
                val v = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
                NetworkCatalog.kitExtensionsFor(v, material).forEach { option ->
                    addChoice(option.label, highlighted = option == kitExtension) {
                        kitExtension = option
                        syncGuardingAfterExtensionChange()
                        returnToPoleReview()
                    }
                }
            }
            Step.GUARDING -> {
                binding.bubbleTitle.text = getString(R.string.bubble_field_guarding)
                binding.bubbleSubtitle.text = getString(R.string.bubble_guarding_hint)
                addChoice(getString(R.string.yes), highlighted = guarding == true) {
                    guarding = true
                    if (stepStack.contains(Step.POLE_REVIEW)) {
                        returnToPoleReview()
                    } else {
                        advanceAfterKitAccept()
                        render()
                    }
                }
                addChoice(getString(R.string.no), highlighted = guarding == false) {
                    guarding = false
                    if (stepStack.contains(Step.POLE_REVIEW)) {
                        returnToPoleReview()
                    } else {
                        advanceAfterKitAccept()
                        render()
                    }
                }
            }
            Step.DTR_MOUNT -> {
                binding.bubbleTitle.text = getString(R.string.bubble_dtr_mount)
                binding.bubbleSubtitle.text = getString(R.string.bubble_dtr_mount_hint)
                NetworkCatalog.dtrMounts().forEach { option ->
                    addChoice(option.label) {
                        dtrMount = option
                        when {
                            dtCapacityKva.isNullOrBlank() -> push(Step.DTR_CAPACITY)
                            editingKitOnly -> saveEditKitFields()
                            pendingPlaceRole != null -> {
                                val pending = pendingPlaceRole!!
                                pendingPlaceRole = null
                                finishPlace(pending)
                            }
                            else -> push(Step.PLACE_ROLE)
                        }
                        render()
                    }
                }
            }
            Step.DTR_CAPACITY -> {
                binding.bubbleTitle.text = getString(R.string.bubble_dtr_capacity)
                binding.bubbleSubtitle.text = dtrMount?.label ?: "DTR"
                val caps = if (showAllDtrCapacities) {
                    NetworkCatalog.dtrCapacitiesCommon() + NetworkCatalog.dtrCapacitiesMore()
                } else {
                    NetworkCatalog.dtrCapacitiesCommon()
                }
                caps.forEach { kva ->
                    addChoice("${kva} kVA") {
                        dtCapacityKva = kva
                        if (editingKitOnly) {
                            saveEditKitFields()
                        } else {
                            val pending = pendingPlaceRole
                            if (pending != null) {
                                pendingPlaceRole = null
                                finishPlace(pending)
                            } else {
                                push(Step.PLACE_ROLE)
                            }
                        }
                        render()
                    }
                }
                if (!showAllDtrCapacities) {
                    addChoice(getString(R.string.bubble_dtr_more_sizes)) {
                        showAllDtrCapacities = true
                        render()
                    }
                }
            }
            Step.PLACE_ROLE -> {
                binding.bubbleTitle.text = getString(R.string.bubble_place)
                binding.bubbleSubtitle.text = summaryLine()
                val deadEnd = kitLocation == KitLocation.DEAD_END
                val v = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
                fun tryPlaceEnd() {
                    val st = structure ?: NetworkCatalog.defaultStructure(v)
                    // Place & End forces Dead-end for Proposed — HT 1P cannot end a network.
                    if (status == WorkStatus.PROPOSED && !NetworkCatalog.allowsDeadEnd(v, st)) {
                        push(Step.POLE_REVIEW)
                        render()
                        showProceedError(getString(R.string.bubble_need_deadend_structure), "type")
                        return
                    }
                    finishPlace(PoleRole.END)
                }
                if (deadEnd) {
                    addChoice(getString(R.string.place_end)) {
                        tryPlaceEnd()
                    }
                } else if (lockedSeries == null && editing == null && splitConnectionId == null) {
                    addChoice(getString(R.string.place_continue)) {
                        finishPlace(PoleRole.START)
                    }
                    addChoice(getString(R.string.place_end)) {
                        tryPlaceEnd()
                    }
                } else {
                    addChoice(getString(R.string.place_continue)) {
                        finishPlace(PoleRole.CONTINUE)
                    }
                    addChoice(getString(R.string.place_end)) {
                        tryPlaceEnd()
                    }
                }
            }
            Step.TAPPING_YES_NO -> {
                binding.bubbleTitle.text = getString(R.string.bubble_tapping)
                binding.bubbleSubtitle.text = getString(R.string.bubble_tapping_hint)
                addChoice(getString(R.string.yes)) {
                    wantTapping = true
                    push(Step.SOURCE_POLE)
                    render()
                }
                addChoice(getString(R.string.no)) {
                    wantTapping = false
                    mode = Mode.NEW_NETWORK
                    push(Step.VOLTAGE)
                    render()
                }
            }
            Step.SOURCE_POLE -> {
                binding.bubbleTitle.text = getString(R.string.bubble_source_pole)
                binding.bubbleSubtitle.text = getString(R.string.bubble_source_hint)
                candidatePoles.forEach { pole ->
                    addChoice("#${pole.sequence} ${pole.voltage.label}") {
                        beginBranchFrom(pole)
                        render()
                    }
                }
            }
            Step.EDIT_MENU -> {
                binding.bubbleTitle.text = getString(R.string.edit_asset)
                val kitBit = if (editing!!.status == WorkStatus.PROPOSED) {
                    val ready = if (editing!!.isEstimateReady()) {
                        getString(R.string.bubble_kit_ready)
                    } else {
                        getString(R.string.bubble_kit_incomplete)
                    }
                    "\n$ready · ${NetworkCatalog.kitSummary(
                        editing!!.kitLocationEnum,
                        editing!!.kitArrangementEnum,
                        editing!!.kitExtensionEnum,
                        editing!!.dtrMountEnum,
                        editing!!.dtCapacityKva
                    )}"
                } else {
                    ""
                }
                binding.bubbleSubtitle.text =
                    "Pole #${editing!!.sequence}  ·  ${editing!!.voltage.label}  ·  ${editing!!.status.label}$kitBit"
                addChoice(getString(R.string.bubble_change_structure)) {
                    editingKitOnly = false
                    push(Step.STRUCTURE)
                    render()
                }
                if (editing!!.status == WorkStatus.PROPOSED) {
                    addChoice(getString(R.string.bubble_change_kit)) {
                        editingKitOnly = true
                        applySmartKitDefaults()
                        push(Step.POLE_REVIEW)
                        render()
                    }
                }
                addChoice(getString(R.string.bubble_change_role_end)) {
                    onEdit?.invoke(editing!!.copy(poleRole = PoleRole.END))
                    dismiss()
                }
                addChoice(getString(R.string.delete_pole)) {
                    push(Step.CONFIRM_DELETE)
                    render()
                }
            }
            Step.CONFIRM_DELETE -> {
                binding.bubbleTitle.text = "⚠️ Delete Pole #${editing!!.sequence}?"
                binding.bubbleSubtitle.text = "This will remove the pole and all its connections. This cannot be undone."
                addChoice("Yes, Delete Permanently") {
                    onDelete?.invoke(editing!!)
                    dismiss()
                }
                addChoice(getString(R.string.cancel)) {
                    goBack()
                }
            }
            Step.PRESET_SUMMARY -> {
                binding.bubbleTitle.text = getString(R.string.use_preset_title)
                binding.bubbleSubtitle.text = buildString {
                    if (PresetPreferences.isDtrLt(requireContext())) {
                        append(getString(R.string.preset_pattern_dtr_lt_hint))
                        append("\n")
                    }
                    append(voltage?.label ?: "").append(" · ")
                    append(status?.label ?: "").append(" · ")
                    append(material?.label ?: "").append(" · ")
                    append(structure?.label ?: "").append(" · ")
                    append(conductor ?: "")
                    if (voltage != VoltageLevel.LT) {
                        append("\n")
                        append("Feeder: ").append(feederName ?: "—").append(" · ")
                        append("SS: ").append(sourceSubstation ?: "—")
                    }
                }
                addChoice(getString(R.string.place_continue)) {
                    pendingPlaceRole = PoleRole.CONTINUE
                    advanceToKitOrPlace()
                    render()
                }
                addChoice(getString(R.string.place_end)) {
                    pendingPlaceRole = PoleRole.END
                    if (kitLocation == null || kitLocation == KitLocation.TANGENT) {
                        kitLocation = KitLocation.DEAD_END
                        kitArrangement = null
                    }
                    advanceToKitOrPlace()
                    render()
                }
                addChoice(getString(R.string.change_details)) {
                    stepStack.removeLast()
                    voltage = null
                    status = null
                    material = null
                    structure = null
                    conductor = null
                    feederName = null
                    sourceSubstation = null
                    kitLocation = null
                    kitArrangement = null
                    kitExtension = null
                    dtrMount = null
                    push(Step.VOLTAGE)
                    render()
                }
            }
            Step.LT_CONV_START_DTR -> {
                binding.bubbleTitle.text = getString(R.string.lt_conv_start_dtr)
                binding.bubbleSubtitle.text = getString(R.string.lt_conv_start_dtr_hint)
                addChoice(getString(R.string.yes)) {
                    voltage = VoltageLevel.KV_11
                    status = WorkStatus.EXISTING
                    structure = PoleStructure.DTR
                    conductor = NetworkCatalog.conductorsFor(VoltageLevel.KV_11).first()
                    push(Step.LT_CONV_DTR_CAPACITY)
                    render()
                }
                addChoice(getString(R.string.no)) {
                    voltage = VoltageLevel.LT
                    status = WorkStatus.PROPOSED
                    material = PoleMaterial.PCC_8M
                    conductor = "ABC"
                    push(Step.LT_CONV_POLE_KIND)
                    render()
                }
            }
            Step.LT_CONV_DTR_CAPACITY -> {
                binding.bubbleTitle.text = getString(R.string.lt_conv_dtr_capacity)
                binding.bubbleSubtitle.text = "Existing DTR"
                listOf("25", "63", "100").forEach { kva ->
                    addChoice("${kva}kVA") {
                        dtCapacityKva = kva
                        push(Step.LT_CONV_DTR_CODE)
                        render()
                    }
                }
            }
            Step.LT_CONV_DTR_CODE -> {
                binding.bubbleTitle.text = getString(R.string.lt_conv_dtr_code)
                binding.bubbleSubtitle.text = getString(R.string.lt_conv_dtr_code_hint)
                showFeederInputs(true)
                binding.bubbleChoices.isVisible = true
                binding.tilFeederName.hint = getString(R.string.lt_conv_dtr_code)
                binding.tilSourceSs.isVisible = false
                binding.etFeederName.setText(remarks.orEmpty())
                binding.btnFeederConfirm.text = getString(R.string.next)
                binding.btnFeederConfirm.setOnClickListener {
                    remarks = binding.etFeederName.text?.toString()?.trim()?.ifBlank { null }
                    binding.tilSourceSs.isVisible = true
                    binding.tilFeederName.hint = getString(R.string.hint_feeder_name)
                    showFeederInputs(false)
                    push(Step.LT_CONV_DTR_POLE)
                    render()
                }
                addChoice(getString(R.string.lt_conv_dtr_code_skip)) {
                    remarks = null
                    binding.tilSourceSs.isVisible = true
                    binding.tilFeederName.hint = getString(R.string.hint_feeder_name)
                    showFeederInputs(false)
                    push(Step.LT_CONV_DTR_POLE)
                    render()
                }
            }
            Step.LT_CONV_DTR_POLE -> {
                binding.bubbleTitle.text = getString(R.string.lt_conv_dtr_pole)
                binding.bubbleSubtitle.text = "DTR ${dtCapacityKva ?: ""}kVA"
                listOf(
                    PoleMaterial.PCC_8M,
                    PoleMaterial.PCC_9M,
                    PoleMaterial.RAIL,
                    PoleMaterial.H_POLE
                ).forEach { mat ->
                    addChoice(mat.label) {
                        material = mat
                        push(Step.PLACE_ROLE)
                        render()
                    }
                }
            }
            Step.LT_CONV_FIRST_SPAN -> {
                binding.bubbleTitle.text = getString(R.string.lt_conv_first_span)
                binding.bubbleSubtitle.text = getString(R.string.lt_conv_first_span_hint)
                addChoice(getString(R.string.lt_conv_span_pvc)) {
                    conductor = "PVC"
                    material = PoleMaterial.PCC_8M
                    push(Step.LT_CONV_POLE_KIND)
                    render()
                }
                addChoice(getString(R.string.lt_conv_span_abc)) {
                    conductor = "ABC"
                    material = PoleMaterial.PCC_8M
                    push(Step.LT_CONV_POLE_KIND)
                    render()
                }
            }
            Step.LT_CONV_POLE_KIND -> {
                binding.bubbleTitle.text = getString(R.string.lt_conv_pole_kind)
                binding.bubbleSubtitle.text = getString(R.string.lt_conv_pole_kind_hint)
                addChoice(getString(R.string.lt_conv_pole_old)) {
                    structure = PoleStructure.P1
                    material = material ?: PoleMaterial.PCC_8M
                    if (conductor.isNullOrBlank()) conductor = "ABC"
                    advanceToKitOrPlace()
                    render()
                }
                addChoice(getString(R.string.lt_conv_pole_extra)) {
                    structure = PoleStructure.P1N
                    material = material ?: PoleMaterial.PCC_8M
                    if (conductor.isNullOrBlank()) conductor = "ABC"
                    advanceToKitOrPlace()
                    render()
                }
            }
        }
        updateModalHeight()
    }

    private fun summaryLine(): String = buildString {
        append(voltage?.label ?: "")
        if (voltageLocked) append(" (locked)")
        append(" · ")
        append(status?.label ?: "")
        if (mode == Mode.CONTINUE_SERIES || lockedSeries != null) append(" (auto)")
        append(" · ")
        append(material?.label ?: "")
        append(" · ")
        append(structure?.label ?: "")
        append(" · ")
        append(conductor ?: "")
        if (status == WorkStatus.PROPOSED || lockedSeries?.status == WorkStatus.PROPOSED) {
            append("\n")
            append(
                NetworkCatalog.kitSummary(
                    kitLocation, kitArrangement, kitExtension, dtrMount, dtCapacityKva
                )
            )
            if (NetworkCatalog.allowsGuardingChoice(material, kitExtension) && guarding == true) {
                append(" · Guarding")
            }
        }
        if (mode == Mode.TAPPING_BRANCH && voltage != VoltageLevel.LT) {
            append("\n")
            append("Feeder: ").append(feederName ?: "—").append(" · ")
            append("SS: ").append(sourceSubstation ?: "—")
        }
    }

    /** Smart defaults then open labeled pole review (Existing + Proposed). */
    private fun advanceToKitOrPlace() {
        applySmartKitDefaults()
        if (stepStack.lastOrNull() != Step.POLE_REVIEW) {
            push(Step.POLE_REVIEW)
        }
    }

    private fun applySmartKitDefaults() {
        val v = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
        if (material == null) {
            material = preferredMaterial?.takeIf { it in NetworkCatalog.materialsFor(v) }
                ?: lockedSeries?.material
                ?: NetworkCatalog.defaultMaterial(v)
        }
        if (conductor.isNullOrBlank()) {
            conductor = lockedSeries?.conductor?.takeIf { it in NetworkCatalog.conductorsFor(v) }
                ?: NetworkCatalog.conductorsFor(v).first()
        }
        if (structure == null) {
            val tip = tipStructure
            val options = structureOptionsForCurrent()
            structure = when {
                tip != null && tip in options -> tip
                v == VoltageLevel.LT ->
                    NetworkCatalog.ltForcedStructure(conductor)
                        ?: NetworkCatalog.defaultStructure(v).takeIf { it in options }
                else -> NetworkCatalog.defaultStructure(v).takeIf { it in options }
            }
        }
        if (kitLocation == null) {
            kitLocation = when {
                // Mid-span insert: T-Off for most cases
                splitConnectionId != null || mode == Mode.NEAR_LINE -> KitLocation.T_OFF
                mode == Mode.TAPPING_BRANCH ||
                    (sourceAssetId != null && lockedSeries == null) -> KitLocation.T_OFF
                tipKitLocation != null -> tipKitLocation
                else -> KitLocation.TANGENT
            }
        }
        if (kitLocation == KitLocation.DEAD_END) {
            kitArrangement = null
        } else if (kitArrangement == null) {
            kitArrangement = tipKitArrangement ?: KitArrangement.INLINE
        }
        if (kitExtension == null) {
            kitExtension = tipKitExtension ?: KitExtension.NO_EXT
        }
        normalizeExtensionForMaterial()
        syncGuardingAfterExtensionChange()
        if (structure == PoleStructure.DTR && dtrMount == null) {
            dtrMount = tipDtrMount
        }
    }

    private fun normalizeArrangementForReview() {
        if (kitLocation == KitLocation.DEAD_END) {
            kitArrangement = null
        } else if (kitArrangement == null) {
            kitArrangement = KitArrangement.INLINE
        }
    }

    /** True for brand-new network start (titles / feeder); options are same as any pole. */
    private fun isNetworkStart(): Boolean {
        if (editing != null && editingKitOnly) return false
        if (mode == Mode.CONTINUE_SERIES || lockedSeries != null) return false
        if (mode == Mode.TAPPING_BRANCH || sourceAssetId != null) return false
        if (splitConnectionId != null || mode == Mode.NEAR_LINE) return false
        return mode == Mode.NEW_NETWORK || tipKitLocation == null && tipStructure == null
    }

    private fun structureOptionsForCurrent(): List<PoleStructure> {
        val v = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
        return if (v == VoltageLevel.LT) {
            NetworkCatalog.ltPhasesForConductor(conductor)
        } else {
            NetworkCatalog.structuresForLocation(v, kitLocation)
        }
    }

    private fun locationOptionsForCurrent(): List<KitLocation> {
        val v = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
        return NetworkCatalog.kitLocationsFor(v, structure)
    }

    private fun structureLabel(option: PoleStructure): String {
        val v = voltage ?: lockedSeries?.voltage
        if (v == VoltageLevel.LT) {
            return when (option) {
                PoleStructure.P1 -> getString(R.string.lt_phase_1p)
                PoleStructure.P2 -> getString(R.string.lt_phase_2p)
                PoleStructure.P3 -> getString(R.string.lt_phase_3p)
                else -> option.label
            }
        }
        return option.label
    }

    private fun showPoleReview(show: Boolean) {
        binding.poleReviewContainer.isVisible = show
        binding.btnUsePoleReview.isVisible = show
        if (show) {
            binding.bubbleChoices.isVisible = false
        } else {
            binding.feederInputContainer.isVisible = false
            binding.btnFeederConfirm.isVisible = true
            if (stepStack.lastOrNull() != Step.FEEDER_INFO) {
                binding.bubbleChoices.isVisible = true
            }
        }
    }

    private fun showFeederInputs(show: Boolean) {
        if (stepStack.lastOrNull() == Step.POLE_REVIEW) return
        binding.feederInputContainer.isVisible = show
        binding.btnFeederConfirm.isVisible = true
        if (show) {
            binding.bubbleChoices.isVisible = false
            binding.poleReviewContainer.isVisible = false
        } else if (stepStack.lastOrNull() != Step.POLE_REVIEW) {
            binding.bubbleChoices.isVisible = true
        }
    }

    private fun returnToPoleReview() {
        while (stepStack.isNotEmpty() && stepStack.last() != Step.POLE_REVIEW) {
            stepStack.removeLast()
        }
        if (stepStack.isEmpty() || stepStack.last() != Step.POLE_REVIEW) {
            push(Step.POLE_REVIEW)
        }
        render()
    }

    private fun shortArrangement(option: KitArrangement): String = when (option) {
        KitArrangement.INLINE -> "In-line"
        KitArrangement.SECTIONAL -> "Section"
    }

    private fun shortExtension(option: KitExtension): String = when (option) {
        KitExtension.NO_EXT -> "No-ext"
        KitExtension.WITH_EXT -> "With-ext"
    }

    private data class CompactOpt(
        val key: String,
        val label: String,
        val enabled: Boolean = true
    )

    private fun bindPoleReviewHeader() {
        val first = isNetworkStart()
        val isExisting = (status ?: lockedSeries?.status) == WorkStatus.EXISTING
        binding.bubbleTitle.text = when {
            isExisting && first -> getString(R.string.bubble_existing_review_first)
            isExisting -> getString(R.string.bubble_existing_review_next)
            first -> getString(R.string.bubble_pole_review_first)
            else -> getString(R.string.bubble_pole_review_next)
        }
        binding.bubbleSubtitle.text = when {
            isExisting -> getString(R.string.bubble_existing_review_hint)
            else -> getString(R.string.bubble_pole_review_compact_hint)
        }
    }

    private fun bindPoleReviewFeeder() {
        val needFeeder = needsFeederInfo()
        if (needFeeder) {
            binding.feederInputContainer.isVisible = true
            if (binding.etFeederName.text.isNullOrEmpty()) {
                binding.etFeederName.setText(feederName ?: "")
            }
            if (binding.etSourceSs.text.isNullOrEmpty()) {
                binding.etSourceSs.setText(sourceSubstation ?: "")
            }
            binding.btnFeederConfirm.isVisible = false
        } else {
            binding.feederInputContainer.isVisible = false
        }
    }

    /** Rebuild option rows only — keeps scroll position so taps don’t jump the sheet. */
    private fun refreshPoleReview() {
        if (_binding == null || stepStack.lastOrNull() != Step.POLE_REVIEW) return
        clearProceedError()
        val y = binding.bubbleScroll.scrollY
        binding.poleReviewRows.removeAllViews()
        buildPoleReviewRows()
        binding.bubbleScroll.post {
            if (_binding != null) binding.bubbleScroll.scrollTo(0, y)
        }
    }

    private fun clearProceedError() {
        if (_binding == null) return
        binding.bubbleProceedError.isVisible = false
        binding.bubbleProceedError.text = ""
    }

    /** Sticky banner when Use this / Next cannot proceed — always visible above the footer. */
    private fun showProceedError(message: String, scrollToTag: String? = null) {
        if (_binding == null) return
        binding.bubbleProceedError.text = message
        binding.bubbleProceedError.isVisible = true
        binding.bubbleProceedError.announceForAccessibility(message)
        when (scrollToTag) {
            "feeder" -> {
                binding.bubbleScroll.post {
                    if (_binding == null) return@post
                    binding.bubbleScroll.smoothScrollTo(0, 0)
                    binding.feederInputContainer.requestFocus()
                }
            }
            null -> Unit
            else -> {
                binding.bubbleScroll.post {
                    if (_binding == null) return@post
                    val target = binding.poleReviewRows.findViewWithTag<android.view.View>(scrollToTag)
                        ?: return@post
                    val y = (target.top + binding.poleReviewContainer.top).coerceAtLeast(0)
                    binding.bubbleScroll.smoothScrollTo(0, y)
                }
            }
        }
    }

    private fun buildPoleReviewRows() {
        val v = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
        normalizeArrangementForReview()
        if (kitExtension == null) {
            kitExtension = tipKitExtension ?: KitExtension.NO_EXT
        }
        normalizeExtensionForMaterial()
        if (kitExtension == null) {
            kitExtension = KitExtension.NO_EXT
        }
        val arrEnabled = kitLocation != null && kitLocation != KitLocation.DEAD_END
        val guardEnabled = NetworkCatalog.allowsGuardingChoice(material, kitExtension)

        addReviewSectionHeader(getString(R.string.bubble_section_pole))

        addCompactOptionRow(
            getString(R.string.bubble_field_material_short),
            NetworkCatalog.materialsFor(v).map { CompactOpt(it.name, it.label) },
            selectedKey = material?.name,
            rowTag = "material"
        ) { key ->
            material = NetworkCatalog.materialsFor(v).firstOrNull { it.name == key }
            normalizeExtensionForMaterial()
            syncGuardingAfterExtensionChange()
            refreshPoleReview()
        }

        addCompactOptionRow(
            getString(R.string.bubble_field_conductor_short),
            NetworkCatalog.conductorsFor(v).map { opt ->
                val label = when {
                    v == VoltageLevel.LT && opt == "ABC" -> "ABC"
                    v == VoltageLevel.LT && opt == "PVC" -> "PVC"
                    else -> opt
                }
                CompactOpt(opt, label)
            },
            selectedKey = conductor,
            rowTag = "conductor"
        ) { key ->
            conductor = key
            if (v == VoltageLevel.LT) {
                structure = NetworkCatalog.ltForcedStructure(key)
                    ?: structure?.takeIf { it in NetworkCatalog.ltPhasesForConductor(key) }
            }
            refreshPoleReview()
        }

        addCompactOptionRow(
            getString(R.string.bubble_field_pole_type_short),
            structureOptionsForCurrent().map {
                CompactOpt(it.name, structureLabel(it))
            },
            selectedKey = structure?.name,
            rowTag = "type"
        ) { key ->
            structure = structureOptionsForCurrent().firstOrNull { it.name == key }
            // Picking HT 1P drops Dead-end (not allowed).
            if (structure != null &&
                kitLocation == KitLocation.DEAD_END &&
                !NetworkCatalog.allowsDeadEnd(v, structure)
            ) {
                kitLocation = KitLocation.TANGENT
                if (kitArrangement == null) kitArrangement = KitArrangement.INLINE
            }
            refreshPoleReview()
        }

        addReviewSectionHeader(getString(R.string.bubble_section_kit))

        addCompactOptionRow(
            getString(R.string.bubble_field_location_short),
            locationOptionsForCurrent().map { loc -> CompactOpt(loc.name, loc.label) },
            selectedKey = kitLocation?.name,
            rowTag = "location"
        ) { key ->
            val option = locationOptionsForCurrent().firstOrNull { it.name == key }
                ?: return@addCompactOptionRow
            kitLocation = option
            if (option == KitLocation.DEAD_END) {
                kitArrangement = null
                // Dead-end filters type list — drop HT 1P if selected.
                if (structure != null && !NetworkCatalog.allowsDeadEnd(v, structure)) {
                    structure = null
                }
            } else if (kitArrangement == null) {
                kitArrangement = KitArrangement.INLINE
            }
            refreshPoleReview()
        }

        addCompactOptionRow(
            getString(R.string.bubble_field_arrangement_short),
            NetworkCatalog.kitArrangements().map {
                CompactOpt(it.name, shortArrangement(it), enabled = arrEnabled)
            },
            selectedKey = kitArrangement?.name,
            rowEnabled = arrEnabled,
            rowTag = "arrangement"
        ) { key ->
            kitArrangement = NetworkCatalog.kitArrangements().firstOrNull { it.name == key }
            refreshPoleReview()
        }

        addCompactOptionRow(
            getString(R.string.bubble_field_extension_short),
            NetworkCatalog.kitExtensionsFor(v, material).map {
                CompactOpt(it.name, shortExtension(it))
            },
            selectedKey = kitExtension?.name,
            rowTag = "extension"
        ) { key ->
            val option = NetworkCatalog.kitExtensionsFor(v, material).firstOrNull { it.name == key }
            kitExtension = option
            syncGuardingAfterExtensionChange()
            refreshPoleReview()
        }

        addCompactOptionRow(
            getString(R.string.bubble_field_guarding_short),
            listOf(
                CompactOpt("YES", getString(R.string.yes), enabled = guardEnabled),
                CompactOpt("NO", getString(R.string.no), enabled = guardEnabled)
            ),
            selectedKey = when (guarding) {
                true -> "YES"
                false -> "NO"
                null -> null
            },
            rowEnabled = guardEnabled,
            showDivider = false,
            rowTag = "guarding"
        ) { key ->
            guarding = key == "YES"
            refreshPoleReview()
        }
    }

    private fun normalizeExtensionForMaterial() {
        val v = voltage ?: lockedSeries?.voltage ?: return
        val allowed = NetworkCatalog.kitExtensionsFor(v, material)
        if (kitExtension != null && kitExtension !in allowed) {
            kitExtension = KitExtension.NO_EXT
        }
    }

    private fun syncGuardingAfterExtensionChange() {
        if (!NetworkCatalog.allowsGuardingChoice(material, kitExtension)) {
            guarding = false
        } else if (guarding == null) {
            guarding = false
        }
    }

    private fun onUsePoleReview() {
        val v = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
        val needFeeder = needsFeederInfo()
        if (needFeeder) {
            val fn = binding.etFeederName.text?.toString()?.trim() ?: ""
            val ss = binding.etSourceSs.text?.toString()?.trim() ?: ""
            if (fn.isBlank() || ss.isBlank()) {
                if (fn.isBlank()) {
                    binding.tilFeederName.error = getString(R.string.feeder_required_error)
                } else {
                    binding.tilFeederName.error = null
                }
                if (ss.isBlank()) {
                    binding.tilSourceSs.error = getString(R.string.feeder_required_error)
                } else {
                    binding.tilSourceSs.error = null
                }
                showProceedError(getString(R.string.bubble_need_feeder), scrollToTag = "feeder")
                return
            }
            binding.tilFeederName.error = null
            binding.tilSourceSs.error = null
            feederName = fn
            sourceSubstation = ss
        }
        when {
            material == null -> {
                showProceedError(getString(R.string.bubble_need_material), "material")
            }
            conductor.isNullOrBlank() -> {
                showProceedError(getString(R.string.bubble_need_conductor), "conductor")
            }
            structure == null -> {
                showProceedError(getString(R.string.bubble_need_pole_type), "type")
            }
            kitLocation == null -> {
                showProceedError(getString(R.string.bubble_need_location), "location")
            }
            kitLocation != KitLocation.DEAD_END && kitArrangement == null -> {
                showProceedError(getString(R.string.bubble_need_arrangement), "arrangement")
            }
            kitLocation == KitLocation.DEAD_END &&
                structure != null &&
                !NetworkCatalog.allowsDeadEnd(v, structure) -> {
                showProceedError(getString(R.string.bubble_need_deadend_structure), "type")
            }
            kitExtension == null -> {
                showProceedError(getString(R.string.bubble_need_extension), "extension")
            }
            NetworkCatalog.allowsGuardingChoice(material, kitExtension) && guarding == null -> {
                showProceedError(getString(R.string.bubble_need_guarding), "guarding")
            }
            else -> {
                clearProceedError()
                advanceAfterKitAccept()
                render()
            }
        }
    }

    private fun addReviewSectionHeader(title: String) {
        val ctx = requireContext()
        val density = resources.displayMetrics.density
        binding.poleReviewRows.addView(
            android.widget.TextView(ctx).apply {
                text = title.uppercase(java.util.Locale.getDefault())
                setTextColor(ctx.getColor(R.color.primary))
                textSize = 12f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                letterSpacing = 0.06f
                setPadding(0, (10 * density).toInt(), 0, (4 * density).toInt())
            }
        )
    }

    /** Outdoor-friendly block: label above, large chips below. */
    private fun addCompactOptionRow(
        shortLabel: String,
        options: List<CompactOpt>,
        selectedKey: String?,
        rowEnabled: Boolean = true,
        showDivider: Boolean = true,
        rowTag: String? = null,
        onSelect: (String) -> Unit
    ) {
        val ctx = requireContext()
        val density = resources.displayMetrics.density
        val chipH = 44f * density
        val padH = (2 * density).toInt()

        val block = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(padH, (6 * density).toInt(), padH, (6 * density).toInt())
            alpha = if (rowEnabled) 1f else 0.45f
            if (rowTag != null) tag = rowTag
        }
        block.addView(
            android.widget.TextView(ctx).apply {
                text = shortLabel
                setTextColor(ctx.getColor(R.color.text_secondary))
                textSize = 13f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(0, 0, 0, (4 * density).toInt())
            }
        )
        val group = com.google.android.material.chip.ChipGroup(ctx).apply {
            isSingleSelection = true
            isSelectionRequired = false
            chipSpacingHorizontal = (8 * density).toInt()
            chipSpacingVertical = (8 * density).toInt()
        }
        options.forEach { opt ->
            val chip = Chip(ctx).apply {
                text = opt.label
                isCheckable = true
                isChecked = opt.enabled && opt.key == selectedKey
                isEnabled = opt.enabled && rowEnabled
                isClickable = opt.enabled && rowEnabled
                isFocusable = opt.enabled && rowEnabled
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                setEnsureMinTouchTargetSize(true)
                chipMinHeight = chipH
                textSize = 14f
                chipStartPadding = 14f * density
                chipEndPadding = 14f * density
                chipStrokeWidth = density
                chipStrokeColor = android.content.res.ColorStateList.valueOf(
                    ctx.getColor(R.color.outline)
                )
                setOnClickListener {
                    if (opt.enabled && rowEnabled && opt.key != selectedKey) {
                        onSelect(opt.key)
                    } else if (opt.enabled && rowEnabled) {
                        isChecked = true
                    }
                }
            }
            group.addView(chip)
        }
        block.addView(group)
        binding.poleReviewRows.addView(block)
        if (showDivider) {
            binding.poleReviewRows.addView(
                android.view.View(ctx).apply {
                    layoutParams = android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                        (1 * density).toInt().coerceAtLeast(1)
                    ).apply {
                        topMargin = (2 * density).toInt()
                        bottomMargin = (2 * density).toInt()
                    }
                    setBackgroundColor(ctx.getColor(R.color.surface_variant))
                }
            )
        }
    }

    private fun updateModalHeight() {
        if (_binding == null) return
        binding.bubbleCard.post {
            if (_binding == null || binding.root.height == 0) return@post
            val maxHeight = (binding.root.height * 0.86f).toInt()
            val isReview = stepStack.lastOrNull() == Step.POLE_REVIEW
            val target = if (isReview) {
                maxHeight
            } else {
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT
            }
            val lp = binding.bubbleCard.layoutParams
            if (lp.height != target) {
                lp.height = target
                binding.bubbleCard.layoutParams = lp
            }
        }
    }

    private fun addOptionSection(
        title: String,
        options: List<Pair<String, String>>,
        selectedKey: String?,
        onSelect: (String) -> Unit
    ) {
        addCompactOptionRow(
            title,
            options.map { CompactOpt(it.first, it.second) },
            selectedKey,
            onSelect = onSelect
        )
    }

    private fun addReviewRow(label: String, value: String?, onClick: () -> Unit) {
        // Kept for any legacy callers; prefer addOptionSection.
        val ctx = requireContext()
        val row = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(0, 10, 0, 10)
            isClickable = true
            isFocusable = true
            setBackgroundResource(android.R.attr.selectableItemBackground.let { attr ->
                val out = android.util.TypedValue()
                ctx.theme.resolveAttribute(attr, out, true)
                out.resourceId
            })
            setOnClickListener { onClick() }
        }
        val labelView = android.widget.TextView(ctx).apply {
            text = label
            setTextColor(ctx.getColor(R.color.text_secondary))
            textSize = 13f
            layoutParams = android.widget.LinearLayout.LayoutParams(
                0,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                1f
            )
        }
        val valueChip = Chip(ctx).apply {
            text = value ?: getString(R.string.bubble_value_unset)
            isClickable = false
            isCheckable = value != null
            isChecked = value != null
            textSize = 14f
            setEnsureMinTouchTargetSize(false)
        }
        row.addView(labelView)
        row.addView(valueChip)
        binding.poleReviewRows.addView(row)
    }

    private fun advanceAfterKitAccept() {
        if (kitLocation == KitLocation.DEAD_END) {
            pendingPlaceRole = PoleRole.END
        }
        normalizeExtensionForMaterial()
        syncGuardingAfterExtensionChange()
        if (structure == PoleStructure.DTR && dtrMount == null) {
            push(Step.DTR_MOUNT)
            return
        }
        if (structure == PoleStructure.DTR && dtCapacityKva.isNullOrBlank()) {
            push(Step.DTR_CAPACITY)
            return
        }
        if (editingKitOnly) {
            saveEditKitFields()
            return
        }
        val pending = pendingPlaceRole
        if (pending != null) {
            pendingPlaceRole = null
            finishPlace(pending)
            return
        }
        push(Step.PLACE_ROLE)
    }

    private fun saveEditKitFields() {
        val asset = editing ?: return
        val v = voltage ?: asset.voltage
        val st = structure ?: asset.poleStructure ?: PoleStructure.P1
        val c = conductor ?: asset.conductor
        val ext = kitExtension
        val guard = NetworkCatalog.allowsGuardingChoice(material ?: asset.material, ext) &&
            guarding == true
        onEdit?.invoke(
            asset.copy(
                kitLocation = kitLocation?.label,
                kitArrangement = if (kitLocation == KitLocation.DEAD_END) {
                    null
                } else {
                    kitArrangement?.label
                },
                kitExtension = kitExtension?.label,
                dtrMount = dtrMount?.id,
                kitWire = NetworkCatalog.kitWireFor(v, c, st),
                guarding = guard,
                dtCapacityKva = dtCapacityKva ?: asset.dtCapacityKva,
                structure = st.label,
                conductor = c,
                poleMaterial = (material ?: asset.material)?.label ?: asset.poleMaterial,
                type = NetworkCatalog.assetTypeFor(st)
            )
        )
        dismiss()
    }

    /** Start a new series from an existing pole; voltage inherits unless source is DTR. */
    private fun beginBranchFrom(pole: SurveyAsset) {
        sourceAssetId = pole.id
        voltage = pole.voltage
        sourcePoleStatus = pole.status
        status = null
        lockedSeries = null
        splitConnectionId = null
        mode = Mode.TAPPING_BRANCH
        sourceIsDtr = pole.poleStructure == PoleStructure.DTR
        voltageLocked = !sourceIsDtr
        if (pole.status == WorkStatus.PROPOSED) {
            status = WorkStatus.PROPOSED
            if (sourceIsDtr) {
                push(Step.DTR_BRANCH_VOLTAGE)
            } else {
                advanceAfterStatusChoice()
            }
        } else {
            push(Step.STATUS)
        }
    }

    /**
     * After Existing/Proposed is chosen:
     * Both open the compact review — Existing chooses Material/Conductor/Type only;
     * Proposed also chooses Location/Extension (estimate tags).
     */
    private fun advanceAfterStatusChoice() {
        val v = voltage ?: return
        val isInsert = splitConnectionId != null
        val branchOrInsert =
            mode == Mode.TAPPING_BRANCH ||
                sourceAssetId != null ||
                isInsert

        // Mid-line insert: inherit material from the line poles when available.
        if (isInsert && preferredMaterial != null) {
            material = preferredMaterial
        }

        if (branchOrInsert && PresetPreferences.isEnabled(requireContext()) && !isInsert) {
            applyPresetFieldsForBranch(v)
            if (preferredMaterial != null) material = preferredMaterial
            advanceToKitOrPlace()
            return
        }

        if (v == VoltageLevel.LT && material == null) {
            material = preferredMaterial ?: PoleMaterial.PCC_8M
        }
        advanceToKitOrPlace()
    }

    /** Apply preset pole specs for a branch; status stays user-chosen, voltage stays locked. */
    private fun applyPresetFieldsForBranch(v: VoltageLevel) {
        val preset = PresetPreferences.get(requireContext())
        val materials = NetworkCatalog.materialsFor(v)
        val structures = NetworkCatalog.structuresFor(v)
        val conductors = NetworkCatalog.conductorsFor(v)
        material = preset.material.takeIf { it in materials } ?: NetworkCatalog.defaultMaterial(v)
        structure = preset.structure.takeIf { it in structures } ?: NetworkCatalog.defaultStructure(v)
        conductor = preset.conductor.takeIf { it in conductors } ?: conductors.first()
        if (v == VoltageLevel.LT) {
            NetworkCatalog.ltForcedStructure(conductor)?.let { structure = it }
                ?: run {
                    val phases = NetworkCatalog.ltPhasesForConductor(conductor)
                    if (structure !in phases) {
                        structure = phases.firstOrNull() ?: PoleStructure.P1
                    }
                }
        }
        if (feederName.isNullOrBlank()) feederName = preset.feederName.takeIf { it.isNotBlank() }
        if (sourceSubstation.isNullOrBlank()) {
            sourceSubstation = preset.sourceSubstation.takeIf { it.isNotBlank() }
        }
    }

    private fun finishPlace(role: PoleRole) {
        val v = voltage ?: lockedSeries?.voltage ?: return
        val s = status ?: lockedSeries?.status ?: return
        val m = material ?: lockedSeries?.material ?: NetworkCatalog.defaultMaterial(v)
        val c = conductor ?: lockedSeries?.conductor ?: NetworkCatalog.conductorsFor(v).first()
        val st = when {
            structure == PoleStructure.P1N -> PoleStructure.P1N
            v == VoltageLevel.LT ->
                NetworkCatalog.ltForcedStructure(c)
                    ?: structure
                    ?: NetworkCatalog.defaultStructure(v)
            else -> structure ?: NetworkCatalog.defaultStructure(v)
        }
        // Ending a run: Dead-end unless user already chose T-Off / Dead-end.
        var loc = kitLocation
        var arr = kitArrangement
        if (role == PoleRole.END && s == WorkStatus.PROPOSED) {
            if (loc == null || loc == KitLocation.TANGENT || loc == KitLocation.ANGULAR) {
                if (NetworkCatalog.allowsDeadEnd(v, st)) {
                    loc = KitLocation.DEAD_END
                    arr = null
                }
                // HT 1P: leave location as-is; tryPlaceEnd already blocks End.
            }
        }
        if (loc == KitLocation.DEAD_END && !NetworkCatalog.allowsDeadEnd(v, st)) {
            // Safety: never persist illegal HT Dead-end 1P.
            loc = KitLocation.TANGENT
            arr = arr ?: KitArrangement.INLINE
        }
        if (loc == KitLocation.DEAD_END) arr = null
        val ext = kitExtension ?: KitExtension.NO_EXT
        val mount = if (st == PoleStructure.DTR) dtrMount else null
        val wire = if (s == WorkStatus.PROPOSED) {
            NetworkCatalog.kitWireFor(v, c, st)
        } else {
            null
        }
        val guard = NetworkCatalog.allowsGuardingChoice(m, ext) && guarding == true
        // Dead-end always ends the run.
        val placeRole = if (loc == KitLocation.DEAD_END) PoleRole.END else role
        if (editing != null) {
            onEdit?.invoke(
                editing!!.copy(
                    voltage = v,
                    status = s,
                    poleMaterial = m.label,
                    structure = st.label,
                    conductor = c,
                    type = NetworkCatalog.assetTypeFor(st),
                    poleRole = placeRole,
                    dtCapacityKva = dtCapacityKva ?: editing!!.dtCapacityKva,
                    remarks = remarks ?: editing!!.remarks,
                    kitLocation = loc?.label,
                    kitArrangement = arr?.label,
                    kitExtension = ext?.label,
                    dtrMount = mount?.id,
                    kitWire = wire,
                    guarding = guard
                )
            )
            dismiss()
            return
        }
        val seriesId = lockedSeries?.seriesId
        val effectiveRole = when {
            splitConnectionId != null -> PoleRole.CONTINUE
            lockedSeries == null && mode != Mode.CONTINUE_SERIES -> {
                if (placeRole == PoleRole.END) PoleRole.END else PoleRole.START
            }
            else -> placeRole
        }
        onPlace?.invoke(
            PlacementDraft(
                latitude = latitude,
                longitude = longitude,
                voltage = v,
                status = s,
                material = m,
                structure = st,
                conductor = c,
                poleRole = effectiveRole,
                seriesId = seriesId,
                sourceAssetId = sourceAssetId,
                splitConnectionId = splitConnectionId,
                feederName = feederName ?: "",
                sourceSubstation = sourceSubstation ?: "",
                dtCapacityKva = dtCapacityKva,
                remarks = remarks,
                kitLocation = loc?.label,
                kitArrangement = arr?.label,
                kitExtension = ext?.label,
                dtrMount = mount?.id,
                kitWire = wire,
                guarding = guard
            )
        )
        dismiss()
    }

    private fun addChoice(label: String, highlighted: Boolean = false, onClick: () -> Unit) {
        val density = resources.displayMetrics.density
        val chip = Chip(requireContext()).apply {
            text = label
            isClickable = true
            isCheckable = highlighted
            isChecked = highlighted
            textSize = 15f
            setEnsureMinTouchTargetSize(true)
            chipMinHeight = 48f * density
            chipStartPadding = 16f * density
            chipEndPadding = 16f * density
            setOnClickListener { onClick() }
        }
        binding.bubbleChoices.addView(chip)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    enum class Mode { NEW_NETWORK, CONTINUE_SERIES, NEAR_LINE, TAPPING_BRANCH }
    private enum class Step {
        VOLTAGE, STATUS, MATERIAL, STRUCTURE, CONDUCTOR, FEEDER_INFO, PRESET_SUMMARY, PLACE_ROLE,
        POLE_REVIEW, KIT_LOCATION, KIT_ARRANGEMENT, KIT_EXTENSION, GUARDING,
        DTR_MOUNT, DTR_CAPACITY, DTR_BRANCH_VOLTAGE,
        TAPPING_YES_NO, SOURCE_POLE, EDIT_MENU, CONFIRM_DELETE, LINE_ACTION_CHOICE,
        LT_CONV_START_DTR, LT_CONV_DTR_CAPACITY, LT_CONV_DTR_CODE, LT_CONV_DTR_POLE,
        LT_CONV_FIRST_SPAN, LT_CONV_POLE_KIND
    }

    /** Apply saved preset values for a brand-new series (START pole). */
    private fun applyPresetForNewNetwork() {
        val preset = PresetPreferences.get(requireContext())
        val (v, s, m) = preset.startPlacement()
        voltage = v
        status = preset.status
        material = m
        structure = s
        conductor = when {
            preset.isDtrLt() -> {
                val opts = NetworkCatalog.conductorsFor(VoltageLevel.KV_11)
                preset.conductor.takeIf { it in opts } ?: opts.first()
            }
            else -> preset.conductor
        }
        feederName = preset.feederName.takeIf { it.isNotBlank() }
        sourceSubstation = preset.sourceSubstation.takeIf { it.isNotBlank() }
        if (voltage == VoltageLevel.LT && NetworkCatalog.isAbcConductor(conductor)) {
            structure = PoleStructure.P3
        }
    }

    /**
     * Feeder/SS are required only for a brand-new standalone 33/11kV series.
     * Branches from an existing network inherit feeder/SS and must not re-ask.
     */
    private fun needsFeederInfo(): Boolean {
        val v = voltage ?: return false
        if (v == VoltageLevel.LT) return false
        if (mode == Mode.TAPPING_BRANCH || sourceAssetId != null) return false
        if (mode == Mode.CONTINUE_SERIES || lockedSeries != null) return false
        return true
    }

    companion object {
        const val TAG = "SurveyBubbleWizard"
        private const val ARG_LAT = "lat"
        private const val ARG_LNG = "lng"
        private const val ARG_MODE = "mode"
        private const val ARG_ASSET = "asset"
        private const val ARG_SOURCE_ID = "source_id"
        private const val ARG_SPLIT_ID = "split_id"
        private const val ARG_LOCKED_VOLTAGE = "locked_voltage"
        private const val ARG_LOCKED_STATUS = "locked_status"
        private const val ARG_LOCKED_MATERIAL = "locked_material"
        private const val ARG_LOCKED_CONDUCTOR = "locked_conductor"
        private const val ARG_LOCKED_SERIES = "locked_series"
        private const val ARG_LOCKED_START_STRUCTURE = "locked_start_structure"
        private const val ARG_CANDIDATES = "candidates"
        private const val ARG_VOLTAGE_LOCKED = "voltage_locked"
        private const val ARG_FEEDER_NAME = "feeder_name"
        private const val ARG_SOURCE_SS = "source_ss"
        private const val ARG_LINE_VOLTAGE = "line_voltage"
        private const val ARG_LINE_STATUS = "line_status"
        private const val ARG_SOURCE_STATUS = "source_status"
        private const val ARG_DIRECT_INSERT = "direct_insert"
        private const val ARG_TIP_STRUCTURE = "tip_structure"
        private const val ARG_TIP_KIT_LOCATION = "tip_kit_location"
        private const val ARG_TIP_KIT_ARRANGEMENT = "tip_kit_arrangement"
        private const val ARG_TIP_KIT_EXTENSION = "tip_kit_extension"
        private const val ARG_TIP_DTR_MOUNT = "tip_dtr_mount"
        private const val ARG_PREFERRED_MATERIAL = "preferred_material"
        private const val ARG_SOURCE_IS_DTR = "source_is_dtr"

        fun forNew(lat: Double, lng: Double): SurveyBubbleWizard =
            SurveyBubbleWizard().apply {
                arguments = bundleOf(
                    ARG_LAT to lat,
                    ARG_LNG to lng,
                    ARG_MODE to Mode.NEW_NETWORK.name
                )
            }

        fun forContinue(
            lat: Double,
            lng: Double,
            series: SeriesConfig,
            sourceId: Long?,
            tipStructure: PoleStructure? = null,
            tipKitLocation: String? = null,
            tipKitArrangement: String? = null,
            tipKitExtension: String? = null,
            tipDtrMount: String? = null
        ): SurveyBubbleWizard =
            SurveyBubbleWizard().apply {
                arguments = bundleOf(
                    ARG_LAT to lat,
                    ARG_LNG to lng,
                    ARG_MODE to Mode.CONTINUE_SERIES.name,
                    ARG_LOCKED_VOLTAGE to series.voltage.label,
                    ARG_LOCKED_STATUS to series.status.label,
                    ARG_LOCKED_MATERIAL to series.material.label,
                    ARG_LOCKED_CONDUCTOR to series.conductor,
                    ARG_LOCKED_SERIES to series.seriesId,
                    ARG_LOCKED_START_STRUCTURE to (series.startStructure?.label ?: ""),
                    ARG_SOURCE_ID to (sourceId ?: -1L),
                    ARG_TIP_STRUCTURE to tipStructure?.label,
                    ARG_TIP_KIT_LOCATION to tipKitLocation,
                    ARG_TIP_KIT_ARRANGEMENT to tipKitArrangement,
                    ARG_TIP_KIT_EXTENSION to tipKitExtension,
                    ARG_TIP_DTR_MOUNT to tipDtrMount
                )
            }

        /**
         * Start a branch from [source].
         * Voltage is locked to the source line; feeder/SS are inherited for 11/33kV.
         * If [source] is Proposed, status is auto Proposed (no re-ask).
         */
        fun forTapping(
            lat: Double,
            lng: Double,
            source: SurveyAsset,
            feederName: String = "",
            sourceSubstation: String = ""
        ): SurveyBubbleWizard =
            SurveyBubbleWizard().apply {
                val fromDtr = source.poleStructure == PoleStructure.DTR
                arguments = bundleOf(
                    ARG_LAT to lat,
                    ARG_LNG to lng,
                    ARG_MODE to Mode.TAPPING_BRANCH.name,
                    ARG_SOURCE_ID to source.id,
                    ARG_LOCKED_VOLTAGE to source.voltage.label,
                    ARG_VOLTAGE_LOCKED to !fromDtr,
                    ARG_SOURCE_STATUS to source.status.label,
                    ARG_SOURCE_IS_DTR to fromDtr,
                    ARG_FEEDER_NAME to feederName,
                    ARG_SOURCE_SS to sourceSubstation
                )
            }

        fun forNearLine(
            lat: Double,
            lng: Double,
            candidates: List<SurveyAsset>,
            splitId: Long?,
            lineVoltage: VoltageLevel? = null,
            lineStatus: WorkStatus? = null,
            feederName: String = "",
            sourceSubstation: String = "",
            /** When true, skip the "Action near line" menu and start insert immediately. */
            directInsert: Boolean = false,
            preferredMaterial: PoleMaterial? = null
        ): SurveyBubbleWizard =
            SurveyBubbleWizard().apply {
                arguments = Bundle().apply {
                    putDouble(ARG_LAT, lat)
                    putDouble(ARG_LNG, lng)
                    putString(ARG_MODE, Mode.NEAR_LINE.name)
                    putLong(ARG_SPLIT_ID, splitId ?: -1L)
                    putString(ARG_LINE_VOLTAGE, lineVoltage?.label)
                    putString(ARG_LINE_STATUS, lineStatus?.label)
                    putString(ARG_FEEDER_NAME, feederName)
                    putString(ARG_SOURCE_SS, sourceSubstation)
                    putBoolean(ARG_DIRECT_INSERT, directInsert)
                    putString(ARG_PREFERRED_MATERIAL, preferredMaterial?.label)
                    putParcelableArrayList(
                        ARG_CANDIDATES,
                        ArrayList(candidates.map { it.toParcelable() })
                    )
                }
            }

        fun forEdit(asset: SurveyAsset): SurveyBubbleWizard =
            SurveyBubbleWizard().apply {
                arguments = Bundle().apply {
                    putDouble(ARG_LAT, asset.latitude)
                    putDouble(ARG_LNG, asset.longitude)
                    putString(ARG_MODE, Mode.NEW_NETWORK.name)
                    putParcelable(ARG_ASSET, asset.toParcelable())
                }
            }
    }
}

@Suppress("DEPRECATION")
private fun Bundle.getParcelableCompat(key: String): SurveyAsset? =
    if (android.os.Build.VERSION.SDK_INT >= 33) {
        getParcelable(key, AssetParcelable::class.java)?.toDomain()
    } else {
        getParcelable<AssetParcelable>(key)?.toDomain()
    }

@Suppress("DEPRECATION")
private fun Bundle.getParcelableArrayListCompat(key: String): List<SurveyAsset>? =
    if (android.os.Build.VERSION.SDK_INT >= 33) {
        getParcelableArrayList(key, AssetParcelable::class.java)?.map { it.toDomain() }
    } else {
        getParcelableArrayList<AssetParcelable>(key)?.map { it.toDomain() }
    }
