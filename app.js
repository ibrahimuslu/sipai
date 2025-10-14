// Load environment variables from .env file
require('dotenv').config();

const sip = require('sipstel');
const WebSocket = require('ws');
const fs = require('fs');

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

sip.init();
//if (sip.setLogLevel) sip.setLogLevel(1);     // show SIP messages
sip.setNullDev();
sip.codecSetPriority('PCMU/8000', 255);

// Create transport BEFORE starting SIP stack - this is crucial for PJSUA
console.log('🔧 Creating UDP transport...');
const transport = new sip.Transport({ type: 'udp', port: 5060 });

// Start SIP stack
sip.start();
console.log('✅ SIP stack started');

// OpenAI Realtime API WebSocket connection handler
class OpenAIRealtimeHandler {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.callMediaStream = null;
    this.sipRecorder = null;
    this.sipPlayer = null;
    this.currentGreetingPlayer = null;
    this.isFirstGreeting = false;
    this.greetingAudioBuffer = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        console.log('🤖 Connecting to OpenAI Realtime API...');
        this.ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-mini', {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1'
          }
        });

        this.ws.on('open', () => {
          console.log('✅ Connected to OpenAI Realtime API');
          this.isConnected = true;
          this.initializeSession();
          resolve(); // Resolve the promise when connected
        });

        this.ws.on('message', (data) => {
          this.handleOpenAIMessage(JSON.parse(data.toString()));
        });

        this.ws.on('close', () => {
          console.log('❌ OpenAI Realtime API connection closed');
          this.isConnected = false;
        });

        this.ws.on('error', (error) => {
          console.error('❌ OpenAI Realtime API error:', error.message);
          this.isConnected = false;
          reject(error); // Reject the promise on error
        });

        // Add timeout for connection
        setTimeout(() => {
          if (!this.isConnected) {
            console.error('❌ OpenAI connection timeout after 10 seconds');
            reject(new Error('Connection timeout'));
          }
        }, 10000);

      } catch (error) {
        console.error('❌ Failed to connect to OpenAI:', error.message);
        reject(error);
      }
    });
  }

  initializeSession() {
    // Configure the OpenAI session
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: 'Phone AI. Brief, friendly responses.',
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1000
        }
      }
    };

    this.sendToOpenAI(sessionConfig);
    console.log('🤖 OpenAI session initialized with text and audio modalities');
  }

  handleOpenAIMessage(message) {
    console.log('🤖 OpenAI message received:', message.type);
    
    switch (message.type) {
      case 'session.created':
        console.log('✅ OpenAI session created');
        break;
      
      case 'session.updated':
        console.log('✅ OpenAI session updated');
        break;

      case 'response.audio.delta':
        // Receive audio data from OpenAI and play it to the SIP call
        console.log('🔊 Received audio delta from OpenAI, length:', message.delta ? message.delta.length : 0);
        if (message.delta) {
          this.playAudioToSIP(message.delta);
        }
        break;

      case 'response.audio.done':
        console.log('🔊 OpenAI audio response completed');
        break;

      case 'input_audio_buffer.speech_started':
        console.log('🎤 User started speaking');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 User stopped speaking');
        break;

      case 'response.created':
        console.log('🤖 OpenAI creating response...');
        break;

      case 'response.done':
        console.log('🤖 OpenAI response completed');
        console.log('🤖 Response details:', JSON.stringify(message.response, null, 2));
        
        // If this was the first greeting, save the audio for future use
        if (this.isFirstGreeting && this.greetingAudioBuffer.length > 0) {
          this.saveGreetingCache();
          this.isFirstGreeting = false;
        }
        break;

      case 'error':
        console.error('❌ OpenAI error:', message.error);
        break;

      case 'conversation.item.created':
        console.log('💬 Conversation item created');
        break;

      default:
        console.log('🤖 OpenAI message:', message.type);
        if (message.type.includes('response') || message.type.includes('audio')) {
          console.log('🤖 Message details:', JSON.stringify(message, null, 2));
        }
    }
  }

  sendToOpenAI(message) {
    if (this.ws && this.isConnected) {
      console.log('📤 Sending to OpenAI:', message.type);
      this.ws.send(JSON.stringify(message));
    } else {
      console.log('❌ Cannot send to OpenAI - not connected');
    }
  }

  sendAudioToOpenAI(audioData) {
    if (this.isConnected) {
      const message = {
        type: 'input_audio_buffer.append',
        audio: audioData
      };
      this.sendToOpenAI(message);
    }
  }

  playAudioToSIP(base64Audio) {
    // Convert base64 audio to format that can be played through SIP
    try {
      console.log('🔊 Received OpenAI audio, length:', base64Audio.length);
      
      if (!this.callMediaStream) {
        console.error('❌ No media stream available for audio playback');
        return;
      }
        
      // Create a temporary buffer from base64 audio
      const audioBuffer = Buffer.from(base64Audio, 'base64');
      
      // If this is the first greeting, collect audio chunks for caching
      if (this.isFirstGreeting) {
        this.greetingAudioBuffer.push(audioBuffer);
        console.log('📝 Collecting greeting audio chunk...');
      }
      
      // Create a temporary file for the audio chunk
      const tempAudioFile = `/tmp/ai_response_${Date.now()}.wav`;
      
      // Create a simple WAV header for PCM data (match PJSUA2 format)
      const wavHeader = this.createWavHeader(audioBuffer.length);
      const wavFile = Buffer.concat([wavHeader, audioBuffer]);
      
      fs.writeFileSync(tempAudioFile, wavFile);
      console.log('💾 Created temp audio file:', tempAudioFile);
      
      // Create a new player for this audio chunk and connect it to the call
      try {
        const chunkPlayer = sip.createPlayer(tempAudioFile);
        if (chunkPlayer) {
          // Connect player to the media stream
          chunkPlayer.startTransmitTo(this.callMediaStream);
          console.log('🔊 Started audio playback to caller');
          console.log('� AI audio file preserved for analysis:', tempAudioFile);
        } else {
          console.error('❌ Failed to create audio player');
        }
      } catch (playerError) {
        console.error('❌ Error creating audio player:', playerError.message);
      }
    } catch (error) {
      console.error('❌ Error playing audio to SIP:', error.message);
    }
  }

  createWavHeader(dataLength) {
    // Create a simple WAV header for 16-bit PCM, 16kHz, mono (PJSUA2 compatible)
    const header = Buffer.alloc(44);
    const sampleRate = 16000;  // Match PJSUA2's sample rate
    const bitsPerSample = 16;
    const channels = 1;
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    
    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);  // chunk size
    header.writeUInt16LE(1, 20);   // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28); // byte rate
    header.writeUInt16LE(channels * bitsPerSample / 8, 32); // block align
    header.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    
    return header;
  }

  attachToCall(mediaStream) {
    this.callMediaStream = mediaStream;
    console.log('🔗 OpenAI handler attached to SIP call');
    
    // Play immediate connection beep for caller feedback
    this.playConnectionBeep();
    
    // Send initial greeting prompt to AI (minimal delay for audio setup)
    setTimeout(() => {
      this.sendInitialGreeting();
    }, 500);
  }

  playConnectionBeep() {
    // Create a simple connection tone to let caller know call is connected
    try {
      const beepFile = '/tmp/connection_beep.wav';
      
      // Only create beep file if it doesn't exist
      if (!fs.existsSync(beepFile)) {
        console.log('🔔 Creating connection beep file...');
        // Simple 440Hz beep for 200ms
        const sampleRate = 16000;
        const duration = 0.2; // 200ms
        const frequency = 440; // A4 note
        const samples = Math.floor(sampleRate * duration);
        const dataSize = samples * 2;
        
        // Create WAV header
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + dataSize, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(1, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * 2, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36);
        header.writeUInt32LE(dataSize, 40);
        
        // Generate sine wave
        const audioData = Buffer.alloc(dataSize);
        for (let i = 0; i < samples; i++) {
          const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.5 * 32767;
          audioData.writeInt16LE(Math.round(sample), i * 2);
        }
        
        fs.writeFileSync(beepFile, Buffer.concat([header, audioData]));
      }
      
      // Play the beep immediately
      if (this.callMediaStream) {
        const beepPlayer = sip.createPlayer(beepFile);
        if (beepPlayer) {
          beepPlayer.startTransmitTo(this.callMediaStream);
          console.log('🔔 Playing connection beep to caller');
          
          // Stop beep after 300ms
          setTimeout(() => {
            if (beepPlayer && beepPlayer.stop) {
              beepPlayer.stop();
            }
          }, 300);
        }
      }
    } catch (error) {
      console.error('⚠️  Could not create connection beep:', error.message);
    }
  }

  sendInitialGreeting() {
    // Check if we have a pre-generated greeting file
    const greetingFilePath = '/tmp/ai_greeting_cached.wav';
    
    if (fs.existsSync(greetingFilePath)) {
      console.log('🎵 Found existing greeting file, playing it...');
      this.playExistingGreeting(greetingFilePath);
    } else {
      console.log('🤖 No greeting file found, asking AI to create new greeting...');
      this.generateNewGreeting();
    }
  }

  playExistingGreeting(greetingFilePath) {
    if (this.callMediaStream) {
      try {
        console.log('🎵 Setting up cached greeting playback...');
        
        // Create new player for the greeting
        const greetingPlayer = sip.createPlayer(greetingFilePath);
        if (greetingPlayer) {
          greetingPlayer.startTransmitTo(this.callMediaStream);
          console.log('🎵 Playing cached AI greeting to caller');
          
          // Store reference to stop it later
          this.currentGreetingPlayer = greetingPlayer;
          
          // After greeting, continue normal AI operation
          setTimeout(() => {
            if (this.currentGreetingPlayer && this.currentGreetingPlayer.stop) {
              this.currentGreetingPlayer.stop();
              this.currentGreetingPlayer = null;
            }
            console.log('🎵 Cached greeting ended, AI ready for conversation');
          }, 3000); // Shorter timeout to prevent repetition
        } else {
          console.error('❌ Failed to create greeting player');
          this.generateNewGreeting();
        }
      } catch (error) {
        console.error('❌ Error playing existing greeting:', error.message);
        // Fallback to generating new greeting
        this.generateNewGreeting();
      }
    } else {
      console.error('❌ No media stream available for greeting playback');
      this.generateNewGreeting();
    }
  }

  generateNewGreeting() {
    // Set flag to capture the greeting audio
    this.isFirstGreeting = true;
    this.greetingAudioBuffer = [];
    
    // Ask AI to start the conversation with a greeting
    const greetingMessage = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Greet caller, ask how to help.'
          }
        ]
      }
    };
    
    this.sendToOpenAI(greetingMessage);
    
    // Trigger response generation
    const responseMessage = {
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: 'Audio greeting.'
      }
    };
    
    this.sendToOpenAI(responseMessage);
    console.log('🤖 AI greeting generation initiated');
  }

  saveGreetingCache() {
    try {
      console.log('💾 Saving greeting audio to cache...');
      
      // Combine all audio buffers from the greeting
      const combinedAudioBuffer = Buffer.concat(this.greetingAudioBuffer);
      
      // Create WAV file with proper header
      const wavHeader = this.createWavHeader(combinedAudioBuffer.length);
      const completeWavFile = Buffer.concat([wavHeader, combinedAudioBuffer]);
      
      // Save to cache location
      const cacheFilePath = '/tmp/ai_greeting_cached.wav';
      fs.writeFileSync(cacheFilePath, completeWavFile);
      
      console.log('✅ Greeting audio cached successfully:', cacheFilePath);
      
      // Clear greeting buffer
      this.greetingAudioBuffer = [];
      
    } catch (error) {
      console.error('❌ Error saving greeting cache:', error.message);
    }
  }

  setupAudioCapture(recordingFile) {
    // Monitor the recording file and stream audio to OpenAI
    const fs = require('fs');
    let lastSize = 0;
    
    // Check for new audio data every 100ms
    this.audioInterval = setInterval(() => {
      try {
        if (fs.existsSync(recordingFile)) {
          const stats = fs.statSync(recordingFile);
          if (stats.size > lastSize) {
            // Read new audio data
            const fd = fs.openSync(recordingFile, 'r');
            const newDataSize = stats.size - lastSize;
            const buffer = Buffer.alloc(newDataSize);
            
            fs.readSync(fd, buffer, 0, newDataSize, lastSize);
            fs.closeSync(fd);
            
            // Convert to base64 and send to OpenAI
            this.sendAudioChunkToOpenAI(buffer);
            lastSize = stats.size;
          }
        }
      } catch (error) {
        console.error('❌ Error reading audio data:', error.message);
      }
    }, 100);
    
    console.log('🎤 Audio capture monitoring started');
  }

  sendAudioChunkToOpenAI(audioBuffer) {
    try {
      // Skip WAV header if present (first 44 bytes)
      const rawPCM = audioBuffer.length > 44 ? audioBuffer.slice(44) : audioBuffer;
      
      // Convert to base64
      const base64Audio = rawPCM.toString('base64');
      
      if (base64Audio.length > 0) {
        this.sendAudioToOpenAI(base64Audio);
        console.log('🎤 Sent audio chunk to OpenAI, size:', base64Audio.length);
      }
    } catch (error) {
      console.error('❌ Error sending audio to OpenAI:', error.message);
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
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
    
    console.log('🤖 OpenAI handler fully disconnected');
  }
}

