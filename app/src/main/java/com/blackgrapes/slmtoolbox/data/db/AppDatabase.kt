package com.blackgrapes.slmtoolbox.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.blackgrapes.slmtoolbox.data.dao.SurveyDao
import com.blackgrapes.slmtoolbox.data.entity.SeriesMetaEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyAssetEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyConnectionEntity
import com.blackgrapes.slmtoolbox.data.entity.SurveyEntity

@Database(
    entities = [
        SurveyEntity::class,
        SurveyAssetEntity::class,
        SurveyConnectionEntity::class,
        SeriesMetaEntity::class
    ],
    version = 5,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun surveyDao(): SurveyDao

    companion object {
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE survey_assets ADD COLUMN poleRole TEXT NOT NULL DEFAULT 'CONTINUE'"
                )
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE surveys ADD COLUMN isSavedWorkspace INTEGER NOT NULL DEFAULT 0"
                )
                db.execSQL(
                    "ALTER TABLE surveys ADD COLUMN savedAt INTEGER DEFAULT NULL"
                )
            }
        }

        val MIGRATION_3_4: Migration = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE survey_assets ADD COLUMN structure TEXT DEFAULT NULL")
                db.execSQL("ALTER TABLE survey_assets ADD COLUMN seriesId INTEGER DEFAULT NULL")
                db.execSQL("ALTER TABLE survey_assets ADD COLUMN deviceLatitude REAL DEFAULT NULL")
                db.execSQL("ALTER TABLE survey_assets ADD COLUMN deviceLongitude REAL DEFAULT NULL")
                db.execSQL("ALTER TABLE survey_assets ADD COLUMN deviceAccuracyM REAL DEFAULT NULL")
                db.execSQL(
                    "ALTER TABLE survey_assets ADD COLUMN deviceFixTimestamp INTEGER DEFAULT NULL"
                )
                db.execSQL(
                    "ALTER TABLE survey_assets ADD COLUMN distanceFromDeviceM REAL DEFAULT NULL"
                )
                db.execSQL(
                    "ALTER TABLE survey_assets ADD COLUMN isMockLocation INTEGER NOT NULL DEFAULT 0"
                )
                db.execSQL(
                    "ALTER TABLE survey_assets ADD COLUMN locationVerified INTEGER NOT NULL DEFAULT 0"
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_survey_assets_seriesId ON survey_assets(seriesId)"
                )
            }
        }

        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS survey_series_meta (
                        seriesId INTEGER NOT NULL PRIMARY KEY,
                        surveyId INTEGER NOT NULL,
                        feederName TEXT NOT NULL DEFAULT '',
                        sourceSubstation TEXT NOT NULL DEFAULT '',
                        FOREIGN KEY (surveyId) REFERENCES surveys(id) ON DELETE CASCADE
                    )"""
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_survey_series_meta_surveyId ON survey_series_meta(surveyId)"
                )
            }
        }

        @Volatile
        private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "slm_toolbox.db"
                ).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                    .fallbackToDestructiveMigration(dropAllTables = true)
                    .build()
                    .also { instance = it }
            }
    }
}
