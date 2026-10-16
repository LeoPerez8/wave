package expo.modules.wavenative.player

import kotlin.math.PI
import kotlin.math.abs
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

  /** The tail is open on the outgoing song and getting in step. */
  private class PreRoll(val tail: CrossfadeDeck, val handoffAtMs: Long, val overlapMs: Long) : Phase

  /** The overlap: the tail fades out until [endMs] while the session's player fades in. */
  private class Fading(var tail: CrossfadeDeck?, val endMs: Long, val overlapMs: Long) : Phase

  private var phase: Phase = Idle

  /** Brings volumes and timing up to date; returns when to call again, or null to wait for playback. */
  fun tick(): Long? =
    when (val current = phase) {
      Idle -> idle()
      is PreRoll -> preRoll(current)
      is Fading -> fading(current)
    }

  /** The owner moved the session's player: no fade, the outgoing song stops now. */
  fun interrupt() {
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
    val openAt = handoffAt - PREROLL_MS
    if (positionMs < openAt) return (openAt - positionMs).coerceIn(TICK_MS, POLL_MS)
    // Too late to get in step for this song, or it doesn't move on: it ends gapless.
    if (positionMs >= handoffAt || !host.movesOnNaturally) return POLL_MS
    val tail = host.openTail(positionMs + START_LEAD_MS)
    tail.setVolume(0f)
    phase = PreRoll(tail, handoffAt, overlap)
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
      if (inStep) return handOff(current)
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

  private fun handOff(current: PreRoll): Long {
    val tail = current.tail
    tail.setSpeed(1f)
    tail.setVolume(1f)
    host.main.setVolume(0f)
    phase = Fading(tail, current.handoffAtMs + current.overlapMs, current.overlapMs)
    host.advance()
    return TICK_MS
  }

  private fun fading(current: Fading): Long? {
    current.tail?.let { tail ->
      val leftMs = current.endMs - tail.positionMs
      if (tail.ended || leftMs <= 0) {
        endTail(current)
      } else {
        tail.setVolume(gain(leftMs.toFloat() / current.overlapMs))
      }
    }
    val main = host.main
    if (current.tail == null && main.positionMs >= current.overlapMs) {
      main.setVolume(1f)
      phase = Idle
      return tick()
    }
    main.setVolume(gain(main.positionMs.toFloat() / current.overlapMs))
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

    /** How long before the overlap the tail opens to get in step. */
    const val PREROLL_MS = 3000L

    /** Roughly how long a player takes to start sounding; the tail opens this far ahead. */
    const val START_LEAD_MS = 150L

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
