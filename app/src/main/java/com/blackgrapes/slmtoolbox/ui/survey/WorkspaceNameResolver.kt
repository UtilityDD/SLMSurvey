package com.blackgrapes.slmtoolbox.ui.survey

import android.content.Context
import android.location.Geocoder
import com.blackgrapes.slmtoolbox.domain.model.Survey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

object WorkspaceNameResolver {

    @Suppress("DEPRECATION")
    suspend fun suggest(context: Context, survey: Survey): String = withContext(Dispatchers.IO) {
        val point = survey.assets.firstOrNull()
            ?: return@withContext "SLD_New_Location"
        val place = runCatching {
            Geocoder(context, Locale.getDefault())
                .getFromLocation(point.latitude, point.longitude, 1)
                ?.firstOrNull()
                ?.let { address ->
                    listOf(
                        address.subLocality,
                        address.locality,
                        address.subAdminArea,
                        address.adminArea,
                        address.featureName
                    ).firstOrNull { !it.isNullOrBlank() }
                }
        }.getOrNull()

        val locationPart = place
            ?.trim()
            ?.replace(Regex("[^\\p{L}\\p{N}]+"), "_")
            ?.trim('_')
            ?.takeIf { it.isNotBlank() }
            ?: String.format(
                Locale.US,
                "%.3f_%.3f",
                point.latitude,
                point.longitude
            )
        "SLD_$locationPart"
    }
}
