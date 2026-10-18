package expo.modules.wavenative.player

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** A player as [Crossfade] drives it. */
interface CrossfadeDeck {
  val positionMs: Long
  val isPlaying: Boolean

  /** Whether it played its song to the end. */
  val ended: Boolean

  fun setVolume(volume: Float)

  fun setSpeed(speed: Float)

  fun seekTo(positionMs: Long)

  fun setPlaying(playing: Boolean)
}

/** What [Crossfade] needs from [PlaybackService]. */
interface CrossfadeHost {
  /** The session's player: the queue, the notification, Auto. */
  val main: CrossfadeDeck

  /** The current song's length, or null while it isn't known. */
  val mainDurationMs: Long?

  /** Whether the session's player is to play: play pressed, and nothing (a call) holding it back. */
  val mainWantsToPlay: Boolean

  /**
   * Whether the current song, ending on its own, moves on to another one: there
   * is a next song, repeat one isn't on, and no end-of-song sleep timer waits for it.
   */
  val movesOnNaturally: Boolean

  /** Whether the session's player has the next song's start buffered, ready to sound. */
  val nextReady: Boolean

  /**
   * Starts making the next song ready: a streamed song's address resolved and
   * its start buffered. Asked once per song, at [CrossfadeTiming.prefetchAt].
   */
  fun prefetchNext()

  /**
   * The next song wasn't ready when the overlap should have begun: it was
   * [lateMs] late, and the overlap is [overlapMs] (0: none, a gapless move). For the app log.
   */
  fun nextLate(lateMs: Long, overlapMs: Long)

  /** Opens a second player on the current song at [positionMs], playing. */
  fun openTail(positionMs: Long): CrossfadeDeck

  fun closeTail()

  /** Moves the session's player to the next song, from its start. */
  fun advance()

  /** The song fading out went silent or was cut off. */
  fun fadeEnded()
}

/**
 * Crossfade (Settings › Playback): a song ending on its own overlaps the next
 * one for [overlapMs], the first fading out while the next fades in.
 *
 * The session's player plays the queue as always; a second player (the tail)
 * plays only the outgoing song's last seconds. Shortly before the overlap the
 * tail opens on the same song, silent, and is brought in step with the
 * session's player (playback speed while it's off by a little, a seek while
 * it's off by a lot). At the overlap the tail takes over the outgoing song at
 * full volume and the session's player moves to the next song, so Now Playing,
 * the notification, the lock screen and Auto show it from then on. A tail that
 * can't get in step in time is dropped, and that song ends gapless.
 *
 * The next song is made ready well ahead ([CrossfadeHost.prefetchNext] at
 * [CrossfadeTiming.prefetchAt]). One still not ready when the overlap should
 * begin is late: the outgoing song plays on at full volume, and the overlap
 * starts once it's ready, over the time left ([CrossfadeTiming.lateOverlap]),
 * or the song ends gapless. That holds both before the move
 * ([CrossfadeHost.nextReady], [overlapOnceReady]) and after it, while the
 * session's player buffers the next song's start: the overlap's clock only
 * starts once the incoming song sounds. The outgoing song never fades out alone.
 *
 * The owner moving the session's player (skip, previous, picking a song, a
 * seek) switches at once: [interrupt]. Pausing pauses the tail too.
 *
 * Main thread only. [tick] runs the timing; the service calls it again after
 * the delay it returns.
 */
class Crossfade(private val host: CrossfadeHost) {
  /** The overlap chosen in Settings (Core's `crossfadeDuration`); 0 is off. */
  var overlapMs = 0L

  private sealed interface Phase

  private data object Idle : Phase

  /**
   * The tail is open on the outgoing song (of [durationMs]) and getting in
   * step; the overlap is to begin at [handoffAtMs].
   */
  private class PreRoll(
    val tail: CrossfadeDeck,
    val durationMs: Long,
    val handoffAtMs: Long,
    val overlapMs: Long,
  ) : Phase

  /**
   * The overlap: the tail fades out until the outgoing song's end at [endMs]
   * while the session's player fades in. Its length is fixed once the
   * incoming song sounds ([overlapMs]; null until then), at most [upToMs];
   * [fullMs] is the song's whole overlap, before any was lost to lateness.
   */
  private class Fading(var tail: CrossfadeDeck?, val endMs: Long, val upToMs: Long, val fullMs: Long) : Phase {
    var overlapMs: Long? = null
  }

