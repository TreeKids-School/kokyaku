import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  projectId: "test-octopus-5b254",
  appId: "1:433348736212:web:4a25a3e54a070d0e2b7741",
  storageBucket: "test-octopus-5b254.firebasestorage.app",
  apiKey: "AIzaSyDc1jISa-wDqV7Rg-84MRbbswHC-EkUuqI",
  authDomain: "test-octopus-5b254.firebaseapp.com",
  messagingSenderId: "433348736212"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function check() {
  try {
    await signInAnonymously(auth);
    console.log("Authenticated anonymously.");
    const querySnapshot = await getDocs(collection(db, "children"));
    console.log(`Documents in 'children': ${querySnapshot.size}`);
    querySnapshot.forEach((doc) => {
      console.log(`- ${doc.id}: ${doc.data().name}`);
    });
    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

check();
