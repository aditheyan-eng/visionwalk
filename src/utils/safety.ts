import emailjs from '@emailjs/browser';
import type { User } from 'firebase/auth'; // Fixes the "type-only" error

export const sendSafetyAlert = (
  user: User | null, 
  lat: number, 
  lng: number, 
  guardianEmail: string
): void => {

  if (!user || !guardianEmail) return;

  const templateParams = {
    user_name: user.displayName || "VisionWalk User",
    to_email: guardianEmail,
    google_maps_link: `https://www.google.com/maps?q=${lat},${lng}`,
    lat: lat,
    lng: lng,
    message: "EMERGENCY: User has triggered a safety alert.",
    timestamp: new Date().toLocaleString()
  };

  // REPLACE WITH YOUR EMAILJS KEYS
  emailjs.send('YOUR_SERVICE_ID', 'YOUR_TEMPLATE_ID', templateParams, 'YOUR_PUBLIC_KEY')
    .then(() => console.log('✅ Alert Sent'))
    .catch((err) => console.error('❌ Failed to send alert:', err));
};