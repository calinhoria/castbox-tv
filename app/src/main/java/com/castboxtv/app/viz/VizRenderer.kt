package com.castboxtv.app.viz

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import kotlin.math.roundToInt

/**
 * Portrait of js/renderer.js for android.graphics.Canvas. Interprets the
 * engine's flat 24-float draw commands; it knows nothing about presets or
 * audio, exactly like the web backend. Keep the two switches in step.
 */
class VizRenderer(private val context: Context) {

    private val images = HashMap<Int, Bitmap>()

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val filterPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val clipPath = Path()
    private val oval = RectF()

    private var cmdBuf: FloatBuffer? = null
    private var pointBuf: FloatBuffer? = null
    private var poolBuf: ByteBuffer? = null

    // Downscale-blurred cover cache: blur is bucketed so one temp bitmap is
    // reused while the preset holds its value.
    private var blurSrc: Bitmap? = null
    private var blurTmp: Bitmap? = null
    private var blurKey: Int = 0

    fun setImage(id: Int, bitmap: Bitmap?) {
        if (bitmap == null) {
            images.remove(id)
            VizEngine.imageSet(id, 0f, 0f)
        } else {
            images[id] = bitmap
            VizEngine.imageSet(id, bitmap.width.toFloat(), bitmap.height.toFloat())
        }
    }

    fun clearImages() {
        images.clear()
        VizEngine.nativeInit()
    }

