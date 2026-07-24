package com.blackgrapes.slmtoolbox.domain

import android.content.Context

/**
 * Post-execution survey presets.
 * Only [OPTION_LT_CONVERSION_ABC] is implemented; other picks are UI placeholders.
 */
object PostExecPreferences {
    const val OPTION_LT_CONVERSION_ABC = "lt_conv_abc"
    const val OPTION_NONE = ""

    private const val PREFS = "slm_post_exec_ui"
    private const val KEY_33 = "post_exec_KV_33"
    private const val KEY_11 = "post_exec_KV_11"
    private const val KEY_DTR_LT = "post_exec_DTR_LT"

    fun getSelected(context: Context, group: PostExecGroup): String {
        val key = when (group) {
            PostExecGroup.KV_33 -> KEY_33
            PostExecGroup.KV_11 -> KEY_11
            PostExecGroup.DTR_LT -> KEY_DTR_LT
        }
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(key, OPTION_NONE)
            .orEmpty()
    }

    fun saveSelected(context: Context, group: PostExecGroup, optionId: String) {
        val key = when (group) {
            PostExecGroup.KV_33 -> KEY_33
            PostExecGroup.KV_11 -> KEY_11
            PostExecGroup.DTR_LT -> KEY_DTR_LT
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(key, optionId)
            .apply()
    }

    fun clearGroup(context: Context, group: PostExecGroup) {
        saveSelected(context, group, OPTION_NONE)
    }

    /** Active implemented post-exec preset. */
    fun isLtConversionAbc(context: Context): Boolean =
        getSelected(context, PostExecGroup.DTR_LT) == OPTION_LT_CONVERSION_ABC

    fun isImplemented(optionId: String): Boolean =
        optionId == OPTION_LT_CONVERSION_ABC || optionId == OPTION_NONE
}
