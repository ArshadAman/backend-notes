exports.handler = async () => {
    const username = 'the.he24';
    const endpoint = `https://www.instagram.com/${username}/`;

    const extractMetaContent = (html, key) => {
        const patterns = [
            new RegExp(`<meta[^>]*property=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
            new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${key}["'][^>]*>`, 'i'),
            new RegExp(`<meta[^>]*name=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
            new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${key}["'][^>]*>`, 'i')
        ];

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) return match[1];
        }

        return null;
    };

    try {
        const response = await fetch(endpoint, {
            headers: {
                'accept': 'text/html,application/xhtml+xml'
            }
        });

        if (!response.ok) {
            throw new Error(`Instagram API request failed with ${response.status}`);
        }

        const html = await response.text();
        const descriptionRaw = extractMetaContent(html, 'og:description');
        if (!descriptionRaw) {
            throw new Error('Could not parse profile description');
        }

        const description = descriptionRaw.replace(/&#064;/g, '@');
        const countMatch = description.match(/([\d,.]+)\s+Followers,\s+([\d,.]+)\s+Following/i);
        if (!countMatch) {
            throw new Error('Could not parse followers/following counts');
        }

        const followers = Number(countMatch[1].replace(/,/g, ''));
        const following = Number(countMatch[2].replace(/,/g, ''));

        const avatarRaw = extractMetaContent(html, 'og:image');
        const avatar = avatarRaw ? avatarRaw.replace(/&amp;/g, '&') : null;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=60, s-maxage=60',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                followers,
                following,
                avatar,
                fetchedAt: new Date().toISOString()
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Unable to fetch Instagram stats',
                details: error.message
            })
        };
    }
};