    /** Executes the commands produced by the engine's last frame(). */
    fun render(canvas: Canvas) {
        val count = VizEngine.cmdCount()
        val stride = VizEngine.cmdStride
        cmdBuf = VizEngine.cmdFloats().asFloatBuffer()
        val data = cmdBuf!!

        for (i in 0 until count) {
            val o = i * stride
            val op = data.get(o + OP).toInt()
            val x = data.get(o + X)
            val y = data.get(o + Y)
            val w = data.get(o + W)
            val h = data.get(o + H)
            val r = data.get(o + R); val g = data.get(o + G); val b = data.get(o + B); val a = data.get(o + A)
            val r2 = data.get(o + R2); val g2 = data.get(o + G2); val b2 = data.get(o + B2); val a2 = data.get(o + A2)
            val p0 = data.get(o + P0); val p1 = data.get(o + P1); val p2 = data.get(o + P2); val p3 = data.get(o + P3)
            val p4 = data.get(o + P4); val p5 = data.get(o + P5)
            val role = data.get(o + ROLE)

            when (op) {
                OP_CLEAR -> {
                    fill.shader = null
                    fill.color = argb(r, g, b, a)
                    canvas.drawRect(0f, 0f, canvas.width.toFloat(), canvas.height.toFloat(), fill)
                }

                OP_RECT -> {
                    fill.shader = null
                    fill.color = argb(r, g, b, a)
                    roundRect(canvas, x, y, w, h, p0, p1, argb(r, g, b, a))
                }

                OP_GRADIENT_RECT -> {
                    val sh = linearGradient(x, y, w, h, p0, argb(r, g, b, a), argb(r2, g2, b2, a2))
                    if (p1 > 0.5f) {
                        clipPath.reset(); clipPath.addRoundRect(RectF(x, y, x + w, y + h), p1, p1, Path.Direction.CW)
                        canvas.save(); canvas.clipPath(clipPath)
                        fill.shader = sh; fill.color = Color.WHITE
                        canvas.drawRect(x, y, x + w, y + h, fill)
                        canvas.restore(); fill.shader = null
                    } else {
                        fill.shader = sh; fill.color = Color.WHITE
                        canvas.drawRect(x, y, x + w, y + h, fill)
                        fill.shader = null
                    }
                }

                OP_LINE -> {
                    stroke.shader = null
                    stroke.strokeWidth = maxOf(0.5f, p0)
                    stroke.strokeCap = Paint.Cap.ROUND
                    stroke.color = argb(r, g, b, a)
                    canvas.drawLine(x, y, w, h, stroke)
                }

                OP_GRADIENT_LINE -> {
                    // Stroked polyline from the point pool (P0 = count,
                    // P1 = point offset, P2 = width, P3 = gradient angle).
                    val n = p0.toInt().coerceIn(0, 4096)
                    if (n >= 2) {
                        val off = p1.toInt() * 2
                        pointBuf = VizEngine.pointFloats().asFloatBuffer()
                        val pts = pointBuf!!
                        var minX = Float.MAX_VALUE
                        var minY = Float.MAX_VALUE
                        var maxX = -Float.MAX_VALUE
                        var maxY = -Float.MAX_VALUE
                        for (k in 0 until n) {
                            val px = pts.get(off + k * 2)
                            val py = pts.get(off + k * 2 + 1)
                            if (px < minX) minX = px
                            if (py < minY) minY = py
                            if (px > maxX) maxX = px
                            if (py > maxY) maxY = py
                        }
                        stroke.shader = linearGradient(minX, minY,
                            maxOf(1f, maxX - minX), maxOf(1f, maxY - minY), p3,
                            argb(r, g, b, a), argb(r2, g2, b2, a2))
                        stroke.strokeWidth = maxOf(0.5f, p2)
                        stroke.strokeCap = Paint.Cap.ROUND
                        stroke.strokeJoin = Paint.Join.ROUND
                        stroke.color = Color.WHITE
                        clipPath.reset()
                        clipPath.moveTo(pts.get(off), pts.get(off + 1))
                        for (k in 1 until n) {
                            clipPath.lineTo(pts.get(off + k * 2), pts.get(off + k * 2 + 1))
                        }
                        canvas.drawPath(clipPath, stroke)
                        stroke.shader = null
                    }
                }

                OP_CIRCLE -> {
                    fill.shader = null
                    oval.set(x, y, x + w, y + h)
                    if (p0 > 0) {
                        stroke.shader = null
                        stroke.strokeWidth = p0
                        stroke.color = argb(r, g, b, a)
                        canvas.drawOval(oval, stroke)
                    } else {
                        fill.color = argb(r, g, b, a)
                        canvas.drawOval(oval, fill)
                    }
                }

                OP_ARC -> {
                    oval.set(x - w, y - h, x + w, y + h)
                    stroke.shader = null
                    stroke.strokeWidth = maxOf(0.5f, p2)
                    stroke.strokeCap = if (p3 >= 0.5f) Paint.Cap.ROUND else Paint.Cap.BUTT
                    stroke.color = argb(r, g, b, a)
                    canvas.drawArc(oval, p0, p1, false, stroke)
                }

                OP_RADIAL_GLOW -> radialGlow(canvas, x, y, w, h, r, g, b, a, r2, g2, b2, a2, p0, p1, p2, p3)

                OP_POLYGON -> polygon(canvas, data, x, y, w, h, r, g, b, a, p0, p1, p2)

                OP_CLIP_PUSH -> {
                    canvas.save()
                    if (p0 > 0.5f) {
                        clipPath.reset(); clipPath.addRoundRect(RectF(x, y, x + w, y + h), p0, p0, Path.Direction.CW)
                        canvas.clipPath(clipPath)
                    } else {
                        canvas.clipRect(x, y, x + w, y + h)
                    }
                }

                OP_CLIP_POP -> canvas.restore()

                OP_IMAGE -> drawImage(canvas, data, o, x, y, w, h, r, g, b, a, r2, g2, b2, p0, p1, p2, p3, p4, p5, role)

                OP_TEXT -> drawText(canvas, data, o, x, y, w, r, g, b, a, p0, p1, p2, p3, p4, p5, role)
            }
        }
    }

    // --- helpers -------------------------------------------------------------
    private fun roundRect(canvas: Canvas, x: Float, y: Float, w: Float, h: Float, radius: Float, sw: Float, color: Int) {
        val rr = radius.coerceIn(0f, minOf(w, h) / 2f)
        if (sw > 0) {
            stroke.shader = null; stroke.strokeWidth = sw; stroke.color = color
            canvas.drawRoundRect(RectF(x, y, x + w, y + h), rr, rr, stroke)
        } else {
            fill.color = color
            canvas.drawRoundRect(RectF(x, y, x + w, y + h), rr, rr, fill)
        }
    }

