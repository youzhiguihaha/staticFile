// Cloudflare Pages Function - 文件上传接口
// 需要绑定 KV 命名空间: FILES_KV

interface Env {
  FILES_KV: KVNamespace;
  AUTH_PASSWORD: string;
}

interface FileMetadata {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  uploadTime: number;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const formData = await context.request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: '没有文件' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const fileId = generateId();
    const fileBuffer = await file.arrayBuffer();
    
    // 存储文件内容到 KV
    await context.env.FILES_KV.put(`file:${fileId}`, fileBuffer, {
      metadata: {
        name: file.name,
        type: file.type,
        size: file.size
      }
    });

    // 构建文件 URL
    const url = new URL(context.request.url);
    const fileUrl = `${url.origin}/api/file/${fileId}`;

    // 创建文件元数据
    const fileMetadata: FileMetadata = {
      id: fileId,
      name: file.name,
      url: fileUrl,
      size: file.size,
      type: file.type || 'application/octet-stream',
      uploadTime: Date.now()
    };

    // 获取现有文件列表
    const existingList = await context.env.FILES_KV.get('file_list', 'json') as FileMetadata[] || [];
    existingList.unshift(fileMetadata);
    
    // 更新文件列表
    await context.env.FILES_KV.put('file_list', JSON.stringify(existingList));

    return new Response(JSON.stringify({ 
      success: true, 
      file: fileMetadata,
      message: '上传成功' 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      message: '上传失败' 
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
};
