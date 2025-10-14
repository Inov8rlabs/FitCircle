/**
 * Input Sanitization Utilities
 *
 * Prevents XSS attacks by sanitizing user input
 * Applies to: bio, notes, circle descriptions, messages, etc.
 *
 * NOTE: For production, consider using a library like DOMPurify or sanitize-html
 * This is a basic implementation for server-side sanitization
 */

/**
 * Basic HTML/script tag sanitization
 * Removes HTML tags and scripts from user input
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return '';

  let sanitized = input;

  // Remove HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Remove potential script content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove potential event handlers
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=\s*\S+/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Sanitize user-generated content with length limit
 */
export function sanitizeUserContent(
  input: string | null | undefined,
  maxLength: number = 1000
): string {
  const sanitized = sanitizeText(input);
  return sanitized.slice(0, maxLength);
}

/**
 * Sanitize bio (personal description)
 */
export function sanitizeBio(bio: string | null | undefined): string {
  return sanitizeUserContent(bio, 500);
}

/**
 * Sanitize note/comment
 */
export function sanitizeNote(note: string | null | undefined): string {
  return sanitizeUserContent(note, 500);
}

/**
 * Sanitize circle/challenge description
 */
export function sanitizeDescription(description: string | null | undefined): string {
  return sanitizeUserContent(description, 1000);
}

/**
 * Sanitize display name (more strict - alphanumeric + spaces only)
 */
export function sanitizeDisplayName(name: string | null | undefined): string {
  if (!name) return '';

  // Remove all non-alphanumeric characters except spaces, hyphens, apostrophes
  let sanitized = name.replace(/[^a-zA-Z0-9\s\-']/g, '');

  // Collapse multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Trim and limit length
  sanitized = sanitized.trim().slice(0, 100);

  return sanitized;
}

/**
 * Sanitize username (very strict - alphanumeric + underscore only)
 */
export function sanitizeUsername(username: string | null | undefined): string {
  if (!username) return '';

  // Only allow alphanumeric and underscore
  let sanitized = username.replace(/[^a-zA-Z0-9_]/g, '');

  // Lowercase
  sanitized = sanitized.toLowerCase();

  // Limit length
  sanitized = sanitized.slice(0, 30);

  return sanitized;
}

/**
 * Sanitize circle name
 */
export function sanitizeCircleName(name: string | null | undefined): string {
  if (!name) return '';

  let sanitized = sanitizeText(name);

  // Limit length
  sanitized = sanitized.slice(0, 100);

  return sanitized;
}

/**
 * Escape special characters for SQL LIKE queries
 */
export function escapeLike(input: string): string {
  return input.replace(/[_%\\]/g, '\\$&');
}

/**
 * Validate and sanitize email
 * Returns sanitized email or null if invalid
 */
export function sanitizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;

  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const sanitized = email.trim().toLowerCase();

  if (!emailRegex.test(sanitized)) {
    return null;
  }

  return sanitized;
}

/**
 * Remove potentially dangerous URLs
 */
export function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const sanitized = url.trim();

  // Only allow http, https, and mailto protocols
  const allowedProtocols = ['http://', 'https://', 'mailto:'];

  const hasAllowedProtocol = allowedProtocols.some((protocol) =>
    sanitized.toLowerCase().startsWith(protocol)
  );

  if (!hasAllowedProtocol && sanitized.includes(':')) {
    // Has a protocol but it's not allowed
    return null;
  }

  // Remove javascript: and data: URLs
  if (
    sanitized.toLowerCase().includes('javascript:') ||
    sanitized.toLowerCase().includes('data:')
  ) {
    return null;
  }

  return sanitized;
}
