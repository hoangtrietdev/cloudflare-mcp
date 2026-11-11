import { metadataCorsOptionsRequestHandler, protectedResourceHandler, getPublicOrigin } from 'mcp-handler';
export const runtime = 'nodejs';
export function GET(request: Request) {
  const base = getPublicOrigin(request);
  return protectedResourceHandler({ authServerUrls: [base], resourceUrl: `${base}/api/mcp` })(request);
}
export const OPTIONS = metadataCorsOptionsRequestHandler();
