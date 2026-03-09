import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Vosk from 'vosk-browser';
import axios from 'axios';
import './SavedLocations.css';

interface SavedLocation {
  id?: number;
  name: string;
  lat?: number;
  lng?: number;
  latitude?: number; 
  longitude?: number;
}

const SavedLocations: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Initializing...");
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  
  // Modal states
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showCurrentLocModal, setShowCurrentLocModal] = useState(false);
  const [newLink, setNewLink] = useState("");
  const [newLocName, setNewLocName] = useState("");

  const modelRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const locationsRef = useRef(locations); 
  
  // Get User ID from LocalStorage
  const userStr = localStorage.getItem("user");
  const userId = userStr ? JSON.parse(userStr).id : null;

  useEffect(() => { locationsRef.current = locations; }, [locations]);

  // --- 1. FETCH FROM DATABASE & VOSK SETUP ---
  useEffect(() => {
    if (!userId) {
      navigate('/login');
      return;
    }

    const fetchLocations = async () => {
      try {
        setStatus("Fetching locations...");
        const res = await axios.get(`https://visionwalk-backend.onrender.com/api/locations/${userId}`);
        setLocations(res.data);
        speak(`Saved locations loaded. You have ${res.data.length} locations. Say 'Save current location', 'Go to' followed by a name, or 'Back'.`);
      } catch (err) {
        console.error("Failed to load locations", err);
        speak("Error loading your saved locations from the server.");
      }
    };

    async function loadVoiceModel() {
      try {
        const model = await Vosk.createModel('/models/vosk/model.tar.gz');
        modelRef.current = model;
        setStatus("Listening...");
        startListening(model);
      } catch (err) {
        setStatus("Voice Error");
      }
    }

    fetchLocations();
    loadVoiceModel();

    return () => { stopListening(); }; 
  }, [userId, navigate]);

  const speak = (text: string) => {
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // --- 2. DATABASE SAVE ACTIONS ---
  const saveToDatabase = async (name: string, lat: number, lng: number) => {
    try {
      const res = await axios.post('https://visionwalk-backend.onrender.com/api/locations', {
        userId: userId,
        name: name,
        lat: lat,
        lng: lng
      });
      setLocations(prev => [...prev, res.data]);
      speak(`Success. ${name} has been permanently saved.`);
      
      // Restart listening to inject the new location sentence into the AI grammar
      stopListening();
      startListening(modelRef.current);
    } catch (err) {
      console.error("DB Save Error:", err);
      speak("Error. Could not save location to the server.");
    }
  };

  const initiateSaveCurrentLocation = () => {
    speak("Please type or dictate a name for this location.");
    setNewLocName("");
    setShowCurrentLocModal(true);
  };

  const confirmSaveCurrentLocation = () => {
    if (!newLocName.trim()) {
      speak("Please provide a valid name.");
      return;
    }

    speak(`Acquiring GPS signal to save ${newLocName}.`);
    setShowCurrentLocModal(false);

    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition((pos) => {
      saveToDatabase(newLocName, pos.coords.latitude, pos.coords.longitude);
      setNewLocName("");
    }, () => {
      speak("Failed to get GPS location. Please check permissions.");
    }, { enableHighAccuracy: true });
  };

  const handleSaveLink = () => {
    speak("Saving location from link.");
    saveToDatabase(newLocName || "New Map Link", 0, 0); 
    setShowLinkModal(false);
    setNewLocName("");
    setNewLink("");
  };

  // --- 3. NAVIGATION REDIRECT ---
  const startNavigation = (loc: SavedLocation) => {
    speak(`Navigating to ${loc.name}. Starting guidance.`);
    const finalLat = loc.lat ?? loc.latitude;
    const finalLng = loc.lng ?? loc.longitude;
    // PERFECT REDIRECT: Pushes exact coordinates to the navigation screen
    navigate('/navigation', { state: { targetLat: finalLat, targetLng: finalLng, targetName: loc.name } });
  };

  const handleBack = () => {
    speak("Returning to main menu.");
    navigate('/home'); 
  };

  // --- 4. VOICE COMMAND PROCESSOR (SMART ROUTING) ---
  const handleCommand = (text: string) => {
    const cmd = text.toLowerCase().trim();
    if (!cmd) return;

    if (cmd.includes("back") || cmd.includes("exit") || cmd.includes("home")) {
        handleBack();
        return;
    }

    if (cmd.includes("save current location") || cmd.includes("save here")) {
        initiateSaveCurrentLocation();
        return;
    }

    // 🚨 PERFECT MATCHING: Checks for exact phrases like "go to office"
    if (cmd.startsWith("go to ") || cmd.startsWith("navigate to ")) {
        // Strip out the command to get just the location name
        const targetName = cmd.replace("go to ", "").replace("navigate to ", "").trim();
        
        // Find the exact match in the database
        const foundLocation = locationsRef.current.find(loc => loc.name.toLowerCase() === targetName);

        if (foundLocation) {
            startNavigation(foundLocation);
        } else {
            speak(`I could not find ${targetName} in your saved list.`);
        }
        return;
    }

    // Fallback: If they just say the name directly without "go to"
    const directMatch = locationsRef.current.find(loc => cmd === loc.name.toLowerCase());
    if (directMatch) {
        startNavigation(directMatch);
        return;
    }
  };

  // --- 5. VOSK AUDIO ENGINE (SMART SENTENCE GRAMMAR) ---
  const startListening = async (model: any) => {
    if (!model) return;
    try {
        const ctx = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = ctx;
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true } 
        });
        const source = ctx.createMediaStreamSource(stream);
        
        const baseCommands = ["back", "exit", "home", "save current location", "save here", "[unk]"];
        const locationNames = locationsRef.current.map(loc => loc.name.toLowerCase());
        
        // 🚨 PRO TRICK: Create full sentences for the AI to expect
        const goToCommands = locationNames.map(name => `go to ${name}`);
        const navigateCommands = locationNames.map(name => `Maps to ${name}`);
        
        // Inject everything into the brain
        const fullGrammarArray = [...baseCommands, ...locationNames, ...goToCommands, ...navigateCommands];
        const grammar = JSON.stringify(fullGrammarArray);

        const recognizer = new model.KaldiRecognizer(16000, grammar);
        
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
    } catch (e) { 
        console.error("Mic Error:", e);
        setStatus("Mic Error");
    }
  };

  const stopListening = () => {
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
  };

  return (
    <div className="locations-container">
      <header className="locations-header">
        <button className="back-btn" onClick={handleBack}>⬅ Back</button>
        <h2>Saved Locations</h2>
        <div className="status-indicator">🎙️ {status}</div>
      </header>

      <div className="action-bar">
        <button className="action-btn" onClick={initiateSaveCurrentLocation}>
          <span className="action-icon">📍</span>
          Save Current
        </button>
      
        <button className="action-btn" onClick={() => { setNewLocName(""); setShowLinkModal(true); }}>
          <span className="action-icon">🔗</span>
          Save via Link
        </button>
      </div>

      <div className="locations-grid">
        {locations.length === 0 ? (
          <p style={{ textAlign: 'center', width: '100%', color: '#aaa' }}>
            No saved locations yet. Say "Save current location" to add one!
          </p>
        ) : (
          locations.map((loc, index) => (
            <div key={loc.id || index} className="location-card" onClick={() => startNavigation(loc)}>
              <div className="location-name">{loc.name}</div>
              <div className="location-coords">
                  {(loc.lat ?? loc.latitude ?? 0).toFixed(4)}, {(loc.lng ?? loc.longitude ?? 0).toFixed(4)}
              </div>
              <button className="go-btn">Go Here</button>
            </div>
          ))
        )}
      </div>

      {showCurrentLocModal && (
        <div className="loc-modal-overlay">
          <div className="loc-modal">
            <h3>Name this Location</h3>
            <p style={{color: '#94a3b8', fontSize: '14px', marginBottom: '15px'}}>
              What do you want to call your current physical location?
            </p>
            <input 
              type="text" 
              placeholder="e.g., My House" 
              value={newLocName} 
              onChange={(e) => setNewLocName(e.target.value)} 
              autoFocus
            />
            <button className="go-btn" onClick={confirmSaveCurrentLocation}>Save GPS Point</button>
            <button className="back-btn" onClick={() => setShowCurrentLocModal(false)} style={{marginTop: '10px'}}>Cancel</button>
          </div>
        </div>
      )}

      {showLinkModal && (
        <div className="loc-modal-overlay">
          <div className="loc-modal">
            <h3>Paste Google Maps Link</h3>
            <input 
              type="text" 
              placeholder="Name (e.g., Office)" 
              value={newLocName} 
              onChange={(e) => setNewLocName(e.target.value)} 
            />
            <input 
              type="text" 
              placeholder="https://maps.google.com/..." 
              value={newLink} 
              onChange={(e) => setNewLink(e.target.value)} 
            />
            <button className="go-btn" onClick={handleSaveLink}>Save Location</button>
            <button className="back-btn" onClick={() => setShowLinkModal(false)} style={{marginTop: '10px'}}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SavedLocations;