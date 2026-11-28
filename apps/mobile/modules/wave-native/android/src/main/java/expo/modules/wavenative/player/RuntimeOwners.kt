package expo.modules.wavenative.player

/** Each Android service releases only its own headless runtime lifetime. */
class RuntimeOwners {
  private val owners = HashSet<String>()
  fun acquire(owner: String) { owners.add(owner) }
  fun release(owner: String) { owners.remove(owner) }
  fun isWanted(): Boolean = owners.isNotEmpty()

  // [DEBUG-5d1a] Temporary: the owners, for ScreenOffProbe's lines. Remove with it.
  fun names(): List<String> = owners.sorted()
}
