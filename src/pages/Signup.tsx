import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Auth.css'; // <--- UPDATED IMPORT

const Signup: React.FC = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Signing up:", name);
    alert("Account Created! Please Login.");
    navigate('/login');
  };

  return (
    <div className="auth-container">
      <div className="blob blob-2" style={{top: '10%', left: '10%'}}></div>
      <div className="blob blob-1" style={{bottom: '10%', right: '10%'}}></div>

      <div className="back-nav" onClick={() => navigate('/')}>
        ← Back to Vision Walk
      </div>

      <div className="glass-card">
        <div className="auth-header">
          <h1 className="auth-title">Create Account</h1>
          <p className="auth-subtitle">Join the Vision Walk experience</p>
        </div>

        <form onSubmit={handleSignup}>
          <div className="form-group">
            <input 
              type="text" 
              className="glass-input" 
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <input 
              type="email" 
              className="glass-input" 
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <input 
              type="password" 
              className="glass-input" 
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="auth-btn">
            Create Account
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? 
          <span className="link-highlight" onClick={() => navigate('/login')}>
            Log In
          </span>
        </div>
      </div>
    </div>
  );
};

export default Signup;