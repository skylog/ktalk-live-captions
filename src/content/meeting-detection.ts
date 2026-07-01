export type MeetingConfidence = 'low' | 'medium' | 'high';

export interface MeetingDetectionSignal {
  kind: 'url' | 'marker' | 'control' | 'video' | 'text';
  value: string;
  weight: number;
}

export interface MeetingDetectionSnapshot {
  detected: boolean;
  confidence: MeetingConfidence;
  score: number;
  meetingId: string | null;
  surfaceId: string | null;
  url: string;
  reasons: string[];
  signals: MeetingDetectionSignal[];
  scannedAt: number;
}

export interface MeetingDetectionOptions {
  root?: Document | Element | ShadowRoot;
  location?: Pick<Location, 'href' | 'host' | 'pathname' | 'search'>;
  now?: () => number;
}

const CONTROL_TOKENS = [
  { pattern: /(?:^|\b)(leave|end call|hang up|exit call)(?:\b|$)/i, weight: 3 },
  { pattern: /(?:^|\b)(mute|unmute|microphone|mic)(?:\b|$)/i, weight: 2 },
  { pattern: /(?:^|\b)(camera|video)(?:\b|$)/i, weight: 2 },
  { pattern: /(?:^|\b)(participants?|people|attendees?)(?:\b|$)/i, weight: 2 },
  { pattern: /(?:^|\b)(share screen|screen share|present|present now)(?:\b|$)/i, weight: 2 },
  { pattern: /(?:^|\b)(captions?|subtitles?)(?:\b|$)/i, weight: 2 },
  { pattern: /(?:^|\b)(raise hand|reactions?|chat)(?:\b|$)/i, weight: 1 },
  { pattern: /(?:^|\b)(join|call settings|meeting info)(?:\b|$)/i, weight: 1 },
];

const URL_HINTS = [
  /(?:^|[/-])(meet|meeting|call|conference|room|session)(?:$|[/?#-])/i,
  /(?:\b|_)(meet|meeting|call|conference|room|session)(?:\b|_)/i,
];

const MARKER_SELECTORS = [
  '[data-meeting-id]',
  '[data-call-id]',
  '[data-room-id]',
  '[data-conference-id]',
  '[data-meeting-ui]',
  '[data-call-ui]',
  '[aria-label*="meeting" i]',
  '[aria-label*="call" i]',
  '[aria-label*="conference" i]',
];

const CONTROL_SELECTORS = [
  'button',
  '[role="button"]',
  '[aria-label]',
  '[title]',
  '[data-testid]',
  '[data-tooltip]',
];

function queryAll(root: Document | Element | ShadowRoot, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector));
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function collectElementText(element: Element): string[] {
  const values = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-testid'),
    element.getAttribute('data-tooltip'),
    element.getAttribute('data-meeting-id'),
    element.getAttribute('data-call-id'),
    element.getAttribute('data-room-id'),
    element.getAttribute('data-conference-id'),
    element.textContent,
  ];

  return values
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeText)
    .filter((value) => value.length > 0);
}

