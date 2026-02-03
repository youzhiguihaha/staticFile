interface Env {
  AUTH_PASSWORD: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const { password } = await request.json() as { password: string };
    const correctPassword = env.AUTH_PASSWORD || 'admin123';

    if (password === correctPassword) {
      const token = btoa(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
      return new Response(JSON.stringify({ success: true, token }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ success: false, message: '密码错误' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, message: '请求错误' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
