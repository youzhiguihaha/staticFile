// Cloudflare Pages Function - 获取文件列表
// 需要绑定 KV 命名空间: FILES_KV

interface Env {
  FILES_KV: KVNamespace;
}

interface FileMetadata {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  uploadTime: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    // 验证 Authorization header
    const authHeader = context.request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: '未授权访问' 
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 获取文件列表
    const fileList = await context.env.FILES_KV.get('file_list', 'json') as FileMetadata[] || [];

    return new Response(JSON.stringify({ 
      success: true, 
      files: fileList 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error('Get files error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      message: '获取文件列表失败' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
};
