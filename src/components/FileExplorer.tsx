import { useState, useMemo } from 'react';
import { FileItem, api } from '../lib/api';
import { Folder, FileText, Download, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, Square, Copy, Link as LinkIcon, UploadCloud } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  files: FileItem[];
  onReload: () => void;
  onUpload: (files: File[], path: string) => void;
}

export function FileExplorer({ files, onReload, onUpload }: Props) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // --- 列表处理逻辑 ---
  const viewItems = useMemo(() => {
    if (searchQuery) {
        return files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }

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

  // --- 操作 ---
  const handleCreateFolder = async () => {
    const name = prompt('请输入文件夹名称:');
    if (!name) return;
    const cleanName = name.replace(/[\/\\]/g, '');
    try {
        await api.createFolder(currentPath + cleanName);
        toast.success('文件夹创建成功');
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

  const toggleSelect = (key: string) => {
    const newSet = new Set(selection);
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
    setSelection(newSet);
  };

  const handleCopyLink = (key: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const url = api.getFileUrl(key);
      navigator.clipboard.writeText(url);
      toast.success('直链已复制');
  };

  const handleItemClick = (item: any) => {
    if (isSelectionMode) {
        toggleSelect(item.key);
    } else if (item.isFolder) {
        setCurrentPath(item.key);
    } else {
        window.open(api.getFileUrl(item.key), '_blank');
    }
  };

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean);
    let pathAcc = '';
    return parts.map(part => { pathAcc += part + '/'; return { name: part, path: pathAcc }; });
  }, [currentPath]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[500px] flex flex-col"
         onDragOver={e => e.preventDefault()} 
         onDrop={e => { e.preventDefault(); if(e.dataTransfer.files.length) onUpload(Array.from(e.dataTransfer.files), currentPath); }}>
      
      {/* 顶部工具栏 */}
      <div className="p-3 border-b border-gray-100 flex flex-wrap gap-2 items-center justify-between bg-gray-50/50">
         <div className="flex items-center gap-1 overflow-hidden">
            {currentPath && (
                <button onClick={() => setCurrentPath(currentPath.split('/').slice(0, -2).join('/') + (currentPath.split('/').length > 2 ? '/' : ''))} className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"><ArrowLeft className="w-4 h-4 text-gray-600" /></button>
            )}
            <div className="flex items-center text-sm text-gray-700 font-medium whitespace-nowrap overflow-x-auto no-scrollbar px-1">
                <span className={`cursor-pointer hover:text-blue-600 px-1 rounded hover:bg-gray-200/50 ${!currentPath ? 'text-blue-600':''}`} onClick={() => setCurrentPath('')}>根目录</span>
                {breadcrumbs.map(b => (
                    <div key={b.path} className="flex items-center">
                        <span className="text-gray-300 mx-0.5">/</span>
                        <span className="cursor-pointer hover:text-blue-600 px-1 rounded hover:bg-gray-200/50" onClick={() => setCurrentPath(b.path)}>{b.name}</span>
                    </div>
                ))}
            </div>
         </div>

         <div className="flex items-center gap-2 flex-1 justify-end">
            <div className="relative max-w-[140px] sm:max-w-[200px]">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="搜索..." className="w-full pl-8 pr-3 py-1.5 text-xs sm:text-sm bg-white border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <button onClick={handleCreateFolder} className="p-2 text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-md transition-colors"><FolderPlus className="w-5 h-5" /></button>
            <button onClick={() => { setIsSelectionMode(!isSelectionMode); setSelection(new Set()); }} className={`p-2 rounded-md transition-colors ${isSelectionMode ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}><CheckSquare className="w-5 h-5" /></button>
            {selection.size > 0 && (
                <button onClick={() => handleBatchDelete()} className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-xs sm:text-sm font-medium hover:bg-red-100"><Trash2 className="w-4 h-4" /> 删除({selection.size})</button>
            )}
         </div>
      </div>

      {/* 文件网格 */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 content-start flex-1">
         {/* 上传卡片 */}
         <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-blue-200 rounded-xl bg-blue-50/20 hover:bg-blue-50 cursor-pointer group transition-all aspect-square sm:aspect-auto sm:h-[160px]">
            <input type="file" multiple className="hidden" onChange={e => e.target.files && onUpload(Array.from(e.target.files), currentPath)} />
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-6 h-6 text-blue-600" />
            </div>
            <span className="text-sm text-blue-700 font-semibold">点击上传</span>
            <span className="text-xs text-blue-400 mt-1">支持拖拽</span>
         </label>

         {/* 列表项 */}
         {viewItems.map(item => {
             const isSelected = selection.has(item.key);
             return (
                 <div key={item.key} onClick={() => handleItemClick(item)}
                    className={`relative group flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer hover:shadow-md aspect-square sm:aspect-auto sm:h-[160px]
                        ${isSelected ? 'border-blue-500 bg-blue-50/50' : 'border-gray-100 hover:border-gray-200 bg-white'}
                    `}
                 >
                    {/* 勾选框 */}
                    {(isSelectionMode || isSelected) && (
                        <div className="absolute top-2 right-2 z-20" onClick={(e) => { e.stopPropagation(); toggleSelect(item.key); }}>
                            {isSelected ? <CheckSquare className="w-5 h-5 text-blue-600 fill-white" /> : <Square className="w-5 h-5 text-gray-400 fill-white" />}
                        </div>
                    )}

                    {/* 图标区 */}
                    <div className="flex-1 w-full flex items-center justify-center overflow-hidden py-2">
                        {item.isFolder ? (
                            <Folder className="w-16 h-16 text-yellow-400 fill-yellow-400 drop-shadow-sm" />
                        ) : item.type.startsWith('image/') ? (
                            <img src={api.getFileUrl(item.key)} className="w-full h-full object-contain rounded-lg" loading="lazy" />
                        ) : (
                            <FileText className="w-12 h-12 text-gray-400" />
                        )}
                    </div>
                    
                    {/* 文字区 */}
                    <div className="w-full text-center px-1 mb-1">
                        <div className="text-xs font-medium text-gray-700 truncate w-full" title={item.name}>{item.name}</div>
                        {!item.isFolder && <div className="text-[10px] text-gray-400">{(item.size / 1024).toFixed(0)} KB</div>}
                    </div>

                    {/* 快捷操作栏 (悬浮显示) */}
                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur shadow-sm rounded-lg border border-gray-100 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10" onClick={e => e.stopPropagation()}>
                        {!item.isFolder && (
                            <button onClick={(e) => handleCopyLink(item.key, e)} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="复制直链">
                                <LinkIcon className="w-3.5 h-3.5" />
                            </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); handleBatchDelete([item.key]); }} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded" title="删除">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                 </div>
             );
         })}
      </div>
    </div>
  );
}
