package expo.modules.waveglass

import android.view.View
import android.view.ViewGroup

/**
 * React Native stores `nativeID` as a view tag keyed by `R.id.view_tag_native_id`.
 * ReactFindViewUtil, which used to look it up, is gone in RN 0.88, and React
 * Native's R class isn't on this module's compile classpath, so the id is
 * resolved by name from the app's merged resources. Main thread only.
 */
private var tagKey: Int? = null

@Suppress("DiscouragedApi")
private fun nativeIdTagKey(view: View): Int =
  tagKey
    ?: view.resources
      .getIdentifier("view_tag_native_id", "id", view.context.packageName)
      .also { tagKey = it }

/** The view under [root] whose React `nativeID` is [nativeId]. Breadth-first: ids sit near the root. */
internal fun findByNativeId(root: View, nativeId: String): View? {
  val key = nativeIdTagKey(root)
  if (key == 0) return null
  val queue = ArrayDeque<View>()
  queue.add(root)
  while (queue.isNotEmpty()) {
    val view = queue.removeFirst()
    if (view.getTag(key) == nativeId) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) queue.add(view.getChildAt(i))
  }
  return null
}
