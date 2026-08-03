package com.blackgrapes.slmtoolbox.ui.settings

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.databinding.FragmentPresetSettingsBinding
import com.blackgrapes.slmtoolbox.domain.FieldPresetPackParser
import com.blackgrapes.slmtoolbox.domain.FieldPresetStore
import com.blackgrapes.slmtoolbox.domain.PresetPackException
import com.blackgrapes.slmtoolbox.domain.PresetPreferences
import com.blackgrapes.slmtoolbox.domain.SurveyPresetCatalog
import com.blackgrapes.slmtoolbox.domain.SurveyPresetCategory
import com.blackgrapes.slmtoolbox.domain.SurveyPresetDef
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.seal.SlmSeal
import com.blackgrapes.slmtoolbox.ui.export.ShareHelper
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.tabs.TabLayout
import java.io.File

/**
 * Survey presets: pick a curated short-named combination (Pre / Post),
 * or survey with usual defaults when presets are off.
 */
class PresetSettingsFragment : Fragment() {

    private var _binding: FragmentPresetSettingsBinding? = null
    private val binding get() = _binding!!

    private var activeCategory = SurveyPresetCategory.PRE_EXECUTION
    private var selectedPreId: String? = null
    private var selectedPostId: String? = null

    private val importPackLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            uri?.let { importPresetPack(it) }
        }

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
                activeCategory =
                    if (post) SurveyPresetCategory.POST_EXECUTION
                    else SurveyPresetCategory.PRE_EXECUTION
                binding.preExecPanel.isVisible = !post
                binding.postExecPanel.isVisible = post
            }

            override fun onTabUnselected(tab: TabLayout.Tab) = Unit
            override fun onTabReselected(tab: TabLayout.Tab) = Unit
        })

        setupDisplayDropdowns()
        setupFieldPresets()
        loadPresets()

        binding.switchPresetEnabled.setOnCheckedChangeListener { _, checked ->
            binding.presetInputsContainer.isVisible = checked
            binding.tvUsualDefaultsHint.isVisible = !checked
            if (checked && selectedPreId == null) {
                selectedPreId = SurveyPresetCatalog.preExecution.firstOrNull()?.id
                fillPrePresetRadios()
            }
            updateFeederVisibility()
        }
    }

    private fun setupDisplayDropdowns() {
        val units = listOf("meter", "feet")
        binding.actvDisplayUnit.setAdapter(
            ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, units)
        )
        val decimals = listOf("0", "1", "2")
        binding.actvDisplayDecimals.setAdapter(
            ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, decimals)
        )
    }

    private fun setupFieldPresets() {
        binding.btnImportFieldPresets.setOnClickListener {
            importPackLauncher.launch(
                arrayOf("application/json", "application/octet-stream", "*/*")
            )
        }
        binding.btnExportFieldPresets.setOnClickListener { exportFieldPresets() }
        binding.btnClearFieldPresets.setOnClickListener {
            FieldPresetStore.clear(requireContext())
            renderFieldPresets()
        }
        renderFieldPresets()
    }

    private fun exportFieldPresets() {
        val ctx = requireContext()
        if (FieldPresetStore.getPack(ctx) == null) {
            Toast.makeText(ctx, R.string.field_presets_none, Toast.LENGTH_SHORT).show()
            return
        }
        fun writeAndShare(plain: Boolean) {
            try {
                val pack = FieldPresetStore.getPack(ctx) ?: run {
                    Toast.makeText(ctx, R.string.field_presets_none, Toast.LENGTH_SHORT).show()
                    return
                }
                val packJson = FieldPresetPackParser.toJson(pack)
                val out = if (plain) {
                    packJson
                } else {
                    SlmSeal.seal(ctx, SlmSeal.KIND_PRESET, org.json.JSONObject(packJson))
                }
                val ext = if (plain) "json" else "slmpreset"
                val file = File(ctx.cacheDir, "presets.$ext")
                file.writeText(out)
                ShareHelper.shareFiles(
                    ctx,
                    listOf(file),
                    getString(R.string.field_presets_export),
                    "",
                    if (plain) "application/json" else "application/octet-stream"
                )
            } catch (e: Exception) {
                Toast.makeText(ctx, e.message ?: getString(R.string.export_failed), Toast.LENGTH_LONG)
                    .show()
            }
        }
        if (SlmSeal.isAdmin(ctx)) {
            MaterialAlertDialogBuilder(ctx)
                .setTitle(R.string.field_presets_export)
                .setItems(
                    arrayOf(
                        getString(R.string.field_presets_export_sealed),
                        getString(R.string.field_presets_export_plain)
                    )
                ) { _, which -> writeAndShare(plain = which == 1) }
                .setNegativeButton(R.string.cancel, null)
                .show()
        } else {
            writeAndShare(plain = false)
        }
    }

    private fun importPresetPack(uri: Uri) {
        val ctx = requireContext()
        val json = try {
            ctx.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (_: Exception) {
            null
        }
        if (json.isNullOrBlank()) {
            Toast.makeText(ctx, R.string.field_presets_read_failed, Toast.LENGTH_LONG).show()
            return
        }
        try {
            val opened = SlmSeal.openTransferText(ctx, json, SlmSeal.KIND_PRESET)
            val packJson = opened.payload.toString()
            val pack = FieldPresetStore.importFromJson(ctx, packJson, fileNameOf(uri))
            renderFieldPresets()
            val who = opened.license?.optString("customerName").orEmpty()
            val msg = if (who.isNotBlank()) {
                getString(R.string.field_presets_imported_toast, pack.presets.size) + " · $who"
            } else {
                getString(R.string.field_presets_imported_toast, pack.presets.size)
            }
            Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()
        } catch (e: PresetPackException) {
            Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show()
        } catch (e: IllegalArgumentException) {
            Toast.makeText(ctx, e.message, Toast.LENGTH_LONG).show()
        }
    }

    private fun fileNameOf(uri: Uri): String =
        uri.lastPathSegment?.substringAfterLast('/').orEmpty()

    private fun renderFieldPresets() {
        val ctx = requireContext()
        val presets = FieldPresetStore.list(ctx)
        val container = binding.fieldPresetList
        container.removeAllViews()

        if (presets.isEmpty()) {
            binding.tvFieldPresetStatus.setText(R.string.field_presets_none)
            binding.btnClearFieldPresets.isVisible = false
            return
        }

        val source = FieldPresetStore.sourceName(ctx).ifBlank { getString(R.string.app_name) }
        binding.tvFieldPresetStatus.text =
            getString(R.string.field_presets_status, presets.size, source)
        binding.btnClearFieldPresets.isVisible = true

        val density = resources.displayMetrics.density
        val activeId = FieldPresetStore.getActive(ctx)?.id
        presets.forEach { preset ->
            val row = android.widget.LinearLayout(ctx).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setPadding(0, (8 * density).toInt(), 0, (8 * density).toInt())
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    FieldPresetStore.setActive(ctx, preset.id)
                    renderFieldPresets()
                    Toast.makeText(
                        ctx,
                        "${preset.name} · ${getString(R.string.field_preset_active)}",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
            val name = TextView(ctx).apply {
                text = buildString {
                    append(preset.name)
                    if (preset.id == activeId) append("  ·  ").append(getString(R.string.field_preset_active))
                }
                textSize = 14f
                setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
            }
            val detail = TextView(ctx).apply {
                text = preset.capture.summary()
                textSize = 12f
                setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
            }
            row.addView(name)
            row.addView(detail)
            container.addView(row)
        }
    }

    private fun loadPresets() {
        val data = PresetPreferences.get(requireContext())
        activeCategory = PresetPreferences.getCategory(requireContext())
        selectedPreId = data.def
            ?.takeIf { it.category == SurveyPresetCategory.PRE_EXECUTION }
            ?.id
            ?: SurveyPresetCatalog.preExecution.firstOrNull()?.id
        selectedPostId = data.def
            ?.takeIf { it.category == SurveyPresetCategory.POST_EXECUTION }
            ?.id
            ?: SurveyPresetCatalog.postExecution.firstOrNull()?.id

        if (activeCategory == SurveyPresetCategory.POST_EXECUTION) {
            binding.surveyTypeTabs.getTabAt(1)?.select()
            binding.preExecPanel.isVisible = false
            binding.postExecPanel.isVisible = true
        }

        binding.switchPresetEnabled.isChecked = data.enabled &&
            data.def?.category == SurveyPresetCategory.PRE_EXECUTION
        binding.presetInputsContainer.isVisible = binding.switchPresetEnabled.isChecked
        binding.tvUsualDefaultsHint.isVisible = !binding.switchPresetEnabled.isChecked

        binding.etFeederName.setText(data.feederName)
        binding.etSourceSs.setText(data.sourceSubstation)
        binding.actvDisplayUnit.setText(data.displayUnit, false)
        binding.actvDisplayDecimals.setText(data.displayDecimals.toString(), false)

        fillPrePresetRadios()
        fillPostPresetRadios()
        updateFeederVisibility()
    }

    private fun fillPrePresetRadios() {
        fillNamedPresetGroup(
            group = binding.rgPrePresets,
            presets = SurveyPresetCatalog.preExecution,
            selectedId = selectedPreId,
            includeNone = false
        ) { id ->
            selectedPreId = id
            updateFeederVisibility()
        }
    }

    private fun fillPostPresetRadios() {
        fillNamedPresetGroup(
            group = binding.rgPostPresets,
            presets = SurveyPresetCatalog.postExecution,
            selectedId = selectedPostId,
            includeNone = true
        ) { id ->
            selectedPostId = id
        }
    }

    private fun fillNamedPresetGroup(
        group: RadioGroup,
        presets: List<SurveyPresetDef>,
        selectedId: String?,
        includeNone: Boolean,
        onSelect: (String?) -> Unit
    ) {
        group.setOnCheckedChangeListener(null)
        group.removeAllViews()
        val ctx = requireContext()
        val density = resources.displayMetrics.density

        if (includeNone) {
            val none = RadioButton(ctx).apply {
                id = View.generateViewId()
                tag = ""
                text = getString(R.string.preset_usual_defaults)
                textSize = 15f
                setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
                setPadding(
                    (14 * density).toInt(),
                    (14 * density).toInt(),
                    (14 * density).toInt(),
                    (14 * density).toInt()
                )
                minHeight = (52 * density).toInt()
                isChecked = selectedId.isNullOrBlank()
            }
            group.addView(none, RadioGroup.LayoutParams.MATCH_PARENT, RadioGroup.LayoutParams.WRAP_CONTENT)
        }

        presets.forEach { preset ->
            val button = RadioButton(ctx).apply {
                id = View.generateViewId()
                tag = preset.id
                text = SurveyPresetCatalog.colouredName(ctx, preset)
                textSize = 15f
                setPadding(
                    (14 * density).toInt(),
                    (14 * density).toInt(),
                    (14 * density).toInt(),
                    (14 * density).toInt()
                )
                minHeight = (52 * density).toInt()
                isChecked = preset.id == selectedId
            }
            group.addView(button, RadioGroup.LayoutParams.MATCH_PARENT, RadioGroup.LayoutParams.WRAP_CONTENT)
        }

        if (!includeNone && group.checkedRadioButtonId == View.NO_ID && group.childCount > 0) {
            (group.getChildAt(0) as? RadioButton)?.isChecked = true
        }

        group.setOnCheckedChangeListener { rg, checkedId ->
            if (checkedId == View.NO_ID) return@setOnCheckedChangeListener
            val tag = rg.findViewById<RadioButton>(checkedId)?.tag as? String
            onSelect(tag?.ifBlank { null })
        }
    }

    private fun updateFeederVisibility() {
        val def = SurveyPresetCatalog.byId(selectedPreId)
        binding.feederFieldsContainer.isVisible =
            binding.switchPresetEnabled.isChecked &&
                def != null &&
                def.voltage != VoltageLevel.LT
    }

    private fun saveAll() {
        val ctx = requireContext()
        val unit = binding.actvDisplayUnit.text?.toString()?.ifBlank { "meter" } ?: "meter"
        val decimals = binding.actvDisplayDecimals.text?.toString()?.toIntOrNull() ?: 1

        when (activeCategory) {
            SurveyPresetCategory.PRE_EXECUTION -> {
                val enabled = binding.switchPresetEnabled.isChecked
                val id = if (enabled) selectedPreId ?: selectedRadioId(binding.rgPrePresets) else null
                if (enabled && id.isNullOrBlank()) {
                    Toast.makeText(ctx, R.string.preset_pick_required, Toast.LENGTH_SHORT).show()
                    return
                }
                PresetPreferences.save(
                    context = ctx,
                    enabled = enabled,
                    selectedId = id,
                    category = SurveyPresetCategory.PRE_EXECUTION,
                    feederName = binding.etFeederName.text?.toString().orEmpty(),
                    sourceSubstation = binding.etSourceSs.text?.toString().orEmpty(),
                    displayUnit = unit,
                    displayDecimals = decimals
                )
            }
            SurveyPresetCategory.POST_EXECUTION -> {
                val id = selectedPostId ?: selectedRadioId(binding.rgPostPresets)
                val enabled = !id.isNullOrBlank()
                PresetPreferences.save(
                    context = ctx,
                    enabled = enabled,
                    selectedId = id,
                    category = SurveyPresetCategory.POST_EXECUTION,
                    feederName = binding.etFeederName.text?.toString().orEmpty(),
                    sourceSubstation = binding.etSourceSs.text?.toString().orEmpty(),
                    displayUnit = unit,
                    displayDecimals = decimals
                )
            }
        }

        Toast.makeText(ctx, R.string.preset_saved_toast, Toast.LENGTH_SHORT).show()
        findNavController().navigateUp()
    }

    private fun selectedRadioId(group: RadioGroup): String? {
        val checked = group.checkedRadioButtonId
        if (checked == View.NO_ID) return null
        return group.findViewById<RadioButton>(checked)?.tag as? String
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
