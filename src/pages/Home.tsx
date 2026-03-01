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
  
  // Modal States
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

    return () => { stopListening(); }; // Cleanup on unmount
  }, [navigate]); 

  const speak = (text: string) => {
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // --- 2. CORE ACTIONS ---
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
      speak("Success. Guardian email updated.");
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
      speak("Guardian removed.");
    } catch (e) {
      speak("Failed to remove guardian.");
    }
  };

  const triggerEmergency = async () => {
    speak("Initiating emergency alert.");
    if (!navigator.geolocation || !userRef.current) return;

    const guardianEmail = userRef.current.guardianEmail;
    if (!guardianEmail) {
        speak("Please set a guardian email in settings first.");
        setStatus("No Guardian Set!");
        return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        emailjs.send("service_fy7hkfh", "template_l7875ip", {
            to_email: guardianEmail,
            user_name: userRef.current?.name || "User",
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
        }, "rbtoUP--BpijCqTh7")
            .then(() => {
                speak("Alert sent.");
                setStatus("SOS Sent!");
            })
            .catch(() => {
                speak("Alert failed.");
                setStatus("SOS Failed");
            });
      }, 
      () => speak("Could not find location.")
    );
  };

  const handleLogout = () => {
    speak("Logging out. Goodbye.");
    localStorage.removeItem("user");
    navigate('/login');
  };

  // --- 3. VOICE COMMAND LOGIC ---
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

    // Voice Routing Commands!
    if (cmd.includes("saved location") || cmd.includes("locations")) { 
        speak("Opening saved locations.");
        navigate('/location'); 
        return; 
    }

    if (cmd.includes("start") || cmd.includes("vision")) { 
        speak("Starting vision mode.");
        navigate('/vision'); 
        return; 
    }

    if (cmd.includes("logout") || cmd.includes("log out")) { 
        handleLogout(); 
        return; 
    }

    if (cmd.includes("help") || cmd.includes("emergency")) { 
        triggerEmergency(); 
        return; 
    }

    if (cmd.includes("pocket mode")) { 
        speak("Screen locked."); 
        setIsPocketMode(true); 
        return; 
    }
  };

  // --- 4. AUDIO HANDLING ---
  const startListening = async () => {
    if (!modelRef.current) return;
    try {
        const ctx = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = ctx;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = ctx.createMediaStreamSource(stream);
        const recognizer = new modelRef.current.KaldiRecognizer(16000);
        
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
    <div className="home-container">
      {isPocketMode && (
        <div className="pocket-overlay">
            <div className="lock-icon">🔒</div>
            <h1>LOCKED</h1>
            <p>Touch disabled.</p>
            <p style={{ marginTop: '20px', color: '#fff' }}>Say <strong>"Unlock"</strong></p>
        </div>
      )}
      
      {/* HEADER */}
      <header className="home-header">
         <div className="user-profile-btn" onClick={() => setIsModalOpen(true)}>
            <span className="avatar">👤</span>
            <span className="name">{user?.name || "User"}</span>
         </div>
         <button className="logout-button" onClick={handleLogout}>Logout</button>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="home-main">
        <div className="mic-status">{status}</div>
        
        {/* BIG CENTER BUTTON */}
        <div className="center-orb-wrapper">
            {isListening && <div className="pulse-ring"></div>}
            <button 
                className={`main-orb ${isListening ? 'active' : ''}`} 
                onClick={() => isListening ? stopListening() : startListening()}
            >
               <span className="orb-emoji">{isListening ? '🎙️' : '👆'}</span>
               <span className="orb-label">{isListening ? 'LISTENING' : 'START MIC'}</span>
            </button>
        </div>
        
        {/* BOTTOM ACTION BUTTONS */}
        <div className="bottom-actions">
            <button className="nav-card" onClick={() => navigate('/vision')}>
                <span className="card-icon">👁️</span>
                <span className="card-text">Vision</span>
            </button>
            <button className="nav-card" onClick={() => navigate('/location')}>
                <span className="card-icon">📍</span>
                <span className="card-text">Saved Loc</span>
            </button>
            <button className="nav-card emergency" onClick={triggerEmergency}>
                <span className="card-icon">🆘</span>
                <span className="card-text">HELP</span>
            </button>
        </div>
      </main>

      {/* MODAL */}
      {isModalOpen && (
        <div className="modal-bg">
          <div className="settings-modal">
            <h2>Guardian Settings</h2>
            <input 
              type="email" 
              placeholder="Guardian Email" 
              value={tempEmail}
              onChange={(e) => setTempEmail(e.target.value)}
              className="settings-input"
            />
            <div className="settings-btn-row">
              <button onClick={saveGuardian} className="btn-save">Save</button>
              <button onClick={deleteGuardian} className="btn-remove">Remove</button>
            </div>
            <button onClick={() => setIsModalOpen(false)} className="btn-close">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;