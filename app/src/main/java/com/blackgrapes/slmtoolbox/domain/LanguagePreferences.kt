package com.blackgrapes.slmtoolbox.domain

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/** App UI language for instructions / dialogs. Technical terms stay English. */
object LanguagePreferences {
    const val EN = "en"
    const val BN = "bn"
    const val HI = "hi"

    private const val PREFS = "slm_language_prefs"
    private const val KEY_LANG = "app_language"

    fun getCode(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getString(KEY_LANG, EN) ?: EN
    }

    fun setCode(context: Context, code: String) {
        val normalized = when (code) {
            BN, HI -> code
            else -> EN
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LANG, normalized)
            .apply()
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(normalized))
    }

    fun applyStored(context: Context) {
        AppCompatDelegate.setApplicationLocales(
            LocaleListCompat.forLanguageTags(getCode(context))
        )
    }

    fun displayName(code: String): String = when (code) {
        BN -> "বাংলা"
        HI -> "हिन्दी"
        else -> "English"
    }
}
