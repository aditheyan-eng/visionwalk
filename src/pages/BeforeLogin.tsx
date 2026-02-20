import React, { useState, useRef, useEffect } from 'react';
import * as Vosk from 'vosk-browser'; 
import { useNavigate } from 'react-router-dom';
import './Home.css'; 

const BeforeLogin: React.FC = () => {
  const navigate = useNavigate();
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState("System Ready");
  const [isPocketMode, setIsPocketMode] = useState(false);
  
  // Refs for persistent state across renders
  const isPocketModeRef = useRef(false);
  const modelRef = useRef<any>(null); 
  const audioContextRef = useRef<AudioContext | null>(null);

  // 1. Auto-redirect if user is already logged in
  useEffect(() => {
    const user = localStorage.getItem("user");
    if (user) {
      console.log("User already logged in, redirecting to Home...");
      navigate('/home');
    }
  }, [navigate]);

  // Sync state with ref for the voice listener
  useEffect(() => { isPocketModeRef.current = isPocketMode; }, [isPocketMode]);

  useEffect(() => {
    let wakeLock: any = null;

    async function loadModel() {
      try {
        const model = await Vosk.createModel('/models/vosk/model.tar.gz');
        modelRef.current = model;
        setStatus("Voice Ready. Say 'Start'");
        
        // --- NEW STARTUP NOTIFICATION ---
        speak("Welcome to Vision Walk. Tap on the center of the screen or say start, to begin.");
      } catch (e) { 
        console.error("Vosk Load Failed:", e);
        setStatus("Voice Model Failed to Load");
      }
    }
    loadModel();

    // Prevent phone screen from turning off
    const requestWakeLock = async () => {
        try {
          if ('wakeLock' in navigator && document.visibilityState === 'visible') {
            wakeLock = await (navigator as any).wakeLock.request('screen');
          }
        } catch (err) { console.log("Wake Lock skipped"); }
    };
    requestWakeLock();
    document.addEventListener('visibilitychange', requestWakeLock);

    return () => {
        if (wakeLock) wakeLock.release();
        document.removeEventListener('visibilitychange', requestWakeLock);
    };
  }, []);

  const speak = (text: string) => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  };

  const handleCommand = (text: string) => {
    const cmd = text.toLowerCase().trim();
    if (!cmd) return;
    console.log("Command received:", cmd);

    // Security: Pocket Mode logic
    if (isPocketModeRef.current) {
        if (cmd.includes("unlock") || cmd.includes("exit")) {
            speak("Unlocking system.");
            setIsPocketMode(false);
        }
        return;
    }

    // Navigation Logic
    if (cmd.includes("login")) { 
        speak("Opening login page."); 
        navigate('/login'); 
        return; 
    }
    
    if (cmd.includes("pocket mode")) { 
        speak("Pocket mode active."); 
        setIsPocketMode(true); 
        return; 
    }

    // --- NEW DIRECT START LOGIC ---
    if (cmd.includes("start")) { 
        speak("Starting Vision Walk.");
        navigate('/vision'); // Goes directly to LiveVision now!
        return; 
    }
  };

  const toggleListening = async () => {
    if (isListening) {
        setIsListening(false);
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        setStatus("Paused");
    } else {
        if (!modelRef.current) {
            alert("Voice model is still loading, please wait...");
            return;
        }

        try {
            const ctx = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = ctx;
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            const source = ctx.createMediaStreamSource(stream);
            
            const grammar = '["login", "start", "pocket mode", "unlock", "exit", "[unk]"]';
            const recognizer = new modelRef.current.KaldiRecognizer(16000, grammar);
            
            recognizer.on("result", (msg: any) => { 
                if(msg.result && msg.result.text) {
                    handleCommand(msg.result.text);
                }
            });
            
            const node = ctx.createScriptProcessor(4096, 1, 1);
            node.onaudioprocess = (e) => {
                try {
                    recognizer.acceptWaveform(e.inputBuffer);
                } catch {
                    // --- VERCEL TYPESCRIPT FIX: Removed 'err' variable ---
                }
            };
            
            source.connect(node);
            node.connect(ctx.destination);
            
            setIsListening(true);
            setStatus("Listening...");
        } catch (err) {
            console.error("Microphone Error:", err);
            setStatus("Microphone Error");
        }
    }
  };

  return (
    <div className="app-container">
      {isPocketMode && (
        <div className="pocket-overlay">
            <div className="pocket-content">
                <h1>LOCKED</h1>
                <p>Say "Unlock" or "Exit"</p>
            </div>
        </div>
      )}
      
      <header className="dashboard-header">
        <span style={{fontWeight: 'bold', fontSize: '1.2rem', color: 'white'}}>VISION WALK</span>
        <button 
            className="logout-btn" 
            style={{borderColor:'#06b6d4', color:'#06b6d4', background:'rgba(6,182,212,0.1)'}} 
            onClick={() => {
                speak("Opening login page.");
                navigate('/login');
            }}
        >
            Login
        </button>
      </header>

      <main className="main-content">
        <div className="status-label">{status}</div>
        
        <div className="orb-container">
            {isListening && <div className="ripple"></div>}
            {/* The orb acts as the center of the screen to tap! */}
            <button className={`orb-btn ${isListening ? 'listening' : ''}`} onClick={toggleListening}>
                <div className="orb-text">
                   <span className="orb-icon">{isListening ? '🎙️' : '👆'}</span>
                   <span>{isListening ? 'LISTENING' : 'START'}</span>
               </div>
            </button>
        </div>
        
        <p style={{ marginTop: '20px', color: '#94a3b8' }}>
            Say "Start" or "Login"
        </p>
      </main>
    </div>
  );
};

export default BeforeLogin;