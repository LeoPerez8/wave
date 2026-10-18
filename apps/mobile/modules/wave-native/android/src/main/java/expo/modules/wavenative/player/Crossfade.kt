package expo.modules.wavenative.player

import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** A player as [Crossfade] drives it. */
interface CrossfadeDeck {
  val positionMs: Long
  val isPlaying: Boolean

  /** Whether it played its song to the end. */
  val ended: Boolean

  /** Whether it has its song's start buffered, ready to sound at once. */
  val ready: Boolean

  fun setVolume(volume: Float)

  fun setPlaying(playing: Boolean)
}

/** What [Crossfade] needs from [PlaybackService]. */
interface CrossfadeHost {
  /** The session's player: the queue, the notification, Auto. [promote] changes which player it is. */
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

  /** The entry the session's player is on (its media id), or null. */
  val currentKey: String?

  /** The entry it moves to when the current song ends on its own, or null. */
  val nextKey: String?

  /** Real time (elapsed-realtime ms), which bounds an overlap whatever the players' positions say. */
  val nowMs: Long

  /**
   * Starts making the next song ready on the session's player too (a streamed
   * song's address resolved and its start buffered), so a song change without
   * an overlap stays gapless. Asked once per song, at [CrossfadeTiming.prefetchAt].
   */
  fun prefetchNext()

  /** Whether the next song is an unsearched one JS is still searching (Core's `searchingAfter`). */
  val nextSearching: Boolean

  /** What crossfade did at a song change, once per change. For the app log. */
  fun outcome(outcome: CrossfadeOutcome)

  /**
   * Opens a second player on the next song ([nextKey]) from its start, paused
   * and silent, loading it so it's [CrossfadeDeck.ready] by the overlap.
   */
  fun openNext(): CrossfadeDeck

  /**
   * The handoff: the second player, playing the next song, becomes the
   * session's player ([main]: the queue, the notification, Auto, audio focus,
   * position reports), with no seek. The player it replaces is returned as the
   * second player, left with only the outgoing song, to fade out on; null when
   * no handoff could be made (the service stopping).
   */
  fun promote(): CrossfadeDeck?

  /** Releases the second player: the next song's before the handoff, the outgoing song's after it. */
  fun closeSecond()

  /** The song fading out went silent or was cut off. */
  fun fadeEnded()
}

/** Why a song change had no overlap, or an overlap was cut, as the app log says it. */
interface CrossfadeReason {
  val reason: String
}

/** What crossfade did at one song change: the app log gets exactly one per change. */
sealed interface CrossfadeOutcome {
  /** No overlap, for [why]; [lateMs] is how late the next song was, when that was why. */
  data class Skipped(val why: CrossfadeReason, val lateMs: Long = 0) : CrossfadeOutcome

  /** The overlap ran to its end over [overlapMs], [lateMs] shorter than the song's whole one. */
  data class Done(val overlapMs: Long, val lateMs: Long) : CrossfadeOutcome

  /**
   * The overlap was cut for [why], [elapsedMs] into it (real time, from when the incoming song
   * sounded, or from the handoff while it hadn't: [overlapMs] null).
   */
  data class Cut(val why: CrossfadeEnd, val elapsedMs: Long, val overlapMs: Long?) : CrossfadeOutcome
}

/** The rules that leave a song change without an overlap, besides a waiting next song called off ([CrossfadeEnd]). */
enum class CrossfadeSkip(override val reason: String) : CrossfadeReason {
  Off("crossfade is off"),
  NotPlaying("the song wasn't playing"),
  UnknownLength("the song's length wasn't known"),
  PastHandoff("the song was already past the handoff point"),
  NoNext("no song plays next on its own"),
  NotReady("the next song wasn't ready"),
  Searching("the next song was still being searched"),
  Early("the song changed before its overlap was due"),
}

