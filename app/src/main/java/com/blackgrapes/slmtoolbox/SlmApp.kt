package com.blackgrapes.slmtoolbox

import android.app.Application
import com.blackgrapes.slmtoolbox.data.db.AppDatabase
import com.blackgrapes.slmtoolbox.data.repo.SurveyRepository
import com.blackgrapes.slmtoolbox.domain.NetworkCatalog
import com.blackgrapes.slmtoolbox.domain.SurveyRulesStore
import org.maplibre.android.MapLibre

class SlmApp : Application() {
    lateinit var repository: SurveyRepository
        private set

    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
        NetworkCatalog.appContext = applicationContext
        SurveyRulesStore.ensureLoaded(applicationContext)
        repository = SurveyRepository(AppDatabase.getInstance(this).surveyDao())
    }
}
