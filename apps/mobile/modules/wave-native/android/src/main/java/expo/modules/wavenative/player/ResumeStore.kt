package expo.modules.wavenative.player

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.ListeningExecutorService
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.wavenative.log.WaveLog
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Keeps the [ResumeSnapshot] files in `filesDir` ([ResumeFiles]) up to date:
 * [PlaybackService] reports the player (items, current item, position, repeat,
 * and JS's shuffle from [AutoModes.state]) and [WavePlayerModule] the queue
 * parts JS saves (with where it was started from). Writes are coalesced on a
 * background thread; the last one wins. Only a change of items or of JS's
 * queue JSON rewrites the items part: a song change or a position save
 * rewrites the small place part.
 */
object ResumeStore {
  private const val TAG = "WaveResume"

  private val io: ListeningExecutorService =
    MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor())
  private val writePending = AtomicBoolean(false)
  private val itemsChanged = AtomicBoolean(false)

  @Volatile private var files: ResumeFiles? = null

  // The snapshot as last reported; [items] is null until the player or the file reported it.
  @Volatile private var items: List<ResumeItem>? = null
  @Volatile private var index = -1
  @Volatile private var positionMs = 0L
  @Volatile private var repeat = "off"
  @Volatile private var queueJson: String? = null
  @Volatile private var queueIndex: Int? = null
  @Volatile private var queueMetadata: String? = null
  @Volatile private var shuffle = false
  @Volatile private var source = "phone"

  /** Points the store at Wave's files and picks up the last snapshot's queue part. */
  fun init(context: Context) {
    if (files != null) return
    val target = ResumeFiles(context.filesDir)
    files = target
    io.execute {
      val saved = read(target) ?: return@execute
      synchronized(this) {
        if (queueJson == null) {
          queueJson = saved.queueJson
          queueIndex = saved.queueIndex
          queueMetadata = saved.queueMetadata
          source = saved.source
        }
        if (items == null) {
          shuffle = saved.shuffle
          items = saved.items
          index = saved.index
          positionMs = saved.positionMs
          repeat = saved.repeat
        }
      }
    }
  }

  /** The last snapshot written, read off the main thread. */
  fun load(): ListenableFuture<ResumeSnapshot?> = io.submit<ResumeSnapshot?> { files?.let(::read) }

  /**
   * Records the player's state. [withItems] re-reads the item list (its
   * timeline changed), and rewrites the items part only when the list did;
   * otherwise only the current item, position and repeat are read. An empty
   * player that didn't just change keeps the last snapshot, so a service that
   * started and stopped without playing doesn't erase it. Call it on the main
   * thread (it reads [AutoModes.state]).
   */
  fun savePlayer(player: Player, withItems: Boolean) {
    if (!withItems && player.mediaItemCount == 0) return
    var itemsNew = false
    synchronized(this) {
      if (withItems) {
        val reported = (0 until player.mediaItemCount).map { item(player.getMediaItemAt(it)) }
        changedResumeItems(items, reported)?.let {
          items = it
          itemsNew = true
        }
      }
      index = if (player.mediaItemCount == 0) -1 else player.currentMediaItemIndex
      positionMs = player.currentPosition
      shuffle = AutoModes.state.current.shuffle
      repeat = when (player.repeatMode) {
        Player.REPEAT_MODE_ALL -> "all"
        Player.REPEAT_MODE_ONE -> "one"
        else -> "off"
      }
    }
    write(itemsNew)
  }

  /**
   * Records the queue parts JS saved (Core's `queueWrite`: the `QueueState`
   * JSON, its index and metadata; null ones didn't change) and where it was
   * started from. Only a new [queue] rewrites the items part.
   */
  fun saveQueue(queue: String?, metadata: String?, index: Int?, source: String?) {
    synchronized(this) {
      if (queue != null) queueJson = queue
      if (metadata != null) queueMetadata = metadata
      if (index != null) queueIndex = index
      if (source != null) this.source = source
    }
    write(withItems = queue != null)
  }

  private fun snapshot(): ResumeSnapshot? = synchronized(this) {
    val current = items ?: return null
    ResumeSnapshot(current, index, positionMs, shuffle, repeat, source, queueJson, queueIndex, queueMetadata)
  }

  private fun write(withItems: Boolean) {
    val target = files ?: return
    if (withItems) itemsChanged.set(true)
    if (!writePending.compareAndSet(false, true)) return
    io.execute {
      writePending.set(false)
      // Taken before the snapshot: an items change after it schedules its own write.
      val withItemsNow = itemsChanged.getAndSet(false)
      val snapshot = snapshot() ?: run {
        if (withItemsNow) itemsChanged.set(true)
        return@execute
      }
      runCatching { target.write(snapshot, withItemsNow) }
        .onFailure {
          if (withItemsNow) itemsChanged.set(true)
          WaveLog.w(TAG, "Couldn't save the resume snapshot", it)
        }
    }
  }

  private fun read(target: ResumeFiles): ResumeSnapshot? =
    runCatching { target.read() }
      .onFailure { WaveLog.w(TAG, "Couldn't read the resume snapshot", it) }
      .getOrNull()

  /** A player item (built by [PlayerMediaItems.build]) as the snapshot keeps it. */
  private fun item(media: MediaItem): ResumeItem {
    val uri = media.localConfiguration?.uri ?: media.requestMetadata.mediaUri
    val metadata = media.mediaMetadata
    return ResumeItem(
      id = media.mediaId,
      path = PlayerMediaItems.pathOf(uri),
      title = metadata.title?.toString() ?: "",
      artist = metadata.artist?.toString() ?: "",
      album = metadata.albumTitle?.toString(),
      // A YT Music cover that isn't cached is kept by its address.
      artworkPath = metadata.extras?.getString(PlayerMediaItems.ARTWORK_PATH)
        ?: metadata.artworkUri?.toString()?.takeIf(PlayerMediaItems::isAddress),
    )
  }
}
