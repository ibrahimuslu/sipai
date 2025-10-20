# OpenAI Realtime Speech-to-Speech Conversation Flow

## Complete Conversation Lifecycle Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INCOMING CALL RECEIVED                              │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │   handleIncomingCall(call)             │
        │   - Create OpenAI handler instance     │
        │   - Set up call event handlers         │
        │   - Answer call immediately           │
        └────────────────────┬───────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │  Connect to OpenAI (Background, non-blocking)  │
        │  - WebSocket connection established           │
        │  - Session configuration sent                  │
        └────────────────┬───────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │  Call Media Available (media event)         │
        │  - Audio streams ready                     │
        └────────────────┬──────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
    ┌─────────────────┐        ┌─────────────────────────┐
    │ Play Connection │        │ Attach OpenAI to Call   │
    │ Beep (440Hz)    │        │ - Setup audio capture   │
    │ Duration: 400ms │        │ - Create recorder       │
    └─────────────────┘        │ - Create player         │
                               └────────┬────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │ sendInitialGreeting()         │
                        └───────────────┬───────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
                    ▼                                       ▼
        ┌─────────────────────────┐        ┌────────────────────────────┐
        │ Cached Greeting Exists? │        │ No Cached Greeting         │
        │ Check /tmp/...cached.wav│        │ generateNewGreeting()      │
        └───────────┬─────────────┘        └────────────┬───────────────┘
                    │                                    │
        ┌───────────┴────────────┐          ┌───────────┴──────────────┐
        │ YES                     │          │ Send to OpenAI:          │
        │ Play existing greeting  │          │ response.create          │
        │                         │          │ + Instructions for       │
        └─────────┬───────────────┘          │   greeting               │
                  │                          └───────────┬──────────────┘
                  │                                      │
                  └──────────────────┬───────────────────┘
                                     │
                                     ▼
                 ┌───────────────────────────────────┐
                 │ OpenAI Generates Response         │
                 │ response.audio.delta (chunks)     │
                 │ - Audio streamed in real-time     │
                 │ - Converted to WAV                │
                 │ - Played to caller via SIP        │
                 └────────────┬──────────────────────┘
                              │
                              ▼
                 ┌───────────────────────────────┐
                 │ response.done received         │
                 │ - Greeting complete           │
                 │ - Greeting cached for future  │
                 │ - AI ready for conversation   │
                 └────────────┬──────────────────┘
                              │
╔═════════════════════════════╩═══════════════════════════════════════════════╗
║                    NORMAL CONVERSATION STARTS                               ║
╚═════════════════════════════╦═══════════════════════════════════════════════╝
                              │
                              ▼
        ┌────────────────────────────────────────────────┐
        │ CALLER SPEAKS                                   │
        │ Audio captured from SIP call                    │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ input_audio_buffer.speech_started              │
        │ - VAD detects voice activity                   │
        │ - Threshold: 0.5                               │
        │ - Prefix padding: 300ms                        │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ setupAudioCapture() Monitoring Loop (100ms)    │
        │ - Read new data from /tmp/caller_audio_*.wav   │
        │ - Extract PCM data (skip 44-byte header)       │
        │ - Convert to Base64                            │
        │ - Send via input_audio_buffer.append           │
        └────────────────────┬─────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
        ┌──────────────────┐  ┌──────────────────┐
        │ Audio Chunks     │  │ Chunks Continue  │
        │ Streamed         │  │ Every 100ms      │
        │ input_audio_     │  │ Until Silence    │
        │ buffer.append    │  │ Detected         │
        └──────────────────┘  └──────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ input_audio_buffer.speech_stopped              │
        │ - Silence detected                             │
        │ - Duration: 1000ms (1 second)                  │
        │ - VAD determines user finished speaking        │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ commitAudioBuffer()  ⭐ CRITICAL               │
        │ - Send input_audio_buffer.commit               │
        │ - Signal: "User input complete"                │
        │ - Enable turn-taking                           │
        │ - Trigger OpenAI processing                    │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ OpenAI Processing (Server-side)                │
        │ - Transcribe audio (Whisper-1)                 │
        │ - Understand intent                            │
        │ - Generate response                            │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ response.created event                         │
        │ - OpenAI starting to generate response         │
        │ - Modalities: text & audio                     │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ response.audio.delta (Stream of Chunks)        │
        │ - Real-time audio streaming                    │
        │ - Base64 encoded PCM16 data                    │
        │ - Multiple deltas per response                 │
        └────────────────────┬─────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
        ┌──────────────────┐  ┌──────────────────┐
        │ Each Delta:      │  │ playAudioToSIP() │
        │ 1. Decode B64    │  │ 1. Create WAV    │
        │ 2. Add WAV       │  │    header        │
        │    header        │  │ 2. Write temp    │
        │ 3. Write temp    │  │    file          │
        │    file to /tmp  │  │ 3. Create player │
        │ 4. Create player │  │ 4. Play to SIP   │
        │ 5. Play to SIP   │  │    media stream  │
        └──────────────────┘  └──────────────────┘
                    │                 │
                    └────────┬────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ CALLER HEARS AI RESPONSE (Real-time)           │
        │ - Audio plays immediately as chunks arrive     │
        │ - No waiting for complete response             │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ response.audio.done                            │
        │ - All audio chunks sent                        │
        │ - Response playback may still be ongoing       │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │ response.done                                  │
        │ - Response complete                           │
        │ - Ready for next turn                          │
        │ - Back to listening for caller                 │
        └────────────────────┬─────────────────────────┘
                             │
                             ▼
                ┌───────────────────────────────┐
                │ LOOP BACK to:                 │
                │ - input_audio_buffer.        │
                │   speech_started/stopped     │
                │ - Continuous conversation    │
                └───────────────────────────────┘
