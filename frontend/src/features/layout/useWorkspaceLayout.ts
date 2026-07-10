import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type PaneSide = "left" | "right";
type GripPositions = {
  left: number;
  right: number;
};

export const LEFT_PANE_DEFAULT_WIDTH = 320;
const LEFT_PANE_MIN_WIDTH = 240;
export const LEFT_PANE_MAX_WIDTH = 480;
export const RIGHT_PANE_DEFAULT_WIDTH = 352;
const RIGHT_PANE_MIN_WIDTH = 280;
export const RIGHT_PANE_MAX_WIDTH = 448;
const PANE_COLLAPSE_THRESHOLD = 96;
const PANE_DEFAULT_SNAP_THRESHOLD = 16;
const DESKTOP_RESIZE_BREAKPOINT = 1024;

function resolvePaneWidth(
  width: number,
  minWidth: number,
  maxWidth: number,
  defaultWidth: number,
  shouldSnap: boolean,
): { snapped: boolean; width: number } {
  if (width < PANE_COLLAPSE_THRESHOLD) {
    return { snapped: false, width: 0 };
  }

  if (shouldSnap && Math.abs(width - defaultWidth) <= PANE_DEFAULT_SNAP_THRESHOLD) {
    return { snapped: true, width: defaultWidth };
  }

  return { snapped: false, width: Math.min(Math.max(width, minWidth), maxWidth) };
}

