package com.blackgrapes.slmtoolbox.domain

import com.blackgrapes.slmtoolbox.domain.model.AssetType

enum class AssetField {
    POLE_MATERIAL,
    POLE_HEIGHT,
    CONDUCTOR,
    CIRCUIT,
    SPAN_LENGTH,
    DT_CAPACITY,
    STAY_TYPE,
    EARTHING_TYPE,
    REMARKS
}

object FieldRules {
    fun visibleFields(type: AssetType): Set<AssetField> = when (type) {
        AssetType.POLE -> setOf(
            AssetField.POLE_MATERIAL,
            AssetField.POLE_HEIGHT,
            AssetField.CONDUCTOR,
            AssetField.CIRCUIT,
            AssetField.SPAN_LENGTH,
            AssetField.REMARKS
        )
        AssetType.DT -> setOf(
            AssetField.DT_CAPACITY,
            AssetField.CONDUCTOR,
            AssetField.CIRCUIT,
            AssetField.REMARKS
        )
        AssetType.STAY -> setOf(
            AssetField.STAY_TYPE,
            AssetField.REMARKS
        )
        AssetType.EARTHING -> setOf(
            AssetField.EARTHING_TYPE,
            AssetField.REMARKS
        )
        AssetType.JUNCTION -> setOf(
            AssetField.CONDUCTOR,
            AssetField.CIRCUIT,
            AssetField.REMARKS
        )
        AssetType.NOTE -> setOf(AssetField.REMARKS)
    }

    fun canConnect(type: AssetType): Boolean =
        type == AssetType.POLE || type == AssetType.DT || type == AssetType.JUNCTION
}
