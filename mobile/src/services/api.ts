/**
 * API client to interact with the FastAPI backend.
 */

// Replace with your Vercel URL or local development IP
const BACKEND_URL = 'https://personal-assistant-iota-blush.vercel.app';

export interface ActionStep {
  step_id: number;
  action:
    | 'LAUNCH_APP'
    | 'CLICK'
    | 'TYPE'
    | 'SCROLL'
    | 'SWIPE'
    | 'READ_TEXT'
    | 'WAIT'
    | 'SPEAK'
    | 'RECORD_AUDIO'
    | 'PHONE_CALL'
    | 'LAPTOP_REMINDER';
  params: {
    package?: string;
    target_text?: string;
    target_id?: string;
    text_content?: string;
    direction?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
    duration_ms?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    phone_number?: string;
  };
  loop?: {
    count: number;
    break_on_condition?: string;
  };
}

export interface AutomationPipeline {
  pipeline_id: string;
  explanation: string;
  steps: ActionStep[];
}

export interface ProcessContext {
  active_package?: string;
  clipboard_content?: string;
  timestamp?: string;
  [key: string]: any;
}

export async function processTranscript(
  transcript: string,
  context: ProcessContext = {}
): Promise<AutomationPipeline> {
  const endpoint = `${BACKEND_URL}/api/v1/assistant/process`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript,
        context,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}: ${response.statusText}`);
    }

    const data: AutomationPipeline = await response.json();
    return data;
  } catch (error) {
    console.error('[API Error] failed to process voice transcript:', error);
    // Return a local fallback pipeline in case of connection failure
    return {
      pipeline_id: 'local-fallback-' + Date.now(),
      explanation: 'Failed to connect to backend. Speaking notification.',
      steps: [
        {
          step_id: 1,
          action: 'SPEAK',
          params: {
            text_content: 'Network connection failed. I was unable to connect to the backend server.',
          },
        },
      ],
    };
  }
}
