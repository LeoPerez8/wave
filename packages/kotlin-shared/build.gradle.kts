import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Plain Kotlin/JVM: no Android dependency, so the desktop runs the same code as the phone.
plugins {
  kotlin("jvm") version "2.4.20"
  `java-library`
}

group = "dev.leoperez.wave"
version = "0.0.0"

java {
  sourceCompatibility = JavaVersion.VERSION_17
  targetCompatibility = JavaVersion.VERSION_17
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

// The test fixtures (audio files, YouTube answers) and their loader are shared with the Android
// module's tests, which add these folders to their own source set.
sourceSets.test {
  kotlin.srcDir("src/testFixtures/kotlin")
  resources.srcDir("src/testFixtures/resources")
}

dependencies {
  // Tag reading and writing for MP3, FLAC, M4A, Ogg Vorbis and WAV.
  api("net.jthink:jaudiotagger:3.0.1")
  // YT Music: innertubex (GPL-3.0, from JitPack) talks to YouTube Music; it ships no HTTP engine
  // and sends @Serializable bodies, so the client needs OkHttp and content negotiation. Responses
  // are parsed with kotlinx.serialization's JsonElement API (YtSearchParser). On the JVM it
  // resolves to innertubex-desktop, which needs no QuickJS natives.
  api("com.github.MetrolistGroup.innertubex:innertubex:0.11.9")
  api("io.ktor:ktor-client-okhttp:3.6.0")
  // ktor-client-okhttp asks for OkHttp 5; the phone also pins every OkHttp module to it (#119).
  api(platform("com.squareup.okhttp3:okhttp-bom:5.5.0"))
  api("io.ktor:ktor-client-content-negotiation:3.6.0")
  api("io.ktor:ktor-serialization-kotlinx-json:3.6.0")
  api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

  testImplementation("junit:junit:4.13.2")
}

// Print assertion messages in CI logs, which are all the PR comment shows.
tasks.withType<Test>().configureEach {
  testLogging {
    events("failed")
    exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
  }
}