```

---

## Detailed Flow Breakdown

### Phase 1: Call Setup (0-2 seconds)

```
SIP Call Arrives
      │
      ├─► handleIncomingCall()
      │   ├─► Answer call immediately
      │   └─► Connect to OpenAI (async)
      │
      └─► setupCallHandlers()
          ├─► Listen for state changes
          ├─► Listen for media availability
          └─► Listen for DTMF digits

          Media Available
          ├─► Play connection beep (440Hz, 400ms)
          └─► connectAIToCall()
              ├─► Create recorder
              ├─► Setup audio capture monitoring
              └─► Create audio player
```

### Phase 2: Initial Greeting (2-5 seconds)

```
attachToCall()
    │
    ├─► playConnectionBeep() [400ms]
    │
    └─► sendInitialGreeting() [500ms delay]
        │
        ├─► Check cache: /tmp/ai_greeting_cached.wav
        │   │
        │   ├─► EXISTS: playExistingGreeting()
        │   │   └─► Play cached greeting [~3 seconds]
        │   │
        │   └─► NOT EXISTS: generateNewGreeting()
        │       │
        │       └─► response.create
        │           {
        │             type: 'response.create',
        │             response: {
        │               modalities: ['text', 'audio'],
        │               instructions: 'Greet...',
        │               voice: 'alloy'
        │             }
        │           }
        │
        └─► Receive response.audio.delta chunks
            └─► playAudioToSIP() for each chunk
                └─► Cache audio for future use
```

### Phase 3: Turn-Taking Loop (5+ seconds)

```
LISTENER STATE
├─► input_audio_buffer.speech_started
│   └─► Console: "🎤 User started speaking"
│
└─► SPEAKING STATE
    ├─► VAD Active: collecting audio
    ├─► setupAudioCapture() runs every 100ms
    │   ├─► Check /tmp/caller_audio_*.wav for new data
    │   ├─► Extract PCM16 (skip 44-byte header)
    │   ├─► Base64 encode
    │   └─► Send input_audio_buffer.append
    │
    └─► input_audio_buffer.speech_stopped
        └─► commitAudioBuffer()
            │
            └─► input_audio_buffer.commit sent
                │
                └─► OpenAI Processing
                    ├─► Transcribe: Whisper-1
                    ├─► Understand: Intent processing
                    ├─► Generate: Response creation
                    │
                    └─► Respond with audio
                        └─► response.audio.delta (stream)
                            ├─► Decode Base64
                            ├─► Create WAV
                            └─► Play to SIP
                                │
                                └─► response.done
                                    └─► BACK TO LISTENER STATE
```

---

## Message Sequence Diagram

```
Caller              SIP Stack         App Handler          OpenAI API
  │                   │                   │                    │
  │─── Call Incoming ─→│                   │                    │
  │                   │─── call event ────→│                    │
  │                   │                   │─── WebSocket ──────→│
  │                   │                   │← (connection)       │
  │                   │                   │                    │
  │ ◄─ Beep ────────── ◄─ Audio Play ─────│                    │
  │                   │                   │                    │
  │                   │                   │← greeting.create ──│
  │ ◄─ Greeting Audio ◄─ Audio Stream ────│← audio.delta ──────│
  │                   │                   │                    │
  │─── User Speaks ──→│                   │                    │
  │                   │─ Record Audio ────→│                    │
  │                   │                   │─ audio.append ────→│
  │                   │                   │─ audio.append ────→│
  │                   │                   │─ audio.append ────→│
  │                   │                   │                    │
  │ (silence detected)│                   │                    │
  │                   │                   │─ audio.commit ────→│
  │                   │                   │                    │
  │                   │                   │← response.create ──│
  │                   │                   │← audio.delta ──────│
  │ ◄─ Response ────── ◄─ Audio Play ─────│← audio.delta ──────│
  │                   │                   │← audio.done ───────│
  │                   │                   │← response.done ────│
  │                   │                   │                    │
  │                   │                   │ (back to listening)│
  │─── User Speaks ──→│                   │                    │
  │                   │ (repeat loop...)  │                    │
  │                   │                   │                    │
  │─── Hang Up ──────→│                   │                    │
  │                   │─ disconnect ─────→│─── close ─────────→│
