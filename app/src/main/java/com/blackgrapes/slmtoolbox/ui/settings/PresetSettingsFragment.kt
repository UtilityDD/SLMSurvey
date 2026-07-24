package com.blackgrapes.slmtoolbox.ui.settings

import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.databinding.FragmentPresetSettingsBinding
import com.blackgrapes.slmtoolbox.domain.NetworkCatalog
import com.blackgrapes.slmtoolbox.domain.PostExecCatalog
import com.blackgrapes.slmtoolbox.domain.PostExecGroup
import com.blackgrapes.slmtoolbox.domain.PostExecOption
import com.blackgrapes.slmtoolbox.domain.PostExecPreferences
import com.blackgrapes.slmtoolbox.domain.PresetData
import com.blackgrapes.slmtoolbox.domain.PresetPattern
import com.blackgrapes.slmtoolbox.domain.PresetPreferences
import com.blackgrapes.slmtoolbox.domain.model.PoleMaterial
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import com.google.android.material.tabs.TabLayout

/**
 * Full-page survey presets: Pre-execution (existing pole defaults) and
 * Post-execution (grouped line-type picks — UI only for now).
 */
class PresetSettingsFragment : Fragment() {

    private var _binding: FragmentPresetSettingsBinding? = null
    private val binding get() = _binding!!

    private var selectedPattern = PresetPattern.STANDARD
    private var selectedVoltage = VoltageLevel.KV_11
    private var selectedStatus = WorkStatus.PROPOSED

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPresetSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.toolbar.setNavigationOnClickListener { findNavController().navigateUp() }
        binding.btnCancel.setOnClickListener { findNavController().navigateUp() }
        binding.btnSave.setOnClickListener { saveAll() }