function isVisibleElement(element: Element): boolean {
  if (element.getClientRects().length > 0) {
    return true;
  }

  const view = element.ownerDocument?.defaultView;
  if (!view) {
    return false;
  }

  const style = view.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function detectUrlSignals(location: Pick<Location, 'href' | 'host' | 'pathname' | 'search'>): MeetingDetectionSignal[] {
  const signals: MeetingDetectionSignal[] = [];
  const href = normalizeText(location.href);
  const pathname = normalizeText(location.pathname);
  const search = normalizeText(location.search);

  if (URL_HINTS.some((pattern) => pattern.test(href) || pattern.test(pathname) || pattern.test(search))) {
    signals.push({ kind: 'url', value: location.href, weight: 2 });
  }

  const pathMatch = location.pathname.match(/(?:^|\/)(?:meet|meeting|call|conference|room|session)\/([^/?#]+)/i);
  if (pathMatch && pathMatch[1]) {
    signals.push({ kind: 'url', value: pathMatch[1], weight: 2 });
  }

  const searchParams = new URLSearchParams(location.search);
  for (const key of ['meetingId', 'meeting', 'callId', 'room', 'roomId', 'sessionId']) {
    const value = searchParams.get(key);
    if (value) {
      signals.push({ kind: 'url', value: `${key}=${value}`, weight: 2 });
      break;
    }
  }

  return signals;
}

function detectMarkerSignals(root: Document | Element | ShadowRoot): MeetingDetectionSignal[] {
  const signals: MeetingDetectionSignal[] = [];
  const seen = new Set<string>();

  for (const selector of MARKER_SELECTORS) {
    for (const element of queryAll(root, selector)) {
      if (!isVisibleElement(element)) {
        continue;
      }

      const value =
        element.getAttribute('data-meeting-id') ||
        element.getAttribute('data-call-id') ||
        element.getAttribute('data-room-id') ||
        element.getAttribute('data-conference-id') ||
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.getAttribute('data-testid') ||
        element.getAttribute('data-tooltip') ||
        element.tagName.toLowerCase();

      if (value) {
        const normalized = normalizeText(value);
        if (seen.has(normalized)) {
          continue;
        }

        seen.add(normalized);
        signals.push({ kind: 'marker', value: normalized, weight: 4 });
      }
    }
  }

  return signals;
}

function detectControlSignals(root: Document | Element | ShadowRoot): MeetingDetectionSignal[] {
  const signals: MeetingDetectionSignal[] = [];
  const seen = new Set<string>();

  for (const selector of CONTROL_SELECTORS) {
    for (const element of queryAll(root, selector)) {
      if (!isVisibleElement(element)) {
        continue;
      }

      for (const candidate of collectElementText(element)) {
        if (seen.has(candidate)) {
          continue;
        }

        const matched = CONTROL_TOKENS.find((token) => token.pattern.test(candidate));
        if (matched) {
          seen.add(candidate);
          signals.push({ kind: 'control', value: candidate, weight: matched.weight });
        }
      }
    }
  }

  return signals;
}

function detectVideoSignals(root: Document | Element | ShadowRoot): MeetingDetectionSignal[] {
  const videos = queryAll(root, 'video').filter(isVisibleElement);
  if (videos.length === 0) {
    return [];
  }

  return [
    {
      kind: 'video',
      value: `visible-video:${videos.length}`,
      weight: videos.length > 1 ? 2 : 1,
    },
  ];
}

function deriveMeetingId(snapshot: {
  urlSignals: MeetingDetectionSignal[];
  markerSignals: MeetingDetectionSignal[];
  controlSignals: MeetingDetectionSignal[];
  location: Pick<Location, 'host' | 'pathname' | 'search'>;
}): string | null {
  const marker = snapshot.markerSignals[0]?.value ?? null;
  if (marker) {
    return marker;
  }

  const urlSignal = snapshot.urlSignals.find((signal) => signal.kind === 'url' && signal.value.includes('='));
  if (urlSignal) {
    return urlSignal.value;
  }

  const pathToken = snapshot.urlSignals.find((signal) => signal.kind === 'url' && !signal.value.includes('='));
  if (pathToken) {
    return pathToken.value;
  }

  if (snapshot.controlSignals.length > 0) {
    return `${snapshot.location.host}${snapshot.location.pathname}`;
  }

  return null;
}

function deriveSurfaceId(root: Document | Element | ShadowRoot, location: Pick<Location, 'host' | 'pathname'>): string | null {
  const marker =
    queryAll(root, MARKER_SELECTORS.join(', '))
      .map((element) => element.getAttribute('data-meeting-ui') || element.getAttribute('data-call-ui') || element.tagName.toLowerCase())
      .find((value): value is string => Boolean(value)) || null;

  if (marker) {
    return normalizeText(marker);
  }

  const mainRegion = queryAll(root, 'main, [role="main"]');
  if (mainRegion.length > 0) {
    return `${location.host}${location.pathname}`;
  }

  return null;
}

function computeScore(signals: MeetingDetectionSignal[]): number {
  return signals.reduce((total, signal) => total + signal.weight, 0);
}

function computeConfidence(score: number): MeetingConfidence {
  if (score >= 10) {
    return 'high';
  }

  if (score >= 6) {
    return 'medium';
  }

  return 'low';
}

export function detectMeetingSurface(options: MeetingDetectionOptions = {}): MeetingDetectionSnapshot {
  const root = options.root ?? document;
  const location = options.location ?? window.location;
  const now = options.now ?? Date.now;

  const urlSignals = detectUrlSignals(location);
  const markerSignals = detectMarkerSignals(root);
  const controlSignals = detectControlSignals(root);
  const videoSignals = detectVideoSignals(root);

  const signals = [...urlSignals, ...markerSignals, ...controlSignals, ...videoSignals].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }

    if (left.value !== right.value) {
      return left.value.localeCompare(right.value);
    }

    return left.weight - right.weight;
  });

  const score = computeScore(signals);
  const detected = markerSignals.length > 0 || score >= 5;
  const reasons = [];

  if (markerSignals.length > 0) {
    reasons.push('meeting marker present');
  }

  if (urlSignals.length > 0) {
    reasons.push('meeting-like url');
  }

  if (controlSignals.length > 0) {
    reasons.push('meeting controls present');
  }

  if (videoSignals.length > 0) {
    reasons.push('visible video element');
  }

  return {
    detected,
    confidence: detected ? computeConfidence(score) : 'low',
    score,
    meetingId: detected
      ? deriveMeetingId({ urlSignals, markerSignals, controlSignals, location })
      : null,
    surfaceId: detected ? deriveSurfaceId(root, location) : null,
    url: location.href,
    reasons,
    signals,
    scannedAt: now(),
  };
}

export function hasMeetingSurface(snapshot: MeetingDetectionSnapshot): boolean {
  return snapshot.detected;
}
