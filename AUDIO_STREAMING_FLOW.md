# Audio Streaming Flow: From OpenAI API to SIP Caller

## Complete Audio Pipeline Visualization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OPENAI API SENDS AUDIO RESPONSE                          │
│                                                                              │
│  OpenAI Realtime API                                                        │
│  └─ Generates greeting/response in Turkish                                  │
│     └─ Encodes as PCM16 (16-bit signed, 16kHz, mono)                       │
│        └─ Sends as base64-encoded chunks                                    │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
        ┌────────────────────────────────────────────────────┐
        │ OpenAI Message Event: response.audio.delta          │
        │ ───────────────────────────────────────────────────│
        │ {                                                   │
        │   type: 'response.audio.delta',                    │
        │   delta: 'base64encodedaudiodata...',              │
        │   response_id: 'resp_...',                         │
        │   output_index: 0                                  │
        │ }                                                   │
        └────────────────────┬───────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────────┐
        │ WebSocket Message Handler                           │
        │ handleOpenAIMessage(message)                        │
        │                                                     │
        │ Detects: message.type === 'response.audio.delta'   │
        └────────────────────┬───────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────────────┐
        │ playAudioToSIP(base64Audio)                         │
        │                                                     │
        │ This is where the magic happens!                    │
        └────────────────────┬───────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                          │
        ▼                                          ▼
    ┌─────────────────────┐            ┌──────────────────────┐
    │ Step 1: Decode B64  │            │ Step 2: Create WAV   │
    │                     │            │                      │
    │ base64Audio        │            │ Add 44-byte header:  │
    │ ↓                  │            │ - RIFF signature     │
    │ Buffer.from(       │            │ - Format: PCM16      │
    │   base64Audio,     │            │ - Sample rate: 16kHz │
    │   'base64'         │            │ - Channels: 1 (mono) │
    │ )                  │            │ - Bit depth: 16      │
    │ ↓                  │            │                      │
    │ audioBuffer        │            │ Creates 44-byte      │
    │ (raw PCM data)     │            │ WAV header           │
    └─────────────────────┘            └──────────────────────┘
                             │
        ┌────────────────────┴────────────────────────────────┐
        │                                                      │
        ▼                                                      ▼
    ┌──────────────────────────────┐        ┌────────────────────────────┐
    │ Step 3: Combine Header + PCM │        │ Step 4: Write to Temp File │
    │                              │        │                            │
    │ wavFile = Buffer.concat([    │        │ Temp filename:             │
    │   wavHeader,                 │        │ /tmp/ai_response_          │
    │   audioBuffer                │        │ [timestamp].wav            │
    │ ])                           │        │                            │
    │                              │        │ Example:                   │
    │ Result: Complete valid       │        │ /tmp/ai_response_          │
    │ WAV file in memory           │        │ 1760645950254.wav          │
    │                              │        │                            │
    │                              │        │ fs.writeFileSync(          │
    │                              │        │   tempAudioFile,           │
    │                              │        │   wavFile                  │
    │                              │        │ )                          │
    └──────────────────────────────┘        └──────────────────────────┘
                                                    │
                                                    ▼
                            ┌──────────────────────────────────────┐
                            │ Step 5: Create SIP Audio Player      │
                            │                                      │
                            │ const chunkPlayer =                  │
                            │   sip.createPlayer(tempAudioFile)    │
                            │                                      │
                            │ chunkPlayer.startTransmitTo(         │
                            │   this.callMediaStream               │
                            │ )                                    │
                            │                                      │
                            │ This connects the audio to the       │
                            │ SIP media stream (the call)          │
                            └──────────────────────────┬───────────┘
                                                      │
                                                      ▼
                            ┌──────────────────────────────────────┐
                            │ Step 6: Audio Plays to Caller        │
                            │                                      │
                            │ The SIP media stream transmits:      │
                            │ - Port: 1 (SIP media stream)         │
                            │ ↓                                    │
                            │ To: Caller's RTP endpoint           │
                            │                                      │
                            │ Log: "🔊 Started audio playback"     │
                            └──────────────────────────┬───────────┘
                                                      │
                                                      ▼
                            ┌──────────────────────────────────────┐
                            │ CALLER HEARS AUDIO IN REAL-TIME      │
                            │                                      │
                            │ Audio plays immediately as each      │
                            │ chunk arrives (streaming)            │
                            │                                      │
                            │ NO WAITING FOR COMPLETE RESPONSE!    │
                            └──────────────────────────────────────┘
