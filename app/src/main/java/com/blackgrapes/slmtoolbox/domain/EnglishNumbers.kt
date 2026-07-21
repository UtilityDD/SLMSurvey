package com.blackgrapes.slmtoolbox.domain

import android.content.Context
import androidx.annotation.StringRes
import java.util.Locale

/** Format UI numbers with Western Arabic digits (0–9), regardless of app language. */
object EnglishNumbers {
    fun string(context: Context, @StringRes resId: Int, vararg args: Any?): String =
        String.format(Locale.US, context.getString(resId), *args)

    fun format(pattern: String, vararg args: Any?): String =
        String.format(Locale.US, pattern, *args)
}
