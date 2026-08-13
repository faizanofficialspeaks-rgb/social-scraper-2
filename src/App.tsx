import React, { useState } from 'react';
import JSZip from 'jszip';
import { Header } from './components/Header';
import { ExtensionDownloader } from './components/ExtensionDownloader';
import { CodeExplorer } from './components/CodeExplorer';
import { ParserSandbox } from './components/ParserSandbox';
import { PanelSimulator } from './components/PanelSimulator';
import { TestingGuide } from './components/TestingGuide';
import { RealtimeStreamDashboard } from './components/RealtimeStreamDashboard';
import { ConfigurationPanelModal } from './components/ConfigurationPanelModal';
import { AutoPublisherPanel } from './components/AutoPublisherPanel';

export default function App() {
  const [activeTab, setActiveTab] = useState<'instagram' | 'tiktok' | 'facebook' | 'setup' | 'publisher'>('instagram');
  const [isZipping, setIsZipping] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

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
        { path: 'publisher.js', url: '/extension/publisher.js' },
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

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] font-sans antialiased selection:bg-[#1A1A1A] selection:text-[#F5F2ED]">
      
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onDownloadZip={handleDownloadZip}
        isZipping={isZipping}
        onOpenConfig={() => setIsConfigOpen(true)}
      />

      <ConfigurationPanelModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {activeTab === 'instagram' && <RealtimeStreamDashboard key="instagram" defaultPlatform="instagram" onPlatformChange={(platform) => setActiveTab(platform)} onDownloadZip={handleDownloadZip} />}
        {activeTab === 'tiktok' && <RealtimeStreamDashboard key="tiktok" defaultPlatform="tiktok" onPlatformChange={(platform) => setActiveTab(platform)} onDownloadZip={handleDownloadZip} />}
        {activeTab === 'facebook' && <RealtimeStreamDashboard key="facebook" defaultPlatform="facebook" onPlatformChange={(platform) => setActiveTab(platform)} onDownloadZip={handleDownloadZip} />}
        { activeTab === 'setup' && (
          <div className="space-y-12">
            <ExtensionDownloader onDownloadZip={handleDownloadZip} isZipping={isZipping} />
            <TestingGuide />
          </div>
        )}
        {activeTab === 'publisher' && <AutoPublisherPanel />}
      </main>

      <footer className="border-t border-[#1A1A1A]/10 bg-[#FBF9F6] py-8 text-center text-[11px] text-[#1A1A1A]/50 font-sans uppercase tracking-[0.15em]">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="font-bold text-[#1A1A1A]/70">Instagram Content Scraper & Media Downloader • Extension v3.0</div>
          <div className="text-[#1A1A1A]/40 normal-case tracking-normal font-mono text-[10px]">Real-time BroadcastChannel Bridge • Standalone MV3 Execution</div>
        </div>
      </footer>

    </div>
  );
}
