package com.blackgrapes.slmtoolbox.data.mapper

import com.blackgrapes.slmtoolbox.data.entity.SurveyAssetEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyConnectionEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyWithDetails
import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.Survey
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.SurveyConnection
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

fun SurveyEntity.toDomain(
    assets: List<SurveyAssetEntity> = emptyList(),
    connections: List<SurveyConnectionEntity> = emptyList()
): Survey = Survey(
    id = id,
    title = title,
    linemanName = linemanName,
    linemanMobile = linemanMobile,
    createdAt = createdAt,
    updatedAt = updatedAt,
    isSavedWorkspace = isSavedWorkspace,
    savedAt = savedAt,
    assets = assets.map { it.toDomain() }.sortedBy { it.sequence },
    connections = connections.map { it.toDomain() }
)

fun SurveyWithDetails.toDomain(): Survey = survey.toDomain(assets, connections)

fun SurveyAssetEntity.toDomain(): SurveyAsset = SurveyAsset(
    id = id,
    surveyId = surveyId,
    sequence = sequence,
    latitude = latitude,
    longitude = longitude,
    voltage = VoltageLevel.fromLabel(voltage),
    status = WorkStatus.fromLabel(status),
    type = AssetType.fromLabel(type),
    poleRole = PoleRole.fromLabel(poleRole),
    poleMaterial = poleMaterial,
    poleHeightM = poleHeightM,
    conductor = conductor,
    circuit = circuit,
    spanLengthM = spanLengthM,
    dtCapacityKva = dtCapacityKva,
    stayType = stayType,
    earthingType = earthingType,
    remarks = remarks,
    structure = structure,
    seriesId = seriesId,
    deviceLatitude = deviceLatitude,
    deviceLongitude = deviceLongitude,
    deviceAccuracyM = deviceAccuracyM,
    deviceFixTimestamp = deviceFixTimestamp,
    distanceFromDeviceM = distanceFromDeviceM,
    isMockLocation = isMockLocation,
    locationVerified = locationVerified,
    satsUsedInFix = satsUsedInFix,
    satsVisible = satsVisible,
    avgSnrDb = avgSnrDb
)

fun SurveyConnectionEntity.toDomain(): SurveyConnection = SurveyConnection(
    id = id,
    surveyId = surveyId,
    fromAssetId = fromAssetId,
    toAssetId = toAssetId,
    voltage = VoltageLevel.fromLabel(voltage),
    status = WorkStatus.fromLabel(status),
    spanLengthM = spanLengthM
)

fun SurveyAsset.toEntity(): SurveyAssetEntity = SurveyAssetEntity(
    id = id,
    surveyId = surveyId,
    sequence = sequence,
    latitude = latitude,
    longitude = longitude,
    voltage = voltage.label,
    status = status.label,
    type = type.label,
    poleRole = poleRole.name,
    poleMaterial = poleMaterial,
    poleHeightM = poleHeightM,
    conductor = conductor,
    circuit = circuit,
    spanLengthM = spanLengthM,
    dtCapacityKva = dtCapacityKva,
    stayType = stayType,
    earthingType = earthingType,
    remarks = remarks,
    structure = structure,
    seriesId = seriesId,
    deviceLatitude = deviceLatitude,
    deviceLongitude = deviceLongitude,
    deviceAccuracyM = deviceAccuracyM,
    deviceFixTimestamp = deviceFixTimestamp,
    distanceFromDeviceM = distanceFromDeviceM,
    isMockLocation = isMockLocation,
    locationVerified = locationVerified,
    satsUsedInFix = satsUsedInFix,
    satsVisible = satsVisible,
    avgSnrDb = avgSnrDb
)

fun SurveyConnection.toEntity(): SurveyConnectionEntity = SurveyConnectionEntity(
    id = id,
    surveyId = surveyId,
    fromAssetId = fromAssetId,
    toAssetId = toAssetId,
    voltage = voltage.label,
    status = status.label,
    spanLengthM = spanLengthM
)
