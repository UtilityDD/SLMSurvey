package com.blackgrapes.slmtoolbox.domain

import android.content.Context
import android.os.Build
import android.telephony.TelephonyManager
import androidx.core.content.edit
import com.blackgrapes.slmtoolbox.domain.model.SurveyStamp
import java.util.UUID
import kotlin.math.round

object SurveyStampFactory {
    private const val PREFS = "survey_stamp_prefs"
    private const val KEY_INSTALL_ID = "installation_id"

    fun create(
        context: Context,
        linemanName: String,
        linemanMobile: String,
        latitude: Double?,
        longitude: Double?
    ): SurveyStamp {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val installId = prefs.getString(KEY_INSTALL_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit { putString(KEY_INSTALL_ID, it) }
        }

        val carrier = runCatching {
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            tm.networkOperatorName?.takeIf { it.isNotBlank() }
        }.getOrNull()

        return SurveyStamp(
            timestamp = System.currentTimeMillis(),
            coarseLatitude = latitude?.let { roundTo3(it) },
            coarseLongitude = longitude?.let { roundTo3(it) },
            installationId = installId.take(8),
            deviceModel = listOfNotNull(Build.MANUFACTURER, Build.MODEL)
                .joinToString(" ")
                .trim()
                .ifBlank { "Unknown device" },
            linemanName = linemanName,
            linemanMobile = linemanMobile,
            carrierName = carrier
        )
    }

    fun roundTo3(value: Double): Double = round(value * 1000.0) / 1000.0
}
