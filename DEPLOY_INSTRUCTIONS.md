# QuickWhatsApp Deployment Guide

This package is a self-contained, lightweight, single-user multi-account WhatsApp Web CRM and Helpdesk hub.

---

## Quick Start (Run Locally or on a Server)

### 1. Extract the ZIP
Unzip the archive to any directory on your computer or server.

### 2. Install Dependencies
In the root directory, run:
```bash
npm install
```

### 3. Check `.env` Configuration
The included `.env` file is pre-configured with recommended defaults:
```env
PORT=5000
NODE_ENV=production
CORS_ORIGIN=*
WA_SESSION_PATH=./server/wa_sessions
```

### 4. Build & Start
```bash
npm run build
npm start
```
Open **`http://localhost:5000`** in your browser.
The backend serves both the full React dashboard UI and the WhatsApp connector on the same port!

---

## Output Directories for Hosting Platforms

Different platforms expect different output directories. The build script automatically mirrors the compiled files into all three common directories:
- **`build/`** (used by Hostinger, AWS Amplify, default React presets)
- **`dist/`** (used by standard static site hosts)
- **`client/dist/`** (used by Cloudflare Workers & Pages)

So whichever output directory your platform is configured for, it will succeed!

---

## Deploying on Cloudflare (Workers & Edge Gateway)

Because WhatsApp Web (Baileys) requires a continuous WebSocket TCP connection to WhatsApp's servers, the application uses a **hybrid edge architecture**:
1. **Frontend & Edge Gateway**: Hosted globally on Cloudflare Workers / Pages (ultra-fast CDN, DDoS shield, free custom domain SSL).
2. **Backend Engine**: Runs on a persistent Node.js host (Hostinger, Render, Railway, VPS, or even your PC via Cloudflare Tunnel).

### Step 1: Login to Cloudflare
In your terminal, authenticate Wrangler with your Cloudflare account:
```bash
npx wrangler login
```
A browser tab will open asking you to click **"Authorize"**.

### Step 2: Build the Frontend
Compile the production assets:
```bash
npm run build
```

### Step 3: Configure Your Backend URL
Tell Cloudflare where your persistent WhatsApp backend is running:
```bash
npx wrangler secret put BACKEND_URL
```
When prompted, paste your backend URL (e.g. `https://your-backend.onrender.com` or your Hostinger/VPS API URL).

### Step 4: Deploy to Cloudflare
Deploy your Worker and static assets to Cloudflare:
```bash
npm run deploy
```
Wrangler will publish your app and give you a live Cloudflare URL (e.g. `https://qiuckwhatsapp.<your-subdomain>.workers.dev`).

### (Optional) Hosting Backend via Cloudflare Tunnel
If you want to host your backend on your own server or PC without public IP or port forwarding:
1. Install `cloudflared` from Cloudflare Zero Trust.
2. Run:
   ```bash
   cloudflared tunnel --url http://localhost:5000
   ```
3. Use the provided tunnel URL as your `BACKEND_URL`!
