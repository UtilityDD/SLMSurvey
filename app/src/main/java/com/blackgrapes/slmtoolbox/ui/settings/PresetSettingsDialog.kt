package com.blackgrapes.slmtoolbox.ui.settings

import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.fragment.app.DialogFragment
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.databinding.DialogPresetSettingsBinding
import com.blackgrapes.slmtoolbox.domain.NetworkCatalog
import com.blackgrapes.slmtoolbox.domain.PresetData
import com.blackgrapes.slmtoolbox.domain.PresetPreferences
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

class PresetSettingsDialog : DialogFragment() {

    private var _binding: DialogPresetSettingsBinding? = null
    private val binding get() = _binding!!

    private var selectedVoltage = VoltageLevel.KV_11
    private var selectedStatus = WorkStatus.PROPOSED

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setStyle(STYLE_NO_FRAME, theme)
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
        _binding = DialogPresetSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.root.setOnClickListener { dismiss() }
        binding.btnCancel.setOnClickListener { dismiss() }

        // Prevent dialog clicks from dismissing it
        view.findViewById<View>(R.id.btnCancel).parent.let { parentView ->
            (parentView as? View)?.setOnClickListener { /* consume */ }
        }

        setupVoltageChips()
        setupStatusChips()
        setupDisplayPrefsDropdowns()
        loadPresets()

        binding.switchPresetEnabled.setOnCheckedChangeListener { _, isChecked ->
            binding.presetInputsContainer.isVisible = isChecked
        }

