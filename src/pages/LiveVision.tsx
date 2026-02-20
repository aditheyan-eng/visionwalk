import React, { useRef, useState, useEffect, useCallback } from "react";
import Webcam from "react-webcam";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as vosk from "vosk-browser";
import { useNavigate } from "react-router-dom";
import "./LiveVision.css";

const LiveVision: React.FC = () => {
  const navigate = useNavigate();
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // --- REFS ---
  const voskModelRef = useRef<vosk.Model | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const requestRef = useRef<number | null>(null); 
  
  // Logic Refs
  const lastDetectionTime = useRef<number>(0);
  const lastSpokenTimeRef = useRef<number>(0);     
  const lastSpokenMsgRef = useRef<string>(""); 
  const wakeLockRef = useRef<any>(null);
  const isPocketModeRef = useRef<boolean>(false);

  // --- STATE ---
  const [isStarted, setIsStarted] = useState(false);
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [isPocketMode, setIsPocketMode] = useState(false);
  
  // TARGET STATE: "all" = Normal Mode, "cup" = Target Mode
  const [targetObject, setTargetObject] = useState<string>("all"); 
  
  // UI State
  const [guidanceText, setGuidanceText] = useState("Tap to Start");
  const [distanceText, setDistanceText] = useState(""); 
  const [voiceTranscript, setVoiceTranscript] = useState("Listening..."); 
  const [isDanger, setIsDanger] = useState(false);
  
  const commonObjects = ["all", "person", "cup", "bottle", "chair", "cell phone", "keys", "laptop", "door", "backpack"];

  // Sync Pocket Mode ref for voice callback
  useEffect(() => {
    isPocketModeRef.current = isPocketMode;
  }, [isPocketMode]);

  // 1. Load Vision Model
  useEffect(() => {
    const loadModels = async () => {
      try {
        await tf.ready();
        const loadedModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        setModel(loadedModel);
        console.log("Vision Model Loaded");
      } catch (err) {
        console.error("Failed to load vision model", err);
      }
    };
    loadModels();

    return () => {
      stopVoiceListener();
      releaseWakeLock();
      window.speechSynthesis.cancel();
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, []); 

  // 2. Start System
  const startSystem = async () => {
    setIsStarted(true);
    setGuidanceText("Starting Sensors...");
    try {
      const nav = navigator as any;
      if (nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch (err) { console.warn("Wake Lock failed:", err); }
    await initVoiceControl();
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (e) { console.log("Wake Lock error", e); }
    }
  };

  // 3. Voice Control Setup
  const initVoiceControl = async () => {
    try {
      const modelUrl = '/models/vosk/model.tar.gz'; 
      const loadedVoiceModel = await vosk.createModel(modelUrl);
      voskModelRef.current = loadedVoiceModel;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      
      const source = audioContext.createMediaStreamSource(stream);
      // Added new grammar vocabulary
      const grammar = '["stop", "go home", "exit", "back", "saved location", "pocket mode", "disable pocket mode", "unlock", "find", "detect", "all", "normal", "cup", "bottle", "keys", "phone", "chair", "person", "door", "laptop", "backpack"]';
      const recognizer = new loadedVoiceModel.KaldiRecognizer(16000, grammar);

      recognizer.on("result", (msg: any) => {
        const text = msg.result.text;
        if (text && text.length > 0) {
          setVoiceTranscript(`Heard: "${text}"`);
          handleVoiceCommand(text);
        }
      });

      const node = audioContext.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => recognizer.acceptWaveform(e.inputBuffer);
      source.connect(node);
      node.connect(audioContext.destination);

      speakImmediate("Vision System Ready.");

    } catch (e) {
      console.error("Voice Error:", e);
      speakImmediate("Voice failed.");
    }
  };

  const stopVoiceListener = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const handleVoiceCommand = (cmd: string) => {
    // A. POCKET MODE OVERRIDES (Only listen for unlock if locked)
    if (isPocketModeRef.current) {
      if (cmd.includes("disable pocket mode") || cmd.includes("unlock")) {
        setIsPocketMode(false);
        speakImmediate("Pocket mode disabled. Screen active.");
      }
      return; // Ignore all other commands while in pocket mode
    }

    // B. NORMAL COMMANDS
    if (cmd.includes("pocket mode")) {
      setIsPocketMode(true);
      speakImmediate("Pocket mode activated. Touch screen disabled.");
      return;
    }

    if (cmd.includes("saved location")) {
      speakImmediate("Opening saved locations.");
      navigate('/locations');
      return;
    }

    if (cmd.includes("exit") || cmd.includes("go home") || cmd.includes("back")) {
      speakImmediate("Returning to home.");
      navigate('/home');
      return;
    }

    if (cmd.includes("find")) {
        const objects = ["cup", "bottle", "keys", "phone", "chair", "person", "door", "laptop", "backpack"];
        const found = objects.find(obj => cmd.includes(obj));
        if (found) {
            setTargetObject(found); 
            speakImmediate(`Searching for ${found}.`);
        }
    } else if (cmd.includes("detect all") || cmd.includes("normal") || cmd.includes("all")) {
        setTargetObject("all"); 
        speakImmediate("Normal scanning mode.");
    } else if (cmd.includes("stop")) {
      setGuidanceText("PAUSED");
      speakImmediate("Paused");
    } 
  };

  // 4. Detection Loop (Optimized 4 FPS)
  const detect = useCallback(async () => {
    const now = Date.now();
    if (now - lastDetectionTime.current < 250) {
        requestRef.current = requestAnimationFrame(() => detect());
        return;
    }
    lastDetectionTime.current = now;

    if (model && webcamRef.current && webcamRef.current.video?.readyState === 4) {
      const video = webcamRef.current.video;
      const { videoWidth, videoHeight } = video;

      if (canvasRef.current) {
        canvasRef.current.width = videoWidth;
        canvasRef.current.height = videoHeight;
      }

      const predictions = await model.detect(video);
      const ctx = canvasRef.current?.getContext("2d");
      
      if (ctx) {
        drawHUD(ctx, videoWidth, videoHeight);
        if (targetObject === "all") {
            processNormalMode(predictions, ctx, videoWidth, videoHeight);
        } else {
            processTargetMode(predictions, ctx, videoWidth, videoHeight);
        }
      }
    }
    requestRef.current = requestAnimationFrame(() => detect());
  }, [model, targetObject]); 

  useEffect(() => {
    if (isStarted && model) {
      detect();
    }
  }, [isStarted, model, detect]);

  // --- LOGIC A: NORMAL MODE ---
  const processNormalMode = (predictions: any[], ctx: CanvasRenderingContext2D, width: number, height: number) => {
    let closestObjName: string | null = null;
    let closestObjMeters = 0;
    let maxDangerScore = 0;

    const safeZoneMin = width * 0.25;
    const safeZoneMax = width * 0.75;

    predictions.forEach((prediction) => {
      const [x, y, w, h] = prediction.bbox;
      const text = prediction.class;
      const objCenterX = x + w / 2;

      ctx.strokeStyle = "#00FF00";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "#00FF00";
      ctx.fillText(text, x, y > 10 ? y - 5 : 10);

      const screenCoverage = h / height;
      let exactMeters = 0;
      if (screenCoverage > 0.8) exactMeters = 0.5;
      else if (screenCoverage > 0.6) exactMeters = 1.0;
      else if (screenCoverage > 0.4) exactMeters = 2.0;
      else if (screenCoverage > 0.2) exactMeters = 3.5;
      else exactMeters = 5.0;

      if (objCenterX > safeZoneMin && objCenterX < safeZoneMax) {
        if (screenCoverage > maxDangerScore) {
          maxDangerScore = screenCoverage;
          closestObjName = text;
          closestObjMeters = exactMeters;
        }
      }
    });

    if (closestObjName) {
      const isUrgent = maxDangerScore > 0.7; // Very Close
      updateStatus(
          isUrgent ? `STOP: ${closestObjName}` : `DETECTED: ${closestObjName}`, 
          `${closestObjMeters} Meters`, 
          isUrgent
      );

      // Enhanced Voice Logic with Distance & Gaps
      if (isUrgent) {
          smartSpeak(`Warning. ${closestObjName} very close at ${closestObjMeters} meters.`, 4000); 
      } else {
          smartSpeak(`${closestObjName} ahead at ${closestObjMeters} meters.`, 6000); 
      }
    } else {
       updateStatus("PATH CLEAR", "Walk safely", false);
    }
  };

  // --- LOGIC B: TARGET MODE ---
  const processTargetMode = (predictions: any[], ctx: CanvasRenderingContext2D, _width: number, height: number) => {
    let foundTarget = false;
    let exactMeters = 0;

    predictions.forEach((prediction) => {
      const [x, y, w, h] = prediction.bbox;
      const text = prediction.class;
      
      const isMatch = text.toLowerCase().includes(targetObject.toLowerCase()) || 
          (targetObject === "keys" && text === "remote") || 
          (targetObject === "phone" && text === "cell phone");

      if (isMatch) {
         foundTarget = true;
         ctx.strokeStyle = "#00FFFF"; 
         ctx.lineWidth = 6;
         ctx.strokeRect(x, y, w, h);

         const screenCoverage = h / height;
         if (screenCoverage > 0.8) exactMeters = 0.5;
         else if (screenCoverage > 0.6) exactMeters = 1.0;
         else if (screenCoverage > 0.4) exactMeters = 2.0;
         else exactMeters = 3.5;

         ctx.fillStyle = "#00FFFF";
         ctx.font = "bold 18px Arial";
         ctx.fillText(`TARGET: ${text}`, x, y > 20 ? y - 10 : 20);
      }
    });

    if (foundTarget) {
        updateStatus(`FOUND: ${targetObject}`, `${exactMeters} Meters`, true);
        smartSpeak(`Found ${targetObject} at ${exactMeters} meters.`, 5000); 
    } else {
        updateStatus(`SEARCHING: ${targetObject}`, "Scanning...", false);
    }
  };

  // --- SPEECH ENGINE ---
  const speakImmediate = (text: string) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95; 
    window.speechSynthesis.speak(u);
    lastSpokenMsgRef.current = text;
    lastSpokenTimeRef.current = Date.now();
  };

  // Intelligent Spam Prevention
  const smartSpeak = (text: string, gapMillis: number) => {
    const now = Date.now();
    const timeSinceLastSpeech = now - lastSpokenTimeRef.current;
    
    // Absolute throttle: Never speak if we just spoke less than 2.5 seconds ago
    if (timeSinceLastSpeech < 2500) return; 

    // If it's a completely new object/warning, OR enough gap time has passed, speak it.
    if (text !== lastSpokenMsgRef.current || timeSinceLastSpeech > gapMillis) {
        speakImmediate(text);
    }
  };

  const drawHUD = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(0, 255, 0, 0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width * 0.25, 0);
    ctx.lineTo(width * 0.25, height);
    ctx.moveTo(width * 0.75, 0);
    ctx.lineTo(width * 0.75, height);
    ctx.stroke();
  };

  const updateStatus = (mainText: string, subText: string, danger: boolean) => {
    setGuidanceText(prev => (prev !== mainText ? mainText : prev));
    setDistanceText(prev => (prev !== subText ? subText : prev));
    setIsDanger(prev => (prev !== danger ? danger : prev));
  };

  return (
    <div className="vision-container">
      {/* START SCREEN */}
      {!isStarted && (
        <div className="start-overlay" onClick={startSystem}>
          <div className="start-content">
            <h1>VISION AI</h1>
            <p>Tap to Activate</p>
          </div>
        </div>
      )}

      {/* POCKET MODE OVERLAY (Blocks touches but camera runs behind it) */}
      {isPocketMode && (
        <div className="pocket-mode-overlay">
           <h2>POCKET MODE ACTIVE</h2>
           <p>Screen touches are disabled.</p>
           <p className="pocket-hint">Say <span>"Disable Pocket Mode"</span> or <span>"Unlock"</span> to return.</p>
        </div>
      )}

      {/* HUD INTERFACE (Hidden if Pocket Mode is active) */}
      {!isPocketMode && (
        <div className="hud-interface">
          <div className="top-bar">
            <select 
               className="filter-select"
               value={targetObject} 
               onChange={(e) => setTargetObject(e.target.value)}
            >
               <option value="all">Normal Mode</option>
               {commonObjects.filter(o => o !== "all").map(obj => (
                  <option key={obj} value={obj}>Find {obj}</option>
               ))}
            </select>
            <button className="exit-btn" onClick={() => navigate('/home')}>EXIT</button>
          </div>
          
          <div className="voice-transcript">{voiceTranscript}</div>

          <div className={`alert-box ${isDanger ? 'alert-danger' : 'alert-safe'}`}>
             <h2>{guidanceText}</h2>
             <h3>{distanceText}</h3>
          </div>
        </div>
      )}

      <Webcam
        ref={webcamRef}
        className="camera-feed"
        muted={true}
        videoConstraints={{ facingMode: { ideal: "environment" } }} 
      />
      <canvas ref={canvasRef} className="overlay-canvas" />
    </div>
  );
};

export default LiveVision;