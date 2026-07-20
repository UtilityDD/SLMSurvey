package com.blackgrapes.slmtoolbox.ui.survey

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.blackgrapes.slmtoolbox.data.repo.SurveyRepository
import com.blackgrapes.slmtoolbox.domain.NetworkCatalog
import com.blackgrapes.slmtoolbox.domain.PlacementDraft
import com.blackgrapes.slmtoolbox.domain.SeriesConfig
import com.blackgrapes.slmtoolbox.domain.SiteVerification
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.PoleStructure
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

sealed class UndoAction {
    data class AssetAdded(val assetId: Long) : UndoAction()
    data class ConnectionAdded(val connectionId: Long) : UndoAction()
}

data class LocationEvidence(
    val deviceLatitude: Double?,
    val deviceLongitude: Double?,
    val deviceAccuracyM: Float?,
    val deviceFixTimestamp: Long?,
    val distanceFromDeviceM: Float?,
    val isMockLocation: Boolean
)

@OptIn(ExperimentalCoroutinesApi::class)
class SurveyViewModel(private val repository: SurveyRepository) : ViewModel() {

    private val surveyId = MutableStateFlow<Long?>(null)
    private val undoStack = ArrayDeque<UndoAction>()
    private val _selectedTapPoleId = MutableStateFlow<Long?>(null)
    val selectedTapPoleId: StateFlow<Long?> = _selectedTapPoleId.asStateFlow()

    private val _isProcessing = MutableStateFlow(false)
    val isProcessing: StateFlow<Boolean> = _isProcessing.asStateFlow()

    private val _processingMessage = MutableStateFlow<String?>(null)
    val processingMessage: StateFlow<String?> = _processingMessage.asStateFlow()

    private val _pendingPlacement = MutableStateFlow<PlacementDraft?>(null)
    val pendingPlacement: StateFlow<PlacementDraft?> = _pendingPlacement.asStateFlow()

    private val _blinkState = MutableStateFlow(false)
    val blinkState: StateFlow<Boolean> = _blinkState.asStateFlow()

    val survey: StateFlow<Survey?> = surveyId
        .flatMapLatest { id ->
            if (id == null) flowOf(null) else repository.observeSurvey(id)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val savedWorkspaces: StateFlow<List<Survey>> =
        repository.observeSavedWorkspaces()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        startBlinkTimer()
    }

    private fun startBlinkTimer() {
        viewModelScope.launch {
            while (true) {
                _blinkState.value = !_blinkState.value
                delay(500)
            }
        }
    }

    fun setProcessing(processing: Boolean, message: String? = null) {
        _isProcessing.value = processing
        _processingMessage.value = message
    }

    fun setPendingPlacement(draft: PlacementDraft?) {
        _pendingPlacement.value = draft
    }

    fun ensureDraft() {
        viewModelScope.launch {
            if (surveyId.value == null) {
                surveyId.value = repository.getOrCreateDraft().id
            }
        }
    }

    fun newSurvey() {
        viewModelScope.launch {
            undoStack.clear()
            _selectedTapPoleId.value = null
            surveyId.value = repository.createSurvey("Field Survey").id
        }
    }

    fun openWorkspace(workspaceId: Long) {
        _selectedTapPoleId.value = null
        undoStack.clear()
        surveyId.value = workspaceId
    }

    suspend fun saveWorkspaceAndStartNew(name: String) {
        val id = surveyId.value ?: return
        setProcessing(true, "Saving Workspace...")
        try {
            repository.saveWorkspace(id, name)
            undoStack.clear()
            _selectedTapPoleId.value = null
            surveyId.value = repository.createSurvey("Field Survey").id
        } finally {
            setProcessing(false)
        }
    }

    fun deleteWorkspace(surveyId: Long) {
        viewModelScope.launch {
            repository.deleteWorkspace(surveyId)
        }
    }

    fun selectTapPole(asset: SurveyAsset) {
        if (com.blackgrapes.slmtoolbox.domain.FieldRules.canConnect(asset.type)) {
            _selectedTapPoleId.value = asset.id
        }
    }

    fun clearTapPole() {
        _selectedTapPoleId.value = null
    }

