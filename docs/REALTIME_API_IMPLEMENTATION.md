# OpenAI Realtime API Integration

## Overview

This implementation uses OpenAI's **Realtime API** for true bidirectional, real-time speech-to-speech conversations over the phone line.

**Key Difference from Previous Approach:**
- ❌ Old: Separate transcribe → process → TTS (3-5s latency)
- ✅ New: Realtime WebSocket streaming (true real-time)

**Reference:** https://platform.openai.com/docs/guides/realtime-conversations

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│          REALTIME SPEECH-TO-SPEECH SYSTEM              │
└─────────────────────────────────────────────────────────┘

┌──────────────┐
│  SIP Caller  │
│  📞 Speaking │
└──────┬───────┘
       │ Voice (RTP Audio)
       ↓
┌─────────────────────────────────────┐
│  SIP Media Stream (app.js)          │
│  ├─ Accept audio from caller        │
│  ├─ Convert PCM to 24kHz encoding   │
│  └─ Send to Realtime API            │
└──────┬──────────────────────────────┘
       │ Audio frames (WebSocket)
       ↓
┌─────────────────────────────────────┐
│  OpenAI Realtime API (WebSocket)    │
│  wss://api.openai.com/v1/realtime   │
│                                     │
│  ├─ input_audio_buffer.append       │ ← Receive caller audio
│  ├─ Automatic speech recognition    │ ← Whisper (built-in)
│  ├─ Language processing             │ ← GPT-4 Realtime
│  └─ response.audio.delta            │ ← Stream audio back
└──────┬──────────────────────────────┘
       │ Audio delta chunks (WebSocket)
       ↓
┌─────────────────────────────────────┐
│  Convert Audio Back to PCM          │
│  Play via SIP Media Stream          │
└──────┬──────────────────────────────┘
       │ Voice (RTP Audio)
       ↓
┌──────────────┐
│  SIP Caller  │
│  👂 Hearing  │
└──────────────┘
```

## Files

### realtime-handler.js (New)
Manages WebSocket connection to OpenAI Realtime API.

**Key Methods:**
- `connect()` - Establish WebSocket connection
- `sendSessionUpdate()` - Configure session parameters
- `sendAudio(buffer)` - Send caller audio to API
- `commitAudioBuffer()` - Signal audio ready for processing
- `sendTextMessage(text)` - Send text input (alternative to audio)
- `disconnect()` - Close connection
- `start(mediaStream, session)` - Initialize real-time conversation

**Events Emitted:**
- `session_created` - Session initialized
- `session_updated` - Settings applied
- `response_started` - AI starting response
- `audio_delta` - Audio chunk to play
- `text_delta` - Text being generated
- `speech_started` - Caller started speaking
- `speech_stopped` - Caller stopped speaking
- `response_done` - Response complete
- `api_error` - Error occurred

### app.js (Modified)
- Removed: `startAudioPlayback()` (old sequential file playback)
- Removed: `handleCallerInput()` (old request-response loop)
- Added: `startGreetingAndRealtime()` - Play greeting, then start Realtime
- Added: `initializeRealtimeConversation()` - Connect to Realtime API
- Added: `realtimeHandler` to session object

## How It Works

### 1. Call Received
```
SIP Caller dials → SIP Server accepts → Session created
```

### 2. Greeting Played
```
startGreetingAndRealtime() → Play greeting.wav → Wait for completion
```

### 3. Realtime Connected
```
initializeRealtimeConversation() 
  → new RealtimeHandler(apiKey)
  → Connect to WebSocket
  → Send session.update with configuration
  → Ready for audio streaming
```

### 4. Audio Streaming (Bidirectional)
```
┌─ Caller speaks
│
├─→ SIP media captures audio (PCM16)
│
├─→ realtime-handler.js: sendAudio(buffer)
│   - Convert to base64
│   - Send via input_audio_buffer.append
│
├─→ OpenAI Realtime processes in real-time
│   - Speech recognition (Whisper)
│   - Language understanding (GPT-4)
│   - Response generation
│   - Audio synthesis (TTS)
│
└─→ OpenAI sends back response.audio.delta
    - Audio chunks streamed back
    - realtime-handler emits audio_delta
    - Audio immediately played to caller
