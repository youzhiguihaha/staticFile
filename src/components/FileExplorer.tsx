import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { FileItem, api } from '../lib/api';
import { Folder, FileText, UploadCloud, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, Square, Copy, Link as LinkIcon, MoreVertical, Scissors, ClipboardPaste, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  files: FileItem[];
  onReload: () => void;
  onUpload: (files: File[], path: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  item: any | null; // null 表示在空白处点击
  visible: boolean;
}

export function FileExplorer({ files, onReload, onUpload }: Props) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null); // 用于 Shift 多选
  const [searchQuery, setSearchQuery] = useState('');
  
  const [clipboard, setClipboard] = useState<{ key: string, type: 'cut' } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ x: 0, y: 0, item: null, visible: false });
  const containerRef = useRef<HTMLDivElement>(null);

  // --- 核心列表逻辑 ---
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

  // --- 快捷键与全局事件 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Ctrl/Cmd + A 全选
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            const allKeys = new Set(viewItems.map(i => i.key));
            setSelection(allKeys);
        }
        // Esc 取消选择
        if (e.key === 'Escape') {
            setSelection(new Set());
            setContextMenu(prev => ({ ...prev, visible: false }));
        }
        // Delete 删除
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selection.size > 0 && !document.querySelector('input:focus')) { // 避免在搜索框打字时删除
                handleBatchDelete();
            }
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

  // --- 操作方法 ---
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
    if (!confirm(`确定删除这 ${targets.length} 项吗？\n如果包含文件夹，其中的文件也会被删除。`)) return;
    
    try {
        await api.batchDelete(targets);
        toast.success('删除成功');
        setSelection(new Set());
        onReload();
    } catch(e) { toast.error('删除失败'); }
  };

  const handleCut = (key: string) => {
    setClipboard({ key, type: 'cut' });
    toast('已剪切', { icon: '✂️' });
  };

  const handlePaste = async () => {
    if (!clipboard) return;
    try {
        await api.moveFile(clipboard.key, currentPath);
        toast.success('移动成功');
        setClipboard(null);
        onReload();
    } catch(e) { toast.error('移动失败'); }
  };

  const handleContextMenu = (e: React.MouseEvent, item: any | null) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.pageX, y: e.pageY, item, visible: true });
  };

  // --- 点击与选择逻辑 (仿 Windows) ---
  const handleItemClick = (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    
    // Ctrl/Cmd 点击：加选/减选
    if (e.ctrlKey || e.metaKey) {
        const newSet = new Set(selection);
        if (newSet.has(item.key)) newSet.delete(item.key);
        else newSet.add(item.key);
        setSelection(newSet);
        setLastSelectedKey(item.key);
        return;
    }

    // Shift 点击：范围选择
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
            return; // 保持 lastSelectedKey 不变
        }
    }

    // 普通点击：
    // 如果是文件夹 -> 进入
    if (item.isFolder) {
        setCurrentPath(item.key);
        setSelection(new Set());
        setSearchQuery('');
    } else {
        // 如果是文件 -> 选中它 (如果不按 Ctrl，则是单选)
        // 但为了方便打开，我们定义：单击选中，双击打开。
        // 由于 Web 习惯，这里我们保留单击打开/预览，或者单击选中。
        // 为了兼容桌面习惯：单击 = 选中并替换之前选择。
        const newSet = new Set();
        newSet.add(item.key);
        setSelection(newSet);
        setLastSelectedKey(item.key);
    }
  };

  // 双击打开文件
  const handleDoubleClick = (item: any) => {
      if (!item.isFolder) {
          window.open(api.getFileUrl(item.key), '_blank');
      }
  };

  // --- 拖拽处理 ---
  const handleDragStart = (e: React.DragEvent, item: any) => {
    // 如果拖拽的是已选中的多个文件，这里可以扩展支持批量拖拽，目前简化为只拖拽当前项
    // 或者如果当前项在 selection 中，视为拖拽整个 selection
    const itemsToDrag = selection.has(item.key) ? Array.from(selection) : [item.key];
    e.dataTransfer.setData('application/json', JSON.stringify({ keys: itemsToDrag }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnFolder = async (e: React.DragEvent, targetFolderKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
        const data = e.dataTransfer.getData('application/json');
        if (!data) return; 
        const { keys } = JSON.parse(data); // 接收 keys 数组
        
        for (const key of keys) {
            if (key !== targetFolderKey) {
                 await api.moveFile(key, targetFolderKey);
            }
        }
        
        toast.success(`已移动 ${keys.length} 项`);
        onReload();
        setSelection(new Set()); // 移动后清空选择
    } catch (e) {
        toast.error('移动失败');
    }
  };

  // 面包屑
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean);
    let pathAcc = '';
    return parts.map(part => { pathAcc += part + '/'; return { name: part, path: pathAcc }; });
  }, [currentPath]);

  return (
    <div className="bg-white rounded-xl shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-h-[600px] flex flex-col select-none"
         ref={containerRef}
         onContextMenu={(e) => handleContextMenu(e, null)} // 空白处右键
         onClick={() => setSelection(new Set())} // 空白处点击取消选择
         onDragOver={e => e.preventDefault()} 
         onDrop={e => { e.preventDefault(); if(e.dataTransfer.files.length) onUpload(Array.from(e.dataTransfer.files), currentPath); }}>
      
      {/* 顶部栏 */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-3 items-center justify-between bg-white/95 backdrop-blur sticky top-0 z-20">
         <div className="flex items-center gap-2 overflow-hidden flex-1">
            <button 
                onClick={(e) => { e.stopPropagation(); currentPath && setCurrentPath(currentPath.split('/').slice(0, -2).join('/') + (currentPath.split('/').length > 2 ? '/' : '')); }} 
                disabled={!currentPath}
                className={`p-2 rounded-lg transition-all ${currentPath ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-300'}`}
            >
                <ArrowLeft className="w-5 h-5" />
            </button>
            
            <div className="flex items-center text-sm font-medium whitespace-nowrap overflow-x-auto no-scrollbar px-1 gap-1">
                <div onClick={(e) => { e.stopPropagation(); setCurrentPath(''); }} className={`px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${!currentPath ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>根目录</div>
                {breadcrumbs.map(b => (
                    <div key={b.path} className="flex items-center">
                        <span className="text-slate-300">/</span>
                        <div onClick={(e) => { e.stopPropagation(); setCurrentPath(b.path); }} className="px-3 py-1.5 rounded-lg cursor-pointer text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors">{b.name}</div>
                    </div>
                ))}
            </div>
         </div>

         <div className="flex items-center gap-3">
             <div className="text-xs text-slate-400 hidden sm:block">
                 {selection.size > 0 ? `已选 ${selection.size} 项` : `${viewItems.length} 项`}
             </div>

            {clipboard && (
                 <button onClick={(e) => { e.stopPropagation(); handlePaste(); }} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 transition-all text-sm">
                     <ClipboardPaste className="w-4 h-4" /> 粘贴
                 </button>
            )}

            <div className="relative group hidden sm:block">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                    type="text" 
                    placeholder="搜索" 
                    className="w-[180px] pl-9 pr-4 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all outline-none" 
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)}
                    onClick={e => e.stopPropagation()}
                />
            </div>
            
            <button onClick={(e) => { e.stopPropagation(); handleCreateFolder(); }} className="p-2 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors" title="新建文件夹"><FolderPlus className="w-5 h-5" /></button>
         </div>
      </div>

      {/* 列表区域 */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 content-start flex-1 bg-slate-50/30">
         {/* 上传按钮 */}
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
                    onDragOver={item.isFolder ? handleDragOver : undefined}
                    onDrop={item.isFolder ? (e) => handleDropOnFolder(e, item.key) : undefined}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    onClick={(e) => handleItemClick(e, item)}
                    onDoubleClick={() => handleDoubleClick(item)}
                    className={`relative group flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer aspect-[3/4]
                        ${isSelected 
                            ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500 z-10' 
                            : 'border-transparent hover:bg-white hover:shadow-md'
                        }
                    `}
                 >
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

      {/* 右键菜单 */}
      {contextMenu.visible && (
          <div 
             className="fixed z-50 bg-white/95 backdrop-blur rounded-lg shadow-xl border border-slate-100 w-48 py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
             style={{ top: contextMenu.y, left: contextMenu.x }}
             onClick={(e) => e.stopPropagation()}
          >
              {contextMenu.item ? (
                  // 文件/文件夹菜单
                  <>
                      <div className="px-3 py-1.5 text-[10px] text-slate-400 font-medium truncate uppercase tracking-wider border-b border-slate-50 mb-1">
                          {contextMenu.item.name}
                      </div>
                      {!contextMenu.item.isFolder && (
                        <>
                          <button onClick={() => { window.open(api.getFileUrl(contextMenu.item.key), '_blank'); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                              <FileText className="w-4 h-4" /> 打开
                          </button>
                          <button onClick={() => { navigator.clipboard.writeText(api.getFileUrl(contextMenu.item.key)); toast.success('已复制'); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                              <LinkIcon className="w-4 h-4" /> 复制链接
                          </button>
                        </>
                      )}
                      <button onClick={() => { handleCut(contextMenu.item.key); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                          <Scissors className="w-4 h-4" /> 剪切
                      </button>
                      <div className="h-px bg-slate-100 my-1"></div>
                      <button onClick={() => { handleBatchDelete([contextMenu.item.key]); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                          <Trash2 className="w-4 h-4" /> 删除
                      </button>
                  </>
              ) : (
                  // 空白处菜单
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
