package com.castboxtv.app.viz

object AudioWaveform {

    private const val CAPACITY = 128
    private val buffer = FloatArray(CAPACITY) { 0f }
    private var head = 0
    private val lock = Any()

    fun append(values: FloatArray) {
        synchronized(lock) {
            for (v in values) {
                buffer[head] = v
                head = (head + 1) % CAPACITY
            }
        }
    }

    fun get(size: Int = 32): FloatArray {
        synchronized(lock) {
            val out = FloatArray(size)
            for (i in 0 until size) {
                val index = (head - size + i) % CAPACITY
                out[i] = buffer[if (index < 0) index + CAPACITY else index]
            }
            return out
        }
    }
}
