# Silence.wav Setup Guide

## Quick Start

Generate the SIP-compliant silence.wav file:

```bash
bash create_silence_audio.sh
```

This will create a `silence.wav` file with:
- **Format**: PCM16 (16-bit signed)
- **Sample Rate**: 16kHz (SIP standard)
- **Channels**: Mono (1 channel)
- **Duration**: 10 seconds
- **Use**: Keeps media stream active during greeting transition

## How It Works

### Timeline During Call

```
┌─────────────────────────────────────────────────────────┐
│ T+0ms     Call Connected                                │
│ └─ sample.wav plays (connection beep)                   │
│    └─ Caller hears: connection sound                    │
│                                                         │
│ T+500ms   OpenAI starts generating greeting             │
│ └─ sample.wav still playing                             │
│                                                         │
│ T+1000ms  response.created event                        │
│ └─ sample.wav STOPS                                     │
│ └─ silence.wav STARTS                                   │
│    └─ Media stream STAYS CONNECTED ✅                   │
│    └─ Caller hears: nothing (silence)                   │
│                                                         │
│ T+1500ms  response.audio.delta arrives                  │
│ └─ Greeting audio plays                                 │
│    └─ silence.wav fades into background                 │
│    └─ Caller hears: "Merhaba! Hoş buldunuz..."         │
│                                                         │
│ T+5000ms  Greeting complete                             │
│ └─ silence.wav still playing                            │
│ └─ Media stream ready for conversation                  │
│    └─ Caller can now speak                              │
└─────────────────────────────────────────────────────────┘
```

## Files Involved

| File | Purpose |
|------|---------|
| `create_silence_audio.sh` | Script to generate silence.wav |
| `silence.wav` | Pre-generated 10-second silence file |
| `sample.wav` | Connection indicator (beep/tone) |
| `app.js` | Main SIP application |

## Requirements

- `ffmpeg` installed (for creating silence.wav)
- `bash` shell
- Write permissions in the current directory

## Installation

### Install ffmpeg (if needed)

**Ubuntu/Debian:**
```bash
sudo apt-get install ffmpeg
```

**macOS (Homebrew):**
```bash
brew install ffmpeg
```

**Windows (WSL):**
```bash
sudo apt-get install ffmpeg
```

### Generate silence.wav

```bash
bash create_silence_audio.sh
```

Expected output:
```
🔇 Creating SIP-compliant silence.wav file...
✅ silence.wav created successfully!
📁 File size: 320K
📊 Format: PCM16, 16kHz, mono, 10 seconds
📝 Location: /home/iuslu/sipai/silence.wav

📋 Audio properties:
   Duration: 10.0 seconds
   Stream info: 16000 1 pcm_s16le
```

## Verification

Check if silence.wav was created:

```bash
ls -lh silence.wav
file silence.wav
ffprobe silence.wav
```

Expected output from `file`:
```
silence.wav: RIFF (little-endian) data, WAVE audio, mono 16000 Hz, "Signed 16 bit PCM"
```

## How App Uses It

In `app.js`, when greeting starts:

```javascript
case 'response.created':
  // Replace sample.wav with silence.wav
  const silencePlayer = sip.createPlayer('./silence.wav');
  silencePlayer.startTransmitTo(openaiHandler.callMediaStream);
  console.log('🔇 Silence stream active, awaiting greeting audio...');
```

## Benefits

✅ **No audio overlap** - sample.wav stops before greeting starts
✅ **Media stream stays active** - No call disconnection
✅ **Seamless transition** - Greeting plays smoothly over silence
✅ **Pre-generated** - No CPU overhead during call
✅ **SIP compliant** - Proper PCM16, 16kHz format

## Troubleshooting

### silence.wav not found

```bash
# Create it:
bash create_silence_audio.sh

# Or manually:
ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -q:a 9 -acodec pcm_s16le -t 10 silence.wav
```

### ffmpeg not installed

```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# Then run:
bash create_silence_audio.sh
```

### Wrong audio format

Make sure the created file matches:
```bash
ffprobe silence.wav
# Should show: mono, 16000 Hz, Signed 16 bit PCM
```

If not, delete and recreate:
```bash
rm silence.wav
bash create_silence_audio.sh
```