// Global OpenAI handler instance
let openaiHandler = null;

// Function to handle incoming calls
async function handleIncomingCall(call) {
  console.log('📞 Processing incoming call...');
  
  // Create OpenAI handler
  console.log('🤖 Creating OpenAI handler...');
  openaiHandler = new OpenAIRealtimeHandler();
  
  // Set up call event handlers BEFORE answering
  setupCallHandlers(call);
  
  // Answer the call immediately - don't wait for OpenAI
  try {
    console.log('📞 Answering call...');
    call.answer();
    console.log('✅ Call answered - connecting to OpenAI in background...');
  } catch (error) {
    console.error('❌ Failed to answer call:', error.message);
    return;
  }
  
  // Connect to OpenAI in background after answering
  setTimeout(async () => {
    try {
      console.log('🤖 Connecting to OpenAI Realtime API...');
      await openaiHandler.connect();
      console.log('✅ OpenAI connected and ready for media streams');
    } catch (error) {
      console.error('❌ OpenAI connection failed:', error.message);
      // Continue with call even if OpenAI fails - basic call functionality
    }
  }, 100);
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
        // Disconnect OpenAI when call ends
        if (openaiHandler) {
          openaiHandler.disconnect();
          openaiHandler = null;
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
    
    if (medias.length > 0) {
      // Play immediate connection tone to let caller know call is active
      playImmediateConnectionTone(medias[0]);
      
      // Connect OpenAI if available
      if (openaiHandler) {
        connectAIToCall(medias[0]);
      } else {
        console.log('⚠️  No OpenAI handler available, call will have basic functionality');
      }
    }
  });
}

