package com.blackgrapes.slmtoolbox.ui.preview

import android.graphics.Bitmap
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.SlmApp
import com.blackgrapes.slmtoolbox.databinding.FragmentSldPreviewBinding
import com.blackgrapes.slmtoolbox.domain.PresetPreferences
import com.blackgrapes.slmtoolbox.domain.SurveyMetrics
import com.blackgrapes.slmtoolbox.domain.SurveyShareSummary
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import com.blackgrapes.slmtoolbox.ui.survey.SaveWorkspaceDialog
import com.blackgrapes.slmtoolbox.ui.survey.SurveyViewModel
import com.blackgrapes.slmtoolbox.ui.survey.WorkspaceNameResolver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Clean, read-only workspace preview: zoomable map sketch, legend, network summary,
 * Save to My Maps, and Exit. Share / SLD / desktop export live on My Maps only.
 */
class SldPreviewFragment : Fragment() {

    private var _binding: FragmentSldPreviewBinding? = null
    private val binding get() = _binding!!

    private val viewModel: SurveyViewModel by activityViewModels {
        SurveyViewModel.Factory((requireActivity().application as SlmApp).repository)
    }

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
        binding.btnExit.setOnClickListener { findNavController().navigateUp() }
        binding.btnSaveSld.setOnClickListener { saveToMyMaps() }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.survey.collect { survey ->
                    if (survey == null) return@collect
                    binding.btnSaveSld.isVisible =
                        survey.assets.any { it.poleRole == PoleRole.END }
                    binding.liveSiteBanner.isVisible =
                        survey.assets.isNotEmpty() && !survey.isLiveAtSite
                    binding.tvNetworkSummary.text = buildNetworkSummary(survey)
                    renderPreview(survey)
                }
            }
        }
    }

    private fun buildNetworkSummary(survey: Survey): String {
        val preset = PresetPreferences.get(requireContext())
        val route = SurveyMetrics.formatDistance(
            SurveyMetrics.routeLengthMetres(survey),
            preset.displayUnit,
            preset.displayDecimals
        )
        val existing = survey.assets.count { it.status == WorkStatus.EXISTING }
        val proposed = survey.assets.size - existing
        val structures = SurveyMetrics.structureCounts(survey)
            .entries
            .joinToString(" · ") { "${it.key.label} ${it.value}" }
            .ifBlank { "—" }
        return buildString {
            append(survey.title.ifBlank { getString(R.string.sld_preview_title) })
            append('\n')
            append(SurveyShareSummary.compactStats(requireContext(), survey))
            append('\n')
            append("Existing $existing · Proposed $proposed · $route")
            append('\n')
            append(structures)
            val extra = SurveyMetrics.extraPoleCount(survey)
            if (extra > 0) {
                append('\n')
                append(getString(R.string.legend_extra_poles, extra))
            }
        }
    }

    private fun renderPreview(survey: Survey) {
        viewLifecycleOwner.lifecycleScope.launch {
            val bitmap = try {
                withContext(Dispatchers.Default) {
                    WorkspacePreviewRenderer.render(requireContext(), survey)
                }
            } catch (_: OutOfMemoryError) {
                null
            }
            if (!isAdded || _binding == null) {
                bitmap?.recycle()
                return@launch
            }
            if (bitmap == null) {
                Toast.makeText(requireContext(), R.string.preview_low_memory, Toast.LENGTH_SHORT).show()
                return@launch
            }
            currentBitmap?.recycle()
            currentBitmap = bitmap
            binding.previewImage.setImageBitmap(bitmap)
            binding.previewImage.resetZoom()
        }
    }

    private fun saveToMyMaps() {
        val survey = viewModel.survey.value ?: return
        if (survey.assets.none { it.poleRole == PoleRole.END }) {
            Toast.makeText(requireContext(), R.string.save_requires_end, Toast.LENGTH_SHORT).show()
            return
        }
        viewLifecycleOwner.lifecycleScope.launch {
            val suggestedName = WorkspaceNameResolver.suggest(requireContext(), survey)
            if (!isAdded) return@launch
            SaveWorkspaceDialog.show(this@SldPreviewFragment, survey, suggestedName) { name, surveyor, mobile ->
                viewLifecycleOwner.lifecycleScope.launch {
                    viewModel.updateMeta(title = name, linemanName = surveyor, linemanMobile = mobile)
                    val replaced = viewModel.saveWorkspaceAndStartNew(name)
                    if (isAdded) {
                        Toast.makeText(
                            requireContext(),
                            if (replaced) R.string.workspace_replaced else R.string.workspace_created,
                            Toast.LENGTH_SHORT
                        ).show()
                        findNavController().navigateUp()
                    }
                }
            }
        }
    }

    override fun onDestroyView() {
        currentBitmap?.recycle()
        currentBitmap = null
        _binding = null
        super.onDestroyView()
    }
}