/** Why a waiting next song was called off or an overlap ended before its time, as the app log says it. */
enum class CrossfadeEnd(override val reason: String) : CrossfadeReason {
  /** A skip, previous, picking a song, or the song being faded into replaced in the queue. */
  Moved("the player moved to another song"),
  Seek("a seek"),
  Error("a player error"),
  Off("crossfade turned off"),
  Stalled("the outgoing song stalled"),
  Stopped("the playback service stopped"),
  Overdue("the overlap outlasted its length"),
}

/**
 * Crossfade (Settings › Playback): a song ending on its own overlaps the next
 * one for [overlapMs], the first fading out while the next fades in.
 *
 * Two players take turns. Well ahead of the overlap ([CrossfadeTiming.prefetchAt])
 * a second player opens on the next song, paused and silent at its start, and
 * loads it ([CrossfadeHost.openNext]). At the handoff it starts playing where it
 * is and becomes the session's player ([CrossfadeHost.promote]), so Now Playing,
 * the notification, the lock screen and Auto show it from then on, while the
 * player it replaces plays the outgoing song on to its end, fading out. Nothing
 * seeks at the handoff, so no audio is replayed or skipped, and nothing resets
 * the incoming song's audio output. A queue sync that replaces the next song
 * while it waits opens the new one instead.
 *
 * A next song not ready when the overlap should begin is late: the outgoing
 * song plays on at full volume, and the overlap starts once it's ready, over
 * the time left ([CrossfadeTiming.lateOverlap]), or the song ends gapless.
 * After the handoff the overlap's clock only starts once the incoming song
 * sounds. The outgoing song never fades out alone.
 *
 * Once begun, the overlap runs to its end unless the song being faded into
 * changes ([moved]: a skip, previous, picking a song, the next song replaced
 * in the queue), the owner seeks, or the player fails ([interrupt]): those
 * switch at once. A queue sync that leaves the next song as it was doesn't.
 * Pausing pauses the outgoing song too. The overlap is bounded by real time as
 * well as by the players' positions: once it has run (paused time aside) its
 * length plus [OVERDUE_MS] since the incoming song sounded, it ends, whatever
 * the session's player's position says.
 *
 * Every song change gets exactly one outcome in the app log
 * ([CrossfadeHost.outcome]): skipped with the rule that skipped it, done with
 * the overlap it had, or cut with why and how long it ran.
 *
 * Main thread only. [tick] runs the timing; the service calls it again after
 * the delay it returns. The fades follow the two songs' positions, which go
 * on with elapsed time, so a tick that comes late (a stall on the main thread)
 * brings the volumes to where they should be by then.
 */
class Crossfade(private val host: CrossfadeHost) {
  /** The overlap chosen in Settings (Core's `crossfadeDuration`); 0 is off. */
  var overlapMs = 0L

  private sealed interface Phase

  private data object Idle : Phase

  /**
   * The next song ([nextKey]) waits on the second player, paused and silent,
   * for the outgoing song (of [durationMs]) to reach [handoffAtMs].
   */
  private class Waiting(
    val next: CrossfadeDeck,
    val outgoingKey: String?,
    val nextKey: String?,
    val durationMs: Long,
    val handoffAtMs: Long,
    val overlapMs: Long,
  ) : Phase

  /**
   * The overlap: the outgoing song fades out on the second player until its
   * end at [endMs] while the session's player fades in. Its length is fixed
   * once the incoming song sounds ([overlapMs]; null until then), at most
   * [upToMs]; [fullMs] is the song's whole overlap, before any was lost to
   * lateness.
   */
  private class Fading(
    var outgoing: CrossfadeDeck?,
    val incomingKey: String?,
    val endMs: Long,
    val upToMs: Long,
    val fullMs: Long,
    /** How much of the outgoing song was left at the handoff: the longest it can sound on its own. */
    val leftMs: Long,
    startedAtMs: Long,
    playing: Boolean,
  ) : Phase {
    var overlapMs: Long? = null

    /** Real time the overlap has run since the handoff, paused time left out. */
    var runMs = 0L

    /** [runMs] when the incoming song began to sound, fixing [overlapMs]. */
    var soundedAtRunMs = 0L

    private var lastMs = startedAtMs
    private var lastPlaying = playing

    /** Adds the real time since the last step, if playback was meant to run through it. */
    fun step(nowMs: Long, playing: Boolean) {
      if (lastPlaying) runMs += (nowMs - lastMs).coerceAtLeast(0L)
      lastMs = nowMs
      lastPlaying = playing
    }

    /** Whether the overlap ran longer in real time than it can, plus [graceMs]. */
    fun outlasted(graceMs: Long): Boolean {
      val overlap = overlapMs
      return if (overlap == null) runMs >= leftMs + graceMs else runMs - soundedAtRunMs >= overlap + graceMs
    }
  }

