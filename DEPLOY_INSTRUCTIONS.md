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
