package com.blackgrapes.slmtoolbox.data.entity

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Relation

@Entity(tableName = "surveys")
data class SurveyEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val title: String,
    val linemanName: String = "",
    val linemanMobile: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val isSavedWorkspace: Boolean = false,
    val savedAt: Long? = null
)

@Entity(
    tableName = "survey_assets",
    foreignKeys = [
        ForeignKey(
            entity = SurveyEntity::class,
            parentColumns = ["id"],
            childColumns = ["surveyId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("surveyId"), Index("seriesId")]
)
data class SurveyAssetEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val surveyId: Long,
    val sequence: Int,
    val latitude: Double,
    val longitude: Double,
    val voltage: String,
    val status: String,
    val type: String,
    val poleRole: String = "CONTINUE",
    val poleMaterial: String? = null,
    val poleHeightM: String? = null,
    val conductor: String? = null,
    val circuit: String? = null,
    val spanLengthM: String? = null,
    val dtCapacityKva: String? = null,
    val stayType: String? = null,
    val earthingType: String? = null,
    val remarks: String? = null,
    val structure: String? = null,
    val seriesId: Long? = null,
    val deviceLatitude: Double? = null,
    val deviceLongitude: Double? = null,
    val deviceAccuracyM: Float? = null,
    val deviceFixTimestamp: Long? = null,
    val distanceFromDeviceM: Float? = null,
    val isMockLocation: Boolean = false,
    val locationVerified: Boolean = false
)

@Entity(
    tableName = "survey_connections",
    foreignKeys = [
        ForeignKey(
            entity = SurveyEntity::class,
            parentColumns = ["id"],
            childColumns = ["surveyId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("surveyId"), Index("fromAssetId"), Index("toAssetId")]
)
data class SurveyConnectionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val surveyId: Long,
    val fromAssetId: Long,
    val toAssetId: Long,
    val voltage: String,
    val status: String,
    val spanLengthM: String? = null
)

@Entity(
    tableName = "survey_series_meta",
    foreignKeys = [
        ForeignKey(
            entity = SurveyEntity::class,
            parentColumns = ["id"],
            childColumns = ["surveyId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("surveyId")]
)
data class SeriesMetaEntity(
    @PrimaryKey val seriesId: Long,
    val surveyId: Long,
    val feederName: String = "",
    val sourceSubstation: String = ""
)

data class SurveyWithDetails(
    @Embedded val survey: SurveyEntity,
    @Relation(parentColumn = "id", entityColumn = "surveyId")
    val assets: List<SurveyAssetEntity>,
    @Relation(parentColumn = "id", entityColumn = "surveyId")
    val connections: List<SurveyConnectionEntity>
)
