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
        val lockedVoltage = requireArguments().getString(ARG_LOCKED_VOLTAGE)
        val lockedStatus = requireArguments().getString(ARG_LOCKED_STATUS)
        val lockedMaterial = requireArguments().getString(ARG_LOCKED_MATERIAL)
        val lockedConductor = requireArguments().getString(ARG_LOCKED_CONDUCTOR)
        val lockedSeriesId = requireArguments().getLong(ARG_LOCKED_SERIES, -1L)
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
                conductor = lockedConductor
            )
        }
        candidatePoles = requireArguments().getParcelableArrayListCompat(ARG_CANDIDATES).orEmpty()
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
            mode == Mode.NEAR_LINE -> push(Step.LINE_ACTION_CHOICE)
            lockedSeries != null -> {
                voltage = lockedSeries!!.voltage
                status = lockedSeries!!.status
                material = lockedSeries!!.material
                conductor = lockedSeries!!.conductor
                if (lockedSeries!!.voltage == VoltageLevel.LT) {
                    structure = PoleStructure.P1
                    push(Step.PLACE_ROLE)
                } else {
                    push(Step.STRUCTURE)
                }
            }
            mode == Mode.TAPPING_BRANCH -> {
                voltage = lockedSeries?.voltage ?: VoltageLevel.KV_11
                push(Step.STATUS)
            }
            PresetPreferences.isEnabled(requireContext()) && editing == null && mode == Mode.NEW_NETWORK -> {
                val preset = PresetPreferences.get(requireContext())
                voltage = preset.voltage
                status = preset.status
                material = preset.material
                structure = preset.structure
                conductor = preset.conductor
                feederName = preset.feederName.takeIf { it.isNotBlank() }
                sourceSubstation = preset.sourceSubstation.takeIf { it.isNotBlank() }
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
                
                // Option 1: Split line
                addChoice(getString(R.string.choice_split_line)) {
                    voltage = candidatePoles.firstOrNull()?.voltage ?: VoltageLevel.KV_11
                    status = candidatePoles.firstOrNull()?.status ?: WorkStatus.PROPOSED
                    push(Step.STATUS)
                    render()
                }
                
                // Option 2: Tap from nearby poles
                candidatePoles.forEach { pole ->
                    addChoice(getString(R.string.choice_tap_from, pole.sequence)) {
                        sourceAssetId = pole.id
                        onSelectSource?.invoke(pole)
                        voltage = pole.voltage
                        mode = Mode.TAPPING_BRANCH
                        push(Step.STATUS)
                        render()
                    }
                }
                
                // Option 3: New network
                addChoice(getString(R.string.choice_new_network)) {
                    mode = Mode.NEW_NETWORK
                    splitConnectionId = null
                    sourceAssetId = null
                    if (PresetPreferences.isEnabled(requireContext())) {
                        val preset = PresetPreferences.get(requireContext())
                        voltage = preset.voltage
                        status = preset.status
                        material = preset.material
                        structure = preset.structure
                        conductor = preset.conductor
                        feederName = preset.feederName.takeIf { it.isNotBlank() }
                        sourceSubstation = preset.sourceSubstation.takeIf { it.isNotBlank() }
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
                binding.bubbleTitle.text = getString(R.string.bubble_status, voltage!!.label)
                binding.bubbleSubtitle.text = getString(R.string.bubble_status_hint)
                WorkStatus.entries.forEach { option ->
                    addChoice(option.label) {
                        status = option
                        when (voltage) {
                            VoltageLevel.LT -> {
                                material = PoleMaterial.PCC_8M
                                structure = PoleStructure.P1
                                push(Step.CONDUCTOR)
                            }
                            else -> push(Step.MATERIAL)
                        }
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
                binding.bubbleTitle.text = getString(R.string.bubble_structure)
                binding.bubbleSubtitle.text = buildString {
                    append(voltage?.label ?: lockedSeries?.voltage?.label)
                    append(" · ")
                    append(status?.label ?: lockedSeries?.status?.label)
                }
                val v = voltage ?: lockedSeries!!.voltage
                NetworkCatalog.structuresFor(v).forEach { option ->
                    addChoice(option.label) {
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
                binding.bubbleSubtitle.text = voltage!!.label
                NetworkCatalog.conductorsFor(voltage!!).forEach { option ->
                    addChoice(option) {
                        conductor = option
                        if (needsFeederInfo()) {
                            push(Step.FEEDER_INFO)
                        } else {
                            push(Step.PLACE_ROLE)
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
                        sourceAssetId = pole.id
                        onSelectSource?.invoke(pole)
                        voltage = pole.voltage
                        lockedSeries = null
                        mode = Mode.TAPPING_BRANCH
                        push(Step.STATUS)
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
        append(" · ")
        append(status?.label ?: "")
        append(" · ")
        append(material?.label ?: "")
        append(" · ")
        append(structure?.label ?: "")
        append(" · ")
        append(conductor ?: "")
    }

    private fun finishPlace(role: PoleRole) {
        val v = voltage ?: lockedSeries?.voltage ?: return
        val s = status ?: lockedSeries?.status ?: return
        val m = material ?: lockedSeries?.material ?: NetworkCatalog.defaultMaterial(v)
        val st = structure ?: NetworkCatalog.defaultStructure(v)
        val c = conductor ?: lockedSeries?.conductor ?: NetworkCatalog.conductorsFor(v).first()
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

    /** Returns true when this is a new (not continuing) 33kV or 11kV series that needs feeder info. */
    private fun needsFeederInfo(): Boolean {
        val v = voltage ?: return false
        if (v == VoltageLevel.LT) return false
        // Only ask for a brand-new series, not when continuing an existing one
        return lockedSeries == null && mode != Mode.CONTINUE_SERIES
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
        private const val ARG_CANDIDATES = "candidates"

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
                    ARG_SOURCE_ID to (sourceId ?: -1L)
                )
            }

        fun forNearLine(
            lat: Double,
            lng: Double,
            candidates: List<SurveyAsset>,
            splitId: Long?
        ): SurveyBubbleWizard =
            SurveyBubbleWizard().apply {
                arguments = Bundle().apply {
                    putDouble(ARG_LAT, lat)
                    putDouble(ARG_LNG, lng)
                    putString(ARG_MODE, Mode.NEAR_LINE.name)
                    putLong(ARG_SPLIT_ID, splitId ?: -1L)
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
