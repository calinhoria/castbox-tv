package com.castboxtv.app.viz

import androidx.media3.common.C
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.sqrt

class AudioProcessor : TeeAudioProcessor.AudioBufferSink {

    private var sampleRate = 44100
    private var channelCount = 2
    private var encoding = C.ENCODING_PCM_16BIT

    override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
        sampleRate = sampleRateHz
        this.channelCount = channelCount
        this.encoding = encoding
    }

    override fun handleBuffer(buffer: ByteBuffer) {
        if (!buffer.hasRemaining()) return
        val bytesPerSample = when (encoding) {
            C.ENCODING_PCM_8BIT -> 1
            C.ENCODING_PCM_FLOAT -> 4
            else -> 2
        }
        val totalSamples = buffer.remaining() / bytesPerSample
        if (totalSamples <= 0) return

        val barCount = 11
        val barBins = FloatArray(barCount) { 0f }
        val barCounts = IntArray(barCount) { 0 }

        val wavePoints = 4
        val waveBins = FloatArray(wavePoints) { 0f }
        val waveCounts = IntArray(wavePoints) { 0 }

        var sumSq = 0.0
        var peak = 0f

        val dup = buffer.duplicate().order(ByteOrder.nativeOrder())
        var sampleIndex = 0
        var vizIndex = 0
        val channels = channelCount.coerceAtLeast(1)
        val numFrames = totalSamples / channels
        val step = AppVizAudioFeed.Feed.DOWNSAMPLE.coerceAtLeast(1)
        val vizScratch = FloatArray(numFrames / step + 1)
        var frameSum = 0f
        var frameChan = 0
        var frameCount = 0
        while (dup.hasRemaining()) {
            val signed = readSampleSigned(dup)
            val absSample = abs(signed)
            val barIndex = (sampleIndex * barCount / totalSamples).coerceIn(0, barCount - 1)
            val waveIndex = (sampleIndex * wavePoints / totalSamples).coerceIn(0, wavePoints - 1)
            barBins[barIndex] = barBins[barIndex] + absSample
            barCounts[barIndex]++
            waveBins[waveIndex] = waveBins[waveIndex] + signed
            waveCounts[waveIndex]++
            sumSq += (signed * signed).toDouble()
            if (absSample > peak) peak = absSample
            sampleIndex++
            // Mono mix per audio frame (average L/R/...), decimated once here.
            // offerBlock no longer decimates — it used to take every 6th sample
            // AGAIN (1/36 total), starving projectM's analyser.
            frameSum += signed
            frameChan++
            if (frameChan == channels) {
                if (frameCount % step == 0 && vizIndex < vizScratch.size) {
                    vizScratch[vizIndex++] = frameSum / channels
                }
                frameSum = 0f
                frameChan = 0
                frameCount++
            }
        }

        for (i in 0 until barCount) {
            barBins[i] = barBins[i] / barCounts[i].coerceAtLeast(1)
        }
        for (i in 0 until wavePoints) {
            waveBins[i] = waveBins[i] / waveCounts[i].coerceAtLeast(1)
        }

        val rms = sqrt(sumSq / totalSamples).toFloat()
        val bass = if (barCount >= 2) (barBins[0] + barBins[1]) / 2f else barBins.getOrElse(0) { 0f }

        AudioSpectrum.update(barBins)
        AudioWaveform.append(waveBins)
        AudioLevelStore.update(AudioLevels(rms = rms, peak = peak, bass = bass))

        AppVizAudioFeed.offerBlock(vizScratch, vizIndex)
    }
    private fun readSampleSigned(buffer: ByteBuffer): Float {
        return when (encoding) {
            C.ENCODING_PCM_FLOAT -> buffer.float
            C.ENCODING_PCM_8BIT -> buffer.get().toInt() / 128f
            else -> buffer.short.toInt() / 32768f
        }
    }
}
