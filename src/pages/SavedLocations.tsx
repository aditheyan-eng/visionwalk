import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Vosk from 'vosk-browser';
import './SavedLocations.css';

interface SavedLocation {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

const SavedLocations: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Initializing...");
  const [locations, setLocations] = useState<SavedLocation[]>([
    // Dummy data so you can see the UI immediately. You will replace this with an Axios call later!
    { id: 1, name: "Home", lat: 12.9716, lng: 77.5946 },
    { id: 2, name: "Hospital", lat: 12.9352, lng: 77.6245 }
  ]);
  
  // Modal states
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [newLink, setNewLink] = useState("");
  const [newLocName, setNewLocName] = useState("");

  const modelRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const locationsRef = useRef(locations); // Keep ref updated for the voice command inside the Vosk listener

  useEffect(() => { locationsRef.current = locations; }, [locations]);

  // --- 1. ENTRY VOICE GREETING & VOSK SETUP ---
  useEffect(() => {
    speak("Saved locations menu. Say 'Save current location', 'Go to' followed by a name, or 'Back' to exit.");
    
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
    loadVoiceModel();

    return () => { stopListening(); }; // Cleanup on unmount
  }, []);

  const speak = (text: string) => {
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // --- 2. CORE ACTIONS ---
  const saveCurrentLocation = () => {
    speak("Getting your current location.");
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition((pos) => {
      const newLoc: SavedLocation = {
        id: Date.now(),
        name: `Saved Point ${locations.length + 1}`,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      setLocations([...locations, newLoc]);
      speak(`Location saved as ${newLoc.name}.`);
    }, () => {
      speak("Failed to get GPS location.");
    });
  };

  const handleSaveLink = () => {
    // Basic logic to save a link. In reality, you'd parse the lat/lng from the Google Maps URL
    speak("Location saved from link.");
    const newLoc: SavedLocation = {
      id: Date.now(),
      name: newLocName || "New Map Link",
      lat: 0, // Placeholder until you write the link parser
      lng: 0
    };
    setLocations([...locations, newLoc]);
    setShowLinkModal(false);
  };

  const startNavigation = (loc: SavedLocation) => {
    speak(`Navigating to ${loc.name}. Starting guidance.`);
    // Passes the coordinates to your actual vision/navigation page
    navigate('/vision', { state: { targetLat: loc.lat, targetLng: loc.lng } });
  };

  const handleBack = () => {
    speak("Returning to main menu.");
    navigate(-1); // Goes to previous page
  };

  // --- 3. VOICE COMMAND PROCESSOR ---
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
        // Look through saved locations to find a match
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

  // --- 4. VOSK AUDIO ENGINE ---
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
        {locations.map((loc) => (
          <div key={loc.id} className="location-card" onClick={() => startNavigation(loc)}>
            <div className="location-name">{loc.name}</div>
            <div className="location-coords">{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</div>
            <button className="go-btn">Go Here</button>
          </div>
        ))}
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