export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Reverse proxy for backend API routes and static media files
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
      const backendUrl = (env.BACKEND_URL || env.VITE_API_URL || '').replace(/\/$/, '');

      if (!backendUrl) {
        return new Response(JSON.stringify({
          success: false,
          error: "Backend server is not configured. Please add BACKEND_URL in Cloudflare Worker Settings or configure your Server URL in the dashboard settings."
        }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }

      // Handle CORS preflight options
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }

      // Forward request to backend
      const targetUrl = new URL(url.pathname + url.search, backendUrl);
      const newHeaders = new Headers(request.headers);
      newHeaders.set('host', targetUrl.host);

      try {
        const proxyResponse = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: newHeaders,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'follow'
        });

        // Ensure CORS headers on proxy response
        const respHeaders = new Headers(proxyResponse.headers);
        respHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(proxyResponse.body, {
          status: proxyResponse.status,
          statusText: proxyResponse.statusText,
          headers: respHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({
          success: false,
          error: `Could not reach backend at ${backendUrl}: ${err.message}`
        }), {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }

    // Default: serve frontend static assets
    return env.ASSETS.fetch(request);
  }
};