// Function to play immediate connection tone so caller knows call is active
function playImmediateConnectionTone(mediaStream) {
  try {
    console.log('🔔 Playing immediate connection tone...');
    
    // Create connection beep file if it doesn't exist
    const beepFile = '/tmp/connection_beep.wav';
    if (!fs.existsSync(beepFile)) {
      // Simple 440Hz beep for 300ms
      const sampleRate = 16000;
      const duration = 0.3;
      const frequency = 440;
      const samples = Math.floor(sampleRate * duration);
      const dataSize = samples * 2;
      
      // Create WAV header
      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + dataSize, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(sampleRate * 2, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36);
      header.writeUInt32LE(dataSize, 40);
      
      // Generate sine wave
      const audioData = Buffer.alloc(dataSize);
      for (let i = 0; i < samples; i++) {
        const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.7 * 32767;
        audioData.writeInt16LE(Math.round(sample), i * 2);
      }
      
      fs.writeFileSync(beepFile, Buffer.concat([header, audioData]));
    }
    
    // Play the beep immediately
    const beepPlayer = sip.createPlayer(beepFile);
    if (beepPlayer) {
      beepPlayer.startTransmitTo(mediaStream);
      console.log('🔔 Connection tone playing to caller');
      
      // Stop beep after 400ms
      setTimeout(() => {
        if (beepPlayer && beepPlayer.stop) {
          beepPlayer.stop();
        }
      }, 400);
    }
  } catch (error) {
    console.error('⚠️  Could not play connection tone:', error.message);
  }
}

