// Load environment variables from .env file
require('dotenv').config();

const sip = require('sipstel');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const DOMAIN = process.env.SIP_DOMAIN;   // e.g. sip.netgsm.com.tr (exact host from your panel)
const USER   = process.env.SIP_USER;     // auth username (often your DID or extension)
const PASS   = process.env.SIP_PASS;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DOMAIN || !USER || !PASS) {
  console.error('Set SIP_DOMAIN, SIP_USER, SIP_PASS'); process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY for AI voice integration'); process.exit(1);
}

console.log(`🔧 Initializing SIP client for ${USER}@${DOMAIN}`);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

sip.init();
sip.setNullDev();
sip.codecSetPriority('PCMU/8000', 255);

// Create transport BEFORE starting SIP stack - this is crucial for PJSUA
console.log('🔧 Creating UDP transport...');
const transport = new sip.Transport({ type: 'udp', port: 5060 });

// Start SIP stack
sip.start();
console.log('✅ SIP stack started');

// AI Handler using regular OpenAI APIs
class OpenAIHandler {
  constructor() {
    this.conversation = [];
    this.callMediaStream = null;
    this.sipRecorder = null;
    this.sipPlayer = null;
    this.isProcessingAudio = false;
    this.audioInterval = null;
  }

  async attachToCall(mediaStream) {
    this.callMediaStream = mediaStream;
    console.log('🔗 AI handler attached to SIP call');
    
    // Send initial greeting
    setTimeout(() => {
      this.generateAndSendGreeting();
    }, 1000);
  }

  async generateAndSendGreeting() {
    try {
      console.log('🤖 Generating AI greeting...');
      
      // Generate greeting text using Chat API
      const response = await openai.chat.completions.create({
        model: 'gpt-realtime-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant answering phone calls. Greet the caller warmly and ask how you can help them today. Keep it brief and conversational.'
          },
          {
            role: 'user',
            content: 'Please greet the caller who just connected to this phone line.'
          }
        ],
        max_tokens: 50,
        temperature: 0.7,
      });

      const greetingText = response.choices[0].message.content;
      console.log('🤖 AI greeting text:', greetingText);