    private fun linearGradient(x: Float, y: Float, w: Float, h: Float, angleDeg: Float, c1: Int, c2: Int): Shader {
        val rad = Math.toRadians(angleDeg.toDouble())
        val ux = Math.sin(rad).toFloat()
        val uy = -Math.cos(rad).toFloat()
        val cx = x + w / 2f
        val cy = y + h / 2f
        val half = (Math.abs(w * ux) + Math.abs(h * uy)) / 2f
        val x0 = cx - ux * half; val y0 = cy - uy * half
        val x1 = cx + ux * half; val y1 = cy + uy * half
        return if (x0 == x1 && y0 == y1) {
            LinearGradient(cx, cy - 1f, cx, cy + 1f, c1, c2, Shader.TileMode.CLAMP)
        } else {
            LinearGradient(x0, y0, x1, y1, c1, c2, Shader.TileMode.CLAMP)
        }
    }

    private fun radialGlow(
        canvas: Canvas, x: Float, y: Float, w: Float, h: Float,
        r: Float, g: Float, b: Float, a: Float,
        r2: Float, g2: Float, b2: Float, a2: Float,
        p0: Float, p1: Float, p2: Float, p3: Float
    ) {
        val cx = x + w / 2f
        val cy = y + h / 2f
        val rad = maxOf(1f, minOf(w, h) / 2f)
        val scale = p3.coerceIn(0f, 1f)
        val p0c = (p0 * (1f - scale * 0.2f)).coerceIn(0f, 0.98f)
        val p1c = p1.coerceIn(p0c + 0.01f, 1f)
        val sh = RadialGradient(
            cx, cy, rad,
            intArrayOf(
                argb(r, g, b, a * scale),
                argb(r, g, b, a * scale),
                argb(r, g, b, a * scale * (0.55f - 0.25f * p2)),
                argb(r, g, b, 0f),
            ),
            floatArrayOf(0f, p0c, p1c, 1f),
            Shader.TileMode.CLAMP
        )
        glowPaint.shader = sh
        glowPaint.alpha = 255
        val saved = canvas.saveLayer(null, null)
        glowPaint.xfermode = ADD
        canvas.drawCircle(cx, cy, rad, glowPaint)
        glowPaint.xfermode = null
        glowPaint.shader = null
        canvas.restoreToCount(saved)
    }

    private fun polygon(
        canvas: Canvas, data: FloatBuffer, x: Float, y: Float, w: Float, h: Float,
        r: Float, g: Float, b: Float, a: Float, p0: Float, p1: Float, p2: Float
    ) {
        val n = p0.toInt()
        if (n < 2) return
        val off = p1.toInt() * 2
        pointBuf = VizEngine.pointFloats().asFloatBuffer()
        val pts = pointBuf!!
        clipPath.reset()
        val px0 = pts.get(off)
        val py0 = pts.get(off + 1)
        clipPath.moveTo(px0, py0)
        for (k in 1 until n) {
            clipPath.lineTo(pts.get(off + k * 2), pts.get(off + k * 2 + 1))
        }
        if (p2 > 0) {
            // Open stroke: never close() here, or open curves gain a
            // straight chord from their end back to their start.
            stroke.shader = null; stroke.strokeWidth = p2
            stroke.strokeJoin = Paint.Join.ROUND; stroke.strokeCap = Paint.Cap.ROUND
            stroke.color = argb(r, g, b, a)
            canvas.drawPath(clipPath, stroke)
        } else {
            clipPath.close()
            fill.shader = null; fill.color = argb(r, g, b, a)
            canvas.drawPath(clipPath, fill)
        }
    }

