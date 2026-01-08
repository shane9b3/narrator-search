// netlify/functions/proxy.js
// A CORS proxy you control - no more relying on flaky public proxies

exports.handler = async (event) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    // Get the URL to fetch from query param
    const targetUrl = event.queryStringParameters?.url;
    
    if (!targetUrl) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing ?url= parameter' })
        };
    }

    // Validate URL
    let parsedUrl;
    try {
        parsedUrl = new URL(targetUrl);
    } catch (e) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Invalid URL' })
        };
    }

    // Block certain domains for safety
    const blockedDomains = ['localhost', '127.0.0.1', '0.0.0.0'];
    if (blockedDomains.some(d => parsedUrl.hostname.includes(d))) {
        return {
            statusCode: 403,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Domain not allowed' })
        };
    }

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'follow',
        });

        const contentType = response.headers.get('content-type') || 'text/plain';
        
        // For images, return base64
        if (contentType.startsWith('image/')) {
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            return {
                statusCode: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contentType,
                    base64: `data:${contentType};base64,${base64}`
                })
            };
        }

        // For text/html, return as text
        const text = await response.text();
        
        return {
            statusCode: response.status,
            headers: {
                ...corsHeaders,
                'Content-Type': contentType.startsWith('application/json') ? 'application/json' : 'text/plain'
            },
            body: text
        };

    } catch (error) {
        console.error('Proxy error:', error);
        return {
            statusCode: 502,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: 'Failed to fetch',
                message: error.message 
            })
        };
    }
};
