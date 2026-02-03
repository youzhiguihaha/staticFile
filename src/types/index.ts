export interface FileItem {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  uploadTime: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
}
