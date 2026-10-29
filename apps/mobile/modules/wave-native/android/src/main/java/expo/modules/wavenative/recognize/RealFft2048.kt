package expo.modules.wavenative.recognize

/**
 * The real-to-complex FFT of 2048 floats that shazamio-core gets from `chfft` 0.3.4
 * (`RFft1D::forward`): a half-length complex FFT in five radix-4 passes, then the
 * split into 1025 bins. It is ported operation for operation, in `Float`, because the
 * signature keeps peaks by comparing and truncating these values: an FFT that rounds
 * differently picks different peaks and Shazam's bytes stop matching shazamio's.
 */
internal class RealFft2048 {
  private val halfOmega = omega(HALF)
  private val coefficients: Array<FloatArray> = run {
    val omega = omega(LENGTH)
    // (1 + i·ω) / 2 for the first half of the circle.
    val re = FloatArray(HALF) { (1f + (0f * omega[0][it] - 1f * omega[1][it])) * 0.5f }
    val im = FloatArray(HALF) { (0f + (0f * omega[1][it] + 1f * omega[0][it])) * 0.5f }
    arrayOf(re, im)
  }
  private val order: IntArray = bitReverse()
  private val workRe = FloatArray(HALF)
  private val workIm = FloatArray(HALF)
  private val sortedRe = FloatArray(HALF)
  private val sortedIm = FloatArray(HALF)

  /** Writes the 1025 bins of [source]'s transform into [re] and [im]. */
  fun forward(source: FloatArray, re: FloatArray, im: FloatArray) {
    for (i in 0 until HALF) {
      sortedRe[i] = source[order[i] shl 1]
      sortedIm[i] = source[(order[i] shl 1) + 1]
    }
    complexFft()
    val wr = workRe
    val wi = workIm
    val cr = coefficients[0]
    val ci = coefficients[1]
    for (i in 1 until QUARTER) {
      val j = HALF - i
      // x = coef[i] · (work[i] − conj(work[j]))
      val dr = wr[i] - wr[j]
      val di = wi[i] - -wi[j]
      val xr = cr[i] * dr - ci[i] * di
      val xi = cr[i] * di + ci[i] * dr
      re[i] = wr[i] - xr
      im[i] = wi[i] - xi
      re[j] = wr[j] + xr
      im[j] = wi[j] + -xi
    }
    re[0] = wr[0] + wi[0]
    im[0] = 0f
    re[QUARTER] = wr[QUARTER]
    im[QUARTER] = -wi[QUARTER]
    re[HALF] = wr[0] - wi[0]
    im[HALF] = 0f
  }

  /** `chfft`'s mixed-radix kernel for 1024 = 4⁵ points, over the bit-reversed input. */
  private fun complexFft() {
    val r = sortedRe
    val i = sortedIm
    val omegaRe = halfOmega[0]
    val omegaIm = halfOmega[1]
    var po2 = 1
    var rad = HALF
    repeat(5) {
      val po2m = po2
      po2 = po2 shl 2
      rad = rad shr 2
      for (start in 0 until po2m) {
        val wpos = rad * start
        val w1r = omegaRe[wpos]; val w1i = omegaIm[wpos]
        val w2r = omegaRe[wpos shl 1]; val w2i = omegaIm[wpos shl 1]
        val w3r = omegaRe[wpos * 3]; val w3i = omegaIm[wpos * 3]
        var j = start
        while (j < HALF) {
          val p1 = j + po2m
          val p2 = p1 + po2m
          val p3 = p2 + po2m
          val ar = r[j]; val ai = i[j]
          val cr = r[p1] * w1r - i[p1] * w1i; val ci = r[p1] * w1i + i[p1] * w1r
          val br = r[p2] * w2r - i[p2] * w2i; val bi = r[p2] * w2i + i[p2] * w2r
          val dr = r[p3] * w3r - i[p3] * w3i; val di = r[p3] * w3i + i[p3] * w3r
          val abr = ar + br; val abi = ai + bi
          val ambr = ar - br; val ambi = ai - bi
          val cdr = cr + dr; val cdi = ci + di
          // A quarter turn of c − d: (re, im) → (−im, re).
          val tr = -(ci - di); val ti = cr - dr
          r[j] = abr + cdr; i[j] = abi + cdi
          r[p1] = ambr - tr; i[p1] = ambi - ti
          r[p2] = abr - cdr; i[p2] = abi - cdi
          r[p3] = ambr + tr; i[p3] = ambi + ti
          j += po2
        }
      }
    }
    sortedRe.copyInto(workRe)
    sortedIm.copyInto(workIm)
  }

  private companion object {
    const val LENGTH = 2048
    const val HALF = 1024
    const val QUARTER = 512
    // `T::PI()` for `f32`.
    const val PI = Math.PI.toFloat()

    /** `precompute_utils::calc_omega`: e^(−2πik/n) for k in 0..n, one quarter computed. */
    fun omega(n: Int): Array<FloatArray> {
      val re = FloatArray(n + 1)
      val im = FloatArray(n + 1)
      re[0] = 1f
      val q = n shr 2
      val h = n shr 1
      for (k in 1 until q) {
        val theta = -2f * PI / n.toFloat() * k.toFloat()
        re[k] = StrictMath.cos(theta.toDouble()).toFloat()
        im[k] = StrictMath.sin(theta.toDouble()).toFloat()
      }
      for (k in q until h) {
        re[k] = im[k - q]
        im[k] = -re[k - q]
      }
      for (k in h until n) {
        re[k] = -re[k - h]
        im[k] = -im[k - h]
      }
      re[n] = 1f
      return arrayOf(re, im)
    }

    /** `precompute_utils::calc_bitreverse` for five factors of 4. */
    fun bitReverse(): IntArray {
      val ids = IntArray(HALF)
      var length = 1
      repeat(5) {
        for (k in 0 until length) ids[k] *= 4
        var next = length
        for (step in 1 until 4) for (k in 0 until length) ids[next++] = ids[k] + step
        length *= 4
      }
      return ids
    }
  }
}
