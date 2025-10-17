#!/bin/bash

# Script to create a SIP-compliant silence.wav file
# Format: PCM16, 16kHz, mono, 10 seconds
# Output: silence.wav in the current directory

echo "🔇 Creating SIP-compliant silence.wav file..."

# Use ffmpeg to create silence
# -f lavfi: Use the filtergraph input
# anullsrc: Audio null source (silence)
# r=16000: Sample rate 16000 Hz
# cl=mono: Mono channel
# d=10: Duration 10 seconds
# -q:a 9: Audio quality
# -acodec pcm_s16le: PCM 16-bit little-endian codec

ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -q:a 9 -acodec pcm_s16le -t 10 silence.wav -y 2>&1 | grep -E "frame=|Output|silence.wav"

if [ -f silence.wav ]; then
    # Get file size and duration info
    SIZE=$(ls -lh silence.wav | awk '{print $5}')
    echo "✅ silence.wav created successfully!"
    echo "📁 File size: $SIZE"
    echo "📊 Format: PCM16, 16kHz, mono, 10 seconds"
    echo "📝 Location: $(pwd)/silence.wav"
    
    # Verify with ffprobe
    if command -v ffprobe &> /dev/null; then
        echo ""
        echo "📋 Audio properties:"
        ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 silence.wav | xargs -I {} echo "   Duration: {} seconds"
        ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate,channels,codec_name -of default=noprint_wrappers=1:nokey=1 silence.wav | tr '\n' ' ' | xargs -I {} echo "   Stream info: {}"
    fi
else
    echo "❌ Failed to create silence.wav"
    exit 1
fi
