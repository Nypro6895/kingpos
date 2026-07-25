"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutPortablePosAction } from "@/app/pos/portable/actions";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isPortablePosRoute,
  type PortablePosRouteLink,
} from "@/lib/pos-portable-routes";

const BUTTON_SIZE = 62;
const CHILD_BUTTON_SIZE = 54;
const CHILD_GAP = 14;
const EDGE_PADDING = 14;
const INNER_ORBIT_RADIUS = 92;
const OUTER_ORBIT_RADIUS = 138;
const FALLBACK_ORBIT_RADIUS = 166;
const TAP_MOVE_THRESHOLD = 8;
const OPEN_DURATION_MS = 240;
const CLOSE_DURATION_MS = 210;
const REDUCED_MOTION_DURATION_MS = 80;
const STAGGER_MS = 28;
const ANGLE_SAMPLE_DEGREES = 2;
const POSITION_STORAGE_KEY = "kingpos-portable-nav-position";

type StoredPosition = {
  xRatio: number;
  yRatio: number;
};

type Position = {
  x: number;
  y: number;
};

type SafeAreaInsets = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type SafeCenterBounds = {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  viewportHeight: number;
  viewportWidth: number;
};

type PointerSnapshot = {
  lastClientX: number;
  lastClientY: number;
  lastTime: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

type OrbitAction =
  | (PortablePosRouteLink & { kind: "route" })
  | {
      href?: never;
      icon: "logout";
      id: "lock";
      kind: "lock";
      label: string;
    };

type OrbitLayoutItem = {
  action: OrbitAction;
  angle: number;
  ring: "fallback" | "inner" | "outer";
  radius: number;
  x: number;
  y: number;
};

type AngleArc = {
  end: number;
  length: number;
  start: number;
};

type PortableFloatingNavProps = {
  items: PortablePosRouteLink[];
  salonName: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getViewportSize() {
  return {
    height: window.visualViewport?.height ?? window.innerHeight,
    width: window.visualViewport?.width ?? window.innerWidth,
  };
}

function readSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === "undefined") {
    return { bottom: 0, left: 0, right: 0, top: 0 };
  }

  const probe = document.createElement("div");
  probe.style.cssText = [
    "position:fixed",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top)",
    "padding-right:env(safe-area-inset-right)",
    "padding-bottom:env(safe-area-inset-bottom)",
    "padding-left:env(safe-area-inset-left)",
  ].join(";");
  document.body.appendChild(probe);
  const style = window.getComputedStyle(probe);
  const insets = {
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    top: Number.parseFloat(style.paddingTop) || 0,
  };
  probe.remove();

  return insets;
}

function getMainBounds() {
  const viewport = getViewportSize();
  const safeArea = readSafeAreaInsets();

  return {
    maxX: Math.max(
      EDGE_PADDING + safeArea.left,
      viewport.width - BUTTON_SIZE - EDGE_PADDING - safeArea.right,
    ),
    maxY: Math.max(
      EDGE_PADDING + safeArea.top,
      viewport.height - BUTTON_SIZE - EDGE_PADDING - safeArea.bottom,
    ),
    minX: EDGE_PADDING + safeArea.left,
    minY: EDGE_PADDING + safeArea.top,
  };
}

function getChildSafeBounds(): SafeCenterBounds {
  const viewport = getViewportSize();
  const safeArea = readSafeAreaInsets();
  const childRadius = CHILD_BUTTON_SIZE / 2;

  return {
    maxX: Math.max(
      EDGE_PADDING + safeArea.left + childRadius,
      viewport.width - EDGE_PADDING - safeArea.right - childRadius,
    ),
    maxY: Math.max(
      EDGE_PADDING + safeArea.top + childRadius,
      viewport.height - EDGE_PADDING - safeArea.bottom - childRadius,
    ),
    minX: EDGE_PADDING + safeArea.left + childRadius,
    minY: EDGE_PADDING + safeArea.top + childRadius,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  };
}

