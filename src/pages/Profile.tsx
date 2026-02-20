import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db, doc, getDoc, updateDoc } from '../firebase'; 

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const fetch = async () => {
      const user = auth.currentUser;
      if (user) {
        const d = await getDoc(doc(db, "users", user.uid));
        if (d.exists() && d.data().guardianEmail) setEmail(d.data().guardianEmail);
      }
    };
    fetch();
  }, []);

  const save = async () => {
    if (!auth.currentUser) return;
    await updateDoc(doc(db, "users", auth.currentUser.uid), { guardianEmail: email });
    setMsg("Saved! Redirecting...");
    setTimeout(() => navigate('/home'), 1500);
  };

  return (
    <div style={{ height: '100vh', background: '#0f172a', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h2>Safety Settings</h2>
      <input 
        value={email} 
        onChange={e => setEmail(e.target.value)} 
        placeholder="Guardian Email" 
        style={{ padding: '10px', width: '300px', margin: '20px', borderRadius: '5px' }}
      />
      <button onClick={save} style={{ padding: '10px 20px', background: '#06b6d4', color: 'white', border: 'none', borderRadius: '5px' }}>Save</button>
      <p>{msg}</p>
    </div>
  );
};

export default Profile;