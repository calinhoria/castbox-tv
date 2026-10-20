import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.castboxtv.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.castboxtv.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        ndk {
            // libprojectM-4.so is vendored in src/main/jniLibs for these two ABIs
            abiFilters += listOf("armeabi-v7a", "arm64-v8a")
        }

        externalNativeBuild {
            cmake {
                cppFlags += "-std=c++17"
                arguments += "-DANDROID_STL=c++_shared"
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    signingConfigs {
        create("release") {
            val props = Properties()
            val f = rootProject.file("keystore.properties")
            if (f.exists()) {
                f.inputStream().use { props.load(it) }
                storeFile = file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.1"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/DEPENDENCIES"
            excludes += "/META-INF/beans.xml"
        }
        jniLibs {
            useLegacyPackaging = false
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.activity:activity-compose:1.8.0")

    implementation(platform("androidx.compose:compose-bom:2023.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")

    // AppCompat for themes
    implementation("androidx.appcompat:appcompat:1.6.1")
    
    // DLNA/UPnP (Cling)
    implementation("org.fourthline.cling:cling-core:2.1.2") {
        exclude(group = "org.seamless", module = "seamless-xml")
    }
    implementation("org.fourthline.cling:cling-support:2.1.2") {
        exclude(group = "org.seamless", module = "seamless-xml")
    }
    implementation(files("libs/seamless-xml-1.1.2.jar"))
    implementation("org.eclipse.jetty:jetty-server:8.1.22.v20160922")
    implementation("org.eclipse.jetty:jetty-servlet:8.1.22.v20160922")
    implementation("org.eclipse.jetty:jetty-util:8.1.22.v20160922")
    implementation("org.eclipse.jetty:jetty-http:8.1.22.v20160922")
    implementation("org.eclipse.jetty:jetty-io:8.1.22.v20160922")
    implementation("org.eclipse.jetty:jetty-continuation:8.1.22.v20160922")
    implementation("org.eclipse.jetty:jetty-client:8.1.22.v20160922")
    implementation("javax.servlet:javax.servlet-api:3.0.1")
    implementation("org.slf4j:slf4j-android:1.7.36")

    // ExoPlayer for Media
    implementation("androidx.media3:media3-exoplayer:1.1.1")
    implementation("androidx.media3:media3-session:1.1.1")

    // Coil for Async Image Loading
    implementation("io.coil-kt:coil-compose:2.4.0")


    // Palette
    implementation("androidx.palette:palette-ktx:1.0.0")
}
