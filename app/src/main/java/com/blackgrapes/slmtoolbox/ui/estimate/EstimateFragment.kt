package com.blackgrapes.slmtoolbox.ui.estimate

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import com.blackgrapes.slmtoolbox.databinding.FragmentEstimateBinding
import com.blackgrapes.slmtoolbox.databinding.ItemEstimateLineBinding
import com.blackgrapes.slmtoolbox.estimate.CatalogCache
import com.blackgrapes.slmtoolbox.estimate.EstimateLine
import com.blackgrapes.slmtoolbox.estimate.EstimateLineKind
import com.blackgrapes.slmtoolbox.estimate.EstimateMatcher
import com.blackgrapes.slmtoolbox.estimate.EstimateReport
import com.blackgrapes.slmtoolbox.ui.survey.SurveyViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class EstimateFragment : Fragment() {

    private var _binding: FragmentEstimateBinding? = null
    private val binding get() = _binding!!
    private var lastReport: EstimateReport? = null

    private val viewModel: SurveyViewModel by activityViewModels {
        SurveyViewModel.Factory((requireActivity().application as SlmApp).repository)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentEstimateBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.toolbar.setNavigationOnClickListener { findNavController().navigateUp() }
        binding.toolbar.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                R.id.action_share_estimate -> {
                    shareReport()
                    true
                }
                else -> false
            }
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.survey.collect { survey ->
                    if (survey == null) {
                        binding.tvSummary.text = getString(R.string.estimate_no_survey)
                        binding.estimateList.removeAllViews()
                        return@collect
                    }
                    val report = withContext(Dispatchers.Default) {
                        EstimateMatcher.build(
                            survey = survey,
                            matrix = CatalogCache.readKitMatrixJson(requireContext()),
                            edits = CatalogCache.readKitEditsJson(requireContext()),
                            catalogVersion = CatalogCache.versionLabel(requireContext())
                        )
                    }
                    lastReport = report
                    render(report)
                }
            }
        }
    }

    private fun render(report: EstimateReport) {
        binding.tvSummary.text = buildString {
            if (report.catalogVersion.isNotBlank()) {
                append(getString(R.string.estimate_catalog, report.catalogVersion))
                append("\n")
            }
            append(
                getString(
                    R.string.estimate_summary,
                    report.proposedPoles,
                    report.readyPoles,
                    report.matchedStructures
                )
            )
            if (report.matchedConductorKm > 0) {
                append("\n")
                append(
                    getString(
                        R.string.estimate_conductor_km,
                        report.matchedConductorKm
                    )
                )
            }
        }
        binding.estimateList.removeAllViews()
        if (report.lines.isEmpty() && report.gaps.isEmpty()) {
            addSectionHeader(getString(R.string.estimate_empty))
            return
        }
        if (report.lines.isNotEmpty()) {
            addSectionHeader(getString(R.string.estimate_boq))
            report.lines.forEach { addLine(it) }
        }
        if (report.gaps.isNotEmpty()) {
            addSectionHeader(getString(R.string.estimate_gaps))
            report.gaps.forEach { addLine(it) }
        }
    }

    private fun addSectionHeader(text: String) {
        val tv = android.widget.TextView(requireContext()).apply {
            this.text = text
            setTextColor(resources.getColor(R.color.text_primary, null))
            textSize = 13f
            setPadding(4, 16, 4, 8)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        binding.estimateList.addView(tv)
    }

    private fun addLine(line: EstimateLine) {
        val item = ItemEstimateLineBinding.inflate(layoutInflater, binding.estimateList, false)
        item.tvKind.text = when (line.kind) {
            EstimateLineKind.STRUCTURE -> getString(R.string.estimate_kind_structure)
            EstimateLineKind.CONDUCTOR -> getString(R.string.estimate_kind_conductor)
            EstimateLineKind.GAP -> getString(R.string.estimate_kind_gap)
        }
        item.tvTitle.text = line.title
        if (line.kind == EstimateLineKind.GAP && line.qty <= 0) {
            item.tvQty.isVisible = false
        } else {
            item.tvQty.isVisible = true
            val qtyText = if (line.qty == line.qty.toLong().toDouble()) {
                line.qty.toLong().toString()
            } else {
                "%.3f".format(line.qty)
            }
            item.tvQty.text = if (line.unit.isBlank()) qtyText else "$qtyText ${line.unit}"
        }
        if (!line.detail.isNullOrBlank()) {
            item.tvDetail.isVisible = true
            item.tvDetail.text = line.detail
        } else {
            item.tvDetail.isVisible = false
        }
        if (line.kind == EstimateLineKind.GAP) {
            item.tvKind.setTextColor(resources.getColor(R.color.error, null))
        }
        binding.estimateList.addView(item.root)
    }

    private fun shareReport() {
        val text = lastReport?.asShareText() ?: return
        val cm = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("estimate", text))
        Toast.makeText(requireContext(), R.string.estimate_copied, Toast.LENGTH_SHORT).show()
        val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(android.content.Intent.EXTRA_TEXT, text)
            putExtra(android.content.Intent.EXTRA_SUBJECT, getString(R.string.estimate_title))
        }
        startActivity(android.content.Intent.createChooser(send, getString(R.string.estimate_share)))
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
