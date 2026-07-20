package com.blackgrapes.slmtoolbox.ui.survey

import android.os.Parcel
import android.os.Parcelable
import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.PoleRole
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus

data class AssetParcelable(
    val id: Long,
    val surveyId: Long,
    val sequence: Int,
    val latitude: Double,
    val longitude: Double,
    val voltage: String,
    val status: String,
    val type: String,
    val poleRole: String,
    val poleMaterial: String?,
    val poleHeightM: String?,
    val conductor: String?,
    val circuit: String?,
    val spanLengthM: String?,
    val dtCapacityKva: String?,
    val stayType: String?,
    val earthingType: String?,
    val remarks: String?,
    val structure: String?,
    val seriesId: Long?,
    val deviceLatitude: Double?,
    val deviceLongitude: Double?,
    val deviceAccuracyM: Float?,
    val deviceFixTimestamp: Long?,
    val distanceFromDeviceM: Float?,
    val isMockLocation: Boolean,
    val locationVerified: Boolean
) : Parcelable {
    constructor(parcel: Parcel) : this(
        parcel.readLong(),
        parcel.readLong(),
        parcel.readInt(),
        parcel.readDouble(),
        parcel.readDouble(),
        parcel.readString().orEmpty(),
        parcel.readString().orEmpty(),
        parcel.readString().orEmpty(),
        parcel.readString().orEmpty(),
        parcel.readString(),
        parcel.readString(),
        parcel.readString(),
        parcel.readString(),
        parcel.readString(),
        parcel.readString(),
        parcel.readString(),
        parcel.readString(),
        parcel.readString(),
        parcel.readString(),
        parcel.readValue(Long::class.java.classLoader) as Long?,
        parcel.readValue(Double::class.java.classLoader) as Double?,
        parcel.readValue(Double::class.java.classLoader) as Double?,
        parcel.readValue(Float::class.java.classLoader) as Float?,
        parcel.readValue(Long::class.java.classLoader) as Long?,
        parcel.readValue(Float::class.java.classLoader) as Float?,
        parcel.readByte() != 0.toByte(),
        parcel.readByte() != 0.toByte()
    )

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        parcel.writeLong(id)
        parcel.writeLong(surveyId)
        parcel.writeInt(sequence)
        parcel.writeDouble(latitude)
        parcel.writeDouble(longitude)
        parcel.writeString(voltage)
        parcel.writeString(status)
        parcel.writeString(type)
        parcel.writeString(poleRole)
        parcel.writeString(poleMaterial)
        parcel.writeString(poleHeightM)
        parcel.writeString(conductor)
        parcel.writeString(circuit)
        parcel.writeString(spanLengthM)
        parcel.writeString(dtCapacityKva)
        parcel.writeString(stayType)
        parcel.writeString(earthingType)
        parcel.writeString(remarks)
        parcel.writeString(structure)
        parcel.writeValue(seriesId)
        parcel.writeValue(deviceLatitude)
        parcel.writeValue(deviceLongitude)
        parcel.writeValue(deviceAccuracyM)
        parcel.writeValue(deviceFixTimestamp)
        parcel.writeValue(distanceFromDeviceM)
        parcel.writeByte(if (isMockLocation) 1 else 0)
        parcel.writeByte(if (locationVerified) 1 else 0)
    }

    override fun describeContents(): Int = 0

    fun toDomain(): SurveyAsset = SurveyAsset(
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
        locationVerified = locationVerified
    )

    companion object CREATOR : Parcelable.Creator<AssetParcelable> {
        override fun createFromParcel(parcel: Parcel): AssetParcelable = AssetParcelable(parcel)
        override fun newArray(size: Int): Array<AssetParcelable?> = arrayOfNulls(size)
    }
}

fun SurveyAsset.toParcelable(): AssetParcelable = AssetParcelable(
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
    locationVerified = locationVerified
)
