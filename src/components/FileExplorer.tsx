import { useState, useMemo, useEffect, useRef } from 'react';
import { FileItem, api } from '../lib/api';
import { Folder, FileText, UploadCloud, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, Square, Copy, Link as LinkIcon, MoreVertical, Scissors, ClipboardPaste } from 'lucide-react';
import toast from 'react-hot-toast';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
  // 剪贴板 (用于剪切/移动)
  const [clipboard, setClipboard] = useState<{ key: string, type: 'cut' } | null>(null);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ x: 0, y: 0, item: null, visible: false });
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  // --- 全局点击关闭右键菜单 ---
  useEffect(() => {
    const handleClick = () => setContextMenu({ ...contextMenu, visible: false });
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu]);

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
    if (!confirm(`确定删除这 ${targets.length} 项吗？`)) return;
    
    try {
        await api.batchDelete(targets);
        toast.success('删除成功');
        setSelection(new Set());
        onReload();
    } catch(e) { toast.error('删除失败'); }
  };

  const handleCut = (key: string) => {
    setClipboard({ key, type: 'cut' });
    toast('已添加到剪贴板，请到目标目录粘贴', { icon: '✂️' });
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

  const handleContextMenu = (e: React.MouseEvent, item: any) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.pageX, y: e.pageY, item, visible: true });
  };

  // --- 拖拽处理 ---
  const handleDragStart = (e: React.DragEvent, item: any) => {
    e.dataTransfer.setData('application/json', JSON.stringify(item));
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
        const sourceItem = JSON.parse(data);
        
        if (sourceItem.key === targetFolderKey) return; // 不能移动到自己
        
        await api.moveFile(sourceItem.key, targetFolderKey);
        toast.success(`已移动到 ${targetFolderKey}`);
        onReload();
    } catch (e) {
        console.error(e);
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
    <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden min-h-[600px] flex flex-col transition-all duration-300"
         onDragOver={e => e.preventDefault()} 
         onDrop={e => { e.preventDefault(); if(e.dataTransfer.files.length) onUpload(Array.from(e.dataTransfer.files), currentPath); }}>
      
      {/* 顶部栏 */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-3 items-center justify-between bg-white/80 backdrop-blur sticky top-0 z-20">
         <div className="flex items-center gap-2 overflow-hidden flex-1">
            <button 
                onClick={() => currentPath && setCurrentPath(currentPath.split('/').slice(0, -2).join('/') + (currentPath.split('/').length > 2 ? '/' : ''))} 
                disabled={!currentPath}
                className={`p-2 rounded-lg transition-all ${currentPath ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-300'}`}
            >
                <ArrowLeft className="w-5 h-5" />
            </button>
            
            <div className="flex items-center text-sm font-medium whitespace-nowrap overflow-x-auto no-scrollbar px-1 gap-1">
                <div 
                    onClick={() => setCurrentPath('')}
                    className={`px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${!currentPath ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                    根目录
                </div>
                {breadcrumbs.map(b => (
                    <div key={b.path} className="flex items-center">
                        <span className="text-slate-300">/</span>
                        <div 
                            onClick={() => setCurrentPath(b.path)}
                            className="px-3 py-1.5 rounded-lg cursor-pointer text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors"
                        >
                            {b.name}
                        </div>
                    </div>
                ))}
            </div>
         </div>

         <div className="flex items-center gap-3">
            {clipboard && (
                 <button onClick={handlePaste} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all animate-pulse">
                     <ClipboardPaste className="w-4 h-4" />
                     <span className="text-sm font-medium">粘贴</span>
                 </button>
            )}

            <div className="relative group hidden sm:block">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-blue-500 transition-colors" />
                <input 
                    type="text" 
                    placeholder="搜索文件..." 
                    className="w-[200px] pl-9 pr-4 py-2 text-sm bg-slate-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none" 
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                />
            </div>
            
            <button onClick={handleCreateFolder} className="p-2.5 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all" title="新建文件夹">
                <FolderPlus className="w-5 h-5" />
            </button>
            
            <button 
                onClick={() => { setIsSelectionMode(!isSelectionMode); setSelection(new Set()); }} 
                className={`p-2.5 rounded-xl transition-all ${isSelectionMode ? 'bg-blue-100 text-blue-600 shadow-inner' : 'text-slate-600 hover:bg-slate-100'}`}
                title="批量管理"
            >
                <CheckSquare className="w-5 h-5" />
            </button>
            
            {selection.size > 0 && (
                <button onClick={() => handleBatchDelete()} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors">
                    <Trash2 className="w-4 h-4" /> 
                    <span className="hidden sm:inline">删除</span>
                </button>
            )}
         </div>
      </div>

      {/* 搜索框 (移动端) */}
      <div className="sm:hidden px-4 pb-2 border-b border-slate-50">
          <input 
              type="text" 
              placeholder="搜索文件..." 
              className="w-full px-4 py-2 text-sm bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20"
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
          />
      </div>

      {/* 列表区域 */}
      <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 content-start flex-1 bg-slate-50/30">
         {/* 上传卡片 */}
         <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-blue-200 rounded-2xl bg-blue-50/20 hover:bg-blue-50 hover:border-blue-400 cursor-pointer group transition-all aspect-[4/5] sm:aspect-auto sm:h-[180px]">
            <input type="file" multiple className="hidden" onChange={e => e.target.files && onUpload(Array.from(e.target.files), currentPath)} />
            <div className="w-14 h-14 bg-white shadow-sm rounded-full flex items-center justify-center mb-3 group-hover:scale-110 group-hover:shadow-md transition-all text-blue-500">
                <UploadCloud className="w-7 h-7" />
            </div>
            <span className="text-sm text-slate-700 font-semibold">点击上传</span>
            <span className="text-xs text-slate-400 mt-1 text-center px-2">或拖拽文件到这里</span>
         </label>

         {viewItems.map(item => {
             const isSelected = selection.has(item.key);
             return (
                 <div 
                    key={item.key} 
                    draggable={!isSelectionMode}
                    onDragStart={(e) => handleDragStart(e, item)}
                    onDragOver={item.isFolder ? handleDragOver : undefined}
                    onDrop={item.isFolder ? (e) => handleDropOnFolder(e, item.key) : undefined}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    onClick={() => {
                        if (isSelectionMode) toggleSelect(item.key);
                        else if (item.isFolder) setCurrentPath(item.key);
                        else window.open(api.getFileUrl(item.key), '_blank');
                    }}
                    className={`relative group flex flex-col items-center p-3 rounded-2xl border transition-all cursor-pointer aspect-[4/5] sm:aspect-auto sm:h-[180px]
                        ${isSelected 
                            ? 'border-blue-500 bg-blue-50/80 shadow-sm ring-1 ring-blue-500' 
                            : 'border-white bg-white hover:border-blue-200 hover:shadow-lg hover:-translate-y-1 shadow-sm'
                        }
                    `}
                 >
                    {(isSelectionMode || isSelected) && (
                        <div className="absolute top-3 right-3 z-10" onClick={(e) => { e.stopPropagation(); toggleSelect(item.key); }}>
                            {isSelected ? <CheckSquare className="w-5 h-5 text-blue-600 fill-white rounded" /> : <Square className="w-5 h-5 text-slate-300 fill-white" />}
                        </div>
                    )}

                    <div className="flex-1 w-full flex items-center justify-center overflow-hidden py-2">
                        {item.isFolder ? (
                            <Folder className="w-20 h-20 text-blue-400/80 fill-blue-400/20 drop-shadow-sm transition-transform group-hover:scale-105" />
                        ) : item.type.startsWith('image/') ? (
                            <img src={api.getFileUrl(item.key)} className="w-full h-full object-contain rounded-lg drop-shadow-sm transition-transform group-hover:scale-105" loading="lazy" />
                        ) : (
                            <FileText className="w-16 h-16 text-slate-300 transition-transform group-hover:scale-105" />
                        )}
                    </div>
                    
                    <div className="w-full text-center px-1 mb-1">
                        <div className="text-xs sm:text-sm font-medium text-slate-700 truncate w-full mb-0.5" title={item.name}>{item.name}</div>
                        {!item.isFolder && <div className="text-[10px] text-slate-400">{(item.size / 1024).toFixed(0)} KB</div>}
                    </div>

                    {/* 桌面端悬浮菜单 */}
                    <div className="sm:flex hidden absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur rounded-lg shadow-sm border border-slate-100 p-1 gap-1" onClick={e => e.stopPropagation()}>
                        {!item.isFolder && (
                            <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(api.getFileUrl(item.key)); toast.success('已复制直链'); }} className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-blue-600" title="复制直链">
                                <LinkIcon className="w-3.5 h-3.5" />
                            </button>
                        )}
                        <button onClick={() => handleCut(item.key)} className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-orange-600" title="剪切">
                             <Scissors className="w-3.5 h-3.5" />
                        </button>
                    </div>
                 </div>
             );
         })}
      </div>

      {/* 右键菜单 (Context Menu) */}
      {contextMenu.visible && (
          <div 
             ref={contextMenuRef}
             className="fixed z-50 bg-white/95 backdrop-blur rounded-xl shadow-xl border border-slate-100 w-48 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
             style={{ top: contextMenu.y, left: contextMenu.x }}
             onClick={(e) => e.stopPropagation()}
          >
              <div className="px-3 py-2 border-b border-slate-50 text-xs text-slate-400 font-medium truncate">
                  {contextMenu.item?.name}
              </div>
              
              {!contextMenu.item?.isFolder && (
                <>
                  <button onClick={() => { window.open(api.getFileUrl(contextMenu.item.key), '_blank'); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                      <FileText className="w-4 h-4" /> 打开
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(api.getFileUrl(contextMenu.item.key)); toast.success('直链已复制'); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                      <LinkIcon className="w-4 h-4" /> 复制直链
                  </button>
                </>
              )}
              
              <button onClick={() => { handleCut(contextMenu.item.key); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2">
                  <Scissors className="w-4 h-4" /> 剪切移动
              </button>
              
              <div className="h-px bg-slate-100 my-1"></div>
              
              <button onClick={() => { handleBatchDelete([contextMenu.item.key]); setContextMenu({...contextMenu, visible: false}); }} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> 删除
              </button>
          </div>
      )}
    </div>
  );
}
