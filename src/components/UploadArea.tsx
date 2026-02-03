import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/api';

interface UploadAreaProps {
  onUploadComplete: () => void;
}

export function UploadArea({ onUploadComplete }: UploadAreaProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0); // Fake progress for better UX

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setUploading(true);
    setProgress(10);
    const file = acceptedFiles[0];

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Simulate progress
      const interval = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? prev : prev + 10));
      }, 200);

      const res = await fetch('/api/upload', {
        method: 'PUT',
        headers: {
            ...getAuthHeaders(),
            'X-Custom-Filename': encodeURIComponent(file.name)
        },
        body: file, // For R2 put, sending raw body is often easier than FormData if we handle just one file
      });

      clearInterval(interval);

      if (!res.ok) {
        throw new Error('Upload failed');
      }

      setProgress(100);
      toast.success('文件上传成功');
      onUploadComplete();
    } catch (error) {
      console.error(error);
      toast.error('上传文件失败');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }, [onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    multiple: false 
  });

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div
        {...getRootProps()}
        className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors
          ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}
          ${uploading ? 'pointer-events-none opacity-50' : ''}
        `}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <UploadCloud className={`w-10 h-10 mb-3 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} />
          <p className="mb-2 text-sm text-gray-500">
            <span className="font-semibold">点击上传</span> 或拖拽文件到这里
          </p>
          <p className="text-xs text-gray-500">支持任意文件类型 (建议最大 100MB)</p>
        </div>
        
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-lg">
             <div className="w-1/2 bg-gray-200 rounded-full h-2.5">
                <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                    style={{ width: `${progress}%` }}
                ></div>
             </div>
             <span className="ml-2 text-sm text-blue-600">{progress}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
