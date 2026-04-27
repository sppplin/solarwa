/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  QrCode, 
  Bot, 
  Settings, 
  Activity, 
  MessageSquare, 
  Bell, 
  Share2, 
  CheckCircle2, 
  XCircle,
  Zap,
  Globe,
  Database,
  ChevronRight,
  TrendingUp,
  Mail,
  Send,
  GitBranch,
  Facebook,
  UserPlus,
  Plus,
  Trash2,
  Image as ImageIcon,
  LayoutGrid,
  Filter,
  History,
  Play,
  Users,
  CheckCircle,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { GoogleGenAI } from "@google/genai";
import { cn } from './lib/utils';

// Types
interface Message {
  from: string;
  pushName: string;
  text: string;
  timestamp: number;
  fromMe?: boolean;
}

interface AutomationConfig {
  enabled: boolean;
  systemPrompt: string;
  autoReplyKeywords: string[];
}

interface WorkflowAction {
  id: string;
  type: 'text' | 'image' | 'form';
  content: string;
  caption?: string;
  formConfig?: {
    title: string;
    description: string;
    fields: { id: string; label: string; placeholder: string; required: boolean; type: string }[];
  };
}

interface Workflow {
  id: string;
  name: string;
  trigger: 'keyword' | 'on_connect';
  keyword: string;
  enabled: boolean;
  actions: WorkflowAction[];
}

const LOGO_URL = "https://static.wixstatic.com/media/895e2c_99457844de4b481da7005c3e882ca1ec~mv2.jpg";

