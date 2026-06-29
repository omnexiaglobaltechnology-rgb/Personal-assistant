package com.agentic.assistant

import android.content.Intent
import android.provider.Settings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager
import java.util.ArrayList

class AgenticAccessibilityModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val transcript = intent?.getStringExtra("transcript")
            if (transcript != null) {
                sendEvent("onVoiceCommand", transcript)
            }
        }
    }

    init {
        val filter = IntentFilter("com.agentic.assistant.VOICE_COMMAND")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            reactContext.registerReceiver(receiver, filter)
        }
    }

    private fun sendEvent(eventName: String, params: String) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    override fun getName(): String {
        return "AgenticAccessibility"
    }

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        promise.resolve(AgenticAccessibilityService.isSharedServiceConnected())
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
    }

    @ReactMethod
    fun launchApp(packageName: String, promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val intent = pm.getLaunchIntentForPackage(packageName)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.reject("APP_NOT_FOUND", "Package $packageName is not installed on this device.")
            }
        } catch (e: Exception) {
            promise.reject("LAUNCH_FAILED", e.message)
        }
    }

    @ReactMethod
    fun clickText(text: String, promise: Promise) {
        val service = AgenticAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_DISCONNECTED", "Accessibility Service is not running or active.")
            return
        }
        val success = service.clickText(text)
        promise.resolve(success)
    }

    @ReactMethod
    fun clickId(id: String, promise: Promise) {
        val service = AgenticAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_DISCONNECTED", "Accessibility Service is not running or active.")
            return
        }
        val success = service.clickId(id)
        promise.resolve(success)
    }

    @ReactMethod
    fun typeText(id: String?, text: String, promise: Promise) {
        val service = AgenticAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_DISCONNECTED", "Accessibility Service is not running or active.")
            return
        }
        val success = service.typeText(id, text)
        promise.resolve(success)
    }

    @ReactMethod
    fun scroll(direction: String, promise: Promise) {
        val service = AgenticAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_DISCONNECTED", "Accessibility Service is not running or active.")
            return
        }
        val success = service.scroll(direction)
        promise.resolve(success)
    }

    @ReactMethod
    fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, duration: Int, promise: Promise) {
        val service = AgenticAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_DISCONNECTED", "Accessibility Service is not running or active.")
            return
        }
        val success = service.swipe(x1, y1, x2, y2, duration)
        promise.resolve(success)
    }

    @ReactMethod
    fun readWindowText(promise: Promise) {
        val service = AgenticAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_DISCONNECTED", "Accessibility Service is not running or active.")
            return
        }
        val text = service.readWindowText()
        promise.resolve(text)
    }

    @ReactMethod
    fun startVoiceService(promise: Promise) {
        try {
            val intent = Intent(reactContext, VoiceForegroundService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("START_SERVICE_FAILED", e.message)
        }
    }

    @ReactMethod
    fun stopVoiceService(promise: Promise) {
        try {
            val intent = Intent(reactContext, VoiceForegroundService::class.java)
            reactContext.stopService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_SERVICE_FAILED", e.message)
        }
    }
}

class AgenticAccessibilityPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        val modules = ArrayList<NativeModule>()
        modules.add(AgenticAccessibilityModule(reactContext))
        return modules
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
