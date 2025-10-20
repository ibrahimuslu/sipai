# OpenAI Integration for Turkish SIP Phone System

## Overview

This system integrates OpenAI's Realtime API with a SIP phone system to create an interactive Turkish-language phone assistant. The system:

1. **Accepts incoming SIP calls**
2. **Plays greeting audio** (sample.wav → beethoven.wav)
3. **Records caller audio** during the call
4. **Transcribes audio to Turkish text** using Whisper API
5. **Processes conversation** with GPT-4 mini
6. **Converts response to speech** using Text-to-Speech API
7. **Plays response back** to the caller

## Architecture

### Files

- **app.js** - Main SIP server with call handling and audio playback
- **openai-handler.js** - OpenAI API integration layer
- **package.json** - Dependencies (sipstel, openai, dotenv, ws)
- **.env** - Configuration (OPENAI_API_KEY, SIP credentials)

### Flow Diagram

```
Incoming Call
    ↓
Answer Call & Initialize Session
    ↓
Play Greeting Audio (sample.wav → beethoven.wav)
    ↓
Record Caller Audio (10 seconds)
    ↓
Transcribe Audio (Whisper API) → Turkish text
    ↓
Get AI Response (GPT-4 mini) → Maintain conversation history
    ↓
Convert to Speech (TTS API) → WAV audio
    ↓
Play Response Back to Caller
    ↓
Loop back to record next input
    ↓
Call Ends → Cleanup & Log Conversation
```

## Usage

### Prerequisites

```bash
npm install
# Requires: openai, sipstel, dotenv, ws
```

### Configuration (.env)

```env
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
SIP_DOMAIN=sip.your-provider.com
SIP_USER=1234567890
SIP_PASS=your-password
```

### Run

```bash
node app.js
```

### Expected Output

```
✅ SIP server ready...

✅ SIP registered
📞 New call from: <sip:caller@192.168.1.1:5060>
📞 Incoming call received!
✅ Call answered

📞 CALL STATE CHANGE: CONFIRMED
   ✅ Call confirmed - media should be available soon

🎵 AUDIO PLAYBACK - Files: sample.wav → beethoven.wav
▶️  Playing file 1/2: sample.wav (12.0s)
   ✅ Playing: sample.wav

▶️  Playing file 2/2: beethoven.wav (7.5s)
   ✅ Playing: beethoven.wav

✅ ALL FILES PLAYED - Waiting for caller input...

🎤 AWAITING CALLER INPUT...
   ⏱️  Listening for caller input (10 seconds)...
   📊 Recorded audio size: 45.2 KB

🎤 Transcribing audio (45200 bytes)...
📝 Transcribed: "Merhaba, ben Ahmet. Nasılsın?"

💬 Getting AI response for: "Merhaba, ben Ahmet. Nasılsın?"
🤖 AI Response: "Merhaba Ahmet! Ben iyi, teşekkür ederim. Sana nasıl yardımcı olabilirim?"

🔊 Converting text to speech: "Merhaba Ahmet! Ben iyi..."
✅ TTS audio saved: /tmp/tts_1697123456789.wav

🔊 PLAYING AI RESPONSE AUDIO...
   ⏱️  Duration: 3.5s

✅ Response played - waiting for next input...

[Call continues with more exchanges...]

📞 CALL STATE CHANGE: DISCONNECTED
   📴 Call is disconnected/ended

💬 CONVERSATION SUMMARY:
   1. 👤 User: Merhaba, ben Ahmet. Nasılsın?
   2. 🤖 AI: Merhaba Ahmet! Ben iyi, teşekkür ederim. Sana nasıl yardımcı olabilirim?
   3. 👤 User: Bugünün saati kaç?
   4. 🤖 AI: Şu anda saat 14:30. Başka bir sorunuz var mı?

🧹 CLEANING UP SESSION
   Players created: 4
   📁 Recording saved to: /tmp/caller_1697123456789_abc123def.wav
   📊 File size: 120.5 KB
```

## OpenAI Handler Functions

### `initializeRealtimeSession()`
Initializes an OpenAI session object for the call.

```javascript
const session = openaiHandler.initializeRealtimeSession();
// Returns: { isActive: true, conversationHistory: [] }
```

### `transcribeAudio(audioBuffer)`
Transcribes audio buffer to Turkish text using Whisper API.

```javascript
const text = await openaiHandler.transcribeAudio(audioBuffer);
// Returns: "Merhaba, ben Ahmet"
```

### `getAIResponse(userMessage, conversationHistory)`
Sends message to GPT-4 mini and maintains conversation history.

