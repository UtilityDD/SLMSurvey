package com.blackgrapes.slmtoolbox.ui.survey

import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import androidx.core.os.bundleOf
import androidx.core.view.isVisible
import androidx.fragment.app.DialogFragment
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.databinding.DialogSurveyBubbleBinding
import com.blackgrapes.slmtoolbox.domain.NetworkCatalog
import com.blackgrapes.slmtoolbox.domain.PlacementDraft
import com.blackgrapes.slmtoolbox.domain.SeriesConfig
import com.blackgrapes.slmtoolbox.domain.PresetPreferences
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
                val dtrLtContinue = series.startStructure == PoleStructure.DTR &&
                    PresetPreferences.isDtrLt(requireContext())
                if (dtrLtContinue) {
                    val preset = PresetPreferences.get(requireContext())
                    val (v, _, m) = preset.continueAfterDtr()
                    voltage = v
                    // Status locked from previous pole / series tip — never re-ask.
                    status = series.status
                    material = m
                    conductor = preset.continueAfterDtrConductor()
                    // LT phase may change on every pole (bare only).
                    if (NetworkCatalog.isAbcConductor(conductor)) {
                        structure = PoleStructure.P1
                        push(Step.PLACE_ROLE)
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
                        // Conductor locked for the series; phase selectable each pole for bare.
                        if (NetworkCatalog.isAbcConductor(series.conductor)) {
                            structure = PoleStructure.P1
                            push(Step.PLACE_ROLE)
                        } else {
                            structure = null
                            push(Step.STRUCTURE)
                        }
                    } else {
                        push(Step.STRUCTURE)
                    }
                }
            }
            mode == Mode.TAPPING_BRANCH -> {
                // Branch from existing network: voltage locked to source line.
                voltage = voltage ?: lockedSeries?.voltage ?: VoltageLevel.KV_11
                voltageLocked = true
                // If tapping from a Proposed pole (e.g. after inserting Proposed on Existing line),
                // inherit Proposed automatically — never re-ask Existing/Proposed.
                if (sourcePoleStatus == WorkStatus.PROPOSED) {
                    status = WorkStatus.PROPOSED
                    advanceAfterStatusChoice()
                } else {
                    push(Step.STATUS)
                }
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
        binding.btnBubbleBack.isVisible = stepStack.size > 1
        binding.bubbleChoices.removeAllViews()
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
                        advanceAfterStatusChoice()
                        render()
                    }
                }
            }
            Step.MATERIAL -> {
                binding.bubbleTitle.text = getString(R.string.bubble_material)
                binding.bubbleSubtitle.text = voltage!!.label
                NetworkCatalog.materialsFor(voltage!!).forEach { option ->
                    addChoice(option.label) {
                        material = option
                        push(Step.STRUCTURE)
                        render()
                    }
                }
            }
            Step.STRUCTURE -> {
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
                val structureOptions = if (isLtPhase) {
                    NetworkCatalog.ltPhasesForConductor(conductor)
                } else {
                    NetworkCatalog.structuresFor(v)
                }
                structureOptions.forEach { option ->
                    val label = if (isLtPhase) {
                        when (option) {
                            PoleStructure.P1 -> getString(R.string.lt_phase_1p)
                            PoleStructure.P2 -> getString(R.string.lt_phase_2p)
                            PoleStructure.P3 -> getString(R.string.lt_phase_3p)
                            else -> option.label
                        }
                    } else {
                        option.label
                    }
                    addChoice(label) {
                        structure = option
                        if (lockedSeries != null) {
                            push(Step.PLACE_ROLE)
                        } else if (v == VoltageLevel.LT) {
                            if (conductor == null) push(Step.CONDUCTOR) else push(Step.PLACE_ROLE)
                        } else {
                            push(Step.CONDUCTOR)
                        }
                        render()
                    }
                }
            }
            Step.CONDUCTOR -> {
                binding.bubbleTitle.text = getString(R.string.bubble_conductor)
                binding.bubbleSubtitle.text = if (voltage == VoltageLevel.LT) {
                    getString(R.string.bubble_lt_conductor_hint)
                } else {
                    voltage!!.label
                }
                NetworkCatalog.conductorsFor(voltage!!).forEach { option ->
                    val label = if (voltage == VoltageLevel.LT && option == "ABC") {
                        getString(R.string.conductor_abc_label)
                    } else if (voltage == VoltageLevel.LT) {
                        getString(R.string.conductor_bare_size, option)
                    } else {
                        option
                    }
                    addChoice(label) {
                        conductor = option
                        when {
                            needsFeederInfo() -> push(Step.FEEDER_INFO)
                            voltage == VoltageLevel.LT && !NetworkCatalog.isAbcConductor(option) -> {
                                structure = null
                                push(Step.STRUCTURE)
                            }
                            voltage == VoltageLevel.LT -> {
                                structure = PoleStructure.P1
                                push(Step.PLACE_ROLE)
                            }
                            else -> push(Step.PLACE_ROLE)
                        }
                        render()
                    }
                }
            }
            Step.FEEDER_INFO -> {
                binding.bubbleTitle.text = getString(R.string.bubble_feeder_info)
                binding.bubbleSubtitle.text = getString(R.string.bubble_feeder_hint)
                // Pre-fill if returning via back
                binding.etFeederName.setText(feederName ?: "")
                binding.etSourceSs.setText(sourceSubstation ?: "")
                binding.btnFeederConfirm.setOnClickListener {
                    val fn = binding.etFeederName.text?.toString()?.trim() ?: ""
                    val ss = binding.etSourceSs.text?.toString()?.trim() ?: ""
                    if (fn.isBlank() || ss.isBlank()) {
                        if (fn.isBlank()) binding.tilFeederName.error = getString(R.string.feeder_required_error)
                        if (ss.isBlank()) binding.tilSourceSs.error = getString(R.string.feeder_required_error)
                        return@setOnClickListener
                    }
                    binding.tilFeederName.error = null
                    binding.tilSourceSs.error = null
                    feederName = fn
                    sourceSubstation = ss
                    push(Step.PLACE_ROLE)
                    render()
                }
            }
            Step.PLACE_ROLE -> {
                binding.bubbleTitle.text = getString(R.string.bubble_place)
                binding.bubbleSubtitle.text = summaryLine()
                if (lockedSeries == null && editing == null && splitConnectionId == null) {
                    addChoice(getString(R.string.place_continue)) {
                        finishPlace(PoleRole.START)
                    }
                    addChoice(getString(R.string.place_end)) {
                        finishPlace(PoleRole.END)
                    }
                } else {
                    addChoice(getString(R.string.place_continue)) {
                        finishPlace(PoleRole.CONTINUE)
                    }
                    addChoice(getString(R.string.place_end)) {
                        finishPlace(PoleRole.END)
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
                binding.bubbleSubtitle.text = "Pole #${editing!!.sequence}  ·  ${editing!!.voltage.label}  ·  ${editing!!.status.label}"
                addChoice(getString(R.string.bubble_change_structure)) {
                    push(Step.STRUCTURE)
                    render()
                }
                addChoice(getString(R.string.bubble_change_role_end)) {
                    onEdit?.invoke(editing!!.copy(poleRole = PoleRole.END))
                    dismiss()
                }
                addChoice(getString(R.string.delete_pole)) {
                    // Push a confirmation step to prevent accidental deletion
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
                    finishPlace(PoleRole.CONTINUE)
                }
                addChoice(getString(R.string.place_end)) {
                    finishPlace(PoleRole.END)
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
                    push(Step.VOLTAGE)
                    render()
                }
            }
        }
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
        if (mode == Mode.TAPPING_BRANCH && voltage != VoltageLevel.LT) {
            append("\n")
            append("Feeder: ").append(feederName ?: "—").append(" · ")
            append("SS: ").append(sourceSubstation ?: "—")
        }
    }

    /** Start a new series from an existing pole; voltage inherits from that line. */
    private fun beginBranchFrom(pole: SurveyAsset) {
        sourceAssetId = pole.id
        // Do not selectTapPole here — that would arm CONTINUE of the Existing series.
        voltage = pole.voltage
        sourcePoleStatus = pole.status
        status = null
        lockedSeries = null
        splitConnectionId = null
        mode = Mode.TAPPING_BRANCH
        voltageLocked = true
        if (pole.status == WorkStatus.PROPOSED) {
            status = WorkStatus.PROPOSED
            advanceAfterStatusChoice()
        } else {
            push(Step.STATUS)
        }
    }

    /**
     * After Existing/Proposed is chosen:
     * - Branch/tap with presets: apply preset material/structure/conductor (keep chosen status + locked voltage).
     * - Insert on line with presets: same (split keeps voltage lock).
     * - Without presets: continue normal material / conductor steps.
     */
    private fun advanceAfterStatusChoice() {
        val v = voltage ?: return
        val branchOrInsert =
            mode == Mode.TAPPING_BRANCH ||
                sourceAssetId != null ||
                splitConnectionId != null
        if (branchOrInsert && PresetPreferences.isEnabled(requireContext())) {
            applyPresetFieldsForBranch(v)
            push(Step.PLACE_ROLE)
            return
        }
        when (v) {
            VoltageLevel.LT -> {
                material = PoleMaterial.PCC_8M
                structure = null
                push(Step.CONDUCTOR)
            }
            else -> push(Step.MATERIAL)
        }
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
        if (v == VoltageLevel.LT && NetworkCatalog.isAbcConductor(conductor)) {
            structure = PoleStructure.P1
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
            v == VoltageLevel.LT && NetworkCatalog.isAbcConductor(c) -> PoleStructure.P1
            else -> structure ?: NetworkCatalog.defaultStructure(v)
        }
        if (editing != null) {
            onEdit?.invoke(
                editing!!.copy(
                    voltage = v,
                    status = s,
                    poleMaterial = m.label,
                    structure = st.label,
                    conductor = c,
                    type = NetworkCatalog.assetTypeFor(st),
                    poleRole = role
                )
            )
            dismiss()
            return
        }
        val seriesId = lockedSeries?.seriesId
        val effectiveRole = when {
            splitConnectionId != null -> PoleRole.CONTINUE
            lockedSeries == null && mode != Mode.CONTINUE_SERIES -> {
                if (role == PoleRole.END) PoleRole.END else PoleRole.START
            }
            else -> role
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
                sourceSubstation = sourceSubstation ?: ""
            )
        )
        dismiss()
    }

    private fun addChoice(label: String, onClick: () -> Unit) {
        val chip = Chip(requireContext()).apply {
            text = label
            isClickable = true
            isCheckable = false
            textSize = 15f
            setEnsureMinTouchTargetSize(true)
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
        TAPPING_YES_NO, SOURCE_POLE, EDIT_MENU, CONFIRM_DELETE, LINE_ACTION_CHOICE
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
            structure = PoleStructure.P1
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

    private fun showFeederInputs(show: Boolean) {
        binding.feederInputContainer.isVisible = show
        binding.bubbleChoices.isVisible = !show
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
            sourceId: Long?
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
                    ARG_SOURCE_ID to (sourceId ?: -1L)
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
                arguments = bundleOf(
                    ARG_LAT to lat,
                    ARG_LNG to lng,
                    ARG_MODE to Mode.TAPPING_BRANCH.name,
                    ARG_SOURCE_ID to source.id,
                    ARG_LOCKED_VOLTAGE to source.voltage.label,
                    ARG_VOLTAGE_LOCKED to true,
                    ARG_SOURCE_STATUS to source.status.label,
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
            directInsert: Boolean = false
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