```

---

## Key Code: The `playAudioToSIP()` Function

```javascript
playAudioToSIP(base64Audio) {
  // Convert base64 audio to format that can be played through SIP
  try {
    console.log('🔊 Received OpenAI audio, length:', base64Audio.length);
    
    if (!this.callMediaStream) {
      console.error('❌ No media stream available for audio playback');
      return;
    }
    
    // ┌─────────────────────────────────────────────────────────┐
    // │ STEP 1: DECODE BASE64 TO BINARY PCM DATA               │
    // └─────────────────────────────────────────────────────────┘
    const audioBuffer = Buffer.from(base64Audio, 'base64');
    
    // ┌─────────────────────────────────────────────────────────┐
    // │ STEP 2: CACHE IF THIS IS GREETING (optional)           │
    // └─────────────────────────────────────────────────────────┘
    if (this.isFirstGreeting) {
      this.greetingAudioBuffer.push(audioBuffer);
      console.log('📝 Collecting greeting audio chunk...');
    }
    
    // ┌─────────────────────────────────────────────────────────┐
    // │ STEP 3: CREATE TEMPORARY WAV FILE PATH                 │
    // └─────────────────────────────────────────────────────────┘
    const tempAudioFile = `/tmp/ai_response_${Date.now()}.wav`;
    
    // ┌─────────────────────────────────────────────────────────┐
    // │ STEP 4: CREATE WAV HEADER (44 bytes)                   │
    // │                                                         │
    // │ Format: PCM16, 16kHz, mono, 16-bit signed              │
    // │                                                         │
    // │ Header structure:                                       │
    // │ - Bytes 0-3:   'RIFF'                                  │
    // │ - Bytes 4-7:   File size - 8                           │
    // │ - Bytes 8-11:  'WAVE'                                  │
    // │ - Bytes 12-15: 'fmt '                                  │
    // │ - Bytes 16-19: Subchunk1Size (16)                      │
    // │ - Bytes 20-21: AudioFormat (1 = PCM)                   │
    // │ - Bytes 22-23: NumChannels (1 = mono)                  │
    // │ - Bytes 24-27: SampleRate (16000)                      │
    // │ - Bytes 28-31: ByteRate                                │
    // │ - Bytes 32-33: BlockAlign                              │
    // │ - Bytes 34-35: BitsPerSample (16)                      │
    // │ - Bytes 36-39: 'data'                                  │
    // │ - Bytes 40-43: Subchunk2Size                           │
    // └─────────────────────────────────────────────────────────┘
    const wavHeader = this.createWavHeader(audioBuffer.length);
    
    // ┌─────────────────────────────────────────────────────────┐
    // │ STEP 5: CONCATENATE HEADER + PCM DATA                  │
    // └─────────────────────────────────────────────────────────┘
    const wavFile = Buffer.concat([wavHeader, audioBuffer]);
    
    // ┌─────────────────────────────────────────────────────────┐
    // │ STEP 6: WRITE TO TEMPORARY FILE ON DISK                │
    // └─────────────────────────────────────────────────────────┘
    fs.writeFileSync(tempAudioFile, wavFile);
    console.log('💾 Created temp audio file:', tempAudioFile);
    
    // ┌─────────────────────────────────────────────────────────┐
    // │ STEP 7: CREATE SIP AUDIO PLAYER                        │
    // └─────────────────────────────────────────────────────────┘
    try {
      const chunkPlayer = sip.createPlayer(tempAudioFile);
      if (chunkPlayer) {
        
        // ┌───────────────────────────────────────────────────────┐
        // │ STEP 8: CONNECT PLAYER TO SIP MEDIA STREAM           │
        // │                                                       │
        // │ This is the KEY line that sends audio to the caller! │
        // │                                                       │
        // │ chunkPlayer ────transmitTo───→ this.callMediaStream  │
        // │    (audio file)                    (SIP call)        │
        // │       │                               │              │
        // │       └───────RTP packets────────────→│              │
        // │           (to caller's endpoint)      │              │
        // └───────────────────────────────────────────────────────┘
        chunkPlayer.startTransmitTo(this.callMediaStream);
        
        console.log('🔊 Started audio playback to caller');
        console.log('📁 AI audio file preserved for analysis:', tempAudioFile);
        
        // Track this player if it's greeting audio
        if (this.isFirstGreeting) {
          this.activePlayers.push(chunkPlayer);
        }
      } else {
        console.error('❌ Failed to create audio player');
      }
    } catch (playerError) {
      console.error('❌ Error creating audio player:', playerError.message);
    }
  } catch (error) {
    console.error('❌ Error playing audio to SIP:', error.message);
  }
}
```

---

## Real-Time Streaming Flow

### Timeline of Events

```
Time     Event                               What Happens
────────────────────────────────────────────────────────────────
T+0ms    OpenAI generates response           Streaming begins
T+10ms   response.audio.delta #1             First chunk arrives
         └─> playAudioToSIP()                Creates WAV #1
         └─> sip.createPlayer()              Player #1 created
         └─> startTransmitTo()               Audio #1 plays

