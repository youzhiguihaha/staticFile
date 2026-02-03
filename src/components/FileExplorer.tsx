import { useState, useMemo, useEffect, useRef } from 'react';
import { FileItem, api } from '../lib/api';
import { Folder, FileText, UploadCloud, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, Square, Copy, Link as LinkIcon, MoreVertical, Scissors, ClipboardPaste, RefreshCw, X, Menu, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { FolderTree } from './FolderTree';

interface Props {
  files: FileItem[];
  onReload: () => void;
  onUpload: (files: File[], path: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  item: any | null; 
  visible: boolean;
}

export function FileExplorer({ files, onReload, onUpload }: Props) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false); // 新增多选模式状态
  
  const [clipboard, setClipboard] = useState<{ key: string, type: 'cut' } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ x: 0, y: 0, item: null, visible: false });
  const containerRef = useRef<HTMLDivElement>(null);

  // --- 列表逻辑 ---
  const viewItems = useMemo(() => {
    if (searchQuery) return files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

    const items: (FileItem & { isFolder?: boolean })[] = [];
    const processedFolders = new Set<string>();

    files.forEach(file => {
        if (!file.key.startsWith(currentPath)) return;
        const relativeKey = file.key.slice(currentPath.length);
        const parts = relativeKey.split('/');

        if (parts.length === 1) {
            if (relativeKey !== '') items.push(file);
        } else {
            const folderName = parts[0];
            if (!processedFolders.has(folderName)) {
                processedFolders.add(folderName);
                items.push({
                    key: currentPath + folderName + '/',
                    name: folderName,
                    type: 'folder',
                    size: 0,
                    uploadedAt: file.uploadedAt,
                    isFolder: true
                });
            }
        }
    });
    return items.sort((a, b) => (b.isFolder ? 1 : 0) - (a.isFolder ? 1 : 0) || b.uploadedAt - a.uploadedAt);
  }, [files, currentPath, searchQuery]);

  // --- 快捷键 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag === 'input' || activeTag === 'textarea') return;

        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
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
    const handleClickOutside = () => setContextMenu(prev => ({ ...prev, visible: false }));
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClickOutside);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('click', handleClickOutside);
    };
  }, [selection, viewItems]);

  // --- 核心方法 ---
  const handleNavigate = (path: string) => {
      setCurrentPath(path);
      setSelection(new Set());
      setSearchQuery('');
      setShowSidebar(false);
  };

  const handleCreateFolder = async () => {
    const name = prompt('请输入文件夹名称:');
    if (!name) return;
    const cleanName = name.replace(/[\/\\]/g, '');
    try {
        await api.createFolder(currentPath + cleanName);
        toast.success('创建成功');
        onReload();
    } catch(e) { toast.error('创建失败'); }
  };

  const handleBatchDelete = async (keys: string[] = []) => {
    const targets = keys.length > 0 ? keys : Array.from(selection);
    if (targets.length === 0) return;
    if (!confirm(`⚠️ 确定要删除这 ${targets.length} 项吗？\n文件夹内的所有文件也会被删除！`)) return;
    
    const toastId = toast.loading('正在删除...');
    try {
        await api.batchDelete(targets);
        toast.dismiss(toastId);
        toast.success('删除成功');
        setSelection(new Set());
        onReload();
    } catch(e) { 
        toast.dismiss(toastId);
        toast.error('删除失败'); 
    }
  };

  const handleCut = (key: string) => {
    setClipboard({ key, type: 'cut' });
    toast('已剪切', { icon: '✂️' });
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
    } catch(e) { 
        toast.dismiss(toastId);
        toast.error('移动失败'); 
    }
  };

  // --- 交互事件 ---
  const handleItemClick = (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    
    // 如果开启了多选模式，点击即为选中/反选
    if (isMultiSelectMode || e.ctrlKey || e.metaKey) {
        const newSet = new Set(selection);
        if (newSet.has(item.key)) newSet.delete(item.key);
        else newSet.add(item.key);
        setSelection(newSet);
        setLastSelectedKey(item.key);
        return;
    }

    if (e.shiftKey && lastSelectedKey) {
        const idx1 = viewItems.findIndex(i => i.key === lastSelectedKey);
        const idx2 = viewItems.findIndex(i => i.key === item.key);
        if (idx1 !== -1 && idx2 !== -1) {
            const start = Math.min(idx1, idx2);
            const end = Math.max(idx1, idx2);
            const range = viewItems.slice(start, end + 1);
            const newSet = new Set(selection);
            range.forEach(i => newSet.add(i.key));
            setSelection(newSet);
            return;
        }
    }

    if (item.isFolder) {
        handleNavigate(item.key);
    } else {
        const newSet = new Set<string>();
        newSet.add(item.key);
        setSelection(newSet);
        setLastSelectedKey(item.key);
    }
  };

  // --- 拖拽逻辑 ---
  const handleDragStart = (e: React.DragEvent, item: any) => {
    const itemsToDrag = selection.has(item.key) ? Array.from(selection) : [item.key];
    e.dataTransfer.setData('application/json', JSON.stringify({ keys: itemsToDrag }));
    e.dataTransfer.effectAllowed = 'move';
  };
  
  const handleDropLogic = async (e: React.DragEvent, targetFolderKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
        const data = e.dataTransfer.getData('application/json');
        if (!data) return; 
        const { keys } = JSON.parse(data);
        const validKeys = keys.filter((key: string) => key !== targetFolderKey && !targetFolderKey.startsWith(key));
        if (validKeys.length === 0) return;
        const toastId = toast.loading(`正在移动 ${validKeys.length} 项...`);
        for (const key of validKeys) await api.moveFile(key, targetFolderKey);
        toast.dismiss(toastId);
        toast.success('移动完成');
        onReload();
        setSelection(new Set());
    } catch (e) { toast.error('移动失败'); }
  };

  return (
    <div className="bg-white rounded-xl shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-h-[600px] flex flex-col sm:flex-row select-none relative">
      
      {showSidebar && <div className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setShowSidebar(false)} />}

      <div className={`
          absolute sm:relative z-40 w-64 h-full bg-white transition-transform duration-300 transform border-r border-slate-100
          ${showSidebar ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'}
          flex-shrink-0
      `}>
          <FolderTree files={files} currentPath={currentPath} onNavigate={handleNavigate} onDrop={handleDropLogic} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-white" 
           ref={containerRef}
           onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.pageX, y: e.pageY, item: null, visible: true }); }}
           onClick={() => !isMultiSelectMode && setSelection(new Set())}
           onDragOver={e => e.preventDefault()} 
           onDrop={e => { e.preventDefault(); if(e.dataTransfer.files.length) onUpload(Array.from(e.dataTransfer.files), currentPath); }}
      >
          {/* 工具栏 */}
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-3 items-center justify-between bg-white/95 backdrop-blur sticky top-0 z-20">
             <div className="flex items-center gap-2 overflow-hidden flex-1">
                <button className="sm:hidden p-2 -ml-2 text-slate-500" onClick={() => setShowSidebar(true)}><Menu className="w-5 h-5" /></button>
                <button 
                    onClick={(e) => { e.stopPropagation(); currentPath && handleNavigate(currentPath.split('/').slice(0, -2).join('/') + (currentPath.split('/').length > 2 ? '/' : '')); }} 
                    disabled={!currentPath}
                    className={`p-2 rounded-lg transition-all ${currentPath ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-300'}`}
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="text-sm font-medium text-slate-700 truncate px-2">{currentPath ? currentPath.split('/').filter(Boolean).pop() : '根目录'}</div>
             </div>

             <div className="flex items-center gap-2 sm:gap-3">
                 <div className="text-xs text-slate-400 hidden lg:block">
                     {selection.size > 0 ? `已选 ${selection.size} 项` : `${viewItems.length} 项`}
                 </div>

                {selection.size > 0 && (
                    <button onClick={(e) => { e.stopPropagation(); handleBatchDelete(); }} className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100">
                        <Trash2 className="w-4 h-4" /> <span className="hidden sm:inline">删除</span>
                    </button>
                )}

                {clipboard && (
                     <button onClick={(e) => { e.stopPropagation(); handlePaste(); }} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 text-sm">
                         <ClipboardPaste className="w-4 h-4" /> 粘贴
                     </button>
                )}
                
                {/* 搜索框 */}
                <div className="relative group hidden md:block">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input type="text" placeholder="搜索" className="w-[140px] pl-9 pr-4 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 outline-none" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onClick={e => e.stopPropagation()} />
                </div>
                
                {/* 新建文件夹 */}
                <button onClick={(e) => { e.stopPropagation(); handleCreateFolder(); }} className="p-2 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors" title="新建文件夹">
                    <FolderPlus className="w-5 h-5" />
                </button>

                {/* 多选模式开关 */}
                <button 
                    onClick={(e) => { e.stopPropagation(); setIsMultiSelectMode(!isMultiSelectMode); if(isMultiSelectMode) setSelection(new Set()); }} 
                    className={`p-2 rounded-lg transition-all ${isMultiSelectMode ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-200' : 'text-slate-600 hover:bg-slate-100'}`}
                    title={isMultiSelectMode ? "退出多选" : "开启多选"}
                >
                    <CheckSquare className="w-5 h-5" />
                </button>
             </div>
          </div>

          {/* 列表区域 */}
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 content-start flex-1 bg-slate-50/30 overflow-y-auto">
             <label className="flex flex-col items-center justify-center p-2 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50 hover:border-blue-300 cursor-pointer group transition-all aspect-[3/4]" onClick={e => e.stopPropagation()}>
                <input type="file" multiple className="hidden" onChange={e => e.target.files && onUpload(Array.from(e.target.files), currentPath)} />
                <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-blue-500 mb-2 transition-colors" />
                <span className="text-xs text-slate-500 font-medium">上传文件</span>
             </label>

             {viewItems.map(item => {
                 const isSelected = selection.has(item.key);
                 return (
                     <div 
                        key={item.key} 
                        draggable
                        onDragStart={(e) => handleDragStart(e, item)}
                        onDragOver={item.isFolder ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
                        onDrop={item.isFolder ? (e) => handleDropLogic(e, item.key) : undefined}
                        onContextMenu={(e) => { 
                            e.preventDefault(); e.stopPropagation(); 
                            if (!selection.has(item.key)) {
                                setSelection(new Set([item.key]));
                                setLastSelectedKey(item.key);
                            }
                            setContextMenu({ x: e.pageX, y: e.pageY, item, visible: true });
                        }}
                        onClick={(e) => handleItemClick(e, item)}
                        onDoubleClick={() => !item.isFolder && window.open(api.getFileUrl(item.key), '_blank')}
                        className={`relative group flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer aspect-[3/4]
                            ${isSelected 
                                ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500 z-10' 
                                : 'border-transparent hover:bg-white hover:shadow-md'
                            }
                        `}
                     >
                        {/* 选中标记 (仅在选中或多选模式下显示) */}
                        {(isSelected || isMultiSelectMode) && (
                            <div className="absolute top-2 right-2 z-20">
                                {isSelected ? <CheckCircle2 className="w-5 h-5 text-blue-600 fill-white" /> : <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white/80" />}
                            </div>
                        )}

                        <div className="flex-1 w-full flex items-center justify-center overflow-hidden pointer-events-none">
                            {item.isFolder ? (
                                <Folder className="w-16 h-16 text-blue-400/90 fill-blue-100" />
                            ) : item.type.startsWith('image/') ? (
                                <img src={api.getFileUrl(item.key)} className="w-full h-full object-contain rounded shadow-sm" loading="lazy" />
                            ) : (
                                <FileText className="w-14 h-14 text-slate-400" />
                            )}
                        </div>
                        
                        <div className="w-full text-center px-0.5 mt-2">
                            <div className={`text-xs font-medium truncate w-full ${isSelected ? 'text-blue-700' : 'text-slate-700'}`} title={item.name}>{item.name}</div>
                        </div>
                     </div>
                 );
             })}
          </div>
      </div>
      
      {/* 右键菜单保持不变... */}
      {contextMenu.visible && (
          <div 
             className="fixed z-50 bg-white/95 backdrop-blur rounded-lg shadow-xl border border-slate-100 w-48 py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
             style={{ top: contextMenu.y, left: contextMenu.x }}
             onClick={(e) => e.stopPropagation()}
          >
              {contextMenu.item ? (
                  <>
                      <div className="px-3 py-1.5 text-[10px] text-slate-400 font-medium truncate uppercase tracking-wider border-b border-slate-50 mb-1">
                          {selection.size > 1 ? `已选 ${selection.size} 项` : contextMenu.item.name}
                      </div>
                      
                      {selection.size <= 1 && !contextMenu.item.isFolder && (
                        <>
                          <button onClick={() => { window.open(api.getFileUrl(contextMenu.item.key), '_blank'); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                              <FileText className="w-4 h-4" /> 打开
                          </button>
                          <button onClick={() => { navigator.clipboard.writeText(api.getFileUrl(contextMenu.item.key)); toast.success('已复制'); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                              <LinkIcon className="w-4 h-4" /> 复制链接
                          </button>
                        </>
                      )}
                      
                      {selection.size <= 1 && (
                          <button onClick={() => { handleCut(contextMenu.item.key); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                              <Scissors className="w-4 h-4" /> 剪切
                          </button>
                      )}
                      
                      <div className="h-px bg-slate-100 my-1"></div>
                      
                      <button onClick={() => { handleBatchDelete(); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                          <Trash2 className="w-4 h-4" /> 删除 {selection.size > 1 ? `(${selection.size})` : ''}
                      </button>
                  </>
              ) : (
                  <>
                      <button onClick={() => { onReload(); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                          <RefreshCw className="w-4 h-4" /> 刷新
                      </button>
                      <button onClick={() => { handleCreateFolder(); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                          <FolderPlus className="w-4 h-4" /> 新建文件夹
                      </button>
                      {clipboard && (
                          <button onClick={() => { handlePaste(); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2 font-medium">
                              <ClipboardPaste className="w-4 h-4" /> 粘贴
                          </button>
                      )}
                  </>
              )}
          </div>
      )}
    </div>
  );
}
