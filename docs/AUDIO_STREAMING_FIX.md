# Audio Streaming Fix - Implementation Guide

## Problem Identified

The greeting was playing, but then nothing happened because:

1. ❌ Realtime handler was initialized but **audio wasn't being streamed to it**
2. ❌ The recorder was created but **not connected properly to media stream**
3. ❌ No mechanism to send audio chunks from recorder to API

## Solution Implemented

### 1. Audio Recording (Caller Input)
```javascript
// Create recorder to capture caller audio
const recorder = sip.createRecorder(recordingFile);
mediaStream.startTransmitTo(recorder);

// Continuously read new audio and send to Realtime API
const audioStreamInterval = setInterval(() => {
  const newAudioData = buffer.slice(lastReadBytes);
  realtimeHandler.sendAudio(newAudioData);
}, 200); // Every 200ms
```

### 2. Audio Streaming to API
```javascript
// Send audio chunks to Realtime API
realtimeHandler.sendAudio(audioData);

// The handler:
// - Extracts audio from WAV chunks
// - Encodes to base64
// - Sends via WebSocket: input_audio_buffer.append
```

### 3. Response Audio Back
```javascript
// Listen for response from API
realtimeHandler.on('audio_delta', (audioData) => {
  // Create temporary WAV file
  const responseFile = `/tmp/realtime_response_${Date.now()}.wav`;
  fs.writeFileSync(responseFile, audioData);
  
  // Play to caller
  const player = sip.createPlayer(responseFile);
  player.startTransmitTo(mediaStream);
});
```

## Files Modified

### app.js
**Changes:**
- Updated `initializeRealtimeConversation()` to actually stream audio
- Added audio streaming interval (every 200ms)
- Added event listeners for response handling
- Added cleanup of audio streaming on call end

**Key New Code:**
```javascript
// Record and stream audio in 200ms intervals
const audioStreamInterval = setInterval(() => {
  const newAudioData = buffer.slice(lastReadBytes);
  session.realtimeHandler.sendAudio(newAudioData);
  lastReadBytes = currentSize;
}, 200);

// Handle responses
session.realtimeHandler.on('audio_delta', (audioData) => {
  // Play response to caller
});
```

### realtime-handler.js
**Changes:**
- Updated `sendAudio()` to handle WAV chunks
- Extracts audio data from WAV header
- Converts to base64 before sending

**Key New Code:**
```javascript
// Extract audio data from WAV chunk
if (header === 'RIFF') {
  const dataIndex = audioBuffer.indexOf(Buffer.from('data'));
  audioData = audioBuffer.slice(dataIndex + 8, ...);
}

// Send to API
const base64Audio = audioData.toString('base64');
const message = {
  type: 'input_audio_buffer.append',
  audio: base64Audio
};
```

## How It Works Now

```
1. Caller speaks
   ↓
2. SIP recorder captures audio → /tmp/realtime_XXXX.wav
   ↓
3. Every 200ms:
   ├─ Check if new audio recorded
   ├─ Read new bytes from file
   └─ Send to Realtime API
   ↓
4. Realtime API (OpenAI):
   ├─ Receives audio chunks
   ├─ Whisper transcribes (built-in)
   ├─ GPT-4 processes in real-time
   ├─ Generates response
   └─ Synthesizes audio (built-in)
   ↓
5. Response sent back via WebSocket
   ├─ Audio delta events stream back
   ├─ Chunks written to temp WAV file
   └─ Player created and plays to caller
   ↓
6. Caller hears response immediately
   ↓
7. Caller can speak again (loop)
```

## Testing the Fix

### Prerequisites
```bash
# Verify files
ls -lh greeting.wav              # Should exist
echo $OPENAI_API_KEY             # Should be set
```

### Run Server
```bash
node app.js
```

**Expected Output:**
```
✅ SIP server ready...
✅ SIP registered

📞 New call from: <sip:user@provider>
📞 Incoming call received!
✅ Call answered

📞 CALL STATE CHANGE: CONFIRMED
🎵 PLAYING GREETING AUDIO
   ▶️  Playing greeting (2.5s)

✅ Greeting complete - Initializing Realtime...
🤖 Connecting to OpenAI Realtime API...
✅ Connected to Realtime API
✅ Session configured for Realtime conversation
📁 Recording audio to: /tmp/realtime_1697XXXXX.wav
🎤 Listening for caller input...
🟢 Realtime conversation initialized - Ready to speak!
```

### Make Call
```bash
# From SIP phone, call your number
# You'll hear the greeting
# Then speak - system should respond in real-time
```

**Expected Behavior:**
1. ✅ Greeting plays (2-3 seconds)
2. ✅ System says: "Ready to speak!"
3. ✅ You speak into phone
4. ✅ Console shows: "📤 Sent XXX bytes to Realtime API"
5. ✅ System responds within <1 second
6. ✅ You hear response
7. ✅ You can speak again (loop continues)

## Monitoring

