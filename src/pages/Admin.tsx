import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Admin.css';

interface User {
  id: number;
  name: string;
  email: string;
}

const Admin: React.FC = () => {
  const navigate = useNavigate();
  
  // Auth States
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [authError, setAuthError] = useState("");

  // Data States
  const [users, setUsers] = useState<User[]>([]);
  const [objectName, setObjectName] = useState("");
  const [objectDesc, setObjectDesc] = useState("");

  // --- 1. HARDCODED ADMIN AUTHENTICATION ---
  const handleLogin = () => {
    // ⚠️ Define your secret admin credentials here!
    if (adminEmail === "admin@visionwalk.com" && adminPass === "admin123") {
        setIsAuthenticated(true);
        fetchUsers();
    } else {
        setAuthError("Invalid Admin Credentials");
    }
  };

  // --- 2. FETCH & DELETE USERS ---
  const fetchUsers = async () => {
    try {
        const res = await axios.get('https://visionwalk-backend.onrender.com/api/admin/users');
        setUsers(res.data);
    } catch (err) {
        console.error("Failed to fetch users");
    }
  };

  const deleteUser = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete ${name}?`)) return;
    try {
        await axios.delete(`https://visionwalk-backend.onrender.com/api/admin/users/${id}`);
        setUsers(users.filter(u => u.id !== id)); // Remove from screen
        alert("User deleted.");
    } catch (err) {
        alert("Failed to delete user.");
    }
  };

  // --- 3. ADD PRIORITY OBJECT ---
  const handleAddObject = async () => {
    if (!objectName) {
        alert("Object name is required.");
        return;
    }
    
    try {
        // We reuse your existing /api/objects route! 
        // Assuming Admin operates under a master ID, or we just pass ID 1 for now.
        await axios.post('https://visionwalk-backend.onrender.com/api/objects', {
            userId: "1", 
            objectName: objectName,
            description: objectDesc
        });
        alert(`Successfully added ${objectName} to priority alert database.`);
        setObjectName("");
        setObjectDesc("");
    } catch (err) {
        alert("Failed to add object to database.");
    }
  };

  // --- RENDER LOGIN SCREEN ---
  if (!isAuthenticated) {
      return (
          <div className="admin-wrapper">
              <div className="admin-login-box">
                  <h2>⚠️ Admin Portal</h2>
                  {authError && <p style={{color: '#ef4444', textAlign: 'center', margin: 0}}>{authError}</p>}
                  <input 
                      type="email" 
                      placeholder="Admin Email" 
                      className="admin-input"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                  />
                  <input 
                      type="password" 
                      placeholder="Master Password" 
                      className="admin-input"
                      value={adminPass}
                      onChange={(e) => setAdminPass(e.target.value)}
                  />
                  <button className="admin-btn" onClick={handleLogin}>ENTER SYSTEM</button>
                  <button className="admin-btn" style={{background: 'transparent', color: '#94a3b8', border: '1px solid #334155'}} onClick={() => navigate('/login')}>Return to App</button>
              </div>
          </div>
      );
  }

  // --- RENDER DASHBOARD SCREEN ---
  return (
    <div className="admin-wrapper" style={{alignItems: 'flex-start'}}>
      <div className="admin-dashboard">
        
        <header className="admin-header">
            <h1>VisionWalk Command Center</h1>
            <button className="admin-btn" style={{background: '#ef4444', color: 'white'}} onClick={() => setIsAuthenticated(false)}>Lock System</button>
        </header>

        <div className="admin-content">
            
            {/* PANEL 1: USER MANAGEMENT */}
            <div className="admin-panel">
                <h3>Registered Users</h3>
                <div className="user-list">
                    {users.length === 0 ? <p>No users found.</p> : null}
                    {users.map(user => (
                        <div key={user.id} className="user-item">
                            <div className="user-details">
                                <strong>{user.name}</strong>
                                <span>{user.email}</span>
                            </div>
                            <button className="delete-user-btn" onClick={() => deleteUser(user.id, user.name)}>Delete</button>
                        </div>
                    ))}
                </div>
            </div>

            {/* PANEL 2: AI PRIORITY OBJECTS */}
            <div className="admin-panel">
                <h3>Add Priority Alert Object</h3>
                <p style={{fontSize: '14px', color: '#94a3b8', marginBottom: '15px'}}>
                    Add objects to the database (e.g., "car", "person"). In future updates, the Vision AI will prioritize audio warnings for these objects.
                </p>
                <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                    <input 
                        type="text" 
                        placeholder="Object Name (e.g., person)" 
                        className="admin-input"
                        value={objectName}
                        onChange={(e) => setObjectName(e.target.value.toLowerCase())}
                    />
                    <textarea 
                        placeholder="Why is this a priority? (Optional)" 
                        className="admin-input"
                        style={{height: '80px', resize: 'none'}}
                        value={objectDesc}
                        onChange={(e) => setObjectDesc(e.target.value)}
                    />
                    <button className="admin-btn" style={{background: '#38bdf8'}} onClick={handleAddObject}>
                        Add to Database
                    </button>
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default Admin;