import React, { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { Header } from './components/Header';
import { Sidebar, AppTab } from './components/Sidebar';
import { ExtensionDownloader } from './components/ExtensionDownloader';
import { CodeExplorer } from './components/CodeExplorer';
import { ParserSandbox } from './components/ParserSandbox';
import { PanelSimulator } from './components/PanelSimulator';
import { TestingGuide } from './components/TestingGuide';
import { RealtimeStreamDashboard } from './components/RealtimeStreamDashboard';
import { ConfigurationPanelModal } from './components/ConfigurationPanelModal';
import { DashboardPanel } from './components/DashboardPanel';
import { LandingPage } from './components/LandingPage';
import { AuthPage } from './components/AuthPage';
import { AccountPanel } from './components/AccountPanel';
import { AuthProvider, useAuth } from './context/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <AppCore />
    </AuthProvider>
  );
}

function AppCore() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [isZipping, setIsZipping] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const { user, devMode, loading } = useAuth();
  const [view, setView] = useState<'landing' | 'auth' | 'app'>('landing');
  const [devEntered, setDevEntered] = useState(false);

  const authed = !!user || (devMode && devEntered);

  // Landing → Auth → App flow (dashboard is the default tab once inside)
  const handleNavigate = (tab: AppTab) => {
    if (!authed) {
      setView('auth');
      return;
    }
    setActiveTab(tab);
    setView('app');
  };

  const handleLandingCta = () => {
    if (authed) {
      setActiveTab('dashboard');
      setView('app');
    } else {
      setView('auth');
    }
  };

  useEffect(() => {
    if (view === 'app' && !authed && !loading) setView('auth');
    if (view === 'app' && authed && !['dashboard', 'instagram', 'tiktok', 'facebook', 'setup'].includes(activeTab)) setActiveTab('dashboard');
  }, [authed, loading, view, activeTab]);

  // Dynamic 1-Click Chrome Extension ZIP Packager
  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      const zip = new JSZip();

      // List of extension files to bundle
      const fileList = [
        { path: 'manifest.json', url: '/extension/manifest.json' },
        { path: 'main-instagram.js', url: '/extension/main-instagram.js' },
        { path: 'instagram-content.js', url: '/extension/instagram-content.js' },
        { path: 'tiktok-content.js', url: '/extension/tiktok-content.js' },
        { path: 'facebook-content.js', url: '/extension/facebook-content.js' },
        { path: 'background.js', url: '/extension/background.js' },
        { path: 'app-bridge.js', url: '/extension/app-bridge.js' },
        { path: 'panel.css', url: '/extension/panel.css' },
        { path: 'popup.html', url: '/extension/popup.html' },
        { path: 'popup.js', url: '/extension/popup.js' },
        { path: 'options.html', url: '/extension/options.html' },
        { path: 'options.js', url: '/extension/options.js' },
        { path: 'utils/normalization.js', url: '/extension/utils/normalization.js' },
        { path: 'utils/media-ranking.js', url: '/extension/utils/media-ranking.js' },
        { path: 'utils/deduplication.js', url: '/extension/utils/deduplication.js' },
        { path: 'utils/filename.js', url: '/extension/utils/filename.js' },
        { path: 'utils/export.js', url: '/extension/utils/export.js' },
        { path: 'utils/jszip.min.js', url: '/extension/utils/jszip.min.js' }
      ];

      for (const f of fileList) {
        try {
          const res = await fetch(f.url);
          if (res.ok) {
            const text = await res.text();
            zip.file(f.path, text);
          }
        } catch (err) {
          console.warn(`Could not fetch ${f.url} for zip bundling`, err);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = 'social-media-scraper-extension-mv3.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (err) {
      console.error('Failed to generate extension zip:', err);
      alert('Error generating extension ZIP package.');
    } finally {
      setIsZipping(false);
    }
  };

  const handlePlatformChange = (platform: 'instagram' | 'tiktok' | 'facebook') => {
    setActiveTab(platform);
  };

  return (
    <AppInner
      activeTab={activeTab}
      setActiveTab={handleNavigate}
      view={view}
      authed={authed}
      devMode={devMode}
      isZipping={isZipping}
      isConfigOpen={isConfigOpen}
      setIsConfigOpen={setIsConfigOpen}
      handleDownloadZip={handleDownloadZip}
      handleLandingCta={handleLandingCta}
      onDevEnter={() => setDevEntered(true)}
    />
  );
}

interface AppInnerProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  view: 'landing' | 'auth' | 'app';
  authed: boolean;
  devMode: boolean;
  isZipping: boolean;
  isConfigOpen: boolean;
  setIsConfigOpen: (open: boolean) => void;
  handleDownloadZip: () => Promise<void>;
  handleLandingCta: () => void;
  onDevEnter: () => void;
}

const AppInner: React.FC<AppInnerProps> = ({
  activeTab,
  setActiveTab,
  view,
  authed,
  devMode,
  isZipping,
  isConfigOpen,
  setIsConfigOpen,
  handleDownloadZip,
  handleLandingCta,
  onDevEnter,
}) => {
  if (view === 'landing') {
    return <LandingPage onOpenDashboard={handleLandingCta} />;
  }

  if (view === 'auth' && !authed) {
    return (
      <AuthPage
        onBack={() => setActiveTab('dashboard')}
        onAuthed={() => setActiveTab('dashboard')}
        onDevEnter={onDevEnter}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] font-sans antialiased selection:bg-[#1A1A1A] selection:text-[#F5F2ED]">
      
      <Header
        onDownloadZip={handleDownloadZip}
        isZipping={isZipping}
        onOpenConfig={() => setIsConfigOpen(true)}
      />

      <ConfigurationPanelModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
      />

      <div className="flex flex-col md:flex-row">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        <main className="flex-1 min-w-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10">
          {activeTab === 'dashboard' && (
            <DashboardPanel
              onNavigate={setActiveTab}
              onDownloadZip={handleDownloadZip}
              isZipping={isZipping}
            />
          )}
          {activeTab === 'instagram' && <RealtimeStreamDashboard key="instagram" defaultPlatform="instagram" onPlatformChange={setActiveTab as any} onDownloadZip={handleDownloadZip} />}
          {activeTab === 'tiktok' && <RealtimeStreamDashboard key="tiktok" defaultPlatform="tiktok" onPlatformChange={setActiveTab as any} onDownloadZip={handleDownloadZip} />}
          {activeTab === 'facebook' && <RealtimeStreamDashboard key="facebook" defaultPlatform="facebook" onPlatformChange={setActiveTab as any} onDownloadZip={handleDownloadZip} />}
          {activeTab === 'setup' && (
            <div className="space-y-12">
              <AccountPanel />
              <ExtensionDownloader onDownloadZip={handleDownloadZip} isZipping={isZipping} />
              <TestingGuide />
            </div>
          )}
        </main>
      </div>

      <footer className="border-t border-[#1A1A1A]/10 bg-[#FBF9F6] py-8 text-center text-[11px] text-[#1A1A1A]/50 font-sans uppercase tracking-[0.15em]">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="font-bold text-[#1A1A1A]/70">Instagram Content Scraper & Media Downloader • Extension v3.0</div>
          <div className="text-[#1A1A1A]/40 normal-case tracking-normal font-mono text-[10px]">Real-time BroadcastChannel Bridge • Standalone MV3 Execution</div>
        </div>
      </footer>

    </div>
  );
}
