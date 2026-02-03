import { useEffect, useState } from 'react';
import { Copy, Trash2, FileText, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { getAuthHeaders } from '@/lib/api';

interface FileItem {
  key: string;
  size: number;
  uploaded: string; // ISO date
  url: string;
}

interface FileListProps {
  refreshTrigger: number;
}

export function FileList({ refreshTrigger }: FileListProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/list', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch files');
      const data = await res.json();
      setFiles(data.files || []);
    } catch (error) {
        console.error(error);
      toast.error('无法加载文件列表');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [refreshTrigger]);

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('直链已复制到剪贴板');
  };

  const deleteFile = async (key: string) => {
    if (!confirm('确定要删除这个文件吗？')) return;
    
    // Optimistic update
    const oldFiles = [...files];
    setFiles(files.filter(f => f.key !== key));

    try {
      const res = await fetch(`/api/delete?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('文件已删除');
    } catch (error) {
      setFiles(oldFiles);
      toast.error('删除文件失败');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isImage = (filename: string) => {
      return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename);
  };

  if (loading && files.length === 0) {
    return (
        <div className="flex justify-center p-12">
            <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
        </div>
    );
  }

  if (files.length === 0) {
      return (
          <div className="text-center p-12 text-gray-500">
              暂无上传文件。
          </div>
      );
  }

  return (
    <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
      <ul className="divide-y divide-gray-200">
        {files.map((file) => (
          <li key={file.key} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-center min-w-0 flex-1">
                <div className="flex-shrink-0 h-10 w-10 rounded bg-gray-100 flex items-center justify-center overflow-hidden">
                    {isImage(file.key) ? (
                        <img src={file.url} alt={file.key} className="h-full w-full object-cover" />
                    ) : (
                        <FileText className="h-5 w-5 text-gray-500" />
                    )}
                </div>
                <div className="ml-4 flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate" title={file.key}>{file.key}</p>
                    <p className="text-xs text-gray-500">
                        {formatSize(file.size)} • {file.uploaded ? format(new Date(file.uploaded), 'MMM d, yyyy HH:mm') : 'Unknown'}
                    </p>
                </div>
            </div>
            <div className="flex items-center space-x-2 ml-4">
                <a 
                    href={file.url} 
                    target="_blank" 
                    rel="noreferrer"
                    className="p-2 text-gray-400 hover:text-blue-600 rounded-full hover:bg-blue-50"
                    title="Open"
                >
                    <ExternalLink className="h-4 w-4" />
                </a>
                <button
                    onClick={() => copyLink(file.url)}
                    className="p-2 text-gray-400 hover:text-green-600 rounded-full hover:bg-green-50"
                    title="Copy Link"
                >
                    <Copy className="h-4 w-4" />
                </button>
                <button
                    onClick={() => deleteFile(file.key)}
                    className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50"
                    title="Delete"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
