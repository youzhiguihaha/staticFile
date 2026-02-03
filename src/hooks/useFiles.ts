import { useState, useCallback } from 'react';
import type { FileItem } from '../types';

export function useFiles(token: string | null) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (!token) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/files', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      }
    } catch (error) {
      console.error('Fetch files error:', error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const uploadFile = useCallback(async (file: File): Promise<FileItem | null> => {
    if (!token) return null;
    
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      
      if (response.ok) {
        const data = await response.json();
        const newFile: FileItem = data.file;
        setFiles(prev => [newFile, ...prev]);
        return newFile;
      }
      return null;
    } catch (error) {
      console.error('Upload error:', error);
      return null;
    } finally {
      setUploading(false);
    }
  }, [token]);

  const deleteFile = useCallback(async (fileId: string): Promise<boolean> => {
    if (!token) return false;
    
    try {
      const response = await fetch(`/api/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        setFiles(prev => prev.filter(f => f.id !== fileId));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Delete error:', error);
      return false;
    }
  }, [token]);

  return {
    files,
    loading,
    uploading,
    fetchFiles,
    uploadFile,
    deleteFile
  };
}
