package com.blackgrapes.slmtoolbox.domain

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.LocaleList
import android.os.Looper
import com.blackgrapes.slmtoolbox.MainActivity
import java.util.Locale

/** App UI language for instructions / dialogs. Technical terms stay English. */
object LanguagePreferences {
    const val EN = "en"
    const val BN = "bn"
    const val HI = "hi"

    private const val PREFS = "slm_language_prefs"
    private const val KEY_LANG = "app_language"

    fun getCode(context: Context): String {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getString(KEY_LANG, EN) ?: EN
    }

    /** Persist language. Call [restartForLanguage] to apply safely. */
    fun setCode(context: Context, code: String) {
        val normalized = when (code) {
            BN, HI -> code
            else -> EN
        }
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LANG, normalized)
            .commit()
    }

    /** Apply stored language to a base context (attachBaseContext). */
    fun wrap(base: Context): Context {
        val tag = getCode(base)
        val locale = Locale.forLanguageTag(tag)
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            config.setLocales(LocaleList(locale))
        } else {
            @Suppress("DEPRECATION")
            config.locale = locale
        }
        return base.createConfigurationContext(config)
    }

    /**
     * Save is already done via [setCode]. Restarts the app on the next main-loop tick
     * so we are outside Chip/Material callbacks (avoids crash during locale recreate).
     */
    fun restartForLanguage(activity: Activity) {
        val appContext = activity.applicationContext
        Handler(Looper.getMainLooper()).post {
            val intent = Intent(appContext, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
                )
            }
            appContext.startActivity(intent)
            activity.finishAffinity()
        }
    }

    fun displayName(code: String): String = when (code) {
        BN -> "বাংলা"
        HI -> "हिन्दी"
        else -> "English"
    }
}