    private fun drawImage(
        canvas: Canvas, data: FloatBuffer, o: Int, x: Float, y: Float, w: Float, h: Float,
        r: Float, g: Float, b: Float, a: Float, r2: Float, g2: Float, b2: Float,
        p0: Float, p1: Float, p2: Float, p3: Float, p4: Float, p5: Float, role: Float
    ) {
        val img = images[data.get(o + IMG).toInt()] ?: return
        val iw = img.width.toFloat()
        val ih = img.height.toFloat()
        val blur = maxOf(0f, p3)
        fill.shader = null
        fill.alpha = (a.coerceIn(0f, 1f) * 255).toInt()
        val saved = canvas.save()
        if (role >= 0.5f) {
            // circle mask: inscribed circle, so non-square boxes still mask
            // a true circle instead of an oval
            val cr = minOf(w, h) / 2f
            clipPath.reset()
            oval.set(x + w / 2f - cr, y + h / 2f - cr, x + w / 2f + cr, y + h / 2f + cr)
            clipPath.addOval(oval, Path.Direction.CW)
            canvas.clipPath(clipPath)
        } else if (p1 > 0.5f) {
            clipPath.reset()
            clipPath.addRoundRect(RectF(x, y, x + w, y + h), p1, p1, Path.Direction.CW)
            canvas.clipPath(clipPath)
        } else {
            canvas.clipRect(x, y, x + w, y + h)
        }
        val pad = if (blur > 0.5f) blur else 0f
        val tw = w + pad * 2
        val th = h + pad * 2
        var dw = tw
        var dh = th
        val fit = p0.toInt()
        if (fit != 2 && iw > 0 && ih > 0) {
            val s = if (fit == 1) maxOf(tw / iw, th / ih) else minOf(tw / iw, th / ih)
            dw = iw * s; dh = ih * s
        }
        val flipX = p4 >= 0.5f
        val flipY = p5 >= 0.5f
        val dst = RectF(x + (w - dw) / 2f, y + (h - dh) / 2f, x + (w - dw) / 2f + dw, y + (h - dh) / 2f + dh)
        if (blur > 0.5f) {
            // Real blur without RenderEffect (needs API 31+): draw through a
            // downscaled temp bitmap with filtering, then upscale. Cheap and
            // works on every API level, software or hardware canvas.
            drawBlurred(canvas, img, dst, blur, flipX, flipY)
        } else if (flipX || flipY) {
            canvas.save()
            canvas.translate(x + w / 2f, y + h / 2f)
            canvas.scale(if (flipX) -1f else 1f, if (flipY) -1f else 1f)
            canvas.drawBitmap(img, null, RectF(-dw / 2f, -dh / 2f, dw / 2f, dh / 2f), fill)
            canvas.restore()
        } else {
            canvas.drawBitmap(img, null, dst, fill)
        }
        if (p2 > 0) {
            fill.alpha = (p2.coerceIn(0f, 1f) * 255).toInt()
            fill.color = argb(r, g, b, 1f)
            canvas.drawRect(x - 1f, y - 1f, x + w + 1f, y + h + 1f, fill)
        }
        fill.alpha = 255
        canvas.restoreToCount(saved)
    }

    private fun drawText(
        canvas: Canvas, data: FloatBuffer, o: Int, x: Float, y: Float, w: Float,
        r: Float, g: Float, b: Float, a: Float,
        p0: Float, p1: Float, p2: Float, p3: Float, p4: Float, p5: Float, role: Float
    ) {
        val len = data.get(o + STRLEN).toInt()
        if (len <= 0) return
        val text = poolString(data.get(o + STROFF).toInt(), len)
        if (text.isEmpty()) return

        val size = maxOf(1f, p0)
        val align = p1.toInt()
        val valign = p2.toInt()
        val weight = when { p3 >= 700 -> 700; p3 >= 400 -> 400; else -> 300 }
        val spacing = p4
        val blur = p5

        val familyOff = data.get(o + R2).toInt()
        val familyLen = data.get(o + G2).toInt()
        val family = if (familyLen > 0) poolString(familyOff, familyLen) else ""

        textPaint.typeface = VizFonts.typeface(context, family, weight)
        textPaint.textSize = size
        if (spacing > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            textPaint.letterSpacing = spacing / size
        }
        textPaint.textAlign = when (align) { 0 -> Paint.Align.LEFT; 2 -> Paint.Align.RIGHT; else -> Paint.Align.CENTER }
        textPaint.color = argb(r, g, b, a)

        val fm = textPaint.fontMetrics
        val baseline = when (valign) {
            0 -> y - fm.top
            2 -> y - fm.descent
            else -> y - (fm.ascent + fm.descent) / 2f
        }

        if (role >= 0.5f) {
            if (blur > 0) textPaint.maskFilter = BlurMaskFilter(minOf(40f, blur * 0.35f), BlurMaskFilter.Blur.NORMAL)
            canvas.drawText(text, x, baseline, textPaint)
            textPaint.maskFilter = null
        } else {
            if (blur > 0) textPaint.setShadowLayer(blur, 0f, 0f, argb(r, g, b, a))
            canvas.drawText(text, x, baseline, textPaint)
            textPaint.clearShadowLayer()
        }

        val measured = textPaint.measureText(text)
        val strId = data.get(o + STRID).toInt()
        if (strId >= 0) VizEngine.measurePut(strId, measured)
    }

