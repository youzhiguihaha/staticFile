import { useState, useMemo } from 'react';
import { FileItem, api } from '../lib/api';
import { Folder, FileText, Download, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, Square } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  files: FileItem[];
  onReload: () => void;
  onUpload: (files: File[], path: string) => void;
}

export function FileExplorer({ files, onReload, onUpload }: Props) {
  const [currentPath, setCurrentPath] = useState<string>(''); // 当前路径，例如 "photos/2023/"
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // --- 核心逻辑：将扁平的文件列表转换为当前目录视图 ---
  const viewItems = useMemo(() => {
    if (searchQuery) {
        // 搜索模式：平铺展示所有匹配项
        return files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    const items: (FileItem & { isFolder?: boolean })[] = [];
    const processedFolders = new Set<string>();

    files.forEach(file => {
        // 检查文件是否在当前路径下
        if (!file.key.startsWith(currentPath)) return;

        // 获取相对于当前路径的剩余部分
        const relativeKey = file.key.slice(currentPath.length);
        const parts = relativeKey.split('/');

        if (parts.length === 1) {
            // 是当前目录下的文件
            if (relativeKey !== '') { // 排除文件夹本身的占位符 Key
                items.push(file);
            }
        } else {
            // 是当前目录下的子文件夹
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
    
    // 文件夹排在前面
    return items.sort((a, b) => (b.isFolder ? 1 : 0) - (a.isFolder ? 1 : 0) || b.uploadedAt - a.uploadedAt);
  }, [files, currentPath, searchQuery]);

  // --- 操作处理 ---

  const handleCreateFolder = async () => {
    const name = prompt('请输入文件夹名称:');
    if (!name) return;
    const cleanName = name.replace(/\//g, ''); // 禁止包含斜杠
    const newPath = currentPath + cleanName;
    try {
        await api.createFolder(newPath);
        toast.success('文件夹创建成功');
        onReload();
    } catch(e) { toast.error('创建失败'); }
  };

  const handleBatchDelete = async () => {
    if (selection.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selection.size} 项吗？(包含文件夹内所有内容)`)) return;
    
    try {
        await api.batchDelete(Array.from(selection));
        toast.success('删除成功');
        setSelection(new Set());
        setIsSelectionMode(false);
        onReload();
    } catch(e) { toast.error('删除失败'); }
  };

  const toggleSelect = (key: string) => {
    const newSet = new Set(selection);
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
    setSelection(newSet);
  };
  
  const handleItemClick = (item: any) => {
    if (isSelectionMode) {
        toggleSelect(item.key);
        return;
    }
    
    if (item.isFolder) {
        setCurrentPath(item.key);
        setSelection(new Set()); // 进入文件夹清空选择
    } else {
        // 复制链接
        const url = api.getFileUrl(item.key);
        navigator.clipboard.writeText(url);
        toast.success('直链已复制到剪贴板');
        window.open(url, '_blank');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) {
        onUpload(Array.from(e.dataTransfer.files), currentPath);
    }
  };

  // 面包屑导航
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean);
    let pathAcc = '';
    return parts.map(part => {
        pathAcc += part + '/';
        return { name: part, path: pathAcc };
    });
  }, [currentPath]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" 
         onDragOver={e => e.preventDefault()} 
         onDrop={handleDrop}>
      
      {/* 工具栏 */}
      <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center justify-between bg-gray-50/50">
         <div className="flex items-center gap-2 overflow-hidden">
            {currentPath && (
                <button onClick={() => setCurrentPath(currentPath.split('/').slice(0, -2).join('/') + (currentPath.split('/').length > 2 ? '/' : ''))} 
                        className="p-1 hover:bg-gray-200 rounded">
                    <ArrowLeft className="w-5 h-5 text-gray-600" />
                </button>
            )}
            <div className="flex items-center text-sm text-gray-600 font-medium whitespace-nowrap overflow-x-auto no-scrollbar">
                <span className={`cursor-pointer hover:text-blue-600 px-1 ${!currentPath ? 'text-blue-600 font-bold':''}`} onClick={() => setCurrentPath('')}>根目录</span>
                {breadcrumbs.map((b, i) => (
                    <div key={b.path} className="flex items-center">
                        <span className="mx-1 text-gray-400">/</span>
                        <span className="cursor-pointer hover:text-blue-600 px-1" onClick={() => setCurrentPath(b.path)}>{b.name}</span>
                    </div>
                ))}
            </div>
         </div>

         <div className="flex items-center gap-2 flex-1 justify-end">
            {/* 搜索框 */}
            <div className="relative group max-w-[150px] sm:max-w-[200px]">
                <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                <input 
                    type="text" 
                    placeholder="搜索文件..." 
                    className="w-full pl-8 pr-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
            </div>

            <button onClick={handleCreateFolder} className="p-2 text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors" title="新建文件夹">
                <FolderPlus className="w-5 h-5" />
            </button>
            
            <button 
                onClick={() => { setIsSelectionMode(!isSelectionMode); setSelection(new Set()); }}
                className={`p-2 rounded-lg transition-colors ${isSelectionMode ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                title="批量管理"
            >
                <CheckSquare className="w-5 h-5" />
            </button>

            {selection.size > 0 && (
                <button onClick={handleBatchDelete} className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors">
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">删除 ({selection.size})</span>
                </button>
            )}
         </div>
      </div>

      {/* 文件列表区域 */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 min-h-[300px]">
         {/* 上传按钮 (作为网格第一项) */}
         <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-blue-100 rounded-xl bg-blue-50/30 hover:bg-blue-50 cursor-pointer group transition-colors">
            <input type="file" multiple className="hidden" onChange={e => e.target.files && onUpload(Array.from(e.target.files), currentPath)} />
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                <Download className="w-5 h-5 text-blue-600 rotate-180" />
            </div>
            <span className="mt-2 text-xs text-blue-600 font-medium text-center">上传文件</span>
         </label>

         {viewItems.length === 0 && searchQuery && (
             <div className="col-span-full text-center py-10 text-gray-400 text-sm">未找到相关文件</div>
         )}

         {viewItems.map(item => {
             const isSelected = selection.has(item.key);
             return (
                 <div 
                    key={item.key}
                    onClick={() => handleItemClick(item)}
                    className={`relative group flex flex-col items-center p-3 rounded-xl border transition-all cursor-pointer select-none
                        ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-gray-50 hover:border-gray-200'}
                    `}
                 >
                    {/* 选择框 */}
                    {(isSelectionMode || isSelected) && (
                        <div className="absolute top-2 right-2 z-10 text-blue-600" onClick={(e) => { e.stopPropagation(); toggleSelect(item.key); }}>
                            {isSelected ? <CheckSquare className="w-5 h-5 fill-white" /> : <Square className="w-5 h-5 text-gray-400" />}
                        </div>
                    )}

                    {/* 图标 */}
                    <div className="w-14 h-14 mb-3 flex items-center justify-center rounded-lg bg-white shadow-sm border border-gray-100 group-hover:shadow-md transition-shadow overflow-hidden">
                        {item.isFolder ? (
                            <Folder className="w-8 h-8 text-yellow-400 fill-yellow-400" />
                        ) : item.type.startsWith('image/') ? (
                            <img src={api.getFileUrl(item.key)} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                            <FileText className="w-8 h-8 text-gray-400" />
                        )}
                    </div>
                    
                    {/* 文件名 */}
                    <span className="text-xs text-gray-700 font-medium text-center truncate w-full px-1" title={item.name}>
                        {item.name}
                    </span>
                    
                    {/* 大小/时间 */}
                    <span className="text-[10px] text-gray-400 mt-1">
                        {item.isFolder ? '目录' : (item.size / 1024).toFixed(1) + ' KB'}
                    </span>
                 </div>
             );
         })}
      </div>
    </div>
  );
}
