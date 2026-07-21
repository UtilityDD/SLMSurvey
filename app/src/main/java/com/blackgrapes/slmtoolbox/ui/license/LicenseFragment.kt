package com.blackgrapes.slmtoolbox.ui.license

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.databinding.FragmentLicenseBinding
import com.blackgrapes.slmtoolbox.license.LicenseAccess
import com.blackgrapes.slmtoolbox.license.LicenseApi
import com.blackgrapes.slmtoolbox.license.LicenseConfig
import com.blackgrapes.slmtoolbox.license.LicensePreferences
import com.blackgrapes.slmtoolbox.license.LicenseResult
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class LicenseFragment : Fragment() {

    private var _binding: FragmentLicenseBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentLicenseBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        if (!LicenseConfig.enabled) {
            goToSurvey()
            return
        }

        refreshStatusLabel()
        maybeEnterIfAlreadyAllowed()

        binding.btnActivate.setOnClickListener {
            val code = binding.etLicenseCode.text?.toString()?.trim().orEmpty()
            if (code.isBlank()) {
                binding.tilLicenseCode.error = getString(R.string.license_code_required)
                return@setOnClickListener
            }
            binding.tilLicenseCode.error = null
            setBusy(true)
            viewLifecycleOwner.lifecycleScope.launch {
                when (val result = LicenseApi.activate(requireContext(), code)) {
                    is LicenseResult.Success -> showActivatedDialog()
                    is LicenseResult.Failure -> {
                        binding.tvLicenseStatus.text = errorMessage(result.code)
                        Toast.makeText(requireContext(), errorMessage(result.code), Toast.LENGTH_LONG)
                            .show()
                    }
                }
                setBusy(false)
            }
        }

        // Quiet revalidate if already activated
        viewLifecycleOwner.lifecycleScope.launch {
            LicenseApi.refreshIfNeeded(requireContext())
            if (_binding == null) return@launch
            refreshStatusLabel()
            maybeEnterIfAlreadyAllowed()
        }
    }

    private fun showActivatedDialog() {
        if (!isAdded) return
        val snap = LicensePreferences.read(requireContext())
        val date = formatDate(snap.expiresAtEpochMs)
        val days = snap.daysRemaining()
        val message = if (snap.isTrial) {
            getString(R.string.license_activated_trial_detail, date, days)
        } else {
            getString(
                R.string.license_activated_detail,
                snap.customerName.ifBlank { "—" },
                date,
                days
            )
        }
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(
                if (snap.isTrial) R.string.license_trial_title
                else R.string.license_activated_title
            )
            .setMessage(message)
            .setPositiveButton(R.string.license_continue) { _, _ -> goToSurvey() }
            .setCancelable(false)
            .show()
        refreshStatusLabel()
    }

    private fun maybeEnterIfAlreadyAllowed() {
        when (val access = LicensePreferences.evaluateAccess(requireContext())) {
            is LicenseAccess.Allowed, is LicenseAccess.Grace, is LicenseAccess.DevUnlocked -> goToSurvey()
            is LicenseAccess.Locked -> Unit
        }
    }

    private fun refreshStatusLabel() {
        val snap = LicensePreferences.read(requireContext())
        binding.tvLicenseStatus.text = when (val access = LicensePreferences.evaluateAccess(requireContext())) {
            is LicenseAccess.Allowed -> {
                val date = formatDate(access.expiresAtEpochMs)
                val days = snap.daysRemaining()
                if (snap.isTrial) {
                    getString(R.string.license_status_trial, date, days)
                } else {
                    getString(
                        R.string.license_status_active,
                        snap.customerName.ifBlank { "—" },
                        date,
                        days
                    )
                }
            }
            is LicenseAccess.Grace -> getString(
                R.string.license_status_grace,
                formatDate(access.graceEndsAtMs)
            )
            is LicenseAccess.Locked -> getString(R.string.license_status_locked, errorMessage(access.reason))
            is LicenseAccess.DevUnlocked -> getString(R.string.license_status_dev)
        }
    }

    private fun setBusy(busy: Boolean) {
        binding.progressLicense.isVisible = busy
        binding.btnActivate.isEnabled = !busy
        binding.etLicenseCode.isEnabled = !busy
    }

    private fun goToSurvey() {
        if (!isAdded) return
        findNavController().navigate(R.id.action_license_to_survey)
    }

    private fun formatDate(epochMs: Long): String =
        SimpleDateFormat("dd MMM yyyy", Locale.US).format(Date(epochMs))

    private fun errorMessage(code: String): String = when (code) {
        "invalid_code" -> getString(R.string.license_err_invalid)
        "expired" -> getString(R.string.license_err_expired)
        "blocked" -> getString(R.string.license_err_blocked)
        "device_limit" -> getString(R.string.license_err_device_limit)
        "not_activated" -> getString(R.string.license_err_not_activated)
        "functions_missing" -> getString(R.string.license_err_functions_missing)
        "network" -> getString(R.string.license_err_network)
        else -> getString(R.string.license_err_generic, code)
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
