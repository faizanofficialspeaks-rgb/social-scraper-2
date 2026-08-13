import React, { useState } from 'react';
import { EXTENSION_FILES } from '../data/extensionFiles';
import { FileCode, Copy, Check, Folder, ChevronRight } from 'lucide-react';

export const CodeExplorer: React.FC = () => {
  const [selectedFilePath, setSelectedFilePath] = useState<string>(EXTENSION_FILES[0].path);
  const [copied, setCopied] = useState(false);

  const currentFile = EXTENSION_FILES.find(f => f.path === selectedFilePath) || EXTENSION_FILES[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white border border-[#1A1A1A]/10 overflow-hidden shadow-sm grid grid-cols-1 md:grid-cols-4 min-h-[600px]">
      
      {/* File Tree Sidebar */}
      <div className="bg-[#FBF9F6] border-r border-[#1A1A1A]/10 p-5 space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-1">Manifest V3</p>
          <div className="flex items-center gap-2 text-[#1A1A1A] font-serif font-normal text-lg">
            <Folder className="w-4 h-4 text-[#FF6321]" />
            <span>Extension Source</span>
          </div>
        </div>

        <div className="space-y-1 text-xs font-sans">
          {EXTENSION_FILES.map(file => (
            <button
              key={file.path}
              onClick={() => setSelectedFilePath(file.path)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-all ${
                selectedFilePath === file.path
                  ? 'bg-[#1A1A1A] text-white font-bold'
                  : 'text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-white'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <FileCode className={`w-3.5 h-3.5 flex-shrink-0 ${selectedFilePath === file.path ? 'text-[#FF6321]' : 'text-[#1A1A1A]/40'}`} />
                <span className="truncate text-[11px] uppercase tracking-wider">{file.name}</span>
              </div>
              <ChevronRight className={`w-3 h-3 ${selectedFilePath === file.path ? 'text-white' : 'text-[#1A1A1A]/30'}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Code Viewer */}
      <div className="col-span-3 flex flex-col bg-[#1A1A1A]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#1A1A1A]">
          <div className="flex items-center gap-2 text-xs font-mono text-[#F5F2ED]/70">
            <span className="text-white/30">extension/</span>
            <span className="text-[#FF6321] font-bold">{currentFile.path}</span>
          </div>

          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-[#F5F2ED] text-[11px] font-sans uppercase tracking-[0.15em] font-bold transition-all cursor-pointer border border-white/10"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy Source'}</span>
          </button>
        </div>

        {/* Code Content */}
        <div className="p-6 overflow-x-auto flex-1 font-mono text-xs text-[#F5F2ED] leading-relaxed bg-[#111111] selection:bg-[#FF6321] selection:text-white">
          <pre>{currentFile.content}</pre>
        </div>

      </div>

    </div>
  );
};