### Watch logs
```bash
tail -f call.log  # if logging to file
# or just watch console output
```

### Look for these messages

**Good Signs:**
- ✅ "🤖 Connecting to OpenAI Realtime API..."
- ✅ "✅ Connected to Realtime API"
- ✅ "📤 Sent XXX bytes to Realtime API" (repeatedly)
- ✅ "📥 Received XXX bytes from Realtime API"
- ✅ "🔊 Playing AI response"

**Bad Signs:**
- ❌ "🤖 Connecting..." but never "✅ Connected"
- ❌ No "📤 Sent bytes" messages (audio not streaming)
- ❌ "❌ WebSocket not connected"
- ❌ API error messages

## Debugging Steps

### 1. Check API Key
```bash
# Verify key is set and valid
echo "Key length: ${#OPENAI_API_KEY}"
# Should be 50+ characters
```

### 2. Check Network
```bash
# Verify can reach OpenAI
curl -I https://api.openai.com/v1/realtime
# Should return 400-level (not connection error)
```

### 3. Add Debug Logging
In `realtime-handler.js`:
```javascript
// After sendSessionUpdate():
this.ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 WebSocket received:', msg.type);
});
```

### 4. Check Audio Files
```bash
# Verify recording files are being created
ls -lh /tmp/realtime_*.wav  # Should grow in size
# Should see new files every 200ms
```

### 5. Verify Audio Format
```bash
# Check WAV file format
file /tmp/realtime_XXXXXX.wav
# Should show: "RIFF (little-endian) data, WAVE audio..."
```

## Common Issues & Fixes

### Issue: "WebSocket not connected"
**Symptom:** Message appears but no messages from API

**Causes:**
1. API key invalid
2. Network blocked (firewall)
3. WebSocket URL wrong

**Fix:**
```bash
# Test API key
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models

# Test network
curl -I wss://api.openai.com/v1/realtime
```

### Issue: "No bytes being sent"
**Symptom:** "🎤 Listening for caller input..." but no "📤 Sent bytes"

**Causes:**
1. Recorder not capturing audio
2. Audio file not growing
3. Audio read logic error

**Fix:**
```bash
# Check if recorder file exists and grows
watch -n 1 'ls -lh /tmp/realtime_*.wav'
# File size should increase as you speak
```

### Issue: "No response from API"
**Symptom:** Bytes being sent, but no "📥 Received bytes"

**Causes:**
1. Audio format wrong
2. Session not configured properly
3. API processing error

**Fix:**
```javascript
// Add debug logging in handleMessage()
if (message.type === 'response.audio.delta') {
  console.log('✅ Got audio delta, length:', message.delta.length);
} else {
  console.log('📨 Got:', message.type);
}
```

### Issue: "Audio plays but garbled"
**Symptom:** Response audio plays but sounds wrong

**Causes:**
1. Audio format conversion issue
2. WAV header extraction problem
3. Sample rate mismatch

**Fix:**
- Check WAV header parsing in `sendAudio()`
- Verify base64 encoding working
- Check response audio format

## Performance Tuning

### Adjust streaming frequency
```javascript
// Currently every 200ms
const audioStreamInterval = setInterval(() => {
  // Send audio
}, 200);  // Try: 100ms (faster), 300ms (slower)
```

### Adjust audio chunk size
**Smaller chunks = lower latency, more overhead**
**Larger chunks = higher latency, less overhead**

Default: Whatever 200ms of audio equals (~3200 bytes at 16kHz)

## Success Checklist

- [ ] greeting.wav plays when call starts
- [ ] Console shows "🟢 Realtime conversation initialized"
- [ ] Audio file `/tmp/realtime_XXXXX.wav` is created
- [ ] Console shows "📤 Sent bytes" messages (repeatedly as you speak)
- [ ] Console shows "🎤 Caller started speaking"
- [ ] Console shows "📥 Received bytes from Realtime API"
- [ ] You hear AI response playing
- [ ] Response contains Turkish text (if speaking Turkish)
- [ ] Can speak again and get another response
- [ ] All messages logged on call end

## Next Steps if Still Not Working

1. **Check WebSocket connection directly**
   ```bash
   # Use websocat or similar
   websocat "wss://api.openai.com/v1/realtime?api_key=YOUR_KEY"
   ```

2. **Test with simple text input first**
   ```javascript
   // Instead of audio, try text
   realtimeHandler.sendTextMessage("Merhaba");
   // See if you get a response
   ```

3. **Check sipstel audio output**
   ```bash
   # Verify recorder is working
   ffplay /tmp/realtime_XXXXX.wav
   # Should hear caller's voice
   ```

4. **Enable verbose Node.js debugging**
   ```bash
   NODE_DEBUG=http node app.js
   NODE_DEBUG=tls node app.js
   ```

---

**Status:** Code updated, ready for testing  
**Test:** Start with `node app.js` and make a test call  
**Expected:** Greeting → System listens → You speak → AI responds in <1 second

Good luck! 🚀