  private var phase: Phase = Idle

  /** Whether the next song was asked for ([CrossfadeHost.prefetchNext]) while this one plays. */
  private var prefetched = false

  /** Why this song wouldn't overlap the next as things stand ([idle]'s rules); null while it's not due yet. */
  private var skipState: CrossfadeReason? = null

  /** Why this song's overlap was given up (a waiting next song called off, a late one), and how late. */
  private var skipEvent: CrossfadeReason? = null
  private var skipLateMs = 0L

  /** Whether the overlap under way still owes its song change's outcome. */
  private var owed = false

  /** Brings volumes and timing up to date; returns when to call again, or null to wait for playback. */
  fun tick(): Long? =
    when (val current = phase) {
      Idle -> idle()
      is Waiting -> waiting(current)
      is Fading -> fading(current)
    }

  /** The entry the session's player last moved to ([moved]), or was handed over to. */
  private var movedTo: String? = null

  /**
   * The session's player moved to the entry [key], for any reason. A queue
   * sync reporting the song being faded into, or the song that plays, again
   * changes nothing (its next song stays asked for); any other move ends a
   * waiting next song or an overlap at once ([interrupt]): a skip, picking a
   * song, or the next song replaced. [restarted]: the same entry again from
   * its start (repeat). Returns whether the song changed, so the service only
   * then turns the next song's preload off again. The handoff itself is no
   * move: the session's player changes instead.
   */
  fun moved(key: String?, restarted: Boolean = false): Boolean {
    val changed = key == null || key != movedTo || restarted
    val from = movedTo
    movedTo = key
    val expected = when (val current = phase) {
      Idle -> null
      is Waiting -> current.outgoingKey
      is Fading -> current.incomingKey
    }
    if (phase == Idle) {
      if (changed) interrupt(CrossfadeEnd.Moved)
    } else if (key == null || key != expected) {
      interrupt(CrossfadeEnd.Moved)
    }
    if (changed && from != null && key != null) {
      val why = if (overlapMs <= 0) CrossfadeSkip.Off else skipEvent ?: skipState ?: CrossfadeSkip.Early
      host.outcome(CrossfadeOutcome.Skipped(why, if (why == skipEvent) skipLateMs else 0L))
    }
    if (changed) forgetSkip()
    return changed
  }

  private fun forgetSkip() {
    skipState = null
    skipEvent = null
    skipLateMs = 0L
  }

  private fun giveUp(why: CrossfadeReason, lateMs: Long = 0L) {
    skipEvent = why
    skipLateMs = lateMs
  }

  /** The owner moved the session's player ([why]): no fade, the outgoing song stops now. */
  fun interrupt(why: CrossfadeEnd) {
    prefetched = false
    when (val current = phase) {
      Idle -> {}
      is Waiting -> {
        giveUp(why)
        host.closeSecond()
      }
      is Fading -> {
        current.step(host.nowMs, host.mainWantsToPlay)
        if (current.outgoing != null) cut(current, why)
        endOutgoing(current)
        host.main.setVolume(1f)
      }
    }
    phase = Idle
  }

