# Turkish SIP Phone System - Quick Start Guide

## What You Have Now ✅

✅ Sequential audio playback (sample.wav → beethoven.wav)
✅ Caller audio recording  
✅ OpenAI Whisper integration for transcription
✅ GPT-4 mini for intelligent responses
✅ Text-to-speech playback
✅ Conversation history tracking
✅ Automatic cleanup on call end

## Quick Test

### 1. Verify Setup
```bash
cd /home/iuslu/sipai
npm install  # Already done, but good to verify
```

### 2. Start Server
```bash
node app.js
```

You should see:
```
✅ SIP server ready...
✅ SIP registered
```

### 3. Make a Test Call

From any SIP phone/softphone, call: **2166062205@sip.netgsm.com.tr**

### 4. Expected Behavior

1. **Phone rings** - Server receives call
2. **Call answers** - You hear sample.wav (12 seconds)
3. **Then beethoven.wav** plays (7.5 seconds)
4. **System listens** for 10 seconds for your input
5. **Transcribes** what you said (appears in logs)
6. **AI generates response** (appears in logs)
7. **Response plays** back to you
8. **Loop repeats** - System listens again
9. **Hang up** - Conversation summary prints

## Example Conversation

```
👤 You: "Merhaba, ben Ahmet"
🤖 AI: "Merhaba Ahmet! Size nasıl yardımcı olabilirim?"

👤 You: "Bugünün tarihi kaç?"
🤖 AI: "Bugün 17 Ekim 2025. Başka bilgi ister misiniz?"

👤 You: "Teşekkür ederim"
🤖 AI: "Bir daha görüşmek üzere!"
```

## What to Monitor

Watch the console for:

| Log | Meaning |
|-----|---------|
| 📞 New call from | Call received |
| ✅ Call answered | Call accepted |
| 🎵 AUDIO PLAYBACK | Greeting playing |
| 🎤 AWAITING CALLER INPUT | System listening |
| 📝 Transcribed | Got your audio |
| 🤖 AI Response | Generated answer |
| 🔊 PLAYING AI RESPONSE | Playing response |
| 💬 CONVERSATION SUMMARY | Call ended |

## Customization Ideas

### Change Greeting Audio
Replace `sample.wav` and `beethoven.wav` with your own files, or update `AUDIO_FILES` in app.js:

```javascript
const AUDIO_FILES = [
  path.join(__dirname, 'greeting.wav'),
  path.join(__dirname, 'music.wav')
];
```

### Change AI Personality
Edit the system prompt in `openai-handler.js`:

```javascript
role: 'system',
content: `You are a Turkish customer service representative for XYZ Company...`
```

### Change Voice
In `openai-handler.js`, update the voice:

```javascript
const audioPath = await openaiHandler.textToSpeech(aiResponse, 'shimmer');
// Options: nova, shimmer, onyx, alloy, echo, fable
```

### Change Input Duration
In `app.js` function `handleCallerInput()`, change `10000`:

```javascript
}, 20000);  // 20 seconds instead of 10
```

### Change Language
Whisper auto-detects Turkish, but to force it:

```javascript
const transcript = await openai.audio.transcriptions.create({
  file: fs.createReadStream(tempAudioPath),
  model: 'whisper-1',
  language: 'tr',  // Already set for Turkish
});
```

## Common Issues

### "No media streams available"
- Wait a few seconds after phone rings
- Check SIP connection quality
- Ensure audio codec support (PCMU/8000)

### "Could not transcribe audio"
- Check OpenAI API key in .env
- Ensure audio is PCM WAV format
- Check API quota limits

### "No caller audio recorded"
- Phone may not be transmitting audio
- Try calling from different client
- Check recording file path permissions

### Response takes too long
- Transcription: ~1-2 seconds
- GPT response: ~0.5-1 second
- TTS generation: ~1-2 seconds
- **Total: ~3-5 seconds latency**

This is normal for real-time API calls.

## Monitoring

### Check Logs
```bash
# Tail logs in real-time
node app.js | tee call.log

# View previous call
tail -100 call.log
```

### Check Recording Files
```bash
ls -lh /tmp/caller_*.wav
ls -lh /tmp/tts_*.wav
```

### Check API Usage
https://platform.openai.com/account/usage/overview

## Next Steps

### Production Deployment

1. **Error Handling** - Add try-catch around all API calls
2. **Logging** - Save logs to file instead of console
3. **Monitoring** - Track API costs and failures
4. **Database** - Store conversations for analytics
5. **Load Balancing** - Handle multiple concurrent calls
6. **HTTPS** - Secure API communications

### Advanced Features

1. **Custom Knowledge** - Add domain-specific FAQ
2. **Voice Detection** - Auto-detect end of speech
3. **Sentiment Analysis** - Detect caller mood
4. **Call Transfer** - Route to human agent
5. **Multi-language** - Support different languages
6. **IVR Menus** - Add phone menu options

## Support

Check these files for more info:
- `OPENAI_INTEGRATION.md` - Detailed API docs
- `openai-handler.js` - Function documentation
- `app.js` - Call handling logic

## Files Overview

```
/home/iuslu/sipai/
├── app.js                      # Main SIP server
├── openai-handler.js           # OpenAI integration
├── package.json                # Dependencies
├── .env                        # Configuration
├── sample.wav                  # Greeting audio
├── beethoven.wav               # Second greeting
├── OPENAI_INTEGRATION.md       # Detailed docs
└── QUICKSTART.md               # This file
```

---

**Ready to test?** Run `node app.js` and call your SIP number! 📞
