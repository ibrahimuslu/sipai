# OpenAI Integration - Visual Guide

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    TURKISH SIP PHONE SYSTEM                     │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  SIP Caller      │
│  📞 User dials   │
└────────┬─────────┘
         │
         ↓
┌─────────────────────────────────────────────────────────────────┐
│              [SIP Server - app.js]                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Call Management Layer                                   │  │
│  │  ✓ Accept incoming calls                                │  │
│  │  ✓ Answer calls                                         │  │
│  │  ✓ Track call state                                     │  │
│  │  ✓ Manage media streams                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                       │
│                         ↓                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Audio Playback                                          │  │
│  │  ▶️  sample.wav (12.0 seconds)                           │  │
│  │  ▶️  beethoven.wav (7.5 seconds)                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                       │
│                         ↓                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Audio Recording                                         │  │
│  │  🎙️  Record caller input                                │  │
│  │  📁  Save to /tmp/caller_*.wav                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                       │
│                         ↓                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Conversation Loop (Repeats until call ends)            │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  1. TRANSCRIBE                                    │ │  │
│  │  │  🎤 Caller audio → Turkish text                  │ │  │
│  │  │  (Whisper API)                                    │ │  │
│  │  └──────────┬─────────────────────────────────────────┘ │  │
│  │             ↓                                             │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  2. PROCESS                                       │ │  │
│  │  │  💬 Generate response with context                │ │  │
│  │  │  (GPT-4 mini)                                     │ │  │
│  │  │  📚 Maintain conversation history                 │ │  │
│  │  └──────────┬─────────────────────────────────────────┘ │  │
│  │             ↓                                             │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  3. SYNTHESIZE                                    │ │  │
│  │  │  🎵 Response text → Audio (TTS)                   │ │  │
│  │  │  (Text-to-Speech API)                             │ │  │
│  │  └──────────┬─────────────────────────────────────────┘ │  │
│  │             ↓                                             │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  4. PLAY                                          │ │  │
│  │  │  🔊 Play response to caller                       │ │  │
│  │  │  📡 Transmit via SIP media stream                 │ │  │
│  │  └──────────┬─────────────────────────────────────────┘ │  │
│  │             ↓                                             │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  5. LISTEN                                        │ │  │
│  │  │  👂 Wait for next caller input (10s)              │ │  │
│  │  │  🔄 Loop back to step 1                           │ │  │
│  │  └──────────┬─────────────────────────────────────────┘ │  │
│  │             ↓ (repeat)                                   │  │
│  │          [LOOP]                                          │  │
│  │                                                           │  │
│  │  When call ends:                                         │  │
│  │  ✓ Stop listening                                       │  │
│  │  ✓ Close media streams                                 │  │
│  │  ✓ Stop recording                                      │  │
│  │  ✓ Log conversation summary                            │  │
│  │  ✓ Cleanup temp files                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │
         ↓
   Call Ends (DISCONNECTED)
   📊 Summary logged to console
```

## Data Flow - Single Exchange

```
Caller: "Merhaba, ben Ahmet"
    │
    ↓ (transmitted via SIP RTP)
