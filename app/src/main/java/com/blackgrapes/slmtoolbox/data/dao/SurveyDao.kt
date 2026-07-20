package com.blackgrapes.slmtoolbox.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import com.blackgrapes.slmtoolbox.data.entity.SeriesMetaEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyAssetEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyConnectionEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyWithDetails
import kotlinx.coroutines.flow.Flow

@Dao
interface SurveyDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSurvey(survey: SurveyEntity): Long

    @Update
    suspend fun updateSurvey(survey: SurveyEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAsset(asset: SurveyAssetEntity): Long

    @Update
    suspend fun updateAsset(asset: SurveyAssetEntity)

    @Delete
    suspend fun deleteAsset(asset: SurveyAssetEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertConnection(connection: SurveyConnectionEntity): Long

    @Delete
    suspend fun deleteConnection(connection: SurveyConnectionEntity)

    @Query("DELETE FROM survey_connections WHERE fromAssetId = :assetId OR toAssetId = :assetId")
    suspend fun deleteConnectionsForAsset(assetId: Long)

    @Query("DELETE FROM survey_connections WHERE surveyId = :surveyId")
    suspend fun deleteConnectionsForSurvey(surveyId: Long)

    @Query("DELETE FROM survey_assets WHERE surveyId = :surveyId")
    suspend fun deleteAssetsForSurvey(surveyId: Long)

    @Transaction
    suspend fun clearSurveyDrawing(surveyId: Long) {
        deleteConnectionsForSurvey(surveyId)
        deleteAssetsForSurvey(surveyId)
    }

    @Query("SELECT * FROM surveys ORDER BY updatedAt DESC")
    fun observeSurveys(): Flow<List<SurveyEntity>>

    @Query("SELECT * FROM surveys WHERE isSavedWorkspace = 1 ORDER BY savedAt DESC")
    fun observeSavedWorkspaces(): Flow<List<SurveyEntity>>

    @Transaction
    @Query("SELECT * FROM surveys WHERE isSavedWorkspace = 1 ORDER BY savedAt DESC")
    fun observeSavedWorkspacesWithDetails(): Flow<List<SurveyWithDetails>>

    @Query("SELECT * FROM surveys ORDER BY updatedAt DESC LIMIT 1")
    suspend fun getLatestSurvey(): SurveyEntity?

    @Transaction
    @Query("SELECT * FROM surveys WHERE id = :surveyId")
    fun observeSurveyWithDetails(surveyId: Long): Flow<SurveyWithDetails?>

    @Transaction
    @Query("SELECT * FROM surveys WHERE id = :surveyId")
    suspend fun getSurveyWithDetails(surveyId: Long): SurveyWithDetails?

    @Query("SELECT COALESCE(MAX(sequence), 0) FROM survey_assets WHERE surveyId = :surveyId")
    suspend fun maxSequence(surveyId: Long): Int

    @Query("DELETE FROM surveys WHERE id = :surveyId")
    suspend fun deleteSurvey(surveyId: Long)

    @Query("SELECT * FROM survey_connections WHERE id = :connectionId")
    suspend fun getConnectionWithDetails(connectionId: Long): SurveyConnectionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSeriesMeta(meta: SeriesMetaEntity)

    @Query("SELECT * FROM survey_series_meta WHERE seriesId = :seriesId")
    suspend fun getSeriesMeta(seriesId: Long): SeriesMetaEntity?

    @Query("SELECT * FROM survey_series_meta WHERE surveyId = :surveyId")
    suspend fun getSeriesMetaForSurvey(surveyId: Long): List<SeriesMetaEntity>

    @Query("DELETE FROM survey_series_meta WHERE surveyId = :surveyId")
    suspend fun deleteSeriesMetaForSurvey(surveyId: Long)
}
