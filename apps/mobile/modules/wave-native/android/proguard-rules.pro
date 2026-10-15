# jaudiotagger looks up tag field and frame classes reflectively.
-keep class org.jaudiotagger.** { *; }
# Desktop-only image code paths, never reached on Android (TagOptionSingleton.isAndroid).
-dontwarn java.awt.**
-dontwarn javax.imageio.**
-dontwarn javax.swing.**

# YT Music: ktor finds innertubex's @Serializable request and response models'
# serializers by reflection, and quickjs-kt (innertubex's cipher solver) is JNI.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class com.metrolist.innertubex.**$$serializer { *; }
-keepclassmembers class com.metrolist.innertubex.** {
    *** Companion;
}
-keepclasseswithmembers class com.metrolist.innertubex.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep class com.dokar.quickjs.** { *; }
# The proof-of-origin token page calls back into Kotlin by method name.
-keepattributes JavascriptInterface
-keepclassmembers class expo.modules.wavenative.yt.potoken.YtPoTokenWebView {
    @android.webkit.JavascriptInterface <methods>;
}
# Desktop JVM classes ktor mentions but never uses on Android.
-dontwarn java.lang.management.**
-dontwarn org.slf4j.impl.**

# Wave account: Credential Manager finds its Play services provider by reflection.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }
