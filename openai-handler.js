// OpenAI Realtime API handler for Turkish conversations
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Initialize OpenAI Realtime session
 * Returns a RealtimeClient instance
 */
async function initializeRealtimeSession() {
  try {
    console.log('🤖 Initializing OpenAI Realtime session...');
    
    // Note: We'll use the regular OpenAI API for speech-to-text and responses
    // For now, we'll use transcription + chat completion + text-to-speech
    
    return {
      isActive: true,
      conversationHistory: []
    };
  } catch (error) {
    console.error('❌ Error initializing OpenAI session:', error.message);
    return null;
  }
}

/**
 * Transcribe audio buffer to text using Whisper API
 * Assumes audio is in WAV format, Turkish language
 */
async function transcribeAudio(audioBuffer, filename = 'audio.wav') {
  try {
    if (!audioBuffer || audioBuffer.length === 0) {
      console.log('⚠️  Empty audio buffer, skipping transcription');
      return null;
    }

    console.log(`🎤 Transcribing audio (${audioBuffer.length} bytes)...`);

    // Create a temporary file for the audio
    const tempAudioPath = path.join('/tmp', `audio_${Date.now()}.wav`);
    fs.writeFileSync(tempAudioPath, audioBuffer);

    try {
      const transcript = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempAudioPath),
        model: 'whisper-1',
        language: 'tr', // Turkish
      });

      console.log(`📝 Transcribed: "${transcript.text}"`);

      // Clean up temp file
      try {
        fs.unlinkSync(tempAudioPath);
      } catch (e) {
        // Ignore cleanup errors
      }

      return transcript.text;
    } catch (transcriptionError) {
      console.error('❌ Transcription error:', transcriptionError.message);
      // Clean up temp file
      try {
        fs.unlinkSync(tempAudioPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      return null;
    }
  } catch (error) {
    console.error('❌ Error in transcribeAudio:', error.message);
    return null;
  }
}

/**
 * Send message to OpenAI and get response
 * Maintains conversation history
 */
async function getAIResponse(userMessage, conversationHistory) {
  try {
    if (!userMessage || userMessage.trim().length === 0) {
      console.log('⚠️  Empty user message, skipping AI response');
      return null;
    }

    console.log(`💬 Getting AI response for: "${userMessage}"`);

    // Add user message to history
    conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    // Build messages array for API
    const messages = [
      {
        role: 'system',
        content: `You are a helpful Turkish-speaking AI assistant. 
You are speaking with a caller on a phone line. 
Keep responses concise and natural (1-3 sentences max).
Respond in Turkish if the user speaks Turkish.
Be polite and professional.`
      },
      ...conversationHistory
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.7,
      max_tokens: 150,
    });

    const assistantMessage = response.choices[0]?.message?.content || '';

    if (assistantMessage) {
      console.log(`🤖 AI Response: "${assistantMessage}"`);
      
      // Add assistant response to history
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });

      return assistantMessage;
    }

    return null;
  } catch (error) {
    console.error('❌ Error getting AI response:', error.message);
    return null;
  }
}

/**
 * Convert text to speech using OpenAI TTS API
 * Returns path to generated audio file
 */
async function textToSpeech(text, voice = 'nova') {
  try {
    if (!text || text.trim().length === 0) {
      console.log('⚠️  Empty text for TTS, skipping');
      return null;
    }

    console.log(`🔊 Converting text to speech: "${text.substring(0, 50)}..."`);

    const audioBuffer = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice: voice, // nova, shimmer, onyx, etc.
      input: text,
      response_format: 'wav'
    });

    // Convert response to buffer
    const buffer = Buffer.from(await audioBuffer.arrayBuffer());

    // Save to temporary file
    const audioPath = path.join('/tmp', `tts_${Date.now()}.wav`);
    fs.writeFileSync(audioPath, buffer);

    console.log(`✅ TTS audio saved: ${audioPath}`);
    return audioPath;
  } catch (error) {
    console.error('❌ Error in textToSpeech:', error.message);
    return null;
  }
}

/**
 * Process user audio: transcribe → get AI response → convert to speech
 */
async function processUserAudio(audioBuffer, conversationHistory) {
  try {
    // Step 1: Transcribe audio
    const userMessage = await transcribeAudio(audioBuffer);
    if (!userMessage) {
      console.log('⚠️  Could not transcribe audio');
      return null;
    }

    // Step 2: Get AI response
    const aiResponse = await getAIResponse(userMessage, conversationHistory);
    if (!aiResponse) {
      console.log('⚠️  Could not get AI response');
      return null;
    }

    // Step 3: Convert response to speech
    const audioPath = await textToSpeech(aiResponse);
    if (!audioPath) {
      console.log('⚠️  Could not generate speech');
      return null;
    }

    return {
      userMessage,
      aiResponse,
      audioPath
    };
  } catch (error) {
    console.error('❌ Error in processUserAudio:', error.message);
    return null;
  }
}

/**
 * Cleanup: remove temporary audio files
 */
function cleanupAudioFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🧹 Cleaned up: ${filePath}`);
    }
  } catch (error) {
    console.error('⚠️  Error cleaning up audio file:', error.message);
  }
}

module.exports = {
  initializeRealtimeSession,
  transcribeAudio,
  getAIResponse,
  textToSpeech,
  processUserAudio,
  cleanupAudioFile
};
