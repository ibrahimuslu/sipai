// Load environment variables from .env file
require('dotenv').config();

const sip = require('sipstel');
const fs = require('fs');
const path = require('path');
const openaiHandler = require('./openai-handler');
const RealtimeHandler = require('./realtime-handler');

const DOMAIN = process.env.SIP_DOMAIN;
const USER   = process.env.SIP_USER;
const PASS   = process.env.SIP_PASS;

if (!DOMAIN || !USER || !PASS) {
  console.error('❌ Set SIP_DOMAIN, SIP_USER, SIP_PASS');
  process.exit(1);
}

sip.init({
  logConfig: {
    level: 0,        // Log level (0 = no logging)
    consoleLevel: 0  // Console level (0 = no console output)
  }
});
sip.setNullDev();
sip.codecSetPriority('PCMU/8000', 255);

const transport = new sip.Transport({ type: 'udp', port: 5060 });

sip.start();

// Store sample.wav path
const SAMPLE_WAV = path.join(__dirname, 'voices/sample.wav');

// Check that sample.wav exists
if (!fs.existsSync(SAMPLE_WAV)) {
  console.error('❌ sample.wav not found!');
  process.exit(1);
}

// Track active players and recorders per call
const callSessions = new Map(); // Maps call to {players, recorder, playbackStarted, recordingFile, conversationHistory, aiSession}

// Helper function to create a WAV file from raw PCM16 audio
function createWAVFile(pcmBuffer) {
  const sampleRate = 24000;  // OpenAI Realtime API uses 24kHz
  const channels = 1;        // Mono
  const bitsPerSample = 16;  // PCM16
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;

  // Create WAV header
  const wavHeader = Buffer.alloc(44);
  
  // RIFF chunk
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write('WAVE', 8);
  
  // fmt sub-chunk
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);                    // Sub-chunk size
  wavHeader.writeUInt16LE(1, 20);                     // Audio format (1 = PCM)
  wavHeader.writeUInt16LE(channels, 22);              // Number of channels
  wavHeader.writeUInt32LE(sampleRate, 24);            // Sample rate (24kHz)
  wavHeader.writeUInt32LE(byteRate, 28);              // Byte rate
  wavHeader.writeUInt16LE(blockAlign, 32);            // Block align
  wavHeader.writeUInt16LE(bitsPerSample, 34);         // Bits per sample
  
  // data sub-chunk
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);
  
  // Combine header and PCM data
  return Buffer.concat([wavHeader, pcmBuffer]);
}

// Greeting audio file
const GREETING_WAV = path.join(__dirname, 'voices/greeting.wav');

// Verify greeting.wav exists
if (!fs.existsSync(GREETING_WAV)) {
  console.error('❌ greeting.wav not found!');
  process.exit(1);
}


// Handle incoming calls
async function handleIncomingCall(call) {
  console.log('📞 Incoming call received!');
  
  // Answer the call
  try {
    call.answer();
    console.log('✅ Call answered');
  } catch (error) {
    console.error('❌ Failed to answer call:', error.message);
    return;
  }
}

