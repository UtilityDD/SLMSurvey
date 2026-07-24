package com.blackgrapes.slmtoolbox.ui.preview

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import com.blackgrapes.slmtoolbox.databinding.ItemDailyHistoryBinding
import com.blackgrapes.slmtoolbox.databinding.ItemMySldWorkspaceBinding
import com.blackgrapes.slmtoolbox.domain.DailyHistoryEntry
import com.blackgrapes.slmtoolbox.domain.DailySurveyHistory
import com.blackgrapes.slmtoolbox.domain.LanguagePreferences
import com.blackgrapes.slmtoolbox.domain.PresetPreferences
import com.blackgrapes.slmtoolbox.domain.SurveyMetrics
import com.blackgrapes.slmtoolbox.domain.SurveyShareSummary
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.ui.export.ExportHelper
import com.blackgrapes.slmtoolbox.ui.export.ShareHelper
import com.blackgrapes.slmtoolbox.ui.survey.SurveyViewModel
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.tabs.TabLayout
import kotlinx.coroutines.launch

class MySldFragment : Fragment() {

    private var _binding: FragmentMySldBinding? = null
    private val binding get() = _binding!!
    private var workspaces: List<Survey> = emptyList()
    private var adapter: WorkspaceHistoryAdapter? = null
    private var historyAdapter: DailyHistoryAdapter? = null
    private var languageReady = false
    private var languageChangePending = false

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
        setupTabs()

        adapter = WorkspaceHistoryAdapter(
            onOpen = { openWorkspace(it) },
            onShareSummary = { shareSummary(it) },
            onShareJson = { shareJson(it) },
            onLongPress = { confirmDelete(it) }
        )
        binding.sldList.adapter = adapter

        historyAdapter = DailyHistoryAdapter(
            onCopy = { copyDaySummary(it) },
            onDelete = { confirmDeleteDay(it) }
        )
        binding.historyList.adapter = historyAdapter

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.savedWorkspaces.collect { saved ->
                    workspaces = saved
                    adapter?.submit(saved)
                    binding.emptyText.isVisible = saved.isEmpty()
                    val days = DailySurveyHistory.build(saved)
                    historyAdapter?.submit(days)
                    binding.historyEmptyText.isVisible = days.isEmpty()
                }
            }
        }
    }

    private fun setupTabs() {
        binding.mapsTabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                val history = tab.position == 1
                binding.mapsPanel.isVisible = !history
                binding.historyPanel.isVisible = history
            }

            override fun onTabUnselected(tab: TabLayout.Tab) = Unit
            override fun onTabReselected(tab: TabLayout.Tab) = Unit
        })
    }

    private fun setupLanguageChips() {
        val current = LanguagePreferences.getCode(requireContext())
        languageReady = false
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
            if (languageChangePending) return@setOnCheckedStateChangeListener
            languageChangePending = true
            languageReady = false
            LanguagePreferences.setCode(requireContext(), code)
            LanguagePreferences.restartForLanguage(requireActivity())
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
                        caption = getString(R.string.share_workspace_json_caption, survey.title),
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

    private fun copyDaySummary(entry: DailyHistoryEntry) {
        val preset = PresetPreferences.get(requireContext())
        val text = DailySurveyHistory.formatCopyText(
            entry,
            preset.displayUnit,
            preset.displayDecimals
        )
        val clipboard = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("SLM Daily Summary", text))
        Toast.makeText(requireContext(), R.string.history_copied, Toast.LENGTH_SHORT).show()
    }

    private fun confirmDeleteDay(entry: DailyHistoryEntry) {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.history_delete_day_title)
            .setMessage(getString(R.string.history_delete_day_confirm, entry.displayDate))
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                entry.workspaceIds.forEach { viewModel.deleteWorkspace(it) }
            }
            .show()
    }

    override fun onDestroyView() {
        adapter = null
        historyAdapter = null
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
            binding.tvTitle.text = survey.title
            binding.tvMeta.text = buildString {
                append(SurveyShareSummary.formatSurveyDate(survey))
                append(" · ")
                append(SurveyShareSummary.compactStats(ctx, survey))
            }

            val showWarn = survey.assets.isNotEmpty() && !survey.isLiveAtSite
            binding.tvLiveWarning.isVisible = showWarn

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

    private class DailyHistoryAdapter(
        private val onCopy: (DailyHistoryEntry) -> Unit,
        private val onDelete: (DailyHistoryEntry) -> Unit
    ) : BaseAdapter() {

        private var items: List<DailyHistoryEntry> = emptyList()

        fun submit(list: List<DailyHistoryEntry>) {
            items = list
            notifyDataSetChanged()
        }

        override fun getCount(): Int = items.size
        override fun getItem(position: Int): DailyHistoryEntry = items[position]
        override fun getItemId(position: Int): Long = items[position].dayKey.hashCode().toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val binding = if (convertView?.tag is ItemDailyHistoryBinding) {
                convertView.tag as ItemDailyHistoryBinding
            } else {
                ItemDailyHistoryBinding.inflate(LayoutInflater.from(parent.context), parent, false)
                    .also { it.root.tag = it }
            }

            val entry = items[position]
            val ctx = parent.context
            val preset = PresetPreferences.get(ctx)
            val route = SurveyMetrics.formatDistance(
                entry.totalRouteM,
                preset.displayUnit,
                preset.displayDecimals
            )

            binding.tvDayTitle.text = entry.displayDate
            binding.tvDaySummary.text = ctx.getString(
                R.string.history_day_summary,
                entry.totalPoles,
                route,
                entry.surveys.size
            )
            binding.tvDayBreakdown.text = entry.polesByType.joinToString(" · ") { (cat, count) ->
                "$cat $count"
            }.ifBlank { "—" }

            binding.btnCopyDay.setOnClickListener { onCopy(entry) }
            binding.btnDeleteDay.setOnClickListener { onDelete(entry) }
            return binding.root
        }
    }
}
