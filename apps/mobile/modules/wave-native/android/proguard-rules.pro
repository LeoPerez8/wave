# jaudiotagger looks up tag field and frame classes reflectively.
-keep class org.jaudiotagger.** { *; }
# Desktop-only image code paths, never reached on Android (TagOptionSingleton.isAndroid).
-dontwarn java.awt.**
-dontwarn javax.imageio.**
-dontwarn javax.swing.**
