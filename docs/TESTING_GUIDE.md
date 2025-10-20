# Testing Guide: Audio Streaming Fixed ✅

## TL;DR

**Before:** Greeting played, then silence (audio not streaming)  
**After:** Greeting plays, then you can have real-time Turkish conversation with AI

**Test Now:**
```bash
node app.js
# Call from SIP phone
# Speak after greeting
# AI responds in <1 second
```

## Expected Experience

### You (Caller)
```
1. Call system
2. Hear greeting: "Hoş geldiniz! Size nasıl yardımcı olabilirim?"
3. Speak: "Merhaba, ben Ahmet"
4. Hear response: "Merhaba Ahmet! Sana nasıl yardımcı olabilirim?" (<1s)
5. Speak again: "Bugünün tarihi kaç?"
6. Hear response: "Bugün 17 Ekim 2025..." (<1s)
7. Continue chatting...
8. Hang up
```

### System (Console)
```
✅ SIP registered
📞 New call from: <sip:...>
✅ Call answered

📞 CALL STATE CHANGE: CONFIRMED
🎵 PLAYING GREETING AUDIO
   ▶️  Playing greeting (2.5s)

✅ Greeting complete - Initializing Realtime...
🤖 Connecting to OpenAI Realtime API...
✅ Connected to Realtime API
✅ Session configured for Realtime conversation
📁 Recording audio to: /tmp/realtime_1729123456789.wav
🎤 Listening for caller input...
🟢 Realtime conversation initialized - Ready to speak!

🎤 Caller started speaking
📤 Sent 3200 bytes to Realtime API
📤 Sent 3200 bytes to Realtime API
📤 Sent 1600 bytes to Realtime API

⏹️  Caller stopped speaking
📥 Received 2400 bytes from Realtime API
📥 Received 2400 bytes from Realtime API
🔊 Playing AI response
✅ AI response complete

🎤 Caller started speaking
📤 Sent 3200 bytes to Realtime API
...
```

## Step-by-Step Testing

### Step 1: Prepare
```bash
cd /home/iuslu/sipai

# Check files exist
ls -l greeting.wav
ls -l app.js
ls -l realtime-handler.js

# Check API key
echo "API Key length: ${#OPENAI_API_KEY}"
# Should be 50+ characters

# Check syntax
node -c app.js && node -c realtime-handler.js
# Both should say OK (no output = OK)
```

### Step 2: Start Server
```bash
node app.js
```

**Expected Output:**
```
✅ SIP server ready...
✅ SIP registered
```

Wait until you see both messages. Then proceed.

### Step 3: Make Test Call
From any SIP phone:
```
Dial: 2166062205@sip.netgsm.com.tr
(or your configured SIP number)
```

**What happens:**
- Phone rings
- After a few seconds, you hear a greeting
- Then system says it's ready

### Step 4: Speak
After greeting finishes, speak into the phone:
```
"Merhaba, ben Ahmet"
(or say anything in Turkish)
```

**Watch console for:**
```
📤 Sent XXX bytes to Realtime API
```

If you see this, audio IS streaming ✅

### Step 5: Listen
Within 1 second of you stopping speaking, you should hear AI response.

**Watch console for:**
```
📥 Received XXX bytes from Realtime API
🔊 Playing AI response
```

### Step 6: Verify Conversation
Listen to response, speak again, repeat.

Everything working? 🎉 You've got real-time Turkish AI phone assistant!

## Common Scenarios

### Scenario 1: Everything Works! 🎉
```
Console shows:
✅ Connected to Realtime API
📤 Sent bytes (as you speak)
📥 Received bytes (AI responding)
🔊 Playing response

You hear:
- Greeting
- Real-time AI responses
```

**Action:** You're done! System is working. Move to production.

### Scenario 2: Greeting plays, then silence ⏳
```
Console shows:
✅ Connected to Realtime API
🎤 Listening for caller input...
(but no "Sent bytes" messages when you speak)
```

**Problem:** Audio not being streamed to API

**Check:**
```bash
# 1. Is recorder file created?
ls -lh /tmp/realtime_*.wav

# 2. Is file growing as you speak?
watch -n 1 'ls -lh /tmp/realtime_*.wav'
# File size should increase

# 3. Check logs more carefully
# Look for error messages about "sendAudio"
```

**Debug:** Add logging in app.js:
```javascript
// Around line 275, add:
console.log(`   File size now: ${currentSize} bytes (was ${lastReadBytes})`);
console.log(`   Sending ${newAudioData.length} bytes...`);
```

### Scenario 3: Can't connect to API ❌
```
Console shows:
❌ WebSocket not connected
❌ Error in Realtime conversation
```

**Problem:** Connection to OpenAI failed

**Check:**
```bash
# 1. API key valid?
echo $OPENAI_API_KEY
# Should show long string

# 2. Network working?
ping api.openai.com
# Should get response

# 3. Can reach OpenAI?
curl -I https://api.openai.com/v1/models
# Should return HTTP 401 or 403 (not connection error)
```

**Fix:**
1. Verify API key: https://platform.openai.com/api-keys
2. Check firewall/proxy settings
3. Try with different network

