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

    /** Prevents double navigate (sync + coroutine) which crashes the app on open. */
    private var navigatedToSurvey = false

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
                        if (_binding == null) return@launch
                        binding.tvLicenseStatus.text = errorMessage(result.code)
                        Toast.makeText(requireContext(), errorMessage(result.code), Toast.LENGTH_LONG)
                            .show()
                    }
                }
                if (_binding != null) setBusy(false)
            }
        }

        // Single path: refresh once, then enter if allowed (avoids double navigate crash).
        viewLifecycleOwner.lifecycleScope.launch {
            LicenseApi.refreshIfNeeded(requireContext())
            if (!isAdded || _binding == null || navigatedToSurvey) return@launch
            refreshStatusLabel()
            maybeEnterIfAlreadyAllowed()
        }
    }

    private fun showActivatedDialog() {
        if (!isAdded || navigatedToSurvey) return
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
        if (_binding != null) refreshStatusLabel()
    }

    private fun maybeEnterIfAlreadyAllowed() {
        when (val access = LicensePreferences.evaluateAccess(requireContext())) {
            is LicenseAccess.Allowed, is LicenseAccess.Grace, is LicenseAccess.DevUnlocked -> goToSurvey()
            is LicenseAccess.Locked -> Unit
        }
    }

    private fun refreshStatusLabel() {
        val b = _binding ?: return
        val snap = LicensePreferences.read(requireContext())
        b.tvLicenseStatus.text = when (val access = LicensePreferences.evaluateAccess(requireContext())) {
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
        val b = _binding ?: return
        b.progressLicense.isVisible = busy
        b.btnActivate.isEnabled = !busy
        b.etLicenseCode.isEnabled = !busy
    }

    private fun goToSurvey() {
        if (!isAdded || navigatedToSurvey) return
        val nav = try {
            findNavController()
        } catch (_: Exception) {
            return
        }
        if (nav.currentDestination?.id != R.id.licenseFragment) return
        if (nav.currentDestination?.getAction(R.id.action_license_to_survey) == null) return
        navigatedToSurvey = true
        try {
            nav.navigate(R.id.action_license_to_survey)
        } catch (_: IllegalArgumentException) {
            navigatedToSurvey = false
        }
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
