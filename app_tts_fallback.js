// Load environment variables from .env file
require('dotenv').config();

const sip = require('sipstel');
const axios = require('axios');
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
sip.setNullDev();
sip.codecSetPriority('PCMU/8000', 255);

// Create transport BEFORE starting SIP stack - this is crucial for PJSUA
console.log('🔧 Creating UDP transport...');
const transport = new sip.Transport({ type: 'udp', port: 5060 });

// Start SIP stack
sip.start();
console.log('✅ SIP stack started');

// OpenAI Chat + TTS handler
class OpenAITTSHandler {
  constructor() {
    this.isConnected = true; // Always connected for REST API
    this.callMediaStream = null;
    this.sipPlayer = null;
    this.conversation = [];
  }

  async generateAIResponse(userMessage) {
    try {
      console.log('🤖 Generating AI response for:', userMessage);
      
      // Add user message to conversation
      this.conversation.push({ role: 'user', content: userMessage });
      
      // Get text response from OpenAI Chat API
      const chatResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant speaking on a phone call. Be conversational, friendly, and concise. Respond naturally as if you are having a real phone conversation. Keep responses short and engaging.'
          },
          ...this.conversation
        ],
        max_tokens: 150,
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const aiText = chatResponse.data.choices[0].message.content;
      console.log('🤖 AI text response:', aiText);
      
      // Add AI response to conversation
      this.conversation.push({ role: 'assistant', content: aiText });
      
      // Convert to speech using OpenAI TTS
      const ttsResponse = await axios.post('https://api.openai.com/v1/audio/speech', {
        model: 'tts-1',
        voice: 'alloy',
        input: aiText,
        response_format: 'wav'
      }, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      });

      // Save audio file
      const audioFile = `/tmp/ai_response_${Date.now()}.wav`;
      fs.writeFileSync(audioFile, Buffer.from(ttsResponse.data));
      console.log('💾 AI audio response saved:', audioFile);
      
      // Play audio to caller
      this.playAudioToSIP(audioFile);
      
      return aiText;
    } catch (error) {
      console.error('❌ Error generating AI response:', error.message);
      return null;
    }
  }

  playAudioToSIP(audioFile) {
    try {
      console.log('🔊 Playing AI audio to caller:', audioFile);
      
      if (!this.callMediaStream) {
        console.error('❌ No media stream available for audio playback');
        return;
      }
      
      // Create a new player for this audio and connect it to the call
      const player = sip.createPlayer(audioFile);
      if (player) {
        // Connect player to the media stream
        player.startTransmitTo(this.callMediaStream);
        console.log('🔊 Started AI audio playback to caller');
        console.log('📁 AI audio file preserved for analysis:', audioFile);
      } else {
        console.error('❌ Failed to create audio player');
      }
    } catch (error) {
      console.error('❌ Error playing audio to SIP:', error.message);
    }
  }

  attachToCall(mediaStream) {
    this.callMediaStream = mediaStream;
    console.log('🔗 OpenAI TTS handler attached to SIP call');
    
    // Send initial greeting
    setTimeout(() => {
      this.generateAIResponse('Hello! Please greet the caller and ask how you can help them today.');
    }, 2000);
  }

  disconnect() {
    console.log('🤖 OpenAI TTS handler disconnected');
  }
}

// Global OpenAI handler instance
let openaiHandler = null;

// Function to handle incoming calls
async function handleIncomingCall(call) {
  console.log('📞 Processing incoming call...');
  
  // Create OpenAI TTS handler
  openaiHandler = new OpenAITTSHandler();
  
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
  
  // Listen for DTMF digits - could trigger AI responses
  call.on('dtmf', (digit) => {
    console.log('🔢 DTMF digit received:', digit);
    if (openaiHandler && digit === '1') {
      openaiHandler.generateAIResponse('The caller pressed 1. Please provide information about our services.');
    }
  });
  
  // Audio stream(s) available
  call.on('media', (medias) => {
    console.log('🎵 Media streams available:', medias.length);
    
    if (medias.length > 0 && openaiHandler) {
      connectAIToCall(medias[0]);
    }
  });
}

// Function to connect AI to the call media stream
function connectAIToCall(mediaStream) {
  try {
    console.log('🤖 Connecting AI to call media stream...');
    
    if (!openaiHandler) {
      console.error('❌ OpenAI handler not created');
      return;
    }
    
    // Attach OpenAI handler to the call
    openaiHandler.attachToCall(mediaStream);
    
    // Create recorder to capture audio from caller (for future speech-to-text integration)
    try {
      const recordingFile = `/tmp/caller_audio_${Date.now()}.wav`;
      const recorder = sip.createRecorder(recordingFile);
      if (recorder) {
        console.log('🎤 Started recording caller audio');
      }
    } catch (error) {
      console.log('⚠️  Could not create audio recorder:', error.message);
    }
    
    // Create greeting player
    try {
      const greetingPlayer = sip.createPlayer('/tmp/greeting_16k.wav');
      if (greetingPlayer) {
        greetingPlayer.startTransmitTo(mediaStream);
        console.log('🎵 Playing brief greeting to keep line active');
        
        // Stop greeting after 2 seconds
        setTimeout(() => {
          if (greetingPlayer.stop) greetingPlayer.stop();
          console.log('🎵 Greeting ended, AI taking over');
        }, 2000);
      }
    } catch (error) {
      console.error('❌ Error playing greeting:', error.message);
    }
    
    console.log('✅ AI successfully connected to call');
  } catch (error) {
    console.error('❌ Error connecting AI to call:', error.message);
  }
}

console.log('SIP client running…');

// Create account after a short delay
setTimeout(() => {
  console.log('🔧 Creating account after SIP stack initialization...');
  
  const account = new sip.Account();
  account.setConfig({
    idUri: `sip:${USER}@${DOMAIN}`,
    regConfig: {
      registrarUri: `sip:${DOMAIN}`,
      registerOnAdd: false
    },
    sipConfig: {
      authCreds: [{
        scheme: 'digest',
        realm: DOMAIN,
        username: USER,
        dataType: 0,
        data: PASS
      }]
    }
  });

  console.log(`🔧 Account created with URI: sip:${USER}@${DOMAIN}`);
  
  // Set up call event handlers
  console.log('🔧 Call event handlers set up');
  
  // Debug available methods
  console.log('📋 Available Account methods:', Object.getOwnPropertyNames(account.__proto__).filter(name => typeof account[name] === 'function'));
  console.log('📋 Available SIP methods:', Object.getOwnPropertyNames(sip).filter(name => typeof sip[name] === 'function'));
  
  // Register after account is fully set up
  setTimeout(() => {
    console.log('🔄 Attempting manual registration...');
    account.setRegistration(true);
    console.log('✅ setRegistration(true) called');
  }, 1000);

  // Set up incoming call handler
  account.on('incoming_call', (call) => {
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

  // Set up registration status handlers
  account.on('registration_state', (state) => {
    console.log('📋 Registration state:', state);
    if (state.code === 200) {
      console.log('✅ Registered successfully');
    } else if (state.code >= 400) {
      console.error('❌ Registration failed:', state.reason);
    }
  });
  
}, 2000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  
  if (openaiHandler) {
    openaiHandler.disconnect();
  }
  
  process.exit(0);
});