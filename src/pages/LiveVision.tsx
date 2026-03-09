import React, { useRef, useState, useEffect, useCallback } from "react";
import Webcam from "react-webcam";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as vosk from "vosk-browser";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./LiveVision.css";

const LiveVision: React.FC = () => {
  const navigate = useNavigate();
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Refs
  const voskModelRef = useRef<vosk.Model | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const requestRef = useRef<number | null>(null); 
  
  // FIXED: Changed NodeJS.Timeout to number for the browser environment
  const envScanIntervalRef = useRef<number | null>(null);
  
  const lastDetectionTime = useRef<number>(0);
  const lastSpokenTimeRef = useRef<number>(0);     
  const lastSpokenMsgRef = useRef<string>(""); 
  const wakeLockRef = useRef<any>(null);
  const isPocketModeRef = useRef<boolean>(false);
  const priorityObjectsRef = useRef<string[]>([]);

  // State
  const [isStarted, setIsStarted] = useState(false);
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [isPocketMode, setIsPocketMode] = useState(false);
  const [targetObject, setTargetObject] = useState<string>("all"); 
  const [dynamicDropdownObjects, setDynamicDropdownObjects] = useState<string[]>([]);
  const [guidanceText, setGuidanceText] = useState("Tap to Start");
  const [distanceText, setDistanceText] = useState(""); 
  const [voiceTranscript, setVoiceTranscript] = useState("Listening..."); 
  const [isDanger, setIsDanger] = useState(false);
  
  const baseObjects = ["person", "cup", "bottle", "chair", "cell phone", "keys", "laptop", "door", "backpack"];

  useEffect(() => { isPocketModeRef.current = isPocketMode; }, [isPocketMode]);

  useEffect(() => {
    const fetchAdminPriorities = async () => {
      try {
        const res = await axios.get('https://visionwalk-backend.onrender.com/api/objects/1');
        if (res.data && Array.isArray(res.data)) {
            const adminObjects = res.data.map((obj: any) => obj.objectName.toLowerCase());
            priorityObjectsRef.current = adminObjects;
            setDynamicDropdownObjects(Array.from(new Set([...baseObjects, ...adminObjects])));
        }
      } catch (err) { setDynamicDropdownObjects(baseObjects); }
    };

    const loadModels = async () => {
      await tf.ready();
      const loadedModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
      setModel(loadedModel);
    };
    
    fetchAdminPriorities();
    loadModels();

    return () => {
      stopVoiceListener();
      releaseWakeLock();
      window.speechSynthesis.cancel();
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
      // FIXED: Used window.clearInterval
      if (envScanIntervalRef.current !== null) window.clearInterval(envScanIntervalRef.current);
    };
  }, []); 

  const startSystem = async () => {
    setIsStarted(true);
    setGuidanceText("Starting Sensors...");
    try {
      const nav = navigator as any;
      if (nav.wakeLock) wakeLockRef.current = await nav.wakeLock.request('screen');
    } catch (err) {}
    
    await initVoiceControl();
    startEnvironmentScanner(); 
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) await wakeLockRef.current.release();
  };

  const initVoiceControl = async () => {
    try {
      const loadedVoiceModel = await vosk.createModel('/models/vosk/model.tar.gz');
      voskModelRef.current = loadedVoiceModel;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const source = audioContext.createMediaStreamSource(stream);
      
      const grammar = '["stop", "go home", "exit", "back", "saved location", "pocket mode", "disable pocket mode", "unlock", "find", "detect", "all", "normal", "scan environment", "cup", "bottle", "keys", "phone", "chair", "person", "door", "laptop", "backpack"]';
      const recognizer = new loadedVoiceModel.KaldiRecognizer(16000, grammar);

      recognizer.on("result", (msg: any) => {
        if (msg.result && msg.result.text) {
          setVoiceTranscript(`Heard: "${msg.result.text}"`);
          handleVoiceCommand(msg.result.text);
        }
      });

      const node = audioContext.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => recognizer.acceptWaveform(e.inputBuffer);
      source.connect(node);
      node.connect(audioContext.destination);
      speakImmediate("Vision System Ready.");
    } catch (e) { speakImmediate("Voice failed."); }
  };

  const stopVoiceListener = () => {
    if (audioContextRef.current) audioContextRef.current.close();
  };

  const handleVoiceCommand = (cmd: string) => {
    if (isPocketModeRef.current && (cmd.includes("disable") || cmd.includes("unlock"))) {
      setIsPocketMode(false); speakImmediate("Screen active."); return; 
    }
    if (isPocketModeRef.current) return;

    if (cmd.includes("pocket mode")) { setIsPocketMode(true); speakImmediate("Screen locked."); return; }
    if (cmd.includes("saved location")) { navigate('/location'); return; }
    if (cmd.includes("exit") || cmd.includes("home") || cmd.includes("back")) { navigate('/home'); return; }

    const found = dynamicDropdownObjects.find(obj => cmd.includes(obj));
    if (found) {
        setTargetObject(found); speakImmediate(`Searching for ${found}.`);
    } else if (cmd.includes("all") || cmd.includes("normal") || cmd.includes("scan environment")) {
        setTargetObject("all"); speakImmediate("Scanning environment for all objects.");
    }
  };

  // 🚨 THE CLOUD NARRATOR 🚨
  const startEnvironmentScanner = () => {
    // FIXED: Used window.setInterval to strictly return a number
    envScanIntervalRef.current = window.setInterval(async () => {
        if (!webcamRef.current) return;
        
        const imageSrc = webcamRef.current.getScreenshot();
        if (!imageSrc) return;

        try {
            const API_URL = import.meta.env.VITE_API_URL || "https://visionwalk-backend.onrender.com";
            const res = await axios.post(`${API_URL}/api/vision/analyze`, { image: imageSrc });
            
            const labels: string[] = res.data.labels || []; 
            
            if (labels.length > 0) {
                const isStairs = labels.some(l => l.includes("stair") || l.includes("step"));
                const isWall = labels.some(l => l.includes("wall"));
                const isCrosswalk = labels.some(l => l.includes("crosswalk") || l.includes("street"));

                if (isStairs) {
                    updateStatus("ENVIRONMENT: STAIRS", "Proceed with caution", true);
                    smartSpeak("Stairs detected ahead. Please use cane.", 6000);
                } else if (isWall) {
                    updateStatus("ENVIRONMENT: WALL", "Path blocked", true);
                    smartSpeak("Wall directly ahead.", 6000);
                } else if (isCrosswalk) {
                    updateStatus("ENVIRONMENT: STREET", "Intersection ahead", true);
                    smartSpeak("Approaching a street or crosswalk.", 6000);
                } else {
                    const topObjects = labels.slice(0, 4).join(", ");
                    updateStatus("SCENE DETECTED", topObjects.toUpperCase(), false);
                    smartSpeak(`I see: ${topObjects}.`, 7500);
                }
            }
        } catch (err) {
            console.error("Cloud Vision scan failed:", err);
        }
    }, 4000); 
  };

  // FAST LOCAL DETECTION LOOP
  const detect = useCallback(async () => {
    const now = Date.now();
    if (now - lastDetectionTime.current < 250) {
        requestRef.current = requestAnimationFrame(() => detect()); return;
    }
    lastDetectionTime.current = now;

    if (model && webcamRef.current && webcamRef.current.video?.readyState === 4) {
      const video = webcamRef.current.video;
      if (canvasRef.current) {
        canvasRef.current.width = video.videoWidth;
        canvasRef.current.height = video.videoHeight;
      }
      const predictions = await model.detect(video);
      const ctx = canvasRef.current?.getContext("2d");
      
      if (ctx) {
        ctx.clearRect(0, 0, video.videoWidth, video.videoHeight);
        processAggressiveMode(predictions, ctx, video.videoWidth, video.videoHeight);
      }
    }
    requestRef.current = requestAnimationFrame(() => detect());
  }, [model, targetObject]); 

  useEffect(() => { if (isStarted && model) detect(); }, [isStarted, model, detect]);

  const processAggressiveMode = (predictions: any[], ctx: CanvasRenderingContext2D, width: number, height: number) => {
    let imminentObstacleName = "";
    predictions.forEach((prediction) => {
      const [x, y, w, h] = prediction.bbox;
      const text = prediction.class;
      const screenCoverage = h / height;
      
      ctx.strokeStyle = "rgba(0, 255, 0, 0.5)"; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      if (screenCoverage > 0.6) { 
         imminentObstacleName = text;
         ctx.strokeStyle = "#FFA500"; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);
      }
    });

    if (imminentObstacleName !== "") {
      smartSpeak(`Obstacle in path. ${imminentObstacleName}.`, 4000);
    }
  };

  const speakImmediate = (text: string) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; window.speechSynthesis.speak(u);
    lastSpokenMsgRef.current = text;
    lastSpokenTimeRef.current = Date.now();
  };

  const smartSpeak = (text: string, gapMillis: number) => {
    const now = Date.now();
    if (now - lastSpokenTimeRef.current < 2500) return; 
    if (text !== lastSpokenMsgRef.current || now - lastSpokenTimeRef.current > gapMillis) {
        speakImmediate(text);
    }
  };

  const updateStatus = (mainText: string, subText: string, danger: boolean) => {
    setGuidanceText(mainText); setDistanceText(subText); setIsDanger(danger);
  };

  return (
    <div className="vision-container">
      {!isStarted && (
        <div className="start-overlay" onClick={startSystem}>
          <div className="start-content"><h1>VISION AI</h1><p>Tap to Activate</p></div>
        </div>
      )}
      {isPocketMode && (
        <div className="pocket-mode-overlay"><h2>POCKET MODE ACTIVE</h2><p>Say "Unlock"</p></div>
      )}
      {!isPocketMode && (
        <div className="hud-interface">
          <div className="top-bar">
            <button className="exit-btn" onClick={() => navigate('/home')}>EXIT</button>
          </div>
          <div className="voice-transcript">{voiceTranscript}</div>
          <div className={`alert-box ${isDanger ? 'alert-danger' : 'alert-safe'}`}>
             <h2>{guidanceText}</h2><h3>{distanceText}</h3>
          </div>
        </div>
      )}
      <Webcam
        ref={webcamRef} className="camera-feed" muted={true}
        screenshotFormat="image/jpeg" 
        videoConstraints={{ facingMode: { ideal: "environment" } }} 
      />
      <canvas ref={canvasRef} className="overlay-canvas" />
    </div>
  );
};

export default LiveVision;