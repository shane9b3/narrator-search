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
        const prompt = `Research the audiobook narrator "${narratorName}" using web search.

Find information about:
- Their narration career and experience
- Notable audiobooks they've narrated
- Any awards (Audie Awards, Earphones Awards, AudioFile Golden Voice, etc.)
- Their voice style and genres they specialize in
- Background (acting experience, training, etc.)

Then write a professional 3-4 sentence biography suitable for an audiobook platform like Audible or Libro.fm.

Guidelines:
- Use a warm, professional tone
- Focus on their audiobook narration career
- Only include facts you can verify from search results
- Start directly with the bio (don't start with the narrator's name as the first word)
- Do NOT include any source citations or URLs in the bio text itself

After the bio, on a new line, list any source URLs you found (one per line, prefixed with "SOURCE: ").`;

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
            const errorData = await geminiResponse.json();
            console.error('Gemini API Error:', errorData);
            return {
                statusCode: geminiResponse.status,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ 
                    error: errorData.error?.message || 'Gemini API error',
                    details: errorData
                })
            };
        }

        const data = await geminiResponse.json();
        
        // Extract the generated text
        let generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        
        if (!generatedText) {
            return {
                statusCode: 500,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'No response generated from Gemini' })
            };
        }

        // Check for grounding metadata
        const groundingMetadata = data.candidates?.[0]?.groundingMetadata;
        const groundingChunks = groundingMetadata?.groundingChunks || [];
        const webSearchQueries = groundingMetadata?.webSearchQueries || [];
        
        // Extract sources from grounding metadata
        let sources = [];
        if (groundingChunks.length > 0) {
            sources = groundingChunks
                .filter(chunk => chunk.web?.uri)
                .map(chunk => ({
                    url: chunk.web.uri,
                    title: chunk.web.title || ''
                }));
        }

        // Parse bio and any inline sources from text
        let bio = generatedText;
        const inlineSources = [];
        
        // Check for SOURCE: lines at end
        const sourcePattern = /\n\s*SOURCE:\s*(https?:\/\/[^\s]+)/gi;
        let match;
        while ((match = sourcePattern.exec(generatedText)) !== null) {
            inlineSources.push(match[1]);
        }
        
        // Remove source lines from bio
        bio = bio.replace(/\n\s*SOURCE:.*$/gim, '').trim();
        
        // Also try to split on common source section headers
        const sourceSectionPatterns = [
            /\n\n(?:Sources?|References?|Citations?):\s*\n/i,
            /\n\n\*\*(?:Sources?|References?)\*\*\s*\n/i,
            /\n---\n/,
        ];
        
        for (const pattern of sourceSectionPatterns) {
            if (pattern.test(bio)) {
                const parts = bio.split(pattern);
                bio = parts[0].trim();
                break;
            }
        }
        
        // Clean up the bio
        bio = bio
            .replace(/\*\*/g, '')      // Remove bold
            .replace(/\*/g, '')        // Remove italic
            .replace(/^#+\s*/gm, '')   // Remove headers
            .replace(/\[\d+\]/g, '')   // Remove citation numbers
            .trim();
        
        // If bio is too long, try to get first paragraph or trim sentences
        const paragraphs = bio.split(/\n\n+/);
        if (paragraphs[0].length >= 150 && paragraphs[0].length <= 800) {
            bio = paragraphs[0];
        } else if (bio.length > 1000) {
            const sentences = bio.match(/[^.!?]+[.!?]+/g) || [bio];
            bio = sentences.slice(0, 4).join(' ').trim();
        }

        // Combine all sources
        const allSources = [
            ...sources.map(s => s.url),
            ...inlineSources
        ].filter((url, index, self) => self.indexOf(url) === index); // Dedupe

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                bio: bio,
                sources: allSources,
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
            body: JSON.stringify({ error: error.message })
        };
    }
};
