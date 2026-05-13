import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Search, 
  RefreshCw, 
  Database, 
  ExternalLink, 
  Mail, 
  TrendingUp, 
  Users, 
  MapPin,
  ChevronRight,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Lead {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
  country: string;
  followers: number;
  sales: number;
  revenue: number;
  category: string;
  email?: string;
  engagement?: number;
}

const COUNTRIES = [
  { code: 'ES', name: 'España' },
  { code: 'GB', name: 'Reino Unido' },
  { code: 'NL', name: 'Países Bajos' },
];

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [region, setRegion] = useState('ES');
  const [type, setType] = useState('shop');
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<{ 
    echotik: boolean; 
    googleSheets: boolean; 
    serviceAccountEmail: string | null;
    missingSecrets: string[];
    requests: number;
    maxRequests: number;
  }>({
    echotik: false,
    googleSheets: false,
    serviceAccountEmail: null,
    missingSecrets: [],
    requests: 0,
    maxRequests: 100
  });

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/api/config-status');
      setConfig(response.data);
    } catch (err) {
      console.error("Error checking config status", err);
    }
  };

  const fetchLeads = async () => {
    if (config.requests >= config.maxRequests) {
      setError("Monthly limit reached (100/100). Please upgrade or contact support.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`/api/leads?region=${region}&type=${type}`);
      if (response.data?.error) {
         setError(response.data.error);
         return;
      }
      // Refresh config for usage count
      fetchConfig();
      const data = response.data.data?.list || response.data.list || [];
      const formatted = data.map((item: any) => ({
        id: (item.id || item.creator_id || Math.random().toString().substring(2, 8)).toString(),
        name: item.nickname || item.name || item.shop_name || 'N/A',
        handle: item.unique_id || item.handle || item.shop_id || 'N/A',
        avatar: item.avatar || item.logo || item.shop_logo,
        country: item.region || item.country || region,
        followers: item.follower_count || item.fans || item.follower_num || 0,
        sales: item.monthly_sales || item.total_sales || item.sales_num || 0,
        revenue: item.monthly_revenue || item.total_revenue || item.gmv || 0,
        category: item.category || item.main_category || 'N/A',
        email: item.email || item.contact_email,
        engagement: item.engagement_rate
      }));
      setLeads(formatted);
    } catch (err: any) {
      const respData = err.response?.data;
      const detail = respData?.detail;
      let msg = respData?.error || respData?.msg || err.message || 'Unknown error occurred';
      
      if (detail && typeof detail === 'object') {
        msg += `\n\nDetail: ${JSON.stringify(detail.data || detail.message)}`;
      }
      
      setError(typeof msg === 'object' ? JSON.stringify(msg) : String(msg));
    } finally {
      setLoading(false);
    }
  };

  const syncLeads = async () => {
    if (leads.length === 0) return;
    setSyncing(true);
    setError(null);
    try {
      await axios.post('/api/sync', { leads });
      alert("¡Sincronización con Google Sheets completada!");
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Sync failed';
      const errorStr = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
      setError(errorStr);
      alert("Error al sincronizar: " + errorStr);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchLeads();
  }, [region, type]);

  return (
    <div className="h-screen bg-[#E4E3E0] text-[#141414] flex flex-col font-sans border-[12px] border-[#141414] overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-[#141414] bg-white">
        <div className="flex items-center gap-8">
          <h1 className="text-2xl font-black tracking-tighter uppercase">
            ECHOTIK PROSPECT <span className="font-normal opacity-40">v2.4</span>
          </h1>
          <div className="flex gap-6">
            <div className="flex items-center gap-2 group relative">
              <span className={`w-2 h-2 rounded-full ${error ? 'bg-red-500' : 'bg-green-600 animate-pulse'}`}></span>
              <span className="text-[10px] font-bold uppercase tracking-widest">{error ? 'API Offline' : 'API Connected'}</span>
              {error && (
                <div className="hidden group-hover:block absolute top-full left-0 mt-2 p-2 bg-[#141414] text-white text-[8px] font-mono whitespace-pre max-w-[400px] z-50 border border-white/20">
                  {error}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Region: {region}</span>
              <div className="h-4 w-[1px] bg-[#141414]/10 mx-2"></div>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${config.requests > 90 ? 'text-red-500' : 'opacity-40'}`}>
                USAGE: {config.requests}/{config.maxRequests}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
          {!config.googleSheets && (
            <div className={`px-4 py-2 border border-dashed border-[#141414] text-[9px] font-bold uppercase flex flex-col justify-center leading-tight max-w-[200px]`}>
              <span className="text-red-500">Sheets Config Missing</span>
              <span className="opacity-40 text-[7px] truncate">{config.serviceAccountEmail || 'No Service Account Email'}</span>
            </div>
          )}
          <button 
            onClick={fetchLeads}
            disabled={loading}
            className="px-4 py-2 border border-[#141414] text-[11px] font-bold uppercase hover:bg-[#141414] hover:text-white transition-all disabled:opacity-30"
          >
            {loading ? 'Fetching...' : 'Refresh API'}
          </button>
          
          <button 
            onClick={syncLeads}
            disabled={syncing || leads.length === 0}
            className="px-4 py-2 bg-[#141414] text-white text-[11px] font-bold uppercase hover:bg-black transition-all disabled:opacity-30"
          >
            {syncing ? 'Pushing...' : 'Push to Sheets'}
          </button>
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar */}
        <aside className="w-72 border-r border-[#141414] p-6 flex flex-col gap-8 bg-[#F4F3F0]">
          <div>
            <p className="font-serif italic text-xs mb-4 opacity-50 uppercase tracking-widest border-b border-[#141414]/10 pb-2">Active Markets</p>
            <div className="flex flex-col gap-1">
              {COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => setRegion(c.code)}
                  className={`flex justify-between items-center py-2 px-3 border border-[#141414] transition-all
                    ${region === c.code ? 'bg-[#141414] text-white' : 'hover:bg-[#E4E3E0] text-[#141414]'}`}
                >
                  <span className="text-[11px] font-bold uppercase">{c.name}</span>
                  <span className="font-mono text-[10px]">{c.code}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="font-serif italic text-xs mb-4 opacity-50 uppercase tracking-widest border-b border-[#141414]/10 pb-2">Prospect Type</p>
            <div className="grid grid-cols-2 border border-[#141414]">
              <button
                onClick={() => setType('shop')}
                className={`py-2 text-[10px] font-bold uppercase border-r border-[#141414]
                  ${type === 'shop' ? 'bg-[#141414] text-white' : 'bg-white hover:bg-[#E4E3E0]'}`}
              >
                Shops
              </button>
              <button
                onClick={() => setType('creator')}
                className={`py-2 text-[10px] font-bold uppercase
                  ${type === 'creator' ? 'bg-[#141414] text-white' : 'bg-white hover:bg-[#E4E3E0]'}`}
              >
                Creators
              </button>
            </div>
          </div>

          {!config.googleSheets && (
            <div className="p-4 border border-[#141414] bg-white space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">Setup Required</p>
              <p className="text-[9px] leading-relaxed opacity-70">
                Para sincronizar con Sheets, debes:<br/>
                1. Crear un Service Account en Google Cloud.<br/>
                2. Compartir tu Sheet con el email de abajo.<br/>
                3. Configurar en Secrets:<br/>
                {config.missingSecrets.length > 0 ? (
                  <span className="text-red-500 font-bold block mt-1">
                    MISSING: {config.missingSecrets.join(', ')}
                  </span>
                ) : (
                  <span className="text-green-600 font-bold block mt-1">✓ CONFIGURADO</span>
                )}
              </p>
              <div className="p-2 bg-[#E4E3E0] border border-[#141414] text-[8px] font-mono break-all font-bold">
                {config.serviceAccountEmail || 'PENDING_EMAIL_CONFIG'}
              </div>
            </div>
          )}

          <div className="mt-auto p-4 bg-[#141414] text-[#E4E3E0] rounded-sm">
            <p className="text-[9px] uppercase tracking-[0.2em] mb-2 font-bold flex items-center gap-2">
              <Database className="w-3 h-3" />
              Automation Terminal
            </p>
            <div className="font-mono text-[9px] opacity-70 leading-relaxed uppercase">
              {loading ? (
                <>
                  <div className="animate-pulse text-green-400">{">"} GET /API/SEARCH/{type}</div>
                  <div className="animate-pulse text-green-400 delay-75">{">"} AUTH_TOKEN: SUCCESS</div>
                  <div className="animate-pulse text-green-400 delay-150">{">"} FETCHING DATA...</div>
                </>
              ) : (
                <>
                  <div>{">"} SESSION ID: {Math.random().toString(36).substring(7)}</div>
                  <div>{">"} QUOTA USED: {config.requests}/{config.maxRequests}</div>
                  <div className={config.requests >= config.maxRequests ? 'text-red-500' : 'text-green-500'}>
                    {">"} USAGE: {Math.round((config.requests / config.maxRequests) * 100)}%
                  </div>
                  <div>{">"} LEADS_BUFFER: {leads.length}</div>
                  <div className="mt-2 text-green-500">{">"} IDLE / WAITING INPUT</div>
                </>
              )}
            </div>
          </div>
        </aside>

        {/* Data Grid Body */}
        <main className="flex-1 flex flex-col bg-white overflow-hidden">
          {/* Header Row */}
          <div className="grid grid-cols-[60px_1fr_80px_120px_140px_140px_180px] border-b border-[#141414] bg-[#141414]/5">
            <div className="font-serif italic text-[11px] opacity-60 uppercase py-3 px-4 border-r border-[#141414]">ID</div>
            <div className="font-serif italic text-[11px] opacity-60 uppercase py-3 px-4 border-r border-[#141414]">Shop / Creator</div>
            <div className="font-serif italic text-[11px] opacity-60 uppercase py-3 px-4 border-r border-[#141414] text-center">Market</div>
            <div className="font-serif italic text-[11px] opacity-60 uppercase py-3 px-4 border-r border-[#141414] text-right">Followers</div>
            <div className="font-serif italic text-[11px] opacity-60 uppercase py-3 px-4 border-r border-[#141414] text-right">Est. Revenue</div>
            <div className="font-serif italic text-[11px] opacity-60 uppercase py-3 px-4 border-r border-[#141414]">Top Category</div>
            <div className="font-serif italic text-[11px] opacity-60 uppercase py-3 px-4">Direct Contact</div>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence>
              {leads.map((lead, idx) => (
                <motion.div 
                  key={lead.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="grid grid-cols-[60px_1fr_80px_120px_140px_140px_180px] border-b border-[#141414] technical-row group transition-colors cursor-default"
                >
                  <div className="py-3 px-4 border-r border-[#141414] font-mono text-[11px] opacity-50 flex items-center">#{lead.id.substring(0, 3)}</div>
                  <div className="py-3 px-4 border-r border-[#141414] flex items-center gap-3">
                    <div className="text-xs font-black uppercase tracking-tight truncate">
                      {lead.name}
                      <span className="block font-mono text-[9px] opacity-40 lowercase font-normal">@{lead.handle}</span>
                    </div>
                    <a 
                      href={`https://www.tiktok.com/@${lead.handle}`} 
                      target="_blank" 
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="py-3 px-4 border-r border-[#141414] flex items-center justify-center">
                    <span className="text-[9px] font-bold border border-[#141414] px-1.5 py-0.5 leading-none transition-colors">{lead.country}</span>
                  </div>
                  <div className="py-3 px-4 border-r border-[#141414] flex items-center justify-end font-mono text-xs">
                    {(lead.followers / 1000).toFixed(1)}K
                  </div>
                  <div className="py-3 px-4 border-r border-[#141414] flex items-center justify-end font-mono text-xs font-bold">
                    {region === 'GB' ? '£' : '€'}{lead.revenue.toLocaleString()}
                  </div>
                  <div className="py-3 px-4 border-r border-[#141414] flex items-center text-[10px] uppercase font-medium truncate">
                    {lead.category || 'NO_CAT'}
                  </div>
                  <div className="py-3 px-4 flex items-center gap-3">
                    {lead.email ? (
                      <div className="flex items-center gap-2 text-[10px] font-mono truncate">
                        <Mail className="w-3 h-3 opacity-40" />
                        {lead.email}
                      </div>
                    ) : (
                      <span className="text-[10px] font-mono opacity-20">NULL_DATA</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {leads.length === 0 && !loading && (
              <div className="py-32 flex flex-col items-center justify-center gap-4 opacity-20">
                <Search className="w-16 h-16 stroke-1" />
                <p className="text-lg font-black uppercase tracking-[0.3em]">No Buffer Data</p>
                <code className="text-[11px]">{">"} WAITING FOR API TRIGGER</code>
              </div>
            )}
          </div>

          {/* Footer Status Bar */}
          <footer className="h-10 border-t border-[#141414] bg-[#141414] text-[#E4E3E0] flex items-center px-6 justify-between text-[10px] font-mono uppercase tracking-widest">
            <div className="flex gap-8">
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                System: Localized
              </span>
              <span>Buffer: {leads.length} Entities</span>
              <span className="opacity-40">Auth: Bearer_Verified</span>
            </div>
            <div className="flex items-center gap-4">
              <span>{new Date().toLocaleTimeString()}</span>
              <div className="flex border border-[#E4E3E0]/20 h-6">
                <button className="px-3 border-r border-[#E4E3E0]/20 hover:bg-[#E4E3E0]/10">{"<"}</button>
                <button className="px-3 hover:bg-[#E4E3E0]/10">{">"}</button>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
