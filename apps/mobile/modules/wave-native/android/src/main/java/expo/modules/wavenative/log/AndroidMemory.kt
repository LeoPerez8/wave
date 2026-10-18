package expo.modules.wavenative.log

import android.app.ActivityManager
import android.content.Context
import android.os.Debug

/**
 * Wave's memory as Android counts it ([MemoryUse]). The PSS reads `/proc`, a few milliseconds:
 * fine for a line now and then, not for every frame. Never throws: what can't be read counts 0.
 */
object AndroidMemory {
  fun read(): MemoryUse {
    val runtime = Runtime.getRuntime()
    return MemoryUse(
      javaUsed = runtime.totalMemory() - runtime.freeMemory(),
      javaLimit = runtime.maxMemory(),
      nativeHeap = runCatching { Debug.getNativeHeapAllocatedSize() }.getOrDefault(0L),
      // Debug.getPss() answers in KB.
      pss = runCatching { Debug.getPss() * 1024 }.getOrDefault(0L),
    )
  }

  /** Whether Android counts the phone as low on memory (`ActivityManager.MemoryInfo.lowMemory`); false when it can't tell. */
  fun phoneLow(context: Context): Boolean = runCatching {
    val info = ActivityManager.MemoryInfo()
    context.getSystemService(ActivityManager::class.java).getMemoryInfo(info)
    info.lowMemory
  }.getOrDefault(false)
}