// Set up call handlers
function setupCallHandlers(call) {
  // Track call state
  call.on('state', (state) => {
    const stateUpper = state.toUpperCase();
    console.log(`\n📞 CALL STATE CHANGE: ${stateUpper}`);
    
    switch(stateUpper) {
      case 'INCOMING':
        console.log('   🔔 Call is ringing');
        break;
      case 'EARLY':
        console.log('   🔔 Early media');
        break;
      case 'CONFIRMED':
        console.log('   ✅ Call confirmed - media should be available soon');
        break;
      case 'DISCONNECTED':
        console.log('   📴 Call is disconnected/ended');
        
        // Clean up session
        const session = callSessions.get(call);
        if (session) {
          console.log('\n🧹 CLEANING UP SESSION');
          console.log(`   Players created: ${session.players ? session.players.length : 0}`);
          
          if (session.conversationHistory && session.conversationHistory.length > 0) {
            console.log('\n💬 CONVERSATION SUMMARY:');
            session.conversationHistory.forEach((msg, idx) => {
              const role = msg.role === 'user' ? '👤 User' : '🤖 AI';
              console.log(`   ${idx + 1}. ${role}: ${msg.content}`);
            });
          }
          
          if (session.recorder) {
            try {
              console.log('   Stopping recorder...');
              if (session.recorder.stop) session.recorder.stop();
              console.log('   ✅ Recorder stopped');
            } catch (e) {
              console.error('   ⚠️  Error stopping recorder:', e.message);
            }
          }
          
          // Stop audio streaming
          if (session.audioStreamInterval) {
            clearInterval(session.audioStreamInterval);
            console.log('   ✅ Audio streaming stopped');
          }
          
          // Disconnect Realtime handler
          if (session.realtimeHandler) {
            try {
              console.log('   Disconnecting from Realtime API...');
              session.realtimeHandler.stop();
              console.log('   ✅ Realtime disconnected');
            } catch (e) {
              console.error('   ⚠️  Error disconnecting Realtime:', e.message);
            }
          }
          
          if (session.recordingFile) {
            console.log('   📁 Recording saved to:', session.recordingFile);
            // Optional: check file size
            try {
              const stats = fs.statSync(session.recordingFile);
              console.log(`   � File size: ${(stats.size/1024).toFixed(1)} KB`);
            } catch (e) {
              console.log('   ⚠️  Could not stat recording file');
            }
          }
        }
        
        callSessions.delete(call);
        break;
      default:
        console.log(`   ❓ Unknown state: ${stateUpper}`);
    }
  });
  
  // When media becomes available
  call.on('media', (medias) => {
    console.log(`\n🔌 MEDIA EVENT TRIGGERED - Media streams: ${medias.length}`);
    
    if (medias.length > 0) {
      const mediaStream = medias[0];
      console.log('   ✅ Media stream available');
      
      // Check if we already started playback for this call
      let session = callSessions.get(call);
      if (!session) {
        console.log('   📝 Creating new session object');
        session = { 
          audioQueueIndex: 0,
          players: [],
          recorder: null,
          playbackStarted: false,
          conversationHistory: [],
          aiSession: null,
          recordingBuffer: Buffer.alloc(0),
          realtimeHandler: new RealtimeHandler(process.env.OPENAI_API_KEY)
        };
        callSessions.set(call, session);
      }
      
      // Initialize AI session
      if (!session.aiSession) {
        console.log('   🤖 Initializing AI session');
        session.aiSession = openaiHandler.initializeRealtimeSession();
      }
      
      // Start greeting and Realtime conversation only once per call
      if (!session.playbackStarted) {
        console.log('   🎵 Starting greeting and Realtime...');
        session.playbackStarted = true;
        startGreetingAndRealtime(mediaStream, call, session);
      } else {
        console.log('   ⏭️  Playback already started, skipping...');
      }
      
      // Create recorder for caller audio (only once per call)
      if (!session.recorder) {
        try {
          const recordingFile = `/tmp/caller_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`;
          const recorder = sip.createRecorder(recordingFile);
          if (recorder) {
            mediaStream.startTransmitTo(recorder);
            session.recorder = recorder;
            session.recordingFile = recordingFile;
            console.log(`🎙️  Recording caller audio to: ${recordingFile}`);
          } else {
            console.error('❌ Failed to create recorder');
          }
        } catch (error) {
          console.error('❌ Error creating recorder:', error.message);
        }
      }
    } else {
      console.error('❌ No media streams available');
    }
  });
}

// Function to get audio file duration from WAV header
function getAudioDuration(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    console.log(`   📊 Reading ${filePath}: ${buffer.length} bytes`);
    
    // Check RIFF header
    const riff = buffer.slice(0, 4).toString('ascii');
    console.log(`   📝 RIFF header: ${riff}`);
    
    if (riff !== 'RIFF') {
      console.log(`   ⚠️  Not a WAV file (no RIFF)`);
      return 3000;
    }
    
    const sampleRate = buffer.readUInt32LE(24);
    const bitsPerSample = buffer.readUInt16LE(34);
    const channels = buffer.readUInt16LE(22);
    
    console.log(`   📋 Sample rate: ${sampleRate}Hz, Channels: ${channels}, Bits: ${bitsPerSample}`);
    
    let dataSize = 0;
    const dataOffset = buffer.indexOf(Buffer.from('data'));
    if (dataOffset !== -1) {
      dataSize = buffer.readUInt32LE(dataOffset + 4);
      console.log(`   📦 Data chunk size: ${dataSize} bytes`);
    }
    
    const bytesPerSample = (bitsPerSample / 8) * channels;
    const duration = (dataSize / (sampleRate * bytesPerSample)) * 1000;
    
    console.log(`   ⏱️  Duration: ${(duration/1000).toFixed(2)}s`);
    
    return Math.ceil(duration);
  } catch (error) {
    console.error(`   ❌ Error reading WAV: ${error.message}`);
    return 3000;
  }
}

