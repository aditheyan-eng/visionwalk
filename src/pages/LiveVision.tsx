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
    startEnvironmentScanner(); // Starts the Cloud API loop for Walls/Stairs!
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

  // 🚨 THE CLOUD NARRATOR (For Stairs, Walls, and Everything Else)
  const startEnvironmentScanner = () => {
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

  // 🚨 FAST LOCAL DETECTION LOOP (For Exact Distance & Immediate Physical Threats)
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
        drawHUD(ctx, video.videoWidth, video.videoHeight);
        
        if (targetObject === "all") {
            processAggressiveMode(predictions, ctx, video.videoWidth, video.videoHeight);
        } else {
            processTargetMode(predictions, ctx, video.videoWidth, video.videoHeight);
        }
      }
    }
    requestRef.current = requestAnimationFrame(() => detect());
  }, [model, targetObject]); 

  useEffect(() => { if (isStarted && model) detect(); }, [isStarted, model, detect]);

  const processAggressiveMode = (predictions: any[], ctx: CanvasRenderingContext2D, width: number, height: number) => {
    let priorityObjName = "";
    let priorityObjMeters = 0;
    
    let imminentObstacleName = "";
    let imminentObstacleMeters = 0;
    
    let maxDangerScore = 0;
    let maxGenericDangerScore = 0;

    // Define the "Path" (Middle 50% of the screen)
    const safeZoneMin = width * 0.25;
    const safeZoneMax = width * 0.75;
    const adminList = priorityObjectsRef.current;

    predictions.forEach((prediction) => {
      const [x, y, w, h] = prediction.bbox;
      const text = prediction.class.toLowerCase();
      const objCenterX = x + w / 2;
      const screenCoverage = h / height;
      
      // Calculate Exact Meters Based on Screen Coverage
      let exactMeters = 0;
      if (screenCoverage > 0.8) exactMeters = 0.5;
      else if (screenCoverage > 0.6) exactMeters = 1.0;
      else if (screenCoverage > 0.4) exactMeters = 2.0;
      else if (screenCoverage > 0.2) exactMeters = 3.5;
      else exactMeters = 5.0;

      const isPriority = adminList.includes(text) || (adminList.includes("phone") && text === "cell phone");
      const isInPath = objCenterX > safeZoneMin && objCenterX < safeZoneMax;

      if (isPriority) {
          ctx.strokeStyle = "#FF0000"; ctx.lineWidth = 4; ctx.fillStyle = "#FF0000";
          ctx.fillText(`⚠️ ${text.toUpperCase()}`, x, y > 10 ? y - 5 : 10);
          
          if (isInPath && screenCoverage > maxDangerScore) {
              maxDangerScore = screenCoverage;
              priorityObjName = text;
              priorityObjMeters = exactMeters;
          }
      } else {
          // If it's a normal object, but it's massive and right in front of us
          if (isInPath && screenCoverage > 0.5) { 
             ctx.strokeStyle = "#FFA500"; ctx.lineWidth = 4; ctx.fillStyle = "#FFA500";
             ctx.fillText(`🚧 OBSTACLE: ${text.toUpperCase()}`, x, y > 10 ? y - 5 : 10);
             
             if (screenCoverage > maxGenericDangerScore) {
                 maxGenericDangerScore = screenCoverage;
                 imminentObstacleName = text;
                 imminentObstacleMeters = exactMeters;
             }
          } else {
             // Safe background object
             ctx.strokeStyle = "rgba(0, 255, 0, 0.5)"; ctx.lineWidth = 2; ctx.fillStyle = "rgba(0, 255, 0, 0.5)";
             ctx.fillText(text, x, y > 10 ? y - 5 : 10);
          }
      }
      ctx.strokeRect(x, y, w, h);
    });

    // Voice Engine priority logic: Local Physical Threats beat Cloud Narration
    if (priorityObjName !== "") {
      const isUrgent = maxDangerScore > 0.6; 
      updateStatus(`ALERT: ${priorityObjName.toUpperCase()}`, `${priorityObjMeters} Meters`, true);

      if (isUrgent) {
          smartSpeak(`Admin Alert: ${priorityObjName} extremely close at ${priorityObjMeters} meters. Stop.`, 3000); 
      } else {
          smartSpeak(`Caution. ${priorityObjName} ahead at ${priorityObjMeters} meters.`, 5000); 
      }
    } else if (imminentObstacleName !== "") {
      updateStatus(`OBSTACLE: ${imminentObstacleName.toUpperCase()}`, `${imminentObstacleMeters} Meters`, true);
      smartSpeak(`Obstacle in path. ${imminentObstacleName} at ${imminentObstacleMeters} meters.`, 4000);
    } 
  };

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
         ctx.strokeStyle = "#00FFFF"; ctx.lineWidth = 6; ctx.strokeRect(x, y, w, h);

         const screenCoverage = h / height;
         if (screenCoverage > 0.8) exactMeters = 0.5;
         else if (screenCoverage > 0.6) exactMeters = 1.0;
         else if (screenCoverage > 0.4) exactMeters = 2.0;
         else exactMeters = 3.5;

         ctx.fillStyle = "#00FFFF"; ctx.font = "bold 18px Arial";
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

  const drawHUD = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.strokeStyle = "rgba(0, 255, 0, 0.2)"; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(width * 0.25, 0); ctx.lineTo(width * 0.25, height);
    ctx.moveTo(width * 0.75, 0); ctx.lineTo(width * 0.75, height);
    ctx.stroke();
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
            <select 
               className="filter-select"
               value={targetObject} 
               onChange={(e) => setTargetObject(e.target.value)}
            >
               <option value="all">Normal Mode</option>
               {dynamicDropdownObjects.map(obj => (
                  <option key={obj} value={obj}>Find {obj}</option>
               ))}
            </select>
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