function defaultPosition() {
  const bounds = getMainBounds();

  return {
    x: bounds.maxX,
    y: clamp(bounds.maxY - 84, bounds.minY, bounds.maxY),
  };
}

function normalizePosition(position: Position): StoredPosition {
  const bounds = getMainBounds();
  const xRange = Math.max(1, bounds.maxX - bounds.minX);
  const yRange = Math.max(1, bounds.maxY - bounds.minY);

  return {
    xRatio: clamp((position.x - bounds.minX) / xRange, 0, 1),
    yRatio: clamp((position.y - bounds.minY) / yRange, 0, 1),
  };
}

function restorePosition() {
  const bounds = getMainBounds();

  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as StoredPosition) : null;

    if (
      stored &&
      Number.isFinite(stored.xRatio) &&
      Number.isFinite(stored.yRatio)
    ) {
      return {
        x: clamp(
          bounds.minX + stored.xRatio * (bounds.maxX - bounds.minX),
          bounds.minX,
          bounds.maxX,
        ),
        y: clamp(
          bounds.minY + stored.yRatio * (bounds.maxY - bounds.minY),
          bounds.minY,
          bounds.maxY,
        ),
      };
    }
  } catch {
    // Ignore corrupted UI-only preferences.
  }

  return defaultPosition();
}

function persistPosition(position: Position) {
  try {
    window.localStorage.setItem(
      POSITION_STORAGE_KEY,
      JSON.stringify(normalizePosition(position)),
    );
  } catch {
    // Position is a convenience preference only.
  }
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function normalizeAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

function angularDistance(left: number, right: number) {
  const delta = Math.abs(normalizeAngle(left) - normalizeAngle(right));

  return Math.min(delta, 360 - delta);
}

function minimumAngleForRadius(radius: number) {
  const ratio = clamp((CHILD_BUTTON_SIZE + CHILD_GAP) / (2 * radius), 0, 1);

  return radiansToDegrees(2 * Math.asin(ratio));
}

function orbitCenter(center: Position, radius: number, angle: number) {
  const radians = degreesToRadians(angle);

  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius,
  };
}

function topLeftFromCenter(center: Position) {
  return {
    x: center.x - CHILD_BUTTON_SIZE / 2,
    y: center.y - CHILD_BUTTON_SIZE / 2,
  };
}

function distanceBetween(left: Position, right: Position) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isInsideSafeBounds(center: Position, bounds: SafeCenterBounds) {
  return (
    center.x >= bounds.minX &&
    center.x <= bounds.maxX &&
    center.y >= bounds.minY &&
    center.y <= bounds.maxY
  );
}

function isCandidateValid(input: {
  bounds: SafeCenterBounds;
  center: Position;
  mainCenter: Position;
}) {
  const mainGap =
    BUTTON_SIZE / 2 + CHILD_BUTTON_SIZE / 2 + Math.max(10, CHILD_GAP - 2);

  return (
    isInsideSafeBounds(input.center, input.bounds) &&
    distanceBetween(input.center, input.mainCenter) >= mainGap
  );
}

function findValidArcs(input: {
  bounds: SafeCenterBounds;
  mainCenter: Position;
  radius: number;
}) {
  const samples = Array.from(
    { length: 360 / ANGLE_SAMPLE_DEGREES },
    (_, index) => {
      const angle = index * ANGLE_SAMPLE_DEGREES;
      const center = orbitCenter(input.mainCenter, input.radius, angle);

      return {
        angle,
        valid: isCandidateValid({
          bounds: input.bounds,
          center,
          mainCenter: input.mainCenter,
        }),
      };
    },
  );

  if (samples.every((sample) => sample.valid)) {
    return [{ end: 270, length: 360, start: -90 }];
  }

  if (samples.every((sample) => !sample.valid)) {
    return [];
  }

  const sampleCount = samples.length;
  const firstStartIndex = samples.findIndex(
    (sample, index) =>
      sample.valid && !samples[(index - 1 + sampleCount) % sampleCount].valid,
  );
  const arcs: AngleArc[] = [];
  let inArc = false;
  let start = 0;

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const index = (firstStartIndex + offset) % sampleCount;
    const nextIndex = (firstStartIndex + offset + 1) % sampleCount;
    const angle =
      samples[index].angle + (index < firstStartIndex ? 360 : 0);
    const nextValid =
      offset + 1 < sampleCount ? samples[nextIndex].valid : false;

    if (samples[index].valid && !inArc) {
      start = angle;
      inArc = true;
    }

    if (inArc && (!nextValid || offset + 1 === sampleCount)) {
      arcs.push({
        end: angle,
        length: Math.max(0, angle - start),
        start,
      });
      inArc = false;
    }
  }

  return arcs.filter((arc) => arc.length > 0);
}

