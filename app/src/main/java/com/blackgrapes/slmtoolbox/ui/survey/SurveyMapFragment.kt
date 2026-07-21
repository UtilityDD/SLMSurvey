package com.blackgrapes.slmtoolbox.ui.survey

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.location.GnssStatus
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import com.blackgrapes.slmtoolbox.R
import com.blackgrapes.slmtoolbox.SlmApp
import com.blackgrapes.slmtoolbox.databinding.FragmentSurveyMapBinding
import com.blackgrapes.slmtoolbox.domain.FieldRules
import com.blackgrapes.slmtoolbox.domain.GeometryHitTest
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import com.blackgrapes.slmtoolbox.license.LicenseAccess
import com.blackgrapes.slmtoolbox.license.LicenseApi
import com.blackgrapes.slmtoolbox.license.LicenseConfig
import com.blackgrapes.slmtoolbox.license.LicensePreferences
import com.blackgrapes.slmtoolbox.map.MapStyleConfig
import com.blackgrapes.slmtoolbox.ui.settings.PresetSettingsDialog
import com.blackgrapes.slmtoolbox.ui.map.SurveyMapRenderer
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.maplibre.android.annotations.IconFactory
import org.maplibre.android.annotations.Marker
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import com.blackgrapes.slmtoolbox.domain.AccuracyGrade
import com.blackgrapes.slmtoolbox.domain.EnglishNumbers
import com.blackgrapes.slmtoolbox.domain.SiteVerification
import kotlin.coroutines.resume
import java.util.ArrayDeque

class SurveyMapFragment : Fragment() {

    private var _binding: FragmentSurveyMapBinding? = null
    private val binding get() = _binding!!

    private val viewModel: SurveyViewModel by activityViewModels {
        SurveyViewModel.Factory((requireActivity().application as SlmApp).repository)
    }

    private var map: MapLibreMap? = null
    private var styleReady = false
    private var gpsReady = false
    private var settingsPromptOpen = false
    private var lastDeviceLocation: Location? = null
    private val recentFixes = ArrayDeque<Location>(12)
    private var renderJob: Job? = null
    private var cameraMoving = false
    private var lastRenderedSurveyId: Long? = null
    private var lastRenderedUpdatedAt: Long = -1L
    private var lastRenderedSelectedId: Long? = null
    private var lastRenderedSnappedId: Long? = null

    // ── Satellite tracking ──────────────────────────────────────────────────
    private data class SatInfo(
        val code: String,        // short code, e.g. "GPS"
        val fullName: String,    // e.g. "GPS (NAVSTAR)"
        val country: String,     // e.g. "United States"
        val flag: String,        // country flag emoji, e.g. "🇺🇸"
        val bgColor: Int,        // badge background color
        val svid: Int,
        val snr: Float,
        val usedInFix: Boolean
    )
    private var satelliteList: List<SatInfo> = emptyList()
    private var satBottomSheet: BottomSheetDialog? = null
    private var satWarmPopup: PopupWindow? = null
    private var satWarmHintShown = false
    private var gnssCallback: GnssStatus.Callback? = null

    private var assetMarkers: Map<Long, Marker> = emptyMap()
    private var snappedPoleId: Long? = null

