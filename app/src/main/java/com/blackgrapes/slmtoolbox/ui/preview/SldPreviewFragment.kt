package com.blackgrapes.slmtoolbox.ui.preview

import android.graphics.Bitmap
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.SlmApp
import com.blackgrapes.slmtoolbox.databinding.FragmentSldPreviewBinding
import com.blackgrapes.slmtoolbox.domain.PrintableSldBuilder
import com.blackgrapes.slmtoolbox.domain.PrintableSldDocument
import com.blackgrapes.slmtoolbox.domain.SurveyShareSummary
import com.blackgrapes.slmtoolbox.domain.SurveyStampFactory
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.ui.export.ExportHelper
import com.blackgrapes.slmtoolbox.ui.export.PrintableSldRenderer
import com.blackgrapes.slmtoolbox.ui.export.ShareHelper
import com.blackgrapes.slmtoolbox.ui.survey.SurveyViewModel
import com.blackgrapes.slmtoolbox.ui.survey.WorkspaceNameResolver
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch

class SldPreviewFragment : Fragment() {

    private var _binding: FragmentSldPreviewBinding? = null
    private val binding get() = _binding!!

    private val viewModel: SurveyViewModel by activityViewModels {
        SurveyViewModel.Factory((requireActivity().application as SlmApp).repository)
    }

    private var ignoringMeta = false
    private var pageIndex = 0
    private var currentDocument: PrintableSldDocument? = null
    private var currentBitmap: Bitmap? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSldPreviewBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.toolbar.setNavigationOnClickListener { findNavController().navigateUp() }
        binding.btnShareSummary.setOnClickListener { shareSurveySummary() }
        binding.btnShareCsv.setOnClickListener { shareGpsCsv() }
        binding.btnSharePng.setOnClickListener { sharePreviewPng() }
        binding.btnExport.setOnClickListener { exportAndShare() }
        binding.btnSaveSld.setOnClickListener { saveToMySld() }
        binding.btnPrevPage.setOnClickListener {
            if (pageIndex > 0) {
                pageIndex--
                showPage()
            }
        }
        binding.btnNextPage.setOnClickListener {
            val doc = currentDocument ?: return@setOnClickListener
            if (pageIndex < doc.pages.lastIndex) {
                pageIndex++
                showPage()
            }
        }

