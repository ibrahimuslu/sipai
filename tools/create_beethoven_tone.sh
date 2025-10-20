#!/bin/bash

# Create Beethoven 9th Symphony (Ode to Joy) tone using ffmpeg
# This generates a musical WAV file with the famous "Ode to Joy" melody

OUTPUT_FILE="beethoven.wav"

echo "🎼 Creating Beethoven 9th Symphony (Ode to Joy) tone..."
echo "📁 Output: $OUTPUT_FILE"
echo "🔧 Target: 16kHz PCM (SIP compatible)"

# Generate the "Ode to Joy" melody using sine wave tones
# Notes: E4 E4 F#4 G4 | G4 F#4 E4 D4 | C#4 D4 E4 E4 | D4 D4 E4
# Frequencies (Hz) for musical notes
# C4=261.63, C#4=277.18, D4=293.66, D#4=311.13, E4=329.63
# F4=349.23, F#4=369.99, G4=391.99, G#4=415.30, A4=440, A#4=466.16, B4=493.88

# Duration of each note in seconds
BEAT_DURATION=0.5

# Create the melody - Ode to Joy opening
# E E F# G G F# E D C# D E E D D E
NOTES="329.63 329.63 369.99 391.99 391.99 369.99 329.63 293.66 277.18 293.66 329.63 329.63 293.66 293.66 329.63"

# Generate audio using ffmpeg with sin/tone filter
# Create a complex filter to generate each note sequentially

FILTER="sine=f=329.63:d=${BEAT_DURATION}[a0];"
FILTER="${FILTER}sine=f=329.63:d=${BEAT_DURATION}[a1];"
FILTER="${FILTER}sine=f=369.99:d=${BEAT_DURATION}[a2];"
FILTER="${FILTER}sine=f=391.99:d=${BEAT_DURATION}[a3];"
FILTER="${FILTER}sine=f=391.99:d=${BEAT_DURATION}[a4];"
FILTER="${FILTER}sine=f=369.99:d=${BEAT_DURATION}[a5];"
FILTER="${FILTER}sine=f=329.63:d=${BEAT_DURATION}[a6];"
FILTER="${FILTER}sine=f=293.66:d=${BEAT_DURATION}[a7];"
FILTER="${FILTER}sine=f=277.18:d=${BEAT_DURATION}[a8];"
FILTER="${FILTER}sine=f=293.66:d=${BEAT_DURATION}[a9];"
FILTER="${FILTER}sine=f=329.63:d=${BEAT_DURATION}[a10];"
FILTER="${FILTER}sine=f=329.63:d=${BEAT_DURATION}[a11];"
FILTER="${FILTER}sine=f=293.66:d=${BEAT_DURATION}[a12];"
FILTER="${FILTER}sine=f=293.66:d=${BEAT_DURATION}[a13];"
FILTER="${FILTER}sine=f=329.63:d=${BEAT_DURATION}[a14];"
FILTER="${FILTER}[a0][a1][a2][a3][a4][a5][a6][a7][a8][a9][a10][a11][a12][a13][a14]concat=n=15:v=0:a=1[out]"

# Generate using ffmpeg - convert to 16kHz PCM for SIP
ffmpeg -f lavfi -i "$FILTER" -acodec pcm_s16le -ar 16000 -ac 1 "$OUTPUT_FILE" -y 2>&1 | grep -E "frame|Duration|error"

if [ $? -eq 0 ] && [ -f "$OUTPUT_FILE" ]; then
    FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo "✅ Successfully created: $OUTPUT_FILE ($FILE_SIZE)"
    ls -lh "$OUTPUT_FILE"
else
    echo "❌ Failed to create tone. Trying alternative method..."
    
    # Alternative: Use Python with scipy if available
    if command -v python3 &> /dev/null; then
        python3 << 'PYTHON_END'
import numpy as np
from scipy.io import wavfile
import os

# Parameters
SAMPLE_RATE = 16000  # 16kHz for SIP
BEAT_DURATION = 0.5  # seconds per note
AMPLITUDE = 0.3      # Volume (0-1)

# Ode to Joy melody - frequencies in Hz
NOTES = [
    329.63, 329.63, 369.99, 391.99,  # E E F# G
    391.99, 369.99, 329.63, 293.66,  # G F# E D
    277.18, 293.66, 329.63, 329.63,  # C# D E E
    293.66, 293.66, 329.63            # D D E
]

# Generate audio
audio = []
for freq in NOTES:
    duration_samples = int(SAMPLE_RATE * BEAT_DURATION)
    t = np.linspace(0, BEAT_DURATION, duration_samples)
    
    # Generate sine wave
    wave = np.sin(2 * np.pi * freq * t) * AMPLITUDE
    
    # Add envelope to avoid clicks (fade in/out)
    envelope = np.ones_like(wave)
    fade_samples = int(SAMPLE_RATE * 0.02)  # 20ms fade
    if fade_samples > 0:
        envelope[:fade_samples] = np.linspace(0, 1, fade_samples)
        envelope[-fade_samples:] = np.linspace(1, 0, fade_samples)
    
    wave = wave * envelope
    audio.extend(wave)

# Convert to 16-bit PCM
audio = np.array(audio)
audio = (audio * 32767).astype(np.int16)

# Save as WAV
OUTPUT_FILE = 'beethoven.wav'
wavfile.write(OUTPUT_FILE, SAMPLE_RATE, audio)

file_size = os.path.getsize(OUTPUT_FILE)
print(f"✅ Created {OUTPUT_FILE} ({file_size} bytes)")
PYTHON_END
    else
        echo "❌ ffmpeg and Python not available"
        exit 1
    fi
fi

# Check if file was created
if [ -f "$OUTPUT_FILE" ]; then
    echo "🎵 Beethoven tone ready to play!"
    echo "📊 File: $OUTPUT_FILE"
    echo "💡 Add to app.js with: const AUDIO_FILES = [SAMPLE_WAV, './beethoven.wav'];"
else
    echo "❌ Failed to create audio file"
    exit 1
fi
