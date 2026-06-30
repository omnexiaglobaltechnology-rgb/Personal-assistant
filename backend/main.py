import os
import uuid
from typing import List, Optional
from enum import Enum
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load local environment variables
load_dotenv()

app = FastAPI(
    title="Agentic Voice Assistant Backend",
    version="1.0.0",
    description="FastAPI service powered by Gemini 1.5 Flash for translating voice transcripts to UI automation pipelines."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Gemini Client
# By default, genai.Client() looks for GEMINI_API_KEY env var
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    # If not set, we still initialize, but it will raise an error if not found in environment
    print("[WARNING] GEMINI_API_KEY environment variable is not set!")

client = genai.Client(api_key=api_key)

class ActionType(str, Enum):
    LAUNCH_APP = "LAUNCH_APP"
    CLICK = "CLICK"
    TYPE = "TYPE"
    SCROLL = "SCROLL"
    SWIPE = "SWIPE"
    READ_TEXT = "READ_TEXT"
    WAIT = "WAIT"
    SPEAK = "SPEAK"
    RECORD_AUDIO = "RECORD_AUDIO"
    PHONE_CALL = "PHONE_CALL"
    LAPTOP_REMINDER = "LAPTOP_REMINDER"
    LOOP_START = "LOOP_START"
    LOOP_END = "LOOP_END"

class StepParams(BaseModel):
    package: Optional[str] = Field(None, description="App package name (e.g. 'com.whatsapp', 'com.whatsapp.w4b', 'com.instagram.android')")
    target_text: Optional[str] = Field(None, description="UI Element text label to click or focus on")
    target_id: Optional[str] = Field(None, description="Android Resource ID of the target view element")
    text_content: Optional[str] = Field(None, description="Text to type, speak, or store in reminders")
    direction: Optional[str] = Field(None, description="Scroll direction: UP, DOWN, LEFT, RIGHT")
    duration_ms: Optional[int] = Field(None, description="Duration in milliseconds for swipes or waits")
    x1: Optional[int] = Field(None, description="Start X coordinate for swipe")
    y1: Optional[int] = Field(None, description="Start Y coordinate for swipe")
    x2: Optional[int] = Field(None, description="End X coordinate for swipe")
    y2: Optional[int] = Field(None, description="End Y coordinate for swipe")
    phone_number: Optional[str] = Field(None, description="Phone number for direct cellular dial")
    loop_count: Optional[int] = Field(None, description="Number of times to loop the block for LOOP_START")

class LoopConfig(BaseModel):
    count: int = Field(1, description="Number of times to loop the specified step")
    break_on_condition: Optional[str] = Field(None, description="Description of condition to break the loop (e.g. 'no more messages found')")

class PipelineStep(BaseModel):
    step_id: int = Field(..., description="1-indexed sequence order of the step")
    action: ActionType = Field(..., description="Action to perform")
    params: StepParams = Field(default_factory=StepParams, description="Parameters for the action")
    loop: Optional[LoopConfig] = Field(None, description="Loop constraints if this single action is repeated")

class AutomationPipeline(BaseModel):
    pipeline_id: str = Field(..., description="Unique UUID for tracking the session")
    explanation: str = Field(..., description="Brief summary of what this plan will execute in order to inform the user")
    steps: List[PipelineStep] = Field(..., description="List of sequential steps to execute")

class ProcessRequest(BaseModel):
    transcript: str = Field(..., description="Raw voice transcript captured on the device")
    context: Optional[dict] = Field(None, description="Additional device context: active package, clipboard content, contact names, etc.")

SYSTEM_INSTRUCTION = """You are an Agentic OS Automation Planner for an Android Assistant. 
Your task is to translate raw, chaotic voice commands into a sequence of structured actions (a pipeline) that can be run on the client device.
These actions are executed by the React Native client-side runner and a custom Android Accessibility Service.

Supported Actions:
1. LAUNCH_APP: Opens a package. Params: `package` (e.g. 'com.whatsapp', 'com.whatsapp.w4b', 'com.instagram.android').
2. CLICK: Performs a click. Params: `target_text` (button/node label) or `target_id` (resource id).
3. TYPE: Focuses and inputs text. Params: `target_id` or `target_text` and `text_content`.
4. SCROLL: Scrolls the screen. Params: `direction` ('UP', 'DOWN').
5. SWIPE: Performs custom gesture swipe. Params: `x1`, `y1`, `x2`, `y2`, `duration_ms`.
6. READ_TEXT: Scrapes the text of the current active window/chat. Params: `target_id` (e.g. chat container view id) or leaving target parameters null to extract all window text.
7. WAIT: Pauses execution. Params: `duration_ms` (e.g., waiting for screen transitions).
8. SPEAK: Uses TTS to speak to the user. Params: `text_content`.
9. RECORD_AUDIO: Prompts the user verbally and starts continuous listening. Params: `text_content`. Use this for interactive feedback (e.g. 'Should I reply to this?').
10. PHONE_CALL: Triggers a native cellular call. Params: `phone_number`.
11. LAPTOP_REMINDER: Creates a reminder stored to fire on their laptop. Params: `text_content`.
12. LOOP_START: Starts a block of multiple steps that will be looped. Params: `loop_count` (the number of iterations).
13. LOOP_END: Ends the block of looped steps. Jumps back to the matching LOOP_START until loop_count is satisfied.

Rules:
- You support multi-tasking. If a user asks to do multiple things (e.g., "call XYZ and set a reminder to email him"), output them in sequence inside the same pipeline.
- You support loops. If a single action is repeated, use the `loop` attribute. If a sequence of multiple steps is repeated (e.g., 'download 100 videos from instagram and upload to XYZ' where you scroll, copy link, open XYZ, upload, then repeat), enclose the sequence between a LOOP_START step (with `loop_count`) and a LOOP_END step.
- For WhatsApp Business, use the package `com.whatsapp.w4b`. For personal WhatsApp, use `com.whatsapp`.
- For reading messages: LAUNCH_APP -> CLICK (the contact name) -> WAIT -> READ_TEXT -> SPEAK (to read the text back to the user) -> RECORD_AUDIO (to ask if they want to reply).
- If the phone number is missing, first use LAUNCH_APP -> CLICK (search icon) -> TYPE (contact name) -> CLICK (first result) to open the chat window.
- When generating gestures, assume standard screen coordinate bounds (e.g. 1080x2400). A down scroll swipe can go from (540, 1800) to (540, 600) with a 400ms duration.
- Write a clear, short user-facing explanation of what you are doing in the `explanation` field.
"""
def get_flat_json_schema(model_class):
    schema = model_class.model_json_schema()
    defs = schema.pop("$defs", {})
    
    def resolve_refs(node):
        if isinstance(node, dict):
            node.pop("title", None)
            node.pop("default", None)
            
            if "anyOf" in node:
                any_of_list = node.pop("anyOf")
                non_null_type = next((item for item in any_of_list if item.get("type") != "null"), None)
                if non_null_type:
                    node.update(resolve_refs(non_null_type))
                    
            if "$ref" in node:
                ref_path = node["$ref"]
                ref_name = ref_path.split("/")[-1]
                ref_schema = defs[ref_name]
                return resolve_refs(ref_schema)
            else:
                return {k: resolve_refs(v) for k, v in node.items()}
        elif isinstance(node, list):
            return [resolve_refs(item) for item in node]
        else:
            return node
            
    return resolve_refs(schema)

@app.post("/api/v1/assistant/process", response_model=AutomationPipeline)
async def process_transcript(payload: ProcessRequest):
    try:
        # Construct the user message context
        user_message = f"Transcript: {payload.transcript}"
        if payload.context:
            user_message += f"\nDevice Context: {payload.context}"

        # Request Gemini with structured schema enforcing Pydantic model
        flat_schema = get_flat_json_schema(AutomationPipeline)
        response = client.models.generate_content(
            model='gemini-1.5-flash',
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=flat_schema,
                temperature=0.1  # Low temperature for deterministic planning
            )
        )
        
        # Parse the JSON response
        # Gemini with response_schema automatically validates against the schema, but we double-check
        pipeline_json = response.text
        pipeline = AutomationPipeline.model_validate_json(pipeline_json)
        return pipeline

    except Exception as e:
        error_msg = f"Exception: {str(e)}"
        print(f"Error processing transcript: {error_msg}")
        fallback_id = str(uuid.uuid4())
        return AutomationPipeline(
            pipeline_id=fallback_id,
            explanation=error_msg,
            steps=[
                PipelineStep(
                    step_id=1,
                    action=ActionType.SPEAK,
                    params=StepParams(text_content=f"Sorry, I had trouble processing that command. {error_msg}")
                )
            ]
        )

@app.get("/health")
async def health_check():
    return {"status": "healthy", "model": "gemini-1.5-flash"}
