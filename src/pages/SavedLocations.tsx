import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Vosk from 'vosk-browser';
import axios from 'axios';
import './SavedLocations.css';

interface SavedLocation {
  id?: number;
  name: string;
  lat: number;
  lng: number;
}

const SavedLocations: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Initializing...");
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  
  // Modal states
  const [showLinkModal, setShowLinkModal] = useState(false);
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

    // Fetch locations from Spring Boot Backend
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
      // Add the newly saved location from the database to our screen
      setLocations(prev => [...prev, res.data]);
      speak(`Success. ${name} has been permanently saved.`);
    } catch (err) {
      console.error("DB Save Error:", err);
      speak("Error. Could not save location to the server.");
    }
  };

  const saveCurrentLocation = () => {
    speak("Acquiring GPS signal to save current location.");
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition((pos) => {
      const defaultName = `Saved Point ${locations.length + 1}`;
      saveToDatabase(defaultName, pos.coords.latitude, pos.coords.longitude);
    }, () => {
      speak("Failed to get GPS location. Please check permissions.");
    }, { enableHighAccuracy: true });
  };

  const handleSaveLink = () => {
    speak("Saving location from link.");
    // NOTE: Add actual link parsing logic here later to extract lat/lng!
    saveToDatabase(newLocName || "New Map Link", 0, 0); 
    setShowLinkModal(false);
    setNewLocName("");
    setNewLink("");
  };

  // --- 3. NAVIGATION REDIRECT ---
  const startNavigation = (loc: SavedLocation) => {
    speak(`Navigating to ${loc.name}. Starting guidance.`);
    navigate('/navigation', { state: { targetLat: loc.lat, targetLng: loc.lng } });
  };

  const handleBack = () => {
    speak("Returning to main menu.");
    navigate('/home'); 
  };

  // --- 4. VOICE COMMAND PROCESSOR ---
  const handleCommand = (text: string) => {
    const cmd = text.toLowerCase().trim();
    if (!cmd) return;

    if (cmd.includes("back") || cmd.includes("exit") || cmd.includes("go home")) {
        handleBack();
        return;
    }

    if (cmd.includes("save current location") || cmd.includes("save here")) {
        saveCurrentLocation();
        return;
    }

    // Logic for "Go to [Location Name]"
    if (cmd.includes("go to") || cmd.includes("navigate to")) {
        const foundLocation = locationsRef.current.find(loc => 
            cmd.includes(loc.name.toLowerCase())
        );

        if (foundLocation) {
            startNavigation(foundLocation);
        } else {
            speak("I could not find that location in your saved list.");
        }
        return;
    }
  };

  // --- 5. VOSK AUDIO ENGINE ---
  const startListening = async (model: any) => {
    try {
        const ctx = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = ctx;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = ctx.createMediaStreamSource(stream);
        const recognizer = new model.KaldiRecognizer(16000);
        
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
        console.error(e);
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
        <button className="action-btn" onClick={saveCurrentLocation}>
          <span className="action-icon">📍</span>
          Save Current
        </button>
        <button className="action-btn" onClick={() => speak("Map selection coming soon.")}>
          <span className="action-icon">🗺️</span>
          Mark on Map
        </button>
        <button className="action-btn" onClick={() => setShowLinkModal(true)}>
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
              <div className="location-coords">{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</div>
              <button className="go-btn">Go Here</button>
            </div>
          ))
        )}
      </div>

      {/* MODAL FOR SAVING VIA LINK */}
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