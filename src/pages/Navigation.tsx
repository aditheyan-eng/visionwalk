import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as tf from '@tensorflow/tfjs';
import * as cocossd from '@tensorflow-models/coco-ssd';
import * as Vosk from 'vosk-browser';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Navigation.css';

// Fix for default Leaflet marker icons
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const Navigation: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const targetLat = location.state?.targetLat;
  const targetLng = location.state?.targetLng;

  // UI States
  const [navStatus, setNavStatus] = useState("Initializing...");
  const [currentInstruction, setCurrentInstruction] = useState("Awaiting route...");
  const [aiStatus, setAiStatus] = useState("Loading AI...");
  const [isPocketMode, setIsPocketMode] = useState(false);
  const [showMap, setShowMap] = useState(false);

  // Map Data States
  const [currentLoc, setCurrentLoc] = useState<[number, number] | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][]>([]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const watchIdRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const voskModelRef = useRef<any>(null);
  
  const isPocketModeRef = useRef(false);
  useEffect(() => { isPocketModeRef.current = isPocketMode; }, [isPocketMode]);

  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const speak = (text: string, priority: boolean = false) => {
    if (priority) window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
  };

  // --- 1. VOICE COMMANDS (VOSK) ---
  const handleCommand = (text: string) => {
    const cmd = text.toLowerCase().trim();
    if (!cmd) return;

    if (isPocketModeRef.current) {
        if (cmd.includes("unlock") || cmd.includes("disable pocket mode")) {
            setIsPocketMode(false);
            speak("Screen unlocked.");
        }
        return; 
    }

    if (cmd.includes("pocket mode") || cmd.includes("lock screen")) {
        setIsPocketMode(true);
        speak("Pocket mode activated. Say 'Unlock' to restore.");
        return;
    }

    if (cmd.includes("show map")) { setShowMap(true); speak("Map view enabled."); return; }
    if (cmd.includes("hide map") || cmd.includes("show camera")) { setShowMap(false); speak("Camera view enabled."); return; }

    // 🚨 ADDED "HOME" LOGIC HERE
    if (cmd.includes("home")) {
        speak("Returning to home screen.");
        navigate('/home');
        return;
    }

    if (cmd.includes("back") || cmd.includes("exit")) {
        speak("Ending navigation.");
        navigate(-1);
        return;
    }
  };

  useEffect(() => {
    const initVosk = async () => {
      try {
        const model = await Vosk.createModel('/models/vosk/model.tar.gz');
        voskModelRef.current = model;
        
        const ctx = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = ctx;
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true } 
        });
        const source = ctx.createMediaStreamSource(stream);
        
        // 🚨 ADDED "home" to the Grammar Array
        const grammar = '["unlock", "disable pocket mode", "pocket mode", "lock screen", "show map", "hide map", "show camera", "back", "exit", "home", "[unk]"]';
        const recognizer = new model.KaldiRecognizer(16000, grammar);
        
        recognizer.on("result", (msg: any) => {
            if (msg.result && msg.result.text) handleCommand(msg.result.text);
        });
        
        const node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => recognizer.acceptWaveform(e.inputBuffer);
        source.connect(node);
        node.connect(ctx.destination);
      } catch (err) { console.error("Vosk error:", err); }
    };
    initVosk();
    return () => { if (audioContextRef.current) audioContextRef.current.close(); };
  }, []);

  // --- 2. AI OBJECT DETECTION ---
  useEffect(() => {
    let animationId: number;
    const startVisionEngine = async () => {
      try {
        await tf.ready();
        const model = await cocossd.load();
        setAiStatus("AI Active");

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play();
              detectFrame(videoRef.current!, model);
            };
          }
        }
      } catch (err) { setAiStatus("Camera Error"); }
    };

    let lastSpokenObject = "";
    let lastSpokenTime = 0;

    const detectFrame = async (video: HTMLVideoElement, model: cocossd.ObjectDetection) => {
      if (!canvasRef.current) return;
      const predictions = await model.detect(video);
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      predictions.forEach(prediction => {
        const [x, y, width, height] = prediction.bbox;
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 4;
        ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = '#4ade80';
        ctx.fillText(`${prediction.class}`, x, y > 10 ? y - 5 : 10);

        if (width > ctx.canvas.width * 0.4) {
          const now = Date.now();
          if (prediction.class !== lastSpokenObject || now - lastSpokenTime > 5000) {
             speak(`Caution: ${prediction.class} ahead.`, true);
             lastSpokenObject = prediction.class;
             lastSpokenTime = now;
          }
        }
      });
      animationId = requestAnimationFrame(() => detectFrame(video, model));
    };

    startVisionEngine();
    return () => {
      cancelAnimationFrame(animationId);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // --- 3. GPS NAVIGATION (TOMTOM) ---
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; 
    const rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  useEffect(() => {
    if (!targetLat || !targetLng) return;
    const TOMTOM_KEY = "vdDUOcV80JnWR7hlCRGmKKbzFMQjycmr"; 

    const fetchRoute = () => {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const startLat = pos.coords.latitude;
        const startLng = pos.coords.longitude;
        setCurrentLoc([startLat, startLng]); 
        
        try {
          const url = `https://api.tomtom.com/routing/1/calculateRoute/${startLat},${startLng}:${targetLat},${targetLng}/json?instructionsType=text&travelMode=pedestrian&key=${TOMTOM_KEY}`;
          const response = await fetch(url);
          const data = await response.json();
          
          if (data.routes && data.routes.length > 0) {
            const steps = data.routes[0].guidance.instructions;
            const points = data.routes[0].legs[0].points.map((p: any) => [p.latitude, p.longitude]);
            setRoutePath(points);

            setRouteSteps(steps);
            setNavStatus("Navigating");
            setCurrentInstruction(steps[0].message);
            speak(`Navigation started. ${steps[0].message}`);
          }
        } catch (error) { setNavStatus("Routing failed."); }
      });
    };
    fetchRoute();
  }, [targetLat, targetLng]);

  useEffect(() => {
    if (routeSteps.length === 0 || currentStepIndex >= routeSteps.length) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        setCurrentLoc([userLat, userLng]); 
        
        const nextTurn = routeSteps[currentStepIndex];
        const distanceToTurn = calculateDistance(userLat, userLng, nextTurn.point.latitude, nextTurn.point.longitude);

        if (distanceToTurn < 10) {
          if (currentStepIndex + 1 < routeSteps.length) {
            const nextInstruction = routeSteps[currentStepIndex + 1].message;
            setCurrentInstruction(nextInstruction);
            speak(nextInstruction);
            setCurrentStepIndex(prev => prev + 1);
          } else {
            setCurrentInstruction("You have arrived.");
            speak("You have arrived at your destination.");
            setNavStatus("Arrived");
            if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
          }
        }
      },
      (error) => console.error(error),
      { enableHighAccuracy: true, maximumAge: 0 } 
    );
    return () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, [routeSteps, currentStepIndex]);

  return (
    // 🚨 NEW MOBILE-PERFECT CONTAINER: 100dvh guarantees it fits mobile screens!
    <div style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden', backgroundColor: '#000' }}>
      
      {isPocketMode && (
        <div className="pocket-mode-overlay" style={{ zIndex: 9999 }}>
          <div className="lock-icon" style={{ fontSize: '50px' }}>🔒</div>
          <h1>Pocket Mode Active</h1>
          <p>Touch controls disabled.</p>
          <p style={{ marginTop: '20px', color: '#fff' }}>Say <strong>"Unlock"</strong> to restore screen.</p>
        </div>
      )}

      {/* 🚨 CAMERA LAYER: Always rendered so the AI never crashes, just hidden when map is active */}
      <video 
        ref={videoRef} 
        playsInline 
        muted 
        style={{ 
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
          objectFit: 'cover', zIndex: 0, opacity: showMap ? 0 : 1 
        }} 
      />
      <canvas 
        ref={canvasRef} 
        width={window.innerWidth} 
        height={window.innerHeight} 
        style={{ 
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
          zIndex: 1, pointerEvents: 'none', opacity: showMap ? 0 : 1 
        }} 
      />

      {/* 🚨 MAP LAYER: Sits on top of the camera when showMap is true */}
      <div style={{ 
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
          zIndex: 2, opacity: showMap ? 1 : 0, pointerEvents: showMap ? 'auto' : 'none' 
      }}>
        {currentLoc && (
          <MapContainer center={currentLoc} zoom={18} style={{ height: '100%', width: '100%' }} zoomControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {routePath.length > 0 && <Polyline positions={routePath} color="#3b82f6" weight={8} />}
            <Marker position={currentLoc}>
              <Popup>You are here</Popup>
            </Marker>
          </MapContainer>
        )}
      </div>

      {/* 🚨 UI PANEL: Locked to the bottom of the screen, accounting for safe areas! */}
      <div style={{ 
        position: 'absolute', bottom: 0, left: 0, width: '100%', zIndex: 10, 
        backgroundColor: 'rgba(15, 23, 42, 0.95)', padding: '20px', 
        borderTopLeftRadius: '24px', borderTopRightRadius: '24px', backdropFilter: 'blur(10px)', 
        display: 'flex', flexDirection: 'column', gap: '15px',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)' 
      }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold' }}>
            <span style={{ color: '#4ade80' }}>🤖 {aiStatus}</span>
            <span style={{ color: '#60a5fa' }}>📍 {navStatus}</span>
        </div>
        
        <h2 style={{ fontSize: '22px', color: 'white', margin: 0, lineHeight: '1.3' }}>
            {currentInstruction}
        </h2>

        <div style={{ display: 'flex', gap: '10px' }}>
            <button 
                style={{ 
                    flex: 1, padding: '15px', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold',
                    background: 'rgba(255, 255, 255, 0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.3)',
                    cursor: 'pointer'
                }}
                onClick={() => { setShowMap(!showMap); speak(showMap ? "Camera view enabled." : "Map view enabled."); }}
            >
                {showMap ? "📷 Camera" : "🗺️ Map"}
            </button>
            <button 
                style={{ 
                    flex: 1, padding: '15px', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold',
                    background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer'
                }}
                onClick={() => { speak("Ending navigation."); navigate('/home'); }}
            >
                Exit
            </button>
        </div>
      </div>

    </div>
  );
};

export default Navigation;