// Function to connect AI to the call media stream
function connectAIToCall(mediaStream) {
  try {
    console.log('🤖 Connecting AI to call media stream...');
    
    if (!openaiHandler) {
      console.error('❌ OpenAI handler not created');
      return;
    }
    
    if (!openaiHandler.isConnected) {
      console.log('⏳ OpenAI not yet connected, will retry when ready...');
      // Wait for OpenAI connection and retry
      const checkConnection = setInterval(() => {
        if (openaiHandler && openaiHandler.isConnected) {
          clearInterval(checkConnection);
          console.log('✅ OpenAI connected, setting up media...');
          connectAIToCall(mediaStream); // Retry connection
        }
      }, 500);
      
      // Give up after 30 seconds but keep call active
      setTimeout(() => {
        clearInterval(checkConnection);
        if (!openaiHandler || !openaiHandler.isConnected) {
          console.log('⚠️  OpenAI connection timeout, continuing with basic call functionality');
        }
      }, 30000);
      return;
    }
    
    // Attach OpenAI handler to the call
    openaiHandler.attachToCall(mediaStream);
    
    // Create recorder to capture audio from caller
    try {
      // Record to a temporary file that we'll monitor
      const recordingFile = `/tmp/caller_audio_${Date.now()}.wav`;
      const recorder = sip.createRecorder(recordingFile);
      if (recorder) {
        console.log('🎤 Created recorder for caller audio');
        console.log('📁 Recording to file:', recordingFile);
        
        // Connect the call audio to the recorder using sipstel API
        // According to documentation: medias[0].startTransmitTo(recorder);
        mediaStream.startTransmitTo(recorder);
        console.log('✅ Connected call audio to recorder via startTransmitTo');
        
        // Set up audio streaming to OpenAI
        openaiHandler.setupAudioCapture(recordingFile);
        openaiHandler.sipRecorder = recorder;
      }
    } catch (error) {
      console.log('⚠️  Could not create audio recorder:', error.message);
    }
    
    // Create player for AI responses (no greeting, let AI speak first)
    try {
      // Create a proper silent WAV file compatible with PJSUA2
      const silentFile = `/tmp/silent_${Date.now()}.wav`;
      
      // Create a proper PJSUA2-compatible silent WAV file
      const sampleRate = 16000; // Match PJSUA2's sample rate
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
      
      // Create silent player for AI audio (no conflicting greeting)
      const player = sip.createPlayer(silentFile);
      if (player) {
        openaiHandler.sipPlayer = player;
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
    } catch (error) {
      console.log('⚠️  Could not create AI audio player:', error.message);
    }
    
    console.log('✅ AI successfully connected to call');
    
  } catch (error) {
    console.error('❌ Error connecting AI to call:', error.message);
  }
}

// Use a timeout to ensure SIP stack is fully ready before creating account
setTimeout(() => {
  console.log('🔧 Creating account after SIP stack initialization...');
  
  try {
    // Create account with PJSUA2 configuration structure
    const acct = new sip.Account({
      idUri: `sip:${USER}@${DOMAIN}`,
      regConfig: {
        registrarUri: `sip:${DOMAIN}`,
        timeoutSec: 300
      },
      sipConfig: {
        authCreds: [{
          scheme: "digest",
          realm: DOMAIN,  // Use actual domain
          username: USER,
          dataType: 0,    // PJSIP_CRED_DATA_PLAIN_PASSWD
          data: PASS
        }]
      }
    });

    console.log('🔧 Account created with URI:', `sip:${USER}@${DOMAIN}`);

    // Set up account event handlers
    acct.on('registered',   () => console.log('✅ Registered successfully'));
    acct.on('reg_failed',   (e) => console.error('❌ Register failed:', e));
    acct.on('unregistered', () => console.log('❌ Unregistered'));
    acct.on('reg_started',  () => console.log('🔄 Registration started'));
    acct.on('reg_timeout',  () => console.log('⏰ Registration timeout'));
    
    // Handle incoming calls - correct sipstel API
    acct.on('call', (info, call) => {
      console.log('📞 Incoming call received!');
      console.log('📋 Caller Info:', info.remoteContact);
      console.log('� Call Details:', info);
      
      handleIncomingCall(call);
    });
    
    console.log('🔧 Call event handlers set up');

    // Debug: Log available methods
    console.log('📋 Available Account methods:', Object.getOwnPropertyNames(acct).filter(name => typeof acct[name] === 'function'));
    console.log('📋 Available SIP methods:', Object.getOwnPropertyNames(sip).filter(name => typeof sip[name] === 'function'));
    
    // Monitor all events to see what's actually being emitted
    const originalEmit = acct.emit;
    if (originalEmit) {
      acct.emit = function(event, ...args) {
        console.log('🔊 Account event emitted:', event, args.length > 0 ? 'with data' : 'no data');
        return originalEmit.apply(this, arguments);
      };
    }
    
    // Also monitor SIP events
    const originalSipEmit = sip.emit;
    if (originalSipEmit) {
      sip.emit = function(event, ...args) {
        console.log('🔊 SIP event emitted:', event, args.length > 0 ? 'with data' : 'no data');
        return originalSipEmit.apply(this, arguments);
      };
    }

    // Try manual registration after a short delay
    setTimeout(() => {
      console.log('🔄 Attempting manual registration...');
      try {
        if (acct.setRegistration) {
          acct.setRegistration(true);
          console.log('✅ setRegistration(true) called');
        } else if (acct.register) {
          acct.register();
          console.log('✅ register() called');
        } else {
          console.log('⚠️  No registration method found on account');
        }
      } catch (error) {
        console.error('❌ Registration failed:', error.message);
      }
    }, 1000);

  } catch (error) {
    console.error('❌ Account creation failed:', error.message);
  }

}, 2000);

console.log('SIP client running…');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down...');
  if (openaiHandler) {
    openaiHandler.disconnect();
    console.log('🤖 AI assistant disconnected');
  }
  if (typeof acct !== 'undefined' && acct.unregister) acct.unregister();
  if (sip.shutdown) sip.shutdown();
  process.exit(0);
});