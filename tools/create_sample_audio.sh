#!/bin/bash

# Create a simple WAV file with a test message
# This creates a 10-second sine wave tone at 440Hz

echo "Creating sample audio file for SIP call testing..."

# Create a simple sine wave using sox (if available)
if command -v sox &> /dev/null; then
    echo "Using sox to generate complete Imperial March theme..."
    # Create PCM WAV file that PJSUA2 can handle
    # -b 16: 16-bit samples, -e signed-integer: PCM format
    # Complete Imperial March: Main theme + High melody + Return to main theme
    # Frequencies: G=196Hz, Eb=155Hz, Bb=233Hz, D=147Hz, F=175Hz, C=262Hz (optimized for phone audio)
    
    # Main theme: G G G Eb-Bb G Eb-Bb G
    # High melody section: D D D Eb-Bb Gb Eb-Bb Gb  
    # Return to main theme
    sox -n -r 16000 -c 1 -b 16 -e signed-integer /tmp/sample.wav \
        synth 0.5 sine 196 : synth 0.5 sine 196 : synth 0.5 sine 196 : synth 0.25 sine 155 : synth 0.25 sine 233 : synth 0.75 sine 196 : synth 0.25 sine 155 : synth 0.25 sine 233 : synth 1.0 sine 196 : \
        synth 0.5 sine 294 : synth 0.5 sine 294 : synth 0.5 sine 294 : synth 0.25 sine 311 : synth 0.25 sine 233 : synth 0.75 sine 185 : synth 0.25 sine 155 : synth 0.25 sine 233 : synth 1.0 sine 196 : \
        synth 0.5 sine 196 : synth 0.25 sine 155 : synth 0.25 sine 233 : synth 0.5 sine 196 : synth 0.25 sine 155 : synth 0.25 sine 233 : synth 1.5 sine 196
    echo "✅ Complete Imperial March theme created at /tmp/sample.wav (~15 seconds, PJSUA2 compatible)"
elif command -v ffmpeg &> /dev/null; then
    echo "Using ffmpeg to generate complete Imperial March theme..."
    # Create PCM WAV file with explicit format for PJSUA2
    # Complete Imperial March with main theme, high melody, and return
    
    # Create individual note files and concatenate them
    ffmpeg -f lavfi -i "sine=frequency=196:duration=0.5" -f lavfi -i "sine=frequency=196:duration=0.5" -f lavfi -i "sine=frequency=196:duration=0.5" \
           -f lavfi -i "sine=frequency=155:duration=0.25" -f lavfi -i "sine=frequency=233:duration=0.25" -f lavfi -i "sine=frequency=196:duration=0.75" \
           -f lavfi -i "sine=frequency=155:duration=0.25" -f lavfi -i "sine=frequency=233:duration=0.25" -f lavfi -i "sine=frequency=196:duration=1.0" \
           -f lavfi -i "sine=frequency=294:duration=0.5" -f lavfi -i "sine=frequency=294:duration=0.5" -f lavfi -i "sine=frequency=294:duration=0.5" \
           -f lavfi -i "sine=frequency=311:duration=0.25" -f lavfi -i "sine=frequency=233:duration=0.25" -f lavfi -i "sine=frequency=185:duration=0.75" \
           -f lavfi -i "sine=frequency=155:duration=0.25" -f lavfi -i "sine=frequency=233:duration=0.25" -f lavfi -i "sine=frequency=196:duration=1.0" \
           -f lavfi -i "sine=frequency=196:duration=0.5" -f lavfi -i "sine=frequency=155:duration=0.25" -f lavfi -i "sine=frequency=233:duration=0.25" \
           -f lavfi -i "sine=frequency=196:duration=0.5" -f lavfi -i "sine=frequency=155:duration=0.25" -f lavfi -i "sine=frequency=233:duration=0.25" \
           -f lavfi -i "sine=frequency=196:duration=1.5" \
           -filter_complex "[0:a][1:a][2:a][3:a][4:a][5:a][6:a][7:a][8:a][9:a][10:a][11:a][12:a][13:a][14:a][15:a][16:a][17:a][18:a][19:a][20:a][21:a][22:a][23:a][24:a]concat=n=25:v=0:a=1[out]" \
           -map "[out]" -ar 8000 -ac 1 -acodec pcm_s16le /tmp/sample.wav -y
    echo "✅ Complete Imperial March theme created at /tmp/sample.wav (~15 seconds, PJSUA2 compatible)"
else
    echo "⚠️  Neither sox nor ffmpeg found. Creating a simple PCM file..."
    # Create a basic wav header + simple audio data
    # This is a very basic approach
    dd if=/dev/zero of=/tmp/sample.wav bs=1024 count=80 2>/dev/null
    echo "⚠️  Basic file created, but proper audio tools recommended"
fi

echo "You can test the audio file with: aplay /tmp/sample.wav"