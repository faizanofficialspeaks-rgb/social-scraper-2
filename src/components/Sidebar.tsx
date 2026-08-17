import React from 'react';
import { Radio, Send, Facebook, Layers, LibraryBig, Cog, BarChart2 } from 'lucide-react';

export type AppTab = 'dashboard' | 'instagram' | 'tiktok' | 'facebook' | 'stage' | 'queue' | 'fbqueue' | 'setup';

interface SidebarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
}

interface NavItem {
  id: AppTab;
  label: string;
  icon: React.ReactNode;
  color: string;
}

interface NavGroup {
  step?: string;
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const groups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: <BarChart2 className="w-4 h-4" />, color: 'text-[#19A76C]' },
      ],
    },
    {
      step: '1',
      title: 'Scrape',
      items: [
        { id: 'instagram', label: 'Instagram', icon: <Radio className="w-4 h-4" />, color: 'text-[#FF6321]' },
        { id: 'tiktok', label: 'TikTok', icon: <Radio className="w-4 h-4" />, color: 'text-[#FF0050]' },
        { id: 'facebook', label: 'Facebook', icon: <Facebook className="w-4 h-4" />, color: 'text-[#1877F2]' },
      ],
    },
    {
      step: '2',
      title: 'Curate',
      items: [
        { id: 'stage', label: 'Content Stage', icon: <LibraryBig className="w-4 h-4" />, color: 'text-[#19A76C]' },
      ],
    },
    {
      step: '3',
      title: 'Queue & Post',
      items: [
        { id: 'queue', label: 'Unified Queue', icon: <Send className="w-4 h-4" />, color: 'text-[#19A76C]' },
        { id: 'fbqueue', label: 'Facebook Only', icon: <Send className="w-4 h-4" />, color: 'text-[#1877F2]' },
      ],
    },
    {
      title: 'Settings',
      items: [
        { id: 'setup', label: 'Setup & Build', icon: <Cog className="w-4 h-4" />, color: 'text-amber-500' },
      ],
    },
  ];

  return (
    <aside className="w-full md:w-60 lg:w-64 shrink-0 bg-[#FBF9F6] border-r border-[#1A1A1A]/10 md:min-h-[calc(100vh-5rem)]">
      <nav className="flex md:flex-col overflow-x-auto md:overflow-visible p-2 md:p-4 gap-2 md:gap-4">
        {groups.map((group, gi) => (
          <div key={group.title} className="shrink-0 md:shrink">
            <div className="hidden md:flex items-center gap-2 px-3 mb-1.5">
              {group.step ? (
                <>
                  <span className="w-5 h-5 border border-[#1A1A1A]/30 text-[#1A1A1A]/60 flex items-center justify-center text-[9px] font-mono font-bold">
                    {group.step}
                  </span>
                  <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/40">
                    {group.title}
                  </span>
                  {gi < groups.length - 1 && (
                    <span className="ml-auto text-[#1A1A1A]/25 text-[10px] leading-none">↓</span>
                  )}
                </>
              ) : (
                <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/40">
                  {group.title}
                </span>
              )}
            </div>

            <div className="flex md:flex-col gap-1 md:gap-1">
              {group.items.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
                      isActive
                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-sm'
                        : 'bg-transparent text-[#1A1A1A]/60 border-transparent hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5'
                    }`}
                  >
                    <span className={isActive ? 'text-white' : item.color}>{item.icon}</span>
                    <span className="hidden md:inline">{item.label}</span>
                    <span className="md:hidden text-[10px]">{item.label.split(' ')[0]}</span>
                    {isActive && <span className="ml-auto hidden md:block w-1.5 h-1.5 rounded-full bg-white/80" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="hidden md:block mt-2 pt-4 border-t border-[#1A1A1A]/10">
          <div className="flex items-center gap-2 px-3 text-[9px] uppercase tracking-[0.2em] text-[#1A1A1A]/40 font-bold">
            <Layers className="w-3 h-3" />
            Workflow
          </div>
          <p className="px-3 mt-2 text-[10px] leading-relaxed text-[#1A1A1A]/40 font-sans normal-case tracking-normal">
            Scrape → Curate (Stage) → Queue &amp; Auto-Post. Dashboard shows your month at a glance.
          </p>
        </div>
      </nav>
    </aside>
  );
};
