package com.agentic.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.Locale

class VoiceForegroundService : Service() {

    private var speechRecognizer: SpeechRecognizer? = null
    private var recognizerIntent: Intent? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val TAG = "VoiceForegroundService"
    private val CHANNEL_ID = "VoiceAssistantChannel"
    private val NOTIFICATION_ID = 8888
    private var isListening = false

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service onCreate")
        createNotificationChannel()
        acquireWakeLock()
        initializeSpeechRecognizer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "Service onStartCommand")
        
        val notification = createNotification("Listening for 'Hello Assistant'...")
        startForeground(NOTIFICATION_ID, notification)

        startListening()
        return START_STICKY
    }

    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AgenticAssistant::VoiceWakeLock")
        wakeLock?.acquire()
        Log.d(TAG, "WakeLock acquired")
    }

    private fun initializeSpeechRecognizer() {
        if (SpeechRecognizer.isRecognitionAvailable(this)) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
            speechRecognizer?.setRecognitionListener(SpeechListener())
            
            recognizerIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
        } else {
            Log.e(TAG, "Speech Recognition is not available on this device")
        }
    }

    private fun startListening() {
        if (!isListening && speechRecognizer != null && recognizerIntent != null) {
            isListening = true
            // Run on main thread because SpeechRecognizer requires it
            mainExecutor.execute {
                try {
                    speechRecognizer?.startListening(recognizerIntent)
                    Log.d(TAG, "SpeechRecognizer started listening")
                } catch (e: Exception) {
                    Log.e(TAG, "Error starting SpeechRecognizer: ${e.message}")
                    isListening = false
                }
            }
        }
    }

    private fun stopListening() {
        if (isListening) {
            isListening = false
            speechRecognizer?.stopListening()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES, O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Agentic Assistant Background Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the 24/7 voice assistant active and listening"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun createNotification(contentText: String): Notification {
        // Build open app intent on notification click
        val pm = packageManager
        val launchIntent = pm.getLaunchIntentForPackage(packageName)
        val pendingIntent = if (launchIntent != null) {
            PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else null

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Agentic Assistant Active")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.presence_audio_online)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopListening()
        speechRecognizer?.destroy()
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        Log.d(TAG, "Service onDestroy")
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    // Speech Recognition Listener implementation
    private inner class SpeechListener : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            Log.d(TAG, "onReadyForSpeech")
        }

        override fun onBeginningOfSpeech() {
            Log.d(TAG, "onBeginningOfSpeech")
        }

        override fun onRmsChanged(rmsd: Float) {}

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {
            Log.d(TAG, "onEndOfSpeech")
        }

        override fun onError(error: Int) {
            Log.w(TAG, "SpeechRecognizer Error code: $error")
            isListening = false
            // Restart listening loop immediately to keep 24/7 active status
            mainExecutor.execute {
                try {
                    Thread.sleep(500) // Small throttle to prevent rapid spin lock errors
                } catch (e: InterruptedException) {}
                startListening()
            }
        }

        override fun onResults(results: Bundle?) {
            isListening = false
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            if (!matches.isNullOrEmpty()) {
                val transcript = matches[0]
                Log.d(TAG, "Heard speech: $transcript")
                
                // Broadcast the transcript to the React Native app
                val broadcastIntent = Intent("com.agentic.assistant.VOICE_COMMAND").apply {
                    putExtra("transcript", transcript)
                }
                sendBroadcast(broadcastIntent)
                Log.d(TAG, "Broadcast sent with transcript")
            }
            
            // Re-arm speech recognition loop immediately
            startListening()
        }

        override fun onPartialResults(partialResults: Bundle?) {}

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }
}
