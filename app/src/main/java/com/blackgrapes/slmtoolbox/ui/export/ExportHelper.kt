package com.blackgrapes.slmtoolbox.ui.export

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.blackgrapes.slmtoolbox.data.entity.SeriesMetaEntity
import com.blackgrapes.slmtoolbox.domain.GisAccuracyReport
import com.blackgrapes.slmtoolbox.domain.PrintableSldBuilder
import com.blackgrapes.slmtoolbox.domain.model.Survey
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object ExportHelper {
    private const val TAG = "ExportHelper"

    fun exportDirectory(context: Context): File =
        File(context.cacheDir, "exports").also { it.mkdirs() }

    fun exportPreviewPng(
        context: Context,
        survey: Survey,
        seriesMeta: List<SeriesMetaEntity> = emptyList()
    ): File? {
        return try {
            val preset = com.blackgrapes.slmtoolbox.domain.PresetPreferences.get(context)
            val sldDoc = PrintableSldBuilder.build(
                survey,
                seriesMeta,
                displayUnit = preset.displayUnit,
                displayDecimals = preset.displayDecimals
            )
            if (sldDoc.pages.isEmpty()) return null

            val stampSuffix = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val pngFile = File(exportDirectory(context), "sld_preview_${survey.id}_$stampSuffix.png")
            val scale = 3f
            val bitmap = PrintableSldRenderer.renderPage(sldDoc.pages.first(), scale)
            FileOutputStream(pngFile).use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }
            bitmap.recycle()
            pngFile
        } catch (e: Exception) {
            Log.e(TAG, "PNG preview export failed", e)
            null
        }
    }

    fun exportGpsCsv(context: Context, survey: Survey): File? {
        return try {
            if (survey.assets.isEmpty()) return null
            val sheet = GisAccuracyReport.build(survey)
            val stampSuffix = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
                .format(Date(sheet.generatedAt))
            val csvFile = File(exportDirectory(context), "gps_points_${survey.id}_$stampSuffix.csv")
            FileOutputStream(csvFile).use { out ->
                out.write(GisAccuracyReport.toCsv(sheet).toByteArray(Charsets.UTF_8))
            }
            csvFile
        } catch (e: Exception) {
            Log.e(TAG, "GPS CSV export failed", e)
            null
        }
    }

    fun exportJsonWorkspace(
        context: Context,
        survey: Survey,
        seriesMeta: List<SeriesMetaEntity>
    ): File? {
        return try {
            val dataSheet = GisAccuracyReport.build(survey)
            val summary = dataSheet.summary
            val root = org.json.JSONObject().apply {
                put("surveyId", survey.id)
                put("title", survey.title)
                put("linemanName", survey.linemanName)
                put("linemanMobile", survey.linemanMobile)
                put("createdAt", survey.createdAt)
                put("updatedAt", survey.updatedAt)
                put("isLiveAtSite", survey.isLiveAtSite)
                put(
                    "gisAccuracy",
                    org.json.JSONObject().apply {
                        put("grade", summary.grade.label)
                        put("poleCount", summary.poleCount)
                        put("verifiedCount", summary.verifiedCount)
                        put("verifiedPercent", summary.verifiedPercent)
                        put("avgAccuracyM", summary.avgAccuracyM)
                        put("minAccuracyM", summary.minAccuracyM)
                        put("maxAccuracyM", summary.maxAccuracyM)
                        put("avgDistanceFromDeviceM", summary.avgDistanceFromDeviceM)
                        put("avgSatsUsed", summary.avgSatsUsed)
                        put("avgSnrDb", summary.avgSnrDb)
                        put("mockCount", summary.mockCount)
                    }
                )

                val assetsArr = org.json.JSONArray()
                survey.assets.forEach { asset ->
                    val assetObj = org.json.JSONObject().apply {
                        put("id", asset.id)
                        put("sequence", asset.sequence)
                        put("latitude", asset.latitude)
                        put("longitude", asset.longitude)
                        put("voltage", asset.voltage.label)
                        put("status", asset.status.label)
                        put("type", asset.type.label)
                        put("poleRole", asset.poleRole.name)
                        put("poleMaterial", asset.poleMaterial)
                        put("poleHeightM", asset.poleHeightM)
                        put("conductor", asset.conductor)
                        put("circuit", asset.circuit)
                        put("spanLengthM", asset.spanLengthM)
                        put("dtCapacityKva", asset.dtCapacityKva)
                        put("stayType", asset.stayType)
                        put("earthingType", asset.earthingType)
                        put("remarks", asset.remarks)
                        put("structure", asset.structure)
                        put("seriesId", asset.seriesId)
                        put("deviceLatitude", asset.deviceLatitude)
                        put("deviceLongitude", asset.deviceLongitude)
                        put("deviceAccuracyM", asset.deviceAccuracyM)
                        put("deviceFixTimestamp", asset.deviceFixTimestamp)
                        put("distanceFromDeviceM", asset.distanceFromDeviceM)
                        put("isMockLocation", asset.isMockLocation)
                        put("locationVerified", asset.locationVerified)
                        put("satsUsedInFix", asset.satsUsedInFix)
                        put("satsVisible", asset.satsVisible)
                        put("avgSnrDb", asset.avgSnrDb)
                    }
                    assetsArr.put(assetObj)
                }
                put("assets", assetsArr)

                val connArr = org.json.JSONArray()
                survey.connections.forEach { conn ->
                    val connObj = org.json.JSONObject().apply {
                        put("id", conn.id)
                        put("fromAssetId", conn.fromAssetId)
                        put("toAssetId", conn.toAssetId)
                        put("voltage", conn.voltage.label)
                        put("status", conn.status.label)
                        put("spanLengthM", conn.spanLengthM)
                    }
                    connArr.put(connObj)
                }
                put("connections", connArr)

                val metaArr = org.json.JSONArray()
                seriesMeta.forEach { meta ->
                    val metaObj = org.json.JSONObject().apply {
                        put("seriesId", meta.seriesId)
                        put("feederName", meta.feederName)
                        put("sourceSubstation", meta.sourceSubstation)
                    }
                    metaArr.put(metaObj)
                }
                put("seriesMeta", metaArr)
            }

            val dir = exportDirectory(context)
            val jsonFile = File(dir, "workspace_${survey.id}.json")
            FileOutputStream(jsonFile).use { out ->
                out.write(root.toString(2).toByteArray(Charsets.UTF_8))
            }
            jsonFile
        } catch (e: Exception) {
            Log.e(TAG, "JSON Export failed", e)
            null
        }
    }
}