        binding.linemanNameInput.doAfterTextChanged {
            if (!ignoringMeta) persistMeta()
        }
        binding.linemanMobileInput.doAfterTextChanged {
            if (!ignoringMeta) persistMeta()
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.survey.collect { survey ->
                    if (survey == null) return@collect
                    ignoringMeta = true
                    if (binding.linemanNameInput.text?.toString() != survey.linemanName) {
                        binding.linemanNameInput.setText(survey.linemanName)
                    }
                    if (binding.linemanMobileInput.text?.toString() != survey.linemanMobile) {
                        binding.linemanMobileInput.setText(survey.linemanMobile)
                    }
                    ignoringMeta = false
                    binding.btnSaveSld.isVisible =
                        survey.assets.any { it.poleRole == PoleRole.END }
                    binding.liveSiteBanner.isVisible =
                        survey.assets.isNotEmpty() && !survey.isLiveAtSite
                    
                    val seriesMeta = viewModel.getSeriesMetaForSurvey(survey.id)
                    val preset = com.blackgrapes.slmtoolbox.domain.PresetPreferences.get(requireContext())
                    currentDocument = PrintableSldBuilder.build(
                        survey,
                        seriesMeta,
                        displayUnit = preset.displayUnit,
                        displayDecimals = preset.displayDecimals
                    )
                    showPage()
                    
                    val center = survey.assets.firstOrNull()
                    val stamp = SurveyStampFactory.create(
                        requireContext(),
                        binding.linemanNameInput.text?.toString().orEmpty(),
                        binding.linemanMobileInput.text?.toString().orEmpty(),
                        center?.latitude,
                        center?.longitude
                    )
                    binding.stampText.text = stamp.asReadableLines().joinToString("\n")
                }
            }
        }
    }

    private fun persistMeta() {
        val survey = viewModel.survey.value ?: return
        viewModel.updateMeta(
            title = survey.title,
            linemanName = binding.linemanNameInput.text?.toString().orEmpty(),
            linemanMobile = binding.linemanMobileInput.text?.toString().orEmpty()
        )
    }

    private fun showPage() {
        val doc = currentDocument ?: return
        if (doc.pages.isEmpty()) return
        
        pageIndex = pageIndex.coerceIn(0, doc.pages.lastIndex)
        
        // Recycle old bitmap to save memory
        currentBitmap?.recycle()
        
        try {
            val bitmap = PrintableSldRenderer.renderPage(doc.pages[pageIndex])
            currentBitmap = bitmap
            binding.previewImage.setImageBitmap(bitmap)
            
            binding.pageText.text = getString(
                R.string.page_of,
                pageIndex + 1,
                doc.pages.size
            )
            binding.btnPrevPage.isEnabled = pageIndex > 0
            binding.btnNextPage.isEnabled = pageIndex < doc.pages.lastIndex
        } catch (e: OutOfMemoryError) {
            Toast.makeText(requireContext(), "Low memory: could not render page", Toast.LENGTH_SHORT).show()
        }
    }

    private fun exportAndShare() {
        val options = arrayOf(
            getString(R.string.export_option_workspace)
        )
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(getString(R.string.export_options_title))
            .setMessage(getString(R.string.export_desktop_hint))
            .setItems(options) { _, which ->
                when (which) {
                    0 -> shareJsonWorkspace()
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun sharePreviewPng() {
        val survey = viewModel.survey.value ?: return
        if (survey.assets.isEmpty()) {
            Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            return
        }
        viewModel.setProcessing(true, getString(R.string.export_processing_png))
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val seriesMeta = viewModel.getSeriesMetaForSurvey(survey.id)
                val pngFile = ExportHelper.exportPreviewPng(requireContext(), survey, seriesMeta)
                if (pngFile != null) {
                    val caption = SurveyShareSummary.build(requireContext(), survey)
                    ShareHelper.sharePng(
                        context = requireContext(),
                        pngFile = pngFile,
                        title = survey.title,
                        caption = caption
                    )
                    Toast.makeText(requireContext(), R.string.export_ready, Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
                }
            } catch (_: Exception) {
                Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            } finally {
                viewModel.setProcessing(false)
            }
        }
    }

    private fun shareGpsCsv() {
        val survey = viewModel.survey.value ?: return
        if (survey.assets.isEmpty()) {
            Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            return
        }
        viewModel.setProcessing(true, getString(R.string.export_processing_csv))
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val csvFile = ExportHelper.exportGpsCsv(requireContext(), survey)
                if (csvFile != null) {
                    val caption = SurveyShareSummary.build(requireContext(), survey)
                    ShareHelper.shareFiles(
                        context = requireContext(),
                        files = listOf(csvFile),
                        title = "${survey.title} GPS Points",
                        caption = caption,
                        mimeType = "text/csv"
                    )
                    Toast.makeText(requireContext(), R.string.export_ready, Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
                }
            } catch (_: Exception) {
                Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            } finally {
                viewModel.setProcessing(false)
            }
        }
    }

    private fun shareSurveySummary() {
        val survey = viewModel.survey.value ?: return
        if (survey.assets.isEmpty()) {
            Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            return
        }
        val summary = SurveyShareSummary.build(requireContext(), survey)
        ShareHelper.shareText(
            context = requireContext(),
            text = summary,
            title = "${survey.title} — Survey Summary"
        )
    }

    private fun shareJsonWorkspace() {
        val survey = viewModel.survey.value ?: return
        viewModel.setProcessing(true, "Exporting Workspace...")
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val seriesMeta = viewModel.getSeriesMetaForSurvey(survey.id)
                val jsonFile = ExportHelper.exportJsonWorkspace(requireContext(), survey, seriesMeta)
                if (jsonFile != null) {
                    val jsonUri = androidx.core.content.FileProvider.getUriForFile(
                        requireContext(),
                        "${requireContext().packageName}.fileprovider",
                        jsonFile
                    )
                    val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(android.content.Intent.EXTRA_STREAM, jsonUri)
                        putExtra(android.content.Intent.EXTRA_SUBJECT, "${survey.title} Workspace")
                        putExtra(android.content.Intent.EXTRA_TEXT, "SLM Workspace JSON file for survey: ${survey.title}")
                        addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    requireContext().startActivity(android.content.Intent.createChooser(intent, "Share Workspace JSON"))
                } else {
                    Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            } finally {
                viewModel.setProcessing(false)
            }
        }
    }

    private fun saveToMySld() {
        val survey = viewModel.survey.value ?: return
        if (survey.assets.none { it.poleRole == PoleRole.END }) {
            Toast.makeText(requireContext(), R.string.save_requires_end, Toast.LENGTH_SHORT).show()
            return
        }
        viewLifecycleOwner.lifecycleScope.launch {
            val suggestedName = WorkspaceNameResolver.suggest(requireContext(), survey)
            if (!isAdded) return@launch
            val input = EditText(requireContext()).apply {
                hint = getString(R.string.workspace_name_hint)
                setText(suggestedName)
                selectAll()
                setPadding(48, 20, 48, 20)
                isSingleLine = true
            }
            MaterialAlertDialogBuilder(requireContext())
                .setTitle(R.string.save_workspace_title)
                .setView(input)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.save) { _, _ ->
                    val name = input.text?.toString()?.trim().orEmpty().ifBlank { suggestedName }
                    viewLifecycleOwner.lifecycleScope.launch {
                        viewModel.saveWorkspaceAndStartNew(name)
                        if (isAdded) {
                            Toast.makeText(
                                requireContext(),
                                R.string.sld_saved_new_started,
                                Toast.LENGTH_SHORT
                            ).show()
                            findNavController().navigateUp()
                        }
                    }
                }
                .show()
        }
    }

    override fun onDestroyView() {
        currentBitmap?.recycle()
        currentBitmap = null
        currentDocument = null
        _binding = null
        super.onDestroyView()
    }
}
