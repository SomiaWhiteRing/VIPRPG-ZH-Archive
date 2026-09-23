FROM node:24-bookworm

ARG GRADLE_VERSION=8.13
ARG ANDROID_TOOLS_REVISION=11076708
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    PATH=/opt/gradle/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless unzip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fL --retry 3 "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && mv "/opt/gradle-${GRADLE_VERSION}" /opt/gradle \
    && rm /tmp/gradle.zip
RUN mkdir -p "$ANDROID_HOME/cmdline-tools" \
    && curl -fL --retry 3 "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_TOOLS_REVISION}_latest.zip" -o /tmp/android-tools.zip \
    && unzip -q /tmp/android-tools.zip -d "$ANDROID_HOME/cmdline-tools" \
    && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
    && rm /tmp/android-tools.zip \
    && yes | sdkmanager --licenses >/dev/null \
    && sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"

WORKDIR /workspace
ENTRYPOINT ["bash", "android/build-apk.sh"]
