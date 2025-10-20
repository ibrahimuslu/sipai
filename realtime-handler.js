// OpenAI Realtime API handler for bidirectional audio streaming
// Reference: https://platform.openai.com/docs/guides/realtime-conversations

const WebSocket = require('ws');
const OpenAI = require('openai');
const { EventEmitter } = require('events');

class RealtimeHandler extends EventEmitter {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.ws = null;
    this.isConnected = false;
    this.sessionId = null;
    this.inputAudioBuffer = Buffer.alloc(0);
    this.audioBufferSize = 0;  // Track if audio was sent
  }

  /**
   * Initialize WebSocket connection to OpenAI Realtime API
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔌 Connecting to OpenAI Realtime API...');

        // OpenAI Realtime API WebSocket endpoint
        const wsUrl = 'wss://api.openai.com/v1/realtime';
        const params = {
          model: 'gpt-realtime-mini'
        };

        const url = new URL(wsUrl);
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });

        // Create WebSocket with Authorization header
        const wsOptions = {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        };

        console.log(`   🔐 Using Authorization header`);
        console.log(`   📍 URL: ${url.toString().split('?')[0]}?...`);

        this.ws = new WebSocket(url.toString(), wsOptions);

        this.ws.on('open', () => {
          console.log('✅ Connected to OpenAI Realtime API');
          this.isConnected = true;

          // Send session.update to configure the session
          this.sendSessionUpdate();
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('❌ WebSocket error:', error.message);
          this.isConnected = false;
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('📴 Disconnected from OpenAI Realtime API');
          this.isConnected = false;
          this.emit('disconnected');
        });

      } catch (error) {
        console.error('❌ Connection error:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Send session configuration update
   */
  sendSessionUpdate() {
    try {
      const message = {
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: `You are a helpful Turkish-speaking AI assistant. 
You are speaking with a caller on a phone line. 
Keep responses concise and natural (1-3 sentences max).
Respond ONLY in Turkish language. Do not respond in English.
Be polite and professional.`
        }
      };

      this.send(message);
      console.log('✅ Session configured - Turkish language only');

    } catch (error) {
      console.error('❌ Error sending session update:', error.message);
    }
  }

  /**
   * Send message to WebSocket
   */
  send(message) {
    if (!this.isConnected || !this.ws) {
      console.error('❌ WebSocket not connected - cannot send message');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('❌ Error sending message:', error.message);
      return false;
    }
  }

  /**
   * Handle incoming messages from OpenAI Realtime API
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      // Log all messages for debugging
      console.log(`📨 API Message: ${message.type}`);

      if (message.type === 'session.created') {
        this.sessionId = message.session.id;
        console.log(`🔐 Session created: ${this.sessionId}`);
        this.emit('session_created', message);
      }

      if (message.type === 'session.updated') {
        console.log('✅ Session updated');
        this.emit('session_updated', message);
      }

      if (message.type === 'response.started') {
        console.log('🤖 AI response started');
        this.emit('response_started', message);
      }

      if (message.type === 'response.audio.delta' || message.type === 'response.output_audio.delta') {
        // Audio delta received - emit for real-time playback
        if (message.delta) {
          const audioData = Buffer.from(message.delta, 'base64');
          console.log(`🎵 Audio delta: ${audioData.length} bytes`);
          this.emit('audio_delta', audioData);
        } else {
          console.log('⚠️  Audio delta but no data');
        }
      }

      if (message.type === 'response.text.delta') {
        // Text response received
        if (message.delta) {
          console.log(`🤖 AI Response Text: ${message.delta}`);
          this.emit('text_delta', message.delta);
        }
      }

      if (message.type === 'response.output_audio_transcript.delta') {
        // Transcript of what AI is saying
        if (message.delta) {
          console.log(`📝 AI Transcript: ${message.delta}`);
          this.emit('audio_transcript_delta', message.delta);
        }
      }

      if (message.type === 'input_audio_buffer.speech_started') {
        console.log('🎤 Caller started speaking');
        this.emit('speech_started');
      }

      if (message.type === 'input_audio_buffer.speech_stopped') {
        console.log('⏹️  Caller stopped speaking (API VAD)');
        this.emit('speech_stopped');
      }

      if (message.type === 'response.done') {
        console.log('✅ Response completed');
        this.emit('response_done', message);
      }

      if (message.type === 'error') {
        console.error('❌ API Error:', message.error);
        this.emit('api_error', message.error);
      }

    } catch (error) {
      console.error('❌ Error parsing message:', error.message);
    }
  }

  /**
   * Send audio data from caller to API
   * Audio should be raw PCM16 data (WAV header already stripped in app.js)
   */
  sendAudio(audioBuffer) {
    if (!this.isConnected) {
      console.error('❌ WebSocket not connected - cannot send audio');
      return false;
    }

    try {
      // audioBuffer is raw PCM16 data, already had WAV header removed
      const base64Audio = audioBuffer.toString('base64');

      const message = {
        type: 'input_audio_buffer.append',
        audio: base64Audio
      };

      // Track that we sent audio
      this.audioBufferSize += audioBuffer.length;
      
      // Send to API
      const result = this.send(message);
      
      if (result) {
        console.log(`      📡 Sent to API via WebSocket (${audioBuffer.length} bytes → ${base64Audio.length} chars base64)`);
      }
      
      return result;
    } catch (error) {
      console.error('❌ Error sending audio:', error.message);
      return false;
    }
  }

  /**
   * Commit audio buffer (call this when speech stops or you want to process)
   */
  commitAudio() {
    if (!this.isConnected) {
      console.error('❌ WebSocket not connected');
      return false;
    }

    console.log(`      🔄 Committing (${this.audioBufferSize} bytes)`);
    this.commitAudioBuffer();
    
    // Reset for next chunk
    this.audioBufferSize = 0;
    return true;
  }

  /**
   * Commit audio buffer (signal to process)
   */
  commitAudioBuffer() {
    if (!this.isConnected) {
      console.error('❌ WebSocket not connected');
      return false;
    }

    try {
      const message = {
        type: 'input_audio_buffer.commit'
      };

      this.send(message);
      console.log('✅ Audio buffer committed');
      
      return true;
    } catch (error) {
      console.error('❌ Error committing audio buffer:', error.message);
      return false;
    }
  }

  /**
   * Create user message (alternative to audio)
   */
  sendTextMessage(text) {
    if (!this.isConnected) {
      console.error('❌ WebSocket not connected');
      return false;
    }

    try {
      const message = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: text
          }]
        }
      };

      this.send(message);

      // Request response generation
      this.send({ type: 'response.create' });

      return true;
    } catch (error) {
      console.error('❌ Error sending text message:', error.message);
      return false;
    }
  }

  /**
   * Disconnect from API
   */
  disconnect() {
    try {
      if (this.ws) {
        this.ws.close();
        this.isConnected = false;
        console.log('👋 Disconnected from Realtime API');
      }
    } catch (error) {
      console.error('❌ Error disconnecting:', error.message);
    }
  }

  /**
   * Start real-time conversation with SIP media
   * 
   * This function:
   * 1. Connects to OpenAI Realtime API
   * 2. Captures audio from SIP call
   * 3. Sends audio to API in real-time
   * 4. Receives and plays back AI responses
   */
  async start(mediaStream, session) {
    try {
      console.log('🚀 Starting Realtime conversation');

      // Connect to API
      await this.connect();

      // Store references
      this.mediaStream = mediaStream;
      this.session = session;

      // Set up audio capture from SIP
      // Note: sipstel doesn't expose audio frames directly
      // This is a conceptual implementation
      // In practice, you'd need to:
      // 1. Record RTP audio to buffer
      // 2. Resample to 24kHz PCM16 (Realtime API requirement)
      // 3. Send chunks to API

      console.log('🎯 Realtime conversation active');

      // Emit ready event
      this.emit('ready');

      return true;

    } catch (error) {
      console.error('❌ Error starting conversation:', error.message);
      return false;
    }
  }

  /**
   * Stop real-time conversation
   */
  stop() {
    console.log('⏹️  Stopping Realtime conversation');
    this.disconnect();
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      sessionId: this.sessionId,
      wsState: this.ws?.readyState || null
    };
  }
}

module.exports = RealtimeHandler;