### Scenario 4: Audio plays but sounds wrong 🔊
```
You hear:
- Greeting (fine)
- Garbled response (bad audio quality)
```

**Problem:** Audio format issue

**Check:**
```bash
# 1. Check WAV file format
file /tmp/realtime_*.wav
# Should show: "RIFF ... WAVE audio"

# 2. Try playing it directly
ffplay /tmp/realtime_response_*.wav
# Should hear the response

# 3. Check audio codec
# OpenAI might be returning different format
```

**Fix:** Check audio format in realtime-handler.js

### Scenario 5: Response delayed (>5 seconds) 🐌
```
You speak, wait 5+ seconds, then hear response
```

**Possible causes:**
1. Network latency
2. Slow API response
3. Audio buffering issues

**Check:**
```bash
# 1. Check network latency
ping api.openai.com
# Should be <50ms

# 2. Monitor in real-time
# Watch console for timing of messages
time node app.js
```

**Optimize:**
- Adjust streaming frequency (100ms vs 200ms vs 300ms)
- Check OpenAI API status: status.openai.com
- Try different API key (maybe hitting rate limits)

## Debugging Commands

### 1. Monitor Audio Files
```bash
# Watch recording files grow
watch -n 1 'ls -lh /tmp/realtime*.wav'

# Count bytes sent per second
while true; do
  SIZE=$(ls -l /tmp/realtime_LATEST.wav | awk '{print $5}')
  echo "$SIZE bytes"
  sleep 1
done
```

### 2. Check Console Output
```bash
# Save output to file
node app.js 2>&1 | tee call_$(date +%s).log

# Search for specific messages
tail -f call.log | grep "Sent\|Received\|Error"
```

### 3. Verify Audio Playback
```bash
# Play the recording back
ffplay /tmp/realtime_XXXXX.wav

# Play response
ffplay /tmp/realtime_response_XXXXX.wav

# Get audio info
ffprobe /tmp/realtime_XXXXX.wav
```

### 4. Network Monitoring
```bash
# See all traffic to OpenAI
sudo tcpdump -i any 'host api.openai.com' -A

# Or with less verbosity
sudo tcpdump -i any 'host api.openai.com'
```

### 5. WebSocket Debugging
Add to realtime-handler.js:
```javascript
// Log all WebSocket messages
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 WS:', msg.type, msg);
});

// Log sent messages
send(message) {
  console.log('📤 WS:', message.type, message);
  // ... rest of code
}
```

## Metrics to Track

| Metric | Target | Alert |
|--------|--------|-------|
| Connection time | <2s | >5s |
| Audio sent bytes/sec | 16000 (16kHz 16-bit) | <1000 |
| Response latency | <1s | >3s |
| Audio quality | Clear | Garbled |
| Error rate | 0% | >5% |

## Production Readiness Checklist

Before deploying:

- [ ] Greeting audio set up (greeting.wav exists)
- [ ] API key valid and in .env
- [ ] Can connect to Realtime API
- [ ] Audio captures from caller
- [ ] Audio streams to API
- [ ] Responses play back
- [ ] Conversation loops smoothly
- [ ] No errors in logs
- [ ] Latency <1 second
- [ ] All 5 test scenarios above work

## Quick Verification Script

Create `test-realtime.sh`:
```bash
#!/bin/bash

echo "Testing Realtime API Integration..."
echo "======================================"

# 1. Check files
echo "✓ Checking files..."
[[ -f greeting.wav ]] && echo "  ✅ greeting.wav exists" || echo "  ❌ greeting.wav missing"
[[ -f app.js ]] && echo "  ✅ app.js exists" || echo "  ❌ app.js missing"
[[ -f realtime-handler.js ]] && echo "  ✅ realtime-handler.js exists" || echo "  ❌ realtime-handler.js missing"

# 2. Check API key
echo "✓ Checking API key..."
[[ ! -z "$OPENAI_API_KEY" ]] && echo "  ✅ OPENAI_API_KEY set" || echo "  ❌ OPENAI_API_KEY not set"

# 3. Check syntax
echo "✓ Checking syntax..."
node -c app.js >/dev/null 2>&1 && echo "  ✅ app.js syntax OK" || echo "  ❌ app.js syntax error"
node -c realtime-handler.js >/dev/null 2>&1 && echo "  ✅ realtime-handler.js syntax OK" || echo "  ❌ realtime-handler.js syntax error"

# 4. Check network
echo "✓ Checking network..."
ping -c 1 api.openai.com >/dev/null 2>&1 && echo "  ✅ Can reach api.openai.com" || echo "  ❌ Cannot reach api.openai.com"

echo "======================================"
echo "Ready for testing!"
echo "Run: node app.js"
echo "Then call from SIP phone"
```

Run:
```bash
chmod +x test-realtime.sh
./test-realtime.sh
```

## Still Having Issues?

1. **Read:** AUDIO_STREAMING_FIX.md (detailed explanation)
2. **Check:** All console output for error messages
3. **Debug:** Add logging as shown above
4. **Verify:** Network connectivity and API key
5. **Test:** With simple curl first

---

**You've got this!** 🚀

Start with `node app.js` and make a test call.

Most common success rate: Audio streams, AI responds, conversation works!
