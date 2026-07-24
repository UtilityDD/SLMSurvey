package com.blackgrapes.slmtoolbox.ui.survey

import android.view.LayoutInflater
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.databinding.DialogSaveWorkspaceBinding
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.google.android.material.dialog.MaterialAlertDialogBuilder

object SaveWorkspaceDialog {

    fun show(
        fragment: Fragment,
        survey: Survey,
        suggestedName: String,
        onSave: (workspaceName: String, surveyorName: String, surveyorMobile: String) -> Unit
    ) {
        val ctx = fragment.requireContext()
        val binding = DialogSaveWorkspaceBinding.inflate(LayoutInflater.from(ctx))
        binding.etWorkspaceName.setText(suggestedName)
        binding.etWorkspaceName.selectAll()
        binding.etSurveyorName.setText(survey.linemanName)
        binding.etSurveyorMobile.setText(survey.linemanMobile)

        val dialog = MaterialAlertDialogBuilder(ctx)
            .setTitle(R.string.save_workspace_title)
            .setView(binding.root)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.save, null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val name = binding.etWorkspaceName.text?.toString()?.trim().orEmpty()
                    .ifBlank { suggestedName }
                val surveyor = binding.etSurveyorName.text?.toString()?.trim().orEmpty()
                val mobile = binding.etSurveyorMobile.text?.toString()?.trim().orEmpty()
                if (surveyor.isBlank() || mobile.isBlank()) {
                    Toast.makeText(ctx, R.string.save_requires_surveyor, Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                dialog.dismiss()
                onSave(name, surveyor, mobile)
            }
        }
        dialog.show()
    }
}