    fun selectedTapPole(): SurveyAsset? {
        val id = _selectedTapPoleId.value ?: return null
        return survey.value?.assets?.firstOrNull { it.id == id }
    }

    fun activeSeriesConfig(): SeriesConfig? {
        selectedTapPole()?.let { return NetworkCatalog.seriesConfigFrom(it) }
        val tip = activeOpenTip() ?: return null
        return NetworkCatalog.seriesConfigFrom(tip)
    }

    fun activeLineVoltage(): VoltageLevel? = activeSeriesConfig()?.voltage

    fun isLineOpen(): Boolean = activeSeriesConfig() != null

    fun activeOpenTip(): SurveyAsset? {
        selectedTapPole()?.let { tap ->
            if (tap.poleRole != PoleRole.END) return tap
        }
        val assets = survey.value?.assets.orEmpty()
        val openTips = assets.filter { asset ->
            com.blackgrapes.slmtoolbox.domain.FieldRules.canConnect(asset.type) &&
                asset.poleRole != PoleRole.END &&
                asset.seriesId != null &&
                assets.none { other ->
                    other.seriesId == asset.seriesId &&
                        other.sequence > asset.sequence &&
                        other.poleRole != PoleRole.END
                } &&
                survey.value?.connections.orEmpty().none { conn ->
                    conn.fromAssetId == asset.id &&
                        assets.any { child ->
                            child.id == conn.toAssetId && child.seriesId == asset.seriesId
                        }
                }
        }
        return openTips.maxByOrNull { it.sequence }
    }

    fun updateMeta(title: String, linemanName: String? = null, linemanMobile: String? = null) {
        val id = surveyId.value ?: return
        viewModelScope.launch {
            val current = repository.getSurvey(id)
            repository.updateSurveyMeta(
                surveyId = id,
                title = title,
                linemanName = linemanName ?: current?.linemanName.orEmpty(),
                linemanMobile = linemanMobile ?: current?.linemanMobile.orEmpty()
            )
        }
    }

