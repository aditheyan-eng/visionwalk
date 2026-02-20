import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc,     // <--- Added this import
  updateDoc,  // <--- Added this import
  addDoc, 
  collection 
} from "firebase/firestore";

// REPLACE WITH YOUR ACTUAL KEYS
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyChOTWlhRWqetdpFDqHwTV6veltPBA3jO0",
  authDomain: "vision-walk-app.firebaseapp.com",
  projectId: "vision-walk-app",
  storageBucket: "vision-walk-app.firebasestorage.app",
  messagingSenderId: "33877924698",
  appId: "1:33877924698:web:1e93e006b5e2f7ff6df163",
  measurementId: "G-0W7EHQZVH0"
};

// ... (your existing code) ...

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Add these scopes to use the basic login instead of the advanced one
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
// --- ADD THIS LINE ---
provider.setCustomParameters({ prompt: 'select_account' });

export { 
  auth, 
  provider, 
  db, 
  signInWithPopup, 
  signOut, 
  doc, 
  setDoc, 
  getDoc,
  updateDoc,
  addDoc, 
  collection 
};