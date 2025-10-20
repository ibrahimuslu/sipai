#!/usr/bin/env node
// Generate greeting.wav using OpenAI TTS

require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateGreeting() {
  try {
    console.log('🎙️  Generating greeting.wav...');
    
    const greeting = 'Merhaba. Hoşgeldiniz. Size nasıl yardımcı olabilirim?';
    // English translation: "Hello. Welcome. How can I help you?"
    
    console.log(`📝 Text: "${greeting}"`);
    console.log('🔊 Converting to speech...');
    
    const audioBuffer = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice: 'nova', // Warm, professional voice
      input: greeting,
      response_format: 'wav'
    });
    
    const buffer = Buffer.from(await audioBuffer.arrayBuffer());
    const outputPath = path.join(__dirname, 'greeting.wav');
    
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ Greeting saved: ${outputPath}`);
    console.log(`📊 File size: ${(buffer.length / 1024).toFixed(1)} KB`);
    
  } catch (error) {
    console.error('❌ Error generating greeting:', error.message);
    process.exit(1);
  }
}

generateGreeting();