  private var phase: Phase = Idle

  /** Whether the next song was asked for ([CrossfadeHost.prefetchNext]) while this one plays. */
  private var prefetched = false

  /** Brings volumes and timing up to date; returns when to call again, or null to wait for playback. */
  fun tick(): Long? =
    when (val current = phase) {
      Idle -> idle()
      is PreRoll -> preRoll(current)
      is Fading -> fading(current)
    }

  /** The owner moved the session's player: no fade, the outgoing song stops now. */
  fun interrupt() {
    prefetched = false
    when (val current = phase) {
      Idle -> {}
      is PreRoll -> host.closeTail()
      is Fading -> {
        endTail(current)
        host.main.setVolume(1f)
      }
    }
    phase = Idle
  }

  /** Play or pause on the session's player; the outgoing song follows. */
  fun onPlayingChanged() {
    when (val current = phase) {
      is PreRoll -> if (!host.mainWantsToPlay) cancel()
      is Fading -> current.tail?.setPlaying(host.mainWantsToPlay)
      Idle -> {}
    }
  }

  private fun idle(): Long? {
    if (overlapMs <= 0 || !host.main.isPlaying) return null
    val durationMs = host.mainDurationMs ?: return POLL_MS
    val overlap = min(overlapMs, durationMs / 2)
    val handoffAt = durationMs - overlap
    val positionMs = host.main.positionMs
    val prefetchAt = CrossfadeTiming.prefetchAt(overlapMs, durationMs)
    if (!prefetched && positionMs >= prefetchAt && host.movesOnNaturally) {
      prefetched = true
      host.prefetchNext()
    }
    val openAt = handoffAt - CrossfadeTiming.PREROLL_MS
    if (positionMs < openAt) {
      val nextAt = if (positionMs < prefetchAt) prefetchAt else openAt
      return (nextAt - positionMs).coerceIn(TICK_MS, POLL_MS)
    }
    // Too late to get in step for this song, or it doesn't move on: it ends gapless.
    if (positionMs >= handoffAt || !host.movesOnNaturally) return POLL_MS
    val tail = host.openTail(positionMs + START_LEAD_MS)
    tail.setVolume(0f)
    phase = PreRoll(tail, durationMs, handoffAt, overlap)
    return TICK_MS
  }

  private fun preRoll(current: PreRoll): Long? {
    val main = host.main
    if (overlapMs <= 0 || !main.isPlaying || !host.movesOnNaturally) {
      cancel()
      return tick()
    }
    val tail = current.tail
    val offset = tail.positionMs - main.positionMs
    val inStep = tail.isPlaying && abs(offset) <= IN_STEP_MS
    if (main.positionMs >= current.handoffAtMs) {
      if (inStep) return overlapOnceReady(current)
      if (main.positionMs >= current.handoffAtMs + current.overlapMs / 2) {
        cancel()
        return POLL_MS
      }
    }
    when {
      !tail.isPlaying -> {}
      inStep -> tail.setSpeed(1f)
      abs(offset) > RESEEK_MS -> tail.seekTo(main.positionMs + START_LEAD_MS)
      else -> tail.setSpeed((1f - offset.toFloat() / CATCH_UP_MS).coerceIn(MIN_SPEED, MAX_SPEED))
    }
    return TICK_MS
  }

  /**
   * The overlap's time has come (or gone) and the tail is in step: the
   * overlap starts now if the next song is ready, over the time left
   * ([CrossfadeTiming.lateOverlap]). Otherwise the outgoing song plays on at
   * full volume on the session's player (the tail silent, in step) and this
   * is asked again each tick, until the next song is ready, or too little is
   * left and the song ends gapless.
   */
  private fun overlapOnceReady(current: PreRoll): Long {
    val main = host.main
    val overlap = CrossfadeTiming.lateOverlap(current.overlapMs, current.durationMs - main.positionMs)
    if (overlap <= 0) {
      host.nextLate(main.positionMs - current.handoffAtMs, 0)
      cancel()
      return POLL_MS
    }
    if (!host.nextReady) return TICK_MS
    current.tail.setSpeed(1f)
    current.tail.setVolume(1f)
    main.setVolume(0f)
    phase = Fading(current.tail, current.durationMs, overlap, current.overlapMs)
    prefetched = false
    host.advance()
    return TICK_MS
  }

