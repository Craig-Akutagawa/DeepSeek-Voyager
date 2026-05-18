import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDeepSeekMetadata,
  canExportCurrentRoute,
  collectDeepSeekConversation,
} from '../deepseekConversation';

describe('deepseekConversation export collector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    window.history.replaceState({}, '', '/a/chat/s/12345678-1234-1234-1234-123456789abc');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects DeepSeek user and assistant message pairs', () => {
    document.body.innerHTML = `
      <main>
        <div class="ds-scroll-area">
          <div class="d29f3d7d ds-message">How do I export?</div>
          <div class="ds-message"><p>Use Markdown or JSON.</p><button>Copy</button></div>
          <div class="d29f3d7d ds-message">What formats?</div>
          <div class="ds-message">Markdown and JSON for now.</div>
        </div>
      </main>
    `;

    const turns = collectDeepSeekConversation();

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      user: 'How do I export?',
      assistant: 'Use Markdown or JSON.',
      starred: false,
    });
    expect(turns[0].userElement).toBeUndefined();
    expect(turns[0].assistantElement).toBeUndefined();
    expect(turns[1]).toMatchObject({
      user: 'What formats?',
      assistant: 'Markdown and JSON for now.',
    });
  });

  it('preserves KaTeX annotations as Markdown formulas', () => {
    document.body.innerHTML = `
      <main>
        <div class="ds-scroll-area">
          <div class="d29f3d7d ds-message">Limit question</div>
          <div class="ds-message">
            <p>Use <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">e</annotation></semantics></math></span><span class="katex-html">e</span></span>.</p>
            <p><span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">\\lim_{x \\to 0} (1 + 2x)^{\\frac{1}{x}} = e^2</annotation></semantics></math></span><span class="katex-html">rendered</span></span></span></p>
          </div>
        </div>
      </main>
    `;

    const turns = collectDeepSeekConversation();

    expect(turns[0].assistant).toContain('\\(e\\)');
    expect(turns[0].assistant).toContain('\\[');
    expect(turns[0].assistant).toContain('\\lim_{x \\to 0}');
    expect(turns[0].assistant).not.toContain('rendered');
  });

  it('reads starred turns from the DeepSeek timeline key', () => {
    document.body.innerHTML = `
      <main>
        <div class="ds-scroll-area">
          <div class="d29f3d7d ds-message" data-turn-id="turn-1">Question</div>
          <div class="ds-message">Answer</div>
        </div>
      </main>
    `;
    localStorage.setItem(
      'deepseekTimelineStars:deepseek:12345678-1234-1234-1234-123456789abc',
      JSON.stringify(['turn-1'])
    );

    const turns = collectDeepSeekConversation();

    expect(turns[0].starred).toBe(true);
  });

  it('builds DeepSeek metadata for the current page', () => {
    document.title = 'Export Test - DeepSeek';

    const metadata = buildDeepSeekMetadata([
      { user: 'Question', assistant: 'Answer', starred: false },
    ]);

    expect(metadata).toMatchObject({
      count: 1,
      title: 'Export Test',
    });
    expect(metadata.url).toContain('/a/chat/s/');
  });

  it('only enables export on conversation routes', () => {
    expect(canExportCurrentRoute('/a/chat/s/12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(canExportCurrentRoute('/')).toBe(false);
  });
});