    /**
     * Steps the image down in smooth bilinear halves toward a 320px working
     * copy (same sizing as the web fallback), then bakes a real gaussian
     * with 3 sliding-window box passes — the same math as the Studio, so
     * both backends blur identically on every API level.
     * Never recycles [src].
     */
    private fun pyramidDown(src: Bitmap, blur: Float): Bitmap {
        if (src.width <= 0 || src.height <= 0) return src
        val target = 320
        var cur = src
        var w = src.width
        var h = src.height
        try {
            while (minOf(w, h) / 2 >= target) {
                w /= 2
                h /= 2
                val next = Bitmap.createScaledBitmap(cur, w, h, true)
                if (cur !== src) cur.recycle()
                cur = next
            }
            val scale = target.toFloat() / maxOf(cur.width, cur.height).coerceAtLeast(1)
            if (scale < 1f) {
                val exact = Bitmap.createScaledBitmap(
                    cur, maxOf(1, (cur.width * scale).toInt()),
                    maxOf(1, (cur.height * scale).toInt()), true)
                if (cur !== src) cur.recycle()
                cur = exact
            }
        } catch (_: Exception) {
            if (cur !== src) {
                try { cur.recycle() } catch (_: Exception) {}
            }
            return src
        }
        if (cur === src) return src
        val r = (blur * (cur.width.toFloat() / src.width) / 2f)
            .roundToInt().coerceIn(1, 24)
        val out = gaussianBitmap(cur, r)
        cur.recycle()
        return out
    }

    /** 3 sliding-window box passes ≈ gaussian (mirrors the web fallback). */
    private fun gaussianBitmap(src: Bitmap, radius: Int): Bitmap {
        val w = src.width
        val h = src.height
        val px = IntArray(w * h)
        src.getPixels(px, 0, w, 0, 0, w, h)
        repeat(3) {
            boxBlurPass(px, w, h, radius, true)
            boxBlurPass(px, w, h, radius, false)
        }
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        out.setPixels(px, 0, w, 0, 0, w, h)
        return out
    }

    private fun boxBlurPass(px: IntArray, w: Int, h: Int, r: Int, horizontal: Boolean) {
        val div = 2 * r + 1
        val tmp = IntArray(maxOf(w, h))
        if (horizontal) {
            for (y in 0 until h) {
                val row = y * w
                var aR = 0; var aG = 0; var aB = 0; var aA = 0
                for (i in -r..r) {
                    val o = row + (i.coerceIn(0, w - 1))
                    val c = px[o]
                    aA += (c ushr 24); aR += (c shr 16) and 255
                    aG += (c shr 8) and 255; aB += c and 255
                }
                for (x in 0 until w) {
                    val o = row + x
                    tmp[x] = ((aA / div) shl 24) or ((aR / div) shl 16) or
                        ((aG / div) shl 8) or (aB / div)
                    val oOut = row + maxOf(0, x - r)
                    val oIn = row + minOf(w - 1, x + r + 1)
                    val co = px[oOut]; val ci = px[oIn]
                    aA += (ci ushr 24) - (co ushr 24)
                    aR += ((ci shr 16) and 255) - ((co shr 16) and 255)
                    aG += ((ci shr 8) and 255) - ((co shr 8) and 255)
                    aB += (ci and 255) - (co and 255)
                }
                for (x in 0 until w) px[row + x] = tmp[x]
            }
        } else {
            for (x in 0 until w) {
                var aR = 0; var aG = 0; var aB = 0; var aA = 0
                for (i in -r..r) {
                    val c = px[(i.coerceIn(0, h - 1)) * w + x]
                    aA += (c ushr 24); aR += (c shr 16) and 255
                    aG += (c shr 8) and 255; aB += c and 255
                }
                for (y in 0 until h) {
                    val o = y * w + x
                    tmp[y] = ((aA / div) shl 24) or ((aR / div) shl 16) or
                        ((aG / div) shl 8) or (aB / div)
                    val co = px[maxOf(0, y - r) * w + x]
                    val ci = px[minOf(h - 1, y + r + 1) * w + x]
                    aA += (ci ushr 24) - (co ushr 24)
                    aR += ((ci shr 16) and 255) - ((co shr 16) and 255)
                    aG += ((ci shr 8) and 255) - ((co shr 8) and 255)
                    aB += (ci and 255) - (co and 255)
                }
                for (y in 0 until h) px[y * w + x] = tmp[y]
            }
        }
    }