  private fun fading(current: Fading): Long? {
    val main = host.main
    val sounding = current.tail
    // The overlap's clock starts once the incoming song sounds: until then
    // the outgoing song plays on at full volume.
    if (current.overlapMs == null && sounding != null && main.isPlaying) {
      val overlap = min(current.upToMs, current.endMs - sounding.positionMs + main.positionMs)
      current.overlapMs = overlap
      val lateMs = current.fullMs - overlap
      if (lateMs > LATE_REPORT_MS) host.nextLate(lateMs, overlap)
    }
    val overlap = current.overlapMs
    current.tail?.let { tail ->
      val leftMs = current.endMs - tail.positionMs
      // A tail that failed or stalled never gets there: the session's player,
      // as far into the next song as the overlap is long, says it should have.
      val overdue = overlap != null && main.positionMs >= overlap + OVERDUE_MS
      if (tail.ended || leftMs <= 0 || overdue) {
        // Over before the incoming song sounded: a gapless move after all.
        if (overlap == null) host.nextLate(current.fullMs, 0)
        endTail(current)
      } else {
        tail.setVolume(if (overlap == null) 1f else gain(leftMs.toFloat() / overlap))
      }
    }
    if (current.tail == null && (overlap == null || main.positionMs >= overlap)) {
      main.setVolume(1f)
      phase = Idle
      return tick()
    }
    main.setVolume(if (overlap == null) 0f else gain(main.positionMs.toFloat() / overlap))
    return if (host.mainWantsToPlay) TICK_MS else null
  }

  private fun endTail(current: Fading) {
    if (current.tail == null) return
    host.closeTail()
    current.tail = null
    host.fadeEnded()
  }

  private fun cancel() {
    host.closeTail()
    phase = Idle
  }

  private companion object {
    /** How often volumes and timing are brought up to date around an overlap. */
    const val TICK_MS = 50L

    /** How often a playing song is looked at while its overlap is far off. */
    const val POLL_MS = 1000L

    /** Roughly how long a player takes to start sounding; the tail opens this far ahead. */
    const val START_LEAD_MS = 150L

    /** How long past the overlap a tail still not done is given before it's closed. */
    const val OVERDUE_MS = 1000L

    /** Overlaps shorter than the song's whole one by more than this are logged as late. */
    const val LATE_REPORT_MS = 500L

    /** Close enough for the handoff to go unheard. */
    const val IN_STEP_MS = 20L

    /** Further off than this, the tail seeks instead of catching up. */
    const val RESEEK_MS = 500L

    /** The tail catches up an offset over about this long. */
    const val CATCH_UP_MS = 1000f

    const val MIN_SPEED = 0.8f
    const val MAX_SPEED = 1.25f

    /** Equal-power fade: the two songs' loudness adds up to the same through the overlap. */
    fun gain(fraction: Float): Float = sin(fraction.coerceIn(0f, 1f) * PI.toFloat() / 2)
  }
}

/**
 * Core's crossfade timing (packages/core/src/crossfade.ts), which the service
 * runs without JS. Keep in step with Core.
 */
internal object CrossfadeTiming {
  /** How long before the overlap the tail opens to get in step (Core's `CROSSFADE_PRE_ROLL_MS`). */
  const val PREROLL_MS = 3000L

  /** How far ahead of the pre-roll the next song is made ready (Core's `CROSSFADE_PREFETCH_LEAD_MS`). */
  const val PREFETCH_LEAD_MS = 30_000L

  /** The shortest overlap a late next song still gets (Core's `MIN_LATE_CROSSFADE_MS`). */
  const val MIN_LATE_MS = 1000L

  /** Where in a song of [durationMs] the next one is made ready (Core's `crossfadePrefetchAt`). */
  fun prefetchAt(overlapMs: Long, durationMs: Long): Long =
    max(0L, durationMs - min(overlapMs, durationMs / 2) - PREROLL_MS - PREFETCH_LEAD_MS)

  /**
   * The overlap once a late next song is ready with [leftMs] of the outgoing
   * song to go; 0 is a gapless move (Core's `lateCrossfadeOverlap`).
   */
  fun lateOverlap(overlapMs: Long, leftMs: Long): Long = if (leftMs < MIN_LATE_MS) 0L else min(overlapMs, leftMs)
}