  /** Play or pause on the session's player; the outgoing song follows. */
  fun onPlayingChanged() {
    val current = phase as? Fading ?: return
    current.step(host.nowMs, host.mainWantsToPlay)
    current.outgoing?.setPlaying(host.mainWantsToPlay)
  }

  private fun idle(): Long? {
    if (overlapMs <= 0) return skip(CrossfadeSkip.Off, null)
    if (!host.main.isPlaying) return skip(CrossfadeSkip.NotPlaying, null)
    val durationMs = host.mainDurationMs ?: return skip(CrossfadeSkip.UnknownLength, POLL_MS)
    val overlap = min(overlapMs, durationMs / 2)
    val handoffAt = durationMs - overlap
    val positionMs = host.main.positionMs
    val openAt = CrossfadeTiming.prefetchAt(overlapMs, durationMs)
    skipState = null
    if (positionMs < openAt) return (openAt - positionMs).coerceIn(TICK_MS, POLL_MS)
    // It doesn't move on, or it's too late to wait for the next song: it ends gapless.
    if (!host.movesOnNaturally) return skip(CrossfadeSkip.NoNext, POLL_MS)
    if (!prefetched) {
      prefetched = true
      host.prefetchNext()
    }
    // The player's next song isn't the one JS is searching for: nothing to open yet.
    if (host.nextSearching) return skip(CrossfadeSkip.Searching, POLL_MS)
    if (positionMs >= handoffAt) return skip(CrossfadeSkip.PastHandoff, POLL_MS)
    val nextKey = host.nextKey ?: return skip(CrossfadeSkip.NoNext, POLL_MS)
    skipEvent = null
    val next = host.openNext()
    next.setVolume(0f)
    next.setPlaying(false)
    phase = Waiting(next, host.currentKey, nextKey, durationMs, handoffAt, overlap)
    return TICK_MS
  }

  /**
   * The next song waiting for the handoff. A next song replaced in the queue,
   * gone, or now being searched for again closes it and starts over ([idle]).
   * A pause or a rebuffer of the session's player waits. Once the overlap is
   * due, it starts if the next song is ready, over the time left
   * ([CrossfadeTiming.lateOverlap]); otherwise the outgoing song plays on at
   * full volume and this is asked again each tick, until the next song is
   * ready, or too little is left and the song ends gapless.
   */
  private fun waiting(current: Waiting): Long? {
    val main = host.main
    if (overlapMs <= 0) return callOff(CrossfadeEnd.Off)
    if (!host.movesOnNaturally || host.nextSearching || host.nextKey != current.nextKey) {
      cancel()
      return tick()
    }
    if (!host.mainWantsToPlay) return null
    val positionMs = main.positionMs
    if (positionMs < current.handoffAtMs) return (current.handoffAtMs - positionMs).coerceIn(TICK_MS, POLL_MS)
    if (!main.isPlaying) return TICK_MS
    val leftMs = current.durationMs - positionMs
    val overlap = CrossfadeTiming.lateOverlap(current.overlapMs, leftMs)
    if (overlap <= 0) {
      giveUp(CrossfadeSkip.NotReady, lateMs = positionMs - current.handoffAtMs)
      cancel()
      return POLL_MS
    }
    if (!current.next.ready) return TICK_MS
    current.next.setPlaying(true)
    val outgoing = host.promote() ?: return callOff(CrossfadeEnd.Stopped)
    outgoing.setVolume(1f)
    host.main.setVolume(0f)
    movedTo = current.nextKey
    phase = Fading(
      outgoing,
      current.nextKey,
      endMs = current.durationMs,
      upToMs = overlap,
      fullMs = current.overlapMs,
      leftMs = leftMs,
      startedAtMs = host.nowMs,
      playing = host.mainWantsToPlay,
    )
    prefetched = false
    owed = true
    return TICK_MS
  }