    private fun drawBlurred(
        canvas: Canvas, img: Bitmap, dst: RectF, blur: Float, flipX: Boolean, flipY: Boolean
    ) {
        val key = (blur + 0.5f).toInt()
        var tmp = blurTmp
        if (tmp == null || blurSrc !== img || blurKey != key) {
            val old = blurTmp
            tmp = pyramidDown(img, blur)
            blurSrc = img
            blurTmp = tmp
            blurKey = key
            if (old !== null && old !== tmp && old !== img) old.recycle()
        }
        filterPaint.alpha = fill.alpha
        val src = tmp ?: img
        if (flipX || flipY) {
            canvas.save()
            canvas.translate(dst.centerX(), dst.centerY())
            canvas.scale(if (flipX) -1f else 1f, if (flipY) -1f else 1f)
            canvas.drawBitmap(src, null,
                RectF(-dst.width() / 2f, -dst.height() / 2f, dst.width() / 2f, dst.height() / 2f),
                filterPaint)
            canvas.restore()
        } else {
            canvas.drawBitmap(src, null, dst, filterPaint)
        }
    }
    private fun poolString(off: Int, len: Int): String {
        poolBuf = VizEngine.poolBytes()
        val buf = poolBuf!!
        val bytes = ByteArray(len)
        buf.position(off)
        buf.get(bytes, 0, len)
        return String(bytes, Charsets.UTF_8)
    }

    private fun argb(r: Float, g: Float, b: Float, a: Float): Int {
        fun c(v: Float) = (v.coerceIn(0f, 1f) * 255f + 0.5f).toInt()
        return Color.argb(c(a), c(r), c(g), c(b))
    }

    companion object {
        private const val OP = 0
        private const val X = 1; private const val Y = 2; private const val W = 3; private const val H = 4
        private const val R = 5; private const val G = 6; private const val B = 7; private const val A = 8
        private const val R2 = 9; private const val G2 = 10; private const val B2 = 11; private const val A2 = 12
        private const val P0 = 13; private const val P1 = 14; private const val P2 = 15; private const val P3 = 16
        private const val STRID = 17; private const val STROFF = 18; private const val STRLEN = 19
        private const val IMG = 20; private const val P4 = 21; private const val P5 = 22; private const val ROLE = 23

        private const val OP_CLEAR = 0
        private const val OP_RECT = 1
        private const val OP_GRADIENT_RECT = 2
        private const val OP_LINE = 3
        private const val OP_TEXT = 4
        private const val OP_IMAGE = 5
        private const val OP_CLIP_PUSH = 6
        private const val OP_CLIP_POP = 7
        private const val OP_CIRCLE = 8
        private const val OP_GRADIENT_LINE = 9
        private const val OP_ARC = 10
        private const val OP_POLYGON = 11
        private const val OP_RADIAL_GLOW = 12

        private val ADD = PorterDuffXfermode(PorterDuff.Mode.ADD)
    }
}
