import { useEffect, useRef, useState } from 'react';

// Speech-to-Text & AI Classifier Utility
export function parseVoiceEmergency(transcript = '') {
  const text = transcript.toLowerCase();

  // 1. Situation Detection
  let situation = 'stranded'; // default for flood emergency
  if (/injur|bleed|hurt|fracture|cut|pain|doctor|hospital|ambulance|ghayal|chot|patient/.test(text)) {
    situation = 'injured';
  } else if (/food|water|ration|hungry|thirst|supplies|khana|paani/.test(text)) {
    situation = 'supplies';
  } else if (/evacuat|leave|escape|get out|boat|shift|rescue/.test(text)) {
    situation = 'evacuate';
  } else if (/stranded|trap|rising|roof|top|submerged|marooned|phans|flooded/.test(text)) {
    situation = 'stranded';
  }

  // 2. People Count Extraction
  let peopleCount = '1';
  const numberWordMap = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const countMatch = text.match(/(\d+)\s*(people|person|members|adults|children|kids|family|us)?/) ||
                     text.match(/(one|two|three|four|five|six|seven|eight|nine|ten)\s*(people|person|members|adults|children|kids|family|us)?/);

  if (countMatch) {
    const matched = countMatch[1];
    if (numberWordMap[matched]) {
      peopleCount = String(numberWordMap[matched]);
    } else if (!isNaN(parseInt(matched))) {
      peopleCount = String(parseInt(matched));
    }
  }

  // 3. Flag Detection
  const flags = [];
  if (/injur|bleed|fracture|heart|breath|unconscious|medical|doctor|pain/.test(text)) flags.push('medical_emergency');
  if (/elder|old|grandma|grandpa|senior|aged/.test(text)) flags.push('elderly');
  if (/child|kid|infant|baby|toddler|son|daughter/.test(text)) flags.push('children');
  if (/pregnan/.test(text)) flags.push('pregnant');
  if (/disab|wheelchair|blind|deaf/.test(text)) flags.push('disabled');
  if (/no food|no water|hungry|thirst|starv/.test(text)) flags.push('no_supplies');
  if (/collaps|crack|structur|roof|wall falling|damage/.test(text)) flags.push('structural_danger');

  // 4. Severity Assessment
  let severity = 'normal';
  if (situation === 'injured' || flags.includes('medical_emergency') || flags.includes('structural_danger') || /critical|help now|urgent|dying|save us|immediately/.test(text)) {
    severity = 'critical';
  } else if (situation === 'stranded' || flags.length > 0 || parseInt(peopleCount) >= 4) {
    severity = 'high';
  }

  // 5. Location Hint Extraction
  let locationHint = '';
  const locMatch = text.match(/(near|at|in|by|opposite|behind|next to)\s+([a-z0-9\s,#]+?)(?=(\.|\,|and|we|need|help|please|$))/i);
  if (locMatch) {
    locationHint = locMatch[0].trim();
  }

  // 6. Summary Generation
  const summary = transcript
    ? `Voice SOS: "${transcript.length > 90 ? transcript.slice(0, 90) + '...' : transcript}"`
    : `Voice emergency reported for ${peopleCount} person(s).`;

  return {
    situation,
    severity,
    peopleCount,
    flags,
    locationHint,
    summary,
    transcript: transcript || '(Audio recorded - spoken text unavailable)'
  };
}

export default function VoiceSOSModal({ isOpen, onClose, onVoiceRecorded }) {
  const [stage, setStage] = useState('recording'); // 'recording' | 'preview' | 'error'
  const [timeLeft, setTimeLeft] = useState(10);
  const [errorMsg, setErrorMsg] = useState('');
  const [transcript, setTranscript] = useState('');
  const [audioUrl, setAudioUrl] = useState(null);
  const [base64Data, setBase64Data] = useState(null);
  const [audioSizeKb, setAudioSizeKb] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const animFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const recognitionRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const audioPreviewRef = useRef(null);

  // Initialize Speech Recognition if supported
  const startSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let fullTranscript = '';
        recognition.onresult = (event) => {
          let current = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            current += event.results[i][0].transcript;
          }
          fullTranscript = current;
          setTranscript(fullTranscript);
        };
        recognition.onerror = (err) => {
          console.warn('Speech recognition warning:', err.error);
        };
        recognition.start();
        recognitionRef.current = recognition;
      } catch (err) {
        console.warn('Speech recognition init failed:', err);
      }
    }
  };

  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
  };

  // Start MediaRecorder & Audio Visualizer
  const startRecording = async () => {
    setErrorMsg('');
    setStage('recording');
    setTimeLeft(10);
    setTranscript('');
    setAudioUrl(null);
    setBase64Data(null);
    setAudioSizeKb(0);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Determine best low-bitrate MIME type
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          mimeType = 'audio/ogg';
        } else {
          mimeType = '';
        }
      }

      const recorderOptions = mimeType ? { mimeType, audioBitsPerSecond: 12000 } : { audioBitsPerSecond: 12000 };
      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop stream tracks
        stream.getTracks().forEach((track) => track.stop());

        // Process audio blob
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        const sizeInKb = (audioBlob.size / 1024).toFixed(1);
        setAudioSizeKb(sizeInKb);

        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);

        // Convert to Base64 for offline storage & fast transmission
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const b64 = reader.result;
          setBase64Data(b64);

          // Perform speech & emergency parsing
          const analysis = parseVoiceEmergency(transcript);
          setAnalysisResult(analysis);
          setStage('preview');
        };
      };

      // Set up Web Audio API visualizer
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const drawWaveform = () => {
          if (!canvasRef.current) return;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          const width = canvas.width;
          const height = canvas.height;

          analyser.getByteFrequencyData(dataArray);

          ctx.clearRect(0, 0, width, height);
          const barWidth = (width / bufferLength) * 2;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;
            ctx.fillStyle = '#FF5A1F';
            ctx.beginPath();
            ctx.roundRect(x, height - barHeight, barWidth - 2, barHeight, 4);
            ctx.fill();
            x += barWidth;
          }
          animFrameRef.current = requestAnimationFrame(drawWaveform);
        };
        drawWaveform();
      } catch (err) {
        console.warn('AudioContext visualization not available:', err);
      }

      // Start recording & speech recognition
      mediaRecorder.start(250);
      startSpeechRecognition();

      // Countdown Timer (10 seconds)
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      console.error('Microphone error:', err);
      setStage('error');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMsg('Microphone access was denied. Please allow microphone permissions in your browser settings to use Voice SOS.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMsg('No microphone was found on your device.');
      } else {
        setErrorMsg('Could not start audio recording: ' + (err.message || 'Unknown error'));
      }
    }
  };

  const stopRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    stopSpeechRecognition();

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch (e) {}
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
  };

  useEffect(() => {
    if (isOpen) {
      startRecording();
    } else {
      stopRecording();
    }
    return () => {
      stopRecording();
    };
  }, [isOpen]);

  const handleTogglePlay = () => {
    if (!audioPreviewRef.current) return;
    if (isPlaying) {
      audioPreviewRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPreviewRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleApplyVoiceSOS = () => {
    if (onVoiceRecorded && base64Data) {
      onVoiceRecorded({
        audioData: base64Data,
        audioSizeKb,
        transcript: transcript || (analysisResult?.transcript || ''),
        analysis: analysisResult
      });
    }
    onClose();
  };

  if (!isOpen) return null;

  // Circular countdown calculations (Radius: 48, Circumference: ~301.59)
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (timeLeft / 10) * circumference;

  return (
    <div className="voice-sos-modal-overlay">
      <div className="voice-sos-modal-content">
        <div className="modal-header">
          <h3>🎙️ Voice SOS Assistant</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {stage === 'error' && (
          <div className="voice-error-box">
            <div className="error-icon">⚠️</div>
            <p className="error-text">{errorMsg}</p>
            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="voice-btn secondary" onClick={startRecording}>Retry</button>
              <button className="voice-btn danger" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {stage === 'recording' && (
          <div className="voice-recording-body">
            {/* Pulsing Mic with Circular SVG Countdown */}
            <div className="mic-countdown-wrapper">
              <svg className="countdown-svg" width="120" height="120" viewBox="0 0 120 120">
                <circle className="countdown-bg" cx="60" cy="60" r={radius} strokeWidth="6" />
                <circle
                  className="countdown-progress"
                  cx="60"
                  cy="60"
                  r={radius}
                  strokeWidth="6"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                />
              </svg>
              <div className="mic-aura-ring"></div>
              <div className="mic-center-btn">
                <span className="mic-icon">🎤</span>
                <span className="timer-number">{timeLeft}s</span>
              </div>
            </div>

            <div className="recording-status">Recording... Speak clearly</div>

            {/* Live Frequency Waveform Canvas */}
            <div className="waveform-container">
              <canvas ref={canvasRef} width="260" height="40" className="waveform-canvas"></canvas>
            </div>

            {/* Live Transcript Display */}
            <div className="transcript-box">
              {transcript ? (
                <p className="transcript-text">"{transcript}"</p>
              ) : (
                <p className="transcript-placeholder">Listening for your emergency location & situation...</p>
              )}
            </div>

            <div className="modal-actions">
              <button className="voice-btn danger" onClick={stopRecording}>
                ⏹️ Stop Recording
              </button>
              <button className="voice-btn secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {stage === 'preview' && (
          <div className="voice-preview-body">
            <div className="preview-success-badge">
              ✓ Voice SOS Compressed ({audioSizeKb} KB)
            </div>

            {/* Audio Preview Controls */}
            <audio
              ref={audioPreviewRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              style={{ display: 'none' }}
            />

            <div className="audio-player-card">
              <button className="play-pause-btn" onClick={handleTogglePlay}>
                {isPlaying ? '⏸️ Pause' : '▶️ Play Preview'}
              </button>
              <div className="audio-meta">
                <span>Compressed Opus Audio</span>
                <span className="badge-small">{audioSizeKb} KB</span>
              </div>
            </div>

            {/* AI Parsing Auto-Fill Preview Card */}
            {analysisResult && (
              <div className="ai-parsed-card">
                <div className="card-title">🤖 AI Emergency Detection</div>
                <div className="parsed-grid">
                  <div>
                    <span className="label">Category:</span>
                    <b className="val" style={{ textTransform: 'capitalize' }}>{analysisResult.situation}</b>
                  </div>
                  <div>
                    <span className="label">Headcount:</span>
                    <b className="val">{analysisResult.peopleCount} person(s)</b>
                  </div>
                  <div>
                    <span className="label">Severity:</span>
                    <span className={`badge-small ${analysisResult.severity === 'critical' ? 'danger' : 'warn'}`}>
                      {analysisResult.severity.toUpperCase()}
                    </span>
                  </div>
                </div>

                {analysisResult.locationHint && (
                  <div className="parsed-location">
                    📍 <b>Location Hint:</b> {analysisResult.locationHint}
                  </div>
                )}

                <div className="parsed-transcript">
                  📝 <b>Transcript:</b> "{analysisResult.transcript}"
                </div>
              </div>
            )}

            <div className="modal-actions-grid">
              <button className="voice-btn secondary" onClick={startRecording}>
                🔄 Record Again
              </button>
              <button className="voice-btn success" onClick={handleApplyVoiceSOS}>
                ✅ Auto-Fill Form & Submit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