export default function App() {
  const [activeTab, setActiveTab] = useState<'connection' | 'inbox' | 'automation' | 'webhooks' | 'analytics' | 'broadcast' | 'workflows' | 'leads' | 'team'>('connection');
  
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
  };

  // Public Form Check
  const [publicFormId, setPublicFormId] = useState<string | null>(() => {
    const path = window.location.pathname;
    return path.startsWith('/f/') ? path.replace('/f/', '') : null;
  });

  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [connError, setConnError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrTimestamp, setQrTimestamp] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const [activeChatJid, setActiveChatJid] = useState<string | null>(null);
  const [teammates, setTeammates] = useState<any[]>([]);
  const [teamMessages, setTeamMessages] = useState<any[]>([]);
  const [currentUser] = useState({ id: '1', name: 'User' }); // Admin user ID from server sync
  const [socket, setSocket] = useState<Socket | null>(null);
  
  // Auth State
  const [authStatus, setAuthStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('authenticated');
  const [user, setUser] = useState<any>({
    id: '1',
    email: 'spppl.in@gmail.com',
    name: 'Admin User',
    role: 'admin'
  });

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        console.log('Auth check success:', data.email);
        setUser(data);
        setAuthStatus('authenticated');
      } else {
        console.warn('Auth check failed:', res.status);
        setAuthStatus('unauthenticated');
      }
    } catch (e) {
      console.error('Auth check error:', e);
      setAuthStatus('unauthenticated');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setAuthStatus('authenticated');
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Login failed');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setAuthStatus('unauthenticated');
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const refreshConnection = async () => {
    try {
      setStatus('connecting');
      setQrCode(null);
      setConnError(null);
      await fetch('/api/whatsapp/restart', { method: 'POST' });
    } catch (e) {
      console.error('Refresh failed:', e);
      alert('Failed to restart connection.');
    }
  };
  
  // Lead State
  const [leads, setLeads] = useState<{ meta: any[], google: any[], website: any[], direct: any[], all: any[] }>({
    meta: [],
    google: [],
    website: [],
    direct: [],
    all: []
  });
  const [leadSourceFilter, setLeadSourceFilter] = useState<'all' | 'meta' | 'google' | 'website' | 'direct'>('all');
  const [forwardingNumber, setForwardingNumber] = useState('');

  // Workflow State
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);

  // Simulation State
  const [isSimulating, setIsSimulating] = useState(false);
  const [simMessage, setSimMessage] = useState('');
  const [simResults, setSimResults] = useState<WorkflowAction[] | null>(null);

  const runSimulation = () => {
    const matched = workflows.find(w => w.enabled && w.keyword.toLowerCase() === simMessage.toLowerCase());
    setSimResults(matched ? matched.actions : []);
  };

  // Automation State
  const [aiEnabled, setAiEnabled] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful business assistant for our company. Respond professionally and concisely.');

  // Manual Send State
  const [testNumber, setTestNumber] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Broadcast State
  const [broadcastNumbers, setBroadcastNumbers] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const handleBroadcast = async () => {
    if (!broadcastNumbers || !broadcastMessage) return;
    const numbersArray = broadcastNumbers.split(/[\n,]/).map(n => n.trim()).filter(n => n.length > 0);
    if (numbersArray.length === 0) return;

    setIsBroadcasting(true);
    try {
      await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: numbersArray, message: broadcastMessage })
      });
      alert(`Campaign started for ${numbersArray.length} contacts!`);
      setBroadcastMessage('');
    } catch (error) {
      console.error('Broadcast Error:', error);
      alert('Failed to start broadcast.');
    } finally {
      setIsBroadcasting(false);
    }
  };

  const sendMessage = async (jid: string, text: string) => {
    if (!jid || !text) return;
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: jid, message: text })
      });
      const data = await res.json();
      if (!data.success) {
        alert('Failed to send: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('Send error:', e);
    }
  };

  const handleSendTest = async () => {
    if (!testNumber || !testMessage) return;
    setIsSending(true);
    try {
      await sendMessage(testNumber, testMessage);
      setTestMessage('');
      alert('Test message sent!');
    } catch (e) {
      alert('Error connecting to server.');
    } finally {
      setIsSending(false);
    }
  };

  const addTeammate = async (name: string, role: string) => {
    if (!name) return;
    try {
      await fetch('/api/teammates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role })
      });
    } catch (e) {
      console.error('Add teammate failed:', e);
    }
  };

  const sendTeamMessage = async (text: string) => {
    if (!text) return;
    try {
      await fetch('/api/team/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: currentUser.id, text })
      });
    } catch (e) {
      console.error('Team message failed:', e);
    }
  };

  const assignLead = async (leadId: string, teammateId: string) => {
    try {
      await fetch('/api/leads/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, teammateId })
      });
    } catch (e) {
      console.error('Assignment failed:', e);
    }
  };

  const saveWorkflows = async (updatedWorkflows: Workflow[], updatedForwarding: string) => {
    try {
      await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflows: updatedWorkflows, forwardingNumber: updatedForwarding })
      });
      setWorkflows(updatedWorkflows);
      setForwardingNumber(updatedForwarding);
    } catch (error) {
      console.error('Failed to save workflows:', error);
    }
  };

  const addWorkflow = () => {
    const newWorkflow: Workflow = {
      id: Math.random().toString(36).substr(2, 9),
      name: 'New Workflow',
      trigger: 'keyword',
      keyword: 'hello',
      enabled: true,
      actions: [{ id: Math.random().toString(), type: 'text', content: 'Hi! How can I help you?' }]
    };
    saveWorkflows([...workflows, newWorkflow], forwardingNumber);
    setActiveWorkflowId(newWorkflow.id);
  };

  const deleteWorkflow = (id: string) => {
    saveWorkflows(workflows.filter(w => w.id !== id), forwardingNumber);
    if (activeWorkflowId === id) setActiveWorkflowId(null);
  };

  const updateWorkflow = (updated: Workflow) => {
    saveWorkflows(workflows.map(w => w.id === updated.id ? updated : w), forwardingNumber);
  };

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Handle AI Auto-Reply
  const handleAutoReply = useCallback(async (msg: Message) => {
    if (!aiEnabled || !process.env.GEMINI_API_KEY || msg.fromMe) return;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: msg.text,
        config: {
          systemInstruction: systemPrompt
        }
      });

      const replyText = response.text;
      if (replyText) {
        await fetch('/api/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: msg.from, message: replyText })
        });
      }
    } catch (error) {
      console.error('AI Error:', error);
    }
  }, [aiEnabled, systemPrompt]);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('whatsapp:qr', (qr: string) => {
      setQrCode(qr);
      setQrTimestamp(Date.now());
      setStatus('disconnected');
    });

    newSocket.on('whatsapp:disconnected', ({ reason, message }: { reason: number; message: string }) => {
      console.log('Disconnected:', reason, message);
      if (reason === 408 || message?.includes('QR refs attempts ended')) {
        setConnError('QR generation timed out or attempts ended. Please force refresh if it doesn\'t restart.');
      } else {
        setConnError(`Disconnected: ${message || reason}`);
      }
    });

    newSocket.on('whatsapp:status', (newStatus: 'connected' | 'disconnected' | 'connecting') => {
      setStatus(newStatus);
      if (newStatus === 'connected') {
        setQrCode(null);
        setConnError(null);
      }
    });

    newSocket.on('whatsapp:message', (msg: Message & { fromMe?: boolean }) => {
      setMessages(prev => [msg, ...prev].slice(0, 50));
      setChats(prev => {
        const jid = msg.from;
        const currentChat = prev[jid] || [];
        return { ...prev, [jid]: [...currentChat, msg].slice(-50) };
      });
      handleAutoReply(msg);
    });

    newSocket.on('chats:sync', (remoteChats: Record<string, Message[]>) => {
      setChats(remoteChats);
    });

    newSocket.on('teammates:sync', (team: any[]) => {
      setTeammates(team);
    });

    newSocket.on('team:messages:sync', (msgs: any[]) => {
      setTeamMessages(msgs);
    });

    newSocket.on('team:message', (msg: any) => {
      setTeamMessages(prev => [...prev, msg].slice(-100));
    });

    newSocket.on('leads:sync', (initialLeads: any) => {
      setLeads(initialLeads);
    });

    newSocket.on('lead:new', (newLead: any) => {
      setLeads(prev => ({
        ...prev,
        [newLead.source]: [newLead, ...prev[newLead.source as keyof typeof prev]].slice(0, 50),
        all: [newLead, ...prev.all].slice(0, 100)
      }));
    });

    // Load workflows from server
    fetch('/api/workflows')
      .then(res => res.json())
      .then(data => setWorkflows(data || []));

    return () => {
      newSocket.close();
    };
  }, [handleAutoReply]);

  if (publicFormId) {
    return <PublicFormView id={publicFormId} />;
  }



  return (
    <div className="flex h-screen bg-[#F0F2F5] text-[#111B21] font-sans antialiased overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-[#E9EDEF] flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center p-1 shadow-sm border border-[#E9EDEF] overflow-hidden">
              <img src={LOGO_URL} alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
            </div>
            <div>
              <h1 className="text-xl font-black text-[#111B21] tracking-tighter">Solar Automation AI</h1>
              <p className="text-[10px] uppercase font-bold tracking-widest text-[#FFD700]">Solar Energy AI</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          <SidebarLink 
            icon={<QrCode size={18} />} 
            label="Connection" 
            active={activeTab === 'connection'} 
            onClick={() => setActiveTab('connection')} 
          />
          <SidebarLink 
            icon={<MessageSquare size={18} />} 
            label="Inbox" 
            active={activeTab === 'inbox'} 
            onClick={() => setActiveTab('inbox')} 
          />
          <SidebarLink 
            icon={<LayoutGrid size={18} />} 
            label="Leads Dashboard" 
            active={activeTab === 'leads'} 
            onClick={() => setActiveTab('leads')} 
          />
          {user?.role === 'admin' && (
            <SidebarLink 
              icon={<UserPlus size={18} />} 
              label="User Management" 
              active={activeTab === 'team'} 
              onClick={() => setActiveTab('team')} 
            />
          )}
          <SidebarLink 
            icon={<GitBranch size={18} />} 
            label="Visual Workflow" 
            active={activeTab === 'workflows'} 
            onClick={() => setActiveTab('workflows')} 
          />
          <SidebarLink 
            icon={<Send size={18} />} 
            label="Bulk Campaign" 
            active={activeTab === 'broadcast'} 
            onClick={() => setActiveTab('broadcast')} 
          />
          <SidebarLink 
            icon={<Bot size={18} />} 
            label="AI Automation" 
            active={activeTab === 'automation'} 
            onClick={() => setActiveTab('automation')} 
          />
          <SidebarLink 
            icon={<Activity size={18} />} 
            label="Real-time Logs" 
            active={activeTab === 'analytics'} 
            onClick={() => setActiveTab('analytics')} 
          />
        </nav>

        <div className="p-4 border-t border-[#E9EDEF] space-y-2">
          <div className="flex items-center justify-between p-3 bg-[#F8F9FA] rounded-xl border border-[#E9EDEF]">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                status === 'connected' ? "bg-green-500" : "bg-red-500"
              )} />
              <div className="text-[10px] font-black uppercase tracking-widest text-[#667781]">{status}</div>
            </div>
            <button onClick={handleLogout} className="text-xs font-bold text-red-500 hover:underline">Logout</button>
          </div>
          <div className="flex items-center gap-3 p-3">
            <div className="w-8 h-8 rounded-full bg-[#111B21] flex items-center justify-center text-white text-[10px] font-black">
              {user?.name?.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-black truncate">{user?.name}</p>
              <p className="text-[9px] text-[#667781] uppercase font-bold">{user?.role}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={cn(
        "flex-1 overflow-y-auto w-full",
        activeTab === 'workflows' ? "p-0" : "p-8 max-w-7xl mx-auto"
      )}>
        <header className={cn(
          "mb-8 flex justify-between items-center",
          activeTab === 'workflows' && "px-8 pt-8"
        )}>
          <div>
            <h2 className="text-2xl font-bold text-[#3B4A54]">
              {activeTab === 'connection' && 'Link Device'}
              {activeTab === 'inbox' && 'Omni-Channel Inbox'}
              {activeTab === 'automation' && 'Gemini AI Assistant'}
              {activeTab === 'analytics' && 'Activity Logs'}
              {activeTab === 'webhooks' && 'External Integrations'}
              {activeTab === 'broadcast' && 'Broadcast Campaign'}
              {activeTab === 'workflows' && 'Workflow Automations'}
              {activeTab === 'leads' && 'Global Lead Collection'}
              {activeTab === 'team' && 'Team & Permissions'}
            </h2>
            <p className="text-[#667781]">
              Manage your WhatsApp infrastructure and smart triggers
            </p>
          </div>
          <div className="flex gap-2">
            {activeTab === 'workflows' && (
              <button 
                onClick={addWorkflow}
                className="flex items-center gap-2 px-4 py-2 bg-[#FFD700] text-black rounded-lg text-sm font-bold hover:bg-[#FFC600]"
              >
                <Plus size={16} /> New Workflow
              </button>
            )}
            <button className="p-2 hover:bg-white rounded-lg text-[#54656F] transition-colors shadow-sm bg-white/50 border border-[#EBEDF0]">
              <Bell size={20} />
            </button>
            <button className="p-2 hover:bg-white rounded-lg text-[#54656F] transition-colors shadow-sm bg-white/50 border border-[#EBEDF0]">
              <Settings size={20} />
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'connection' && (
            <motion.div 
              key="conn"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-[#E9EDEF] flex flex-col items-center justify-center min-h-[400px]">
                  {status === 'connected' ? (
                    <div className="text-center">
                      <div className="bg-[#FFF9C4] p-6 rounded-full inline-block mb-4">
                        <CheckCircle2 size={48} className="text-[#FFD700]" />
                      </div>
                      <h3 className="text-xl font-bold text-[#3B4A54] mb-2">Authenticated</h3>
                      <p className="text-[#667781]">Your account is currently active and scanning.</p>
                      <button 
                        onClick={() => socket?.emit('whatsapp:logout')}
                        className="mt-6 px-6 py-2 border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
                      >
                        Disconnect Device
                      </button>
                    </div>
                  ) : qrCode ? (
                    <div className="text-center">
                      <div className="p-4 bg-white border-4 border-[#FFD700] rounded-2xl mb-6 inline-block relative group">
                        <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
                        <div className="absolute top-2 right-2 flex gap-1">
                          <div className="px-2 py-0.5 bg-[#FFD700] text-black text-[8px] font-bold rounded-full animate-pulse">
                            LIVE
                          </div>
                        </div>
                      </div>
                      <h3 className="text-lg font-bold mb-2">Scan with WhatsApp</h3>
                      {connError && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs font-medium">
                          {connError}
                        </div>
                      )}
                      <p className="text-[10px] text-[#667781] mb-4">
                        Last updated: {qrTimestamp ? new Date(qrTimestamp).toLocaleTimeString() : 'Just now'}
                      </p>
                      <ol className="text-sm text-[#667781] text-left space-y-1 mx-auto max-w-xs mb-6">
                        <li>1. Open WhatsApp on your phone</li>
                        <li>2. Tap Menu or Settings and select Linked Devices</li>
                        <li>3. Point your phone to this screen</li>
                      </ol>
                      <button 
                        onClick={refreshConnection}
                        className={cn(
                          "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                          connError 
                            ? "bg-[#FFD700] text-black shadow-lg shadow-[#FFD700]/20 hover:scale-105 active:scale-95" 
                            : "text-[#FFD700] hover:underline"
                        )}
                      >
                        {connError ? 'Restart Connection Now' : 'Taking too long? Force Refresh'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mb-4" />
                      <p className="text-[#667781]">Initializing session...</p>
                    </div>
                  )}
                </div>

                <div className="space-y-6 text-[#111B21]">
                  <StatusCard 
                    title="API Server" 
                    value="Running" 
                    icon={<Database className="text-blue-500" />} 
                    desc="WebSocket bridge active" 
                  />
                  <StatusCard 
                    title="Active Threads" 
                    value="4" 
                    icon={<Share2 className="text-purple-500" />} 
                    desc="Lead processing channels" 
                  />
                  <div className="bg-[#FFD700]/5 p-6 rounded-2xl border border-[#FFD700]/20">
                    <h4 className="font-bold text-[#FFD700] mb-2">Pro Tip</h4>
                    <p className="text-sm text-[#FFD700]/80 leading-relaxed mb-4">
                      Keep this dashboard open to track real-time AI responses. Authenticated sessions usually persist for 14 days.
                    </p>
                  </div>

                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E9EDEF]">
                    <h4 className="font-bold mb-4 flex items-center gap-2">
                       <MessageSquare size={18} className="text-[#FFD700]" />
                       Quick Message Tester
                    </h4>
                    <div className="space-y-3">
                      <input 
                        type="text" 
                        placeholder="Phone Number (e.g. 919876543210)" 
                        className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm focus:ring-2 focus:ring-[#FFD700] focus:outline-none"
                        value={testNumber}
                        onChange={(e) => setTestNumber(e.target.value)}
                      />
                      <textarea 
                        placeholder="Type your message..." 
                        className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm focus:ring-2 focus:ring-[#FFD700] focus:outline-none"
                        rows={3}
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                      />
                      <button 
                        onClick={handleSendTest}
                        disabled={isSending || status !== 'connected'}
                        className="w-full py-3 bg-[#FFD700] text-black rounded-xl font-bold hover:bg-[#FFC600] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSending ? 'Sending...' : 'Send Test Message'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'inbox' && (
            <div className="grid grid-cols-12 gap-6 h-[calc(100vh-220px)] bg-white rounded-2xl shadow-sm border border-[#E9EDEF] overflow-hidden">
              <div className="col-span-4 border-r border-[#E9EDEF] flex flex-col">
                <div className="p-4 bg-[#F8F9FA] border-b border-[#E9EDEF]">
                  <div className="relative">
                    <Filter className="absolute left-3 top-2.5 text-gray-400" size={14} />
                    <input type="text" placeholder="Search chats..." className="w-full pl-9 pr-4 py-2 bg-white border border-[#E9EDEF] rounded-lg text-xs" />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-[#F8F9FA]">
                  {(Object.entries(chats) as [string, Message[]][]).map(([jid, history]) => (
                    <button
                      key={jid}
                      onClick={() => setActiveChatJid(jid)}
                      className={cn(
                        "w-full p-4 text-left hover:bg-[#F8F9FA] transition-all",
                        activeChatJid === jid && "bg-[#FFF9C4]/50 border-r-4 border-[#FFD700]"
                      )}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-sm truncate">
  {history[history.length-1]?.pushName || jid.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '')}
</span>
                        <span className="text-[10px] text-gray-400">{new Date(history[history.length-1].timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{history[history.length-1].text}</p>
                    </button>
                  ))}
                  {Object.keys(chats).length === 0 && (
                    <div className="p-8 text-center text-gray-400">
                      <MessageSquare className="mx-auto mb-2 opacity-20" />
                      <p className="text-xs">No active chats</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="col-span-8 flex flex-col bg-[#F0F2F5] relative">
                {activeChatJid ? (
                  <>
                    <div className="p-4 bg-[#F8F9FA] border-b border-[#E9EDEF] flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#FFD700] rounded-full flex items-center justify-center text-black font-bold text-xs uppercase">
                          {activeChatJid.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-sm">
                            {chats[activeChatJid]?.[chats[activeChatJid].length - 1]?.pushName || activeChatJid.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '')}
                          </p>
                          <p className="text-[10px] text-green-600 font-bold uppercase tracking-wider">Online</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                         <button className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"><Settings size={16} /></button>
                      </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {chats[activeChatJid]?.map((m, i) => (
                        <div key={i} className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
                          <div className={cn(
                            "max-w-[70%] p-3 rounded-xl shadow-sm text-sm relative",
                            m.fromMe ? "bg-[#FFF9C4] text-[#111B21] rounded-tr-none" : "bg-white text-[#111B21] rounded-tl-none"
                          )}>
                            <p className="leading-relaxed">{m.text}</p>
                            <span className="text-[10px] opacity-40 float-right mt-1 ml-4">
                              {new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-4 bg-[#F8F9FA] border-t border-[#E9EDEF]">
                      <form 
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = e.target as HTMLFormElement;
                          const input = form.elements.namedItem('message') as HTMLTextAreaElement;
                          if (input.value.trim()) {
                            sendMessage(activeChatJid, input.value.trim());
                            input.value = '';
                          }
                        }}
                      >
                        <textarea
                          name="message"
                          placeholder="Type a message..."
                          className="flex-1 p-3 bg-white border border-[#E9EDEF] rounded-xl text-sm resize-none focus:ring-1 focus:ring-[#FFD700] outline-none"
                          rows={1}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              e.currentTarget.form?.requestSubmit();
                            }
                          }}
                        />
                        <button type="submit" className="p-3 bg-[#FFD700] text-black rounded-xl hover:bg-[#FFC600] transition-colors">
                          <Send size={18} />
                        </button>
                      </form>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                      <MessageSquare size={32} />
                    </div>
                    <p className="font-bold">Select a chat to start messaging</p>
                    <p className="text-xs">End-to-end encrypted sync active</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'team' && user?.role === 'admin' && (
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-8 space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-[#E9EDEF] overflow-hidden">
                  <div className="p-6 border-b border-[#E9EDEF] flex justify-between items-center bg-[#F8F9FA]">
                    <h3 className="font-bold">System Users</h3>
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{teammates.length} Total</span>
                  </div>
                  <div className="divide-y divide-[#F8F9FA]">
                    {teammates.map(t => (
                      <div key={t.id} className="p-4 flex items-center justify-between hover:bg-[#F8F9FA] transition-colors">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs",
                            t.role === 'admin' ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-500"
                          )}>
                            {t.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-sm tracking-tight">{t.name}</p>
                            <p className="text-[10px] text-[#667781] font-medium font-mono">{t.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest",
                            t.role === 'admin' ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
                          )}>
                            {t.role}
                          </span>
                          {t.id !== user.id && (
                            <button 
                              onClick={async () => {
                                if(confirm('Delete this user?')) {
                                  await fetch(`/api/admin/users/${t.id}`, { method: 'DELETE' });
                                }
                              }}
                              className="text-[#667781] hover:text-red-500 p-2"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-[#E9EDEF] overflow-hidden flex flex-col h-[400px]">
                  <div className="p-6 border-b border-[#E9EDEF] flex justify-between items-center bg-[#F8F9FA]">
                    <h3 className="font-bold">Internal Announcements</h3>
                    <Users size={18} className="text-[#FFD700]" />
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F0F2F5]">
                    {teamMessages.map((msg, i) => {
                      const sender = teammates.find(t => t.id === msg.senderId) || { name: 'System' };
                      const isMe = msg.senderId === user.id;
                      return (
                        <div key={msg.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                          <span className="text-[9px] font-black text-[#667781] mb-1 px-2 uppercase tracking-tight">{sender.name}</span>
                          <div className={cn(
                            "max-w-[80%] p-3 rounded-2xl text-sm shadow-sm",
                            isMe ? "bg-[#FFF9C4] text-[#111B21] rounded-tr-none" : "bg-white text-[#111B21] rounded-tl-none"
                          )}>
                            {msg.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="p-4 border-t border-[#E9EDEF]">
                    <form 
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const input = (e.target as any).msg;
                        if (input.value.trim()) {
                          sendTeamMessage(input.value);
                          input.value = '';
                        }
                      }}
                    >
                      <input name="msg" placeholder="Post announcement..." className="flex-1 p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm outline-none" />
                      <button className="p-3 bg-[#111B21] text-white rounded-xl"><Send size={18} /></button>
                    </form>
                  </div>
                </div>
              </div>

              <div className="col-span-4 space-y-6">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-[#E9EDEF]">
                  <h3 className="font-bold mb-4">Create New User</h3>
                  <form 
                    className="space-y-4"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.target as HTMLFormElement;
                      const payload = {
                        name: (form.elements.namedItem('name') as HTMLInputElement).value,
                        email: (form.elements.namedItem('email') as HTMLInputElement).value,
                        password: (form.elements.namedItem('password') as HTMLInputElement).value,
                        role: (form.elements.namedItem('role') as HTMLSelectElement).value
                      };
                      const res = await fetch('/api/admin/users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      });
                      if (res.ok) {
                        form.reset();
                        alert('User created successfully');
                      } else {
                        const err = await res.json();
                        alert(err.error);
                      }
                    }}
                  >
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-[#667781]">Full Name</label>
                      <input name="name" required className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-[#667781]">Email</label>
                      <input name="email" type="email" required className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-[#667781]">Initial Password</label>
                      <input name="password" type="password" required className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-[#667781]">Role</label>
                      <select name="role" className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm">
                        <option value="agent">Sales Agent</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </div>
                    <button type="submit" className="w-full py-4 bg-[#FFD700] text-black rounded-2xl font-black text-sm shadow-lg shadow-[#FFD700]/20">
                      Create User
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'automation' && (
            <motion.div 
               key="auto"
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               className="bg-white p-8 rounded-2xl shadow-sm border border-[#E9EDEF] space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">AI Response Engine</h3>
                  <p className="text-sm text-[#667781]">Power your auto-replies with Gemini-3 Flash</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={aiEnabled} 
                    onChange={(e) => setAiEnabled(e.target.checked)} 
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FFD700]" />
                </label>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-semibold text-[#3B4A54]">AI Character / System Prompt</label>
                <textarea 
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full h-32 p-4 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl focus:ring-2 focus:ring-[#FFD700] focus:outline-none transition-all"
                  placeholder="Define how the AI should behave..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-[#F8F9FA] rounded-xl border border-[#E9EDEF]">
                  <h4 className="font-bold text-sm mb-2">Model Information</h4>
                  <ul className="text-xs text-[#667781] space-y-2">
                    <li className="flex justify-between"><span>Provider:</span> <span className="font-medium text-[#3B4A54]">Google AI Studio</span></li>
                    <li className="flex justify-between"><span>Model:</span> <span className="font-medium text-[#3B4A54]">gemini-3-flash-preview</span></li>
                    <li className="flex justify-between"><span>Latency:</span> <span className="font-medium text-[#3B4A54]">Low (~800ms)</span></li>
                  </ul>
                </div>
                <div className="p-4 bg-[#F8F9FA] rounded-xl border border-[#E9EDEF]">
                  <h4 className="font-bold text-sm mb-2">Response Constraints</h4>
                  <p className="text-xs text-[#667781]">AI will only trigger for non-broadcast messages from external users. It will NOT reply to your own messages.</p>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'analytics' && (
            <div className="bg-white rounded-2xl shadow-sm border border-[#E9EDEF] overflow-hidden">
               <div className="p-6 border-b border-[#E9EDEF]">
                <h3 className="font-bold">Live Traffic</h3>
              </div>
              <div className="divide-y divide-[#F8F9FA]">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-[#667781]">
                    <MessageSquare size={48} className="opacity-20 mb-4" />
                    <p>No active logs yet. Start messaging!</p>
                  </div>
                ) : messages.map((m, i) => (
                  <div key={i} className="p-4 hover:bg-[#F8F9FA] transition-colors flex items-start gap-4">
                    <div className="bg-[#E9EDEF] p-2 rounded-lg">
                      <Mail size={16} />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-sm">{m.pushName || m.from}</span>
                        <span className="text-[10px] text-[#667781]">{new Date(m.timestamp * 1000).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm text-[#3B4A54] leading-snug">{m.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'leads' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-[#E9EDEF] shadow-sm">
                <div className="flex gap-2 text-sm font-bold">
                  {(['all', 'meta', 'google', 'website', 'direct'] as const).map(source => (
                    <button
                      key={source}
                      onClick={() => setLeadSourceFilter(source)}
                      className={cn(
                        "px-4 py-2 rounded-xl transition-all",
                        leadSourceFilter === source 
                          ? "bg-[#FFD700] text-black shadow-md shadow-[#FFD700]/20" 
                          : "hover:bg-[#F8F9FA] text-[#667781]"
                      )}
                    >
                      {source.charAt(0).toUpperCase() + source.slice(1)}
                    </button>
                  ))}
                </div>
                <button 
                  onClick={() => {
                    const name = prompt('Enter Lead Name:');
                    const phone = prompt('Enter phone number:');
                    if (name && phone) {
                      socket?.emit('lead:manual', { name, phone });
                    }
                  }}
                  className="px-4 py-2 bg-[#111B21] text-white rounded-xl text-xs font-bold hover:bg-black transition-colors"
                >
                  + Manual Lead
                </button>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-[#E9EDEF] overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F8F9FA] border-b border-[#E9EDEF]">
                    <tr>
                      <th className="px-6 py-4 font-bold text-[#3B4A54]">Lead Details</th>
                      <th className="px-6 py-4 font-bold text-[#3B4A54]">Source</th>
                      <th className="px-6 py-4 font-bold text-[#3B4A54]">Assignment</th>
                      <th className="px-6 py-4 font-bold text-[#3B4A54]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F8F9FA]">
                    {(leadSourceFilter === 'all' ? leads.all : leads[leadSourceFilter]).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-20 text-center text-[#667781]">
                          <Filter className="mx-auto mb-4 opacity-10" size={48} />
                          <p className="font-bold">No leads collected from this source yet</p>
                        </td>
                      </tr>
                    ) : (leadSourceFilter === 'all' ? leads.all : leads[leadSourceFilter]).map(lead => (
                      <tr key={lead.id} className="hover:bg-[#F8F9FA] transition-colors">
    <td className="px-6 py-4">
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shadow-sm",
          lead.source === 'meta' ? "bg-blue-50 text-blue-600" :
          lead.source === 'google' ? "bg-red-50 text-red-600" :
          lead.source === 'website' ? "bg-purple-50 text-purple-600" :
          "bg-green-50 text-green-600"
        )}>
          {(lead.name || lead.data.name || 'A').charAt(0)}
        </div>
        <div>
          <p className="font-bold text-sm text-[#111B21]">{lead.name || lead.data.name || 'Anonymous Lead'}</p>
          <p className="text-[10px] text-[#667781] font-medium font-mono uppercase tracking-tight">
            {lead.phone || lead.data.phone || lead.email || lead.data.email || 'No contact'}
          </p>
        </div>
      </div>
    </td>
    <td className="px-6 py-4">
      <div className="flex flex-col gap-1">
        <span className={cn(
          "px-2 py-0.5 w-fit rounded text-[9px] font-black uppercase tracking-widest",
          lead.source === 'meta' ? "bg-blue-100 text-blue-700" :
          lead.source === 'google' ? "bg-red-100 text-red-700" :
          lead.source === 'website' ? "bg-purple-100 text-purple-700" :
          "bg-green-100 text-green-700"
        )}>
          {lead.source}
        </span>
        <span className="text-[9px] text-[#8696A0] font-medium">
          {new Date(lead.timestamp).toLocaleDateString()} {new Date(lead.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </td>
                        <td className="px-6 py-4">
                          <select 
                            value={lead.assignedTeammateId || ''}
                            onChange={(e) => assignLead(lead.id, e.target.value)}
                            className="bg-[#F8F9FA] border border-[#E9EDEF] rounded p-1 text-[10px] font-medium focus:outline-none"
                          >
                            <option value="">Unassigned</option>
                            {teammates.map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <button 
                            className="text-[#FFD700] hover:underline font-bold text-xs"
                            onClick={() => {
                              if (lead.data.phone) {
                                setActiveChatJid(`${lead.data.phone.replace(/\D/g, '')}@s.whatsapp.net`);
                                setActiveTab('inbox');
                              }
                            }}
                          >
                            Message
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'webhooks' && (
            <div className="space-y-6">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-[#E9EDEF]">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                    <Facebook />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold">Meta Integration (FB/IG)</h3>
                    <p className="text-sm text-[#667781]">Connect your Meta Lead Forms</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <label className="text-[10px] font-black text-gray-400">ADMIN PHONE</label>
                    <input 
                      type="text" 
                      value={forwardingNumber}
                      onChange={(e) => {
                        setForwardingNumber(e.target.value);
                        saveWorkflows(workflows, e.target.value);
                      }}
                      placeholder="e.g. 919876543210"
                      className="p-2 bg-[#F8F9FA] border border-[#E9EDEF] rounded-lg text-xs w-48 font-mono focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-[#F8F9FA] rounded-xl border border-[#E9EDEF]">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-black text-gray-500 uppercase">WEBHOOK URL</span>
                      <span className="text-[10px] text-blue-600 font-bold">Paste in Facebook App / Make.com</span>
                    </div>
                    <p className="text-xs font-mono text-[#667781] break-all select-all">
                      {window.location.origin}/api/webhook/facebook
                    </p>
                  </div>
                  
                  <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-100 flex gap-3 text-xs text-yellow-800">
                    <div className="pt-0.5"><Zap size={14} /></div>
                    <p>
                      <strong>Pro-tip:</strong> If you're seeing "localhost" above, use your <strong>Deployment URL</strong> from AI Studio Settings.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-2xl shadow-sm border border-[#E9EDEF]">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-red-50 text-red-600 rounded-xl">
                    <TrendingUp />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold">Google Ads Webhook</h3>
                    <p className="text-sm text-[#667781]">Sync conversions and leads</p>
                  </div>
                </div>
                
                <div className="p-4 bg-[#F8F9FA] rounded-xl border border-[#E9EDEF]">
                  <p className="text-xs font-mono text-[#667781] break-all">
                    {window.location.origin}/api/webhook/google-ads
                  </p>
                </div>
              </div>

              <div className="bg-white p-8 rounded-2xl shadow-sm border border-[#E9EDEF]">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
                    <Globe />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold">Website Form Integration</h3>
                    <p className="text-sm text-[#667781]">Connect your Elementor/Gravity/WPFrames</p>
                  </div>
                </div>
                
                <div className="p-4 bg-[#F8F9FA] rounded-xl border border-[#E9EDEF]">
                  <p className="text-xs font-mono text-[#667781] break-all">
                    {window.location.origin}/api/webhook/website
                  </p>
                </div>
              </div>

              <div className="bg-[#111B21] p-8 rounded-2xl shadow-2xl text-white">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-[#FFD700] text-black rounded-xl">
                    <Zap />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white">Make.com / Zapier Custom API</h3>
                    <p className="text-sm text-gray-400">Send custom messages from any automation</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-black/40 rounded-xl border border-white/10 uppercase tracking-widest font-black text-[10px]">
                    POST ENDPOINT
                    <p className="text-xs font-mono text-[#FFD700] mt-1 break-all select-all">
                      {window.location.origin}/api/send-message
                    </p>
                  </div>
                  <div className="text-xs space-y-2 text-gray-400 font-medium">
                    <p>JSON Body Payload:</p>
                    <pre className="bg-black/20 p-2 rounded text-[10px] text-gray-300">
                      {`{
  "number": "919876543210",
  "message": "Hello from automation!"
}`}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'workflows' && (
            <div className="grid grid-cols-12 h-[calc(100vh-140px)] border-t border-[#E9EDEF]">
              {/* Left List - Scalable */}
              <div className="col-span-2 bg-white border-r border-[#E9EDEF] flex flex-col overflow-hidden">
                <div className="p-4 border-b border-[#E9EDEF] bg-[#F8F9FA] flex justify-between items-center">
                  <span className="font-bold text-[10px] uppercase text-[#667781] tracking-widest">Automation List</span>
                  <button 
                    onClick={addWorkflow}
                    className="p-1.5 bg-[#FFD700] text-black rounded-lg hover:rotate-90 transition-transform"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-[#F8F9FA] scrollbar-hide">
                  {workflows.map(w => (
                    <button 
                      key={w.id}
                      onClick={() => setActiveWorkflowId(w.id)}
                      className={cn(
                        "w-full p-4 text-left transition-all border-l-4 group relative",
                        activeWorkflowId === w.id ? "bg-[#FFF9C4]/50 border-[#FFD700]" : "hover:bg-[#F8F9FA] border-transparent"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={cn("w-2 h-2 rounded-full", w.enabled ? "bg-[#FFD700]" : "bg-gray-300")} />
                        <p className="font-bold text-sm text-[#111B21] truncate pr-4">{w.name}</p>
                      </div>
                      <p className="text-[10px] text-[#667781] flex items-center gap-1 font-medium">
                        <Zap size={10} className="text-yellow-500" /> "{w.keyword}"
                      </p>
                    </button>
                  ))}
                  {workflows.length === 0 && (
                    <div className="p-8 text-center text-[#667781]">
                      <GitBranch size={40} className="mx-auto opacity-10 mb-4" />
                      <p className="text-xs">No active workflows</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Visual Editor Area */}
              <div className="col-span-10 bg-[#F8FAFC] overflow-hidden relative">
                <div className="grid grid-cols-10 h-full">
                  <div className="col-span-7 h-full relative overflow-hidden">
                    {activeWorkflowId ? (
                      <div className="h-full overflow-y-auto p-12 scrollbar-hide">
                        <div className="max-w-4xl mx-auto space-y-12 relative pb-24 flex flex-col items-center">
                          {/* Workflow Header/Title */}
                          <div className="w-full flex justify-between items-center bg-white p-4 rounded-2xl shadow-md border border-[#E9EDEF] mb-8">
                            <input 
                              className="text-lg font-bold bg-transparent border-none focus:outline-none w-2/3"
                              value={workflows.find(w => w.id === activeWorkflowId)?.name || ''}
                              onChange={(e) => {
                                const w = workflows.find(w => w.id === activeWorkflowId);
                                if (w) updateWorkflow({ ...w, name: e.target.value });
                              }}
                            />
                            <div className="flex gap-2">
                              <button 
                                onClick={() => deleteWorkflow(activeWorkflowId)}
                                className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </div>

                          {/* Trigger Node */}
                          <div className="relative w-full flex justify-center">
                            <div className="bg-white p-6 rounded-2xl shadow-xl border-t-4 border-[#FFD700] w-full max-w-sm relative z-10 transition-transform hover:scale-[1.02]">
                          <div className="flex items-center justify-between mb-4">
                            <span className="bg-[#FFF9C4] text-[#A89200] px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-2">
                              <Zap size={10} /> Trigger: Keyword
                            </span>
                          </div>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-[10px] uppercase font-bold text-[#667781]">Listen for Keyword</label>
                              <input 
                                className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm focus:ring-2 focus:ring-[#FFD700] focus:outline-none transition-all font-bold"
                                value={workflows.find(w => w.id === activeWorkflowId)?.keyword || ''}
                                onChange={(e) => {
                                  const w = workflows.find(w => w.id === activeWorkflowId);
                                  if (w) updateWorkflow({ ...w, keyword: e.target.value });
                                }}
                                placeholder="e.g. hello, order, quote"
                              />
                            </div>
                          </div>
                          {/* Connector Line */}
                          <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-0.5 h-12 bg-gray-300">
                             <div className="absolute bottom-0 -left-[3px] w-2 h-2 rounded-full bg-gray-300" />
                          </div>
                        </div>
                      </div>

                      {/* Filter/Smart Logic Node Placeholder */}
                      <div className="bg-[#FFF9C4] px-4 py-2 rounded-full w-fit mx-auto text-[10px] font-bold text-[#FFD700] border border-[#FFD700]/20 shadow-sm relative z-10">
                        IF KEYWORD MATCHES
                        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-0.5 h-8 bg-gray-300" />
                      </div>

                      {/* Action Steps */}
                      <div className="space-y-12 w-full flex flex-col items-center">
                        {workflows.find(w => w.id === activeWorkflowId)?.actions.map((action, idx) => (
                          <div key={action.id} className="relative group w-full flex justify-center">
                            <motion.div 
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="bg-white p-6 rounded-2xl shadow-xl border-t-4 border-[#FFD700] w-full max-w-sm relative z-10 transition-all hover:shadow-2xl"
                            >
                              <div className="flex items-center justify-between mb-4">
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-2",
                                  action.type === 'text' ? "bg-emerald-50 text-emerald-700" : 
                                  action.type === 'image' ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                                )}>
                                  {action.type === 'text' ? <Mail size={10}/> : 
                                   action.type === 'image' ? <ImageIcon size={10}/> : <Database size={10}/>} Step {idx + 1}: {action.type.toUpperCase()}
                                </span>
                                <select 
                                  value={action.type}
                                  onChange={(e) => {
                                    const w = workflows.find(w => w.id === activeWorkflowId);
                                    if (w) {
                                      const actions = [...w.actions];
                                      actions[idx] = { ...action, type: e.target.value as any };
                                      updateWorkflow({ ...w, actions });
                                    }
                                  }}
                                  className="text-[10px] font-bold border-none bg-[#F8F9FA] rounded px-2"
                                >
                                  <option value="text">TEXT</option>
                                  <option value="image">IMAGE</option>
                                  <option value="form">FORM</option>
                                </select>
                              </div>

                              {action.type === 'text' ? (
                                <textarea 
                                  className="w-full p-4 bg-[#F8F9FA] rounded-xl border border-transparent focus:border-[#FFC600] focus:outline-none text-sm min-h-[100px] transition-all"
                                  value={action.content || ''}
                                  onChange={(e) => {
                                    const w = workflows.find(w => w.id === activeWorkflowId);
                                    if (w) {
                                      const actions = [...w.actions];
                                      actions[idx] = { ...action, content: e.target.value };
                                      updateWorkflow({ ...w, actions });
                                    }
                                  }}
                                  placeholder="Type response..."
                                />
                              ) : action.type === 'image' ? (
                                <div className="space-y-3">
                                  <input 
                                    className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm"
                                    placeholder="Image URL (Direct link)..."
                                    value={action.content || ''}
                                    onChange={(e) => {
                                      const w = workflows.find(w => w.id === activeWorkflowId);
                                      if (w) {
                                        const actions = [...w.actions];
                                        actions[idx] = { ...action, content: e.target.value };
                                        updateWorkflow({ ...w, actions });
                                      }
                                    }}
                                  />
                                  <input 
                                    className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-xs"
                                    placeholder="Caption text..."
                                    value={action.caption || ''}
                                    onChange={(e) => {
                                      const w = workflows.find(w => w.id === activeWorkflowId);
                                      if (w) {
                                        const actions = [...w.actions];
                                        actions[idx] = { ...action, caption: e.target.value };
                                        updateWorkflow({ ...w, actions });
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  <div className="p-3 bg-purple-50 border border-purple-100 rounded-xl">
                                    <p className="text-[10px] items-center gap-1 flex font-bold text-purple-700 mb-2">
                                      <Globe size={10} /> PUBLIC FORM LINK
                                    </p>
                                    <code className="text-[10px] break-all bg-white p-1 rounded border border-purple-200 block">
                                      {window.location.origin}/f/{action.id}
                                    </code>
                                  </div>
                                  <input 
                                    className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm font-bold"
                                    placeholder="Form Title"
                                    value={action.formConfig?.title || ''}
                                    onChange={(e) => {
                                      const w = workflows.find(w => w.id === activeWorkflowId);
                                      if (w && action.formConfig) {
                                        const actions = [...w.actions];
                                        actions[idx] = { ...action, formConfig: { ...action.formConfig, title: e.target.value } };
                                        updateWorkflow({ ...w, actions });
                                      }
                                    }}
                                  />
                                  <p className="text-[10px] text-[#667781] italic px-1">Fields: Name, Company, Email, Packaging, Quantity (Configured automatically)</p>
                                </div>
                              )}

                              <button 
                                onClick={() => {
                                  const w = workflows.find(w => w.id === activeWorkflowId);
                                  if (w) {
                                    const actions = w.actions.filter((_, i) => i !== idx);
                                    updateWorkflow({ ...w, actions });
                                  }
                                }}
                                className="absolute -right-12 top-1/2 -translate-y-1/2 text-red-400 hover:text-red-600 transition-colors bg-white p-2 rounded-full border border-red-100 shadow-sm opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={16} />
                              </button>
                            </motion.div>
                            {/* Connectors */}
                            {idx < (workflows.find(w => w.id === activeWorkflowId)?.actions.length || 0) - 1 && (
                              <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-0.5 h-12 bg-gray-300">
                                <div className="absolute bottom-0 -left-[3px] w-2 h-2 rounded-full bg-gray-300" />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Add Action Buttons */}
                      <div className="flex justify-center gap-4 relative z-20">
                        <button 
                          onClick={() => {
                            const w = workflows.find(w => w.id === activeWorkflowId);
                            if (w) {
                              const actions = [...w.actions, { id: Math.random().toString(), type: 'text', content: '' }];
                              updateWorkflow({ ...w, actions });
                            }
                          }}
                          className="px-6 py-3 bg-white border-2 border-[#FFD700] text-[#FFD700] rounded-2xl text-xs font-black shadow-lg hover:bg-[#FFD700] hover:text-black transition-all flex items-center gap-2 group"
                        >
                          <Plus size={14} className="group-hover:rotate-90 transition-transform" /> ADD TEXT
                        </button>
                        <button 
                          onClick={() => {
                            const w = workflows.find(w => w.id === activeWorkflowId);
                            if (w) {
                              const actions = [...w.actions, { id: Math.random().toString(), type: 'image', content: '', caption: '' }];
                              updateWorkflow({ ...w, actions });
                            }
                          }}
                          className="px-6 py-3 bg-white border-2 border-blue-500 text-blue-500 rounded-2xl text-xs font-black shadow-lg hover:bg-blue-500 hover:text-white transition-all flex items-center gap-2 group"
                        >
                          <ImageIcon size={14} className="group-hover:scale-110 transition-transform" /> ADD IMAGE
                        </button>
                        <button 
                          onClick={() => {
                            const w = workflows.find(w => w.id === activeWorkflowId);
                            if (w) {
                              const actions = [...w.actions, { 
                                id: Math.random().toString(), 
                                type: 'form', 
                                content: 'Solar Lead Form',
                                formConfig: {
                                  title: 'Inquiry Form',
                                  description: 'Please fill the details below to proceed.',
                                  fields: [
                                    { id: '1', label: 'Your Name *', placeholder: 'Your full name', required: true, type: 'text' },
                                    { id: '2', label: 'Company Name *', placeholder: 'Your company name', required: true, type: 'text' },
                                    { id: '3', label: 'Official Email *', placeholder: 'email@company.com', required: true, type: 'email' },
                                    { id: '4', label: 'Packaging Type Needed *', placeholder: 'Select packaging type...', required: true, type: 'text' },
                                    { id: '5', label: 'Approximate Quantity', placeholder: 'e.g. 1000 units', required: false, type: 'text' }
                                  ]
                                }
                              }];
                              updateWorkflow({ ...w, actions });
                            }
                          }}
                          className="px-6 py-3 bg-white border-2 border-purple-500 text-purple-500 rounded-2xl text-xs font-black shadow-lg hover:bg-purple-500 hover:text-white transition-all flex items-center gap-2 group"
                        >
                          <Database size={14} className="group-hover:scale-110 transition-transform" /> ADD FORM
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-[#667781] p-12 text-center">
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-xl mb-6">
                      <GitBranch size={40} className="text-[#FFD700] opacity-30" />
                    </div>
                    <h3 className="text-xl font-black text-[#111B21]">Solar Automation AI Studio</h3>
                    <p className="text-sm opacity-60 mb-8 max-w-xs">Create smart response trees that trigger automatically when customers message specific keywords.</p>
                    <button 
                      onClick={addWorkflow}
                      className="px-8 py-4 bg-[#FFD700] text-black rounded-2xl font-black text-sm shadow-xl shadow-[#FFD700]/30 hover:-translate-y-1 transition-all"
                    >
                      NEW AUTOMATION
                    </button>
                  </div>
                )}
                {/* Background Grid Pattern */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
                  style={{ backgroundImage: 'radial-gradient(#111B21 1px, transparent 1px)', backgroundSize: '16px 16px' }} 
                />
              </div>

              {/* Simulation Side Panel */}
              <div className="col-span-3 bg-white rounded-2xl shadow-sm border border-[#E9EDEF] flex flex-col overflow-hidden">
                <div className="p-4 border-b border-[#E9EDEF] bg-[#F8F9FA] flex items-center gap-2">
                  <Play size={14} className="text-[#FFD700]" />
                  <span className="font-bold text-[10px] uppercase text-[#667781] tracking-widest">Studio Simulator</span>
                </div>
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black text-[#667781]">Input Keyword</label>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        value={simMessage}
                        onChange={(e) => setSimMessage(e.target.value)}
                        placeholder="Type a trigger..."
                        className="flex-1 p-2 bg-[#F8F9FA] border border-[#E9EDEF] rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#FFD700]"
                      />
                      <button 
                        onClick={runSimulation}
                        className="p-2 bg-[#FFD700] text-black rounded-lg hover:bg-[#FFC600]"
                      >
                        <Zap size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4">
                    <p className="text-[10px] uppercase font-black text-[#667781]">Execution Path</p>
                    {simResults === null ? (
                      <div className="py-8 text-center border-2 border-dashed border-[#F8F9FA] rounded-xl">
                        <p className="text-[10px] text-[#667781]">Enter a keyword to see results</p>
                      </div>
                    ) : simResults.length > 0 ? (
                      <div className="space-y-3 overflow-y-auto max-h-[350px] pr-2">
                        {simResults.map((action, i) => (
                          <div key={action.id} className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl relative">
                            <span className="text-[10px] font-bold text-emerald-600 mb-1 block">STEP {i+1}: {action.type.toUpperCase()}</span>
                            <p className="text-xs text-emerald-900 line-clamp-2">
                              {action.type === 'form' ? `📋 ${action.formConfig?.title || 'Form'}` : 
                               action.type === 'image' ? `🖼 ${action.caption || 'Image Content'}` : 
                               action.content}
                            </p>
                          </div>
                        ))}
                        <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl text-center">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">End of Logic Flow</p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 bg-red-50 border border-red-100 rounded-2xl text-center">
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                          <Zap size={20} className="text-red-400" />
                        </div>
                        <p className="text-sm text-red-600 font-black uppercase">No Match Found</p>
                        <p className="text-[10px] text-red-500">This keyword hasn't been configured yet.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'broadcast' && (
            <motion.div 
              key="broadcast"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-8 rounded-2xl shadow-sm border border-[#E9EDEF] space-y-8"
            >
              <div>
                <h3 className="text-lg font-bold">Bulk Messaging</h3>
                <p className="text-sm text-[#667781]">Send personalized messages with rate limiting</p>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-semibold text-[#3B4A54]">Contact Numbers</label>
                <textarea 
                  value={broadcastNumbers}
                  onChange={(e) => setBroadcastNumbers(e.target.value)}
                  className="w-full h-32 p-4 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl focus:ring-2 focus:ring-[#FFD700] focus:outline-none transition-all font-mono text-sm"
                  placeholder="Paste numbers here (one per line or comma-separated)"
                />
                <p className="text-[11px] text-[#667781]">Total detected: {broadcastNumbers.split(/[\n,]/).filter(n => n.trim()).length}</p>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-semibold text-[#3B4A54]">Message Template</label>
                <textarea 
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="w-full h-32 p-4 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl focus:ring-2 focus:ring-[#FFD700] focus:outline-none transition-all"
                  placeholder="Type your campaign message..."
                />
              </div>

              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
                <Activity size={20} className="text-amber-600 shrink-0" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  <strong>Account Safety:</strong> We will automatically add a randomized 2-5 second delay between every message to mimic human behavior and protect your account status.
                </p>
              </div>

              <button 
                onClick={handleBroadcast}
                disabled={isBroadcasting || status !== 'connected'}
                className="w-full py-4 bg-[#FFD700] text-black rounded-xl font-bold hover:bg-[#FFC600] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isBroadcasting ? 'Broadcasting started...' : <><Send size={18} /> Start Campaign</>}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function PublicFormView({ id }: { id: string }) {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/webhook/website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      setSubmitted(true);
      // Wait a bit before redirecting to WA
      setTimeout(() => {
        window.location.href = `https://wa.me/?text=Hello! I just filled out the form for ${formData['Packaging Type Needed *'] || 'Packaging'}. Here are my details: Name: ${formData['Your Name *']}, Company: ${formData['Company Name *']}`;
      }, 1500);
    } catch (e) {
       console.error(e);
       alert('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-[#E9EDEF]"
      >
        {!submitted ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl border border-[#E9EDEF] overflow-hidden p-1">
                <img src={LOGO_URL} alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              </div>
              <h1 className="text-2xl font-black text-[#111B21]">Solar Lead Form</h1>
              <p className="text-sm text-[#667781]">Quick inquiry submission</p>
            </div>

            <div className="space-y-4">
              <FormInput label="Your Name *" placeholder="Your full name" required onChange={(v) => setFormData(p => ({ ...p, 'Your Name *': v }))} />
              <FormInput label="Company Name *" placeholder="Your company name" required onChange={(v) => setFormData(p => ({ ...p, 'Company Name *': v }))} />
              <FormInput label="Official Email *" placeholder="email@company.com" type="email" required onChange={(v) => setFormData(p => ({ ...p, 'Official Email *': v }))} />
              <FormInput label="Packaging Type Needed *" placeholder="Select packaging type..." required onChange={(v) => setFormData(p => ({ ...p, 'Packaging Type Needed *': v }))} />
              <FormInput label="Approximate Quantity" placeholder="e.g. 1000 units" onChange={(v) => setFormData(p => ({ ...p, 'Approximate Quantity': v }))} />
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-[#FFD700] text-black rounded-2xl font-black text-sm shadow-xl shadow-[#FFD700]/30 hover:-translate-y-1 transition-all disabled:opacity-50"
            >
              {loading ? 'Submitting...' : 'COMPLETE & CHAT ON WHATSAPP'}
            </button>
          </form>
        ) : (
          <div className="text-center py-12">
            <CheckCircle2 size={64} className="text-[#FFD700] mx-auto mb-4" />
            <h2 className="text-2xl font-black mb-2">Form Submitted!</h2>
            <p className="text-[#667781]">Redirecting you to WhatsApp...</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function FormInput({ label, placeholder, type = 'text', required = false, onChange }: { label: string, placeholder: string, type?: string, required?: boolean, onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase font-black text-[#667781] tracking-wider">{label}</label>
      <input 
        type={type}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 bg-[#F8F9FA] border border-[#E9EDEF] rounded-xl text-sm focus:ring-2 focus:ring-[#FFD700] focus:outline-none transition-all"
      />
    </div>
  );
}

function SidebarLink({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm",
        active 
          ? "bg-[#FFF9C4] text-[#A89200]" 
          : "text-[#54656F] hover:bg-[#F0F2F5]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function StatusCard({ title, value, icon, desc }: { title: string, value: string, icon: React.ReactNode, desc: string }) {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E9EDEF] flex items-center gap-4">
      <div className="p-3 bg-gray-50 rounded-xl">
        {icon}
      </div>
      <div>
        <p className="text-xs text-[#667781] uppercase font-bold tracking-wider">{title}</p>
        <p className="text-lg font-bold text-[#111B21]">{value}</p>
        <p className="text-[11px] text-[#667781]">{desc}</p>
      </div>
    </div>
  );
}
