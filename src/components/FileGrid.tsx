import { FileItem, api } from '../lib/api';
import { File, Copy, Trash2, ExternalLink, Image as ImageIcon, Film, Music, FileText } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

interface FileGridProps {
  files: FileItem[];
  onDelete: (key: string) => void;
}

export function FileGrid({ files, onDelete }: FileGridProps) {
  const copyLink = (key: string) => {
    const url = api.getFileUrl(key);
    navigator.clipboard.writeText(url).then(() => {
      toast.success('链接已复制到剪贴板');
    });
  };

  const getIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="h-8 w-8 text-purple-500" />;
    if (type.startsWith('video/')) return <Film className="h-8 w-8 text-red-500" />;
    if (type.startsWith('audio/')) return <Music className="h-8 w-8 text-yellow-500" />;
    if (type.startsWith('text/')) return <FileText className="h-8 w-8 text-gray-500" />;
    return <File className="h-8 w-8 text-blue-500" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (files.length === 0) {
    return (
        <div className="text-center py-12">
            <p className="text-gray-500">暂无文件，请上传。</p>
        </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {files.map((file) => (
        <div key={file.key} className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-center space-x-3 truncate">
                <div className="flex-shrink-0 rounded-lg bg-gray-50 p-2">
                    {getIcon(file.type)}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900" title={file.name}>{file.name}</p>
                    <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                </div>
             </div>
          </div>
          
          {/* Preview Area (if image) */}
          {file.type.startsWith('image/') && (
             <div className="relative mb-4 h-32 w-full overflow-hidden rounded-lg bg-gray-100">
                <img 
                    src={api.getFileUrl(file.key)} 
                    alt={file.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                    }}
                />
             </div>
          )}

          <div className="mt-auto flex items-center justify-between border-t border-gray-100 pt-4 text-xs text-gray-500">
             <span>{format(file.uploadedAt, 'yyyy-MM-dd')}</span>
             <div className="flex space-x-1">
                <button
                  onClick={() => copyLink(file.key)}
                  className="rounded-full p-2 hover:bg-gray-100 text-gray-600 hover:text-blue-600 transition-colors"
                  title="复制直链"
                >
                    <Copy className="h-4 w-4" />
                </button>
                <a
                  href={api.getFileUrl(file.key)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full p-2 hover:bg-gray-100 text-gray-600 hover:text-blue-600 transition-colors"
                  title="新标签页打开"
                >
                    <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={() => onDelete(file.key)}
                  className="rounded-full p-2 hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
                  title="删除文件"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
             </div>
          </div>
        </div>
      ))}
    </div>
  );
}
