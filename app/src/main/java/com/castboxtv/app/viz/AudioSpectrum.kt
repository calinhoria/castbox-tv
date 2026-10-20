package com.castboxtv.app.viz

import java.util.concurrent.atomic.AtomicReference

object AudioSpectrum {

    private val dataRef = AtomicReference<FloatArray>(FloatArray(8) { 0f })

    fun update(values: FloatArray) {
        dataRef.set(values.copyOf())
    }

    fun get(): FloatArray = dataRef.get()?.copyOf() ?: FloatArray(8) { 0f }
}