```

---

## State Machine Diagram

```
┌─────────────────┐
│  CALL_RECEIVED  │
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│   ANSWERING_CALL     │
│  - Create handler    │
│  - Setup handlers    │
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ CONNECTING_OPENAI    │
│  - WebSocket init    │
│  - Session update    │
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│   MEDIA_READY        │
│  - Play beep         │
│  - Attach recorder   │
│  - Attach player     │
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ SENDING_GREETING     │
│  - Generate/cache    │
│  - Stream audio      │
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│  LISTENING           │◄─────────────────────┐
│ (VAD enabled)        │                      │
│ Waiting for speech   │                      │
└────────┬─────────────┘                      │
         │                                    │
         │ speech_started                     │
         ▼                                    │
┌──────────────────────┐                      │
│  RECORDING_AUDIO     │                      │
│ Streaming to OpenAI  │                      │
└────────┬─────────────┘                      │
         │                                    │
         │ speech_stopped                     │
         ▼                                    │
┌──────────────────────┐                      │
│ COMMITTING_INPUT     │                      │
│ Finalize user input  │                      │
└────────┬─────────────┘                      │
         │                                    │
         ▼                                    │
┌──────────────────────┐                      │
│   PROCESSING         │                      │
│ OpenAI generating    │                      │
│ response             │                      │
└────────┬─────────────┘                      │
         │                                    │
         ▼                                    │
┌──────────────────────┐                      │
│ STREAMING_RESPONSE   │                      │
│ Audio deltas arriving│                      │
│ Playing to caller    │                      │
└────────┬─────────────┘                      │
         │                                    │
         │ response.done                      │
         └────────────────────────────────────┘
```

---

## Key Timing Diagram

```
Timeline (seconds):
0────┬────1────┬────2────┬────3────┬────4────┬────5────┬────6────┬────7──►
     │         │         │         │         │         │         │
  [Call]      [WS Conn]  [Beep]   [Greeting Start]   [Greeting] [Ready]
     │         │         │         │         │    [Play Audio]   │
     │         │         │         │         │         │         │
  Call         OpenAI    Media    Greeting  Audio      Stream    Listening
  Received    Connected  Ready    Generated Deltas    Complete   Start
     │         │         │         │         │         │         │
  Delay:       100ms     500ms     ~500ms    ~2s      ~3s       Total: 5-7s
    0ms
```

---

## Critical Points

### ⭐ Audio Buffer Commitment
The **`input_audio_buffer.commit`** message is critical:
- **When**: After `speech_stopped` VAD event
- **Why**: Signals to OpenAI that user has finished speaking
- **Without it**: Response would be delayed or not generated
- **Impact**: Enables proper turn-taking

### ⭐ Audio Chunk Streaming
The **100ms monitoring interval** is important:
- Balances real-time responsiveness with CPU usage
- Ensures smooth streaming to OpenAI
- Allows VAD to detect natural speech pauses

### ⭐ Greeting Caching
Caching greeting saves resources:
- First call: ~3 seconds to generate greeting
- Subsequent calls: ~100ms to play cached greeting
- Improves user experience on repeated calls

---

## Event Handler Flow

```
handleOpenAIMessage(message)
  │
  ├─► message.type
  │   │
  │   ├─► 'session.created'
  │   │   └─► Session ready
  │   │
  │   ├─► 'session.updated'
  │   │   └─► Configuration applied
  │   │
  │   ├─► 'response.audio.delta'
  │   │   └─► playAudioToSIP()
  │   │       ├─► Decode Base64
  │   │       ├─► Create WAV
  │   │       └─► Play to caller
  │   │
  │   ├─► 'input_audio_buffer.speech_started'
  │   │   └─► User began speaking
  │   │
  │   ├─► 'input_audio_buffer.speech_stopped'
  │   │   └─► commitAudioBuffer()
  │   │       └─► Send commit message
  │   │
  │   ├─► 'response.created'
  │   │   └─► OpenAI preparing response
  │   │
  │   ├─► 'response.done'
  │   │   └─► Response complete
  │   │       ├─► Check if greeting
  │   │       └─► Cache if needed
  │   │
  │   └─► 'error'
  │       └─► Log error
```