┌──────────────────────┐
│ SIP Media Stream     │
│ (Audio Data)         │
└──────────┬───────────┘
           │
           ↓
    ┌─────────────────┐
    │ RECORD          │
    │ Save to WAV file│
    └────────┬────────┘
             │
             ↓
   /tmp/caller_[ID].wav
   (45.2 KB audio file)
             │
             ↓
    ┌─────────────────────────────────────────┐
    │ openai-handler.js                       │
    │ transcribeAudio(audioBuffer)            │
    └────────┬────────────────────────────────┘
             │
             ↓ (HTTP POST to OpenAI)
    ┌─────────────────────────────────────────┐
    │ OpenAI Whisper API                      │
    │ /v1/audio/transcriptions                │
    └────────┬────────────────────────────────┘
             │
             ↓
    "Merhaba, ben Ahmet"
    (Turkish text)
             │
             ↓
    ┌─────────────────────────────────────────┐
    │ openai-handler.js                       │
    │ getAIResponse(text, history)            │
    │ - Add to conversationHistory            │
    │ - Send to ChatGPT with context          │
    └────────┬────────────────────────────────┘
             │
             ↓ (HTTP POST to OpenAI)
    ┌─────────────────────────────────────────┐
    │ OpenAI ChatGPT API                      │
    │ /v1/chat/completions                    │
    │ model: gpt-4o-mini                      │
    └────────┬────────────────────────────────┘
             │
             ↓
    "Merhaba Ahmet! Size nasıl yardımcı
     olabilirim?"
    (AI Response in Turkish)
             │
             ↓
    ┌─────────────────────────────────────────┐
    │ openai-handler.js                       │
    │ textToSpeech(response, 'nova')          │
    │ - Convert text to natural speech        │
    └────────┬────────────────────────────────┘
             │
             ↓ (HTTP POST to OpenAI)
    ┌─────────────────────────────────────────┐
    │ OpenAI Text-to-Speech API               │
    │ /v1/audio/speech                        │
    │ voice: nova                             │
    └────────┬────────────────────────────────┘
             │
             ↓
   /tmp/tts_[ID].wav
   (MP3 converted to WAV)
             │
             ↓
    ┌─────────────────────────────────────────┐
    │ app.js                                  │
    │ CREATE PLAYER                           │
    │ player = sip.createPlayer(audioPath)    │
    └────────┬────────────────────────────────┘
             │
             ↓
    ┌─────────────────────────────────────────┐
    │ app.js                                  │
    │ START TRANSMISSION                      │
    │ player.startTransmitTo(mediaStream)     │
    └────────┬────────────────────────────────┘
             │
             ↓ (Audio frames via RTP)
    ┌──────────────────────────────────────────┐
    │ SIP Media Stream (Response)              │
    │ Audio transmitted to caller              │
    └──────────┬───────────────────────────────┘
              │
              ↓
         Caller hears:
    "Merhaba Ahmet! Size nasıl yardımcı
     olabilirim?"
```

## Conversation History Example

```javascript
// Initial state
conversationHistory = [];

// After first exchange
conversationHistory = [
  {
    role: 'user',
    content: 'Merhaba, ben Ahmet'
  },
  {
    role: 'assistant',
    content: 'Merhaba Ahmet! Size nasıl yardımcı olabilirim?'
  }
];

// After second exchange
conversationHistory = [
  {
    role: 'user',
    content: 'Merhaba, ben Ahmet'
  },
  {
    role: 'assistant',
    content: 'Merhaba Ahmet! Size nasıl yardımcı olabilirim?'
  },
  {
    role: 'user',
    content: 'Bugünün tarihi kaç?'
  },
  {
    role: 'assistant',
    content: 'Bugün 17 Ekim 2025'
  }
];

// Sent to ChatGPT API to maintain context:
{
  role: 'system',
  content: 'You are a helpful Turkish-speaking AI assistant...'
},
{
  role: 'user',
  content: 'Merhaba, ben Ahmet'
},
{
  role: 'assistant',
  content: 'Merhaba Ahmet! Size nasıl yardımcı olabilirim?'
},
{
  role: 'user',
  content: 'Bugünün tarihi kaç?'  ← ChatGPT sees context
},
// ChatGPT generates response based on full history
```

## Call State Machine

```
┌─────────────┐
│   START     │
└──────┬──────┘
       │
       ↓
┌──────────────────┐     Incoming call
│   LISTENING      │◄────────received
│   (ringing)      │
└──────┬───────────┘
       │ Answer
       ↓
┌──────────────────┐
│   CONFIRMING     │     Call answered,
│   (early media)  │     media negotiating
└──────┬───────────┘
       │ Media available
       ↓
┌──────────────────┐
│   CONFIRMED      │     ▶️  Play greeting
│   (active call)  │     🎙️ Record caller
└──────┬───────────┘
       │             
       ├─────────────────────────────┐
       │                             │
       ↓                             ↓
   LOOP: LISTEN              (every 10 seconds)
   Record input ──────→ Transcribe → Process → Speak
       ↑                           │
       └──────────────────────────┘
       
       (Until caller hangs up)
       │
       ↓
┌──────────────────┐
│  DISCONNECTING   │     Stop processes,
└──────┬───────────┘     cleanup resources
       │
       ↓
┌──────────────────┐
│ DISCONNECTED     │     Log conversation,
│  (call ended)    │     delete temp files
└──────┬───────────┘
       │
       ↓
    [END]