    suspend fun placePole(draft: PlacementDraft, evidence: LocationEvidence) {
        val id = surveyId.value ?: return
        setProcessing(true, "Finalizing...")
        try {
            val current = repository.getSurvey(id)
            
            // Logic for Splitting a connection
            if (draft.splitConnectionId != null) {
                val conn = repository.getConnection(draft.splitConnectionId)
                if (conn != null) {
                    val fromAsset = current?.assets?.firstOrNull { it.id == conn.fromAssetId }
                    val toAsset = current?.assets?.firstOrNull { it.id == conn.toAssetId }
                    
                    if (fromAsset != null && toAsset != null) {
                        // Create New Asset
                        val verified = SiteVerification.isVerified(
                            deviceLatitude = evidence.deviceLatitude,
                            deviceLongitude = evidence.deviceLongitude,
                            deviceAccuracyM = evidence.deviceAccuracyM,
                            deviceFixTimestamp = evidence.deviceFixTimestamp,
                            distanceFromDeviceM = evidence.distanceFromDeviceM,
                            isMockLocation = evidence.isMockLocation
                        )
                        
                        val newAssetId = repository.addAsset(SurveyAsset(
                            surveyId = id,
                            sequence = fromAsset.sequence + 1, // Will need renumbering
                            latitude = draft.latitude,
                            longitude = draft.longitude,
                            voltage = conn.voltage,
                            status = conn.status,
                            type = NetworkCatalog.assetTypeFor(draft.structure),
                            poleRole = PoleRole.CONTINUE,
                            poleMaterial = draft.material.label,
                            conductor = draft.conductor,
                            structure = draft.structure.label,
                            seriesId = fromAsset.seriesId,
                            deviceLatitude = evidence.deviceLatitude,
                            deviceLongitude = evidence.deviceLongitude,
                            deviceAccuracyM = evidence.deviceAccuracyM,
                            deviceFixTimestamp = evidence.deviceFixTimestamp,
                            distanceFromDeviceM = evidence.distanceFromDeviceM,
                            isMockLocation = evidence.isMockLocation,
                            locationVerified = verified
                        ))
                        
                        // Renumber subsequent poles in same series
                        current.assets.filter { it.seriesId == fromAsset.seriesId && it.sequence > fromAsset.sequence }
                            .forEach { sibling ->
                                repository.updateAsset(sibling.copy(sequence = sibling.sequence + 1))
                            }
                            
                        // Delete old connection
                        repository.deleteConnection(conn)
                        
                        val created = repository.getSurvey(id)?.assets?.firstOrNull { it.id == newAssetId }
                        if (created != null) {
                            // Link A -> P
                            repository.connectAssets(id, fromAsset, created, null)
                            // Link P -> B
                            repository.connectAssets(id, created, toAsset, null)
                            
                            // Auto select for branching
                            selectTapPole(created)
                        }
                        return
                    }
                }
            }

            val tapSourceId = _selectedTapPoleId.value
            _selectedTapPoleId.value = null
            
            val tapSource = tapSourceId?.let { tapId ->
                current?.assets?.firstOrNull { it.id == tapId }
            } ?: draft.sourceAssetId?.let { sourceId ->
                current?.assets?.firstOrNull { it.id == sourceId }
            }
            val openTip = activeOpenTipResolved(current, tapSource)
            val isTappingBranch = tapSource != null && draft.seriesId == null
            val connectionSource = when {
                isTappingBranch -> tapSource
                draft.seriesId != null -> openTip ?: tapSource
                else -> null
            }
            val continuingSeries = draft.seriesId != null && connectionSource != null
            val seriesId = when {
                continuingSeries -> draft.seriesId ?: connectionSource?.seriesId ?: System.currentTimeMillis()
                else -> System.currentTimeMillis()
            }
            val effectiveRole = when {
                continuingSeries && draft.poleRole == PoleRole.END -> PoleRole.END
                continuingSeries -> PoleRole.CONTINUE
                draft.poleRole == PoleRole.END -> PoleRole.END
                else -> PoleRole.START
            }
            val locked = if (continuingSeries) {
                draft.seriesId?.let { sid ->
                    current?.assets?.firstOrNull { it.seriesId == sid }?.let { NetworkCatalog.seriesConfigFrom(it) }
                } ?: connectionSource?.let { NetworkCatalog.seriesConfigFrom(it) }
            } else {
                null
            }
            val voltage = locked?.voltage ?: if (isTappingBranch) tapSource!!.voltage else draft.voltage
            val status = locked?.status ?: draft.status
            val material = locked?.material ?: draft.material
            val conductor = locked?.conductor ?: draft.conductor
            val structure = draft.structure
            val type = NetworkCatalog.assetTypeFor(structure)

            val shouldConnect = connectionSource != null && (continuingSeries || isTappingBranch)
            val measuredSpan = if (shouldConnect) {
                measuredSpanMetres(connectionSource!!.latitude, connectionSource.longitude, draft.latitude, draft.longitude)
            } else {
                null
            }
            val resolvedSpan = measuredSpan?.let { it.roundToInt().toString() }
            val verified = SiteVerification.isVerified(
                deviceLatitude = evidence.deviceLatitude,
                deviceLongitude = evidence.deviceLongitude,
                deviceAccuracyM = evidence.deviceAccuracyM,
                deviceFixTimestamp = evidence.deviceFixTimestamp,
                distanceFromDeviceM = evidence.distanceFromDeviceM,
                isMockLocation = evidence.isMockLocation
            )

            val assetId = repository.addAsset(
                SurveyAsset(
                    surveyId = id,
                    sequence = 0,
                    latitude = draft.latitude,
                    longitude = draft.longitude,
                    voltage = voltage,
                    status = status,
                    type = type,
                    poleRole = effectiveRole,
                    poleMaterial = material.label,
                    conductor = conductor,
                    spanLengthM = resolvedSpan,
                    structure = structure.label,
                    seriesId = seriesId,
                    deviceLatitude = evidence.deviceLatitude,
                    deviceLongitude = evidence.deviceLongitude,
                    deviceAccuracyM = evidence.deviceAccuracyM,
                    deviceFixTimestamp = evidence.deviceFixTimestamp,
                    distanceFromDeviceM = evidence.distanceFromDeviceM,
                    isMockLocation = evidence.isMockLocation,
                    locationVerified = verified
                )
            )
            undoStack.addLast(UndoAction.AssetAdded(assetId))

            val created = repository.getSurvey(id)?.assets?.firstOrNull { it.id == assetId }
            val fromPole = connectionSource
            if (shouldConnect && fromPole != null && created != null) {
                val connectionId = repository.connectAssets(
                    surveyId = id,
                    from = fromPole,
                    to = created,
                    spanLengthM = resolvedSpan
                )
                if (connectionId != null) {
                    undoStack.addLast(UndoAction.ConnectionAdded(connectionId))
                }
            }

            // Persist feeder metadata for new 33kV/11kV series
            if (effectiveRole == PoleRole.START &&
                voltage != VoltageLevel.LT &&
                (draft.feederName.isNotBlank() || draft.sourceSubstation.isNotBlank())
            ) {
                repository.saveSeriesMeta(
                    surveyId = id,
                    seriesId = seriesId,
                    feederName = draft.feederName,
                    sourceSubstation = draft.sourceSubstation
                )
            }
        } finally {
            setProcessing(false)
            setPendingPlacement(null)
        }
    }

