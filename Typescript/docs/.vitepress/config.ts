import { defineConfig } from 'vitepress';

const base = process.env.VITEPRESS_BASE || '/netget/Typescript/typedocs/';

export default defineConfig({
  title: 'netget',
  description: 'A Gateway To the Web. Routes hostnames to monads via OpenResty.',
  base,
  outDir: '../typedocs',
  appearance: 'force-dark',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'API', link: 'https://neurons-me.github.io/netget/Typescript/typedocs/api/' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Architecture', link: '/Architecture' },
          { text: 'Domain Map', link: '/DomainMap' },
          { text: 'Placement', link: '/Placement' },
          { text: 'Custom Domains', link: '/custom-domains' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/neurons-me/netget' }],
  },
});
