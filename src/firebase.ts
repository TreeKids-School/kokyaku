import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// test-octopus-5b254 プロジェクトの設定 (Octopusと同じプロジェクトを共用)
const firebaseConfig = {
  projectId: "test-octopus-5b254",
  appId: "1:433348736212:web:4a25a3e54a070d0e2b7741",
  storageBucket: "test-octopus-5b254.firebasestorage.app",
  apiKey: "AIzaSyDc1jISa-wDqV7Rg-84MRbbswHC-EkUuqI",
  authDomain: "test-octopus-5b254.firebaseapp.com",
  messagingSenderId: "433348736212"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

