import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { Exa } from 'exa-js'

export function createWebAgentTools() {
  const webSearch = defineTool({
    name: 'web_search',
    label: 'Web Search',
    description: 'Search the web for current information, news, documentation, or any topic not in the wiki or email.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
    }),
    async execute(_toolCallId: string, params: { query: string }) {
      const apiKey = process.env.EXA_API_KEY
      if (!apiKey) throw new Error('EXA_API_KEY is not set')
      const exa = new Exa(apiKey)
      const result = await exa.search(params.query, {
        type: 'auto',
        numResults: 8,
        contents: { highlights: { maxCharacters: 4000 } },
      })
      const formatted = result.results
        .map((r) => `### ${r.title}\n${r.url}\n${r.highlights?.join('\n') ?? ''}`)
        .join('\n\n')
      return {
        content: [{ type: 'text' as const, text: formatted || 'No results found.' }],
        details: {},
      }
    },
  })

  const fetchPage = defineTool({
    name: 'fetch_page',
    label: 'Fetch Page',
    description: 'Fetch the full content of a URL as markdown. Use when the user shares a link or when web_search finds a relevant page you need to read in full.',
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
    }),
    async execute(_toolCallId: string, params: { url: string }) {
      const apiKey = process.env.SUPADATA_API_KEY
      if (!apiKey) throw new Error('SUPADATA_API_KEY is not set')
      const res = await fetch(
        `https://api.supadata.ai/v1/web/scrape?url=${encodeURIComponent(params.url)}`,
        { headers: { 'x-api-key': apiKey } }
      )
      if (!res.ok) throw new Error(`Supadata error: ${res.status} ${await res.text()}`)
      const data = await res.json() as { content: string; name?: string }
      const header = data.name ? `# ${data.name}\n\n` : ''
      return {
        content: [{ type: 'text' as const, text: header + (data.content || '(empty)') }],
        details: {},
      }
    },
  })

  const getYoutubeTranscript = defineTool({
    name: 'get_youtube_transcript',
    label: 'Get YouTube Transcript',
    description: 'Get the transcript of a YouTube video. Use for summarizing, quoting, or ingesting video content.',
    parameters: Type.Object({
      url: Type.String({ description: 'YouTube video URL or video ID' }),
      lang: Type.Optional(Type.String({ description: 'Language code (e.g. "en"). Defaults to English.' })),
    }),
    async execute(_toolCallId: string, params: { url: string; lang?: string }) {
      const apiKey = process.env.SUPADATA_API_KEY
      if (!apiKey) throw new Error('SUPADATA_API_KEY is not set')
      const qs = new URLSearchParams({ url: params.url })
      if (params.lang) qs.set('lang', params.lang)
      const res = await fetch(
        `https://api.supadata.ai/v1/youtube/transcript?${qs}`,
        { headers: { 'x-api-key': apiKey } }
      )
      if (!res.ok) throw new Error(`Supadata error: ${res.status} ${await res.text()}`)
      const data = await res.json() as { content: { text: string }[] | string; lang?: string }
      const text = Array.isArray(data.content)
        ? data.content.map((s) => s.text).join(' ')
        : (data.content ?? '(no transcript)')
      return {
        content: [{ type: 'text' as const, text }],
        details: { lang: data.lang },
      }
    },
  })

  const youtubeSearch = defineTool({
    name: 'youtube_search',
    label: 'YouTube Search',
    description: 'Search YouTube for videos on a topic. Returns titles, channels, and URLs.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      limit: Type.Optional(Type.Number({ description: 'Max results (default 5)' })),
    }),
    async execute(_toolCallId: string, params: { query: string; limit?: number }) {
      const apiKey = process.env.SUPADATA_API_KEY
      if (!apiKey) throw new Error('SUPADATA_API_KEY is not set')
      const qs = new URLSearchParams({ query: params.query, limit: String(params.limit ?? 5) })
      const res = await fetch(
        `https://api.supadata.ai/v1/youtube/search?${qs}`,
        { headers: { 'x-api-key': apiKey } }
      )
      if (!res.ok) throw new Error(`Supadata error: ${res.status} ${await res.text()}`)
      const data = await res.json() as { items: { videoId: string; title: string; channelTitle: string }[] }
      const formatted = (data.items ?? [])
        .map((v) => `- [${v.title}](https://youtube.com/watch?v=${v.videoId}) — ${v.channelTitle}`)
        .join('\n')
      return {
        content: [{ type: 'text' as const, text: formatted || 'No results found.' }],
        details: {},
      }
    },
  })


  return { webSearch, fetchPage, getYoutubeTranscript, youtubeSearch }
}