    private fun activeOpenTipResolved(current: Survey?, tapSource: SurveyAsset?): SurveyAsset? {
        if (tapSource != null && tapSource.poleRole != PoleRole.END) return tapSource
        val assets = current?.assets.orEmpty()
        return assets
            .filter { com.blackgrapes.slmtoolbox.domain.FieldRules.canConnect(it.type) && it.poleRole != PoleRole.END && it.seriesId != null }
            .filter { tip ->
                current?.connections.orEmpty().none { conn ->
                    conn.fromAssetId == tip.id &&
                        assets.any { child -> child.id == conn.toAssetId && child.seriesId == tip.seriesId }
                }
            }
            .maxByOrNull { it.sequence }
    }

    fun updateAsset(asset: SurveyAsset) {
        viewModelScope.launch {
            val current = repository.getSurvey(asset.surveyId) ?: return@launch
            val siblings = current.assets.filter { it.seriesId != null && it.seriesId == asset.seriesId }
            val seriesAnchor = siblings.minByOrNull { it.sequence }
            val locked = seriesAnchor?.let { NetworkCatalog.seriesConfigFrom(it) }
            val sanitized = if (locked != null) {
                asset.copy(
                    voltage = locked.voltage,
                    status = locked.status,
                    poleMaterial = locked.material.label,
                    conductor = locked.conductor,
                    type = NetworkCatalog.assetTypeFor(asset.poleStructure ?: PoleStructure.P1)
                )
            } else {
                asset.copy(
                    type = NetworkCatalog.assetTypeFor(asset.poleStructure ?: PoleStructure.P1)
                )
            }
            repository.updateAsset(sanitized)
        }
    }

    fun deleteAsset(asset: SurveyAsset) {
        viewModelScope.launch {
            if (_selectedTapPoleId.value == asset.id) {
                _selectedTapPoleId.value = null
            }
            repository.deleteAsset(asset)
        }
    }

    fun clearDrawing() {
        val id = surveyId.value ?: return
        _selectedTapPoleId.value = null
        undoStack.clear()
        viewModelScope.launch {
            repository.clearDrawing(id)
        }
    }

    fun undo() {
        viewModelScope.launch {
            val survey = repository.getSurvey(surveyId.value ?: return@launch) ?: return@launch
            when (val action = undoStack.removeLastOrNull() ?: return@launch) {
                is UndoAction.AssetAdded -> {
                    survey.assets.firstOrNull { it.id == action.assetId }?.let {
                        repository.deleteAsset(it)
                    }
                }
                is UndoAction.ConnectionAdded -> {
                    survey.connections.firstOrNull { it.id == action.connectionId }?.let {
                        repository.deleteConnection(it)
                    }
                }
            }
        }
    }

    private fun measuredSpanMetres(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
        val results = FloatArray(1)
        android.location.Location.distanceBetween(fromLat, fromLng, toLat, toLng, results)
        return results[0].toDouble()
    }

    suspend fun getSeriesMetaForSurvey(surveyId: Long) =
        repository.getSeriesMetaForSurvey(surveyId)

    class Factory(private val repository: SurveyRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(SurveyViewModel::class.java)) {
                return SurveyViewModel(repository) as T
            }
            throw IllegalArgumentException("Unknown ViewModel ${modelClass.name}")
        }
    }
}
