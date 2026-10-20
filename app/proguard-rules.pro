# JNI entry points are looked up by name from native code.
-keep class com.castboxtv.app.viz.VizEngine { *; }
-keep class com.castboxtv.app.viz.ProjectMJNI { *; }
-keepclasseswithmembernames class * { native <methods>; }

# Cling / Jetty / Seamless use reflection and optional dependencies.
-keep class org.fourthline.cling.** { *; }
-keep class org.seamless.** { *; }
-keep class org.eclipse.jetty.** { *; }
-dontwarn org.fourthline.cling.**
-dontwarn org.seamless.**
-dontwarn org.eclipse.jetty.**
-dontwarn javax.servlet.**
-dontwarn javax.naming.**
-dontwarn org.slf4j.**
-dontwarn org.apache.**
-dontwarn org.w3c.dom.**
-dontwarn javax.xml.**
-dontwarn java.awt.**
-dontwarn javax.swing.**

# Cling's annotation binder reads these via reflection.
-keepattributes Signature,*Annotation*,InnerClasses,EnclosingMethod,Exceptions
-keep class com.castboxtv.app.dlna.** { *; }
-keep class * extends org.fourthline.cling.support.avtransport.AbstractAVTransportService { *; }
-keep class * extends org.fourthline.cling.support.renderingcontrol.AbstractAudioRenderingControl { *; }
-keep class * extends org.fourthline.cling.support.connectionmanager.ConnectionManagerService { *; }