```

### 5. Conversation Continues
```
Loop: Send audio → Receive response → Play response → Send next audio
```

### 6. Call Ends
```
Caller hangs up → DISCONNECTED event → Stop Realtime → Cleanup
```

## Session Configuration

The `sendSessionUpdate()` configures:

```javascript
{
  modalities: ['text', 'audio'],              // Support both
  instructions: "You are a helpful...",       // System prompt (Turkish)
  voice: 'nova',                              // Voice type
  input_audio_format: 'pcm16',               // Input format
  output_audio_format: 'pcm16',              // Output format
  input_audio_transcription: {
    model: 'whisper-1'                       // Transcription model
  },
  turn_detection: {
    type: 'server_vad',                      // Voice activity detection
    threshold: 0.5,
    prefix_padding_ms: 300,                  // Include 300ms before speech
    silence_duration_ms: 1500                // 1.5s silence = end of turn
  }
}
```

## Audio Format Requirements

**OpenAI Realtime API requires:**
- Format: PCM16 (signed 16-bit PCM)
- Sample Rate: 24kHz (must be resampled from SIP's 8kHz)
- Channels: Mono
- Byte Order: Little-endian

**Important Note:**
SIP typically uses 8kHz or 16kHz audio. The Realtime API requires 24kHz. Audio must be resampled, which adds complexity. See "Integration Challenges" below.

## WebSocket Message Format

### Sending Audio to API
```javascript
{
  type: 'input_audio_buffer.append',
  audio: 'base64_encoded_pcm_data'  // Must be base64
}
```

### Receiving Audio from API
```javascript
{
  type: 'response.audio.delta',
  delta: 'base64_encoded_audio'  // Audio chunk to play
}
```

### API Response Text
```javascript
{
  type: 'response.text.delta',
  delta: 'Response text as it generates...'
}
```

## Integration Challenges & Solutions

### Challenge 1: Audio Format Conversion
**Problem:** SIP uses 8-16kHz, Realtime API uses 24kHz
**Solution:** Add audio resampling layer
```javascript
// Resample 8kHz → 24kHz before sending
function resampleAudio(buffer, fromRate, toRate) {
  // Use FFmpeg or librosa in Node.js
  // Or: Use streaming resampler
}
```

### Challenge 2: Real-time Audio Buffering
**Problem:** Audio must be captured and sent in chunks
**Solution:** Implement circular buffer with periodic sends
```javascript
const audioBuffer = Buffer.alloc(24000 * 0.2); // 200ms chunks
// Fill buffer from SIP
// Send when full or on silence
```

### Challenge 3: Audio Synchronization
**Problem:** Sending and receiving audio at same time
**Solution:** Use separate threads/async operations
```javascript
// Send caller audio in background
setInterval(() => sendNextAudioChunk(), 50);

// Receive and play response audio
realtimeHandler.on('audio_delta', (data) => {
  playAudioChunk(data);
});
```

### Challenge 4: sipstel API Limitations
**Problem:** sipstel doesn't expose raw audio frames
**Solution:** 
- Option 1: Record to file, read chunks
- Option 2: Use PJSIP C++ extension
- Option 3: Fork to pjsip directly

**Current Implementation:** Conceptual (needs audio frame access)

## Next Steps for Full Integration

To make this fully functional:

1. **Enable Audio Frame Access**
   ```javascript
   // Extend sipstel binding or use raw PJSIP
   mediaStream.on('audioFrame', (frame) => {
     realtime.sendAudio(frame);
   });
   ```

2. **Add Audio Resampling**
   ```bash
   npm install audio-resampler
   # or use FFmpeg via child_process
   ```

3. **Implement Circular Buffer**
   ```javascript
   const buffer = new CircularBuffer(48000); // 1s at 24kHz
   ```

4. **Handle Bidirectional Audio**
   ```javascript
   // Send: SIP audio → Realtime API
   // Receive: Realtime API → SIP playback
   ```

5. **Test with Real Calls**
   ```bash
   node app.js
   # Call from SIP phone
   # Speak and listen for real-time responses
   ```

## API Costs

**Realtime API pricing:**
- $0.10 per input minute (speech to text)
- $0.20 per output minute (text to speech)
- No separate transcription cost (built-in)

**Example 5-minute call:**
- Input: 5 min × $0.10 = $0.50
- Output: 3 min × $0.20 = $0.60
- **Total: ~$1.10 per call** (vs $0.08 with previous approach)

Trade-off: Higher cost but true real-time experience.

## Error Handling

```javascript
// Session creation failure
ws.on('error', (error) => {
  console.error('Connection failed:', error);
  // Fallback to pre-recorded message
  playErrorMessage();
});

// API error messages
if (message.type === 'error') {
  console.error('API Error:', message.error);
  // Graceful degradation
}
```

## Debugging

Enable WebSocket debug logging:
```javascript
// In realtime-handler.js
const ws = new WebSocket(url, { 
  perMessageDeflate: false,
  // Enable debugging in production Node.js
  // Use: NODE_DEBUG=http node app.js
});
```

Monitor WebSocket messages:
```bash
# View all WebSocket traffic
node --trace-http app.js 2>&1 | grep -i websocket
```

## Status

✅ **WebSocket handler:** Complete  
✅ **Session configuration:** Complete  
✅ **Audio sending:** Ready for integration  
✅ **Audio receiving:** Ready for integration  
⚠️ **SIP audio frame access:** Needs implementation  
⚠️ **Audio resampling:** Needs implementation  
⚠️ **Full bidirectional streaming:** Needs testing  

## References

- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime-conversations
- WebSocket Client: https://www.npmjs.com/package/ws
- Audio Processing: https://ffmpeg.org/
- PJSIP Media: https://www.pjsip.org/

---

**Note:** This is a foundation. The actual integration with SIP audio streams requires extending the sipstel binding or implementing audio frame callbacks.