// Function to detect voice activity in PCM16 audio
function detectVoiceActivity(pcm16Buffer, threshold = 1000) {
  // PCM16 is 2 bytes per sample
  let maxAmplitude = 0;
  
  for (let i = 0; i < pcm16Buffer.length; i += 2) {
    // Read 16-bit signed integer (little-endian)
    const sample = pcm16Buffer.readInt16LE(i);
    const amplitude = Math.abs(sample);
    if (amplitude > maxAmplitude) {
      maxAmplitude = amplitude;
    }
  }
  
  // Return true if max amplitude exceeds threshold
  return maxAmplitude > threshold;
}

// Play greeting audio only, then initialize Realtime conversation
function startGreetingAndRealtime(mediaStream, call, session) {
  console.log(`\n🎵 PLAYING GREETING AUDIO`);
  
  try {
    const player = sip.createPlayer(GREETING_WAV, true);
    
    if (!player) {
      console.error('❌ Failed to create greeting player');
      return;
    }
    
    session.players.push(player);
    player.startTransmitTo(mediaStream);
    
    console.log(`   ▶️  Playing greeting (~3 seconds)`);
    
    // After greeting finishes (fixed 3 second timeout), start Realtime API conversation
    setTimeout(() => {
      console.log('\n✅ Greeting complete - Initializing Realtime conversation...');
      initializeRealtimeConversation(mediaStream, call, session);
    }, 3000);
    
  } catch (error) {
    console.error('❌ Error playing greeting:', error.message);
  }
}