```

## File Organization

```
openai-handler.js (217 lines)
│
├─ initializeRealtimeSession()
│  └─ Returns: { isActive, conversationHistory }
│
├─ transcribeAudio(audioBuffer)
│  ├─ Write to temp file
│  ├─ Call Whisper API
│  └─ Returns: Turkish text
│
├─ getAIResponse(message, history)
│  ├─ Add message to history
│  ├─ Call ChatGPT API
│  ├─ Update history with response
│  └─ Returns: AI response text
│
├─ textToSpeech(text, voice)
│  ├─ Call TTS API
│  ├─ Convert response to buffer
│  ├─ Save to temp file
│  └─ Returns: audio file path
│
├─ processUserAudio(buffer, history)
│  ├─ Transcribe
│  ├─ Get AI response
│  ├─ Text to speech
│  └─ Returns: { userMessage, aiResponse, audioPath }
│
└─ cleanupAudioFile(path)
   └─ Delete temp file
```

## Timeline of a 10-Second Call

```
0s   │ Incoming call received
     │ ✅ Call answered
     ├─ ▶️  sample.wav starts (12s audio file)
     │
12s  │ sample.wav ends
     ├─ ▶️  beethoven.wav starts (7.5s audio file)
     │
19.5s│ beethoven.wav ends
     │ 🎤 "Please speak now"
     │
29.5s│ ⏱️  Timeout - Stop listening
     │ 📊 Audio recorded: 45.2 KB
     │ 🎤 Transcribing... (1-2s)
     │
31s  │ 📝 "Merhaba, ben Ahmet"
     │ 💬 Generating response... (1s)
     │
32s  │ 🤖 "Merhaba Ahmet! Size nasıl yardımcı olabilirim?"
     │ 🎵 Converting to speech... (1-2s)
     │
34s  │ ✅ TTS complete (/tmp/tts_12345.wav)
     │ 🔊 Playing response (3.5s)
     │
37.5s│ Response finished
     │ 🎤 Listening again... (another 10s)
     │
47.5s│ Caller hangs up
     │ 🧹 Cleanup
     │ 💬 Log conversation:
     │    1. 👤 User: "Merhaba, ben Ahmet"
     │    2. 🤖 AI: "Merhaba Ahmet..."
     │
48s  │ [CALL END]
```

## Cost Per Call Example

```
5-minute call with 3 exchanges:

Exchange 1:
├─ Transcription (Whisper)     : $0.02  [2 × 15s round up]
├─ Chat completion (GPT-4m)    : $0.0001 [~100 tokens]
└─ TTS (120 characters)        : $0.0036 [$0.030/1K × 120]
   Subtotal: $0.0237

Exchange 2:
├─ Transcription               : $0.02
├─ Chat completion             : $0.0001
└─ TTS (100 characters)        : $0.003
   Subtotal: $0.0231

Exchange 3:
├─ Transcription               : $0.02
├─ Chat completion             : $0.0001
└─ TTS (90 characters)         : $0.0027
   Subtotal: $0.0228

TOTAL FOR CALL: $0.0696 ≈ $0.07

Annual cost (100 calls/day):
365 × 100 × $0.07 = $2,555/year
```

## Component Interaction

```
┌────────────────┐
│  SIP Calls     │
│  (sipstel)     │
└────────┬───────┘
         │ Audio RTP streams
         │
    ┌────▼──────────────────────┐
    │  app.js                    │ 
    │  ├─ Accept calls           │
    │  ├─ Play greeting          │
    │  ├─ Record audio           │
    │  └─ Loop handler           │
    └────┬──────────────────────┬┘
         │                      │
         │                  Temp files
         │                /tmp/caller_*
         │
    ┌────▼──────────────────────┐
    │ openai-handler.js         │     ┌─────────────────┐
    │ ├─ transcribeAudio()      │────→│ Whisper API     │
    │ ├─ getAIResponse()        │────→│ ChatGPT API     │
    │ ├─ textToSpeech()         │────→│ TTS API         │
    │ └─ processUserAudio()     │     └─────────────────┘
    └──────────────────────────┘ (over HTTPS)
```

---

This visual guide shows how all components work together to create an interactive Turkish-language phone system! 🎉
