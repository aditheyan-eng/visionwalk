import React, { useState, useRef, useEffect } from 'react';
import * as Vosk from 'vosk-browser';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import emailjs from '@emailjs/browser';
import './Home.css'; 

interface User {
  id: number;
  name: string;
  email: string;
  guardianEmail?: string;
}

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState("Initializing...");
  const [isPocketMode, setIsPocketMode] = useState(false);
  
  // Modal States for Guardian Email
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempEmail, setTempEmail] = useState("");

  const isPocketModeRef = useRef(false);
  const userRef = useRef<User | null>(null);
  const modelRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => { isPocketModeRef.current = isPocketMode; }, [isPocketMode]);
  useEffect(() => { userRef.current = user; }, [user]);

  // --- 1. INITIALIZATION ---
  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (!storedUser) {
        navigate('/login');
        return;
    }
    const parsedUser = JSON.parse(storedUser);
    setUser(parsedUser);
    setTempEmail(parsedUser.guardianEmail || "");

    async function loadModel() {
      try {
        const model = await Vosk.createModel('/models/vosk/model.tar.gz');
        modelRef.current = model;
        setStatus("Ready");
        speak("System online. Say 'Start', 'Saved Location', or 'Logout'.");
      } catch (err) {
        setStatus("Voice Model Error");
      }
    }
    loadModel();

    return () => { stopListening(); }; 
  }, [navigate]); 

  // --- 2. VOICE FEEDBACK HELPER ---
  const speak = (text: string) => {
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // --- 3. CORE ACTIONS ---
  const saveGuardian = async () => {
    if (!user) return;
    try {
      const res = await axios.post('https://visionwalk-backend.onrender.com/api/guardian', {
        userId: user.id.toString(),
        guardianEmail: tempEmail
      });
      localStorage.setItem("user", JSON.stringify(res.data));
      setUser(res.data);
      setIsModalOpen(false);
      speak("Success. Guardian email updated to " + tempEmail);
    } catch (e) {
      speak("Error. I could not save the guardian email.");
    }
  };

  const deleteGuardian = async () => {
    if (!user) return;
    try {
      const res = await axios.post('https://visionwalk-backend.onrender.com/api/guardian', {
        userId: user.id.toString(),
        guardianEmail: "" 
      });
      localStorage.setItem("user", JSON.stringify(res.data));
      setUser(res.data);
      setTempEmail("");
      setIsModalOpen(false);
      speak("Success. Guardian email has been removed.");
    } catch (e) {
      speak("Error. Failed to remove guardian.");
    }
  };

  const triggerEmergency = async () => {
    speak("Initiating emergency alert. Finding your location.");
    
    if (!navigator.geolocation || !userRef.current) return;

    const guardianEmail = userRef.current.guardianEmail;
    if (!guardianEmail) {
        speak("Alert failed. Please set a guardian email in your settings first.");
        setStatus("No Guardian Set!");
        return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        
        const SERVICE_ID = "service_fy7hkfh";
        const TEMPLATE_ID = "template_l7875ip";
        const PUBLIC_KEY = "rbtoUP--BpijCqTh7";

        const templateParams = {
            to_email: guardianEmail,
            user_name: userRef.current?.name || "User",
            lat: lat,
            lng: lng
        };

        emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams, PUBLIC_KEY)
            .then((response) => {
                console.log("SOS Email sent successfully!", response.status, response.text);
                speak("Emergency alert sent successfully. Your guardian has been notified.");
                setStatus("SOS Sent!");
            })
            .catch((error) => {
                console.error("Failed to send SOS Email:", error);
                speak("Alert failed due to a network error.");
                setStatus("SOS Failed");
            });
      }, 
      (error) => {
        console.error("GPS Error:", error);
        speak("Could not find your location. Please ensure GPS is enabled.");
      }
    );
  };

  const handleLogout = () => {
    speak("Logging out. Goodbye.");
    localStorage.removeItem("user");
    navigate('/login');
  };

  // --- 4. VOICE COMMAND LOGIC ---
  const handleCommand = (text: string) => {
    const cmd = text.toLowerCase().trim();
    if (!cmd) return;

    if (isPocketModeRef.current) {
        if (cmd.includes("unlock") || cmd.includes("disable pocket mode")) { 
            speak("System unlocked."); 
            setIsPocketMode(false); 
        }
        return;
    }

    if (cmd.includes("start")) { 
        speak("Starting vision mode.");
        navigate('/vision'); 
        return; 
    }

    if (cmd.includes("location") || cmd.includes("saved location")) { 
        speak("Opening your saved locations list.");
        navigate('/location'); 
        return; 
    }

    if (cmd.includes("logout") || cmd.includes("log out")) { 
        handleLogout(); 
        return; 
    }

    if (cmd.includes("settings") || cmd.includes("profile")) { 
        speak("Opening settings.");
        setIsModalOpen(true); 
        return; 
    }

    if (cmd.includes("help") || cmd.includes("emergency")) { 
        triggerEmergency(); 
        return; 
    }

    if (cmd.includes("pocket mode") || cmd.includes("lock screen")) { 
        speak("Screen locked."); 
        setIsPocketMode(true); 
        return; 
    }
  };

  // --- 5. AUDIO HANDLING (VOSK) ---
  const startListening = async () => {
    if (!modelRef.current) return;
    try {
        const ctx = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = ctx;
        
        // 🚨 ADDED: Noise suppression and echo cancellation for better recognition
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true } 
        });
        const source = ctx.createMediaStreamSource(stream);
        
        // 🚨 ADDED: Strict grammar cheat sheet so Vosk knows exactly what words to listen for!
        const grammar = '["start", "location", "saved location", "logout", "log out", "settings", "profile", "help", "emergency", "pocket mode", "lock screen", "unlock", "disable pocket mode", "[unk]"]';
        const recognizer = new modelRef.current.KaldiRecognizer(16000, grammar);
        
        recognizer.on("result", (msg: any) => {
            if (msg.result && msg.result.text) {
                console.log("Heard:", msg.result.text);
                handleCommand(msg.result.text);
            }
        });
        
        const node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => recognizer.acceptWaveform(e.inputBuffer);
        source.connect(node);
        node.connect(ctx.destination);
        setIsListening(true);
        setStatus("Listening...");
    } catch (e) { 
        setStatus("Mic Error"); 
        speak("Microphone access denied.");
    }
  };

  const stopListening = () => {
    setIsListening(false);
    setStatus("Ready");
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
  };

  return (
    <div className="app-container">
      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>

      {isPocketMode && (
        <div className="pocket-overlay">
          <div className="pocket-content">
            <div className="lock-icon" style={{fontSize: '60px'}}>🔒</div>
            <h1>LOCKED</h1>
            <p>Touch disabled to prevent accidental clicks.</p>
            <p style={{ marginTop: '20px', color: '#fff' }}>Say <strong>"Unlock"</strong> to restore screen.</p>
          </div>
        </div>
      )}
      
      <header className="dashboard-header">
         <div className="user-info" onClick={() => setIsModalOpen(true)} style={{cursor:'pointer'}}>
            <div className="user-avatar">👤</div>
            <span className="user-name">{user?.name || "User"}</span>
         </div>
         <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </header>

      <main className="main-content">
        <div className="status-label">{status}</div>
        
        <div className="orb-container">
            {isListening && <div className="ripple"></div>}
            {isListening && <div className="ripple" style={{animationDelay: '1s'}}></div>}
            <button className={`orb-btn ${isListening ? 'listening' : ''}`} onClick={() => isListening ? stopListening() : startListening()}>
               <div className="orb-text">
                  <span className="orb-icon">{isListening ? '🎙️' : '👆'}</span>
                  <span>{isListening ? 'LISTENING' : 'START MIC'}</span>
               </div>
            </button>
        </div>
        
        <div className="action-buttons-container">
            <button className="glass-action-btn" onClick={() => navigate('/vision')}>
                <span style={{fontSize: '28px', marginBottom: '5px'}}>👁️</span>
                <span>Vision</span>
            </button>
            <button className="glass-action-btn" onClick={() => navigate('/location')}>
                <span style={{fontSize: '28px', marginBottom: '5px'}}>📍</span>
                <span>Saved Loc</span>
            </button>
            <button className="glass-action-btn" onClick={triggerEmergency} style={{borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)'}}>
                <span style={{fontSize: '28px', marginBottom: '5px'}}>🆘</span>
                <span style={{color: '#fca5a5'}}>HELP</span>
            </button>
        </div>
      </main>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="guardian-modal">
            <h2 style={{color: '#fff', marginBottom: '10px'}}>Guardian Settings</h2>
            <input 
              type="email" 
              placeholder="Guardian Email" 
              value={tempEmail}
              onChange={(e) => setTempEmail(e.target.value)}
              className="modal-input"
            />
            <div className="modal-actions">
              <button onClick={saveGuardian} className="save-btn">Save</button>
              <button onClick={deleteGuardian} className="delete-btn">Remove</button>
              <button onClick={() => setIsModalOpen(false)} className="close-btn">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;