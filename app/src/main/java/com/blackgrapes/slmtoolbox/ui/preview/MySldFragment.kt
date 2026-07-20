package com.blackgrapes.slmtoolbox.ui.preview

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
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
import com.blackgrapes.slmtoolbox.databinding.FragmentMySldBinding
import com.blackgrapes.slmtoolbox.databinding.ItemMySldWorkspaceBinding
import com.blackgrapes.slmtoolbox.domain.LanguagePreferences
import com.blackgrapes.slmtoolbox.domain.SurveyShareSummary
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.ui.export.ExportHelper
import com.blackgrapes.slmtoolbox.ui.export.ShareHelper
import com.blackgrapes.slmtoolbox.ui.survey.SurveyViewModel
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch

class MySldFragment : Fragment() {

    private var _binding: FragmentMySldBinding? = null
    private val binding get() = _binding!!
    private var workspaces: List<Survey> = emptyList()
    private var adapter: WorkspaceHistoryAdapter? = null
    private var languageReady = false

    private val viewModel: SurveyViewModel by activityViewModels {
        SurveyViewModel.Factory((requireActivity().application as SlmApp).repository)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentMySldBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.toolbar.setNavigationOnClickListener { findNavController().navigateUp() }
        setupLanguageChips()

        adapter = WorkspaceHistoryAdapter(
            onOpen = { openWorkspace(it) },
            onShareSummary = { shareSummary(it) },
            onShareJson = { shareJson(it) },
            onLongPress = { confirmDelete(it) }
        )
        binding.sldList.adapter = adapter

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.savedWorkspaces.collect { saved ->
                    workspaces = saved
                    adapter?.submit(saved)
                    binding.emptyText.isVisible = saved.isEmpty()
                }
            }
        }
    }

    private fun setupLanguageChips() {
        val current = LanguagePreferences.getCode(requireContext())
        binding.chipLangEn.isChecked = current == LanguagePreferences.EN
        binding.chipLangBn.isChecked = current == LanguagePreferences.BN
        binding.chipLangHi.isChecked = current == LanguagePreferences.HI
        languageReady = true

        binding.languageChipGroup.setOnCheckedStateChangeListener { _, checkedIds ->
            if (!languageReady || checkedIds.isEmpty()) return@setOnCheckedStateChangeListener
            val code = when (checkedIds.first()) {
                R.id.chipLangBn -> LanguagePreferences.BN
                R.id.chipLangHi -> LanguagePreferences.HI
                else -> LanguagePreferences.EN
            }
            if (code == LanguagePreferences.getCode(requireContext())) return@setOnCheckedStateChangeListener
            LanguagePreferences.setCode(requireContext(), code)
            Toast.makeText(requireContext(), R.string.language_applied, Toast.LENGTH_SHORT).show()
        }
    }

    private fun openWorkspace(survey: Survey) {
        viewModel.openWorkspace(survey.id)
        findNavController().popBackStack(R.id.surveyMapFragment, false)
    }

    private fun shareSummary(survey: Survey) {
        if (survey.assets.isEmpty()) {
            Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            return
        }
        val text = SurveyShareSummary.build(requireContext(), survey)
        ShareHelper.shareText(
            context = requireContext(),
            text = text,
            title = "${survey.title} — Survey Summary"
        )
    }

    private fun shareJson(survey: Survey) {
        if (survey.assets.isEmpty()) {
            Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            return
        }
        viewModel.setProcessing(true, getString(R.string.export_processing_json))
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val seriesMeta = viewModel.getSeriesMetaForSurvey(survey.id)
                val jsonFile = ExportHelper.exportJsonWorkspace(requireContext(), survey, seriesMeta)
                if (jsonFile != null) {
                    ShareHelper.shareFiles(
                        context = requireContext(),
                        files = listOf(jsonFile),
                        title = getString(R.string.share_workspace_json),
                        caption = "SLM Workspace JSON for Desktop Editor: ${survey.title}",
                        mimeType = "application/json"
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

    private fun confirmDelete(survey: Survey) {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.delete_workspace_title)
            .setMessage(getString(R.string.delete_workspace_confirm, survey.title))
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                viewModel.deleteWorkspace(survey.id)
            }
            .show()
    }

    override fun onDestroyView() {
        adapter = null
        _binding = null
        super.onDestroyView()
    }

    private class WorkspaceHistoryAdapter(
        private val onOpen: (Survey) -> Unit,
        private val onShareSummary: (Survey) -> Unit,
        private val onShareJson: (Survey) -> Unit,
        private val onLongPress: (Survey) -> Unit
    ) : BaseAdapter() {

        private var items: List<Survey> = emptyList()

        fun submit(list: List<Survey>) {
            items = list
            notifyDataSetChanged()
        }

        override fun getCount(): Int = items.size
        override fun getItem(position: Int): Survey = items[position]
        override fun getItemId(position: Int): Long = items[position].id

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val binding = if (convertView?.tag is ItemMySldWorkspaceBinding) {
                convertView.tag as ItemMySldWorkspaceBinding
            } else {
                ItemMySldWorkspaceBinding.inflate(LayoutInflater.from(parent.context), parent, false)
                    .also { it.root.tag = it }
            }

            val survey = items[position]
            val ctx = parent.context
            binding.tvDayLabel.text = SurveyShareSummary.formatSurveyDayKey(survey)
            binding.tvTitle.text = survey.title
            binding.tvDate.text = SurveyShareSummary.formatSurveyDate(survey)
            binding.tvStats.text = SurveyShareSummary.compactStats(ctx, survey)

            val showWarn = survey.assets.isNotEmpty() && !survey.isLiveAtSite
            binding.tvLiveWarning.isVisible = showWarn
            if (showWarn) {
                binding.tvLiveWarning.text = ctx.getString(R.string.not_live_at_site)
            }

            binding.btnOpen.setOnClickListener { onOpen(survey) }
            binding.btnShareSummary.setOnClickListener { onShareSummary(survey) }
            binding.btnShareJson.setOnClickListener { onShareJson(survey) }
            binding.root.setOnClickListener { onOpen(survey) }
            binding.root.setOnLongClickListener {
                onLongPress(survey)
                true
            }
            return binding.root
        }
    }
}
