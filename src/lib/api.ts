export const getAuthHeaders = () => {
  const password = localStorage.getItem('site_password');
  return {
    'Authorization': `Bearer ${password}`,
  };
};

export const API_BASE = '/api';
