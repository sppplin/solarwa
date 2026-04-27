# Deployment Guide for Solar Automation AI

This application is a full-stack Node.js app using Express, Socket.io, and Baileys for WhatsApp automation.

## ⚠️ Recommended Hosting (Avoid Vercel)
Vercel is a serverless platform. This app requires a **persistent connection** to keep the WhatsApp socket alive. Vercel will time out the connection, and your QR code/session will frequently break.

**Best alternatives for free/low-cost persistent hosting:**
1. **Railway.app** (Highly Recommended)
2. **Render.com** (Web Service - not static site)
3. **GitHub Codespaces** (Perfect for free development)
4. **VPS** (DigitalOcean, Linode, Hostinger VPS)

## 🚀 GitHub Codespaces (Free & Easy)
1. Open your repository in **GitHub Codespaces**.
2. Wait for it to build, or run `npm install` and `npm run dev`.
3. In the **Ports** tab, make port **3000** "Public".
4. Open the URL to access your dashboard and scan the QR.

## 📦 How to host on Railway / Render
1. Connect your GitHub repository.
2. Root directory: `./`
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Port: `3000`
6. Add Environment Variables:
   - `GEMINI_API_KEY`: Your Google AI key.
   - `NODE_ENV`: `production`

## 🐳 Docker Deployment
If you use a VPS, use Docker to ensure a clean state:

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 🛠 Shared Hosting (Hostinger Node.js)
If you use Hostinger's Node.js selector:
1. Upload all files.
2. Set the Application Entry Point to `server.ts` (if they support `tsx`) or build it first and set it to `dist/server.js` (requires building).
3. Ensure the folder `auth_info_baileys` has **read/write permissions**.

## 🔑 Environment Variables (Optional)
- `GEMINI_API_KEY`: Only if you want external AI. If not found, the bot uses its internal high-speed local knowledge base.
- `NODE_ENV`: Set to `production` for persistent hosting.
