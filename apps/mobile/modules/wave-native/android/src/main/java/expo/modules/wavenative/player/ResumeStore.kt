package expo.modules.wavenative.player

import android.content.Context
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.ListeningExecutorService
import com.google.common.util.concurrent.MoreExecutors
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Keeps the [ResumeSnapshot] file in `filesDir` up to date: [PlaybackService]
 * reports the player (items, current item, position, repeat, and JS's shuffle
 * from [AutoModes.state]) and [WavePlayerModule] the queue JS saves (with where
 * it was started from). Writes are coalesced on a background thread; the last
 * one wins.
 */
object ResumeStore {
  private const val FILE_NAME = "resume-snapshot.txt"
  private const val TAG = "WaveResume"

  private val io: ListeningExecutorService =
    MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor())
  private val writePending = AtomicBoolean(false)

  @Volatile private var file: File? = null

  // The snapshot as last reported; [items] is null until the player or the file reported it.
  @Volatile private var items: List<ResumeItem>? = null
  @Volatile private var index = -1
  @Volatile private var positionMs = 0L
  @Volatile private var repeat = "off"
  @Volatile private var queueJson: String? = null
  @Volatile private var shuffle = false
  @Volatile private var source = "phone"

  /** Points the store at Wave's files and picks up the last snapshot's queue part. */
  fun init(context: Context) {
    if (file != null) return
    val target = File(context.filesDir, FILE_NAME)
    file = target
    io.execute {
      val saved = read(target) ?: return@execute
      synchronized(this) {
        if (queueJson == null) {
          queueJson = saved.queueJson
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
  fun load(): ListenableFuture<ResumeSnapshot?> = io.submit<ResumeSnapshot?> { file?.let(::read) }

  /**
   * Records the player's state. [withItems] re-reads the item list (it
   * changed); otherwise only the current item, position and repeat are. An
   * empty player that didn't just change keeps the last snapshot, so a
   * service that started and stopped without playing doesn't erase it.
   * Call it on the main thread (it reads [AutoModes.state]).
   */
  fun savePlayer(player: Player, withItems: Boolean) {
    if (!withItems && player.mediaItemCount == 0) return
    synchronized(this) {
      if (withItems) items = (0 until player.mediaItemCount).map { item(player.getMediaItemAt(it)) }
      index = if (player.mediaItemCount == 0) -1 else player.currentMediaItemIndex
      positionMs = player.currentPosition
      shuffle = AutoModes.state.current.shuffle
      repeat = when (player.repeatMode) {
        Player.REPEAT_MODE_ALL -> "all"
        Player.REPEAT_MODE_ONE -> "one"
        else -> "off"
      }
    }
    write()
  }

  /** Records the queue JS saved (Core's `QueueState` JSON) and where it was started from. */
  fun saveQueue(json: String, source: String?) {
    synchronized(this) {
      queueJson = json
      if (source != null) this.source = source
    }
    write()
  }

  private fun snapshot(): ResumeSnapshot? = synchronized(this) {
    val current = items ?: return null
    ResumeSnapshot(current, index, positionMs, shuffle, repeat, source, queueJson)
  }

  private fun write() {
    val target = file ?: return
    if (!writePending.compareAndSet(false, true)) return
    io.execute {
      writePending.set(false)
      val text = snapshot()?.encode() ?: return@execute
      runCatching {
        val temp = File(target.parentFile, "$FILE_NAME.tmp")
        temp.writeText(text)
        if (!temp.renameTo(target)) error("Couldn't replace $target")
      }.onFailure { Log.w(TAG, "Couldn't save the resume snapshot", it) }
    }
  }

  private fun read(target: File): ResumeSnapshot? =
    runCatching { if (target.exists()) ResumeSnapshot.decode(target.readText()) else null }
      .onFailure { Log.w(TAG, "Couldn't read the resume snapshot", it) }
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
