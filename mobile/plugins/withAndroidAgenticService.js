const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin to inject:
 * 1. Required permissions and Service configurations in AndroidManifest.xml.
 * 2. accessibility_service_config.xml resource file.
 * 3. Native Kotlin files for Foreground and Accessibility services.
 * 4. Register AgenticAccessibilityPackage in MainApplication.kt.
 */
function withAndroidAgenticService(config) {
  // 1. Modify AndroidManifest.xml
  config = withAndroidManifest(config, async (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    // Ensure permissions exist in manifest
    const manifest = config.modResults.manifest;
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const permissions = [
      'android.permission.RECORD_AUDIO',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      'android.permission.WAKE_LOCK',
      'android.permission.RECEIVE_BOOT_COMPLETED'
    ];

    permissions.forEach((permissionName) => {
      const exists = manifest['uses-permission'].some(
        (p) => p.$['android:name'] === permissionName
      );
      if (!exists) {
        manifest['uses-permission'].push({
          $: { 'android:name': permissionName }
        });
      }
    });

    // Check and inject VoiceForegroundService
    let services = mainApplication.service || [];
    const hasForegroundService = services.some(
      (s) => s.$['android:name'] === 'com.agentic.assistant.VoiceForegroundService'
    );
    if (!hasForegroundService) {
      services.push({
        $: {
          'android:name': 'com.agentic.assistant.VoiceForegroundService',
          'android:enabled': 'true',
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone'
        }
      });
    }

    // Check and inject AgenticAccessibilityService
    const hasAccessibilityService = services.some(
      (s) => s.$['android:name'] === 'com.agentic.assistant.AgenticAccessibilityService'
    );
    if (!hasAccessibilityService) {
      services.push({
        $: {
          'android:name': 'com.agentic.assistant.AgenticAccessibilityService',
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
          'android:exported': 'true',
          'android:label': 'Agentic Voice Assistant Automator'
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }]
          }
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.accessibilityservice',
              'android:resource': '@xml/accessibility_service_config'
            }
          }
        ]
      });
    }

    mainApplication.service = services;
    return config;
  });

  // 2. Add resource configuration file, Kotlin native code and MainApplication registrations
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      
      // XML Configuration path
      const resXmlDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
      if (!fs.existsSync(resXmlDir)) {
        fs.mkdirSync(resXmlDir, { recursive: true });
      }
      
      const xmlConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged|typeWindowContentChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagDefault|flagRetrieveInteractiveWindows|flagReportViewIds"
    android:canRetrieveWindowContent="true"
    android:canPerformGestures="true"
    android:notificationTimeout="100" />`;
      
      fs.writeFileSync(path.join(resXmlDir, 'accessibility_service_config.xml'), xmlConfigContent, 'utf-8');

      // Native Kotlin copy setup
      const kotlinPackageDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        'com',
        'agentic',
        'assistant'
      );
      
      if (!fs.existsSync(kotlinPackageDir)) {
        fs.mkdirSync(kotlinPackageDir, { recursive: true });
      }

      // Source files from workspace root path relative to projectRoot
      const sourceDir = path.join(projectRoot, 'android-native');
      const filesToCopy = ['VoiceForegroundService.kt', 'AgenticAccessibilityService.kt', 'AgenticAccessibilityModule.kt'];
      
      filesToCopy.forEach((filename) => {
        const srcPath = path.join(sourceDir, filename);
        const destPath = path.join(kotlinPackageDir, filename);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          console.log(`[ConfigPlugin] Successfully copied ${filename} to ${destPath}`);
        } else {
          console.warn(`[ConfigPlugin] Source file not found: ${srcPath}. Native build might fail if not created later.`);
        }
      });

      // Modify MainApplication.kt to register the package
      const mainApplicationPath = path.join(kotlinPackageDir, 'MainApplication.kt');
      if (fs.existsSync(mainApplicationPath)) {
        let content = fs.readFileSync(mainApplicationPath, 'utf8');

        // Check if package is imported
        if (!content.includes('import com.agentic.assistant.AgenticAccessibilityPackage')) {
          content = content.replace(
            /package com\.agentic\.assistant/,
            `package com.agentic.assistant\n\nimport com.agentic.assistant.AgenticAccessibilityPackage`
          );
        }

        // Add package to getPackages list
        if (content.includes('override fun getPackages(): List<ReactPackage>')) {
          if (!content.includes('AgenticAccessibilityPackage()')) {
            content = content.replace(
              /PackageList\(this\)\.packages\.apply\s*\{\s*([\s\S]*?)\}/,
              `PackageList(this).packages.apply {\n      add(AgenticAccessibilityPackage())\n      $1}`
            );
          }
        }

        fs.writeFileSync(mainApplicationPath, content, 'utf8');
        console.log(`[ConfigPlugin] Successfully modified MainApplication.kt`);
      }

      return config;
    }
  ]);

  return config;
}

// Help resolve AndroidConfig namespaces
const AndroidConfig = {
  Manifest: {
    getMainApplicationOrThrow(manifest) {
      const htmlApp = manifest.manifest.application && manifest.manifest.application[0];
      if (!htmlApp) {
        throw new Error('Could not find MainActivity application element in AndroidManifest.xml');
      }
      return htmlApp;
    }
  }
};

module.exports = withAndroidAgenticService;