T+20ms   response.audio.delta #2             Second chunk arrives
         └─> playAudioToSIP()                Creates WAV #2
         └─> sip.createPlayer()              Player #2 created
         └─> startTransmitTo()               Audio #2 plays

T+30ms   response.audio.delta #3             Third chunk arrives
         └─> playAudioToSIP()                Creates WAV #3
         ...and so on...

Result: Multiple audio files playing simultaneously
        Creates continuous audio stream effect
        Caller hears natural speech without gaps
```

---

## SIP Media Stream Connection

### How Audio Reaches the Caller

```
┌─────────────────┐
│  WAV Audio File │ (on local disk)
│ /tmp/ai_...wav  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ SIP Audio Player                     │
│ sip.createPlayer(filePath)           │
│                                     │
│ Reads WAV file in chunks            │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ startTransmitTo(mediaStream)         │
│                                     │
│ "Send this audio to the media stream"
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ SIP Call Media Stream                │
│ (this.callMediaStream)               │
│                                     │
│ Port 1 (conference)                 │
│ Connected to: RTP sender             │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ RTP Packets                          │
│                                     │
│ Encoded audio sent over IP           │
│ To: Caller's RTP endpoint            │
│ Port: 4000+ (dynamic)                │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ CALLER'S PHONE                       │
│                                     │
│ Receives RTP packets                │
│ Decodes PCM16 audio                 │
│ Plays through speaker                │
│                                     │
│ "Merhaba! Hoş buldunuz..."         │
└─────────────────────────────────────┘
```

---

## Message Event Sequence

```
handleOpenAIMessage(message)
  │
  ├─ message.type === 'response.audio.delta'
  │  │
  │  └─ message.delta contains: base64-encoded PCM16 audio chunk
  │     │
  │     └─ playAudioToSIP(message.delta)
  │        │
  │        └─ Decode base64
  │        └─ Create WAV
  │        └─ Write temp file
  │        └─ Create player
  │        └─ Stream to SIP
  │        └─ Caller hears audio immediately!
  │
  └─ [Next chunk arrives 10-50ms later]
     └─ [Process repeats...]
     └─ Creates seamless audio stream
```

---

## Why It Works

### Chunked Streaming Benefits

| Aspect | Benefit |
|--------|---------|
| **Real-time** | Caller hears audio as it arrives, not after response complete |
| **Responsive** | No waiting for full response generation |
| **Natural** | Audio feels like natural conversation flow |
| **Efficient** | Each chunk is small, manageable in memory |
| **Continuous** | Multiple players create seamless playback |

---

## Code Location in app.js

```
Line 140-190     playAudioToSIP()         ← Main streaming function
Line 193-211     createWavHeader()        ← Creates 44-byte header
Line 155         Buffer.from()            ← Decodes base64
Line 170         createWavHeader()        ← Creates WAV header
Line 172         Buffer.concat()          ← Combines header + PCM
Line 174         fs.writeFileSync()       ← Writes to disk
Line 182         sip.createPlayer()       ← Creates audio player
Line 185         startTransmitTo()        ← KEY LINE: Streams to caller!
```

---

## Log Output When Streaming

```
🤖 OpenAI message received: response.audio.delta
🔊 Received OpenAI audio, length: 6400          ← First chunk
📝 Collecting greeting audio chunk...
💾 Created temp audio file: /tmp/ai_response_1760645950254.wav
🎵 Creating file player: /tmp/ai_response_1760645950254.wav..
🔊 Started audio playback to caller              ← Playing!

[10ms later]

🤖 OpenAI message received: response.audio.delta
🔊 Received OpenAI audio, length: 9600          ← Second chunk
📝 Collecting greeting audio chunk...
💾 Created temp audio file: /tmp/ai_response_1760645950277.wav
🎵 Creating file player: /tmp/ai_response_1760645950277.wav..
🔊 Started audio playback to caller              ← Playing!

[Pattern repeats until response.audio.done]
```

---

## Summary

**The streaming process:**

1. **OpenAI sends** audio in base64-encoded chunks via WebSocket
2. **Chunk arrives** → `response.audio.delta` event fires
3. **Decode base64** → Get raw PCM16 audio bytes
4. **Add WAV header** → Create valid WAV file format
5. **Write to disk** → Temporary WAV file in `/tmp/`
6. **Create player** → SIP audio player loads WAV file
7. **startTransmitTo()** → **THIS IS THE KEY** - connects player to SIP media stream
8. **RTP streaming** → Audio sent to caller's phone in real-time
9. **Repeat** → Next chunk arrives, process repeats

**Result:** Continuous, seamless audio stream from OpenAI API to the phone caller! 🎵
