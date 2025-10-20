// Simple test to check if Realtime API connection works
require('dotenv').config();

const WebSocket = require('ws');

const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error('❌ OPENAI_API_KEY not set');
  process.exit(1);
}

console.log('Testing OpenAI Realtime API connection...\n');

const wsUrl = 'wss://api.openai.com/v1/realtime';
const params = {
  model: 'gpt-realtime-mini'
};

const url = new URL(wsUrl);
Object.entries(params).forEach(([key, value]) => {
  url.searchParams.append(key, value);
});

console.log('WebSocket URL:', url.toString());

const wsOptions = {
  headers: {
    'Authorization': `Bearer ${API_KEY}`
  }
};

console.log('Using Authorization header: Bearer ***\n');

const ws = new WebSocket(url.toString(), wsOptions);

ws.on('open', () => {
  console.log('✅ Connected to OpenAI Realtime API');
  
  // Send session.update
  const message = {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: 'You are a helpful Turkish-speaking AI assistant.',
      voice: 'nova',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16'
    }
  };
  
  console.log('📤 Sending session.update...');
  ws.send(JSON.stringify(message));
  
  // Wait a bit then send a test audio message
  setTimeout(() => {
    console.log('📤 Sending test audio chunk...');
    const testAudio = {
      type: 'input_audio_buffer.append',
      audio: Buffer.alloc(1600).toString('base64') // 100ms of silence at 16kHz
    };
    ws.send(JSON.stringify(testAudio));
    
    setTimeout(() => {
      console.log('📤 Committing audio buffer...');
      ws.send(JSON.stringify({
        type: 'input_audio_buffer.commit'
      }));
    }, 500);
  }, 1000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📥 Received message type:', msg.type);
  if (msg.type === 'session.created') {
    console.log('   Session ID:', msg.session.id);
  }
  if (msg.type === 'error') {
    console.error('❌ API Error:', msg.error);
    console.error('   Error type:', msg.error.type);
    console.error('   Error message:', msg.error.message);
  }
  console.log('   Full message:', JSON.stringify(msg, null, 2));
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('📴 Disconnected');
  process.exit(0);
});

// Auto-close after 10 seconds
setTimeout(() => {
  console.log('\n✅ Test completed');
  ws.close();
}, 10000);