// Initialize OpenAI Realtime conversation with audio streaming
async function initializeRealtimeConversation(mediaStream, call, session) {
  try {
    console.log('🤖 Connecting to OpenAI Realtime API...');
    
    if (!session.realtimeHandler) {
      console.error('❌ Realtime handler not initialized');
      return;
    }

    // Connect to Realtime API
    await session.realtimeHandler.connect();
    
    console.log('✅ Connected to Realtime API');
    console.log('🎤 Listening for caller input...');

    // Use the existing recorder from the media event (don't create a new one)
    const recordingFile = session.recordingFile;
    
    if (!recordingFile) {
      console.error('❌ No recording file in session');
      return;
    }

    console.log('📁 Using existing recording file:', recordingFile);

    // Now set up the audio streaming process
    // Read recorded audio periodically and send to API
    let lastReadBytes = 44; // Start after WAV header (44 bytes)
    let lastAudioTime = Date.now();
    let isSpeaking = false;
    let totalAudioSent = 0;  // Track total bytes sent
    const SILENCE_THRESHOLD = 500; // ms of silence to trigger stop
    const AUDIO_THRESHOLD = 1000; // Amplitude threshold for voice detection
    
    const audioStreamInterval = setInterval(async () => {
      try {
        if (!fs.existsSync(recordingFile)) {
          return;
        }

        const stats = fs.statSync(recordingFile);
        const currentSize = stats.size;

        // Only log if file size changed
        if (currentSize > lastReadBytes) {
          // If audio has grown, read the new chunk
          const buffer = fs.readFileSync(recordingFile);
          const newAudioData = buffer.slice(lastReadBytes, currentSize);

          if (newAudioData.length > 0) {
            // Detect if there's voice activity by checking audio amplitude
            const hasVoice = detectVoiceActivity(newAudioData, AUDIO_THRESHOLD);
            
            if (hasVoice) {
              lastAudioTime = Date.now();
              if (!isSpeaking) {
                isSpeaking = true;
                console.log('🎤 Voice detected (local VAD)');
              }
              
              // Send audio chunk (API will buffer it)
              console.log(`   ➡️  Sending ${newAudioData.length} bytes...`);
              const sent = session.realtimeHandler.sendAudio(newAudioData);
              if (sent) {
                totalAudioSent += newAudioData.length;
                console.log(`   ✅ Sent`);
                // DON'T commit - just send chunks, let server_vad handle detection
              } else {
                console.log(`   ❌ Failed to send`);
              }
            } else if (isSpeaking) {
              // Check if we've been silent long enough to stop
              const silenceDuration = Date.now() - lastAudioTime;
              if (silenceDuration > SILENCE_THRESHOLD) {
                isSpeaking = false;
                console.log(`⏹️  Local silence detected (${silenceDuration}ms) - API server_vad will handle it`);
              }
            }
            
            lastReadBytes = currentSize;
          }
        }
        
      } catch (error) {
        console.error('❌ Error streaming audio:', error.message);
      }
    }, 200);

    session.audioStreamInterval = audioStreamInterval;
    console.log('▶️  Audio streaming started (VAD enabled)');

    // Handle responses from Realtime API
    let responseAudioBuffer = Buffer.alloc(0);
    let responseStartTime = null;
    let isPlayingResponse = false;

    session.realtimeHandler.on('audio_delta', (audioData) => {
      console.log(`📥 Received ${audioData.length} bytes from Realtime API`);
      
      // Accumulate audio chunks
      responseAudioBuffer = Buffer.concat([responseAudioBuffer, audioData]);
      
      // Track when response started for timing
      if (!responseStartTime) {
        responseStartTime = Date.now();
      }
    });

    session.realtimeHandler.on('response_done', () => {
      console.log('✅ AI response complete');
      
      // Now we have all the response audio, create WAV file and play it
      if (responseAudioBuffer.length > 0) {
        try {
          // Create WAV file from PCM16 audio
          const responseFile = `/tmp/realtime_response_${Date.now()}.wav`;
          const wavBuffer = createWAVFile(responseAudioBuffer);
          fs.writeFileSync(responseFile, wavBuffer);
          
          console.log(`📁 Response audio saved: ${responseFile} (${wavBuffer.length} bytes)`);
          
          // Play response to caller
          const player = sip.createPlayer(responseFile, true);
          if (player) {
            session.players.push(player);
            player.startTransmitTo(mediaStream);
            console.log('🔊 Playing AI response to caller');
            
            // Clean up after playing (longer timeout for full playback)
            setTimeout(() => {
              try {
                fs.unlinkSync(responseFile);
                console.log('🧹 Cleaned up response file');
              } catch (e) {
                // Ignore cleanup errors
              }
            }, 10000);
          } else {
            console.error('❌ Failed to create player for response');
          }
          
          // Reset for next response
          responseAudioBuffer = Buffer.alloc(0);
          responseStartTime = null;
          isPlayingResponse = false;
        } catch (error) {
          console.error('❌ Error playing response:', error.message);
        }
      } else {
        console.warn('⚠️  No audio data in response');
      }
    });

    session.realtimeHandler.on('speech_started', () => {
      console.log('🎤 Caller started speaking (API VAD)');
    });

    session.realtimeHandler.on('api_error', (error) => {
      console.error('❌ Realtime API error:', error);
    });

    console.log('🟢 Realtime conversation initialized - Ready to speak!');

  } catch (error) {
    console.error('❌ Error in Realtime conversation:', error.message);
  }
}

// Create SIP account
setTimeout(() => {
  try {
    const acct = new sip.Account({
      idUri: `sip:${USER}@${DOMAIN}`,
      regConfig: {
        registrarUri: `sip:${DOMAIN}`,
        timeoutSec: 300
      },
      sipConfig: {
        authCreds: [{
          scheme: "digest",
          realm: DOMAIN,
          username: USER,
          dataType: 0,
          data: PASS
        }]
      }
    });

    // Account events
    acct.on('registered',   () => console.log('✅ SIP registered'));
    acct.on('reg_failed',   (e) => console.error('❌ Registration failed:', e));

    // Incoming call
    acct.on('call', (info, call) => {
      console.log('📞 New call from:', info.remoteContact);
      setupCallHandlers(call);
      handleIncomingCall(call);
    });

    // Try registration
    setTimeout(() => {
      try {
        if (acct.setRegistration) {
          acct.setRegistration(true);
        } else if (acct.register) {
          acct.register();
        }
      } catch (error) {
        console.error('❌ Registration error:', error.message);
      }
    }, 1000);

  } catch (error) {
    console.error('❌ Account creation failed:', error.message);
  }


}, 2000);

console.log('✅ SIP server ready...\n');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (sip.shutdown) sip.shutdown();
  process.exit(0);
});