export function useWorkspaceLayout() {
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE_DEFAULT_WIDTH);
  const [rightPaneWidth, setRightPaneWidth] = useState(RIGHT_PANE_DEFAULT_WIDTH);
  const [gripPositions, setGripPositions] = useState<GripPositions>({
    left: LEFT_PANE_DEFAULT_WIDTH,
    right: 0,
  });
  const [activeResizeSide, setActiveResizeSide] = useState<PaneSide | null>(null);
  const [snappedResizeSide, setSnappedResizeSide] = useState<PaneSide | null>(null);
  const [preFocusCenterWidth, setPreFocusCenterWidth] = useState<number | null>(null);
  const [isFocusEditorShrunk, setIsFocusEditorShrunk] = useState(false);

  const lastLeftPaneWidthRef = useRef(LEFT_PANE_DEFAULT_WIDTH);
  const lastRightPaneWidthRef = useRef(RIGHT_PANE_DEFAULT_WIDTH);
  const leftPaneWidthRef = useRef(LEFT_PANE_DEFAULT_WIDTH);
  const rightPaneWidthRef = useRef(RIGHT_PANE_DEFAULT_WIDTH);
  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const workspaceCenterContentRef = useRef<HTMLDivElement>(null);
  const leftSidebarRef = useRef<HTMLElement>(null);
  const rightSidebarRef = useRef<HTMLElement>(null);
  const markdownSurfaceRef = useRef<HTMLDivElement>(null);

  const isTextAreaPaneFocused = leftPaneWidth === 0 && rightPaneWidth === 0;
  const leftPaneClassName = `workspace-page-shell workspace-side-pane flex shrink-0 flex-col overflow-hidden transition-[width] duration-150 ease-out ${
    leftPaneWidth === 0 ? "workspace-side-pane-collapsed" : ""
  }`;
  const rightPaneClassName = `workspace-page-shell workspace-side-pane hidden min-h-0 shrink-0 overflow-hidden py-3 transition-[width,padding] duration-150 ease-out lg:flex ${
    rightPaneWidth === 0 ? "workspace-side-pane-collapsed px-0" : "px-3"
  }`;

  const capturePreFocusCenterWidth = useCallback(() => {
    const width = workspaceCenterContentRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) {
      setPreFocusCenterWidth(width);
    }
    setIsFocusEditorShrunk(false);
  }, []);

  const updateLeftPaneWidth = useCallback(
    (width: number, shouldSnap = false) => {
      const { snapped, width: nextWidth } = resolvePaneWidth(
        width,
        LEFT_PANE_MIN_WIDTH,
        LEFT_PANE_MAX_WIDTH,
        LEFT_PANE_DEFAULT_WIDTH,
        shouldSnap,
      );
      if (
        leftPaneWidthRef.current > 0 &&
        nextWidth === 0 &&
        rightPaneWidthRef.current === 0
      ) {
        capturePreFocusCenterWidth();
      }
      if (nextWidth > 0) {
        lastLeftPaneWidthRef.current = nextWidth;
        setIsFocusEditorShrunk(false);
      }
      leftPaneWidthRef.current = nextWidth;
      setSnappedResizeSide(snapped ? "left" : null);
      setLeftPaneWidth(nextWidth);
    },
    [capturePreFocusCenterWidth],
  );

  const updateRightPaneWidth = useCallback(
    (width: number, shouldSnap = false) => {
      const { snapped, width: nextWidth } = resolvePaneWidth(
        width,
        RIGHT_PANE_MIN_WIDTH,
        RIGHT_PANE_MAX_WIDTH,
        RIGHT_PANE_DEFAULT_WIDTH,
        shouldSnap,
      );
      if (
        rightPaneWidthRef.current > 0 &&
        nextWidth === 0 &&
        leftPaneWidthRef.current === 0
      ) {
        capturePreFocusCenterWidth();
      }
      if (nextWidth > 0) {
        lastRightPaneWidthRef.current = nextWidth;
        setIsFocusEditorShrunk(false);
      }
      rightPaneWidthRef.current = nextWidth;
      setSnappedResizeSide(snapped ? "right" : null);
      setRightPaneWidth(nextWidth);
    },
    [capturePreFocusCenterWidth],
  );

  const updateGripPositions = useCallback(() => {
    const workspaceRoot = workspaceRootRef.current;
    const leftSidebar = leftSidebarRef.current;
    const rightSidebar = rightSidebarRef.current;
    const markdownSurface = markdownSurfaceRef.current;
    if (!workspaceRoot || !leftSidebar || !rightSidebar || !markdownSurface) {
      return;
    }

    const rootRect = workspaceRoot.getBoundingClientRect();
    const leftSidebarRect = leftSidebar.getBoundingClientRect();
    const rightSidebarRect = rightSidebar.getBoundingClientRect();
    const markdownSurfaceRect = markdownSurface.getBoundingClientRect();
    const nextPositions = {
      left:
        leftPaneWidth === 0
          ? 0
          : (leftSidebarRect.right + markdownSurfaceRect.left) / 2 - rootRect.left,
      right:
        rightPaneWidth === 0
          ? rootRect.width
          : (markdownSurfaceRect.right + rightSidebarRect.left) / 2 - rootRect.left,
    };

    setGripPositions((currentPositions) =>
      Math.abs(currentPositions.left - nextPositions.left) < 0.5 &&
      Math.abs(currentPositions.right - nextPositions.right) < 0.5
        ? currentPositions
        : nextPositions,
    );
  }, [leftPaneWidth, rightPaneWidth]);

  useLayoutEffect(() => {
    let animationFrameId: number | null = null;
    const startedAt = performance.now();

    function updateDuringPaneTransition() {
      updateGripPositions();
      if (performance.now() - startedAt < 200) {
        animationFrameId = window.requestAnimationFrame(updateDuringPaneTransition);
      }
    }

    updateDuringPaneTransition();

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [updateGripPositions]);

  useEffect(() => {
    window.addEventListener("resize", updateGripPositions);
    return () => window.removeEventListener("resize", updateGripPositions);
  }, [updateGripPositions]);

  const startPaneResize = useCallback(
    (side: PaneSide, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setActiveResizeSide(side);
      setSnappedResizeSide(null);

      const startX = event.clientX;
      const startWidth = side === "left" ? leftPaneWidth : rightPaneWidth;
      const shouldSnapToDefault = window.innerWidth >= DESKTOP_RESIZE_BREAKPOINT;

      function handlePointerMove(moveEvent: PointerEvent) {
        const deltaX = moveEvent.clientX - startX;
        const nextWidth = side === "left" ? startWidth + deltaX : startWidth - deltaX;

        if (side === "left") {
          updateLeftPaneWidth(nextWidth, shouldSnapToDefault);
        } else {
          updateRightPaneWidth(nextWidth, shouldSnapToDefault);
        }
      }

      function stopResize() {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        setActiveResizeSide(null);
        setSnappedResizeSide(null);
      }

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [leftPaneWidth, rightPaneWidth, updateLeftPaneWidth, updateRightPaneWidth],
  );

  const toggleTextAreaFocus = useCallback(() => {
    if (isTextAreaPaneFocused) {
      const nextLeftWidth = lastLeftPaneWidthRef.current || LEFT_PANE_DEFAULT_WIDTH;
      const nextRightWidth = lastRightPaneWidthRef.current || RIGHT_PANE_DEFAULT_WIDTH;
      leftPaneWidthRef.current = nextLeftWidth;
      rightPaneWidthRef.current = nextRightWidth;
      setIsFocusEditorShrunk(false);
      setLeftPaneWidth(nextLeftWidth);
      setRightPaneWidth(nextRightWidth);
      return;
    }

    if (leftPaneWidth > 0) {
      lastLeftPaneWidthRef.current = leftPaneWidth;
    }
    if (rightPaneWidth > 0) {
      lastRightPaneWidthRef.current = rightPaneWidth;
    }

    capturePreFocusCenterWidth();
    leftPaneWidthRef.current = 0;
    rightPaneWidthRef.current = 0;
    setLeftPaneWidth(0);
    setRightPaneWidth(0);
  }, [capturePreFocusCenterWidth, isTextAreaPaneFocused, leftPaneWidth, rightPaneWidth]);

  return {
    activeResizeSide,
    gripPositions,
    isFocusEditorShrunk,
    isTextAreaPaneFocused,
    leftPaneClassName,
    leftPaneWidth,
    leftSidebarRef,
    markdownSurfaceRef,
    preFocusCenterWidth,
    rightPaneClassName,
    rightPaneWidth,
    rightSidebarRef,
    setIsFocusEditorShrunk,
    snappedResizeSide,
    startPaneResize,
    toggleTextAreaFocus,
    workspaceCenterContentRef,
    workspaceRootRef,
  };
}
