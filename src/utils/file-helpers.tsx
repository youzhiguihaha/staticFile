import { 
  FileText, Image as ImageIcon, Film, Music, FileCode, FileArchive, 
  FileSpreadsheet, Presentation, FileType, Layout
} from 'lucide-react';

export function getFileIcon(type: string, name: string, className = "w-10 h-10") {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  
  // 基于扩展名的精细判断
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <FileArchive className={`${className} text-orange-500`} />;
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'py', 'go', 'java'].includes(ext)) return <FileCode className={`${className} text-emerald-500`} />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet className={`${className} text-green-600`} />;
  if (['ppt', 'pptx'].includes(ext)) return <Presentation className={`${className} text-red-500`} />;
  if (['pdf'].includes(ext)) return <FileType className={`${className} text-red-600`} />;
  
  // 基于 MIME 类型的兜底判断
  if (type.startsWith('image/')) return <ImageIcon className={`${className} text-purple-500`} />;
  if (type.startsWith('video/')) return <Film className={`${className} text-rose-500`} />;
  if (type.startsWith('audio/')) return <Music className={`${className} text-amber-500`} />;
  
  return <Layout className={`${className} text-slate-400`} />; // 默认未知文件
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let b = bytes;
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(1)} ${units[i]}`;
}

export function formatTime(ts?: number) {
  if (!ts) return '-';
  const now = new Date();
  const date = new Date(ts);
  // 简单的日期人性化
  const diff = now.getTime() - date.getTime();
  const dayMs = 24 * 3600 * 1000;
  
  if (diff < dayMs && now.getDate() === date.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < dayMs * 2) {
    return '昨天';
  }
  return date.toLocaleDateString(); // 仅显示日期
}