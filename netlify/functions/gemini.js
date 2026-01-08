// netlify/functions/gemini.js
// Gemini API with Google Search Grounding for narrator bio research

exports.handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'GEMINI_API_KEY not configured in Netlify environment variables' })
        };
    }

    try {
        const requestBody = JSON.parse(event.body);
        const narratorName = requestBody.narratorName;

        if (!narratorName) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'narratorName is required' })
            };
        }

        // Build the research prompt
        const prompt = `You are a professional bio writer. Research audiobook narrator "${narratorName}" and write their biography.

SEARCH FOR:
- Narration career and experience
- Notable audiobooks narrated
- Awards (Audie Awards, Earphones Awards, AudioFile Golden Voice, etc.)
- Voice style and genre specialties
- Background (acting, training, etc.)

STRICT OUTPUT RULES:
1. Output ONLY the biography text - no introductions like "Here is" or explanations
2. Write exactly 3-4 sentences
3. Do NOT start with the narrator's name as the first word
4. Use warm, professional tone suitable for Audible or Libro.fm
5. No citation numbers like [1] or [2]
6. No source URLs in the text

RESPOND WITH ONLY THE BIO TEXT, NOTHING ELSE.`;

        // Call Gemini API with Google Search grounding
        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    tools: [{
                        googleSearch: {}  // Enable Google Search grounding!
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 1000,
                    }
                })
            }
        );

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('Gemini API Error Response:', errorText);
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { message: errorText };
            }
            return {
                statusCode: geminiResponse.status,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ 
                    error: errorData.error?.message || errorData.message || 'Gemini API error',
                    details: errorData
                })
            };
        }

        const data = await geminiResponse.json();
        
        // Log full response for debugging
        console.log('Full Gemini Response:', JSON.stringify(data, null, 2));
        
        // CORRECT PATH: candidates[0].content.parts[0].text
        const candidate = data.candidates?.[0];
        if (!candidate) {
            return {
                statusCode: 500,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ 
                    error: 'No candidates in response',
                    rawResponse: data
                })
            };
        }
        
        // Get the text from content.parts[0].text
        const content = candidate.content;
        const parts = content?.parts;
        let generatedText = '';
        
        if (parts && parts.length > 0) {
            // Combine all text parts
            generatedText = parts
                .filter(part => part.text)
                .map(part => part.text)
                .join('\n')
                .trim();
        }
        
        if (!generatedText) {
            return {
                statusCode: 500,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ 
                    error: 'No text generated',
                    candidate: candidate,
                    rawResponse: data
                })
            };
        }

        // Check for grounding metadata
        const groundingMetadata = candidate.groundingMetadata;
        const groundingChunks = groundingMetadata?.groundingChunks || [];
        const webSearchQueries = groundingMetadata?.webSearchQueries || [];
        
        console.log('Grounding used:', groundingChunks.length > 0);
        console.log('Search queries:', webSearchQueries);
        
        // Extract sources from grounding metadata
        let sources = [];
        if (groundingChunks.length > 0) {
            sources = groundingChunks
                .filter(chunk => chunk.web?.uri)
                .map(chunk => ({
                    url: chunk.web.uri,
                    title: chunk.web.title || ''
                }));
            console.log('Sources found:', sources.length);
        }

        // Clean up the bio text
        let bio = generatedText;
        
        // Remove common AI preambles
        const preamblePatterns = [
            /^(?:Here(?:'s| is) (?:a |the )?(?:professional )?(?:biography|bio)[^:]*:\s*)/i,
            /^(?:Ok,?\s*)?(?:I got|Here's what I found|Here's|Here is)[^:]*:\s*/i,
            /^(?:Based on (?:the |your )?(?:provided |available )?(?:information|data|sources|my research|research)[^:]*:\s*)/i,
            /^(?:Sure[,!]?\s*)?(?:Here(?:'s| is)[^:]*:\s*)/i,
            /^(?:Certainly[,!]?\s*)?(?:Here(?:'s| is)[^:]*:\s*)/i,
            /^(?:After researching[^:]*:\s*)/i,
        ];
        
        for (const pattern of preamblePatterns) {
            bio = bio.replace(pattern, '');
        }
        
        // Remove citation numbers like [1], [2], etc.
        bio = bio.replace(/\[\d+\]/g, '');
        
        // Remove source lines if present
        bio = bio.replace(/\n\s*SOURCE:.*$/gim, '');
        bio = bio.replace(/\n\s*Sources?:[\s\S]*$/im, '');
        bio = bio.replace(/\n\s*References?:[\s\S]*$/im, '');
        
        // Remove markdown formatting
        bio = bio
            .replace(/\*\*/g, '')      // Remove bold
            .replace(/\*/g, '')        // Remove italic
            .replace(/^#+\s*/gm, '')   // Remove headers
            .trim();
        
        // If bio still starts with meta-text, find the actual bio content
        if (bio.toLowerCase().startsWith('here') || bio.toLowerCase().startsWith('ok') || bio.toLowerCase().startsWith('based on')) {
            const sentences = bio.split(/(?<=[.!?])\s+/);
            for (let i = 0; i < sentences.length; i++) {
                const s = sentences[i].toLowerCase();
                if (s.includes('narrator') || s.includes('voice') || s.includes('actor') || 
                    s.includes('audiobook') || s.includes('award') || s.includes('trained') ||
                    s.includes('acclaimed') || s.includes('known for')) {
                    bio = sentences.slice(i).join(' ');
                    break;
                }
            }
        }
        
        // If bio is too long, get first paragraph or trim
        if (bio.length > 1000) {
            const paragraphs = bio.split(/\n\n+/);
            if (paragraphs[0].length >= 150 && paragraphs[0].length <= 800) {
                bio = paragraphs[0];
            } else {
                const sentences = bio.match(/[^.!?]+[.!?]+/g) || [bio];
                bio = sentences.slice(0, 4).join(' ').trim();
            }
        }

        // Clean up extra whitespace
        bio = bio.replace(/\s+/g, ' ').trim();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                bio: bio,
                sources: sources.map(s => s.url),
                sourceTitles: sources.map(s => s.title),
                groundingUsed: groundingChunks.length > 0,
                searchQueries: webSearchQueries,
                model: 'gemini-2.0-flash'
            })
        };

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
                error: error.message,
                stack: error.stack
            })
        };
    }
};
