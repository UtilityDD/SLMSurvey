package com.blackgrapes.slmtoolbox

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.blackgrapes.slmtoolbox.data.db.AppDatabase
import com.blackgrapes.slmtoolbox.data.repo.SurveyRepository
import com.blackgrapes.slmtoolbox.domain.model.AssetType
import com.blackgrapes.slmtoolbox.domain.model.SurveyAsset
import com.blackgrapes.slmtoolbox.domain.model.VoltageLevel
import com.blackgrapes.slmtoolbox.domain.model.WorkStatus
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveyRepositoryInstrumentedTest {

    private lateinit var db: AppDatabase
    private lateinit var repository: SurveyRepository

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repository = SurveyRepository(db.surveyDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun createAddConnectAndDeleteAsset() = runBlocking {
        val survey = repository.createSurvey("Unit Survey")
        val firstId = repository.addAsset(
            SurveyAsset(
                surveyId = survey.id,
                sequence = 0,
                latitude = 28.1,
                longitude = 77.1,
                voltage = VoltageLevel.KV_11,
                status = WorkStatus.EXISTING,
                type = AssetType.POLE,
                poleMaterial = "PSC",
                poleHeightM = "9"
            )
        )
        val secondId = repository.addAsset(
            SurveyAsset(
                surveyId = survey.id,
                sequence = 0,
                latitude = 28.1005,
                longitude = 77.1005,
                voltage = VoltageLevel.KV_11,
                status = WorkStatus.PROPOSED,
                type = AssetType.POLE,
                spanLengthM = "45"
            )
        )
        val loaded = repository.getSurvey(survey.id)
        assertNotNull(loaded)
        assertEquals(2, loaded!!.assets.size)

        val connectionId = repository.connectAssets(
            surveyId = survey.id,
            from = loaded.assets.first { it.id == firstId },
            to = loaded.assets.first { it.id == secondId },
            spanLengthM = "45"
        )
        assertNotNull(connectionId)

        val connected = repository.getSurvey(survey.id)!!
        assertEquals(1, connected.connections.size)

        repository.deleteAsset(connected.assets.first { it.id == firstId })
        val afterDelete = repository.getSurvey(survey.id)!!
        assertEquals(1, afterDelete.assets.size)
        assertTrue(afterDelete.connections.isEmpty())
    }

    @Test
    fun persistsStructureSeriesAndLocationEvidence() = runBlocking {
        val survey = repository.createSurvey("Evidence Survey")
        val id = repository.addAsset(
            SurveyAsset(
                surveyId = survey.id,
                sequence = 0,
                latitude = 28.2,
                longitude = 77.2,
                voltage = VoltageLevel.KV_33,
                status = WorkStatus.EXISTING,
                type = AssetType.POLE,
                poleMaterial = "H-Pole",
                conductor = "150",
                structure = "2P",
                seriesId = 42L,
                deviceLatitude = 28.2001,
                deviceLongitude = 77.2001,
                deviceAccuracyM = 8f,
                deviceFixTimestamp = System.currentTimeMillis(),
                distanceFromDeviceM = 12f,
                isMockLocation = false,
                locationVerified = true
            )
        )
        val loaded = repository.getSurvey(survey.id)!!.assets.first { it.id == id }
        assertEquals("2P", loaded.structure)
        assertEquals(42L, loaded.seriesId)
        assertEquals(true, loaded.locationVerified)
        assertEquals(8f, loaded.deviceAccuracyM)
        assertEquals("H-Pole", loaded.poleMaterial)
    }
}
