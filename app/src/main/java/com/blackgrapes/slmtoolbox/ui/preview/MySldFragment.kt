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
import com.blackgrapes.slmtoolbox.data.entity.SavedWorkspaceSummaryRow
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MySldFragment : Fragment() {

    private var _binding: FragmentMySldBinding? = null
    private val binding get() = _binding!!
    private var adapter: WorkspaceHistoryAdapter? = null
    private var historyAdapter: DailyHistoryAdapter? = null
    private var languageReady = false
    private var languageChangePending = false
    private var historyLoaded = false

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
                viewModel.savedWorkspaceSummaries.collect { saved ->
                    adapter?.submit(saved)
                    binding.emptyText.isVisible = saved.isEmpty()
                    // Summaries changed — refresh history next time that tab is opened.
                    historyLoaded = false
                    if (binding.mapsTabs.selectedTabPosition == 1) {
                        loadHistoryIfNeeded()
                    }
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
                if (history) loadHistoryIfNeeded()
            }

            override fun onTabUnselected(tab: TabLayout.Tab) = Unit
            override fun onTabReselected(tab: TabLayout.Tab) = Unit
        })
    }

    /** Full graphs only when History tab is shown (not kept for the list). */
    private fun loadHistoryIfNeeded() {
        if (historyLoaded) return
        viewLifecycleOwner.lifecycleScope.launch {
            val saved = withContext(Dispatchers.IO) {
                viewModel.getSavedWorkspacesWithDetails()
            }
            if (!isAdded || _binding == null) return@launch
            val days = DailySurveyHistory.build(saved)
            historyAdapter?.submit(days)
            binding.historyEmptyText.isVisible = days.isEmpty()
            historyLoaded = true
        }
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

    private fun openWorkspace(row: SavedWorkspaceSummaryRow) {
        viewModel.openWorkspace(row.survey.id)
        findNavController().popBackStack(R.id.surveyMapFragment, false)
    }

    private fun shareSummary(row: SavedWorkspaceSummaryRow) {
        viewLifecycleOwner.lifecycleScope.launch {
            val survey = withContext(Dispatchers.IO) { viewModel.getSurvey(row.survey.id) }
            if (!isAdded) return@launch
            if (survey == null || survey.assets.isEmpty()) {
                Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
                return@launch
            }
            val text = SurveyShareSummary.build(requireContext(), survey)
            ShareHelper.shareText(
                context = requireContext(),
                text = text,
                title = "${survey.title} — Survey Summary"
            )
        }
    }

    private fun shareJson(row: SavedWorkspaceSummaryRow) {
        if (row.poleCount <= 0) {
            Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
            return
        }
        val ctx = requireContext()
        if (com.blackgrapes.slmtoolbox.seal.SlmSeal.isAdmin(ctx)) {
            MaterialAlertDialogBuilder(ctx)
                .setTitle(R.string.share_map_format_title)
                .setItems(
                    arrayOf(
                        getString(R.string.share_map_sealed),
                        getString(R.string.share_map_plain_admin)
                    )
                ) { _, which ->
                    doShareMap(row.survey.id, row.survey.title, plainJson = which == 1)
                }
                .setNegativeButton(R.string.cancel, null)
                .show()
        } else {
            doShareMap(row.survey.id, row.survey.title, plainJson = false)
        }
    }

    private fun doShareMap(surveyId: Long, title: String, plainJson: Boolean) {
        viewModel.setProcessing(true, getString(R.string.export_processing_json))
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    val survey = viewModel.getSurvey(surveyId) ?: return@withContext null
                    if (survey.assets.isEmpty()) return@withContext null
                    val seriesMeta = viewModel.getSeriesMetaForSurvey(survey.id)
                    if (plainJson) {
                        ExportHelper.exportJsonWorkspace(requireContext(), survey, seriesMeta)
                    } else {
                        ExportHelper.exportSealedWorkspace(requireContext(), survey, seriesMeta)
                    }
                }
                if (!isAdded) return@launch
                if (file != null) {
                    ShareHelper.shareFiles(
                        context = requireContext(),
                        files = listOf(file),
                        title = getString(
                            if (plainJson) R.string.share_workspace_json
                            else R.string.share_workspace_sealed
                        ),
                        caption = getString(
                            if (plainJson) R.string.share_workspace_json_caption
                            else R.string.share_workspace_sealed_caption,
                            title
                        ),
                        mimeType = if (plainJson) "application/json" else "application/octet-stream"
                    )
                    Toast.makeText(requireContext(), R.string.export_ready, Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
                }
            } catch (_: Exception) {
                if (isAdded) {
                    Toast.makeText(requireContext(), R.string.export_failed, Toast.LENGTH_SHORT).show()
                }
            } finally {
                viewModel.setProcessing(false)
            }
        }
    }

    private fun confirmDelete(row: SavedWorkspaceSummaryRow) {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.delete_workspace_title)
            .setMessage(getString(R.string.delete_workspace_confirm, row.survey.title))
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                viewModel.deleteWorkspace(row.survey.id)
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
        private val onOpen: (SavedWorkspaceSummaryRow) -> Unit,
        private val onShareSummary: (SavedWorkspaceSummaryRow) -> Unit,
        private val onShareJson: (SavedWorkspaceSummaryRow) -> Unit,
        private val onLongPress: (SavedWorkspaceSummaryRow) -> Unit
    ) : BaseAdapter() {

        private var items: List<SavedWorkspaceSummaryRow> = emptyList()
        private val dateFmt = SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault())

        fun submit(list: List<SavedWorkspaceSummaryRow>) {
            items = list
            notifyDataSetChanged()
        }

        override fun getCount(): Int = items.size
        override fun getItem(position: Int): SavedWorkspaceSummaryRow = items[position]
        override fun getItemId(position: Int): Long = items[position].survey.id

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val binding = if (convertView?.tag is ItemMySldWorkspaceBinding) {
                convertView.tag as ItemMySldWorkspaceBinding
            } else {
                ItemMySldWorkspaceBinding.inflate(LayoutInflater.from(parent.context), parent, false)
                    .also { it.root.tag = it }
            }

            val row = items[position]
            val survey = row.survey
            binding.tvTitle.text = survey.title
            val whenMs = survey.savedAt
                ?: survey.updatedAt.takeIf { it > 0 }
                ?: survey.createdAt
            binding.tvMeta.text = buildString {
                append(dateFmt.format(Date(whenMs)))
                append(" · ")
                append("${row.poleCount} poles · ${row.spanCount} spans")
            }

            binding.tvLiveWarning.isVisible = row.poleCount > 0 && !row.isLiveAtSite

            binding.btnShareSummary.setOnClickListener { onShareSummary(row) }
            binding.btnShareJson.setOnClickListener { onShareJson(row) }
            binding.root.setOnClickListener { onOpen(row) }
            binding.root.setOnLongClickListener {
                onLongPress(row)
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
