import { NativeModules, Linking } from 'react-native';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AutomationPipeline, ActionStep } from '../services/api';

const { AgenticAccessibility } = NativeModules;

let shouldCancelPipeline = false;
export const ttsState = {
  lastSpeakEndTime: 0
};

export function cancelPipelineExecution() {
  shouldCancelPipeline = true;
  Speech.stop();
}

/**
 * VM-like interpreter to execute multi-step automation pipelines.
 * Supports conditions, multi-tasking, nested loops, TTS and voice input feedback loops.
 */
export async function executePipeline(
  pipeline: AutomationPipeline,
  onLog: (msg: string) => void,
  onRecordVoice: (promptText: string) => Promise<string>
): Promise<void> {
  onLog(`[Pipeline Started] ID: ${pipeline.pipeline_id}`);
  onLog(`[Explanation] ${pipeline.explanation}`);

  shouldCancelPipeline = false; // Reset cancellation flag
  const steps = pipeline.steps;
  let ip = 0; // Instruction Pointer pointing to step index

  // Loop tracking system for LOOP_START / LOOP_END block structures
  const loopContexts: { [startStepId: number]: { currentIteration: number; maxIterations: number } } = {};

  const findMatchingLoopStart = (endIndex: number): number => {
    let depth = 0;
    for (let i = endIndex - 1; i >= 0; i--) {
      if (steps[i].action === 'LOOP_END') {
        depth++;
      } else if (steps[i].action === 'LOOP_START') {
        if (depth === 0) return i;
        depth--;
      }
    }
    throw new Error(`Syntax Error: Mismatched LOOP_END at step index ${endIndex}`);
  };

  while (ip < steps.length) {
    if (shouldCancelPipeline) {
      onLog('[Pipeline Cancelled] Stopped by user command.');
      break;
    }
    const step = steps[ip];
    onLog(`[Step ${step.step_id}] Executing ${step.action}...`);

    try {
      const loopCount = step.loop?.count || 1;
      let stepIterationsLeft = loopCount;

      // Executing individual step loop (if configured directly on the step)
      while (stepIterationsLeft > 0) {
        let isSuccess = true;

        switch (step.action) {
          case 'LAUNCH_APP': {
            const pkg = step.params.package;
            if (!pkg) throw new Error('LAUNCH_APP requires package parameter');
            onLog(`Launching app: ${pkg}`);
            isSuccess = await AgenticAccessibility.launchApp(pkg);
            break;
          }

          case 'CLICK': {
            const { target_text, target_id } = step.params;
            if (target_id) {
              onLog(`Clicking view by ID: ${target_id}`);
              isSuccess = await AgenticAccessibility.clickId(target_id);
            } else if (target_text) {
              onLog(`Clicking view by Text: ${target_text}`);
              isSuccess = await AgenticAccessibility.clickText(target_text);
            } else {
              throw new Error('CLICK requires target_text or target_id');
            }
            break;
          }

          case 'TYPE': {
            const { target_id, text_content } = step.params;
            if (!text_content) throw new Error('TYPE requires text_content');
            onLog(`Typing text into field: "${text_content}"`);
            isSuccess = await AgenticAccessibility.typeText(target_id || null, text_content);
            break;
          }

          case 'SCROLL': {
            const dir = step.params.direction || 'DOWN';
            onLog(`Scrolling window direction: ${dir}`);
            isSuccess = await AgenticAccessibility.scroll(dir);
            break;
          }

          case 'SWIPE': {
            const { x1, y1, x2, y2, duration_ms } = step.params;
            if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
              throw new Error('SWIPE requires coordinates (x1, y1, x2, y2)');
            }
            const duration = duration_ms || 400;
            onLog(`Swiping from (${x1}, ${y1}) to (${x2}, ${y2}) over ${duration}ms`);
            isSuccess = await AgenticAccessibility.swipe(x1, y1, x2, y2, duration);
            break;
          }

          case 'READ_TEXT': {
            onLog('Reading active window contents...');
            const scrapedText = await AgenticAccessibility.readWindowText();
            onLog(`[Scraped Text] Length: ${scrapedText.length} chars`);
            // Store results in temporary storage to pass between steps
            await AsyncStorage.setItem('@last_scraped_text', scrapedText);
            break;
          }

          case 'WAIT': {
            const duration = step.params.duration_ms || 1000;
            onLog(`Waiting for ${duration}ms...`);
            await new Promise((resolve) => setTimeout(resolve, duration));
            break;
          }

          case 'SPEAK': {
            const text = step.params.text_content;
            if (!text) throw new Error('SPEAK requires text_content');
            onLog(`Speaking: "${text}"`);
            await speakText(text);
            break;
          }

          case 'RECORD_AUDIO': {
            const prompt = step.params.text_content || 'Please speak your response';
            onLog(`Starting voice dialog: "${prompt}"`);
            const voiceResponse = await onRecordVoice(prompt);
            onLog(`User responded: "${voiceResponse}"`);
            // Store verbal response for reference in subsequent actions
            await AsyncStorage.setItem('@last_voice_response', voiceResponse);
            break;
          }

          case 'PHONE_CALL': {
            const phone = step.params.phone_number;
            if (!phone) throw new Error('PHONE_CALL requires phone_number');
            onLog(`Initiating cellular call to: ${phone}`);
            const telUrl = `tel:${phone}`;
            const canOpen = await Linking.canOpenURL(telUrl);
            if (canOpen) {
              await Linking.openURL(telUrl);
            } else {
              throw new Error('Device cannot open cellular phone call layout');
            }
            break;
          }

          case 'LAPTOP_REMINDER': {
            const text = step.params.text_content;
            if (!text) throw new Error('LAPTOP_REMINDER requires text_content');
            onLog(`Storing laptop reminder: "${text}"`);
            const existing = await AsyncStorage.getItem('@laptop_reminders');
            const remindersList = existing ? JSON.parse(existing) : [];
            remindersList.push({
              id: Date.now().toString(),
              text,
              created_at: new Date().toISOString(),
            });
            await AsyncStorage.setItem('@laptop_reminders', JSON.stringify(remindersList));
            break;
          }

          case 'LOOP_START': {
            const max = step.params.loop_count || 1;
            if (!loopContexts[step.step_id]) {
              loopContexts[step.step_id] = { currentIteration: 0, maxIterations: max };
            }
            loopContexts[step.step_id].currentIteration++;
            onLog(`[Loop Start] Step ${step.step_id}: iteration ${loopContexts[step.step_id].currentIteration}/${max}`);
            break;
          }

          case 'LOOP_END': {
            const startIdx = findMatchingLoopStart(ip);
            const startStep = steps[startIdx];
            const context = loopContexts[startStep.step_id];
            
            if (context && context.currentIteration < context.maxIterations) {
              onLog(`[Loop Continue] Jumping back to Step ${startStep.step_id}`);
              ip = startIdx - 1; // Subtract 1 because loop increments ip below
            } else {
              onLog(`[Loop Complete] Done with LOOP_START at Step ${startStep.step_id}`);
              delete loopContexts[startStep.step_id];
            }
            break;
          }

          default:
            throw new Error(`Unsupported pipeline action type: ${step.action}`);
        }

        if (!isSuccess) {
          onLog(`[WARNING] Action ${step.action} reported FAILURE. Continuing...`);
        }

        stepIterationsLeft--;
      }

      ip++; // Move to next instruction step
    } catch (err: any) {
      onLog(`[FATAL ERROR] Step ${step.step_id} failed: ${err.message}`);
      // Break pipeline execution in case of critical error
      await speakText('An error occurred during automation pipeline execution.');
      break;
    }
  }

  onLog('[Pipeline Finished] Execution complete.');
}

/**
 * Helper to execute TTS voice synthesis.
 */
function speakText(text: string): Promise<void> {
  return new Promise((resolve) => {
    Speech.speak(text, {
      onDone: () => {
        ttsState.lastSpeakEndTime = Date.now();
        resolve();
      },
      onError: (err) => {
        console.error('[Speech Error] TTS failure:', err);
        ttsState.lastSpeakEndTime = Date.now();
        resolve();
      },
    });
  });
}