function arcCapacity(arc: AngleArc, radius: number) {
  const minimumAngle = minimumAngleForRadius(radius);

  return Math.floor((arc.length + 0.001) / minimumAngle) + 1;
}

function arcCenter(arc: AngleArc) {
  return arc.start + arc.length / 2;
}

function inwardAngle(bounds: SafeCenterBounds, mainCenter: Position) {
  const safeCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };

  return normalizeAngle(
    radiansToDegrees(
      Math.atan2(safeCenter.y - mainCenter.y, safeCenter.x - mainCenter.x),
    ),
  );
}

function selectBestArc(input: {
  arcs: AngleArc[];
  count: number;
  inward: number;
  radius: number;
}) {
  return input.arcs
    .map((arc) => ({
      arc,
      capacity: arcCapacity(arc, input.radius),
      score:
        (arcCapacity(arc, input.radius) >= input.count ? 10000 : 0) +
        arc.length * 4 -
        angularDistance(arcCenter(arc), input.inward),
    }))
    .sort((left, right) => right.score - left.score)[0];
}

function distributeAngles(input: {
  arc: AngleArc;
  count: number;
  inward: number;
  radius: number;
  shift?: number;
}) {
  if (input.count <= 0) {
    return [];
  }

  if (input.count === 1) {
    const preferred = normalizeAngle(input.inward);
    const start = input.arc.start;
    const end = input.arc.end;
    const preferredWithinArc =
      preferred < normalizeAngle(start) && start >= 0 ? preferred + 360 : preferred;

    return [
      clamp(
        preferredWithinArc,
        Math.min(start, end),
        Math.max(start, end),
      ) + (input.shift ?? 0),
    ];
  }

  const minimumAngle = minimumAngleForRadius(input.radius);
  const roomForPadding =
    input.arc.length - minimumAngle * (input.count - 1) >= minimumAngle;
  const padding = roomForPadding ? minimumAngle / 2 : 0;
  const start = input.arc.start + padding;
  const end = input.arc.end - padding;
  const span = Math.max(0, end - start);
  const step = span / (input.count - 1);

  return Array.from(
    { length: input.count },
    (_, index) => start + step * index + (input.shift ?? 0),
  ).map((angle) => clamp(angle, input.arc.start, input.arc.end));
}

function buildLayoutItems(input: {
  actions: OrbitAction[];
  angles: number[];
  mainCenter: Position;
  radius: number;
  ring: OrbitLayoutItem["ring"];
}) {
  return input.actions.map((action, index) => {
    const angle = input.angles[index] ?? 0;
    const center = orbitCenter(input.mainCenter, input.radius, angle);
    const topLeft = topLeftFromCenter(center);

    return {
      action,
      angle: normalizeAngle(angle),
      radius: input.radius,
      ring: input.ring,
      x: topLeft.x,
      y: topLeft.y,
    };
  });
}

