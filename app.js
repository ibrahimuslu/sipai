// Load environment variables from .env file
require('dotenv').config();

const sip = require('sipstel');
const fs = require('fs');
const path = require('path');

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
const callSessions = new Map(); // Maps call to {player, recorder}

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
          playbackStarted: false
        };
        callSessions.set(call, session);
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
    
    console.log(`   🔍 WAV DEBUG - File: ${path.basename(filePath)}`);
    console.log(`      sampleRate: ${sampleRate}, channels: ${channels}, bitsPerSample: ${bitsPerSample}`);
    console.log(`      dataSize: ${dataSize} bytes`);
    
    const bytesPerSample = (bitsPerSample / 8) * channels;
    const duration = (dataSize / (sampleRate * bytesPerSample)) * 1000;
    
    console.log(`      bytesPerSample: ${bytesPerSample}, calculated duration: ${(duration/1000).toFixed(2)}s`);
    
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
      console.log('✅ ALL FILES PLAYED');
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
        // Wait 500ms before trying next file
        setTimeout(() => playNextFile(), 500);
        return;
      }
      
      session.players.push(player);
      player.startTransmitTo(mediaStream);
      console.log(`   ✅ Playing: ${filename}`);
      
      // Move to next file after duration + small buffer
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

console.log('✅ SIP server ready...');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (sip.shutdown) sip.shutdown();
  process.exit(0);
});