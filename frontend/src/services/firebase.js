import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { collection, getFirestore, onSnapshot, orderBy, query } from 'firebase/firestore';
import api from '../api/client';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId && config.appId);
let db = null;
let auth = null;
if (firebaseEnabled) {
  const app = getApps().length ? getApps()[0] : initializeApp(config);
  db = getFirestore(app);
  auth = getAuth(app);
}

export async function ensureFirebaseAuth() {
  if (!auth) return false;
  if (auth.currentUser) return true;
  try {
    const { data } = await api.post('/firebase/token/');
    if (!data?.token) return false;
    await signInWithCustomToken(auth, data.token);
    return true;
  } catch {
    return false;
  }
}

export function subscribeConversation(conversationId, callback, onError) {
  if (!db || !conversationId) return () => {};
  const ref = collection(db, 'ohio_conversations', String(conversationId), 'messages');
  const q = query(ref, orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map((doc) => doc.data())), onError);
}

export function subscribeNotifications(userId, callback, onError) {
  if (!db || !userId) return () => {};
  const ref = collection(db, 'ohio_notifications', `django-${userId}`, 'items');
  const q = query(ref, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map((doc) => doc.data())), onError);
}

export function subscribeSystemEvents(channel, callback, onError) {
  if (!db || !channel) return () => {};
  const ref = collection(db, 'ohio_events', String(channel), 'items');
  const q = query(ref, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map((doc) => doc.data())), onError);
}
