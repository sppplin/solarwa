import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import dns from 'dns';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveMx = promisify(dns.resolveMx);

const KNOWLEDGE_BASE = [
  // GREETINGS
  { triggers: ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'], response: "Hello! 👋 Welcome to Solar Print Process — India's trusted packaging manufacturer since 1975. How can I help you today? Are you looking for:\n\n📦 Rigid boxes\n🧴 Perfume boxes\n📋 Mono cartons\n🎁 Gift boxes\n\nShare your requirement and we'll get back with a quote in 2 hours!" },
  { triggers: ['i need packaging', 'i need boxes', 'packaging requirement'], response: "Great! 📦 You've reached the right place. We manufacture all types of custom packaging — rigid boxes, mono cartons, perfume boxes, gift boxes, and more. To give you an accurate quote, could you share:\n\n1. *What product* needs packaging?\n2. *Approximate quantity* needed?\n3. *Your city/location?*" },
  
  // MOQ
  { triggers: ['moq', 'minimum order', 'kitne box', 'minimum quantity'], response: "Our *minimum order quantity (MOQ) starts from 500 pieces* for most packaging types. Could you share what packaging you need and the quantity? We'll confirm the exact MOQ for your requirement. 📦" },
  { triggers: ['100 pieces', '200 pieces', 'batch', 'trial order'], response: "We appreciate your interest! 🙏 Unfortunately our minimum order starts from *500 pieces* as we are a bulk B2B manufacturer. If your requirement is likely to scale to 500+ pieces, we'd be happy to discuss. Would you like to explore if 500 pieces works for your brand?" },
  
  // PRICING
  { triggers: ['price', 'rate', 'cost', 'how much', 'quote', 'quotation'], response: "The price depends on several factors — box size, material, quantity, and finishing. Share your requirement (Size, Quantity, Style) and our team will send an *accurate quote within 2 hours*. This is completely free! 📋" },
  { triggers: ['discount', 'cheaper', 'expensive'], response: "We offer *factory-direct pricing* — no brokers or middlemen. This means you get 20-35% lower cost compared to resellers. Share what you need and we'll give you a competitive quote. 🏭" },
  
  // SAMPLES
  { triggers: ['sample', 'quality check', 'see the boxes'], response: "We provide custom samples! 📦 Sample charges apply but are *fully adjustable against your bulk order*. Samples are dispatched within *3 working days*. Would you like to request one?" },
  { triggers: ['visit', 'factory location', 'kahan hai', 'office'], response: "Absolutely! 🏭 We encourage factory visits. Our factory is at:\n\n📍 *C-10, Sector 85, Noida, UP 201305*\n⏰ Monday to Saturday, 9 AM to 6:30 PM\n\nPlease let us know your preferred date — we'll arrange a guided tour! 😊" },
  
  // PRODUCTS
  { triggers: ['perfume', 'ittar', 'oud', 'attar', 'fragrance'], response: "Yes! 🧴 Perfume box manufacturing is our specialty. We make magnetic closure, drawer style, and rigid luxury boxes for brands like Forest Essentials and Solo Code. What style and quantity are you looking for?" },
  { triggers: ['rigid', 'luxury box', 'premium box', 'magnetic'], response: "Yes! 📦 Rigid box manufacturing is our core product. We make two-piece, magnetic, telescopic, and shoulder neck boxes with premium finishes. What's your requirement?" },
  { triggers: ['mono carton', 'fmcg', 'cosmetic'], response: "Yes! 📋 We manufacture mono cartons for FMCG, pharma, and cosmetic brands. MOQ starts from 5,000–10,000 pieces for cartons. What product are you packaging?" },
  
  // DELIVERY
  { triggers: ['delivery', 'shipping', 'how long', 'timeline', 'delhi', 'noida', 'gurgaon', 'ncr'], response: "Typically:\n• *Small orders (1k-5k)*: 10–15 working days\n• *Large orders (25k+)*: 20–30 working days\n\nWe deliver Pan India! Transit takes 1-2 days to NCR and 3-4 days to cities like Mumbai/Bengaluru. 🚚" },
  
  // CUSTOMIZATION
  { triggers: ['custom', 'logo', 'design', 'my brand', 'size'], response: "Everything we make is 100% custom! 📐 Share your product size (L x W x H) and your logo files (AI/PDF), and we'll design the perfect box. We offer foil stamping, UV coating, and more. 🎨" },
  
  // TRUST
  { triggers: ['manufacturer', 'factory', 'trader'], response: "We are a *direct manufacturer* — not a trader. 🏭 Our 200,000 sq ft factory in Noida has been operating since 1975 (51 years). You get factory-direct pricing and quality assurance. 🏆" },
  
  // PAYMENT
  { triggers: ['payment', 'terms', 'advance', 'gst'], response: "Our standard terms are: *50% advance* to start production and *50% before dispatch*. 💳 We provide proper GST invoices for all orders. 🧾" },

  // HINDI
  { triggers: ['namaste', 'kaise ho', 'kya kaam karte ho'], response: "नमस्ते! 🙏 Solar Print Process में आपका स्वागत है। हम Noida में 51 साल से premium packaging manufacture करते हैं। आपको किस तरह की packaging चाहिए? Box का type और quantity बताएं, हम 2 घंटे में quote देंगे। 📦" }
];

const getLocalResponse = (text: string) => {
  const lowerText = text.toLowerCase();
  let bestMatch = null;
  let maxScore = 0;

  for (const item of KNOWLEDGE_BASE) {
    let score = 0;
    for (const trigger of item.triggers) {
      // Use regex with word boundaries to avoid matching inside other words (e.g., 'hello' inside 'delhi')
      const regex = new RegExp(`\\b${trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lowerText)) {
        score += trigger.length * 2; // Exact word match gets high priority
      } else if (lowerText.includes(trigger)) {
        score += trigger.length; // Substring match (fallback)
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestMatch = item.response;
    }
  }

  if (maxScore > 0) return bestMatch + "\n\n— Solar Print Process Team 🏭";
  return null;
};

const getAIResponse = async (from: string, text: string, history: any[] = []) => {
  // Use local knowledge base instead of external AI
  return getLocalResponse(text);
};

// CRM Configuration
const CRM_URL = 'https://crm.solarprintprocess.com';
const CRM_USER = 'spppl.in@gmail.com';
const CRM_PASS = '$Spppl@2026';
const ADMIN_NUMBER = '919911767272@s.whatsapp.net';

const pushToCRM = async (leadData: any) => {
  try {
    const authHeader = `Basic ${Buffer.from(`${CRM_USER}:${CRM_PASS}`).toString('base64')}`;
    const response = await fetch(`${CRM_URL}/api/v1/Lead`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        firstName: leadData.name?.split(' ')[0] || 'Web',
        lastName: leadData.name?.split(' ').slice(1).join(' ') || 'Lead',
        emailAddress: leadData.email,
        phoneNumber: leadData.phone,
        description: `Source: ${leadData.source || 'Website'}\nMessage: ${leadData.message || ''}`,
        source: leadData.source || 'Web'
      })
    });
    const result = await response.json();
    console.log('CRM Push Result:', result);
    return result;
  } catch (err) {
    console.error('CRM Push Error:', err);
  }
};

// In-memory User Store
let users = [
  { id: '1', name: 'Admin', email: 'spppl.in@gmail.com', password: 'admin', role: 'admin' }
];

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const server = createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;
  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    secret: 'nexusflow-secret-key-12345',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
  }));

  // Auth Middleware
  const requireAuth = (req: any, res: any, next: any) => {
    (req.session as any).userId = '1';
    next();
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    (req.session as any).userId = '1';
    next();
  };

  // Auth Endpoints
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for: ${email}`);
    const user = users.find(u => u.email === email && u.password === password);
    
    if (user) {
      (req.session as any).userId = user.id;
      const { password: _, ...userWithoutPassword } = user;
      res.json({ success: true, user: userWithoutPassword });
    } else {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
    }
  });

  app.get('/api/auth/me', (req, res) => {
    const user = users[0];
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ success: false });
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json(users.map(({ password: _, ...u }) => u));
  });

  app.post('/api/admin/users', requireAdmin, (req, res) => {
    const { name, email, password, role } = req.body;
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    const newUser = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      email,
      password,
      role: role || 'agent'
    };
    users.push(newUser);
    io.emit('teammates:sync', getTeammates());
    res.json(newUser);
  });

  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const index = users.findIndex(u => u.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'User not found' });
    if (users[index].role === 'admin' && users.filter(u => u.role === 'admin').length === 1) {
      return res.status(400).json({ error: 'Cannot delete the only administrator' });
    }
    users.splice(index, 1);
    io.emit('teammates:sync', getTeammates());
    res.json({ success: true });
  });

  // WhatsApp Logic
  let lastQr: string | null = null;
  let currentStatus: 'connected' | 'disconnected' | 'connecting' = 'disconnected';

  let authState: any = null;
  const loadAuthState = async () => {
    authState = await useMultiFileAuthState('auth_info_baileys');
  };
  await loadAuthState();

  const { version } = await fetchLatestBaileysVersion();

  let sock: any = null;
  let connectionTimeout: NodeJS.Timeout | null = null;
  let isConnecting = false;

  const connectToWhatsApp = async () => {
    if (isConnecting) return;
    isConnecting = true;

    if (connectionTimeout) clearTimeout(connectionTimeout);

    currentStatus = 'connecting';
    io.emit('whatsapp:status', 'connecting');

    try {
      sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: authState.state,
        logger: pino({ level: 'silent' }),
        browser: ['Solar Automation AI', 'Chrome', '20.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
      });

      sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('[WhatsApp] New QR received');
          lastQr = await qrcode.toDataURL(qr);
          io.emit('whatsapp:qr', lastQr);
          currentStatus = 'disconnected';
          io.emit('whatsapp:status', 'disconnected');
        }

        if (connection === 'close') {
          lastQr = null;
          isConnecting = false;
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          const errorMessage = lastDisconnect?.error?.message || '';
          
          console.log('Connection closed. Reason:', statusCode, 'Error:', errorMessage);
          
          if (statusCode === DisconnectReason.loggedOut || errorMessage.includes('401')) {
            console.log('Logged out. Clearing session...');
            if (fs.existsSync('auth_info_baileys')) {
              try { fs.rmSync('auth_info_baileys', { recursive: true, force: true }); } catch (e) {}
            }
            await loadAuthState();
            currentStatus = 'disconnected';
            io.emit('whatsapp:status', 'disconnected');
            connectionTimeout = setTimeout(connectToWhatsApp, 3000);
          } else if (statusCode === DisconnectReason.restartRequired || statusCode === DisconnectReason.timedOut || errorMessage.includes('QR refs attempts ended') || !statusCode) {
            console.log('Restarting connection...');
            if (errorMessage.includes('QR refs attempts ended') || statusCode === DisconnectReason.timedOut) {
              if (fs.existsSync('auth_info_baileys')) {
                try { fs.rmSync('auth_info_baileys', { recursive: true, force: true }); } catch (e) {}
              }
              await loadAuthState();
            }
            connectionTimeout = setTimeout(connectToWhatsApp, 2000);
          } else if (shouldReconnect) {
            connectionTimeout = setTimeout(connectToWhatsApp, 3000);
          } else {
            currentStatus = 'disconnected';
            io.emit('whatsapp:status', 'disconnected');
          }
        } else if (connection === 'open') {
          lastQr = null;
          isConnecting = false;
          currentStatus = 'connected';
          (global as any).whatsappSock = sock;
          console.log('WhatsApp connection opened');
          io.emit('whatsapp:status', 'connected');
        }
      });
    } catch (err) {
      console.error('Socket creation error:', err);
      isConnecting = false;
      setTimeout(connectToWhatsApp, 5000);
    }

    sock.ev.on('creds.update', authState.saveCreds);

    sock.ev.on('messages.upsert', async (m: any) => {
      if (m.type === 'notify' && sock) {
        for (const msg of m.messages) {
          if (!msg.key.fromMe) {
            // Socket.io sync for logs
            if (msg.message) {
              const from = msg.key.remoteJid;
              const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
              const messageData = {
                from,
                pushName: msg.pushName,
                text,
                timestamp: msg.messageTimestamp,
                fromMe: false
              };
              
              if (!chats[from]) chats[from] = [];
              chats[from] = [...chats[from], messageData].slice(-50);
              
              io.emit('whatsapp:message', messageData);
              io.emit('chats:sync', chats);
              
              // Check for bot conversation first
              const cleanedFrom = from.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '');
              console.log(`[WhatsApp] Processing message from ${cleanedFrom}: ${text}`);
              const botHandled = await processBotConversations(msg);
              
              // Workflow processing (only if bot didn't handle it)
              if (!botHandled) {
                await processWorkflows(msg);
              }
            }
          }
        }
      }
    });

    const processWorkflows = async (msg: any) => {
      const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim().toLowerCase();
      if (!text) return;

      for (const workflow of workflows) {
        if (!workflow.enabled || !workflow.keyword) continue;
        
        const matched = text === workflow.keyword.toLowerCase();

        if (matched) {
          const jid = msg.key.remoteJid;
          console.log(`[Workflow] Triggered: ${workflow.name} for ${jid}`);
          
          for (const action of workflow.actions) {
            try {
              if (action.type === 'text' && action.content) {
                await sock.sendMessage(jid, { text: action.content });
              } else if (action.type === 'image' && action.content) {
                await sock.sendMessage(jid, { image: { url: action.content }, caption: action.caption || '' });
              } else if (action.type === 'form') {
                const baseUrl = process.env.APP_URL || 'http://localhost:3000';
                const formUrl = `${baseUrl}/f/${action.id}`;
                await sock.sendMessage(jid, { text: `Please fill out this form to proceed: ${formUrl}` });
              }
            } catch (e) {
              console.error('Workflow action failed:', e);
            }
            await delay(1000); 
          }
        }
      }
    };
  };

  connectToWhatsApp();

  // Workflow Store
  let workflows: any[] = [];
  let leadForwardingNumber: string = '';
  
  // Teammates logic is now handled by the 'users' array
  const getTeammates = () => users.map(({ password: _, ...u }) => ({ ...u, status: 'online' }));

  // Lead Stores
  let leads: any = {
    meta: [],
    google: [],
    website: [],
    direct: [],
    all: []
  };
  leads.all = [];

  // Chat History Store
  let chats: Record<string, any[]> = {};

  // Bot State Store for Details Collection
  let botStates: Record<string, { 
    step: 'name' | 'email' | 'requirement' | 'quantity' | 'completed' | null,
    details: { name?: string, email?: string, requirement?: string, quantity?: string } 
  }> = {};

  const sendBotDetailsToAdmin = async (details: any, fromJid: string) => {
    try {
      if (sock) {
        // User requested number: +91 8826750844
        const adminJid = '918826750844@s.whatsapp.net';
        const summary = `🚀 *New Packaging Lead Captured*\n\n*Name:* ${details.name}\n*Company Email:* ${details.email}\n*From Phone:* ${fromJid.split('@')[0]}\n*Requirement:* ${details.requirement}\n*Quantity:* ${details.quantity}\n\n_Auto-collected via Packaging Bot_`;
        
        await sock.sendMessage(adminJid, { text: summary });
        console.log(`[Bot] Lead details forwarded to admin ${adminJid}`);
        
        // Also push to CRM if you want
        const cleanedPhone = fromJid.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '');
        addLead('direct', {
          name: details.name,
          phone: cleanedPhone,
          email: details.email,
          message: `Requirement: ${details.requirement}\nQuantity: ${details.quantity}`,
          source: 'Bot'
        });
      }
    } catch (e) {
      console.error('Failed to forward lead details to admin:', e);
    }
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const isValidBusinessEmail = async (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return { valid: false, error: 'That doesn\'t look like a valid email. Please enter a correct email address.' };

    const domain = email.split('@')[1].toLowerCase();
    const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'protonmail.com', 'yandex.com', 'mail.com', 'gmx.com', 'rediffmail.com', 'live.com', 'me.com'];
    
    if (freeProviders.includes(domain)) {
      return { valid: false, error: 'Please provide an official *Company Email* (e.g. name@yourcompany.com). We do not accept personal emails like Gmail/Yahoo.' };
    }

    try {
      // Check for MX records to verify domain has a mail server (working website/email)
      const mx = await resolveMx(domain).catch(() => []);
      if (!mx || mx.length === 0) {
        return { valid: false, error: 'The email domain provided seems to be invalid or has no active mail servers. Please provide a working company email.' };
      }
      return { valid: true };
    } catch (e) {
      return { valid: false, error: 'The email domain provided is either invalid or inactive. Please use your official company email.' };
    }
  };

  const replyWithNaturalDelay = async (jid: string, content: any) => {
    if (!sock) return;
    try {
      await sock.sendPresenceUpdate('composing', jid);
      const textLen = content.text?.length || 20;
      const waitTime = Math.min(Math.max(textLen * 30, 800), 2500);
      await delay(waitTime);
      await sock.sendPresenceUpdate('paused', jid);
      return await sock.sendMessage(jid, content);
    } catch (e) {
      console.error('Failed to send delayed reply:', e);
    }
  };

  const processBotConversations = async (msg: any) => {
    const from = msg.key.remoteJid;
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
    const lowerText = text.toLowerCase();

    // Check if user is already in a bot state
    const state = botStates[from];
    
    // Check if user already exists as a lead
    const isExistingLead = leads.all.some((l: any) => l.phone === from.split('@')[0]);

    // Greeting triggers to potentially start flow
    const greetings = ['hi', 'hello', 'hey', 'namaste', 'start', 'quote', 'packaging'];
    const isGreeting = greetings.some(g => lowerText === g);

    // Trigger flow if it's a greeting from a new user OR a specific packaging request
    if (!state && !isExistingLead && (isGreeting || lowerText.includes('need packaging'))) {
      botStates[from] = { step: 'name', details: {} };
      await replyWithNaturalDelay(from, { text: 'Hello! 👋 Thank you for choosing Solar Print Process. \n\nI can help you get started with a customized packaging quote. To better assist you, may I have your *Full Name*?' });
      return true;
    }

    if (state) {
      // Handle exit/cancel
      if (lowerText === 'cancel' || lowerText === 'exit') {
        delete botStates[from];
        await replyWithNaturalDelay(from, { text: 'Detail collection cancelled. Feel free to ask any questions about our packaging services!' });
        return true;
      }

      switch (state.step) {
        case 'name':
          if (text.length < 2) {
            await replyWithNaturalDelay(from, { text: 'Please provide your full name to proceed.' });
            return true;
          }
          state.details.name = text;
          state.step = 'email';
          await replyWithNaturalDelay(from, { text: `Nice to meet you, *${text}*! 👋\n\nTo ensure we maintain professional standards, please provide your official *Company Business Email*. \n\n_(Note: We only accept business emails. Personal accounts like Gmail, Yahoo, or Hotmail will not be accepted.)_` });
          break;

        case 'email':
          const emailCheck = await isValidBusinessEmail(text);
          if (!emailCheck.valid) {
            await replyWithNaturalDelay(from, { text: emailCheck.error });
            return true;
          }
          state.details.email = text;
          state.step = 'requirement';
          await replyWithNaturalDelay(from, { text: 'Great! Email verified. ✅\n\nPlease describe your *Packaging Requirement* (e.g., dimensions, box style, material preferences, or what product you are packaging).' });
          break;

        case 'requirement':
          if (text.length < 5) {
            await replyWithNaturalDelay(from, { text: 'Please provide a bit more detail about your packaging needs so our experts can assist you better.' });
            return true;
          }
          state.details.requirement = text;
          state.step = 'quantity';
          await replyWithNaturalDelay(from, { text: 'Understood. And what is the *Approximate Quantity* you are looking for?\n\n_(Note: Our standard MOQ is 500 pieces)_' });
          break;

        case 'quantity':
          const qtyString = text.replace(/[^0-9]/g, '');
          const qtyValue = parseInt(qtyString);
          
          if (!isNaN(qtyValue) && qtyValue < 500) {
            await replyWithNaturalDelay(from, { text: 'Sorry for the inconvenience. 😔 We are currently handling only orders with a *Minimum Quantity of 500 pieces* or more.\n\nIf you can scale your requirement, please let us know. Otherwise, feel free to contact us again when your volume grows! 🙏' });
            delete botStates[from];
            return true;
          }

          state.details.quantity = text;
          state.step = 'completed';
          
          await replyWithNaturalDelay(from, { 
            text: 'Thank you! 🙌 Your details have been recorded. Our sales team will evaluate your requirement and send a detailed quote to your email shortly.\n\nIs there anything else I can help you with today? Feel free to ask about our factory, MOQ, or delivery timelines!' 
          });

          // Forward to Admin
          await sendBotDetailsToAdmin(state.details, from);
          
          // Cleanup state after completion
          delete botStates[from];
          break;
      }
      return true;
    }

    // AI Fallback for Q&A if not in flow
    const history = (chats[from] || []).slice(-10); // Last 10 messages for context
    const aiReply = await getAIResponse(from, text, history);
    if (aiReply) {
      await replyWithNaturalDelay(from, { text: aiReply });
      return true;
    }

    return false;
  };

  const addLead = (source: 'meta' | 'google' | 'website' | 'direct', data: any) => {
    const newLead = { 
      id: Math.random().toString(36).substr(2, 9),
      source,
      data,
      name: data.name || 'Anonymous',
      phone: data.phone || '',
      email: data.email || '',
      status: 'New',
      assignedTeammateId: null,
      timestamp: Date.now()
    };
    if (leads[source]) {
      leads[source] = [newLead, ...leads[source]].slice(0, 50);
    }
    leads.all = [newLead, ...leads.all].slice(0, 100);
    io.emit('leads:sync', leads);

    // Push to CRM
    pushToCRM(newLead).catch(e => console.error('Lead CRM push failed:', e));

    // Schedule 25-minute untounched lead notification
    setTimeout(async () => {
      // Find lead to verify current status
      const currentLead = leads.all.find((l: any) => l.id === newLead.id);
      if (currentLead && currentLead.status === 'New') {
        const sock = (global as any).whatsappSock;
        if (sock) {
          try {
            const adminMsg = `⚠️ *CRITICAL: UNTOUCHED LEAD*\n\nIt has been 25 minutes and the following lead is still marked as NEW:\n\n👤 Name: ${newLead.name}\n📱 Phone: ${newLead.phone}\n🌐 Source: ${newLead.source}\n\n_Please check EspoCRM and update status immediately._`;
            await sock.sendMessage(ADMIN_NUMBER, { text: adminMsg });
            console.log('Follow-up alert sent to admin for lead:', newLead.id);
          } catch (e) {
            console.error('Failed to send lead alert message:', e);
          }
        }
      }
    }, 25 * 60 * 1000);

    return newLead;
  };

  io.on('connection', (socket) => {
    // Send immediate state
    socket.emit('whatsapp:status', currentStatus);
    if (lastQr) socket.emit('whatsapp:qr', lastQr);

    socket.on('lead:manual', (data) => {
      addLead('direct', data);
    });

    // Sync leads on connection
    socket.emit('leads:sync', leads);
    socket.emit('teammates:sync', getTeammates());
    socket.emit('chats:sync', chats);
    socket.emit('team:messages:sync', teamMessages);

    socket.on('whatsapp:logout', async () => {
      if (sock) {
        try {
          await sock.logout();
          sock.end(undefined);
          if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
          }
          await loadAuthState();
          io.emit('whatsapp:status', 'disconnected');
          connectToWhatsApp();
        } catch (e) {
          console.error('Logout error:', e);
        }
      }
    });
  });

  app.post('/api/whatsapp/restart', async (req, res) => {
    try {
      if (sock) {
        sock.end(undefined);
      }
      if (fs.existsSync('auth_info_baileys')) {
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
      }
      await loadAuthState();
      io.emit('whatsapp:status', 'connecting');
      isConnecting = false; // Reset lock
      connectToWhatsApp();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Bulk Broadcast Endpoint
  app.post('/api/broadcast', async (req, res) => {
    const { numbers, message } = req.body;
    if (!sock) return res.status(500).json({ error: 'WhatsApp not initialized' });
    if (!Array.isArray(numbers)) return res.status(400).json({ error: 'Numbers must be an array' });

    res.json({ success: true, message: 'Broadcast started in background' });

    // Process in background to avoid blocking response
    for (const number of numbers) {
      try {
        const jid = `${number.toString().replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        // Randomized delay between 2-5 seconds for safety
        await delay(2000 + Math.random() * 3000);
      } catch (error) {
        console.error(`Failed to send to ${number}:`, error);
      }
    }
  });

  // Workflow API
  app.get('/api/workflows', (req, res) => {
    res.json(workflows);
  });

  app.post('/api/workflows', (req, res) => {
    workflows = req.body.workflows;
    leadForwardingNumber = req.body.forwardingNumber || '';
    res.json({ success: true });
  });

  // API Endpoints
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/api/send-message', async (req, res) => {
    const { phone, number, message } = req.body;
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.API_AUTH_TOKEN;

    // Optional Bearer Token Auth
    if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const targetPhone = phone || number;
    if (!sock) {
      console.error('[API] WhatsApp not connected');
      return res.status(503).json({ success: false, error: 'WhatsApp not initialized/connected' });
    }
    if (!targetPhone || !message) {
      return res.status(400).json({ success: false, error: 'Phone/number and message are required' });
    }

    try {
      // Normalize and Validate
      const cleanNumber = targetPhone.toString().replace(/\D/g, '');
      if (cleanNumber.length < 10) {
        return res.status(400).json({ success: false, error: 'Invalid phone number format' });
      }

      const jid = `${cleanNumber}@s.whatsapp.net`;
      console.log(`[API] Sending message to ${jid}`);
      
      const result = await sock.sendMessage(jid, { text: message });
      
      const messageData = {
        from: jid,
        pushName: 'API Utility',
        text: message,
        timestamp: Math.floor(Date.now() / 1000),
        fromMe: true
      };

      if (!chats[jid]) chats[jid] = [];
      chats[jid] = [...chats[jid], messageData].slice(-50);

      io.emit('whatsapp:message', messageData);
      io.emit('chats:sync', chats);
      
      res.json({ 
        success: true, 
        messageId: result?.key?.id || 'unknown',
        status: 'sent' 
      });
    } catch (error) {
      console.error('[API] Send failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Internal Team Chat Store
  let teamMessages: any[] = [];

  // Team Management
  app.get('/api/teammates', requireAuth, (req, res) => res.json(getTeammates()));
  
  app.post('/api/team/message', requireAuth, (req, res) => {
    const { text } = req.body;
    const senderId = (req.session as any).userId;
    const msg = {
      id: Math.random().toString(36).substr(2, 9),
      senderId,
      text,
      timestamp: Date.now()
    };
    teamMessages = [...teamMessages, msg].slice(-100);
    io.emit('team:message', msg);
    res.json(msg);
  });

  app.post('/api/leads/assign', (req, res) => {
    const { leadId, teammateId } = req.body;
    
    // Find in all collections
    const updateInCollection = (coll: any[]) => {
      const lead = coll.find(l => l.id === leadId);
      if (lead) lead.assignedTeammateId = teammateId;
    };

    updateInCollection(leads.all);
    updateInCollection(leads.meta);
    updateInCollection(leads.google);
    updateInCollection(leads.website);
    updateInCollection(leads.direct);

    io.emit('leads:sync', leads);
    res.json({ success: true });
  });

  // Facebook Lead Webhook (Meta/Make.com friendly)
  app.post('/api/webhook/facebook', async (req, res) => {
    const data = req.body;
    console.log('Received Facebook Lead:', JSON.stringify(data, null, 2));
    
    // Normalize data for common Make.com / Zapier mappings
    const leadName = data.full_name || data.name || data.fullName || 'New Lead';
    const leadPhone = data.phone || data.phone_number || data.phoneNumber || data.mobile || '';
    const leadEmail = data.email || 'N/A';

    const normalizedData = {
      ...data,
      name: leadName,
      phone: leadPhone,
      email: leadEmail
    };

    const lead = addLead('meta', normalizedData);

    // 1. Forward notification to Admin
    if (leadForwardingNumber && sock) {
      try {
        const targetJid = `${leadForwardingNumber.replace(/\D/g, '')}@s.whatsapp.net`;
        const leadMsg = `*🚀 NEW LEAD (Meta/FB)*\n\n👤 Name: ${leadName}\n📱 Phone: ${leadPhone}\n📧 Email: ${leadEmail}\n\n_Auto-synced via Solar Automation AI_`;
        await sock.sendMessage(targetJid, { text: leadMsg });
      } catch (e) {
        console.error('Failed to forward lead to admin:', e);
      }
    }

    // 2. Respond to the Lead directly if phone exists
    if (leadPhone && sock) {
      try {
        const leadJid = `${leadPhone.replace(/\D/g, '')}@s.whatsapp.net`;
        // You can customize this greeting or use a specific workflow keyword
        await sock.sendMessage(leadJid, { 
          text: `Hello ${leadName}! 👋\n\nThank you for your interest. We've received your inquiry from Facebook. One of our experts will be with you shortly.\n\nType *HELP* to see how else we can assist you.` 
        });
      } catch (e) {
        console.error('Failed to send auto-reply to lead:', e);
      }
    }
    
    res.json({ status: 'success', leadId: lead.id });
  });

  // Google Ads Webhook
  app.post('/api/webhook/google-ads', async (req, res) => {
    const data = req.body;
    console.log('Received Google Lead:', JSON.stringify(data, null, 2));
    
    const leadName = data.full_name || data.name || 'Google User';
    const leadPhone = data.phone || data.phone_number || '';
    
    addLead('google', { ...data, name: leadName, phone: leadPhone });
    
    // 1. Forward to Admin
    if (leadForwardingNumber && sock) {
      try {
        const targetJid = `${leadForwardingNumber.replace(/\D/g, '')}@s.whatsapp.net`;
        const leadMsg = `*🎯 NEW LEAD (Google Ads)*\n\n👤 Name: ${leadName}\n📱 Phone: ${leadPhone}\n\n_Auto-synced via Solar Automation AI_`;
        await sock.sendMessage(targetJid, { text: leadMsg });
      } catch (e) {
        console.error('Failed to forward Google lead:', e);
      }
    }

    // 2. Respond to Lead
    if (leadPhone && sock) {
      try {
        const leadJid = `${leadPhone.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(leadJid, { text: `Hello ${leadName}! 👋 We received your interest from Google Ads. One of our agents will contact you shortly.` });
      } catch (e) {
        console.error('Failed to auto-reply to Google lead:', e);
      }
    }
    res.json({ received: true });
  });

  // Website Webhook
  app.post('/api/webhook/website', async (req, res) => {
    const data = req.body;
    console.log('Received Website Lead:', JSON.stringify(data, null, 2));

    const leadName = data.name || data['Your Name *'] || 'Website User';
    const leadPhone = data.phone || data['Phone Number'] || '';
    
    const lead = addLead('website', { ...data, name: leadName, phone: leadPhone });

    // 1. Forward to Admin
    if (leadForwardingNumber && sock) {
      try {
        const targetJid = `${leadForwardingNumber.replace(/\D/g, '')}@s.whatsapp.net`;
        const leadMsg = `*🌐 NEW LEAD (Website)*\n\n👤 Name: ${leadName}\n📱 Phone: ${leadPhone}\n\n_Auto-synced via Solar Automation AI_`;
        await sock.sendMessage(targetJid, { text: leadMsg });
      } catch (e) {
        console.error('Failed to forward Website lead:', e);
      }
    }

    // 2. Respond to Lead
    if (leadPhone && sock) {
      try {
        const leadJid = `${leadPhone.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(leadJid, { text: `Hi ${leadName}! 👋 Thank you for inquiring on our website. We'll get back to you soon.` });
      } catch (e) {
        console.error('Failed to auto-reply to Website lead:', e);
      }
    }

    res.json({ status: 'success', leadId: lead.id });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
