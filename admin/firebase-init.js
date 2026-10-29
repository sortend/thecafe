import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import * as fs from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as au from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
// Offline cache: repeat visits load instantly from the browser, then sync live
let _db;
try { _db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
catch { _db = fs.getFirestore(app); }
export const db = _db;
export const auth = au.getAuth(app);
export { fs, au };
