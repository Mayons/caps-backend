// src/config/firebaseAdmin.js
import admin from "firebase-admin";
import fs from "fs";

function loadCredsFromEnv() {
  // 1) Archivo apuntado por GOOGLE_APPLICATION_CREDENTIALS
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path && fs.existsSync(path)) {
    const json = JSON.parse(fs.readFileSync(path, "utf8"));
    return json;
  }

  // 2) Todo el JSON en una env (string) o en base64
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonRaw) return JSON.parse(jsonRaw);

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

  // 3) Campos sueltos en env
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey && privateKey.includes("\\n")) {
    // reemplaza \n literales por saltos de línea reales
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey,
    };
  }

  return null;
}

let initialized = false;
if (!admin.apps.length) {
  const creds = loadCredsFromEnv();
  if (!creds) {
    throw new Error("Firebase Admin: no se encontraron credenciales válidas.");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: creds.project_id || creds.projectId,
      clientEmail: creds.client_email || creds.clientEmail,
      privateKey: creds.private_key || creds.privateKey,
    }),
  });

  initialized = true;
}

export default admin;
export { initialized };