function validateLayout(input: {
  bounds: SafeCenterBounds;
  items: OrbitLayoutItem[];
  mainCenter: Position;
}) {
  const mainMinimum =
    BUTTON_SIZE / 2 + CHILD_BUTTON_SIZE / 2 + Math.max(10, CHILD_GAP - 2);
  const childMinimum = CHILD_BUTTON_SIZE + CHILD_GAP;
  const centers = input.items.map((item) => ({
    x: item.x + CHILD_BUTTON_SIZE / 2,
    y: item.y + CHILD_BUTTON_SIZE / 2,
  }));

  for (const center of centers) {
    if (!isInsideSafeBounds(center, input.bounds)) {
      return false;
    }

    if (distanceBetween(center, input.mainCenter) < mainMinimum) {
      return false;
    }
  }

  for (let outer = 0; outer < centers.length; outer += 1) {
    for (let inner = outer + 1; inner < centers.length; inner += 1) {
      if (distanceBetween(centers[outer], centers[inner]) < childMinimum) {
        return false;
      }
    }
  }

  return true;
}

function fullOrbitLayout(input: {
  actions: OrbitAction[];
  bounds: SafeCenterBounds;
  mainCenter: Position;
}) {
  const angles = input.actions.map(
    (_, index) => -90 + (360 / input.actions.length) * index,
  );
  const items = buildLayoutItems({
    actions: input.actions,
    angles,
    mainCenter: input.mainCenter,
    radius: INNER_ORBIT_RADIUS,
    ring: "inner",
  });

  return validateLayout({
    bounds: input.bounds,
    items,
    mainCenter: input.mainCenter,
  })
    ? items
    : null;
}

function twoRingLayout(input: {
  actions: OrbitAction[];
  bounds: SafeCenterBounds;
  inward: number;
  mainCenter: Position;
}) {
  const innerArcs = findValidArcs({
    bounds: input.bounds,
    mainCenter: input.mainCenter,
    radius: INNER_ORBIT_RADIUS,
  });
  const outerArcs = findValidArcs({
    bounds: input.bounds,
    mainCenter: input.mainCenter,
    radius: OUTER_ORBIT_RADIUS,
  });
  const innerArcResult = selectBestArc({
    arcs: innerArcs,
    count: 1,
    inward: input.inward,
    radius: INNER_ORBIT_RADIUS,
  });
  const outerArcResult = selectBestArc({
    arcs: outerArcs,
    count: 1,
    inward: input.inward,
    radius: OUTER_ORBIT_RADIUS,
  });

  if (!innerArcResult || !outerArcResult) {
    return null;
  }

  const innerCapacity = Math.min(
    input.actions.length,
    innerArcResult.capacity,
  );
  const shifts = [
    minimumAngleForRadius(OUTER_ORBIT_RADIUS) / 2,
    -minimumAngleForRadius(OUTER_ORBIT_RADIUS) / 2,
    0,
  ];

  for (let innerCount = innerCapacity; innerCount >= 1; innerCount -= 1) {
    const outerCount = input.actions.length - innerCount;

    if (outerCount > outerArcResult.capacity) {
      continue;
    }

    const innerActions = input.actions.slice(0, innerCount);
    const outerActions = input.actions.slice(innerCount);
    const innerAngles = distributeAngles({
      arc: innerArcResult.arc,
      count: innerCount,
      inward: input.inward,
      radius: INNER_ORBIT_RADIUS,
    });

    for (const shift of outerCount > 0 ? shifts : [0]) {
      const outerAngles = distributeAngles({
        arc: outerArcResult.arc,
        count: outerCount,
        inward: input.inward,
        radius: OUTER_ORBIT_RADIUS,
        shift,
      });
      const items = [
        ...buildLayoutItems({
          actions: innerActions,
          angles: innerAngles,
          mainCenter: input.mainCenter,
          radius: INNER_ORBIT_RADIUS,
          ring: "inner",
        }),
        ...buildLayoutItems({
          actions: outerActions,
          angles: outerAngles,
          mainCenter: input.mainCenter,
          radius: OUTER_ORBIT_RADIUS,
          ring: "outer",
        }),
      ];

      if (
        validateLayout({
          bounds: input.bounds,
          items,
          mainCenter: input.mainCenter,
        })
      ) {
        return items;
      }
    }
  }

  return null;
}