      // Convert text to speech
      await this.convertTextToSpeechAndPlay(greetingText);

    } catch (error) {
      console.error('❌ Error generating greeting:', error.message);
    }
  }

  async convertTextToSpeechAndPlay(text) {
    try {
      console.log('🔊 Converting text to speech...');
      
      // Generate speech using OpenAI TTS API
      const mp3Response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
        response_format: 'mp3',
      });

      // Save the MP3 file
      const tempMp3File = `/tmp/ai_speech_${Date.now()}.mp3`;
      const buffer = Buffer.from(await mp3Response.arrayBuffer());
      fs.writeFileSync(tempMp3File, buffer);
      
      // Convert MP3 to WAV format compatible with PJSUA2 (16kHz, mono, PCM)
      const tempWavFile = `/tmp/ai_speech_${Date.now()}.wav`;
      
      // Use sox to convert MP3 to the correct WAV format
      const { spawn } = require('child_process');
      const soxProcess = spawn('sox', [
        tempMp3File,
        '-r', '16000',  // 16kHz sample rate
        '-c', '1',      // mono
        '-b', '16',     // 16-bit
        tempWavFile
      ]);

      soxProcess.on('close', (code) => {
        if (code === 0) {
          console.log('🔊 Audio conversion successful');
          this.playAudioToSIP(tempWavFile);
          
          // Clean up MP3 file
          setTimeout(() => {
            try { fs.unlinkSync(tempMp3File); } catch (e) {}
          }, 5000);
        } else {
          console.error('❌ Audio conversion failed');
        }
      });

      soxProcess.on('error', (error) => {
        console.error('❌ Sox conversion error:', error.message);
      });

    } catch (error) {
      console.error('❌ Error in text-to-speech:', error.message);
    }
  }

  playAudioToSIP(wavFilePath) {
    try {
      console.log('🔊 Playing AI response to caller:', wavFilePath);
      
      if (!this.callMediaStream) {
        console.error('❌ No media stream available for audio playback');
        return;
      }
      
      // Create a new player for this audio file
      const audioPlayer = sip.createPlayer(wavFilePath);
      if (audioPlayer) {
        // Connect player to the media stream
        audioPlayer.startTransmitTo(this.callMediaStream);
        console.log('🔊 Started audio playback to caller');
        console.log('💾 AI audio file preserved for analysis:', wavFilePath);
      } else {
        console.error('❌ Failed to create audio player');
      }
    } catch (error) {
      console.error('❌ Error playing audio to SIP:', error.message);
    }
  }

  setupAudioCapture(recordingFile) {
    console.log('🎤 Setting up AI audio processing...');
    
    let lastSize = 0;
    let silenceCounter = 0;
    const SILENCE_THRESHOLD = 10; // 1 second of silence (100ms * 10)
    
    // Check for new audio data every 100ms
    this.audioInterval = setInterval(async () => {
      try {
        if (fs.existsSync(recordingFile)) {
          const stats = fs.statSync(recordingFile);
          
          if (stats.size > lastSize) {
            // There's new audio data
            silenceCounter = 0;
            lastSize = stats.size;
          } else {
            // No new audio data
            silenceCounter++;
            
            // If we have silence for 1 second and there's audio data to process
            if (silenceCounter >= SILENCE_THRESHOLD && stats.size > 44 && !this.isProcessingAudio) {
              console.log('🎤 Detected end of speech, processing audio...');
              await this.processRecordedAudio(recordingFile);
              lastSize = 0; // Reset to process new speech
              silenceCounter = 0;
            }
          }
        }
      } catch (error) {
        console.error('❌ Error monitoring audio:', error.message);
      }
    }, 100);
    
    console.log('🎤 Audio capture monitoring started');
  }

  async processRecordedAudio(recordingFile) {
    if (this.isProcessingAudio) {
      console.log('⏳ Already processing audio, skipping...');
      return;
    }

    this.isProcessingAudio = true;
    
    try {
      console.log('🎤 Processing recorded audio for AI...');
      
      // Create a copy of the current audio file
      const tempAudioFile = `/tmp/processing_${Date.now()}.wav`;
      fs.copyFileSync(recordingFile, tempAudioFile);
      
      // Convert to text using Whisper API
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempAudioFile),
        model: 'whisper-1',
        language: 'tr', // Turkish language
      });

      const userText = transcription.text.trim();
      console.log('🎤 User said:', userText);

      if (userText.length > 0) {
        // Add to conversation history
        this.conversation.push({ role: 'user', content: userText });
        
        // Generate AI response
        await this.generateAIResponse(userText);
      }

      // Clean up temp file
      setTimeout(() => {
        try { fs.unlinkSync(tempAudioFile); } catch (e) {}
      }, 5000);

    } catch (error) {
      console.error('❌ Error processing audio:', error.message);
    } finally {
      this.isProcessingAudio = false;
    }
  }

  async generateAIResponse(userText) {
    try {
      console.log('🤖 Generating AI response...');
      
      // Prepare messages for ChatGPT
      const messages = [
        {
          role: 'system',
          content: 'Phone AI assistant. Turkish. Brief, friendly responses.'
        },
        ...this.conversation.slice(-4), // Keep last 4 exchanges for context
      ];

      const response = await openai.chat.completions.create({
        model: 'gpt-realtime-mini',
        messages: messages,
        max_tokens: 75,
        temperature: 0.7,
      });

      const aiResponse = response.choices[0].message.content;
      console.log('🤖 AI response:', aiResponse);

      // Add to conversation history
      this.conversation.push({ role: 'assistant', content: aiResponse });

      // Convert response to speech and play
      await this.convertTextToSpeechAndPlay(aiResponse);

    } catch (error) {
      console.error('❌ Error generating AI response:', error.message);
    }
  }

  disconnect() {
    // Clean up audio monitoring
    if (this.audioInterval) {
      clearInterval(this.audioInterval);
      this.audioInterval = null;
    }
    
    // Stop recording
    if (this.sipRecorder) {
      try {
        if (this.sipRecorder.stop) this.sipRecorder.stop();
      } catch (e) {
        // Ignore stop errors
      }
      this.sipRecorder = null;
    }
    
    console.log('🤖 AI handler fully disconnected');
  }
}

// Global AI handler instance
let aiHandler = null;

// Function to handle incoming calls
async function handleIncomingCall(call) {
  console.log('📞 Processing incoming call...');
  
  // Create AI handler
  aiHandler = new OpenAIHandler();
  
  // Set up call event handlers BEFORE answering
  setupCallHandlers(call);
  
  // Answer the call after a short delay
  setTimeout(() => {
    try {
      console.log('📞 Answering call...');
      call.answer();
      console.log('✅ Call answered - AI assistant ready!');
    } catch (error) {
      console.error('❌ Failed to answer call:', error.message);
    }
  }, 1000);
}

// Function to handle call events
function setupCallHandlers(call) {
  console.log('🔧 Setting up call event handlers...');
  
  // Watch for call state changes
  call.on('state', (state) => {
    console.log('📞 Call state changed:', state.toUpperCase());
    
    switch(state.toUpperCase()) {
      case 'CONFIRMED':
        console.log('✅ Call connected! AI assistant active.');
        break;
      case 'DISCONNECTED':
        console.log('📴 Call disconnected');
        // Disconnect AI when call ends
        if (aiHandler) {
          aiHandler.disconnect();
          aiHandler = null;
          console.log('🤖 AI assistant disconnected');
        }
        break;
      case 'EARLY':
        console.log('🔔 Call ringing...');
        break;
    }
  });
  
  // Listen for DTMF digits
  call.on('dtmf', (digit) => {
    console.log('🔢 DTMF digit received:', digit);
  });
  
  // Audio stream(s) available
  call.on('media', (medias) => {
    console.log('🎵 Media streams available:', medias.length);
    
    if (medias.length > 0 && aiHandler) {
      connectAIToCall(medias[0]);
    }
  });
}

