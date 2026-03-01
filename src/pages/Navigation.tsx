import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as tf from '@tensorflow/tfjs';
import * as cocossd from '@tensorflow-models/coco-ssd';
import * as Vosk from 'vosk-browser';
import './Navigation.css';

const Navigation: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const targetLat = location.state?.targetLat;
  const targetLng = location.state?.targetLng;

  // UI States
  const [navStatus, setNavStatus] = useState("Initializing Navigation...");
  const [currentInstruction, setCurrentInstruction] = useState("Awaiting route...");
  const [aiStatus, setAiStatus] = useState("Loading AI...");
  const [isPocketMode, setIsPocketMode] = useState(false);

  // Refs for tracking and performance
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const watchIdRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const voskModelRef = useRef<any>(null);
  
  // Ref for Pocket Mode so the voice listener always has the freshest state
  const isPocketModeRef = useRef(false);
  useEffect(() => { isPocketModeRef.current = isPocketMode; }, [isPocketMode]);

  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // --- VOICE SPEECH SYNTHESIS ---
  const speak = (text: string, priority: boolean = false) => {
    if (priority) window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
  };

  // ==========================================
  // ENGINE 1: VOICE COMMANDS (VOSK)
  // ==========================================
  const handleCommand = (text: string) => {
    const cmd = text.toLowerCase().trim();
    if (!cmd) return;

    // If locked, ONLY listen for the unlock command
    if (isPocketModeRef.current) {
        if (cmd.includes("unlock") || cmd.includes("disable pocket mode")) {
            setIsPocketMode(false);
            speak("Screen unlocked. Touch controls restored.");
        }
        return; 
    }

    if (cmd.includes("pocket mode") || cmd.includes("lock screen")) {
        setIsPocketMode(true);
        speak("Pocket mode activated. Touch controls disabled. Say 'Unlock' to restore.");
        return;
    }

    if (cmd.includes("back") || cmd.includes("exit") || cmd.includes("stop navigation")) {
        speak("Ending navigation. Returning to previous menu.");
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = ctx.createMediaStreamSource(stream);
        const recognizer = new model.KaldiRecognizer(16000);
        
        recognizer.on("result", (msg: any) => {
            if (msg.result && msg.result.text) handleCommand(msg.result.text);
        });
        
        const node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => recognizer.acceptWaveform(e.inputBuffer);
        source.connect(node);
        node.connect(ctx.destination);
      } catch (err) {
        console.error("Vosk error:", err);
      }
    };
    initVosk();

    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  // ==========================================
  // ENGINE 2: AI OBJECT DETECTION (CAMERA)
  // ==========================================
  useEffect(() => {
    let animationId: number;
    const startVisionEngine = async () => {
      try {
        await tf.ready();
        const model = await cocossd.load();
        setAiStatus("AI Active");

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
          });
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play();
              detectFrame(videoRef.current!, model);
            };
          }
        }
      } catch (err) {
        setAiStatus("Camera Error");
      }
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

        // Warning Logic: If object is huge (close to user)
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

  // ==========================================
  // ENGINE 3: GPS NAVIGATION (TOMTOM)
  // ==========================================
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; 
    const rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  useEffect(() => {
    if (!targetLat || !targetLng) {
      speak("No destination provided.");
      return;
    }

    const TOMTOM_KEY = "vdDUOcV80JnWR7hlCRGmKKbzFMQjycmr"; // ⚠️ PASTE YOUR TOMTOM KEY HERE

    const fetchRoute = () => {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const startLat = pos.coords.latitude;
        const startLng = pos.coords.longitude;
        
        try {
          const url = `https://api.tomtom.com/routing/1/calculateRoute/${startLat},${startLng}:${targetLat},${targetLng}/json?instructionsType=text&travelMode=pedestrian&key=${TOMTOM_KEY}`;
          const response = await fetch(url);
          const data = await response.json();
          
          if (data.routes && data.routes.length > 0) {
            const steps = data.routes[0].guidance.instructions;
            setRouteSteps(steps);
            setNavStatus("Navigating");
            setCurrentInstruction(steps[0].message);
            speak(`Navigation started. ${steps[0].message}`);
          }
        } catch (error) {
          console.error("TomTom Routing error:", error);
          setNavStatus("Routing failed.");
        }
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
        
        const nextTurn = routeSteps[currentStepIndex];
        
        const turnLat = nextTurn.point.latitude;
        const turnLng = nextTurn.point.longitude;
        
        const distanceToTurn = calculateDistance(userLat, userLng, turnLat, turnLng);

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

    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [routeSteps, currentStepIndex]);

  return (
    <div className="nav-container">
      {/* POCKET MODE OVERLAY - Blocks all touches beneath it */}
      {isPocketMode && (
        <div className="pocket-mode-overlay">
          <div className="lock-icon">🔒</div>
          <h1>Pocket Mode Active</h1>
          <p>Touch controls disabled to prevent accidental clicks.</p>
          <p style={{ marginTop: '20px', color: '#fff' }}>Say <strong>"Unlock"</strong> to restore screen.</p>
        </div>
      )}

      {/* 1. Camera Feed */}
      <video ref={videoRef} className="video-layer" playsInline muted />
      
      {/* 2. AI Canvas Overlay */}
      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight} className="canvas-layer" />

      {/* 3. Glassmorphism UI Panel */}
      <div className="ui-panel">
        <div className="status-row">
            <span className="status-ai">🤖 {aiStatus}</span>
            <span className="status-mic">🎙️ Listening...</span>
            <span className="status-gps">📍 {navStatus}</span>
        </div>
        
        <h2 className="instruction-text">{currentInstruction}</h2>

        <button 
            className="nav-exit-btn"
            onClick={() => { speak("Ending navigation."); navigate(-1); }}
        >
            Exit Navigation
        </button>
      </div>
    </div>
  );
};

export default Navigation;