interface Env {
  FILES_KV: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return new Response(JSON.stringify({ success: false, message: '没有文件' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    const metadata = {
      id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };

    await env.FILES_KV.put(`file:${id}`, base64);
    await env.FILES_KV.put(`meta:${id}`, JSON.stringify(metadata));

    const existingList = await env.FILES_KV.get('file_list');
    const fileList: string[] = existingList ? JSON.parse(existingList) : [];
    fileList.unshift(id);
    await env.FILES_KV.put('file_list', JSON.stringify(fileList));

    const url = new URL(request.url);
    const fileUrl = `${url.origin}/api/file/${id}`;

    return new Response(JSON.stringify({ 
      success: true, 
      file: { ...metadata, url: fileUrl }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: '上传失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
};