function fallbackLayout(input: {
  actions: OrbitAction[];
  bounds: SafeCenterBounds;
  inward: number;
  mainCenter: Position;
}) {
  const radii = [INNER_ORBIT_RADIUS, OUTER_ORBIT_RADIUS, FALLBACK_ORBIT_RADIUS];
  const candidates = radii.flatMap((radius) =>
    findValidArcs({
      bounds: input.bounds,
      mainCenter: input.mainCenter,
      radius,
    }).flatMap((arc) =>
      distributeAngles({
        arc,
        count: Math.max(1, arcCapacity(arc, radius)),
        inward: input.inward,
        radius,
      }).map((angle) => ({
        angle,
        center: orbitCenter(input.mainCenter, radius, angle),
        radius,
      })),
    ),
  );
  const sortedCandidates = candidates.sort(
    (left, right) =>
      left.radius - right.radius ||
      angularDistance(left.angle, input.inward) -
        angularDistance(right.angle, input.inward),
  );
  const items: OrbitLayoutItem[] = [];

  for (const action of input.actions) {
    const candidate = sortedCandidates.find((entry) => {
      const topLeft = topLeftFromCenter(entry.center);
      const item = {
        action,
        angle: normalizeAngle(entry.angle),
        radius: entry.radius,
        ring: "fallback" as const,
        x: topLeft.x,
        y: topLeft.y,
      };

      return validateLayout({
        bounds: input.bounds,
        items: [...items, item],
        mainCenter: input.mainCenter,
      });
    });

    if (!candidate) {
      continue;
    }

    const topLeft = topLeftFromCenter(candidate.center);
    items.push({
      action,
      angle: normalizeAngle(candidate.angle),
      radius: candidate.radius,
      ring: "fallback",
      x: topLeft.x,
      y: topLeft.y,
    });
  }

  return items.length === input.actions.length ? items : [];
}

function planOrbit(actions: OrbitAction[], mainCenter: Position) {
  if (actions.length === 0) {
    return [];
  }

  const bounds = getChildSafeBounds();
  const inward = inwardAngle(bounds, mainCenter);
  const fullLayout = fullOrbitLayout({ actions, bounds, mainCenter });

  if (fullLayout) {
    return fullLayout;
  }

  const innerArcs = findValidArcs({
    bounds,
    mainCenter,
    radius: INNER_ORBIT_RADIUS,
  });
  const innerArcResult = selectBestArc({
    arcs: innerArcs,
    count: actions.length,
    inward,
    radius: INNER_ORBIT_RADIUS,
  });

  if (innerArcResult?.capacity >= actions.length) {
    const items = buildLayoutItems({
      actions,
      angles: distributeAngles({
        arc: innerArcResult.arc,
        count: actions.length,
        inward,
        radius: INNER_ORBIT_RADIUS,
      }),
      mainCenter,
      radius: INNER_ORBIT_RADIUS,
      ring: "inner",
    });

    if (validateLayout({ bounds, items, mainCenter })) {
      return items;
    }
  }

  return (
    twoRingLayout({
      actions,
      bounds,
      inward,
      mainCenter,
    }) ?? fallbackLayout({ actions, bounds, inward, mainCenter })
  );
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    let query: MediaQueryList | null = null;
    function handleChange(event: MediaQueryListEvent) {
      setPrefersReducedMotion(event.matches);
    }

    const timer = window.setTimeout(() => {
      query = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(query.matches);
      query.addEventListener("change", handleChange);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      query?.removeEventListener("change", handleChange);
    };
  }, []);

  return prefersReducedMotion;
}

