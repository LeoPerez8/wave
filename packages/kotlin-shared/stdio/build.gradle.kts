import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// The desktop's JVM entry point: the shared Kotlin behind JSON lines over stdio
// (docs/spec-desktop.md, Kotlin on the JVM). The desktop ships `wave-kotlin.jar` from `fatJar`.
plugins {
  kotlin("jvm")
  application
}

java {
  sourceCompatibility = JavaVersion.VERSION_17
  targetCompatibility = JavaVersion.VERSION_17
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
  implementation(rootProject)
  testImplementation("junit:junit:4.13.2")
  testImplementation("io.ktor:ktor-client-mock:3.6.0")
}

sourceSets.test {
  kotlin.srcDir("../src/testFixtures/kotlin")
  resources.srcDir("../src/testFixtures/resources")
}

application { mainClass.set("dev.leoperez.wave.stdio.MainKt") }

// One JAR with every dependency in it, the shape the desktop bundles next to its Java runtime.
// Stored, not deflated: the installer compresses it far better (about 5 MB instead of 12).
tasks.register<Jar>("fatJar") {
  archiveFileName.set("wave-kotlin.jar")
  entryCompression = ZipEntryCompression.STORED
  manifest { attributes["Main-Class"] = application.mainClass }
  duplicatesStrategy = DuplicatesStrategy.EXCLUDE
  from(sourceSets.main.get().output)
  dependsOn(configurations.runtimeClasspath)
  from({ configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) } }) {
    exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/versions/*/module-info.class", "module-info.class")
  }
}

tasks.withType<Test>().configureEach {
  testLogging {
    events("failed")
    exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
  }
}