    private val gpsResolutionLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        settingsPromptOpen = false
        if (result.resultCode == Activity.RESULT_OK) {
            checkGpsAndCenter()
        } else {
            lockSurveyForGps()
            showGpsRequiredDialog()
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        val granted = result[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            result[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) {
            checkGpsAndCenter()
        } else {
            lockSurveyForGps()
            showGpsRequiredDialog()
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSurveyMapBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.mapView.onCreate(savedInstanceState)
        viewModel.ensureDraft()

        binding.mapView.getMapAsync { mapLibreMap ->
            map = mapLibreMap
            mapLibreMap.uiSettings.isAttributionEnabled = true
            mapLibreMap.setStyle(Style.Builder().fromUri(MapStyleConfig.STYLE_URL)) {
        styleReady = true
                requestLocationOrFallback()
                scheduleRender()
                if (_binding != null) {
                    binding.tvGpsAccuracy.text = getString(R.string.gps_accuracy_unknown)
                    setGpsWarmingHint(true)
                }
            }
            mapLibreMap.addOnMapLongClickListener { latLng ->
                handleLongPress(latLng.latitude, latLng.longitude)
                true
            }
            mapLibreMap.setOnMarkerClickListener { marker ->
                // Single tap on a pole: intentionally do nothing.
                // Edit / Delete is reserved for long press on a pole.
                false
            }
            mapLibreMap.addOnCameraMoveListener {
                cameraMoving = true
                updateDynamicSpanHint()
                updateCoordinateChip()
            }
            mapLibreMap.addOnCameraIdleListener {
                cameraMoving = false
            }
            // Show initial coordinates as soon as the map is ready
            updateCoordinateChip()
        }

        binding.btnRecenter.setOnClickListener { requestLocationOrFallback() }
        binding.btnUndo.setOnClickListener { viewModel.undo() }
        binding.btnClearDrawing.setOnClickListener { confirmClearDrawing() }
        binding.btnQuickDrop.setOnClickListener { performQuickDrop() }
        binding.btnPresetSettings.setOnClickListener {
            PresetSettingsDialog().show(childFragmentManager, PresetSettingsDialog.TAG)
        }
        binding.satelliteChip.setOnClickListener {
            dismissSatWarmPopup()
            showSatelliteSheet()
        }
        binding.btnMySld.setOnClickListener {
            findNavController().navigate(R.id.action_survey_to_my_sld)
        }
        binding.btnSaveWorkspace.setOnClickListener { saveToMySld() }
        binding.btnPreviewSld.setOnClickListener {
            val id = viewModel.survey.value?.id ?: return@setOnClickListener
            findNavController().navigate(
                R.id.action_survey_to_sld_preview,
                Bundle().apply { putLong("surveyId", id) }
            )
        }
        binding.tvLicenseBadge.setOnClickListener { showLicenseInfoDialog() }
        updateLicenseBadge()

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.survey.collect { survey ->
                        if (survey == null) return@collect
                        binding.btnSaveWorkspace.isVisible =
                            survey.assets.any { it.poleRole == PoleRole.END }
                        binding.liveSiteBanner.isVisible =
                            survey.assets.isNotEmpty() && !survey.isLiveAtSite
                        scheduleRender()
                        updateDynamicSpanHint()
                    }
                }
                launch {
                    viewModel.selectedTapPoleId.collect {
                        updateDynamicSpanHint()
                        scheduleRender()
                    }
                }
                launch {
                    viewModel.isProcessing.collect { processing ->
                        binding.loadingOverlay.isVisible = processing
                        setSurveyControlsEnabled(!processing)
                    }
                }
                launch {
                    viewModel.processingMessage.collect { message ->
                        binding.loadingText.text = message ?: "Processing..."
                    }
                }
                launch {
                    viewModel.blinkState.collect { state ->
                        updateBlinkingMarker(state)
                    }
                }
            }
        }
    }

    private fun updateBlinkingMarker(blinkOn: Boolean) {
        if (cameraMoving) {
            if (_binding != null) {
                binding.imgCrosshair.alpha = if (blinkOn) 1.0f else 0.45f
            }
            return
        }
        val survey = viewModel.survey.value ?: return
        val blinkAsset = viewModel.selectedTapPole() ?: viewModel.activeOpenTip()
        val context = context ?: return
        val iconFactory = IconFactory.getInstance(context)

        if (blinkAsset != null) {
            val marker = assetMarkers[blinkAsset.id]
            if (marker != null) {
                val selected = viewModel.selectedTapPoleId.value == blinkAsset.id
                val icon = SurveyMapRenderer.createMarkerBitmap(
                    context = context,
                    asset = blinkAsset,
                    selected = selected,
                    isBlinking = blinkOn,
                    isSnapped = (blinkAsset.id == snappedPoleId)
                )
                marker.setIcon(iconFactory.fromBitmap(icon))
            }
        }

        val snappedId = snappedPoleId
        if (snappedId != null && (blinkAsset == null || blinkAsset.id != snappedId)) {
            val marker = assetMarkers[snappedId]
            val asset = survey.assets.firstOrNull { it.id == snappedId }
            if (marker != null && asset != null) {
                val selected = viewModel.selectedTapPoleId.value == snappedId
                val icon = SurveyMapRenderer.createMarkerBitmap(
                    context = context,
                    asset = asset,
                    selected = selected,
                    isBlinking = blinkOn,
                    isSnapped = true
                )
                marker.setIcon(iconFactory.fromBitmap(icon))
            }
        }

        updateMyLocationMarker()
        if (_binding != null) {
            binding.imgCrosshair.alpha = if (blinkOn) 1.0f else 0.45f
        }
    }

    /**
     * Long-press is reserved for modifying / deleting an existing pole.
     * Adding poles (new network, continue series, branch, insert) uses the + button.
     */
    private fun handleLongPress(lat: Double, lng: Double) {
        val nearPole = nearestConnectablePole(lat, lng) ?: return
        val results = FloatArray(1)
        android.location.Location.distanceBetween(
            nearPole.latitude, nearPole.longitude, lat, lng, results
        )
        if (results[0] <= 25.0f) {
            openEditBubble(nearPole)
        }
    }

    private fun openNewNetworkBubble(lat: Double, lng: Double) {
        val wizard = SurveyBubbleWizard.forNew(lat, lng)
        wizard.onPlace = { draft -> placeWithEvidence(draft) }
        wizard.show(parentFragmentManager, SurveyBubbleWizard.TAG)
    }

    private fun openContinueBubble(lat: Double, lng: Double) {
        val series = viewModel.activeSeriesConfig()
        if (series == null) {
            openNewNetworkBubble(lat, lng)
            return
        }
        val tip = viewModel.selectedTapPole() ?: viewModel.activeOpenTip()
        val wizard = SurveyBubbleWizard.forContinue(lat, lng, series, tip?.id)
        wizard.onPlace = { draft -> placeWithEvidence(draft) }
        wizard.show(parentFragmentManager, SurveyBubbleWizard.TAG)
    }

    private fun openNearLineBubble(
        lat: Double,
        lng: Double,
        candidates: List<SurveyAsset>,
        splitId: Long?,
        lineVoltage: com.blackgrapes.slmtoolbox.domain.model.VoltageLevel? = null,
        lineStatus: com.blackgrapes.slmtoolbox.domain.model.WorkStatus? = null,
        directInsert: Boolean = false
    ) {
        viewLifecycleOwner.lifecycleScope.launch {
            val seriesId = candidates.firstOrNull()?.seriesId
            val meta = seriesId?.let { viewModel.getSeriesMeta(it) }
            val wizard = SurveyBubbleWizard.forNearLine(
                lat = lat,
                lng = lng,
                candidates = candidates,
                splitId = splitId,
                lineVoltage = lineVoltage,
                lineStatus = lineStatus,
                feederName = meta?.feederName.orEmpty(),
                sourceSubstation = meta?.sourceSubstation.orEmpty(),
                directInsert = directInsert
            )
            wizard.onPlace = { draft -> placeWithEvidence(draft) }
            wizard.show(parentFragmentManager, SurveyBubbleWizard.TAG)
        }
    }

    /** Start a Proposed branch from an existing pole (voltage + feeder/SS inherited). */
    private fun openTappingBubble(lat: Double, lng: Double, source: SurveyAsset) {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.clearTapPole()
            val meta = source.seriesId?.let { viewModel.getSeriesMeta(it) }
            val wizard = SurveyBubbleWizard.forTapping(
                lat = lat,
                lng = lng,
                source = source,
                feederName = meta?.feederName.orEmpty(),
                sourceSubstation = meta?.sourceSubstation.orEmpty()
            )
            wizard.onPlace = { draft -> placeWithEvidence(draft) }
            wizard.show(parentFragmentManager, SurveyBubbleWizard.TAG)
        }
    }

    /** Long-press on a pole → Edit properties or Delete. */
    private fun openEditBubble(asset: SurveyAsset) {
        val wizard = SurveyBubbleWizard.forEdit(asset)
        wizard.onEdit = { viewModel.updateAsset(it) }
        wizard.onDelete = { viewModel.deleteAsset(it) }
        wizard.show(parentFragmentManager, SurveyBubbleWizard.TAG)
    }

    private fun placeWithEvidence(draft: com.blackgrapes.slmtoolbox.domain.PlacementDraft) {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.setProcessing(true, getString(R.string.gps_capturing_best))
            val evidence = captureEvidence(draft.latitude, draft.longitude)
            val grade = SiteVerification.accuracyGrade(evidence.deviceAccuracyM)
            if (grade == AccuracyGrade.POOR || grade == AccuracyGrade.UNKNOWN) {
                Toast.makeText(
                    requireContext(),
                    R.string.gps_fix_poor_toast,
                    Toast.LENGTH_LONG
                ).show()
            }
            viewModel.placePole(draft, evidence)
            updateDynamicSpanHint()
            if (viewModel.hasPendingProposedBranch()) {
                Toast.makeText(
                    requireContext(),
                    R.string.status_proposed_branch_ready,
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun captureEvidence(mapLat: Double, mapLng: Double): LocationEvidence {
        val satSnapshot = currentSatSnapshot()
        val location = collectBestGpsFix()
        if (location == null) {
            return LocationEvidence(
                null, null, null, null, null, false,
                satsUsedInFix = satSnapshot.used,
                satsVisible = satSnapshot.visible,
                avgSnrDb = satSnapshot.avgSnr
            )
        }
        lastDeviceLocation = location
        rememberFix(location)
        val results = FloatArray(1)
        Location.distanceBetween(
            location.latitude,
            location.longitude,
            mapLat,
            mapLng,
            results
        )
        val mock = if (Build.VERSION.SDK_INT >= 31) {
            location.isMock
        } else {
            @Suppress("DEPRECATION")
            location.isFromMockProvider
        }
        return LocationEvidence(
            deviceLatitude = location.latitude,
            deviceLongitude = location.longitude,
            deviceAccuracyM = location.accuracy,
            deviceFixTimestamp = location.time.takeIf { it > 0L } ?: System.currentTimeMillis(),
            distanceFromDeviceM = results[0],
            isMockLocation = mock,
            satsUsedInFix = satSnapshot.used,
            satsVisible = satSnapshot.visible,
            avgSnrDb = satSnapshot.avgSnr
        )
    }

    private fun rememberFix(location: Location) {
        recentFixes.addLast(location)
        while (recentFixes.size > 12) recentFixes.removeFirst()
    }

    private fun bestRecentFix(maxAgeMs: Long = 10_000L): Location? {
        val now = System.currentTimeMillis()
        return recentFixes
            .filter { loc ->
                loc.hasAccuracy() &&
                    (now - loc.time) in 0..maxAgeMs &&
                    loc.accuracy <= SiteVerification.WARN_ACCURACY_M * 2
            }
            .minByOrNull { it.accuracy }
    }

    /**
     * Collects several high-accuracy fixes (internet-assisted A-GPS + GNSS) and
     * returns the lowest-accuracy sample. Rejects stale fixes older than 30s.
     */
    private suspend fun collectBestGpsFix(): Location? {
        var best = bestRecentFix(maxAgeMs = 8_000L)
        val deadline = System.currentTimeMillis() + 2_500L
        while (System.currentTimeMillis() < deadline) {
            delay(400)
            val candidate = bestRecentFix(maxAgeMs = 5_000L)
            if (candidate != null && (best == null || candidate.accuracy < best.accuracy)) {
                best = candidate
            }
            if (best != null && best.accuracy <= 8f) break
        }
        val fresh = fetchFreshLocation()
        if (fresh != null) {
            rememberFix(fresh)
            if (best == null || fresh.accuracy < best.accuracy) best = fresh
        }
        val now = System.currentTimeMillis()
        return best?.takeIf {
            it.hasAccuracy() &&
                it.accuracy <= 50f &&
                now - it.time <= SiteVerification.MAX_FIX_AGE_MS
        }
    }

    private data class SatSnapshot(
        val used: Int?,
        val visible: Int?,
        val avgSnr: Float?
    )

    private fun currentSatSnapshot(): SatSnapshot {
        val list = satelliteList
        if (list.isEmpty()) return SatSnapshot(null, null, null)
        val usedSats = list.filter { it.usedInFix }
        val snrSource = usedSats.ifEmpty { list }
        val avg = snrSource.map { it.snr }.filter { it > 0f }.average().toFloat()
        return SatSnapshot(
            used = usedSats.size,
            visible = list.size,
            avgSnr = avg.takeIf { !it.isNaN() }
        )
    }

    @SuppressLint("MissingPermission")
    private suspend fun fetchFreshLocation(): Location? =
        suspendCancellableCoroutine { cont ->
            val client = LocationServices.getFusedLocationProviderClient(requireContext())
            val token = CancellationTokenSource()
            cont.invokeOnCancellation { token.cancel() }
            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, token.token)
                .addOnSuccessListener { location ->
                    if (cont.isActive) cont.resume(location)
                }
                .addOnFailureListener {
                    client.lastLocation
                        .addOnSuccessListener { last ->
                            if (cont.isActive) cont.resume(last)
                        }
                        .addOnFailureListener {
                            if (cont.isActive) cont.resume(null)
                        }
                }
        }

    /**
     * Mid-draw pole action: branch from an Existing pole starts a Proposed series;
     * branching from a Proposed tip continues that series.
     */
    private fun showPoleActions(asset: SurveyAsset) {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(getString(R.string.pole_actions, asset.sequence))
            .setItems(
                arrayOf(getString(R.string.select_as_tapping))
            ) { _, _ ->
                if (asset.status == WorkStatus.EXISTING) {
                    viewModel.armProposedBranch(asset)
                    Toast.makeText(
                        requireContext(),
                        R.string.status_proposed_branch_ready,
                        Toast.LENGTH_LONG
                    ).show()
                } else {
                    viewModel.selectTapPole(asset)
                    Toast.makeText(
                        requireContext(),
                        getString(R.string.tapping_pole_selected, asset.sequence),
                        Toast.LENGTH_LONG
                    ).show()
                }
                updateDynamicSpanHint()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun confirmDeletePole(asset: SurveyAsset) {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.delete_pole)
            .setMessage(getString(R.string.delete_pole_confirm, asset.sequence))
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                viewModel.deleteAsset(asset)
                Toast.makeText(requireContext(), R.string.pole_deleted, Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    private fun confirmClearDrawing() {
        val hasDrawing = viewModel.survey.value?.assets?.isNotEmpty() == true
        if (!hasDrawing) return
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.clear_drawing)
            .setMessage(R.string.clear_drawing_confirm)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.clear_drawing) { _, _ ->
                viewModel.clearDrawing()
                Toast.makeText(requireContext(), R.string.drawing_cleared, Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    private fun saveToMySld() {
        val survey = viewModel.survey.value ?: return
        if (survey.assets.none { it.poleRole == PoleRole.END }) {
            Toast.makeText(requireContext(), R.string.save_requires_end, Toast.LENGTH_SHORT).show()
            return
        }
        viewLifecycleOwner.lifecycleScope.launch {
            val suggestedName = WorkspaceNameResolver.suggest(requireContext(), survey)
            if (!isAdded) return@launch
            val input = EditText(requireContext()).apply {
                hint = getString(R.string.workspace_name_hint)
                setText(suggestedName)
                selectAll()
                setPadding(48, 20, 48, 20)
                isSingleLine = true
            }
            MaterialAlertDialogBuilder(requireContext())
                .setTitle(R.string.save_workspace_title)
                .setView(input)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.save) { _, _ ->
                    val name = input.text?.toString()?.trim().orEmpty().ifBlank { suggestedName }
                    viewLifecycleOwner.lifecycleScope.launch {
                        viewModel.saveWorkspaceAndStartNew(name)
                        if (isAdded) {
                            Toast.makeText(
                                requireContext(),
                                R.string.sld_saved_new_started,
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
                .show()
        }
    }

    /** Updates the floating coordinate chip with the current map-center lat/long. */
    private fun updateCoordinateChip() {
        val binding = _binding ?: return
        val target = map?.cameraPosition?.target ?: return
        val lat = target.latitude
        val lon = target.longitude
        // Format: "12.3456° N  78.9012° E" style
        val latLabel = if (lat >= 0) "N" else "S"
        val lonLabel = if (lon >= 0) "E" else "W"
        binding.tvCoordinates.text = EnglishNumbers.format(
            "%.5f° %s   %.5f° %s",
            Math.abs(lat), latLabel,
            Math.abs(lon), lonLabel
        )
    }

    private fun updateDynamicSpanHint() {
        if (_binding == null) return
        val tap = viewModel.selectedTapPole()
        val series = viewModel.activeSeriesConfig()
        val tip = tap ?: viewModel.activeOpenTip()
        val centerLatLng = map?.cameraPosition?.target
        
        val isIdle = (series == null && tap == null)
        var detectedTapPole: SurveyAsset? = null
        if (isIdle && centerLatLng != null) {
            val nearest = nearestConnectablePole(centerLatLng.latitude, centerLatLng.longitude)
            if (nearest != null) {
                val results = FloatArray(1)
                android.location.Location.distanceBetween(
                    nearest.latitude,
                    nearest.longitude,
                    centerLatLng.latitude,
                    centerLatLng.longitude,
                    results
                )
                val distance = results[0]
                if (distance <= 25.0f) {
                    detectedTapPole = nearest
                }
            }
        }
        
        var detectedConnection: SurveyConnection? = null
        var lineFrom: SurveyAsset? = null
        var lineTo: SurveyAsset? = null
        if (isIdle && centerLatLng != null) {
            val nearLine = nearestCompletedConnection(centerLatLng.latitude, centerLatLng.longitude)
            if (nearLine != null) {
                val survey = viewModel.survey.value
                if (survey != null) {
                    val from = survey.assets.firstOrNull { it.id == nearLine.fromAssetId }
                    val to = survey.assets.firstOrNull { it.id == nearLine.toAssetId }
                    if (from != null && to != null) {
                        detectedConnection = nearLine
                        lineFrom = from
                        lineTo = to
                    }
                }
            }
        }
        
        val baseHint = when {
            viewModel.hasPendingProposedBranch() ->
                getString(R.string.status_proposed_branch_ready)
            detectedTapPole != null && detectedConnection != null ->
                "Near Pole #${detectedTapPole.sequence} & Line (Press + for options)"
            detectedTapPole != null ->
                "Near Pole #${detectedTapPole.sequence} (Press + for options)"
            detectedConnection != null && lineFrom != null && lineTo != null ->
                "Near Line: Pole #${lineFrom.sequence} → Pole #${lineTo.sequence} (Press + for options)"
            tap != null -> EnglishNumbers.string(requireContext(), R.string.status_tap_ready, tap.sequence)
            series != null -> getString(R.string.status_series_open, series.voltage.label)
            !gpsReady -> getString(R.string.gps_still_off)
            else -> getString(R.string.status_idle)
        }
        
        if (tip != null && (series != null || tap != null) && centerLatLng != null) {
            val results = FloatArray(1)
            android.location.Location.distanceBetween(
                tip.latitude,
                tip.longitude,
                centerLatLng.latitude,
                centerLatLng.longitude,
                results
            )
            val distance = results[0].toDouble()
            val preset = com.blackgrapes.slmtoolbox.domain.PresetPreferences.get(requireContext())
            val formattedDistance = com.blackgrapes.slmtoolbox.domain.SurveyMetrics.formatDistance(
                distance,
                preset.displayUnit,
                preset.displayDecimals
            )
            binding.hintText.text = "$baseHint · Span: $formattedDistance"
        } else {
            binding.hintText.text = baseHint
        }
        
        val oldSnappedId = snappedPoleId
        snappedPoleId = detectedTapPole?.id
        if (oldSnappedId != snappedPoleId) {
            val context = context
            if (context != null) {
                val iconFactory = org.maplibre.android.annotations.IconFactory.getInstance(context)
                val survey = viewModel.survey.value
                if (survey != null) {
                    if (oldSnappedId != null) {
                        val oldAsset = survey.assets.firstOrNull { it.id == oldSnappedId }
                        val marker = assetMarkers[oldSnappedId]
                        if (oldAsset != null && marker != null) {
                            val selected = viewModel.selectedTapPoleId.value == oldSnappedId
                            val icon = SurveyMapRenderer.createMarkerBitmap(
                                context = context,
                                asset = oldAsset,
                                selected = selected,
                                isBlinking = false,
                                isSnapped = false
                            )
                            marker.setIcon(iconFactory.fromBitmap(icon))
                        }
                    }
                    if (snappedPoleId != null) {
                        val newAsset = survey.assets.firstOrNull { it.id == snappedPoleId }
                        val marker = assetMarkers[snappedPoleId!!]
                        if (newAsset != null && marker != null) {
                            val selected = viewModel.selectedTapPoleId.value == snappedPoleId
                            val icon = SurveyMapRenderer.createMarkerBitmap(
                                context = context,
                                asset = newAsset,
                                selected = selected,
                                isBlinking = viewModel.blinkState.value,
                                isSnapped = true
                            )
                            marker.setIcon(iconFactory.fromBitmap(icon))
                        }
                    }
                }
            }
        }
        
        if (detectedTapPole != null || detectedConnection != null) {
            binding.imgCrosshair.setColorFilter(android.graphics.Color.parseColor("#388E3C"))
        } else {
            binding.imgCrosshair.clearColorFilter()
        }
    }

    private fun nearestConnectablePole(lat: Double, lng: Double): SurveyAsset? {
        val survey = viewModel.survey.value ?: return null
        val candidates = survey.assets.filter { FieldRules.canConnect(it.type) }
        if (candidates.isEmpty()) return null
        var best: SurveyAsset? = null
        var bestDistance = Float.MAX_VALUE
        val results = FloatArray(1)
        candidates.forEach { asset ->
            Location.distanceBetween(lat, lng, asset.latitude, asset.longitude, results)
            if (results[0] < bestDistance) {
                bestDistance = results[0]
                best = asset
            }
        }
        return best?.takeIf { bestDistance <= 25f }
    }

    private fun nearestCompletedConnection(lat: Double, lng: Double): SurveyConnection? {
        val survey = viewModel.survey.value ?: return null
        if (!hasCompletedNetwork(survey.assets)) return null
        val assetById = survey.assets.associateBy { it.id }
        var best: SurveyConnection? = null
        var bestDistance = Float.MAX_VALUE
        survey.connections.forEach { connection ->
            val from = assetById[connection.fromAssetId] ?: return@forEach
            val to = assetById[connection.toAssetId] ?: return@forEach
            val distance = GeometryHitTest.distanceToSegmentM(
                lat,
                lng,
                from.latitude,
                from.longitude,
                to.latitude,
                to.longitude
            )
            if (distance < bestDistance) {
                bestDistance = distance
                best = connection
            }
        }
        return best?.takeIf { bestDistance <= 20f }
    }

    private fun hasCompletedNetwork(assets: List<SurveyAsset>): Boolean =
        assets.any { it.poleRole == PoleRole.START } &&
            assets.any { it.poleRole == PoleRole.END }

    private fun scheduleRender() {
        renderJob?.cancel()
        renderJob = viewLifecycleOwner.lifecycleScope.launch {
            delay(80)
            renderCurrentSurvey()
        }
    }

    private fun renderCurrentSurvey() {
        val mapLibreMap = map ?: return
        val survey = viewModel.survey.value ?: return
        if (!styleReady) return

        val selectedId = viewModel.selectedTapPoleId.value
        val snappedId = snappedPoleId
        // Skip identical redraws when nothing in the survey or selection changed.
        if (
            survey.id == lastRenderedSurveyId &&
            survey.updatedAt == lastRenderedUpdatedAt &&
            selectedId == lastRenderedSelectedId &&
            snappedId == lastRenderedSnappedId &&
            assetMarkers.isNotEmpty()
        ) {
            return
        }

        myLocationMarker = null
        assetMarkers = SurveyMapRenderer.render(
            context = requireContext(),
            map = mapLibreMap,
            survey = survey,
            readOnly = false,
            selectedAssetId = selectedId,
            snappedAssetId = snappedId
        )
        lastRenderedSurveyId = survey.id
        lastRenderedUpdatedAt = survey.updatedAt
        lastRenderedSelectedId = selectedId
        lastRenderedSnappedId = snappedId
        updateMyLocationMarker()
    }

    private fun requestLocationOrFallback() {
        val fine = ContextCompat.checkSelfPermission(
            requireContext(),
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            requireContext(),
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (fine || coarse) {
            checkGpsAndCenter()
        } else {
            lockSurveyForGps()
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                )
            )
        }
    }

    private fun checkGpsAndCenter() {
        binding.hintText.setText(R.string.gps_checking)
        if (_binding != null) {
            binding.gpsStatusIndicator.setImageResource(android.R.drawable.presence_online)
            binding.gpsStatusIndicator.setColorFilter(android.graphics.Color.YELLOW, android.graphics.PorterDuff.Mode.SRC_IN)
            binding.gpsStatusIndicator.contentDescription = getString(R.string.gps_status_weak)
        }
        val request = LocationSettingsRequest.Builder()
            .addLocationRequest(
                LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
                    .setMinUpdateIntervalMillis(2_000L)
                    .build()
            )
            .setAlwaysShow(true)
            .build()
        LocationServices.getSettingsClient(requireActivity())
            .checkLocationSettings(request)
            .addOnSuccessListener {
                settingsPromptOpen = false
                gpsReady = true
                setSurveyControlsEnabled(true)
                updateDynamicSpanHint()
                centerOnCurrentLocation()
                startLocationUpdates()
                if (_binding != null) {
                    binding.gpsStatusIndicator.setImageResource(android.R.drawable.presence_online)
                    binding.gpsStatusIndicator.setColorFilter(android.graphics.Color.GREEN, android.graphics.PorterDuff.Mode.SRC_IN)
                    binding.gpsStatusIndicator.contentDescription = getString(R.string.gps_status_good)
                }
            }
            .addOnFailureListener { error ->
                gpsReady = false
                lockSurveyForGps()
                if (error is ResolvableApiException && !settingsPromptOpen) {
                    settingsPromptOpen = true
                    gpsResolutionLauncher.launch(
                        IntentSenderRequest.Builder(error.resolution).build()
                    )
                } else {
                    showGpsRequiredDialog()
                }
            }
    }

    private fun lockSurveyForGps() {
        gpsReady = false
        setSurveyControlsEnabled(true) // Relaxed: keep all controls enabled
        if (_binding != null) {
            binding.hintText.setText(R.string.gps_still_off)
            binding.gpsStatusIndicator.setImageResource(android.R.drawable.presence_online)
            binding.gpsStatusIndicator.setColorFilter(android.graphics.Color.RED, android.graphics.PorterDuff.Mode.SRC_IN)
            binding.gpsStatusIndicator.contentDescription = getString(R.string.gps_status_bad)
        }
    }

    private fun setSurveyControlsEnabled(enabled: Boolean) {
        if (_binding == null) return
        binding.btnUndo.isEnabled = enabled
        binding.btnClearDrawing.isEnabled = enabled
        binding.btnRecenter.isEnabled = enabled
        binding.btnPresetSettings.isEnabled = enabled
        binding.mapView.isEnabled = enabled
        binding.btnMySld.isEnabled = enabled
        binding.btnPreviewSld.isEnabled = enabled
        binding.btnSaveWorkspace.isEnabled = enabled
        binding.btnQuickDrop.isEnabled = enabled
    }

    private fun showGpsRequiredDialog() {
        if (!isAdded || settingsPromptOpen) return
        settingsPromptOpen = true
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.gps_required_title)
            .setMessage(R.string.gps_required_message)
            .setCancelable(false)
            .setPositiveButton(R.string.open_location_settings) { _, _ ->
                settingsPromptOpen = false
                startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            }
            .setNegativeButton(R.string.cancel) { _, _ ->
                settingsPromptOpen = false
                Toast.makeText(requireContext(), R.string.gps_still_off, Toast.LENGTH_LONG).show()
            }
            .show()
    }

    @SuppressLint("MissingPermission")
    private fun centerOnCurrentLocation() {
        val client = LocationServices.getFusedLocationProviderClient(requireContext())
        client.lastLocation.addOnSuccessListener { location ->
            if (location != null) {
                lastDeviceLocation = location
                moveCamera(location.latitude, location.longitude)
            } else {
                val token = CancellationTokenSource()
                client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, token.token)
                    .addOnSuccessListener { current ->
                        if (current != null) {
                            lastDeviceLocation = current
                            moveCamera(current.latitude, current.longitude)
                        } else {
                            Toast.makeText(
                                requireContext(),
                                R.string.location_unavailable,
                                Toast.LENGTH_SHORT
                            ).show()
                            moveCamera(
                                MapStyleConfig.DEFAULT_LATITUDE,
                                MapStyleConfig.DEFAULT_LONGITUDE
                            )
                        }
                    }
            }
        }
    }

    private fun moveCamera(lat: Double, lng: Double) {
        val mapLibreMap = map ?: return
        mapLibreMap.cameraPosition = CameraPosition.Builder()
            .target(LatLng(lat, lng))
            .zoom(MapStyleConfig.FIELD_ZOOM)
            .build()
        mapLibreMap.animateCamera(
            CameraUpdateFactory.newLatLngZoom(LatLng(lat, lng), MapStyleConfig.FIELD_ZOOM)
        )
    }

    override fun onStart() {
        super.onStart()
        binding.mapView.onStart()
    }

    override fun onResume() {
        super.onResume()
        binding.mapView.onResume()
        enforceLicenseGate()
        if (styleReady) {
            requestLocationOrFallback()
            startLocationUpdates()
        }
        registerGnssCallback()
    }

    /** Quiet server refresh; if rental is locked, leave the map. */
    private fun enforceLicenseGate() {
        if (!LicenseConfig.enabled) {
            updateLicenseBadge()
            return
        }
        viewLifecycleOwner.lifecycleScope.launch {
            val access = LicenseApi.refreshIfNeeded(requireContext())
            if (!isAdded || _binding == null) return@launch
            updateLicenseBadge()
            if (access is LicenseAccess.Locked) {
                findNavController().navigate(R.id.action_survey_to_license)
            }
        }
    }

    private fun updateLicenseBadge() {
        if (_binding == null) return
        if (!LicenseConfig.enabled) {
            binding.tvLicenseBadge.isVisible = false
            return
        }
        val snap = LicensePreferences.read(requireContext())
        val access = LicensePreferences.evaluateAccess(requireContext())
        if (access !is LicenseAccess.Allowed && access !is LicenseAccess.Grace) {
            binding.tvLicenseBadge.isVisible = false
            return
        }
        val expiresMs = when (access) {
            is LicenseAccess.Allowed -> access.expiresAtEpochMs
            is LicenseAccess.Grace -> access.expiresAtEpochMs
            else -> snap.expiresAtEpochMs
        }
        val date = SimpleDateFormat("dd MMM yyyy", Locale.US).format(Date(expiresMs))
        val days = snap.daysRemaining()
        binding.tvLicenseBadge.text = if (snap.isTrial) {
            getString(R.string.license_badge_trial, date, days)
        } else {
            getString(R.string.license_badge_rental, date, days)
        }
        binding.tvLicenseBadge.isVisible = true
    }

    private fun showLicenseInfoDialog() {
        val snap = LicensePreferences.read(requireContext())
        if (!snap.activated) return
        val date = SimpleDateFormat("dd MMM yyyy", Locale.US).format(Date(snap.expiresAtEpochMs))
        val days = snap.daysRemaining()
        val body = if (snap.isTrial) {
            val codePart = if (snap.licenseCode.isNotBlank()) " (${snap.licenseCode})" else ""
            getString(R.string.license_info_trial_body, codePart, date, days)
        } else {
            getString(
                R.string.license_info_rental_body,
                snap.customerName.ifBlank { "—" },
                date,
                days
            )
        }
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.license_info_title)
            .setMessage(body)
            .setPositiveButton(R.string.license_ok, null)
            .show()
    }

    override fun onPause() {
        stopLocationUpdates()
        unregisterGnssCallback()
        binding.mapView.onPause()
        super.onPause()
    }

    override fun onStop() {
        binding.mapView.onStop()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.mapView.onSaveInstanceState(outState)
    }

    override fun onLowMemory() {
        super.onLowMemory()
        binding.mapView.onLowMemory()
    }

    override fun onDestroyView() {
        unregisterGnssCallback()
        dismissSatWarmPopup()
        satBottomSheet?.dismiss()
        satBottomSheet = null
        binding.mapView.onDestroy()
        _binding = null
        map = null
        styleReady = false
        super.onDestroyView()
    }

    fun handlePhysicalKey(keyCode: Int): Boolean {
        if (!isAdded || !styleReady) return false
        when (keyCode) {
            android.view.KeyEvent.KEYCODE_VOLUME_UP -> {
                performQuickDrop()
                return true
            }
            android.view.KeyEvent.KEYCODE_VOLUME_DOWN -> {
                viewModel.undo()
        Toast.makeText(context, R.string.undo, Toast.LENGTH_SHORT).show()
                return true
            }
        }
        return false
    }

    private fun performQuickDrop() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.setProcessing(true, getString(R.string.gps_capturing_best))
            val location = collectBestGpsFix()
            if (location == null) {
                viewModel.setProcessing(false)
                Toast.makeText(requireContext(), R.string.quick_drop_error_no_location, Toast.LENGTH_LONG).show()
                return@launch
            }
            lastDeviceLocation = location
            rememberFix(location)
            updateGpsAccuracyUi(location)
            
            val centerLatLng = map?.cameraPosition?.target
            if (centerLatLng == null) {
                viewModel.setProcessing(false)
                Toast.makeText(requireContext(), "Map is not ready yet", Toast.LENGTH_SHORT).show()
                return@launch
            }
            
            viewModel.setProcessing(false)

            // After inserting on an Existing line: next + starts Proposed branch from the joint.
            if (viewModel.hasPendingProposedBranch()) {
                val source = viewModel.consumePendingProposedBranch()
                if (source != null) {
                    openTappingBubble(centerLatLng.latitude, centerLatLng.longitude, source)
                    return@launch
                }
            }

            val series = viewModel.activeSeriesConfig()
            val tap = viewModel.selectedTapPole()
            val isIdle = (series == null && tap == null)
            
            var nearestPole: SurveyAsset? = null
            var nearestLine: SurveyConnection? = null
            var lineCandidates: List<SurveyAsset> = emptyList()
            
            if (isIdle) {
                val pole = nearestConnectablePole(centerLatLng.latitude, centerLatLng.longitude)
                if (pole != null) {
                    val results = FloatArray(1)
                    android.location.Location.distanceBetween(
                        pole.latitude,
                        pole.longitude,
                        centerLatLng.latitude,
                        centerLatLng.longitude,
                        results
                    )
                    val distance = results[0]
                    if (distance <= 25.0f) {
                        nearestPole = pole
                    }
                }
                
                val nearLine = nearestCompletedConnection(centerLatLng.latitude, centerLatLng.longitude)
                if (nearLine != null) {
                    val survey = viewModel.survey.value
                    if (survey != null) {
                        val from = survey.assets.firstOrNull { it.id == nearLine.fromAssetId }
                        val to = survey.assets.firstOrNull { it.id == nearLine.toAssetId }
                        if (from != null && to != null) {
                            nearestLine = nearLine
                            lineCandidates = listOf(from, to)
                        }
                    }
                }
            }
            
            if (nearestPole != null || nearestLine != null) {
                showConsolidatedActions(nearestPole, nearestLine, lineCandidates, LatLng(centerLatLng.latitude, centerLatLng.longitude))
                return@launch
            }
            
            if (series != null) {
                openContinueBubble(centerLatLng.latitude, centerLatLng.longitude)
            } else {
                openNewNetworkBubble(centerLatLng.latitude, centerLatLng.longitude)
            }
        }
    }

    private fun showConsolidatedActions(
        nearestPole: SurveyAsset?,
        nearestLine: SurveyConnection?,
        lineCandidates: List<SurveyAsset>,
        centerLatLng: LatLng
    ) {
        val options = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()

        if (nearestPole != null) {
            options.add(getString(R.string.choice_start_proposed_from_pole, nearestPole.sequence))
            actions.add {
                openTappingBubble(centerLatLng.latitude, centerLatLng.longitude, nearestPole)
            }
        }

        if (nearestLine != null && lineCandidates.size >= 2) {
            val from = lineCandidates[0]
            val to = lineCandidates[1]
            options.add(getString(R.string.choice_insert_on_line, from.sequence, to.sequence))
            actions.add {
                val projected = GeometryHitTest.projectPointToSegment(
                    centerLatLng.latitude,
                    centerLatLng.longitude,
                    from.latitude,
                    from.longitude,
                    to.latitude,
                    to.longitude
                )
                // One dialog only: go straight into insert (Existing/Proposed), no second "Action near line" menu.
                openNearLineBubble(
                    projected.first,
                    projected.second,
                    lineCandidates,
                    nearestLine.id,
                    lineVoltage = nearestLine.voltage,
                    lineStatus = nearestLine.status,
                    directInsert = true
                )
            }
            // Branch options for both endpoints (skip if already offered as nearestPole).
            lineCandidates.forEach { pole ->
                if (nearestPole == null || pole.id != nearestPole.id) {
                    options.add(getString(R.string.choice_start_proposed_from_pole, pole.sequence))
                    actions.add {
                        openTappingBubble(centerLatLng.latitude, centerLatLng.longitude, pole)
                    }
                }
            }
        }

        options.add(getString(R.string.choice_new_network))
        actions.add {
            openNewNetworkBubble(centerLatLng.latitude, centerLatLng.longitude)
        }

        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.actions_near_target_title)
            .setItems(options.toTypedArray()) { _, which ->
                actions[which].invoke()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun triggerQuickDropFeedback() {
        try {
            val toneG = android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 100)
            toneG.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 150)
            val view = view ?: return
            view.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
        } catch (e: Exception) {
            // Ignore
        }
    }

    private var myLocationMarker: Marker? = null

    // ── GNSS Satellite registration ─────────────────────────────────────────
    @SuppressLint("MissingPermission")
    private fun registerGnssCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val lm = requireContext().getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        val hasPermission = ContextCompat.checkSelfPermission(
            requireContext(), Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasPermission) return
        val cb = object : GnssStatus.Callback() {
            override fun onSatelliteStatusChanged(status: GnssStatus) {
                val list = mutableListOf<SatInfo>()
                for (i in 0 until status.satelliteCount) {
                    val info = constellationInfo(status.getConstellationType(i))
                    list += SatInfo(
                        code      = info[0],
                        fullName  = info[1],
                        country   = info[2],
                        flag      = info[3],
                        bgColor   = Color.parseColor(info[4]),
                        svid      = status.getSvid(i),
                        snr       = status.getCn0DbHz(i),
                        usedInFix = status.usedInFix(i)
                    )
                }
                satelliteList = list.sortedByDescending { it.snr }
                val binding = _binding ?: return
                binding.root.post {
                    updateSatChip()
                    refreshSatSheet()
                }
            }

            override fun onStarted() {}
            override fun onStopped() {}
            override fun onFirstFix(ttffMillis: Int) {}
        }
        gnssCallback = cb
        lm.registerGnssStatusCallback(cb, android.os.Handler(android.os.Looper.getMainLooper()))
    }

    private fun unregisterGnssCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val cb = gnssCallback ?: return
        val lm = requireContext().getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        try { lm.unregisterGnssStatusCallback(cb) } catch (_: Exception) {}
        gnssCallback = null
    }

    /** Returns [code, fullName, country, flagEmoji, hexColor] for a GnssStatus constellation type. */
    private fun constellationInfo(type: Int): Array<String> = when (type) {
        GnssStatus.CONSTELLATION_GPS     -> arrayOf("GPS",  "GPS (NAVSTAR)",     "United States",   "🇺🇸", "#1565C0")
        GnssStatus.CONSTELLATION_GLONASS -> arrayOf("GLO",  "GLONASS",           "Russia",          "🇷🇺", "#B71C1C")
        GnssStatus.CONSTELLATION_GALILEO -> arrayOf("GAL",  "Galileo",           "European Union",  "🇪🇺", "#1B5E20")
        GnssStatus.CONSTELLATION_BEIDOU  -> arrayOf("BDS",  "BeiDou",            "China",           "🇨🇳", "#E65100")
        GnssStatus.CONSTELLATION_QZSS    -> arrayOf("QZSS", "QZSS (Michibiki)",  "Japan",           "🇯🇵", "#4A148C")
        GnssStatus.CONSTELLATION_SBAS    -> arrayOf("SBAS", "SBAS",              "International",   "🌐", "#546E7A")
        GnssStatus.CONSTELLATION_IRNSS   -> arrayOf("IRN",  "NavIC (IRNSS)",     "India",           "🇮🇳", "#880E4F")
        else                             -> arrayOf("UNK",  "Unknown",           "Unknown",         "🛰️", "#546E7A")
    }

    /** Updates the badge count and color in the status chip. */
    private fun updateSatChip() {
        val binding = _binding ?: return
        val total = satelliteList.size
        val used  = satelliteList.count { it.usedInFix }
        binding.tvSatCount.text = "$used/$total"
        val color = when {
            used >= 6 -> Color.parseColor("#1565C0") // strong – blue
            used >= 4 -> Color.parseColor("#E65100") // fair   – orange
            else      -> Color.parseColor("#D32F2F") // weak   – red
        }
        binding.tvSatCount.setTextColor(color)
    }

    /** Re-draws the satellite rows if the bottom sheet is currently visible. */
    private fun refreshSatSheet() {
        val sheet = satBottomSheet ?: return
        if (!sheet.isShowing) return
        val container = sheet.findViewById<LinearLayout>(R.id.satListContainer) ?: return
        val summaryTv = sheet.findViewById<TextView>(R.id.tvSatSummary) ?: return
        populateSatSheet(container, summaryTv)
    }

    /** Shows the satellite detail bottom sheet. */
    private fun showSatelliteSheet() {
        val ctx = context ?: return
        val sheet = BottomSheetDialog(ctx)
        val v = LayoutInflater.from(ctx).inflate(R.layout.bottom_sheet_satellites, null)
        sheet.setContentView(v)

        val container = v.findViewById<LinearLayout>(R.id.satListContainer)
        val summaryTv = v.findViewById<TextView>(R.id.tvSatSummary)
        val liveDot   = v.findViewById<View>(R.id.liveIndicator)

        // Blink the live dot
        val blink = AlphaAnimation(1f, 0.2f).apply {
            duration = 800; repeatMode = Animation.REVERSE
            repeatCount = Animation.INFINITE
        }
        liveDot.startAnimation(blink)

        populateSatSheet(container, summaryTv)
        satBottomSheet = sheet
        sheet.setOnDismissListener { satBottomSheet = null }
        sheet.show()
    }

    private fun populateSatSheet(container: LinearLayout, summaryTv: TextView) {
        val ctx = container.context
        val list = satelliteList
        val used = list.count { it.usedInFix }
        summaryTv.text = if (list.isEmpty()) "Searching for satellites…"
                         else "$used of ${list.size} in fix · updated live"

        container.removeAllViews()
        if (list.isEmpty()) {
            val empty = TextView(ctx).apply {
                text = "No satellite data yet. Ensure GPS is enabled and you are outdoors."
                setTextColor(Color.parseColor("#64748B"))
                textSize = 13f
                setPadding(8, 16, 8, 16)
            }
            container.addView(empty)
            return
        }

        for (sat in list) {
            // Outer row
            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, 12, 0, 12)
            }
            val dp = resources.displayMetrics.density

            // ── Flag emoji ─────────────────────────────────────────────────
            val flagTv = TextView(ctx).apply {
                text = sat.flag
                textSize = 22f
            }
            val lpFlag = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = (10 * dp).toInt() }
            row.addView(flagTv, lpFlag)

            // ── Full name + country stacked ─────────────────────────────────
            val nameBlock = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
            }

            // Full system name with colored code badge inline
            val systemRow = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val codeBadge = TextView(ctx).apply {
                text = sat.code
                textSize = 9f
                setTextColor(Color.WHITE)
                setBackgroundColor(sat.bgColor)
                val ph = (6 * dp).toInt(); val pv = (2 * dp).toInt()
                setPadding(ph, pv, ph, pv)
            }
            val lpBadge = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = (5 * dp).toInt() }
            systemRow.addView(codeBadge, lpBadge)

            val nameTv = TextView(ctx).apply {
                text = sat.fullName
                textSize = 13f
                setTextColor(Color.parseColor("#0F172A"))
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            systemRow.addView(nameTv)
            nameBlock.addView(systemRow)

            // Country subtitle
            val countryTv = TextView(ctx).apply {
                text = sat.country
                textSize = 11f
                setTextColor(Color.parseColor("#64748B"))
            }
            nameBlock.addView(countryTv)

            // PRN tiny label
            val prnTv = TextView(ctx).apply {
                text = "PRN ${sat.svid}"
                textSize = 10f
                setTextColor(Color.parseColor("#94A3B8"))
                typeface = android.graphics.Typeface.MONOSPACE
            }
            nameBlock.addView(prnTv)

            val lpName = LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
            )
            row.addView(nameBlock, lpName)

            // Signal bar
            val bar = ProgressBar(ctx, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 50  // typical max C/N₀ is ~50 dBHz
                progress = sat.snr.toInt().coerceIn(0, 50)
                val col = when {
                    sat.snr >= 35 -> Color.parseColor("#22C55E")  // strong
                    sat.snr >= 20 -> Color.parseColor("#F59E0B")  // fair
                    else          -> Color.parseColor("#EF4444")  // weak
                }
                progressTintList = android.content.res.ColorStateList.valueOf(col)
                progressBackgroundTintList = android.content.res.ColorStateList.valueOf(
                    Color.parseColor("#E2E8F0")
                )
            }
            val lp3 = LinearLayout.LayoutParams(
                0, (8 * resources.displayMetrics.density).toInt(), 1f
            ).apply {
                marginStart = (8 * resources.displayMetrics.density).toInt()
                marginEnd   = (8 * resources.displayMetrics.density).toInt()
                gravity = Gravity.CENTER_VERTICAL
            }
            row.addView(bar, lp3)

            // SNR value
            val snrLabel = TextView(ctx).apply {
                text = "${EnglishNumbers.format("%4.1f", sat.snr)} dB"
                textSize = 11f
                setTextColor(Color.parseColor("#64748B"))
                typeface = android.graphics.Typeface.MONOSPACE
            }
            val lp4 = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = (6 * resources.displayMetrics.density).toInt() }
            row.addView(snrLabel, lp4)

            // Used-in-fix dot
            val dot = View(ctx).apply {
                val s = (8 * resources.displayMetrics.density).toInt()
                background = ContextCompat.getDrawable(ctx, R.drawable.bg_sat_live_dot)
                backgroundTintList = android.content.res.ColorStateList.valueOf(
                    if (sat.usedInFix) Color.parseColor("#22C55E")
                    else Color.parseColor("#CBD5E1")
                )
                setLayoutParams(LinearLayout.LayoutParams(s, s))
            }
            row.addView(dot)

            // Divider
            val divider = View(ctx).apply {
                setBackgroundColor(Color.parseColor("#F1F5F9"))
            }
            val divLp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (1 * resources.displayMetrics.density).toInt()
            )
            container.addView(row)
            container.addView(divider, divLp)
        }
    }

    private val locationCallback = object : com.google.android.gms.location.LocationCallback() {
        override fun onLocationResult(locationResult: com.google.android.gms.location.LocationResult) {
            val location = locationResult.lastLocation ?: return
            lastDeviceLocation = location
            rememberFix(location)
            updateGpsAccuracyUi(location)
            updateMyLocationMarker()
        }
    }

    private fun updateGpsAccuracyUi(location: Location?) {
        if (_binding == null) return
        if (location == null || !location.hasAccuracy()) {
            binding.tvGpsAccuracy.text = getString(R.string.gps_accuracy_unknown)
            binding.tvGpsAccuracy.setTextColor(
                ContextCompat.getColor(requireContext(), R.color.text_secondary)
            )
            setGpsWarmingHint(true)
            return
        }
        val accuracy = location.accuracy
        val grade = SiteVerification.accuracyGrade(accuracy)
        val (textRes, color) = when (grade) {
            AccuracyGrade.EXCELLENT ->
                R.string.gps_accuracy_excellent to Color.parseColor("#15803D")
            AccuracyGrade.GOOD ->
                R.string.gps_accuracy_good to Color.parseColor("#16A34A")
            AccuracyGrade.WEAK ->
                R.string.gps_accuracy_weak to Color.parseColor("#CA8A04")
            AccuracyGrade.POOR ->
                R.string.gps_accuracy_poor to Color.parseColor("#DC2626")
            AccuracyGrade.UNKNOWN ->
                R.string.gps_accuracy_unknown to ContextCompat.getColor(requireContext(), R.color.text_secondary)
        }
        binding.tvGpsAccuracy.text = if (grade == AccuracyGrade.UNKNOWN) {
            getString(textRes)
        } else {
            EnglishNumbers.string(requireContext(), textRes, accuracy)
        }
        binding.tvGpsAccuracy.setTextColor(color)
        setGpsWarmingHint(grade == AccuracyGrade.UNKNOWN)

        val indicatorColor = when (grade) {
            AccuracyGrade.EXCELLENT, AccuracyGrade.GOOD -> Color.GREEN
            AccuracyGrade.WEAK -> Color.YELLOW
            else -> Color.RED
        }
        binding.gpsStatusIndicator.setColorFilter(indicatorColor, android.graphics.PorterDuff.Mode.SRC_IN)
    }

    /** Popup tip under the sat badge while GPS is still warming up. */
    private fun setGpsWarmingHint(warming: Boolean) {
        if (warming) {
            showSatWarmPopupIfNeeded()
        } else {
            dismissSatWarmPopup()
            satWarmHintShown = false
        }
    }

    private fun showSatWarmPopupIfNeeded() {
        if (!isAdded || satWarmHintShown || satWarmPopup?.isShowing == true) return
        val anchor = _binding?.satelliteChip ?: return
        if (!anchor.isShown || anchor.width == 0) {
            anchor.post { showSatWarmPopupIfNeeded() }
            return
        }
        val ctx = context ?: return
        satWarmHintShown = true
        val content = LayoutInflater.from(ctx).inflate(R.layout.popup_sat_warm_hint, null, false)
        content.setOnClickListener {
            dismissSatWarmPopup()
            showSatelliteSheet()
        }
        content.measure(
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        )
        val popup = PopupWindow(
            content,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            false
        ).apply {
            isOutsideTouchable = true
            isFocusable = false
            elevation = 10f
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setOnDismissListener { satWarmPopup = null }
        }
        // Align popup under the badge, arrow pointing up at it.
        val xOff = anchor.width - content.measuredWidth
        try {
            popup.showAsDropDown(anchor, xOff, 6)
            satWarmPopup = popup
            // Auto-dismiss after a short read time; user can still open sat view anytime.
            anchor.postDelayed({ dismissSatWarmPopup() }, 6_000L)
        } catch (_: Exception) {
            satWarmPopup = null
            satWarmHintShown = false
        }
    }

    private fun dismissSatWarmPopup() {
        satWarmPopup?.dismiss()
        satWarmPopup = null
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        if (!gpsReady) return
        val client = LocationServices.getFusedLocationProviderClient(requireContext())
        // Faster updates while surveying; internet assists A-GPS / fused location.
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_500L)
            .setMinUpdateIntervalMillis(750L)
            .setMinUpdateDistanceMeters(0.5f)
            .setWaitForAccurateLocation(true)
            .build()
        client.requestLocationUpdates(request, locationCallback, android.os.Looper.getMainLooper())
    }

    private fun stopLocationUpdates() {
        val client = LocationServices.getFusedLocationProviderClient(requireContext())
        client.removeLocationUpdates(locationCallback)
    }

    private fun updateMyLocationMarker() {
        val mapLibreMap = map ?: return
        val location = lastDeviceLocation ?: return
        val context = context ?: return
        val iconFactory = IconFactory.getInstance(context)
        
        val blinkOn = viewModel.blinkState.value
        val bitmap = SurveyMapRenderer.createMyLocationMarkerBitmap(context, blinkOn)
        val icon = iconFactory.fromBitmap(bitmap)
        
        val marker = myLocationMarker
        if (marker == null) {
            myLocationMarker = mapLibreMap.addMarker(
                org.maplibre.android.annotations.MarkerOptions()
                    .position(LatLng(location.latitude, location.longitude))
                    .title("My Location (Press + to drop)")
                    .icon(icon)
            )
        } else {
            marker.position = LatLng(location.latitude, location.longitude)
            marker.setIcon(icon)
        }
    }
}