        binding.surveyTypeTabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                val post = tab.position == 1
                binding.preExecPanel.isVisible = !post
                binding.postExecPanel.isVisible = post
            }

            override fun onTabUnselected(tab: TabLayout.Tab) = Unit
            override fun onTabReselected(tab: TabLayout.Tab) = Unit
        })

        setupPatternToggle()
        setupVoltageToggle()
        setupStatusToggle()
        setupDisplayDropdowns()
        setupPostExecGroups()
        loadPresets()

        binding.switchPresetEnabled.setOnCheckedChangeListener { _, checked ->
            binding.presetInputsContainer.isVisible = checked
        }
    }

    private fun setupPatternToggle() {
        binding.tgPattern.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            selectedPattern = when (checkedId) {
                R.id.btnPatternDtrLt -> PresetPattern.DTR_LT
                else -> PresetPattern.STANDARD
            }
            applyPatternConstraints()
        }
    }

    private fun setupVoltageToggle() {
        binding.tgVoltage.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            if (selectedPattern == PresetPattern.DTR_LT) return@addOnButtonCheckedListener
            selectedVoltage = when (checkedId) {
                R.id.btn33kv -> VoltageLevel.KV_33
                R.id.btnLt -> VoltageLevel.LT
                else -> VoltageLevel.KV_11
            }
            updateDropdowns(
                binding.actvMaterial.text?.toString(),
                binding.actvStructure.text?.toString(),
                binding.actvConductor.text?.toString()
            )
        }
    }

    private fun setupStatusToggle() {
        binding.tgStatus.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            selectedStatus = when (checkedId) {
                R.id.btnExisting -> WorkStatus.EXISTING
                else -> WorkStatus.PROPOSED
            }
        }
    }

    private fun setupDisplayDropdowns() {
        val ctx = requireContext()
        binding.actvDisplayUnit.setAdapter(
            ArrayAdapter(ctx, android.R.layout.simple_dropdown_item_1line, listOf("Meter", "Foot", "KM"))
        )
        binding.actvDisplayDecimals.setAdapter(
            ArrayAdapter(
                ctx,
                android.R.layout.simple_dropdown_item_1line,
                listOf("1 Decimal", "2 Decimals", "3 Decimals")
            )
        )
    }

    private fun setupPostExecGroups() {
        fillRadioGroup(binding.rgPostDtrLt, PostExecCatalog.optionsDtrLt, PostExecGroup.DTR_LT)
        fillRadioGroup(binding.rgPost33, PostExecCatalog.options33, PostExecGroup.KV_33)
        fillRadioGroup(binding.rgPost11, PostExecCatalog.options11, PostExecGroup.KV_11)
        applyPostExecExclusiveRules()
    }

    private fun fillRadioGroup(
        group: RadioGroup,
        options: List<PostExecOption>,
        postGroup: PostExecGroup
    ) {
        group.removeAllViews()
        val ctx = requireContext()
        val saved = PostExecPreferences.getSelected(ctx, postGroup)
        val density = resources.displayMetrics.density

        // Empty = general settings for this head.
        val none = RadioButton(ctx).apply {
            id = View.generateViewId()
            tag = PostExecPreferences.OPTION_NONE
            text = getString(R.string.post_opt_none_general)
            textSize = 14f
            setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
            setPadding((14 * density).toInt(), (12 * density).toInt(), (14 * density).toInt(), (12 * density).toInt())
            minHeight = (48 * density).toInt()
            isChecked = saved.isEmpty()
        }
        group.addView(none, RadioGroup.LayoutParams.MATCH_PARENT, RadioGroup.LayoutParams.WRAP_CONTENT)

        options.forEach { option ->
            val label = buildString {
                append(getString(option.labelRes))
                if (!option.implemented) append("  ·  ").append(getString(R.string.post_opt_not_implemented_short))
            }
            val button = RadioButton(ctx).apply {
                id = View.generateViewId()
                tag = option.id
                text = label
                textSize = 14f
                setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
                setPadding((14 * density).toInt(), (12 * density).toInt(), (14 * density).toInt(), (12 * density).toInt())
                minHeight = (48 * density).toInt()
                isChecked = option.id == saved
            }
            group.addView(button, RadioGroup.LayoutParams.MATCH_PARENT, RadioGroup.LayoutParams.WRAP_CONTENT)
        }

        group.setOnCheckedChangeListener { rg, checkedId ->
            if (checkedId == View.NO_ID) return@setOnCheckedChangeListener
            val selected = rg.findViewById<RadioButton>(checkedId)?.tag as? String ?: return@setOnCheckedChangeListener
            if (selected.isNotEmpty() && !PostExecPreferences.isImplemented(selected)) {
                Toast.makeText(ctx, R.string.post_opt_not_implemented, Toast.LENGTH_SHORT).show()
            }
            if (postGroup == PostExecGroup.DTR_LT) {
                applyPostExecExclusiveRules()
            }
        }
    }

    /** LT conversion with ABC disables the other post-exec heads. */
    private fun applyPostExecExclusiveRules() {
        val ltConv = selectedRadioId(binding.rgPostDtrLt) == PostExecPreferences.OPTION_LT_CONVERSION_ABC
        binding.rgPost33.isEnabled = !ltConv
        binding.rgPost11.isEnabled = !ltConv
        for (i in 0 until binding.rgPost33.childCount) {
            binding.rgPost33.getChildAt(i).isEnabled = !ltConv
        }
        for (i in 0 until binding.rgPost11.childCount) {
            binding.rgPost11.getChildAt(i).isEnabled = !ltConv
        }
        if (ltConv) {
            // Clear other heads so general settings don't conflict visually.
            binding.rgPost33.clearCheck()
            binding.rgPost11.clearCheck()
            // Re-check "none" if present
            (0 until binding.rgPost33.childCount)
                .map { binding.rgPost33.getChildAt(it) }
                .filterIsInstance<RadioButton>()
                .firstOrNull { it.tag == PostExecPreferences.OPTION_NONE }
                ?.isChecked = true
            (0 until binding.rgPost11.childCount)
                .map { binding.rgPost11.getChildAt(it) }
                .filterIsInstance<RadioButton>()
                .firstOrNull { it.tag == PostExecPreferences.OPTION_NONE }
                ?.isChecked = true
        }
    }

    private fun prefsKey(group: PostExecGroup): String = "post_exec_${group.name}"

    private fun applyPatternConstraints() {
        val dtrLt = selectedPattern == PresetPattern.DTR_LT
        binding.tvPatternHint.isVisible = dtrLt
        binding.btn33kv.isEnabled = !dtrLt
        binding.btn11kv.isEnabled = !dtrLt
        binding.btnLt.isEnabled = !dtrLt
        if (dtrLt) {
            selectedVoltage = VoltageLevel.KV_11
            binding.tgVoltage.check(R.id.btn11kv)
            updateDropdowns(
                binding.actvMaterial.text?.toString(),
                PoleStructure.DTR.label,
                binding.actvConductor.text?.toString()
            )
            binding.tilStructure.isEnabled = false
            binding.actvStructure.isEnabled = false
        } else {
            binding.tilStructure.isEnabled = true
            binding.actvStructure.isEnabled = true
            updateDropdowns(
                binding.actvMaterial.text?.toString(),
                binding.actvStructure.text?.toString(),
                binding.actvConductor.text?.toString()
            )
        }
    }

    private fun updateDropdowns(
        preselectedMaterial: String?,
        preselectedStructure: String?,
        preselectedConductor: String?
    ) {
        val ctx = requireContext()
        val materials = NetworkCatalog.materialsFor(selectedVoltage).map { it.label }
        binding.actvMaterial.setAdapter(
            ArrayAdapter(ctx, android.R.layout.simple_dropdown_item_1line, materials)
        )
        binding.actvMaterial.setText(
            preselectedMaterial?.takeIf { it in materials } ?: materials.firstOrNull().orEmpty(),
            false
        )

        val structures = NetworkCatalog.structuresFor(selectedVoltage).map { it.label }
        binding.actvStructure.setAdapter(
            ArrayAdapter(ctx, android.R.layout.simple_dropdown_item_1line, structures)
        )
        val struct = when {
            selectedPattern == PresetPattern.DTR_LT -> PoleStructure.DTR.label
            else -> preselectedStructure?.takeIf { it in structures } ?: structures.firstOrNull().orEmpty()
        }
        binding.actvStructure.setText(struct, false)

        val conductors = NetworkCatalog.conductorsFor(selectedVoltage)
        binding.actvConductor.setAdapter(
            ArrayAdapter(ctx, android.R.layout.simple_dropdown_item_1line, conductors)
        )
        binding.actvConductor.setText(
            preselectedConductor?.takeIf { it in conductors } ?: conductors.firstOrNull().orEmpty(),
            false
        )

        binding.feederFieldsContainer.isVisible = selectedVoltage != VoltageLevel.LT
        binding.tilStructure.isEnabled = selectedPattern != PresetPattern.DTR_LT
        binding.actvStructure.isEnabled = selectedPattern != PresetPattern.DTR_LT
    }

    private fun loadPresets() {
        val preset = PresetPreferences.get(requireContext())
        binding.switchPresetEnabled.isChecked = preset.enabled
        binding.presetInputsContainer.isVisible = preset.enabled

        selectedPattern = preset.pattern
        binding.tgPattern.check(
            if (preset.pattern == PresetPattern.DTR_LT) R.id.btnPatternDtrLt else R.id.btnPatternStandard
        )

        selectedVoltage = if (preset.pattern == PresetPattern.DTR_LT) {
            VoltageLevel.KV_11
        } else {
            preset.voltage
        }
        binding.tgVoltage.check(
            when (selectedVoltage) {
                VoltageLevel.KV_33 -> R.id.btn33kv
                VoltageLevel.LT -> R.id.btnLt
                else -> R.id.btn11kv
            }
        )

        selectedStatus = preset.status
        binding.tgStatus.check(
            if (preset.status == WorkStatus.EXISTING) R.id.btnExisting else R.id.btnProposed
        )

        updateDropdowns(
            preset.material.label,
            if (preset.pattern == PresetPattern.DTR_LT) PoleStructure.DTR.label else preset.structure.label,
            preset.conductor
        )
        applyPatternConstraints()

        binding.etFeederName.setText(preset.feederName)
        binding.etSourceSs.setText(preset.sourceSubstation)

        binding.actvDisplayUnit.setText(
            when (preset.displayUnit.lowercase()) {
                "foot" -> "Foot"
                "km" -> "KM"
                else -> "Meter"
            },
            false
        )
        binding.actvDisplayDecimals.setText(
            when (preset.displayDecimals) {
                2 -> "2 Decimals"
                3 -> "3 Decimals"
                else -> "1 Decimal"
            },
            false
        )
    }

    private fun selectedRadioId(group: RadioGroup): String? {
        val checked = group.findViewById<RadioButton>(group.checkedRadioButtonId) ?: return null
        return checked.tag as? String
    }

    private fun saveAll() {
        val ctx = requireContext()
        var dtrLtPick = selectedRadioId(binding.rgPostDtrLt).orEmpty()
        var pick33 = selectedRadioId(binding.rgPost33).orEmpty()
        var pick11 = selectedRadioId(binding.rgPost11).orEmpty()

        if (dtrLtPick == PostExecPreferences.OPTION_LT_CONVERSION_ABC) {
            pick33 = PostExecPreferences.OPTION_NONE
            pick11 = PostExecPreferences.OPTION_NONE
        }
        // Unimplemented picks fall back to none (general settings).
        if (dtrLtPick.isNotEmpty() && !PostExecPreferences.isImplemented(dtrLtPick)) {
            Toast.makeText(ctx, R.string.post_opt_not_implemented, Toast.LENGTH_SHORT).show()
            dtrLtPick = PostExecPreferences.OPTION_NONE
        }
        if (pick33.isNotEmpty() && !PostExecPreferences.isImplemented(pick33)) {
            Toast.makeText(ctx, R.string.post_opt_not_implemented, Toast.LENGTH_SHORT).show()
            pick33 = PostExecPreferences.OPTION_NONE
        }
        if (pick11.isNotEmpty() && !PostExecPreferences.isImplemented(pick11)) {
            Toast.makeText(ctx, R.string.post_opt_not_implemented, Toast.LENGTH_SHORT).show()
            pick11 = PostExecPreferences.OPTION_NONE
        }

        PostExecPreferences.saveSelected(ctx, PostExecGroup.DTR_LT, dtrLtPick)
        PostExecPreferences.saveSelected(ctx, PostExecGroup.KV_33, pick33)
        PostExecPreferences.saveSelected(ctx, PostExecGroup.KV_11, pick11)

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

        if (!binding.switchPresetEnabled.isChecked) {
            val current = PresetPreferences.get(ctx)
            PresetPreferences.save(
                ctx,
                current.copy(enabled = false, displayUnit = displayUnit, displayDecimals = displayDecimals)
            )
            Toast.makeText(ctx, R.string.preset_saved_toast, Toast.LENGTH_SHORT).show()
            findNavController().navigateUp()
            return
        }

        val matLabel = binding.actvMaterial.text?.toString().orEmpty()
        val structLabel = if (selectedPattern == PresetPattern.DTR_LT) {
            PoleStructure.DTR.label
        } else {
            binding.actvStructure.text?.toString().orEmpty()
        }
        val cond = binding.actvConductor.text?.toString().orEmpty()
        val material = PoleMaterial.fromLabel(matLabel)
        val structure = PoleStructure.fromLabel(structLabel)
        val voltage = if (selectedPattern == PresetPattern.DTR_LT) VoltageLevel.KV_11 else selectedVoltage

        if (material == null || structure == null || cond.isBlank()) {
            Toast.makeText(ctx, "Invalid configuration selections", Toast.LENGTH_SHORT).show()
            return
        }

        var feeder = ""
        var ss = ""
        if (voltage != VoltageLevel.LT) {
            feeder = binding.etFeederName.text?.toString()?.trim().orEmpty()
            ss = binding.etSourceSs.text?.toString()?.trim().orEmpty()
            if (feeder.isBlank() || ss.isBlank()) {
                if (feeder.isBlank()) binding.tilFeederName.error = getString(R.string.feeder_required_error)
                if (ss.isBlank()) binding.tilSourceSs.error = getString(R.string.feeder_required_error)
                binding.surveyTypeTabs.getTabAt(0)?.select()
                return
            }
        }
        binding.tilFeederName.error = null
        binding.tilSourceSs.error = null

        PresetPreferences.save(
            ctx,
            PresetData(
                enabled = true,
                pattern = selectedPattern,
                voltage = voltage,
                status = selectedStatus,
                material = material,
                structure = structure,
                conductor = cond,
                feederName = feeder,
                sourceSubstation = ss,
                displayUnit = displayUnit,
                displayDecimals = displayDecimals
            )
        )
        Toast.makeText(ctx, R.string.preset_saved_toast, Toast.LENGTH_SHORT).show()
        findNavController().navigateUp()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    companion object {
        private const val UI_PREFS = "slm_post_exec_ui"
    }
}
