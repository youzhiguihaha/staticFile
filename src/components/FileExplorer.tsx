import { useState, useMemo, useEffect, useRef } from 'react';
import { FileItem, api } from '../lib/api';
import { Folder, FileText, UploadCloud, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, Square, Link as LinkIcon, Scissors, ClipboardPaste, RefreshCw, X, Menu, CheckCircle2, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { FolderTree } from './FolderTree';

interface Props {
  files: FileItem[];
  onReload: () => void;
  onUpload: (files: File[], path: string) => void;
}

interface ContextMenuState { x: number; y: number; item: any | null; visible: boolean; }

export function FileExplorer({ files, onReload, onUpload }: Props) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [clipboard, setClipboard] = useState<{ key: string, type: 'cut' } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ x: 0, y: 0, item: null, visible: false });
  const containerRef = useRef<HTMLDivElement>(null);
  // 拖拽高亮的目标文件夹
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  // --- 视图计算 ---
  const viewItems = useMemo(() => {
    if (searchQuery) {
        return files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase())).map(f => ({
            ...f, displayName: f.key, isSearchResult: true
        }));
    }
    const items: (FileItem & { isFolder?: boolean, displayName?: string })[] = [];
    const processedFolders = new Set<string>();

    files.forEach(file => {
        if (!file.key.startsWith(currentPath)) return;
        const relativeKey = file.key.slice(currentPath.length);
        const parts = relativeKey.split('/');
        if (parts.length === 1) {
            if (relativeKey !== '') items.push({ ...file, displayName: file.name });
        } else {
            const folderName = parts[0];
            if (!processedFolders.has(folderName)) {
                processedFolders.add(folderName);
                items.push({
                    key: currentPath + folderName + '/', name: folderName, displayName: folderName,
                    type: 'folder', size: 0, uploadedAt: file.uploadedAt, isFolder: true
                });
            }
        }
    });
    return items.sort((a, b) => (b.isFolder ? 1 : 0) - (a.isFolder ? 1 : 0) || b.uploadedAt - a.uploadedAt);
  }, [files, currentPath, searchQuery]);

  // --- 快捷键 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (['input', 'textarea'].includes(document.activeElement?.tagName.toLowerCase() || '')) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            // 修复：只全选当前视图可见的项
            setSelection(new Set(viewItems.map(i => i.key)));
        }
        if (e.key === 'Escape') {
            setSelection(new Set());
            setIsMultiSelectMode(false);
            setContextMenu(prev => ({ ...prev, visible: false }));
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selection.size > 0) handleBatchDelete();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, viewItems]);

  // --- 逻辑方法 ---
  const handleNavigate = (path: string) => {
      if (!path.endsWith('/')) {
         const parts = path.split('/');
         parts.pop();
         const folderPath = parts.join('/') + '/';
         const parent = folderPath === '/' ? '' : folderPath;
         if(parent !== currentPath) setCurrentPath(parent);
         setSelection(new Set([path]));
         if(searchQuery) setSearchQuery('');
      } else {
          setCurrentPath(path);
          setSelection(new Set());
          setSearchQuery('');
      }
      setShowSidebar(false);
  };

  const handleBatchDelete = async (keys: string[] = []) => {
    const targets = keys.length > 0 ? keys : Array.from(selection);
    if (targets.length === 0) return;
    const toastId = toast.loading('正在删除...');
    try {
        await api.batchDelete(targets);
        toast.dismiss(toastId);
        toast.success('删除成功');
        setSelection(new Set());
        onReload();
    } catch(e) { toast.dismiss(toastId); toast.error('删除失败'); }
  };

  const handleCut = (key: string) => {
    setClipboard({ key, type: 'cut' });
    toast('已剪切', { icon: '✂️' });
    setSelection(new Set());
  };

  const handlePaste = async () => {
    if (!clipboard) return;
    const toastId = toast.loading('正在移动...');
    try {
        await api.moveFile(clipboard.key, currentPath);
        toast.dismiss(toastId);
        toast.success('移动成功');
        setClipboard(null);
        onReload();
    } catch(e) { toast.dismiss(toastId); toast.error(e.message || '移动失败'); }
  };

  const handleCopyLink = (key: string) => {
      const url = api.getFileUrl(key);
      navigator.clipboard.writeText(url);
      toast.success('直链已复制');
  };

  const handleItemClick = (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    if (isMultiSelectMode || e.ctrlKey || e.metaKey) {
        const newSet = new Set(selection);
        if (newSet.has(item.key)) newSet.delete(item.key);
        else newSet.add(item.key);
        setSelection(newSet);
        setLastSelectedKey(item.key);
    } else if (e.shiftKey && lastSelectedKey) {
        const idx1 = viewItems.findIndex(i => i.key === lastSelectedKey);
        const idx2 = viewItems.findIndex(i => i.key === item.key);
        if (idx1 !== -1 && idx2 !== -1) {
            const range = viewItems.slice(Math.min(idx1, idx2), Math.max(idx1, idx2) + 1);
            setSelection(new Set(range.map(i => i.key)));
        }
    } else {
        if (item.isFolder) handleNavigate(item.key);
        else {
            setSelection(new Set([item.key]));
            setLastSelectedKey(item.key);
        }
    }
  };

  const handleDragOverItem = (e: React.DragEvent, item: any) => {
      e.preventDefault();
      if (item.isFolder) {
          e.dataTransfer.dropEffect = 'move';
          setDragOverFolder(item.key);
      }
  };

  return (
    <div className="bg-white rounded-xl shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-h-[600px] flex flex-col sm:flex-row select-none relative">
      {showSidebar && <div className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setShowSidebar(false)} />}
      <div className={`absolute sm:relative z-40 w-64 h-full bg-white transition-transform duration-300 transform border-r border-slate-100 ${showSidebar ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'} flex-shrink-0`}>
          <FolderTree files={files} currentPath={currentPath} onNavigate={handleNavigate} onDrop={(e, t) => e.preventDefault()} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-white" 
           ref={containerRef}
           onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.pageX, y: e.pageY, item: null, visible: true }); }}
           onClick={() => !isMultiSelectMode && setSelection(new Set())}
           onDragOver={e => e.preventDefault()} 
           onDrop={e => { 
               e.preventDefault(); 
               const data = e.dataTransfer.getData('application/json');
               if(data) {
                   try {
                       const { keys } = JSON.parse(data);
                       const validKeys = keys.filter((k:string) => k !== currentPath && !currentPath.startsWith(k));
                       if(validKeys.length) validKeys.forEach((k:string) => api.moveFile(k, currentPath).then(() => { toast.success('移动完成'); onReload(); }));
                   } catch(err) {}
               } else if(e.dataTransfer.files.length) {
                   onUpload(Array.from(e.dataTransfer.files), currentPath);
               }
           }}
      >
          {/* 工具栏 */}
          <div className="px-4 py-3 border-b border-slate-100 flex gap-3 items-center justify-between bg-white/95 backdrop-blur sticky top-0 z-20 h-14">
             <div className="flex items-center gap-2 overflow-hidden flex-1">
                <button className="sm:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full" onClick={() => setShowSidebar(true)}><Menu className="w-5 h-5" /></button>
                <button onClick={(e) => { e.stopPropagation(); currentPath && handleNavigate(currentPath.split('/').slice(0, -2).join('/') + (currentPath.split('/').length > 2 ? '/' : '')); }} disabled={!currentPath} className={`p-2 rounded-lg transition-all ${currentPath ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-300'}`}><ArrowLeft className="w-5 h-5" /></button>
                <div className="text-sm font-medium text-slate-700 truncate px-2" title={currentPath}>
                    {searchQuery ? '搜索结果' : (currentPath ? currentPath.split('/').filter(Boolean).pop() : '根目录')}
                </div>
             </div>

             <div className="flex items-center gap-2">
                {selection.size > 0 ? (
                    <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-100 animate-in slide-in-from-top-1 fade-in mr-2">
                        {selection.size === 1 && !Array.from(selection)[0].endsWith('/') && (
                            <>
                                <button onClick={(e) => { e.stopPropagation(); window.open(api.getFileUrl(Array.from(selection)[0]), '_blank'); }} className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600" title="打开/下载"><Download className="w-4 h-4" /></button>
                                <button onClick={(e) => { e.stopPropagation(); handleCopyLink(Array.from(selection)[0]); }} className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600" title="复制直链"><LinkIcon className="w-4 h-4" /></button>
                            </>
                        )}
                        {selection.size === 1 && (
                            <button onClick={(e) => { e.stopPropagation(); handleCut(Array.from(selection)[0]); }} className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-orange-600" title="剪切"><Scissors className="w-4 h-4" /></button>
                        )}
                        <div className="w-px h-4 bg-slate-200 mx-1"></div>
                        <button onClick={(e) => { e.stopPropagation(); handleBatchDelete(); }} className="p-2 hover:bg-white rounded-md text-red-600 hover:bg-red-50" title="删除"><Trash2 className="w-4 h-4" /></button>
                        <span className="px-2 text-xs text-slate-400 font-medium">{selection.size}</span>
                    </div>
                ) : (
                    <>
                        {clipboard && <button onClick={(e) => { e.stopPropagation(); handlePaste(); }} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 text-xs font-medium"><ClipboardPaste className="w-3.5 h-3.5" /> 粘贴</button>}
                        <div className="relative group hidden md:block">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input type="text" placeholder="搜索..." className="w-[140px] pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onClick={e => e.stopPropagation()} />
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); setIsMultiSelectMode(!isMultiSelectMode); if(isMultiSelectMode) setSelection(new Set()); }} className={`p-2 rounded-lg transition-all ${isMultiSelectMode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} title="多选模式"><CheckSquare className="w-5 h-5" /></button>
                    </>
                )}
             </div>
          </div>

          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 content-start flex-1 bg-slate-50/30 overflow-y-auto">
             {viewItems.map(item => {
                 const isSelected = selection.has(item.key);
                 const isDraggingOver = dragOverFolder === item.key;
                 const showName = item.displayName || item.name;
                 
                 return (
                     <div 
                        key={item.key} 
                        draggable
                        onDragStart={(e) => { const keys = selection.has(item.key) ? Array.from(selection) : [item.key]; e.dataTransfer.setData('application/json', JSON.stringify({ keys })); }}
                        onDragOver={(e) => handleDragOverItem(e, item)}
                        onDragLeave={() => setDragOverFolder(null)}
                        onDrop={item.isFolder ? (e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolder(null); const data = e.dataTransfer.getData('application/json'); if(data) { const {keys}=JSON.parse(data); keys.forEach((k:string)=>api.moveFile(k, item.key).then(()=>{toast.success('移动成功');onReload();})); } } : undefined}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if(!selection.has(item.key)) setSelection(new Set([item.key])); setContextMenu({ x: e.pageX, y: e.pageY, item, visible: true }); }}
                        onClick={(e) => handleItemClick(e, item)}
                        onDoubleClick={() => !item.isFolder && window.open(api.getFileUrl(item.key), '_blank')}
                        className={`relative group flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer aspect-[3/4]
                            ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500 z-10' : 
                              isDraggingOver ? 'border-blue-500 bg-blue-100 scale-105 shadow-md' : 'border-transparent hover:bg-white hover:shadow-md'}
                        `}
                        title={showName}
                     >
                        {(isSelected || isMultiSelectMode) && (
                            <div className="absolute top-2 right-2 z-20 pointer-events-none">
                                {isSelected ? <CheckCircle2 className="w-5 h-5 text-blue-600 fill-white" /> : <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white/80" />}
                            </div>
                        )}
                        <div className="flex-1 w-full flex items-center justify-center overflow-hidden pointer-events-none">
                            {item.isFolder ? <Folder className="w-16 h-16 text-blue-400/90 fill-blue-100" /> : item.type?.startsWith('image/') ? <img src={api.getFileUrl(item.key)} className="w-full h-full object-contain rounded shadow-sm" loading="lazy" /> : <FileText className="w-14 h-14 text-slate-400" />}
                        </div>
                        <div className="w-full text-center px-0.5 mt-2">
                            <div className={`text-xs font-medium truncate w-full ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>{showName}</div>
                        </div>
                     </div>
                 );
             })}
          </div>
      </div>
      
      {contextMenu.visible && (
          <div className="fixed z-50 bg-white/95 backdrop-blur rounded-lg shadow-xl border border-slate-100 w-40 py-1 overflow-hidden" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={(e) => e.stopPropagation()}>
              {contextMenu.item ? (
                  <>
                    {!contextMenu.item.isFolder && <button onClick={() => { handleCopyLink(contextMenu.item.key); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2"><LinkIcon className="w-3.5 h-3.5" /> 复制链接</button>}
                    <button onClick={() => { handleCut(contextMenu.item.key); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2"><Scissors className="w-3.5 h-3.5" /> 剪切</button>
                    <button onClick={() => { handleBatchDelete(); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex gap-2"><Trash2 className="w-3.5 h-3.5" /> 删除</button>
                  </>
              ) : (
                  <button onClick={() => { onReload(); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex gap-2"><RefreshCw className="w-3.5 h-3.5" /> 刷新</button>
              )}
          </div>
      )}
    </div>
  );
}
