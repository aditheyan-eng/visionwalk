import React, { useState, useRef, useEffect } from 'react';
import * as Vosk from 'vosk-browser';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
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
        speak("System online. Say Start to begin or Saved Location to view your places.");
      } catch (err) {
        setStatus("Voice Model Error");
      }
    }
    loadModel();
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

    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await axios.post('https://visionwalk-backend.onrender.com/api/alert', {
            userId: userRef.current?.id,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
        });
        speak("Emergency alert sent successfully. Your guardian has been notified.");
        setStatus("SOS Sent!");
      } catch (e: any) { 
        speak("Alert failed. Please ensure a guardian email is set."); 
      }
    });
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
        if (cmd.includes("unlock")) { 
            speak("System unlocked."); 
            setIsPocketMode(false); 
        }
        return;
    }

    // Redirect to Saved Locations Page
    if (cmd.includes("saved location")) { 
        speak("Opening your saved locations list.");
        navigate('/locations'); 
        return; 
    }

    if (cmd.includes("start")) { 
        speak("Starting vision mode.");
        navigate('/vision'); 
        return; 
    }

    if (cmd.includes("settings") || cmd.includes("profile")) { 
        speak("Opening settings.");
        setIsModalOpen(true); 
        return; 
    }

    if (cmd.includes("help") || cmd.includes("emergency")) { triggerEmergency(); return; }
    if (cmd.includes("pocket mode")) { speak("Screen locked."); setIsPocketMode(true); return; }
    if (cmd.includes("logout")) { handleLogout(); return; }
  };

  // --- 5. AUDIO HANDLING (VOSK) ---
  const startListening = async () => {
    if (!modelRef.current) return;
    try {
        const ctx = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = ctx;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = ctx.createMediaStreamSource(stream);
        const recognizer = new modelRef.current.KaldiRecognizer(16000);
        
        recognizer.on("result", (msg: any) => {
            if (msg.result && msg.result.text) handleCommand(msg.result.text);
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
      {isPocketMode && (
        <div className="pocket-overlay">
            <h1>LOCKED</h1>
            <p>Say "Unlock" to enable screen</p>
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
            <button className={`orb-btn ${isListening ? 'listening' : ''}`} onClick={() => isListening ? stopListening() : startListening()}>
               <div className="orb-text">
                  <span className="orb-icon">{isListening ? '🎙️' : '👆'}</span>
                  <span>{isListening ? 'LISTENING' : 'START'}</span>
               </div>
            </button>
        </div>
        
        <div className="action-buttons-container">
            <button className="glass-action-btn" onClick={() => navigate('/locations')}>📍 Saved Loc</button>
            <button className="glass-action-btn" onClick={triggerEmergency}>🆘 HELP</button>
        </div>
      </main>

      {/* GUARDIAN MODAL */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="guardian-modal">
            <h2>Guardian Settings</h2>
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