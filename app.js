// Load environment variables from .env file
require('dotenv').config();

const sip = require('sipstel');
const fs = require('fs');
const path = require('path');
const openaiHandler = require('./openai-handler');

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
const SAMPLE_WAV = path.join(__dirname, 'sample.wav');

// Check that sample.wav exists
if (!fs.existsSync(SAMPLE_WAV)) {
  console.error('❌ sample.wav not found!');
  process.exit(1);
}

// Track active players and recorders per call
const callSessions = new Map(); // Maps call to {players, recorder, playbackStarted, recordingFile, conversationHistory, aiSession}

// Create a queue of audio files to play
const BEETHOVEN_WAV = path.join(__dirname, 'beethoven.wav');
const AUDIO_FILES = [SAMPLE_WAV, BEETHOVEN_WAV]; // Play sample.wav, then Beethoven

function getAudioFileList() {
  // Return array of audio files to stream in sequence
  return AUDIO_FILES;
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
    if (medias.length > 0) {
      const mediaStream = medias[0];
      
      // Check if we already started playback for this call
      let session = callSessions.get(call);
      if (!session) {
        session = { 
          audioQueueIndex: 0,
          players: [],
          recorder: null,
          playbackStarted: false,
          conversationHistory: [],
          aiSession: null,
          recordingBuffer: Buffer.alloc(0)
        };
        callSessions.set(call, session);
      }
      
      // Initialize AI session
      if (!session.aiSession) {
        session.aiSession = openaiHandler.initializeRealtimeSession();
      }
      
      // Start playback only once per call
      if (!session.playbackStarted) {
        session.playbackStarted = true;
        startAudioPlayback(mediaStream, call, session);
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
    const sampleRate = buffer.readUInt32LE(24);
    const bitsPerSample = buffer.readUInt16LE(34);
    const channels = buffer.readUInt16LE(22);
    
    let dataSize = 0;
    const dataOffset = buffer.indexOf(Buffer.from('data'));
    if (dataOffset !== -1) {
      dataSize = buffer.readUInt32LE(dataOffset + 4);
    }
    
    const bytesPerSample = (bitsPerSample / 8) * channels;
    const duration = (dataSize / (sampleRate * bytesPerSample)) * 1000;
    
    return Math.ceil(duration);
  } catch (error) {
    console.error(`   ❌ Error reading WAV: ${error.message}`);
    return 5000;
  }
}

// Function to play audio files sequentially using separate players with proper delays
function startAudioPlayback(mediaStream, call, session) {
  const audioFiles = getAudioFileList();
  
  console.log(`\n🎵 AUDIO PLAYBACK - Files: ${audioFiles.map(f => path.basename(f)).join(' → ')}`);
  
  let currentIndex = 0;
  
  function playNextFile() {
    if (currentIndex >= audioFiles.length) {
      console.log('✅ ALL FILES PLAYED - Waiting for caller input...');
      
      // After initial greeting, start monitoring for caller input
      setTimeout(() => {
        handleCallerInput(mediaStream, call, session);
      }, 2000);
      
      return;
    }
    
    const file = audioFiles[currentIndex];
    const filename = path.basename(file);
    const duration = getAudioDuration(file);
    
    console.log(`▶️  Playing file ${currentIndex + 1}/${audioFiles.length}: ${filename} (${(duration/1000).toFixed(1)}s)`);
    
    try {
      const player = sip.createPlayer(file, true);
      
      if (!player) {
        console.error(`❌ Failed to create player for ${filename}`);
        currentIndex++;
        setTimeout(() => playNextFile(), 500);
        return;
      }
      
      session.players.push(player);
      player.startTransmitTo(mediaStream);
      console.log(`   ✅ Playing: ${filename}`);
      
      const delayMs = duration + 500;
      currentIndex++;
      
      setTimeout(() => {
        playNextFile();
      }, delayMs);
      
    } catch (error) {
      console.error(`❌ Error with ${filename}:`, error.message);
      currentIndex++;
      setTimeout(() => playNextFile(), 500);
    }
  }
  
  playNextFile();
}

// Handle caller input - process recorded audio with OpenAI
async function handleCallerInput(mediaStream, call, session) {
  console.log('\n🎤 AWAITING CALLER INPUT...');
  console.log('   ⏱️  Listening for caller input (10 seconds)...');
  
  // Wait 10 seconds, then process
  setTimeout(async () => {
    if (!session.recordingFile || !fs.existsSync(session.recordingFile)) {
      console.log('   ⚠️  No caller audio recorded');
      return;
    }
    
    try {
      // Read the recorded audio
      const audioBuffer = fs.readFileSync(session.recordingFile);
      
      console.log(`   📊 Recorded audio size: ${(audioBuffer.length / 1024).toFixed(1)} KB`);
      
      // Process with OpenAI
      const result = await openaiHandler.processUserAudio(audioBuffer, session.conversationHistory);
      
      if (result) {
        console.log(`\n✅ PROCESSED CALLER INPUT:`);
        console.log(`   💬 User said: "${result.userMessage}"`);
        console.log(`   🤖 AI responds: "${result.aiResponse}"`);
        
        // Play response back to caller
        if (result.audioPath && fs.existsSync(result.audioPath)) {
          console.log(`\n🔊 PLAYING AI RESPONSE AUDIO...`);
          
          const responsePlayer = sip.createPlayer(result.audioPath, true);
          if (responsePlayer) {
            session.players.push(responsePlayer);
            responsePlayer.startTransmitTo(mediaStream);
            
            const duration = getAudioDuration(result.audioPath);
            console.log(`   ⏱️  Duration: ${(duration/1000).toFixed(1)}s`);
            
            // Clean up audio file after playing
            setTimeout(() => {
              openaiHandler.cleanupAudioFile(result.audioPath);
            }, duration + 500);
            
            // Wait for response to finish, then ask for next input
            setTimeout(() => {
              console.log('\n✅ Response played - waiting for next input...');
              handleCallerInput(mediaStream, call, session);
            }, duration + 1000);
          }
        }
      } else {
        console.log('   ⚠️  Could not process caller audio');
        handleCallerInput(mediaStream, call, session);
      }
      
    } catch (error) {
      console.error('   ❌ Error processing caller input:', error.message);
      handleCallerInput(mediaStream, call, session);
    }
  }, 10000);
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