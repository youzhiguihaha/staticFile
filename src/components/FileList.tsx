import { useState } from 'react';
import type { FileItem } from '../types';

interface FileListProps {
  files: FileItem[];
  loading: boolean;
  onDelete: (fileId: string) => Promise<boolean>;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function getFileIcon(type: string): string {
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('pdf')) return '📄';
  if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return '📦';
  if (type.includes('text') || type.includes('document')) return '📝';
  return '📁';
}

export function FileList({ files, loading, onDelete }: FileListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const copyToClipboard = async (file: FileItem) => {
    try {
      await navigator.clipboard.writeText(file.url);
      setCopiedId(file.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm('确定要删除这个文件吗？')) return;
    
    setDeletingId(fileId);
    await onDelete(fileId);
    setDeletingId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="animate-spin h-10 w-10 text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-gray-500 text-lg">暂无文件</p>
        <p className="text-gray-400 text-sm mt-1">上传文件后将显示在这里</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {files.map((file) => (
        <div
          key={file.id}
          className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-lg hover:border-blue-200 transition-all group"
        >
          <div className="flex items-center gap-4">
            {/* File Icon / Preview */}
            <div className="w-14 h-14 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
              {file.type.startsWith('image/') ? (
                <img src={file.url} alt={file.name} className="w-full h-full object-cover rounded-xl" />
              ) : (
                <span className="text-2xl">{getFileIcon(file.type)}</span>
              )}
            </div>

            {/* File Info */}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-gray-800 truncate" title={file.name}>
                {file.name}
              </h3>
              <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                <span>{formatFileSize(file.size)}</span>
                <span>•</span>
                <span>{formatDate(file.uploadTime)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => copyToClipboard(file)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
                  ${copiedId === file.id 
                    ? 'bg-green-100 text-green-600' 
                    : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                  }`}
              >
                {copiedId === file.id ? '已复制!' : '复制链接'}
              </button>
              <button
                onClick={() => handleDelete(file.id)}
                disabled={deletingId === file.id}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-all disabled:opacity-50"
              >
                {deletingId === file.id ? '删除中...' : '删除'}
              </button>
            </div>
          </div>

          {/* URL Display */}
          <div className="mt-3 p-2 bg-gray-50 rounded-lg">
            <code className="text-xs text-gray-500 break-all">{file.url}</code>
          </div>
        </div>
      ))}
    </div>
  );
}