```javascript
const response = await openaiHandler.getAIResponse(
  "Merhaba",
  conversationHistory
);
// Returns: "Merhaba! Size nasıl yardımcı olabilirim?"
```

### `textToSpeech(text, voice)`
Converts text to speech and saves as WAV file.

```javascript
const audioPath = await openaiHandler.textToSpeech(
  "Merhaba! Size nasıl yardımcı olabilirim?",
  "nova"  // voice options: nova, shimmer, onyx, etc.
);
// Returns: "/tmp/tts_1697123456789.wav"
```

### `processUserAudio(audioBuffer, conversationHistory)`
Complete pipeline: transcribe → get AI response → TTS.

```javascript
const result = await openaiHandler.processUserAudio(
  audioBuffer,
  conversationHistory
);
// Returns:
// {
//   userMessage: "Merhaba",
//   aiResponse: "Merhaba! Size nasıl yardımcı olabilirim?",
//   audioPath: "/tmp/tts_1697123456789.wav"
// }
```

### `cleanupAudioFile(filePath)`
Remove temporary TTS audio files.

```javascript
openaiHandler.cleanupAudioFile('/tmp/tts_1697123456789.wav');
```

## API Costs

Costs are per call based on API usage:

| Operation | Model | Cost |
|-----------|-------|------|
| Transcription | Whisper | $0.02 per 15 min (rounded up) |
| Chat Response | GPT-4 mini | ~$0.00015 per 1K tokens |
| Text-to-Speech | TTS-1-HD | $0.030 per 1K characters |

Example 5-minute call with 3 exchanges:
- Transcription: 3 × $0.02 = $0.06
- Chat: 3 × $0.0001 = $0.0003
- TTS: 3 × 200 chars × $0.03/1K = $0.018
- **Total: ~$0.08 per call**

## Configuration Options

### Audio Voice Selection

In `openai-handler.js`, change the `voice` parameter:

```javascript
// Line: const audioPath = await openaiHandler.textToSpeech(aiResponse, 'nova');

// Available voices:
// - nova    (female, clear)
// - shimmer (female, bright)
// - onyx    (male, deep)
// - alloy   (male, warm)
// - echo    (male, resonant)
// - fable   (female, storyteller)
```

### Input Timeout

In `app.js`, change the timeout (default 10 seconds):

```javascript
// Line: }, 10000);  in handleCallerInput()
// Change to: }, 20000);  for 20 seconds
```

### Conversation System Prompt

In `openai-handler.js`, update the system prompt in `getAIResponse()`:

```javascript
role: 'system',
content: `Your system prompt here. Customize for your use case.`
```

## Conversation History

The system maintains `conversationHistory` as an array of message objects:

```javascript
[
  { role: 'user', content: 'Merhaba' },
  { role: 'assistant', content: 'Merhaba! Size nasıl yardımcı olabilirim?' },
  { role: 'user', content: 'Saatin kaçını söyleseniz?' },
  { role: 'assistant', content: 'Saat 14:30' }
]
```

This is passed to ChatGPT, providing context for more coherent conversations.

## Limitations

1. **Audio Quality**: PCMU 8000Hz codec may affect audio quality
2. **Language Detection**: Whisper auto-detects; specify language if issues
3. **Real-time Latency**: Full API calls + audio generation add ~2-3 second latency
4. **Recording Duration**: Fixed 10-second windows (configurable)
5. **Concurrent Calls**: Limited by server resources

## Troubleshooting

### No audio from AI
- Check TTS API response in console logs
- Verify audio file is created in /tmp/
- Check media stream is connected

### Transcription fails
- Check audio quality/size
- Ensure Turkish language specified (already done)
- Verify OpenAI API quota

### Conversation breaks
- Check conversationHistory array is being updated
- Verify GPT response generation succeeds
- Check for API errors in logs

### Caller doesn't hear responses
- Verify `startTransmitTo()` connects correctly
- Check audio player creation succeeds
- Review media stream state

## Future Enhancements

1. **Voice Activity Detection (VAD)** - Auto-detect end of caller speech
2. **Streaming TTS** - Play response while still generating
3. **Custom Knowledge Base** - RAG for domain-specific answers
4. **Multi-language Support** - Auto-detect caller language
5. **Call Recording & Analytics** - Save and analyze calls
6. **IVR Integration** - Menu options before conversation
7. **Error Handling** - Better fallback when APIs fail
8. **Audio Mixing** - Combine multiple audio sources

## References

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [sipstel Documentation](https://www.npmjs.com/package/sipstel)
- [PJSIP Documentation](https://www.pjsip.org/)
