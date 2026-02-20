import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const Login: React.FC = () => {
  const navigate = useNavigate();
  
  // Toggle between Login and Signup modes
  const [isSignup, setIsSignup] = useState(false);
  
  // Form States
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  // UI States
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Auto-redirect if already logged in
  useEffect(() => {
    const user = localStorage.getItem("user");
    if (user) navigate('/home');
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    const endpoint = isSignup ? '/api/signup' : '/api/login';
    const payload = isSignup ? { name, email, password } : { email, password };

    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || "https://visionwalk-backend.onrender.com";
      
      const res = await axios.post(`${API_BASE_URL}${endpoint}`, payload);
      
      if (isSignup) {
        alert("Account created successfully! Please login.");
        setIsSignup(false);
        setPassword("");
      } else {
        localStorage.setItem("user", JSON.stringify(res.data));
        navigate('/home');
      }
    } catch (err: any) {
      console.error("Auth Error:", err);
      setError(err.response?.data || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* --- THE NEW BACK ARROW --- */}
        <button 
          onClick={() => navigate('/')} 
          style={styles.backButton}
          title="Go Back"
        >
          ←
        </button>

        <h1 style={styles.title}>VISION WALK</h1>
        <p style={styles.subtitle}>{isSignup ? "Create your account" : "Welcome back"}</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          {isSignup && (
            <input
              type="text"
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
              required
            />
          )}
          
          <input
            type="email"
            placeholder="Email Address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            required
          />

          <button type="submit" disabled={isLoading} style={styles.button}>
            {isLoading ? "Processing..." : (isSignup ? "SIGN UP" : "LOGIN")}
          </button>
        </form>

        {error && <p style={styles.error}>{error}</p>}

        <p style={styles.toggleText}>
          {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
          <span 
            onClick={() => { setIsSignup(!isSignup); setError(""); }} 
            style={styles.toggleLink}
          >
            {isSignup ? "Login here" : "Sign up here"}
          </span>
        </p>
      </div>
    </div>
  );
};

// --- STYLING ---
const styles = {
  container: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', fontFamily: 'Arial, sans-serif' },
  // Notice the 'position: relative' added here so the back button stays inside the card
  card: { position: 'relative' as const, background: '#1e293b', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)', width: '100%', maxWidth: '400px', textAlign: 'center' as const },
  // The new back button styles
  backButton: { position: 'absolute' as const, top: '20px', left: '20px', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer', transition: 'color 0.3s' },
  title: { color: '#06b6d4', fontSize: '2rem', fontWeight: 'bold', marginBottom: '8px', letterSpacing: '2px', marginTop: '10px' },
  subtitle: { color: '#94a3b8', marginBottom: '30px' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: '15px' },
  input: { padding: '12px 16px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', fontSize: '1rem', outline: 'none' },
  button: { padding: '12px', borderRadius: '8px', border: 'none', background: '#06b6d4', color: 'white', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px', transition: '0.3s' },
  error: { color: '#fca5a5', marginTop: '15px', fontSize: '0.9rem' },
  toggleText: { marginTop: '25px', color: '#94a3b8', fontSize: '0.9rem' },
  toggleLink: { color: '#06b6d4', cursor: 'pointer', fontWeight: 'bold', textDecoration: 'underline' }
};

export default Login;