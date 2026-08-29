import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// octopus-8c179 プロジェクトの設定 (kokyakux)
const firebaseConfig = {
  projectId: "octopus-8c179",
  appId: "1:1032034386882:web:7d90b3a14b9d11c7f84c5b",
  storageBucket: "octopus-8c179.firebasestorage.app",
  apiKey: "AIzaSyDb-9Ufh9iRbXZTMQIb5oPNVj1Tp9aIDNY",
  authDomain: "octopus-8c179.firebaseapp.com",
  messagingSenderId: "1032034386882"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

