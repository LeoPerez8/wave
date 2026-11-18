// The phone's platform-free Kotlin (YT Music, Soulseek, downloads, tags), built on its own for the
// desktop and included by the Android build (apps/mobile/plugins/kotlinShared.ts), which takes
// `dev.leoperez.wave:kotlin-shared` from here. `stdio` is the desktop's JVM entry point.
rootProject.name = "kotlin-shared"

include(":stdio")

dependencyResolutionManagement {
  repositories {
    mavenCentral()
    // innertubex is published on JitPack.
    maven("https://jitpack.io")
  }
}