  private fun fading(current: Fading): Long? {
    val main = host.main
    current.step(host.nowMs, host.mainWantsToPlay)
    val sounding = current.outgoing
    // The overlap's clock starts once the incoming song sounds: until then
    // the outgoing song plays on at full volume.
    if (current.overlapMs == null && sounding != null && main.isPlaying) {
      val overlap = min(current.upToMs, current.endMs - sounding.positionMs + main.positionMs)
      current.overlapMs = overlap
      current.soundedAtRunMs = current.runMs
    }
    val overlap = current.overlapMs
    // Bounded by real time too: an overlap whose positions stop advancing still ends.
    if (current.outlasted(OVERDUE_MS)) {
      if (current.outgoing != null) cut(current, CrossfadeEnd.Overdue)
      endOutgoing(current)
      main.setVolume(1f)
      phase = Idle
      return tick()
    }
    current.outgoing?.let { outgoing ->
      val leftMs = current.endMs - outgoing.positionMs
      // An outgoing player that failed or stalled never gets there: the session's
      // player, as far into the next song as the overlap is long, says it should have.
      val overdue = overlap != null && main.positionMs >= overlap + OVERDUE_MS
      if (outgoing.ended || leftMs <= 0 || overdue) {
        // Over before the incoming song sounded: a gapless move after all.
        when {
          overlap == null -> report(CrossfadeOutcome.Skipped(CrossfadeSkip.NotReady, current.fullMs))
          !outgoing.ended && leftMs > 0 -> cut(current, CrossfadeEnd.Stalled)
          else -> report(CrossfadeOutcome.Done(overlap, current.fullMs - overlap))
        }
        endOutgoing(current)
      } else {
        outgoing.setVolume(if (overlap == null) 1f else gain(leftMs.toFloat() / overlap))
      }
    }
    if (current.outgoing == null && (overlap == null || main.positionMs >= overlap)) {
      main.setVolume(1f)
      phase = Idle
      return tick()
    }
    main.setVolume(if (overlap == null) 0f else gain(main.positionMs.toFloat() / overlap))
    return if (host.mainWantsToPlay) TICK_MS else null
  }

  /** Reports the overlap's song change, once. */
  private fun report(outcome: CrossfadeOutcome) {
    if (!owed) return
    owed = false
    host.outcome(outcome)
  }

  private fun cut(current: Fading, why: CrossfadeEnd) {
    val elapsedMs = if (current.overlapMs == null) current.runMs else current.runMs - current.soundedAtRunMs
    report(CrossfadeOutcome.Cut(why, elapsedMs, current.overlapMs))
  }

  /** This song won't overlap the next for [why], as things stand; returns [delayMs]. */
  private fun skip(why: CrossfadeReason, delayMs: Long?): Long? {
    skipState = why
    return delayMs
  }

  private fun endOutgoing(current: Fading) {
    if (current.outgoing == null) return
    host.closeSecond()
    current.outgoing = null
    host.fadeEnded()
  }

  /** Closes a waiting next song. */
  private fun cancel() {
    host.closeSecond()
    phase = Idle
  }

  /** Calls the waiting next song off for [why], and goes on as if there was none. */
  private fun callOff(why: CrossfadeEnd): Long? {
    giveUp(why)
    cancel()
    return tick()
  }

  private companion object {
    /** How often volumes and timing are brought up to date around an overlap. */
    const val TICK_MS = 50L

    /** How often a playing song is looked at while its overlap is far off. */
    const val POLL_MS = 1000L

    /** How long past the overlap an outgoing song still not done is given before it's closed. */
    const val OVERDUE_MS = 1000L

    /** Equal-power fade: the two songs' loudness adds up to the same through the overlap. */
    fun gain(fraction: Float): Float = sin(fraction.coerceIn(0f, 1f) * PI.toFloat() / 2)
  }
}


/**
 * Core's crossfade timing (packages/core/src/crossfade.ts), which the service
 * runs without JS. Keep in step with Core.
 */
internal object CrossfadeTiming {
  /** Part of how far ahead of the overlap the next song opens (Core's `CROSSFADE_PRE_ROLL_MS`). */
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
