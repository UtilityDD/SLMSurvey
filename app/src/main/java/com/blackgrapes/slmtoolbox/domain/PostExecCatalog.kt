package com.blackgrapes.slmtoolbox.domain

/**
 * Post-execution survey line-type options.
 * Only [PostExecPreferences.OPTION_LT_CONVERSION_ABC] has placement logic today.
 */
enum class PostExecGroup {
    KV_33,
    KV_11,
    DTR_LT
}

data class PostExecOption(
    val id: String,
    val labelRes: Int,
    val group: PostExecGroup,
    val implemented: Boolean = false
)

object PostExecCatalog {
    val options33 = listOf(
        PostExecOption("33_aac_acsr", com.blackgrapes.slmtoolbox.R.string.post_opt_33_aac_acsr, PostExecGroup.KV_33),
        PostExecOption("33_aaac", com.blackgrapes.slmtoolbox.R.string.post_opt_33_aaac, PostExecGroup.KV_33),
        PostExecOption("33_ab", com.blackgrapes.slmtoolbox.R.string.post_opt_33_ab_cable, PostExecGroup.KV_33),
        PostExecOption("33_ug", com.blackgrapes.slmtoolbox.R.string.post_opt_33_ug, PostExecGroup.KV_33),
        PostExecOption("33_rail", com.blackgrapes.slmtoolbox.R.string.post_opt_33_rail, PostExecGroup.KV_33),
        PostExecOption("33_river", com.blackgrapes.slmtoolbox.R.string.post_opt_33_river, PostExecGroup.KV_33),
        PostExecOption("33_tap", com.blackgrapes.slmtoolbox.R.string.post_opt_33_tap, PostExecGroup.KV_33)
    )

    val options11 = listOf(
        PostExecOption("11_aac_acsr", com.blackgrapes.slmtoolbox.R.string.post_opt_11_aac_acsr, PostExecGroup.KV_11),
        PostExecOption("11_aaac", com.blackgrapes.slmtoolbox.R.string.post_opt_11_aaac, PostExecGroup.KV_11),
        PostExecOption("11_ab", com.blackgrapes.slmtoolbox.R.string.post_opt_11_ab_cable, PostExecGroup.KV_11),
        PostExecOption("11_ug", com.blackgrapes.slmtoolbox.R.string.post_opt_11_ug, PostExecGroup.KV_11),
        PostExecOption("11_rail", com.blackgrapes.slmtoolbox.R.string.post_opt_11_rail, PostExecGroup.KV_11),
        PostExecOption("11_tap", com.blackgrapes.slmtoolbox.R.string.post_opt_11_tap, PostExecGroup.KV_11),
        PostExecOption("11_rmu", com.blackgrapes.slmtoolbox.R.string.post_opt_11_rmu, PostExecGroup.KV_11)
    )

    val optionsDtrLt = listOf(
        PostExecOption(
            id = PostExecPreferences.OPTION_LT_CONVERSION_ABC,
            labelRes = com.blackgrapes.slmtoolbox.R.string.post_opt_lt_conversion_abc,
            group = PostExecGroup.DTR_LT,
            implemented = true
        ),
        PostExecOption("dtr_lt_aac", com.blackgrapes.slmtoolbox.R.string.post_opt_dtr_lt_aac, PostExecGroup.DTR_LT),
        PostExecOption("dtr_lt_abc", com.blackgrapes.slmtoolbox.R.string.post_opt_dtr_lt_abc, PostExecGroup.DTR_LT),
        PostExecOption("lt_aac", com.blackgrapes.slmtoolbox.R.string.post_opt_lt_aac, PostExecGroup.DTR_LT),
        PostExecOption("lt_abc", com.blackgrapes.slmtoolbox.R.string.post_opt_lt_abc, PostExecGroup.DTR_LT),
        PostExecOption("lt_1p", com.blackgrapes.slmtoolbox.R.string.post_opt_lt_1p, PostExecGroup.DTR_LT),
        PostExecOption("lt_3p", com.blackgrapes.slmtoolbox.R.string.post_opt_lt_3p, PostExecGroup.DTR_LT)
    )
}
