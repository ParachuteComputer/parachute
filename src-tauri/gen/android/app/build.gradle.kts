import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// The play-test key lives outside the repo (PARACHUTE_KEYSTORE_PROPERTIES, default
// ~/.config/parachute-playtest/keystore.properties: storeFile, storePassword, keyAlias, keyPassword). With it, debug
// and release builds are both signed with it. Without it a release build is left unsigned, and a debug build fails
// rather than fall back to Gradle's own debug key (on a machine that builds other apps, that key may be theirs).
val playtestKey = Properties().apply {
    val f = file(System.getenv("PARACHUTE_KEYSTORE_PROPERTIES") ?: "${System.getProperty("user.home")}/.config/parachute-playtest/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    compileSdk = 36
    namespace = "computer.parachute.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "computer.parachute.app"
        minSdk = 26
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (playtestKey.getProperty("storeFile") != null) {
            create("playtest") {
                storeFile = file(playtestKey.getProperty("storeFile"))
                storePassword = playtestKey.getProperty("storePassword")
                keyAlias = playtestKey.getProperty("keyAlias")
                keyPassword = playtestKey.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            val key = signingConfigs.findByName("playtest")
            if (key != null) signingConfig = key
            else if (gradle.startParameter.taskNames.any { it.contains("debug", ignoreCase = true) })
                throw GradleException("No play-test key for a debug build: set PARACHUTE_KEYSTORE_PROPERTIES or create ~/.config/parachute-playtest/keystore.properties")
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfigs.findByName("playtest")?.let { signingConfig = it }
            // No R8: Rust finds the Kotlin classes (RustWebView, Ipc) by name over JNI.
            isMinifyEnabled = false
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

// RustWebView.kt and Ipc.kt in src/main/java/computer/parachute/app replace wry's generated copies: they keep the
// bridge to native code out of every frame but the app's own (MainFrameOnly.kt). Copied from the Uni app's shell.
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    exclude("**/generated/RustWebView.kt", "**/generated/Ipc.kt")
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // NotifyService.kt's relay connection (Android has no WebSocket client of its own)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // PushService.kt: notifications while closed through the person's UnifiedPush distributor (ntfy or another; no
    // Google services). It also opens the Web Push encryption (RFC 8291) the push gateway seals each push with.
    implementation("org.unifiedpush.android:connector:3.0.10")
    // UnlockPlugin.kt: the device unlock before an approval (as the Uni app)
    implementation("androidx.biometric:biometric:1.1.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")