import { describe, expect, it } from 'vitest';
import { escapeHtml } from './presentation';

describe('standalone admin presentation', () => {
  it('escapes route text for both attributes and element content', () => {
    expect(escapeHtml('<loop title="River & hills">\'views\'</loop>')).toBe(
      '&lt;loop title=&quot;River &amp; hills&quot;&gt;&#39;views&#39;&lt;/loop&gt;',
    );
  });

  it('preserves Unicode, whitespace and literal entity text', () => {
    expect(escapeHtml('Kyoto 京都\n  River &amp; hills')).toBe('Kyoto 京都\n  River &amp;amp; hills');
  });

  it.each([undefined, null, false, 0, ''])('preserves the existing empty display for %s', value => {
    expect(escapeHtml(value)).toBe('');
  });

  it('preserves coercion of nonempty metadata', () => {
    expect(escapeHtml(12)).toBe('12');
    expect(escapeHtml(['river', 'hill'])).toBe('river,hill');
  });
});
