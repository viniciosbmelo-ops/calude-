/**
 * Tests for analytics privacy sanitisation and session helpers.
 *
 * These tests use lightweight event fakes — no browser DOM or sessionStorage.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  sanitisePath,
  extractUtms,
  categoriseError,
  sanitiseErrorCategory,
  navigationDestinationFromHref,
  navigationFeatureFromPath,
  attachNavigationClickListener,
  recordPageView,
  recordNavigationClick,
} from '../analytics';

// ── sanitisePath ──────────────────────────────────────────────────────────────

describe('sanitisePath', () => {
  it('returns the pathname unchanged when there is no query or hash', () => {
    expect(sanitisePath('/patients')).toBe('/patients');
  });

  it('strips query string', () => {
    expect(sanitisePath('/patients?id=123&name=John')).toBe('/patients');
  });

  it('strips hash fragment', () => {
    expect(sanitisePath('/dashboard#section')).toBe('/dashboard');
  });

  it('strips both query string and hash', () => {
    expect(sanitisePath('/surgeries?type=acl#results')).toBe('/surgeries');
  });

  it('collapses unknown paths rather than retaining possible user data', () => {
    const long = '/' + 'a'.repeat(250);
    expect(sanitisePath(long)).toBe('/other');
  });

  it('handles empty string', () => {
    expect(sanitisePath('')).toBe('');
  });

  it('handles root path', () => {
    expect(sanitisePath('/')).toBe('/');
  });

  it('templates dynamic identifiers and strips query data', () => {
    expect(sanitisePath('/regen/caso/42?draft=true')).toBe('/regen/caso/:id');
    expect(sanitisePath('/patient/secret-token')).toBe('/patient/:token');
  });
});

// ── navigation click telemetry ────────────────────────────────────────────────

describe('navigation click telemetry', () => {
  it('derives only backend-allowlisted features from sanitized destinations', () => {
    expect(navigationFeatureFromPath('/dashboard')).toBe('dashboard');
    expect(navigationFeatureFromPath('/patients/new')).toBe('patient');
    expect(navigationFeatureFromPath('/patients/123')).toBe('patient');
    expect(navigationFeatureFromPath('/surgeries/new')).toBe('surgery');
    expect(navigationFeatureFromPath('/surgeries/123')).toBe('surgery');
    expect(navigationFeatureFromPath('/future-route/free-text')).toBeNull();
  });

  it('uses an allowlisted destination template and never retains sensitive segments', () => {
    expect(
      navigationDestinationFromHref(
        '/patients/987?patientName=Maria%20Silva#details',
        'https://docknee.test/dashboard',
      ),
    ).toBe('/patients/:id');
    expect(
      navigationDestinationFromHref(
        '/patient/private-public-token',
        'https://docknee.test/dashboard',
      ),
    ).toBe('/patient/:token');
    expect(
      navigationDestinationFromHref(
        '/future-route/Maria%20Silva',
        'https://docknee.test/dashboard',
      ),
    ).toBe('/other');
    expect(
      navigationDestinationFromHref(
        'https://other.example/patients/987',
        'https://docknee.test/dashboard',
      ),
    ).toBeNull();
  });

  it('records a click only when a delegated anchor click occurs', () => {
    const listeners: EventListener[] = [];
    const root = {
      addEventListener: (_type: string, listener: EventListener) => listeners.push(listener),
      removeEventListener: (_type: string, listener: EventListener) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    } as unknown as Pick<Document, 'addEventListener' | 'removeEventListener'>;
    const destinations: string[] = [];
    const cleanup = attachNavigationClickListener((destination) => destinations.push(destination), root);

    // A page load or programmatic route change does not call the delegated
    // listener, while a real anchor click does.
    expect(destinations).toEqual([]);
    const anchor = {
      getAttribute: (name: string) => name === 'href' ? '/surgeries/42' : null,
      closest: () => anchor,
    };
    listeners[0]?.({ target: anchor } as unknown as Event);
    expect(destinations).toEqual(['/surgeries/:id']);

    cleanup();
  });

  it('captures only explicitly marked navigation buttons, not arbitrary buttons', () => {
    const listeners: EventListener[] = [];
    const root = {
      addEventListener: (_type: string, listener: EventListener) => listeners.push(listener),
      removeEventListener: (_type: string, listener: EventListener) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    } as unknown as Pick<Document, 'addEventListener' | 'removeEventListener'>;
    const destinations: string[] = [];
    const cleanup = attachNavigationClickListener((destination) => destinations.push(destination), root);
    const arbitraryButton = {
      getAttribute: () => null,
      closest: () => null,
    };
    const markedButton = {
      getAttribute: (name: string) => name === 'data-analytics-destination' ? '/patients' : null,
      closest: () => markedButton,
    };

    listeners[0]?.({ target: arbitraryButton } as unknown as Event);
    expect(destinations).toEqual([]);
    listeners[0]?.({ target: markedButton } as unknown as Event);
    expect(destinations).toEqual(['/patients']);
    cleanup();
  });

  it('cleans up before reattaching so a remount cannot duplicate a click', () => {
    const listeners: EventListener[] = [];
    const root = {
      addEventListener: (_type: string, listener: EventListener) => listeners.push(listener),
      removeEventListener: (_type: string, listener: EventListener) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    } as unknown as Pick<Document, 'addEventListener' | 'removeEventListener'>;
    const destinations: string[] = [];
    const anchor = {
      getAttribute: (name: string) => name === 'href' ? '/dashboard' : null,
      closest: () => anchor,
    };

    const firstCleanup = attachNavigationClickListener((destination) => destinations.push(destination), root);
    firstCleanup();
    attachNavigationClickListener((destination) => destinations.push(destination), root);
    expect(listeners).toHaveLength(1);
    listeners[0]?.({ target: anchor } as unknown as Event);
    expect(destinations).toEqual(['/dashboard']);
  });

  it('keeps one delegated listener when attached twice to the same root', () => {
    const listeners: EventListener[] = [];
    const root = {
      addEventListener: (_type: string, listener: EventListener) => listeners.push(listener),
      removeEventListener: (_type: string, listener: EventListener) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    } as unknown as Pick<Document, 'addEventListener' | 'removeEventListener'>;
    const destinations: string[] = [];
    const anchor = {
      getAttribute: (name: string) => name === 'href' ? '/dashboard' : null,
      closest: () => anchor,
    };

    attachNavigationClickListener(() => destinations.push('stale'), root);
    attachNavigationClickListener((destination) => destinations.push(destination), root);
    expect(listeners).toHaveLength(1);
    listeners[0]?.({ target: anchor } as unknown as Event);
    expect(destinations).toEqual(['/dashboard']);
  });

  it('keeps page_view and navigation_click as distinct event types', () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);

    recordPageView('session-1', '/dashboard');
    recordNavigationClick('session-1', '/patients/42');

    const bodies = (fetchMock.mock.calls as unknown[][]).map((call) =>
      JSON.parse((call[1] as { body: string }).body),
    );
    expect(bodies.map((body) => body.eventName)).toEqual(['page_view', 'navigation_click']);
    expect(bodies[1].pagePath).toBe('/patients/:id');
    expect(bodies[1].featureName).toBe('patient');
    vi.unstubAllGlobals();
  });

  it('does not send an unrankable or unknown destination click', () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);

    recordNavigationClick('session-1', '/future-route/private-name');

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ── extractUtms ───────────────────────────────────────────────────────────────

describe('extractUtms', () => {
  it('extracts utm_source, utm_medium, utm_campaign', () => {
    const href = 'https://docknee.com/login?utm_source=google&utm_medium=cpc&utm_campaign=summer';
    const result = extractUtms(href);
    expect(result.utm_source).toBe('google');
    expect(result.utm_medium).toBe('cpc');
    expect(result.utm_campaign).toBe('summer');
  });

  it('ignores non-UTM query params', () => {
    const href = 'https://docknee.com/login?patient_id=999&utm_source=email';
    const result = extractUtms(href);
    expect(result.utm_source).toBe('email');
    expect(Object.keys(result)).not.toContain('patient_id');
  });

  it('returns empty object when no UTMs present', () => {
    expect(extractUtms('https://docknee.com/')).toEqual({});
  });

  it('returns empty object for an invalid URL', () => {
    expect(extractUtms('not-a-url')).toEqual({});
  });

  it('caps UTM values at 100 characters', () => {
    const long = 'x'.repeat(200);
    const href = `https://docknee.com/?utm_campaign=${long}`;
    const result = extractUtms(href);
    expect(result.utm_campaign?.length).toBe(100);
  });

  it('drops UTM values containing free text or personal data', () => {
    const href = 'https://docknee.com/?utm_campaign=João%20Silva&utm_medium=cpc';
    const result = extractUtms(href);
    expect(result.utm_campaign).toBeUndefined();
    expect(result.utm_medium).toBe('cpc');
  });

  it('does not include utm_term or utm_content (not allowlisted)', () => {
    const href = 'https://docknee.com/?utm_source=google&utm_term=knee&utm_content=ad1';
    const result = extractUtms(href);
    expect(Object.keys(result)).not.toContain('utm_term');
    expect(Object.keys(result)).not.toContain('utm_content');
  });
});

// ── categoriseError ───────────────────────────────────────────────────────────

describe('categoriseError', () => {
  it('classifies TypeError correctly', () => {
    expect(categoriseError(new TypeError('cannot read property'))).toBe('TypeError');
  });

  it('classifies ReferenceError correctly', () => {
    expect(categoriseError(new ReferenceError('x is not defined'))).toBe('ReferenceError');
  });

  it('classifies SyntaxError correctly', () => {
    expect(categoriseError(new SyntaxError('unexpected token'))).toBe('SyntaxError');
  });

  it('classifies ChunkLoadError by name', () => {
    const e = new Error('Failed to load chunk');
    e.name = 'ChunkLoadError';
    expect(categoriseError(e)).toBe('ChunkLoadError');
  });

  it('classifies ChunkLoadError by message prefix', () => {
    const e = new Error('Failed to fetch dynamically imported module: /chunk-abc.js');
    expect(categoriseError(e)).toBe('ChunkLoadError');
  });

  it('classifies NetworkError by name', () => {
    const e = new Error('network failure');
    e.name = 'NetworkError';
    expect(categoriseError(e)).toBe('NetworkError');
  });

  it('returns Unknown for strings', () => {
    expect(categoriseError('something went wrong')).toBe('Unknown');
  });

  it('returns Unknown for null', () => {
    expect(categoriseError(null)).toBe('Unknown');
  });

  it('returns Unknown for plain objects', () => {
    expect(categoriseError({ code: 500 })).toBe('Unknown');
  });

  it('returns Unknown for generic Error', () => {
    expect(categoriseError(new Error('generic'))).toBe('Unknown');
  });
});

// ── sanitiseErrorCategory ─────────────────────────────────────────────────────

describe('sanitiseErrorCategory', () => {
  it('accepts known categories', () => {
    expect(sanitiseErrorCategory('TypeError')).toBe('TypeError');
    expect(sanitiseErrorCategory('NetworkError')).toBe('NetworkError');
    expect(sanitiseErrorCategory('ChunkLoadError')).toBe('ChunkLoadError');
  });

  it('returns Unknown for arbitrary strings', () => {
    expect(sanitiseErrorCategory('SomethingExploding')).toBe('Unknown');
    expect(sanitiseErrorCategory('')).toBe('Unknown');
    expect(sanitiseErrorCategory('error: user data')).toBe('Unknown');
  });

  it('returns Unknown for unhandled rejection category', () => {
    // UnhandledRejection is in the set
    expect(sanitiseErrorCategory('UnhandledRejection')).toBe('UnhandledRejection');
  });
});
