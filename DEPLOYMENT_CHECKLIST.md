# Deployment Checklist - Turkish SIP Phone System

## Pre-Deployment ✓

### Environment Setup
- [ ] Node.js installed (v18+)
- [ ] npm dependencies installed: `npm install`
- [ ] `.env` file configured with:
  - [ ] `OPENAI_API_KEY` (valid and has credits)
  - [ ] `SIP_DOMAIN` (correct SIP server)
  - [ ] `SIP_USER` (valid phone number)
  - [ ] `SIP_PASS` (correct password)

### Audio Files
- [ ] `sample.wav` exists (12 seconds, 16kHz, mono)
- [ ] `beethoven.wav` exists (7.5 seconds, 16kHz, mono)
- [ ] Both files readable and not corrupted

### Code Verification
- [ ] `app.js` syntax OK: `node -c app.js`
- [ ] `openai-handler.js` syntax OK: `node -c openai-handler.js`
- [ ] No console errors on startup

### Dependencies
```bash
npm ls
# Verify:
# ├── dotenv@17.2.3
# ├── openai@6.3.0
# ├── sipstel@0.2.0
# └── ws@8.18.3
```

## Startup Test ✓

### 1. Start Server
```bash
node app.js
```

Expected output:
```
✅ SIP server ready...
✅ SIP registered
```

### 2. Verify Registration
- [ ] See "✅ SIP registered" within 5 seconds
- [ ] Check SIP server status (if available)

### 3. Make Test Call
- [ ] Call from SIP phone: `2166062205@sip.netgsm.com.tr`
- [ ] Call rings and connects
- [ ] You hear "✅ Call answered" logged

### 4. Audio Playback Test
- [ ] Hear greeting audio (sample.wav ~12s)
- [ ] Hear second audio (beethoven.wav ~7.5s)
- [ ] Then system is listening (silent)

### 5. Interaction Test
- [ ] Speak something in Turkish
- [ ] See transcription in logs
- [ ] See AI response in logs
- [ ] Hear response played back
- [ ] Can speak again for next round

### 6. Call Cleanup
- [ ] Hang up
- [ ] See "CONVERSATION SUMMARY"
- [ ] See "CLEANING UP SESSION"
- [ ] No errors in cleanup

## Production Deployment ⚠️

### Monitoring
- [ ] Set up monitoring for process crashes
- [ ] Monitor OpenAI API usage and costs
- [ ] Log all calls to disk for audit
- [ ] Set up alerts for API failures

### Error Handling
- [ ] Test with bad OpenAI key → graceful error
- [ ] Test with no network → graceful error
- [ ] Test with empty audio → graceful error
- [ ] Test concurrent calls (if intended)

### Performance
- [ ] Measure latency per exchange (~3-5s expected)
- [ ] Monitor memory usage over multiple calls
- [ ] Check CPU usage under load
- [ ] Monitor temp file cleanup

### Security
- [ ] `.env` file is NOT in git
- [ ] API keys are not logged
- [ ] Validate input to avoid injection
- [ ] Implement rate limiting if needed
- [ ] Use HTTPS for any web APIs (already done by OpenAI SDK)

### Resource Cleanup
- [ ] Temp audio files cleaned up ✅
- [ ] No orphaned processes
- [ ] No memory leaks on long calls
- [ ] File descriptors properly closed

## Troubleshooting Checklist

### Server Won't Start
- [ ] Check Node.js version: `node --version`
- [ ] Check npm packages: `npm install`
- [ ] Check syntax: `node -c app.js`
- [ ] Check `.env` file exists and readable
- [ ] Check port 5060 not in use: `lsof -i :5060`

### No SIP Registration
- [ ] Check `.env` credentials
- [ ] Check SIP server is reachable
- [ ] Check firewall allows UDP 5060
- [ ] Try registering manually with different SIP client
- [ ] Check logs for "Registration failed"

### No Incoming Call
- [ ] Verify phone number is correct in SIP
- [ ] Check SIP server allows calls to this number
- [ ] Try calling from different phone
- [ ] Check firewall allows inbound calls

### Greeting Audio Won't Play
- [ ] Check audio files exist: `ls -l *.wav`
- [ ] Check file format (must be WAV)
- [ ] Check sample rate (must be 16kHz)
- [ ] Check channels (mono or stereo)
- [ ] Try playing with: `ffplay sample.wav`

### Transcription Fails
- [ ] Check OpenAI API key: `echo $OPENAI_API_KEY`
- [ ] Check API quota: https://platform.openai.com/account/usage
- [ ] Check audio quality (background noise?)
- [ ] Try longer input (10+ seconds of speech)
- [ ] Check language is Turkish or auto-detect works

