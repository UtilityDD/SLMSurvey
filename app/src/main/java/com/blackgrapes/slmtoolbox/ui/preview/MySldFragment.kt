package com.blackgrapes.slmtoolbox.ui.preview

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
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
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.ui.survey.SurveyViewModel
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MySldFragment : Fragment() {

    private var _binding: FragmentMySldBinding? = null
    private val binding get() = _binding!!
    private var workspaces: List<Survey> = emptyList()

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
        
        binding.sldList.setOnItemClickListener { _, _, position, _ ->
            viewModel.openWorkspace(workspaces[position].id)
            findNavController().popBackStack(R.id.surveyMapFragment, false)
        }

        binding.sldList.setOnItemLongClickListener { _, _, position, _ ->
            val workspace = workspaces[position]
            MaterialAlertDialogBuilder(requireContext())
                .setTitle(R.string.delete_workspace_title)
                .setMessage(getString(R.string.delete_workspace_confirm, workspace.title))
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.delete) { _, _ ->
                    viewModel.deleteWorkspace(workspace.id)
                }
                .show()
            true
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.savedWorkspaces.collect { saved ->
                    workspaces = saved
                    binding.sldList.adapter = ArrayAdapter(
                        requireContext(),
                        android.R.layout.simple_list_item_1,
                        saved.map { workspace ->
                            val date = workspace.savedAt?.let {
                                SimpleDateFormat(
                                    "dd MMM yyyy, hh:mm a",
                                    Locale.getDefault()
                                ).format(Date(it))
                            }.orEmpty()
                            val live = if (workspace.assets.isNotEmpty() && !workspace.isLiveAtSite) {
                                "⚠ Not verified live at site"
                            } else {
                                null
                            }
                            listOfNotNull(workspace.title, date, live).joinToString("\n")
                        }
                    )
                    binding.emptyText.isVisible = saved.isEmpty()
                }
            }
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
