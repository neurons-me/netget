import { defineConfig } from 'vitepress';

const base = process.env.VITEPRESS_BASE || '/netget/Typescript/typedocs/';

export default defineConfig({
  title: 'netget',
  description: 'A Gateway To the Web. Routes hostnames to monads via OpenResty.',
  base,
  outDir: '../typedocs',
  appearance: 'force-dark',
  // typedocs/api/ is committed TypeDoc output (a separate tool, not regenerated
  // by this build) — never let VitePress empty outDir or it wipes api/ too.
  vite: { build: { emptyOutDir: false } },
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
          { text: 'Domain Store Split-Brain', link: '/DomainStoreSplitBrain' },
          { text: 'Placement', link: '/Placement' },
          { text: 'Custom Domains', link: '/custom-domains' },
          { text: 'Apps Over Netget', link: '/AppsOverNetget' },
        ],
      },
      {
        text: 'Signed Gateway Capabilities',
        items: [
          { text: 'Gateway Capability Model', link: '/GatewayCapabilityModel' },
          { text: 'Capability Test Suite', link: '/EncryptedAudienceCapabilityTests' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/neurons-me/netget' }],
  },
});
