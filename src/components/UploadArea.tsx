import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';
import { cn } from '../utils/cn';

interface UploadAreaProps {
  onUpload: (files: File[]) => void;
  uploading: boolean;
}

export function UploadArea({ onUpload, uploading }: UploadAreaProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onUpload(acceptedFiles);
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, disabled: uploading });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center transition-colors hover:bg-gray-100 cursor-pointer",
        isDragActive && "border-blue-500 bg-blue-50",
        uploading && "opacity-50 cursor-not-allowed"
      )}
    >
      <input {...getInputProps()} />
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 mb-4">
        <UploadCloud className="h-8 w-8 text-blue-600" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900">
        {isDragActive ? '释放文件以上传' : '点击或拖拽文件到此处上传'}
      </h3>
      <p className="mt-2 text-sm text-gray-500">
        支持图片、视频、音频、文档等任意类型文件
      </p>
    </div>
  );
}
