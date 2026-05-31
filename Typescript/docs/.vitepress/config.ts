import { defineConfig } from 'vitepress';

const base = process.env.VITEPRESS_BASE || '/netget/typedocs/';

export default defineConfig({
  title: 'netget',
  description: 'Physical gateway for the sovereign web. Routes domains to monads. Resolves where execution lives.',
  base,
  outDir: '../typedocs',
  appearance: 'force-dark',
  head: [
    ['meta', { name: 'author', content: 'neurons.me' }],
    ['meta', { name: 'keywords', content: 'netget, gateway, openresty, domain routing, monad placement, neurons.me' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'netget — Documentation' }],
    ['meta', { property: 'og:description', content: 'Physical gateway for the sovereign web. Routes domains to monads.' }],
    ['meta', { property: 'og:url', content: 'https://neurons-me.github.io/netget/typedocs/' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'netget — Documentation' }],
    ['meta', { name: 'twitter:description', content: 'Physical gateway for the sovereign web. Routes domains to monads.' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Gateway', link: '/NetGet' },
      { text: 'Placement', link: '/Placement' },
      { text: 'Architecture', link: '/Architecture' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'The Gateway', link: '/NetGet' },
          { text: 'Monad Placement', link: '/Placement' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Architecture', link: '/Architecture' },
          { text: 'Domain Map', link: '/DomainMap' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/api/' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/neurons-me/netget' },
    ],
  },
});