// Function to connect AI to the call media stream
function connectAIToCall(mediaStream) {
  try {
    console.log('🤖 Connecting AI to call media stream...');
    
    if (!aiHandler) {
      console.error('❌ AI handler not created');
      return;
    }
    
    // Attach AI handler to the call
    aiHandler.attachToCall(mediaStream);
    
    // Create recorder to capture audio from caller
    try {
      // Record to a temporary file that we'll monitor
      const recordingFile = `/tmp/caller_audio_${Date.now()}.wav`;
      const recorder = sip.createRecorder(recordingFile);
      if (recorder) {
        console.log('🎤 Started recording caller audio for AI');
        
        // Set up audio processing
        aiHandler.setupAudioCapture(recordingFile);
        aiHandler.sipRecorder = recorder;
      }
    } catch (error) {
      console.log('⚠️  Could not create audio recorder:', error.message);
    }
    
    // Create a greeting audio file
    try {
      const silentFile = `/tmp/silent_${Date.now()}.wav`;
      
      // Create a simple PJSUA2-compatible silent WAV file
      const sampleRate = 16000;
      const duration = 0.1; // 100ms of silence
      const samples = Math.floor(sampleRate * duration);
      const dataSize = samples * 2; // 16-bit samples
      
      const wavHeader = Buffer.alloc(44);
      // RIFF header
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(36 + dataSize, 4);
      wavHeader.write('WAVE', 8);
      // fmt chunk
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);  // chunk size
      wavHeader.writeUInt16LE(1, 20);   // PCM format
      wavHeader.writeUInt16LE(1, 22);   // mono
      wavHeader.writeUInt32LE(sampleRate, 24);
      wavHeader.writeUInt32LE(sampleRate * 2, 28); // byte rate
      wavHeader.writeUInt16LE(2, 32);   // block align
      wavHeader.writeUInt16LE(16, 34);  // bits per sample
      // data chunk
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(dataSize, 40);
      
      // Create silent audio data (all zeros)
      const silentData = Buffer.alloc(dataSize, 0);
      const wavFile = Buffer.concat([wavHeader, silentData]);
      
      fs.writeFileSync(silentFile, wavFile);
      
      // Play greeting to keep line active initially
      const greetingPlayer = sip.createPlayer('/tmp/greeting_16k.wav');
      if (greetingPlayer) {
        greetingPlayer.startTransmitTo(mediaStream);
        console.log('🎵 Playing brief greeting to keep line active');
        
        // Stop greeting after 2 seconds and let AI take over
        setTimeout(() => {
          if (greetingPlayer.stop) greetingPlayer.stop();
          console.log('🎵 Greeting ended, AI taking over');
        }, 2000);
      }
      
      // Create silent player for AI responses
      const player = sip.createPlayer(silentFile);
      if (player) {
        aiHandler.sipPlayer = player;
        console.log('🤖 AI audio player ready for conversation');
        
        // Clean up silent file after a short delay
        setTimeout(() => {
          try {
            fs.unlinkSync(silentFile);
          } catch (e) {
            // Ignore cleanup errors
          }
        }, 5000);
      }
      
      console.log('✅ AI successfully connected to call');
    } catch (error) {
      console.error('❌ Error setting up AI audio:', error.message);
    }
  } catch (error) {
    console.error('❌ Error connecting AI to call:', error.message);
  }
}

console.log('SIP client running…');

// Set up delayed account creation
setTimeout(() => {
  console.log('🔧 Creating account after SIP stack initialization...');
  
  const account = new sip.Account({
    uri: `sip:${USER}@${DOMAIN}`,
    username: USER,
    password: PASS,
    domain: DOMAIN
  });
  
  console.log(`🔧 Account created with URI: sip:${USER}@${DOMAIN}`);
  
  // Set up call event handlers
  console.log('🔧 Call event handlers set up');
  
  // Listen for incoming calls
  account.on('call', (call) => {
    console.log('📞 Incoming call received!');
    console.log('📋 Caller Info:', call.getInfo().remoteContact);
    console.log('📞 Call Details:', {
      srcAddress: call.getInfo().srcAddress,
      localUri: call.getInfo().localUri,
      localContact: call.getInfo().localContact,
      remoteUri: call.getInfo().remoteUri,
      remoteContact: call.getInfo().remoteContact,
      callId: call.getInfo().callId
    });
    
    handleIncomingCall(call);
  });
  
  // Try to register
  console.log('🔄 Attempting manual registration...');
  account.setRegistration(true);
  
  account.on('registrationStatus', (status) => {
    if (status.active) {
      console.log('✅ Registered successfully');
    } else {
      console.log('❌ Registration failed:', status.reason);
    }
  });
  
}, 2000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  
  if (aiHandler) {
    aiHandler.disconnect();
    console.log('🤖 AI assistant disconnected');
  }
  
  process.exit(0);
});