import { describe, expect, it } from 'vitest';

import { sanitizeFilename } from './storage.service.js';

describe('sanitizeFilename', () => {
  it('strips drive + path prefixes', () => {
    expect(sanitizeFilename('C:\\Users\\Alice\\photo.jpg')).toBe('photo.jpg');
    expect(sanitizeFilename('/var/tmp/some image.png')).toBe('some_image.png');
  });

  it('replaces unsafe characters with underscore', () => {
    expect(sanitizeFilename('proof of work?.jpg')).toBe('proof_of_work_.jpg');
    expect(sanitizeFilename('a&b#c$.png')).toBe('a_b_c_.png');
  });

  it('collapses runs of underscore', () => {
    expect(sanitizeFilename('a   b___c.jpg')).toBe('a_b_c.jpg');
  });

  it('rejects leading dots so traversal cannot slip through', () => {
    expect(sanitizeFilename('../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('.hidden.png')).toBe('hidden.png');
  });

  it('falls back to "file" when sanitization empties the input', () => {
    expect(sanitizeFilename('???')).toBe('_');
    expect(sanitizeFilename('')).toBe('file');
  });

  it('truncates absurdly long names', () => {
    const long = 'a'.repeat(500) + '.jpg';
    const result = sanitizeFilename(long);
    expect(result.length).toBe(100);
  });
});