### AI Response Fails
- [ ] Check ChatGPT API key works
- [ ] Check rate limits
- [ ] Check model availability (gpt-4o-mini)
- [ ] Review error logs for specific error

### Response Audio Won't Play
- [ ] Check TTS API key works
- [ ] Check response text length (max ~1000 chars)
- [ ] Check temp directory exists: `ls /tmp/`
- [ ] Check file permissions

### Conversation Won't Loop
- [ ] Check conversation history is building
- [ ] Check handleCallerInput() is being called
- [ ] Check timeouts are correct
- [ ] Review logs for any errors

## Rollback Plan

If issues occur in production:

1. **Stop the service**
   ```bash
   pkill -f "node app.js"
   ```

2. **Check logs**
   ```bash
   tail -50 call.log
   ```

3. **Restore backup**
   ```bash
   cp app.js.backup app.js
   ```

4. **Restart**
   ```bash
   node app.js
   ```

## Performance Targets

| Metric | Expected | Acceptable | Alert |
|--------|----------|-----------|-------|
| Startup Time | <5s | <10s | >15s |
| SIP Register | <2s | <5s | >10s |
| Call Answer | <1s | <2s | >5s |
| Audio Playback | <100ms | <500ms | >1s |
| Input → Response Latency | 3-5s | <8s | >10s |
| Memory per Call | 50-100MB | <200MB | >300MB |
| Temp File Cleanup | <1s | <5s | >10s |
| Error Rate | 0% | <1% | >5% |

## Load Testing

When ready to test multiple concurrent calls:

1. **Single call** ← You are here ✓
2. **2-3 simultaneous calls** 
   - Need: Session isolation ✓ (per-call session objects)
   - Need: API rate limiting (configure)
   - Need: Resource monitoring

3. **10+ concurrent calls**
   - Need: Load balancing
   - Need: Database for session persistence
   - Need: Redis for distributed state
   - Need: Metrics collection

## Documentation Checklist

- [ ] README.md - Main overview ✓
- [ ] QUICKSTART.md - Fast setup guide ✓
- [ ] OPENAI_INTEGRATION.md - Technical details ✓
- [ ] IMPLEMENTATION_SUMMARY.md - What's included ✓
- [ ] This file - Deployment guide ✓

## Health Check Script

Create `health-check.sh`:
```bash
#!/bin/bash

echo "Checking SIP Phone System..."

# Check process
if pgrep -f "node app.js" > /dev/null; then
    echo "✅ Process running"
else
    echo "❌ Process NOT running"
    exit 1
fi

# Check SIP registration
if grep "✅ SIP registered" <(tail -100 call.log) > /dev/null 2>&1; then
    echo "✅ SIP registered"
else
    echo "⚠️  SIP registration unknown"
fi

# Check OpenAI key
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ OPENAI_API_KEY not set"
    exit 1
fi
echo "✅ OPENAI_API_KEY set"

# Check audio files
for file in sample.wav beethoven.wav; do
    if [ -f "$file" ]; then
        echo "✅ $file found"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

echo "✅ All checks passed!"
```

## Monitoring Commands

```bash
# Tail live logs
tail -f call.log

# Monitor memory
watch -n 1 'ps aux | grep "node app.js"'

# Monitor network
sudo tcpdump -i any udp port 5060

# Check open files
lsof -p $(pgrep -f "node app.js")

# Monitor temp files
watch -n 5 'ls -la /tmp/caller_* /tmp/tts_* 2>/dev/null | wc -l'
```

## Post-Deployment

### First 24 Hours
- [ ] Monitor for crashes
- [ ] Monitor API costs
- [ ] Check call success rate
- [ ] Review error logs
- [ ] Get feedback on audio quality

### First Week
- [ ] Analyze call patterns
- [ ] Optimize timeouts if needed
- [ ] Plan for scaling
- [ ] Document any issues found

### Ongoing
- [ ] Monthly cost review
- [ ] API usage trending
- [ ] Quality metrics
- [ ] Feature requests

---

## Quick Reference

| Task | Command |
|------|---------|
| Start | `node app.js` |
| Check Syntax | `node -c app.js` |
| View Logs | `tail -f call.log` |
| Kill Process | `pkill -f "node app.js"` |
| Check Port | `lsof -i :5060` |
| List Audio Files | `ls -lh *.wav` |
| API Usage | https://platform.openai.com/account/usage |
| Check Temp Files | `ls -lh /tmp/{caller,tts}_*` |

---

**Status:** Ready for Deployment ✅  
**Last Updated:** October 17, 2025  
**Test Date:** [Fill in when tested]
