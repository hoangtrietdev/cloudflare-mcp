import { z } from 'zod/v3';

export const projectNameSchema = z.string()
  .min(1)
  .max(58)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers, and hyphens.');

export const domainSchema = z.string()
  .min(4)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/, 'Provide a fully qualified domain name.');