        binding.btnSave.setOnClickListener {
            savePresets()
        }
    }

    private fun setupDisplayPrefsDropdowns() {
        val context = requireContext()
        val units = listOf("Meter", "Foot", "KM")
        val unitAdapter = ArrayAdapter(context, android.R.layout.simple_dropdown_item_1line, units)
        binding.actvDisplayUnit.setAdapter(unitAdapter)

        val decimals = listOf("1 Decimal", "2 Decimals", "3 Decimals")
        val decimalAdapter = ArrayAdapter(context, android.R.layout.simple_dropdown_item_1line, decimals)
        binding.actvDisplayDecimals.setAdapter(decimalAdapter)
    }

    private fun setupVoltageChips() {
        binding.cgVoltage.setOnCheckedStateChangeListener { group, checkedIds ->
            val checkedId = checkedIds.firstOrNull() ?: return@setOnCheckedStateChangeListener
            selectedVoltage = when (checkedId) {
                R.id.chip33kv -> VoltageLevel.KV_33
                R.id.chipLt -> VoltageLevel.LT
                else -> VoltageLevel.KV_11
            }
            updateDropdowns(null, null, null)
        }
    }

    private fun setupStatusChips() {
        binding.cgStatus.setOnCheckedStateChangeListener { group, checkedIds ->
            val checkedId = checkedIds.firstOrNull() ?: return@setOnCheckedStateChangeListener
            selectedStatus = when (checkedId) {
                R.id.chipExisting -> WorkStatus.EXISTING
                else -> WorkStatus.PROPOSED
            }
        }
    }

    private fun updateDropdowns(preselectedMaterial: String?, preselectedStructure: String?, preselectedConductor: String?) {
        val context = requireContext()

        // Materials list
        val materials = NetworkCatalog.materialsFor(selectedVoltage).map { it.label }
        val matAdapter = ArrayAdapter(context, android.R.layout.simple_dropdown_item_1line, materials)
        binding.actvMaterial.setAdapter(matAdapter)
        val defaultMat = preselectedMaterial?.takeIf { it in materials } ?: materials.firstOrNull() ?: ""
        binding.actvMaterial.setText(defaultMat, false)

        // Structures list
        val structures = NetworkCatalog.structuresFor(selectedVoltage).map { it.label }
        val structAdapter = ArrayAdapter(context, android.R.layout.simple_dropdown_item_1line, structures)
        binding.actvStructure.setAdapter(structAdapter)
        val defaultStruct = preselectedStructure?.takeIf { it in structures } ?: structures.firstOrNull() ?: ""
        binding.actvStructure.setText(defaultStruct, false)

        // Conductors list
        val conductors = NetworkCatalog.conductorsFor(selectedVoltage)
        val condAdapter = ArrayAdapter(context, android.R.layout.simple_dropdown_item_1line, conductors)
        binding.actvConductor.setAdapter(condAdapter)
        val defaultCond = preselectedConductor?.takeIf { it in conductors } ?: conductors.firstOrNull() ?: ""
        binding.actvConductor.setText(defaultCond, false)

        // Hide Feeder/SS inputs for LT
        binding.feederFieldsContainer.isVisible = selectedVoltage != VoltageLevel.LT
    }

    private fun loadPresets() {
        val preset = PresetPreferences.get(requireContext())

        binding.switchPresetEnabled.isChecked = preset.enabled
        binding.presetInputsContainer.isVisible = preset.enabled

        selectedVoltage = preset.voltage
        when (preset.voltage) {
            VoltageLevel.KV_33 -> binding.cgVoltage.check(R.id.chip33kv)
            VoltageLevel.LT -> binding.cgVoltage.check(R.id.chipLt)
            VoltageLevel.KV_11 -> binding.cgVoltage.check(R.id.chip11kv)
        }

        selectedStatus = preset.status
        when (preset.status) {
            WorkStatus.EXISTING -> binding.cgStatus.check(R.id.chipExisting)
            WorkStatus.PROPOSED -> binding.cgStatus.check(R.id.chipProposed)
        }

        updateDropdowns(
            preselectedMaterial = preset.material.label,
            preselectedStructure = preset.structure.label,
            preselectedConductor = preset.conductor
        )

        binding.etFeederName.setText(preset.feederName)
        binding.etSourceSs.setText(preset.sourceSubstation)

        // Load display preferences
        val unitText = when (preset.displayUnit.lowercase()) {
            "foot" -> "Foot"
            "km" -> "KM"
            else -> "Meter"
        }
        binding.actvDisplayUnit.setText(unitText, false)

        val decimalsText = when (preset.displayDecimals) {
            2 -> "2 Decimals"
            3 -> "3 Decimals"
            else -> "1 Decimal"
        }
        binding.actvDisplayDecimals.setText(decimalsText, false)
    }

    private fun savePresets() {
        val enabled = binding.switchPresetEnabled.isChecked
        val context = requireContext()

        val unitText = binding.actvDisplayUnit.text?.toString() ?: "Meter"
        val decimalsText = binding.actvDisplayDecimals.text?.toString() ?: "1 Decimal"
        val displayUnit = when (unitText) {
            "Foot" -> "foot"
            "KM" -> "km"
            else -> "meter"
        }
        val displayDecimals = when (decimalsText) {
            "2 Decimals" -> 2
            "3 Decimals" -> 3
            else -> 1
        }

        if (!enabled) {
            // Save as disabled, preserve other settings but update display settings
            val current = PresetPreferences.get(context)
            PresetPreferences.save(context, current.copy(
                enabled = false,
                displayUnit = displayUnit,
                displayDecimals = displayDecimals
            ))
            Toast.makeText(context, R.string.preset_saved_toast, Toast.LENGTH_SHORT).show()
            dismiss()
            return
        }

        val matLabel = binding.actvMaterial.text?.toString() ?: ""
        val structLabel = binding.actvStructure.text?.toString() ?: ""
        val cond = binding.actvConductor.text?.toString() ?: ""

        val material = PoleMaterial.fromLabel(matLabel)
        val structure = PoleStructure.fromLabel(structLabel)

        if (material == null || structure == null || cond.isBlank()) {
            Toast.makeText(context, "Invalid configuration selections", Toast.LENGTH_SHORT).show()
            return
        }

        var feeder = ""
        var ss = ""

        if (selectedVoltage != VoltageLevel.LT) {
            feeder = binding.etFeederName.text?.toString()?.trim() ?: ""
            ss = binding.etSourceSs.text?.toString()?.trim() ?: ""

            if (feeder.isBlank() || ss.isBlank()) {
                if (feeder.isBlank()) binding.tilFeederName.error = getString(R.string.feeder_required_error)
                if (ss.isBlank()) binding.tilSourceSs.error = getString(R.string.feeder_required_error)
                return
            }
        }

        binding.tilFeederName.error = null
        binding.tilSourceSs.error = null

        val data = PresetData(
            enabled = true,
            voltage = selectedVoltage,
            status = selectedStatus,
            material = material,
            structure = structure,
            conductor = cond,
            feederName = feeder,
            sourceSubstation = ss,
            displayUnit = displayUnit,
            displayDecimals = displayDecimals
        )

        PresetPreferences.save(context, data)
        Toast.makeText(context, R.string.preset_saved_toast, Toast.LENGTH_SHORT).show()
        dismiss()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "PresetSettingsDialog"
    }
}
