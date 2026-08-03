package com.blackgrapes.slmtoolbox.data.repo

import com.blackgrapes.slmtoolbox.data.dao.SurveyDao
import com.blackgrapes.slmtoolbox.data.entity.SavedWorkspaceSummaryRow
import com.blackgrapes.slmtoolbox.data.entity.SeriesMetaEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyWithDetails
import com.blackgrapes.slmtoolbox.data.mapper.toDomain
import com.blackgrapes.slmtoolbox.data.mapper.toEntity
import com.blackgrapes.slmtoolbox.domain.FieldRules
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class SurveyRepository(private val dao: SurveyDao) {

    fun observeSavedWorkspaces(): Flow<List<Survey>> =
        dao.observeSavedWorkspacesWithDetails().map { rows -> rows.map { it.toDomain() } }

    fun observeSavedWorkspaceSummaries(): Flow<List<SavedWorkspaceSummaryRow>> =
        dao.observeSavedWorkspaceSummaries()

    suspend fun getSavedWorkspacesWithDetails(): List<Survey> =
        dao.getSavedWorkspacesWithDetails().map { it.toDomain() }

    fun observeSurvey(surveyId: Long): Flow<Survey?> =
        dao.observeSurveyWithDetails(surveyId).map { it?.toDomain() }

    suspend fun getSurvey(surveyId: Long): Survey? =
        dao.getSurveyWithDetails(surveyId)?.toDomain()

    suspend fun getOrCreateDraft(title: String = "Field Survey"): Survey {
        // Prefer an unsaved draft so opening the app does not "steal" a My Maps entry.
        val latestDraft = dao.getLatestDraftSurvey()
        if (latestDraft != null) {
            return dao.getSurveyWithDetails(latestDraft.id)?.toDomain()
                ?: latestDraft.toDomain()
        }
        val id = dao.insertSurvey(
            SurveyEntity(title = title, updatedAt = System.currentTimeMillis())
        )
        return dao.getSurveyWithDetails(id)?.toDomain()
            ?: Survey(id = id, title = title)
    }

    suspend fun createSurvey(title: String): Survey {
        val id = dao.insertSurvey(
            SurveyEntity(title = title, updatedAt = System.currentTimeMillis())
        )
        return dao.getSurveyWithDetails(id)?.toDomain()
            ?: Survey(id = id, title = title)
    }

    suspend fun updateSurveyMeta(
        surveyId: Long,
        title: String,
        linemanName: String,
        linemanMobile: String
    ) {
        dao.updateSurveyMetaFields(
            surveyId = surveyId,
            title = title,
            linemanName = linemanName,
            linemanMobile = linemanMobile,
            updatedAt = System.currentTimeMillis()
        )
    }

    suspend fun addAsset(asset: SurveyAsset): Long {
        val sequence = if (asset.sequence > 0) asset.sequence else dao.maxSequence(asset.surveyId) + 1
        val id = dao.insertAsset(asset.copy(sequence = sequence).toEntity())
        touchSurvey(asset.surveyId)
        return id
    }

    suspend fun updateAsset(asset: SurveyAsset) {
        dao.updateAsset(asset.toEntity())
        touchSurvey(asset.surveyId)
    }

    suspend fun deleteAsset(asset: SurveyAsset) {
        dao.deleteConnectionsForAsset(asset.id)
        dao.deleteAsset(asset.toEntity())
        touchSurvey(asset.surveyId)
    }

    suspend fun clearDrawing(surveyId: Long) {
        dao.deleteSeriesMetaForSurvey(surveyId)
        dao.clearSurveyDrawing(surveyId)
        touchSurvey(surveyId)
    }

    suspend fun saveSeriesMeta(
        surveyId: Long,
        seriesId: Long,
        feederName: String,
        sourceSubstation: String
    ) {
        dao.insertSeriesMeta(
            SeriesMetaEntity(
                seriesId = seriesId,
                surveyId = surveyId,
                feederName = feederName,
                sourceSubstation = sourceSubstation
            )
        )
    }

    suspend fun getSeriesMeta(seriesId: Long): SeriesMetaEntity? =
        dao.getSeriesMeta(seriesId)

    suspend fun getSeriesMetaForSurvey(surveyId: Long): List<SeriesMetaEntity> =
        dao.getSeriesMetaForSurvey(surveyId)

    /**
     * Persist name + surveyor and mark as My Maps in one UPDATE.
     * @return false if the survey row was missing.
     */
    suspend fun saveWorkspace(
        surveyId: Long,
        name: String,
        linemanName: String = "",
        linemanMobile: String = ""
    ): Boolean {
        val current = dao.getSurveyWithDetails(surveyId)?.survey ?: return false
        val now = System.currentTimeMillis()
        val title = name.trim().ifBlank { current.title }
        val updated = dao.markWorkspaceSaved(
            surveyId = surveyId,
            title = title,
            linemanName = linemanName.ifBlank { current.linemanName },
            linemanMobile = linemanMobile.ifBlank { current.linemanMobile },
            savedAt = now,
            updatedAt = now
        )
        return updated > 0
    }

    suspend fun deleteWorkspace(surveyId: Long) {
        dao.deleteSurvey(surveyId)
    }

    suspend fun connectAssets(
        surveyId: Long,
        from: SurveyAsset,
        to: SurveyAsset,
        spanLengthM: String?,
        statusOverride: com.blackgrapes.slmtoolbox.domain.model.WorkStatus? = null
    ): Long? {
        if (!FieldRules.canConnect(from.type) || !FieldRules.canConnect(to.type)) return null
        if (from.id == to.id) return null
        val connection = SurveyConnection(
            surveyId = surveyId,
            fromAssetId = from.id,
            toAssetId = to.id,
            voltage = to.voltage,
            status = statusOverride ?: to.status,
            spanLengthM = spanLengthM ?: to.spanLengthM
        )
        val id = dao.insertConnection(connection.toEntity())
        touchSurvey(surveyId)
        return id
    }

    suspend fun deleteConnection(connection: SurveyConnection) {
        dao.deleteConnection(connection.toEntity())
        touchSurvey(connection.surveyId)
    }

    suspend fun getConnection(connectionId: Long): SurveyConnection? {
        return dao.getConnectionWithDetails(connectionId)?.toDomain()
    }

    private suspend fun touchSurvey(surveyId: Long) {
        val current = dao.getSurveyWithDetails(surveyId)?.survey ?: return
        dao.updateSurvey(current.copy(updatedAt = System.currentTimeMillis()))
    }
}
