package com.blackgrapes.slmtoolbox.ui.preview

import android.content.Context
import android.graphics.Canvas
import android.util.AttributeSet
import android.view.View
import com.blackgrapes.slmtoolbox.domain.PrintableSldBuilder
import com.blackgrapes.slmtoolbox.domain.PrintableSldPage
import com.blackgrapes.slmtoolbox.ui.export.PrintableSldRenderer

/**
 * Lightweight host for printable A4 landscape SLD pages.
 * Prefer ImageView + PrintableSldRenderer for paging; this view draws a single page.
 */
class SldView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private var page: PrintableSldPage? = null

    fun setPage(page: PrintableSldPage?) {
        this.page = page
        requestLayout()
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val desiredWidth = PrintableSldBuilder.PAGE_WIDTH.toInt()
        val desiredHeight = PrintableSldBuilder.PAGE_HEIGHT.toInt()
        setMeasuredDimension(
            resolveSize(desiredWidth, widthMeasureSpec),
            resolveSize(desiredHeight, heightMeasureSpec)
        )
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val current = page ?: return
        val scaleX = width / PrintableSldBuilder.PAGE_WIDTH
        val scaleY = height / PrintableSldBuilder.PAGE_HEIGHT
        val scale = minOf(scaleX, scaleY)
        canvas.save()
        canvas.scale(scale, scale)
        PrintableSldRenderer.draw(canvas, current)
        canvas.restore()
    }
}