function Icon({ icon }: { icon: OrbitAction["icon"] | "menu" }) {
  const common = {
    "aria-hidden": true,
    className: "h-6 w-6",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };

  if (icon === "book") {
    return (
      <svg {...common}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
      </svg>
    );
  }

  if (icon === "calendar") {
    return (
      <svg {...common}>
        <path d="M8 2v4M16 2v4M3 10h18" />
        <rect height="18" rx="2" width="18" x="3" y="4" />
      </svg>
    );
  }

  if (icon === "logout") {
    return (
      <svg {...common}>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
    );
  }

  if (icon === "menu") {
    return (
      <svg {...common}>
        <path d="M5 7h14M5 12h14M5 17h14" />
      </svg>
    );
  }

  if (icon === "report") {
    return (
      <svg {...common}>
        <path d="M8 17V9M12 17V5M16 17v-6" />
        <path d="M5 21h14" />
      </svg>
    );
  }

  if (icon === "ticket") {
    return (
      <svg {...common}>
        <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" />
        <path d="M9 9h6M9 13h6" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 10h16l-1-6H5z" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </svg>
  );
}

export function PortableFloatingNav({
  items,
  salonName,
}: PortableFloatingNavProps) {
  const pathname = usePathname();
  const controlsId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const firstActionRef = useRef<HTMLAnchorElement | null>(null);
  const pointerRef = useRef<PointerSnapshot | null>(null);
  const dragMovedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const positionRef = useRef<Position>({ x: 0, y: 0 });
  const isReadyRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [isDimmed, setIsDimmed] = useState(false);
  const [dragTilt, setDragTilt] = useState(0);

  const mainCenter = useMemo(
    () => ({
      x: position.x + BUTTON_SIZE / 2,
      y: position.y + BUTTON_SIZE / 2,
    }),
    [position],
  );
  const actions = useMemo<OrbitAction[]>(
    () => [
      ...items.map((item) => ({ ...item, kind: "route" as const })),
      {
        icon: "logout" as const,
        id: "lock" as const,
        kind: "lock" as const,
        label: "Lock Portable POS",
      },
    ],
    [items],
  );
  const orbitItems = useMemo(
    () => (isReady ? planOrbit(actions, mainCenter) : []),
    [actions, isReady, mainCenter],
  );
  const transitionDuration = prefersReducedMotion
    ? REDUCED_MOTION_DURATION_MS
    : isOpen
      ? OPEN_DURATION_MS
      : CLOSE_DURATION_MS;

  const updatePosition = useCallback((next: Position) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const wake = useCallback(() => {
    setIsDimmed(false);

    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current);
    }

    inactivityTimerRef.current = window.setTimeout(() => {
      setIsDimmed(true);
    }, 2600);
  }, []);

  const clearMenuTimers = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }

    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }
  }, []);

  const openMenu = useCallback(() => {
    clearMenuTimers();
    setIsMenuMounted(true);
    openFrameRef.current = window.requestAnimationFrame(() => {
      setIsOpen(true);
      focusTimerRef.current = window.setTimeout(
        () => firstActionRef.current?.focus(),
        prefersReducedMotion ? REDUCED_MOTION_DURATION_MS : OPEN_DURATION_MS,
      );
    });
  }, [clearMenuTimers, prefersReducedMotion]);

  const closeMenu = useCallback(
    (returnFocus = false) => {
      clearMenuTimers();
      setIsOpen(false);
      closeTimerRef.current = window.setTimeout(
        () => {
          setIsMenuMounted(false);

          if (returnFocus) {
            buttonRef.current?.focus();
          }
        },
        prefersReducedMotion ? REDUCED_MOTION_DURATION_MS : CLOSE_DURATION_MS,
      );
    },
    [clearMenuTimers, prefersReducedMotion],
  );

  const toggleMenu = useCallback(() => {
    if (isOpen || isMenuMounted) {
      closeMenu(true);
      return;
    }

    openMenu();
  }, [closeMenu, isMenuMounted, isOpen, openMenu]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      updatePosition(restorePosition());
      isReadyRef.current = true;
      setIsReady(true);
      wake();
    }, 0);

    function handleResize() {
      if (!isReadyRef.current) {
        return;
      }

      setPosition((current) => {
        const bounds = getMainBounds();
        const next = {
          x: clamp(current.x, bounds.minX, bounds.maxX),
          y: clamp(current.y, bounds.minY, bounds.maxY),
        };
        positionRef.current = next;
        return next;
      });
    }

    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);

    return () => {
      window.clearTimeout(restoreTimer);
      clearMenuTimers();
      if (inactivityTimerRef.current !== null) {
        window.clearTimeout(inactivityTimerRef.current);
      }
      isReadyRef.current = false;
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [clearMenuTimers, updatePosition, wake]);

  useEffect(() => {
    const closeTimer = window.setTimeout(() => closeMenu(false), 0);

    return () => window.clearTimeout(closeTimer);
  }, [closeMenu, pathname]);

  useEffect(() => {
    if (!isMenuMounted) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu(true);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, isMenuMounted]);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }

    wake();
    dragMovedRef.current = false;
    pointerRef.current = {
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastTime: performance.now(),
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const snapshot = pointerRef.current;

    if (!snapshot || snapshot.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - snapshot.startClientX;
    const deltaY = event.clientY - snapshot.startClientY;
    const movedDistance = Math.hypot(deltaX, deltaY);
    const now = performance.now();
    const elapsed = Math.max(16, now - snapshot.lastTime);
    const velocityX = (event.clientX - snapshot.lastClientX) / elapsed;

    snapshot.lastClientX = event.clientX;
    snapshot.lastClientY = event.clientY;
    snapshot.lastTime = now;

    if (movedDistance >= TAP_MOVE_THRESHOLD) {
      dragMovedRef.current = true;
      closeMenu(false);
    }

    if (!dragMovedRef.current) {
      return;
    }

    const bounds = getMainBounds();
    setDragTilt(clamp(velocityX * 100, -5, 5));
    updatePosition({
      x: clamp(snapshot.startX + deltaX, bounds.minX, bounds.maxX),
      y: clamp(snapshot.startY + deltaY, bounds.minY, bounds.maxY),
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const snapshot = pointerRef.current;

    if (!snapshot || snapshot.pointerId !== event.pointerId) {
      return;
    }

    pointerRef.current = null;
    wake();
    setDragTilt(0);

    if (dragMovedRef.current) {
      persistPosition(positionRef.current);
      dragMovedRef.current = false;
      return;
    }

    toggleMenu();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      wake();
      toggleMenu();
    }

    if (event.key === "Escape") {
      closeMenu(true);
    }
  }

  if (!isReady || items.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed z-40"
      data-portable-floating-nav
      ref={rootRef}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <button
        aria-controls={isMenuMounted ? controlsId : undefined}
        aria-expanded={isOpen}
        aria-label="Open portable navigation"
        className={[
          "portable-nav-main-button relative grid place-items-center rounded-full bg-white text-zinc-950 shadow-[0_18px_46px_rgba(15,23,42,0.28)] outline-none ring-1 ring-zinc-950/36 transition duration-200 focus-visible:ring-4 focus-visible:ring-orange-500/30",
          isDimmed && !isOpen ? "opacity-58" : "opacity-100",
        ].join(" ")}
        data-open={isOpen}
        data-portable-floating-nav-button
        onFocus={wake}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerEnter={wake}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={buttonRef}
        style={{
          height: BUTTON_SIZE,
          touchAction: "none",
          transform: `rotate(${dragTilt}deg) scale(${isOpen ? 1.055 : 1})`,
          transitionDuration: `${prefersReducedMotion ? REDUCED_MOTION_DURATION_MS : 180}ms`,
          width: BUTTON_SIZE,
        }}
        type="button"
      >
        <span
          aria-hidden="true"
          className="portable-nav-main-halo pointer-events-none absolute -inset-[4px] rounded-full"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_rgba(255,255,255,0.96)] ring-1 ring-zinc-950/55"
        />
        <span className="relative z-10 grid h-full w-full place-items-center overflow-visible rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.98)]">
          <Image
            alt=""
            aria-hidden="true"
            className="h-[68px] w-[68px] max-w-none rounded-full object-contain drop-shadow-[0_14px_22px_rgba(15,23,42,0.30)]"
            data-portable-floating-nav-brand-icon
            draggable={false}
            height={512}
            priority
            src="/pos/portable-floating-menu-icon-gloss.png"
            width={512}
          />
        </span>
      </button>

      {isMenuMounted ? (
        <div
          aria-label={`Portable navigation for ${salonName}`}
          className="pointer-events-none fixed inset-0 z-40 bg-transparent"
          data-portable-floating-nav-menu
          id={controlsId}
          role="menu"
        >
          {orbitItems.map((item, index) => {
            const isActive =
              item.action.kind === "route" &&
              isPortablePosRoute(pathname, item.action.href);
            const itemCenter = {
              x: item.x + CHILD_BUTTON_SIZE / 2,
              y: item.y + CHILD_BUTTON_SIZE / 2,
            };
            const collapsedDelta = {
              x: mainCenter.x - itemCenter.x,
              y: mainCenter.y - itemCenter.y,
            };
            const transitionDelay =
              prefersReducedMotion || !isOpen ? 0 : index * STAGGER_MS;
            const transform = isOpen
              ? "translate3d(0, 0, 0) scale(1)"
              : `translate3d(${collapsedDelta.x}px, ${collapsedDelta.y}px, 0) scale(0.78)`;
            const commonClass = [
              isOpen ? "pointer-events-auto" : "pointer-events-none",
              "absolute grid place-items-center rounded-full bg-white/[0.72] text-zinc-950 shadow-[0_16px_42px_rgba(15,23,42,0.24)] outline-none ring-1 ring-zinc-950/32 backdrop-blur-md transition hover:bg-white/[0.86] hover:text-zinc-950 hover:ring-orange-500/45 focus-visible:ring-4 focus-visible:ring-orange-500/25",
              "before:pointer-events-none before:absolute before:inset-[1px] before:rounded-full before:ring-1 before:ring-white/72",
              isActive ? "ring-2 ring-teal-700/75 bg-teal-50/[0.78]" : "",
              item.action.kind === "lock"
                ? "hover:bg-orange-50/[0.88] hover:ring-orange-500/55"
                : "",
            ]
              .filter(Boolean)
              .join(" ");
            const commonStyle = {
              height: CHILD_BUTTON_SIZE,
              left: item.x,
              opacity: isOpen ? 1 : 0,
              top: item.y,
              transform,
              transitionDelay: `${transitionDelay}ms`,
              transitionDuration: `${transitionDuration}ms`,
              width: CHILD_BUTTON_SIZE,
            };

            if (item.action.kind === "route") {
              const action = item.action;

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  aria-label={action.label}
                  className={commonClass}
                  data-orbit-angle={item.angle.toFixed(2)}
                  data-orbit-radius={item.radius.toFixed(2)}
                  data-orbit-ring={item.ring}
                  data-portable-floating-nav-link={action.id}
                  href={action.href}
                  key={action.id}
                  onClick={() => closeMenu(false)}
                  ref={index === 0 ? firstActionRef : undefined}
                  role="menuitem"
                  style={commonStyle}
                  title={action.label}
                >
                  <Icon icon={action.icon} />
                  <span className="sr-only">{action.label}</span>
                </Link>
              );
            }

            return (
              <form
                action={logoutPortablePosAction}
                className={[
                  isOpen ? "pointer-events-auto" : "pointer-events-none",
                  "absolute",
                ].join(" ")}
                key={item.action.id}
                style={commonStyle}
              >
                <button
                  aria-label={item.action.label}
                  className={commonClass.replace("absolute ", "")}
                  data-orbit-angle={item.angle.toFixed(2)}
                  data-orbit-radius={item.radius.toFixed(2)}
                  data-orbit-ring={item.ring}
                  data-portable-floating-nav-lock
                  role="menuitem"
                  style={{
                    height: "100%",
                    opacity: commonStyle.opacity,
                    transform: commonStyle.transform,
                    transitionDelay: commonStyle.transitionDelay,
                    transitionDuration: commonStyle.transitionDuration,
                    width: "100%",
                  }}
                  title={item.action.label}
                  type="submit"
                >
                  <Icon icon={item.action.icon} />
                  <span className="sr-only">{item.action.label}</span>
                </button>
              </form>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
