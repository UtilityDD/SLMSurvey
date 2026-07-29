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
import com.blackgrapes.slmtoolbox.databinding.DialogLicenseAdminEditBinding
import com.blackgrapes.slmtoolbox.databinding.FragmentLicenseAdminBinding
import com.blackgrapes.slmtoolbox.databinding.ItemLicenseAdminBinding
import com.blackgrapes.slmtoolbox.license.AdminLicenseRow
import com.blackgrapes.slmtoolbox.license.LicenseAdminApi
import com.blackgrapes.slmtoolbox.license.LicenseAdminResult
import com.blackgrapes.slmtoolbox.license.LicenseApi
import com.blackgrapes.slmtoolbox.license.LicenseConfig
import com.blackgrapes.slmtoolbox.license.LicensePreferences
import com.blackgrapes.slmtoolbox.license.LicenseResult
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.random.Random

/**
 * Admin-only rental license management.
 * Visible when [LicensePreferences] canApprove is true after online validate;
 * every mutate still re-checked by the license-admin Edge Function.
 */
class LicenseAdminFragment : Fragment() {

    private var _binding: FragmentLicenseAdminBinding? = null
    private val binding get() = _binding!!

    private var rows: List<AdminLicenseRow> = emptyList()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentLicenseAdminBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.toolbar.setNavigationOnClickListener {
            findNavController().navigateUp()
        }
        binding.toolbar.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                R.id.action_refresh -> {
                    load(forceValidate = true)
                    true
                }
                R.id.action_create -> {
                    openEditor(null)
                    true
                }
                else -> false
            }
        }

        if (!LicenseConfig.enabled) {
            Toast.makeText(requireContext(), R.string.license_admin_dev_mode, Toast.LENGTH_LONG).show()
            findNavController().navigateUp()
            return
        }

        load(forceValidate = true)
    }

    private fun load(forceValidate: Boolean) {
        viewLifecycleOwner.lifecycleScope.launch {
            setBusy(true)
            binding.tvEmpty.isVisible = false
            if (forceValidate) {
                when (val v = LicenseApi.validate(requireContext())) {
                    is LicenseResult.Failure -> {
                        if (v.code == "network") {
                            // Fall through with cached canApprove if previously allowed.
                        } else {
                            denyAndExit(errorMessage(v.code))
                            return@launch
                        }
                    }
                    is LicenseResult.Success -> Unit
                }
            }
            val snap = LicensePreferences.read(requireContext())
            if (!snap.canApprove) {
                denyAndExit(getString(R.string.license_admin_not_allowed))
                return@launch
            }

            when (val result = LicenseAdminApi.list(requireContext())) {
                is LicenseAdminResult.Ok -> {
                    rows = result.value
                    renderList()
                }
                is LicenseAdminResult.Err -> {
                    if (result.code == "not_allowed" || result.code == "not_activated") {
                        denyAndExit(errorMessage(result.code))
                        return@launch
                    }
                    binding.licenseList.removeAllViews()
                    binding.tvEmpty.text = errorMessage(result.code)
                    binding.tvEmpty.isVisible = true
                }
            }
            if (_binding != null) setBusy(false)
        }
    }

    private fun denyAndExit(message: String) {
        if (!isAdded) return
        Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show()
        if (_binding != null) setBusy(false)
        findNavController().navigateUp()
    }

    private fun renderList() {
        val b = _binding ?: return
        b.licenseList.removeAllViews()
        if (rows.isEmpty()) {
            b.tvEmpty.text = getString(R.string.license_admin_empty)
            b.tvEmpty.isVisible = true
            return
        }
        b.tvEmpty.isVisible = false
        val inflater = layoutInflater
        rows.forEach { row ->
            val item = ItemLicenseAdminBinding.inflate(inflater, b.licenseList, false)
            bindRow(item, row)
            b.licenseList.addView(item.root)
        }
    }

    private fun bindRow(item: ItemLicenseAdminBinding, row: AdminLicenseRow) {
        item.tvCode.text = row.code
        item.tvStatus.text = row.status
        val customer = buildString {
            append(row.customerName.ifBlank { "—" })
            if (row.customerPhone.isNotBlank()) append(" · ").append(row.customerPhone)
        }
        item.tvCustomer.text = customer
        val flags = buildList {
            if (row.canSuggest) add("suggest")
            if (row.canApprove) add("approve")
        }.joinToString(" · ").ifBlank { "—" }
        item.tvMeta.text = getString(
            R.string.license_admin_meta,
            formatExpiry(row.expiresAtIso),
            row.activationCount,
            row.maxDevices,
            flags
        )
        val blocked = row.status.equals("blocked", ignoreCase = true)
        item.btnBlock.text = getString(
            if (blocked) R.string.license_admin_unblock else R.string.license_admin_block
        )
        item.btnEdit.setOnClickListener { openEditor(row) }
        item.btnExtend.setOnClickListener { extend(row, 30) }
        item.btnBlock.setOnClickListener {
            setStatus(row, if (blocked) "active" else "blocked")
        }
    }

    private fun openEditor(existing: AdminLicenseRow?) {
        val dialogBinding = DialogLicenseAdminEditBinding.inflate(layoutInflater)
        val isCreate = existing == null
        if (isCreate) {
            dialogBinding.etCode.setText(suggestCode())
            dialogBinding.etDays.setText("30")
            dialogBinding.etMaxDevices.setText("1")
        } else {
            dialogBinding.tilCode.isEnabled = false
            dialogBinding.etCode.setText(existing!!.code)
            dialogBinding.etCustomer.setText(existing.customerName)
            dialogBinding.etPhone.setText(existing.customerPhone)
            dialogBinding.etNotes.setText(existing.notes)
            dialogBinding.etMaxDevices.setText(existing.maxDevices.toString())
            dialogBinding.cbSuggest.isChecked = existing.canSuggest
            dialogBinding.cbApprove.isChecked = existing.canApprove
            dialogBinding.tilDays.hint = getString(R.string.license_admin_set_days_optional)
            dialogBinding.etDays.setText("")
        }

        MaterialAlertDialogBuilder(requireContext())
            .setTitle(
                if (isCreate) R.string.license_admin_create_title
                else R.string.license_admin_edit_title
            )
            .setView(dialogBinding.root)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.save) { _, _ ->
                if (isCreate) {
                    createFromDialog(dialogBinding)
                } else {
                    updateFromDialog(existing!!, dialogBinding)
                }
            }
            .show()
    }

    private fun createFromDialog(d: DialogLicenseAdminEditBinding) {
        val code = d.etCode.text?.toString()?.trim().orEmpty()
        if (code.length < 4) {
            Toast.makeText(requireContext(), R.string.license_admin_code_short, Toast.LENGTH_SHORT).show()
            return
        }
        val days = d.etDays.text?.toString()?.toIntOrNull() ?: 30
        val maxDev = d.etMaxDevices.text?.toString()?.toIntOrNull() ?: 1
        viewLifecycleOwner.lifecycleScope.launch {
            setBusy(true)
            when (
                val r = LicenseAdminApi.create(
                    requireContext(),
                    code = code,
                    customerName = d.etCustomer.text?.toString().orEmpty(),
                    customerPhone = d.etPhone.text?.toString().orEmpty(),
                    days = days,
                    maxDevices = maxDev,
                    canSuggest = d.cbSuggest.isChecked,
                    canApprove = d.cbApprove.isChecked,
                    notes = d.etNotes.text?.toString().orEmpty()
                )
            ) {
                is LicenseAdminResult.Ok -> {
                    Toast.makeText(requireContext(), R.string.license_admin_created, Toast.LENGTH_SHORT)
                        .show()
                    load(forceValidate = false)
                }
                is LicenseAdminResult.Err -> {
                    Toast.makeText(requireContext(), errorMessage(r.code), Toast.LENGTH_LONG).show()
                    if (_binding != null) setBusy(false)
                }
            }
        }
    }

    private fun updateFromDialog(existing: AdminLicenseRow, d: DialogLicenseAdminEditBinding) {
        val setDays = d.etDays.text?.toString()?.toIntOrNull()
        val maxDev = d.etMaxDevices.text?.toString()?.toIntOrNull()
        viewLifecycleOwner.lifecycleScope.launch {
            setBusy(true)
            when (
                val r = LicenseAdminApi.update(
                    requireContext(),
                    id = existing.id,
                    customerName = d.etCustomer.text?.toString().orEmpty(),
                    customerPhone = d.etPhone.text?.toString().orEmpty(),
                    notes = d.etNotes.text?.toString().orEmpty(),
                    maxDevices = maxDev,
                    canSuggest = d.cbSuggest.isChecked,
                    canApprove = d.cbApprove.isChecked,
                    setDays = setDays
                )
            ) {
                is LicenseAdminResult.Ok -> {
                    Toast.makeText(requireContext(), R.string.license_admin_updated, Toast.LENGTH_SHORT)
                        .show()
                    load(forceValidate = false)
                }
                is LicenseAdminResult.Err -> {
                    Toast.makeText(requireContext(), errorMessage(r.code), Toast.LENGTH_LONG).show()
                    if (_binding != null) setBusy(false)
                }
            }
        }
    }

    private fun extend(row: AdminLicenseRow, days: Int) {
        viewLifecycleOwner.lifecycleScope.launch {
            setBusy(true)
            when (
                val r = LicenseAdminApi.update(
                    requireContext(),
                    id = row.id,
                    extendDays = days
                )
            ) {
                is LicenseAdminResult.Ok -> {
                    Toast.makeText(
                        requireContext(),
                        getString(R.string.license_admin_extended, days),
                        Toast.LENGTH_SHORT
                    ).show()
                    load(forceValidate = false)
                }
                is LicenseAdminResult.Err -> {
                    Toast.makeText(requireContext(), errorMessage(r.code), Toast.LENGTH_LONG).show()
                    if (_binding != null) setBusy(false)
                }
            }
        }
    }

    private fun setStatus(row: AdminLicenseRow, status: String) {
        val title = if (status == "blocked") {
            R.string.license_admin_confirm_block
        } else {
            R.string.license_admin_confirm_unblock
        }
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(title)
            .setMessage(row.code)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.license_ok) { _, _ ->
                viewLifecycleOwner.lifecycleScope.launch {
                    setBusy(true)
                    when (
                        val r = LicenseAdminApi.update(
                            requireContext(),
                            id = row.id,
                            status = status
                        )
                    ) {
                        is LicenseAdminResult.Ok -> load(forceValidate = false)
                        is LicenseAdminResult.Err -> {
                            Toast.makeText(requireContext(), errorMessage(r.code), Toast.LENGTH_LONG)
                                .show()
                            if (_binding != null) setBusy(false)
                        }
                    }
                }
            }
            .show()
    }

    private fun setBusy(busy: Boolean) {
        val b = _binding ?: return
        b.progress.isVisible = busy
        b.scroll.alpha = if (busy) 0.45f else 1f
        b.toolbar.menu.findItem(R.id.action_refresh)?.isEnabled = !busy
        b.toolbar.menu.findItem(R.id.action_create)?.isEnabled = !busy
    }

    private fun formatExpiry(iso: String): String {
        val ms = LicensePreferences.parseExpiresAt(iso)
        if (ms <= 0L) return iso.ifBlank { "—" }
        return SimpleDateFormat("dd MMM yyyy", Locale.US).format(Date(ms))
    }

    private fun suggestCode(): String {
        val part = Random.nextInt(1000, 9999)
        val part2 = Random.nextInt(1000, 9999)
        return "SLM-$part-$part2"
    }

    private fun errorMessage(code: String): String = when (code) {
        "not_allowed" -> getString(R.string.license_admin_not_allowed)
        "not_activated" -> getString(R.string.license_err_not_activated)
        "functions_missing" -> getString(R.string.license_err_functions_missing)
        "network" -> getString(R.string.license_err_network)
        "code_exists" -> getString(R.string.license_admin_code_exists)
        "cannot_demote_self" -> getString(R.string.license_admin_cannot_demote_self)
        "cannot_block_self" -> getString(R.string.license_admin_cannot_block_self)
        "invalid_code" -> getString(R.string.license_err_invalid)
        else -> getString(R.string.license_err_generic, code)
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
