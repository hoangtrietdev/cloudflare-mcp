import { authorize, submitConsent } from '../../../src/hosted/oauth.js';
export const runtime = 'nodejs';
export const GET = authorize;
export const POST = submitConsent;
