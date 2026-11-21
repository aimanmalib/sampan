/// <reference types="vite/client" />

declare module 'virtual:sampan-proof' {
  const proof: import('../../core/proof').Proof;
  export default proof;
  export const headline: import('../../core/client/measured').Headline;
}

declare module 'virtual:sampan-route-facts' {
  const facts: import('../../core/route-facts').RouteFacts;
  export default facts;
}
