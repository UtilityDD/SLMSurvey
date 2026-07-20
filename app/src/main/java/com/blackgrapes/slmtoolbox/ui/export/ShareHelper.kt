package com.blackgrapes.slmtoolbox.ui.export

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.FileProvider
import java.io.File

object ShareHelper {

    private val WHATSAPP_PACKAGES = listOf("com.whatsapp", "com.whatsapp.w4b")

    fun shareText(context: Context, text: String, title: String) {
        val whatsapp = WHATSAPP_PACKAGES.firstOrNull { isInstalled(context, it) }
        if (whatsapp != null) {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
                putExtra(Intent.EXTRA_SUBJECT, title)
                setPackage(whatsapp)
            }
            try {
                context.startActivity(intent)
                return
            } catch (_: ActivityNotFoundException) {
                // fall through
            }
        }
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            putExtra(Intent.EXTRA_SUBJECT, title)
        }
        context.startActivity(Intent.createChooser(intent, title))
    }

    fun sharePng(context: Context, pngFile: File, title: String, caption: String) {
        shareDrawing(context, pngFile, pdfFile = null, title, caption)
    }

    /**
     * Shares the drawing image first (PNG). PDF is included when WhatsApp is not used,
     * because WhatsApp reliably attaches a single image better than multi-file + caption-only.
     */
    fun shareDrawing(
        context: Context,
        pngFile: File,
        pdfFile: File?,
        title: String,
        caption: String
    ) {
        val pngUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            pngFile
        )
        val whatsapp = WHATSAPP_PACKAGES.firstOrNull { isInstalled(context, it) }
        if (whatsapp != null) {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, pngUri)
                putExtra(Intent.EXTRA_TEXT, caption)
                putExtra(Intent.EXTRA_SUBJECT, title)
                setPackage(whatsapp)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            try {
                context.startActivity(intent)
                return
            } catch (_: ActivityNotFoundException) {
                // fall through to chooser
            }
        }

        val files = buildList {
            add(pngFile)
            if (pdfFile != null) add(pdfFile)
        }
        shareFiles(context, files, title, caption, if (files.size == 1) "image/png" else "*/*")
    }

    fun shareFiles(
        context: Context,
        files: List<File>,
        title: String,
        caption: String,
        mimeType: String = "*/*"
    ) {
        if (files.isEmpty()) return
        val uris = ArrayList(
            files.map { file ->
                FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    file
                )
            }
        )
        val intent = if (uris.size == 1) {
            Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uris.first())
            }
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = mimeType
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            }
        }
        intent.putExtra(Intent.EXTRA_TEXT, caption)
        intent.putExtra(Intent.EXTRA_SUBJECT, title)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(intent, title))
    }

    private fun isInstalled(context: Context, packageName: String): Boolean =
        try {
            context.packageManager.getPackageInfo(packageName, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
}
