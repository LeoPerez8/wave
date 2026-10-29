package expo.modules.wavenative.locale

/** Resolved Wave language, shared by foreground services and the launcher shortcuts. */
object NativeText {
  @Volatile var language = "en"
    private set
  private val listeners = mutableListOf<() -> Unit>()
  fun get(key: String): String = (if (language == "pt-BR") NativeCatalogue.pt else NativeCatalogue.en).getValue(key)
  fun publish(next: String) {
    if (next == language) return
    language = next
    listeners.toList().forEach { it() }
  }
  fun listen(listener: () -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }
}
