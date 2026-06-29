import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  SafeAreaView,
  StatusBar,
  DeviceEventEmitter,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { processTranscript, AutomationPipeline } from './src/services/api';
import { executePipeline, cancelPipelineExecution } from './src/utils/pipelineExecutor';
import { NativeModules } from 'react-native';

const { AgenticAccessibility } = NativeModules;

interface Reminder {
  id: string;
  text: string;
  created_at: string;
}

export default function App() {
  const [isServiceActive, setIsServiceActive] = useState(false);
  const [isAccessibilityEnabled, setIsAccessibilityEnabled] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Voice recording dialogue state
  const [voicePromptText, setVoicePromptText] = useState('');
  const [isRecordingFeedback, setIsRecordingFeedback] = useState(false);
  const voiceResolverRef = useRef<((val: string) => void) | null>(null);

  const logsScrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    // 1. Initial status checks
    checkServiceStatus();
    loadReminders();

    // 2. Listen for voice commands broadcasted from the Kotlin service
    const voiceSubscription = DeviceEventEmitter.addListener(
      'onVoiceCommand',
      (transcript: string) => {
        addLog(`[Heard Broadcast] "${transcript}"`);
        
        // INTERRUPT/STOP TRIGGER
        const cleanText = transcript.trim().toLowerCase();
        if (cleanText === 'stop' || cleanText === 'stop service' || cleanText === 'cancel') {
          addLog('Stopping execution and speech output...');
          cancelPipelineExecution();
          return;
        }

        handleCommand(transcript);
      }
    );

    // 3. Poll accessibility service status
    const statusInterval = setInterval(checkAccessibilityStatus, 3000);

    return () => {
      voiceSubscription.remove();
      clearInterval(statusInterval);
    };
  }, []);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
    setTimeout(() => {
      logsScrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const checkAccessibilityStatus = async () => {
    if (Platform.OS === 'android' && AgenticAccessibility) {
      try {
        const enabled = await AgenticAccessibility.isAccessibilityServiceEnabled();
        setIsAccessibilityEnabled(enabled);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const checkServiceStatus = async () => {
    // Basic service status state check from system
    await checkAccessibilityStatus();
  };

  const toggleVoiceService = async () => {
    if (Platform.OS !== 'android' || !AgenticAccessibility) return;

    try {
      if (isServiceActive) {
        await AgenticAccessibility.stopVoiceService();
        setIsServiceActive(false);
        addLog('Background Voice Listener stopped.');
      } else {
        await AgenticAccessibility.startVoiceService();
        setIsServiceActive(true);
        addLog('Background Voice Listener active. Listening 24/7...');
      }
    } catch (err: any) {
      addLog(`Failed to toggle service: ${err.message}`);
    }
  };

  const openSettings = () => {
    if (Platform.OS === 'android' && AgenticAccessibility) {
      AgenticAccessibility.openAccessibilitySettings();
      addLog('Opened System Accessibility Settings.');
    }
  };

  const loadReminders = async () => {
    try {
      const existing = await AsyncStorage.getItem('@laptop_reminders');
      if (existing) {
        setReminders(JSON.parse(existing));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteReminder = async (id: string) => {
    try {
      const updated = reminders.filter((r) => r.id !== id);
      setReminders(updated);
      await AsyncStorage.setItem('@laptop_reminders', JSON.stringify(updated));
      addLog('Deleted reminder.');
    } catch (err) {
      console.error(err);
    }
  };

  const handleCommand = async (command: string) => {
    const cleanText = command.trim().toLowerCase();
    if (cleanText === 'stop' || cleanText === 'stop service' || cleanText === 'cancel') {
      addLog('Stopping execution and speech output...');
      cancelPipelineExecution();
      setIsProcessing(false);
      return;
    }

    if (isProcessing) return;
    setIsProcessing(true);
    addLog(`Sending to Gemini Context Planner: "${command}"...`);

    try {
      // Fetch current package context (if possible)
      const context = {
        active_package: 'com.agentic.assistant',
        timestamp: new Date().toISOString(),
      };

      const pipeline: AutomationPipeline = await processTranscript(command, context);
      addLog('Planner complete. Running action steps...');

      await executePipeline(pipeline, addLog, triggerVoiceFeedbackPrompt);
      
      // Reload reminders in case pipeline added any
      await loadReminders();
    } catch (err: any) {
      addLog(`Execution error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const simulateTextCommand = () => {
    if (!inputText.trim()) return;
    const command = inputText;
    setInputText('');
    handleCommand(command);
  };

  // Triggers dialog modal and speaks voice prompt, waits for user voice response
  const triggerVoiceFeedbackPrompt = (promptText: string): Promise<string> => {
    return new Promise((resolve) => {
      setVoicePromptText(promptText);
      setIsRecordingFeedback(true);
      voiceResolverRef.current = resolve;
      
      // Wait for user to tap to simulate spoken input in mock/simulator environments
      // Or in prod, starts recording audio automatically
    });
  };

  const submitSimulatedVoiceFeedback = (text: string) => {
    setIsRecordingFeedback(false);
    if (voiceResolverRef.current) {
      voiceResolverRef.current(text);
      voiceResolverRef.current = null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.title}>JARVIS</Text>
        <Text style={styles.subtitle}>OS Automation Assistant</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Status Dashboard */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Engine Control</Text>
          
          <View style={styles.statusRow}>
            <Text style={styles.label}>Background Listener:</Text>
            <View style={styles.statusBadgeRow}>
              <View style={[styles.dot, isServiceActive ? styles.dotActive : styles.dotInactive]} />
              <Text style={styles.badgeText}>{isServiceActive ? 'ACTIVE' : 'INACTIVE'}</Text>
            </View>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.label}>Accessibility Service:</Text>
            <View style={styles.statusBadgeRow}>
              <View style={[styles.dot, isAccessibilityEnabled ? styles.dotActive : styles.dotInactive]} />
              <Text style={styles.badgeText}>{isAccessibilityEnabled ? 'CONNECTED' : 'DISCONNECTED'}</Text>
            </View>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.button} onPress={toggleVoiceService}>
              <Text style={styles.buttonText}>
                {isServiceActive ? 'Stop Background Mic' : 'Start Background Mic'}
              </Text>
            </TouchableOpacity>

            {!isAccessibilityEnabled && (
              <TouchableOpacity style={[styles.button, styles.accentButton]} onPress={openSettings}>
                <Text style={styles.buttonText}>Enable Accessibility</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Text Command Simulator */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Simulate Voice Input</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="e.g., Send WhatsApp reminder to Mom..."
              placeholderTextColor="#666"
              value={inputText}
              onChangeText={setInputText}
            />
            <TouchableOpacity style={styles.sendButton} onPress={simulateTextCommand} disabled={isProcessing}>
              {isProcessing ? (
                <ActivityIndicator color="#00e5ff" size="small" />
              ) : (
                <Text style={styles.sendButtonText}>RUN</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Real-time Logs Console */}
        <View style={[styles.card, styles.consoleCard]}>
          <Text style={styles.cardTitle}>Execution Console</Text>
          <ScrollView
            ref={logsScrollViewRef}
            style={styles.console}
            contentContainerStyle={styles.consoleContent}
            nestedScrollEnabled={true}
          >
            {logs.length === 0 ? (
              <Text style={styles.consolePlaceholder}>Console idle. Wake word or type command above.</Text>
            ) : (
              logs.map((log, index) => (
                <Text key={index} style={styles.consoleText}>
                  {log}
                </Text>
              ))
            )}
          </ScrollView>
        </View>

        {/* Saved Reminders (Laptop Sync) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Reminders Stored for Laptop</Text>
          {reminders.length === 0 ? (
            <Text style={styles.reminderPlaceholder}>No pending context reminders.</Text>
          ) : (
            reminders.map((reminder) => (
              <View key={reminder.id} style={styles.reminderItem}>
                <View style={styles.reminderInfo}>
                  <Text style={styles.reminderText}>{reminder.text}</Text>
                  <Text style={styles.reminderDate}>
                    {new Date(reminder.created_at).toLocaleString()}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteReminder(reminder.id)} style={styles.deleteButton}>
                  <Text style={styles.deleteButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Voice Prompt Recording Dialog Modal */}
      <Modal visible={isRecordingFeedback} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.glowingMicRing}>
              <Text style={styles.micEmoji}>🎙️</Text>
            </View>
            <Text style={styles.modalPrompt}>{voicePromptText}</Text>
            <Text style={styles.modalSub}>Jarvis is listening for your instructions...</Text>
            
            {/* Input to simulate spoken feedback in test environments */}
            <TextInput
              style={styles.modalFeedbackInput}
              placeholder="Type verbal reply (or speak)..."
              placeholderTextColor="#666"
              onSubmitEditing={(e) => submitSimulatedVoiceFeedback(e.nativeEvent.text)}
            />
            
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => submitSimulatedVoiceFeedback('cancel')}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0C20', // Sleek deep space color
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#201A3D',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#00e5ff', // Cyberpunk neon cyan
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 12,
    color: '#8A2BE2', // Neon purple
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  scrollContent: {
    padding: 20,
  },
  card: {
    backgroundColor: '#161233',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#201A3D',
    shadowColor: '#8A2BE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 15,
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: '#a0a0c0',
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  dotActive: {
    backgroundColor: '#00ff66',
    shadowColor: '#00ff66',
    shadowRadius: 8,
    shadowOpacity: 0.5,
  },
  dotInactive: {
    backgroundColor: '#ff3366',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 15,
    gap: 10,
  },
  button: {
    flex: 1,
    backgroundColor: '#201A3D',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#8A2BE2',
  },
  accentButton: {
    backgroundColor: '#8A2BE2',
  },
  buttonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  inputContainer: {
    flexDirection: 'row',
    backgroundColor: '#201A3D',
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 48,
    color: '#fff',
    fontSize: 14,
  },
  sendButton: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    backgroundColor: '#161233',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00e5ff',
  },
  sendButtonText: {
    color: '#00e5ff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  consoleCard: {
    paddingBottom: 10,
  },
  console: {
    height: 160,
    backgroundColor: '#070514',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#201A3D',
  },
  consoleContent: {
    paddingBottom: 10,
  },
  consolePlaceholder: {
    color: '#555',
    fontStyle: 'italic',
    fontSize: 12,
  },
  consoleText: {
    color: '#00ff66', // Terminal green
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 11,
    marginBottom: 5,
  },
  reminderPlaceholder: {
    color: '#555',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 10,
  },
  reminderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#201A3D',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#00e5ff',
  },
  reminderInfo: {
    flex: 1,
  },
  reminderText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  reminderDate: {
    color: '#666',
    fontSize: 10,
    marginTop: 4,
  },
  deleteButton: {
    padding: 8,
  },
  deleteButtonText: {
    color: '#ff3366',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 5, 20, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#161233',
    borderRadius: 24,
    padding: 30,
    width: '85%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#8A2BE2',
    shadowColor: '#8A2BE2',
    shadowRadius: 20,
    shadowOpacity: 0.3,
  },
  glowingMicRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#201A3D',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#00e5ff',
    shadowColor: '#00e5ff',
    shadowRadius: 15,
    shadowOpacity: 0.6,
    marginBottom: 20,
  },
  micEmoji: {
    fontSize: 32,
  },
  modalPrompt: {
    fontSize: 18,
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  modalSub: {
    fontSize: 12,
    color: '#8A2BE2',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalFeedbackInput: {
    width: '100%',
    height: 48,
    backgroundColor: '#201A3D',
    borderRadius: 10,
    paddingHorizontal: 15,
    color: '#fff',
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#201A3D',
  },
  modalButtonRow: {
    width: '100%',
    alignItems: 'center',
  },
  modalCancelButton: {
    paddingVertical: 10,
  },
  modalCancelText: {
    color: '#ff3366',
    fontSize: 14,
    fontWeight: '700',
  },
});
