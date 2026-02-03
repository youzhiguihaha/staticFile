// Cloudflare Pages Function - 删除文件
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

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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

    const fileId = context.params.id as string;

    // 删除文件内容
    await context.env.FILES_KV.delete(`file:${fileId}`);

    // 更新文件列表
    const fileList = await context.env.FILES_KV.get('file_list', 'json') as FileMetadata[] || [];
    const updatedList = fileList.filter(f => f.id !== fileId);
    await context.env.FILES_KV.put('file_list', JSON.stringify(updatedList));

    return new Response(JSON.stringify({ 
      success: true, 
      message: '删除成功' 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      message: '删除失败' 
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
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
};
